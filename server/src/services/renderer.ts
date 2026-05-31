import puppeteer, { type Browser } from 'puppeteer';
import ffmpegStatic from 'ffmpeg-static';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Writable } from 'stream';

/**
 * Finds a Chrome/Chromium to drive. Puppeteer's own browser download is often
 * missing (it isn't installed by `npm install` unless configured), so we fall
 * back to a system Chrome — which most macOS users already have. Override with
 * PUPPETEER_EXECUTABLE_PATH if Chrome lives somewhere unusual.
 */
function resolveChromeExecutable(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    // Puppeteer's bundled browser, if it actually got installed.
    (() => {
      try {
        return puppeteer.executablePath();
      } catch {
        return undefined;
      }
    })(),
    // Common macOS install locations.
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Common Linux locations.
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  throw new Error(
    'No Chrome found for video rendering. Install Google Chrome, or run ' +
      '`npx puppeteer browsers install chrome` in the server folder, or set ' +
      'PUPPETEER_EXECUTABLE_PATH to your Chrome binary.'
  );
}

/**
 * Resolves an FFmpeg binary. Prefers the bundled `ffmpeg-static` download so
 * the feature works with zero setup; falls back to a system ffmpeg on PATH or
 * an explicit FFMPEG_PATH override.
 */
function resolveFfmpeg(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    ffmpegStatic as string | null,
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Last resort: hope it's on PATH.
  return 'ffmpeg';
}

export interface RenderOptions {
  destinations: Array<{
    id: string;
    city: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
    arrivalDate: string;
    departureDate: string;
    tripId: string;
    tripName: string;
  }>;
  width?: number;
  height?: number;
  fps?: number;
  /** Milliseconds to wait per destination for the camera transition */
  transitionMs?: number;
  /** URL of the client app render page */
  clientUrl?: string;
}

/** Common Chrome flags shared by both the GPU and software render paths. */
function baseArgs(width: number, height: number): string[] {
  return [
    `--window-size=${width},${height}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--ignore-gpu-blocklist',
    // Avoid renderer crashes from a too-small /dev/shm during long captures.
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--mute-audio',
  ];
}

/**
 * Hardware-accelerated path. On Apple Silicon, Chrome's ANGLE backend drives
 * the real Metal GPU here, which renders the heavy 8k-texture globe roughly an
 * order of magnitude faster than software WebGL.
 */
function gpuArgs(width: number, height: number): string[] {
  return [...baseArgs(width, height), '--enable-gpu'];
}

/**
 * Software fallback path. Forces SwiftShader so WebGL still initializes when no
 * usable GPU is available (e.g. headless Linux/CI). Recent Chrome refuses
 * software WebGL unless explicitly allowed — without these flags the WebGL
 * context never initializes and the tab crashes ("frame got detached").
 */
function softwareArgs(width: number, height: number): string[] {
  return [
    ...baseArgs(width, height),
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ];
}

/**
 * A render produced via a working WebGL context contains the globe and is a
 * fairly large image. A failed/blank context yields a near-uniform dark frame
 * that compresses to only a few KB. We use a generous PNG-size threshold to
 * detect the blank case and trigger the software fallback.
 */
const BLANK_FRAME_PNG_BYTES = 30_000;

export async function renderVideo(
  options: RenderOptions,
  onProgress?: (pct: number) => void
): Promise<Buffer> {
  const { destinations, width = 1920, height = 1080 } = options;

  if (destinations.length < 2) {
    throw new Error('Need at least 2 destinations to render a video');
  }

  // Escape hatch for environments without a usable GPU (CI, some servers) or
  // for debugging: skip straight to software rendering.
  if (process.env.RENDER_FORCE_SOFTWARE === '1') {
    return await renderWithArgs(softwareArgs(width, height), 'software', options, onProgress);
  }

  // Try the fast GPU path first. If the WebGL context fails to initialize or
  // renders blank frames, retry with software rendering so we never regress to
  // a broken/blank video.
  try {
    return await renderWithArgs(gpuArgs(width, height), 'gpu', options, onProgress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[renderer] GPU render path failed (${message}); falling back to software WebGL.`
    );
    return await renderWithArgs(softwareArgs(width, height), 'software', options, onProgress);
  }
}

/**
 * Performs a full render with a given set of Chrome flags. Frames are captured
 * as JPEG and streamed straight into FFmpeg's stdin (no thousands of PNGs on
 * disk). Throws if the WebGL context appears non-functional so the caller can
 * fall back to software rendering.
 */
