# AGENTS.md

Guidance for AI agents working in this repository.

## Cursor Cloud specific instructions

### Product

**Travel Timeline** is an npm-workspace monorepo (`client/` + `server/`): a React/Vite web app with an Express API for macOS Apple Photos import and server-side video export. See `README.md` for architecture and endpoints.

### Dev servers

From the repo root:

```bash
npm run dev
```

- **Client (Vite):** http://localhost:5173 — proxies `/api` to the server (`client/vite.config.ts`).
- **Server (Express):** http://localhost:3001 — `GET /health` for liveness.

Use **tmux** for long-running `npm run dev` (both processes via `concurrently`).

### Linux / Cloud VM caveats

- **Apple Photos import does not work** off macOS. `GET /api/apple-photos/status` returns `accessible: false` when `Photos.sqlite` is missing (expected on Linux).
- **Core UI and globe still work:** seed trips via the trip panel (**New Trip**, city search), **Import** JSON, or `localStorage` key `travel-timeline-trips`.
- **Satellite tiles** need outbound network (ESRI CDN).
- **Video export** (`POST /api/render-video`) needs Chrome/Chromium + FFmpeg; not required for basic globe/timeline dev.

### Lint, test, build

| Task | Command | Notes |
|------|---------|--------|
| Lint | `npm run lint` | ESLint on `client/` (currently clean — keep it that way) |
| Build | `npm run build` | `tsc -b && vite build` (client) + `tsc` (server) |
| Start (prod) | `npm start` | One process: serves client build + API on `PORT` (default 3001) |
| Tests | — | No unit/e2e test script in `package.json` today; CI runs lint + build + Docker smoke test |

### Deployment

Single deployable unit: the Express server hosts the built client with an SPA
fallback. `Dockerfile` + `render.yaml` at the root; full guide in
`docs/DEPLOYMENT.md`.

### Optional: Supabase social features

Requires `client/.env.local` from `client/.env.example` and schema in `client/supabase/schema.sql`. See `docs/SOCIAL_SETUP.md`. Omit env vars to run without social.

### iOS (Capacitor)

Native path: `npm run ios:sync` / `ios:open` in `client/` (Xcode on macOS only). Not needed for web dev in Cloud.
