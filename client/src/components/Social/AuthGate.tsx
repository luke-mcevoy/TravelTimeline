import { useState } from 'react';
import { Apple, Globe2, Loader2, Mail, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { isNativePlatform } from '@/services/photoSource';
import styles from './AuthGate.module.css';

/**
 * Sign-in card. The globe stays usable without an account; this overlay is
 * opened from the people button. The only required step after auth is picking
 * an @handle (needsProfile).
 */
export function AuthGate({ onDismiss }: { onDismiss?: () => void }) {
  const status = useAuthStore((s) => s.status);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const otpSent = useAuthStore((s) => s.otpSent);
  const signInApple = useAuthStore((s) => s.signInApple);
  const signInPassword = useAuthStore((s) => s.signInPassword);
  const signUpPassword = useAuthStore((s) => s.signUpPassword);
  const sendEmailOtp = useAuthStore((s) => s.sendEmailOtp);
  const verifyEmailOtp = useAuthStore((s) => s.verifyEmailOtp);
  const resetOtp = useAuthStore((s) => s.resetOtp);
  const setPassword = useAuthStore((s) => s.setPassword);
  const skipPassword = useAuthStore((s) => s.skipPassword);
  const submitProfile = useAuthStore((s) => s.submitProfile);
  const needsPassword = useAuthStore((s) => s.needsPassword);

  const [email, setEmail] = useState('');
  const [password, setPasswordValue] = useState('');
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<'password' | 'otp'>('password');
  const [showEmail, setShowEmail] = useState(!isNativePlatform);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');

  if (needsPassword && status !== 'needsProfile') {
    return (
      <div className={styles.backdrop}>
        <div className={styles.card}>
          <Globe2 className={styles.hero} />
          <h1 className={styles.title}>Set a password</h1>
          <p className={styles.sub}>
            A new Cloudflare URL is a new website — it won't remember you. A
            password is how you sign in next time without an email code.
          </p>
          <div className={styles.emailBlock}>
            <input
              className={styles.input}
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder="Password (6+ characters)"
              type="password"
              autoComplete="new-password"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button
              className={styles.primary}
              disabled={busy || password.length < 6}
              onClick={() => setPassword(password)}
            >
              {busy ? <Loader2 className={styles.spinnerSm} /> : 'Save password'}
            </button>
            <button className={styles.ghost} type="button" onClick={skipPassword}>
              Skip for now
            </button>
          </div>
        </div>
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

  const emailReady = email.includes('@') && password.length >= 6;

  return (
    <div
      className={styles.backdrop}
      onClick={onDismiss ? (e) => e.target === e.currentTarget && onDismiss() : undefined}
    >
      <div className={styles.card}>
        {onDismiss && (
          <button className={styles.close} type="button" onClick={onDismiss} aria-label="Close">
            <X size={18} />
          </button>
        )}
        <Globe2 className={styles.hero} />
        <h1 className={styles.title}>Friends & sync</h1>
        <p className={styles.sub}>
          Optional. Your globe works without an account. Sign in only if you want
          friends to find you or to sync this map to your phone.
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
        ) : method === 'password' ? (
          <div className={styles.emailBlock}>
            <input
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
            />
            <input
              className={styles.input}
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
            />
            <button
              className={styles.primary}
              disabled={busy || !emailReady}
              onClick={() => signInPassword(email, password)}
            >
              {busy ? <Loader2 className={styles.spinnerSm} /> : 'Sign in'}
            </button>
            <button
              className={styles.ghost}
              disabled={busy || !emailReady}
              onClick={() => signUpPassword(email, password)}
            >
              Create account
            </button>
            <button
              className={styles.link}
              type="button"
              onClick={() => {
                resetOtp();
                setMethod('otp');
              }}
            >
              No password yet? Email a one-time code
            </button>
          </div>
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
            <button className={styles.link} type="button" onClick={() => setMethod('password')}>
              Use a password instead
            </button>
          </div>
        ) : (
          <div className={styles.emailBlock}>
            <p className={styles.sub}>Enter the code sent to {email}. Then you'll set a password so you don't need another code.</p>
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
            <button
              className={styles.ghost}
              type="button"
              onClick={() => {
                resetOtp();
                setMethod('password');
              }}
            >
              Use a password instead
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
