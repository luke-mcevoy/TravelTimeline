import type { SupabaseClient } from '@supabase/supabase-js';
import { socialEnabled, socialMock } from './socialConfig';
import { getSupabaseClient } from './socialApi';

export { socialEnabled, socialMock } from './socialConfig';

export const supabase: SupabaseClient | null =
  socialEnabled && !socialMock ? getSupabaseClient() : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Social backend is not configured.');
  return supabase;
}
