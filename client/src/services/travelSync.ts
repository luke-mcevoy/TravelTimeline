import { nanoid } from 'nanoid';
import { requireSupabase } from './supabase';
import { updateMyStats, getPlacesFor, heroUrl, type RemotePlace } from './social';
import { loadPhotoSrc } from './photoSource';
import { useTripStore } from '@/stores/tripStore';
import { totalDistance, uniqueCountries, uniqueCities } from '@/utils/animation';
import type { Destination, SortedDestination, Trip } from '@/types';

const HERO_UPLOAD_WIDTH = 480; // small, shareable thumbnail
const SYNCED_HEROES_KEY = 'tt_synced_heroes';

/** Stable id for a place so re-syncs upsert instead of duplicating. */
function placeKey(d: SortedDestination): string {
  const cc = d.countryCode || 'XX';
  return `${cc}:${d.lat.toFixed(2)},${d.lng.toFixed(2)}`;
}

function loadSyncedHeroes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SYNCED_HEROES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSyncedHeroes(map: Record<string, string>): void {
  localStorage.setItem(SYNCED_HEROES_KEY, JSON.stringify(map));
}

function remoteToDestination(p: RemotePlace): Destination {
  const arrival = p.arrival ?? new Date().toISOString().slice(0, 10);
  return {
    id: p.id,
    city: p.city ?? '',
    country: p.country ?? '',
    countryCode: p.country_code ?? '',
    lat: p.lat,
    lng: p.lng,
    arrivalDate: arrival,
    departureDate: p.departure ?? arrival,
    heroUrl: heroUrl(p.hero_path) ?? undefined,
  };
}

/**
 * Pull this account's cloud places into the local globe. Phone and browser
 * each have their own localStorage — without this, a library built on iOS
 * never appears on the website (and an empty web client used to DELETE the
 * cloud copy). Merges by place_key so neither side clobbers the other.
 */
export async function hydrateMyTravel(userId: string): Promise<void> {
  const remote = await getPlacesFor(userId);
  if (remote.length === 0) return;

  const local = useTripStore.getState().getSortedDestinations();
  const have = new Set(local.map(placeKey));
  const missing = remote.filter((p) => !have.has(p.place_key));
  if (missing.length === 0) return;

  const extra = missing.map(remoteToDestination);
  const trips = useTripStore.getState().trips;
  if (trips.length === 0) {
    const now = new Date().toISOString();
    const trip: Trip = {
      id: nanoid(),
      name: 'My travels',
      destinations: extra,
      createdAt: now,
      updatedAt: now,
    };
    useTripStore.getState().setTrips([trip]);
    return;
  }
  const [first, ...rest] = trips;
  useTripStore.getState().setTrips([
    { ...first, destinations: [...first.destinations, ...extra], updatedAt: new Date().toISOString() },
    ...rest,
  ]);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/**
 * Pushes the signed-in user's derived travel history to the backend: one row per
 * visited place (+ a small hero thumbnail uploaded once), then refreshes the
 * denormalized profile stats that power the leaderboards. Removed places are
 * pruned. Idempotent — safe to call after every library rebuild.
 */
export async function syncMyTravel(userId: string): Promise<void> {
  const sb = requireSupabase();
  const dests = useTripStore.getState().getSortedDestinations();

  const synced = loadSyncedHeroes();
  const rows: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  for (const d of dests) {
    const key = placeKey(d);
    if (seenKeys.has(key)) continue; // collapse same-cell dupes
    seenKeys.add(key);

    // Upload the hero thumbnail once per place.
    let heroPath = synced[key] ?? null;
    const ref = d.serverPhotos?.[0];
    if (!heroPath && ref) {
      try {
        const src = await loadPhotoSrc(ref, HERO_UPLOAD_WIDTH);
        const blob = await dataUrlToBlob(src);
        const path = `${userId}/${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
        const { error } = await sb.storage.from('heroes').upload(path, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (!error) {
          heroPath = path;
          synced[key] = path;
        }
      } catch {
        /* a place without an uploadable hero still syncs */
      }
    }

    rows.push({
      user_id: userId,
      place_key: key,
      city: d.city || null,
      country: d.country || null,
      country_code: d.countryCode || null,
      lat: d.lat,
      lng: d.lng,
      arrival: d.arrivalDate || null,
      departure: d.departureDate || null,
      photo_count: d.serverPhotos?.length ?? 0,
      hero_path: heroPath,
    });
  }

  saveSyncedHeroes(synced);

  // An empty local library means "this device hasn't loaded yet", not "delete
  // my account." Never prune or zero stats in that case — hydrate fills in.
  if (rows.length === 0) return;

  const { error } = await sb.from('places').upsert(rows, { onConflict: 'user_id,place_key' });
  if (error) throw error;

  // Prune places that no longer exist locally. Delete by UUID id (place_key
  // contains commas, which would break an `in`-list filter).
  const { data: existing } = await sb.from('places').select('id, place_key').eq('user_id', userId);
  const staleIds = (existing ?? [])
    .filter((r) => !seenKeys.has(r.place_key as string))
    .map((r) => r.id as string);
  if (staleIds.length > 0) {
    await sb.from('places').delete().in('id', staleIds);
  }

  await updateMyStats(userId, {
    countries_count: uniqueCountries(dests).filter(Boolean).length,
    cities_count: uniqueCities(dests).filter((c) => !c.startsWith(', ')).length,
    places_count: seenKeys.size,
    distance_km: Math.round(totalDistance(dests)),
    home_country: dests[0]?.countryCode ?? null,
  });
}
