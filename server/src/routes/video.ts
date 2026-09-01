import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { renderVideo, type RenderOptions } from '../services/renderer.js';
import { renderClientUrl } from '../config.js';

export const videoRouter = Router();

// Rendering spawns a full Chrome + FFmpeg pipeline; cap concurrency so a
// handful of simultaneous requests can't exhaust the host.
const MAX_CONCURRENT_RENDERS = Number(process.env.MAX_CONCURRENT_RENDERS) || 2;
let activeRenders = 0;

videoRouter.post('/render-video', async (req: Request, res: Response) => {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    res.status(429).json({ error: 'Too many renders in progress. Try again in a minute.' });
    return;
  }

  activeRenders++;
  try {
    const { destinations, width, height, fps, speed } = req.body;

    if (!destinations || !Array.isArray(destinations) || destinations.length < 2) {
      res.status(400).json({ error: 'At least 2 destinations are required' });
      return;
    }

    const options: RenderOptions = {
      destinations,
      width: width || 1920,
      height: height || 1080,
      fps: fps || 30,
      transitionMs: speed ? 2000 / speed : 2000,
      clientUrl: renderClientUrl(),
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (pct: number) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', pct })}\n\n`);
    };

    sendProgress(0);

    const videoBuffer = await renderVideo(options, sendProgress);

    // The client downloads the file in a second request, claimed by a
    // single-use token (req.ip is unreliable behind NAT/proxies).
    const token = randomUUID();
    storeVideo(token, videoBuffer);

    res.write(
      `data: ${JSON.stringify({
        type: 'complete',
        size: videoBuffer.length,
        token,
      })}\n\n`
    );

    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Render failed:', message);

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      res.end();
    }
  } finally {
    activeRenders--;
  }
});

videoRouter.get('/download-video', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const entry = token ? videoCache.get(token) : undefined;
  if (!entry) {
    res.status(404).json({ error: 'No video available. Render one first.' });
    return;
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="travel-timeline.mp4"');
  res.setHeader('Content-Length', entry.buffer.length);
  res.send(entry.buffer);

  videoCache.delete(token);
});

// In-memory cache of rendered videos awaiting download. Entries are
// single-use, expire after 5 minutes, and the cache is bounded so queued
// videos can't exhaust memory.
const MAX_CACHED_VIDEOS = 5;
const videoCache = new Map<string, { buffer: Buffer; createdAt: number }>();

function storeVideo(token: string, buffer: Buffer) {
  while (videoCache.size >= MAX_CACHED_VIDEOS) {
    const oldest = videoCache.keys().next().value;
    if (oldest === undefined) break;
    videoCache.delete(oldest);
  }
  videoCache.set(token, { buffer, createdAt: Date.now() });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of videoCache) {
    if (now - val.createdAt > 5 * 60 * 1000) {
      videoCache.delete(key);
    }
  }
}, 60_000).unref();
