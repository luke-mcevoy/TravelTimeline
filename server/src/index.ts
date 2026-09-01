import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { join } from 'path';
import { videoRouter } from './routes/video.js';
import { applePhotosRouter } from './routes/applePhotos.js';
import {
  PORT,
  CLIENT_DIST,
  clientBuildAvailable,
  publicClientConfig,
} from './config.js';

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

app.get('/api/config', (_req, res) => {
  res.json(publicClientConfig());
});

function injectClientConfig(html: string): string {
  const json = JSON.stringify(publicClientConfig()).replace(/</g, '\\u003c');
  const tag = `<script>window.__TT_CONFIG__=${json};</script>`;
  if (html.includes('<!--TT_CONFIG-->')) {
    return html.replace('<!--TT_CONFIG-->', tag);
  }
  return html.replace('<head>', `<head>\n    ${tag}`);
}

// Single-deployable-unit mode: when a client build exists, host it here with
// an SPA fallback (the client routes are '/' and '/render').
if (clientBuildAvailable()) {
  const indexHtml = injectClientConfig(
    readFileSync(join(CLIENT_DIST, 'index.html'), 'utf8')
  );
  app.use(express.static(CLIENT_DIST, { index: false }));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(indexHtml);
  });
  console.log(`Serving client build from ${CLIENT_DIST}`);
} else {
  console.log('No client build found; running as API only (dev mode).');
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
