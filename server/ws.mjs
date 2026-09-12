// Minimal RFC 6455 WebSocket server on Node built-ins (no `ws` package, per CLAUDE.md).
// Text and binary frames, fragmentation, ping/pong, close. Server → client frames are
// unmasked; client → server frames must be masked (the RFC requires it; we enforce it).
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20;          // 1 MiB: a misbehaving client is closed, not buffered

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

// Encodes one frame. opcode: 1 text, 2 binary, 8 close, 9 ping, 10 pong.
export function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.allocUnsafe(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.allocUnsafe(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.allocUnsafe(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | (opcode & 0x0f);   // FIN + opcode
  return Buffer.concat([header, payload]);
}

// One connection. Events: onmessage(string|Buffer, isBinary), onclose(code, reason), onerror(err).
export class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._buf = Buffer.alloc(0);
    this._frags = [];
    this._fragOp = 0;
    this._fragLen = 0;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed(1006, 'socket closed'));
    socket.on('error', (e) => { if (this.onerror) this.onerror(e); this._closed(1006, 'socket error'); });
    socket.setNoDelay(true);
  }

  send(data) {
    if (!this.open) return false;
    const bin = Buffer.isBuffer(data);
    const payload = bin ? data : Buffer.from(String(data), 'utf8');
    return this.socket.write(encodeFrame(bin ? 2 : 1, payload));
  }

  ping() { if (this.open) this.socket.write(encodeFrame(9, Buffer.alloc(0))); }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason, 'utf8');
    const p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0); r.copy(p, 2);
    try { this.socket.write(encodeFrame(8, p)); } catch { /* closing anyway */ }
    this.socket.end();
    this._closed(code, reason);
  }

  _closed(code, reason) {
    if (!this.open) return;
    this.open = false;
    if (this.onclose) this.onclose(code, reason);
  }

  _onData(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    for (;;) {
      const b = this._buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) { this.close(1009, 'too big'); return; } len = Number(big); off = 10; }
      if (!masked) { this.close(1002, 'client frames must be masked'); return; }
      if (b.length < off + 4 + len) return;
      const key = b.subarray(off, off + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ key[i & 3];
      this._buf = b.subarray(off + 4 + len);
      this._frame(fin, opcode, payload);
      if (!this.open) return;
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode === 8) { const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; this.close(code, ''); return; }
    if (opcode === 9) { if (this.open) this.socket.write(encodeFrame(10, payload)); return; }
    if (opcode === 10) return;
    if (opcode === 0) {                      // continuation
      if (!this._fragOp) { this.close(1002, 'unexpected continuation'); return; }
      this._frags.push(payload); this._fragLen += payload.length;
      if (this._fragLen > MAX_MESSAGE) { this.close(1009, 'too big'); return; }
      if (fin) { const full = Buffer.concat(this._frags); const op = this._fragOp; this._frags = []; this._fragOp = 0; this._fragLen = 0; this._deliver(op, full); }
      return;
    }
    if (opcode !== 1 && opcode !== 2) { this.close(1002, 'bad opcode'); return; }
    if (!fin) { this._fragOp = opcode; this._frags = [payload]; this._fragLen = payload.length; return; }
    this._deliver(opcode, payload);
  }

  _deliver(opcode, payload) {
    if (!this.onmessage) return;
    if (opcode === 1) this.onmessage(payload.toString('utf8'), false);
    else this.onmessage(payload, true);
  }
}

// Attach to an http.Server: upgrades requests at `path` and calls onConnection(conn, req).
export function attachWebSocket(httpServer, path, onConnection) {
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    const conn = new WsConnection(socket);
    if (head && head.length) conn._onData(head);
    onConnection(conn, req, url);
  });
}
