import { create } from 'zustand';
import { supabase, socialEnabled } from '@/services/supabase';
import { signInWithApple, consumeAppleName } from '@/services/appleAuth';
import { getMyProfile, createProfile, isHandleAvailable, type Profile } from '@/services/social';

type Status = 'loading' | 'signedOut' | 'needsProfile' | 'ready';

interface AuthStore {
  status: Status;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  busy: boolean;
  error: string | null;
  otpSent: boolean;
  /** After an OTP login, pick a password so the next origin doesn't need a code. */
  needsPassword: boolean;

  init: () => void;
  signInApple: () => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<void>;
  signUpPassword: (email: string, password: string) => Promise<void>;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  setPassword: (password: string) => Promise<boolean>;
  skipPassword: () => void;
  submitProfile: (handle: string, displayName: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  resetOtp: () => void;
  clearError: () => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

function authMessage(e: unknown): string {
  const m = message(e);
  if (/invalid login credentials/i.test(m)) {
    return 'Wrong email or password. If you signed up with a code, use “Email me a code” once, then set a password.';
  }
  if (/user already registered/i.test(m)) {
    return 'That email already has an account. Sign in instead.';
  }
  return m;
}

let authStarted = false;

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: socialEnabled ? 'loading' : 'signedOut',
  userId: null,
  email: null,
  profile: null,
  busy: false,
  error: null,
  otpSent: false,
  needsPassword: false,

  init: () => {
    if (!supabase || authStarted) return;
    authStarted = true;

    const applySession = async (userId: string | null, email: string | null) => {
      if (!userId) {
        set({ status: 'signedOut', userId: null, email: null, profile: null });
        return;
      }
      set({ userId, email });
      try {
        const profile = await getMyProfile(userId);
        set({ profile, status: profile ? 'ready' : 'needsProfile' });
      } catch (e) {
        set({ error: message(e), status: 'needsProfile' });
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      applySession(s?.user.id ?? null, s?.user.email ?? null);
    });

    // INITIAL_SESSION is handled by getSession above. Listening to it as well
    // can flash signedOut and force another email login on every refresh.
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      applySession(session?.user.id ?? null, session?.user.email ?? null);
    });
  },

  signInApple: async () => {
    set({ busy: true, error: null });
    try {
      await signInWithApple();
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  signInPassword: async (email, password) => {
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
    } catch (e) {
      set({ error: authMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  signUpPassword: async (email, password) => {
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      // Email-enumeration protection: existing users come back with no identities.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        set({ error: 'That email already has an account. Sign in instead.' });
        return;
      }
      if (!data.session) {
        set({
          error: 'Check your email to confirm the account, then sign in with your password.',
        });
      }
    } catch (e) {
      set({ error: authMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  sendEmailOtp: async (email) => {
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      set({ otpSent: true, email: email.trim() });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  verifyEmailOtp: async (email, token) => {
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: 'email',
      });
      if (error) throw error;
      set({ otpSent: false, needsPassword: true });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  setPassword: async (password) => {
    if (!supabase) return false;
    if (password.length < 6) {
      set({ error: 'Password must be at least 6 characters.' });
      return false;
    }
    set({ busy: true, error: null });
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      set({ needsPassword: false });
      return true;
    } catch (e) {
      set({ error: message(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  skipPassword: () => set({ needsPassword: false, error: null }),

  submitProfile: async (handle, displayName) => {
    const { userId } = get();
    if (!userId) return;
    const normalized = handle.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      set({ error: 'Handle must be 3–20 chars: letters, numbers, underscore.' });
      return;
    }
    set({ busy: true, error: null });
    try {
      if (!(await isHandleAvailable(normalized))) {
        set({ error: 'That handle is taken.', busy: false });
        return;
      }
      const name = displayName.trim() || consumeAppleName() || null;
      const profile = await createProfile({ id: userId, handle: normalized, displayName: name });
      set({ profile, status: 'ready' });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  reloadProfile: async () => {
    const { userId } = get();
    if (!userId) return;
    try {
      const profile = await getMyProfile(userId);
      set({ profile, status: profile ? 'ready' : 'needsProfile' });
    } catch {
      /* keep current */
    }
  },

  signOut: async () => {
    if (supabase) await supabase.auth.signOut();
    set({
      status: 'signedOut',
      userId: null,
      email: null,
      profile: null,
      otpSent: false,
      needsPassword: false,
    });
  },

  resetOtp: () => set({ otpSent: false, error: null }),

  clearError: () => set({ error: null }),
}));
