# dMegle - Submission Summary

## Elevator Pitch

**dMegle** (decentralized Megle) is a decentralized, real-time video streaming platform that uses Arkiv blockchain for storage and delivery. Stream live camera feeds directly from browsers without any centralized servers - just blockchain storage and real-time subscriptions. Think Omegle meets blockchain.

## What Problem Does It Solve?

Traditional streaming requires expensive servers, CDNs, and infrastructure. dMegle eliminates this by:
- **No Servers**: Content stored on Arkiv blockchain
- **Real-Time**: Live streaming via Arkiv subscriptions
- **Cost-Effective**: Pay-per-chunk with automatic expiration
- **Censorship Resistant**: Immutable blockchain storage

## How Does It Use Arkiv?

✅ **CRUD**: Create streams, publish video chunks as entities  
✅ **Subscriptions**: Real-time chunk delivery via Arkiv event subscriptions  
✅ **TTL**: Automatic expiration of old chunks  
✅ **Queries**: Filter and fetch chunks by stream ID and index  

## Key Innovation

**dMegle - First real-time video streaming platform on Arkiv blockchain** - demonstrating that blockchain can be used for live media delivery, not just static storage. A decentralized alternative to Omegle-style video streaming.

## Technical Highlights

- Live camera streaming from browser (MediaRecorder API)
- Real-time chunk delivery (~2 second chunks)
- Sequential ordering with server-side queuing
- Sliding window playback for continuous video
- WebSocket bridge for browser compatibility

## Demo

1. Open `/stream` - Create stream and start camera
2. Open `/watch` - Enter stream ID to watch live
3. Video plays in real-time as chunks arrive via Arkiv subscriptions

## Impact

Proves blockchain can be used for **live, real-time content delivery**, opening possibilities for:
- Decentralized streaming platforms
- Censorship-resistant live events
- Cost-effective content delivery
- No infrastructure requirements

---

**Built for**: DevConnect 2025 / Arkiv Hackathon  
**Status**: Core features complete, live streaming working

