/**
 * Video Streaming Demo
 * 
 * This script demonstrates streaming video via Arkiv subscriptions:
 * 1. Creates a video stream
 * 2. Publishes video chunks sequentially
 * 3. Subscribes to receive chunks in real-time
 */

import { ArkivVideoStreamer } from './video-streamer.js';
import { config } from './config.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('🎬 Arkiv Video Streaming Demo\n');
  console.log(`Account: ${config.privateKey ? '***' + config.privateKey.slice(-8) : 'Not configured'}`);
  console.log(`RPC: ${config.rpcUrl}\n`);

  const streamer = new ArkivVideoStreamer();
  const accountAddress = streamer.getAccountAddress();
  
  console.log(`✅ Connected to Arkiv Testnet`);
  console.log(`📝 Account Address: ${accountAddress}\n`);

  // Create a test video stream
  console.log('📹 Creating video stream...');
  const streamId = await streamer.createStream({
    title: 'Demo Video Stream',
    description: 'Testing real-time video streaming via Arkiv subscriptions',
    expiresIn: 3600, // 1 hour
  });
  console.log(`✅ Stream created: ${streamId}\n`);

  // Create a small test video file (or use existing)
  const testVideoPath = join(process.cwd(), 'test-video.bin');
  
  // Generate a small test file if it doesn't exist
  try {
    readFileSync(testVideoPath);
    console.log(`📁 Using existing test video: ${testVideoPath}`);
  } catch {
    console.log(`📁 Creating test video file...`);
    // Create a small test file (simulated video data)
    const testData = Buffer.alloc(200000); // ~200KB
    testData.fill(0x42); // Fill with test pattern
    writeFileSync(testVideoPath, testData);
    console.log(`✅ Created test video file: ${testVideoPath}`);
  }

  // Set up subscription BEFORE publishing (to catch chunks as they're created)
  console.log('\n📡 Setting up real-time subscription...');
  const receivedChunks: Map<number, string> = new Map();
  let chunkCount = 0;

  const stopSubscription = await streamer.subscribeToStream(streamId, {
    onChunkReceived: (chunk) => {
      chunkCount++;
      receivedChunks.set(chunk.chunkIndex, chunk.entityKey);
      console.log(`📥 [LIVE] Received chunk ${chunk.chunkIndex} (${(chunk.data.length / 1024).toFixed(2)} KB base64)`);
    },
    onError: (error) => {
      console.error('❌ Subscription error:', error.message);
    },
  });
  console.log('✅ Subscription active - ready to receive chunks\n');

  // Start streaming (publish chunks)
  console.log('🚀 Starting video stream...\n');
  
  try {
    await streamer.streamVideoFile(streamId, testVideoPath, 1);
  } catch (error: any) {
    console.error('❌ Streaming error:', error.message);
    stopSubscription();
    process.exit(1);
  }

  // Wait a bit for all chunks to be received
  console.log('\n⏳ Waiting for all chunks to be received via subscription...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log(`\n📊 Summary:`);
  console.log(`   Stream ID: ${streamId}`);
  console.log(`   Chunks received via subscription: ${chunkCount}`);
  console.log(`   Unique chunks: ${receivedChunks.size}`);

  // Query chunks to verify
  console.log('\n🔍 Querying chunks from Arkiv...');
  const queriedChunks = await streamer.getStreamChunks(streamId);
  console.log(`   Total chunks in Arkiv: ${queriedChunks.length}`);

  if (queriedChunks.length > 0) {
    console.log(`   First chunk index: ${queriedChunks[0].chunkIndex}`);
    console.log(`   Last chunk index: ${queriedChunks[queriedChunks.length - 1].chunkIndex}`);
  }

  // Stop subscription
  stopSubscription();
  console.log('\n✨ Demo complete!');
  console.log('💡 This demonstrates real-time video streaming via Arkiv subscriptions');
  console.log('   Each video chunk is stored as an Arkiv entity and streamed in real-time\n');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

