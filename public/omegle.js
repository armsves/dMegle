const API_BASE = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, 'ws');

let ws = null;
let rtcPeerConnection = null;
let localStream = null;
let currentSessionId = null;
let userId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeWebSocket();
  loadAccount();
  setupEventListeners();
});

// WebSocket connection
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
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };
}

function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'connected':
      userId = data.userId;
      document.getElementById('userId').textContent = `User: ${userId.slice(0, 12)}...`;
      break;
    case 'session:matched':
      handleMatched(data.session);
      break;
    case 'user:waiting':
      addWaitingUser(data.user);
      break;
    case 'webrtc-signal':
      handleWebRTCSignal(data.signal, data.from);
      break;
    case 'session:ended':
      handleSessionEnded(data.sessionId);
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
    userId = data.userId;
    document.getElementById('userId').textContent = `User: ${userId.slice(0, 12)}...`;
  } catch (error) {
    console.error('Failed to load account:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('startWaitingBtn').addEventListener('click', startWaiting);
  document.getElementById('nextBtn').addEventListener('click', nextChat);
  document.getElementById('endBtn').addEventListener('click', endChat);
}

// Start waiting for a match
async function startWaiting() {
  const interestsInput = document.getElementById('interestsInput');
  const interests = interestsInput.value
    .split(',')
    .map(i => i.trim())
    .filter(i => i.length > 0);

  try {
    const response = await fetch(`${API_BASE}/api/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interests }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start waiting');
    }

    const data = await response.json();
    currentSessionId = data.sessionId;
    
    document.getElementById('waitingStatus').textContent = 'Waiting for a match...';
    document.getElementById('startWaitingBtn').disabled = true;
    
    // Load camera
    await startLocalVideo();
    
    // Check for waiting users periodically
    checkWaitingUsers();
    setInterval(checkWaitingUsers, 3000);
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// Check for waiting users
async function checkWaitingUsers() {
  try {
    const response = await fetch(`${API_BASE}/api/waiting?exclude=${userId}`);
    const data = await response.json();
    
    const container = document.getElementById('waitingUsers');
    if (data.users.length > 0) {
      container.innerHTML = '<h3>Other users waiting:</h3>';
      data.users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `
          <span>${user.userId.slice(0, 12)}...</span>
          <button class="btn btn-secondary" onclick="matchUser('${user.userId}')">Match</button>
        `;
        container.appendChild(div);
      });
    } else {
      container.innerHTML = '<p>No other users waiting</p>';
    }
  } catch (error) {
    console.error('Failed to check waiting users:', error);
  }
}

// Match with a user
async function matchUser(matchedUserId) {
  if (!currentSessionId) {
    showNotification('Please start waiting first', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        matchedUserId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to match');
    }

    showNotification('Matched! Starting video chat...', 'success');
    // The match event will come via WebSocket
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// Handle matched session
async function handleMatched(session) {
  if (session.sessionId !== currentSessionId) return;

  // Switch to chat screen
  document.getElementById('waitingScreen').classList.remove('active');
  document.getElementById('chatScreen').classList.add('active');

  // Initialize WebRTC
  await initializeWebRTC();
}

// Initialize WebRTC
async function initializeWebRTC() {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  };

  rtcPeerConnection = new RTCPeerConnection(configuration);

  // Add local stream tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      rtcPeerConnection.addTrack(track, localStream);
    });
  }

  // Handle remote stream
  rtcPeerConnection.ontrack = (event) => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = event.streams[0];
  };

  // Handle ICE candidates
  rtcPeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'ice-candidate',
        from: userId,
        to: 'peer', // In real app, would be matched user ID
        candidate: event.candidate,
      }));
    }
  };

  // Create and send offer
  const offer = await rtcPeerConnection.createOffer();
  await rtcPeerConnection.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: 'offer',
    from: userId,
    to: 'peer',
    sdp: offer,
  }));
}

// Handle WebRTC signaling
async function handleWebRTCSignal(signal, from) {
  if (!rtcPeerConnection) return;

  if (signal.type === 'offer') {
    await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await rtcPeerConnection.createAnswer();
    await rtcPeerConnection.setLocalDescription(answer);

    ws.send(JSON.stringify({
      type: 'answer',
      from: userId,
      to: from,
      sdp: answer,
    }));
  } else if (signal.type === 'answer') {
    await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  } else if (signal.type === 'ice-candidate') {
    await rtcPeerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
}

// Start local video
async function startLocalVideo() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = localStream;
  } catch (error) {
    console.error('Error accessing camera:', error);
    showNotification('Could not access camera/microphone', 'error');
  }
}

// Next chat
async function nextChat() {
  await endChat();
  setTimeout(() => {
    document.getElementById('waitingScreen').classList.add('active');
    document.getElementById('chatScreen').classList.remove('active');
    startWaiting();
  }, 500);
}

// End chat
async function endChat() {
  if (currentSessionId) {
    try {
      await fetch(`${API_BASE}/api/sessions/${currentSessionId}/end`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to end session:', error);
    }
  }

  // Close WebRTC connection
  if (rtcPeerConnection) {
    rtcPeerConnection.close();
    rtcPeerConnection = null;
  }

  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Reset UI
  document.getElementById('waitingScreen').classList.add('active');
  document.getElementById('chatScreen').classList.remove('active');
  document.getElementById('waitingStatus').textContent = '';
  document.getElementById('waitingUsers').innerHTML = '';
  document.getElementById('startWaitingBtn').disabled = false;
  currentSessionId = null;
}

function handleSessionEnded(sessionId) {
  if (sessionId === currentSessionId) {
    endChat();
  }
}

function addWaitingUser(user) {
  // User already added via polling
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

// Make functions globally available
window.matchUser = matchUser;

