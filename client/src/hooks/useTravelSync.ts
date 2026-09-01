import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTripStore } from '@/stores/tripStore';
import { hydrateMyTravel, syncMyTravel } from '@/services/travelSync';

/**
 * Keeps the backend copy of the user's travel history in step with the local
 * one. Switches the in-memory library to that account first so a new sign-in
 * never inherits the Mac's guest/Photos trips (and then uploads them).
 */
export function useTravelSync(): void {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.userId);
  const trips = useTripStore((s) => s.trips);
  const viewing = useTripStore((s) => s.viewing);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    const owner = status === 'ready' && userId ? userId : null;
    useTripStore.getState().switchOwner(owner);
  }, [status, userId]);

  useEffect(() => {
    if (status !== 'ready' || !userId || viewing) return;
    const owner = useTripStore.getState().ownerId;
    if (owner !== userId) return;
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
