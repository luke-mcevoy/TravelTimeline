import { nanoid } from 'nanoid';
import type { Profile, FriendEdge, LeaderboardMetric } from '../socialTypes';
import type { SocialApi } from './types';
import {
  acceptedFriendIds,
  edgeStateForRow,
  friendStateBetween,
} from './friendState';
import { buildFeedItems } from '../socialFeed';
import {
  createSeedStore,
  MOCK_SESSION_KEY,
  MOCK_STORE_KEY,
  type MockStore,
  type MockFriendship,
} from './mockSeed';

let memory: MockStore | null = null;

function loadStore(): MockStore {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(MOCK_STORE_KEY);
    if (raw) {
      memory = JSON.parse(raw) as MockStore;
      for (const prof of memory.profiles) {
        if (prof.bio === undefined) prof.bio = null;
      }
      return memory;
    }
  } catch {
    /* re-seed */
  }
  memory = createSeedStore();
  persist();
  return memory;
}

function persist(): void {
  if (!memory) return;
  localStorage.setItem(MOCK_STORE_KEY, JSON.stringify(memory));
}

function sessionUserId(): string | null {
  return localStorage.getItem(MOCK_SESSION_KEY);
}

function setSession(userId: string | null): void {
  if (userId) localStorage.setItem(MOCK_SESSION_KEY, userId);
  else localStorage.removeItem(MOCK_SESSION_KEY);
}

function canViewPlaces(viewerId: string, ownerId: string, store: MockStore): boolean {
  if (viewerId === ownerId) return true;
  return friendStateBetween(store.friendships, viewerId, ownerId) === 'accepted';
}

function sortProfiles(profiles: Profile[], metric: LeaderboardMetric): Profile[] {
  const col = metric === 'countries' ? 'countries_count' : 'distance_km';
  return [...profiles].sort((a, b) => (b[col] as number) - (a[col] as number));
}

