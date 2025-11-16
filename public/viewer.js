const API_BASE = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, 'ws');

let ws = null;
let currentStreamId = null;
let persistentStreamId = null; // Store stream ID from URL - never cleared
let receivedChunks = new Map();
let videoChunks = [];
let mediaSource = null;
let sourceBuffer = null;
let videoElement = null;
let isVideoInitialized = false;
let blobUpdateTimeout = null;
let chunkQueue = [];
let useBlobMethod = false;
let lastBlobChunkCount = 0; // Track how many chunks were in the last blob update
let lastVideoDuration = 0; // Track the duration of the last video blob

document.addEventListener('DOMContentLoaded', () => {
  // Check URL params for stream ID FIRST, before WebSocket connects
  const urlParams = new URLSearchParams(window.location.search);
  const streamParam = urlParams.get('stream') || urlParams.get('streamId');
  
  console.log('Page loaded, URL params:', window.location.search);
  console.log('Stream param from URL:', streamParam);
  
  if (streamParam) {
    const streamIdInput = document.getElementById('streamIdInput');
    if (streamIdInput) {
      streamIdInput.value = streamParam;
      console.log('Set input field value to:', streamParam);
      // Set both currentStreamId and persistentStreamId immediately
      currentStreamId = streamParam;
      persistentStreamId = streamParam; // Never cleared
      console.log('Set currentStreamId to:', currentStreamId);
      console.log('Set persistentStreamId to:', persistentStreamId);
    } else {
      console.error('streamIdInput element not found!');
    }
  } else {
    console.log('No stream parameter in URL');
  }
  
  initializeWebSocket();
  setupEventListeners();
  
  // Auto-start watching immediately if stream param exists
  if (streamParam) {
    console.log('Auto-starting watch for stream:', streamParam);
    // Start watching immediately - WebSocket will retry if not connected
    setTimeout(() => {
      startWatching();
    }, 500);
  }
});

