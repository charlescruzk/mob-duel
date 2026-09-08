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
const URL = `http://127.0.0.1:${PORT}/index.html?cb=${Date.now()}`;

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
    r.deathEmitted = diedSeen === 1 && h.alive === false && h.mesh.visible === false;
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

  ws.close();
  try { server.kill('SIGKILL'); } catch { /* gone */ }
  try { chrome.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(exitCode);
}

main().catch((e) => { console.log('PROBE ERROR: ' + (e?.message || e)); process.exit(1); });
