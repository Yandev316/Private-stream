const socket = (typeof io === 'function') ? io() : null;

// utils
function $q(s){return document.querySelector(s)}
function parseQuery(){return Object.fromEntries(new URLSearchParams(location.search))}

const tpl = document.getElementById('userTpl');
const usersList = document.getElementById('usersList');
const roomCodeSpan = document.getElementById('roomCode');
const copyBtn = document.getElementById('copyBtn');
const copyConfirm = document.getElementById('copyConfirm');
const leaveBtn = document.getElementById('leaveBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const statusDiv = document.getElementById('status');
const liveBadge = document.getElementById('liveBadge');
const streamerNameEl = document.getElementById('streamerName');
const remoteVideo = document.getElementById('remoteVideo');
const placeholder = document.getElementById('placeholder');

let pcMap = new Map(); // peer connections keyed by peerId (for transmitter side)
let viewerPc = null; // for viewer receiving
let localStream = null;
let me = { id: null, name: '', isHost: false };
let room = { code: null, users: [], transmitting:false, transmitter:null };

const q = parseQuery();
let myName = null;
let roomCode = null;
if (q.code && q.name) {
  myName = decodeURIComponent(q.name).trim();
  roomCode = q.code.toUpperCase();
} else {
  // try recover from sessionStorage when redirected from lobby
  try{
    const pending = sessionStorage.getItem('pendingRoom');
    if (pending) {
      const obj = JSON.parse(pending);
      if (obj && obj.code && obj.name) {
        roomCode = String(obj.code).toUpperCase();
        myName = String(obj.name).trim();
        sessionStorage.removeItem('pendingRoom');
      }
    }
  }catch(e){}
}

if (!roomCode || !myName) {
  alert('Parâmetros inválidos');
  location.href = '/';
}
roomCodeSpan.textContent = roomCode;
// update any inline stage label if present
try{
  const inline = document.querySelector('.room-code-inline');
  if (inline) inline.textContent = roomCode;
}catch(e){}

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    copyConfirm.textContent = 'Copiado!';
    copyConfirm.classList.add('show');
    setTimeout(()=>{ copyConfirm.classList.remove('show'); copyConfirm.textContent=''; },1400);
  } catch (e) {
    copyConfirm.textContent = 'Erro';
    setTimeout(()=>copyConfirm.textContent='',1200);
  }
});

leaveBtn.addEventListener('click', () => {
  // show confirm modal
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.remove('hidden');
});

const cancelLeave = document.getElementById('cancelLeave');
const confirmLeave = document.getElementById('confirmLeave');
if (cancelLeave) cancelLeave.addEventListener('click', ()=>{ document.getElementById('confirmModal').classList.add('hidden'); });
if (confirmLeave) confirmLeave.addEventListener('click', ()=>{
  document.getElementById('confirmModal').classList.add('hidden');
  if (socket) socket.emit('leave-room');
  cleanupAndReturn();
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    const res = await navigator.mediaDevices.getDisplayMedia({ video: true });
    localStream = res;
    // ask server to mark as transmitter
    if (!socket) { alert('Conexão com o servidor indisponível'); startBtn.disabled=false; return; }
    socket.emit('start-transmit', (resp)=>{
      if (resp && resp.error) {
        alert(resp.error);
        startBtn.disabled=false;
        return;
      }
      // setup: when server instructs new viewer we will create per-viewer PC and add tracks
      updateUI(true, myName);
    });
  } catch (e) {
    alert('Não foi possível iniciar o compartilhamento de tela.');
    startBtn.disabled=false;
  }
});

stopBtn.addEventListener('click', ()=>{
  if (socket) socket.emit('stop-transmit', (resp)=>{});
  stopLocalStream();
});

fullscreenBtn.addEventListener('click', ()=>{
  const el = remoteVideo.style.display !== 'none' ? remoteVideo : document.getElementById('videoArea');
  if (el.requestFullscreen) el.requestFullscreen();
  else alert('Tela cheia não suportada');
});

function stopLocalStream(){
  if (localStream) {
    localStream.getTracks().forEach(t=>t.stop());
    localStream = null;
  }
  // close peer connections
  for (const pc of pcMap.values()) try{pc.close()}catch(e){}
  pcMap.clear();
  updateUI(false);
}

function updateUI(isTransmitting, name){
  if (isTransmitting) {
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    if (liveBadge) liveBadge.classList.remove('hidden');
    if (streamerNameEl) streamerNameEl.textContent = name ? `${name} está transmitindo` : '';
    if (statusDiv) statusDiv.textContent = 'Transmissão ativa';
  } else {
    if (startBtn) startBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
    if (liveBadge) liveBadge.classList.add('hidden');
    if (streamerNameEl) streamerNameEl.textContent = '';
    if (statusDiv) statusDiv.textContent = 'Nenhuma transmissão ativa';
  }
}

function cleanupAndReturn(){
  stopLocalStream();
  if (viewerPc) { try{viewerPc.close()}catch(e){} viewerPc=null }
  try{ if (socket) socket.disconnect(); }catch(e){}
  location.href = '/';
}

