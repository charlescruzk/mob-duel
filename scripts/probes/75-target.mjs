// Tap-to-target on touch: a tap locks the enemy under the finger, autos and skills
// follow the lock instead of the facing, and the left stick never moves the camera.
export default async function ({ block, restart, send, sleep }) {
  const touch = async (type, x, y, id = 1) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await restart('hero=kazane&enemy=ren&lowfx=1');
    await touch('touchStart', 700, 60); await touch('touchEnd', 700, 60);   // activates the touch layer
    await sleep(120);
    // A creep stands closer than the enemy hero, slightly to the side: without a lock
    // the reticle pick would take the creep.
    await send('Runtime.evaluate', { expression: `(async () => {
      const g = window.__game;
      g.paused = true; g.match.controller = g.controller; g.controller.enabled = true; g.match.bot = null;
      g.match.skipCountdown();
      (await import('/src/sim/hero/intent.js')).clearIntent(g.enemy.intent);   // a detached bot leaves its last intent behind
      g.hero.teleport(0, 0); g.camera.setYaw(0); g.camera.snapTo(g.hero.pos); g.camera.update(0.05, g.hero.pos);
      g.enemy.teleport(0, -5); g.enemy.hp = g.enemy.maxHp;
      const Minion = (await import('/src/sim/units/minion.js')).Minion;
      window.__t = {};
      window.__t.creep = g.world.add(new Minion('red', g.world, { x: 1.6, y: 0, z: -2.5 }, { ranged: false, wave: 0 }));
      for (let k = 0; k < 10; k++) g.step(0.05);
      const THREE = await import('three');
      const v = new THREE.Vector3();
      v.set(g.enemy.pos.x, 1.1, g.enemy.pos.z).project(g.engine.camera);
      window.__t.ex = (v.x + 1) * 0.5 * window.innerWidth;
      window.__t.ey = (1 - v.y) * 0.5 * window.innerHeight;
      window.__t.yaw0 = g.camera.yaw;
      return 'ready';
    })()`, awaitPromise: true });
    const pt = (await send('Runtime.evaluate', { expression: 'JSON.stringify([window.__t.ex, window.__t.ey])', returnByValue: true })).result.value;
    const [ex, ey] = JSON.parse(pt);
    await touch('touchStart', ex, ey, 7); await sleep(60); await touch('touchEnd', ex, ey, 7);
    await sleep(80);
    // Hold the attack button with the lock in place.
    const atk = (await send('Runtime.evaluate', { expression: "(() => { const r = document.getElementById('tb-atk').getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()", returnByValue: true })).result.value;
    const [ax, ay] = JSON.parse(atk);
    await touch('touchStart', ax, ay, 8);
    await send('Runtime.evaluate', { expression: "for (let k = 0; k < 40; k++) window.__game.step(0.05); 'ok'" });
    await touch('touchEnd', ax, ay, 8);
    // Left stick: a long push must not turn the camera (the right side is the only
    // camera control now).
    await touch('touchStart', 140, 300, 9);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', 140 + i * 4, 300 - i * 12, 9); await sleep(16); }
    await send('Runtime.evaluate', { expression: "for (let k = 0; k < 40; k++) window.__game.step(0.05); 'ok'" });
    await touch('touchEnd', 140, 228, 9);
    await block('target: tap locks an enemy, autos and skills follow it, stick never turns the camera', `(async () => {
      const g = window.__game, H = g.hero, E = g.enemy, T = g.fx.touch, t = window.__t; const r = {};
      r.tapSelectsTarget = T.target === E && T.stats.targets === 1;
      r.targetMarkerShown = T.marker.mesh.visible === true && Math.abs(T.marker.mesh.position.z - E.pos.z) < 0.2;
      r.markerDrawsThroughBodies = T.marker.mesh.material.depthTest === false;
      const bar = g.fx.enemyBars.bars.find((b) => b.unit === E);
      r.enemyBarMarksLockedTarget = !!bar && bar.el.className.indexOf('locked') >= 0;
      r.lockedTargetTakesAutos = E.hp < E.maxHp;
      r.lockIgnoresCloserCreep = t.creep.hp === t.creep.maxHp;
      r.intentCarriesTargetId = H.intent.targetId === E.id;
      r.aimFollowsTarget = Math.abs(H.intent.aimX - E.pos.x) < 0.5 && Math.abs(H.intent.aimZ - E.pos.z) < 0.5;
      // ...and points at it even past the 12 m reticle clamp.
      const tx = E.pos.x - H.pos.x, tz = E.pos.z - H.pos.z, td = Math.hypot(tx, tz);
      const ax = H.intent.aimX - H.pos.x, az = H.intent.aimZ - H.pos.z, ad = Math.hypot(ax, az);
      r.aimPointsAtTarget = td > 1e-3 && ad > 1e-3 && (tx / td) * (ax / ad) + (tz / td) * (az / ad) > 0.999;
      r.stickDoesNotTurnCamera = Math.abs(g.camera.yaw - t.yaw0) < 1e-9;
      r.stickStillWalks = H.pos.z !== 0;
      // A skill cast with a lock aims at the target, not at the facing: stand the
      // hero with its back to the enemy so only the lock can land the skillshot.
      H.abilities.resetAll(); H.mp = H.maxMp;
      H.teleport(0, 0); E.teleport(0, -7); E.hp = E.maxHp;
      H.facing = 0;                                   // facing +... away from the enemy
      const before = E.hp;
      T._cast('q', false, 0, 0);                      // queues the edge; the next frame sends it
      for (let k = 0; k < 24; k++) g.step(0.05);
      r.skillAimsAtLockedTarget = E.hp < before;
      // The lock clears itself when the target dies.
      E.takeDamage(1e9, H, 'true');
      for (let k = 0; k < 4; k++) g.step(0.05);
      T.update(0.05);
      r.targetClearsOnDeath = T.target === null && T.marker.mesh.visible === false && H.intent.targetId >= 0;
      return r;
    })()`);
    // Wild Rift / Honor of Kings drag targeting: pull the attack button toward a unit.
    await send('Runtime.evaluate', { expression: `(() => {
      const g = window.__game, T = g.fx.touch;
      T.target = null; T.attackHeld = false;
      g.hero.teleport(0, 0); g.camera.setYaw(0); g.camera.snapTo(g.hero.pos); g.camera.update(0.05, g.hero.pos);
      g.enemy.teleport(-4.5, -4.5); g.enemy.alive = true; g.enemy.hp = g.enemy.maxHp;
      for (let k = 0; k < 4; k++) g.step(0.05);
      return 'ok';
    })()` });
    const atk2 = JSON.parse((await send('Runtime.evaluate', { expression: "(() => { const r = document.getElementById('tb-atk').getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()", returnByValue: true })).result.value);
    await touch('touchStart', atk2[0], atk2[1], 11);
    for (let i = 1; i <= 5; i++) { await touch('touchMove', atk2[0] - i * 12, atk2[1] - i * 12, 11); await sleep(16); }
    const dragRes = (await send('Runtime.evaluate', { expression: "(() => { const T = window.__game.fx.touch; return JSON.stringify({ locked: T.target === window.__game.enemy, drags: T.stats.dragLocks, held: T.attackHeld }); })()", returnByValue: true })).result.value;
    await touch('touchEnd', atk2[0] - 60, atk2[1] - 60, 11);
    await block('target: dragging the attack button locks the unit in that direction', `(() => {
      const d = ${dragRes};
      const T = window.__game.fx.touch;
      return {
        dragAttackLocksTarget: d.locked === true && d.drags >= 1,
        dragAttackKeepsAttacking: d.held === true,
        dragLockSurvivesRelease: T.target === window.__game.enemy && T.attackHeld === false,
      };
    })()`);

    // Pursuit, as Mobile Legends / Honor of Kings / Wild Rift do it: holding attack
    // walks into range, the stick overrides it, and it never chases far.
    await block('target: close pursuit walks into range, the stick always wins', `(async () => {
      const g = window.__game, H = g.hero, E = g.enemy, T = g.fx.touch; const r = {};
      const I = H.intent;
      g.match.controller = g.controller; g.controller.enabled = true;
      H.abilities.resetAll(); H.hp = H.maxHp; H.mp = H.maxMp;
      E.alive = true; E.hp = E.maxHp;
      // Out of Kazane's 8 m range but inside the 5 m leash.
      H.teleport(0, 0); E.teleport(0, -11.5); T.target = E; T.attackHeld = true; T.jx = 0; T.jz = 0;
      const z0 = H.pos.z;
      for (let k = 0; k < 30; k++) g.step(0.05);
      r.pursuitWalksIntoRange = H.pos.z < z0 - 1.5 && T.pursuing === false && E.hp < E.maxHp;
      r.pursuitStopsInRange = Math.abs(H.pos.z - E.pos.z) <= H.attackRange + 0.01;
      // The stick overrides pursuit the same frame.
      T.jx = 1; T.jz = 0;
      const x0 = H.pos.x;
      for (let k = 0; k < 10; k++) g.step(0.05);
      r.stickOverridesPursuit = H.pos.x > x0 + 1 && T.pursuing === false;
      T.jx = 0; T.jz = 0;
      // Beyond the leash it refuses to chase.
      H.teleport(0, 0); E.teleport(0, -20); E.hp = E.maxHp;
      const z1 = H.pos.z;
      for (let k = 0; k < 20; k++) g.step(0.05);
      r.pursuitRespectsLeash = Math.abs(H.pos.z - z1) < 0.05;
      // ...and the pause-menu toggle turns it off entirely.
      T.setPursuit(false);
      H.teleport(0, 0); E.teleport(0, -11.5);
      for (let k = 0; k < 20; k++) g.step(0.05);
      r.pursuitToggleOff = Math.abs(H.pos.z) < 0.05;
      r.pursuitTogglePersists = localStorage.getItem('mobaDuel.pursuit') === '0';
      T.setPursuit(true); T.attackHeld = false; T.target = null;
      return r;
    })()`);
  } finally {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.clearDeviceMetricsOverride');
    await restart('hero=bayani&enemy=ren&lowfx=1');
  }
}
