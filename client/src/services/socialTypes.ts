export interface Profile {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  home_country: string | null;
  countries_count: number;
  cities_count: number;
  places_count: number;
  distance_km: number;
  last_synced_at: string | null;
}

export interface RemotePlace {
  id: string;
  user_id: string;
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
}

export type FriendState = 'none' | 'pending_out' | 'pending_in' | 'accepted';

export interface FriendEdge {
  profile: Profile;
  state: FriendState;
}

export interface MyStats {
  countries_count: number;
  cities_count: number;
  places_count: number;
  distance_km: number;
  home_country: string | null;
}

export type LeaderboardMetric = 'countries' | 'distance';

export const PROFILE_COLS =
  'id, handle, display_name, avatar_url, home_country, countries_count, cities_count, places_count, distance_km, last_synced_at';
