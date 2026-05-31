import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGlobeStore } from '@/stores/globeStore';
import { useTripStore } from '@/stores/tripStore';
import { useUiStore } from '@/stores/uiStore';
import { totalDistance } from '@/utils/animation';
import { spaceFactor } from '@/utils/spaceView';

/**
 * A stylised Moon placed in the globe's three.js scene, plus a straight
 * Earth→Moon "progress beam" that visualises how far the traveller's total
 * distance carries them toward the Moon (384,400 km).
 *
 * The Moon is always present in space. The beam only fades in once the camera
 * pulls far enough back (see spaceFactor) — at which point GlobeView fades the
 * city-to-city arcs out, so the two never fight for attention.
 *
 * Scene units: three-globe's globe radius is 100. The Earth–Moon distance is
 * wildly compressed (true scale would put the Moon ~6000 units away, off any
 * reachable camera framing), so we use a stylised separation that keeps both
 * bodies in frame at full zoom-out.
 */
const GLOBE_RADIUS = 100;
const MOON_RADIUS = 26;
const MOON_CENTER_DIST = 520; // scene units from Earth centre
const MOON_DIR = new THREE.Vector3(0.82, 0.3, 0.48).normalize();
const MOON_DISTANCE_KM = 384400;

const CYAN = 0x8fe9ff;

/**
 * Build a believable Moon surface procedurally (no bundled texture, so it works
 * offline / on iOS): a warm-grey regolith base, darker basaltic "maria" plains,
 * and hundreds of craters drawn with a shadowed floor + sunlit rim. Returns an
 * albedo map plus a matching height field for bump-mapped relief.
 */
function makeMoonTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 1024;
  const H = 512;

  const color = document.createElement('canvas');
  color.width = W;
  color.height = H;
  const cx = color.getContext('2d')!;

  const bump = document.createElement('canvas');
  bump.width = W;
  bump.height = H;
  const bx = bump.getContext('2d')!;

  // Base regolith tone + neutral mid-grey height.
  cx.fillStyle = '#8f8d88';
  cx.fillRect(0, 0, W, H);
  bx.fillStyle = '#808080';
  bx.fillRect(0, 0, W, H);

  // Fine grain so the surface isn't a flat fill.
  const grain = cx.getImageData(0, 0, W, H);
  const gd = grain.data;
  for (let i = 0; i < gd.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    gd[i] += n;
    gd[i + 1] += n;
    gd[i + 2] += n;
  }
  cx.putImageData(grain, 0, 0);

  // Maria: large, soft, dark basalt plains.
  const maria: Array<[number, number, number]> = [
    [0.30, 0.40, 150],
    [0.44, 0.32, 110],
    [0.54, 0.50, 95],
    [0.27, 0.62, 90],
    [0.62, 0.40, 80],
    [0.40, 0.55, 70],
  ];
  for (const [u, v, r] of maria) {
    const g = cx.createRadialGradient(u * W, v * H, 0, u * W, v * H, r);
    g.addColorStop(0, 'rgba(74, 75, 84, 0.55)');
    g.addColorStop(1, 'rgba(74, 75, 84, 0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(u * W, v * H, r, 0, Math.PI * 2);
    cx.fill();
  }

  // Craters. Light comes from the upper-left, so the rim is bright top-left and
  // a cast shadow sits bottom-right; the floor is darker than the surroundings.
  const CRATERS = 420;
  for (let i = 0; i < CRATERS; i++) {
    const u = Math.random() * W;
    // Bias away from the poles where equirectangular mapping smears badly.
    const v = (0.12 + Math.random() * 0.76) * H;
    const r = 2 + Math.pow(Math.random(), 2.6) * 24; // many small, few large

    // Albedo: darker floor fading to the surface.
    const floor = cx.createRadialGradient(u, v, 0, u, v, r);
    floor.addColorStop(0, 'rgba(58, 58, 66, 0.45)');
    floor.addColorStop(0.7, 'rgba(82, 82, 90, 0.22)');
    floor.addColorStop(1, 'rgba(120, 120, 128, 0)');
    cx.fillStyle = floor;
    cx.beginPath();
    cx.arc(u, v, r, 0, Math.PI * 2);
    cx.fill();

    // Sunlit rim arc (top-left) + shadow arc (bottom-right).
    cx.lineWidth = Math.max(1, r * 0.14);
    cx.strokeStyle = 'rgba(214, 214, 220, 0.4)';
    cx.beginPath();
    cx.arc(u, v, r * 0.9, Math.PI * 0.85, Math.PI * 1.85);
    cx.stroke();
    cx.strokeStyle = 'rgba(30, 30, 36, 0.4)';
    cx.beginPath();
    cx.arc(u, v, r * 0.9, Math.PI * 1.9, Math.PI * 2.9);
    cx.stroke();

    // Height field: bowl floor (low) ringed by a raised rim (high).
    const h = bx.createRadialGradient(u, v, 0, u, v, r);
    h.addColorStop(0, 'rgba(48, 48, 48, 0.9)');
    h.addColorStop(0.74, 'rgba(72, 72, 72, 0.55)');
    h.addColorStop(0.9, 'rgba(206, 206, 206, 0.75)');
    h.addColorStop(1, 'rgba(128, 128, 128, 0)');
    bx.fillStyle = h;
    bx.beginPath();
    bx.arc(u, v, r, 0, Math.PI * 2);
    bx.fill();
  }

  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bumpTex = new THREE.CanvasTexture(bump);
  return { map, bump: bumpTex };
}