function initializeWebSocket() {
  ws = new WebSocket(`${WS_BASE}`);
  
  ws.onopen = () => {
    updateConnectionStatus(true);
    // Use persistentStreamId if currentStreamId is null (e.g., after reconnect)
    const streamIdToUse = currentStreamId || persistentStreamId;
    console.log('WebSocket connected, currentStreamId:', currentStreamId, 'persistentStreamId:', persistentStreamId);
    
    // If we have a streamId (from URL or previous session), subscribe immediately
    if (streamIdToUse) {
      console.log('WebSocket connected, auto-subscribing to stream:', streamIdToUse);
      currentStreamId = streamIdToUse; // Restore currentStreamId if it was lost
      
      // Update input field
      const streamIdInput = document.getElementById('streamIdInput');
      if (streamIdInput && streamIdInput.value !== streamIdToUse) {
        streamIdInput.value = streamIdToUse;
      }
      
      ws.send(JSON.stringify({
        type: 'subscribe',
        streamId: streamIdToUse,
      }));
    } else {
      console.log('WebSocket connected but no streamId yet - will subscribe when startWatching is called');
    }
  };
  
  ws.onclose = () => {
    updateConnectionStatus(false);
    setTimeout(initializeWebSocket, 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateConnectionStatus(false);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    if (connected) {
      statusEl.textContent = '● Connected';
      statusEl.className = 'status-indicator connected';
    } else {
      statusEl.textContent = '○ Disconnected';
      statusEl.className = 'status-indicator disconnected';
    }
  }
}

function handleWebSocketMessage(data) {
  console.log('handleWebSocketMessage: Received message type:', data.type, 'data:', data);
  
  switch (data.type) {
    case 'connected':
      console.log('WebSocket connected message received');
      updateConnectionStatus(true);
      break;
    case 'subscribed':
      console.log('Successfully subscribed to stream:', data.streamId);
      const streamStatus = document.getElementById('streamStatus');
      if (streamStatus) {
        streamStatus.textContent = 'Subscribed - waiting for chunks...';
      }
      // Ensure stream ID is set
      if (data.streamId) {
        currentStreamId = data.streamId;
        if (!persistentStreamId) {
          persistentStreamId = data.streamId;
        }
        console.log('Set stream IDs from subscription:', currentStreamId, persistentStreamId);
      }
      break;
    case 'chunk':
      // Handle chunks from both global broadcast and per-client subscription
      const chunkStreamId = data.streamId;
      const activeStreamId = currentStreamId || persistentStreamId;
      console.log('Received chunk message:', {
        chunkStreamId,
        chunkIndex: data.chunkIndex,
        currentStreamId,
        persistentStreamId,
        activeStreamId,
        dataSize: data.data?.length || 0
      });
      
      if (!chunkStreamId) {
        console.warn('Chunk message missing streamId');
        break;
      }
      
      // Restore currentStreamId if it was lost but we have persistentStreamId
      if (!currentStreamId && persistentStreamId && chunkStreamId === persistentStreamId) {
        console.log('Restoring currentStreamId from persistentStreamId');
        currentStreamId = persistentStreamId;
      }
      
      // Match chunks - be more lenient to catch any chunks
      const shouldProcess = chunkStreamId === activeStreamId || 
                           chunkStreamId === currentStreamId || 
                           chunkStreamId === persistentStreamId ||
                           (!activeStreamId && !currentStreamId && !persistentStreamId); // If no stream ID set, accept all
      
      if (shouldProcess) {
        const chunk = {
          chunkIndex: data.chunkIndex,
          data: data.data,
          timestamp: data.timestamp,
        };
        console.log('✅ Processing chunk:', chunk.chunkIndex, 'for stream:', chunkStreamId);
        handleChunkData(chunk);
      } else {
        console.log('❌ Ignoring chunk for different stream:', chunkStreamId, 'active:', activeStreamId, 'current:', currentStreamId, 'persistent:', persistentStreamId);
      }
      break;
    case 'stream:complete':
      document.getElementById('streamStatus').textContent = 'Stream Complete';
      // Final update of video
      if (useBlobMethod) {
        updateBlobVideo();
      }
      break;
    case 'error':
      console.error('WebSocket error:', data.message);
      const statusEl = document.getElementById('streamStatus');
      if (statusEl) {
        statusEl.textContent = 'Error: ' + data.message;
      }
      break;
    default:
      console.log('Unknown WebSocket message type:', data.type, data);
  }
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (connected) {
    statusEl.textContent = '● Connected';
    statusEl.className = 'status-indicator connected';
  } else {
    statusEl.textContent = '○ Disconnected';
    statusEl.className = 'status-indicator disconnected';
  }
}

function setupEventListeners() {
  const form = document.getElementById('watchForm');
  if (!form) {
    console.error('Watch form not found');
    return;
  }
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Start watching button clicked');
    try {
      await startWatching();
    } catch (error) {
      console.error('Error starting watch:', error);
      alert('Error starting watch: ' + error.message);
    }
  });
}

