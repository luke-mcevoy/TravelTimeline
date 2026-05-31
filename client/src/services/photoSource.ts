// Single seam between the web (Mac server) build and the native (iOS) build.
// Everything that used to hit `/api/...` goes through here; on native it runs
// on-device via the PhotoKit plugin + the ported trip inference instead.

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ServerPhotoRef, Trip, Destination } from '@/types';
import { Photos } from '@/native/photos';
import { initGeocoder, countryName } from './geo';
import { initCityDb, nearestCity } from './cityDb';
import { inferTrips, renameTrip, type InferredTrip } from './tripInference';

export const isNativePlatform = Capacitor.isNativePlatform();

export type ProgressFn = (message: string, pct: number) => void;

export interface BuiltDestination {
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  arrivalDate: string;
  departureDate: string;
  photoCount: number;
  photos: ServerPhotoRef[];
}

export interface BuiltTrip {
  name: string;
  destinations: BuiltDestination[];
}

// ─── Access ──────────────────────────────────────────────────────────

export async function checkAccess(): Promise<{ accessible: boolean; error?: string }> {
  if (isNativePlatform) {
    try {
      const { status } = await Photos.requestAccess();
      if (status === 'authorized' || status === 'limited') return { accessible: true };
      if (status === 'denied' || status === 'restricted') {
        return {
          accessible: false,
          error:
            'Photo access is off. Enable it in Settings → Privacy & Security → Photos → TravelTimeline.',
        };
      }
      return { accessible: false, error: 'Photo access has not been granted yet.' };
    } catch {
      return { accessible: false, error: 'Could not reach the photo library.' };
    }
  }

  try {
    const res = await fetch('/api/apple-photos/status');
    const data = await res.json();
    return { accessible: !!data.accessible, error: data.error };
  } catch {
    return {
      accessible: false,
      error: 'Cannot reach server. Make sure the backend is running on port 3001.',
    };
  }
}

// ─── Build trips ─────────────────────────────────────────────────────

export async function buildTrips(
  yearsBack: number,
  onProgress?: ProgressFn
): Promise<BuiltTrip[]> {
  return isNativePlatform
    ? buildTripsNative(yearsBack, onProgress)
    : buildTripsServer(yearsBack, onProgress);
}

async function buildTripsNative(
  yearsBack: number,
  onProgress?: ProgressFn
): Promise<BuiltTrip[]> {
  onProgress?.('Loading map data…', 8);
  await initGeocoder();

  onProgress?.('Scanning your photo library…', 18);
  const { assets } = await Photos.queryAssets({ yearsBack });

  const trips = inferTrips(assets, onProgress);

  onProgress?.('Naming your places…', 88);
  await enrichPlaceNames(trips);

  onProgress?.('Done!', 100);
  return trips.map(toBuiltTrip);
}

/**
 * Fills in human city names for every destination using the bundled offline
 * GeoNames dataset (nearest populated place). Instant, network-free, and not
 * subject to CLGeocoder's throttling — so places reliably get a real city name
 * instead of falling back to country-only. The country itself was already
 * resolved offline (borders-polygon lookup) during trip inference.
 */
async function enrichPlaceNames(trips: InferredTrip[]): Promise<void> {
  await initCityDb();
  for (const d of trips.flatMap((t) => t.destinations)) applyCityName(d);
  for (const trip of trips) renameTrip(trip);
}

/** Sets the nearest-city name on a place (and backfills country if missing). */
function applyCityName(d: {
  lat: number;
  lng: number;
  city: string;
  country: string;
  countryCode: string;
}): void {
  const c = nearestCity(d.lat, d.lng);
  if (!c) return;
  d.city = c.name;
  if (!d.countryCode && c.countryCode) {
    d.countryCode = c.countryCode;
    d.country = countryName(c.countryCode);
  }
}

/**
 * Re-derives city/country labels over an EXISTING set of trips (from the offline
 * city dataset) and returns a new trips array. Lets the user refresh place names
 * without re-scanning their whole library. Native-only — on web the names come
 * from the server import.
 */
export async function refreshPlaceNames(
  trips: Trip[],
  onProgress?: (done: number, total: number) => void
): Promise<Trip[]> {
  if (!isNativePlatform) return trips;
  await initCityDb();
  const total = trips.reduce((n, t) => n + t.destinations.length, 0);
  let done = 0;

  const out: Trip[] = [];
  for (const trip of trips) {
    const dests: Destination[] = [];
    for (const d of trip.destinations) {
      const next = { ...d };
      applyCityName(next);
      dests.push(next);
      done++;
      onProgress?.(done, total);
    }
    out.push({ ...trip, destinations: dests });
  }
  return out;
}

