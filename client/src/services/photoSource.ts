// Single seam between the web (Mac server) build and the native (iOS) build.
// Everything that used to hit `/api/...` goes through here; on native it runs
// on-device via the PhotoKit plugin + the ported trip inference instead.

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ServerPhotoRef, Trip, Destination } from '@/types';
import { Photos, type ReverseGeocodeResult } from '@/native/photos';
import { initGeocoder, countryName } from './geo';
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
 * Fills in human place names (and refines the country) for the final, small set
 * of destinations using the device's reverse geocoder. Runs sequentially and
 * fails soft — a place that can't be named keeps its country-level label.
 */
async function enrichPlaceNames(trips: InferredTrip[]): Promise<void> {
  const pacer = createGeoPacer();
  const all = trips.flatMap((t) => t.destinations);

  for (const d of all) {
    const g = await resolvePlace(pacer, d);
    d.city = g.city;
    d.country = g.country;
    d.countryCode = g.countryCode;
  }

  // Second chance for anything the geocoder throttled on the first pass. A brief
  // cooldown lets CLGeocoder's per-minute window fully clear, then we retry the
  // stragglers at a gentler pace so a long trip still ends up fully named.
  const missing = all.filter((d) => !d.city);
  if (missing.length > 0) {
    await delay(5000);
    pacer.spacing = 1100;
    for (const d of missing) {
      const g = await resolvePlace(pacer, d);
      d.city = g.city;
      d.country = g.country;
      d.countryCode = g.countryCode;
    }
  }

  for (const trip of trips) renameTrip(trip);
}

interface PlaceFields {
  lat: number;
  lng: number;
  city: string;
  country: string;
  countryCode: string;
}

/** Reverse-geocodes a point and merges the result over the current labels. */
async function resolvePlace(
  pacer: GeoPacer,
  d: PlaceFields
): Promise<{ city: string; country: string; countryCode: string }> {
  const r = await reverseGeocodeCached(pacer, d.lat, d.lng);
  if (!r) return { city: d.city, country: d.country, countryCode: d.countryCode };
  // Prefer the most specific human place name available, falling back from
  // city → neighbourhood → district → region. Rural spots (a jungle, a
  // coastline) often have no `locality` but do carry the coarser fields.
  const name =
    r.locality || r.subLocality || r.subAdministrativeArea || r.administrativeArea;
  const countryCode = r.countryCode ? r.countryCode.toUpperCase() : d.countryCode;
  return {
    city: name || d.city,
    countryCode,
    country: r.countryCode ? countryName(countryCode) : d.country,
  };
}

/**
 * Self-tuning rate controller for CLGeocoder. The device geocoder allows only a
 * limited burst before it hard-throttles (a transient error) for up to a minute.
 * Rather than a fixed delay (too slow when free, too fast when throttled), we
 * adapt: gently speed up after successes, and back off aggressively the moment a
 * throttle appears so the per-minute window can clear before the next request.
 */
interface GeoPacer {
  cache: Map<string, ReverseGeocodeResult | null>;
  spacing: number; // ms to leave between network requests
  last: number; // timestamp of the last request
}

function createGeoPacer(): GeoPacer {
  return { cache: new Map(), spacing: 450, last: 0 };
}

async function reverseGeocodeCached(
  pacer: GeoPacer,
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = pacer.cache.get(key);
  if (hit !== undefined) return hit;

  let result: ReverseGeocodeResult | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const since = Date.now() - pacer.last;
    if (since < pacer.spacing) await delay(pacer.spacing - since);
    pacer.last = Date.now();
    try {
      result = await Photos.reverseGeocode({ lat, lng });
      // Success: ease the pace back up for the next request.
      pacer.spacing = Math.max(400, pacer.spacing - 80);
      break;
    } catch {
      // Throttled: slow down hard and wait out (most of) the window before retry.
      pacer.spacing = Math.min(8000, Math.round(pacer.spacing * 1.9) + 500);
      await delay(pacer.spacing);
    }
  }
  pacer.cache.set(key, result);
  return result;
}

/**
 * Re-runs reverse geocoding over an EXISTING set of trips and returns a new
 * trips array with refreshed city/country labels. Lets the user fix place names
 * (e.g. after a geocoder improvement) without re-scanning their whole library.
 * Native-only — on web the names come from the server import.
 */
export async function refreshPlaceNames(
  trips: Trip[],
  onProgress?: (done: number, total: number) => void
): Promise<Trip[]> {
  if (!isNativePlatform) return trips;
  const pacer = createGeoPacer();
  const total = trips.reduce((n, t) => n + t.destinations.length, 0);
  let done = 0;

  const out: Trip[] = [];
  for (const trip of trips) {
    const dests: Destination[] = [];
    for (const d of trip.destinations) {
      const g = await resolvePlace(pacer, d);
      dests.push({ ...d, ...g });
      done++;
      onProgress?.(done, total);
    }
    out.push({ ...trip, destinations: dests });
  }

  // Second chance for any place the geocoder throttled, after a cooldown.
  const missing = out.flatMap((t) => t.destinations).filter((d) => !d.city);
  if (missing.length > 0) {
    await delay(5000);
    pacer.spacing = 1100;
    for (const d of missing) {
      const g = await resolvePlace(pacer, d);
      d.city = g.city;
      d.country = g.country;
      d.countryCode = g.countryCode;
    }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
