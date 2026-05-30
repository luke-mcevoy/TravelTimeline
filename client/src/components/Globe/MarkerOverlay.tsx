import { useEffect, useRef } from 'react';
import { useGlobeStore } from '@/stores/globeStore';
import { useTripStore } from '@/stores/tripStore';
import { flyToDestination } from '@/utils/camera';
import './GlobeView.module.css';

/**
 * Destination markers, positioned in screen space via globe.gl's
 * `getScreenCoords`.
 *
 * We deliberately do NOT use globe.gl's built-in `htmlElementsData` layer: on
 * some GPUs / Retina displays its internal CSS2D projection diverges from the
 * actual rendered globe and flings markers off into space near the limb, even
 * though `getScreenCoords` reports the correct position. So we drive the DOM
 * ourselves from `getScreenCoords` (proven correct) and hide any marker on the
 * far side of the globe using a simple horizon test.
 */
type GlobeLike = {
  getScreenCoords: (lat: number, lng: number, alt: number) => { x: number; y: number };
  pointOfView: () => { lat: number; lng: number; altitude: number };
};

interface MarkerEl {
  wrap: HTMLDivElement;
  dot: HTMLDivElement;
  label: HTMLDivElement;
  lat: number;
  lng: number;
  index: number;
}

const DEG = Math.PI / 180;

export function MarkerOverlay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globe = useGlobeStore((s) => s.globeInstance) as unknown as GlobeLike | null;
  const trips = useTripStore((s) => s.trips);
  const getSorted = useTripStore((s) => s.getSortedDestinations);
  const elsRef = useRef<MarkerEl[]>([]);
  const rafRef = useRef<number>(0);

  // (Re)build the marker DOM whenever the set of destinations changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    const dests = getSorted();
    elsRef.current = dests.map((d, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'globe-marker';
      wrap.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);cursor:pointer;pointer-events:auto;display:none;';
      wrap.title = d.city;
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        const store = useTripStore.getState();
        const g = useGlobeStore.getState().globeInstance;
        store.setAnimation({ isPlaying: false, currentDestinationIndex: i });
        if (g) flyToDestination(g, d);
      });

      const dot = document.createElement('div');
      dot.className = 'globe-dot-marker';
      wrap.appendChild(dot);

      const label = document.createElement('div');
      label.textContent = d.city;
      label.className = 'globe-label globe-label--hover';
      label.style.cssText =
        'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:8px;';
      wrap.appendChild(label);

      container.appendChild(wrap);
      return { wrap, dot, label, lat: d.lat, lng: d.lng, index: i };
    });
  }, [trips, getSorted]);

  // Position every marker each frame from getScreenCoords; hide far-side ones.
  useEffect(() => {
    if (!globe) return;
    const g = globe;
    const loop = () => {
      const pov = g.pointOfView();
      const { animation, getSortedDestinations } = useTripStore.getState();
      const total = getSortedDestinations().length;
      const visibleCount = animation.isPlaying
        ? Math.min(animation.currentDestinationIndex + 1, total)
        : total;
      // A surface point is on the visible near side when the cosine of its
      // angular distance from the sub-camera point exceeds R / cameraDistance.
      const minCos = 1 / (1 + pov.altitude);
      const sinPov = Math.sin(pov.lat * DEG);
      const cosPov = Math.cos(pov.lat * DEG);

      for (const e of elsRef.current) {
        const within = e.index < visibleCount;
        const cosG =
          Math.sin(e.lat * DEG) * sinPov +
          Math.cos(e.lat * DEG) * cosPov * Math.cos((e.lng - pov.lng) * DEG);
        if (!within || cosG <= minCos) {
          e.wrap.style.display = 'none';
          continue;
        }
        const s = g.getScreenCoords(e.lat, e.lng, 0);
        e.wrap.style.left = `${s.x}px`;
        e.wrap.style.top = `${s.y}px`;
        e.wrap.style.display = 'block';
        const active = e.index === animation.currentDestinationIndex;
        e.dot.className = active ? 'globe-pin globe-pin--active' : 'globe-dot-marker';
        e.label.className = active ? 'globe-label' : 'globe-label globe-label--hover';
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [globe]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5 }}
    />
  );
}
