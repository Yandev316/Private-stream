
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    // Clean, self-contained room client
    const socket = (typeof io === 'function') ? io() : null;

    function parseQuery(){ return Object.fromEntries(new URLSearchParams(location.search)); }

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
    const qualitySelect = document.getElementById('qualitySelect');
    const shareAudioCheckbox = document.getElementById('shareAudio');
    const muteBtn = document.getElementById('muteBtn');
    const localPreview = document.getElementById('localPreview');
    const qualityLabel = document.getElementById('qualityLabel');

    let pcMap = new Map(); // transmitter -> viewer pc map
    let viewerPc = null; // viewer pc when receiving
    let localStream = null;
    let me = { id: null, name: '', isHost: false };
    let room = { code: null, users: [], transmitting:false, transmitter:null };

    // read params or session fallback
    const q = parseQuery();
    let roomCode = null;
    let myName = null;
    if (q.code && q.name) { roomCode = q.code.toUpperCase(); myName = decodeURIComponent(q.name).trim(); }
    else {
      try{
        const pend = sessionStorage.getItem('pendingRoom');
        if (pend) { const p = JSON.parse(pend); roomCode = String(p.code).toUpperCase(); myName = String(p.name); sessionStorage.removeItem('pendingRoom'); }
      }catch(e){}
    }
    if (!roomCode || !myName) { alert('Parâmetros inválidos'); location.href='/'; }
    if (roomCodeSpan) roomCodeSpan.textContent = roomCode;
    const inline = document.querySelector('.room-code-inline'); if (inline) inline.textContent = roomCode;

    console.debug('room.js init', { roomCode, myName, socketAvailable: !!socket });

    // copy code
    if (copyBtn) copyBtn.addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(roomCode); if (copyConfirm) { copyConfirm.textContent='Copiado!'; copyConfirm.classList.add('show'); setTimeout(()=>{ copyConfirm.classList.remove('show'); copyConfirm.textContent=''; },1200); } }catch(e){ if (copyConfirm) { copyConfirm.textContent='Erro'; setTimeout(()=>copyConfirm.textContent='',1200); } }
    });

    // leave
    if (leaveBtn) leaveBtn.addEventListener('click', ()=>{ if (socket) socket.emit('leave-room', ()=>{}); cleanupAndReturn(); });

    if (startBtn) startBtn.addEventListener('click', startTransmit);
    if (stopBtn) stopBtn.addEventListener('click', ()=>{
      if (!socket) return;
      stopBtn.disabled = true;
      socket.emit('stop-transmit', (resp)=>{
        if (resp && resp.error) {
          alert(resp.error);
          stopBtn.disabled = false;
        }
        // wait for server 'stream-stopped' to actually stop local streams and update UI
      });
    });

    if (fullscreenBtn) fullscreenBtn.addEventListener('click', ()=>{ const el = remoteVideo || document.getElementById('videoArea'); if (el && el.requestFullscreen) el.requestFullscreen(); });

    function getConstraintsForQuality(q){
      if (!q || q === 'auto') return true;
      switch(q){
        case 'high': return { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
        case 'medium': return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 25 } };
        case 'low': return { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
        default: return true;
      }
    }

    async function startTransmit(){
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { alert('Compartilhamento não suportado'); return; }
      startBtn.disabled = true;
      try{
        const q = qualitySelect ? qualitySelect.value : 'auto';
        const videoConstraints = getConstraintsForQuality(q);
        const wantAudio = shareAudioCheckbox ? Boolean(shareAudioCheckbox.checked) : false;
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: wantAudio });
        // show local preview
        try{ if (localPreview) { localPreview.srcObject = localStream; localPreview.classList.remove('hidden'); try{ localPreview.play(); }catch(e){} } }catch(e){}
        // publish will be done via direct RTCPeerConnections to viewers (server will ask to create peers)
        // update quality label for transmitter
        if (qualityLabel) {
          let txt = 'Qualidade: ' + (q === 'auto' ? 'Automática' : (q === 'high' ? 'Alta (1080p)' : (q === 'medium' ? 'Média (720p)' : 'Baixa (480p)')));
          qualityLabel.textContent = txt;
        }
      }catch(e){ alert('Permissão negada ou falha ao capturar tela'); startBtn.disabled=false; return; }
      if (!socket) { alert('Sem conexão com sinalizador'); startBtn.disabled=false; return; }
      socket.emit('start-transmit', (resp)=>{
        if (resp && resp.error) { alert(resp.error); startBtn.disabled=false; return; }
        // mark local room state as transmitting and set transmitter id to self
        try{ room.transmitting = true; room.transmitter = me.id; }catch(e){}
        // we'll receive 'new-viewer' events for existing viewers
        updateUI(true, me.id, myName);
      });
    }

    function stopLocalStream(){
      if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
      // nothing to unpublish here (we close local tracks and RTCPeerConnections)
      try{ if (localPreview) { localPreview.pause(); localPreview.srcObject = null; localPreview.classList.add('hidden'); } }catch(e){}
      for (const pc of pcMap.values()) try{ pc.close(); }catch(e){}
      pcMap.clear();
      if (viewerPc) try{ viewerPc.close(); }catch(e){} viewerPc=null;
      updateUI(false);
    }

    function cleanupAndReturn(){ stopLocalStream(); try{ if (socket) socket.disconnect(); }catch(e){} location.href='/'; }

    function updateUI(isTransmitting, transmitterId, name){
      if (isTransmitting){
        if (startBtn) startBtn.classList.add('hidden');
        if (stopBtn) {
          // show stop only to the actual transmitter
          if (me.id && transmitterId && (me.id === transmitterId)) {
            stopBtn.classList.remove('hidden'); stopBtn.disabled = false;
          } else {
            stopBtn.classList.add('hidden');
          }
        }
        if (liveBadge) liveBadge.classList.remove('hidden');
        if (streamerNameEl) streamerNameEl.textContent = name ? `${name} está transmitindo` : '';
        if (statusDiv) statusDiv.textContent='Transmissão ativa';
      } else {
        if (startBtn) startBtn.classList.remove('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
        if (liveBadge) liveBadge.classList.add('hidden');
        if (streamerNameEl) streamerNameEl.textContent='';
        if (statusDiv) statusDiv.textContent='Nenhuma transmissão ativa';
      }
    }

    // join and signaling
    if (socket) {
      socket.emit('join-room', { code: roomCode, name: myName }, (resp)=>{ if (resp && resp.error){ alert(resp.error); location.href='/'; } });

      socket.on('connect', ()=>{ me.id = socket.id; console.debug('socket connected', socket.id); });

      socket.on('users-updated', (data)=>{
        room = data;
        renderUsers(data.users);
        const meEntry = data.users.find(u=>u.id===me.id);
        if (meEntry) me.isHost = meEntry.isHost;
        // ensure UI reflects current transmitting state and host role
        updateUI(room.transmitting, room.transmitter, '');
      });

      socket.on('stream-started', ({ transmitter, name })=>{
        room.transmitting=true; room.transmitter=transmitter; updateUI(true, transmitter, name || '');
        // If I'm viewer, I'll wait for offers; if I'm transmitter server will emit 'new-viewer' events
      });

      socket.on('stream-stopped', ({ by, prevTransmitter })=>{
        room.transmitting=false; room.transmitter=null;
        // stop local stream resources
        stopLocalStream();
        updateUI(false);
      });

      socket.on('transmitter-stopped', ({ prevTransmitter })=>{
        // cleanup any state related to prevTransmitter (for transmitters/viewers)
        if (pcMap && typeof pcMap === 'object') {
          for (const [k, pc] of pcMap.entries()) {
            try{ pc.close(); }catch(e){}
          }
          pcMap.clear();
        }
        if (viewerPc) { try{ viewerPc.close(); }catch(e){} viewerPc=null }
        updateUI(false);
      });

      socket.on('new-viewer', async ({ viewerId })=>{
        // transmitter: create pc for this viewer
        if (!localStream) return;
        const pc = new RTCPeerConnection(getIceConfig());
        pcMap.set(viewerId, pc);
        pc.onicecandidate = (e)=>{ if (e.candidate) socket.emit('ice-candidate', { target: viewerId, candidate: e.candidate }); };
        pc.onconnectionstatechange = ()=>{ if (pc.connectionState === 'failed' || pc.connectionState === 'closed') try{ pc.close(); }catch(e){} };
        for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
        try{ const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('offer', { target: viewerId, sdp: offer }); }catch(e){ console.error('createOffer error', e); }
      });

      // mute button toggles share of audio tracks
      if (muteBtn) {
        muteBtn.addEventListener('click', ()=>{
          if (!localStream) return;
          const audioTracks = localStream.getAudioTracks();
          if (!audioTracks || audioTracks.length === 0) return;
          const enabled = audioTracks[0].enabled;
          audioTracks.forEach(t=>t.enabled = !enabled);
          muteBtn.textContent = enabled ? 'Ativar áudio' : 'Desativar áudio';
        });
      }

      socket.on('offer', async ({ from, sdp })=>{
        // viewer receives offer
        try{
          viewerPc = new RTCPeerConnection(getIceConfig());
          viewerPc.ontrack = (e)=>{ remoteVideo.srcObject = e.streams[0]; try{ remoteVideo.play(); }catch(e){} remoteVideo.style.opacity='1'; };
          viewerPc.onicecandidate = (e)=>{ if (e.candidate) socket.emit('ice-candidate', { target: from, candidate: e.candidate }); };
          await viewerPc.setRemoteDescription(new RTCSessionDescription(sdp));
          const answer = await viewerPc.createAnswer(); await viewerPc.setLocalDescription(answer);
          socket.emit('answer', { target: from, sdp: answer });
        }catch(e){ console.error('handle offer error', e); }
      });

      socket.on('answer', async ({ from, sdp })=>{ const pc = pcMap.get(from); if (!pc) return; try{ await pc.setRemoteDescription(new RTCSessionDescription(sdp)); }catch(e){ console.error('setRemoteDescription error', e); } });

      socket.on('ice-candidate', async ({ from, candidate })=>{ let pc = pcMap.get(from) || viewerPc; if (!pc) return; try{ await pc.addIceCandidate(candidate); }catch(e){ console.error('addIceCandidate error', e); } });

      socket.on('removed', ({ reason })=>{ alert(reason); cleanupAndReturn(); });
      socket.on('disconnect', ()=>{ alert('Conexão perdida'); cleanupAndReturn(); });

    } else {
      if (statusDiv) statusDiv.textContent = 'Sinalizador indisponível'; if (startBtn) startBtn.disabled=true; if (leaveBtn) leaveBtn.disabled=true; if (copyBtn) copyBtn.disabled=true;
    }

    window.addEventListener('beforeunload', ()=>{ if (socket) socket.emit('leave-room'); });

    function renderUsers(users){ usersList.innerHTML=''; const count = document.getElementById('userCount'); if (count) count.textContent = String(users.length);
      for (const u of users){ const clone = tpl.content.cloneNode(true); const li = clone.querySelector('.user-item'); const avatar = clone.querySelector('.avatar'); const nameEl = clone.querySelector('.name'); const meta = clone.querySelector('.meta'); const actions = clone.querySelector('.user-actions'); avatar.textContent = u.name.charAt(0).toUpperCase(); nameEl.textContent = u.name; meta.innerHTML=''; if (u.isHost){ const sp = document.createElement('span'); sp.className='host-badge'; sp.textContent='HOST'; meta.appendChild(sp); } else if (room.transmitter===u.id){ const sp = document.createElement('span'); sp.className='role'; sp.textContent='TRANSMITINDO'; meta.appendChild(sp); }
        if (me.isHost && !u.isHost){ const btn = document.createElement('button'); btn.className='btn danger'; btn.textContent='Remover'; btn.onclick=()=>{ if (!confirm(`Remover ${u.name}?`)) return; socket.emit('remove-user',{ target: u.id }, (resp)=>{ if (resp && resp.error) alert(resp.error); }); }; actions.appendChild(btn); }
        usersList.appendChild(clone);
      }
    }

    // ICE config helper
    function getIceConfig(){ const cfg = { iceServers:[ { urls:'stun:stun.l.google.com:19302' } ] }; try{ if (window && window.RTC_CONFIG && Array.isArray(window.RTC_CONFIG.iceServers)) return window.RTC_CONFIG; }catch(e){} return cfg; }

  } catch (err) {
    console.error('room.js unexpected error', err);
    alert('Erro interno no cliente. Veja o console para detalhes.');
  }
});

// hide page loader when window fully loads
function hidePageLoader(){
  try{
    const ld = document.getElementById('pageLoader');
    if (!ld) return;
    ld.classList.add('hidden');
    setTimeout(()=>{ try{ ld.remove(); }catch(e){} }, 400);
  }catch(e){console.error('hidePageLoader', e)}
}
window.addEventListener('load', hidePageLoader);

