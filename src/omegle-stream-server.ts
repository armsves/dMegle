// Import error suppression first to suppress expected block range errors
import '../suppress-errors.js';

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ArkivOmegle } from './omegle-client.js';
import { ArkivVideoStreamer } from './video-streamer.js';
import { config } from './config.js';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });
const omegle = new ArkivOmegle();
const streamer = new ArkivVideoStreamer();

// Route for streamer page
app.get('/stream', (req, res) => {
  res.sendFile(join(__dirname, '../public/streamer.html'));
});

// Route for viewer page
app.get('/watch', (req, res) => {
  res.sendFile(join(__dirname, '../public/viewer.html'));
});

app.use(express.static('public'));

// Set up Arkiv subscriptions for stream chunks
let subscriptionStop: (() => void) | null = null;

const setupSubscriptions = async () => {
  if (subscriptionStop) {
    subscriptionStop();
  }

  subscriptionStop = await streamer.subscribeToStream('*', {
    onChunkReceived: (chunk) => {
      console.log(`[Chunk] Stream: ${chunk.streamId}, Index: ${chunk.chunkIndex}`);
      // Broadcast to WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'chunk',
            streamId: chunk.streamId,
            chunkIndex: chunk.chunkIndex,
            data: chunk.data,
            timestamp: chunk.timestamp,
          }));
        }
      });
    },
    onError: (error) => {
      const errorMsg = error?.message || String(error);
      if (!errorMsg.includes('exceed max block range') && 
          !errorMsg.includes('max block range params') &&
          !errorMsg.includes('InvalidInputRpcError')) {
        console.error('[Subscription Error]', error);
      }
    },
  });

  console.log('✅ Arkiv video stream subscriptions active');
};

setupSubscriptions().catch(console.error);

// Chunk queues per stream to ensure ordering
// Also stores sent chunks for late subscribers
const chunkQueues = new Map<string, {
  queue: Array<{ chunkIndex: number; streamId: string; data: any; timestamp: number }>;
  processing: boolean;
  lastSentIndex: number;
  sentChunks: Map<number, { chunkIndex: number; streamId: string; data: any; timestamp: number }>; // Store sent chunks for late subscribers
}>();

// Arkiv publishing queue to prevent nonce conflicts
const arkivPublishQueue: Array<{ streamId: string; chunkIndex: number; chunkBuffer: Buffer }> = [];
let isPublishingToArkiv = false;

// Process chunk queue sequentially to maintain order
async function processChunkQueue(streamId: string) {
  if (!chunkQueues.has(streamId)) {
    return;
  }
  
  const queue = chunkQueues.get(streamId)!;
  
  if (queue.processing) {
    return; // Already processing
  }
  
  queue.processing = true;
  
  // Sort queue by chunkIndex to ensure order
  queue.queue.sort((a, b) => a.chunkIndex - b.chunkIndex);
  
  // Send chunks in order
  while (queue.queue.length > 0) {
    const chunk = queue.queue[0];
    
    // Only send if it's the next expected chunk
    if (chunk.chunkIndex === queue.lastSentIndex + 1) {
      // Broadcast to subscribed viewers only
      let sentCount = 0;
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          const subs = clientSubscriptions.get(client);
          // Send to clients subscribed to this stream, or if they have no subscriptions (backward compat)
          if (!subs || subs.size === 0 || subs.has(chunk.streamId)) {
            try {
              client.send(JSON.stringify({
                type: 'chunk',
                streamId: chunk.streamId,
                chunkIndex: chunk.chunkIndex,
                data: chunk.data,
                timestamp: chunk.timestamp,
              }));
              sentCount++;
            } catch (error) {
              console.error('Error sending chunk to client:', error);
            }
          }
        }
      });
      console.log(`📡 Broadcasting chunk ${chunk.chunkIndex} for stream ${chunk.streamId} to ${sentCount} subscribed clients`);
      
      queue.lastSentIndex = chunk.chunkIndex;
      // Store sent chunk for late subscribers
      queue.sentChunks.set(chunk.chunkIndex, chunk);
      queue.queue.shift();
    } else {
      // Wait for previous chunks
      console.log(`⏳ Waiting for chunk ${queue.lastSentIndex + 1}, got ${chunk.chunkIndex}`);
      break;
    }
  }
  
  queue.processing = false;
  
  // If there are still chunks in queue, process again immediately (no delay for low latency)
  if (queue.queue.length > 0) {
    setImmediate(() => processChunkQueue(streamId));
  }
}

