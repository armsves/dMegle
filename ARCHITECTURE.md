# Arkiv Video Stream - Architecture & Design

## Overview

This project demonstrates **real-time video streaming using Arkiv subscriptions** - a novel approach that uses blockchain-based subscriptions for live video delivery.

## Core Innovation

**Using Arkiv subscriptions to stream video chunks in real-time** - each video chunk is stored as an Arkiv entity, and viewers subscribe to receive chunks as they're published, enabling decentralized video streaming.

## Architecture Diagram

```
┌─────────────┐
│ Video File  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Video Chunker   │  Split into ~40KB chunks
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Arkiv Publisher │  Publish each chunk as entity
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Arkiv Chain    │  Store chunks with metadata
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Subscriptions  │  Real-time chunk delivery
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Video Player    │  Buffer & assemble chunks
└─────────────────┘
```

## Data Flow

### Publishing Flow

1. **Video Input**: User uploads video file
2. **Chunking**: File split into ~40KB chunks
3. **Encoding**: Chunks base64 encoded (~50KB)
4. **Publishing**: Each chunk published as Arkiv entity:
   ```typescript
   {
     type: 'video-chunk',
     streamId: 'stream-123',
     chunkIndex: 0,
     timestamp: 1234567890,
     payload: '<base64 video data>'
   }
   ```
5. **TTL**: Chunks expire after 1 hour

### Subscription Flow

1. **Subscribe**: Client subscribes to Arkiv entity creation events
2. **Filter**: Filter events for `type='video-chunk'` and matching `streamId`
3. **Receive**: Chunks arrive in real-time as they're published
4. **Buffer**: Client buffers chunks and maintains order by `chunkIndex`
5. **Assemble**: Chunks assembled for playback

## Arkiv Features Used

### 1. Real-time Subscriptions (Primary)

**Heavy usage** - Core of the streaming system:

```typescript
await publicClient.subscribeEntityEvents({
  onEntityCreated: async (e) => {
    // Receive chunks as they're published
    const entity = await publicClient.getEntity(e.entityKey);
    // Process chunk...
  },
});
```

**Why it matters**: Enables real-time video delivery without traditional streaming servers.

### 2. CRUD Operations

- **Create**: Stream metadata and video chunks
- **Read**: Query chunks by stream ID, index range
- **Update**: (Not used - chunks are immutable)
- **Delete**: (Via TTL expiration)

### 3. TTL/Expiration

Each chunk expires after 1 hour:
```typescript
await walletClient.createEntity({
  payload: chunkData,
  expiresIn: 3600, // 1 hour
});
```

**Why it matters**: Automatic cleanup reduces storage costs for temporary video streams.

### 4. Queries

Query chunks for replay/catch-up:
```typescript
const chunks = await query
  .where(and(
    eq('type', 'video-chunk'),
    eq('streamId', streamId)
  ))
  .fetch();
```

**Why it matters**: Allows viewers to join mid-stream and catch up on missed chunks.

## Technical Decisions

### Chunk Size: ~40KB

- **Reason**: Balance between gas costs and streaming efficiency
- **Base64**: ~50KB when encoded (fits in Arkiv entity)
- **Trade-off**: Smaller chunks = more entities = more gas, but faster initial delivery

### Chunk Ordering

- **Attribute**: `chunkIndex` for sequential ordering
- **Challenge**: Subscriptions may deliver chunks out of order
- **Solution**: Client buffers and sorts by index before playback

### TTL Strategy

- **Chunks**: 1 hour expiration
- **Streams**: Configurable (default 24 hours)
- **Rationale**: Most video streams are watched live, old chunks can expire

## Limitations & Future Improvements

### Current Limitations

1. **Video Format**: Uses raw binary (not proper codec)
2. **Chunk Size**: Limited by Arkiv entity size
3. **Latency**: Blockchain writes have inherent delay
4. **Cost**: Each chunk requires gas fees

### Potential Improvements

1. **Hybrid Architecture**: Store large video files on IPFS, use Arkiv for metadata/chunks
2. **Codec Support**: Proper video codec (H.264) with chunking
3. **CDN Integration**: Use CDN for final delivery, Arkiv for coordination
4. **Adaptive Chunking**: Dynamic chunk sizes based on network conditions

## Why This Demonstrates Arkiv Well

1. **Heavy Subscription Usage**: Real-time streaming relies entirely on subscriptions
2. **Multiple Features**: Uses CRUD, TTL, subscriptions, and queries together
3. **Novel Use Case**: Video streaming via blockchain subscriptions is innovative
4. **Practical Demo**: Working web UI shows real-time chunk delivery
5. **Clear Architecture**: Well-documented streaming protocol

## Key Learnings

### What Worked Well

- Arkiv subscriptions handle real-time delivery effectively
- TTL automatic expiration reduces storage costs
- Query system allows catch-up/replay functionality
- Entity attributes enable efficient filtering

### Challenges

- Chunk size limits require careful design
- Gas costs scale with number of chunks
- Subscription ordering requires client-side buffering
- Latency from blockchain writes affects real-time feel

### Developer Experience Insights

**Strengths**:
- Subscription API is straightforward
- Query building is intuitive
- TTL management is simple

**Areas for Improvement**:
- Entity size limits could be documented better
- Subscription ordering guarantees would help
- Batch operations for multiple chunks would reduce gas costs

## Conclusion

This project successfully demonstrates **real-time video streaming via Arkiv subscriptions**, showing that blockchain-based subscriptions can enable novel streaming architectures. While there are limitations (chunk size, gas costs), the core concept works and opens possibilities for decentralized media delivery.

