import type { GlobeInstance } from 'globe.gl';

/**
 * Cinematic camera flight across the globe.
 *
 * Instead of skimming straight across the surface at a low altitude (which is
 * fast, close, and nauseating on big jumps), we fly a smooth ARC: pull the
 * camera up, travel along the great circle, then settle back down — like a
 * plane taking off and landing. The higher you pull up, the more ground you can
 * cover calmly, so the lift scales with the distance of the jump. Short hops
 * barely rise; cross-globe jumps rise to a near-full-globe view before coming
 * back in.
 *
 * We tween it ourselves frame-by-frame (great-circle slerp for position, a sine
 * hump for altitude) so the whole move is one continuous, smooth motion with no
 * mid-flight pause.
 */

/** Altitude we settle at when "arrived" — wide enough to feel calm, not glued to the ground. */
export const REST_ALTITUDE = 0.55;

const toRad = Math.PI / 180;
const toDeg = 180 / Math.PI;

type Vec3 = [number, number, number];

function toVec(lat: number, lng: number): Vec3 {
  const phi = lat * toRad;
  const lam = lng * toRad;
  return [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
}

function fromVec([x, y, z]: Vec3): { lat: number; lng: number } {
  return { lat: Math.atan2(z, Math.hypot(x, y)) * toDeg, lng: Math.atan2(y, x) * toDeg };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Great-circle separation between two lat/lng points, in degrees (0..180). */
function angularDistanceDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * toDeg;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// One flight at a time; a new call cancels the previous tween.
let activeRaf = 0;

export interface FlyOptions {
  /** Playback speed multiplier (higher = faster). */
  speed?: number;
}

/**
 * Flies the camera to a target lat/lng along a smooth arc.
 * Returns the flight duration in ms (so callers can schedule what comes next).
 */
export function flyToDestination(
  globe: GlobeInstance,
  target: { lat: number; lng: number },
  options: FlyOptions = {}
): number {
  const speed = options.speed ?? 1;
  cancelAnimationFrame(activeRaf);

  const start = globe.pointOfView();
  const startAlt = start.altitude ?? REST_ALTITUDE;
  const dist = angularDistanceDeg(start.lat, start.lng, target.lat, target.lng);

  // Slower than a straight skim, and scaled to distance so far jumps get time
  // to breathe. Cross-globe tops out around 3.4s (before the speed multiplier).
  const duration = clamp(1200 + dist * 13, 1200, 3400) / speed;

  // How high to crest mid-flight. Tiny hops barely lift; antipodal jumps pull
  // back to a near-global view before descending.
  const peak = Math.max(startAlt, REST_ALTITUDE) + (dist / 180) * 1.9;
  const hump = peak - Math.max(startAlt, REST_ALTITUDE);

  const p0 = toVec(start.lat, start.lng);
  const p1 = toVec(target.lat, target.lng);
  const omega = Math.acos(clamp(p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2], -1, 1));

  const begin = performance.now();

  const tick = (now: number) => {
    const raw = clamp((now - begin) / duration, 0, 1);
    const e = easeInOut(raw);

    let lat: number;
    let lng: number;
    if (omega < 1e-6) {
      lat = target.lat;
      lng = target.lng;
    } else {
      const s0 = Math.sin((1 - e) * omega) / Math.sin(omega);
      const s1 = Math.sin(e * omega) / Math.sin(omega);
      ({ lat, lng } = fromVec([
        p0[0] * s0 + p1[0] * s1,
        p0[1] * s0 + p1[1] * s1,
        p0[2] * s0 + p1[2] * s1,
      ]));
    }

    const base = startAlt + (REST_ALTITUDE - startAlt) * e;
    const altitude = base + Math.sin(Math.PI * e) * hump;

    globe.pointOfView({ lat, lng, altitude }, 0);

    if (raw < 1) activeRaf = requestAnimationFrame(tick);
  };

  activeRaf = requestAnimationFrame(tick);
  return duration;
}
