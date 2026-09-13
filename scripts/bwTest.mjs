// Bandwidth check (docs/PHASE4.md target: < 20 KB/s per client). One solo client for
// SECONDS of match time, through the first wave clash. Prints JSON and "BW TEST: ok".
//   node scripts/bwTest.mjs [seconds]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECONDS = Number(process.argv[2] || 25);
const PORT = 8900 + Math.floor(Math.random() * 90);
const server = spawn('node', [join(ROOT, 'server', 'index.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
let bytes = 0, snaps = 0, maxB = 0, units = 0;
ws.onmessage = (ev) => { const n = ev.data.length; bytes += n; if (n > maxB) maxB = n; const m = JSON.parse(ev.data); if (m.t === 'snap') { snaps++; if (!m.partial) units = m.u.length; } };
await new Promise((r) => { ws.onopen = r; });
ws.send(JSON.stringify({ t: 'join', room: 'new', hero: 'bayani', solo: true }));
const t0 = Date.now();
await sleep(SECONDS * 1000);
const secs = (Date.now() - t0) / 1000;
const kbps = bytes / secs / 1024;
const out = { secs: Math.round(secs), snaps, units, kbps: Math.round(kbps * 10) / 10, maxSnapBytes: maxB, avgSnapBytes: Math.round(bytes / snaps) };
console.log(JSON.stringify(out));
ws.close(); server.kill('SIGKILL');
const ok = kbps < 20 && snaps > SECONDS * 15;
console.log(ok ? 'BW TEST: ok' : 'BW TEST: FAILED');
process.exit(ok ? 0 : 1);
