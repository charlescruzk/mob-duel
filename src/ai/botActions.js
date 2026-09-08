// Per-state intent writers for HeroBot (DESIGN.md §9). Every function receives the
// bot (`b`, already sensed this tick) and the intent to fill. No allocation: aim and
// move helpers write straight into the intent; scratch lists live on the bot.
import { ITEMS, INVENTORY_SLOTS, countItem } from '../economy/items.js';
import { abilityReady, abilityDamage, lineBlocked, REACTION_DELAY } from './botSense.js';

const AIM_MAX = 11.0;           // contract: reticle ≤ 12 m — leaves 1 m for drift between ticks
const AIM_ERR_RAD = 7 * Math.PI / 180;
const AOE_ERR = 0.8;
const LEAD = 0.25;
const LAST_HIT = 0.9;
const FLIGHT = 0.35;

// Item indices into ITEMS (intent.buy order): swiftsoles 2, oxbelt 4, wardenplate 14,
// whetstone 9, ironring 3 for the bruiser; sapphirebead 6, aether 11, stormglass 15,
// voidlens 18 for the mage. Full build-priority work arrives with the bot rework.
const PRIORITY = { brakk: [2, 4, 14, 9, 3], ilyra: [2, 6, 11, 15, 18] };
const need = [0, 0, 0, 0];

function ad(hero) { return hero.attackDamage || 62; }
function range(hero) { return typeof hero.attackRange === 'number' ? hero.attackRange : 2.0; }
function isRangedMinion(u) { return !!(u.ranged || u.isRanged || (u.attackRange || 0) > 3); }

// --- intent primitives -------------------------------------------------------

export function moveTo(b, intent, tx, tz, stop) {
  const dx = tx - b.hero.pos.x, dz = tz - b.hero.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= stop || d < 1e-6) { intent.moveX = 0; intent.moveZ = 0; return false; }
  intent.moveX = dx / d; intent.moveZ = dz / d;
  return true;
}

export function aimAt(b, intent, tx, tz) {
  const hx = b.hero.pos.x, hz = b.hero.pos.z;
  let dx = tx - hx, dz = tz - hz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > AIM_MAX) { dx *= AIM_MAX / d; dz *= AIM_MAX / d; }
  intent.aimX = hx + dx; intent.aimZ = hz + dz;
}

// Skillshot: direction rotated by a random angle inside a cone that tightens with
// time on target (1.6× the 7° base when fresh, 0.6× after 3 s) — beatable by strafing.
export function aimSkillshot(b, intent, tx, tz) {
  const hx = b.hero.pos.x, hz = b.hero.pos.z;
  const dx = tx - hx, dz = tz - hz;
  let d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) { aimAt(b, intent, tx, tz); return; }
  const err = (b.world.random() * 2 - 1) * AIM_ERR_RAD * b.coneScale;
  const c = Math.cos(err), s = Math.sin(err);
  const rx = dx * c - dz * s, rz = dx * s + dz * c;
  if (d > AIM_MAX) d = AIM_MAX;
  const k = d / Math.sqrt(rx * rx + rz * rz);
  intent.aimX = hx + rx * k; intent.aimZ = hz + rz * k;
}

// Ground AoE: landing point offset by a uniform point in a disc of r 0.8 × cone scale.
export function aimAoe(b, intent, tx, tz) {
  const r = AOE_ERR * b.coneScale * Math.sqrt(b.world.random());
  const a = b.world.random() * Math.PI * 2;
  aimAt(b, intent, tx + Math.cos(a) * r, tz + Math.sin(a) * r);
}

// Raise a cast flag: never on the tick a state was entered, never two ticks in a row
// (the hero edge-detects), only when the hero could actually cast.
export function cast(b, intent, slot) {
  if (b.stateAge < REACTION_DELAY) return false;
  if (b.prevFlags[slot]) return false;
  if (!abilityReady(b.kit, slot, b.hero)) return false;
  intent[slot] = true;
  return true;
}

// --- shared sub-behaviours ---------------------------------------------------

// Expected HP/s an enemy minion is losing to the bot's wave and tower (approximate:
// nearby allied melee 12/s, ranged 15/s, own tower ~158/s) — used for the ranged
// last-hit flight compensation.
function lossRate(b, m) {
  let rate = 0;
  const allies = b.allies;
  for (let i = 0; i < allies.length; i++) {
    const a = allies[i];
    const dx = a.pos.x - m.pos.x, dz = a.pos.z - m.pos.z;
    const d2 = dx * dx + dz * dz;
    if (isRangedMinion(a)) { if (d2 <= 6.5 * 6.5) rate += 15; }
    else if (d2 <= 2.0 * 2.0) rate += 12;
  }
  if (b.ownTowerAlive && b.inOwnTowerRange(m.pos)) rate += 158;
  return rate;
}

