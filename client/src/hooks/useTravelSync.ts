import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTripStore } from '@/stores/tripStore';
import { hydrateMyTravel, syncMyTravel } from '@/services/travelSync';

/**
 * Keeps the backend copy of the user's travel history in step with the local
 * one. Runs once when signed in, then again (debounced) whenever the user's own
 * trips change. Never runs while viewing a friend's globe.
 */
export function useTravelSync(): void {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.userId);
  const trips = useTripStore((s) => s.trips);
  const viewing = useTripStore((s) => s.viewing);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'ready' || !userId || viewing) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      (async () => {
        await hydrateMyTravel(userId);
        await syncMyTravel(userId);
      })().catch((err) => {
        console.error('[travelSync]', err);
      });
    }, 800);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [status, userId, trips, viewing]);
}
