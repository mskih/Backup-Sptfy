// server.js
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const archiver = require('archiver');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const {
  PORT,
  DOWNLOAD_ROOT,
  METADATA_REFRESH_MINUTES,
  DOWNLOAD_SCAN_SECONDS,
  YT_DOWNLOAD_ROOT
} = require('./lib/config');

const {
  initPlaylistsFromEnv,
  getAllPlaylistsSummary,
  getPlaylistById,
  refreshMetadataAndTracks,
  updateDownloadStatus,
  startSync,
  addPlaylistFromUrl,
  cleanupOldPlaylistContent
} = require('./lib/playlists');

const app = express();

// 1 hour TTL for downloaded content (playlists & YouTube jobs)
const CONTENT_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // cleanup every 10 minutes

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

// Ensure download roots exist
fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });
fs.mkdirSync(YT_DOWNLOAD_ROOT, { recursive: true });

// ----------------------------------------------------------
// Home: playlists grid
// ----------------------------------------------------------
app.get('/', (req, res) => {
  const playlists = getAllPlaylistsSummary();
  res.render('index', {
    title: 'Backup Sptfy',
    playlists,
    active: 'home'
  });
});

// Playlist detail
app.get('/playlist/:id', (req, res) => {
  const playlist = getPlaylistById(req.params.id);
  if (!playlist) {
    return res.status(404).send('Playlist not found');
  }
  res.render('playlist', {
    title: playlist.name || 'Playlist',
    playlist,
    active: 'home'
  });
});

// Trigger sync
app.post('/playlist/:id/sync', (req, res) => {
  const playlist = getPlaylistById(req.params.id);
  if (!playlist) {
    return res.status(404).send('Playlist not found');
  }
  try {
    if (!playlist.process) {
      startSync(playlist.id);
    }
    res.redirect(`/playlist/${playlist.id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to start sync');
  }
});

// Download ZIP of playlist folder
app.get('/playlist/:id/download', (req, res) => {
  const playlist = getPlaylistById(req.params.id);
  if (!playlist) {
    return res.status(404).send('Playlist not found');
  }

  const dir = playlist.downloadDir;
  if (!fs.existsSync(dir)) {
    return res.status(404).send('No downloaded files yet');
  }

  const zipName = `${playlist.name || playlist.id}.zip`.replace(
    /[^\w\d-_.]+/g,
    '_'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${zipName}"`
  );
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('Archive error:', err);
    res.status(500).end();
  });

  archive.pipe(res);
  archive.directory(dir, false);
  archive.finalize();
});

// ----------------------------------------------------------
// Add playlist (manual URL) page
// ----------------------------------------------------------

// Show form
app.get('/playlists/add', (req, res) => {
  res.render('add_playlist', {
    title: 'Add playlist',
    error: null,
    url: '',
    active: 'add'
  });
});

// Handle form submit
app.post('/playlists/add', async (req, res) => {
  const url = (req.body.url || '').trim();
  if (!url) {
    return res.status(400).render('add_playlist', {
      title: 'Add playlist',
      error: 'Please enter a Spotify playlist URL.',
      url,
      active: 'add'
    });
  }

  try {
    const playlist = await addPlaylistFromUrl(url);
    return res.redirect(`/playlist/${playlist.id}`);
  } catch (err) {
    console.error('[add playlist] error:', err);
    return res.status(400).render('add_playlist', {
      title: 'Add playlist',
      error: err.message || 'Failed to add playlist.',
      url,
      active: 'add'
    });
  }
});

// ----------------------------------------------------------
// YouTube → MP3 feature
// ----------------------------------------------------------

// In-memory job state
// { [id]: { id, url, dir, status, files, logs, startedAt, finishedAt, error } }
const ytJobs = new Map();

function newJobId() {
  return crypto.randomBytes(6).toString('hex');
}

function safeName(name) {
  return name.replace(/[^\w\d\-_.\[\]\(\) ]+/g, '_');
}

// YouTube form
app.get('/yt', (req, res) => {
  res.render('yt', {
    title: 'YouTube → MP3',
    job: null,
    active: 'yt'
  });
});

