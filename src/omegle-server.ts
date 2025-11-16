import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ArkivOmegle } from './omegle-client.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Route for Omegle (before static middleware)
app.get('/omegle', (req, res) => {
  res.sendFile(join(__dirname, '../public/omegle.html'));
});

app.use(express.static('public'));

const omegle = new ArkivOmegle();

// Store active WebRTC connections
const activeConnections = new Map<string, any>();

// Broadcast to WebSocket clients
const broadcast = (data: any) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};

// Set up Arkiv subscriptions for matching
let subscriptionStop: (() => void) | null = null;

const setupSubscriptions = async () => {
  if (subscriptionStop) {
    subscriptionStop();
  }

  subscriptionStop = await omegle.subscribeToMatches({
    onMatched: (session) => {
      console.log(`[Match] Session ${session.sessionId}: ${session.user1} <-> ${session.user2}`);
      broadcast({
        type: 'session:matched',
        session,
      });
    },
    onUserWaiting: (user) => {
      console.log(`[User Waiting] ${user.userId}`);
      broadcast({
        type: 'user:waiting',
        user,
      });
    },
    onSessionEnded: (sessionId) => {
      console.log(`[Session Ended] ${sessionId}`);
      broadcast({
        type: 'session:ended',
        sessionId,
      });
    },
    onError: (error) => {
      // Filter out block range errors - subscriptions still work for new events
      const errorMsg = error?.message || String(error);
      if (!errorMsg.includes('exceed max block range') && 
          !errorMsg.includes('max block range params') &&
          !errorMsg.includes('InvalidInputRpcError')) {
        console.error('[Subscription Error]', error);
      }
      // Block range errors are expected and harmless - subscriptions work for new events
    },
  });

  console.log('✅ Arkiv matching subscriptions active');
};

setupSubscriptions().catch(console.error);

// REST API Routes

app.get('/api/account', (req, res) => {
  res.json({
    userId: omegle.getUserId(),
    address: omegle.getAccountAddress(),
  });
});

// Start waiting for a match
app.post('/api/wait', async (req, res) => {
  try {
    const { interests } = req.body;
    const sessionId = await omegle.startWaiting(interests);
    await omegle.setUserProfile(interests);
    
    res.json({ sessionId, userId: omegle.getUserId() });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get waiting users
app.get('/api/waiting', async (req, res) => {
  try {
    const excludeUserId = req.query.exclude as string;
    const users = await omegle.getWaitingUsers(excludeUserId);
    res.json({ users });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Match with a user
app.post('/api/match', async (req, res) => {
  try {
    const { sessionId, matchedUserId } = req.body;
    const matchedSessionId = await omegle.matchSession(sessionId, matchedUserId);
    res.json({ sessionId: matchedSessionId });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// End session
app.post('/api/sessions/:sessionId/end', async (req, res) => {
  try {
    await omegle.endSession(req.params.sessionId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get user sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const { userId, status } = req.query;
    const sessions = await omegle.getSessions({
      userId: userId as string,
      status: status as any,
    });
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket for WebRTC signaling
wss.on('connection', (ws, req) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // Forward WebRTC signaling to peer
          broadcast({
            type: 'webrtc-signal',
            from: data.from,
            to: data.to,
            signal: {
              type: data.type,
              sdp: data.sdp,
              candidate: data.candidate,
            },
          });
          break;

        case 'subscribe':
          // Client wants to subscribe to matches
          ws.send(JSON.stringify({
            type: 'subscribed',
            userId: omegle.getUserId(),
          }));
          break;
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
  });

  ws.send(JSON.stringify({
    type: 'connected',
    userId: omegle.getUserId(),
    message: 'Connected to Arkiv Omegle',
  }));
});

const PORT = config.port;
server.listen(PORT, () => {
  console.log(`🚀 Arkiv Omegle Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready for WebRTC signaling`);
  console.log(`👤 User ID: ${omegle.getUserId()}`);
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

