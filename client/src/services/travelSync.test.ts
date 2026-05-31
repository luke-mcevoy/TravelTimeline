import { describe, expect, it } from 'vitest';
import { placeKey } from './travelSync';
import type { SortedDestination } from '@/types';

function dest(partial: Partial<SortedDestination> & Pick<SortedDestination, 'lat' | 'lng'>): SortedDestination {
  return {
    id: '1',
    tripId: 't',
    tripName: 'T',
    city: 'X',
    country: 'Y',
    countryCode: partial.countryCode ?? 'US',
    arrivalDate: '2024-01-01',
    departureDate: '2024-01-02',
    ...partial,
  };
}

describe('placeKey', () => {
  it('rounds lat/lng and prefixes country code', () => {
    const k = placeKey(dest({ lat: 37.774926, lng: -122.419416, countryCode: 'US' }));
    expect(k).toBe('US:37.77,-122.42');
  });

  it('uses XX when country code missing', () => {
    const k = placeKey(dest({ lat: 0, lng: 0, countryCode: '' }));
    expect(k.startsWith('XX:')).toBe(true);
  });
});
