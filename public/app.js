const API_BASE = window.location.origin;
let ws = null;
let currentStreamId = null;
let receivedChunks = new Map();
let videoChunks = [];
let isWatching = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeWebSocket();
  loadAccount();
  loadStreams();
  setupEventListeners();
});

// WebSocket connection
function initializeWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    updateConnectionStatus(true);
    showNotification('Connected to real-time video streaming', 'success');
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

function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'connected':
      console.log('WebSocket connected');
      break;
    case 'chunk:received':
      if (isWatching && data.streamId === currentStreamId) {
        handleChunkReceived(data);
      }
      break;
    case 'chunk':
      // Direct chunk data from subscription
      handleChunkData(data.chunk);
      break;
    case 'stream:complete':
      showNotification(`Stream complete: ${data.streamId}`, 'success');
      break;
    case 'error':
      showNotification(`Error: ${data.message}`, 'error');
      break;
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

// Load account
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

// Load available streams
async function loadStreams() {
  // In a real app, you'd fetch list of streams
  // For now, streams are created and selected manually
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('createStreamForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await createStream();
  });

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await uploadVideo();
  });
}

// Create stream
async function createStream() {
  const title = document.getElementById('streamTitle').value;
  const description = document.getElementById('streamDescription').value;
  const expiresIn = parseInt(document.getElementById('streamExpiresIn').value, 10);

  try {
    const response = await fetch(`${API_BASE}/api/streams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, expiresIn }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create stream');
    }

    const data = await response.json();
    showNotification(`Stream created: ${data.streamId}`, 'success');
    
    // Add to stream select
    const select = document.getElementById('streamSelect');
    const option = document.createElement('option');
    option.value = data.streamId;
    option.textContent = `${data.stream.title} (${data.streamId.slice(0, 12)}...)`;
    select.appendChild(option);
    select.value = data.streamId;

    document.getElementById('createStreamForm').reset();
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// Upload video
async function uploadVideo() {
  const streamId = document.getElementById('streamSelect').value;
  const fileInput = document.getElementById('videoFile');
  
  if (!streamId) {
    showNotification('Please select a stream', 'error');
    return;
  }

  if (!fileInput.files || fileInput.files.length === 0) {
    showNotification('Please select a video file', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('video', fileInput.files[0]);

  try {
    showNotification('Uploading and streaming video...', 'info');
    
    const response = await fetch(`${API_BASE}/api/streams/${streamId}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload video');
    }

    const data = await response.json();
    showNotification('Video streaming started!', 'success');
    
    // Auto-start watching
    document.getElementById('watchStreamId').value = streamId;
    startWatching();
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// Start watching stream
async function startWatching() {
  const streamId = document.getElementById('watchStreamId').value;
  
  if (!streamId) {
    showNotification('Please enter a stream ID', 'error');
    return;
  }

  currentStreamId = streamId;
  isWatching = true;
  receivedChunks.clear();
  videoChunks = [];

  // Subscribe via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'subscribe',
      streamId,
    }));
  }

  // Load existing chunks
  try {
    const response = await fetch(`${API_BASE}/api/streams/${streamId}/chunks`);
    const data = await response.json();
    
    if (data.chunks && data.chunks.length > 0) {
      data.chunks.forEach(chunk => {
        handleChunkData({
          chunkIndex: chunk.chunkIndex,
          data: chunk.data,
          timestamp: chunk.timestamp,
        });
      });
    }
  } catch (error) {
    console.error('Failed to load chunks:', error);
  }

  // Load stream info
  try {
    const response = await fetch(`${API_BASE}/api/streams/${streamId}`);
    const data = await response.json();
    displayStreamInfo(data.stream);
  } catch (error) {
    console.error('Failed to load stream info:', error);
  }

  showNotification(`Watching stream: ${streamId}`, 'info');
}

