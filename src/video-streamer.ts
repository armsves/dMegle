import { createWalletClient, createPublicClient, http, webSocket } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { mendoza } from '@arkiv-network/sdk/chains';
import { stringToPayload, jsonToPayload } from '@arkiv-network/sdk/utils';
import { eq, and } from '@arkiv-network/sdk/query';
import { config } from './config.js';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface VideoChunk {
  entityKey: string;
  streamId: string;
  chunkIndex: number;
  data: string; // base64 encoded video chunk
  timestamp: number;
  expiresAt: number;
}

export interface VideoStream {
  streamId: string;
  title: string;
  description: string;
  createdAt: number;
  totalChunks: number;
  chunkDuration: number; // seconds per chunk
  expiresIn: number; // total stream expiration
}

export class ArkivVideoStreamer {
  private walletClient;
  public publicClient; // Expose for server subscriptions
  private account;

  constructor() {
    this.account = privateKeyToAccount(config.privateKey);
    
    this.walletClient = createWalletClient({
      chain: mendoza,
      transport: http(config.rpcUrl),
      account: this.account,
    });

    // Use WebSocket transport if available for real-time subscriptions (avoids block range issues)
    // Fallback to HTTP if WS not available
    const transport = config.wsUrl ? webSocket(config.wsUrl) : http(config.rpcUrl);
    
    this.publicClient = createPublicClient({
      chain: mendoza,
      transport,
    });
  }