async function startWatching() {
  // Priority order: URL params > persistentStreamId > input field
  const urlParams = new URLSearchParams(window.location.search);
  let streamId = urlParams.get('stream') || urlParams.get('streamId');
  
  // Fall back to persistent stream ID if no URL param
  if (!streamId && persistentStreamId) {
    streamId = persistentStreamId;
    console.log('Using persistentStreamId:', streamId);
  }
  
  // Fall back to input field if still no stream ID
  if (!streamId) {
    const streamIdInput = document.getElementById('streamIdInput');
    if (!streamIdInput) {
      console.error('Stream ID input not found');
      return;
    }
    streamId = streamIdInput.value.trim();
  }
  
  if (!streamId) {
    alert('Please enter a stream ID');
    return;
  }

  console.log('Starting to watch stream:', streamId);
  console.log('Current WebSocket state:', ws ? ws.readyState : 'not initialized');
  console.log('persistentStreamId:', persistentStreamId);

  // Set BOTH currentStreamId and persistentStreamId
  currentStreamId = streamId;
  persistentStreamId = streamId; // Always keep this set
  console.log('Set currentStreamId to:', currentStreamId);
  console.log('Set persistentStreamId to:', persistentStreamId);
  
  // Make sure input field has the value
  const streamIdInput = document.getElementById('streamIdInput');
  if (streamIdInput && streamIdInput.value !== streamId) {
    streamIdInput.value = streamId;
    console.log('Updated input field with stream ID:', streamId);
  }
  receivedChunks.clear();
  videoChunks = [];
  chunkQueue = [];
  isVideoInitialized = false;
  useBlobMethod = true; // Use blob method
  lastBlobChunkCount = 0; // Reset chunk count tracking
  lastVideoDuration = 0; // Reset video duration tracking
  
  // Clean up previous video
  if (blobUpdateTimeout) {
    clearTimeout(blobUpdateTimeout);
    blobUpdateTimeout = null;
  }
  if (videoElement) {
    videoElement.pause();
    if (videoElement.src && videoElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(videoElement.src);
    }
    videoElement.src = '';
    videoElement = null;
  }
  if (mediaSource) {
    if (mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream();
      } catch (e) {
        // Ignore errors when ending stream
      }
    }
    mediaSource = null;
  }
  sourceBuffer = null;

  // Clear chunk log
  const chunkLog = document.getElementById('chunkLog');
  if (chunkLog) {
    chunkLog.innerHTML = '<p>Chunks will appear here as they\'re received...</p>';
  }

  // Update UI immediately
  const streamStatus = document.getElementById('streamStatus');
  const streamStats = document.getElementById('streamStats');
  const videoContainer = document.getElementById('videoContainer');
  
  if (streamStatus) {
    streamStatus.textContent = 'Connecting...';
  }
  if (streamStats) {
    streamStats.style.display = 'flex';
  }
  if (videoContainer) {
    videoContainer.innerHTML = `
      <div class="empty-state">
        <h3>📹 Receiving stream...</h3>
        <p>Chunks will appear as they're received from Arkiv</p>
      </div>
    `;
  }

  // Load stream info (for display only, not for playback)
  try {
    const response = await fetch(`${API_BASE}/api/streams/${streamId}`);
    const data = await response.json();
    console.log('Stream info loaded:', data);
    
    if (streamStatus) {
      streamStatus.textContent = 'Watching live stream (starting from latest chunk)...';
    }
  } catch (error) {
    console.error('Failed to load stream info:', error);
    if (streamStatus) {
      streamStatus.textContent = 'Error loading stream info';
    }
  }

  // Subscribe via WebSocket (live mode - no historical chunks)
  const subscribeToStream = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const streamIdToSubscribe = streamId || currentStreamId || persistentStreamId;
      if (!streamIdToSubscribe) {
        console.error('No stream ID available for subscription');
        return false;
      }
      
      console.log('Subscribing to stream via WebSocket:', streamIdToSubscribe);
      try {
        ws.send(JSON.stringify({
          type: 'subscribe',
          streamId: streamIdToSubscribe,
        }));
        console.log('✅ Subscribed to stream:', streamIdToSubscribe);
        
        // Ensure both IDs are set
        currentStreamId = streamIdToSubscribe;
        if (!persistentStreamId) {
          persistentStreamId = streamIdToSubscribe;
        }
        
        // Update UI to show we're ready
        if (streamStatus) {
          streamStatus.textContent = 'Connected - waiting for video...';
        }
        
        return true;
      } catch (error) {
        console.error('Error sending subscription message:', error);
        return false;
      }
    }
    return false;
  };
  
  if (!subscribeToStream()) {
    console.warn('WebSocket not ready, will retry...');
    let attempts = 0;
    const maxAttempts = 10; // 5 seconds total
    const checkWs = setInterval(() => {
      attempts++;
      if (subscribeToStream()) {
        console.log('✅ Connected after', attempts, 'attempts');
        clearInterval(checkWs);
      } else if (attempts >= maxAttempts) {
        console.error('❌ Failed to connect after', maxAttempts, 'attempts');
        clearInterval(checkWs);
        if (streamStatus) {
          streamStatus.textContent = 'Connection failed - please refresh';
        }
      }
    }, 500);
  }

  // For MediaSource API, we can start playing chunks as they arrive
  // Each chunk is a self-contained WebM segment
  console.log('Live mode: waiting for chunks to arrive (MediaSource streaming)...');
}

