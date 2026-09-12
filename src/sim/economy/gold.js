// Economy (a.k.a. GoldSystem in ARCHITECTURE.md): the ONLY source of gold and XP.
// Listens to 'unitDied' for bounties, pays the passive trickle in update(dt), and
// sets starting gold. Writes hero.gold / hero.xp through hero.addGold / hero.addXp
// when the hero exposes them (contract), else directly.
import { events } from '../core/events.js';
import { distSqXZ } from '../core/physics.js';
import { TEAMS, enemyOf } from '../map/laneData.js';

export const START_GOLD = 400;
export const TRICKLE_PER_SEC = 1.5;
export const HERO_KILL_GOLD = 250;
export const XP_RADIUS = 12.0;
export const XP_RADIUS_SQ = XP_RADIUS * XP_RADIUS;

// Fallbacks when a unit constructor did not set goldValue/xpValue (DESIGN.md §4–§7).
const DEFAULT_GOLD = { minion: 20, tower: 150, nexus: 0, hero: HERO_KILL_GOLD };
const DEFAULT_XP = { minion: 30, tower: 200, nexus: 0, hero: 120 };

// Reused payload — listeners copy fields out (see events.js).
const goldPayload = { hero: null, amount: 0, reason: '' };

export function emitGold(hero, amount, reason) {
  goldPayload.hero = hero;
  goldPayload.amount = amount;
  goldPayload.reason = reason;
  events.emit('gold', goldPayload);
}

export function giveGold(hero, amount, reason) {
  if (!hero || amount === 0) return;
  if (typeof hero.addGold === 'function') hero.addGold(amount);
  else hero.gold = (hero.gold || 0) + amount;
  emitGold(hero, amount, reason);
}

export function giveXp(hero, amount) {
  if (!hero || amount <= 0) return;
  if (typeof hero.addXp === 'function') hero.addXp(amount);
  else hero.xp = (hero.xp || 0) + amount;
}

function goldValueOf(unit) {
  if (typeof unit.goldValue === 'number') return unit.goldValue;
  return DEFAULT_GOLD[unit.kind] || 0;
}

function xpValueOf(unit) {
  // Hero bounty scales with the victim's level at death, so it is computed live.
  if (unit.kind === 'hero') return 120 + 30 * (unit.level || 1);
  if (typeof unit.xpValue === 'number') return unit.xpValue;
  return DEFAULT_XP[unit.kind] || 0;
}

export class Economy {
  // heroes: optional [blueHero, redHero]; when omitted they are found via world.hero().
  constructor(world, heroes = null) {
    this.world = world;
    this.heroes = [null, null];
    this._acc = [0, 0];            // fractional trickle per team index
    this.trickleEnabled = true;
    if (heroes) for (let i = 0; i < 2 && i < heroes.length; i++) this._adopt(i, heroes[i]);
    this._onDied = (p) => this._handleDeath(p.unit, p.source);
    this._off = events.on('unitDied', this._onDied);
  }

  _adopt(i, hero) {
    if (!hero || this.heroes[i] === hero) return;
    this.heroes[i] = hero;
    this._acc[i] = 0;
    hero.gold = START_GOLD;
    if (hero.xp === undefined) hero.xp = 0;
    // Hero.xpFromEvents lets the hero self-award XP when no economy exists; this
    // system is the single XP source, so switch that off (no cross-folder import).
    if (hero.constructor && hero.constructor.xpFromEvents !== undefined) hero.constructor.xpFromEvents = false;
  }

  _refreshHeroes() {
    for (let i = 0; i < TEAMS.length; i++) {
      const h = this.world.hero(TEAMS[i]);
      if (h && h !== this.heroes[i]) this._adopt(i, h);
    }
  }

  // Match reset: both heroes back to starting gold, trickle accumulators cleared.
  reset() {
    this._refreshHeroes();
    for (let i = 0; i < 2; i++) {
      const h = this.heroes[i];
      if (h) { h.gold = START_GOLD; this._acc[i] = 0; }
    }
  }

  // Passive trickle: 1.5 g/s to both heroes from t = 0, dead or alive, paid in whole
  // gold so the HUD/event traffic stays at ~1.5 emits per second per hero.
  update(dt) {
    this._refreshHeroes();
    if (!this.trickleEnabled) return;
    for (let i = 0; i < 2; i++) {
      const h = this.heroes[i];
      if (!h) continue;
      this._acc[i] += TRICKLE_PER_SEC * dt;
      const whole = Math.floor(this._acc[i] + 1e-9);   // 1.5 × 0.05 × 200 must floor to 15
      if (whole > 0) {
        this._acc[i] -= whole;
        giveGold(h, whole, 'trickle');
      }
    }
  }

  _handleDeath(unit, source) {
    if (!unit || unit.kind === 'nexus') return;
    const killer = source && source.kind === 'hero' && source.team !== unit.team ? source : null;
    // Gold: last hit only, and only to a hero.
    if (killer) {
      const g = goldValueOf(unit);
      if (g > 0) {
        giveGold(killer, g, unit.kind === 'hero' ? 'heroKill' : (unit.kind === 'tower' ? 'tower' : 'lastHit'));
      }
    }
    // XP: tower → killing team's hero at any distance; hero kill → the killer only;
    // minion → every enemy hero within 12 m (no last hit required).
    const xp = xpValueOf(unit);
    if (xp <= 0) return;
    if (unit.kind === 'tower') {
      const h = this.world.hero(enemyOf(unit.team));
      giveXp(h, xp);
      return;
    }
    if (unit.kind === 'hero') {
      giveXp(killer, xp);
      return;
    }
    const enemyTeam = enemyOf(unit.team);
    const list = this.world.units;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.kind !== 'hero' || h.team !== enemyTeam || !h.alive) continue;
      if (distSqXZ(h.pos, unit.pos) <= XP_RADIUS_SQ) giveXp(h, xp);
    }
  }

  dispose() {
    if (this._off) { this._off(); this._off = null; }
  }
}

export { Economy as GoldSystem };