async function renderWithArgs(
  args: string[],
  label: 'gpu' | 'software',
  options: RenderOptions,
  onProgress?: (pct: number) => void
): Promise<Buffer> {
  const {
    destinations,
    width = 1920,
    height = 1080,
    fps = 30,
    transitionMs = 2000,
    clientUrl = 'http://localhost:5173/render',
  } = options;

  const framesPerTransition = Math.round((transitionMs / 1000) * fps);
  const startHold = Math.round(fps / 2);
  const endHold = fps;
  const totalFrames = startHold + (destinations.length - 1) * framesPerTransition + endHold;

  const tmpDir = await mkdtemp(join(tmpdir(), 'tt-render-'));
  const outputPath = join(tmpDir, 'output.mp4');

  let browser: Browser | null = null;
  let ffmpeg: ChildProcessWithoutNullStreams | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: resolveChromeExecutable(),
      args,
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // Surface renderer crashes instead of hanging until a timeout.
    let pageCrashed: string | null = null;
    page.on('error', (e) => {
      pageCrashed = e.message;
    });

    // Inject render data before navigating (runs in browser context)
    await page.evaluateOnNewDocument(
      (data: unknown[], w: number, h: number) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (window as any).__RENDER_DATA__ = data;
        (window as any).__RENDER_WIDTH__ = w;
        (window as any).__RENDER_HEIGHT__ = h;
      },
      destinations as unknown[],
      width,
      height
    );

    await page.goto(clientUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for globe to be ready (WebGL context + textures loaded)
    await page.waitForFunction('window.__GLOBE_READY__ === true', { timeout: 30000 });

    if (pageCrashed) {
      throw new Error(`Renderer crashed during init: ${pageCrashed}`);
    }

    // Wait for the page's deterministic "first frame painted" signal rather
    // than a fixed wall-clock sleep.
    await page
      .waitForFunction('window.__FRAME_READY__ === true', { timeout: 10000 })
      .catch(() => {});

    // Blank-render guard: if the WebGL context silently failed, the frame is a
    // near-uniform dark image that compresses tiny. Bail so we can fall back.
    const probe = (await page.screenshot({ type: 'png' })) as Buffer;
    if (probe.length < BLANK_FRAME_PNG_BYTES) {
      throw new Error(
        `Render appears blank (${probe.length} bytes), WebGL likely non-functional`
      );
    }

    // Start FFmpeg reading JPEG frames from stdin (image2pipe). Encoding runs
    // concurrently with capture, and we avoid writing any intermediate PNGs.
    ffmpeg = spawn(resolveFfmpeg(), [
      '-y',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-i', 'pipe:0',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '23',
      '-movflags', '+faststart',
      outputPath,
    ]);

    let ffmpegStderr = '';
    ffmpeg.stderr.on('data', (d: Buffer) => {
      ffmpegStderr += d.toString();
    });
    const ffmpegDone = new Promise<void>((resolve, reject) => {
      ffmpeg!.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}: ${ffmpegStderr.slice(-500)}`));
      });
      ffmpeg!.on('error', (e) => reject(new Error(`Failed to spawn FFmpeg: ${e.message}`)));
    });
    // Don't let an FFmpeg-side error crash the process via an unhandled EPIPE.
    ffmpeg.stdin.on('error', () => {});

    let frameNum = 0;
    const captureFrame = async () => {
      const jpeg = (await page.screenshot({ type: 'jpeg', quality: 90 })) as Buffer;
      await writeToStream(ffmpeg!.stdin, jpeg);
      frameNum++;
      if (onProgress && frameNum % 5 === 0) {
        // Reserve the top 10% for FFmpeg flush/finalize.
        onProgress(Math.min(90, Math.round((frameNum / totalFrames) * 90)));
      }
    };

    // Hold on the first destination.
    for (let f = 0; f < startHold; f++) await captureFrame();

    // Advance through each subsequent destination.
    for (let i = 1; i < destinations.length; i++) {
      await page.evaluate(() => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (window as any).__FRAME_READY__ = false;
        const fn = (window as any).__advanceFrame__ as (() => void) | undefined;
        if (fn) fn();
      });

      // Wait on the deterministic frame-painted signal (camera jump + visuals
      // updated) instead of a fixed settle delay.
      await page.waitForFunction('window.__FRAME_READY__ === true', { timeout: 10000 });

      if (pageCrashed) throw new Error(`Renderer crashed mid-capture: ${pageCrashed}`);

      for (let f = 0; f < framesPerTransition; f++) await captureFrame();
    }

    // Hold the final frame.
    for (let f = 0; f < endHold; f++) await captureFrame();

    // Finalize encoding.
    ffmpeg.stdin.end();
    await ffmpegDone;

    if (onProgress) onProgress(95);

    await browser.close();
    browser = null;

    const videoBuffer = await readFile(outputPath);
    await rm(tmpDir, { recursive: true, force: true });

    if (onProgress) onProgress(100);
    console.log(`[renderer] ${label} path produced ${frameNum} frames -> ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    return videoBuffer;
  } catch (error) {
    if (ffmpeg) {
      try {
        ffmpeg.stdin.destroy();
        ffmpeg.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    if (browser) await browser.close().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Writes a chunk to a stream, awaiting drain to respect backpressure. */
function writeToStream(stream: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (err) => {
      if (err) reject(err);
    });
    if (ok) {
      resolve();
    } else {
      stream.once('drain', resolve);
    }
  });
}
