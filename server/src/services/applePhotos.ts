import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';
import { existsSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { promisify } from 'util';
import {
  countryCodeFromAppleBlob,
  countryCodeForPoint,
  countryName,
} from './geo.js';

const execFileAsync = promisify(execFile);

/**
 * Resolves a single representative country code for a stop. Apple's own
 * per-photo reverse geocode (carried on each PhotoRecord) is the source of
 * truth; we take the majority vote across the stop's photos so one mis-tagged
 * GPS point can't mislabel the place. As a last resort we fall back to an
 * offline polygon lookup on the representative coordinate.
 */
function resolveCountry(
  photos: PhotoRecord[],
  lat: number,
  lng: number
): { country: string; countryCode: string } {
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
  if (!best) best = countryCodeForPoint(lat, lng) ?? '';
  return { country: countryName(best), countryCode: best };
}

const CORE_DATA_EPOCH = 978307200;

const PHOTOS_LIB_PATH = join(
  homedir(),
  'Pictures',
  'Photos Library.photoslibrary'
);
const PHOTOS_DB_PATH = join(PHOTOS_LIB_PATH, 'database', 'Photos.sqlite');
const ORIGINALS_PATH = join(PHOTOS_LIB_PATH, 'originals');
const THUMB_CACHE_DIR = join(tmpdir(), 'tt-photo-cache');

// ─── Types ───────────────────────────────────────────────────────────

interface PhotoRecord {
  latitude: number;
  longitude: number;
  dateTaken: Date;
  filename: string;
  directory: string;
  uuid: string;
  faceCount: number;
  /** Pixel dimensions — used to tell scenic (landscape) from portrait/selfie */
  width: number;
  height: number;
  /** Apple's on-device overall aesthetic score (0..1) */
  aesthetic: number;
  /** Apple's curation score (0..1) — "is this worth surfacing" */
  curation: number;
  /** Highlight visibility score (0..1) */
  highlightVisibility: number;
  /** How iconic/postcard-worthy the shot is (-2..1) */
  iconic: number;
  // ── Apple's per-dimension aesthetic ML scores (ZCOMPUTEDASSETATTRIBUTES) ──
  /** Sense of "being in a place" (0..1) — gold for travel */
  immersiveness: number;
  /** Framing / rule-of-thirds (-1..1) */
  composition: number;
  /** Quality of light, e.g. golden hour (-1..1) */
  lighting: number;
  harmoniousColor: number;
  livelyColor: number;
  interestingSubject: number;
  wellFramedSubject: number;
  sharpFocusSubject: number;
  /** Clutter penalty (-1..0, 0 = clean frame) */
  intrusiveObject: number;
  /** Darkness (0..1, higher = darker) */
  lowLight: number;
  /** Technical quality gates (0..1, higher = better) */
  sharpness: number;
  exposure: number;
  /** Penalty scores from Apple's analysis (<= 0, more negative = worse) */
  failureScore: number;
  noiseScore: number;
  isFavorite: boolean;
  /** Burst group id; photos sharing this are near-duplicate frames */
  avalancheUuid: string | null;
  /** Apple "Moment" id — a place+time grouping Apple has already curated */
  momentId: number | null;
  /** Apple's human-readable moment title, e.g. "Mykonos" (offline geocode) */
  momentTitle: string | null;
  /** ISO alpha-2 country code from Apple's own reverse geocode (ground truth) */
  countryCode: string | null;
  /** Composite "beauty" score we compute (see scorePhoto) */
  score: number;
}

interface LocationCluster {
  lat: number;
  lng: number;
  photos: PhotoRecord[];
  startDate: Date;
  endDate: Date;
  /** Apple moment title used as the place name, e.g. "Mykonos" */
  title?: string;
}

export interface PhotoRef {
  uuid: string;
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
  photos: PhotoRef[];
  /** Internal: hero-photo beauty score, used to pick the best of duplicate
   * places. Stripped from the response before it leaves the service. */
  _heroScore?: number;
}

export interface InferredTrip {
  name: string;
  destinations: InferredDestination[];
}

// ─── Cache ───────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  createdAt: number;
}

const queryCache = new Map<string, CacheEntry<PhotoRecord[]>>();
const tripCache = new Map<string, CacheEntry<InferredTrip[]>>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T) {
  cache.set(key, { data, createdAt: Date.now() });
}

export function clearCache() {
  queryCache.clear();
  tripCache.clear();
}

// ─── Database access ─────────────────────────────────────────────────

