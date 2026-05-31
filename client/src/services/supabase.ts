import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Whether the social backend is configured. When false, every social surface is
 * hidden and the app behaves exactly like the original local-only globe, so a
 * missing/early-stage Supabase setup never breaks the core experience.
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
