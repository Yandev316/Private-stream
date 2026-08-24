import { connect, LocalTrack } from 'https://unpkg.com/@livekit/client@2.28.0/dist/esm/index.js';

const connectBtn = document.getElementById('lkConnect');
const stopBtn = document.getElementById('lkStop');
const identityInput = document.getElementById('identity');
const roomInput = document.getElementById('roomName');
const qualitySelect = document.getElementById('lkQuality');
const audioCheckbox = document.getElementById('lkAudio');
const statusDiv = document.getElementById('lkStatus');
const previewDiv = document.getElementById('lkPreview');

let lkRoom = null;
let localStream = null;

function getConstraintsForQuality(q){
  if (!q || q === 'auto') return true;
  switch(q){
    case 'high': return { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    case 'medium': return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 25 } };
    case 'low': return { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
    default: return true;
  }
}

async function requestToken(identity, room){
  const res = await fetch('/livekit/token', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ identity, room }) });
  if (!res.ok) throw new Error('Failed to get token');
  return res.json();
}

connectBtn.addEventListener('click', async ()=>{
  const identity = identityInput.value.trim() || `user_${Math.floor(Math.random()*1000)}`;
  const room = roomInput.value.trim() || 'demo';
  connectBtn.disabled = true;
  try{
    const { token, url } = await requestToken(identity, room);
    statusDiv.textContent = 'Conectando...';
    lkRoom = await connect(url, token, { autoSubscribe: true });
    statusDiv.textContent = 'Conectado — publicando...';

    // capture screen
    const q = qualitySelect.value;
    const audio = audioCheckbox.checked;
    const constraints = { video: getConstraintsForQuality(q), audio };
    localStream = await navigator.mediaDevices.getDisplayMedia(constraints);

    // show preview
    previewDiv.innerHTML = '';
    const vid = document.createElement('video'); vid.autoplay = true; vid.muted = true; vid.playsInline = true; vid.style.width='420px'; vid.style.borderRadius='8px';
    vid.srcObject = localStream; previewDiv.appendChild(vid);

    // publish tracks to LiveKit
    for (const track of localStream.getTracks()){
      try{
        await lkRoom.localParticipant.publishTrack(track);
      }catch(e){console.warn('publish error', e)}
    }

    statusDiv.textContent = 'Transmitindo em LiveKit';
    stopBtn.classList.remove('hidden');
  }catch(e){
    console.error(e);
    alert('Erro ao conectar/transmitir: ' + (e.message||e));
    connectBtn.disabled = false;
    statusDiv.textContent = 'Erro';
  }
});

stopBtn.addEventListener('click', async ()=>{
  try{
    if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
    if (lkRoom) { try{ lkRoom.disconnect(); }catch(e){} lkRoom=null; }
    previewDiv.innerHTML='';
    statusDiv.textContent = 'Parado';
    connectBtn.disabled = false;
    stopBtn.classList.add('hidden');
  }catch(e){ console.error(e); }
});
