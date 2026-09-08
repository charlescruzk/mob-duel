// Concrete ability resolvers, one per shape (DESIGN.md §3.3/§3.4). Every function is
// allocation-free: module-level scratch objects and one shared out-array. Abilities
// never damage towers/nexuses — abilityHit filters them. `sys` is the caller's
// AbilitySystem (cooldowns, statuses, marks, dash/field state).
import { resolveCircleVsBoxes, clampToBounds } from '../core/physics.js';
import { TEAM_COLOR } from '../map/laneData.js';
import { atLevel } from './heroData.js';
import { effects } from './effects.js';

const hits = [];                       // world.enemiesInRadius out-array
const dir = { x: 0, z: 0 };
const centre = { x: 0, z: 0 };
const pt = { x: 0, y: 0, z: 0 };       // blink target; physics helpers only touch x/z
const COLOR_DAMAGE = 0xffa040;
const COLOR_TELEGRAPH = 0xff5030;
const COLOR_BLINK = 0x9fd6ff;
const COLOR_SHIELD = 0xffe680;

export function scaledDamage(hero, def) {
  return atLevel(def.damage, hero.level) * (1 + hero.abilityAmp);
}

// Unit direction from the hero toward (aimX, aimZ) into `out`; returns the distance.
// A reticle sitting on the hero falls back to the hero's facing.
export function aimDir(hero, aimX, aimZ, out) {
  const dx = aimX - hero.pos.x;
  const dz = aimZ - hero.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-4) { out.x = -Math.sin(hero.facing); out.z = -Math.cos(hero.facing); return 0; }
  out.x = dx / d; out.z = dz / d;
  return d;
}

export function faceDir(hero, dx, dz) { hero.facing = Math.atan2(-dx, -dz); }

// Minions/heroes may implement applyStatus(kind, seconds, magnitude); statics don't.
export function applyStatusTo(unit, kind, seconds, magnitude) {
  if (typeof unit.applyStatus === 'function') unit.applyStatus(kind, seconds, magnitude);
}

// One ability damage instance. Returns HP dealt. Marks the target for Ilyra's passive.
export function abilityHit(hero, sys, unit, raw) {
  if (!unit.alive || unit.invulnerable || unit.kind === 'tower' || unit.kind === 'nexus') return 0;
  const dealt = unit.takeDamage(raw, hero, 'magic');
  if (sys.marksEnabled && unit.alive) sys.markUnit(unit);
  return dealt;
}

// Circle at (cx, cz): damage + optional slow/stun from `def`. Centre-distance test.
export function aoeDamage(hero, sys, def, cx, cz) {
  const world = hero.world;
  if (!world) return 0;
  centre.x = cx; centre.z = cz;
  world.enemiesInRadius(centre, hero.team, def.radius, hits);
  const dmg = scaledDamage(hero, def);
  let struck = 0;
  for (let i = 0; i < hits.length; i++) {
    const u = hits[i];
    if (u.kind === 'tower' || u.kind === 'nexus') continue;
    abilityHit(hero, sys, u, dmg);
    if (def.slowPct) applyStatusTo(u, 'slow', def.slowTime, def.slowPct);
    if (def.stunTime) applyStatusTo(u, 'stun', def.stunTime, 1);
    struck++;
  }
  hits.length = 0;
  effects.spawnRing(centre, def.radius, 0.35, COLOR_DAMAGE);
  return struck;
}

// --- Brakk ------------------------------------------------------------------

export function castSelfAoe(hero, sys, def) {
  return aoeDamage(hero, sys, def, hero.pos.x, hero.pos.z);
}

export function castShield(hero, sys, def) {
  hero.shield = atLevel(def.shield, hero.level);     // recast refreshes, never stacks
  sys.shieldTimer = def.duration;
  effects.spawnRing(hero.pos, 1.0, 0.4, COLOR_SHIELD);
}

export function startDash(hero, sys, def, aimX, aimZ) {
  let d = aimDir(hero, aimX, aimZ, dir);
  if (d < def.minDist) d = def.minDist;
  if (d > def.maxDist) d = def.maxDist;
  const ds = sys.dash;
  ds.active = true;
  ds.dx = dir.x; ds.dz = dir.z;
  ds.remaining = d;
  ds.def = def;
  faceDir(hero, dir.x, dir.z);
}

