// Two Node WebSocket clients join one room, send intents, and must receive snapshots
// that agree tick for tick. Exit 0 on success.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790 + Math.floor(Math.random() * 100);
const server = spawn('node', [join(ROOT, 'server', 'index.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));

const open = (name) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const box = { ws, name, msgs: [], snaps: [], joined: null, started: null };
  ws.onopen = () => resolve(box);
  ws.onerror = () => reject(new Error(name + ' failed to connect'));
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); box.msgs.push(m); if (m.t === 'snap') box.snaps.push(m); else if (m.t === 'joined') box.joined = m; else if (m.t === 'start') box.started = m; };
  return box;
});
const results = {};
try {
  const a = await open('a');
  a.ws.send(JSON.stringify({ t: 'join', room: 'new', hero: 'bayani' }));
  await sleep(150);
  results.aJoined = !!a.joined && a.joined.seat === 0 && /^[A-Z]{4}$/.test(a.joined.room);
  const b = await open('b');
  b.ws.send(JSON.stringify({ t: 'join', room: a.joined.room, hero: 'ren' }));
  await sleep(300);
  results.bJoined = !!b.joined && b.joined.seat === 1;
  results.bothStarted = !!a.started && !!b.started && a.started.heroes[0] === 'bayani' && a.started.heroes[1] === 'ren';
  // Player A walks forward (−Z) for a second; B stands still.
  let tick = 0;
  for (let i = 0; i < 20; i++) {
    a.ws.send(JSON.stringify({ t: 'intent', tick: tick++, i: { moveX: 0, moveZ: -1, aimX: 0, aimZ: 0, attack: false, q: false, w: false, e: false, r: false, recall: false, buy: -1, useItem: -1 } }));
    await sleep(50);
  }
  await sleep(200);
  results.snapshotsFlow = a.snaps.length >= 15 && b.snaps.length >= 15;
  const last = a.snaps[a.snaps.length - 1];
  const heroA = last.u.find((u) => u.k === 'hero' && u.tm === 'blue');
  const heroB = last.u.find((u) => u.k === 'hero' && u.tm === 'red');
  results.heroesInSnapshot = !!heroA && !!heroB && heroA.hk === 'bayani' && heroB.hk === 'ren';
  // The countdown runs 3 s before intents move anyone; by now A should be moving.
  results.stateLive = last.state === 'live' || last.state === 'countdown';
  const firstLive = a.snaps.find((s) => s.state === 'live');
  const zStart = firstLive ? firstLive.u.find((u) => u.k === 'hero' && u.tm === 'blue').z : 37;
  results.intentMovesHero = last.state !== 'live' || heroA.z < zStart - 0.5 || true; // asserted properly below after more ticks
  // Keep walking until live and check movement.
  for (let i = 0; i < 60; i++) {
    a.ws.send(JSON.stringify({ t: 'intent', tick: tick++, i: { moveX: 0, moveZ: -1, aimX: 0, aimZ: 0, attack: false, q: false, w: false, e: false, r: false, recall: false, buy: -1, useItem: -1 } }));
    await sleep(50);
  }
  await sleep(150);
  const fin = a.snaps[a.snaps.length - 1];
  const hA = fin.u.find((u) => u.k === 'hero' && u.tm === 'blue');
  results.intentMovesHero = fin.state === 'live' && hA.z < 37 - 1.0;
  const finB = b.snaps[b.snaps.length - 1];
  results.clientsAgree = finB.tick <= fin.tick && Math.abs(finB.u.find((u) => u.k === 'hero' && u.tm === 'blue').z - hA.z) < 1.0;
  results.forgedIntentClamped = (() => { a.ws.send(JSON.stringify({ t: 'intent', tick: tick++, i: { moveX: 99, moveZ: 99, aimX: 1e9 } })); return true; })();
  await sleep(200);
  const after = a.snaps[a.snaps.length - 1].u.find((u) => u.k === 'hero' && u.tm === 'blue');
  results.forgedIntentClamped = Math.abs(after.x - hA.x) < 2 && Math.abs(after.z - hA.z) < 2;   // ≤ moveSpeed × 0.2 s, not 99×
  const bytes = JSON.stringify(fin).length;
  results.snapshotBytes = bytes;
  results.eventsFlow = a.snaps.some((s) => s.ev && s.ev.length > 0);
  a.ws.close(); b.ws.close();
} catch (e) { results.error = String(e && e.stack || e); }
server.kill('SIGKILL');
console.log(results);
const ok = !results.error && Object.entries(results).every(([k, v]) => k === 'snapshotBytes' || v === true);
console.log(ok ? 'NET TEST: ok' : 'NET TEST: FAILED');
process.exit(ok ? 0 : 1);
