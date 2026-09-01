import { createRequire } from 'module';
import bplist from 'bplist-parser';

// Lazy: `coordinate_to_country` pulls in a 46 MB maritime-borders GeoJSON.
// Parsed, that is hundreds of MB — enough to OOM a 512 MB cloud instance if
// it loads at boot. Only require it the first time a Mac photo import needs
// the offline fallback.
const require = createRequire(import.meta.url);
type CountryLookup = (
  lat: number,
  lng: number,
  options?: { format?: 'alpha2' | 'alpha3' | 'numeric' }
) => string[];
let countryLookup: CountryLookup | null = null;
function coordinateToCountry(
  lat: number,
  lng: number,
  options?: { format?: 'alpha2' | 'alpha3' | 'numeric' }
): string[] {
  if (!countryLookup) {
    countryLookup = require('coordinate_to_country') as CountryLookup;
  }
  return countryLookup(lat, lng, options);
}

/**
 * Resolves the country a photo was taken in, as accurately as Apple Photos
 * itself. Two sources, in priority order:
 *
 *   1. Apple's own on-device reverse geocode, stored per photo in
 *      ZADDITIONALASSETATTRIBUTES.ZREVERSELOCATIONDATA. This is the EXACT
 *      country the user sees in the Photos app — it correctly handles coastal,
 *      island and border locations that trip up coarse polygon lookups.
 *   2. An offline point-in-polygon fallback (`coordinate_to_country`) for the
 *      minority of photos Apple never reverse-geocoded (e.g. old imports).
 *
 * Everything runs locally — no network, no API keys.
 */

// ─── Apple reverse-geo blob (NSKeyedArchiver bplist) ──────────────────

type UidRef = { UID: number };
function isUid(v: unknown): v is UidRef {
  return typeof v === 'object' && v !== null && 'UID' in v;
}

/**
 * Resolves an NSKeyedArchiver `$objects` graph into a plain object, following
 * UID references. Apple serializes `PLRevGeoLocationInfo` this way.
 */
function unarchive(archive: {
  $objects: unknown[];
  $top: { root: UidRef };
}): Record<string, unknown> | null {
  const objects = archive.$objects;
  const seen = new Map<number, unknown>();

  const resolve = (node: unknown): unknown => {
    if (isUid(node)) {
      const i = node.UID;
      if (seen.has(i)) return seen.get(i);
      return build(objects[i], i);
    }
    return node;
  };

  const build = (raw: unknown, i: number): unknown => {
    if (raw === '$null') return null;
    if (raw === null || typeof raw !== 'object') return raw;
    const o = raw as Record<string, unknown>;

    if (o['NS.keys'] && o['NS.objects']) {
      const dict: Record<string, unknown> = {};
      seen.set(i, dict);
      const keys = o['NS.keys'] as unknown[];
      const vals = o['NS.objects'] as unknown[];
      keys.forEach((k, j) => {
        dict[String(resolve(k))] = resolve(vals[j]);
      });
      return dict;
    }
    if (o['NS.objects']) {
      const arr: unknown[] = [];
      seen.set(i, arr);
      (o['NS.objects'] as unknown[]).forEach((e) => arr.push(resolve(e)));
      return arr;
    }
    // A custom class (e.g. PLRevGeoLocationInfo): resolve each property.
    const dict: Record<string, unknown> = {};
    seen.set(i, dict);
    for (const k of Object.keys(o)) {
      if (k === '$class') continue;
      dict[k] = resolve(o[k]);
    }
    return dict;
  };

  const root = resolve(archive.$top.root);
  return root && typeof root === 'object' ? (root as Record<string, unknown>) : null;
}

/** Extracts the ISO alpha-2 country code from Apple's reverse-geo blob. */
export function countryCodeFromAppleBlob(blob: Buffer): string | null {
  try {
    const parsed = bplist.parseBuffer(blob);
    const archive = parsed[0] as { $objects: unknown[]; $top: { root: UidRef } };
    const root = unarchive(archive);
    const code = root?.countryCode;
    if (typeof code === 'string' && code.length === 2) return code.toUpperCase();
  } catch {
    /* fall through */
  }
  return null;
}

// ─── Offline polygon fallback (cached by ~11km grid cell) ─────────────

const pointCache = new Map<string, string | null>();

/** Offline ISO alpha-2 country for a coordinate; cached per coarse grid cell. */
export function countryCodeForPoint(lat: number, lng: number): string | null {
  const key = `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
  const hit = pointCache.get(key);
  if (hit !== undefined) return hit;
  let code: string | null = null;
  try {
    const res = coordinateToCountry(lat, lng, { format: 'alpha2' });
    if (Array.isArray(res) && res[0]) code = res[0].toUpperCase();
  } catch {
    /* leave null */
  }
  pointCache.set(key, code);
  return code;
}

// ─── ISO code → display name ──────────────────────────────────────────

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** A few names shortened/cleaned for travel-card display. */
const NAME_OVERRIDES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CZ: 'Czech Republic',
  RU: 'Russia',
  KR: 'South Korea',
  VN: 'Vietnam',
  VA: 'Vatican City',
};

/** Friendly country name for an ISO alpha-2 code (e.g. "FR" → "France"). */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  if (NAME_OVERRIDES[upper]) return NAME_OVERRIDES[upper];
  try {
    return regionNames.of(upper) ?? '';
  } catch {
    return '';
  }
}
