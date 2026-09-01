import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RuntimeConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function readConfig(): { url?: string; anonKey?: string } {
  const runtime =
    typeof window !== 'undefined'
      ? ((window as unknown as { __TT_CONFIG__?: RuntimeConfig }).__TT_CONFIG__ ?? {})
      : {};
  const url =
    (runtime.supabaseUrl && runtime.supabaseUrl.trim()) ||
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    undefined;
  const anonKey =
    (runtime.supabaseAnonKey && runtime.supabaseAnonKey.trim()) ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    undefined;
  return { url, anonKey };
}

const { url, anonKey } = readConfig();

/**
 * Whether the social backend is configured. When false, every social surface is
 * hidden and the app behaves exactly like the original local-only globe, so a
 * missing/early-stage Supabase setup never breaks the core experience.
 *
 * Production deploys inject keys via `window.__TT_CONFIG__` (server runtime
 * env). Local `npm run dev` still uses `client/.env.local`.
 */
export const socialEnabled = Boolean(url && anonKey);

/**
 * Shared Supabase client, or null when unconfigured. Persists the session in
 * localStorage and auto-refreshes tokens so a signed-in user stays signed in
 * across launches.
 */
export const supabase: SupabaseClient | null = socialEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/** Narrowing helper: throws if called when the backend isn't configured. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Social backend is not configured.');
  return supabase;
}