function toBuiltTrip(t: InferredTrip): BuiltTrip {
  return {
    name: t.name,
    destinations: t.destinations.map((d) => ({
      city: d.city,
      country: d.country,
      countryCode: d.countryCode,
      lat: d.lat,
      lng: d.lng,
      arrivalDate: d.arrivalDate,
      departureDate: d.departureDate,
      photoCount: d.photoCount,
      photos: d.photos.map(
        (p): ServerPhotoRef => ({
          uuid: p.uuid,
          filename: p.filename,
          directory: p.directory,
          dateTaken: p.dateTaken,
          localIdentifier: p.localIdentifier,
        })
      ),
    })),
  };
}

async function buildTripsServer(
  yearsBack: number,
  onProgress?: ProgressFn
): Promise<BuiltTrip[]> {
  const res = await fetch('/api/apple-photos/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yearsBack }),
  });

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('No response stream');

  let result: BuiltTrip[] | null = null;
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    done = streamDone;
    if (!value) continue;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'progress') onProgress?.(data.message, data.pct);
        else if (data.type === 'complete') result = data.trips as BuiltTrip[];
        else if (data.type === 'error') throw new Error(data.message);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!result) throw new Error('Import did not complete');
  return result;
}

// ─── Thumbnails ──────────────────────────────────────────────────────

function serverPhotoUrl(ref: { directory: string; filename: string }, width: number): string {
  return `/api/apple-photos/photo?dir=${encodeURIComponent(ref.directory)}&file=${encodeURIComponent(ref.filename)}&w=${width}`;
}

/**
 * Width to request for the big featured photo. On native each thumbnail is a
 * base64 data URL marshaled across the Capacitor bridge and decoded on the main
 * thread, so an oversized image directly costs playback smoothness. The card is
 * small, so a more modest size is plenty sharp while roughly halving the bridge
 * payload, decode time, and memory vs. the 1400px web size.
 */
export const HERO_PHOTO_WIDTH = isNativePlatform ? 1024 : 1400;

// Base64 thumbnails are large (a 1024px JPEG is ~0.5MB as a UTF-16 string), so an
// unbounded cache steadily inflates memory until the GC stalls cause hitches.
// Keep a bounded LRU of the most-recently-used thumbnails instead.
const THUMB_CACHE_MAX = 48;
const thumbCache = new Map<string, string>();

function thumbCacheGet(key: string): string | undefined {
  const v = thumbCache.get(key);
  if (v !== undefined) {
    thumbCache.delete(key); // re-insert to mark as most-recently-used
    thumbCache.set(key, v);
  }
  return v;
}

function thumbCacheSet(key: string, val: string): void {
  thumbCache.set(key, val);
  if (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) thumbCache.delete(oldest);
  }
}

/** A src that's available with no async work (server URL, or a cached blob). */
function immediateSrc(ref: ServerPhotoRef, width: number): string | null {
  if (!isNativePlatform) return serverPhotoUrl(ref, width);
  const id = ref.localIdentifier ?? ref.uuid;
  return thumbCacheGet(`${id}:${width}`) ?? null;
}

export async function loadPhotoSrc(ref: ServerPhotoRef, width: number): Promise<string> {
  if (!isNativePlatform) return serverPhotoUrl(ref, width);
  const id = ref.localIdentifier ?? ref.uuid;
  const key = `${id}:${width}`;
  const hit = thumbCacheGet(key);
  if (hit) return hit;
  const { dataUrl } = await Photos.getThumbnail({ id, width });
  thumbCacheSet(key, dataUrl);
  return dataUrl;
}

/**
 * Resolves a displayable image src for a photo ref. On web this is the server
 * URL (returned synchronously); on native it asynchronously fetches a thumbnail
 * from PhotoKit and caches it.
 */
export function usePhotoSrc(
  ref: ServerPhotoRef | null | undefined,
  width: number
): string | null {
  const id = ref?.localIdentifier ?? ref?.uuid ?? null;
  const [src, setSrc] = useState<string | null>(() =>
    ref ? immediateSrc(ref, width) : null
  );

  useEffect(() => {
    if (!ref) {
      setSrc(null);
      return;
    }
    const immediate = immediateSrc(ref, width);
    if (immediate) {
      setSrc(immediate);
      return;
    }
    let alive = true;
    setSrc(null);
    loadPhotoSrc(ref, width)
      .then((s) => {
        if (alive) setSrc(s);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, width]);

  return src;
}
