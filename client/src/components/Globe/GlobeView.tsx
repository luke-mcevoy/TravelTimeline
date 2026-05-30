import { useEffect, useRef, useCallback } from 'react';
import Globe, { type GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import { useTripStore } from '@/stores/tripStore';
import { useGlobeStore } from '@/stores/globeStore';
import './GlobeView.module.css';

interface ArcData {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
}

/**
 * globe.gl 2.45 ships the slippy-tile engine at runtime but its bundled type
 * defs don't expose it yet, so we widen the instance type here.
 */
type TileEngineGlobe = GlobeInstance & {
  globeTileEngineUrl(
    fn: (x: number, y: number, level: number) => string
  ): TileEngineGlobe;
  globeTileEngineMaxLevel(level: number): TileEngineGlobe;
  globeCurvatureResolution(deg: number): TileEngineGlobe;
};

/**
 * ESRI World Imagery — global, high-resolution satellite/aerial photography,
 * free and key-less. The engine fetches finer tiles as the camera approaches,
 * so cities stay crisp instead of blurring out like a single baked texture.
 */
const SATELLITE_TILE_URL = (x: number, y: number, level: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${level}/${y}/${x}`;
const SATELLITE_MAX_LEVEL = 17;

const GLOBE_IMAGE = '/earth-day-8k.jpg?v=1';
const BUMP_IMAGE = '/earth-topology.png';
const WATER_IMAGE = '/earth-water.png';

const GLOBE_RADIUS = 100; // three-globe's fixed globe radius

// The globe is a single long-lived WebGL object created once. If Vite hot-patches
// this module without a full reload, the *old* globe instance keeps running with
// its old config (e.g. marker altitude), which silently diverges from the source.
// Force a full page reload on any hot update so the globe is always rebuilt.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

function photoUrl(photo: { directory: string; filename: string }, width = 200): string {
  return `/api/apple-photos/photo?dir=${encodeURIComponent(photo.directory)}&file=${encodeURIComponent(photo.filename)}&w=${width}`;
}

const preloadCache = new Map<string, HTMLImageElement>();

function preloadPhoto(url: string) {
  if (preloadCache.has(url)) return;
  const img = new Image();
  img.src = url;
  preloadCache.set(url, img);
}

export function GlobeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const setGlobeInstance = useGlobeStore((s) => s.setGlobeInstance);

  const trips = useTripStore((s) => s.trips);
  const animation = useTripStore((s) => s.animation);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);

  useEffect(() => {
    if (!containerRef.current || globeRef.current) return;

    const globe = new Globe(containerRef.current)
      .globeImageUrl(GLOBE_IMAGE)
      .bumpImageUrl(BUMP_IMAGE)
      .backgroundColor('rgba(0, 0, 0, 0)')
      .showAtmosphere(true)
      .atmosphereColor('#38e1ff')
      .atmosphereAltitude(0.28)
      .pointOfView({ lat: 20, lng: 0, altitude: 2.5 })
      // Arcs — thin glowing lines (kept slim so they read as flight paths,
      // not giant ribbons, even when the camera is zoomed in close)
      .arcColor('color' as never)
      .arcStroke(0.12)
      .arcDashLength(1)
      .arcDashGap(0)
      .arcDashAnimateTime(0)
      .arcAltitudeAutoScale(0.22)
      .arcsTransitionDuration(0);
    // NOTE: destination markers are intentionally NOT rendered via globe.gl's
    // htmlElementsData layer — its CSS2D projection misplaces markers on some
    // GPUs/Retina displays. They're drawn by <MarkerOverlay> using
    // getScreenCoords instead.

    // ── Satellite tile engine: streams crisp imagery that sharpens on zoom ──
    (globe as TileEngineGlobe)
      .globeTileEngineUrl(SATELLITE_TILE_URL)
      .globeTileEngineMaxLevel(SATELLITE_MAX_LEVEL)
      // Smaller curvature step = rounder sphere when the camera is close in.
      .globeCurvatureResolution(2);

    // ── Crisp, cinematic globe material ──────────────────────────────
    const renderer = globe.renderer();
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const loader = new THREE.TextureLoader();

    const mat = globe.globeMaterial() as THREE.MeshPhongMaterial;
    // Sharpen the day + bump maps once three-globe has loaded them
    let sharpenTries = 0;
    const sharpenInterval = window.setInterval(() => {
      let done = true;
      if (mat.map) mat.map.anisotropy = maxAnisotropy, (mat.map.needsUpdate = true);
      else done = false;
      if (mat.bumpMap) {
        mat.bumpMap.anisotropy = maxAnisotropy;
        mat.bumpMap.needsUpdate = true;
        mat.bumpScale = 6;
      } else done = false;
      if (done || ++sharpenTries > 40) window.clearInterval(sharpenInterval);
    }, 100);

    // Ocean specular sheen via a water mask
    loader.load(WATER_IMAGE, (waterTex) => {
      waterTex.anisotropy = maxAnisotropy;
      mat.specularMap = waterTex;
      mat.specular = new THREE.Color('#1b2a38');
      mat.shininess = 16;
      mat.needsUpdate = true;
    });

    // ── Lighting: ambient fill + directional for ocean highlight ─────
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-1, 0.4, 0.8);
    globe.lights([ambient, sun]);

    const controls = globe.controls();
    controls.autoRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // Satellite tiles stay crisp up close, so allow a much tighter fly-in.
    controls.minDistance = GLOBE_RADIUS * 1.025;
    controls.maxDistance = GLOBE_RADIUS * 5;

    globeRef.current = globe;
    setGlobeInstance(globe);

    const handleResize = () => {
      if (containerRef.current && globeRef.current) {
        globeRef.current.width(containerRef.current.clientWidth);
        globeRef.current.height(containerRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.clearInterval(sharpenInterval);
      setGlobeInstance(null);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      globeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildGlobeData = useCallback(() => {
    const destinations = getSortedDestinations();
    const visibleCount = animation.isPlaying
      ? Math.min(animation.currentDestinationIndex + 1, destinations.length)
      : destinations.length;

    const visible = destinations.slice(0, visibleCount);

    const arcs: ArcData[] = [];
    for (let i = 1; i < visible.length; i++) {
      const from = visible[i - 1];
      const to = visible[i];
      arcs.push({
        startLat: from.lat,
        startLng: from.lng,
        endLat: to.lat,
        endLng: to.lng,
        color: ['rgba(56,225,255,0.15)', 'rgba(111,233,255,0.65)'],
      });
    }

    // Preload the next few destination photos so they're ready when we fly there
    if (animation.isPlaying) {
      const lookahead = destinations.slice(
        animation.currentDestinationIndex + 1,
        animation.currentDestinationIndex + 4
      );
      for (const dest of lookahead) {
        const photos = dest.serverPhotos;
        if (photos && photos.length > 0) {
          preloadPhoto(photoUrl(photos[0], 1400));
        }
      }
    }

    return { arcs };
  }, [getSortedDestinations, animation.isPlaying, animation.currentDestinationIndex]);

  useEffect(() => {
    if (!globeRef.current) return;
    const { arcs } = buildGlobeData();
    globeRef.current.arcsData(arcs);
  }, [trips, animation.currentDestinationIndex, animation.isPlaying, buildGlobeData]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
      id="globe-container"
    />
  );
}
