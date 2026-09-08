// AbilitySystem — one per hero. Owns cooldowns, mana gating, the cast state machine
// (wind-ups, the dash, the ground telegraph), status timers (stun/slow/haste/shield)
// and Ilyra's marks. Data-driven from heroData; the resolvers live in abilityLib.
import { SLOTS, R_UNLOCK_LEVEL } from './heroData.js';
import * as lib from './abilityLib.js';

const MARK_POOL = 32;
const EPS = 1e-6;          // countdowns snap to 0 so float drift never costs a frame

export class AbilitySystem {
  constructor(hero, data) {
    this.hero = hero;
    this.data = data;
    this.cooldowns = { q: 0, w: 0, e: 0, r: 0 };
    this.costs = {
      q: data.abilities.q.cost, w: data.abilities.w.cost,
      e: data.abilities.e.cost, r: data.abilities.r.cost,
    };
    this.cast = { slot: '', timer: 0, def: null };               // wind-up in progress
    this.dash = { active: false, dx: 0, dz: 0, remaining: 0, def: null };
    this.field = { active: false, timer: 0, x: 0, z: 0, def: null };
    this.stunTimer = 0;
    this.slowTimer = 0; this.slowPct = 0;
    this.hasteTimer = 0; this.hastePct = 0;
    this.shieldTimer = 0;
    this._aim = { x: 0, z: 0 };            // wind-up aim scratch
    this.marksEnabled = data.passive.kind === 'mark';
    this.markDuration = this.marksEnabled ? data.passive.duration : 0;
    this.marks = [];
    for (let i = 0; i < MARK_POOL; i++) this.marks.push({ unit: null, t: 0 });
    // Bound once: projectiles carry this instead of a per-cast closure.
    this.onProjectileHit = (p, u) => lib.abilityHit(this.hero, this, u, p.damage);
  }

  get isCasting() { return this.cast.def !== null || this.dash.active; }
  get stunned() { return this.stunTimer > 0; }
  get speedMult() {
    return (1 - this.slowPct) * (1 + (this.hasteTimer > 0 ? this.hastePct : 0));
  }

  unlocked(slot) { return slot !== 'r' || this.hero.level >= R_UNLOCK_LEVEL; }

  // 'locked' | 'cooldown' | 'mana' | 'busy' | 'ready' — the HUD greys on anything but ready.
  state(slot) {
    if (!this.unlocked(slot)) return 'locked';
    if (this.cooldowns[slot] > 0) return 'cooldown';
    if (this.hero.mp < this.costs[slot]) return 'mana';
    if (!this.hero.alive || this.stunned || this.isCasting) return 'busy';
    return 'ready';
  }

  ready(slot) { return this.state(slot) === 'ready'; }

  // Gate → pay → resolve (instants) or arm (wind-up/dash/telegraph). True if cast.
  tryCast(slot, aimX, aimZ) {
    if (this.state(slot) !== 'ready') return false;
    const hero = this.hero;
    const def = this.data.abilities[slot];
    hero.mp -= def.cost;
    switch (def.shape) {
      case 'selfAoe':
        lib.castSelfAoe(hero, this, def);
        this.startCooldown(slot);
        break;
      case 'shield':
        lib.castShield(hero, this, def);
        this.startCooldown(slot);
        break;
      case 'dash':
        lib.startDash(hero, this, def, aimX, aimZ);     // cooldown starts on landing
        break;
      case 'windup':
        this.cast.slot = slot;
        this.cast.timer = def.windup;
        this.cast.def = def;
        lib.aimDir(hero, aimX, aimZ, this._aim);
        lib.faceDir(hero, this._aim.x, this._aim.z);
        break;
      case 'skillshot':
        lib.castSkillshot(hero, this, def, aimX, aimZ);
        this.startCooldown(slot);
        break;
      case 'groundAoe':
        lib.startField(hero, this, def, aimX, aimZ);
        this.startCooldown(slot);
        break;
      case 'blink':
        lib.castBlink(hero, this, def, aimX, aimZ, hero.world);
        this.startCooldown(slot);
        break;
      default:
        return false;
    }
    return true;
  }

  startCooldown(slot) {
    this.cooldowns[slot] = this.data.abilities[slot].cd * (1 - this.hero.cdr);
  }