// Push a circle out of alive static units (tower/nexus). True if it touched one.
export function pushOutOfStatics(pos, radius, world) {
  let touched = false;
  const list = world.units;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u.isStatic || !u.alive) continue;
    let dx = pos.x - u.pos.x;
    let dz = pos.z - u.pos.z;
    const minD = radius + u.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD) continue;
    touched = true;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
    pos.x = u.pos.x + (dx / d) * minD;
    pos.z = u.pos.z + (dz / d) * minD;
  }
  return touched;
}

// Advances an active dash; walls, lane edge and statics stop it early. Returns true
// on the frame it lands (the landing AoE has then been applied).
export function stepDash(hero, sys, world, dt) {
  const ds = sys.dash;
  let step = ds.def.speed * dt;
  if (step > ds.remaining) step = ds.remaining;
  hero.pos.x += ds.dx * step;
  hero.pos.z += ds.dz * step;
  ds.remaining -= step;
  let stop = ds.remaining <= 1e-6;
  if (world) {
    if (world.boxes.length && resolveCircleVsBoxes(hero.pos, hero.radius, world.boxes)) stop = true;
    if (world.bounds && clampToBounds(hero.pos, hero.radius, world.bounds)) stop = true;
    if (pushOutOfStatics(hero.pos, hero.radius, world)) stop = true;
  }
  if (!stop) return false;
  ds.active = false;
  aoeDamage(hero, sys, ds.def, hero.pos.x, hero.pos.z);
  return true;
}

export function castAoeStun(hero, sys, def) {
  return aoeDamage(hero, sys, def, hero.pos.x, hero.pos.z);
}

// --- Ilyra ------------------------------------------------------------------

export function castSkillshot(hero, sys, def, aimX, aimZ) {
  aimDir(hero, aimX, aimZ, dir);
  faceDir(hero, dir.x, dir.z);
  const p = effects.spawnProjectile(hero.pos, dir, def.speed, def.range, def.radius,
    sys.onProjectileHit, hero.team, TEAM_COLOR[hero.team]);
  if (!p) return false;
  p.owner = hero;
  p.pierce = !!def.pierce;
  p.slot = def.slot;
  p.damage = scaledDamage(hero, def);
  p.dtype = 'magic';
  return true;
}

// Telegraph at the reticle clamped to range; lands after def.telegraph seconds.
export function startField(hero, sys, def, aimX, aimZ) {
  let d = aimDir(hero, aimX, aimZ, dir);
  if (d > def.range) d = def.range;
  const f = sys.field;
  f.active = true;
  f.timer = def.telegraph;
  f.x = hero.pos.x + dir.x * d;
  f.z = hero.pos.z + dir.z * d;
  f.def = def;
  faceDir(hero, dir.x, dir.z);
  centre.x = f.x; centre.z = f.z;
  effects.spawnRing(centre, def.radius, def.telegraph, COLOR_TELEGRAPH);
}

export function landField(hero, sys, def, x, z) {
  return aoeDamage(hero, sys, def, x, z);
}

export function castBlink(hero, sys, def, aimX, aimZ, world) {
  aimDir(hero, aimX, aimZ, dir);
  pt.x = hero.pos.x + dir.x * def.distance;
  pt.z = hero.pos.z + dir.z * def.distance;
  if (world) {
    if (world.bounds) clampToBounds(pt, hero.radius, world.bounds);
    if (world.boxes.length) resolveCircleVsBoxes(pt, hero.radius, world.boxes);
    pushOutOfStatics(pt, hero.radius, world);
  }
  effects.spawnRing(hero.pos, 0.8, 0.3, COLOR_BLINK);
  hero.teleport(pt.x, pt.z);
  effects.spawnRing(hero.pos, 0.8, 0.3, COLOR_BLINK);
  faceDir(hero, dir.x, dir.z);
  sys.applyStatus('haste', def.hasteTime, def.hastePct);
}

// Second stage of a wind-up ability (R on both heroes).
export function resolveWindup(hero, sys, def, aimX, aimZ) {
  if (def.resolve === 'aoeStun') return castAoeStun(hero, sys, def);
  if (def.resolve === 'skillshot') return castSkillshot(hero, sys, def, aimX, aimZ);
  return false;
}
