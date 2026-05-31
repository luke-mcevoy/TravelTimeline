import { useEffect } from 'react';
import { socialEnabled } from '@/services/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useTravelSync } from '@/hooks/useTravelSync';
import { getProfileByHandle } from '@/services/social';
import { AuthGate } from './AuthGate';
import { SocialPanel } from './SocialPanel';
import { ViewerBanner } from './ViewerBanner';
import { PhotoAccessNotice } from './PhotoAccessNotice';

export function SocialRoot() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    if (socialEnabled) init();
  }, [init]);

  useTravelSync();

  useEffect(() => {
    if (status !== 'ready') return;
    const params = new URLSearchParams(window.location.search);
    const handle = params.get('profile');
    if (!handle) return;
    getProfileByHandle(handle).then((p) => {
      if (p) window.dispatchEvent(new CustomEvent('tt-open-profile', { detail: p }));
    });
    params.delete('profile');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [status]);

  if (!socialEnabled) return null;
  if (status !== 'ready') return <AuthGate />;

  return (
    <>
      <PhotoAccessNotice />
      <SocialPanel />
      <ViewerBanner />
    </>
  );
}