// Start job
app.post('/yt', (req, res) => {
  const url = (req.body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).send('Please provide a valid http(s) URL.');
  }

  const jobId = newJobId();
  const dir = path.join(YT_DOWNLOAD_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });

  const job = {
    id: jobId,
    url,
    dir,
    status: 'running',
    files: [],
    logs: [],
    startedAt: new Date(),
    finishedAt: null,
    error: null
  };
  ytJobs.set(jobId, job);

  const args = [
    url,
    '-x',
    '--audio-format',
    'mp3',
    '--add-metadata',
    '--embed-thumbnail',
    '--write-info-json',
    '-o',
    '%(title)s [%(id)s].%(ext)s'
  ];

  const child = spawn('yt-dlp', args, { cwd: dir });

  const log = (line, stream = 'stdout') => {
    const msg = `[${new Date().toISOString()}] [${stream}] ${line}`;
    job.logs.push(msg);
    if (job.logs.length > 500) job.logs.shift();
    const fn = stream === 'stderr' ? console.error : console.log;
    fn('[yt-dlp]', line.trim());
  };

  child.stdout.on('data', d => log(d.toString(), 'stdout'));
  child.stderr.on('data', d => log(d.toString(), 'stderr'));

  child.on('close', code => {
    job.finishedAt = new Date();
    if (code === 0) {
      job.status = 'done';
      try {
        job.files = fs
          .readdirSync(dir)
          .filter(f => /\.mp3$/i.test(f))
          .map(f => ({
            name: f,
            href: `/yt/${jobId}/file/${encodeURIComponent(f)}`
          }));
      } catch (e) {
        job.files = [];
      }
    } else {
      job.status = 'error';
      job.error = `yt-dlp exited with code ${code}`;
    }
  });

  child.on('error', err => {
    job.finishedAt = new Date();
    job.status = 'error';
    job.error = `Failed to start yt-dlp: ${err.message}`;
  });

  res.redirect(`/yt/${jobId}`);
});

// Job status
app.get('/yt/:jobId', (req, res) => {
  const job = ytJobs.get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found');
  res.render('yt', { title: 'YouTube → MP3', job, active: 'yt' });
});

// Serve MP3
app.get('/yt/:jobId/file/:name', (req, res) => {
  const job = ytJobs.get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found');
  const requested = path.basename(req.params.name);
  const filePath = path.join(job.dir, requested);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath, safeName(requested));
});

// ----------------------------------------------------------
// Simple JSON API endpoints (optional)
// ----------------------------------------------------------
app.get('/api/playlists', (req, res) => {
  res.json(getAllPlaylistsSummary());
});

app.get('/api/playlists/:id', (req, res) => {
  const playlist = getPlaylistById(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner,
    status: playlist.status,
    tracksTotal: playlist.tracksTotal,
    downloadedCount: playlist.downloadedCount,
    lastSyncAt: playlist.lastSyncAt,
    lastMetadataRefreshAt: playlist.lastMetadataRefreshAt,
    errorMessage: playlist.errorMessage
  });
});

// ----------------------------------------------------------
// Cleanup for old content (playlists + yt jobs)
// ----------------------------------------------------------
function cleanupYtJobs(ttlMs) {
  const now = Date.now();
  for (const [id, job] of ytJobs.entries()) {
    if (!job.finishedAt) continue; // don't touch running jobs
    const age = now - job.finishedAt.getTime();
    if (age < ttlMs) continue;

    try {
      if (fs.existsSync(job.dir)) {
        fs.rmSync(job.dir, { recursive: true, force: true });
      }
      ytJobs.delete(id);
      console.log(`[cleanup] Removed YouTube job ${id} content after TTL`);
    } catch (err) {
      console.error(`[cleanup] Failed to clean YouTube job ${id}:`, err);
    }
  }
}

// ----------------------------------------------------------
// Start server + background refresh loops
// ----------------------------------------------------------
app.listen(PORT, async () => {
  console.log(`Backup Sptfy running on http://0.0.0.0:${PORT}`);

  // Initialize playlists from env
  await initPlaylistsFromEnv();

  // Periodic metadata refresh
  if (METADATA_REFRESH_MINUTES > 0) {
    setInterval(async () => {
      const playlists = getAllPlaylistsSummary();
      for (const p of playlists) {
        const full = getPlaylistById(p.id);
        if (full) {
          await refreshMetadataAndTracks(full);
        }
      }
    }, METADATA_REFRESH_MINUTES * 60 * 1000);
    console.log(
      `Metadata refresh interval: ${METADATA_REFRESH_MINUTES} minutes`
    );
  }

  // Periodic download status refresh
  if (DOWNLOAD_SCAN_SECONDS > 0) {
    setInterval(async () => {
      const playlists = getAllPlaylistsSummary();
      for (const p of playlists) {
        const full = getPlaylistById(p.id);
        if (full) {
          await updateDownloadStatus(full);
        }
      }
    }, DOWNLOAD_SCAN_SECONDS * 1000);
    console.log(
      `Download scan interval: ${DOWNLOAD_SCAN_SECONDS} seconds`
    );
  }

  // Periodic cleanup for old content
  setInterval(() => {
    cleanupOldPlaylistContent(CONTENT_TTL_MS);
    cleanupYtJobs(CONTENT_TTL_MS);
  }, CLEANUP_INTERVAL_MS);
  console.log(
    `Content cleanup TTL: ${CONTENT_TTL_MS / (60 * 1000)} minutes; interval: ${
      CLEANUP_INTERVAL_MS / (60 * 1000)
    } minutes`
  );
});
