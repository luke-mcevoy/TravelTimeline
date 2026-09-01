import { useEffect, useRef, useCallback } from 'react';
import Globe, { type GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import { useTripStore } from '@/stores/tripStore';
import { useUiStore } from '@/stores/uiStore';
import { useGlobeStore } from '@/stores/globeStore';
import { isNativePlatform, loadPhotoSrc, HERO_PHOTO_WIDTH } from '@/services/photoSource';
import { spaceFactor } from '@/utils/spaceView';
import type { ServerPhotoRef } from '@/types';
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
// On the phone, WKWebView's GPU process has a hard memory budget. Loading very
// deep tiles (level 20) for a large area would exhaust it and crash the renderer
// on zoom-in, so we cap the depth lower on native. Desktop GPUs can go deeper.
const SATELLITE_MAX_LEVEL = isNativePlatform ? 18 : 20;

// While the story is auto-playing the camera sweeps fast across the globe, and
// streaming/uploading deep tiles on every hop is the main cause of the hitch on
// big moves. Cap the tile depth lower during playback (coarser, but far fewer
// texture uploads → smooth motion); it sharpens back up the moment you pause.
const SATELLITE_PLAYBACK_LEVEL = isNativePlatform ? 15 : 17;

// How the tile engine picks a zoom level (from three-slippy-map-globe):
//
//   thresholds default = [8, 4, 2, 1, 0.5, ...]  (i.e. 8 / 2^idx, DESCENDING)
//   idx   = thresholds.findIndex(t => t <= cameraAltitude)   // altitude in radii
//   level = clamp(idx, minLevel, maxLevel)
//
// Because it takes the FIRST threshold ≤ the altitude, scaling the thresholds UP
// makes it pick a higher (finer) level at the same altitude — one extra level per
// doubling. The library's defaults are tuned coarse (great-for-desktop, soft on a
// Retina phone), so we scale them up. Each +1 level is ~4x the tiles on screen,
// so we keep this modest; max level is capped separately.
// Each +1 level is ~4x the on-screen tiles (≈4x the GPU texture memory). +3 is
// fine on desktop but is what tips the phone's GPU process over on zoom-in, so
// native gets a gentler +1 boost. Still noticeably sharper than the default.
const TILE_DETAIL_MULT = isNativePlatform ? 2 : 8;

type SlippyLayer = THREE.Object3D & {
  thresholds: number[];
  maxLevel: number;
};

// Find the slippy-map tile layer(s) inside the globe's scene graph so we can
// retune them. They're not exposed by globe.gl's public API, so we detect them
// structurally (an Object3D carrying a `thresholds` array + numeric maxLevel).
// Guard against double-application (the polling re-detects the same layer).
const TUNED_LAYERS = new WeakSet<object>();
function tuneTileLayers(globe: GlobeInstance): boolean {
  const scene = globe.scene();
  if (!scene) return false;
  let tuned = 0;
  scene.traverse((o) => {
    const layer = o as Partial<SlippyLayer>;
    if (Array.isArray(layer.thresholds) && typeof layer.maxLevel === 'number') {
      if (!TUNED_LAYERS.has(o)) {
        (o as SlippyLayer).thresholds = layer.thresholds!.map((t) => t * TILE_DETAIL_MULT);
        TUNED_LAYERS.add(o);
      }
      tuned++;
    }
  });
  return tuned > 0;
}

// The 8K base decodes to ~180MB of GPU memory (with mipmaps) — far more than a
// phone wants resident, and the satellite tile engine supplies the real detail
// when zoomed anyway. Native uses a 4K base (≈45MB) for a big memory saving with
// no visible difference at the overview distance.
const GLOBE_IMAGE = isNativePlatform ? '/earth-day-4k.jpg' : '/earth-day-8k.jpg?v=1';
const BUMP_IMAGE = '/earth-topology.png';
const WATER_IMAGE = '/earth-water.png';

const GLOBE_RADIUS = 100; // three-globe's fixed globe radius

// ── Zoom-reactive arc brightness ────────────────────────────────────────────
// The arc shader writes the vertex-color alpha straight to gl_FragColor (no
// opacity uniform), so we inject a `uArcOpacity` multiplier into each arc's
// material and drive it from the camera distance: faint when flown in close
// (so flight paths don't clutter the city you're looking at), bright when
// pulled back (so the route reads clearly against the small globe).
const ARC_DIM_DISTANCE = 150; // ~resting altitude over a city → faint
const ARC_BRIGHT_DISTANCE = 460; // pulled back to the overview → full strength
const ARC_MIN_OPACITY = 0.16;
const ARC_MAX_OPACITY = 1;

// Arcs also get THINNER when flown in close (so they don't smother the city
// you're inspecting) and thicker at the overview (so the route reads clearly).
// Changing arcStroke rebuilds tube geometry, so we quantise to coarse buckets
// and only push an update when the bucket actually changes.
const ARC_MIN_STROKE = 0.08;
const ARC_MAX_STROKE = 0.42;
const ARC_STROKE_BUCKET = 0.06;

// During the scripted flythrough the camera lifts and dives on every hop, which
// would make the zoom-reactive brightness/thickness pulse bright→dim on each
// move (very noticeable in an exported video). While auto-playing we pin a
// steady, mid look instead so the route reads calmly.
// Kept close to the arc colour's own alpha (≈0.76) so a freshly-revealed arc —
// which renders one frame at its raw colour before the opacity uniform is
// applied — doesn't visibly flash brighter than its settled state.
const ARC_PLAYBACK_OPACITY = 0.92;
const ARC_PLAYBACK_STROKE = 0.2;

function arcStrokeForDistance(d: number): number {
  const t = Math.max(
    0,
    Math.min(1, (d - ARC_DIM_DISTANCE) / (ARC_BRIGHT_DISTANCE - ARC_DIM_DISTANCE))
  );
  const raw = ARC_MIN_STROKE + (ARC_MAX_STROKE - ARC_MIN_STROKE) * t;
  return Math.round(raw / ARC_STROKE_BUCKET) * ARC_STROKE_BUCKET;
}

type ArcShaderMat = THREE.ShaderMaterial & { __arcOpacityPatched?: boolean };

function patchArcMaterial(mat: ArcShaderMat): boolean {
  if (mat.__arcOpacityPatched) return true;
  if (!mat.fragmentShader || !mat.fragmentShader.includes('gl_FragColor = vColor;')) {
    return false;
  }
  mat.uniforms.uArcOpacity = { value: 1 };
  mat.fragmentShader =
    'uniform float uArcOpacity;\n' +
    mat.fragmentShader.replace(
      'gl_FragColor = vColor;',
      'gl_FragColor = vec4(vColor.rgb, vColor.a * uArcOpacity);'
    );
  mat.needsUpdate = true;
  mat.__arcOpacityPatched = true;
  return true;
}

// Collect (and patch) every arc's shader material. Walking the scene graph is
// relatively expensive — the tile engine adds hundreds of meshes — so we only
// do this when the set of arcs actually changes, cache the result, and then
// drive opacity from the cache every frame instead of re-traversing.
function collectArcMaterials(globe: GlobeInstance): ArcShaderMat[] {
  const scene = globe.scene();
  if (!scene) return [];
  const mats: ArcShaderMat[] = [];
  scene.traverse((o) => {
    if ((o as { __globeObjType?: string }).__globeObjType !== 'arc') return;
    const mesh = o.children[0] as THREE.Mesh | undefined;
    const mat = mesh?.material as ArcShaderMat | undefined;
    if (!mat || !mat.uniforms) return;
    if (!patchArcMaterial(mat)) return;
    mats.push(mat);
  });
  return mats;
}

function arcOpacityForDistance(d: number): number {
  const t = Math.max(
    0,
    Math.min(1, (d - ARC_DIM_DISTANCE) / (ARC_BRIGHT_DISTANCE - ARC_DIM_DISTANCE))
  );
  return ARC_MIN_OPACITY + (ARC_MAX_OPACITY - ARC_MIN_OPACITY) * t;
}

// The globe is a single long-lived WebGL object created once. If Vite hot-patches
// this module without a full reload, the *old* globe instance keeps running with
// its old config (e.g. marker altitude), which silently diverges from the source.
// Force a full page reload on any hot update so the globe is always rebuilt.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

const preloadCache = new Map<string, HTMLImageElement>();

// Warm the cache for an upcoming destination photo. On web this resolves to a
// server URL we pre-fetch into an <img>; on native loadPhotoSrc itself caches
// the PhotoKit thumbnail (so usePhotoSrc returns it instantly later).
function preloadPhoto(ref: ServerPhotoRef) {
  loadPhotoSrc(ref, HERO_PHOTO_WIDTH)
    .then((src) => {
      if (isNativePlatform || preloadCache.has(src)) return;
      const img = new Image();
      img.src = src;
      preloadCache.set(src, img);
    })
    .catch(() => {});
}

export function GlobeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const arcStrokeRef = useRef(ARC_MAX_STROKE);
  const updateArcsRef = useRef<() => void>(() => {});
  const setGlobeInstance = useGlobeStore((s) => s.setGlobeInstance);

  const trips = useTripStore((s) => s.trips);
  const animation = useTripStore((s) => s.animation);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);

  useEffect(() => {
    if (!containerRef.current || globeRef.current) return;
    const container = containerRef.current;

    const globe = new Globe(container)
      .globeImageUrl(GLOBE_IMAGE)
      .backgroundColor('rgba(0, 0, 0, 0)')
      .showAtmosphere(true)
      .atmosphereColor('#38e1ff')
      .atmosphereAltitude(0.28)
      .pointOfView({ lat: 20, lng: 0, altitude: 2.5 });
    // The bump + specular maps add per-fragment texture fetches and lighting math
    // across the whole globe every frame. The satellite tiles already carry shaded
    // terrain detail, so we skip them on the phone (where fragment budget is tight)
    // and keep them only for the desktop's spare GPU headroom.
    if (!isNativePlatform) {
      globe.bumpImageUrl(BUMP_IMAGE);
    }
    globe
      // Arcs — thin glowing lines (kept slim so they read as flight paths,
      // not giant ribbons, even when the camera is zoomed in close)
      .arcColor('color' as never)
      .arcStroke(ARC_MAX_STROKE)
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
    // Higher pixel ratio = sharper, but the framebuffer memory grows with its
    // square. A 3x buffer on a phone (plus deep tiles) crashes WKWebView's GPU
    // process, so cap native at 2x (still Retina-sharp) and allow 3x on desktop.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isNativePlatform ? 2 : 3));
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const loader = new THREE.TextureLoader();

    const mat = globe.globeMaterial() as THREE.MeshPhongMaterial;
    // Sharpen the day + bump maps once three-globe has loaded them, and retune
    // the satellite tile layers for higher-resolution imagery.
    let sharpenTries = 0;
    let tilesTuned = false;
    const sharpenInterval = window.setInterval(() => {
      let done = true;
      if (mat.map) {
        mat.map.anisotropy = maxAnisotropy;
        mat.map.needsUpdate = true;
      } else {
        done = false;
      }
      // The bump map only exists on web (skipped on native for performance).
      if (mat.bumpMap) {
        mat.bumpMap.anisotropy = maxAnisotropy;
        mat.bumpMap.needsUpdate = true;
        mat.bumpScale = 6;
      } else if (!isNativePlatform) {
        done = false;
      }
      if (!tilesTuned) {
        tilesTuned = tuneTileLayers(globe);
        if (!tilesTuned) done = false;
      }
      if (done || ++sharpenTries > 40) window.clearInterval(sharpenInterval);
    }, 100);

    // Ocean specular sheen via a water mask — desktop only; the extra texture
    // fetch + specular term per fragment isn't worth the phone's GPU budget.
    if (!isNativePlatform) {
      loader.load(WATER_IMAGE, (waterTex) => {
        waterTex.anisotropy = maxAnisotropy;
        mat.specularMap = waterTex;
        mat.specular = new THREE.Color('#1b2a38');
        mat.shininess = 16;
        mat.needsUpdate = true;
      });
    }

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
    // Pull way back so Earth shrinks into the star field and the whole Earth→Moon
    // scene (Moon sits ~520 units out) can be framed at once. Stars live far
    // beyond this (SKY_RADIUS = 45000), so they stay put.
    controls.maxDistance = GLOBE_RADIUS * 16;

    // ── Free-roam panning when zoomed out, auto-recenter when flown back in ──
    // Earth is normally locked dead-centre (target at origin). Once the camera
    // pulls back into the wider space view we let the user pan the pivot around
    // (two-finger drag on touch, right-drag on desktop) so they can roam over to
    // the Moon. As soon as they zoom back in, the pivot eases home to Earth.
    controls.screenSpacePanning = true;
    controls.enablePan = false;
    controls.panSpeed = 0.8;

    const PAN_ENABLE_DIST = GLOBE_RADIUS * 4.6; // ~beyond the normal overview
    const origin = new THREE.Vector3(0, 0, 0);
    let panRaf = 0;
    let panDisposed = false;
    const panLoop = () => {
      if (panDisposed) return;
      // Reel capture drives the camera itself — don't lerp the orbit target
      // or toggle pan underneath the scripted path (that's visible stutter).
      if (!useUiStore.getState().cinematic) {
        const cam = globe.camera();
        const orbitDist = cam.position.distanceTo(controls.target);
        if (orbitDist > PAN_ENABLE_DIST) {
          controls.enablePan = true;
        } else {
          controls.enablePan = false;
          // Ease the pivot back to Earth's centre so we re-centre on the way in.
          if (controls.target.lengthSq() > 0.02) {
            controls.target.lerp(origin, 0.09);
            if (controls.target.lengthSq() < 0.02) controls.target.set(0, 0, 0);
          }
        }
      }
      panRaf = requestAnimationFrame(panLoop);
    };
    panRaf = requestAnimationFrame(panLoop);

    // Cache of the arc shader materials. Refreshed only when the arc set changes
    // (see updateArcsRef below); read every frame to set opacity without a walk.
    let arcMats: ArcShaderMat[] = [];
    const applyArcOpacity = (opacity: number) => {
      for (let i = 0; i < arcMats.length; i++) {
        arcMats[i].uniforms.uArcOpacity.value = opacity;
      }
    };

    // Debounced arc-stroke application (see below): only rebuild geometry once
    // the camera has settled, never during a sweep.
    let pendingStroke = arcStrokeRef.current;
    let strokeSettleTimer = 0;

    // Dim the flight arcs as the camera flies in, brighten them at the overview,
    // then fade them out entirely once we pull back into the "space view" (where
    // the Earth→Moon beam takes over).
    const updateArcBrightness = () => {
      const distance = globe.camera().position.length(); // controls.target is the origin
      const playing =
        useTripStore.getState().animation.isPlaying || useUiStore.getState().cinematic;

      // While auto-playing, pin a steady look (the camera's scripted lift/dive on
      // every hop would otherwise pulse the arcs bright→dim). When the user is
      // driving the camera, make them zoom-reactive: dim+thin in close, bright+
      // thick at the overview. Either way they fade out into the space view.
      const space = 1 - spaceFactor(distance);
      const opacity = (playing ? ARC_PLAYBACK_OPACITY : arcOpacityForDistance(distance)) * space;
      const stroke = playing ? ARC_PLAYBACK_STROKE : arcStrokeForDistance(distance);

      applyArcOpacity(opacity);

      // arcStroke rebuilds ALL arc tube geometries — far too expensive to do
      // mid-flight. During playback the stroke is constant, so apply it once.
      // Otherwise (manual zoom/tap-to-fly) debounce it so the rebuild happens
      // only after the camera settles, never during a sweep.
      if (playing) {
        if (Math.abs(stroke - arcStrokeRef.current) > 1e-4) {
          arcStrokeRef.current = stroke;
          globe.arcStroke(stroke);
        }
      } else {
        pendingStroke = stroke;
        clearTimeout(strokeSettleTimer);
        strokeSettleTimer = window.setTimeout(() => {
          if (Math.abs(pendingStroke - arcStrokeRef.current) > 1e-4) {
            arcStrokeRef.current = pendingStroke;
            globe.arcStroke(pendingStroke);
          }
        }, 150);
      }
    };
    // When the arc set changes, re-collect the (possibly new) materials once,
    // then re-apply the current look. The cheap per-frame 'change' handler reuses
    // the cached materials.
    updateArcsRef.current = () => {
      arcMats = collectArcMaterials(globe);
      updateArcBrightness();
    };
    controls.addEventListener('change', updateArcBrightness);
    updateArcBrightness();

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
      controls.removeEventListener('change', updateArcBrightness);
      clearTimeout(strokeSettleTimer);
      panDisposed = true;
      if (panRaf) cancelAnimationFrame(panRaf);
      setGlobeInstance(null);
      container.innerHTML = '';
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
        color: ['rgba(130,235,255,0.72)', 'rgba(200,250,255,0.8)'],
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
          preloadPhoto(photos[0]);
        }
      }
    }

    return { arcs };
  }, [getSortedDestinations, animation.isPlaying, animation.currentDestinationIndex]);

  useEffect(() => {
    if (!globeRef.current) return;
    const globe = globeRef.current;
    const { arcs } = buildGlobeData();
    globe.arcsData(arcs);
    // Newly-built arc meshes default to full opacity; sync them to the current
    // look once they've been added to the scene on the next frame. Re-running
    // the full brightness calc (rather than just re-applying the cached value)
    // also handles the play↔pause switch, when the camera may be stationary and
    // the controls 'change' event won't fire on its own.
    const raf = requestAnimationFrame(() => updateArcsRef.current());
    return () => cancelAnimationFrame(raf);
  }, [trips, animation.currentDestinationIndex, animation.isPlaying, buildGlobeData]);

  // Drop tile detail while auto-playing so fast hops don't churn deep tiles;
  // restore full detail (which sharpens the view) the moment playback stops.
  useEffect(() => {
    const globe = globeRef.current as TileEngineGlobe | null;
    if (!globe) return;
    globe.globeTileEngineMaxLevel(
      animation.isPlaying ? SATELLITE_PLAYBACK_LEVEL : SATELLITE_MAX_LEVEL
    );
  }, [animation.isPlaying]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
      id="globe-container"
    />
  );
}
