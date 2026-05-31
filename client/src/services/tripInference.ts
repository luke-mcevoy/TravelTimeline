// On-device port of the server's Apple Photos trip inference
// (server/src/services/applePhotos.ts). It is fed by the native PhotoKit
// plugin's `queryAssets` output instead of the Photos SQLite database, so it
// runs entirely on the phone with no Mac server.
//
// Reused as-is from the server: haversine, representativePoint (medoid),
// findRecurringLocalCells, the 75km/home-country travel filter,
// groupDestinationsIntoTrips (5-day gap), mergeAdjacentStops (15km),
// dedupePlacesAcrossTrips, ensureInternationalCoverage, tripNameFor.
//
// Adapted: Apple "Moments" grouping → location(~0.5°)+day clustering; Apple ML
// aesthetic scores → favorite/landscape/screenshot/burst heuristics; country
// resolution → offline coordinate_to_country (geo.ts). Place names are filled
// in afterwards via the native reverse geocoder (see photoSource.ts).

import { countryCodeForPoint, countryName } from './geo';
import type { NativeAsset } from '../native/photos';

interface PhotoRec {
  id: string;
  lat: number;
  lng: number;
  date: Date;
  isFavorite: boolean;
  width: number;
  height: number;
  burstId: string;
  isScreenshot: boolean;
  countryCode: string | null;
  score: number;
}

interface Cluster {
  lat: number;
  lng: number;
  photos: PhotoRec[];
  startDate: Date;
  endDate: Date;
  title?: string;
}

export interface InferredPhotoRef {
  /** React key + PhotoKit handle. On native, uuid === localIdentifier. */
  uuid: string;
  localIdentifier: string;
  filename: string;
  directory: string;
  dateTaken: string;
}

export interface InferredDestination {
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  arrivalDate: string;
  departureDate: string;
  photoCount: number;
  photos: InferredPhotoRef[];
  /** Internal hero-photo score, used to dedupe places; stripped before use. */
  _heroScore?: number;
}

export interface InferredTrip {
  name: string;
  destinations: InferredDestination[];
}

export type ProgressFn = (message: string, pct: number) => void;

const HOME_RADIUS_KM = 75;
const TRIP_GAP_DAYS = 5;
const SAME_PLACE_KM = 15;
/** Minimum photos for a location+day bucket to count as a domestic stop. */
const MIN_CLUSTER_PHOTOS = 2;

// ─── Public entry point ──────────────────────────────────────────────

export function inferTrips(
  assets: NativeAsset[],
  onProgress?: ProgressFn
): InferredTrip[] {
  onProgress?.('Reading your photos…', 20);

  const photos: PhotoRec[] = assets
    .filter((a) => !a.isScreenshot)
    .map((a) => ({
      id: a.id,
      lat: a.lat,
      lng: a.lng,
      date: new Date(a.dateTaken),
      isFavorite: a.isFavorite,
      width: a.width,
      height: a.height,
      burstId: a.burstId,
      isScreenshot: a.isScreenshot,
      countryCode: countryCodeForPoint(a.lat, a.lng),
      score: 0,
    }));

  if (photos.length === 0) return [];

  for (const p of photos) p.score = scorePhoto(p);
  const deduped = dedupeBursts(photos);

  onProgress?.('Finding your places…', 40);
  const allClusters = buildClusters(deduped);

  const home = findHomeCenter(deduped);
  const homeCountry = dominantCountryCode(deduped);
  const localCells = findRecurringLocalCells(allClusters);
  const cellKey = (lat: number, lng: number) =>
    `${Math.round(lat * 2) / 2},${Math.round(lng * 2) / 2}`;

  const travel = allClusters.filter((c) => {
    // International stops are ALWAYS kept.
    const cc = dominantCountryCode(c.photos);
    if (cc && homeCountry && cc !== homeCountry) return true;
    // Domestic: strip home and everyday/recurring-local places.
    if (home && haversine(home.lat, home.lng, c.lat, c.lng) < HOME_RADIUS_KM) return false;
    if (localCells.has(cellKey(c.lat, c.lng))) return false;
    return true;
  });

  if (travel.length === 0) return [];

  const tripGroups = groupDestinationsIntoTrips(travel, TRIP_GAP_DAYS);
  onProgress?.('Curating your trips…', 60);

  const trips: InferredTrip[] = [];
  for (const group of tripGroups) {
    const stops = mergeAdjacentStops(group);
    const destinations: InferredDestination[] = [];
    for (const cluster of stops) {
      const hero = selectHeroPhoto(cluster.photos);
      if (!hero) continue;
      const cc = dominantCountryCode(cluster.photos) || (hero.countryCode ?? '');
      destinations.push(makeDestination(cluster, hero, cc));
    }
    if (destinations.length === 0) continue;
    fillMissingCountries(destinations);
    trips.push({ name: tripNameFor(destinations), destinations });
  }

  ensureInternationalCoverage(trips, deduped, homeCountry);
  dedupePlacesAcrossTrips(trips);

  for (const t of trips) for (const d of t.destinations) delete d._heroScore;

  onProgress?.('Almost there…', 80);
  return trips;
}

