// Pooled minions: a dead minion stays in the world with its mesh hidden after the
// death sink, and a later wave reuses it in place (no 'unitAdded' fires) — so the
// view has to bring the mesh back itself, or creeps vanish mid-match.
export default async function ({ block, SETUP }) {
  await block('units: a minion reused from the pool comes back visible', `(async () => {
    ${SETUP}
    step(24);                                    // wave 1 at 15 s, fully staggered out by 22 s
    const pool = g.waves.pool;
    r.waveSpawned = pool.length === 10 && pool.every((m) => m.mesh && m.mesh.visible);
    const victim = pool.find((m) => m.alive && m.team === 'blue');
    victim.takeDamage(1e9, H, 'true');
    r.deadMinionStaysForTheFall = victim.alive === false && !!victim.world && victim.mesh.visible === true;
    step(4);                                     // fall, then sink: the animator hides it
    r.deadMinionHidden = victim.mesh.visible === false;
    // Exactly what WaveSpawner._spawn does with a pooled corpse.
    victim.reset({ x: victim.slotX, y: 0, z: 38.5 }, 1);
    if (!victim.world) W.add(victim);
    r.reuseStartsHidden = victim.alive === true && victim.mesh.visible === false;
    step(0.2);
    r.reusedMinionVisible = victim.mesh.visible === true;
    r.reusedMinionPoseReset = !victim.rig || victim.rig.deadT === 0;
    return r;
  })()`);
}
