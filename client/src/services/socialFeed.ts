import type { FeedItem, Profile, RemotePlace } from './socialTypes';

function pushPlaces(items: FeedItem[], profile: Profile, places: RemotePlace[]): void {
  for (const place of places) {
    const sortDate = place.departure ?? place.arrival;
    if (!sortDate) continue;
    items.push({
      id: `${profile.id}:${place.place_key}`,
      profile,
      place,
      sortDate,
    });
  }
}

/** Build a chronological feed from friends' places (newest first). */
export function buildFeedItems(
  friends: Profile[],
  placesForFriend: (friendId: string) => RemotePlace[]
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const profile of friends) {
    pushPlaces(items, profile, placesForFriend(profile.id));
  }
  return items.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

/** Async variant for real Supabase place fetches. */
export async function buildFeedItemsAsync(
  friends: Profile[],
  placesForFriend: (friendId: string) => Promise<RemotePlace[]>
): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for (const profile of friends) {
    pushPlaces(items, profile, await placesForFriend(profile.id));
  }
  return items.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

export function formatFeedWhen(sortDate: string): string {
  const d = new Date(sortDate);
  if (Number.isNaN(d.getTime())) return sortDate;
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / (86400 * 1000));
  if (days < 1) return 'Recently';
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function placeHeadline(place: RemotePlace): string {
  const city = place.city?.trim();
  const country = place.country?.trim();
  if (city && country) return `${city}, ${country}`;
  return city || country || 'somewhere new';
}
