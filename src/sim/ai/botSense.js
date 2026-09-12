// Bot senses: the 0.3 s-delayed view of the player (ring buffer), the two heroes'
// ability numbers as the bot reasons about them (DESIGN.md §3.3/§3.4), and small
// allocation-free geometry helpers. Nothing here writes to the sim.
import { distSqXZ } from '../core/physics.js';
import { RADII, TOWER_RANGE, POSITIONS } from '../map/laneData.js';

export const REACTION_DELAY = 0.3;
const RING = 64;

// Numbers the bot needs about its own kit (PHASE2.md §6 generic schema): cost,
// reach, damage scaling, min level and a kind — 'damage' | 'cc' | 'buff' |
// 'escape' | 'heal' | 'stealth' — that drives the generalized cast rules. Radius
// rides along for the skillshot line-block test.
export const BOT_KIT = {
  brakk: {
    id: 'brakk',
    melee: true,
    q: { cost: 40, range: 3.0, radius: 3.0, base: 60, step: 15, minLevel: 1, kind: 'damage' },
    w: { cost: 50, range: 0, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'buff' },
    e: { cost: 55, range: 6.0, radius: 1.5, base: 50, step: 12, minLevel: 1, kind: 'escape' },
    r: { cost: 100, range: 3.5, radius: 3.5, base: 140, step: 35, minLevel: 4, kind: 'damage' },
  },
  ilyra: {
    id: 'ilyra',
    melee: false,
    q: { cost: 45, range: 11.0, radius: 0.5, base: 70, step: 20, minLevel: 1, kind: 'damage' },
    w: { cost: 60, range: 8.0, radius: 2.5, base: 60, step: 18, minLevel: 1, kind: 'damage' },
    e: { cost: 50, range: 4.5, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'escape' },
    r: { cost: 110, range: 16.0, radius: 0.8, base: 180, step: 45, minLevel: 4, kind: 'damage' },
  },
  vaskra: {
    id: 'vaskra',
    melee: false,
    q: { cost: 40, range: 14.0, radius: 0.5, base: 65, step: 18, minLevel: 1, kind: 'damage' },
    w: { cost: 45, range: 0, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'buff' },
    e: { cost: 35, range: 3.5, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'escape' },
    r: { cost: 100, range: 30.0, radius: 0.6, base: 150, step: 40, minLevel: 4, kind: 'damage' },
  },
  kesh: {
    id: 'kesh',
    melee: true,
    q: { cost: 45, range: 7.0, radius: 0, base: 55, step: 15, minLevel: 1, kind: 'damage' },
    w: { cost: 50, range: 0, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'stealth' },
    e: { cost: 40, range: 4.5, radius: 0, base: 60, step: 16, minLevel: 1, kind: 'damage' },
    r: { cost: 90, range: 5.0, radius: 0, base: 120, step: 30, minLevel: 4, kind: 'damage' },
  },
  halvard: {
    id: 'halvard',
    melee: true,
    q: { cost: 40, range: 2.5, radius: 0, base: 50, step: 14, minLevel: 1, kind: 'cc' },
    w: { cost: 50, range: 0, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'buff' },
    e: { cost: 55, range: 8.0, radius: 1.2, base: 40, step: 10, minLevel: 1, kind: 'cc' },
    r: { cost: 100, range: 5.0, radius: 5.0, base: 120, step: 30, minLevel: 4, kind: 'cc' },
  },
  lumen: {
    id: 'lumen',
    melee: false,
    q: { cost: 50, range: 10.0, radius: 0.6, base: 55, step: 14, minLevel: 1, kind: 'cc' },
    w: { cost: 60, range: 0, radius: 0, base: 0, step: 0, minLevel: 1, kind: 'heal' },
    e: { cost: 65, range: 7.0, radius: 3.0, base: 50, step: 15, minLevel: 1, kind: 'cc' },
    r: { cost: 120, range: 6.0, radius: 5.0, base: 40, step: 12, minLevel: 4, kind: 'damage' },
  },
};

// Which kit a hero runs. Falls back on attack range when the hero exposes no key.
export function kitOf(hero) {
  const k = hero.heroKey || hero.key || hero.heroId || hero.name;
  if (typeof k === 'string') {
    const s = k.toLowerCase();
    if (s.indexOf('brakk') >= 0) return BOT_KIT.brakk;
    if (s.indexOf('ilyra') >= 0) return BOT_KIT.ilyra;
    if (s.indexOf('vaskra') >= 0) return BOT_KIT.vaskra;
    if (s.indexOf('kesh') >= 0) return BOT_KIT.kesh;
    if (s.indexOf('halvard') >= 0) return BOT_KIT.halvard;
    if (s.indexOf('lumen') >= 0) return BOT_KIT.lumen;
  }
  return (hero.attackRange || 2) <= 2.5 ? BOT_KIT.brakk : BOT_KIT.ilyra;
}

export function abilityDamage(kit, slot, hero) {
  const a = kit[slot];
  const L = hero.level || 1;
  return (a.base + a.step * (L - 1)) * (1 + (hero.abilityAmp || 0));
}