export const mockSocialApi: SocialApi = {
  mockListDevUsers() {
    return loadStore().profiles;
  },

  mockSignInAs(userId: string) {
    setSession(userId);
  },

  mockSignOut() {
    setSession(null);
  },

  mockCurrentUserId() {
    return sessionUserId();
  },

  async getMyProfile(userId) {
    return loadStore().profiles.find((p) => p.id === userId) ?? null;
  },

  async isHandleAvailable(handle, exceptUserId) {
    const h = handle.toLowerCase();
    return !loadStore().profiles.some((p) => p.handle === h && p.id !== exceptUserId);
  },

  async createProfile(input) {
    const store = loadStore();
    const existing = store.profiles.find((p) => p.id === input.id);
    if (existing) return existing;
    const profile: Profile = {
      id: input.id,
      handle: input.handle,
      display_name: input.displayName,
      avatar_url: null,
      bio: null,
      home_country: null,
      countries_count: 0,
      cities_count: 0,
      places_count: 0,
      distance_km: 0,
      last_synced_at: null,
    };
    store.profiles.push(profile);
    persist();
    return profile;
  },

  async updateMyStats(userId, stats) {
    const store = loadStore();
    const p = store.profiles.find((x) => x.id === userId);
    if (!p) return;
    Object.assign(p, stats, { last_synced_at: new Date().toISOString() });
    persist();
  },

  async updateAvatar(userId, avatarUrl) {
    const store = loadStore();
    const p = store.profiles.find((x) => x.id === userId);
    if (!p) return;
    p.avatar_url = avatarUrl;
    persist();
  },

  async searchProfiles(query, selfId) {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return [];
    return loadStore()
      .profiles.filter((p) => p.id !== selfId && p.handle.startsWith(q))
      .slice(0, 20);
  },

  async getProfileByHandle(handle) {
    const h = handle.replace(/^@/, '').toLowerCase();
    return loadStore().profiles.find((p) => p.handle === h) ?? null;
  },

  async getLeaderboard(scope, metric, selfId) {
    const store = loadStore();
    let list = store.profiles;
    if (scope === 'friends') {
      const ids = new Set(acceptedFriendIds(store.friendships, selfId));
      ids.add(selfId);
      list = list.filter((p) => ids.has(p.id));
    }
    return sortProfiles(list, metric).slice(0, 100);
  },

  async getFriendEdges(selfId) {
    const store = loadStore();
    const rows = store.friendships.filter(
      (r) => r.requester === selfId || r.addressee === selfId
    );
    const edges: FriendEdge[] = [];
    for (const r of rows) {
      const otherId = r.requester === selfId ? r.addressee : r.requester;
      const profile = store.profiles.find((p) => p.id === otherId);
      if (!profile) continue;
      edges.push({ profile, state: edgeStateForRow(r, selfId) });
    }
    return edges;
  },

  async friendStateWith(selfId, otherId) {
    return friendStateBetween(loadStore().friendships, selfId, otherId);
  },

  async sendFriendRequest(selfId, otherId) {
    const store = loadStore();
    if (friendStateBetween(store.friendships, selfId, otherId) !== 'none') return;
    const row: MockFriendship = {
      id: `f-${nanoid(8)}`,
      requester: selfId,
      addressee: otherId,
      status: 'pending',
    };
    store.friendships.push(row);
    persist();
  },

  async acceptFriendRequest(selfId, requesterId) {
    const store = loadStore();
    const row = store.friendships.find(
      (r) => r.requester === requesterId && r.addressee === selfId && r.status === 'pending'
    );
    if (row) row.status = 'accepted';
    persist();
  },

  async removeFriend(selfId, otherId) {
    const store = loadStore();
    store.friendships = store.friendships.filter(
      (r) =>
        !(
          (r.requester === selfId && r.addressee === otherId) ||
          (r.requester === otherId && r.addressee === selfId)
        )
    );
    persist();
  },

  async incomingRequestCount(selfId) {
    const edges = await mockSocialApi.getFriendEdges(selfId);
    return edges.filter((e) => e.state === 'pending_in').length;
  },

  async getPlacesFor(userId, viewerId) {
    const store = loadStore();
    if (!canViewPlaces(viewerId, userId, store)) return [];
    return store.places
      .filter((p) => p.user_id === userId)
      .sort((a, b) => (a.arrival ?? '').localeCompare(b.arrival ?? ''));
  },

  async upsertPlaces(userId, rows) {
    const store = loadStore();
    for (const row of rows) {
      const idx = store.places.findIndex(
        (p) => p.user_id === userId && p.place_key === row.place_key
      );
      const base = {
        user_id: userId,
        place_key: row.place_key,
        city: row.city,
        country: row.country,
        country_code: row.country_code,
        lat: row.lat,
        lng: row.lng,
        arrival: row.arrival,
        departure: row.departure,
        photo_count: row.photo_count,
        hero_path: row.hero_path,
      };
      if (idx >= 0) {
        store.places[idx] = { ...store.places[idx], ...base };
      } else {
        store.places.push({ id: `place-${nanoid(8)}`, ...base });
      }
    }
    persist();
  },

  async prunePlaces(userId, keepKeys) {
    const store = loadStore();
    store.places = store.places.filter(
      (p) => p.user_id !== userId || keepKeys.has(p.place_key)
    );
    persist();
  },

  async uploadHero(_userId, placeKey, blob) {
    const store = loadStore();
    const path = `mock/upload/${placeKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    store.heroData[path] = dataUrl;
    persist();
    return path;
  },

  async getFriendsFeed(selfId, limit = 40) {
    const store = loadStore();
    const friends = (await mockSocialApi.getFriendEdges(selfId))
      .filter((e) => e.state === 'accepted')
      .map((e) => e.profile);
    const items = buildFeedItems(friends, (fid) =>
      store.places.filter((pl) => pl.user_id === fid)
    );
    return items.slice(0, limit);
  },

  async getDiscoverProfiles(selfId, limit = 24) {
    const store = loadStore();
    const out: Profile[] = [];
    for (const prof of store.profiles) {
      if (prof.id === selfId) continue;
      const st = friendStateBetween(store.friendships, selfId, prof.id);
      if (st !== 'none') continue;
      out.push(prof);
    }
    return out.sort((a, b) => b.countries_count - a.countries_count).slice(0, limit);
  },

  async updateProfile(userId, patch) {
    const store = loadStore();
    const prof = store.profiles.find((x) => x.id === userId);
    if (!prof) throw new Error('Profile not found');
    if (patch.displayName !== undefined) prof.display_name = patch.displayName;
    if (patch.bio !== undefined) prof.bio = patch.bio;
    persist();
    return prof;
  },

  heroUrl(path) {
    if (!path) return null;
    if (path.startsWith('mock-avatar:')) {
      const hue = Number(path.split(':')[1]) || 200;
      return avatarDataUrl(hue);
    }
    return loadStore().heroData[path] ?? null;
  },
};

function avatarDataUrl(hue: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `hsl(${hue}, 55%, 35%)`;
  ctx.beginPath();
  ctx.arc(48, 48, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `hsl(${hue}, 70%, 75%)`;
  ctx.beginPath();
  ctx.arc(48, 38, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(28, 58, 40, 28);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Reset mock DB to seed data (dev helper). */
export function resetMockStore(): void {
  memory = createSeedStore();
  persist();
}