export function isPhotosDbAccessible(): { accessible: boolean; path: string; error?: string } {
  if (!existsSync(PHOTOS_DB_PATH)) {
    return {
      accessible: false,
      path: PHOTOS_DB_PATH,
      error: 'Photos database not found. Make sure Apple Photos has been used on this Mac.',
    };
  }
  try {
    const db = new Database(PHOTOS_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.prepare('SELECT COUNT(*) FROM ZASSET LIMIT 1').get();
    db.close();
    return { accessible: true, path: PHOTOS_DB_PATH };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('SQLITE_CANTOPEN') || message.includes('operation not permitted')) {
      return {
        accessible: false,
        path: PHOTOS_DB_PATH,
        error:
          'Permission denied. Grant Full Disk Access to your terminal app:\n' +
          'System Settings → Privacy & Security → Full Disk Access → Add your terminal/Cursor app.',
      };
    }
    return { accessible: false, path: PHOTOS_DB_PATH, error: message };
  }
}

/**
 * Reads geotagged photos from the Apple Photos database, excluding screenshots
 * and enriching each photo with face count and aesthetic quality scores from
 * Apple's built-in ML analysis.
 *
 * Subtype 2 = screenshots, subtype 10 = screen recordings.
 * Face count comes from ZMEDIAANALYSISASSETATTRIBUTES.
 * Quality score is a composite of Apple's aesthetic classifiers.
 */
