/**
 * "Space view" is the far-zoom state where Earth shrinks into the star field.
 * Past a distance threshold we hide the city-to-city flight arcs and instead
 * reveal a single straight beam from Earth toward the Moon, visualising how far
 * the traveller's total distance gets them on the 384,400 km journey.
 *
 * Distances are in three-globe scene units (globe radius = 100). The orbit
 * controls cap the camera at GLOBE_RADIUS * 9 = 900, so the transition window
 * sits comfortably below that.
 */
export const SPACE_VIEW_START = 640;
export const SPACE_VIEW_FULL = 860;

/** 0 while in the normal globe view → 1 once fully in the far "space" view. */
export function spaceFactor(cameraDistance: number): number {
  return Math.max(
    0,
    Math.min(1, (cameraDistance - SPACE_VIEW_START) / (SPACE_VIEW_FULL - SPACE_VIEW_START))
  );
}
