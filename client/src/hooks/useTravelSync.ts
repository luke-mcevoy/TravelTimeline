import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTripStore } from '@/stores/tripStore';
import { syncMyTravel } from '@/services/travelSync';

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
      syncMyTravel(userId).catch(() => {
        /* best-effort; will retry on the next change */
      });
    }, 1500);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [status, userId, trips, viewing]);
}