function handleChunkData(chunk) {
  if (receivedChunks.has(chunk.chunkIndex)) {
    return; // Already received
  }

  console.log(`handleChunkData: Processing new chunk ${chunk.chunkIndex}, data type: ${typeof chunk.data}, isArray: ${Array.isArray(chunk.data)}, data length: ${chunk.data?.length || 0}`);
  
  receivedChunks.set(chunk.chunkIndex, chunk.data);
  
  // Add to sorted array
  videoChunks.push({
    index: chunk.chunkIndex,
    data: chunk.data,
  });
  videoChunks.sort((a, b) => a.index - b.index);
  
  // Keep only last 10 chunks to reduce memory usage and improve performance
  if (videoChunks.length > 10) {
    videoChunks = videoChunks.slice(-10);
  }
  
  console.log(`handleChunkData: Total chunks now: ${videoChunks.length}`);

  // Update UI
  updateChunkLog(chunk);
  updateStats();
  updateVideoDisplay();
  
  // Update video immediately for real-time streaming
  // Start playing as soon as we have chunks
  if (videoChunks.length >= 1) {
    console.log(`handleChunkData: Calling addChunkToVideo for chunk ${chunk.chunkIndex}`);
    // Pass the chunk object with both index and chunkIndex for compatibility
    addChunkToVideo({
      index: chunk.chunkIndex,
      chunkIndex: chunk.chunkIndex,
      data: chunk.data,
      timestamp: chunk.timestamp
    });
  }
}

function getSequentialChunkCount() {
  if (videoChunks.length === 0) return 0;
  
  // Find the longest sequence of sequential chunks
  let maxSequential = 1;
  let currentSequential = 1;
  
  for (let i = 1; i < videoChunks.length; i++) {
    if (videoChunks[i].index === videoChunks[i - 1].index + 1) {
      currentSequential++;
      maxSequential = Math.max(maxSequential, currentSequential);
    } else {
      currentSequential = 1;
    }
  }
  
  return maxSequential;
}

function getChunkRange() {
  if (videoChunks.length === 0) return 'none';
  const min = Math.min(...videoChunks.map(c => c.index));
  const max = Math.max(...videoChunks.map(c => c.index));
  return `${min}-${max}`;
}

function updateChunkLog(chunk) {
  const log = document.getElementById('chunkLog');
  const item = document.createElement('div');
  item.className = 'chunk-item';
  item.innerHTML = `
    <span>Chunk #${chunk.chunkIndex}</span>
    <span>${(chunk.data.length / 1024).toFixed(2)} KB</span>
  `;
  log.insertBefore(item, log.firstChild);
  
  // Keep only last 50
  while (log.children.length > 50) {
    log.removeChild(log.lastChild);
  }
}

function updateStats() {
  document.getElementById('chunkCount').textContent = receivedChunks.size;
  document.getElementById('streamStatus').textContent = 
    receivedChunks.size > 0 ? 'Receiving chunks...' : 'Waiting for chunks...';
}

function updateVideoDisplay() {
  const container = document.getElementById('videoContainer');
  
  if (videoChunks.length === 0) {
    return;
  }

  // Initialize video element if not already done
  if (!videoElement) {
    videoElement = document.createElement('video');
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.muted = false;
    videoElement.loop = false; // Disable looping to prevent restarting
      videoElement.style.width = '100%';
      videoElement.style.maxWidth = '800px';
      videoElement.style.borderRadius = '8px';
      videoElement.style.backgroundColor = '#1a1a2e';
    
    container.innerHTML = '';
    container.appendChild(videoElement);
    
    // When video ends, update immediately with new chunks
    videoElement.addEventListener('ended', () => {
      console.log('Video ended, updating with new chunks...');
      // Trigger update to get latest chunks
      useBlobFallback();
    });
    
    // Also check periodically if video is near end and update
    videoElement.addEventListener('timeupdate', () => {
      const duration = videoElement.duration;
      const currentTime = videoElement.currentTime;
      const timeRemaining = duration - currentTime;
      
      // If less than 0.5 seconds remaining, trigger update check
      if (isFinite(duration) && isFinite(currentTime) && timeRemaining < 0.5 && timeRemaining > 0) {
        useBlobFallback();
      }
    });
    
    // Add error handler to debug video loading issues
    videoElement.addEventListener('error', (e) => {
      console.error('Video element error:', e);
      console.error('Video error details:', {
        error: videoElement.error,
        code: videoElement.error?.code,
        message: videoElement.error?.message,
        src: videoElement.src,
        networkState: videoElement.networkState,
        readyState: videoElement.readyState
      });
    });
    
    videoElement.addEventListener('loadstart', () => {
      console.log('Video loadstart event');
    });
    
    videoElement.addEventListener('loadeddata', () => {
      console.log('Video loadeddata event, duration:', videoElement.duration);
    });
    
    videoElement.addEventListener('canplay', () => {
      console.log('Video canplay event');
    });
    
    initializeMediaSource();
  }

  // Calculate total size
  const totalSize = videoChunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
}

