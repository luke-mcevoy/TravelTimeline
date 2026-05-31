// Offline, on-device country resolution for the native app. Mirrors the
// server's geo.ts but runs entirely in the WKWebView: a point-in-polygon
// lookup against a slimmed copy of the maritime_10m borders dataset (shipped
// as a static asset and parsed once, lazily, on first use).
//
// @ts-expect-error - no bundled types for this CJS package
import GeoJsonGeometriesLookup from 'geojson-geometries-lookup';

interface Lookup {
  getContainers(geometry: { type: 'Point'; coordinates: [number, number] }): {
    features: Array<{ properties: { isoA2?: string } }>;
  };
}

let lookup: Lookup | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads + indexes the borders dataset once. Heavy (~37MB JSON parse) but only
 * paid the first time an import resolves countries; the index is then reused.
 */
export async function initGeocoder(): Promise<void> {
  if (lookup) return;
  if (!loading) {
    loading = (async () => {
      const res = await fetch('geo/borders.geo.json');
      if (!res.ok) throw new Error('Could not load borders dataset');
      const geo = await res.json();
      lookup = new GeoJsonGeometriesLookup(geo) as Lookup;
    })();
  }
  await loading;
}

const pointCache = new Map<string, string | null>();

/** Offline ISO alpha-2 country for a coordinate; cached per ~11km grid cell. */
export function countryCodeForPoint(lat: number, lng: number): string | null {
  if (!lookup) return null;
  const key = `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
  const hit = pointCache.get(key);
  if (hit !== undefined) return hit;

  let code: string | null = null;
  try {
    const res = lookup.getContainers({ type: 'Point', coordinates: [lng, lat] });
    const a2 = res.features[0]?.properties?.isoA2;
    if (a2 && a2.length === 2) code = a2.toUpperCase();
  } catch {
    /* leave null */
  }
  pointCache.set(key, code);
  return code;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

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
