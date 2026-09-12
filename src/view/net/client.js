// NetClient — the browser's socket to server/index.mjs. Queues snapshots for the
// mirror, sends one intent per tick, measures round-trip time. JSON on the wire
// (docs/PHASE4.md); serialisation happens per tick, never per frame.
export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.joined = null;          // { room, seat, hero }
    this.started = null;         // { heroes }
    this.seat = -1;
    this.pending = [];           // snapshots not yet applied (drained by the mirror)
    this.lastSnapAt = 0;
    this.rtt = 0;
    this.error = '';
    this.over = null;
    this.onjoined = null; this.onstart = null; this.onerror = null; this.onclose = null;
    this._pingAt = 0;
    this._pingCounter = 0;
    this.sentIntents = 0;
    this.receivedSnaps = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let ws = null;
      try { ws = new WebSocket(this.url); } catch (e) { this.error = 'bad url'; reject(e); return; }
      this.ws = ws;
      ws.onopen = () => { this.connected = true; resolve(this); };
      ws.onerror = () => { this.error = 'connection failed'; if (this.onerror) this.onerror(this.error); reject(new Error(this.error)); };
      ws.onclose = () => { this.connected = false; if (this.onclose) this.onclose(); };
      ws.onmessage = (ev) => this._onMessage(ev.data);
    });
  }

  join(room, hero, solo) {
    this._send({ t: 'join', room: room || 'new', hero, solo: !!solo });
  }

  start() { this._send({ t: 'start' }); }

  sendIntent(tick, intent) {
    if (!this.connected) return;
    this._send({ t: 'intent', tick, i: intent });
    this.sentIntents++;
  }

  ping() {
    this._pingAt = performance.now();
    this._send({ t: 'ping', c: ++this._pingCounter });
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(obj));
  }

  _onMessage(text) {
    let m = null;
    try { m = JSON.parse(text); } catch { return; }
    if (!m) return;
    if (m.t === 'snap') { this.pending.push(m); this.lastSnapAt = performance.now(); this.receivedSnaps++; }
    else if (m.t === 'joined') { this.joined = m; this.seat = m.seat; if (this.onjoined) this.onjoined(m); }
    else if (m.t === 'start') { this.started = m; if (this.onstart) this.onstart(m); }
    else if (m.t === 'over') { this.over = m; }
    else if (m.t === 'pong') { if (m.c === this._pingCounter) this.rtt = performance.now() - this._pingAt; }
    else if (m.t === 'error') { this.error = m.code; if (this.onerror) this.onerror(m.code); }
  }

  close() { if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } } this.connected = false; }
}
