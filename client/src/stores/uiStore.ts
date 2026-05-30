import { create } from 'zustand';

interface UiStore {
  /** Whether the large featured photo card is visible over the globe. */
  showPhotoCard: boolean;
  setShowPhotoCard: (v: boolean) => void;
  togglePhotoCard: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  showPhotoCard: true,
  setShowPhotoCard: (v) => set({ showPhotoCard: v }),
  togglePhotoCard: () => set((s) => ({ showPhotoCard: !s.showPhotoCard })),
}));