// Process Arkiv publishing queue sequentially to avoid nonce conflicts
async function processArkivPublishQueue() {
  if (isPublishingToArkiv || arkivPublishQueue.length === 0) {
    return;
  }

  isPublishingToArkiv = true;

  while (arkivPublishQueue.length > 0) {
    const item = arkivPublishQueue.shift();
    if (!item) break;

    const { streamId, chunkIndex, chunkBuffer } = item;

    try {
      // Add a small delay between publishes to avoid nonce conflicts
      if (arkivPublishQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }

      const entityKey = await streamer.publishChunk(streamId, chunkIndex, chunkBuffer);
      console.log(`📹 Published camera chunk ${chunkIndex} for stream ${streamId} → ${entityKey.slice(0, 12)}...`);
    } catch (error: any) {
      // Log but don't fail - chunks are already broadcast via WebSocket
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('replacement transaction underpriced')) {
        console.warn(`⚠️ Chunk ${chunkIndex} publish skipped (nonce conflict) - already broadcast via WebSocket`);
      } else if (errorMsg.includes('Missing or invalid parameters')) {
        console.warn(`⚠️ Chunk ${chunkIndex} publish failed (invalid params) - already broadcast via WebSocket`);
      } else {
        console.warn(`⚠️ Failed to publish chunk ${chunkIndex} to Arkiv:`, errorMsg);
      }
      // Don't retry - streaming continues via WebSocket
    }
  }

  isPublishingToArkiv = false;
}

// REST API Routes

app.get('/api/account', (req, res) => {
  res.json({
    userId: omegle.getUserId(),
    address: omegle.getAccountAddress(),
  });
});

