import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { renderClientUrl, serverVideoEnabled } from '../config.js';
import type { RenderOptions } from '../services/renderer.js';

export const videoRouter = Router();

const MAX_CONCURRENT_RENDERS = Number(process.env.MAX_CONCURRENT_RENDERS) || 1;
let activeRenders = 0;

const UNAVAILABLE =
  '1080p server export needs a Mac (or a larger host). Use Share Reel — that records in the browser.';

videoRouter.post('/render-video', async (req: Request, res: Response) => {
  if (!serverVideoEnabled()) {
    res.status(503).json({ error: UNAVAILABLE });
    return;
  }

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

    const { renderVideo } = await import('../services/renderer.js');
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

const MAX_CACHED_VIDEOS = 1;
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
