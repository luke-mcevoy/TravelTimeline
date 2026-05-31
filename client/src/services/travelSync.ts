import { getSocialApi } from './socialApi';
import { loadPhotoSrc } from './photoSource';
import { useTripStore } from '@/stores/tripStore';
import { totalDistance, uniqueCountries, uniqueCities } from '@/utils/animation';
import type { SortedDestination } from '@/types';

const HERO_UPLOAD_WIDTH = 480;
const SYNCED_HEROES_KEY = 'tt_synced_heroes';

export function placeKey(d: SortedDestination): string {
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

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export async function syncMyTravel(userId: string): Promise<void> {
  const api = getSocialApi();
  const dests = useTripStore.getState().getSortedDestinations();
  const synced = loadSyncedHeroes();
  const rows: Array<{
    place_key: string;
    city: string | null;
    country: string | null;
    country_code: string | null;
    lat: number;
    lng: number;
    arrival: string | null;
    departure: string | null;
    photo_count: number;
    hero_path: string | null;
  }> = [];
  const seenKeys = new Set<string>();

  for (const d of dests) {
    const key = placeKey(d);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let heroPath = synced[key] ?? null;
    const ref = d.serverPhotos?.[0];
    if (!heroPath && ref && api.uploadHero) {
      try {
        const src = await loadPhotoSrc(ref, HERO_UPLOAD_WIDTH);
        const blob = await dataUrlToBlob(src);
        const path = await api.uploadHero(userId, key, blob);
        if (path) {
          heroPath = path;
          synced[key] = path;
        }
      } catch {
        /* ok */
      }
    }

    rows.push({
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
  if (rows.length > 0) await api.upsertPlaces(userId, rows);
  await api.prunePlaces(userId, seenKeys);
  await api.updateMyStats(userId, {
    countries_count: uniqueCountries(dests).filter(Boolean).length,
    cities_count: uniqueCities(dests).filter((c) => !c.startsWith(', ')).length,
    places_count: seenKeys.size,
    distance_km: Math.round(totalDistance(dests)),
    home_country: dests[0]?.countryCode ?? null,
  });
}
