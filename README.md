# 🎥 dMegle - Decentralized Live Streaming

**dMegle** (decentralized Megle) - Real-time live video streaming powered by Arkiv blockchain subscriptions. Stream live camera feeds directly from browsers without centralized servers.

## 🚀 Concept

This project demonstrates **real-time video streaming using Arkiv subscriptions**. Instead of traditional video streaming protocols, video is chunked into small entities stored on Arkiv, and viewers subscribe to receive chunks in real-time as they're published.

### How It Works

1. **Video Chunking**: Video files are split into small chunks (~40KB each, base64 encoded)
2. **Publishing**: Each chunk is published as an Arkiv entity with metadata (streamId, chunkIndex, timestamp)
3. **Real-time Subscriptions**: Viewers subscribe to Arkiv events and receive chunks as they're created
4. **Chunk Assembly**: Received chunks are buffered and assembled for playback
5. **TTL Management**: Chunks automatically expire after a set time to manage storage costs

## ✨ Features

- **Real-time Streaming**: Video chunks streamed via Arkiv subscriptions
- **CRUD Operations**: Create streams, publish chunks, query existing chunks
- **TTL/Expiration**: Automatic expiration of video chunks to manage costs
- **Live Subscriptions**: Real-time chunk delivery using Arkiv's subscription system
- **Query System**: Fetch chunks by stream ID, index range, or timestamp
- **Web UI**: Interactive interface for creating streams, uploading videos, and watching

## 🏗️ Architecture

### Core Components

1. **`video-streamer.ts`**: Arkiv SDK wrapper for video streaming
   - Stream creation and metadata management
   - Chunk publishing with size limits
   - Real-time subscription handling
   - Chunk querying and retrieval

2. **`server.ts`**: Express server with WebSocket bridge
   - REST API for stream management
   - WebSocket server for browser clients
   - Arkiv subscription → WebSocket bridge
   - File upload handling

3. **`public/`**: Web UI
   - Stream creation interface
   - Video upload and streaming
   - Real-time chunk reception display
   - Stream watching interface

### Arkiv Features Used

#### 1. Real-time Subscriptions (Primary Feature)
```typescript
// Subscribe to video chunks as they're created
await streamer.subscribeToStream(streamId, {
  onChunkReceived: (chunk) => {
    // Receive chunks in real-time
    console.log(`Chunk ${chunk.chunkIndex} received`);
  },
});
```

#### 2. CRUD Operations
```typescript
// Create stream metadata
const streamId = await streamer.createStream({
  title: 'My Video',
  expiresIn: 3600,
});

// Publish video chunk
await streamer.publishChunk(streamId, chunkIndex, chunkData);
```

#### 3. TTL/Expiration
```typescript
// Chunks expire after 1 hour
await walletClient.createEntity({
  payload: chunkData,
  expiresIn: 3600, // seconds
});
```

#### 4. Queries
```typescript
// Query chunks for a stream
const chunks = await streamer.getStreamChunks(streamId, startIndex, endIndex);
```

## 📋 Prerequisites

- Node.js 18+ (LTS recommended) or Bun 1.x
- TypeScript 5+
- Ethereum wallet with test ETH for Arkiv Testnet
- RPC endpoint access (Mendoza testnet)

## 🛠️ Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd arkhiv-test
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env`:
```bash
PRIVATE_KEY=0x...                      # Your testnet private key
RPC_URL=https://mendoza.hoodi.arkiv.network/rpc
WS_URL=wss://mendoza.hoodi.arkiv.network/rpc/ws
PORT=3000
```

**⚠️ Important**: Only use testnet private keys. Never use mainnet keys.

## 🎮 Usage

### CLI Demo

Run the streaming demo:
```bash
npm run stream
```

This will:
- Create a test video stream
- Set up real-time subscription
- Publish video chunks sequentially
- Receive chunks via subscription in real-time

### Web UI

Start the server:
```bash
npm run server
```

Open `http://localhost:3000`:

1. **Create Stream**: Enter title/description and create a new stream
2. **Upload Video**: Select stream and upload a video file (small files recommended for demo)
3. **Watch Stream**: Enter stream ID to watch and receive chunks in real-time

### API Endpoints

- `GET /api/account` - Get connected account address
- `POST /api/streams` - Create a new video stream
- `GET /api/streams/:streamId` - Get stream metadata
- `POST /api/streams/:streamId/upload` - Upload and stream video file
- `GET /api/streams/:streamId/chunks` - Get chunks for a stream