// signaling handlers
if (socket) {
  socket.emit('join-room', { code: roomCode, name: myName }, (resp)=>{
    if (resp && resp.error) { alert(resp.error); location.href='/'; return; }
  });

  socket.on('connect', ()=>{
    me.id = socket.id;
  });

  socket.on('users-updated', (data)=>{
    room = data;
    renderUsers(data.users);
    // update host flag
    const meEntry = data.users.find(u=>u.id===me.id);
    if (meEntry) me.isHost = meEntry.isHost;
  });

  socket.on('stream-started', ({ transmitter, name })=>{
    room.transmitting = true; room.transmitter = transmitter;
    statusDiv.textContent = 'Transmissão ativa';
    if (liveBadge) liveBadge.classList.remove('hidden');
    if (streamerNameEl) streamerNameEl.textContent = name ? `${name} está transmitindo` : '';
    placeholder.style.display='none';
    remoteVideo.style.display='block';
    // if I'm transmitter, my side will create PCs for viewers
    if (transmitter === me.id) {
      startBtn.classList.add('hidden'); stopBtn.classList.remove('hidden');
    } else {
      // if I'm viewer, request that transmitter create offer for me
      // viewer will wait for 'offer' event
    }
  });

  socket.on('stream-stopped', ()=>{
    room.transmitting = false; room.transmitter=null;
    statusDiv.textContent = 'Nenhuma transmissão ativa';
    if (liveBadge) liveBadge.classList.add('hidden');
    if (streamerNameEl) streamerNameEl.textContent = '';
    placeholder.style.display='block';
    try{ remoteVideo.style.opacity = '0'; }catch(e){}
    setTimeout(()=>{ try{ remoteVideo.style.display='none'; }catch(e){} }, 350);
    stopLocalStream();
    if (viewerPc) { try{viewerPc.close()}catch(e){} viewerPc=null }
  });

  socket.on('new-viewer', async ({ viewerId })=>{
    // only transmitter receives this
    if (!localStream) return;
    // create peer for this viewer, add tracks, create offer
    const pc = new RTCPeerConnection(getIceConfig());
    pcMap.set(viewerId, pc);

    pc.onicecandidate = (e)=>{
      if (e.candidate) socket.emit('ice-candidate', { target: viewerId, candidate: e.candidate });
    };

    // add tracks
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, sdp: offer });
  });

  socket.on('offer', async ({ from, sdp })=>{
    // viewer receives offer from transmitter
    // create viewer PC
    viewerPc = new RTCPeerConnection(getIceConfig());
    viewerPc.ontrack = (e)=>{
      remoteVideo.srcObject = e.streams[0];
      remoteVideo.play().catch(()=>{});
      // show with fade-in
      try{
        remoteVideo.style.opacity = '0';
        remoteVideo.style.display = 'block';
        const videoCard = document.getElementById('videoCard');
        if (videoCard) videoCard.classList.add('video-ready');
        setTimeout(()=>{ remoteVideo.style.opacity = '1'; }, 60);
      }catch(e){}
    };
    viewerPc.onicecandidate = (e)=>{
      if (e.candidate) socket.emit('ice-candidate', { target: from, candidate: e.candidate });
    };
    await viewerPc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await viewerPc.createAnswer();
    await viewerPc.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
  });

  socket.on('answer', async ({ from, sdp })=>{
    const pc = pcMap.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on('ice-candidate', async ({ from, candidate })=>{
    let pc = pcMap.get(from) || viewerPc;
    if (!pc) return;
    try { await pc.addIceCandidate(candidate); } catch(e){}
  });

  socket.on('removed', ({ reason })=>{
    alert(reason);
    cleanupAndReturn();
  });

  socket.on('disconnect', ()=>{
    alert('Conexão com o servidor foi perdida.');
    cleanupAndReturn();
  });

  function renderUsers(users){
  usersList.innerHTML = '';
  const countEl = document.getElementById('userCount');
  if (countEl) countEl.textContent = String(users.length);

  for (const u of users) {
    const clone = tpl.content.cloneNode(true);
    const li = clone.querySelector('.user-item');
    const avatar = clone.querySelector('.avatar');
    const nameEl = clone.querySelector('.name');
    const meta = clone.querySelector('.meta');
    const actions = clone.querySelector('.user-actions');

    // Avatar initial
    avatar.textContent = u.name.charAt(0).toUpperCase();

    // Name and role
    nameEl.textContent = u.name;
    meta.textContent = '';

    if (u.isHost) {
      const badge = document.createElement('span');
      badge.className = 'host-badge';
      badge.textContent = 'HOST';
      meta.appendChild(badge);
    } else if (room.transmitter === u.id) {
      const badge = document.createElement('span');
      badge.className = 'role';
      badge.textContent = 'TRANSMITINDO';
      meta.appendChild(badge);
    }

    // Host controls: only show for the room host
    if (me.isHost && !u.isHost) {
      const btn = document.createElement('button');
      btn.className = 'btn danger';
      btn.textContent = 'Remover';
      btn.onclick = ()=>{
        if (!confirm(`Remover ${u.name}?`)) return;
        socket.emit('remove-user', { target: u.id }, (resp)=>{
          if (resp && resp.error) alert(resp.error);
        });
      };
      actions.appendChild(btn);
    }

    usersList.appendChild(clone);
  }
}

} else {
  // Socket.IO client not available — disable interactive controls and show message
  if (statusDiv) statusDiv.textContent = 'Conexão com servidor indisponível';
  if (startBtn) startBtn.disabled = true;
  if (leaveBtn) leaveBtn.disabled = true;
  if (copyBtn) copyBtn.disabled = true;
}

window.addEventListener('beforeunload', ()=>{
  if (socket) socket.emit('leave-room');
});

// ICE configuration helper
function getIceConfig(){
  // Default STUN to improve peer connectivity. For production, add TURN servers here.
  const config = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ] };

  // Optional: allow injection from server (e.g., serve a global `window.RTC_CONFIG`)
  try{
    if (window && window.RTC_CONFIG && Array.isArray(window.RTC_CONFIG.iceServers)){
      return window.RTC_CONFIG;
    }
  }catch(e){}

  return config;
}
