import type { Trip } from '@/types';

const GUEST_KEY = 'travel-timeline-trips';

function tripsKey(ownerId: string | null): string {
  return ownerId ? `${GUEST_KEY}:${ownerId}` : GUEST_KEY;
}

export function loadTrips(ownerId: string | null = null): Trip[] {
  try {
    const raw = localStorage.getItem(tripsKey(ownerId));
    if (!raw) return [];
    return JSON.parse(raw) as Trip[];
  } catch {
    return [];
  }
}

export function saveTrips(trips: Trip[], ownerId: string | null = null): void {
  localStorage.setItem(tripsKey(ownerId), JSON.stringify(trips));
}

export function exportTripsToJson(trips: Trip[]): void {
  const blob = new Blob([JSON.stringify(trips, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `travel-timeline-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importTripsFromJson(file: File): Promise<Trip[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const trips = JSON.parse(reader.result as string) as Trip[];
        resolve(trips);
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
