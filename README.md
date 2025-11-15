# 🎵 Backup Sptfy

A self-hosted web app that automatically backs up your Spotify playlists as local MP3 files using **spotdl**.  
Built with **Node.js + Express**, **EJS templates**, and a **dark Spotify-inspired UI**.

### ⭐ Features

- Add Spotify playlist URLs via environment variables  
- Fetch playlist metadata via Spotify Web API (Client Credentials flow)  
- Dark dashboard UI showing playlist covers  
- Track-level status (Downloaded / Pending / Error)  
- Sync playlists on demand with spotdl  
- Per-playlist download logs  
- Download an entire playlist as a ZIP archive  
- Auto-detect new/removed tracks via periodic metadata refresh  
- Dockerized (Node + Python + spotdl)  
- No database — filesystem + in-memory state

---

### 🚀 Running with Docker

```bash
cp .env.example .env   # fill in SPOTIFY_CLIENT_ID, CLIENT_SECRET, PLAYLIST_URLS
docker compose up --build

http://localhost:5000

/app
  /views        # EJS templates
  /routes       # Express routes
  /public       # CSS + static files
  /downloads    # Playlist folders + mp3s
  server.js
  Dockerfile
  docker-compose.yml

Stack:
- Node.js 20
- Express
- EJS templates
- Spotify Web API
- spotdl (Python)
- ffmpeg
- Docker + Debian bookworm (Python 3.11)