function initializeMediaSource() {
  // Use blob method - MediaRecorder creates complete WebM segments, not fragments
  // MediaSource API requires fragments, so we use blob URL concatenation instead
  useBlobMethod = true;
  useBlobFallback();
}

function appendChunkToMediaSource(chunk) {
  const chunkIndex = chunk.index !== undefined ? chunk.index : chunk.chunkIndex;
  if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
    console.log('appendChunkToMediaSource: Not ready, queueing chunk', chunkIndex);
    chunkQueue.push(chunk);
    return;
  }

  // Convert chunk data to ArrayBuffer
  let chunkData;
  if (typeof chunk.data === 'string') {
    try {
      const binaryString = atob(chunk.data);
      chunkData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        chunkData[i] = binaryString.charCodeAt(i);
      }
    } catch (e) {
      console.error('Error decoding base64 chunk:', e);
      return;
    }
  } else if (Array.isArray(chunk.data)) {
    chunkData = new Uint8Array(chunk.data);
  } else {
    console.error('Unknown chunk data format');
    return;
  }

  // Append chunk to SourceBuffer
  if (sourceBuffer.updating) {
    console.log('appendChunkToMediaSource: SourceBuffer updating, queueing chunk', chunkIndex);
    chunkQueue.push(chunk);
    return;
  }

  try {
    sourceBuffer.appendBuffer(chunkData);
    console.log(`✅ Appended chunk ${chunkIndex} to MediaSource (${chunkData.length} bytes)`);
    
    // Play video if paused and we have enough data
    if (videoElement.paused && videoElement.readyState >= 2) {
      videoElement.play().catch(err => console.warn('Auto-play blocked:', err));
    }
  } catch (error) {
    console.error(`Error appending chunk ${chunkIndex}:`, error);
    if (error.name === 'QuotaExceededError') {
      // Buffer is full, remove old data
      try {
        if (sourceBuffer.buffered.length > 0) {
          const start = sourceBuffer.buffered.start(0);
          const end = sourceBuffer.buffered.end(0);
          const removeEnd = Math.min(start + 2, end); // Remove first 2 seconds
          console.log(`Removing old data: ${start} to ${removeEnd}`);
          sourceBuffer.remove(start, removeEnd);
          
          sourceBuffer.addEventListener('updateend', () => {
            try {
              if (!sourceBuffer.updating) {
                sourceBuffer.appendBuffer(chunkData);
                console.log(`✅ Appended chunk ${chunkIndex} after removing old data`);
              }
            } catch (e2) {
              console.error('Error retrying append:', e2);
            }
          }, { once: true });
        }
      } catch (removeError) {
        console.error('Error removing old data:', removeError);
      }
    } else {
      // Queue for retry
      chunkQueue.push(chunk);
    }
  }
}