/** Recomputes a trip's name (used after place names are enriched). */
export function renameTrip(trip: InferredTrip): void {
  trip.name = tripNameFor(trip.destinations);
}

// ─── Scoring (heuristic) ─────────────────────────────────────────────

/**
 * Without Apple's ML aesthetic scores we approximate "beauty" from signals we
 * do get on device: the user's own favorites (their explicit "this is great"
 * label), landscape framing (scenic establishing shots over portraits/selfies),
 * and a faint resolution bonus. Screenshots are dropped upstream.
 */
function scorePhoto(p: PhotoRec): number {
  let s = 0;
  if (p.isFavorite) s += 1.0;
  if (p.width >= p.height) s += 0.3;
  s += Math.min(0.2, ((p.width * p.height) / (4000 * 3000)) * 0.2);
  if (p.burstId) s -= 0.05;
  return s;
}

function selectHeroPhoto(photos: PhotoRec[]): PhotoRec | null {
  if (photos.length === 0) return null;
  return photos.reduce((best, p) => (p.score > best.score ? p : best));
}

/** Keep only the best-scoring frame from each burst group. */
function dedupeBursts(photos: PhotoRec[]): PhotoRec[] {
  const bestByBurst = new Map<string, PhotoRec>();
  const singles: PhotoRec[] = [];
  for (const p of photos) {
    if (!p.burstId) {
      singles.push(p);
      continue;
    }
    const existing = bestByBurst.get(p.burstId);
    if (!existing || p.score > existing.score) bestByBurst.set(p.burstId, p);
  }
  const merged = [...singles, ...bestByBurst.values()];
  merged.sort((a, b) => a.date.getTime() - b.date.getTime());
  return merged;
}

// ─── Clustering (location + day) ─────────────────────────────────────

/**
 * Replaces Apple's "Moments" with a location(~0.5° ≈ 55km grid) + calendar-day
 * bucketing. Multi-day stays split into per-day buckets here, then get folded
 * back together by mergeAdjacentStops (15km) within their trip.
 */
