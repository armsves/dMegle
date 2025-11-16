const API_BASE = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, 'ws');
let currentStreamId = null;
let ws = null;
let cameraStream = null;
let mediaRecorder = null;
let isStreaming = false;
let chunkIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  initializeWebSocket();
  loadAccount();
  setupEventListeners();
});

// Initialize WebSocket connection
function initializeWebSocket() {
  ws = new WebSocket(`${WS_BASE}`);
  
  ws.onopen = () => {
    updateConnectionStatus(true);
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
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') {
        updateConnectionStatus(true);
        console.log('WebSocket connected to server');
      } else if (data.type === 'error') {
        console.error('WebSocket error from server:', data.message);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
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

async function loadAccount() {
  try {
    const response = await fetch(`${API_BASE}/api/account`);
    const data = await response.json();
    document.getElementById('accountAddress').textContent = 
      `Account: ${data.address.slice(0, 10)}...${data.address.slice(-8)}`;
  } catch (error) {
    console.error('Failed to load account:', error);
  }
}

function setupEventListeners() {
  document.getElementById('startCameraBtn').addEventListener('click', async () => {
    await startCameraStream();
  });

  document.getElementById('stopCameraBtn').addEventListener('click', () => {
    stopCameraStream();
  });
}

// Auto-create stream (used internally)
async function createStreamAuto(title) {
  const expiresIn = 3600; // Fixed to 1 hour

  try {
    const response = await fetch(`${API_BASE}/api/streams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, expiresIn }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create stream');
    }

    const data = await response.json();
    const streamId = data.streamId;
    
    // Handle case where stream might be null
    if (!data.stream) {
      throw new Error('Failed to create stream - no stream data returned');
    }

    // Show share link
    const watchUrl = `${window.location.origin}/watch?stream=${streamId}`;
    document.getElementById('watchUrl').value = watchUrl;
    document.getElementById('shareLink').style.display = 'block';
    document.getElementById('streamInfo').innerHTML = `
      <p><strong>Stream ID:</strong> ${streamId}</p>
      <p><strong>Title:</strong> ${data.stream.title || 'Untitled Stream'}</p>
      <p><strong>Status:</strong> Streaming</p>
    `;

    return streamId;
  } catch (error) {
    console.error('Error creating stream:', error);
    throw error;
  }
}

function copyLink() {
  const input = document.getElementById('watchUrl');
  input.select();
  document.execCommand('copy');
  showNotification('Link copied to clipboard!', 'success');
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Camera streaming functions
async function startCameraStream() {
  // Check WebSocket connection first
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showNotification('WebSocket not connected. Please wait...', 'error');
    return;
  }

  // Auto-create stream if we don't have one
  let streamId = currentStreamId;
  
  if (!streamId) {
    const statusEl = document.getElementById('cameraStatus');
    if (statusEl) {
      statusEl.innerHTML = '<p style="color: var(--info);">Creating stream...</p>';
    }
    
    try {
      const title = document.getElementById('streamTitle').value.trim() || `Stream ${new Date().toLocaleTimeString()}`;
      streamId = await createStreamAuto(title);
      
      if (!streamId) {
        showNotification('Failed to create stream', 'error');
        return;
      }
      
      currentStreamId = streamId;
    } catch (error) {
      console.error('Error creating stream:', error);
      showNotification(`Error creating stream: ${error.message}`, 'error');
      if (statusEl) {
        statusEl.innerHTML = `<p style="color: var(--danger);">❌ Error: ${error.message}</p>`;
      }
      return;
    }
  }

  try {
    // Request camera and microphone access with optimized settings for streaming
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: 480, 
        height: 360,
        frameRate: 15 // Lower frame rate for smaller chunks
      },
      audio: true // Enable audio capture
    });

    const videoPreview = document.getElementById('cameraPreview');
    videoPreview.srcObject = cameraStream;

    // Set up MediaRecorder with audio and video compression for low latency
    const options = {
      mimeType: 'video/webm;codecs=vp8,opus', // VP8 for video, Opus for audio
      videoBitsPerSecond: 150000, // 150 kbps for video
      audioBitsPerSecond: 64000 // 64 kbps for audio
    };

    mediaRecorder = new MediaRecorder(cameraStream, options);
    chunkIndex = 0;
    let pendingChunks = []; // Queue to ensure sequential sending
    let isSending = false; // Flag to prevent concurrent sending

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        // Convert blob to array buffer
        const arrayBuffer = await event.data.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Each stop/start cycle creates a complete WebM file
        // These are valid standalone files that can be played
        console.log(`Received complete WebM file, size: ${uint8Array.length} bytes`);
        
        pendingChunks.push({
          index: chunkIndex++,
          data: Array.from(uint8Array),
          timestamp: Date.now()
        });
        console.log(`Added chunk ${chunkIndex - 1}, size: ${uint8Array.length} bytes`);
        
        // Trigger sending if not already sending
        if (!isSending) {
          sendChunksSequentially();
        }
      }
    };

    mediaRecorder.onstop = () => {
      console.log('MediaRecorder stopped');
      // Restart recording after a brief pause to create a new complete WebM file
      if (isStreaming && mediaRecorder && mediaRecorder.state !== 'recording') {
        setTimeout(() => {
          if (isStreaming && mediaRecorder) {
            mediaRecorder.start();
            console.log('MediaRecorder restarted');
          }
        }, 50);
      }
    };

    // Send chunks one at a time to ensure order
    async function sendChunksSequentially() {
      if (isSending) return; // Already sending
      isSending = true;
      
      while (pendingChunks.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
        const chunk = pendingChunks[0];
        
        try {
          // Send chunk
          ws.send(JSON.stringify({
            type: 'camera-chunk',
            streamId,
            chunkIndex: chunk.index,
            data: chunk.data,
            timestamp: chunk.timestamp,
          }));
          
          console.log(`Sent chunk ${chunk.index} to server`);
          
          // Remove from queue
          pendingChunks.shift();
          
          // Minimal delay to ensure order (1ms between chunks for low latency)
          await new Promise(resolve => setTimeout(resolve, 1));
        } catch (error) {
          console.error('Error sending chunk:', error);
          break; // Stop on error
        }
      }
      
      isSending = false;
      
      // If more chunks arrived while sending, process them
      if (pendingChunks.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
        setTimeout(() => sendChunksSequentially(), 10);
      }
    }

    // Start recording without timeslice - we'll manually stop/start
    // This ensures each chunk is a complete WebM file, not a fragment
    mediaRecorder.start();
    console.log('MediaRecorder started (manual chunking mode)');
    
    // Create chunks by stopping and restarting every 4 seconds
    // This creates complete, valid WebM files (2x bigger than before)
    window.chunkInterval = setInterval(() => {
      if (isStreaming && mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop(); // This will trigger ondataavailable and onstop
      }
    }, 4000);

    isStreaming = true;
    document.getElementById('startCameraBtn').style.display = 'none';
    document.getElementById('stopCameraBtn').style.display = 'inline-block';
    document.getElementById('cameraStatus').innerHTML = 
      '<p style="color: var(--success);">📹 Streaming camera to Arkiv...</p>';

    showNotification('Camera streaming started!', 'success');
  } catch (error) {
    console.error('Error starting camera:', error);
    showNotification(`Error: ${error.message}`, 'error');
    document.getElementById('cameraStatus').innerHTML = 
      `<p style="color: var(--danger);">❌ Error: ${error.message}</p>`;
  }
}

function stopCameraStream() {
  isStreaming = false; // Set this first to stop the restart cycle
  
  // Clear chunk interval if it exists
  if (window.chunkInterval) {
    clearInterval(window.chunkInterval);
    window.chunkInterval = null;
  }
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const videoPreview = document.getElementById('cameraPreview');
  videoPreview.srcObject = null;

  document.getElementById('startCameraBtn').style.display = 'inline-block';
  document.getElementById('stopCameraBtn').style.display = 'none';
  document.getElementById('cameraStatus').innerHTML = 
    '<p style="color: var(--info);">Camera stopped</p>';

  showNotification('Camera streaming stopped', 'info');
}

// Check URL params for stream ID
const urlParams = new URLSearchParams(window.location.search);
const streamParam = urlParams.get('stream');
if (streamParam) {
  currentStreamId = streamParam;
}