// Create a video stream
app.post('/api/streams', async (req, res) => {
  try {
    const { title, description, expiresIn } = req.body;
    const streamId = await streamer.createStream({
      title: title || 'Live Stream',
      description: description || '',
      expiresIn: expiresIn || 3600,
    });
    
    // Try to get stream, but if it's not indexed yet, return basic info
    let stream = await streamer.getStream(streamId);
    if (!stream) {
      // Return basic stream info if not yet indexed
      stream = {
        streamId,
        title: title || 'Live Stream',
        description: description || '',
        createdAt: Date.now(),
        totalChunks: 0,
        chunkDuration: 1,
        expiresIn: expiresIn || 3600,
      };
    }
    
    res.json({ streamId, stream });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Upload and stream video file
app.post('/api/streams/:streamId/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const streamId = req.params.streamId;
    console.log(`📹 Starting stream upload: ${streamId}`);

    // Start streaming in background
    streamer.streamVideoFile(streamId, req.file.path, 1)
      .then(() => {
        console.log(`✅ Stream complete: ${streamId}`);
        wss.clients.forEach((client) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'stream:complete',
              streamId,
            }));
          }
        });
      })
      .catch((error) => {
        console.error(`❌ Stream error: ${error.message}`);
      });

    res.json({ 
      message: 'Video streaming started',
      streamId,
      status: 'streaming',
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get stream metadata
app.get('/api/streams/:streamId', async (req, res) => {
  try {
    const stream = await streamer.getStream(req.params.streamId);
    if (!stream) {
      // Return basic info even if not indexed yet
      return res.json({ 
        stream: {
          streamId: req.params.streamId,
          title: 'Stream',
          description: '',
          createdAt: Date.now(),
          totalChunks: 0,
          chunkDuration: 1,
          expiresIn: 3600,
        }
      });
    }
    res.json({ stream });
  } catch (error: any) {
    console.error('Error getting stream:', error);
    // Return basic info on error
    res.json({ 
      stream: {
        streamId: req.params.streamId,
        title: 'Stream',
        description: '',
        createdAt: Date.now(),
        totalChunks: 0,
        chunkDuration: 1,
        expiresIn: 3600,
      }
    });
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
    console.error('Error getting chunks:', error);
    // Return empty chunks array instead of error
    res.json({ chunks: [], count: 0 });
  }
});

// Track subscribed streams per WebSocket client
const clientSubscriptions = new Map<any, Set<string>>();

// WebSocket for real-time chunk delivery
wss.on('connection', (ws) => {
  console.log('Client connected');
  clientSubscriptions.set(ws, new Set());

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'subscribe') {
        const { streamId } = data;
        
        console.log(`📺 Viewer subscribing to stream: ${streamId} (live mode - starting from latest chunk)`);
        
        // Track this subscription
        const subs = clientSubscriptions.get(ws);
        if (subs) {
          subs.add(streamId);
        }
        
        // Don't send historical chunks - start from latest chunk only
        // This ensures viewers only see content from when they joined
        
        // Subscribe to specific stream for future chunks only (as backup)
        // But chunks will come from direct broadcast in processChunkQueue
        const stop = await streamer.subscribeToStream(streamId, {
          onChunkReceived: (chunk) => {
            // This is a backup - chunks should come from direct broadcast
            console.log(`📦 Arkiv subscription received chunk ${chunk.chunkIndex} for ${chunk.streamId}`);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'chunk',
                streamId: chunk.streamId,
                chunkIndex: chunk.chunkIndex,
                data: chunk.data,
                timestamp: chunk.timestamp,
              }));
            }
          },
          onError: (error) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'error',
                message: error.message,
              }));
            }
          },
        });

        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'subscribed',
            streamId,
          }));
        }
      } else if (data.type === 'camera-chunk') {
        // Handle camera chunks from browser
        const { streamId, chunkIndex, data: chunkData, timestamp } = data;
        
        console.log(`📥 Received camera chunk ${chunkIndex} for stream ${streamId}, size: ${chunkData?.length || 0} bytes`);
        
        // Convert array back to Buffer
        const chunkBuffer = Buffer.from(chunkData);
        
        // Broadcast chunks immediately, even if Arkiv publishing fails
        // Use a queue per stream to ensure chunks are sent in order
        if (!chunkQueues.has(streamId)) {
          chunkQueues.set(streamId, {
            queue: [],
            processing: false,
            lastSentIndex: -1,
            sentChunks: new Map()
          });
        }
        
        const queue = chunkQueues.get(streamId)!;
        queue.queue.push({
          chunkIndex,
          streamId,
          data: chunkData,
          timestamp,
        });
        
        console.log(`📤 Queued chunk ${chunkIndex} for stream ${streamId} (queue size: ${queue.queue.length})`);
        
        // Process queue sequentially (broadcast immediately)
        processChunkQueue(streamId);
        
        // Queue for Arkiv publishing (sequential to avoid nonce conflicts)
        arkivPublishQueue.push({ streamId, chunkIndex, chunkBuffer });
        processArkivPublishQueue();
      }
    } catch (error: any) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message,
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clientSubscriptions.delete(ws);
  });

  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to Arkiv Video Stream',
  }));
});

const PORT = config.port;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🚀 Arkiv Stream Server running on http://localhost:${PORT}`);
  console.log(`📡 Streamer: http://localhost:${PORT}/stream`);
  console.log(`👀 Viewer: http://localhost:${PORT}/watch`);
  console.log(`👤 Account: ${omegle.getAccountAddress()}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (subscriptionStop) {
    subscriptionStop();
  }
  wss.close();
  server.close();
  process.exit(0);
});