function processChunkQueue() {
  if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
    return;
  }

  if (sourceBuffer.updating) {
    // Wait for current update to finish
    sourceBuffer.addEventListener('updateend', processChunkQueue, { once: true });
    return;
  }

  if (chunkQueue.length === 0) {
    return;
  }

  // Sort queue by index (handle both index and chunkIndex properties)
  chunkQueue.sort((a, b) => {
    const aIndex = a.index !== undefined ? a.index : a.chunkIndex;
    const bIndex = b.index !== undefined ? b.index : b.chunkIndex;
    return aIndex - bIndex;
  });
  
  // Process chunks in order
  while (chunkQueue.length > 0 && !sourceBuffer.updating) {
    const chunk = chunkQueue.shift();
    appendChunkToMediaSource(chunk);
  }
}

function addChunkToVideo(chunk) {
  // Always use blob method - MediaRecorder creates complete WebM segments, not fragments
  // MediaSource API requires fragments, so blob URL concatenation works better
  useBlobFallback();
}

function appendToSourceBuffer(chunkData) {
  if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
    console.warn('appendToSourceBuffer: SourceBuffer or MediaSource not ready, falling back to blob');
    useBlobMethod = true;
    useBlobFallback();
    return;
  }

  // Check if sourceBuffer is updating
  if (sourceBuffer.updating) {
    console.log('appendToSourceBuffer: SourceBuffer is updating, queueing chunk');
    // Queue for later
    sourceBuffer.addEventListener('updateend', () => {
      try {
        if (!sourceBuffer.updating) {
          sourceBuffer.appendBuffer(chunkData);
          console.log('appendToSourceBuffer: Appended chunk after updateend, size:', chunkData.byteLength);
        }
      } catch (e) {
        console.error('appendToSourceBuffer: Error appending to source buffer:', e);
        useBlobMethod = true;
        useBlobFallback();
      }
    }, { once: true });
    return;
  }

  try {
    sourceBuffer.appendBuffer(chunkData);
    console.log('appendToSourceBuffer: Appended chunk to source buffer, size:', chunkData.byteLength);
    
    // Check if we need to end the stream (for final chunk)
    // For now, we'll keep it open for continuous streaming
  } catch (e) {
    console.error('appendToSourceBuffer: Error appending to source buffer:', e, e.name);
    // If buffer is full, try to remove old data
    if (e.name === 'QuotaExceededError') {
      try {
        // Remove old data (first 1 second)
        if (sourceBuffer.buffered.length > 0) {
          const start = sourceBuffer.buffered.start(0);
          const end = sourceBuffer.buffered.end(0);
          const removeEnd = Math.min(start + 1, end); // Remove first second
          console.log(`appendToSourceBuffer: Removing old data from ${start} to ${removeEnd}`);
          sourceBuffer.remove(start, removeEnd);
          
          // Retry append after removal
          sourceBuffer.addEventListener('updateend', () => {
            try {
              if (!sourceBuffer.updating) {
                sourceBuffer.appendBuffer(chunkData);
                console.log('appendToSourceBuffer: Successfully appended after removing old data');
              }
            } catch (e2) {
              console.error('appendToSourceBuffer: Error retrying append:', e2);
              useBlobMethod = true;
              useBlobFallback();
            }
          }, { once: true });
        } else {
          // No buffered data, switch to blob method
          console.warn('appendToSourceBuffer: No buffered data to remove, switching to blob method');
          useBlobMethod = true;
          useBlobFallback();
        }
      } catch (removeError) {
        console.error('appendToSourceBuffer: Error removing old data:', removeError);
        useBlobMethod = true;
        useBlobFallback();
      }
    } else {
      // Other error, switch to blob method
      console.error('appendToSourceBuffer: Unknown error, switching to blob method');
      useBlobMethod = true;
      useBlobFallback();
    }
  }
}

function useBlobFallback() {
  if (videoChunks.length === 0) {
    return;
  }

  if (!videoElement) {
    updateVideoDisplay();
    setTimeout(() => useBlobFallback(), 100);
    return;
  }

  // Update immediately when any new chunk arrives for true live streaming
  const newChunksCount = videoChunks.length - lastBlobChunkCount;
  
  if (newChunksCount >= 1) {
    if (blobUpdateTimeout) {
      clearTimeout(blobUpdateTimeout);
    }
    console.log(`useBlobFallback: New chunk arrived, updating video for live playback...`);
    blobUpdateTimeout = setTimeout(() => {
      updateBlobVideo();
    }, 50);
  }
}

