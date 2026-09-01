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

## Share from this Mac (a friend signs in)

`localhost` is only this computer. A friend on LTE cannot reach it. You do
not need Render for that — you need a public URL that forwards to this Mac.
You already do this for Carriage with Cloudflare.

```bash
chmod +x serve-public.sh   # once
./serve-public.sh
```

Copy the `https://….trycloudflare.com` line and send it. Leave the window
open; plug the Mac in; don’t close the lid. They sign in on that URL the
same way you do (email + password, or a code). Friends still go through
Supabase — the tunnel is just the website. After you `npm run build`,
hard-refresh the tunnel (Cmd+Shift+R) so the service worker drops the old JS.

The trycloudflare hostname changes each run. Password sign-in still works.
If you use magic-link emails, add that hostname under Supabase →
Authentication → URL Configuration → Redirect URLs.

When you quit the script, the URL dies. That’s the trade vs Render: your
Mac is the server.

## Option 2 — Docker

```bash
docker build -t travel-timeline .
docker run -p 3001:3001 travel-timeline
```

The image is a slim Node runtime (no Chromium). Reels record in the
browser; 1080p server export stays on a Mac. Enable social at
**runtime** (no rebuild) by passing the same keys you keep in
`client/.env.local`:

```bash
docker run -p 3001:3001 \
  -e SUPABASE_URL=https://xyz.supabase.co \
  -e SUPABASE_ANON_KEY=eyJ... \
  travel-timeline
```

## Option 3 — Render.com (one click)

`render.yaml` at the repo root is a Render blueprint. Create a new
Blueprint instance pointing at this repo and Render builds the Dockerfile
and wires the health check (`/health`) automatically.

**To turn on accounts / friends / leaderboards:** in the Render service →
**Environment**, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (copy from
`client/.env.local`). Then in the Supabase dashboard → **Authentication →
URL Configuration**, set **Site URL** to your Render URL
(`https://travel-timeline.onrender.com`) so email login codes work.

The live site is also a **PWA**: on iPhone, open it in Safari → Share →
**Add to Home Screen**. It launches full-screen like a native app.

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
| `DISABLE_SERVER_RENDER` | — | `1` disables Chromium 1080p export |
| `ENABLE_SERVER_RENDER` | — | `1` forces it on (even on Render — will OOM the free plan) |
| `MAX_CONCURRENT_RENDERS` | `1` | Cap on simultaneous video renders |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detected | Chrome/Chromium binary for video export |
| `FFMPEG_PATH` | bundled `ffmpeg-static` | FFmpeg override |
| `SUPABASE_URL` | — | Enables social (accounts, friends, leaderboards) |
| `SUPABASE_ANON_KEY` | — | Supabase anon key (public by design; RLS enforces access) |

### Client (local dev — `client/.env.local`)

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL`; used by Vite in `npm run dev` |
| `VITE_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` |
| `VITE_APPLE_CLIENT_ID` / `VITE_APPLE_REDIRECT_URI` | Sign in with Apple (native iOS / Capacitor only) |

Supabase setup (schema, auth providers) is documented in
[`SOCIAL_SETUP.md`](./SOCIAL_SETUP.md).

## Security posture

- CORS is **same-origin only** in production unless `CORS_ORIGIN` is set.
- Rendered videos are claimed with a **single-use random token** (not IP).
- The photo thumbnail endpoint resolves paths and rejects anything outside
  the Photos originals directory.
- Video rendering is off on Render (free 512 MB cannot run Chromium). Locally
  it is capped at `MAX_CONCURRENT_RENDERS` with a single in-memory download.
- There is **no authentication on the API itself**. The Apple Photos
  endpoints only ever expose data on a Mac where the server has Full Disk
  Access — do not run this on a shared/public Mac. Social auth is enforced
  by Supabase row-level security, not by this server.
