// Round-trip test for server/ws.mjs using Node's built-in WebSocket client (Node ≥ 22).
import { createServer } from 'node:http';
import { attachWebSocket } from '../server/ws.mjs';

const http = createServer((req, res) => { res.writeHead(404); res.end(); });
attachWebSocket(http, '/ws', (conn) => {
  conn.onmessage = (msg, bin) => {
    if (bin) conn.send(Buffer.from(msg));         // echo binary as binary
    else conn.send('echo:' + msg);
  };
});
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const port = http.address().port;
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
ws.binaryType = 'arraybuffer';
const got = [];
const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 5000);
  ws.onopen = () => {
    ws.send('hello');
    ws.send('x'.repeat(70000));                    // 16-bit length path
    ws.send(new Uint8Array([1, 2, 3, 250]).buffer); // binary
  };
  ws.onmessage = (ev) => {
    got.push(ev.data);
    if (got.length === 3) { clearTimeout(timer); resolve(); }
  };
  ws.onerror = (e) => { clearTimeout(timer); reject(new Error('ws error')); };
});
let ok = false;
try {
  await done;
  const big = got[1];
  const bin = new Uint8Array(got[2]);
  ok = got[0] === 'echo:hello' && typeof big === 'string' && big.length === 70005 && bin.length === 4 && bin[3] === 250;
} catch (e) { console.log('WS TEST ERROR: ' + e.message); }
ws.close();
http.close();
console.log(ok ? 'WS TEST: ok' : 'WS TEST: FAILED');
process.exit(ok ? 0 : 1);
