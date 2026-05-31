import type { GlobeInstance } from 'globe.gl';
import type * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { SortedDestination } from '@/types';
import { loadPhotoSrc } from '@/services/photoSource';
import { totalDistance, uniqueCountries, uniqueCities } from '@/utils/animation';
import { useUiStore } from '@/stores/uiStore';

/**
 * Real-time "Instagram reel" recorder.
 *
 * Rather than rendering frames offline (slow — minutes), we composite the LIVE
 * globe canvas together with each stop's photo and captions onto a 1080×1920
 * canvas and capture it with MediaRecorder while a scripted camera flight plays.
 * Recording happens in real time, so a ~25s reel takes ~25s to make. iOS records
 * H.264 mp4 natively, which is exactly what Instagram wants.
 */

const W = 1080;
const H = 1920;
const FPS = 30;

const INTRO_MS = 1800;
const OUTRO_MS = 3200;
// Total time spent flying between/holding on places, spread across all stops so
// even a long trip stays watchable. Each stop gets at least MIN_SEG so the move
// is actually perceptible (the old 650ms felt like a hover, not a journey).
const STOPS_BUDGET_MS = 42_000;
const MIN_SEG_MS = 650;
const MAX_SEG_MS = 1300;
// Fraction of a segment spent flying to the place; the rest holds on it.
const TRAVEL_FRAC = 0.6;

// Camera altitudes (globe-radius units). We stay pulled back far enough to SEE
// the route arcs and the geography, with a distance-scaled hump mid-flight.
const OVERVIEW_LAT = 12;
const OVERVIEW_ALT = 2.4;
const ARRIVE_ALT = 1.15;
const HUMP_SCALE = 1.5;
const MAX_HUMP = 1.7;

// Modest photo size: the card is small and the dwell is brief, and we hold one
// decoded image per place in memory, so this keeps total memory in check.
const REEL_PHOTO_WIDTH = 720;
const PRELOAD_CONCURRENCY = 6;

const CYAN = '#38e1ff';
const BG = '#04070d';

// Called with an arg to set the satellite tile URL, without to read it. We swap
// the tile engine off (back to the bundled base texture) for recording.
type TileToggle = { globeTileEngineUrl?: (url?: string) => unknown };

// ── Deterministic great-circle camera math (so a frame's pose is a pure
//    function of time — required for the offline, lag-free render) ──────────

const toRad = Math.PI / 180;
const toDeg = 180 / Math.PI;
type LL = { lat: number; lng: number };

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function angDistDeg(a: LL, b: LL): number {
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * toDeg;
}

