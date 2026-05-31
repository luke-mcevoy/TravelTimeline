import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '../socialConfig';
import type { SocialApi } from './types';
import type { Profile, RemotePlace, FriendEdge } from '../socialTypes';
import { PROFILE_COLS } from '../socialTypes';
import { acceptedFriendIds, edgeStateForRow, friendStateBetween } from './friendState';

interface FriendshipRow {
  id: string;
  requester: string;
  addressee: string;
  status: 'pending' | 'accepted';
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Social backend is not configured.');
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Legacy export for authStore email/Apple flows. */
export const supabase = (): SupabaseClient => getSupabaseClient();

async function myFriendships(sb: SupabaseClient, selfId: string): Promise<FriendshipRow[]> {
  const { data, error } = await sb
    .from('friendships')
    .select('id, requester, addressee, status')
    .or(`requester.eq.${selfId},addressee.eq.${selfId}`);
  if (error) throw error;
  return (data as FriendshipRow[]) ?? [];
}

export const realSupabaseApi: SocialApi = {
  async getMyProfile(userId) {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle();
    if (error) throw error;
    return (data as Profile) ?? null;
  },

  async isHandleAvailable(handle, exceptUserId) {
    const sb = getSupabaseClient();
    let q = sb.from('profiles').select('id').eq('handle', handle);
    if (exceptUserId) q = q.neq('id', exceptUserId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return !data;
  },

  async createProfile(input) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('profiles')
      .insert({ id: input.id, handle: input.handle, display_name: input.displayName })
      .select(PROFILE_COLS)
      .single();
    if (error) throw error;
    return data as Profile;
  },

  async updateMyStats(userId, stats) {
    const sb = getSupabaseClient();
    const { error } = await sb
      .from('profiles')
      .update({ ...stats, last_synced_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
  },

  async updateAvatar(userId, avatarUrl) {
    const sb = getSupabaseClient();
    const { error } = await sb.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId);
    if (error) throw error;
  },

  async searchProfiles(query, selfId) {
    const sb = getSupabaseClient();
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
  },

  async getProfileByHandle(handle) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('handle', handle.replace(/^@/, '').toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return (data as Profile) ?? null;
  },

  async getLeaderboard(scope, metric, selfId) {
    const sb = getSupabaseClient();
    const orderCol = metric === 'countries' ? 'countries_count' : 'distance_km';
    let query = sb.from('profiles').select(PROFILE_COLS).order(orderCol, { ascending: false }).limit(100);
    if (scope === 'friends') {
      const ids = await acceptedFriendIds(await myFriendships(sb, selfId), selfId);
      ids.push(selfId);
      query = sb.from('profiles').select(PROFILE_COLS).in('id', ids).order(orderCol, { ascending: false }).limit(100);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data as Profile[]) ?? [];
  },

  async getFriendEdges(selfId) {
    const sb = getSupabaseClient();
    const rows = await myFriendships(sb, selfId);
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
      edges.push({ profile, state: edgeStateForRow(r, selfId) });
    }
    return edges;
  },

  async friendStateWith(selfId, otherId) {
    const sb = getSupabaseClient();
    return friendStateBetween(await myFriendships(sb, selfId), selfId, otherId);
  },

  async sendFriendRequest(selfId, otherId) {
    const sb = getSupabaseClient();
    const { error } = await sb.from('friendships').insert({ requester: selfId, addressee: otherId });
    if (error) throw error;
  },

  async acceptFriendRequest(selfId, requesterId) {
    const sb = getSupabaseClient();
    const { error } = await sb
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('requester', requesterId)
      .eq('addressee', selfId);
    if (error) throw error;
  },

  async removeFriend(selfId, otherId) {
    const sb = getSupabaseClient();
    const { error } = await sb
      .from('friendships')
      .delete()
      .or(
        `and(requester.eq.${selfId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${selfId})`
      );
    if (error) throw error;
  },

  async incomingRequestCount(selfId) {
    const edges = await realSupabaseApi.getFriendEdges(selfId);
    return edges.filter((e) => e.state === 'pending_in').length;
  },

  async getPlacesFor(userId, viewerId) {
    const sb = getSupabaseClient();
    const state = await realSupabaseApi.friendStateWith(viewerId, userId);
    if (viewerId !== userId && state !== 'accepted') return [];
    const { data, error } = await sb
      .from('places')
      .select('*')
      .eq('user_id', userId)
      .order('arrival', { ascending: true });
    if (error) throw error;
    return (data as RemotePlace[]) ?? [];
  },

  async upsertPlaces(userId, rows) {
    const sb = getSupabaseClient();
    const payload = rows.map((r) => ({ ...r, user_id: userId }));
    const { error } = await sb.from('places').upsert(payload, { onConflict: 'user_id,place_key' });
    if (error) throw error;
  },

  async prunePlaces(userId, keepKeys) {
    const sb = getSupabaseClient();
    const { data: existing } = await sb.from('places').select('id, place_key').eq('user_id', userId);
    const staleIds = (existing ?? [])
      .filter((r) => !keepKeys.has(r.place_key as string))
      .map((r) => r.id as string);
    if (staleIds.length > 0) {
      await sb.from('places').delete().in('id', staleIds);
    }
  },

  async uploadHero(userId, placeKey, blob) {
    const sb = getSupabaseClient();
    const path = `${userId}/${placeKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
    const { error } = await sb.storage.from('heroes').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) return null;
    return path;
  },

  heroUrl(path) {
    if (!path) return null;
    return getSupabaseClient().storage.from('heroes').getPublicUrl(path).data.publicUrl;
  },
};
