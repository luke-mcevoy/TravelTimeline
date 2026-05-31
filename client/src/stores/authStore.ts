import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { supabase, socialEnabled, socialMock } from '@/services/supabase';
import { signInWithApple, consumeAppleName } from '@/services/appleAuth';
import { getMyProfile, createProfile, isHandleAvailable, mockListDevUsers, type Profile } from '@/services/social';
import { getSocialApi } from '@/services/socialApi';

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
  signInMockUser: (userId: string) => Promise<void>;
  startMockNewAccount: () => void;
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

async function applyUser(
  set: (p: Partial<AuthStore>) => void,
  userId: string | null,
  email: string | null
) {
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
    if (!socialEnabled) {
      set({ status: 'signedOut' });
      return;
    }
    if (socialMock) {
      const uid = getSocialApi().mockCurrentUserId?.() ?? null;
      applyUser(set, uid, uid ? 'mock@local.dev' : null);
      return;
    }
    if (!supabase) {
      set({ status: 'signedOut' });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      applyUser(set, s?.user.id ?? null, s?.user.email ?? null);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(set, session?.user.id ?? null, session?.user.email ?? null);
    });
  },

  signInMockUser: async (userId) => {
    set({ busy: true, error: null });
    try {
      getSocialApi().mockSignInAs?.(userId);
      await applyUser(set, userId, 'mock@local.dev');
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  startMockNewAccount: () => {
    const id = `mock-user-${nanoid(10)}`;
    getSocialApi().mockSignInAs?.(id);
    set({ userId: id, email: 'mock@local.dev', profile: null, status: 'needsProfile', error: null });
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
      if (!(await isHandleAvailable(normalized, userId))) {
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
      /* keep */
    }
  },

  signOut: async () => {
    if (socialMock) getSocialApi().mockSignOut?.();
    else if (supabase) await supabase.auth.signOut();
    set({ status: 'signedOut', userId: null, email: null, profile: null, otpSent: false });
  },

  clearError: () => set({ error: null }),
}));

export { mockListDevUsers };
