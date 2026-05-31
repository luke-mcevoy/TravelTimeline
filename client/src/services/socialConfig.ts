const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const hasRealCreds = Boolean(url?.trim() && anonKey?.trim());
const mockFlag = import.meta.env.VITE_SOCIAL_MOCK as string | undefined;

export const socialMock =
  mockFlag === '1' || (import.meta.env.DEV && mockFlag !== '0' && !hasRealCreds);

export const socialEnabled = hasRealCreds || socialMock;

export const supabaseUrl = hasRealCreds ? url!.trim() : undefined;
export const supabaseAnonKey = hasRealCreds ? anonKey!.trim() : undefined;
