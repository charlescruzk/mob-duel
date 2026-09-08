// Dev-only verification probe (NOT imported by the game). Starts a static server,
// loads index.html in headless Chrome over the DevTools Protocol, clicks to start,
// and dumps uncaught exceptions plus the post-start state. Behaviour assertions are
// added as `Runtime.evaluate` blocks below the marker — each drives the game through
// `window.__game` with explicit `dt` and reports an object of booleans.
//
//   node scripts/probe.mjs
//
// Needs: Node >= 21 (global WebSocket/fetch), Chrome at CHROME, python3.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8090;
const CDP = 9343;
const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;
// The first load runs a normal match (?hero=brakk); the hero-select block navigates
// to the bare page, where the match is only built once a card is clicked. lowfx
// keeps SwiftShader off the bloom composer for the long non-look stretch — the
// look blocks below navigate to a full-fx page explicitly.
const URL = `${URL_BASE}?cb=${Date.now()}&hero=brakk&enemy=ilyra&lowfx=1`;

let exitCode = 0;

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore',
  });
  const chrome = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${CDP}`,
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    'about:blank',
  ], { stdio: 'ignore' });

  const jget = async (path, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      try { return await (await fetch(`http://127.0.0.1:${CDP}${path}`)).json(); }
      catch { await sleep(200); }
    }
    return null;
  };
  const ver = await jget('/json/version');
  if (!ver) throw new Error('Chrome DevTools endpoint never came up (Chrome installed?)');

  const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const logs = [];
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const st = d.stackTrace ? d.stackTrace.callFrames.map((f) => `${f.url}:${f.lineNumber}`).join('\n  at ') : '';
      errors.push('EXCEPTION: ' + (d.exception?.description || d.text) + (st ? '\n  at ' + st : ''));
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // Headless Chrome has no pointer: stub pointer lock so a click-to-play gate opens.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "document._plEl = null;",
    "Object.defineProperty(document, 'pointerLockElement', { configurable: true, get() { return document._plEl; } });",
    "const _rq = function () { document._plEl = this; document.dispatchEvent(new Event('pointerlockchange')); };",
    "const _ex = function () { document._plEl = null; document.dispatchEvent(new Event('pointerlockchange')); };",
    "for (const P of [Element.prototype, HTMLElement.prototype]) { P.requestPointerLock = _rq; }",
    "Document.prototype.exitPointerLock = _ex;",
  ].join('\n') });
  await send('Page.navigate', { url: URL });
  await sleep(4500);
  await send('Runtime.evaluate', { expression: "const o=document.querySelector('#start-overlay'); if(o) o.click(); 'clicked'" });
  await sleep(1200);
  // From here on the render loop must not simulate: every block drives the clock itself.
  await send('Runtime.evaluate', { expression: "if (window.__game) window.__game.paused = true; 'paused'" });

  // Run one assertion block: evaluate, print, and fail the run on any `false`.
  await send('Runtime.evaluate', { expression: "window.__probeEarlyReturn = true;", returnByValue: true });
  const block = async (title, expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    console.log(`\n=== BEHAVIOR (${title}) ===`);
    if (r && r.result && r.result.value !== undefined) {
      const v = r.result.value;
      console.log(v);
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) if (val === false) { exitCode = 1; console.log(`  ✗ ${k}`); }
        if (v.error) exitCode = 1;
      }
    } else {
      exitCode = 1;
      console.log('EXCEPTION: ' + (r?.exceptionDetails?.exception?.description || r?.exceptionDetails?.text || JSON.stringify(r)));
    }
  };

  const codeErrors = errors.filter((e) => !/WebGL context/i.test(e));
  console.log('=== EXCEPTIONS ===');
  if (codeErrors.length) { exitCode = 1; console.log(codeErrors.join('\n')); }
  else console.log('(no code errors)');

  const state = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ hasGame: !!window.__game, three: window.__game && window.__game.three,
      overlayHidden: !!(document.querySelector('#start-overlay')?.classList.contains('hidden')) })`,
    returnByValue: true,
  });
  console.log('\n=== POST-START STATE ===');
  console.log(state?.result?.value ?? '(eval failed)');
  if (!state?.result?.value?.includes('"hasGame":true')) exitCode = 1;

  // Fresh page for hero-specific blocks (the first load runs the default Brakk page):
  // navigate with new query params, click through the start gate, pause the clock.
  const restart = async (qs) => {
    // Empty qs → the bare page: the hero-select overlay shows and no match is built.
    // Always rebuilt from URL_BASE so params never duplicate the first load's (?cb
    // refreshes each time — a stale cache key would replay an old page).
    const url = `${URL_BASE}?cb=${Date.now()}${qs ? '&' + qs : ''}`;
    await send('Page.navigate', { url });
    await sleep(4500);
    await send('Runtime.evaluate', { expression: "const o=document.querySelector('#start-overlay'); if(o) o.click(); 'clicked'" });
    await sleep(1200);
    await send('Runtime.evaluate', { expression: "if (window.__game) window.__game.paused = true; 'paused'" });
  };

  // ---------------------------------------------------------------------------
  // ASSERTION BLOCKS — add one `await block(title, expression)` per feature below.
  // Each expression is an async IIFE returning an object of booleans. Drive the
  // game via window.__game with explicit dt; never rely on real time passing.
  // ---------------------------------------------------------------------------

  await block('scaffold: intent moves the hero, lane clamps, camera follows, events/world queries', `(async () => {
    const g = window.__game; const h = g.hero; const i = g.intent; const w = g.world;
    const r = {};
    const ctl = g.controller; ctl.enabled = false;     // drive intent by hand
    h.pos.set(0, 0, 37); h.prevPos.copy(h.pos);
    // Walk toward -Z for 1 s at 5.2 m/s.
    i.moveX = 0; i.moveZ = -1;
    for (let k = 0; k < 20; k++) { w.update(0.05); }
    r.walkedForward = Math.abs(h.pos.z - (37 - 5.2)) < 0.05 && Math.abs(h.pos.x) < 1e-6;
    r.velTracked = Math.abs(h.vel.z + 5.2) < 0.05;
    r.meshSynced = h.mesh && Math.abs(h.mesh.position.z - h.pos.z) < 1e-6;
    r.facingMove = Math.abs(h.facing) < 1e-6;
    // Strafe +X into the lane edge: centre clamps to 7 - radius.
    i.moveX = 1; i.moveZ = 0;
    for (let k = 0; k < 60; k++) { w.update(0.05); }
    r.laneClamped = Math.abs(h.pos.x - (7 - h.radius)) < 1e-6;
    r.timeAdvanced = w.time > 3.9;
    // Camera follows: after snapping + updates, pivot is at hero, camera ~7 m away.
    g.camera.snapTo(h.pos); g.camera.update(0.05, h.pos);
    const cam = g.engine.camera;
    const dx = cam.position.x - h.pos.x, dz = cam.position.z - h.pos.z, dy = cam.position.y - 1.6;
    r.cameraDistance = Math.abs(Math.sqrt(dx*dx + dz*dz + dy*dy) - 7) < 0.05;
    r.cameraBehind = dz > 5;                           // yaw 0 → camera at +Z of hero
    const tmp = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    r.reticleHitsGround = g.camera.reticleOnGround(tmp) === true && tmp.z < h.pos.z;
    // Event bus + Unit damage/armor/shield/death.
    let dmgSeen = 0, diedSeen = 0;
    const off1 = g.events.on('unitDamaged', (p) => { dmgSeen = p.amount; });
    const off2 = g.events.on('unitDied', (p) => { diedSeen++; });
    const hp0 = h.hp; h.shield = 10;
    const dealt = h.takeDamage(100, null, 'physical');   // armor 15%: 85, shield eats 10 → 75
    r.armorApplied = Math.abs(dealt - 75) < 1e-6 && Math.abs(hp0 - h.hp - 75) < 1e-6 && Math.abs(dmgSeen - 75) < 1e-6;
    r.trueIgnoresArmor = Math.abs(h.takeDamage(10, null, 'true') - 10) < 1e-6;
    h.takeDamage(1e9, null, 'true');
    // Task 10: rigged units keep the mesh up for the death fall/sink (the animator
    // hides it once sunk), so death is asserted on the unit state + event only.
    r.deathEmitted = diedSeen === 1 && h.alive === false && h.mesh.visible === true;
    off1(); off2();
    h.revive(); h.pos.set(0, 0, 37); h.prevPos.copy(h.pos);
    r.revived = h.alive && h.hp === h.maxHp && h.mesh.visible;
    // World queries: hero is found for its own team, not as an enemy of itself.
    const out = [];
    r.byTeam = w.byTeam('blue', 'hero', out).length === 1 && out[0] === h;
    r.nearestEnemyNull = w.nearestEnemy(h.pos, 'blue', 1) === null;   // never itself
    r.nearestEnemyFromRed = w.nearestEnemy(h.pos, 'red', 100) === h;
    r.enemiesInRadius = w.enemiesInRadius(h.pos, 'red', 1, out).length === 1;
    r.rngDeterministic = (() => { const a = w.random(); return a >= 0 && a < 1; })();
    // Intent contract: numbers/booleans only.
    r.intentPlain = Object.values(i).every((v) => typeof v === 'number' || typeof v === 'boolean') && 'buy' in i;
    // Cleanup: hand control back to the input controller.
    i.moveX = 0; i.moveZ = 0; ctl.enabled = true;
    r.mapBoxes = g.map.boxes.length === 16 && !!g.map.positions.blue.tower;
    return r;
  })()`);

  // Integration blocks. Each one: pause the render loop's clock, put the match in
  // 'live' with both intent writers detached, and drive window.__game.step(dt) by
  // hand — so every number below is deterministic and independent of wall time.
  const SETUP = `
    const g = window.__game; const m = g.match; g.paused = true;
    const H = g.hero, E = g.enemy, W = g.world;
    m.controller = null; m.bot = null; m.reset(); m.skipCountdown();
    const step = (secs, dt) => { dt = dt || 0.05; for (let t = 0; t < secs - 1e-9; t += dt) g.step(dt); };
    const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-3 : eps);
    const edge = (intent, key) => { intent[key] = true; g.step(0.05); intent[key] = false; };
    const fresh = (h) => { h.abilities.resetAll(); h.mp = h.maxMp; h.hp = h.maxHp; };
    const r = {};`;

  await block('hero: movement, lane bound, recall, death and respawn', `(async () => {
    ${SETUP}
    const I = H.intent;
    // Walks at Brakk's 5.2 m/s and stops at the lane edge (x = 7 - radius).
    H.teleport(0, 30); I.moveZ = -1; step(1);
    r.heroMoves = near(H.pos.z, 30 - 5.2, 0.1) && near(H.pos.x, 0, 1e-6);
    I.moveZ = 0; I.moveX = 1; step(3);
    r.heroStopsAtWall = near(H.pos.x, 7 - H.radius, 1e-3);
    I.moveX = 0;
    // Recall: a rising edge starts a 6 s channel that teleports home when it completes.
    H.teleport(0, 10); edge(I, 'recall');
    r.recallStarts = H.isRecalling === true;
    step(6.1);
    r.recallChannelsAndTeleports = H.isRecalling === false && near(H.pos.z, 37, 0.05);
    // Moving during the channel cancels it and the hero stays put.
    H.teleport(0, 10); edge(I, 'recall'); step(1); I.moveZ = -1; step(0.1); I.moveZ = 0;
    r.movingCancelsRecall = H.isRecalling === false && H.pos.z < 10 && H.pos.z > 5;
    // Death: the respawn timer runs while dead, then the hero is back at spawn at full HP.
    H.teleport(0, 10); H.takeDamage(99999, E, 'true');
    r.heroDies = H.alive === false && H.respawnTimer > 0;
    step(H.respawnTimer + 0.2);
    r.deathRespawnsAtNexus = H.alive === true && near(H.hp, H.maxHp, 1e-6) && near(H.pos.z, 37, 0.05);
    return r;
  })()`);

  await block('abilities: damage, ult lock, mana and cooldown gates, XP levels', `(async () => {
    ${SETUP}
    const I = H.intent, J = E.intent;
    H.teleport(0, 0); E.teleport(0, -2); fresh(H); fresh(E);
    I.aimX = E.pos.x; I.aimZ = E.pos.z;
    // Brakk Q is a circle r3 around him: it lands on the mage, spends mana, starts a cooldown.
    edge(I, 'q'); step(0.5);
    r.abilityCastsAndDamages = E.hp < E.maxHp && H.cooldowns.q > 0 && H.mp < H.maxMp;
    // Brakk W is a self shield.
    edge(I, 'w'); step(0.05);
    r.brakkWShields = H.shield > 0;
    // Brakk E dashes toward the aim point and lands damage.
    fresh(H); E.hp = E.maxHp; H.teleport(0, 0); E.teleport(0, -3);
    I.aimX = 0; I.aimZ = -3; edge(I, 'e'); step(1);
    r.brakkEDashDamages = H.pos.z < -0.5 && E.hp < E.maxHp;
    // Ult locked at level 1.
    r.ultLockedAtLevel1 = H.level === 1 && H.abilityState('r') === 'locked' && H.ready('r') === false;
    // Mana gate: no mana, no cast, no damage.
    fresh(H); H.mp = 0; E.hp = E.maxHp; H.teleport(0, 0); E.teleport(0, -2); I.aimX = 0; I.aimZ = -2;
    r.manaGates = H.abilityState('q') === 'mana';
    edge(I, 'q'); step(0.5);
    r.manaGateHolds = near(E.hp, E.maxHp, 1e-6);
    // Cooldown gate: a second Q right after the first is refused.
    fresh(H); E.hp = E.maxHp; edge(I, 'q'); step(0.5);
    const afterFirst = E.hp; E.hp = E.maxHp; edge(I, 'q'); step(0.5);
    r.cooldownGates = afterFirst < E.maxHp && near(E.hp, E.maxHp, 1e-6) && H.abilityState('q') === 'cooldown';
    // Ilyra's kit, driven through the enemy's intent: Q skillshot, W ground burst, E blink.
    fresh(H); fresh(E); H.teleport(0, 0); E.teleport(0, -6); I.aimX = 0; I.aimZ = 0;
    J.aimX = 0; J.aimZ = 0; H.hp = H.maxHp;
    edge(J, 'q'); step(1.0);
    r.ilyraQSkillshotDamages = H.hp < H.maxHp;
    H.hp = H.maxHp; edge(J, 'w'); step(0.9);
    r.ilyraWDamages = H.hp < H.maxHp;
    const ez = E.pos.z; edge(J, 'e'); step(0.3);
    r.ilyraEBlinks = E.pos.z > ez + 2.5;
    // XP: 120 reaches level 2 (max HP grows), 540 reaches level 4 and unlocks R.
    const hp1 = H.maxHp; H.addXp(120);
    r.xpLevelsUp = H.level === 2 && H.maxHp > hp1;
    H.addXp(420);
    r.ultUnlocksAtLevel4 = H.level >= 4 && H.abilityState('r') !== 'locked';
    return r;
  })()`);

  await block('minions, last-hit gold, tower rules, nexus, match end, rematch', `(async () => {
    ${SETUP}
    const Minion = (await import('/src/units/minion.js')).Minion;
    H.teleport(0, 37); E.teleport(0, -37);
    // First wave at 15 s, five per side released over the stagger.
    r.noMinionsBefore15 = (step(14.5), g.waves.aliveCount('blue') === 0);
    step(3.2);
    r.minionWaveSpawnsAt15s = g.waves.aliveCount('blue') === 5 && g.waves.aliveCount('red') === 5;
    // They walk the lane, meet, and fight.
    step(12);
    const pool = g.waves.pool;
    r.minionsWalk = pool.some((u) => u.team === 'blue' && u.pos.z < 25);
    r.minionsFight = pool.some((u) => u.hp < u.maxHp);
    // Last-hit gold goes only to the hero whose hit kills; a minion's kill pays nobody.
    const reds = pool.filter((u) => u.team === 'red' && u.alive);
    const blues = pool.filter((u) => u.team === 'blue' && u.alive);
    let gH = H.gold, gE = E.gold; const v = reds[0]; const expect = v.goldValue;
    v.hp = 1; v.takeDamage(10, H, 'physical');
    r.lastHitGoldToKiller = H.gold === gH + expect && E.gold === gE;
    gH = H.gold; const v2 = reds[1]; v2.hp = 1; v2.takeDamage(10, blues[0], 'physical');
    r.lastHitGoldOnlyToKiller = H.gold === gH && v2.alive === false;
    // Tower: with an allied minion in range the hero is not the target.
    m.reset(); m.skipCountdown();
    const T = g.towers.red, N = g.nexuses.red;
    H.teleport(0, -10); E.teleport(0, -8); fresh(H); fresh(E);
    const ally = W.add(new Minion('blue', W, g.engine.scene, { x: 0, y: 0, z: -12 }, { ranged: false, wave: 0 }));
    step(0.3);
    r.towerTargetsMinionsFirst = T.target === ally && near(H.hp, H.maxHp, 1e-6);
    // The hero hits an enemy hero inside tower range: immediate aggro, then the ramp.
    E.takeDamage(10, H, 'physical');
    r.towerSwitchesToAggressiveHero = T.target === H;
    const hpBefore = H.hp; step(2.0);
    r.towerShootsHero = H.hp < hpBefore;
    r.towerDamageRamps = near(T.ramp, 1.25, 1e-6);
    // Nexus is immune while its tower stands, vulnerable the moment it falls.
    const nhp = N.hp; N.takeDamage(500, H, 'true');
    r.nexusImmuneWhileTowerAlive = N.hp === nhp && N.shielded === true;
    const gT = H.gold; T.takeDamage(99999, H, 'true'); step(0.05);
    r.towerKillPaysBounty = T.alive === false && H.gold === gT + 150;
    r.nexusExposedAfterTower = N.shielded === false;
    N.takeDamage(99999, H, 'true');
    r.nexusDestroyedEndsMatch = m.state === 'over' && m.winner === 'blue';
    // Rematch restores everything — including tower aggro, which used to die with world.clear().
    m.reset();
    r.matchResetWorks = m.state === 'countdown' && W.time === 0 && H.level === 1 && H.gold === 400
      && T.alive && N.alive && N.shielded && near(H.pos.z, 37, 0.05)
      && W.units.length === 6 && W.units.indexOf(T) >= 0 && !!T._unsub;
    m.skipCountdown(); H.teleport(0, -10); E.teleport(0, -8); fresh(H); fresh(E);
    E.takeDamage(10, H, 'physical');
    r.towerAggroSurvivesReset = T.target === H;
    return r;
  })()`);

  await block('economy, shop, bot', `(async () => {
    ${SETUP}
    // Shop only in the fountain; buying applies stats; the intent.buy edge works too.
    H.teleport(0, 0); H.gold = 5000;
    r.shopRefusesOutsideFountain = g.shop.canBuy(H, 0) === false && g.shop.reason(H, 0) === 'fountain';
    H.teleport(0, 37);
    const g0 = H.gold; const bought = g.shop.buy(H, 0);
    r.shopBuysInFountain = bought === true && H.items.length === 1 && H.gold < g0;
    const hp0 = H.maxHp; g.shop.buy(H, 'heartwood');
    r.itemStatsApply = H.maxHp > hp0 && H.items.length === 2;
    H.intent.buy = 1; g.step(0.05); H.intent.buy = -1; g.step(0.05);
    r.buyIntentEdge = H.items.length === 3;
    // Bot: with the player parked at home it farms the wave and takes last hits.
    m.bot = g.bot; g.bot.reset(); m.reset(); m.skipCountdown();
    H.teleport(0, 37);
    const seen = {}; let lastHits = 0;
    const off = g.events.on('gold', (p) => { if (p.hero === E && p.reason === 'lastHit') lastHits++; });
    for (let t = 0; t < 60; t += 0.05) { g.step(0.05); seen[g.bot.state] = true; }
    off();
    r.botReachesFarm = seen.FARM === true;
    r.botFarmsLastHits = lastHits > 0;
    // Bot retreats when low with the player close.
    m.bot = null; m.reset(); m.skipCountdown(); m.bot = g.bot; g.bot.reset();
    H.teleport(0, 3); E.teleport(0, 0); fresh(E); E.hp = E.maxHp * 0.2;
    step(1.2);
    r.botRetreatsLowHp = g.bot.state === 'RETREAT';
    step(1.0);
    r.botRetreatMovesHome = E.pos.z < -0.5;
    return r;
  })()`);

  // Phase 2 blocks. Each follows SETUP: paused loop, both writers detached, reset,
  // skipCountdown, hand-driven g.step(dt).
  await block('status: minion CC and hero root/stealth/attackSpeed/armorBuff/reflect/bonus', `(async () => {
    try {
    ${SETUP}
    const Minion = (await import('/src/units/minion.js')).Minion;
    const I = H.intent;
    H.teleport(0, 37); E.teleport(0, -37);
    // A lone blue minion walks the lane at 3.2 m/s; CC changes that distance in 1 s.
    // One minion per kind: slow alone (root would mask it), then root, then stun.
    const spawn = () => W.add(new Minion('blue', W, g.engine.scene, { x: 5, y: 0, z: 20 }, { ranged: false, wave: 0 }));
    const mn = spawn();
    step(0.1);
    const z0 = mn.pos.z;
    step(1.0);
    const base = z0 - mn.pos.z;                         // ~3.2 m
    W.remove(mn); g.step(0.05);
    const mn2 = spawn();
    step(0.1);
    mn2.applyStatus('slow', 10, 0.5);
    step(1.0);
    r.minionSlowed = near(mn2.pos.z, z0 - base * 0.5, 0.1);
    W.remove(mn2); g.step(0.05);
    const mn3 = spawn();
    step(0.1);
    mn3.applyStatus('root', 10, 1);
    step(1.0);
    r.minionRooted = near(mn3.pos.z, z0, 1e-6);
    W.remove(mn3); g.step(0.05);
    const mn4 = spawn();
    step(0.1);
    mn4.applyStatus('stun', 10, 1);
    step(1.0);
    r.minionStunned = near(mn4.pos.z, z0, 1e-6);
    W.remove(mn4); g.step(0.05);
    // Rooted hero: attacks and casts, does not move, cannot start a dash.
    H.teleport(0, 0); E.teleport(0, -1.5); fresh(H); fresh(E);
    H.abilities.applyStatus('root', 5, 1);
    I.aimX = E.pos.x; I.aimZ = E.pos.z; I.attack = true; I.moveX = 0; I.moveZ = -1;
    step(0.6);
    r.heroRootedStillAttacks = E.hp < E.maxHp && near(H.pos.z, 0, 1e-6) && near(H.pos.x, 0, 1e-6);
    const mp0 = H.mp;
    I.attack = false; I.moveZ = 0;
    edge(I, 'e'); step(0.5);
    r.rootedDashBlocked = H.abilities.dash.active === false && H.cooldowns.e === 0 && near(H.mp, mp0, 1e-6);
    I.moveX = 0; I.moveZ = 0;
    // Every status clears on death (abilities.clearStatus through die()).
    H.abilities.resetAll(); H.abilities.applyStatus('root', 5, 1);
    H.abilities.applyStatus('stealth', 5, 1); H.abilities.applyStatus('attackSpeed', 5, 0.6);
    H.abilities.applyStatus('armorBuff', 5, 0.2); H.abilities.applyStatus('reflect', 5, 0.15);
    H.abilities.applyStatus('bonusNextAuto', 5, 40);
    H.takeDamage(99999, E, 'true');
    r.statusClearsOnDeath = H.alive === false && H.abilities.rootTimer === 0
      && H.abilities.stealthTimer === 0 && H.abilities.atkSpdTimer === 0
      && H.abilities.armorBuffTimer === 0 && H.abilities.reflectTimer === 0
      && H.abilities.bonusAutoTimer === 0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await block('items: attribute conversion, caps, fleet replacement, consumables', `(async () => {
    try {
    ${SETUP}
    const I = H.intent;
    const shop = g.shop;
    // Attribute conversion (PHASE2.md §2). Oxbelt = +12 STR on the STR-primary hero:
    // +192 max HP, +0.96 HP regen, +12 attack damage (primary only).
    H.gold = 99999; E.gold = 99999;
    const hp0 = H.maxHp, ad0 = H.attackDamage, rg0 = H.hpRegen;
    r.attributeStr = shop.buy(H, 'oxbelt')
      && near(H.maxHp - hp0, 12 * 16, 1e-6)
      && near(H.hpRegen - rg0, 12 * 0.08, 1e-6)
      && near(H.attackDamage - ad0, 12, 1e-6);
    // Agility on a STR hero: armor (+0.048) and attack speed (+0.12) only.
    const ad1 = H.attackDamage;
    shop.buy(H, 'featherband');
    r.attributeAgi = near(H.itemArmor, 0.048, 1e-6) && near(H.itemAttackSpeed, 0.12, 1e-6)
      && near(H.attackDamage, ad0 + 12, 1e-6);
    // Intellect: on Ilyra (INT primary) it adds attack damage; on Brakk it does not.
    const ead0 = E.attackDamage;
    shop.buy(E, 'sapphirebead');
    shop.buy(H, 'sapphirebead');
    r.attributeInt = near(E.attackDamage - ead0, 12, 1e-6)
      && near(H.attackDamage, ad0 + 12, 1e-6)
      && near(H.maxMp, 250 + 144, 1e-6)
      && near(H.abilityAmp, 0.06, 1e-6);
    // Unique + replacement: Swiftsoles refused twice, Fleetfoot Greaves replaces it.
    r.uniqueRefused = shop.buy(H, 'swiftsoles') && !shop.buy(H, 'swiftsoles');
    shop.buy(H, 'fleetgreaves');                   // replaces the unique it upgrades
    let hasFleet = false, hasSoles = false;
    for (let i = 0; i < H.items.length; i++) {
      if (H.items[i].key === 'fleetgreaves') hasFleet = true;
      if (H.items[i].key === 'swiftsoles') hasSoles = true;
    }
    r.fleetReplacesSwiftsoles = hasFleet && !hasSoles && near(H.itemStats.moveSpeed, 0.9, 1e-6);
    // Caps: item attack speed clamps at +150%, total armor at 0.75.
    H.itemStats.attackSpeedPct = 3.0; H.recomputeStats();
    r.attackSpeedCap = near(H.itemAttackSpeed, 1.5, 1e-6);
    H.itemStats.armor = 1.0; H.recomputeStats();
    r.armorCap = near(H.armor, 0.75, 1e-6);
    H.itemStats.attackSpeedPct = 0; H.itemStats.armor = 0; H.recomputeStats();
    // Consumables: 5 potions merge into one slot, the 6th opens a second.
    let ok = true;
    for (let i = 0; i < 6; i++) ok = ok && shop.buy(H, 'hpotion');
    r.consumableStacks = ok
      && H.items.length === 6
      && H.items[4].key === 'hpotion' && H.items[4].count === 5
      && H.items[5].key === 'hpotion' && H.items[5].count === 1;
    // 4 more fill the second stack (5 + 5 = 10 capacity); an 11th is refused —
    // the inventory is full (4 items + 2 full potion slots = 6).
    for (let i = 0; i < 4; i++) shop.buy(H, 'hpotion');
    const goldBefore = H.gold;
    r.slotsFullRefused = H.items[5].count === 5 && !shop.buy(H, 'hpotion')
      && H.gold === goldBefore;
    // Mid-lane for combat maths (no fountain laser, no tower aggro).
    H.teleport(0, 10); E.teleport(0, 8.5); fresh(H); fresh(E);
    H.mp = H.maxMp;
    // Attack speed scales the interval: base 1.0 ÷ (1 + 1.5) = 0.4 s. The start
    // frame arms the full timer without decrementing (update decrements first).
    H.itemStats.attackSpeedPct = 3.0; H.itemStats.lifesteal = 0.5; H.recomputeStats();
    H.hp = H.maxHp - 250;                            // leave headroom for the heals
    I.aimX = E.pos.x; I.aimZ = E.pos.z; I.attack = true;
    step(0.05);
    r.attackSpeedScalesInterval = near(H.attack.timer, 0.4, 0.01)
      && near(H.attack.windup, 0.25, 0.01);          // wind-up not scaled
    const ehp0 = E.hp, hhp0 = H.hp;
    step(0.25);                                      // wind-up ends → the auto lands
    I.attack = false;
    const dealt = ehp0 - E.hp;
    const rise = H.hp - hhp0;
    // Lifesteal 0.5 × dealt, plus Ironhide 6 × 3 = 18 vs heroes at level 1
    // (6 + 2/level means +2 per level after the first).
    r.lifestealHeals = dealt > 40 && near(rise, dealt * 0.5 + 18, 3.0);
    H.itemStats.attackSpeedPct = 0; H.recomputeStats();
    // Use-item edge: slot 4 (the stacked potions) starts a 150 HP / 10 s regen,
    // count drops 5 → 4.
    H.hp -= 300;
    I.useItem = 4; step(0.05); I.useItem = -1;
    r.useItemEdge = near(H.potionHpTimer, 10, 0.02) && near(H.potionHpRate, 15, 1e-6)
      && H.items[4].count === 4;
    const hhp1 = H.hp;
    step(1.0);
    r.potionHealsOverTime = H.hp - hhp1 > 10;        // ~15 HP, minus drift
    // Digit1 maps to inventory slot 0 through the controller (synthetic keydown):
    // the intent carries 0, and since slot 0 is the Oxbelt, no potion is popped.
    m.controller = g.controller;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
    step(0.05);
    m.controller = null;
    r.digitUsesSlot0 = H.intent.useItem === 0 && H.items[4].count === 4;
    // Everything clears on death: potion stacks, timers, passive runtime state.
    H.passives.length = 0; H.passives.push('tempo');
    H.tempoCount = 7; H.undertowArmed = true; E.shieldReady = true; E.shieldCd = 3;
    H.takeDamage(99999, E, 'true');
    step(0.05);
    let potions = 0;
    for (let i = 0; i < H.items.length; i++) if (H.items[i].consumable) potions++;
    r.consumablesClearOnDeath = H.alive === false && potions === 0
      && H.potionHpTimer === 0 && H.potionMpTimer === 0
      && H.tempoCount === 0 && H.undertowArmed === false;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await block('items: passives — burn, cleave, rend, flow, spell shield, tempo, execute, undertow, second wind', `(async () => {
    try {
    ${SETUP}
    const P = await import('/src/economy/passives.js');
    const Minion = (await import('/src/units/minion.js')).Minion;
    const I = H.intent;
    H.gold = 99999;
    // Lone rooted minions at mid-lane keep position maths exact.
    const spawn = (x) => {
      const mn = W.add(new Minion('red', W, g.engine.scene, { x: x, y: 0, z: 20 }, { ranged: false, wave: 0 }));
      mn.applyStatus('root', 30, 1);
      return mn;
    };
    // Burn: an auto marks the target; 15 + 2/lvl magic over 2 s ticks afterwards.
    const mn = spawn(5);
    H.passives.length = 0; H.passives.push('burn');
    step(0.1);
    P.onAutoLand(H, mn);
    const bz0 = mn.hp;
    r.burnApplied = near(mn.burnTimer, 2, 0.02);
    step(0.5);
    r.burnTicks = mn.alive && mn.burnTimer > 0 && mn.hp < bz0 - 3;
    W.remove(mn); g.step(0.05);
    // Cleave: 30% of attack damage to units within 2 m of the target, target excluded.
    const mnA = spawn(5), mnB = spawn(6.4);
    step(0.1);
    H.passives.length = 0; H.passives.push('cleave');
    const bA = mnA.hp, bB = mnB.hp;
    P.onAutoLand(H, mnA);
    r.cleaveSideswipe = near(mnA.hp, bA, 1e-6) && near(bB - mnB.hp, 62 * 0.3, 1e-3);
    W.remove(mnA); W.remove(mnB); g.step(0.05);
    // Tempo: every third landed auto deals +40 magic.
    const mn2 = spawn(5);
    H.passives.length = 0; H.passives.push('tempo');
    H.tempoCount = 0;
    step(0.1);
    const t0 = mn2.hp;
    P.onAutoLand(H, mn2); P.onAutoLand(H, mn2);
    const drop2 = t0 - mn2.hp;
    P.onAutoLand(H, mn2);
    r.tempoThirdAuto = H.tempoCount === 3 && near((t0 - mn2.hp) - drop2, 40, 1e-3);
    W.remove(mn2); g.step(0.05);
    // Execute: autos vs heroes below 40% HP gain +15% of attack damage.
    H.passives.length = 0; H.passives.push('execute');
    E.hp = E.maxHp * 0.3;
    r.executeBonus = near(P.autoBonusDamage(H, E), H.attackDamage * 0.15, 1e-6);
    E.hp = E.maxHp * 0.6;
    r.executeThreshold = P.autoBonusDamage(H, E) === 0;
    E.hp = E.maxHp;
    // Rend and Flow, resolved after an ability hit.
    H.passives.length = 0; H.passives.push('rend');
    const rhp0 = E.hp;
    P.onAbilityHit(H, E, 50);
    r.rendBonusDamage = near(rhp0 - E.hp, E.maxHp * 0.04 * (1 - E.armor), 1e-3);
    H.passives.length = 0; H.passives.push('flow');
    H.mp = 10;
    P.onAbilityHit(H, E, 50);
    r.flowRefundsMp = near(H.mp, 15, 1e-6);
    H.passives.length = 0;
    // Spell Shield: E's first enemy ability hit is eaten, then it recharges.
    E.passives = ['spellShield'];
    E.shieldReady = true; E.shieldCd = 0;
    E.teleport(0, 9); H.teleport(0, 10); fresh(H); H.mp = H.maxMp;
    const shp0 = E.hp;
    edge(I, 'q'); step(0.1);
    r.spellShieldBlocks = near(E.hp, shp0, 0.5) && E.shieldReady === false && E.shieldCd > 0;
    E.shieldCd = 0.5; step(0.6);
    r.spellShieldRecharges = E.shieldReady === true && E.shieldCd === 0;
    E.passives = [];
    // Undertow: a cast arms the next auto to slow its target 30% for 1 s.
    H.passives.length = 0; H.passives.push('undertow');
    const mn3 = spawn(5);
    step(0.1);
    edge(I, 'w'); step(0.1);                       // any successful cast arms it
    r.undertowArmsOnCast = H.undertowArmed === true;
    P.onAutoLand(H, mn3);
    r.undertowSlowsNextAuto = H.undertowArmed === false
      && mn3.slowTimer > 0 && near(mn3.slowPct, 0.3, 1e-6);
    W.remove(mn3); g.step(0.05);
    H.passives.length = 0;
    // Second Wind: below 30% HP it triggers once and heals 15% max over 4 s.
    H.passives.length = 0; H.passives.push('secondWind');
    H.hp = H.maxHp * 0.2;
    step(0.15);
    r.secondWindTriggers = H.swTimer > 0 && H.swCd > 59;    // cd ticks after the trigger
    const whp0 = H.hp;
    step(1.0);
    r.secondWindHeals = H.hp - whp0 > 15;          // ~23 HP of the 15%-over-4s heal
    H.passives.length = 0;
    // The panel shows 25 items across four tabs.
    r.panelTabsAndItems = document.querySelectorAll('#shop .sp-tab').length === 4
      && document.querySelectorAll('#shop .sp-item').length === 25;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  // --- Vaskra (task 3) — fresh page with ?hero=vaskra (enemy fills as Brakk) ---
  await restart('hero=vaskra&lowfx=1');

  await block('vaskra: pierce, quickdraw, tumble, headhunter, deadeye', `(async () => {
    try {
    ${SETUP}
    const I = H.intent;
    const Minion = (await import('/src/units/minion.js')).Minion;
    const spawn = (x, z) => {
      const mn = W.add(new Minion('red', W, g.engine.scene, { x: x, y: 0, z: z }, { ranged: false, wave: 0 }));
      mn.applyStatus('root', 30, 1);
      return mn;
    };
    // Mid-lane, away from towers/fountain. fresh() zeroes regen-drift by restoring hp.
    H.teleport(0, 0); E.teleport(0, 6); fresh(H); fresh(E);

    // Q pierces: two rooted minions on the aim line both take the hit.
    const mnA = spawn(0, -5), mnB = spawn(0, -9);
    I.aimX = 0; I.aimZ = -20;
    edge(I, 'q'); step(0.5);
    r.vaskraQPierces = mnA.hp < mnA.maxHp && mnB.hp < mnB.maxHp;
    fresh(H);

    // W arms the attack-speed buff (and the auto-slow window).
    edge(I, 'w'); step(0.05);
    r.vaskraWRaisesAttackSpeed = H.abilities.attackSpeedPct === 0.6
      && H.abilities.atkSpdTimer > 3 && H.abilities.autoSlowTimer > 3;
    fresh(H);

    // E is a no-damage hop: lands 3.5 m on, the minion in the way is untouched.
    // Tolerance is loose: landing on the minion triggers unit separation, nudging H.
    const mnC = spawn(0, -3.5);
    I.aimX = 0; I.aimZ = -10;
    edge(I, 'e'); step(0.4);
    r.vaskraEHopsNoDamage = near(H.pos.z, -3.5, 0.5) && mnC.hp === mnC.maxHp
      && H.abilities.bonusAutoTimer > 0;
    // The armed bonus lands on the next auto: (55 + 30) AD × (1 − 0.15 armor);
    // bonusAuto 30 + 8/level resolves to the base at level 1.
    E.teleport(0, 1);
    const ehp0 = E.hp;
    I.aimX = E.pos.x; I.aimZ = E.pos.z; I.attack = true;
    step(0.6); I.attack = false;    // windup 0.2 + flight ~0.16: land must be inside the window
    r.vaskraEBonusAuto = near(ehp0 - E.hp, (55 + 30) * 0.85, 1.5)
      && H.abilities.bonusAutoTimer === 0;
    fresh(H);

    // Headhunter: three autos on the same minion — the third carries +15 true
    // (15 + 5/level resolves to the base at level 1).
    const mnD = spawn(0, -4);
    I.aimX = 0; I.aimZ = -4; I.attack = true;
    let lands = 0;
    for (let k = 0; k < 60 && lands < 3; k++) {
      const before = mnD.hp;
      g.step(0.05);
      if (mnD.hp < before) lands++;
    }
    I.attack = false;
    r.vaskraHeadhunterThirdHit = lands === 3 && near(mnD.maxHp - mnD.hp, 55 + 55 + 70, 1)
      && H.headhunterCount === 0;
    fresh(H);

    // Deadeye exec-scale at level 4: raw 150 + 40·3 = 270, ×1.5 on a 50 % HP target,
    // mitigated by 0.15 armor. maxHp is inflated so the hit cannot kill.
    H.level = 4; fresh(H);
    E.hpRegen = 0; E.maxHp = 2000; E.hp = 1000;
    const ehp1 = E.hp;
    I.aimX = E.pos.x; I.aimZ = E.pos.z;
    edge(I, 'r'); step(1.2);
    r.vaskraRExecScales = near(ehp1 - E.hp, 270 * 1.5 * 0.85, 2);
    // Stun mid-wind-up cancels Deadeye: no resolve, no cooldown.
    H.abilities.resetAll(); fresh(H); E.hp = E.maxHp;
    const ehp2 = E.hp;
    edge(I, 'r'); step(0.3);
    H.abilities.applyStatus('stun', 2, 1);
    step(1.0);
    r.vaskraRInterruptedByStun = near(E.hp, ehp2, 0.5)
      && H.abilities.cast.def === null && H.abilities.cooldowns.r === 0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=kesh&enemy=ilyra&lowfx=1');

  await block('kesh: blink, veil, cone, opportunist, verdict', `(async () => {
    try {
    ${SETUP}
    const I = H.intent;
    const Minion = (await import('/src/units/minion.js')).Minion;
    const spawn = (x, z) => {
      const mn = W.add(new Minion('red', W, g.engine.scene, { x: x, y: 0, z: z }, { ranged: false, wave: 0 }));
      mn.applyStatus('root', 30, 1);
      return mn;
    };
    const fakeIntent = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, attack: false,
      q: false, w: false, e: false, r: false, recall: false, buy: -1 };
    // Mid-lane, away from towers/fountain. E's regen is zeroed so damage windows are exact.
    H.teleport(0, 0); E.teleport(0, 5); fresh(H); fresh(E); E.hpRegen = 0;

    // Q: blink 1.2 m behind the target along its facing. E faces +z (facing = PI),
    // so "behind" is −z: H lands at (0, 3.8), 1.2 m from E — past the 1.0 m radii sum,
    // so separation never pushes. The strike is instant: 55 × (1 − 0.08 armor).
    E.facing = Math.PI;
    I.aimX = 0; I.aimZ = 5;
    const ehp0 = E.hp;
    edge(I, 'q'); step(0.3);
    r.keshQBlinksBehind = near(H.pos.x, 0, 0.15) && near(H.pos.z, 3.8, 0.15)
      && near(Math.abs(H.facing), Math.PI, 0.05) && near(ehp0 - E.hp, 55 * 0.92, 1.5);
    fresh(H);

    // W: while stealthed the bot's delayed view has no player (visible = false,
    // playerDist = Infinity) and world acquisition skips the hero entirely.
    const B = g.bot;
    E.teleport(0, 12);
    const mnV = spawn(2, 0);
    edge(I, 'w'); step(0.1);
    B.view.sample(W.time, H); B.view.read(W.time + 0.4, B.p);
    B.update(0.2, fakeIntent);                     // full bot tick against a throwaway intent
    r.keshWStealthHidesFromBot = H.abilities.stealthed === true && B.p.visible === false
      && B.playerDist === Infinity
      && W.nearestEnemy(mnV.pos, 'red', 12, 'hero') === null;
    fresh(H);

    // W ends on attack, and the first auto carries the veil bonus (40 at level 1):
    // (60 + 40) × 0.92. Kesh is melee — the hit lands at wind-up end.
    E.teleport(0, 5); H.teleport(0, 3.8);
    edge(I, 'w'); step(0.1);
    const ehpA = E.hp;
    I.aimX = E.pos.x; I.aimZ = E.pos.z; I.attack = true;
    step(0.5); I.attack = false;
    r.keshWEndsOnAttack = H.abilities.stealthed === false && near(ehpA - E.hp, (60 + 40) * 0.92, 2);
    fresh(H);

    // E: 60° cone, 4.5 m, aimed down-lane. The front rooted minion takes 60 × 1.2
    // (Opportunist: root is CC — the root itself arms the bonus); side and behind
    // fail the angle test. Minion armour is 0.
    H.teleport(0, 0);
    const mnF = spawn(0, -3), mnS = spawn(3, 0), mnBk = spawn(0, 3);
    I.aimX = 0; I.aimZ = -10;
    edge(I, 'e'); step(0.3);
    r.keshEConeHitsFrontOnly = near(mnF.maxHp - mnF.hp, 60 * 1.2, 1.5)
      && mnS.hp === mnS.maxHp && mnBk.hp === mnBk.maxHp;
    fresh(H);

    // Opportunist: two autos on E, a 30% slow applied between them — the second
    // deals exactly 1.2× the first (same armour, no other modifiers in play).
    E.teleport(0, 1.2);
    I.aimX = E.pos.x; I.aimZ = E.pos.z; I.attack = true;
    let dealt1 = 0, dealt2 = 0, lands = 0;
    for (let k = 0; k < 200 && lands < 2; k++) {
      const before = E.hp;
      g.step(0.05);
      if (E.hp < before) {
        lands++;
        if (lands === 1) { dealt1 = before - E.hp; E.applyStatus('slow', 5, 0.3); }
        else dealt2 = before - E.hp;
      }
    }
    I.attack = false;
    r.keshOpportunistBonus = lands === 2 && near(dealt2, dealt1 * 1.2, 1);
    fresh(H);

    // Verdict at level 4 (unlock level): 120 + 30×3 = 210 raw, ×0.92 armour.
    // Full-HP target: single. Below the 30% threshold: doubled, and it survives
    // (386.4 < 500) because maxHp is inflated to 2000. fresh(E) clears the test
    // slow from the Opportunist check so it cannot inflate both strikes.
    H.level = 4; fresh(H); fresh(E);
    E.maxHp = 2000; E.hp = 2000;
    E.maxHp = 2000; E.hp = 2000;
    const ehpR1 = E.hp;
    I.aimX = E.pos.x; I.aimZ = E.pos.z;
    edge(I, 'r'); step(0.3);
    const dealtR1 = ehpR1 - E.hp;
    fresh(H); E.hp = 500;
    const ehpR2 = E.hp;
    edge(I, 'r'); step(0.3);
    const dealtR2 = ehpR2 - E.hp;
    r.keshRDoublesBelow30 = E.alive === true && near(dealtR1, 210 * 0.92, 2)
      && near(dealtR2, 420 * 0.92, 2) && near(dealtR2, dealtR1 * 2, 2);

    // Refund: a non-hero strike still sets the full 60 s cooldown; killing a HERO
    // inside the strike window halves it (Verdict's unitDied refund).
    fresh(H);
    const mnE = spawn(0, -6);
    I.aimX = 0; I.aimZ = -6;
    edge(I, 'r'); step(0.3);
    const cdAfterMinion = H.cooldowns.r;
    fresh(H);
    E.hp = 150;                                    // 386.4 damage kills: the refund path
    I.aimX = E.pos.x; I.aimZ = E.pos.z;
    edge(I, 'r'); step(0.2);
    r.keshRRefundsOnKill = near(cdAfterMinion, 60, 0.5) && E.alive === false
      && near(H.cooldowns.r, 30, 0.5);
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=halvard&enemy=ilyra&lowfx=1');

  await block('halvard: shield bash, stonewall reflect, charge knockback, earthbreaker zone, unyielding', `(async () => {
    try {
    ${SETUP}
    const I = H.intent;
    // Mid-lane; both regens zeroed so damage windows are exact.
    H.teleport(0, 0); E.teleport(0, 1.5); fresh(H); fresh(E);
    H.hpRegen = 0; E.hpRegen = 0; H.mpRegen = 0; E.mpRegen = 0;

    // Q: targeted bash on the enemy nearest the reticle (2.5 m) — 50 raw × 0.92
    // armour, 1 s stun, 40 mana, 8 s cooldown.
    const ehpQ = E.hp;
    I.aimX = 0; I.aimZ = 1.5;
    edge(I, 'q'); step(0.3);
    r.halvardQStuns = E.stunned === true && near(ehpQ - E.hp, 50 * 0.92, 1.5)
      && near(H.mp, H.maxMp - 40, 1e-3) && near(H.cooldowns.q, 7.7, 0.15);
    fresh(H);

    // W: +0.20 armor on top of the 0.20 base (refreshArmor fires on apply).
    edge(I, 'w');
    r.halvardWArmorBuff = near(H.armor, 0.40, 1e-3) && H.abilities.reflectTimer > 0;

    // W reflects 15% of PRE-mitigation damage: Ilyra's 48 auto costs Halvard
    // 48 × (1 − 0.40) = 28.8 and costs Ilyra 48 × 0.15 × 0.92 = 6.62 as magic —
    // in the same instant, inside the attacker's takeDamage.
    fresh(H);
    E.teleport(0, 3);
    step(0.05);                    // settle prevIntent: fresh() leaves the W key's
                                   // rising edge armed from the armor test above
    edge(I, 'w');
    const hhp0 = H.hp, ehpW = E.hp;
    E.intent.attack = true; E.intent.aimX = 0; E.intent.aimZ = 0;
    for (let k = 0; k < 200; k++) { const h0 = H.hp, e0 = E.hp; g.step(0.05); if (H.hp < h0 || E.hp < e0) break; }
    E.intent.attack = false;
    r.halvardWReflects = near(hhp0 - H.hp, 48 * 0.6, 1.5) && near(ehpW - E.hp, 48 * 0.15 * 0.92, 1);
    fresh(H); E.intent.attack = false;

    // E: dash at the reticle; the FIRST enemy hero within 1.2 m stops the dash,
    // takes the damage and is knocked 2.5 m along the dash over 0.2 s + stunned
    // 0.4 s. No landing aoe when a hero was hit. E at −4: hit at t ≈ 0.2, knock
    // completes at t ≈ 0.4 → E lands at −6.5.
    H.teleport(0, 0); E.teleport(0, -4);
    const ehpE = E.hp;
    I.aimX = 0; I.aimZ = -10;
    edge(I, 'e'); step(0.45);
    r.halvardEKnocksBack = near(E.pos.z, -6.5, 0.4) && E.stunned === true
      && near(ehpE - E.hp, 40 * 0.92, 1.5) && H.abilities.dash.active === false;
    fresh(H);

    // R at level 4: 0.5 s wind-up, then r5 — 270 raw (120 + 50×3, the Task 11
    // balance bump) ×0.92, 1.2 s stun, and a 3 s zone that re-applies a 40% slow.
    H.level = 4; fresh(H); fresh(E);
    E.maxHp = 2000; E.hp = 1500;
    H.teleport(0, 0); E.teleport(0, 2);
    const ehpR = E.hp;
    edge(I, 'r'); step(0.7);
    r.halvardRStunsThenSlows = H.abilities.zone.active === true && E.stunned === true
      && near(ehpR - E.hp, 270 * 0.92, 2) && E.slowPct === 0.4;
    step(1.1);
    r.halvardRZoneOutlastsStun = E.stunned === false && E.slowPct === 0.4
      && H.abilities.zone.active === true;
    step(2.5);                                   // 4.8 s after resolve: zone done
    r.halvardRZoneExpires = H.abilities.zone.active === false;
    step(0.6);                                   // last applied slow (0.5 s) decays
    r.halvardRSlowClears = E.slowPct === 0;

    // Unyielding: below 30% HP the armor getter reads +0.15 (0.35 total); back
    // above the threshold it reverts — recomputed every frame from HP.
    fresh(H); step(0.1);
    const full = near(H.armor, 0.20, 1e-3);
    H.hp = 200; step(0.1);
    const low = near(H.armor, 0.35, 1e-3);
    H.hp = H.maxHp; step(0.1);
    r.halvardUnyieldingBelow30 = full && low && near(H.armor, 0.20, 1e-3);
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=lumen&enemy=brakk&lowfx=1');

  await block('lumen: tidal snare root, mend heal+hot, undertow pull, deluge zone, riptide haste, abilityHit event', `(async () => {
    try {
    ${SETUP}
    const I = H.intent;
    // Mid-lane; regens zeroed so heal/damage windows are exact. Brakk armour 0.15
    // (×0.85). H is Lumen at (0,0); E is Brakk.
    H.teleport(0, 0); E.teleport(0, 5); fresh(H); fresh(E);
    H.hpRegen = 0; E.hpRegen = 0; H.mpRegen = 0; E.mpRegen = 0;

    // abilityHit event: counted across the Q window below.
    let hits = 0;
    const offHit = g.events.on('abilityHit', (p) => { if (p.hero === H) hits++; });

    // Q: line skillshot 10 m at speed 20 — from 5 m out the hit lands ~0.3 s in:
    // 55 raw ×0.85, a 1.5 s root, 50 mana, 9 s cd. Riptide grants haste on the hit.
    const ehpQ = E.hp;
    I.aimX = 0; I.aimZ = 5;
    edge(I, 'q'); step(0.4);
    r.lumenQRoots = E.rooted === true && near(ehpQ - E.hp, 55 * 0.85, 1.5)
      && near(H.mp, H.maxMp - 50, 1e-3) && near(H.cooldowns.q, 9 - 0.45, 0.15);
    r.lumenRiptideHaste = H.abilities.hastePct === 0.15 && H.abilities.hasteTimer > 0;
    r.abilityHitEventFires = hits === 1;
    offHit();
    step(1.2);                                   // haste (1.5 s) expires
    fresh(H);

    // W: Mend heals 80 instantly and 20/s for 3 s after; heals never fire the
    // abilityHit event, so no Riptide from it.
    H.hp = 200;
    const mpW = H.mp;
    edge(I, 'w');
    const afterW = H.hp;
    step(1.0);
    r.lumenWHealsInstantAndOverTime = near(afterW - 200, 80, 0.5)
      && near(H.hp - afterW, 20, 0.5) && near(H.mp, mpW - 60, 1e-3);
    fresh(H);

    // E: ground circle r3 at the reticle (in range 7). 0.4 s telegraph, then the
    // pull drags Brakk toward the centre: Brakk sits 1 m off it (aim 4, E at 5),
    // so the pull takes him the full 1 m → z = 4, with 50 raw ×0.85 and a 40% slow.
    const ehpE = E.hp;
    I.aimX = 0; I.aimZ = 4;
    edge(I, 'e'); step(0.5);
    r.lumenEPullsToward = near(E.pos.z, 4, 0.3) && E.slowPct === 0.40
      && near(ehpE - E.hp, 50 * 0.85, 1.5);
    fresh(H); fresh(E);

    // R at level 4 (unlock): 0.5 s telegraph, then a 3.5 s r5 tide at the reticle
    // (in range 6): 50% slow, 76 (40+3×12) raw per 0.5 s tick ×0.85, and Lumen
    // heals 3% max HP/s standing inside it (4 m from the centre, r5).
    H.level = 4; H.recomputeStats();
    H.hpRegen = 0; H.mpRegen = 0;                // recomputeStats restores them
    fresh(H); fresh(E);
    E.maxHp = 3000; E.hp = 2500;
    H.teleport(0, 0); E.teleport(0, 4);
    H.hp = 300;
    I.aimX = 0; I.aimZ = 4;
    edge(I, 'r'); step(0.7);
    r.lumenRTicksAndSlows = H.abilities.zone.active === true && E.slowPct === 0.50;
    const ehpR = E.hp;
    step(1.05);                                  // zone has run 1.25 s → 2 ticks
    r.lumenRTicksAndSlows = r.lumenRTicksAndSlows
      && near(ehpR - E.hp, 2 * 76 * 0.85, 3) && H.abilities.zone.active === true;
    r.lumenRHealsCasterInside = near(H.hp - 300, 0.03 * H.maxHp * 1.25, 2);
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  // Task 7: hero select, ?enemy=, bot for all six.

  // Bare page: the select overlay shows, nothing is built until a card is clicked.
  await restart('');
  await block('hero select: six cards, click picks hero and builds the match', `(async () => {
    try {
    const r = {};
    const sel = document.querySelector('#hero-select');
    const overlay = document.querySelector('#start-overlay');
    r.selectShownWithNoMatch = !!sel && !sel.classList.contains('hidden') && !window.__game;
    r.startOverlayHiddenWhileSelecting = !!overlay && overlay.classList.contains('hidden');
    const cards = sel ? sel.querySelectorAll('.hs-card') : [];
    r.sixCardsBuilt = cards.length === 6;
    r.cardsCarryAllSixKits = cards.length === 6 &&
      ['brakk', 'ilyra', 'vaskra', 'kesh', 'halvard', 'lumen'].every((k) =>
        Array.prototype.some.call(cards, (c) => c.dataset.hero === k));
    r.cardShowsFourAbilities = cards.length > 0 &&
      !!cards[0].querySelector('.hs-name') && !!cards[0].querySelector('.hs-abil') &&
      cards[0].querySelectorAll('.hs-ab-row').length === 4;
    const vaskra = Array.prototype.find.call(cards, (c) => c.dataset.hero === 'vaskra');
    if (vaskra) vaskra.click();
    const g = window.__game;
    r.pickBuildsMatch = !!g && g.hero.heroKey === 'vaskra';
    r.selectHiddenAfterPick = !!sel && sel.classList.contains('hidden');
    r.startOverlayRevealedAfterPick = !!overlay && !overlay.classList.contains('hidden');
    r.seededEnemyIsValid = !!g && g.enemy.heroKey !== 'vaskra' &&
      ['brakk', 'ilyra', 'kesh', 'halvard', 'lumen'].indexOf(g.enemy.heroKey) >= 0;
    if (overlay) overlay.click();                 // enter the match
    g.paused = true;
    r.matchRunsAfterStart = !!g.match && g.hero.heroKey === 'vaskra';
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&enemy=vaskra&lowfx=1');
  await block('enemy param picks the bot hero', `(async () => {
    try {
    const r = {};
    const g = window.__game;
    r.playerIsBrakk = !!g && g.hero.heroKey === 'brakk';
    r.enemyParamPicksHero = !!g && g.enemy.heroKey === 'vaskra';
    r.botRunsEnemyKit = !!g && !!g.bot.kit && g.bot.kit.id === 'vaskra';
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  // Seeded default enemy: the page's own FNV-1a pick among the other five —
  // replicated here so "deterministic" is checked without a second navigation.
  await restart('hero=kesh&lowfx=1');
  await block('default enemy is a seeded pick among the other five', `(async () => {
    try {
    const r = {};
    const g = window.__game;
    let h = 0x811c9dc5;
    const key = 'kesh';
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const others = ['brakk', 'ilyra', 'vaskra', 'halvard', 'lumen'];
    r.defaultEnemyDiffersFromPlayer = !!g && g.enemy.heroKey !== 'kesh' &&
      others.indexOf(g.enemy.heroKey) >= 0;
    r.defaultEnemyDeterministic = !!g && g.enemy.heroKey === others[h % others.length];
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&enemy=vaskra&lowfx=1');
  await block('bot vaskra: farms last hits and opens trades with its buff', `(async () => {
    try {
    ${SETUP}
    m.bot = g.bot; g.bot.reset();
    H.teleport(0, 37);                             // player parked at home
    const seen = {}; let lastHits = 0; let buffed = false;
    const offGold = g.events.on('gold', (p) => { if (p.hero === E && p.reason === 'lastHit') lastHits++; });
    const offCast = g.events.on('abilityCast', (e) => { if (e.hero === E && e.slot === 'w') buffed = true; });
    for (let t = 0; t < 60; t += 0.05) { g.step(0.05); seen[g.bot.state] = true; }
    offGold(); offCast();
    r.botVaskraReachesFarm = seen.FARM === true;
    r.botVaskraFarms = lastHits >= 5;
    r.botVaskraShops = seen.SHOP === true;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&enemy=kesh&lowfx=1');
  await block('bot kesh: closes and trades when the player is in reach', `(async () => {
    try {
    ${SETUP}
    m.bot = g.bot; g.bot.reset();
    // Player parked mid-lane where the waves meet; the bot walks down with its wave
    // and finds him inside Q reach. Topped up every 5 s so minions don't end the test.
    H.teleport(0, 4); E.teleport(0, 6); fresh(H); fresh(E);
    const seen = {}; let byBot = 0;
    const off = g.events.on('unitDamaged', (e) => { if (e.unit === H && e.source === E) byBot++; });
    for (let t = 0; t < 40; t += 0.05) {
      g.step(0.05);
      seen[g.bot.state] = true;
      if (t % 5 < 0.025 && H.alive && H.hp < H.maxHp * 0.9) H.hp = H.maxHp;
    }
    off();
    r.botKeshEntersTrade = seen.TRADE === true;
    r.botKeshDamagesPlayer = byBot >= 3;
    r.botKeshSurvivesTrade = E.hp > 0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&enemy=halvard&lowfx=1');
  await block('bot halvard: stuns the player when close', `(async () => {
    try {
    ${SETUP}
    m.bot = g.bot; g.bot.reset();
    // Same mid-lane parking as the kesh trade block; Halvard's Shield Bash (1 s stun)
    // fires whenever the player is inside its 2.5 m reach during a trade.
    H.teleport(0, 4); E.teleport(0, 6); fresh(H); fresh(E);
    const seen = {}; let stuns = 0;
    const off = g.events.on('unitDamaged', (e) => { if (e.unit === H && e.dtype !== 'physical') stuns++; });
    for (let t = 0; t < 40; t += 0.05) {
      g.step(0.05);
      seen[g.bot.state] = true;
      if (H.stunned) stuns++;
      if (t % 5 < 0.025 && H.alive && H.hp < H.maxHp * 0.9) H.hp = H.maxHp;
    }
    off();
    r.botHalvardEntersTrade = seen.TRADE === true;
    r.botHalvardCcsWhenClose = stuns > 0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&enemy=lumen&lowfx=1');
  await block('bot lumen: heals below half HP, sustains through the lane', `(async () => {
    try {
    ${SETUP}
    m.bot = g.bot; g.bot.reset();
    H.teleport(0, 37);                             // player far: no combat pressure
    E.teleport(0, 10);
    E.hp = E.maxHp * 0.40;
    const startHp = E.hp;
    let heals = 0; let peak = startHp;
    const off = g.events.on('abilityCast', (e) => { if (e.hero === E && e.slot === 'w') heals++; });
    for (let t = 0; t < 10; t += 0.05) { g.step(0.05); if (E.hp > peak) peak = E.hp; }
    off();
    r.botLumenHealsBelowHalf = heals >= 1;
    r.botLumenHpRecovered = peak >= startHp + 60;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&enemy=brakk&lowfx=1');
  await block('bot: buys two potions at start, sips below 60% out of combat, not in combat', `(async () => {
    try {
    ${SETUP}
    m.bot = g.bot; g.bot.reset();
    step(2.0);                                     // settle: the bot SHOPs in the fountain
    r.botBoughtPotions = E.items.some((it) => it.key === 'hpotion');
    // Out of combat, below 60 %: the bot sips.
    H.teleport(0, 37);
    E.teleport(0, 10);
    E.hp = E.maxHp * 0.45;
    step(1.0);
    r.botSipsPotion = E.potionHpTimer > 0 && E.potionHpRate > 0;
    // In combat (the player just cast): no sip while the 2 s guard runs. The running
    // HoT stays live through the cast frame on purpose — it blocks a same-frame race
    // sip — and is cancelled only after the cast has armed the guard.
    H.teleport(0, 12); E.teleport(0, 9);
    fresh(H);
    H.intent.aimX = E.pos.x; H.intent.aimZ = E.pos.z;
    edge(H.intent, 'q');
    E.potionHpTimer = 0; E.potionHpRate = 0;
    E.hp = E.maxHp * 0.45;
    step(0.4);
    r.botHoldsPotionInCombat = E.potionHpTimer === 0 && E.potionHpRate === 0;
    step(2.2);                                     // guard (2 s) expires → it sips
    r.botSipsAfterCombat = E.potionHpTimer > 0 || E.hp > E.maxHp * 0.45 + 30;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await block('fx: particles emit on cast/hit and die out, buffers constant, damage numbers pool, fx reset', `(async () => {
    try {
    ${SETUP}
    const FX = g.fx; const P = FX.particles; const D = FX.damageNumbers;
    const I = H.intent;
    H.teleport(0, 0); E.teleport(0, 2); fresh(H); fresh(E);   // E inside Q's 3 m reach
    step(0.2);                                    // settle: nothing alive yet
    const alive0 = P.alive();
    I.aimX = E.pos.x; I.aimZ = E.pos.z;
    edge(I, 'q'); step(0.25);
    r.particlesEmitOnCast = P.alive() > alive0;
    r.particlesEmitOnHit = P.alive() > alive0 + 5;  // cast burst + impact burst
    // A damage number appears for the hit (physical, hero-sized).
    let shown = false, poolSize = 0;
    for (let i = 0; i < D.slots.length; i++) {
      if (D.slots[i].life > 0 && D.slots[i].el.textContent !== '') shown = true;
    }
    poolSize = D.root ? D.root.childElementCount : -1;
    r.damageNumberShows = shown;
    r.damageNumbersPoolConstant = poolSize === 32;
    // Nothing keeps emitting (no bot, no minions) → everything dies out.
    step(1.6);
    r.particlesDieOut = P.alive() === 0;
    // 200 frames: buffer lengths never change; the pool stays 32.
    const lens = [P.pos.length, P.col.length, P.size.length, P.alpha.length, P.life.length];
    for (let k = 0; k < 200; k++) g.step(0.05);
    r.particleBuffersConstant = P.pos.length === lens[0] && P.col.length === lens[1]
      && P.size.length === lens[2] && P.alpha.length === lens[3] && P.life.length === lens[4];
    r.damageNumbersPoolConstant2 = D.root.childElementCount === 32;
    // Match reset clears every particle.
    edge(I, 'q'); step(0.1);
    const aliveBefore = P.alive();
    m.reset();
    r.fxResetsOnMatchReset = aliveBefore > 0 && P.alive() === 0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  // Task 9: the rendering look. The rest of the run uses lowfx (SwiftShader is too
  // slow with the bloom composer); these two blocks load the full-fx and cheap paths
  // explicitly. A frame error anywhere stops the engine loop, so "still running"
  // after real rAF time is the render-still-works proof.
  await restart('hero=brakk&enemy=ilyra');
  await block('look: shadows, toon hero, outline, composer renders without error', `(async () => {
    try {
    const g = window.__game;
    const L = g.engine.look;
    const r = {};
    r.shadowsEnabledByDefault = !!L && L.lowfx === false
      && g.engine.renderer.shadowMap.enabled === true && L.composer !== null;
    let toon = false, outline = false, casts = false;
    g.hero.mesh.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material && o.material.isMeshToonMaterial && o.material.gradientMap) toon = true;
      if (o.name === 'outline') outline = true;
      if (o.castShadow) casts = true;
    });
    r.heroUsesToonMaterial = toon;
    r.outlineMeshPresent = outline;
    r.heroCastsShadow = casts;
    // Simulate a second by hand, then let real rAF frames render through the
    // composer: the engine loop must still be alive afterwards.
    for (let k = 0; k < 20; k++) g.step(0.05);
    const f0 = g.engine.frame;
    await new Promise((res) => setTimeout(res, 400));
    r.renderStillRuns = g.engine.running === true && g.engine.frame > f0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  await restart('hero=brakk&lowfx=1');
  await block('lowfx: shadow map and composer disabled, sim unaffected', `(async () => {
    try {
    const g = window.__game;
    const L = g.engine.look;
    const r = {};
    r.lowfxDisablesComposer = L.lowfx === true && L.composer === null
      && g.engine.renderer.shadowMap.enabled === false;
    // The cheap path still renders (straight renderer.render) and simulates.
    for (let k = 0; k < 20; k++) g.step(0.05);
    r.lowfxStillSimulates = g.hero.alive && g.world.units.length > 0;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  // Task 10: procedural rigs. Same page as the lowfx block; SETUP resets the match.
  await block('rig: walk phase tracks distance, idle holds, attack swings, death falls, respawn restores, buffers constant', `(async () => {
    try {
    ${SETUP}
    const R = H.rig;
    const I = H.intent;
    r.rigJointTable = !!R && R.kind === 'hero' && R.joints.length === 8 && R.pose.length === 24;
    step(0.5);                                   // settle after reset
    // Walk: run forward 1 s — phase advances with distance covered.
    H.teleport(0, 20);
    I.moveZ = -1;
    const phase0 = R.phase;
    for (let k = 0; k < 20; k++) g.step(0.05);
    I.moveZ = 0;
    r.walkCycleAdvancesWithDistance = R.dist > 3 && R.phase > phase0 + 3;
    // Idle: standing still never advances the walk phase.
    const phase1 = R.phase;
    for (let k = 0; k < 30; k++) g.step(0.05);
    r.idleDoesNotAdvanceWalk = R.phase === phase1;
    // Attack swing: the weapon joint sweeps from raised (-2.2) to struck while the
    // wind-up runs.
    E.teleport(H.pos.x, H.pos.z - 1.2); fresh(H); fresh(E);
    I.attack = true;
    let swingPeak = 0;
    for (let k = 0; k < 40; k++) {
      g.step(0.02);
      const wx = R.joints[7].rotation.x;
      if (wx < swingPeak) swingPeak = wx;        // most raised angle seen
    }
    I.attack = false;
    r.attackSwingsArm = swingPeak < -1.2;
    // Death: the pelvis tips back over 0.5 s, mesh still up, then sink.
    H.takeDamage(1e9, null, 'true');
    for (let k = 0; k < 12; k++) g.step(0.05);
    r.deathPoseFalls = R.pose[0] < -1.2 && H.mesh.visible === true;
    // Respawn: pose blends back to idle, root height returns.
    H.respawn();
    for (let k = 0; k < 30; k++) g.step(0.05);
    r.respawnRestoresPose = Math.abs(R.pose[0]) < 0.1 && Math.abs(R.root.position.y) < 0.1;
    // 200 frames: the joint table and pose buffer never change length.
    const jl = R.joints.length, pl = R.pose.length;
    for (let k = 0; k < 200; k++) g.step(0.05);
    r.rigNoAllocation = R.joints.length === jl && R.pose.length === pl;
    return r;
    } catch (e) { return { error: String((e && e.stack) || e) }; }
  })()`);

  ws.close();
  try { server.kill('SIGKILL'); } catch { /* gone */ }
  try { chrome.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(exitCode);
}

main().catch((e) => { console.log('PROBE ERROR: ' + (e?.message || e)); process.exit(1); });