export function readPhotosWithLocation(yearsBack: number = 5): PhotoRecord[] {
  const cacheKey = `photos-smart-${yearsBack}`;
  const cached = getCached(queryCache, cacheKey);
  if (cached) return cached;

  const db = new Database(PHOTOS_DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');

  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
  const cutoffCoreData = (cutoffDate.getTime() / 1000) - CORE_DATA_EPOCH;

  const rows = db.prepare(`
    SELECT
      A.ZUUID          AS uuid,
      A.ZDIRECTORY     AS directory,
      A.ZFILENAME      AS filename,
      A.ZLATITUDE      AS latitude,
      A.ZLONGITUDE     AS longitude,
      A.ZDATECREATED   AS dateCreated,
      A.ZWIDTH         AS width,
      A.ZHEIGHT        AS height,
      A.ZFAVORITE      AS favorite,
      A.ZAVALANCHEUUID AS avalancheUuid,
      A.ZMOMENT        AS momentId,
      MO.ZTITLE        AS momentTitle,
      AD.ZREVERSELOCATIONDATA AS revGeo,
      AD.ZLOCATIONHASH        AS locationHash,
      COALESCE(A.ZOVERALLAESTHETICSCORE, 0)    AS aesthetic,
      COALESCE(A.ZCURATIONSCORE, 0)            AS curation,
      COALESCE(A.ZHIGHLIGHTVISIBILITYSCORE, 0) AS highlightVisibility,
      COALESCE(A.ZICONICSCORE, 0)              AS iconic,
      COALESCE(M.ZFACECOUNT, 0)                AS faceCount,
      COALESCE(M.ZBLURRINESSSCORE, 1)          AS sharpness,
      COALESCE(M.ZEXPOSURESCORE, 1)            AS exposure,
      COALESCE(C.ZIMMERSIVENESSSCORE, 0)       AS immersiveness,
      COALESCE(C.ZPLEASANTCOMPOSITIONSCORE, 0) AS composition,
      COALESCE(C.ZPLEASANTLIGHTINGSCORE, 0)    AS lighting,
      COALESCE(C.ZHARMONIOUSCOLORSCORE, 0)     AS harmoniousColor,
      COALESCE(C.ZLIVELYCOLORSCORE, 0)         AS livelyColor,
      COALESCE(C.ZINTERESTINGSUBJECTSCORE, 0)  AS interestingSubject,
      COALESCE(C.ZWELLFRAMEDSUBJECTSCORE, 0)   AS wellFramedSubject,
      COALESCE(C.ZSHARPLYFOCUSEDSUBJECTSCORE, 0) AS sharpFocusSubject,
      COALESCE(C.ZINTRUSIVEOBJECTPRESENCESCORE, 0) AS intrusiveObject,
      COALESCE(C.ZLOWLIGHT, 0)                 AS lowLight,
      COALESCE(C.ZFAILURESCORE, 0)             AS failureScore,
      COALESCE(C.ZNOISESCORE, 0)               AS noiseScore
    FROM ZASSET A
    LEFT JOIN ZMEDIAANALYSISASSETATTRIBUTES M
      ON M.ZASSET = A.Z_PK
    LEFT JOIN ZCOMPUTEDASSETATTRIBUTES C
      ON C.ZASSET = A.Z_PK
    LEFT JOIN ZMOMENT MO
      ON MO.Z_PK = A.ZMOMENT
    LEFT JOIN ZADDITIONALASSETATTRIBUTES AD
      ON AD.ZASSET = A.Z_PK
    WHERE A.ZLATITUDE IS NOT NULL
      AND A.ZLONGITUDE IS NOT NULL
      -- Valid ranges only. Apple uses (-180, -180) as a "no location" sentinel,
      -- which slips past a simple "!= 0" check and otherwise drags a stop's
      -- marker into the ocean near (0,0).
      AND A.ZLATITUDE BETWEEN -90 AND 90
      AND A.ZLONGITUDE BETWEEN -180 AND 180
      AND NOT (A.ZLATITUDE = 0 AND A.ZLONGITUDE = 0)
      AND A.ZDATECREATED > ?
      AND A.ZTRASHEDSTATE = 0
      AND A.ZHIDDEN = 0
      AND A.ZKIND = 0
    ORDER BY A.ZDATECREATED ASC
  `).all(cutoffCoreData) as Array<{
    uuid: string;
    directory: string;
    filename: string;
    latitude: number;
    longitude: number;
    dateCreated: number;
    width: number;
    height: number;
    favorite: number;
    avalancheUuid: string | null;
    momentId: number | null;
    momentTitle: string | null;
    revGeo: Buffer | null;
    locationHash: string | null;
    aesthetic: number;
    curation: number;
    highlightVisibility: number;
    iconic: number;
    faceCount: number;
    sharpness: number;
    exposure: number;
    immersiveness: number;
    composition: number;
    lighting: number;
    harmoniousColor: number;
    livelyColor: number;
    interestingSubject: number;
    wellFramedSubject: number;
    sharpFocusSubject: number;
    intrusiveObject: number;
    lowLight: number;
    failureScore: number;
    noiseScore: number;
  }>;

  db.close();

  // Resolve each photo's country from Apple's own reverse geocode (ground
  // truth). Decoding is memoized by Apple's location hash so we only parse one
  // blob per distinct place, not once per photo.
  const countryByHash = new Map<string, string | null>();
  const countryFor = (row: { revGeo: Buffer | null; locationHash: string | null }) => {
    const hash = row.locationHash;
    if (hash && countryByHash.has(hash)) return countryByHash.get(hash) ?? null;
    const code = row.revGeo ? countryCodeFromAppleBlob(row.revGeo) : null;
    if (hash) countryByHash.set(hash, code);
    return code;
  };

  const mapped: PhotoRecord[] = rows.map((row) => {
    const rec: PhotoRecord = {
      uuid: row.uuid,
      directory: row.directory,
      filename: row.filename,
      latitude: row.latitude,
      longitude: row.longitude,
      dateTaken: new Date((row.dateCreated + CORE_DATA_EPOCH) * 1000),
      faceCount: row.faceCount,
      width: row.width,
      height: row.height,
      aesthetic: row.aesthetic,
      curation: row.curation,
      highlightVisibility: row.highlightVisibility,
      iconic: row.iconic,
      immersiveness: row.immersiveness,
      composition: row.composition,
      lighting: row.lighting,
      harmoniousColor: row.harmoniousColor,
      livelyColor: row.livelyColor,
      interestingSubject: row.interestingSubject,
      wellFramedSubject: row.wellFramedSubject,
      sharpFocusSubject: row.sharpFocusSubject,
      intrusiveObject: row.intrusiveObject,
      lowLight: row.lowLight,
      sharpness: row.sharpness,
      exposure: row.exposure,
      failureScore: row.failureScore,
      noiseScore: row.noiseScore,
      isFavorite: row.favorite === 1,
      avalancheUuid: row.avalancheUuid,
      momentId: row.momentId,
      momentTitle: row.momentTitle,
      countryCode: countryFor(row),
      score: 0,
    };
    return rec;
  });

  // Fill any photo Apple never reverse-geocoded with an offline polygon lookup.
  for (const p of mapped) {
    if (!p.countryCode) p.countryCode = countryCodeForPoint(p.latitude, p.longitude);
  }

  // Only keep photos whose original is actually on disk. With iCloud
  // "Optimize Mac Storage" many originals live in the cloud, and we can't make
  // a thumbnail from a file we don't have — including them would surface broken
  // images in the story.
  const available = mapped.filter((p) => {
    const path = getOriginalPhotoPath(p.directory, p.filename);
    return path !== null && existsSync(path);
  });

  // Score beauty relative to THIS user's library (self-calibrating, learned
  // from their own taste) rather than against hard-coded thresholds.
  assignBeautyScores(available);

  // Collapse bursts: keep only the best-scored frame from each burst group
  const result = dedupeBursts(available);

  setCache(queryCache, cacheKey, result);
  return result;
}

/** Below this many favorites we can't reliably learn a user's taste. */
const MIN_FAVORITES_TO_LEARN = 20;

/**
 * Assigns a "beauty" score to every photo, calibrated to THIS user's library
 * instead of hard-coded thresholds — so it generalizes to any new user.
 *
 *   1. Every signal is converted to a PERCENTILE RANK within the user's own
 *      set, so "beautiful" means "near the top of your photos" regardless of
 *      the absolute numbers (which differ per library/camera/era).
 *   2. Signals are fused with weights LEARNED from the user's favorites — how
 *      strongly each one separates their favorites from the rest (their actual
 *      taste). With too few favorites to learn from, weights fall back to equal
 *      (a neutral cold-start default).
 *
 * The signals are Apple's on-device aesthetic ML — including its cross-user
 * trained curation/highlight/aesthetic/iconic aggregates — never our own
 * hand-coded opinion of what a beautiful photo looks like.
 */
function assignBeautyScores(photos: PhotoRecord[]): void {
  const n = photos.length;
  if (n === 0) return;
  if (n === 1) {
    photos[0].score = 0.5 + (photos[0].isFavorite ? 0.15 : 0);
    return;
  }

  // Each signal + whether higher is better (+1) or lower is better (-1).
  const signals: Array<{ get: (p: PhotoRecord) => number; dir: number }> = [
    { get: (p) => p.aesthetic, dir: 1 },
    { get: (p) => p.curation, dir: 1 },
    { get: (p) => p.highlightVisibility, dir: 1 },
    { get: (p) => p.iconic, dir: 1 },
    { get: (p) => p.immersiveness, dir: 1 },
    { get: (p) => p.composition, dir: 1 },
    { get: (p) => p.lighting, dir: 1 },
    { get: (p) => p.harmoniousColor, dir: 1 },
    { get: (p) => p.livelyColor, dir: 1 },
    { get: (p) => p.interestingSubject, dir: 1 },
    { get: (p) => p.wellFramedSubject, dir: 1 },
    { get: (p) => p.sharpFocusSubject, dir: 1 },
    { get: (p) => p.sharpness, dir: 1 },
    { get: (p) => p.exposure, dir: 1 },
    { get: (p) => p.intrusiveObject, dir: 1 }, // -1..0; closer to 0 = cleaner frame
    { get: (p) => p.lowLight, dir: -1 }, // 0..1; darker = worse
    { get: (p) => p.noiseScore, dir: 1 }, // <= 0; closer to 0 = cleaner
    { get: (p) => p.failureScore, dir: 1 }, // <= 0; closer to 0 = better
  ];

  // Directed percentile rank in [0,1] for each (signal, photo).
  const pct: Float64Array[] = signals.map(() => new Float64Array(n));
  const idx = Array.from({ length: n }, (_, i) => i);
  signals.forEach((sig, s) => {
    const order = [...idx].sort((a, b) => sig.get(photos[a]) - sig.get(photos[b]));
    for (let r = 0; r < n; r++) {
      const p = r / (n - 1);
      pct[s][order[r]] = sig.dir < 0 ? 1 - p : p;
    }
  });

  // Learn weights from favorites when there are enough to be meaningful.
  const favIdx = idx.filter((i) => photos[i].isFavorite);
  let weights: number[];
  if (favIdx.length >= MIN_FAVORITES_TO_LEARN && favIdx.length < n) {
    weights = signals.map((_, s) => {
      let favSum = 0;
      for (const i of favIdx) favSum += pct[s][i];
      const favMean = favSum / favIdx.length;
      let allSum = 0;
      for (let i = 0; i < n; i++) allSum += pct[s][i];
      const nonFavMean = (allSum - favSum) / (n - favIdx.length);
      // Reward only signals on which the user's favorites rank above the rest.
      return Math.max(0, favMean - nonFavMean);
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    weights =
      sum > 0 ? weights.map((w) => w / sum) : signals.map(() => 1 / signals.length);
  } else {
    weights = signals.map(() => 1 / signals.length);
  }

  for (let i = 0; i < n; i++) {
    let b = 0;
    for (let s = 0; s < signals.length; s++) b += weights[s] * pct[s][i];
    // A favorite is the user's own "this is beautiful" label — gentle boost.
    photos[i].score = b + (photos[i].isFavorite ? 0.15 : 0);
  }
}

/**
 * Picks the single most beautiful photo to represent a place. Beauty does the
 * heavy lifting; a light scenic nudge breaks ties toward establishing shots so
 * a place reads as a place (not a face), and a favorite vista is preferred.
 */
function selectHeroPhoto(photos: PhotoRecord[]): PhotoRecord | null {
  if (photos.length === 0) return null;
  const heroScore = (p: PhotoRecord) => {
    const scenicNudge = p.faceCount === 0 ? 0.25 : 0;
    const landscapeNudge = p.width >= p.height ? 0.08 : 0;
    const selfiePenalty = p.faceCount >= 1 && p.height > p.width ? 0.25 : 0;
    return p.score + scenicNudge + landscapeNudge - selfiePenalty;
  };
  return photos.reduce((best, p) => (heroScore(p) > heroScore(best) ? p : best));
}

/**
 * Bursts (rapid-fire near-identical frames) share an avalanche UUID. We keep
 * only the single highest-scoring frame so a burst doesn't flood the story.
 */
function dedupeBursts(photos: PhotoRecord[]): PhotoRecord[] {
  const bestByBurst = new Map<string, PhotoRecord>();
  const singles: PhotoRecord[] = [];

  for (const p of photos) {
    if (!p.avalancheUuid) {
      singles.push(p);
      continue;
    }
    const existing = bestByBurst.get(p.avalancheUuid);
    if (!existing || p.score > existing.score) {
      bestByBurst.set(p.avalancheUuid, p);
    }
  }

  const merged = [...singles, ...bestByBurst.values()];
  merged.sort((a, b) => a.dateTaken.getTime() - b.dateTaken.getTime());
  return merged;
}

// ─── Moment-based destinations ───────────────────────────────────────

const HOME_RADIUS_KM = 75;
const HOME_TITLES = new Set(['home']);
/** Max gap between consecutive stops that still counts as one trip. */
const TRIP_GAP_DAYS = 5;

/**
 * Picks a robust representative coordinate for a stop: the medoid — the actual
 * photo location with the smallest total distance to all the others. Unlike a
 * plain average, a few photos with wrong GPS tags can't drag the marker out
 * into the ocean, and the result is always a real spot where a photo was taken.
 */
function representativePoint(photos: PhotoRecord[]): { lat: number; lng: number } {
  if (photos.length === 1) {
    return { lat: photos[0].latitude, lng: photos[0].longitude };
  }
  // Cap the O(n²) work for very large stops by sampling evenly.
  const sample =
    photos.length > 250
      ? photos.filter((_, i) => i % Math.ceil(photos.length / 250) === 0)
      : photos;

  let best = sample[0];
  let bestSum = Infinity;
  for (const a of sample) {
    let sum = 0;
    for (const b of sample) {
      sum += haversine(a.latitude, a.longitude, b.latitude, b.longitude);
    }
    if (sum < bestSum) {
      bestSum = sum;
      best = a;
    }
  }
  return { lat: best.latitude, lng: best.longitude };
}

/**
 * Groups photos into destinations using Apple's own "Moments" — coherent
 * place+time groupings that already carry a human-readable title (e.g.
 * "Mykonos"). This is far more reliable than network geocoding and produces
 * much more sensible groupings than naive distance clustering.
 */
function buildMomentDestinations(photos: PhotoRecord[]): LocationCluster[] {
  const groups = new Map<number, PhotoRecord[]>();
  for (const p of photos) {
    if (p.momentId == null) continue;
    const title = (p.momentTitle ?? '').trim();
    if (!title) continue;
    const arr = groups.get(p.momentId);
    if (arr) arr.push(p);
    else groups.set(p.momentId, [p]);
  }

  const destinations: LocationCluster[] = [];
  for (const ps of groups.values()) {
    if (ps.length < 3) continue;
    const { lat, lng } = representativePoint(ps);
    const times = ps.map((p) => p.dateTaken.getTime());
    destinations.push({
      title: (ps[0].momentTitle ?? '').trim(),
      lat,
      lng,
      photos: ps,
      startDate: new Date(Math.min(...times)),
      endDate: new Date(Math.max(...times)),
    });
  }

  destinations.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return destinations;
}

/**
 * Estimates the user's home location so we can exclude everyday local photos
 * and keep the story focused on actual travel. Prefers moments Apple titled
 * "Home"; otherwise falls back to the single most-photographed moment.
 */
function findHomeCenter(photos: PhotoRecord[]): { lat: number; lng: number } | null {
  const homePhotos = photos.filter((p) =>
    HOME_TITLES.has((p.momentTitle ?? '').trim().toLowerCase())
  );
  if (homePhotos.length > 0) {
    return {
      lat: homePhotos.reduce((s, p) => s + p.latitude, 0) / homePhotos.length,
      lng: homePhotos.reduce((s, p) => s + p.longitude, 0) / homePhotos.length,
    };
  }

  // Fallback: the moment with the most photos is almost always home.
  const counts = new Map<number, PhotoRecord[]>();
  for (const p of photos) {
    if (p.momentId == null) continue;
    const arr = counts.get(p.momentId);
    if (arr) arr.push(p);
    else counts.set(p.momentId, [p]);
  }
  let biggest: PhotoRecord[] | null = null;
  for (const arr of counts.values()) {
    if (!biggest || arr.length > biggest.length) biggest = arr;
  }
  if (!biggest) return null;
  return {
    lat: biggest.reduce((s, p) => s + p.latitude, 0) / biggest.length,
    lng: biggest.reduce((s, p) => s + p.longitude, 0) / biggest.length,
  };
}

/**
 * Identifies "home / recurring local" places to exclude from the travel story.
 *
 * A real trip is a place you visit once, in a contiguous burst. Everyday life —
 * home, the office, the neighborhood you live in (even across multiple home
 * bases) — shows up as the same area photographed across many separated days
 * over a long span. We bucket destinations into ~55km cells and flag any cell
 * with photos on several distinct days spread over more than a few weeks.
 */
function findRecurringLocalCells(destinations: LocationCluster[]): Set<string> {
  const DAY = 1000 * 60 * 60 * 24;
  const cellKey = (lat: number, lng: number) =>
    `${Math.round(lat * 2) / 2},${Math.round(lng * 2) / 2}`;

  const cells = new Map<string, { days: Set<string>; min: number; max: number }>();
  for (const d of destinations) {
    const key = cellKey(d.lat, d.lng);
    let cell = cells.get(key);
    if (!cell) {
      cell = { days: new Set(), min: Infinity, max: -Infinity };
      cells.set(key, cell);
    }
    for (const p of d.photos) {
      const t = p.dateTaken.getTime();
      cell.days.add(p.dateTaken.toISOString().slice(0, 10));
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

/** Folds stop `b` into stop `a` (photos, date range, medoid, best title). */
function absorbStop(a: LocationCluster, b: LocationCluster): void {
  const titleWins = b.photos.length > a.photos.length;
  a.photos = a.photos.concat(b.photos);
  const { lat, lng } = representativePoint(a.photos);
  a.lat = lat;
  a.lng = lng;
  a.startDate = new Date(Math.min(a.startDate.getTime(), b.startDate.getTime()));
  a.endDate = new Date(Math.max(a.endDate.getTime(), b.endDate.getTime()));
  if (titleWins && b.title) a.title = b.title;
}

/**
 * Within a trip, collapse stops that are really the same place so each place
 * appears exactly once. This runs in two passes:
 *
 *  1. Same Apple title — a place you return to later in the same trip (e.g.
 *     leaving "La Flèche" for a day trip and coming back) is one stop, not two.
 *     We only do this within a trip, so genuine re-visits months apart on
 *     separate trips stay separate.
 *  2. Adjacent & very close (<15km) — neighbouring moments with different
 *     titles that are effectively the same spot.
 *
 * Without this the story flies to the same city several times and the city
 * count is wildly inflated.
 */
function mergeAdjacentStops(group: LocationCluster[]): LocationCluster[] {
  // Pass 1 — collapse every stop that shares an Apple title.
  const byTitle = new Map<string, LocationCluster>();
  const untitled: LocationCluster[] = [];
  for (const c of group) {
    const key = (c.title ?? '').trim().toLowerCase();
    if (!key) {
      untitled.push({ ...c, photos: [...c.photos] });
      continue;
    }
    const existing = byTitle.get(key);
    if (existing) {
      absorbStop(existing, c);
    } else {
      byTitle.set(key, { ...c, photos: [...c.photos] });
    }
  }

  const deduped = [...byTitle.values(), ...untitled].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );

  // Pass 2 — fold differently-titled stops that sit on the same spot, even if
  // they aren't consecutive (e.g. "La Flèche" and "La Flèche & Marcilly-sur-
  // Maulne" separated by a day trip). We compare against EVERY kept stop, not
  // just the previous one, so a place revisited mid-trip collapses to one.
  const merged: LocationCluster[] = [];
  for (const c of deduped) {
    const near = merged.find((m) => haversine(m.lat, m.lng, c.lat, c.lng) < 15);
    if (near) absorbStop(near, c);
    else merged.push(c);
  }
  return merged.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

/** Two stops within this distance are treated as the same place on the globe. */
const SAME_PLACE_KM = 15;

/**
 * Collapses duplicate places ACROSS trips so each spot is a single dot. A place
 * you return to on separate trips (e.g. visiting Angers every year) otherwise
 * stacks several markers on the exact same coordinate and clutters the globe.
 *
 * We keep the single most beautiful instance (highest hero score) as the dot,
 * fold the others' photo counts into it, then drop any trip left empty and
 * rename survivors whose line-up changed.
 */
function dedupePlacesAcrossTrips(trips: InferredTrip[]): void {
  const all: InferredDestination[] = [];
  for (const t of trips) for (const d of t.destinations) all.push(d);
  // Best-looking first, so the marker we keep shows the prettiest photo.
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
      dup.arrivalDate =
        d.arrivalDate < dup.arrivalDate ? d.arrivalDate : dup.arrivalDate;
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

/** Splits a time-ordered destination list into trips separated by long gaps. */
function groupDestinationsIntoTrips(
  destinations: LocationCluster[],
  tripGapDays: number = 14
): LocationCluster[][] {
  if (destinations.length === 0) return [];
  const trips: LocationCluster[][] = [[destinations[0]]];
  for (let i = 1; i < destinations.length; i++) {
    const prev = destinations[i - 1];
    const curr = destinations[i];
    const gapDays =
      (curr.startDate.getTime() - prev.endDate.getTime()) / (1000 * 60 * 60 * 24);
    if (gapDays > tripGapDays) trips.push([curr]);
    else trips[trips.length - 1].push(curr);
  }
  return trips;
}

// ─── Full pipeline ───────────────────────────────────────────────────

export async function inferTripsFromPhotos(
  yearsBack: number = 5,
  onProgress?: (msg: string, pct: number) => void
): Promise<InferredTrip[]> {
  const cacheKey = `trips-smart-${yearsBack}`;
  const cached = getCached(tripCache, cacheKey);
  if (cached) {
    onProgress?.('Using cached results.', 100);
    return cached;
  }

  onProgress?.('Reading Apple Photos database (filtering screenshots)...', 5);
  const photos = readPhotosWithLocation(yearsBack);

  if (photos.length === 0) {
    throw new Error(`No geotagged camera photos found in the last ${yearsBack} years.`);
  }

  onProgress?.(`Found ${photos.length.toLocaleString()} photos. Reading your places...`, 20);
  const allDestinations = buildMomentDestinations(photos);

  // Exclude everyday/local photos so the story is only real travel.
  onProgress?.('Finding the trips that took you somewhere...', 40);
  const home = findHomeCenter(photos);
  const homeCountry = dominantCountryCode(photos);
  const localCells = findRecurringLocalCells(allDestinations);
  const cellKey = (lat: number, lng: number) =>
    `${Math.round(lat * 2) / 2},${Math.round(lng * 2) / 2}`;

  const travelDestinations = allDestinations.filter((d) => {
    // International stops are ALWAYS kept — every foreign trip must show up,
    // even if you also visit that area often or it's near a "home" of yours.
    const cc = dominantCountryCode(d.photos);
    if (cc && homeCountry && cc !== homeCountry) return true;

    // Domestic stops: strip out home and everyday/recurring-local places.
    const title = (d.title ?? '').trim().toLowerCase();
    if (HOME_TITLES.has(title)) return false;
    if (home && haversine(home.lat, home.lng, d.lat, d.lng) < HOME_RADIUS_KM) return false;
    if (localCells.has(cellKey(d.lat, d.lng))) return false;
    return true;
  });

  if (travelDestinations.length === 0) {
    throw new Error(
      `Found photos, but none look like trips away from home in the last ${yearsBack} years. Try a longer time window.`
    );
  }

  const tripGroups = groupDestinationsIntoTrips(travelDestinations, TRIP_GAP_DAYS);
  onProgress?.(
    `Found ${tripGroups.length} trips across ${travelDestinations.length} places. Curating photos...`,
    60
  );

  const trips: InferredTrip[] = [];

  for (const group of tripGroups) {
    const destinations: InferredDestination[] = [];
    const stops = mergeAdjacentStops(group);

    for (const cluster of stops) {
      // One hero photo per place — the most beautiful shot of the stop.
      const hero = selectHeroPhoto(cluster.photos);
      if (!hero) continue;

      const { country, countryCode } = resolveCountry(
        cluster.photos,
        cluster.lat,
        cluster.lng
      );

      destinations.push({
        city: cluster.title ?? '',
        country,
        countryCode,
        lat: cluster.lat,
        lng: cluster.lng,
        arrivalDate: cluster.startDate.toISOString().slice(0, 10),
        departureDate: cluster.endDate.toISOString().slice(0, 10),
        photoCount: cluster.photos.length,
        photos: [
          {
            uuid: hero.uuid,
            filename: hero.filename,
            directory: hero.directory,
            dateTaken: hero.dateTaken.toISOString().slice(0, 10),
          },
        ],
        _heroScore: hero.score,
      });
    }

    if (destinations.length === 0) continue;

    fillMissingCountries(destinations);
    trips.push({ name: tripNameFor(destinations), destinations });
  }

  // Guarantee a photo from EVERY international country — even one-off visits
  // whose moments were too small or untitled to survive normal grouping.
  ensureInternationalCoverage(trips, photos, homeCountry);

  // Collapse places visited on multiple trips into a single (prettiest) dot so
  // the globe shows each place once instead of stacking markers on one spot.
  dedupePlacesAcrossTrips(trips);

  // Drop the internal ranking field before the data leaves the service.
  for (const t of trips) for (const d of t.destinations) delete d._heroScore;

  onProgress?.('Done!', 100);
  setCache(tripCache, cacheKey, trips);
  return trips;
}

/** Majority ISO country code across a set of photos ('' if none resolved). */
function dominantCountryCode(photos: PhotoRecord[]): string {
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

/**
 * Ensures the story includes at least one destination for every international
 * country the user has a photo in. Trips built normally already cover the
 * sizeable foreign stays; this backfills the long tail — a country you only
 * have a couple of photos from, or whose moment Apple left untitled — so a
 * "34 countries" traveller actually sees all 34. Newly added stops are merged
 * back into chronological order.
 */
function ensureInternationalCoverage(
  trips: InferredTrip[],
  photos: PhotoRecord[],
  homeCountry: string
): void {
  const shown = new Set<string>();
  for (const t of trips) {
    for (const d of t.destinations) if (d.countryCode) shown.add(d.countryCode);
  }

  const byCountry = new Map<string, PhotoRecord[]>();
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
    const times = ps.map((p) => p.dateTaken.getTime());
    const city = (hero.momentTitle ?? '').trim() || countryName(cc);
    const dest: InferredDestination = {
      city,
      country: countryName(cc),
      countryCode: cc,
      lat: hero.latitude,
      lng: hero.longitude,
      arrivalDate: new Date(Math.min(...times)).toISOString().slice(0, 10),
      departureDate: new Date(Math.max(...times)).toISOString().slice(0, 10),
      photoCount: ps.length,
      photos: [
        {
          uuid: hero.uuid,
          filename: hero.filename,
          directory: hero.directory,
          dateTaken: hero.dateTaken.toISOString().slice(0, 10),
        },
      ],
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

/**
 * The offline geocoder misses many coastal/island/border points. Within a
 * single trip, fill any blank country with the trip's dominant country so the
 * "countries visited" stat and labels stay coherent (e.g. an unresolved Loire
 * village inherits "France" from the rest of the trip).
 */
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

/** Builds a friendly trip name from its destinations (marquee place + month). */
function tripNameFor(destinations: InferredDestination[]): string {
  const d = new Date(destinations[0].arrivalDate);
  const month = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const primary = destinations.reduce((a, b) => (b.photoCount > a.photoCount ? b : a));
  const label = primary.city || primary.country || 'Trip';
  return destinations.length === 1 ? `${label} · ${month}` : `${label} & more · ${month}`;
}

// ─── Photo serving ───────────────────────────────────────────────────

/**
 * Resolves a photo path and guarantees it stays inside the Photos originals
 * directory (join() would happily escape it given absolute or crafted
 * segments). Returns null for anything outside.
 */
export function getOriginalPhotoPath(directory: string, filename: string): string | null {
  const resolved = resolve(ORIGINALS_PATH, directory, filename);
  if (!resolved.startsWith(ORIGINALS_PATH + sep)) return null;
  return resolved;
}

export async function getPhotoThumbnail(
  directory: string,
  filename: string,
  width: number = 400
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const originalPath = getOriginalPhotoPath(directory, filename);
  if (originalPath === null || !existsSync(originalPath)) return null;

  const hash = createHash('md5').update(`${directory}/${filename}/${width}`).digest('hex');
  const thumbPath = join(THUMB_CACHE_DIR, `${hash}.jpg`);

  if (existsSync(thumbPath)) {
    const buffer = await readFile(thumbPath);
    return { buffer, mimeType: 'image/jpeg' };
  }

  await mkdir(THUMB_CACHE_DIR, { recursive: true });

  try {
    await execFileAsync('sips', [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '80',
      '--resampleWidth', String(width),
      originalPath,
      '--out', thumbPath,
    ]);

    const buffer = await readFile(thumbPath);
    return { buffer, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
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