  /**
   * Create a new video stream metadata entity
   */
  async createStream(metadata: {
    title: string;
    description: string;
    expiresIn?: number; // seconds
  }): Promise<string> {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const createdAt = Date.now();
    const expiresIn = metadata.expiresIn || 3600; // Default 1 hour

    const streamData: VideoStream = {
      streamId,
      title: metadata.title,
      description: metadata.description,
      createdAt,
      totalChunks: 0,
      chunkDuration: 1, // 1 second per chunk
      expiresIn,
    };

    const { entityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(streamData),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'video-stream' },
        { key: 'streamId', value: streamId },
        { key: 'status', value: 'active' },
        { key: 'createdAt', value: String(createdAt) },
      ],
      expiresIn,
    });

    return streamId;
  }

  /**
   * Publish a video chunk to Arkiv
   * Chunks should be small (1-2 seconds of video, base64 encoded)
   */
  async publishChunk(streamId: string, chunkIndex: number, chunkData: Buffer): Promise<string> {
    // Convert to base64 - keep chunks small (max ~50KB when base64 encoded)
    const base64Data = chunkData.toString('base64');
    
    if (base64Data.length > 50000) {
      throw new Error(`Chunk too large: ${base64Data.length} bytes. Max ~50KB base64.`);
    }

    const chunkMetadata = {
      streamId,
      chunkIndex,
      timestamp: Date.now(),
      size: chunkData.length,
    };

    // Store chunk data and metadata
    const chunkPayload = {
      ...chunkMetadata,
      data: base64Data,
    };

    // Chunks expire after stream expiration (or 1 hour default)
    const chunkExpiresIn = 3600; // 1 hour per chunk

    const { entityKey } = await this.walletClient.createEntity({
      payload: jsonToPayload(chunkPayload),
      contentType: 'application/json',
      attributes: [
        { key: 'type', value: 'video-chunk' },
        { key: 'streamId', value: streamId },
        { key: 'chunkIndex', value: String(chunkIndex) },
        { key: 'timestamp', value: String(chunkMetadata.timestamp) },
      ],
      expiresIn: chunkExpiresIn,
    });

    return entityKey;
  }

  /**
   * Stream video file by chunking and publishing sequentially
   */
  async streamVideoFile(streamId: string, videoFilePath: string, chunkSizeSeconds: number = 1): Promise<void> {
    // For demo: read file and chunk it
    // In production, you'd use ffmpeg or similar to extract video chunks
    const videoBuffer = readFileSync(videoFilePath);
    
    // Simple chunking: split buffer into ~50KB chunks
    // In real implementation, use ffmpeg to extract actual video segments
    const chunkSizeBytes = 40000; // ~40KB raw = ~50KB base64
    let chunkIndex = 0;

    console.log(`📹 Starting video stream: ${streamId}`);
    console.log(`📦 Total file size: ${(videoBuffer.length / 1024).toFixed(2)} KB`);

    for (let i = 0; i < videoBuffer.length; i += chunkSizeBytes) {
      const chunk = videoBuffer.slice(i, i + chunkSizeBytes);
      
      try {
        const entityKey = await this.publishChunk(streamId, chunkIndex, chunk);
        console.log(`✅ Published chunk ${chunkIndex} (${(chunk.length / 1024).toFixed(2)} KB) → ${entityKey.slice(0, 12)}...`);
        
        chunkIndex++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`❌ Failed to publish chunk ${chunkIndex}:`, error.message);
        throw error;
      }
    }

    console.log(`✨ Stream complete! Published ${chunkIndex} chunks`);
  }

  /**
   * Subscribe to video chunks for a stream
   * Use '*' as streamId to subscribe to all streams
   */
  async subscribeToStream(
    streamId: string | '*',
    callbacks: {
      onChunkReceived?: (chunk: VideoChunk) => void;
      onStreamComplete?: () => void;
      onError?: (error: Error) => void;
    }
  ): Promise<() => void> {
    const receivedChunks = new Set<number>();
    let lastChunkIndex = -1;

    // Subscribe to new events only (no historical queries to avoid max block range error)
    const stop = await this.publicClient.subscribeEntityEvents({
      onEntityCreated: async (e) => {
        try {
          const entity = await this.publicClient.getEntity(e.entityKey);
          const attrs = Object.fromEntries(
            entity.attributes.map(a => [a.key, a.value])
          );

          if (attrs.type === 'video-chunk' && (streamId === '*' || attrs.streamId === streamId)) {
            const chunkIndex = parseInt(attrs.chunkIndex || '0', 10);
            
            if (!receivedChunks.has(chunkIndex)) {
              receivedChunks.add(chunkIndex);
              
              const data = entity.toJSON();
              const chunk: VideoChunk = {
                entityKey: e.entityKey,
                streamId: attrs.streamId,
                chunkIndex,
                data: data.data, // base64 data
                timestamp: parseInt(attrs.timestamp || '0', 10),
                expiresAt: Date.now() + 3600000, // Approximate
              };

              callbacks.onChunkReceived?.(chunk);
              
              // Track highest chunk index
              if (chunkIndex > lastChunkIndex) {
                lastChunkIndex = chunkIndex;
              }
            }
          }
        } catch (err) {
          callbacks.onError?.(err as Error);
        }
      },
      onError: (err) => {
        // Filter out block range errors - subscriptions still work for new events
        const errorMsg = err?.message || String(err);
        if (!errorMsg.includes('exceed max block range') && !errorMsg.includes('max block range params')) {
          callbacks.onError?.(err as Error);
        }
      },
    });

    return stop;
  }

  /**
   * Query chunks for a stream (for catch-up/replay)
   */
  async getStreamChunks(streamId: string, startIndex?: number, endIndex?: number): Promise<VideoChunk[]> {
    try {
      const query = this.publicClient.buildQuery();
      const result = await query
        .where(and(eq('type', 'video-chunk'), eq('streamId', streamId)))
        .withAttributes(true)
        .withPayload(true)
        .fetch();

    const chunks: VideoChunk[] = [];

    for (const entity of result.entities) {
      try {
        const attrs = Object.fromEntries(
          entity.attributes.map(a => [a.key, a.value])
        );

        const chunkIndex = parseInt(attrs.chunkIndex || '0', 10);
        
        // Apply index filters if provided
        if (startIndex !== undefined && chunkIndex < startIndex) continue;
        if (endIndex !== undefined && chunkIndex > endIndex) continue;

        const data = entity.toJSON();
        chunks.push({
          entityKey: entity.entityKey,
          streamId: attrs.streamId,
          chunkIndex,
          data: data.data,
          timestamp: parseInt(attrs.timestamp || '0', 10),
          expiresAt: Date.now() + 3600000, // Approximate
        });
      } catch (error) {
        console.error('Error parsing chunk:', error);
      }
    }

      // Sort by chunk index
      return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    } catch (error) {
      console.error('Error getting stream chunks:', error);
      return [];
    }
  }

  /**
   * Get stream metadata
   */
  async getStream(streamId: string): Promise<VideoStream | null> {
    try {
      const query = this.publicClient.buildQuery();
      const result = await query
        .where(and(eq('type', 'video-stream'), eq('streamId', streamId)))
        .withAttributes(true)
        .withPayload(true)
        .fetch();

      if (result.entities.length === 0) {
        return null;
      }

      const entity = result.entities[0];
      const data = entity.toJSON() as VideoStream;
      return data;
    } catch (error) {
      console.error('Error getting stream:', error);
      return null;
    }
  }

  getAccountAddress(): string {
    return this.account.address;
  }
}

