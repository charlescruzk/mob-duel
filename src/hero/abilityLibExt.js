// Phase 2 extension resolvers (PHASE2.md §3.5): the shapes added after the original
// seven, and the projectile-hit wrapper that carries dtype and exec-scale damage.
// abilities.js dispatches here so abilityLib.js keeps only the launch shapes.
import * as lib from './abilityLib.js';

const EXEC_CAP = 2;

// Generic status buff (Quickdraw): applies def.buffKind for def.buffTime at
// def.buffPct via the normal strongest-wins status path, plus an auto-applied slow
// window on basic attacks while the buff lasts if the def carries one.
export function castBuff(hero, sys, def) {
  sys.applyStatus(def.buffKind, def.buffTime, def.buffPct);
  if (def.autoSlowPct) {
    sys.autoSlowPct = def.autoSlowPct;
    sys.autoSlowTime = def.autoSlowTime;
    sys.autoSlowTimer = def.buffTime;
  }
}

// Projectile hit shared by every skillshot. execScale (Deadeye) recomputes the raw
// damage from the target's missing-HP fraction at the moment of impact, capped ×2;
// p.dtype carries 'magic' (default) or 'physical'.
export function projectileHit(hero, sys, p, u) {
  let raw = p.damage;
  if (p.execScale && u.maxHp > 0) {
    let mult = 1 + (1 - u.hp / u.maxHp);
    if (mult > EXEC_CAP) mult = EXEC_CAP;
    raw = p.damage * mult;
  }
  return lib.abilityHit(hero, sys, u, raw, p.dtype);
}