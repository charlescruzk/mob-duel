// Hit stop is view-only: an ultimate hit slows the animator/particle clocks for 80 ms
// while the sim keeps its full dt (PHASE3.md §5).
export default async function ({ block, SETUP }) {
  await block('hit stop: view clock slows, sim clock does not', `(async () => {
    ${SETUP}
    const t0 = W.time;
    g.events.emit('abilityHit', { hero: H, unit: E, dealt: 10, slot: 'r' });
    g.step(0.02);
    r.hitStopSlowsView = g.fx.viewScale < 0.5 && g.fx.hitStop.timer > 0;
    r.hitStopKeepsSim = Math.abs((W.time - t0) - 0.02) < 1e-6;
    step(0.2);
    r.hitStopEnds = g.fx.viewScale === 1 && g.fx.hitStop.timer === 0;
    g.events.emit('abilityHit', { hero: H, unit: E, dealt: 10, slot: 'q' });
    g.step(0.02);
    r.hitStopOnlyOnUltimate = g.fx.viewScale === 1;
    return r;
  })()`);
}