function stopWatching() {
  isWatching = false;
  currentStreamId = null;
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'unsubscribe',
      streamId: currentStreamId,
    }));
  }

  document.getElementById('videoContainer').innerHTML = `
    <div class="empty-state">
      <h3>No stream active</h3>
      <p>Create a stream and upload a video, or enter a stream ID to watch</p>
    </div>
  `;
  document.getElementById('streamInfo').style.display = 'none';
}

function handleChunkReceived(data) {
  // Chunk notification received
  console.log(`Chunk ${data.chunkIndex} received for stream ${data.streamId}`);
}

function handleChunkData(chunk) {
  if (receivedChunks.has(chunk.chunkIndex)) {
    return; // Already received
  }

  receivedChunks.set(chunk.chunkIndex, chunk.data);
  
  // Add to sorted array
  videoChunks.push({
    index: chunk.chunkIndex,
    data: chunk.data,
  });
  videoChunks.sort((a, b) => a.index - b.index);

  // Update UI
  updateChunkLog(chunk);
  updateChunkCount();
  
  // Try to play video
  tryPlayVideo();
}

function updateChunkLog(chunk) {
  const chunkList = document.getElementById('chunkList');
  const item = document.createElement('div');
  item.className = 'chunk-item';
  item.innerHTML = `
    <span class="chunk-index">Chunk #${chunk.chunkIndex}</span>
    <span class="chunk-size">${(chunk.data.length / 1024).toFixed(2)} KB</span>
  `;
  chunkList.insertBefore(item, chunkList.firstChild);
  
  // Keep only last 50
  while (chunkList.children.length > 50) {
    chunkList.removeChild(chunkList.lastChild);
  }
}

function updateChunkCount() {
  document.getElementById('chunkCount').textContent = 
    `${receivedChunks.size} chunk${receivedChunks.size !== 1 ? 's' : ''} received`;
}

function displayStreamInfo(stream) {
  const infoDiv = document.getElementById('streamInfo');
  const detailsDiv = document.getElementById('streamDetails');
  
  detailsDiv.innerHTML = `
    <div class="detail-item">
      <div class="detail-label">Stream ID</div>
      <div>${stream.streamId}</div>
    </div>
    <div class="detail-item">
      <div class="detail-label">Title</div>
      <div>${escapeHtml(stream.title)}</div>
    </div>
    <div class="detail-item">
      <div class="detail-label">Created</div>
      <div>${new Date(stream.createdAt).toLocaleString()}</div>
    </div>
  `;
  
  infoDiv.style.display = 'block';
}

function tryPlayVideo() {
  if (videoChunks.length === 0) return;

  // For demo: create a blob from chunks and try to play
  // Note: This is simplified - real video would need proper codec handling
  try {
    const container = document.getElementById('videoContainer');
    
    // Convert base64 chunks to binary
    const binaryChunks = videoChunks.map(chunk => {
      const binaryString = atob(chunk.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    });

    // Combine chunks
    const totalLength = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    binaryChunks.forEach(chunk => {
      combined.set(chunk, offset);
      offset += chunk.length;
    });

    // Create blob (this is simplified - real video needs proper format)
    const blob = new Blob([combined], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    // Display info (since we can't actually play raw binary as video)
    container.innerHTML = `
      <div class="empty-state">
        <h3>📹 Video Stream Active</h3>
        <p>Received ${videoChunks.length} chunks (${(totalLength / 1024).toFixed(2)} KB)</p>
        <p style="margin-top: 12px; font-size: 0.875rem; color: var(--text-muted);">
          Note: This demo shows chunk reception via Arkiv subscriptions.<br>
          Full video playback requires proper video codec handling.
        </p>
        <div style="margin-top: 20px;">
          <a href="${url}" download="stream.bin" class="btn btn-secondary" style="display: inline-block; width: auto; padding: 8px 16px;">
            Download Received Data
          </a>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error playing video:', error);
  }
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions globally available
window.startWatching = startWatching;
window.stopWatching = stopWatching;
