// Offline, on-device city resolution for the native app. Apple's CLGeocoder is
// hard rate-limited (it throttles for ~a minute after a short burst), so on iOS
// most places ended up labelled with only their country. Instead we ship a slim
// GeoNames dataset (cities ≥5,000 people) as a static asset and find the nearest
// city to a coordinate locally — instant, reliable, and network-free, matching
// the quality the web build gets from Apple's pre-computed moment titles.

// Each row is a compact tuple: [name, lat, lng, ISO-alpha2 country code].
type CityRow = [string, number, number, string];

let cities: CityRow[] | null = null;
let loading: Promise<void> | null = null;

/** Loads + parses the cities dataset once (lazily, on first use). ~2.4MB JSON. */
export async function initCityDb(): Promise<void> {
  if (cities) return;
  if (!loading) {
    loading = (async () => {
      const res = await fetch('geo/cities5000.json');
      if (!res.ok) throw new Error('Could not load cities dataset');
      cities = (await res.json()) as CityRow[];
    })();
  }
  await loading;
}

const DEG = Math.PI / 180;
// Beyond this, the "nearest" city is too far to be a meaningful label (e.g. a
// photo in the open ocean or deep wilderness) — leave it country-only instead.
const MAX_KM = 200;

export interface NearestCity {
  name: string;
  countryCode: string;
  km: number;
}

/**
 * Nearest populated city to a coordinate, or null if the dataset isn't loaded
 * or nothing sits within MAX_KM. Brute-force over ~69k points: trivially fast
 * for the few dozen destinations in a trip, so no spatial index is needed.
 */
export function nearestCity(lat: number, lng: number): NearestCity | null {
  if (!cities || cities.length === 0) return null;
  const cosLat = Math.cos(lat * DEG);
  let best = Infinity;
  let bi = -1;
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    const dLat = c[1] - lat;
    let dLng = c[2] - lng;
    if (dLng > 180) dLng -= 360;
    else if (dLng < -180) dLng += 360;
    // Equirectangular approximation — accurate enough for picking the closest
    // city, and far cheaper than haversine across the whole table.
    const x = dLng * cosLat;
    const d2 = x * x + dLat * dLat;
    if (d2 < best) {
      best = d2;
      bi = i;
    }
  }
  if (bi < 0) return null;
  const km = Math.sqrt(best) * 111; // ~111 km per degree
  if (km > MAX_KM) return null;
  const c = cities[bi];
  return { name: c[0], countryCode: c[3], km };
}
