// Knockback displacement — extracted so a knocked unit moves even while stunned
// (the movement systems all gate on the CC timers; this runs before them). The
// velocity is stored, not re-derived, so no per-frame allocation happens here.
// Halvard's Charge uses it; the world's per-frame separation/wall step keeps the
// displaced unit inside the lane, so this needs no clamping of its own.

export function knockApply(unit, dirX, dirZ, dist, time) {
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len > 0) { dirX /= len; dirZ /= len; } else { dirX = dirZ = 0; }
  unit.knockDx = dirX;
  unit.knockDz = dirZ;
  unit.knockSpeed = time > 0 ? dist / time : 0;
  unit.knockTime = time;
}

export function knockTick(hero, dt) {
  if (hero.knockTime <= 0) return;
  // Cap the step at the knock's remaining distance: the final partial step must
  // not overshoot `dist` when the duration divides evenly into dt.
  let step = hero.knockSpeed * dt;
  const remain = hero.knockSpeed * hero.knockTime;
  if (step > remain) step = remain;
  if (step > 0) {
    hero.pos.x += hero.knockDx * step;
    hero.pos.z += hero.knockDz * step;
  }
  hero.knockTime -= dt;
  if (hero.knockTime <= 0) { hero.knockSpeed = 0; hero.knockTime = 0; }
}

export function knockClear(hero) {
  hero.knockSpeed = 0;
  hero.knockTime = 0;
}