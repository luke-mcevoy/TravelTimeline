import { useState } from 'react';
import { Apple, Globe2, Loader2, Mail, FlaskConical } from 'lucide-react';
import { useAuthStore, mockListDevUsers } from '@/stores/authStore';
import { socialMock } from '@/services/supabase';
import { isNativePlatform } from '@/services/photoSource';
import { DEMO_ID } from '@/services/socialApi/mockSeed';
import styles from './AuthGate.module.css';

export function AuthGate() {
  const status = useAuthStore((s) => s.status);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const otpSent = useAuthStore((s) => s.otpSent);
  const signInApple = useAuthStore((s) => s.signInApple);
  const signInMockUser = useAuthStore((s) => s.signInMockUser);
  const startMockNewAccount = useAuthStore((s) => s.startMockNewAccount);
  const sendEmailOtp = useAuthStore((s) => s.sendEmailOtp);
  const verifyEmailOtp = useAuthStore((s) => s.verifyEmailOtp);
  const submitProfile = useAuthStore((s) => s.submitProfile);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');

  const devUsers = socialMock ? mockListDevUsers() : [];

  if (status === 'loading') {
    return (
      <div className={styles.backdrop}>
        <Loader2 className={styles.spinner} />
      </div>
    );
  }

  if (status === 'needsProfile') {
    return (
      <div className={styles.backdrop}>
        <div className={styles.card}>
          <Globe2 className={styles.hero} />
          <h1 className={styles.title}>Claim your handle</h1>
          <p className={styles.sub}>This is how friends find you on TravelTimeline.</p>
          <div className={styles.handleRow}>
            <span className={styles.at}>@</span>
            <input
              className={styles.input}
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="handle"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={20}
            />
          </div>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (optional)"
            maxLength={40}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button
            className={styles.primary}
            disabled={busy || handle.trim().length < 3}
            onClick={() => submitProfile(handle, name)}
          >
            {busy ? <Loader2 className={styles.spinnerSm} /> : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <Globe2 className={styles.hero} />
        <h1 className={styles.title}>TravelTimeline</h1>
        <p className={styles.sub}>
          The honest map of everywhere you've been — built straight from your camera roll.
          See friends' travels and climb the leaderboards.
        </p>

        {socialMock && (
          <div className={styles.mockBlock}>
            <p className={styles.mockLabel}>
              <FlaskConical size={14} /> Mock social mode
            </p>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() => signInMockUser(DEMO_ID)}
            >
              {busy ? <Loader2 className={styles.spinnerSm} /> : 'Start as @demo_traveler'}
            </button>
            <p className={styles.mockHint}>Friends, requests & leaderboards pre-seeded.</p>
            <div className={styles.mockList}>
              {devUsers
                .filter((u) => u.id !== DEMO_ID)
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={styles.mockUserBtn}
                    disabled={busy}
                    onClick={() => signInMockUser(u.id)}
                  >
                    @{u.handle}
                    <span className={styles.mockUserMeta}>{u.countries_count} countries</span>
                  </button>
                ))}
            </div>
            <button type="button" className={styles.ghost} disabled={busy} onClick={startMockNewAccount}>
              Create a fresh test account…
            </button>
          </div>
        )}

        {isNativePlatform && !socialMock && (
          <button type="button" className={styles.apple} disabled={busy} onClick={signInApple}>
            <Apple size={18} />
            Sign in with Apple
          </button>
        )}

        {!socialMock && (
          <>
            {!showEmail ? (
              <button type="button" className={styles.ghost} onClick={() => setShowEmail(true)}>
                <Mail size={16} />
                Continue with email
              </button>
            ) : !otpSent ? (
              <div className={styles.emailBlock}>
                <input
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !email.includes('@')}
                  onClick={() => sendEmailOtp(email)}
                >
                  {busy ? <Loader2 className={styles.spinnerSm} /> : 'Send code'}
                </button>
              </div>
            ) : (
              <div className={styles.emailBlock}>
                <p className={styles.sub}>Enter the code sent to {email}.</p>
                <input
                  className={styles.input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || code.trim().length < 6}
                  onClick={() => verifyEmailOtp(email, code)}
                >
                  {busy ? <Loader2 className={styles.spinnerSm} /> : 'Verify'}
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.fine}>
          By continuing you agree your derived travel map is shared with friends you approve.
        </p>
      </div>
    </div>
  );
}
