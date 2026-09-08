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
// Attribute conversion per point (PHASE2.md §2) and derived-stat caps. Attack speed
// cap applies to the item/agility stat; ability attack-speed buffs stack on top of it.
export const ATTR = {
  strMaxHp: 16, strHpRegen: 0.08,
  agiArmor: 0.004, agiAttackSpeed: 0.01,
  intMaxMp: 12, intMpRegen: 0.06, intAmp: 0.005,
};
export const ARMOR_CAP = 0.75;
export const ATTACK_SPEED_CAP = 1.5;

export const HEROES = {
  brakk: {
    key: 'brakk',
    name: 'Brakk',
    title: 'the Ironhide',
    role: 'melee bruiser',
    primary: 'str',
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
    primary: 'int',
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

  vaskra: {
    key: 'vaskra',
    name: 'Vaskra',
    title: 'the Longshot',
    role: 'ranged marksman',
    primary: 'agi',
    ranged: true,
    hp: { base: 480, step: 60 },
    mp: { base: 260, step: 25 },
    hpRegen: { base: 1.0, step: 0.1 },
    mpRegen: { base: 1.2, step: 0.12 },
    moveSpeed: 5.1,
    attackRange: 8.0,
    attackDamage: { base: 55, step: 5 },
    attackInterval: 0.85,
    windup: 0.2,
    projectileSpeed: 26.0,
    armor: { base: 0.08, step: 0.01 },
    passive: {
      key: 'p', name: 'Headhunter', kind: 'headhunter',
      desc: 'Every third consecutive basic attack on the same target deals 15 + 5/level true damage.',
      bonus: { base: 15, step: 5 },
    },
    abilities: {
      q: {
        slot: 'q', name: 'Piercing Shot', cost: 40, cd: 7.0, range: 14.0, shape: 'skillshot',
        radius: 0.5, speed: 28.0, pierce: true, dtype: 'physical',
        damage: { base: 65, step: 18 },
        desc: 'Line skillshot, 14 m, pierces every enemy on the way. Physical.',
      },
      w: {
        slot: 'w', name: 'Quickdraw', cost: 45, cd: 12.0, range: 0, shape: 'buff',
        buffKind: 'attackSpeed', buffPct: 0.60, buffTime: 4.0,
        autoSlowPct: 0.15, autoSlowTime: 1.0,
        desc: '4 s: +60% attack speed; basic attacks slow 15% for 1 s.',
      },
      e: {
        slot: 'e', name: 'Tumble', cost: 35, cd: 9.0, range: 3.5, shape: 'dash',
        minDist: 3.5, maxDist: 3.5, speed: 16.0, noDamage: true,
        bonusAuto: { base: 30, step: 8 }, bonusAutoTime: 3.0,
        desc: 'Hop 3.5 m toward the reticle. The next basic attack within 3 s deals 30 + 8/level bonus.',
      },
      r: {
        slot: 'r', name: 'Deadeye', cost: 100, cd: 70.0, range: 30.0, shape: 'windup',
        windup: 1.0, resolve: 'skillshot', radius: 0.6, speed: 45.0, pierce: false,
        heroesOnly: true, execScale: true,
        damage: { base: 150, step: 40 },
        desc: '1.0 s aim (interrupted by stun), then a 30 m bolt at the first hero hit, '
          + 'scaled by its missing HP (cap x2).',
      },
    },
  },

  kesh: {
    key: 'kesh',
    name: 'Kesh',
    title: 'the Hollow',
    role: 'melee assassin',
    primary: 'agi',
    ranged: false,
    hp: { base: 540, step: 70 },
    mp: { base: 240, step: 22 },
    hpRegen: { base: 1.4, step: 0.15 },
    mpRegen: { base: 1.0, step: 0.1 },
    moveSpeed: 5.5,
    attackRange: 1.8,
    attackDamage: { base: 60, step: 6 },
    attackInterval: 0.9,
    windup: 0.2,
    projectileSpeed: 0,
    armor: { base: 0.10, step: 0.01 },
    passive: {
      key: 'p', name: 'Opportunist', kind: 'opportunist',
      desc: 'Autos and abilities deal +20% damage to slowed, rooted or stunned targets.',
    },
    abilities: {
      q: {
        slot: 'q', name: 'Shadow Step', cost: 45, cd: 10.0, range: 7.0, shape: 'targetedBlink',
        blinkBehind: 1.2, damage: { base: 55, step: 15 },
        desc: 'Blink 1.2 m behind the enemy nearest the reticle (7 m) and strike it.',
      },
      w: {
        slot: 'w', name: 'Veil', cost: 50, cd: 18.0, range: 0, shape: 'stealth',
        duration: 3.0, stealthHaste: 0.25, veilBonus: { base: 40, step: 10 },
        desc: 'Stealth 3 s, +25% move speed. Ends on attack or cast; the first basic '
          + 'attack after deals 40 + 10/level bonus.',
      },
      e: {
        slot: 'e', name: 'Fan of Blades', cost: 40, cd: 7.0, range: 4.5, shape: 'cone',
        arc: 60, damage: { base: 60, step: 16 }, slowPct: 0.20, slowTime: 1.0,
        desc: '60° cone, 4.5 m: damage and 20% slow 1 s.',
      },
      r: {
        slot: 'r', name: 'Verdict', cost: 90, cd: 60.0, range: 5.0, shape: 'targeted',
        execThreshold: 0.30, damage: { base: 120, step: 30 },
        desc: 'Strike the enemy nearest the reticle (5 m), doubled below 30% HP. '
          + 'A hero kill refunds half the cooldown.',
      },
    },
  },

  halvard: {
    key: 'halvard',
    name: 'Halvard',
    title: 'the Wall',
    role: 'melee tank',
    primary: 'str',
    ranged: false,
    hp: { base: 700, step: 95 },
    mp: { base: 230, step: 22 },
    hpRegen: { base: 2.2, step: 0.25 },
    mpRegen: { base: 0.9, step: 0.1 },
    moveSpeed: 5.0,
    attackRange: 2.0,
    attackDamage: { base: 55, step: 5 },
    attackInterval: 1.1,
    windup: 0.3,
    projectileSpeed: 0,
    armor: { base: 0.20, step: 0.012 },
    passive: {
      key: 'p', name: 'Unyielding', kind: 'unyielding',
      desc: 'Below 30% HP, +15% armor (additive, before the cap).',
      threshold: 0.30, bonus: 0.15,
    },
    abilities: {
      q: {
        slot: 'q', name: 'Shield Bash', cost: 40, cd: 8.0, range: 2.5, shape: 'targeted',
        damage: { base: 50, step: 14 }, stunTime: 1.0,
        desc: 'Bash the enemy nearest the reticle (2.5 m): damage and a 1 s stun.',
      },
      w: {
        slot: 'w', name: 'Stonewall', cost: 50, cd: 16.0, range: 0, shape: 'buff',
        buffKind: 'armorBuff', buffTime: 4.0, buffPct: 0.20, reflectPct: 0.15,
        desc: 'For 4 s: +0.20 armor and reflects 15% of pre-mitigation damage taken '
          + 'back at the attacker as magic.',
      },
      e: {
        slot: 'e', name: 'Charge', cost: 55, cd: 12.0, shape: 'dash',
        speed: 18.0, minDist: 1.0, maxDist: 8.0, radius: 1.2,
        knockback: { dist: 2.5, time: 0.2, stun: 0.4 }, damage: { base: 40, step: 10 },
        desc: 'Dash up to 8 m. The first enemy hero hit is knocked back 2.5 m along '
          + 'the dash and stunned 0.4 s.',
      },
      r: {
        slot: 'r', name: 'Earthbreaker', cost: 100, cd: 65.0, range: 0, shape: 'windup',
        windup: 0.5, resolve: 'aoeStun', radius: 5.0,
        damage: { base: 120, step: 30 }, stunTime: 1.2,
        zone: { radius: 5.0, duration: 3.0, slowPct: 0.40, slowTime: 0.5, color: 0x4a7fd6 },
        desc: '0.5 s wind-up, then circle r5: damage and a 1.2 s knockup stun, leaving '
          + 'a 3 s field that slows enemies inside by 40%.',
      },
    },
  },

  lumen: {
    key: 'lumen',
    name: 'Lumen',
    title: 'the Tidecaller',
    role: 'ranged controller',
    primary: 'int',
    ranged: true,
    hp: { base: 470, step: 60 },
    mp: { base: 420, step: 45 },
    hpRegen: { base: 1.2, step: 0.12 },
    mpRegen: { base: 2.0, step: 0.22 },
    moveSpeed: 5.0,
    attackRange: 6.5,
    attackDamage: { base: 44, step: 4 },
    attackInterval: 0.95,
    windup: 0.25,
    projectileSpeed: 20.0,
    armor: { base: 0.08, step: 0.01 },
    passive: {
      key: 'p', name: 'Riptide', kind: 'riptide',
      desc: 'Landing any ability grants +15% move speed for 1.5 s.',
      hastePct: 0.15, hasteTime: 1.5,
    },
    abilities: {
      q: {
        slot: 'q', name: 'Tidal Snare', cost: 50, cd: 9.0, range: 10.0, shape: 'skillshot',
        radius: 0.6, speed: 20.0, pierce: false, damage: { base: 55, step: 14 },
        rootTime: 1.5,
        desc: 'Line skillshot, 10 m, stops at the first enemy hit: damage and a 1.5 s root.',
      },
      w: {
        slot: 'w', name: 'Mend', cost: 60, cd: 11.0, range: 0, shape: 'heal',
        heal: { base: 80, step: 28 }, hotRate: { base: 20, step: 5 }, hotTime: 3.0,
        desc: 'Heal self 80 instantly, then 20 per second for 3 s.',
      },
      e: {
        slot: 'e', name: 'Undertow', cost: 65, cd: 12.0, range: 7.0, shape: 'groundAoe',
        telegraph: 0.4, radius: 3.0, damage: { base: 50, step: 15 },
        slowPct: 0.40, slowTime: 1.5, pull: 2.0,
        desc: 'Ground circle r3 at the reticle (7 m). 0.4 s telegraph, then enemies '
          + 'inside are pulled 2 m toward the centre, take damage and a 40% slow 1.5 s.',
      },
      r: {
        slot: 'r', name: 'Deluge', cost: 120, cd: 70.0, range: 6.0, shape: 'groundAoe',
        telegraph: 0.5, radius: 5.0,
        zone: { radius: 5.0, duration: 3.5, slowPct: 0.50, slowTime: 0.5,
          tickInterval: 0.5, tickDamage: { base: 40, step: 12 }, healPct: 0.03,
          color: 0x2fa8c8 },
        desc: 'Ground circle r5 at the reticle (6 m): a 3.5 s tide that slows enemies '
          + 'inside by 50% and deals damage every 0.5 s, while healing Lumen 3% max HP '
          + 'per second inside it.',
      },
    },
  },
};

export const HERO_KEYS = ['brakk', 'ilyra', 'vaskra', 'kesh', 'halvard', 'lumen'];

// Brakk ↔ Ilyra for the original pairing; every other hero bot-fills as Brakk until
// hero select (Task 7) wires ?enemy=.
export function otherHero(key) { return key === 'brakk' ? 'ilyra' : 'brakk'; }

// base + step × (L − 1) for a { base, step } pair; plain numbers pass through.
export function atLevel(v, level) {
  if (typeof v === 'number') return v;
  return v.base + v.step * (level - 1);
}

export function respawnTime(level) { return RESPAWN_BASE + RESPAWN_STEP * (level - 1); }
