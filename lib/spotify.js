// lib/spotify.js
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = require('./config');

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify client credentials not configured.');
  }

  const now = Date.now();
  if (accessToken && now < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  const authHeader = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Spotify token: ${res.status} ${text}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return accessToken;
}

function extractPlaylistId(input) {
  if (!input) return null;

  // spotify:playlist:ID
  const colonMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (colonMatch) return colonMatch[1];

  // https://open.spotify.com/playlist/ID
  const urlMatch = input.match(/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // assume plain ID
  return input;
}

async function spotifyGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function getPlaylistMetadata(playlistId) {
  const data = await spotifyGet(`/playlists/${playlistId}`);
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    owner: data.owner?.display_name || data.owner?.id || 'Unknown',
    tracksTotal: data.tracks?.total || 0,
    url: data.external_urls?.spotify || '',
    images: data.images || []
  };
}

async function getPlaylistTracks(playlistId) {
  let url = `/playlists/${playlistId}/tracks?limit=100`;
  const tracks = [];

  while (url) {
    const data = await spotifyGet(url);
    for (const item of data.items || []) {
      const t = item.track;
      if (!t) continue;
      tracks.push({
        id: t.id,
        name: t.name,
        artists: (t.artists || []).map(a => a.name).join(', '),
        album: t.album?.name || '',
        spotifyUrl: t.external_urls?.spotify || '',
        durationMs: t.duration_ms || 0
      });
    }
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }

  return tracks;
}

module.exports = {
  extractPlaylistId,
  getPlaylistMetadata,
  getPlaylistTracks
};