  tickCooldowns(dt) {
    const cd = this.cooldowns;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      if (cd[s] > 0) { cd[s] -= dt; if (cd[s] <= EPS) cd[s] = 0; }
    }
  }

  // Alive-only tick. aimX/aimZ are the live reticle so a wind-up fires where the
  // player is looking when it resolves.
  update(dt, world, aimX, aimZ) {
    const hero = this.hero;
    this.tickCooldowns(dt);
    if (this.stunTimer > 0) { this.stunTimer -= dt; if (this.stunTimer <= EPS) this.stunTimer = 0; }
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= EPS) { this.slowTimer = 0; this.slowPct = 0; }
    }
    if (this.hasteTimer > 0) {
      this.hasteTimer -= dt;
      if (this.hasteTimer <= EPS) { this.hasteTimer = 0; this.hastePct = 0; }
    }
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= EPS || hero.shield <= 0) { this.shieldTimer = 0; hero.shield = 0; }
    }
    this._tickMarks(dt);

    if (this.cast.def) {
      this.cast.timer -= dt;
      if (this.cast.timer <= EPS) {
        const def = this.cast.def;
        this.cast.def = null;
        this.cast.timer = 0;
        lib.resolveWindup(hero, this, def, aimX, aimZ);
        this.startCooldown(def.slot);
      }
    }
    if (this.dash.active && lib.stepDash(hero, this, world, dt)) this.startCooldown('e');
    if (this.field.active) {
      this.field.timer -= dt;
      if (this.field.timer <= EPS) {
        this.field.active = false;
        lib.landField(hero, this, this.field.def, this.field.x, this.field.z);
      }
    }
  }

  // kind: 'stun' | 'slow' | 'haste' | 'shield'. Slows do not stack: strongest wins,
  // an equal slow extends. Stun takes the longer remaining time.
  applyStatus(kind, seconds, magnitude) {
    if (kind === 'stun') {
      if (seconds > this.stunTimer) this.stunTimer = seconds;
    } else if (kind === 'slow') {
      if (magnitude > this.slowPct) { this.slowPct = magnitude; this.slowTimer = seconds; }
      else if (magnitude === this.slowPct && seconds > this.slowTimer) this.slowTimer = seconds;
    } else if (kind === 'haste') {
      if (magnitude >= this.hastePct) { this.hastePct = magnitude; if (seconds > this.hasteTimer) this.hasteTimer = seconds; }
    } else if (kind === 'shield') {
      this.hero.shield = magnitude;
      this.shieldTimer = seconds;
    }
  }

  // --- marks (Ilyra passive) ------------------------------------------------

  markUnit(unit) {
    const list = this.marks;
    let free = null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.unit === unit) { m.t = this.markDuration; return; }
      if (!free && m.unit === null) free = m;
    }
    if (free) { free.unit = unit; free.t = this.markDuration; }
  }

  hasMark(unit) {
    const list = this.marks;
    for (let i = 0; i < list.length; i++) if (list[i].unit === unit) return true;
    return false;
  }

  consumeMark(unit) {
    const list = this.marks;
    for (let i = 0; i < list.length; i++) {
      if (list[i].unit === unit) { list[i].unit = null; list[i].t = 0; return true; }
    }
    return false;
  }

  _tickMarks(dt) {
    if (!this.marksEnabled) return;
    const list = this.marks;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.unit === null) continue;
      m.t -= dt;
      if (m.t <= EPS || !m.unit.alive) { m.unit = null; m.t = 0; }
    }
  }

  // Death: statuses, shield, marks and any cast/dash/telegraph in progress go away.
  // Cooldowns are untouched — they keep ticking while dead (tickCooldowns).
  clearStatus() {
    this.stunTimer = 0;
    this.slowTimer = 0; this.slowPct = 0;
    this.hasteTimer = 0; this.hastePct = 0;
    this.shieldTimer = 0;
    this.hero.shield = 0;
    this.cast.def = null; this.cast.timer = 0; this.cast.slot = '';
    this.dash.active = false;
    this.field.active = false;
    for (let i = 0; i < this.marks.length; i++) { this.marks[i].unit = null; this.marks[i].t = 0; }
  }

  // Match reset.
  resetAll() {
    this.clearStatus();
    this.cooldowns.q = this.cooldowns.w = this.cooldowns.e = this.cooldowns.r = 0;
  }
}
