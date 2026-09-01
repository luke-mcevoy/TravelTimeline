# Deploying Travel Timeline

The app ships as a **single deployable unit**: the Express server hosts the
API *and* the built client (with an SPA fallback for `/` and `/render`).
Because the client calls the API with relative `/api/...` paths, same-origin
hosting means zero URL configuration.

## What works where

| Feature | Mac (local) | Linux / cloud |
| --- | --- | --- |
| Globe, timeline, manual trips, import/export JSON | ✅ | ✅ |
| Supabase social (accounts, friends, leaderboards) | ✅ | ✅ |
| Apple Photos story builder | ✅ (needs Full Disk Access) | ❌ reports "not accessible" gracefully |
| Video export (1080p MP4) | ✅ (GPU) | ✅ (software WebGL — slower) |

The Apple Photos pipeline reads `~/Pictures/Photos Library.photoslibrary`
and uses `sips`, both macOS-only. On any other host the UI simply doesn't
offer the story builder; users build trips manually or sign in to view
synced/social data.

## Option 1 — Bare Node (any host, including a Mac)

```bash
npm ci
npm run build      # client (static) + server (dist/)
NODE_ENV=production npm start
```

The server listens on `PORT` (default 3001) and serves the client build it
finds at `client/dist`. Visit `http://localhost:3001`.

## Option 2 — Docker

```bash
docker build -t travel-timeline .
docker run -p 3001:3001 travel-timeline
```

The image includes Chromium (for the video exporter) and sets
`RENDER_FORCE_SOFTWARE=1` since containers have no GPU. To bake in the
Supabase social layer:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://xyz.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=eyJ... \
  -t travel-timeline .
```

## Option 3 — Render.com (one click)

`render.yaml` at the repo root is a Render blueprint. Create a new
Blueprint instance pointing at this repo and Render builds the Dockerfile
and wires the health check (`/health`) automatically. Set the
`VITE_SUPABASE_*` env vars in the dashboard if you want social features
(Render exposes env vars to the Docker build, where the Dockerfile declares
matching `ARG`s).

Any other Docker host (Fly.io, Railway, a VPS) works the same way — the
only contract is: run the container, route traffic to `PORT`.

## Environment variables

### Server (runtime)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Listen port |
| `NODE_ENV` | — | `production` disables the permissive dev CORS |
| `CORS_ORIGIN` | *(same-origin only)* | Comma-separated origins, only needed if the client is hosted elsewhere |
| `CLIENT_DIST` | `<repo>/client/dist` | Override where the client build lives |
| `RENDER_CLIENT_URL` | self (`http://localhost:PORT/render`) | Page Puppeteer captures for video export |
| `RENDER_FORCE_SOFTWARE` | — | `1` forces software WebGL (headless hosts without GPU) |
| `MAX_CONCURRENT_RENDERS` | `2` | Cap on simultaneous video renders |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detected | Chrome/Chromium binary for video export |
| `FFMPEG_PATH` | bundled `ffmpeg-static` | FFmpeg override |

### Client (build time — baked into the bundle by Vite)

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL (omit both to disable social) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_APPLE_CLIENT_ID` / `VITE_APPLE_REDIRECT_URI` | Sign in with Apple (native iOS only) |

Supabase setup (schema, auth providers) is documented in
[`SOCIAL_SETUP.md`](./SOCIAL_SETUP.md).

## Security posture

- CORS is **same-origin only** in production unless `CORS_ORIGIN` is set.
- Rendered videos are claimed with a **single-use random token** (not IP).
- The photo thumbnail endpoint resolves paths and rejects anything outside
  the Photos originals directory.
- Video rendering is capped at `MAX_CONCURRENT_RENDERS` with a bounded
  in-memory download cache (5 entries, 5-minute TTL).
- There is **no authentication on the API itself**. The Apple Photos
  endpoints only ever expose data on a Mac where the server has Full Disk
  Access — do not run this on a shared/public Mac. Social auth is enforced
  by Supabase row-level security, not by this server.
