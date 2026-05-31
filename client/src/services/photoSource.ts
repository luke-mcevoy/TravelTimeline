// Single seam between the web (Mac server) build and the native (iOS) build.
// Everything that used to hit `/api/...` goes through here; on native it runs
// on-device via the PhotoKit plugin + the ported trip inference instead.

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ServerPhotoRef } from '@/types';
import { Photos } from '@/native/photos';
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
  for (const trip of trips) {
    for (const d of trip.destinations) {
      try {
        const r = await Photos.reverseGeocode({ lat: d.lat, lng: d.lng });
        if (r.locality) d.city = r.locality;
        else if (r.administrativeArea) d.city = r.administrativeArea;
        if (r.countryCode) {
          d.countryCode = r.countryCode.toUpperCase();
          d.country = countryName(d.countryCode);
        }
      } catch {
        /* keep country-level label */
      }
      await delay(120); // be gentle with the geocoder's rate limit
    }
    renameTrip(trip);
  }
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

const thumbCache = new Map<string, string>();

/** A src that's available with no async work (server URL, or a cached blob). */
function immediateSrc(ref: ServerPhotoRef, width: number): string | null {
  if (!isNativePlatform) return serverPhotoUrl(ref, width);
  const id = ref.localIdentifier ?? ref.uuid;
  return thumbCache.get(`${id}:${width}`) ?? null;
}

export async function loadPhotoSrc(ref: ServerPhotoRef, width: number): Promise<string> {
  if (!isNativePlatform) return serverPhotoUrl(ref, width);
  const id = ref.localIdentifier ?? ref.uuid;
  const key = `${id}:${width}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const { dataUrl } = await Photos.getThumbnail({ id, width });
  thumbCache.set(key, dataUrl);
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
