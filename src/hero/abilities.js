// AbilitySystem — one per hero. Owns cooldowns, mana gating, the cast state machine
// (wind-ups, the dash, the ground telegraph), status timers (stun/slow/haste/shield)
// and Ilyra's marks. Data-driven from heroData; the resolvers live in abilityLib.
import { SLOTS, R_UNLOCK_LEVEL } from './heroData.js';
import * as lib from './abilityLib.js';
import * as ext from './abilityLibExt.js';
import { applyStatus as applyStat, clearStatus as clearStat } from './statusExt.js';

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
    // Ground zone (Earthbreaker's slow field, Deluge): sim-side timer is authoritative.
    this.zone = { active: false, timer: 0, x: 0, z: 0, def: null, acc: 0, rec: null };
    this.stunTimer = 0;
    this.slowTimer = 0; this.slowPct = 0;
    this.hasteTimer = 0; this.hastePct = 0;
    this.shieldTimer = 0;
    // Phase 2 status kinds (PHASE2.md §3.5).
    this.rootTimer = 0;
    this.stealthTimer = 0;
    this.atkSpdTimer = 0; this.atkSpdPct = 0;
    this.armorBuffTimer = 0; this.armorBuffVal = 0;
    this.reflectTimer = 0; this.reflectVal = 0;
    this.bonusAutoTimer = 0; this.bonusAutoDmg = 0;
    // Auto-applied slow window (Quickdraw W): while up, basic attacks slow the target.
    this.autoSlowTimer = 0; this.autoSlowPct = 0; this.autoSlowTime = 0;
    this.hot = { rate: 0, timer: 0 };      // Mend's heal-over-time
    this.stealthHaste = 0;                 // Veil's +25% move speed while stealthed
    this.strikeUnit = null; this.strikeUntil = 0;   // Verdict refund tracking
    this._aim = { x: 0, z: 0 };            // wind-up aim scratch
    this.marksEnabled = data.passive.kind === 'mark';
    this.markDuration = this.marksEnabled ? data.passive.duration : 0;
    this.marks = [];
    for (let i = 0; i < MARK_POOL; i++) this.marks.push({ unit: null, t: 0 });
    // Bound once: projectiles carry this instead of a per-cast closure.
    this.onProjectileHit = (p, u) => ext.projectileHit(this.hero, this, p, u);
  }

  get isCasting() { return this.cast.def !== null || this.dash.active; }
  get stunned() { return this.stunTimer > 0; }
  get rooted() { return this.rootTimer > 0; }
  get stealthed() { return this.stealthTimer > 0; }
  get speedMult() {
    let m = (1 - this.slowPct) * (1 + (this.hasteTimer > 0 ? this.hastePct : 0));
    if (this.stealthTimer > 0) m *= 1 + this.stealthHaste;
    return m;
  }
  // attackSpeed magnitude is a fraction added; interval ÷ (1 + pct) in heroAttack.
  get attackSpeedPct() { return this.atkSpdTimer > 0 ? this.atkSpdPct : 0; }
  get armorBuff() { return this.armorBuffTimer > 0 ? this.armorBuffVal : 0; }
  get reflectPct() { return this.reflectTimer > 0 ? this.reflectVal : 0; }
  get bonusAuto() { return this.bonusAutoTimer > 0 ? this.bonusAutoDmg : 0; }

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
    // Targeted shapes fizzle before mana is paid when nothing is in reach.
    if (def.shape === 'targetedBlink' || def.shape === 'targeted') {
      if (!ext.pickTargeted(hero, def, aimX, aimZ)) return false;
    }
    if (def.shape === 'dash' && this.rooted) return false;   // rooted: no move, no dash
    // Veil ends on any cast — except the Veil cast itself.
    if (this.stealthed && def.shape !== 'stealth') this.breakStealth();
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
      case 'buff':
        ext.castBuff(hero, this, def);
        this.startCooldown(slot);
        break;
      case 'heal':
        ext.castHeal(hero, this, def);
        this.startCooldown(slot);
        break;
      case 'stealth':
        ext.castStealth(hero, this, def);
        this.startCooldown(slot);
        break;
      case 'targetedBlink':
        ext.castTargetedBlink(hero, this, def, aimX, aimZ);
        this.startCooldown(slot);
        break;
      case 'cone':
        ext.castCone(hero, this, def, aimX, aimZ);
        this.startCooldown(slot);
        break;
      case 'targeted':
        // Cooldown first: a kill inside the strike window halves it (Verdict refund).
        this.startCooldown(slot);
        ext.castTargeted(hero, this, def, aimX, aimZ);
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
        // One field slot: a second groundAoe mid-telegraph would overwrite the
        // first (mana spent, no damage) — resolve the pending one where it stands.
        if (this.field.active) this._landField();
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
    if (this.rootTimer > 0) { this.rootTimer -= dt; if (this.rootTimer <= EPS) this.rootTimer = 0; }
    if (this.stealthTimer > 0) {
      this.stealthTimer -= dt;
      if (this.stealthTimer <= EPS) this._endStealth();
    }
    if (this.atkSpdTimer > 0) { this.atkSpdTimer -= dt; if (this.atkSpdTimer <= EPS) this.atkSpdTimer = 0; }
    if (this.armorBuffTimer > 0) {
      this.armorBuffTimer -= dt;
      if (this.armorBuffTimer <= EPS) { this.armorBuffTimer = 0; hero.refreshArmor(); }   // buff fell off
    }
    if (this.reflectTimer > 0) { this.reflectTimer -= dt; if (this.reflectTimer <= EPS) this.reflectTimer = 0; }
    if (this.bonusAutoTimer > 0) { this.bonusAutoTimer -= dt; if (this.bonusAutoTimer <= EPS) this.bonusAutoTimer = 0; }
    if (this.autoSlowTimer > 0) { this.autoSlowTimer -= dt; if (this.autoSlowTimer <= EPS) this.autoSlowTimer = 0; }
    this._tickMarks(dt);

    if (this.cast.def) {
      if (hero.stunned) {
        // Stun interrupts any wind-up mid-cast (Deadeye, Sunder Slam): no resolve,
        // no cooldown — the mana is already spent.
        this.cast.def = null;
        this.cast.timer = 0;
        this.cast.slot = '';
      } else {
        this.cast.timer -= dt;
        if (this.cast.timer <= EPS) {
          const def = this.cast.def;
          this.cast.def = null;
          this.cast.timer = 0;
          lib.resolveWindup(hero, this, def, aimX, aimZ);
          // Earthbreaker leaves its slow field behind at the hero's feet.
          if (def.zone) ext.startZone(hero, this, def.zone, hero.pos.x, hero.pos.z);
          this.startCooldown(def.slot);
        }
      }
    }
    if (this.dash.active && lib.stepDash(hero, this, world, dt)) this.startCooldown('e');
    if (this.field.active) {
      this.field.timer -= dt;
      if (this.field.timer <= EPS) this._landField();
    }
    if (this.zone.active) ext.tickZone(hero, this, dt);
    if (this.hot.timer > 0) {
      this.hot.timer -= dt;
      if (this.hot.timer <= 0) { this.hot.timer = 0; this.hot.rate = 0; }
      else hero.heal(this.hot.rate * dt);
    }
  }

  // Resolve the pending groundAoe: burst damage, or Deluge's zone. Runs on natural
  // telegraph expiry and when a newer cast replaces the field, so both casts land.
  _landField() {
    const def = this.field.def;
    this.field.active = false;
    // Deluge is a groundAoe that leaves a zone instead of burst damage.
    if (def.zone) ext.startZone(this.hero, this, def.zone, this.field.x, this.field.z);
    else lib.landField(this.hero, this, def, this.field.x, this.field.z);
  }

  // Veil leaves stealth (expiry, attack or cast) — the resolver lives in ext.
  _endStealth() { ext.endStealth(this, this.hero); }

  // Public break (attack start, cast): same path as natural expiry.
  breakStealth() { if (this.stealthTimer > 0) this._endStealth(); }

  // kind: 'stun' | 'slow' | 'haste' | 'shield' | 'root' | 'stealth' | 'attackSpeed' |
  // 'armorBuff' | 'reflect' | 'bonusNextAuto'. Delegates to statusExt (kept there to
  // hold this file under ~300 lines).
  applyStatus(kind, seconds, magnitude) {
    applyStat(this, kind, seconds, magnitude);
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
  clearStatus() { clearStat(this); }

  // Match reset.
  resetAll() {
    this.clearStatus();
    this.cooldowns.q = this.cooldowns.w = this.cooldowns.e = this.cooldowns.r = 0;
  }
}