/** Great-circle interpolation between two lat/lng points. */
function slerpLL(a: LL, b: LL, e: number): LL {
  const av: [number, number, number] = [
    Math.cos(a.lat * toRad) * Math.cos(a.lng * toRad),
    Math.cos(a.lat * toRad) * Math.sin(a.lng * toRad),
    Math.sin(a.lat * toRad),
  ];
  const bv: [number, number, number] = [
    Math.cos(b.lat * toRad) * Math.cos(b.lng * toRad),
    Math.cos(b.lat * toRad) * Math.sin(b.lng * toRad),
    Math.sin(b.lat * toRad),
  ];
  const dot = Math.max(-1, Math.min(1, av[0] * bv[0] + av[1] * bv[1] + av[2] * bv[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return { lat: b.lat, lng: b.lng };
  const s0 = Math.sin((1 - e) * omega) / Math.sin(omega);
  const s1 = Math.sin(e * omega) / Math.sin(omega);
  const x = av[0] * s0 + bv[0] * s1;
  const y = av[1] * s0 + bv[1] * s1;
  const z = av[2] * s0 + bv[2] * s1;
  return { lat: Math.atan2(z, Math.hypot(x, y)) * toDeg, lng: Math.atan2(y, x) * toDeg };
}

interface Pov {
  lat: number;
  lng: number;
  altitude: number;
}

/** Builds a pure time → camera-pose function describing the whole reel flight. */
function makeCameraPath(stops: SortedDestination[], segMs: number, overviewLng: number) {
  const n = stops.length;
  const overview: LL = { lat: OVERVIEW_LAT, lng: overviewLng };
  const stopsEnd = INTRO_MS + n * segMs;

  return function povAt(t: number): Pov {
    // Intro: slow drift over the overview while the title is up.
    if (t < INTRO_MS) {
      const p = t / INTRO_MS;
      return { lat: OVERVIEW_LAT, lng: overviewLng + (p - 0.5) * 12, altitude: OVERVIEW_ALT };
    }

    // Outro: pull back out to the overview and hold for the stats card.
    if (t >= stopsEnd) {
      const e = easeInOut(Math.min(1, (t - stopsEnd) / (OUTRO_MS * 0.5)));
      const pos = slerpLL(stops[n - 1], overview, e);
      const alt = ARRIVE_ALT + (OVERVIEW_ALT - ARRIVE_ALT) * e + Math.sin(Math.PI * e) * 0.3;
      return { lat: pos.lat, lng: pos.lng, altitude: alt };
    }

    // A place segment: fly from the previous anchor to this stop, then hold.
    const k = Math.min(n - 1, Math.floor((t - INTRO_MS) / segMs));
    const local = (t - INTRO_MS - k * segMs) / segMs; // 0..1 within the segment
    const from: LL = k === 0 ? overview : stops[k - 1];
    const to: LL = stops[k];

    const travel = Math.min(1, local / TRAVEL_FRAC);
    const e = easeInOut(travel);
    const pos = slerpLL(from, to, e);

    const startAlt = k === 0 ? OVERVIEW_ALT : ARRIVE_ALT;
    const baseAlt = startAlt + (ARRIVE_ALT - startAlt) * e;
    const hump = Math.min(MAX_HUMP, (angDistDeg(from, to) / 180) * HUMP_SCALE);
    const alt = baseAlt + Math.sin(Math.PI * travel) * hump;

    return { lat: pos.lat, lng: pos.lng, altitude: alt };
  };
}

// Minimal structural types for the WebCodecs bits we touch, so we don't depend
// on the WebCodecs TS lib being present.
interface VideoEncoderLike {
  configure(cfg: Record<string, unknown>): void;
  encode(frame: VideoFrameLike, opts?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  readonly encodeQueueSize: number;
}
interface VideoFrameLike {
  close(): void;
}
type VideoEncoderCtor = new (init: {
  output: (chunk: unknown, meta: unknown) => void;
  error: (e: unknown) => void;
}) => VideoEncoderLike;
type VideoFrameCtor = new (
  src: CanvasImageSource,
  init: { timestamp: number; duration?: number }
) => VideoFrameLike;
interface VideoEncoderStatic {
  isConfigSupported?: (cfg: Record<string, unknown>) => Promise<{ supported?: boolean }>;
}

function getVideoEncoder(): (VideoEncoderCtor & VideoEncoderStatic) | undefined {
  return (globalThis as unknown as { VideoEncoder?: VideoEncoderCtor & VideoEncoderStatic })
    .VideoEncoder;
}
function getVideoFrame(): VideoFrameCtor | undefined {
  return (globalThis as unknown as { VideoFrame?: VideoFrameCtor }).VideoFrame;
}

/** Picks a supported H.264 codec string for WebCodecs, or null if unavailable. */
async function pickAvcCodec(): Promise<string | null> {
  const VE = getVideoEncoder();
  if (!VE || typeof VE.isConfigSupported !== 'function' || !getVideoFrame()) return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f']) {
    try {
      const res = await VE.isConfigSupported({
        codec,
        width: W,
        height: H,
        bitrate: 10_000_000,
        framerate: FPS,
      });
      if (res?.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return null;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export interface ReelResult {
  blob: Blob;
  mimeType: string;
  ext: string;
}

export type ReelProgress = (label: string, pct: number) => void;

export function reelSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    !!pickMime()
  );
}

function pickMime(): { mimeType: string; ext: string } | null {
  const candidates = [
    { mimeType: 'video/mp4;codecs=h264', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
}

function fmtKm(km: number): string {
  if (km < 1000) return `${Math.round(km)} KM`;
  return `${(km / 1000).toFixed(1)}K KM`;
}

function flagEmoji(cc: string): string {
  const code = (cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw `img` to fill the rect, cropping the overflow (object-fit: cover). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (!img.width || !img.height) return;
  const ir = img.width / img.height;
  const rr = w / h;
  let sw: number;
  let sh: number;
  let sx: number;
  let sy: number;
  if (ir > rr) {
    sh = img.height;
    sw = sh * rr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / rr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, x, y, w, h);
}

function fadeGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fromAlpha: number,
  toAlpha: number
) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(4,7,13,${fromAlpha})`);
  g.addColorStop(1, `rgba(4,7,13,${toAlpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function watermark(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.font = '600 26px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CYAN;
  ctx.fillText('✦', 56, 74);
  ctx.fillStyle = 'rgba(234,246,255,0.92)';
  ctx.fillText('TRAVEL TIMELINE', 92, 76);
  ctx.restore();
}

/**
 * Runs the whole reel: drives the camera, composites every frame, records, and
 * resolves with the encoded video blob.
 */
export async function recordReel(
  globe: GlobeInstance,
  destinations: SortedDestination[],
  onProgress?: ReelProgress
): Promise<ReelResult> {
  const mime = pickMime();
  if (!mime) throw new Error('Video recording is not supported on this device.');

  // EVERY place you've been, in order.
  const stops = destinations.filter(
    (d) => Number.isFinite(d.lat) && Number.isFinite(d.lng)
  );
  if (stops.length < 2) throw new Error('Need at least two places to make a reel.');

  // Preload every stop's hero photo up front (bounded concurrency to avoid a
  // memory/bridge spike) so nothing has to load mid-recording and stall a frame.
  onProgress?.('Preparing photos…', 1);
  const images = new Map<string, HTMLImageElement>();
  let loaded = 0;
  let cursor = 0;
  const loadWorker = async () => {
    while (cursor < stops.length) {
      const d = stops[cursor++];
      const ref = d.serverPhotos?.[0];
      if (ref) {
        try {
          const src = await loadPhotoSrc(ref, REEL_PHOTO_WIDTH);
          images.set(d.id, await loadImage(src));
        } catch {
          /* a stop without a usable photo just shows the globe */
        }
      }
      loaded++;
      onProgress?.('Preparing photos…', Math.round((loaded / stops.length) * 10));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PRELOAD_CONCURRENCY, stops.length) }, loadWorker)
  );

  try {
    await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* fonts are best-effort */
  }

  // Trip-wide stats for the outro card.
  const countries = uniqueCountries(destinations).length;
  const cities = uniqueCities(destinations).length;
  const distance = totalDistance(destinations);
  const flags = [
    ...new Set(
      destinations
        .map((d) => flagEmoji(d.countryCode))
        .filter((f) => f.length > 0)
    ),
  ].slice(0, 18);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const renderer = globe.renderer() as THREE.WebGLRenderer;
  const scene = globe.scene() as THREE.Scene;
  const cam = globe.camera() as THREE.Camera;
  const glCanvas = renderer.domElement;

  // Pace: spread the per-place time across the whole trip so it never drags.
  const segMs = Math.round(
    Math.max(MIN_SEG_MS, Math.min(MAX_SEG_MS, STOPS_BUDGET_MS / stops.length))
  );
  const overviewLng = avgLng(stops);
  const stopsEnd = INTRO_MS + stops.length * segMs;
  const totalMs = stopsEnd + OUTRO_MS;
  const povAt = makeCameraPath(stops, segMs, overviewLng);

  // Renders one frame for virtual time `t`: deterministically poses the camera,
  // draws the globe, then composites the photo card / titles on top.
  const renderFrame = (t: number) => {
    const pov = povAt(t);
    globe.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: pov.altitude }, 0);
    renderer.render(scene, cam);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    if (t < INTRO_MS) {
      drawIntro(ctx, glCanvas, t / INTRO_MS, countries, cities);
    } else if (t < stopsEnd) {
      const seg = Math.min(stops.length - 1, Math.floor((t - INTRO_MS) / segMs));
      const lt = (t - INTRO_MS - seg * segMs) / segMs;
      drawStop(ctx, glCanvas, stops[seg], images.get(stops[seg].id), lt, seg, stops.length);
    } else {
      const lt = Math.min(1, (t - stopsEnd) / OUTRO_MS);
      drawOutro(ctx, glCanvas, lt, countries, cities, distance, flags);
    }
  };

  // ── Offline, frame-perfect encode (no lag, ignores device speed) ──────────
  const encodeWithWebCodecs = async (codec: string): Promise<ReelResult> => {
    const VE = getVideoEncoder()!;
    const VF = getVideoFrame()!;
    const frameCount = Math.max(1, Math.round((totalMs / 1000) * FPS));
    const usPerFrame = 1_000_000 / FPS;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory',
    });
    let encErr: unknown = null;
    const encoder = new VE({
      output: (chunk, meta) =>
        (muxer as unknown as { addVideoChunk: (c: unknown, m: unknown) => void }).addVideoChunk(
          chunk,
          meta
        ),
      error: (e) => {
        encErr = e;
      },
    });
    encoder.configure({ codec, width: W, height: H, bitrate: 10_000_000, framerate: FPS });

    for (let i = 0; i < frameCount; i++) {
      if (encErr) throw encErr;
      renderFrame((i / FPS) * 1000);
      const vf = new VF(canvas, {
        timestamp: Math.round(i * usPerFrame),
        duration: Math.round(usPerFrame),
      });
      encoder.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
      vf.close();
      onProgress?.('Rendering…', Math.min(98, 10 + Math.round((i / frameCount) * 86)));

      // Bound the encoder queue and let the page breathe so the UI stays alive.
      if (encoder.encodeQueueSize > 24) {
        while (encoder.encodeQueueSize > 8) await nextFrame();
      } else if ((i & 7) === 0) {
        await nextFrame();
      }
    }

    await encoder.flush();
    (muxer as unknown as { finalize: () => void }).finalize();
    if (encErr) throw encErr;
    const buffer = (muxer.target as ArrayBufferTarget).buffer;
    onProgress?.('Finishing…', 100);
    return { blob: new Blob([buffer], { type: 'video/mp4' }), mimeType: 'video/mp4', ext: 'mp4' };
  };

  // ── Real-time fallback (older devices without WebCodecs) ──────────────────
  const encodeWithRecorder = (): Promise<ReelResult> => {
    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime.mimeType,
      videoBitsPerSecond: 12_000_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    return new Promise<ReelResult>((resolve, reject) => {
      recorder.onstop = () =>
        resolve({
          blob: new Blob(chunks, { type: mime.mimeType }),
          mimeType: mime.mimeType,
          ext: mime.ext,
        });
      recorder.onerror = () => reject(new Error('Recording failed.'));
      recorder.start();
      const begin = performance.now();
      const frame = () => {
        const t = performance.now() - begin;
        if (t >= totalMs) {
          try {
            recorder.stop();
          } catch {
            /* already stopped */
          }
          return;
        }
        renderFrame(t);
        onProgress?.('Recording…', Math.min(99, 10 + Math.round((t / totalMs) * 89)));
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  };

  // Record against the bundled base Earth texture, NOT the streamed satellite
  // tiles. The tile engine only loads imagery for wherever the camera is looking
  // right now; as the scripted camera flies around the globe — especially in the
  // fast offline render — tiles for newly-entered regions haven't streamed in
  // yet, leaving the far side of the globe BLACK. The day texture is always
  // present and lit everywhere, so the globe is solid in every frame. Restored
  // in the finally below.
  const tiles = globe as unknown as TileToggle;
  const prevTileUrl =
    typeof tiles.globeTileEngineUrl === 'function' ? tiles.globeTileEngineUrl() : undefined;
  const canToggleTiles = typeof prevTileUrl === 'string' && prevTileUrl.length > 0;
  if (canToggleTiles) tiles.globeTileEngineUrl!('');
  useUiStore.getState().setCinematic(true);

  // Let the globe apply the texture swap (kapsule digests props on a frame)
  // before the first captured frame.
  await nextFrame();
  await nextFrame();
  renderFrame(0);

  try {
    const codec = await pickAvcCodec();
    return codec ? await encodeWithWebCodecs(codec) : await encodeWithRecorder();
  } finally {
    if (canToggleTiles) tiles.globeTileEngineUrl!(prevTileUrl as string);
    useUiStore.getState().setCinematic(false);
  }
}

function avgLng(stops: SortedDestination[]): number {
  // Circular mean so the overview isn't thrown off by the ±180 seam.
  let x = 0;
  let y = 0;
  for (const s of stops) {
    x += Math.cos((s.lng * Math.PI) / 180);
    y += Math.sin((s.lng * Math.PI) / 180);
  }
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// ── Phase compositors ──────────────────────────────────────────────────────

function drawIntro(
  ctx: CanvasRenderingContext2D,
  gl: HTMLCanvasElement,
  p: number,
  countries: number,
  cities: number
) {
  drawCover(ctx, gl, 0, 0, W, H);
  // Cinematic darkening so the title reads.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(4,7,13,0.55)');
  g.addColorStop(0.5, 'rgba(4,7,13,0.35)');
  g.addColorStop(1, 'rgba(4,7,13,0.8)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const a = clamp01(p * 1.6);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = CYAN;
  ctx.fillText('MY TRAVEL STORY', W / 2, H / 2 - 120);

  ctx.font = '800 132px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#eaf6ff';
  ctx.shadowColor = 'rgba(56,225,255,0.5)';
  ctx.shadowBlur = 40;
  ctx.fillText('AROUND', W / 2, H / 2 + 10);
  ctx.fillText('THE WORLD', W / 2, H / 2 + 150);
  ctx.shadowBlur = 0;

  ctx.font = '500 34px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(180,210,230,0.95)';
  ctx.fillText(`${countries} COUNTRIES · ${cities} CITIES`, W / 2, H / 2 + 280);
  ctx.restore();

  watermark(ctx);
}

function drawStop(
  ctx: CanvasRenderingContext2D,
  gl: HTMLCanvasElement,
  stop: SortedDestination,
  img: HTMLImageElement | undefined,
  lt: number,
  index: number,
  count: number
) {
  // Globe fills the top, fading into the background above the photo card.
  const globeH = 1180;
  drawCover(ctx, gl, 0, 0, W, globeH);
  fadeGradient(ctx, 0, globeH - 320, W, 320, 0, 1);

  // Photo card.
  const cardX = 56;
  const cardY = 1060;
  const cardW = W - cardX * 2;
  const cardH = 700;
  const appear = easeOut(clamp01(lt * 4)); // ease in over the first ~25% of the segment

  ctx.save();
  ctx.globalAlpha = appear;
  // Soft shadow behind the card.
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.fillStyle = '#0a121c';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Clip to the rounded card and draw the photo.
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.clip();
  if (img) {
    drawCover(ctx, img, cardX, cardY, cardW, cardH);
  } else {
    const g = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
    g.addColorStop(0, '#14202e');
    g.addColorStop(1, '#0a121c');
    ctx.fillStyle = g;
    ctx.fillRect(cardX, cardY, cardW, cardH);
  }

  // Caption scrim + text inside the card.
  fadeGradient(ctx, cardX, cardY + cardH - 230, cardW, 230, 0, 0.92);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '800 70px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  const place = (stop.city || stop.country || 'Unknown').toUpperCase();
  ctx.fillText(place, cardX + 44, cardY + cardH - 96, cardW - 88);

  ctx.font = '500 30px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = CYAN;
  const sub = [stop.city ? stop.country.toUpperCase() : '', fmtDate(stop.arrivalDate)]
    .filter(Boolean)
    .join('  ·  ');
  ctx.fillText(sub, cardX + 46, cardY + cardH - 48);
  ctx.restore();

  // Cyan hairline frame.
  ctx.save();
  ctx.globalAlpha = appear;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.strokeStyle = 'rgba(56,225,255,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Progress bar (scales to any number of stops).
  const barX = 120;
  const barW = W - barX * 2;
  const barY = 1816;
  const barH = 6;
  roundRectPath(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
  const prog = count > 0 ? (index + Math.min(1, lt)) / count : 1;
  roundRectPath(ctx, barX, barY, Math.max(barH, barW * Math.min(1, prog)), barH, barH / 2);
  ctx.fillStyle = CYAN;
  ctx.fill();

  watermark(ctx);
}

function drawOutro(
  ctx: CanvasRenderingContext2D,
  gl: HTMLCanvasElement,
  lt: number,
  countries: number,
  cities: number,
  distance: number,
  flags: string[]
) {
  drawCover(ctx, gl, 0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(4,7,13,0.82)');
  g.addColorStop(1, 'rgba(4,7,13,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const a = clamp01(lt * 2.2);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';

  ctx.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = CYAN;
  ctx.textBaseline = 'middle';
  ctx.fillText('THE NUMBERS', W / 2, 360);

  const stats: Array<[string, string]> = [
    [String(countries), 'COUNTRIES'],
    [String(cities), 'CITIES'],
    [fmtKm(distance), 'TRAVELED'],
  ];
  let y = 560;
  for (const [value, lbl] of stats) {
    ctx.font = '800 120px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#eaf6ff';
    ctx.shadowColor = 'rgba(56,225,255,0.45)';
    ctx.shadowBlur = 32;
    ctx.fillText(value, W / 2, y);
    ctx.shadowBlur = 0;
    ctx.font = '500 32px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(180,210,230,0.9)';
    ctx.fillText(lbl, W / 2, y + 78);
    y += 230;
  }

  // Flag badges.
  if (flags.length) {
    ctx.font = '64px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    const perRow = 6;
    const cell = 86;
    const rows = Math.ceil(flags.length / perRow);
    const startY = y + 40;
    for (let i = 0; i < flags.length; i++) {
      const r = Math.floor(i / perRow);
      const inRow = Math.min(perRow, flags.length - r * perRow);
      const rowStartX = W / 2 - ((inRow - 1) * cell) / 2;
      const col = i - r * perRow;
      ctx.fillText(flags[i], rowStartX + col * cell, startY + r * cell);
    }
    void rows;
  }
  ctx.restore();

  watermark(ctx);
}
