// The nine item passives (PHASE2.md §4), one entry in hero.passives each. Called
// from the hit paths per the ARCHITECTURE file map: heroAttack.land → autoBonusDamage
// (pre-damage) + onAutoLand (post-damage); abilityLib.abilityHit → blockedBySpellShield
// (pre-damage) + onAbilityHit (post-damage). Runtime state lives in flat fields on the
// units, so nothing allocates per frame; initPassives() wires the clear-on-death /
// clear-on-respawn / arm-on-cast listeners and returns the per-frame updater.
import { events } from '../core/events.js';

const BURN_TIME = 2;
const CLEAVE_RADIUS = 2.0;
const CLEAVE_PCT = 0.30;
const REND_PCT = 0.04;
const SECOND_WIND_THRESHOLD = 0.30;
const SECOND_WIND_HEAL = 0.15;
const SECOND_WIND_TIME = 4;
const SECOND_WIND_CD = 60;
const TEMPO_EVERY = 3;
const TEMPO_BONUS = 40;
const EXECUTE_THRESHOLD = 0.40;
const EXECUTE_BONUS = 0.15;
const UNDERTOW_SLOW = 0.30;
const UNDERTOW_TIME = 1.0;
const FLOW_REFUND = 5;
const SPELL_SHIELD_CD = 40;

const hits = [];                       // world.enemiesInRadius out-array
const cleaveCentre = { x: 0, z: 0 };

export function hasPassive(unit, key) {
  const list = unit.passives;
  if (!list) return false;
  return list.indexOf(key) >= 0;
}

// Opportunist (Lilit hero passive): +20% autos and ability damage against slowed,
// rooted or stunned targets. Hero CC timers live on abilities; minion timers on the
// unit itself — same field names either way.
export function opportunistMult(attacker, target) {
  const p = attacker && attacker.data && attacker.data.passive;
  if (!p || p.kind !== 'opportunist') return 1;
  const a = target.abilities;
  const cc = a
    ? (a.stunTimer > 0 || a.rootTimer > 0 || a.slowTimer > 0)
    : (target.stunTimer > 0 || target.rootTimer > 0 || target.slowTimer > 0);
  return cc ? 1.2 : 1;
}

// Autos vs heroes below 40% HP: +15% of attack damage (added pre-mitigation).
export function autoBonusDamage(hero, u) {
  if (!hasPassive(hero, 'execute')) return 0;
  if (u.kind !== 'hero' || u.hp >= u.maxHp * EXECUTE_THRESHOLD) return 0;
  return hero.attackDamage * EXECUTE_BONUS;
}

// Post-auto passives: Burn, Cleave, Tempo, Undertow.
export function onAutoLand(hero, u) {
  const list = hero.passives;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    if (k === 'burn') {
      if (u.alive) { u.burnTimer = BURN_TIME; u.burnDps = (15 + 2 * hero.level) / BURN_TIME; u.burnSource = hero; }
    } else if (k === 'cleave') {
      cleave(hero, u);
    } else if (k === 'tempo') {
      hero.tempoCount = (hero.tempoCount || 0) + 1;
      if (hero.tempoCount % TEMPO_EVERY === 0 && u.alive) u.takeDamage(40, hero, 'magic');
    } else if (k === 'undertow' && hero.undertowArmed) {
      hero.undertowArmed = false;
      if (u.alive && typeof u.applyStatus === 'function') u.applyStatus('slow', UNDERTOW_TIME, UNDERTOW_SLOW);
    }
  }
}

// Post-ability passives: Rend (+4% target max HP magic) and Flow (5 MP back per hit).
export function onAbilityHit(hero, unit, dealt) {
  const list = hero.passives;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    if (k === 'rend') {
      if (unit.alive && dealt > 0) unit.takeDamage(unit.maxHp * REND_PCT, hero, 'magic');
    } else if (k === 'flow' && hero.alive && dealt > 0) {
      hero.mp += FLOW_REFUND;
      if (hero.mp > hero.maxMp) hero.mp = hero.maxMp;
    }
  }
}

// Blocks the first enemy-hero ability hit every 40 s. True means the hit is eaten.
export function blockedBySpellShield(source, unit) {
  if (!source || unit.kind !== 'hero' || unit.team === source.team) return false;
  if (!unit.shieldReady || !hasPassive(unit, 'spellShield')) return false;
  unit.shieldReady = false;
  unit.shieldCd = SPELL_SHIELD_CD;
  return true;
}

function cleave(hero, u) {
  const world = hero.world;
  if (!world || !u.alive || hero.data.ranged) return;   // melee autos only
  cleaveCentre.x = u.pos.x; cleaveCentre.z = u.pos.z;
  world.enemiesInRadius(cleaveCentre, hero.team, CLEAVE_RADIUS, hits);
  const dmg = hero.attackDamage * CLEAVE_PCT;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i] !== u) hits[i].takeDamage(dmg, hero, 'physical');
  }
  hits.length = 0;
}

// Per-frame: burn DoTs on any unit, spell-shield recharge and Second Wind on heroes.
// Called from match._live with the world.
function update(world, dt) {
  const list = world.units;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (u.burnTimer > 0) {
      u.burnTimer -= dt;
      if (u.burnTimer <= 0) { u.burnTimer = 0; u.burnDps = 0; }
      else if (u.alive) u.takeDamage(u.burnDps * dt, u.burnSource, 'magic');
    }
    if (u.kind !== 'hero' || !u.alive) continue;
    if (u.shieldCd > 0) {
      u.shieldCd -= dt;
      if (u.shieldCd <= 0) { u.shieldCd = 0; u.shieldReady = true; }
    }
    if (u.swCd > 0) { u.swCd -= dt; if (u.swCd <= 0) u.swCd = 0; }
    if (u.swTimer > 0) {
      u.swTimer -= dt;
      if (u.swTimer <= 0) u.swTimer = 0;
      else u.heal(u.maxHp * SECOND_WIND_HEAL / SECOND_WIND_TIME * dt);
    } else if (hasPassive(u, 'secondWind') && u.swCd <= 0 && u.hp < u.maxHp * SECOND_WIND_THRESHOLD) {
      u.swTimer = SECOND_WIND_TIME;
      u.swCd = SECOND_WIND_CD;
    }
  }
}

function clearUnit(u) {
  if (!u) return;
  u.burnTimer = 0; u.burnDps = 0; u.burnSource = null;
  if (u.kind !== 'hero') return;
  u.tempoCount = 0;
  u.undertowArmed = false;
  u.shieldReady = false; u.shieldCd = 0;
  u.swTimer = 0; u.swCd = 0;
}

// Attach once (from main.js). Listeners live for the page lifetime, like the systems.
export function initPassives() {
  events.on('unitDied', (p) => clearUnit(p.unit));
  events.on('heroRespawned', (p) => clearUnit(p.hero));
  events.on('abilityCast', (p) => {
    const h = p.hero;
    if (h && h.alive && hasPassive(h, 'undertow')) h.undertowArmed = true;
  });
  return {
    update,
    reset(world) {
      const list = world ? world.units : null;
      if (!list) return;
      for (let i = 0; i < list.length; i++) clearUnit(list[i]);
    },
  };
}