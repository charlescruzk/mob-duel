// Mobile (PHASE3.md §6): phone emulation, touch joystick, look drag, skill taps with
// assisted aim, manual aim drag, no pointer lock, layout fits, portrait prompt.
export default async function ({ block, restart, send, sleep }) {
  const touch = async (type, x, y, id = 1) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id }] });
  const drag = async (x0, y0, x1, y1, steps = 6, id = 1) => {
    await touch('touchStart', x0, y0, id);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, id); await sleep(16); }
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await restart('hero=bayani&enemy=ren');          // no lowfx param: the phone tier must pick it
    // A first touch anywhere activates the touch layer (desktop mice never do).
    await touch('touchStart', 700, 100); await touch('touchEnd', 700, 100);
    await sleep(100);
    const centre = (id) => `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    const q = (await send('Runtime.evaluate', { expression: centre('tb-q'), returnByValue: true })).result.value;
    const atk = (await send('Runtime.evaluate', { expression: centre('tb-atk'), returnByValue: true })).result.value;
    await send('Runtime.evaluate', { expression: "const g = window.__game; g.paused = true; g.match.controller = g.controller; g.controller.enabled = true; g.match.bot = null; g.match.skipCountdown(); 'ready'" });
    // Joystick: press in the left zone, push up = walk toward camera forward.
    await drag(150, 300, 150, 230);
    await send('Runtime.evaluate', { expression: "window.__game.step(0.05); window.__game.step(0.05); 'stepped'" });
    await sleep(30);
    await block('mobile: touch layer, joystick, look, skills, aim, lock, layout', `(async () => {
      const g = window.__game; const H = g.hero, E = g.enemy, W = g.world, I = g.hero.intent; const r = {};
      const T = g.fx.touch;
      r.phoneDefaultsLowfx = !g.engine.look.composer;
      r.touchActiveOnTouchDevice = T.active === true && document.body.classList.contains('touch');
      r.touchJoystickMoves = I.moveZ < -0.7 && Math.abs(I.moveX) < 0.3;
      const z0 = H.pos.z; for (let k = 0; k < 20; k++) g.step(0.05);
      r.joystickWalksHero = H.pos.z < z0 - 3;
      window.__t = { z0 };
      return r;
    })()`);
    await touch('touchEnd', 150, 230);
    // Look drag in the right zone (not on a button): yaw changes.
    await drag(560, 120, 640, 120, 6, 2);
    await send('Runtime.evaluate', { expression: "window.__t.yaw0 = window.__game.camera.yaw; window.__game.step(0.05); window.__t.yaw1 = window.__game.camera.yaw; 'ok'" });
    await touch('touchEnd', 640, 120, 2);
    // Skill tap: Q on Bayani is a self-circle; the edge must reach the sim.
    await send('Runtime.evaluate', { expression: "(() => { const g = window.__game; g.hero.abilities.resetAll(); g.hero.mp = g.hero.maxMp; return 'fresh'; })()" });
    await touch('touchStart', q.x, q.y, 3); await sleep(20); await touch('touchEnd', q.x, q.y, 3);
    await send('Runtime.evaluate', { expression: "window.__game.step(0.05); window.__game.step(0.05); window.__t.qcd = window.__game.hero.cooldowns.q; window.__t.casts = window.__game.fx.touch.stats.casts; 'ok'" });
    // Attack hold with assisted aim: put the enemy 1.5 m ahead and hold the button.
    await send('Runtime.evaluate', { expression: "(() => { const g = window.__game; g.enemy.teleport(g.hero.pos.x + 1.2, g.hero.pos.z - 1.2); g.enemy.hp = g.enemy.maxHp; return 'placed'; })()" });
    await touch('touchStart', atk.x, atk.y, 4);
    await send('Runtime.evaluate', { expression: "for (let k = 0; k < 30; k++) window.__game.step(0.05); 'ok'" });
    await touch('touchEnd', atk.x, atk.y, 4);
    // Manual aim: press E (a dash on Bayani) and drag away, release → cast toward the drag.
    const e = (await send('Runtime.evaluate', { expression: centre('tb-e'), returnByValue: true })).result.value;
    await send('Runtime.evaluate', { expression: "(() => { const g = window.__game; g.hero.abilities.resetAll(); g.hero.mp = g.hero.maxMp; g.hero.teleport(0, 10); g.enemy.teleport(5, -20); window.__t.ex0 = g.hero.pos.x; return 'fresh'; })()" });
    await drag(e.x, e.y, e.x - 60, e.y, 6, 5);
    await send('Runtime.evaluate', { expression: "window.__game.fx.touch.update(0.016); window.__t.aimShown = window.__game.fx.touch.aimIndicator.mesh.visible; 'ok'" });
    await touch('touchEnd', e.x - 60, e.y, 5);
    await send('Runtime.evaluate', { expression: "for (let k = 0; k < 12; k++) window.__game.step(0.05); 'ok'" });
    await block('mobile: results', `(async () => {
      const g = window.__game; const H = g.hero, E = g.enemy; const r = {}; const t = window.__t; const T = g.fx.touch;
      r.touchLookOrbits = Math.abs(t.yaw1 - t.yaw0) > 0.02;
      r.touchAbilityCasts = t.qcd > 0 && t.casts >= 1;   // recorded before the later resetAll()
      r.assistedAimFacesEnemy = E.hp < E.maxHp;
      r.manualAimDragCasts = T.stats.manualCasts >= 1 && t.aimShown === true && H.pos.x < t.ex0 - 1;   // dragged left = -X for yaw 0
      // No pointer lock on touch: dropping the (stubbed) lock changes nothing.
      document.exitPointerLock();
      await new Promise((res) => setTimeout(res, 20));
      const z1 = H.pos.z; H.intent.moveZ = 0;
      r.noPointerLockOnTouch = g.controller.enabled === true && !document.pointerLockElement && document.getElementById('start-overlay').classList.contains('hidden');
      // Layout: every control inside the viewport, no horizontal scroll, centre clear.
      const vw = window.innerWidth, vh = window.innerHeight;
      let inside = true, centreClear = true;
      document.querySelectorAll('#touch-ui .tb').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1) inside = false;
        if (b.right > vw * 0.3 && b.left < vw * 0.7 && b.bottom > vh * 0.25 && b.top < vh * 0.75) centreClear = false;
      });
      r.hudFitsPhone = inside && document.documentElement.scrollWidth <= vw;
      r.playAreaClear = centreClear;
      const dom = document.querySelectorAll('*').length;
      for (let k = 0; k < 200; k++) { g.step(0.05); }
      r.touchNoAllocation = document.querySelectorAll('*').length === dom;
      return r;
    })()`);
    // Portrait: the rotate prompt shows; landscape hides it.
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    await sleep(150);
    await block('mobile: rotate prompt only in portrait', `(async () => {
      const r = {};
      window.dispatchEvent(new Event('resize'));
      await new Promise((res) => setTimeout(res, 30));
      const p = document.getElementById('rotate-prompt');
      r.rotatePromptInPortrait = !!p && getComputedStyle(p).display !== 'none' && document.body.classList.contains('portrait');
      return r;
    })()`);
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
    await sleep(150);
    await block('mobile: rotate prompt hidden in landscape', `(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((res) => setTimeout(res, 30));
      const p = document.getElementById('rotate-prompt');
      return { rotatePromptHiddenInLandscape: !!p && getComputedStyle(p).display === 'none' };
    })()`);
  } finally {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.clearDeviceMetricsOverride');
    await restart('hero=bayani&enemy=ren&lowfx=1');
  }
}
