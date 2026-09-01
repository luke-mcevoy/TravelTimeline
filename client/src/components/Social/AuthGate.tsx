import { useState } from 'react';
import { Apple, Globe2, Loader2, Mail } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { isNativePlatform } from '@/services/photoSource';
import styles from './AuthGate.module.css';

/**
 * Full-screen gate shown until the user has a session AND a profile. Handles
 * Sign in with Apple (native), an email one-time-code fallback (works in the
 * simulator / on web), and picking a public @handle on first run.
 */
export function AuthGate() {
  const status = useAuthStore((s) => s.status);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const otpSent = useAuthStore((s) => s.otpSent);
  const signInApple = useAuthStore((s) => s.signInApple);
  const sendEmailOtp = useAuthStore((s) => s.sendEmailOtp);
  const verifyEmailOtp = useAuthStore((s) => s.verifyEmailOtp);
  const resetOtp = useAuthStore((s) => s.resetOtp);
  const submitProfile = useAuthStore((s) => s.submitProfile);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Web (phones included) has no Sign in with Apple — open the email OTP
  // form immediately so the first screen is actually usable.
  const [showEmail, setShowEmail] = useState(!isNativePlatform);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');

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

  // signedOut
  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <Globe2 className={styles.hero} />
        <h1 className={styles.title}>TravelTimeline</h1>
        <p className={styles.sub}>
          The honest map of everywhere you've been — built straight from your camera
          roll, not a curated highlight reel. See friends' travels and climb the
          leaderboards.
        </p>

        {isNativePlatform && (
          <button className={styles.apple} disabled={busy} onClick={signInApple}>
            <Apple size={18} />
            Sign in with Apple
          </button>
        )}

        {!showEmail ? (
          <button className={styles.ghost} onClick={() => setShowEmail(true)}>
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
              className={styles.primary}
              disabled={busy || code.trim().length < 6}
              onClick={() => verifyEmailOtp(email, code)}
            >
              {busy ? <Loader2 className={styles.spinnerSm} /> : 'Verify'}
            </button>
            <button className={styles.ghost} type="button" onClick={resetOtp}>
              Use a different email
            </button>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.fine}>
          By continuing you agree your derived travel map (places + small photo
          thumbnails) is shared with friends you approve.
        </p>
      </div>
    </div>
  );
}