// Lowest-HP enemy minion within attack range (+walkIn) that the last-hit rule allows.
function pickLastHit(b, walkIn) {
  const hero = b.hero;
  const maxD = range(hero) + walkIn;
  const thr = ad(hero) * LAST_HIT;
  let best = null, bestHp = Infinity;
  const list = b.enemies;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const dx = m.pos.x - hero.pos.x, dz = m.pos.z - hero.pos.z;
    if (dx * dx + dz * dz > maxD * maxD) continue;
    const loss = b.kit.melee ? 0 : FLIGHT * lossRate(b, m);
    if (m.hp - loss > thr || m.hp >= bestHp) continue;
    bestHp = m.hp; best = m;
  }
  return best;
}

function nearestEnemyMinion(b, maxD) {
  let best = null, bestD2 = maxD * maxD;
  const list = b.enemies;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const dx = m.pos.x - b.hero.pos.x, dz = m.pos.z - b.hero.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD2) { bestD2 = d2; best = m; }
  }
  return best;
}

// Attack a unit: aim at it; walk in if it is out of range (statics use edge distance).
function attackUnit(b, intent, u) {
  const r = range(b.hero) + (u.isStatic ? u.radius : 0);
  const dx = u.pos.x - b.hero.pos.x, dz = u.pos.z - b.hero.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  aimAt(b, intent, u.pos.x, u.pos.z);
  intent.attack = true;
  if (d > r) moveTo(b, intent, u.pos.x, u.pos.z, r * 0.9);
}

// Attack the player using only the delayed snapshot (never the live unit).
function attackPlayer(b, intent, lx, lz) {
  const r = range(b.hero);
  const dx = lx - b.hero.pos.x, dz = lz - b.hero.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  aimAt(b, intent, lx, lz);
  intent.attack = true;
  if (d > r) moveTo(b, intent, lx, lz, r * 0.9);
  else { intent.moveX = 0; intent.moveZ = 0; }
}

// Wave-clear casts: Brakk Q on ≥2 minions inside 3 m that Q kills; Ilyra W on ≥3
// inside a 2.5 m circle (groupMin overrides that count for PUSH).
function waveCast(b, intent, groupMin) {
  const kit = b.kit, hero = b.hero, list = b.enemies;
  if (kit.melee) {
    if (!abilityReady(kit, 'q', hero)) return false;
    const dmg = abilityDamage(kit, 'q', hero);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const dx = m.pos.x - hero.pos.x, dz = m.pos.z - hero.pos.z;
      if (dx * dx + dz * dz <= 9 && m.hp <= dmg) n++;
    }
    return n >= groupMin && cast(b, intent, 'q');
  }
  if (!abilityReady(kit, 'w', hero)) return false;
  const dmg = abilityDamage(kit, 'w', hero);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const cx = c.pos.x - hero.pos.x, cz = c.pos.z - hero.pos.z;
    if (cx * cx + cz * cz > 64) continue;
    let n = 0;
    for (let j = 0; j < list.length; j++) {
      const m = list[j];
      const dx = m.pos.x - c.pos.x, dz = m.pos.z - c.pos.z;
      if (dx * dx + dz * dz <= 6.25 && (groupMin < 3 || m.hp <= dmg)) n++;
    }
    if (n >= groupMin) {
      aimAoe(b, intent, c.pos.x, c.pos.z);
      return cast(b, intent, 'w');
    }
  }
  return false;
}

// Next priority-list item the bot can afford and does not yet own; -1 when none.
export function nextBuy(b) {
  const hero = b.hero;
  if (!hero.items || hero.items.length >= INVENTORY_SLOTS) return -1;
  const list = PRIORITY[b.kit.melee ? 'brakk' : 'ilyra'];
  need[0] = 0; need[1] = 0; need[2] = 0; need[3] = 0;
  for (let i = 0; i < list.length; i++) {
    const idx = list[i];
    need[idx]++;
    if (countItem(hero, ITEMS[idx]) >= need[idx]) continue;
    if ((hero.gold || 0) >= ITEMS[idx].cost) return idx;
  }
  return -1;
}

// --- states ------------------------------------------------------------------

export function actRetreat(b, intent) {
  moveTo(b, intent, b.safe.x, b.safe.z, 0.5);
  intent.attack = false;
  if (b.playerDist <= 4.0 && abilityReady(b.kit, 'e', b.hero)) {
    aimAt(b, intent, b.safe.x, b.safe.z);
    cast(b, intent, 'e');
  }
  if (b.kit.melee && b.hpPct < 0.5) cast(b, intent, 'w');
}

