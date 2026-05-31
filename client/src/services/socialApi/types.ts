import type {
  Profile,
  RemotePlace,
  FriendEdge,
  FriendState,
  MyStats,
  LeaderboardMetric,
} from '../socialTypes';

export type { Profile, RemotePlace, FriendEdge, FriendState, MyStats, LeaderboardMetric };

export interface SocialApi {
  mockListDevUsers?(): Profile[];
  mockSignInAs?(userId: string): void;
  mockSignOut?(): void;
  mockCurrentUserId?(): string | null;

  getMyProfile(userId: string): Promise<Profile | null>;
  isHandleAvailable(handle: string, exceptUserId?: string): Promise<boolean>;
  createProfile(input: { id: string; handle: string; displayName: string | null }): Promise<Profile>;
  updateMyStats(userId: string, stats: MyStats): Promise<void>;
  updateAvatar?(userId: string, avatarUrl: string | null): Promise<void>;
  searchProfiles(query: string, selfId: string): Promise<Profile[]>;
  getProfileByHandle?(handle: string): Promise<Profile | null>;

  getLeaderboard(
    scope: 'global' | 'friends',
    metric: LeaderboardMetric,
    selfId: string
  ): Promise<Profile[]>;

  getFriendEdges(selfId: string): Promise<FriendEdge[]>;
  friendStateWith(selfId: string, otherId: string): Promise<FriendState>;
  sendFriendRequest(selfId: string, otherId: string): Promise<void>;
  acceptFriendRequest(selfId: string, requesterId: string): Promise<void>;
  removeFriend(selfId: string, otherId: string): Promise<void>;
  incomingRequestCount?(selfId: string): Promise<number>;

  getPlacesFor(userId: string, viewerId: string): Promise<RemotePlace[]>;
  upsertPlaces(
    userId: string,
    rows: Array<{
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
    }>
  ): Promise<void>;
  prunePlaces(userId: string, keepKeys: Set<string>): Promise<void>;
  uploadHero?(userId: string, placeKey: string, blob: Blob): Promise<string | null>;

  heroUrl(path: string | null | undefined): string | null;
}
