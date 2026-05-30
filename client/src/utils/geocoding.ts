export interface GeocodingResult {
  displayName: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country: string;
    country_code: string;
  };
}

export async function searchCities(query: string): Promise<GeocodingResult[]> {
  if (query.length < 2) return [];

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: '8',
    featuretype: 'city',
  });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: { 'User-Agent': 'TravelTimeline/1.0' },
    }
  );

  if (!res.ok) return [];

  const data = (await res.json()) as NominatimResult[];

  return data.map((r) => ({
    displayName: r.display_name,
    city:
      r.address.city ||
      r.address.town ||
      r.address.village ||
      r.address.municipality ||
      r.address.county ||
      r.address.state ||
      '',
    country: r.address.country,
    countryCode: r.address.country_code.toUpperCase(),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}
