import { create } from 'zustand';

interface UiStore {
  /** Whether the large featured photo card is visible over the globe. */
  showPhotoCard: boolean;
  setShowPhotoCard: (v: boolean) => void;
  togglePhotoCard: () => void;

  /** Whether the current-city name callout is shown on the globe. Dismissed by
   *  tapping empty globe space; re-shown when a city is tapped or playback moves. */
  showCityLabel: boolean;
  setShowCityLabel: (v: boolean) => void;

  /** True while the reel recorder is driving the camera. Keeps the flight arcs
   *  pinned bright (like playback) so the route is always visible in the video. */
  cinematic: boolean;
  setCinematic: (v: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  showPhotoCard: true,
  setShowPhotoCard: (v) => set({ showPhotoCard: v }),
  togglePhotoCard: () => set((s) => ({ showPhotoCard: !s.showPhotoCard })),

  showCityLabel: true,
  setShowCityLabel: (v) => set({ showCityLabel: v }),

  cinematic: false,
  setCinematic: (v) => set({ cinematic: v }),
}));