/** The classic white Skittle "S", drawn on a transparent canvas for a sprite. */
function makeSkittleLogo(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, S, S);
  x.fillStyle = '#ffffff';
  x.font = 'italic 900 190px Georgia, "Times New Roman", serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = 'rgba(110, 0, 12, 0.45)';
  x.shadowBlur = 10;
  x.shadowOffsetY = 3;
  x.fillText('S', S / 2, S / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function MoonScene() {
  const globe = useGlobeStore((s) => s.globeInstance);
  const trips = useTripStore((s) => s.trips);
  const getSorted = useTripStore((s) => s.getSortedDestinations);
  const skittleMode = useUiStore((s) => s.skittleMode);

  const km = totalDistance(getSorted());
  const fraction = Math.max(0, Math.min(1, km / MOON_DISTANCE_KM));

  // Build the (expensive) Moon surface + Skittle logo once.
  const moonTex = useMemo(() => makeMoonTextures(), []);
  const skittleLogo = useMemo(() => makeSkittleLogo(), []);
  useEffect(
    () => () => {
      moonTex.map.dispose();
      moonTex.bump.dispose();
      skittleLogo.dispose();
    },
    [moonTex, skittleLogo]
  );

  useEffect(() => {
    if (!globe) return;
    const scene = globe.scene();
    const camera = globe.camera() as THREE.PerspectiveCamera;
    if (!scene) return;

    void trips; // rebuild when the trip set changes (fraction is derived from it)

    const group = new THREE.Group();
    group.name = 'moon-scene';

    // ── Moon body (always visible) ──
    const moonCenter = MOON_DIR.clone().multiplyScalar(MOON_CENTER_DIST);
    const moonMat = skittleMode
      ? new THREE.MeshPhongMaterial({
          // Glossy red candy shell.
          color: 0xd11a2a,
          emissive: 0x2a0206,
          shininess: 120,
          specular: 0xffd6d6,
        })
      : new THREE.MeshPhongMaterial({
          map: moonTex.map,
          bumpMap: moonTex.bump,
          bumpScale: 0.9,
          color: 0xffffff,
          emissive: 0x05070c,
          shininess: 1.5,
          specular: 0x0c0f15,
        });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 96, 96), moonMat);
    moon.position.copy(moonCenter);
    if (skittleMode) {
      // Skittles are a flattened lentil/lens. Squash one axis; the tick orients
      // that flat face toward the camera so we always see the broad candy side.
      moon.scale.set(1, 1, 0.6);
    } else {
      // Turn an interesting, maria-rich hemisphere toward the typical viewpoint.
      moon.rotation.y = -1.1;
    }
    group.add(moon);

    // The white "S" — a billboarded sprite that always faces the viewer, parked
    // just in front of the candy's near face (skittle mode only).
    let logo: THREE.Sprite | null = null;
    let logoMat: THREE.SpriteMaterial | null = null;
    if (skittleMode) {
      logoMat = new THREE.SpriteMaterial({
        map: skittleLogo,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      logo = new THREE.Sprite(logoMat);
      logo.scale.set(MOON_RADIUS * 1.15, MOON_RADIUS * 1.15, 1);
      logo.renderOrder = 10;
      group.add(logo);
    }

    // Soft outer halo so the body reads gently against the stars (reddened in
    // candy mode so the Skittle gets a sweet glow).
    const haloMat = new THREE.MeshBasicMaterial({
      color: skittleMode ? 0xff5a6a : 0xbfd2e6,
      transparent: true,
      opacity: skittleMode ? 0.16 : 0.1,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS * 1.22, 40, 40), haloMat);
    halo.position.copy(moonCenter);
    group.add(halo);

    // ── Earth → Moon progress beam (fades in with space view) ──
    const start = MOON_DIR.clone().multiplyScalar(GLOBE_RADIUS + 4);
    const end = MOON_DIR.clone().multiplyScalar(MOON_CENTER_DIST - MOON_RADIUS);
    const progressPoint = start.clone().lerp(end, fraction);

    // Faint full path (the whole journey still to go).
    const fullMat = new THREE.LineBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0,
    });
    const fullGeom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const fullLine = new THREE.Line(fullGeom, fullMat);
    group.add(fullLine);

    // Bright travelled beam (start → how far we've come).
    let beamMat: THREE.MeshBasicMaterial | null = null;
    let beam: THREE.Mesh | null = null;
    if (start.distanceTo(progressPoint) > 1) {
      beamMat = new THREE.MeshBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const curve = new THREE.LineCurve3(start, progressPoint);
      const beamGeom = new THREE.TubeGeometry(curve, 1, 1.5, 10, false);
      beam = new THREE.Mesh(beamGeom, beamMat);
      group.add(beam);
    }

    // Glowing node at the progress point.
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const node = new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 20), nodeMat);
    node.position.copy(progressPoint);
    group.add(node);

    scene.add(group);

    // Drive beam opacity from the camera distance every frame.
    let rafId = 0;
    let disposed = false;
    let lastS = -1;
    const camDir = new THREE.Vector3();
    const tick = () => {
      if (disposed) return;
      const s = spaceFactor(camera.position.length());
      // The beam's look only depends on `s` (camera distance); skip the material
      // writes entirely on frames where it hasn't meaningfully changed.
      if (Math.abs(s - lastS) > 0.001) {
        lastS = s;
        fullMat.opacity = 0.3 * s;
        if (beamMat) beamMat.opacity = 0.95 * s;
        nodeMat.opacity = s;
        const beamVisible = s > 0.001;
        fullLine.visible = beamVisible;
        node.visible = beamVisible;
        if (beam) beam.visible = beamVisible;
      }

      // Keep the Skittle's flat face — and its "S" — pointed at the viewer no
      // matter how the globe is rotated or zoomed.
      if (skittleMode) {
        moon.lookAt(camera.position); // squashed local-Z faces the camera
        camDir.copy(camera.position).sub(moonCenter).normalize();
        if (logo) {
          logo.position.copy(moonCenter).addScaledVector(camDir, MOON_RADIUS * 0.62);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as THREE.Mesh).material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
    };
  }, [globe, fraction, trips, moonTex, skittleLogo, skittleMode]);

  return null;
}
