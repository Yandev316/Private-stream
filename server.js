const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Simple in-memory rooms store
const rooms = new Map();

// Generate 6-char codes, avoid confusing chars
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(len = 6) {
  const chars = alphabet;
  const bytes = crypto.randomBytes(len);
  let res = '';
  for (let i = 0; i < len; i++) {
    // map byte to range
    res += chars[bytes[i] % chars.length];
  }
  return res;
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return null;
  const s = name.trim();
  if (s.length < 2 || s.length > 30) return null;
  // remove HTML-like chars
  return s.replace(/[<>"'`]/g, '');
}

function createRoom(hostName, hostSocketId) {
  let code;
  do {
    code = generateCode(6);
  } while (Array.from(rooms.values()).some(r => r.code === code && r.active));

  const room = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,8),
    code,
    host: hostSocketId,
    users: new Map(), // socketId => {name, isHost}
    messages: [], // chat history, [{from,name,text,ts}]
    transmitting: false,
    transmitter: null,
    createdAt: Date.now(),
    active: true
  };
  if (hostSocketId) {
    room.users.set(hostSocketId, { name: hostName, isHost: true });
  }
  rooms.set(room.id, room);
  return room;
}

function findRoomByCode(code) {
  for (const room of rooms.values()) {
    if (room.code === code && room.active) return room;
  }
  return null;
}

app.post('/create-room', (req, res) => {
  const { name } = req.body;
  const sanitized = sanitizeName(name);
  if (!sanitized) return res.status(400).json({ error: 'Nome inválido' });
  const room = createRoom(sanitized, null);
  // host socket assigned later on join
  res.json({ code: room.code });
});

