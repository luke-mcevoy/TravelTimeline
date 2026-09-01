import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { socialEnabled } from '@/services/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useTravelSync } from '@/hooks/useTravelSync';
import { AuthGate } from './AuthGate';
import { SocialPanel } from './SocialPanel';
import { ViewerBanner } from './ViewerBanner';
import panelStyles from './SocialPanel.module.css';

/**
 * Social layer. The globe is always usable; sign-in is only for friends/sync.
 * A saved session restores silently. The email wall is opt-in (people button).
 */
export function SocialRoot() {
  const status = useAuthStore((s) => s.status);
  const needsPassword = useAuthStore((s) => s.needsPassword);
  const init = useAuthStore((s) => s.init);
  const [signInOpen, setSignInOpen] = useState(false);
  if (status === 'ready' && signInOpen && !needsPassword) {
    setSignInOpen(false);
  }

  useEffect(() => {
    if (socialEnabled) init();
  }, [init]);

  useTravelSync();

  if (!socialEnabled) return null;
  if (status === 'loading') return null;

  const showAuth =
    status === 'needsProfile' ||
    needsPassword ||
    (signInOpen && status === 'signedOut');

  return (
    <>
      {status === 'ready' ? (
        <>
          <SocialPanel />
          <ViewerBanner />
        </>
      ) : (
        <button
          className={panelStyles.trigger}
          onClick={() => setSignInOpen(true)}
          title="Sign in"
        >
          <Users className={panelStyles.triggerIcon} />
        </button>
      )}
      {showAuth && (
        <AuthGate
          onDismiss={
            status === 'needsProfile' || needsPassword
              ? undefined
              : () => setSignInOpen(false)
          }
        />
      )}
    </>
  );
}
