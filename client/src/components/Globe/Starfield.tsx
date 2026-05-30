import { useEffect } from 'react';
import * as THREE from 'three';
import { useGlobeStore } from '@/stores/globeStore';

/**
 * Astronomically-accurate star field rendered INSIDE the globe's three.js
 * scene (a single THREE.Points object on a large celestial sphere).
 *
 * Because the globe is fixed at the scene origin and the camera orbits it, the
 * stars — placed at fixed scene positions far beyond the globe — naturally move
 * rigidly with the planet, so you see the real night sky behind each part of
 * Earth.
 *
 * Catalog: HYG v41 (astronexus/HYG-Database), trimmed to naked-eye stars
 * (mag ≤ 6.5, ~8.9k stars) and bundled as /stars.json — arrays of
 * [raDeg, decDeg, mag, B-V] per star.
 *
 * Coordinate mapping matches three-globe's polar2Cartesian (Dec→lat, RA→lng),
 * which is a pure rotation of the equatorial frame onto the globe frame
 * (north pole → +Y), so Polaris sits over the globe's north pole and real
 * constellations keep their correct, un-mirrored geometry when viewed from the
 * camera (which orbits inside the celestial sphere).
 */

// Stars sit on a celestial sphere far beyond controls.maxDistance (GLOBE_RADIUS*5
// = 500) yet well inside the camera's far plane (~125000), so they read as an
// infinitely-distant background that the globe still occludes.
const SKY_RADIUS = 45000;
const MAG_LIMIT = 6.5; // faintest magnitude in the catalog
const DEG2RAD = Math.PI / 180;

interface StarCatalog {
  count: number;
  data: number[]; // flat [raDeg, decDeg, mag, bv] * count
}

/**
 * three-globe's polar2Cartesian convention, on a sphere of radius r.
 * phi = (90 - lat), theta = (90 - lng); y is the polar axis.
 */
function sphericalToCartesian(latDeg: number, lngDeg: number, r: number) {
  const phi = (90 - latDeg) * DEG2RAD;
  const theta = (90 - lngDeg) * DEG2RAD;
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

/** B-V color index → blackbody temperature (Ballesteros' formula). */
function bvToTemp(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** Blackbody temperature (K) → linear-ish RGB (Tanner Helland approximation). */
function tempToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const cl = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return [cl(r), cl(g), cl(b)];
}

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vColor = aColor;
    // Subtle twinkle: small per-star brightness wobble.
    vBright = 1.0 + 0.16 * sin(uTime * 2.2 + aPhase);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Constant screen-space size (stars are effectively at infinity).
    gl_PointSize = clamp(aSize * uSizeScale * uPixelRatio, 1.0, 64.0);
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    // Round soft sprite: bright core + soft glow falloff.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(0.55, 0.0, d);
    float glow = pow(max(1.0 - d, 0.0), 2.2);
    float a = core * 0.85 + glow * 0.45;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * vBright, a);
  }
`;

function buildStarPoints(catalog: StarCatalog, pixelRatio: number): THREE.Points {
  const n = catalog.count;
  const d = catalog.data;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const phases = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const raDeg = d[i * 4];
    const decDeg = d[i * 4 + 1];
    const mag = d[i * 4 + 2];
    const bv = d[i * 4 + 3];

    // Dec → latitude, RA → longitude (same frame as the globe).
    const p = sphericalToCartesian(decDeg, raDeg, SKY_RADIUS);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    // Brightness factor: 0 (faint) .. 1 (brightest naked-eye).
    const t = Math.max(0, Math.min(1, (MAG_LIMIT - mag) / 8.0));
    const sizePx = 1.0 + 7.5 * t * t; // faint ~1px, brightest ~8.5px
    const intensity = 0.4 + 0.6 * Math.pow(t, 1.2);
    sizes[i] = sizePx;

    const [r, g, b] = tempToRgb(bvToTemp(bv));
    // Lift toward white a touch so very red/blue stars don't look garish,
    // then scale by per-star intensity.
    colors[i * 3] = (r * 0.82 + 0.18) * intensity;
    colors[i * 3 + 1] = (g * 0.82 + 0.18) * intensity;
    colors[i * 3 + 2] = (b * 0.82 + 0.18) * intensity;

    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  // Stars never get culled by their own bounding sphere as the camera moves.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SKY_RADIUS);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uSizeScale: { value: 1 },
    },
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false, // let stars blend; globe still occludes them via depthTest
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'celestial-starfield';
  points.frustumCulled = false;
  points.renderOrder = -1; // draw behind globe overlays
  return points;
}

export function Starfield() {
  const globe = useGlobeStore((s) => s.globeInstance);

  useEffect(() => {
    if (!globe) return;

    const scene = globe.scene();
    const renderer = globe.renderer();
    const camera = globe.camera() as THREE.PerspectiveCamera;

    // Make sure distant stars aren't clipped by the camera's far plane.
    if (typeof camera.far === 'number' && camera.far < SKY_RADIUS * 1.5) {
      camera.far = SKY_RADIUS * 2.5;
      camera.updateProjectionMatrix();
    }

    let points: THREE.Points | null = null;
    let rafId = 0;
    let disposed = false;
    const start = performance.now();

    fetch('/stars.json')
      .then((res) => res.json() as Promise<StarCatalog>)
      .then((catalog) => {
        if (disposed) return;
        const pixelRatio = Math.min(renderer.getPixelRatio() || 1, 2);
        points = buildStarPoints(catalog, pixelRatio);
        scene.add(points);

        const material = points.material as THREE.ShaderMaterial;
        const tick = () => {
          material.uniforms.uTime.value = (performance.now() - start) / 1000;
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      })
      .catch((err) => {
        console.error('[Starfield] failed to load star catalog', err);
      });

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (points) {
        scene.remove(points);
        points.geometry.dispose();
        (points.material as THREE.Material).dispose();
      }
    };
  }, [globe]);

  return null;
}