async function updateBlobVideo() {
  if (videoChunks.length === 0) {
    console.log('updateBlobVideo: No chunks to display');
    return;
  }

  if (!videoElement) {
    console.log('updateBlobVideo: Video element not found, creating it');
    updateVideoDisplay();
    // Retry after video element is created
    setTimeout(() => updateBlobVideo(), 100);
    return;
  }

  try {
    if (videoChunks.length === 0) {
      return;
    }
    
    // Sort chunks by index
    const sortedChunks = [...videoChunks].sort((a, b) => a.index - b.index);
    
    // For true live streaming: play ONLY the latest chunk (no buffering)
    // When it ends, we pause until the next chunk arrives
    const latestChunk = sortedChunks[sortedChunks.length - 1];
    const recentChunks = [latestChunk];
    
    console.log(`updateBlobVideo: Playing latest chunk ${latestChunk.index} LIVE (no buffer)`);
    
    // Convert chunk to binary
    const chunkArrays = [];
    for (const chunk of recentChunks) {
      let chunkData;
      if (typeof chunk.data === 'string') {
        try {
          const binaryString = atob(chunk.data);
          chunkData = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            chunkData[i] = binaryString.charCodeAt(i);
          }
        } catch (e) {
          console.error('Error decoding base64 chunk:', e);
          continue;
        }
      } else if (Array.isArray(chunk.data)) {
        chunkData = new Uint8Array(chunk.data);
      } else {
        console.error('Unknown chunk data format');
        continue;
      }
      
      if (chunkData && chunkData.length > 0) {
        chunkArrays.push(chunkData);
      }
    }

    if (chunkArrays.length === 0) {
      console.warn('updateBlobVideo: No valid chunks after conversion');
      return;
    }

    // Combine recent chunks
    const totalLength = chunkArrays.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    chunkArrays.forEach(chunk => {
      combined.set(chunk, offset);
      offset += chunk.length;
    });

    console.log(`updateBlobVideo: Created combined blob, total size: ${totalLength} bytes`);

    // Create blob from combined data
    const blob = new Blob([combined], { type: 'video/webm; codecs=vp8' });
    
    if (videoElement) {
      // Save playback state
      const wasPlaying = !videoElement.paused;
      
      // Revoke old URL if exists
      if (videoElement.src && videoElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(videoElement.src);
      }
      
      const url = URL.createObjectURL(blob);
      console.log(`updateBlobVideo: Set video src to blob URL`);
      videoElement.loop = false; // Don't loop
      videoElement.src = url;
      videoElement.load();
      
      // Play when ready
      const playWhenReady = () => {
        console.log('updateBlobVideo: Video can play, duration:', videoElement.duration);
        videoElement.removeEventListener('canplay', playWhenReady);
        
        // For live streaming: always play from the beginning of each chunk
        videoElement.currentTime = 0;
        
        // Always auto-play for live streaming
        videoElement.play().catch((err) => {
          console.warn('updateBlobVideo: Auto-play blocked:', err);
        });
        
        // Update status
        const statusEl = document.getElementById('streamStatus');
        if (statusEl) {
          statusEl.textContent = `🔴 LIVE (chunk ${latestChunk.index})`;
        }
      };
      
      videoElement.addEventListener('canplay', playWhenReady, { once: true });
      
      // When video ends, PAUSE and wait for next chunk
      const handleEnded = () => {
        console.log('updateBlobVideo: Chunk ended, pausing and waiting for next chunk...');
        videoElement.pause();
        const statusEl = document.getElementById('streamStatus');
        if (statusEl) {
          statusEl.textContent = '⏸️ Waiting for next chunk...';
        }
      };
      videoElement.addEventListener('ended', handleEnded, { once: true });
      
      // Update chunk count
      lastBlobChunkCount = videoChunks.length;
      console.log(`updateBlobVideo: Updated blob video with ${recentChunks.length} chunks`);
    }
  } catch (error) {
    console.error('Error creating blob from chunks:', error);
  }
}

