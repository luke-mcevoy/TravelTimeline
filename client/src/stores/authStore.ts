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

  init: () => void;
  signInApple: () => Promise<void>;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  submitProfile: (handle: string, displayName: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: socialEnabled ? 'loading' : 'signedOut',
  userId: null,
  email: null,
  profile: null,
  busy: false,
  error: null,
  otpSent: false,

  init: () => {
    if (!supabase) {
      set({ status: 'signedOut' });
      return;
    }

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

    supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session?.user.id ?? null, session?.user.email ?? null);
    });
  },

  signInApple: async () => {
    set({ busy: true, error: null });
    try {
      await signInWithApple();
      // onAuthStateChange drives the rest.
    } catch (e) {
      set({ error: message(e) });
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
      set({ otpSent: false });
      // onAuthStateChange drives the rest.
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

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
    set({ status: 'signedOut', userId: null, email: null, profile: null, otpSent: false });
  },

  clearError: () => set({ error: null }),
}));
