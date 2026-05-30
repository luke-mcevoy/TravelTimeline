import { Router, type Request, type Response } from 'express';
import { renderVideo, type RenderOptions } from '../services/renderer.js';

export const videoRouter = Router();

videoRouter.post('/render-video', async (req: Request, res: Response) => {
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
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (pct: number) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', pct })}\n\n`);
    };

    sendProgress(0);

    const videoBuffer = await renderVideo(options, sendProgress);

    res.write(
      `data: ${JSON.stringify({
        type: 'complete',
        size: videoBuffer.length,
      })}\n\n`
    );

    res.end();

    // The client will make a second request to download the actual file
    // Store it temporarily
    videoCache.set(req.ip || 'default', {
      buffer: videoBuffer,
      createdAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Render failed:', message);

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      res.end();
    }
  }
});

videoRouter.get('/download-video', (req: Request, res: Response) => {
  const entry = videoCache.get(req.ip || 'default');
  if (!entry) {
    res.status(404).json({ error: 'No video available. Render one first.' });
    return;
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="travel-timeline.mp4"');
  res.setHeader('Content-Length', entry.buffer.length);
  res.send(entry.buffer);

  videoCache.delete(req.ip || 'default');
});

// Simple in-memory cache for rendered videos (auto-expire after 5 min)
const videoCache = new Map<string, { buffer: Buffer; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of videoCache) {
    if (now - val.createdAt > 5 * 60 * 1000) {
      videoCache.delete(key);
    }
  }
}, 60_000);
