import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { videoRouter } from './routes/video.js';
import { applePhotosRouter } from './routes/applePhotos.js';
import { PORT, CLIENT_DIST, clientBuildAvailable } from './config.js';

const app = express();

// CORS policy:
//   - CORS_ORIGIN set        -> allow exactly those origins (comma-separated)
//   - production, no origin  -> same-origin only (the server hosts the client)
//   - development            -> allow all (Vite dev server on another port)
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin.split(',').map((s) => s.trim()) }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.json({ limit: '50mb' }));

app.use('/api', videoRouter);
app.use('/api', applePhotosRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Single-deployable-unit mode: when a client build exists, host it here with
// an SPA fallback (the client routes are '/' and '/render').
if (clientBuildAvailable()) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.sendFile(join(CLIENT_DIST, 'index.html'));
  });
  console.log(`Serving client build from ${CLIENT_DIST}`);
} else {
  console.log('No client build found; running as API only (dev mode).');
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