function buildClusters(photos: PhotoRec[]): Cluster[] {
  const groups = new Map<string, PhotoRec[]>();
  for (const p of photos) {
    const latC = Math.round(p.lat * 2) / 2;
    const lngC = Math.round(p.lng * 2) / 2;
    const day = p.date.toISOString().slice(0, 10);
    const key = `${latC},${lngC},${day}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const clusters: Cluster[] = [];
  for (const ps of groups.values()) {
    if (ps.length < MIN_CLUSTER_PHOTOS) continue;
    const { lat, lng } = representativePoint(ps);
    const times = ps.map((p) => p.date.getTime());
    clusters.push({
      lat,
      lng,
      photos: ps,
      startDate: new Date(Math.min(...times)),
      endDate: new Date(Math.max(...times)),
    });
  }
  clusters.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return clusters;
}

function representativePoint(photos: PhotoRec[]): { lat: number; lng: number } {
  if (photos.length === 1) return { lat: photos[0].lat, lng: photos[0].lng };
  const sample =
    photos.length > 250
      ? photos.filter((_, i) => i % Math.ceil(photos.length / 250) === 0)
      : photos;
  let best = sample[0];
  let bestSum = Infinity;
  for (const a of sample) {
    let sum = 0;
    for (const b of sample) sum += haversine(a.lat, a.lng, b.lat, b.lng);
    if (sum < bestSum) {
      bestSum = sum;
      best = a;
    }
  }
  return { lat: best.lat, lng: best.lng };
}

function findHomeCenter(photos: PhotoRec[]): { lat: number; lng: number } | null {
  const cells = new Map<string, PhotoRec[]>();
  for (const p of photos) {
    const key = `${Math.round(p.lat * 2) / 2},${Math.round(p.lng * 2) / 2}`;
    const arr = cells.get(key);
    if (arr) arr.push(p);
    else cells.set(key, [p]);
  }
  let biggest: PhotoRec[] | null = null;
  for (const arr of cells.values()) {
    if (!biggest || arr.length > biggest.length) biggest = arr;
  }
  if (!biggest) return null;
  return {
    lat: biggest.reduce((s, p) => s + p.lat, 0) / biggest.length,
    lng: biggest.reduce((s, p) => s + p.lng, 0) / biggest.length,
  };
}

function findRecurringLocalCells(clusters: Cluster[]): Set<string> {
  const DAY = 1000 * 60 * 60 * 24;
  const cellKey = (lat: number, lng: number) =>
    `${Math.round(lat * 2) / 2},${Math.round(lng * 2) / 2}`;

  const cells = new Map<string, { days: Set<string>; min: number; max: number }>();
  for (const d of clusters) {
    const key = cellKey(d.lat, d.lng);
    let cell = cells.get(key);
    if (!cell) {
      cell = { days: new Set(), min: Infinity, max: -Infinity };
      cells.set(key, cell);
    }
    for (const p of d.photos) {
      const t = p.date.getTime();
      cell.days.add(p.date.toISOString().slice(0, 10));
      if (t < cell.min) cell.min = t;
      if (t > cell.max) cell.max = t;
    }
  }

  const local = new Set<string>();
  for (const [key, cell] of cells) {
    const spanDays = (cell.max - cell.min) / DAY;
    if (cell.days.size >= 5 && spanDays >= 30) local.add(key);
  }
  return local;
}

// ─── Trip grouping + merging ─────────────────────────────────────────

function groupDestinationsIntoTrips(
  clusters: Cluster[],
  tripGapDays: number
): Cluster[][] {
  if (clusters.length === 0) return [];
  const trips: Cluster[][] = [[clusters[0]]];
  for (let i = 1; i < clusters.length; i++) {
    const prev = clusters[i - 1];
    const curr = clusters[i];
    const gapDays =
      (curr.startDate.getTime() - prev.endDate.getTime()) / (1000 * 60 * 60 * 24);
    if (gapDays > tripGapDays) trips.push([curr]);
    else trips[trips.length - 1].push(curr);
  }
  return trips;
}

function absorbStop(a: Cluster, b: Cluster): void {
  a.photos = a.photos.concat(b.photos);
  const { lat, lng } = representativePoint(a.photos);
  a.lat = lat;
  a.lng = lng;
  a.startDate = new Date(Math.min(a.startDate.getTime(), b.startDate.getTime()));
  a.endDate = new Date(Math.max(a.endDate.getTime(), b.endDate.getTime()));
}

/**
 * Folds stops within 15km of each other (even non-consecutive ones) into a
 * single place, so a multi-day stay split across day-buckets becomes one dot.
 */
function mergeAdjacentStops(group: Cluster[]): Cluster[] {
  const sorted = [...group].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );
  const merged: Cluster[] = [];
  for (const c of sorted) {
    const copy: Cluster = { ...c, photos: [...c.photos] };
    const near = merged.find((m) => haversine(m.lat, m.lng, copy.lat, copy.lng) < SAME_PLACE_KM);
    if (near) absorbStop(near, copy);
    else merged.push(copy);
  }
  return merged.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

function dedupePlacesAcrossTrips(trips: InferredTrip[]): void {
  const all: InferredDestination[] = [];
  for (const t of trips) for (const d of t.destinations) all.push(d);
  all.sort((a, b) => (b._heroScore ?? 0) - (a._heroScore ?? 0));

  const keepers: InferredDestination[] = [];
  const keep = new Set<InferredDestination>();
  for (const d of all) {
    const dup = keepers.find(
      (w) =>
        w.countryCode === d.countryCode &&
        haversine(w.lat, w.lng, d.lat, d.lng) < SAME_PLACE_KM
    );
    if (dup) {
      dup.photoCount += d.photoCount;
      dup.arrivalDate = d.arrivalDate < dup.arrivalDate ? d.arrivalDate : dup.arrivalDate;
      dup.departureDate =
        d.departureDate > dup.departureDate ? d.departureDate : dup.departureDate;
    } else {
      keepers.push(d);
      keep.add(d);
    }
  }

  for (const t of trips) t.destinations = t.destinations.filter((d) => keep.has(d));
  for (let i = trips.length - 1; i >= 0; i--) {
    if (trips[i].destinations.length === 0) trips.splice(i, 1);
    else trips[i].name = tripNameFor(trips[i].destinations);
  }
}

// ─── Country coverage + naming ───────────────────────────────────────

function dominantCountryCode(photos: PhotoRec[]): string {
  const votes = new Map<string, number>();
  for (const p of photos) {
    if (p.countryCode) votes.set(p.countryCode, (votes.get(p.countryCode) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [code, n] of votes) {
    if (n > bestN) {
      bestN = n;
      best = code;
    }
  }
  return best;
}

function makeDestination(
  cluster: Cluster,
  hero: PhotoRec,
  countryCode: string
): InferredDestination {
  return {
    city: '',
    country: countryName(countryCode),
    countryCode,
    lat: cluster.lat,
    lng: cluster.lng,
    arrivalDate: cluster.startDate.toISOString().slice(0, 10),
    departureDate: cluster.endDate.toISOString().slice(0, 10),
    photoCount: cluster.photos.length,
    photos: [photoRef(hero)],
    _heroScore: hero.score,
  };
}

function photoRef(p: PhotoRec): InferredPhotoRef {
  return {
    uuid: p.id,
    localIdentifier: p.id,
    filename: '',
    directory: '',
    dateTaken: p.date.toISOString().slice(0, 10),
  };
}

function ensureInternationalCoverage(
  trips: InferredTrip[],
  photos: PhotoRec[],
  homeCountry: string
): void {
  const shown = new Set<string>();
  for (const t of trips) {
    for (const d of t.destinations) if (d.countryCode) shown.add(d.countryCode);
  }

  const byCountry = new Map<string, PhotoRec[]>();
  for (const p of photos) {
    const cc = p.countryCode;
    if (!cc || cc === homeCountry || shown.has(cc)) continue;
    const arr = byCountry.get(cc);
    if (arr) arr.push(p);
    else byCountry.set(cc, [p]);
  }

  for (const [cc, ps] of byCountry) {
    const hero = selectHeroPhoto(ps);
    if (!hero) continue;
    const times = ps.map((p) => p.date.getTime());
    const dest: InferredDestination = {
      city: '',
      country: countryName(cc),
      countryCode: cc,
      lat: hero.lat,
      lng: hero.lng,
      arrivalDate: new Date(Math.min(...times)).toISOString().slice(0, 10),
      departureDate: new Date(Math.max(...times)).toISOString().slice(0, 10),
      photoCount: ps.length,
      photos: [photoRef(hero)],
      _heroScore: hero.score,
    };
    trips.push({ name: tripNameFor([dest]), destinations: [dest] });
  }

  trips.sort(
    (a, b) =>
      new Date(a.destinations[0].arrivalDate).getTime() -
      new Date(b.destinations[0].arrivalDate).getTime()
  );
}

function fillMissingCountries(destinations: InferredDestination[]): void {
  const tally = new Map<string, { count: number; code: string }>();
  for (const d of destinations) {
    if (!d.country) continue;
    const t = tally.get(d.country) ?? { count: 0, code: d.countryCode };
    t.count++;
    tally.set(d.country, t);
  }
  let dominant: { country: string; code: string } | null = null;
  for (const [country, { count, code }] of tally) {
    if (!dominant || count > tally.get(dominant.country)!.count) {
      dominant = { country, code };
    }
  }
  if (!dominant) return;
  for (const d of destinations) {
    if (!d.country) {
      d.country = dominant.country;
      d.countryCode = dominant.code;
    }
  }
}

function tripNameFor(destinations: InferredDestination[]): string {
  const d = new Date(destinations[0].arrivalDate);
  const month = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const primary = destinations.reduce((a, b) => (b.photoCount > a.photoCount ? b : a));
  const label = primary.city || primary.country || 'Trip';
  return destinations.length === 1 ? `${label} · ${month}` : `${label} & more · ${month}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
