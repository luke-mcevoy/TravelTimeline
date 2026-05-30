import puppeteer from 'puppeteer';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

export async function renderVideo(
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

  if (destinations.length < 2) {
    throw new Error('Need at least 2 destinations to render a video');
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'tt-render-'));
  const framesDir = join(tmpDir, 'frames');
  await writeFile(join(framesDir, '.keep'), '', { recursive: true } as never).catch(() => null);
  const { mkdir } = await import('fs/promises');
  await mkdir(framesDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromeExecutable(),
    args: [
      `--window-size=${width},${height}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // The globe is WebGL. In headless Chrome there's no real GPU, so we must
      // render through software (SwiftShader). Recent Chrome refuses software
      // WebGL unless explicitly allowed — without these flags the WebGL context
      // never initializes and the tab crashes ("frame got detached").
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
      // Avoid renderer crashes from a too-small /dev/shm during long captures.
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

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

    // Wait for globe to be ready
    await page.waitForFunction('window.__GLOBE_READY__ === true', {
      timeout: 30000,
    });

    // Extra time for WebGL to settle
    await new Promise((r) => setTimeout(r, 1000));

    const framesPerTransition = Math.round((transitionMs / 1000) * fps);
    const totalFrames = (destinations.length - 1) * framesPerTransition + fps; // +1sec hold at end
    let frameNum = 0;

    // Capture first destination
    for (let f = 0; f < Math.round(fps / 2); f++) {
      const padded = String(frameNum++).padStart(6, '0');
      await page.screenshot({
        path: join(framesDir, `frame_${padded}.png`),
        type: 'png',
      });
    }

    // Advance through each destination
    for (let i = 1; i < destinations.length; i++) {
      // Reset frame-ready flag and advance
      await page.evaluate(() => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (window as any).__FRAME_READY__ = false;
        const fn = (window as any).__advanceFrame__ as (() => void) | undefined;
        if (fn) fn();
      });

      // Wait for frame to be ready
      await page.waitForFunction('window.__FRAME_READY__ === true', {
        timeout: 10000,
      });

      // Wait for the camera to finish moving
      await new Promise((r) => setTimeout(r, 200));

      // Capture multiple frames at this position
      for (let f = 0; f < framesPerTransition; f++) {
        const padded = String(frameNum++).padStart(6, '0');
        await page.screenshot({
          path: join(framesDir, `frame_${padded}.png`),
          type: 'png',
        });
      }

      if (onProgress) {
        onProgress(Math.round((i / destinations.length) * 80));
      }
    }

    // Hold last frame for 1 second
    for (let f = 0; f < fps; f++) {
      const padded = String(frameNum++).padStart(6, '0');
      await page.screenshot({
        path: join(framesDir, `frame_${padded}.png`),
        type: 'png',
      });
    }

    await browser.close();

    if (onProgress) onProgress(85);

    // Encode with FFmpeg
    const outputPath = join(tmpDir, 'output.mp4');
    await encodeFrames(framesDir, outputPath, fps, width, height);

    if (onProgress) onProgress(95);

    const { readFile } = await import('fs/promises');
    const videoBuffer = await readFile(outputPath);

    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });

    if (onProgress) onProgress(100);

    return videoBuffer;
  } catch (error) {
    await browser.close().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function encodeFrames(
  framesDir: string,
  outputPath: string,
  fps: number,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(resolveFfmpeg(), [
      '-y',
      '-framerate', String(fps),
      '-i', join(framesDir, 'frame_%06d.png'),
      '-vf', `scale=${width}:${height}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '23',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}
