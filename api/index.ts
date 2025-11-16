// Vercel serverless function entry point
// NOTE: WebSocket support is NOT available in Vercel serverless functions
// For WebSocket support, deploy to Railway, Render, or Fly.io instead

import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// API routes (WebSocket routes won't work on Vercel)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running (WebSocket not available on Vercel)' });
});

// Serve static files
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

export default app;

