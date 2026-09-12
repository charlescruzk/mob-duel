// Rooms: a 4-letter code, two seats, one worker running the match. The main thread
// only routes messages; it never touches the simulation.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class Room {
  constructor(code) {
    this.code = code;
    this.seats = [null, null];          // WsConnection per seat
    this.heroes = ['', ''];
    this.started = false;
    this.lastSnap = null;
    this.worker = new Worker(join(HERE, 'roomWorker.mjs'));
    this.worker.on('message', (m) => this._fromWorker(m));
    this.worker.on('error', (e) => console.error(`[room ${code}] worker error`, e));
    this.createdAt = Date.now();
  }

  join(conn, hero) {
    const seat = this.seats[0] ? (this.seats[1] ? -1 : 1) : 0;
    if (seat < 0) return -1;
    this.seats[seat] = conn;
    this.heroes[seat] = hero;
    this.worker.postMessage({ t: 'seat', seat, hero });
    return seat;
  }

  leave(conn) {
    const seat = this.seats.indexOf(conn);
    if (seat < 0) return;
    this.seats[seat] = null;
    this.worker.postMessage({ t: 'leave', seat });
  }

  get empty() { return !this.seats[0] && !this.seats[1]; }

  start() {
    if (this.started) return;
    this.started = true;
    this.worker.postMessage({ t: 'start' });
    this.broadcast(JSON.stringify({ t: 'start', heroes: this.heroes, room: this.code }));
  }

  intent(conn, tick, i) {
    const seat = this.seats.indexOf(conn);
    if (seat < 0) return;
    this.worker.postMessage({ t: 'intent', seat, tick, i });
  }

  broadcast(text) {
    for (let s = 0; s < 2; s++) if (this.seats[s] && this.seats[s].open) this.seats[s].send(text);
  }

  _fromWorker(m) {
    if (m.t === 'snap') { this.lastSnap = m; this.broadcast(JSON.stringify(m)); }
    else if (m.t === 'over') this.broadcast(JSON.stringify(m));
  }

  dispose() {
    try { this.worker.postMessage({ t: 'stop' }); } catch { /* gone */ }
    setTimeout(() => this.worker.terminate(), 500);
  }
}

export class Rooms {
  constructor() { this.byCode = new Map(); }

  create() {
    let code = '';
    do { code = ''; for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)]; } while (this.byCode.has(code));
    const room = new Room(code);
    this.byCode.set(code, room);
    return room;
  }

  get(code) { return this.byCode.get(code) || null; }

  remove(room) { this.byCode.delete(room.code); room.dispose(); }
}
