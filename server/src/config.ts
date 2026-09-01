import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const PORT = Number(process.env.PORT) || 3001;

/**
 * Where the built client lives. In the monorepo layout this file compiles to
 * server/dist/config.js, so two levels up is the repo root — the same relative
 * hop works when running from src/ via tsx. Override with CLIENT_DIST.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const CLIENT_DIST =
  process.env.CLIENT_DIST ?? join(here, '..', '..', 'client', 'dist');

/** True when a production client build exists and the server should host it. */
export function clientBuildAvailable(): boolean {
  return existsSync(join(CLIENT_DIST, 'index.html'));
}

/**
 * URL of the client's /render page that Puppeteer captures for video export.
 * When the server hosts the client build, it points at itself; otherwise it
 * falls back to the Vite dev server. Override with RENDER_CLIENT_URL.
 */
export function renderClientUrl(): string {
  if (process.env.RENDER_CLIENT_URL) return process.env.RENDER_CLIENT_URL;
  return clientBuildAvailable()
    ? `http://localhost:${PORT}/render`
    : 'http://localhost:5173/render';
}
