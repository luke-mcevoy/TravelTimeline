import type { Profile, RemotePlace } from '../socialTypes';

export const MOCK_SESSION_KEY = 'tt_mock_session_user';
export const MOCK_STORE_KEY = 'tt_social_mock_v1';

export interface MockFriendship {
  id: string;
  requester: string;
  addressee: string;
  status: 'pending' | 'accepted';
}

export interface MockStore {
  profiles: Profile[];
  places: RemotePlace[];
  friendships: MockFriendship[];
  /** place_key → small JPEG data URL for hero thumbnails */
  heroData: Record<string, string>;
}

const DEMO_ID = 'mock-user-demo';

type PlaceSeed = Omit<RemotePlace, 'id' | 'user_id'>;

function place(
  userId: string,
  id: string,
  seed: Omit<PlaceSeed, 'user_id'>
): RemotePlace {
  return { ...seed, id, user_id: userId };
}

function statsFromPlaces(places: RemotePlace[]): Pick<
  Profile,
  'countries_count' | 'cities_count' | 'places_count' | 'distance_km' | 'home_country'
> {
  const countries = new Set(places.map((p) => p.country_code).filter(Boolean));
  const cities = new Set(places.map((p) => `${p.city}|${p.country_code}`));
  let distance = 0;
  for (let i = 1; i < places.length; i++) {
    distance += haversine(places[i - 1].lat, places[i - 1].lng, places[i].lat, places[i].lng);
  }
  return {
    countries_count: countries.size,
    cities_count: cities.size,
    places_count: places.length,
    distance_km: Math.round(distance),
    home_country: places[0]?.country_code ?? null,
  };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Tiny solid-color JPEG as a stand-in hero (no network). */
function heroDataUrl(hue: number): string {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    // SSR / tests: minimal 1×1 PNG
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, `hsl(${hue}, 70%, 45%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360}, 80%, 30%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function buildPlaces(): RemotePlace[] {
  const mara: PlaceSeed[] = [
    { place_key: 'JP:35.68,139.69', city: 'Tokyo', country: 'Japan', country_code: 'JP', lat: 35.6762, lng: 139.6503, arrival: '2023-04-10', departure: '2023-04-18', photo_count: 42, hero_path: 'mock/mara/tokyo' },
    { place_key: 'TH:13.75,100.50', city: 'Bangkok', country: 'Thailand', country_code: 'TH', lat: 13.7563, lng: 100.5018, arrival: '2023-05-02', departure: '2023-05-09', photo_count: 31, hero_path: 'mock/mara/bangkok' },
    { place_key: 'FR:48.86,2.35', city: 'Paris', country: 'France', country_code: 'FR', lat: 48.8566, lng: 2.3522, arrival: '2024-06-01', departure: '2024-06-08', photo_count: 55, hero_path: 'mock/mara/paris' },
    { place_key: 'IT:41.90,12.50', city: 'Rome', country: 'Italy', country_code: 'IT', lat: 41.9028, lng: 12.4964, arrival: '2024-06-10', departure: '2024-06-16', photo_count: 38, hero_path: 'mock/mara/rome' },
    { place_key: 'ES:41.39,2.17', city: 'Barcelona', country: 'Spain', country_code: 'ES', lat: 41.3874, lng: 2.1686, arrival: '2024-07-01', departure: '2024-07-07', photo_count: 29, hero_path: 'mock/mara/bcn' },
    { place_key: 'IS:64.15,-21.94', city: 'Reykjavik', country: 'Iceland', country_code: 'IS', lat: 64.1466, lng: -21.9426, arrival: '2024-09-12', departure: '2024-09-19', photo_count: 44, hero_path: 'mock/mara/ice' },
  ];

  const kai: PlaceSeed[] = [
    { place_key: 'US:40.71,-74.01', city: 'New York', country: 'United States', country_code: 'US', lat: 40.7128, lng: -74.006, arrival: '2022-01-05', departure: '2022-01-12', photo_count: 60, hero_path: 'mock/kai/nyc' },
    { place_key: 'US:34.05,-118.24', city: 'Los Angeles', country: 'United States', country_code: 'US', lat: 34.0522, lng: -118.2437, arrival: '2022-02-01', departure: '2022-02-10', photo_count: 48, hero_path: 'mock/kai/la' },
    { place_key: 'AU:-33.87,151.21', city: 'Sydney', country: 'Australia', country_code: 'AU', lat: -33.8688, lng: 151.2093, arrival: '2023-11-03', departure: '2023-11-14', photo_count: 72, hero_path: 'mock/kai/syd' },
    { place_key: 'NZ:-41.29,174.78', city: 'Wellington', country: 'New Zealand', country_code: 'NZ', lat: -41.2865, lng: 174.7762, arrival: '2023-11-16', departure: '2023-11-22', photo_count: 35, hero_path: 'mock/kai/wlg' },
    { place_key: 'ZA:-33.92,18.42', city: 'Cape Town', country: 'South Africa', country_code: 'ZA', lat: -33.9249, lng: 18.4241, arrival: '2024-03-08', departure: '2024-03-18', photo_count: 51, hero_path: 'mock/kai/cpt' },
    { place_key: 'BR:-22.91,-43.17', city: 'Rio de Janeiro', country: 'Brazil', country_code: 'BR', lat: -22.9068, lng: -43.1729, arrival: '2024-08-20', departure: '2024-08-28', photo_count: 40, hero_path: 'mock/kai/rio' },
  ];

  const sam: PlaceSeed[] = [
    { place_key: 'GB:51.51,-0.13', city: 'London', country: 'United Kingdom', country_code: 'GB', lat: 51.5074, lng: -0.1278, arrival: '2023-08-01', departure: '2023-08-08', photo_count: 22, hero_path: 'mock/sam/lon' },
    { place_key: 'NL:52.37,4.90', city: 'Amsterdam', country: 'Netherlands', country_code: 'NL', lat: 52.3676, lng: 4.9041, arrival: '2023-08-10', departure: '2023-08-14', photo_count: 18, hero_path: 'mock/sam/ams' },
    { place_key: 'DE:52.52,13.41', city: 'Berlin', country: 'Germany', country_code: 'DE', lat: 52.52, lng: 13.405, arrival: '2024-01-15', departure: '2024-01-22', photo_count: 26, hero_path: 'mock/sam/ber' },
  ];

  const zoe: PlaceSeed[] = [
    { place_key: 'MX:19.43,-99.13', city: 'Mexico City', country: 'Mexico', country_code: 'MX', lat: 19.4326, lng: -99.1332, arrival: '2023-12-01', departure: '2023-12-09', photo_count: 33, hero_path: 'mock/zoe/mex' },
    { place_key: 'CO:4.71,-74.07', city: 'Bogotá', country: 'Colombia', country_code: 'CO', lat: 4.711, lng: -74.0721, arrival: '2024-02-14', departure: '2024-02-21', photo_count: 27, hero_path: 'mock/zoe/bog' },
    { place_key: 'PE:-13.16,-72.54', city: 'Cusco', country: 'Peru', country_code: 'PE', lat: -13.5319, lng: -71.9675, arrival: '2024-02-23', departure: '2024-03-02', photo_count: 45, hero_path: 'mock/zoe/cusco' },
  ];

  const leo: PlaceSeed[] = [
    { place_key: 'KR:37.57,126.98', city: 'Seoul', country: 'South Korea', country_code: 'KR', lat: 37.5665, lng: 126.978, arrival: '2024-04-05', departure: '2024-04-12', photo_count: 30, hero_path: 'mock/leo/seoul' },
    { place_key: 'SG:1.35,103.82', city: 'Singapore', country: 'Singapore', country_code: 'SG', lat: 1.3521, lng: 103.8198, arrival: '2024-04-14', departure: '2024-04-18', photo_count: 24, hero_path: 'mock/leo/sin' },
    { place_key: 'FR:48.86,2.35', city: 'Paris', country: 'France', country_code: 'FR', lat: 48.8566, lng: 2.3522, arrival: '2024-10-01', departure: '2024-10-06', photo_count: 19, hero_path: 'mock/leo/paris' },
  ];

  const nina: PlaceSeed[] = [
    { place_key: 'EG:30.04,31.24', city: 'Cairo', country: 'Egypt', country_code: 'EG', lat: 30.0444, lng: 31.2357, arrival: '2023-06-10', departure: '2023-06-18', photo_count: 36, hero_path: 'mock/nina/cairo' },
    { place_key: 'MA:31.63,-8.00', city: 'Marrakech', country: 'Morocco', country_code: 'MA', lat: 31.6295, lng: -7.9811, arrival: '2023-06-20', departure: '2023-06-27', photo_count: 28, hero_path: 'mock/nina/marrakech' },
    { place_key: 'PT:38.72,-9.14', city: 'Lisbon', country: 'Portugal', country_code: 'PT', lat: 38.7223, lng: -9.1393, arrival: '2024-05-03', departure: '2024-05-10', photo_count: 32, hero_path: 'mock/nina/lis' },
  ];

  const alex: PlaceSeed[] = [
    { place_key: 'IN:28.61,77.21', city: 'New Delhi', country: 'India', country_code: 'IN', lat: 28.6139, lng: 77.209, arrival: '2024-01-20', departure: '2024-01-28', photo_count: 41, hero_path: 'mock/alex/delhi' },
    { place_key: 'VN:21.03,105.85', city: 'Hanoi', country: 'Vietnam', country_code: 'VN', lat: 21.0278, lng: 105.8342, arrival: '2024-02-05', departure: '2024-02-14', photo_count: 37, hero_path: 'mock/alex/hanoi' },
    { place_key: 'KH:13.36,103.86', city: 'Siem Reap', country: 'Cambodia', country_code: 'KH', lat: 13.3633, lng: 103.8564, arrival: '2024-02-16', departure: '2024-02-22', photo_count: 29, hero_path: 'mock/alex/siem' },
  ];

  const demo: PlaceSeed[] = [
    { place_key: 'US:37.77,-122.42', city: 'San Francisco', country: 'United States', country_code: 'US', lat: 37.7749, lng: -122.4194, arrival: '2023-01-01', departure: '2023-12-31', photo_count: 10, hero_path: 'mock/demo/sf' },
    { place_key: 'CA:43.65,-79.38', city: 'Toronto', country: 'Canada', country_code: 'CA', lat: 43.6532, lng: -79.3832, arrival: '2024-05-01', departure: '2024-05-08', photo_count: 15, hero_path: 'mock/demo/tor' },
    { place_key: 'FR:48.86,2.35', city: 'Paris', country: 'France', country_code: 'FR', lat: 48.8566, lng: 2.3522, arrival: '2024-06-01', departure: '2024-06-06', photo_count: 22, hero_path: 'mock/demo/paris' },
    { place_key: 'JP:35.68,139.69', city: 'Tokyo', country: 'Japan', country_code: 'JP', lat: 35.6762, lng: 139.6503, arrival: '2024-09-10', departure: '2024-09-18', photo_count: 28, hero_path: 'mock/demo/tokyo' },
  ];

  const groups: Array<[string, PlaceSeed[]]> = [
    ['mock-user-mara', mara],
    ['mock-user-kai', kai],
    ['mock-user-sam', sam],
    ['mock-user-zoe', zoe],
    ['mock-user-leo', leo],
    ['mock-user-nina', nina],
    ['mock-user-alex', alex],
    [DEMO_ID, demo],
  ];

  const out: RemotePlace[] = [];
  let n = 0;
  for (const [uid, seeds] of groups) {
    for (const s of seeds) {
      out.push(place(uid, `place-${n++}`, s));
    }
  }
  return out;
}

function buildProfiles(places: RemotePlace[]): Profile[] {
  const byUser = new Map<string, RemotePlace[]>();
  for (const p of places) {
    const list = byUser.get(p.user_id) ?? [];
    list.push(p);
    byUser.set(p.user_id, list);
  }

  const meta: Array<[string, string, string | null, number]> = [
    [DEMO_ID, 'demo_traveler', 'Demo Traveler', 200],
    ['mock-user-mara', 'mara_explorer', 'Mara Chen', 210],
    ['mock-user-kai', 'kai_runs', 'Kai Okonkwo', 220],
    ['mock-user-sam', 'sam_wanders', 'Sam Rivera', 230],
    ['mock-user-zoe', 'zoe_atlas', 'Zoe Martins', 240],
    ['mock-user-leo', 'leo_paths', 'Leo Tanaka', 250],
    ['mock-user-nina', 'nina_globe', 'Nina Berg', 260],
    ['mock-user-alex', 'alex_roam', 'Alex Kim', 270],
  ];

  const bios: Record<string, string> = {
    [DEMO_ID]: 'Bay Area based. Building my honest travel map from every photo I take.',
    'mock-user-mara': 'Slow travel across Asia and Europe — one city at a time.',
    'mock-user-kai': 'Running marathons on every continent I visit.',
    'mock-user-sam': 'Weekend hops around Europe by train.',
    'mock-user-zoe': 'Latin America deep dives — food first, maps second.',
    'mock-user-leo': 'Tech conferences are just an excuse for layovers in new cities.',
    'mock-user-nina': 'Chasing winter sun from Cairo to Lisbon.',
    'mock-user-alex': 'Southeast Asia temple runs and street food.',
  };
  const now = new Date().toISOString();
  return meta.map(([id, handle, display_name, avatarHue]) => {
    const userPlaces = (byUser.get(id) ?? []).sort((a, b) =>
      (a.arrival ?? '').localeCompare(b.arrival ?? '')
    );
    const s = statsFromPlaces(userPlaces);
    return {
      id,
      handle,
      display_name,
      bio: bios[id] ?? null,
      avatar_url: `mock-avatar:${avatarHue}`,
      home_country: s.home_country,
      countries_count: s.countries_count,
      cities_count: s.cities_count,
      places_count: s.places_count,
      distance_km: s.distance_km,
      last_synced_at: now,
    };
  });
}

function buildFriendships(): MockFriendship[] {
  return [
    { id: 'f1', requester: 'mock-user-mara', addressee: DEMO_ID, status: 'accepted' },
    { id: 'f2', requester: 'mock-user-kai', addressee: DEMO_ID, status: 'accepted' },
    { id: 'f3', requester: 'mock-user-sam', addressee: DEMO_ID, status: 'accepted' },
    { id: 'f4', requester: 'mock-user-nina', addressee: DEMO_ID, status: 'pending' },
    { id: 'f5', requester: 'mock-user-alex', addressee: DEMO_ID, status: 'pending' },
    { id: 'f6', requester: DEMO_ID, addressee: 'mock-user-zoe', status: 'pending' },
    { id: 'f7', requester: 'mock-user-mara', addressee: 'mock-user-leo', status: 'accepted' },
    { id: 'f8', requester: 'mock-user-kai', addressee: 'mock-user-zoe', status: 'accepted' },
  ];
}

function buildHeroData(places: RemotePlace[]): Record<string, string> {
  const heroData: Record<string, string> = {};
  let hue = 10;
  for (const p of places) {
    if (p.hero_path) {
      heroData[p.hero_path] = heroDataUrl(hue);
      hue = (hue + 37) % 360;
    }
  }
  return heroData;
}

export function createSeedStore(): MockStore {
  const places = buildPlaces();
  return {
    profiles: buildProfiles(places),
    places,
    friendships: buildFriendships(),
    heroData: buildHeroData(places),
  };
}

export { DEMO_ID };