// Cast preconditions the hero itself will check (cooldown, mana, unlock level).
export function abilityReady(kit, slot, hero) {
  const a = kit[slot];
  if ((hero.level || 1) < (a.minLevel || 1)) return false;
  const cd = hero.cooldowns ? hero.cooldowns[slot] || 0 : 0;
  if (cd > 0) return false;
  const cost = hero.costs && typeof hero.costs[slot] === 'number' ? hero.costs[slot] : a.cost;
  return (hero.mp === undefined ? Infinity : hero.mp) >= cost;
}

// Longest reach among the bot's ready damaging abilities (TRADE entry range).
export function longestReadyRange(kit, hero) {
  let best = 0;
  if (abilityReady(kit, 'q', hero) && kit.q.range > best) best = kit.q.range;
  if (abilityReady(kit, 'e', hero) && kit.e.base > 0 && kit.e.range > best) best = kit.e.range;
  if (abilityReady(kit, 'r', hero) && kit.r.range > best) best = kit.r.range;
  if (abilityReady(kit, 'w', hero) && kit.w.base > 0 && kit.w.range > best) best = kit.w.range;
  return best;
}

// Ring buffer of player samples; `read(now, out)` fills `out` with the newest sample
// at least REACTION_DELAY old. Sampled once per frame by the bot.
export class DelayedView {
  constructor() {
    this._buf = [];
    for (let i = 0; i < RING; i++) {
      this._buf.push({ t: -1, x: 0, z: 0, vx: 0, vz: 0, hp: 0, maxHp: 1, hpPct: 1, armor: 0,
        alive: true, casting: false, recalling: false, level: 1 });
    }
    this._head = -1;
    this._count = 0;
  }

  reset() { this._head = -1; this._count = 0; }

  sample(now, hero) {
    this._head = (this._head + 1) % RING;
    if (this._count < RING) this._count++;
    const s = this._buf[this._head];
    s.t = now;
    s.visible = hero.stealthed !== true;   // Veil: the bot does not see a stealthed hero
    s.x = hero.pos.x; s.z = hero.pos.z;
    s.vx = hero.vel.x; s.vz = hero.vel.z;
    s.hp = hero.hp; s.maxHp = hero.maxHp || 1;
    s.hpPct = s.maxHp > 0 ? hero.hp / s.maxHp : 0;
    s.armor = hero.armor || 0;
    s.alive = hero.alive !== false;
    s.casting = !!hero.isCasting;
    s.recalling = !!hero.isRecalling;
    s.level = hero.level || 1;
  }

  read(now, out) {
    if (this._count === 0) return false;
    let idx = this._head;
    let pick = null;
    for (let n = 0; n < this._count; n++) {
      const s = this._buf[idx];
      if (now - s.t >= REACTION_DELAY) { pick = s; break; }
      idx = (idx - 1 + RING) % RING;
    }
    // Younger than the delay (match start): use the oldest we have.
    if (!pick) pick = this._buf[(this._head - this._count + 1 + RING) % RING];
    out.x = pick.x; out.z = pick.z; out.vx = pick.vx; out.vz = pick.vz;
    out.hp = pick.hp; out.maxHp = pick.maxHp; out.hpPct = pick.hpPct; out.armor = pick.armor;
    out.alive = pick.alive; out.casting = pick.casting; out.recalling = pick.recalling;
    out.visible = pick.visible !== false;
    out.level = pick.level;
    return true;
  }
}

export function makeSnapshot() {
  return { x: 0, z: 0, vx: 0, vz: 0, hp: 0, maxHp: 1, hpPct: 1, armor: 0,
    alive: true, casting: false, recalling: false, visible: true, level: 1 };
}

// Centre-to-centre distance to a team's tower vs. TOWER_RANGE (DESIGN.md §5).
export function inTowerRange(pos, towerTeam) {
  return distSqXZ(pos, POSITIONS[towerTeam].tower) <= TOWER_RANGE * TOWER_RANGE;
}

// Alive units of `list` (already team/kind filtered) within r of a point.
export function countWithin(list, x, z, r) {
  const r2 = r * r;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const dx = list[i].pos.x - x, dz = list[i].pos.z - z;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

// Is the straight segment from (ax,az) toward (bx,bz), capped at maxLen, blocked by
// any circle in `minions` (radius minion + projectile)? Sampled every 0.5 m.
export function lineBlocked(ax, az, bx, bz, maxLen, projRadius, minions) {
  let dx = bx - ax, dz = bz - az;
  let len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return false;
  dx /= len; dz /= len;
  if (len > maxLen) len = maxLen;
  const hit = RADII.minion + projRadius;
  const hit2 = hit * hit;
  for (let s = 0.5; s < len; s += 0.5) {
    const px = ax + dx * s, pz = az + dz * s;
    for (let i = 0; i < minions.length; i++) {
      const m = minions[i];
      const mx = m.pos.x - px, mz = m.pos.z - pz;
      if (mx * mx + mz * mz <= hit2) return true;
    }
  }
  return false;
}
