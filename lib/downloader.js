// lib/downloader.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SPOTDL_CMD } = require('./config');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function startPlaylistDownload(playlistUrl, downloadDir, onLog) {
  ensureDir(downloadDir);

  const args = [
    playlistUrl
    // You can add extra flags here if needed, e.g.:
    // '--user-auth',
    // '--m3u', 'playlist.m3u',
    // '--bitrate', '320k',
  ];

  const child = spawn(SPOTDL_CMD, args, {
    cwd: downloadDir,
    shell: false
  });

  child.stdout.on('data', data => {
    const line = data.toString();
    console.log('[spotdl stdout]', line.trim());
    onLog && onLog(line, 'stdout');
  });

  child.stderr.on('data', data => {
    const line = data.toString();
    console.error('[spotdl stderr]', line.trim());
    onLog && onLog(line, 'stderr');
  });

  return child;
}

function listAudioFiles(downloadDir) {
  if (!fs.existsSync(downloadDir)) return [];
  const exts = ['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav'];
  return fs.readdirSync(downloadDir).filter(f =>
    exts.includes(path.extname(f).toLowerCase())
  );
}

module.exports = {
  startPlaylistDownload,
  listAudioFiles
};
