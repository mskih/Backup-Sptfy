// lib/config.js
const path = require('path');
require('dotenv').config();

const PLAYLIST_URLS = (process.env.PLAYLIST_URLS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
  console.warn('[config] SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set. Spotify API will fail.');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  PLAYLIST_URLS,
  DOWNLOAD_ROOT: path.resolve(process.env.DOWNLOAD_ROOT || './downloads'),
  METADATA_REFRESH_MINUTES: Number(process.env.METADATA_REFRESH_MINUTES || 30),
  DOWNLOAD_SCAN_SECONDS: Number(process.env.DOWNLOAD_SCAN_SECONDS || 15),
  SPOTDL_CMD: process.env.SPOTDL_CMD || 'spotdl'
};