### WebSocket Events

- `subscribe` - Subscribe to a stream's chunks
- `unsubscribe` - Unsubscribe from a stream
- `chunk` - Receive chunk data
- `chunk:received` - Chunk notification
- `stream:complete` - Stream finished
- `error` - Error occurred

## 🎯 How Real-time Streaming Works

### Publishing Flow

1. Video file is chunked into ~40KB pieces
2. Each chunk is published as an Arkiv entity with:
   - `type: 'video-chunk'`
   - `streamId`: Identifies the stream
   - `chunkIndex`: Sequential chunk number
   - Base64-encoded video data in payload

### Subscription Flow

1. Viewer subscribes to Arkiv entity creation events
2. Filter events for `type='video-chunk'` and matching `streamId`
3. Receive chunks in real-time as they're published
4. Buffer chunks and maintain order using `chunkIndex`
5. Assemble chunks for playback

### Key Innovation

**Using Arkiv subscriptions for video streaming** means:
- No traditional streaming server needed
- Decentralized chunk delivery via blockchain
- Real-time updates as chunks are published
- Automatic expiration for cost management
- Queryable chunk history

## 📊 Technical Details

### Chunk Size Limits

- **Raw chunk**: ~40KB (before base64 encoding)
- **Base64 encoded**: ~50KB (fits in Arkiv entity)
- **Why small**: Gas costs scale with entity size

### Chunk Ordering

- Chunks include `chunkIndex` attribute for ordering
- Subscriptions may receive chunks out of order
- Client buffers and sorts by index before playback

### TTL Strategy

- Each chunk expires after 1 hour (configurable)
- Stream metadata expires after stream duration
- Old chunks automatically cleaned up
- Reduces long-term storage costs

## 🐛 Limitations & Considerations

### Current Limitations

1. **Video Format**: Demo uses raw binary chunks (not proper video codec)
2. **Chunk Size**: Limited to ~50KB per chunk (Arkiv entity size)
3. **Latency**: Blockchain writes have inherent latency
4. **Cost**: Each chunk requires gas fees

### Production Considerations

For production use, consider:
- Using proper video codec (H.264, VP9) with chunking
- Hybrid approach: Store large video files off-chain (IPFS), use Arkiv for metadata/chunks
- CDN integration for final delivery
- Chunk size optimization based on gas costs

## 🎓 Learning Points

This project demonstrates:

1. **Real-time Data Streams**: Using Arkiv subscriptions for live data delivery
2. **Chunked Storage**: Breaking large data into manageable entities
3. **TTL Management**: Cost-efficient storage with automatic expiration
4. **Query Patterns**: Filtering and retrieving chunks by stream/index
5. **Subscription Architecture**: Building real-time apps on blockchain

## 📚 Resources

- [Arkiv Documentation](https://arkiv.network/docs)
- [TypeScript SDK Guide](https://arkiv.network/getting-started/typescript)
- [Arkiv Testnet Explorer](https://arkiv.network)
- [Mendoza Testnet RPC](https://mendoza.hoodi.arkiv.network/rpc)

## 🎯 Hackathon Deliverables

- ✅ **Public live demo**: Web UI for video streaming
- ✅ **Public repo**: This repository with comprehensive documentation
- ✅ **Demo video**: Record showing:
  - Creating a stream
  - Uploading video (chunks published)
  - Real-time chunk reception via subscriptions
  - Multiple viewers receiving same stream

## 🏆 Why This Project Stands Out

1. **Pushes Boundaries**: Uses Arkiv subscriptions for video streaming (novel use case)
2. **Real-time Focus**: Heavily leverages subscription feature for live delivery
3. **Multiple Features**: Uses CRUD, TTL, subscriptions, and queries together
4. **Practical Demo**: Working web UI that demonstrates real-time streaming
5. **Clear Architecture**: Well-documented streaming protocol

## 📝 License

MIT

## 🙏 Acknowledgments

Built for the Arkiv Hackathon at DevConnect 2025. Powered by [Arkiv Network](https://arkiv.network).

---

**Note**: This is a proof-of-concept demonstrating real-time video streaming via Arkiv subscriptions. For production video streaming, consider hybrid architectures combining Arkiv with traditional CDN/video infrastructure.
