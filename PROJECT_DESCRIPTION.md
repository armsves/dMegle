# dMegle - Decentralized Real-Time Video Streaming Platform

## Project Overview

**dMegle** is a decentralized, real-time video streaming platform built on Arkiv Testnet that enables live camera streaming directly from browsers to viewers worldwide. Unlike traditional streaming services that rely on centralized servers, this platform leverages Arkiv's blockchain-based data storage and real-time subscription features to create a truly decentralized streaming experience.

## What is dMegle?

dMegle (decentralized Megle) is a blockchain-powered alternative to traditional video streaming platforms. It combines the real-time video chat concept of Omegle with the decentralized storage and delivery capabilities of Arkiv blockchain, creating a censorship-resistant, serverless streaming platform.

## Problem Statement

Traditional video streaming platforms face several challenges:
- **Centralization**: Dependence on centralized servers creates single points of failure
- **Cost**: High infrastructure costs for hosting and bandwidth
- **Censorship**: Centralized control allows content moderation and blocking
- **Latency**: Complex CDN routing can introduce delays
- **Scalability**: Server capacity limits concurrent viewers

## Solution

dMegle solves these problems by:
- **Decentralized Storage**: Video chunks are stored on Arkiv blockchain, eliminating the need for centralized servers
- **Real-Time Subscriptions**: Leverages Arkiv's subscription feature for live chunk delivery
- **Cost Efficiency**: Pay-per-chunk storage model with TTL-based expiration
- **Censorship Resistant**: Content stored on blockchain cannot be easily removed
- **Low Latency**: Direct WebSocket connections with optimized chunk processing (~2 seconds per chunk)

## Key Features

### 🎥 Live Camera Streaming
- Stream directly from browser camera using WebRTC MediaRecorder API
- Real-time encoding with VP8 codec (WebM format)
- Optimized compression (150 kbps, 480x360, 15fps) for low latency

### 📺 Live Viewing
- Real-time video playback as chunks arrive
- Sliding window approach (last 5 chunks = ~10 seconds) for continuous playback
- Automatic playback restoration when new chunks arrive

### 🔗 Arkiv Integration
- **CRUD Operations**: Create streams, publish chunks as entities
- **Subscriptions**: Real-time chunk delivery via Arkiv subscriptions
- **TTL**: Automatic expiration of old chunks (configurable)
- **Queries**: Fetch stream metadata and chunk information

### ⚡ Performance Optimizations
- 2-second chunks for reduced processing overhead
- Sequential chunk ordering with server-side queuing
- Client-side blob-based video playback
- WebSocket-based real-time communication

## Technical Architecture

### Frontend
- **Streamer Page** (`/stream`): Camera capture and streaming interface
- **Viewer Page** (`/watch`): Live video playback interface
- **Technologies**: HTML5 MediaRecorder API, WebSocket, Blob URLs

### Backend
- **Express.js Server**: REST API and WebSocket signaling
- **Arkiv SDK**: TypeScript SDK for blockchain interactions
- **Chunk Queue System**: Ensures sequential chunk broadcasting

### Arkiv Features Used
1. **Entity Creation**: Each video chunk is stored as an Arkiv entity
2. **Attributes**: Stream ID, chunk index, timestamp stored as entity attributes
3. **Payload**: Video chunk binary data stored in entity payload (Base64 encoded)
4. **Subscriptions**: Real-time event subscriptions for new chunks
5. **Queries**: Filter chunks by stream ID and index
6. **TTL**: Automatic expiration of old chunks

## Use Cases

1. **Live Events**: Stream conferences, meetups, or events without server infrastructure
2. **Content Creation**: Decentralized alternative to Twitch/YouTube Live
3. **Surveillance**: Decentralized security camera streaming
4. **Education**: Live educational content delivery
5. **Social Streaming**: Omegle-like random video chat (extended feature)

## Innovation Highlights

- **First-of-its-kind**: Real-time video streaming on Arkiv blockchain
- **Blockchain as CDN**: Using blockchain storage for live media delivery
- **Cost-Effective**: Pay only for what you store, with automatic cleanup
- **Censorship Resistant**: Content stored on immutable blockchain
- **No Infrastructure**: No servers, databases, or CDNs required

## Technical Challenges Solved

1. **Chunk Ordering**: Implemented server-side queuing to ensure sequential chunk delivery
2. **Real-Time Playback**: Sliding window approach for continuous video playback
3. **Latency Optimization**: Aggressive compression and chunk sizing (2 seconds)
4. **WebM Compatibility**: Blob-based playback fallback for MediaRecorder chunks
5. **Block Range Limits**: Handled Arkiv SDK block range errors gracefully

## Future Enhancements

- Multi-stream support (multiple concurrent streams)
- Audio streaming support
- Peer-to-peer WebRTC integration
- Stream recording and playback
- Viewer authentication and access control
- Stream analytics and metrics

## Demo Instructions

1. **Start the server**: `npm run stream`
2. **Open Streamer**: Navigate to `http://localhost:3000/stream`
3. **Create a stream**: Enter title and click "Create Stream"
4. **Start streaming**: Select stream and click "Start Camera Stream"
5. **Open Viewer**: Navigate to `http://localhost:3000/watch` in another tab
6. **Watch live**: Enter stream ID and click "Start Watching"

## Technology Stack

- **Blockchain**: Arkiv Testnet
- **Backend**: Node.js, Express.js, TypeScript
- **Frontend**: Vanilla JavaScript, HTML5 APIs
- **Real-Time**: WebSocket (ws library)
- **Video**: MediaRecorder API, WebM/VP8 codec
- **SDK**: @arkiv-network/sdk (v0.4.4)

## Project Status

✅ **Core Features Complete**:
- Live camera streaming
- Real-time chunk delivery via Arkiv subscriptions
- Video playback with sliding window
- Stream creation and management
- WebSocket-based signaling

🚧 **In Progress**:
- Optimizing latency and playback smoothness
- Error handling and edge cases

## Team

Built for DevConnect 2025 / Arkiv Hackathon

---

**Note**: This project demonstrates the feasibility of using Arkiv blockchain for real-time media streaming, pushing the boundaries of decentralized content delivery.

