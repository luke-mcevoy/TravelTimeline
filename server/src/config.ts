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

/**
 * Server-side 1080p export launches Chromium + FFmpeg. That fits a Mac, not a
 * 512 MB Render free instance — one render OOMs the whole web process.
 *
 * Disabled automatically on Render unless ENABLE_SERVER_RENDER=1. Override off
 * anywhere with DISABLE_SERVER_RENDER=1.
 */
export function serverVideoEnabled(): boolean {
  if (process.env.DISABLE_SERVER_RENDER === '1') return false;
  if (process.env.ENABLE_SERVER_RENDER === '1') return true;
  if (process.env.RENDER === 'true') return false;
  return true;
}

/**
 * Public client config injected into index.html at serve time. Lets a hosted
 * deploy enable the Supabase social layer via runtime env vars (no rebuild).
 * The anon key is designed to be public — RLS is the real access control.
 */
export function publicClientConfig(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
  serverVideo: boolean;
} {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey:
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    serverVideo: serverVideoEnabled(),
  };
}
