import type { GlobeInstance } from 'globe.gl';
import type * as THREE from 'three';
import type { SortedDestination } from '@/types';
import { loadPhotoSrc } from '@/services/photoSource';
import { flyToDestination } from '@/utils/camera';
import { totalDistance, uniqueCountries, uniqueCities } from '@/utils/animation';

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
// Fast 4×-style pace through EVERY place. Short dwell + fast flights so even a
// long trip stays watchable.
const INTRO_MS = 1600;
const SEG_MS = 650;
const OUTRO_MS = 3000;
const FLY_SPEED = 6;
// Modest photo size: the card is small and the dwell is brief, and we hold one
// decoded image per place in memory, so this keeps total memory in check.
const REEL_PHOTO_WIDTH = 720;
const PRELOAD_CONCURRENCY = 6;

const CYAN = '#38e1ff';
const BG = '#04070d';

// While recording we lock the satellite tiles to a low, fixed level. Streaming
// deep tiles as the camera flies is the #1 source of visible glitches in the
// captured video; a fixed coarse level means the imagery never pops or reloads.
const REEL_TILE_LEVEL = 5;

type ReelGlobe = GlobeInstance & {
  // Called with an arg to set, without to read the current value.
  globeTileEngineMaxLevel?: (level?: number) => unknown;
};

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

  // Lock the satellite tiles to a coarse, fixed level so they never stream or
  // pop mid-flight — the #1 cause of glitches in the captured video. Restored
  // after recording (in the finally below).
  const reelGlobe = globe as ReelGlobe;
  const prevTileLevel = (reelGlobe.globeTileEngineMaxLevel?.() as number) ?? 18;
  reelGlobe.globeTileEngineMaxLevel?.(REEL_TILE_LEVEL);

  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mimeType,
    videoBitsPerSecond: 12_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const total = INTRO_MS + stops.length * SEG_MS + OUTRO_MS;
  const overviewLng = avgLng(stops);

  // Calm overview during the intro.
  globe.pointOfView({ lat: 18, lng: overviewLng, altitude: 2.5 }, INTRO_MS);

  try {
    return await new Promise<ReelResult>((resolve, reject) => {
      recorder.onstop = () =>
        resolve({
          blob: new Blob(chunks, { type: mime.mimeType }),
          mimeType: mime.mimeType,
          ext: mime.ext,
        });
      recorder.onerror = () => reject(new Error('Recording failed.'));

      recorder.start();
      const begin = performance.now();
      let startedSeg = -1; // -1 = intro, 0..n-1 stops, n = outro

      const frame = () => {
        const t = performance.now() - begin;
        if (t >= total) {
          try {
            recorder.stop();
          } catch {
            /* already stopped */
          }
          return;
        }

        // Decide phase and trigger the camera move once per segment boundary.
        let label = 'Recording…';
        if (t < INTRO_MS) {
          label = 'Intro';
        } else if (t < INTRO_MS + stops.length * SEG_MS) {
          const seg = Math.floor((t - INTRO_MS) / SEG_MS);
          if (seg !== startedSeg) {
            startedSeg = seg;
            flyToDestination(globe, stops[seg], { speed: FLY_SPEED });
          }
        } else if (startedSeg !== stops.length) {
          startedSeg = stops.length;
          globe.pointOfView({ lat: 18, lng: overviewLng, altitude: 2.8 }, OUTRO_MS);
        }

        // Force a fresh render so the WebGL backbuffer is valid for drawImage
        // even without preserveDrawingBuffer (we read it synchronously here).
        renderer.render(scene, cam);

        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);

        if (t < INTRO_MS) {
          drawIntro(ctx, glCanvas, t / INTRO_MS, countries, cities);
        } else if (t < INTRO_MS + stops.length * SEG_MS) {
          const seg = Math.floor((t - INTRO_MS) / SEG_MS);
          const lt = (t - INTRO_MS - seg * SEG_MS) / SEG_MS;
          drawStop(ctx, glCanvas, stops[seg], images.get(stops[seg].id), lt, seg, stops.length);
        } else {
          const lt = (t - INTRO_MS - stops.length * SEG_MS) / OUTRO_MS;
          drawOutro(ctx, glCanvas, lt, countries, cities, distance, flags);
        }

        onProgress?.(label, Math.min(100, 10 + Math.round((t / total) * 90)));
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  } finally {
    // Restore full tile detail for normal interaction.
    reelGlobe.globeTileEngineMaxLevel?.(prevTileLevel);
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
