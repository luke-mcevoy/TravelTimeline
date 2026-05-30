import express from 'express';
import cors from 'cors';
import { videoRouter } from './routes/video.js';
import { applePhotosRouter } from './routes/applePhotos.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api', videoRouter);
app.use('/api', applePhotosRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
