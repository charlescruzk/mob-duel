// The two heroes as plain data (DESIGN.md §3). Every scaling number is written as
// { base, step } and resolved with `atLevel(def, key, L)` = base + step × (L − 1).
// Ability `shape` selects the resolver in abilityLib.js; `resolve` is the second
// stage of a wind-up ability. dtype: autos are 'physical', abilities 'magic'.

export const MAX_LEVEL = 6;
export const R_UNLOCK_LEVEL = 4;
// Cumulative XP needed to REACH each level (index = level). No level 7.
export const XP_TO_LEVEL = [0, 0, 120, 300, 540, 840, 1200];
export const XP_SHARE_RADIUS = 12.0;
export const RESPAWN_BASE = 8.0;
export const RESPAWN_STEP = 3.0;
export const RECALL_TIME = 6.0;
export const FOUNTAIN_REGEN_PCT = 0.08;      // of max per second, on top of base regen
export const FOUNTAIN_LASER_DPS = 150;       // true damage to enemy heroes in your fountain
export const CDR_CAP = 0.30;
export const HERO_KILL_GOLD = 250;
export const SLOTS = ['q', 'w', 'e', 'r'];

export const HEROES = {
  brakk: {
    key: 'brakk',
    name: 'Brakk',
    title: 'the Ironhide',
    role: 'melee bruiser',
    ranged: false,
    hp: { base: 620, step: 85 },
    mp: { base: 250, step: 25 },
    hpRegen: { base: 1.8, step: 0.2 },
    mpRegen: { base: 1.0, step: 0.1 },
    moveSpeed: 5.2,
    attackRange: 2.0,
    attackDamage: { base: 62, step: 6 },
    attackInterval: 1.0,
    windup: 0.25,
    projectileSpeed: 0,
    armor: { base: 0.15, step: 0.01 },
    passive: {
      key: 'p', name: 'Ironhide', kind: 'lifeOnHit',
      desc: 'Each basic attack that lands heals 6 + 2/level (x3 vs heroes).',
      heal: { base: 6, step: 2 }, heroMult: 3,
    },
    abilities: {
      q: {
        slot: 'q', name: 'Cleave', cost: 40, cd: 6.0, range: 0, shape: 'selfAoe',
        radius: 3.0, damage: { base: 60, step: 15 }, slowPct: 0.30, slowTime: 1.0,
        desc: 'Instant circle r3 around Brakk. Damage, 30% slow 1 s.',
      },
      w: {
        slot: 'w', name: 'Bulwark', cost: 50, cd: 14.0, range: 0, shape: 'shield',
        shield: { base: 90, step: 25 }, duration: 3.0,
        desc: 'Shield for 3 s. Recast refreshes.',
      },
      e: {
        slot: 'e', name: 'Lunge', cost: 55, cd: 11.0, range: 6.0, shape: 'dash',
        minDist: 1.5, maxDist: 6.0, speed: 20.0, radius: 1.5,
        damage: { base: 50, step: 12 }, slowPct: 0.40, slowTime: 1.0,
        desc: 'Dash toward the reticle (1.5-6 m). Lands a circle r1.5: damage, 40% slow 1 s.',
      },
      r: {
        slot: 'r', name: 'Sunder Slam', cost: 100, cd: 60.0, range: 0, shape: 'windup',
        windup: 0.4, resolve: 'aoeStun', radius: 3.5,
        damage: { base: 140, step: 35 }, stunTime: 0.8,
        desc: '0.4 s wind-up, then circle r3.5: damage and 0.8 s stun.',
      },
    },
  },

  ilyra: {
    key: 'ilyra',
    name: 'Ilyra',
    title: 'the Cinderweaver',
    role: 'ranged mage',
    ranged: true,
    hp: { base: 500, step: 65 },
    mp: { base: 380, step: 40 },
    hpRegen: { base: 1.0, step: 0.1 },
    mpRegen: { base: 1.8, step: 0.2 },
    moveSpeed: 5.0,
    attackRange: 7.0,
    attackDamage: { base: 48, step: 4 },
    attackInterval: 0.9,
    windup: 0.25,
    projectileSpeed: 20.0,
    armor: { base: 0.08, step: 0.01 },
    passive: {
      key: 'p', name: 'Cinder Mark', kind: 'mark',
      desc: 'Ability damage marks for 4 s. Next basic attack on a marked unit deals 20 + 8/level bonus.',
      duration: 4.0, bonus: { base: 20, step: 8 },
    },
    abilities: {
      q: {
        slot: 'q', name: 'Ember Bolt', cost: 45, cd: 5.0, range: 11.0, shape: 'skillshot',
        radius: 0.5, speed: 18.0, pierce: false, damage: { base: 70, step: 20 },
        desc: 'Skillshot, 11 m, stops at the first enemy hit.',
      },
      w: {
        slot: 'w', name: 'Scorch Field', cost: 60, cd: 9.0, range: 8.0, shape: 'groundAoe',
        telegraph: 0.5, radius: 2.5, damage: { base: 60, step: 18 }, slowPct: 0.30, slowTime: 1.5,
        desc: 'Ground circle r2.5 at the reticle (8 m). 0.5 s telegraph, then damage and 30% slow 1.5 s.',
      },
      e: {
        slot: 'e', name: 'Blink Step', cost: 50, cd: 14.0, range: 4.5, shape: 'blink',
        distance: 4.5, hastePct: 0.30, hasteTime: 1.5,
        desc: 'Blink 4.5 m toward the reticle, then +30% move speed for 1.5 s.',
      },
      r: {
        slot: 'r', name: 'Solar Lance', cost: 110, cd: 55.0, range: 16.0, shape: 'windup',
        windup: 0.35, resolve: 'skillshot', radius: 0.8, speed: 30.0, pierce: true,
        damage: { base: 180, step: 45 },
        desc: '0.35 s cast, then a piercing lance: 16 m, hits every enemy on the way.',
      },
    },
  },
};

export const HERO_KEYS = ['brakk', 'ilyra'];

export function otherHero(key) { return key === 'brakk' ? 'ilyra' : 'brakk'; }

// base + step × (L − 1) for a { base, step } pair; plain numbers pass through.
export function atLevel(v, level) {
  if (typeof v === 'number') return v;
  return v.base + v.step * (level - 1);
}

export function respawnTime(level) { return RESPAWN_BASE + RESPAWN_STEP * (level - 1); }
