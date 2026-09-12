// moba-duel match server (docs/PHASE4.md). Node built-ins only.
//   node server/index.mjs [port]      (default 8787)
// GET /health → JSON. WebSocket at /ws. The client (GitHub Pages, https) needs wss://,
// so put this behind TLS: see server/README.md.
import { createServer } from 'node:http';
import { attachWebSocket } from './ws.mjs';
import { Rooms } from './rooms.mjs';
import { HERO_KEYS } from '../src/sim/hero/heroData.js';
import { PROTOCOL_VERSION, isRoomCode } from '../src/net/protocol.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const rooms = new Rooms();
const conns = new Set();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.byCode.size, players: conns.size, version: PROTOCOL_VERSION }));
    return;
  }
  res.writeHead(404); res.end();
});

function reply(conn, obj) { conn.send(JSON.stringify(obj)); }

attachWebSocket(http, '/ws', (conn) => {
  conns.add(conn);
  conn.room = null;
  conn.onmessage = (text, bin) => {
    if (bin) return;
    let m = null;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (conn.room) return;
      const hero = HERO_KEYS.includes(m.hero) ? m.hero : HERO_KEYS[0];
      let room = null;
      if (m.room === 'new' || !m.room) room = rooms.create();
      else if (isRoomCode(m.room)) room = rooms.get(m.room);
      if (!room) { reply(conn, { t: 'error', code: 'no_room' }); return; }
      const seat = room.join(conn, hero);
      if (seat < 0) { reply(conn, { t: 'error', code: 'full' }); return; }
      conn.room = room;
      reply(conn, { t: 'joined', room: room.code, seat, hero, version: PROTOCOL_VERSION });
      // Solo start: the other seat is the bot. Second player: start when both are in.
      if (m.solo || room.seats[0] && room.seats[1]) room.start();
    } else if (m.t === 'start') {
      if (conn.room) conn.room.start();
    } else if (m.t === 'intent') {
      if (conn.room && conn.room.started) conn.room.intent(conn, m.tick | 0, m.i);
    } else if (m.t === 'ping') {
      reply(conn, { t: 'pong', c: m.c });
    }
  };
  conn.onclose = () => {
    conns.delete(conn);
    const room = conn.room;
    if (room) { room.leave(conn); if (room.empty) rooms.remove(room); }
  };
});

http.listen(PORT, '0.0.0.0', () => console.log(`moba-duel server on :${PORT} (ws at /ws)`));
