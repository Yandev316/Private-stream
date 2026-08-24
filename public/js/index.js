document.addEventListener('DOMContentLoaded', ()=>{
  try{
    const socket = (typeof io === 'function') ? io() : null;

    const nameInput = document.getElementById('name');
    const createBtn = document.getElementById('createBtn');
    const enterToggle = document.getElementById('enterToggle');
    const enterSection = document.getElementById('enterSection');
    const roomCodeInput = document.getElementById('roomCode');
    const enterBtn = document.getElementById('enterBtn');
    const messageDiv = document.getElementById('message');

    function showMessage(text, danger = true) {
      if (!messageDiv) return;
      messageDiv.textContent = text;
      messageDiv.style.color = danger ? '#ffb3b3' : '#9fffa3';
    }

    if (enterToggle) enterToggle.addEventListener('click', () => { if (enterSection) enterSection.classList.toggle('hidden'); });

    if (createBtn) createBtn.addEventListener('click', async () => {
      const name = nameInput ? nameInput.value.trim() : '';
      if (name.length < 2) return showMessage('Informe seu nome (mínimo 2 caracteres)');
      createBtn.disabled = true;
      try {
        const res = await fetch('/create-room', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        let data = null;
        if (res.ok) {
          data = await res.json();
          if (data.error) { showMessage(data.error); createBtn.disabled=false; return; }
        } else {
          try { data = await res.json(); } catch(e) { data = null; }
          const msg = data && data.error ? data.error : 'Não foi possível criar a sala.';
          // fallback to socket if available
          if (socket && typeof socket.emit === 'function') {
            socket.emit('create-room', { name }, (resp) => {
              if (resp && resp.error) { showMessage(resp.error); createBtn.disabled=false; return; }
              window.location.href = `room.html?code=${resp.code}&name=${encodeURIComponent(name)}`;
            });
            return;
          }
          showMessage(msg);
          createBtn.disabled=false;
          return;
        }
        // save pending room in sessionStorage as a fallback and navigate
        try{ sessionStorage.setItem('pendingRoom', JSON.stringify({ code: data.code, name })); }catch(e){}
        window.location.href = `room.html?code=${data.code}&name=${encodeURIComponent(name)}`;
      } catch (e) {
        // try socket fallback
        if (socket && typeof socket.emit === 'function') {
          socket.emit('create-room', { name }, (resp) => {
            if (resp && resp.error) { showMessage(resp.error); createBtn.disabled=false; return; }
            try{ sessionStorage.setItem('pendingRoom', JSON.stringify({ code: resp.code, name })); }catch(e){}
            window.location.href = `room.html?code=${resp.code}&name=${encodeURIComponent(name)}`;
          });
          return;
        }
        showMessage('Não foi possível criar a sala.');
        createBtn.disabled = false;
      }
    });

    if (enterBtn) enterBtn.addEventListener('click', async () => {
      const name = nameInput ? nameInput.value.trim() : '';
      const code = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : '';
      if (name.length < 2) return showMessage('Informe seu nome (mínimo 2 caracteres)');
      if (!code || code.length !== 6) return showMessage('Informe o código da sala.');
      enterBtn.disabled = true;
      try {
        const res = await fetch(`/room-exists?code=${encodeURIComponent(code)}`);
        const data = await res.json();
        if (!data.exists) { showMessage('Sala não encontrada.'); enterBtn.disabled=false; return; }
        try{ sessionStorage.setItem('pendingRoom', JSON.stringify({ code, name })); }catch(e){}
        window.location.href = `room.html?code=${code}&name=${encodeURIComponent(name)}`;
      } catch (e) {
        showMessage('Erro ao verificar a sala.');
        enterBtn.disabled=false;
      }
    });

    console.debug('index.js initialized', { socketAvailable: !!socket });
  } catch (err) {
    console.error('index.js init error', err);
  }
});
