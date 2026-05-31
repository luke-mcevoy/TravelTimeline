import { useEffect } from 'react';
import { socialEnabled } from '@/services/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useTravelSync } from '@/hooks/useTravelSync';
import { AuthGate } from './AuthGate';
import { SocialPanel } from './SocialPanel';
import { ViewerBanner } from './ViewerBanner';

/**
 * Top-level social layer. When the backend isn't configured it renders nothing
 * and the app stays a local-only globe. Otherwise it boots the session, gates
 * the app behind sign-in + handle, keeps travel synced, and mounts the friends
 * panel + viewer banner.
 */
export function SocialRoot() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    if (socialEnabled) init();
  }, [init]);

  useTravelSync();

  if (!socialEnabled) return null;
  if (status !== 'ready') return <AuthGate />;

  return (
    <>
      <SocialPanel />
      <ViewerBanner />
    </>
  );
}
