// Phase 2 extension resolvers (shapes the base abilityLib does not know): buffs
// (Quickdraw), projectile impact hooks (Deadeye exec-scale), stealth, targeted blink,
// cone and targeted strikes. All allocation-free: scratch objects at module level.
import * as lib from './abilityLib.js';
import { atLevel } from './heroData.js';
import { resolveCircleVsBoxes, clampToBounds } from '../core/physics.js';
import { effects } from './effects.js';

const EXEC_CAP = 2;
const STRIKE_WINDOW = 1.0;                     // Verdict refund: kill must land within 1 s
const BLINK_BEHIND = 1.2;
const VEIL_BONUS_TIME = 3.0;   // how long the first-attack-after-Veil bonus waits
const pt = { x: 0, z: 0 };
const cdir = { x: 0, z: 0 };
const scratch = { x: 0, z: 0 };   // zone centre for enemiesInRadius
const zoneHits = [];              // shared out-array for the zone tick
const COLOR_DAMAGE = 0xffa040;
const COLOR_BLINK = 0x9fd6ff;
const COLOR_STEALTH = 0x9f6bd6;
const COLOR_HEAL = 0x60e0a0;

export function castBuff(hero, sys, def) {
  sys.applyStatus(def.buffKind, def.buffTime, def.buffPct);
  if (def.reflectPct) sys.applyStatus('reflect', def.buffTime, def.reflectPct);
  if (def.autoSlowPct) {
    sys.autoSlowPct = def.autoSlowPct;
    sys.autoSlowTime = def.autoSlowTime;
    sys.autoSlowTimer = def.buffTime;
  }
}

// Projectile impact with Deadeye's exec scale: the bonus reads the target's missing
// HP at impact, capped at x2. Tidal Snare roots on a landed hit only.
export function projectileHit(hero, sys, p, u) {
  let raw = p.damage;
  if (p.execScale && u.maxHp > 0) {
    let mult = 1 + (1 - u.hp / u.maxHp);
    if (mult > EXEC_CAP) mult = EXEC_CAP;
    raw = p.damage * mult;
  }
  const dealt = lib.abilityHit(hero, sys, u, raw, p.dtype);
  if (p.root && dealt > 0) lib.applyStatusTo(u, 'root', p.root, 1);
  return dealt;
}

// Mend: instant heal plus a heal-over-time the AbilitySystem ticks (cleared with the
// other statuses on death/reset).
export function castHeal(hero, sys, def) {
  hero.heal(atLevel(def.heal, hero.level));
  sys.hot.rate = atLevel(def.hotRate, hero.level);
  sys.hot.timer = def.hotTime;
  effects.spawnRing(hero.pos, 0.8, 0.3, COLOR_HEAL);
}

// The enemy unit nearest the reticle point within def.range of it (heroes and
// minions; statics are excluded — abilities never damage them). Null if none.
export function pickTargeted(hero, def, aimX, aimZ) {
  const world = hero.world;
  if (!world) return null;
  const list = world.units;
  const r2 = def.range * def.range;
  let best = null;
  let bestD2 = r2;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u.alive || u.invulnerable || u.team === hero.team || u.isStatic) continue;
    if (u.kind === 'hero' && u.stealthed) continue;
    const dx = u.pos.x - aimX;
    const dz = u.pos.z - aimZ;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = u; }
  }
  return best;
}

// Kesh Q: appear `blinkBehind` behind the target along its facing, face it, strike.
export function castTargetedBlink(hero, sys, def, aimX, aimZ) {
  const t = pickTargeted(hero, def, aimX, aimZ);
  if (!t) return false;
  pt.x = t.pos.x + Math.sin(t.facing) * BLINK_BEHIND;
  pt.z = t.pos.z + Math.cos(t.facing) * BLINK_BEHIND;
  const world = hero.world;
  if (world) {
    if (world.bounds) clampToBounds(pt, hero.radius, world.bounds);
    if (world.boxes.length) resolveCircleVsBoxes(pt, hero.radius, world.boxes);
    lib.pushOutOfStatics(pt, hero.radius, world);
  }
  effects.spawnRing(hero.pos, 0.8, 0.3, COLOR_STEALTH);
  hero.teleport(pt.x, pt.z);
  effects.spawnRing(hero.pos, 0.8, 0.3, COLOR_STEALTH);
  lib.faceDir(hero, t.pos.x - pt.x, t.pos.z - pt.z);
  lib.abilityHit(hero, sys, t, lib.scaledDamage(hero, def));
  return true;
}

// Kesh W: stealth self-status; the haste rides on the stealth timer (speedMult).
export function castStealth(hero, sys, def) {
  sys.stealthHaste = def.stealthHaste || 0;
  sys.applyStatus('stealth', def.duration, 1);
  effects.spawnRing(hero.pos, 0.8, 0.3, COLOR_STEALTH);
}

