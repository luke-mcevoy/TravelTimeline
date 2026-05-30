import { create } from 'zustand';
import type { GlobeInstance } from 'globe.gl';

interface GlobeStore {
  globeInstance: GlobeInstance | null;
  setGlobeInstance: (g: GlobeInstance | null) => void;
}

export const useGlobeStore = create<GlobeStore>((set) => ({
  globeInstance: null,
  setGlobeInstance: (g) => set({ globeInstance: g }),
}));
