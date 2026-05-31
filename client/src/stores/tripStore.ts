import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Trip, Destination, AnimationState, SortedDestination } from '@/types';
import { loadTrips, saveTrips } from '@/utils/storage';

export interface ViewingProfile {
  handle: string;
  displayName: string | null;
}

interface TripStore {
  trips: Trip[];
  selectedTripId: string | null;
  animation: AnimationState;

  /** When set, the globe/HUD render this friend's trips instead of the user's
   *  own. Not persisted; clearing it returns to the user's own data. */
  viewing: ViewingProfile | null;
  viewerTrips: Trip[] | null;
  viewProfile: (profile: ViewingProfile, trips: Trip[]) => void;
  exitViewer: () => void;

  // Trip CRUD
  addTrip: (name: string) => string;
  updateTrip: (id: string, updates: Partial<Pick<Trip, 'name'>>) => void;
  deleteTrip: (id: string) => void;
  setTrips: (trips: Trip[]) => void;
  selectTrip: (id: string | null) => void;

  // Destination CRUD
  addDestination: (tripId: string, destination: Omit<Destination, 'id'>) => void;
  updateDestination: (tripId: string, destId: string, updates: Partial<Destination>) => void;
  removeDestination: (tripId: string, destId: string) => void;
  reorderDestinations: (tripId: string, fromIndex: number, toIndex: number) => void;

  // Animation
  setAnimation: (updates: Partial<AnimationState>) => void;
  resetAnimation: () => void;

  // Computed
  getSortedDestinations: () => SortedDestination[];
  getSelectedTrip: () => Trip | undefined;
}

const defaultAnimation: AnimationState = {
  isPlaying: false,
  speed: 1,
  currentTime: 0,
  currentDestinationIndex: 0,
  arcProgress: 0,
};

function persist(trips: Trip[]) {
  saveTrips(trips);
}

/**
 * Guards against bad geotags reaching the globe. Apple's "no location" sentinel
 * (-180, -180) renders on the equator in globe.gl, producing a row of ocean
 * dots; we drop anything out of valid range or sitting on null island.
 */
function hasValidCoords(d: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(d.lat) &&
    Number.isFinite(d.lng) &&
    d.lat >= -90 &&
    d.lat <= 90 &&
    d.lng >= -180 &&
    d.lng <= 180 &&
    !(Math.abs(d.lat) < 0.01 && Math.abs(d.lng) < 0.01)
  );
}

export const useTripStore = create<TripStore>((set, get) => ({
  trips: loadTrips(),
  selectedTripId: null,
  animation: { ...defaultAnimation },
  viewing: null,
  viewerTrips: null,

  viewProfile: (profile, trips) =>
    set({ viewing: profile, viewerTrips: trips, animation: { ...defaultAnimation } }),

  exitViewer: () => set({ viewing: null, viewerTrips: null, animation: { ...defaultAnimation } }),

  addTrip: (name: string) => {
    const id = nanoid();
    const now = new Date().toISOString();
    const trip: Trip = {
      id,
      name,
      destinations: [],
      createdAt: now,
      updatedAt: now,
    };
    set((state) => {
      const trips = [...state.trips, trip];
      persist(trips);
      return { trips, selectedTripId: id };
    });
    return id;
  },

  updateTrip: (id, updates) => {
    set((state) => {
      const trips = state.trips.map((t) =>
        t.id === id
          ? { ...t, ...updates, updatedAt: new Date().toISOString() }
          : t
      );
      persist(trips);
      return { trips };
    });
  },

  deleteTrip: (id) => {
    set((state) => {
      const trips = state.trips.filter((t) => t.id !== id);
      persist(trips);
      return {
        trips,
        selectedTripId: state.selectedTripId === id ? null : state.selectedTripId,
      };
    });
  },

  setTrips: (trips) => {
    persist(trips);
    set({ trips });
  },

  selectTrip: (id) => set({ selectedTripId: id }),

  addDestination: (tripId, destination) => {
    set((state) => {
      const trips = state.trips.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          destinations: [...t.destinations, { ...destination, id: nanoid() }],
          updatedAt: new Date().toISOString(),
        };
      });
      persist(trips);
      return { trips };
    });
  },

  updateDestination: (tripId, destId, updates) => {
    set((state) => {
      const trips = state.trips.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          destinations: t.destinations.map((d) =>
            d.id === destId ? { ...d, ...updates } : d
          ),
          updatedAt: new Date().toISOString(),
        };
      });
      persist(trips);
      return { trips };
    });
  },

  removeDestination: (tripId, destId) => {
    set((state) => {
      const trips = state.trips.map((t) => {
        if (t.id !== tripId) return t;
        return {
          ...t,
          destinations: t.destinations.filter((d) => d.id !== destId),
          updatedAt: new Date().toISOString(),
        };
      });
      persist(trips);
      return { trips };
    });
  },

  reorderDestinations: (tripId, fromIndex, toIndex) => {
    set((state) => {
      const trips = state.trips.map((t) => {
        if (t.id !== tripId) return t;
        const dests = [...t.destinations];
        const [moved] = dests.splice(fromIndex, 1);
        dests.splice(toIndex, 0, moved);
        return { ...t, destinations: dests, updatedAt: new Date().toISOString() };
      });
      persist(trips);
      return { trips };
    });
  },

  setAnimation: (updates) => {
    set((state) => ({
      animation: { ...state.animation, ...updates },
    }));
  },

  resetAnimation: () => {
    set({ animation: { ...defaultAnimation } });
  },

  getSortedDestinations: () => {
    const { trips, viewerTrips } = get();
    const source = viewerTrips ?? trips;
    const all: SortedDestination[] = [];
    for (const trip of source) {
      for (const dest of trip.destinations) {
        if (!hasValidCoords(dest)) continue;
        all.push({ ...dest, tripId: trip.id, tripName: trip.name });
      }
    }
    all.sort(
      (a, b) =>
        new Date(a.arrivalDate).getTime() - new Date(b.arrivalDate).getTime()
    );
    return all;
  },

  getSelectedTrip: () => {
    const { trips, selectedTripId } = get();
    return trips.find((t) => t.id === selectedTripId);
  },
}));
