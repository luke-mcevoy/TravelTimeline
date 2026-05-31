import { getSocialApi } from './socialApi';
import type { Trip, Destination } from '@/types';

export type {
  Profile,
  RemotePlace,
  FriendState,
  FriendEdge,
  MyStats,
  LeaderboardMetric,
  FeedItem,
  ProfileUpdate,
} from './socialTypes';

const api = () => getSocialApi();

export async function getMyProfile(userId: string) {
  return api().getMyProfile(userId);
}

export async function getProfileByHandle(handle: string) {
  return api().getProfileByHandle?.(handle) ?? null;
}

export async function isHandleAvailable(handle: string, exceptUserId?: string) {
  return api().isHandleAvailable(handle, exceptUserId);
}

export async function createProfile(input: {
  id: string;
  handle: string;
  displayName: string | null;
}) {
  return api().createProfile(input);
}

export async function updateProfile(userId: string, patch: import('./socialTypes').ProfileUpdate) {
  if (!api().updateProfile) throw new Error('Profile updates not supported.');
  return api().updateProfile!(userId, patch);
}

export async function updateMyStats(userId: string, stats: import('./socialTypes').MyStats) {
  return api().updateMyStats(userId, stats);
}

export async function updateAvatar(userId: string, avatarUrl: string | null) {
  if (api().updateAvatar) await api().updateAvatar!(userId, avatarUrl);
}

export async function searchProfiles(query: string, selfId: string) {
  return api().searchProfiles(query, selfId);
}

export async function getFriendsFeed(selfId: string, limit = 40) {
  return api().getFriendsFeed(selfId, limit);
}

export async function getDiscoverProfiles(selfId: string, limit = 24) {
  return api().getDiscoverProfiles(selfId, limit);
}

export async function getLeaderboard(
  scope: 'global' | 'friends',
  metric: import('./socialTypes').LeaderboardMetric,
  selfId: string
) {
  return api().getLeaderboard(scope, metric, selfId);
}

export async function getFriendEdges(selfId: string) {
  return api().getFriendEdges(selfId);
}

export async function friendStateWith(selfId: string, otherId: string) {
  return api().friendStateWith(selfId, otherId);
}

export async function sendFriendRequest(selfId: string, otherId: string) {
  return api().sendFriendRequest(selfId, otherId);
}

export async function acceptFriendRequest(selfId: string, requesterId: string) {
  return api().acceptFriendRequest(selfId, requesterId);
}

export async function removeFriend(selfId: string, otherId: string) {
  return api().removeFriend(selfId, otherId);
}

export async function incomingRequestCount(selfId: string) {
  if (api().incomingRequestCount) return api().incomingRequestCount!(selfId);
  const edges = await getFriendEdges(selfId);
  return edges.filter((e) => e.state === 'pending_in').length;
}

export async function getPlacesFor(userId: string, viewerId: string) {
  return api().getPlacesFor(userId, viewerId);
}

export function heroUrl(path: string | null | undefined): string | null {
  return api().heroUrl(path);
}

export function placesToViewerTrips(places: import('./socialTypes').RemotePlace[]): Trip[] {
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

export function mockListDevUsers() {
  return api().mockListDevUsers?.() ?? [];
}
