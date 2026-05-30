import { Router, type Request, type Response } from 'express';
import {
  isPhotosDbAccessible,
  inferTripsFromPhotos,
  getPhotoThumbnail,
  clearCache,
} from '../services/applePhotos.js';

export const applePhotosRouter = Router();

applePhotosRouter.get('/apple-photos/status', (_req: Request, res: Response) => {
  const status = isPhotosDbAccessible();
  res.json(status);
});

applePhotosRouter.post('/apple-photos/import', async (req: Request, res: Response) => {
  const { yearsBack = 5 } = req.body || {};

  const status = isPhotosDbAccessible();
  if (!status.accessible) {
    res.status(403).json({ error: status.error });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const trips = await inferTripsFromPhotos(yearsBack, (msg, pct) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', message: msg, pct })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ type: 'complete', trips })}\n\n`);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }
});

applePhotosRouter.get('/apple-photos/photo', async (req: Request, res: Response) => {
  const { dir, file, w } = req.query;

  if (typeof dir !== 'string' || typeof file !== 'string') {
    res.status(400).json({ error: 'Missing dir and file query parameters' });
    return;
  }

  // Prevent path traversal
  if (dir.includes('..') || file.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const width = typeof w === 'string' ? parseInt(w, 10) : 400;
  const result = await getPhotoThumbnail(dir, file, isNaN(width) ? 400 : width);

  if (!result) {
    res.status(404).json({ error: 'Photo not available locally' });
    return;
  }

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(result.buffer);
});

applePhotosRouter.post('/apple-photos/clear-cache', (_req: Request, res: Response) => {
  clearCache();
  res.json({ ok: true });
});
