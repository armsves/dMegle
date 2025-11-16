// Import error suppression first to suppress expected block range errors
import '../suppress-errors.js';

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ArkivVideoStreamer } from './video-streamer.js';
import { config } from './config.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import multer from 'multer';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });
const streamer = new ArkivVideoStreamer();

// Store active stream subscriptions
const activeSubscriptions = new Map<string, () => void>();

// Broadcast to WebSocket clients
const broadcast = (data: any) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};

// Set up global subscription for all video chunks
const setupGlobalSubscription = async () => {
  // Subscribe to all entity creations and filter for video chunks
  const publicClient = streamer.publicClient;
  
  // Subscribe to new events only (no historical queries to avoid max block range error)
  const stop = await publicClient.subscribeEntityEvents({
    onEntityCreated: async (e) => {
      try {
        const entity = await publicClient.getEntity(e.entityKey);
        const attrs = Object.fromEntries(
          entity.attributes.map(a => [a.key, a.value])
        );

        if (attrs.type === 'video-chunk') {
          const chunkIndex = parseInt(String(attrs.chunkIndex || '0'), 10);
          console.log(`[Chunk Received] Stream: ${attrs.streamId}, Index: ${chunkIndex}`);
          broadcast({
            type: 'chunk:received',
            streamId: attrs.streamId,
            chunkIndex,
            timestamp: parseInt(String(attrs.timestamp || '0'), 10),
          });
        }
      } catch (error: any) {
        // Silently ignore block range errors
        const errorMsg = error?.message || String(error);
        if (!errorMsg.includes('exceed max block range') && 
            !errorMsg.includes('max block range params') && 
            !errorMsg.includes('InvalidInputRpcError')) {
          console.error('[Subscription Error]', error);
          broadcast({ type: 'error', message: errorMsg });
        }
      }
    },
    onError: (error) => {
      // Filter out block range errors - subscriptions still work for new events
      const errorMsg = error?.message || String(error);
      if (!errorMsg.includes('exceed max block range') && 
          !errorMsg.includes('max block range params') && 
          !errorMsg.includes('InvalidInputRpcError')) {
        console.error('[Subscription Error]', error);
        broadcast({ type: 'error', message: errorMsg });
      }
    },
  });

  console.log('✅ Global video stream subscription active');
  return stop;
};

// Initialize global subscription
let globalSubscriptionStop: (() => void) | null = null;
setupGlobalSubscription()
  .then(stop => {
    globalSubscriptionStop = stop;
  })
  .catch((error: any) => {
    // Handle block range error gracefully - subscriptions will work for new events
    const errorMsg = error?.message || String(error);
    if (errorMsg.includes('exceed max block range') || 
        errorMsg.includes('max block range params') || 
        errorMsg.includes('InvalidInputRpcError')) {
      console.log('⚠️  Subscription setup: Block range limit hit (this is normal)');
      console.log('   Subscriptions will still work for new events going forward');
    } else {
      console.error('❌ Failed to set up global subscription:', errorMsg);
    }
  });

// REST API Routes

app.get('/api/account', (req, res) => {
  res.json({ address: streamer.getAccountAddress() });
});

// Create a new video stream
app.post('/api/streams', async (req, res) => {
  try {
    const { title, description, expiresIn } = req.body;
    const streamId = await streamer.createStream({
      title: title || 'Untitled Stream',
      description: description || '',
      expiresIn: expiresIn || 3600,
    });
    
    const stream = await streamer.getStream(streamId);
    res.json({ streamId, stream });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get stream metadata
app.get('/api/streams/:streamId', async (req, res) => {
  try {
    const stream = await streamer.getStream(req.params.streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    res.json({ stream });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upload and stream video file
app.post('/api/streams/:streamId/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const streamId = req.params.streamId;
    console.log(`📹 Starting upload for stream: ${streamId}`);

    // Start streaming in background
    streamer.streamVideoFile(streamId, req.file.path, 1)
      .then(() => {
        console.log(`✅ Stream complete: ${streamId}`);
        broadcast({ type: 'stream:complete', streamId });
      })
      .catch((error) => {
        console.error(`❌ Stream error: ${error.message}`);
        broadcast({ type: 'stream:error', streamId, error: error.message });
      });

    res.json({ 
      message: 'Video upload started',
      streamId,
      status: 'streaming',
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get chunks for a stream
app.get('/api/streams/:streamId/chunks', async (req, res) => {
  try {
    const { startIndex, endIndex } = req.query;
    const chunks = await streamer.getStreamChunks(
      req.params.streamId,
      startIndex ? parseInt(startIndex as string, 10) : undefined,
      endIndex ? parseInt(endIndex as string, 10) : undefined
    );
    res.json({ chunks, count: chunks.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Subscribe to a stream via WebSocket
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'subscribe') {
        const { streamId } = data;
        
        // Stop existing subscription if any
        const existingStop = activeSubscriptions.get(streamId);
        if (existingStop) {
          existingStop();
        }

        // Create new subscription
        const stop = await streamer.subscribeToStream(streamId, {
          onChunkReceived: (chunk) => {
            ws.send(JSON.stringify({
              type: 'chunk',
              chunk: {
                chunkIndex: chunk.chunkIndex,
                data: chunk.data,
                timestamp: chunk.timestamp,
              },
            }));
          },
          onError: (error) => {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
            }));
          },
        });

        activeSubscriptions.set(streamId, stop);
        ws.send(JSON.stringify({
          type: 'subscribed',
          streamId,
        }));
      } else if (data.type === 'unsubscribe') {
        const { streamId } = data;
        const stop = activeSubscriptions.get(streamId);
        if (stop) {
          stop();
          activeSubscriptions.delete(streamId);
        }
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          streamId,
        }));
      }
    } catch (error: any) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message,
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // Clean up subscriptions
    activeSubscriptions.forEach((stop) => stop());
    activeSubscriptions.clear();
  });

  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to Arkiv Video Stream',
  }));
});

const PORT = config.port;
server.listen(PORT, () => {
  console.log(`🚀 Arkiv Video Stream Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready for real-time video streaming`);
  console.log(`👤 Account: ${streamer.getAccountAddress()}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (globalSubscriptionStop) {
    globalSubscriptionStop();
  }
  activeSubscriptions.forEach((stop) => stop());
  wss.close();
  server.close();
  process.exit(0);
});
