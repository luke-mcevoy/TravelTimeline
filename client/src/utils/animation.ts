import type { SortedDestination, GlobeCamera } from '@/types';

export function getDestinationCamera(dest: SortedDestination): GlobeCamera {
  return { lat: dest.lat, lng: dest.lng, altitude: 1.5 };
}

/** Linearly interpolate between two camera positions */
export function lerpCamera(
  from: GlobeCamera,
  to: GlobeCamera,
  t: number
): GlobeCamera {
  const ease = easeInOutCubic(t);
  return {
    lat: from.lat + (to.lat - from.lat) * ease,
    lng: from.lng + (to.lng - from.lng) * ease,
    altitude: from.altitude + (to.altitude - from.altitude) * ease,
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Haversine distance in km */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function totalDistance(destinations: SortedDestination[]): number {
  let total = 0;
  for (let i = 1; i < destinations.length; i++) {
    total += haversineDistance(
      destinations[i - 1].lat,
      destinations[i - 1].lng,
      destinations[i].lat,
      destinations[i].lng
    );
  }
  return total;
}

export function uniqueCountries(destinations: SortedDestination[]): string[] {
  return [...new Set(destinations.map((d) => d.country))];
}

export function uniqueCities(destinations: SortedDestination[]): string[] {
  return [...new Set(destinations.map((d) => `${d.city}, ${d.country}`))];
}
