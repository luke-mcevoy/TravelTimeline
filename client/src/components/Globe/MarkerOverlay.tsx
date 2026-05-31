import { useEffect, useRef } from 'react';
import { useGlobeStore } from '@/stores/globeStore';
import { useTripStore } from '@/stores/tripStore';
import { useUiStore } from '@/stores/uiStore';
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
  onGlobeClick: (cb: ((coords: { lat: number; lng: number }) => void) | null) => void;
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
  const currentIndex = useTripStore((s) => s.animation.currentDestinationIndex);
  const elsRef = useRef<MarkerEl[]>([]);
  const rafRef = useRef<number>(0);

  // Whenever the active city changes (playback advances, scrub, or a marker tap)
  // surface its name callout again — even if the user had dismissed the prior one.
  useEffect(() => {
    useUiStore.getState().setShowCityLabel(true);
  }, [currentIndex]);

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
      const goToCity = (e: Event) => {
        e.stopPropagation();
        const store = useTripStore.getState();
        const g = useGlobeStore.getState().globeInstance;
        store.setAnimation({ isPlaying: false, currentDestinationIndex: i });
        // Make sure the photo + name surface even if they were dismissed.
        useUiStore.getState().setShowPhotoCard(true);
        useUiStore.getState().setShowCityLabel(true);
        if (g) flyToDestination(g, d);
      };
      wrap.addEventListener('click', goToCity);

      // Invisible, finger-sized hit target so the tiny dot is easy to tap on a
      // phone (Apple HIG ~44px). The visible dot/pin sits centered on top.
      const hit = document.createElement('div');
      hit.style.cssText =
        'position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%);border-radius:50%;';
      wrap.appendChild(hit);

      const dot = document.createElement('div');
      dot.className = 'globe-dot-marker';
      wrap.appendChild(dot);

      // A single HUD callout — shown ONLY for the city we're currently on, so
      // the globe never gets cluttered with every place name at once. Styled
      // inline (Palantir-style: clipped corner, cyan hairline, mono type) so it
      // doesn't depend on CSS-module class extraction.
      const label = document.createElement('div');
      label.className = 'globe-label';
      label.style.cssText = [
        'position:absolute',
        'bottom:100%',
        'left:50%',
        'transform:translateX(-50%)',
        'margin-bottom:14px',
        'display:none',
        'flex-direction:column',
        'align-items:flex-start',
        'gap:2px',
        'padding:6px 13px 6px 12px',
        'white-space:nowrap',
        'pointer-events:none',
        'background:rgba(6,11,18,0.8)',
        '-webkit-backdrop-filter:blur(8px)',
        'backdrop-filter:blur(8px)',
        'border:1px solid rgba(56,225,255,0.4)',
        'border-left:2px solid #38e1ff',
        'clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)',
        'box-shadow:0 0 18px rgba(56,225,255,0.22),0 4px 16px rgba(0,0,0,0.6)',
      ].join(';');

      const city = document.createElement('span');
      // Some places have no resolved city (e.g. remote/island GPS) — fall back to
      // the country so the banner is never blank.
      city.textContent = d.city || d.country || 'Unknown';
      city.style.cssText =
        'font-family:IBM Plex Mono,monospace;font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#eaf6ff;text-shadow:0 0 10px rgba(56,225,255,0.45);line-height:1.05';
      label.appendChild(city);

      // Connector tick down to the pin
      const tick = document.createElement('div');
      tick.style.cssText =
        'position:absolute;top:100%;left:14px;width:1px;height:14px;background:linear-gradient(to bottom,#38e1ff,rgba(56,225,255,0))';
      label.appendChild(tick);

      wrap.appendChild(label);

      container.appendChild(wrap);
      return { wrap, dot, label, lat: d.lat, lng: d.lng, index: i };
    });
  }, [trips, getSorted]);

  // Tapping the globe away from a city dismisses the name callout. Marker taps
  // catch their own click (and stop propagation) before it reaches the globe
  // surface, so this only fires for "empty" globe clicks.
  useEffect(() => {
    if (!globe) return;
    globe.onGlobeClick(() => useUiStore.getState().setShowCityLabel(false));
    return () => globe.onGlobeClick(null);
  }, [globe]);

  // Position every marker each frame from getScreenCoords; hide far-side ones.
  useEffect(() => {
    if (!globe) return;
    const g = globe;
    const loop = () => {
      const pov = g.pointOfView();
      const { animation } = useTripStore.getState();
      // A surface point is on the visible near side when the cosine of its
      // angular distance from the sub-camera point exceeds R / cameraDistance.
      const minCos = 1 / (1 + pov.altitude);
      const sinPov = Math.sin(pov.lat * DEG);
      const cosPov = Math.cos(pov.lat * DEG);

      for (const e of elsRef.current) {
        // Show a dot for EVERY visited city (not just the ones revealed so far),
        // so it's always clear where you've been — only the far side is hidden.
        const cosG =
          Math.sin(e.lat * DEG) * sinPov +
          Math.cos(e.lat * DEG) * cosPov * Math.cos((e.lng - pov.lng) * DEG);
        if (cosG <= minCos) {
          e.wrap.style.display = 'none';
          continue;
        }
        const s = g.getScreenCoords(e.lat, e.lng, 0);
        e.wrap.style.left = `${s.x}px`;
        e.wrap.style.top = `${s.y}px`;
        e.wrap.style.display = 'block';
        const active = e.index === animation.currentDestinationIndex;
        e.dot.className = active ? 'globe-pin globe-pin--active' : 'globe-dot-marker';
        e.label.style.display =
          active && useUiStore.getState().showCityLabel ? 'flex' : 'none';
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