app.get('/room-exists', (req, res) => {
  const code = req.query.code;
  if (!code) return res.json({ exists: false });
  const room = findRoomByCode(code);
  res.json({ exists: !!room });
});

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('create-room', ({ name }, cb) => {
    const sanitized = sanitizeName(name);
    if (!sanitized) return cb && cb({ error: 'Nome inválido' });
    const room = createRoom(sanitized, socket.id);
    // update host socket id set earlier
    room.users.set(socket.id, { name: sanitized, isHost: true });

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.userName = sanitized;

    cb && cb({ code: room.code });

    // broadcast user list
    io.to(room.code).emit('users-updated', serializeUsers(room));
  });

  socket.on('join-room', ({ code, name }, cb) => {
    const sanitized = sanitizeName(name);
    if (!sanitized) return cb && cb({ error: 'Nome inválido' });
    const room = findRoomByCode(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });

    // prevent duplicate names? allow for now
    room.users.set(socket.id, { name: sanitized, isHost: room.users.size === 0 });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.userName = sanitized;

    // If no host set, ensure first is host
    if (!room.host || !io.sockets.sockets.get(room.host)) {
      room.host = Array.from(room.users.keys())[0];
      const hostEntry = room.users.get(room.host);
      if (hostEntry) hostEntry.isHost = true;
    }

    // Notify
    io.to(room.code).emit('users-updated', serializeUsers(room));

    // send recent chat history to the joiner
    try {
      const history = (room.messages || []).slice(-200);
      socket.emit('chat-history', { messages: history });
    } catch (e) { console.error('error sending chat history', e); }

    // If someone is transmitting, notify the joiner
    if (room.transmitting && room.transmitter) {
      socket.emit('stream-started', { transmitter: room.transmitter, name: room.users.get(room.transmitter)?.name || '' });
      // request transmitter to create a peer for this viewer
      io.to(room.transmitter).emit('new-viewer', { viewerId: socket.id });
    }

    cb && cb({ success: true, code: room.code });
  });

  socket.on('start-transmit', (cb) => {
    const code = socket.data.roomCode;
    const room = findRoomByCode(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    const user = room.users.get(socket.id);
    if (!user) return cb && cb({ error: 'Usuário não pertence à sala' });
    if (room.transmitting) return cb && cb({ error: 'Outro usuário já está transmitindo' });

    room.transmitting = true;
    room.transmitter = socket.id;
    io.to(room.code).emit('stream-started', { transmitter: socket.id, name: user.name });

    // Notify the new transmitter about existing viewers so it can create peers for them
    try {
      for (const [sid] of room.users.entries()) {
        if (sid === socket.id) continue;
        // inform transmitter to create a peer for this existing viewer
        io.to(socket.id).emit('new-viewer', { viewerId: sid });
      }
    } catch (e) {
      console.error('error notifying transmitter of existing viewers', e);
    }

    cb && cb({ success: true });
  });

  socket.on('stop-transmit', (cb) => {
    const code = socket.data.roomCode;
    const room = findRoomByCode(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    if (room.transmitter !== socket.id && room.host !== socket.id) {
      return cb && cb({ error: 'Permissão negada' });
    }
    room.transmitting = false;
    const prev = room.transmitter;
    room.transmitter = null;
    // notify all clients that stream stopped
    io.to(room.code).emit('stream-stopped', { by: socket.id, prevTransmitter: prev });

    // ask all clients to cleanup any transmitter-side peer state referencing prev
    try {
      for (const [sid] of room.users.entries()) {
        io.to(sid).emit('transmitter-stopped', { prevTransmitter: prev });
      }
    } catch (e) { console.error('error notifying clients about transmitter stopped', e); }

    cb && cb({ success: true });
  });

  socket.on('offer', ({ target, sdp }) => {
    const code = socket.data.roomCode;
    const room = findRoomByCode(code);
    if (!room) return;
    // forward offer to target
    io.to(target).emit('offer', { from: socket.id, sdp });
  });

  // chat message handler
  socket.on('chat-message', ({ text }, cb) => {
    const code = socket.data.roomCode;
    if (!code) return cb && cb({ error: 'Not in a room' });
    const room = findRoomByCode(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    const user = room.users.get(socket.id);
    const sanitized = (typeof text === 'string') ? text.trim().slice(0, 1000) : '';
    if (!sanitized) return cb && cb({ error: 'Mensagem vazia' });
    const msg = { from: socket.id, name: (user && user.name) || 'Anon', text: sanitized, ts: Date.now() };
    room.messages = room.messages || [];
    room.messages.push(msg);
    // keep history bounded
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    io.to(room.code).emit('chat-message', msg);
    cb && cb({ success: true });
  });

  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    io.to(target).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('remove-user', ({ target }, cb) => {
    const code = socket.data.roomCode;
    const room = findRoomByCode(code);
    if (!room) return cb && cb({ error: 'Sala não encontrada' });
    if (room.host !== socket.id) return cb && cb({ error: 'Permissão negada' });
    if (!room.users.has(target)) return cb && cb({ error: 'Usuário não encontrado' });

    // notify removed
    io.to(target).emit('removed', { reason: 'Expulso pelo host' });
    // disconnect target socket from room
    const targetSocket = io.sockets.sockets.get(target);
    if (targetSocket) {
      targetSocket.leave(room.code);
      targetSocket.data.roomCode = null;
    }
    room.users.delete(target);
    io.to(room.code).emit('users-updated', serializeUsers(room));
    cb && cb({ success: true });
  });

  socket.on('leave-room', () => {
    const code = socket.data.roomCode;
    handleLeave(socket, code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    handleLeave(socket, code);
  });
});

function handleLeave(socket, code) {
  if (!code) return;
  const room = findRoomByCode(code);
  if (!room) return;
  room.users.delete(socket.id);
  socket.leave(code);

  // if transmitter left, stop transmission
  if (room.transmitter === socket.id) {
    room.transmitting = false;
    room.transmitter = null;
    io.to(room.code).emit('stream-stopped', { by: socket.id });
  }

  // transfer host or remove room
  if (room.users.size === 0) {
    // cleanup
    room.active = false;
    rooms.delete(room.id);
    console.log('room removed', room.code);
  } else {
    if (room.host === socket.id) {
      // transfer to first user
      const next = Array.from(room.users.keys())[0];
      room.host = next;
      const u = room.users.get(next);
      if (u) u.isHost = true;
    }
    io.to(room.code).emit('users-updated', serializeUsers(room));
  }
}

function serializeUsers(room) {
  const arr = [];
  for (const [id, info] of room.users.entries()) {
    arr.push({ id, name: info.name, isHost: !!info.isHost });
  }
  return { users: arr, code: room.code, transmitting: room.transmitting, transmitter: room.transmitter };
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
