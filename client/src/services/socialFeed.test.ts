import { describe, expect, it } from 'vitest';
import { buildFeedItems, placeHeadline } from './socialFeed';
import type { Profile, RemotePlace } from './socialTypes';

const friend: Profile = {
  id: 'u1',
  handle: 'traveler',
  display_name: 'T',
  avatar_url: null,
  bio: null,
  home_country: 'US',
  countries_count: 2,
  cities_count: 2,
  places_count: 2,
  distance_km: 100,
  last_synced_at: null,
};

function place(arrival: string, departure: string | null): RemotePlace {
  return {
    id: 'p1',
    user_id: 'u1',
    place_key: 'FR:1,2',
    city: 'Paris',
    country: 'France',
    country_code: 'FR',
    lat: 48.8,
    lng: 2.3,
    arrival,
    departure,
    photo_count: 1,
    hero_path: null,
  };
}

describe('buildFeedItems', () => {
  it('sorts by date descending', () => {
    const items = buildFeedItems([friend], () => [
      place('2024-01-01', '2024-01-05'),
      place('2024-06-01', '2024-06-10'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].sortDate).toBe('2024-06-10');
    expect(items[1].sortDate).toBe('2024-01-05');
  });

  it('skips places with no dates', () => {
    const items = buildFeedItems([friend], () => [place('', null)]);
    expect(items).toHaveLength(0);
  });
});

describe('placeHeadline', () => {
  it('joins city and country', () => {
    expect(placeHeadline(place('2024-01-01', '2024-01-02'))).toBe('Paris, France');
  });
});
