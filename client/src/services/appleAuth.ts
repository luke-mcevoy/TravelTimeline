import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { requireSupabase } from './supabase';

const APPLE_NAME_KEY = 'tt_apple_name';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Native Sign in with Apple → Supabase session.
 *
 * Supabase verifies the Apple identity token against a nonce, and Apple hashes
 * the nonce it receives. So we generate a raw nonce, send Apple its SHA-256, and
 * hand Supabase the raw value. Apple only returns the user's name on the FIRST
 * authorization ever, so we stash it for the profile step.
 */
export async function signInWithApple(): Promise<void> {
  const sb = requireSupabase();
  const rawNonce = crypto.randomUUID() + crypto.randomUUID();
  const hashedNonce = await sha256Hex(rawNonce);

  const result = await SignInWithApple.authorize({
    clientId: (import.meta.env.VITE_APPLE_CLIENT_ID as string) ?? '',
    redirectURI: (import.meta.env.VITE_APPLE_REDIRECT_URI as string) ?? '',
    scopes: 'email name',
    nonce: hashedNonce,
  });

  const idToken = result.response?.identityToken;
  if (!idToken) throw new Error('Apple did not return an identity token.');

  const { error } = await sb.auth.signInWithIdToken({
    provider: 'apple',
    token: idToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  const fullName = [result.response?.givenName, result.response?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (fullName) localStorage.setItem(APPLE_NAME_KEY, fullName);
}

/** Name captured from Apple's one-time grant, if any. */
export function consumeAppleName(): string | null {
  const v = localStorage.getItem(APPLE_NAME_KEY);
  return v && v.length > 0 ? v : null;
}
