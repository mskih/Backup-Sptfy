// server.js
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const archiver = require('archiver');
const fs = require('fs');
const {
  PORT,
  DOWNLOAD_ROOT,
  METADATA_REFRESH_MINUTES,
  DOWNLOAD_SCAN_SECONDS
} = require('./lib/config');
const {
  initPlaylistsFromEnv,
  getAllPlaylistsSummary,
  getPlaylistById,
  refreshMetadataAndTracks,
  updateDownloadStatus,
  startSync
} = require('./lib/playlists');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

// Ensure download root exists
fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });

// Routes

// Home: playlists grid
app.get('/', (req, res) => {
  const playlists = getAllPlaylistsSummary();
  res.render('index', {
    title: 'Backup Sptfy',
    playlists
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
    playlist
  });
});

// Trigger sync
app.post('/playlist/:id/sync', (req, res) => {
  const playlist = getPlaylistById(req.params.id);
  if (!playlist) {
    return res.status(404).send('Playlist not found');
  }
  try {
    if (playlist.process) {
      return res.redirect(`/playlist/${playlist.id}`);
    }
    startSync(playlist.id);
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

  const zipName = `${playlist.name || playlist.id}.zip`.replace(/[^\w\d-_.]+/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
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

// Simple JSON API endpoints (optional, for polling/progress)
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

// Start server
app.listen(PORT, async () => {
  console.log(`Backup Sptfy running on http://0.0.0.0:${PORT}`);

  // Initialize playlists
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
    console.log(`Metadata refresh interval: ${METADATA_REFRESH_MINUTES} minutes`);
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
    console.log(`Download scan interval: ${DOWNLOAD_SCAN_SECONDS} seconds`);
  }
});
