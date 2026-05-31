import { requireSupabase, supabase } from './supabase';
import type { Trip, Destination } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────

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

const PROFILE_COLS =
  'id, handle, display_name, avatar_url, home_country, countries_count, cities_count, places_count, distance_km, last_synced_at';

// ─── Profile ─────────────────────────────────────────────────────────

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export async function isHandleAvailable(handle: string): Promise<boolean> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('profiles').select('id').eq('handle', handle).maybeSingle();
  if (error) throw error;
  return !data;
}

export async function createProfile(input: {
  id: string;
  handle: string;
  displayName: string | null;
}): Promise<Profile> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('profiles')
    .insert({ id: input.id, handle: input.handle, display_name: input.displayName })
    .select(PROFILE_COLS)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateMyStats(userId: string, stats: MyStats): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('profiles')
    .update({ ...stats, last_synced_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

export async function searchProfiles(query: string, selfId: string): Promise<Profile[]> {
  const sb = requireSupabase();
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return [];
  const { data, error } = await sb
    .from('profiles')
    .select(PROFILE_COLS)
    .ilike('handle', `${q}%`)
    .neq('id', selfId)
    .limit(20);
  if (error) throw error;
  return (data as Profile[]) ?? [];
}

// ─── Leaderboard ─────────────────────────────────────────────────────

export type LeaderboardMetric = 'countries' | 'distance';

export async function getLeaderboard(
  scope: 'global' | 'friends',
  metric: LeaderboardMetric,
  selfId: string
): Promise<Profile[]> {
  const sb = requireSupabase();
  const orderCol = metric === 'countries' ? 'countries_count' : 'distance_km';

  let query = sb.from('profiles').select(PROFILE_COLS).order(orderCol, { ascending: false }).limit(100);

  if (scope === 'friends') {
    const ids = await acceptedFriendIds(selfId);
    ids.push(selfId); // include myself in the friends board
    query = sb
      .from('profiles')
      .select(PROFILE_COLS)
      .in('id', ids)
      .order(orderCol, { ascending: false })
      .limit(100);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as Profile[]) ?? [];
}

// ─── Friends ─────────────────────────────────────────────────────────

interface FriendshipRow {
  id: string;
  requester: string;
  addressee: string;
  status: 'pending' | 'accepted';
}

async function myFriendships(selfId: string): Promise<FriendshipRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('friendships')
    .select('id, requester, addressee, status')
    .or(`requester.eq.${selfId},addressee.eq.${selfId}`);
  if (error) throw error;
  return (data as FriendshipRow[]) ?? [];
}

async function acceptedFriendIds(selfId: string): Promise<string[]> {
  const rows = await myFriendships(selfId);
  return rows
    .filter((r) => r.status === 'accepted')
    .map((r) => (r.requester === selfId ? r.addressee : r.requester));
}

/** Returns friend edges grouped by state, with the other person's profile. */
export async function getFriendEdges(selfId: string): Promise<FriendEdge[]> {
  const sb = requireSupabase();
  const rows = await myFriendships(selfId);
  if (rows.length === 0) return [];

  const otherIds = rows.map((r) => (r.requester === selfId ? r.addressee : r.requester));
  const { data, error } = await sb.from('profiles').select(PROFILE_COLS).in('id', otherIds);
  if (error) throw error;
  const profiles = new Map((data as Profile[]).map((p) => [p.id, p]));

  const edges: FriendEdge[] = [];
  for (const r of rows) {
    const otherId = r.requester === selfId ? r.addressee : r.requester;
    const profile = profiles.get(otherId);
    if (!profile) continue;
    let state: FriendState;
    if (r.status === 'accepted') state = 'accepted';
    else state = r.requester === selfId ? 'pending_out' : 'pending_in';
    edges.push({ profile, state });
  }
  return edges;
}

export async function friendStateWith(selfId: string, otherId: string): Promise<FriendState> {
  const rows = await myFriendships(selfId);
  const r = rows.find(
    (x) =>
      (x.requester === selfId && x.addressee === otherId) ||
      (x.requester === otherId && x.addressee === selfId)
  );
  if (!r) return 'none';
  if (r.status === 'accepted') return 'accepted';
  return r.requester === selfId ? 'pending_out' : 'pending_in';
}

export async function sendFriendRequest(selfId: string, otherId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('friendships').insert({ requester: selfId, addressee: otherId });
  if (error) throw error;
}

export async function acceptFriendRequest(selfId: string, requesterId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('requester', requesterId)
    .eq('addressee', selfId);
  if (error) throw error;
}

export async function removeFriend(selfId: string, otherId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('friendships')
    .delete()
    .or(
      `and(requester.eq.${selfId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${selfId})`
    );
  if (error) throw error;
}

// ─── Places (a user's travel history) ────────────────────────────────

export async function getPlacesFor(userId: string): Promise<RemotePlace[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('places')
    .select('*')
    .eq('user_id', userId)
    .order('arrival', { ascending: true });
  if (error) throw error;
  return (data as RemotePlace[]) ?? [];
}

/** Public URL for a hero thumbnail stored in the 'heroes' bucket. */
export function heroUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) return null;
  return supabase.storage.from('heroes').getPublicUrl(path).data.publicUrl;
}

/**
 * Adapts a friend's remote places into the local Trip shape so the existing
 * globe/HUD can render them unchanged via the trip store's viewer mode.
 */
export function placesToViewerTrips(places: RemotePlace[]): Trip[] {
  const now = new Date().toISOString();
  const destinations: Destination[] = places.map((p) => ({
    id: p.id,
    city: p.city ?? '',
    country: p.country ?? '',
    countryCode: p.country_code ?? '',
    lat: p.lat,
    lng: p.lng,
    arrivalDate: p.arrival ?? now.slice(0, 10),
    departureDate: p.departure ?? p.arrival ?? now.slice(0, 10),
    serverPhotos: [],
    heroUrl: heroUrl(p.hero_path) ?? undefined,
  }));
  return [{ id: 'viewer', name: 'Travels', destinations, createdAt: now, updatedAt: now }];
}