export function actRecall(b, intent) {
  intent.moveX = 0; intent.moveZ = 0; intent.attack = false;
  if (!b.hero.isRecalling && !b.prevFlags.recall) intent.recall = true;
}

export function actShop(b, intent) {
  intent.moveX = 0; intent.moveZ = 0; intent.attack = false;
  if (b.prevBuy !== -1) return;          // pulse: the shop wants a -1 between buys
  intent.buy = nextBuy(b);
}

export function actPush(b, intent) {
  const m = nearestEnemyMinion(b, range(b.hero) + 1.0);
  waveCast(b, intent, 2);
  if (m) { attackUnit(b, intent, m); return; }
  const t = b.pushTarget;
  const clear = b.enemiesNearEnemyTower === 0;
  if (t && clear && b.alliesInEnemyTower >= 1) { attackUnit(b, intent, t); return; }
  intent.attack = false;
  moveTo(b, intent, b.push.x, b.push.z, 0.5);
}

export function actFarm(b, intent) {
  const target = pickLastHit(b, 1.0);
  if (target) attackUnit(b, intent, target);
  else { intent.attack = false; moveTo(b, intent, b.farm.x, b.farm.z, 0.5); }
  waveCast(b, intent, 3);
  if (!b.kit.melee && b.playerDist <= 4.5) moveTo(b, intent, b.safe.x, b.safe.z, 0.5);
}

export function actTrade(b, intent) {
  const p = b.p, hero = b.hero, kit = b.kit, now = b.world.time;
  const lx = p.x + p.vx * LEAD, lz = p.z + p.vz * LEAD;
  const armorMul = 1 - p.armor;
  if (kit.melee) {
    attackPlayer(b, intent, lx, lz);
    if (b.playerDist <= 6.0 && b.hpPct > 0.55 && abilityReady(kit, 'e', hero)) {
      aimAt(b, intent, lx, lz);
      cast(b, intent, 'e');
    }
    if (b.playerDist <= 3.0) cast(b, intent, 'q');
    if (now - b.hitByAbilityAt < 0.4 || b.hpPct < 0.6) cast(b, intent, 'w');
    if (b.playerDist <= 3.5) {
      const kill = p.hp <= (abilityDamage(kit, 'r', hero) + 2 * ad(hero)) * armorMul;
      if (kill || p.casting || p.recalling) cast(b, intent, 'r');
    }
    return;
  }
  // Ilyra: one aimed cast per tick, escape first.
  const qCd = hero.cooldowns ? hero.cooldowns.q || 0 : 0;
  const wCd = hero.cooldowns ? hero.cooldowns.w || 0 : 0;
  if (b.markedUntil > now || qCd > 0) attackPlayer(b, intent, lx, lz);
  else { intent.attack = false; intent.moveX = 0; intent.moveZ = 0; }
  if (b.playerDist < 4.5) moveTo(b, intent, b.safe.x, b.safe.z, 0.5);
  if (b.playerDist < 3.0 && now - b.playerEAt < 0.6 && abilityReady(kit, 'e', hero)) {
    aimAt(b, intent, b.safe.x, b.safe.z);
    if (cast(b, intent, 'e')) return;
  }
  const rDmg = abilityDamage(kit, 'r', hero), qDmg = abilityDamage(kit, 'q', hero);
  const rKill = p.hp <= (rDmg + qDmg) * armorMul;
  if (abilityReady(kit, 'r', hero) && (rKill || (qCd > 0 && wCd > 0 && p.hpPct < 0.5))) {
    aimSkillshot(b, intent, lx, lz);
    if (cast(b, intent, 'r')) return;
  }
  if (abilityReady(kit, 'q', hero) && b.playerDist <= kit.q.range &&
      !lineBlocked(hero.pos.x, hero.pos.z, lx, lz, kit.q.range, kit.q.radius, b.enemies)) {
    aimSkillshot(b, intent, lx, lz);
    if (cast(b, intent, 'q')) return;
  }
  if (abilityReady(kit, 'w', hero) && b.playerDist <= kit.w.range + 2) {
    aimAoe(b, intent, lx, lz);
    if (cast(b, intent, 'w')) return;
  }
  // Nothing to do at this range: close to Q range so the trade actually happens.
  if (!intent.attack && b.playerDist > kit.q.range && b.playerDist >= 4.5) moveTo(b, intent, lx, lz, kit.q.range - 0.5);
}
