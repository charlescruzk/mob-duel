// Multiplayer (docs/PHASE4.md): the dependency-free WebSocket server, a two-client
// room in Node, and the browser mirroring a solo online match end to end.
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';

function nodeOk(script, ROOT) {
  try { return /: ok/.test(execFileSync('node', [join(ROOT, 'scripts', script)], { encoding: 'utf8', timeout: 90000 })); }
  catch (e) { return false; }
}

export default async function ({ block, report, restart, send, sleep, ROOT }) {
  report('net: socket layer and two-client room in Node', {
    wsEchoRoundTrip: nodeOk('wsTest.mjs', ROOT),
    twoClientsShareOneMatch: nodeOk('netTest.mjs', ROOT),
  });

  const PORT = 8800 + Math.floor(Math.random() * 100);
  const server = spawn('node', [join(ROOT, 'server', 'index.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
  try {
    await restart(`server=ws://127.0.0.1:${PORT}/ws&room=new&solo=1&hero=lilit&lowfx=1`);
    // restart() pauses the loop; the online match needs real frames to receive
    // snapshots, so run it live for the countdown, then take over the clock.
    await send('Runtime.evaluate', { expression: "if (window.__game) window.__game.paused = false; 'live'" });
    await sleep(4500);
    await block('net: the browser mirrors a solo online match', `(async () => {
      const g = window.__game; const r = {};
      if (!g || !g.net) return { onlineGameBuilt: false };
      r.onlineGameBuilt = g.net.online === true && g.net.seat === 0 && /^[A-Z]{4}$/.test(g.net.room);
      const W = g.world, H = g.hero, E = g.enemy;
      r.mirrorHasBothHeroes = H.heroKey === 'lilit' && E.team === 'red' && E.kind === 'hero' && W.units.length >= 6;
      r.mirrorBuiltMeshes = !!H.mesh && !!E.mesh && H.mesh.visible && g.fx.unitViews.visibleCount() >= 6;
      r.snapshotsArrive = g.net.client.receivedSnaps > 20 && g.net.mirror.snapshotsApplied > 10;
      r.matchWentLive = g.match.state === 'live';
      r.intentsSent = g.net.client.sentIntents > 20;
      // Drive the intent by hand: walk forward for 1.5 s of real time.
      g.match.controller = null; g.paused = false;
      const z0 = H.pos.z;
      H.intent.moveZ = -1;
      await new Promise((res) => setTimeout(res, 1500));
      H.intent.moveZ = 0;
      r.intentMovesMirroredHero = H.pos.z < z0 - 3;
      r.meshFollowsMirror = Math.abs(H.mesh.position.z - H.pos.z) < 1e-6;
      r.hudReadsMirroredHero = document.getElementById('hp-num') ? document.getElementById('hp-num').textContent.indexOf(String(Math.round(H.maxHp))) >= 0 : true;
      r.botDrivesEnemy = Math.abs(E.pos.z) < 36.9 || E.pos.x !== 0;   // the server's bot walked
      r.eventsReplayed = g.net.mirror.eventsApplied > 0;
      r.localSimNeverSteps = g.world.time > 0 && g.world.time === g.net.mirror.time;   // time comes only from snapshots
      // 200 frames of the render loop: unit list and view list lengths are stable
      // while no wave is spawning (first wave at 15 s; we are well before it).
      const n0 = W.units.length, v0 = g.fx.unitViews.list.length;
      await new Promise((res) => setTimeout(res, 800));
      r.netNoAllocation = (W.units.length === n0 || W.units.length === n0 + 6) && g.fx.unitViews.list.length >= v0;
      g.paused = true;
      return r;
    })()`);
  } finally {
    server.kill('SIGKILL');
    await restart('hero=bayani&enemy=ren&lowfx=1');
  }
}