// Leaving stealth — expiry, attack or cast — arms the first-attack veil bonus
// through the existing bonusNextAuto path.
export function endStealth(sys, hero) {
  sys.stealthTimer = 0;
  sys.stealthHaste = 0;
  const v = sys.data.abilities.w;
  if (sys.data.passive.kind === 'opportunist' && v.veilBonus) {
    sys.applyStatus('bonusNextAuto', VEIL_BONUS_TIME, atLevel(v.veilBonus, hero.level));
  }
}

// Kesh E: 60° cone, 4.5 m — angle-and-distance test straight over world.units.
export function castCone(hero, sys, def, aimX, aimZ) {
  lib.aimDir(hero, aimX, aimZ, cdir);
  lib.faceDir(hero, cdir.x, cdir.z);
  const world = hero.world;
  if (!world) return 0;
  const list = world.units;
  const dmg = lib.scaledDamage(hero, def);
  const cos = Math.cos((def.arc || 60) * Math.PI / 360);
  let struck = 0;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u.alive || u.invulnerable || u.team === hero.team || u.isStatic) continue;
    const dx = u.pos.x - hero.pos.x;
    const dz = u.pos.z - hero.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > def.range || d < 1e-6) continue;
    if ((dx * cdir.x + dz * cdir.z) / d < cos) continue;
    lib.abilityHit(hero, sys, u, dmg);
    if (def.slowPct) lib.applyStatusTo(u, 'slow', def.slowTime, def.slowPct);
    struck++;
  }
  effects.spawnRing(hero.pos, def.range * 0.4, 0.3, COLOR_DAMAGE);
  return struck;
}

// Kesh R: targeted strike, doubled below the exec threshold; a hero kill inside the
// strike window refunds half the cooldown (refund fires from the unitDied listener).
export function castTargeted(hero, sys, def, aimX, aimZ) {
  const t = pickTargeted(hero, def, aimX, aimZ);
  if (!t) return false;
  let dmg = lib.scaledDamage(hero, def);
  if (t.maxHp > 0 && t.hp / t.maxHp < def.execThreshold) dmg *= 2;
  lib.faceDir(hero, t.pos.x - hero.pos.x, t.pos.z - hero.pos.z);
  sys.strikeUnit = t;
  sys.strikeUntil = hero.world ? hero.world.time + STRIKE_WINDOW : 0;
  lib.abilityHit(hero, sys, t, dmg);
  // Shield Bash's stun rides the same targeted resolver (after the hit so the stun
  // itself never boosts the strike's Opportunist window).
  if (def.stunTime) lib.applyStatusTo(t, 'stun', def.stunTime, 1);
  effects.spawnRing(t.pos, 1.5, 0.3, COLOR_DAMAGE);
  return true;
}

// --- ground zones (Earthbreaker's slow field; Deluge reuses these) -------------

// Start a zone under the hero (Earthbreaker) or at (x, z) (Deluge). The sim timer on
// sys.zone is authoritative; the disc's fade in effects is cosmetic.
export function startZone(hero, sys, zdef, x, z) {
  const zn = sys.zone;
  zn.active = true;
  zn.timer = zdef.duration;
  zn.x = x; zn.z = z;
  zn.def = zdef;
  zn.acc = 0;
  zn.rec = effects.spawnZone(hero.pos, zdef.radius, zdef.duration, zdef.color || 0xffffff);
  // spawnZone reads the mesh position from the passed object; set it exactly.
  if (zn.rec) { zn.rec.mesh.position.x = x; zn.rec.mesh.position.z = z; }
}

export function endZone(sys) {
  const zn = sys.zone;
  if (zn.rec) { zn.rec.active = false; zn.rec.mesh.visible = false; zn.rec = null; }
  zn.active = false;
  zn.timer = 0;
  zn.def = null;
}

// Per-frame zone tick: the slow reapplies each frame with a short duration so units
// entering later are slowed too; an optional tick damage uses `acc` against
// def.tickInterval. A healPct zone (Deluge) heals the caster while inside.
export function tickZone(hero, sys, dt) {
  const zn = sys.zone;
  zn.timer -= dt;
  if (zn.timer <= 0) { endZone(sys); return; }
  const def = zn.def;
  if (!def) return;
  const world = hero.world;
  if (!world) return;
  scratch.x = zn.x; scratch.z = zn.z;
  world.enemiesInRadius(scratch, hero.team, def.radius, zoneHits);
  for (let i = 0; i < zoneHits.length; i++) {
    const u = zoneHits[i];
    if (u.kind === 'tower' || u.kind === 'nexus') continue;
    if (def.slowPct) lib.applyStatusTo(u, 'slow', def.slowTime || 0.5, def.slowPct);
    if (def.tickInterval) {
      zn.acc += dt;
      if (zn.acc >= def.tickInterval) {
        zn.acc = 0;
        lib.abilityHit(hero, sys, u, atLevel(def.tickDamage, hero.level) * (1 + hero.abilityAmp));
      }
    }
  }
  zoneHits.length = 0;
  if (def.healPct) {
    const dx = hero.pos.x - zn.x;
    const dz = hero.pos.z - zn.z;
    if (dx * dx + dz * dz <= def.radius * def.radius) {
      hero.heal(def.healPct * hero.maxHp * dt);
    }
  }
}