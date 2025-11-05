import express from 'express';
import { config } from 'dotenv';
import cors from 'cors';
import path from 'path';
import { errorHandler } from './util/errors';
import { log } from './util/logger';

// Load .env from root directory (parent of server folder)
// When running with ts-node-dev, __dirname is server/src, so go up two levels
// When compiled, __dirname is server/dist, so also go up two levels
const envPath = path.resolve(__dirname, '../../.env');
config({ path: envPath });

import templates from './routes/templates';
import products from './routes/products';
import uploads from './routes/uploads';
import publicFiles from './routes/publicFiles';
import dropbox from './routes/dropbox';
import googledrive from './routes/googledrive';
import tunnel from './routes/tunnel';
import { ENV } from './util/env';

const app = express();

// CORS for development
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? false 
    : 'http://localhost:5174',
  credentials: true,
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

// Config endpoint for client-side configuration (non-sensitive values only)
app.get('/api/config', (_req, res) => {
  res.json({
    dropboxAppKey: ENV.DROPBOX_APP_KEY || '', // Client ID - safe to expose
  });
});

// API routes
app.use('/api/templates', templates);
app.use('/api/products', products);
app.use('/api/uploads', uploads);
app.use('/api/dropbox', dropbox);
app.use('/api/googledrive', googledrive);
app.use('/api/tunnel', tunnel);
app.use('/public-files', publicFiles);

// Global error handler
app.use(errorHandler);

const PORT = process.env.SERVER_PORT || '5175';

app.listen(Number(PORT), () => {
  log(`Server listening on port ${PORT}`);
  log(`Health check: http://localhost:${PORT}/health`);
});

