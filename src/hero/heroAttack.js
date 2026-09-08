// BasicAttack — the auto-attack of one hero (DESIGN.md §3.1): target = enemy in range
// nearest the reticle, chosen at wind-up start; damage at wind-up end (melee instant,
// ranged homing projectile that cannot miss). Also applies the on-hit passives:
// Brakk's life-on-hit and Ilyra's mark consumption.
import { TEAM_COLOR } from '../map/laneData.js';
import { atLevel } from './heroData.js';
import { effects } from './effects.js';

const RANGE_LENIENCY = 0.75;      // target may drift this far out of range during the wind-up
const AUTO_RADIUS = 0.25;
const AUTO_MAX_TRAVEL = 60;
const EPS = 1e-6;                 // float drift: 0.25 − 5×0.05 is not 0
const dir = { x: 0, z: 0 };

export class BasicAttack {
  constructor(hero) {
    this.hero = hero;
    this.timer = 0;               // attack interval remaining (includes the wind-up)
    this.windup = 0;
    this.target = null;
    this.onProjectileHit = (p, u) => this.land(u);
  }

  get active() { return this.windup > 0; }

  reset() {
    this.timer = 0;
    this.windup = 0;
    this.target = null;
  }

  // Stun: drop the wind-up but keep the interval so it cannot be exploited.
  interrupt() {
    this.windup = 0;
    this.target = null;
  }

  update(dt, intent, world) {
    const hero = this.hero;
    if (this.timer > 0) { this.timer -= dt; if (this.timer <= EPS) this.timer = 0; }
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= EPS) { this.windup = 0; this._release(); }
      return;
    }
    if (!intent || !intent.attack || this.timer > 0 || !world) return;
    if (hero.stunned || hero.isCasting) return;
    const t = this.pickTarget(world, intent.aimX, intent.aimZ);
    if (!t) return;
    this.target = t;
    this.windup = hero.data.windup;
    this.timer = hero.attackInterval;
    hero.onAttackStart();
  }

  // Range rule: statics use centre distance − their radius, others centre distance.
  inRange(u, extra) {
    const hero = this.hero;
    const dx = u.pos.x - hero.pos.x;
    const dz = u.pos.z - hero.pos.z;
    let d = Math.sqrt(dx * dx + dz * dz);
    if (u.isStatic) d -= u.radius;
    return d <= hero.attackRange + extra;
  }

  // Among enemies in range, the one whose centre is nearest the reticle.
  pickTarget(world, aimX, aimZ) {
    const hero = this.hero;
    const list = world.units;
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive || u.invulnerable || u.team === hero.team || u === hero) continue;
      if (!this.inRange(u, 0)) continue;
      const dx = u.pos.x - aimX;
      const dz = u.pos.z - aimZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = u; }
    }
    return best;
  }

  _release() {
    const hero = this.hero;
    const t = this.target;
    this.target = null;
    if (!t || !t.alive || t.invulnerable || !this.inRange(t, RANGE_LENIENCY)) return;
    if (!hero.data.ranged) { this.land(t); return; }
    let dx = t.pos.x - hero.pos.x;
    let dz = t.pos.z - hero.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-4) { dx /= d; dz /= d; } else { dx = 0; dz = -1; }
    dir.x = dx; dir.z = dz;
    const p = effects.spawnProjectile(hero.pos, dir, hero.data.projectileSpeed, AUTO_MAX_TRAVEL,
      AUTO_RADIUS, this.onProjectileHit, hero.team, TEAM_COLOR[hero.team]);
    if (!p) { this.land(t); return; }      // pool exhausted: resolve instantly rather than lose the hit
    p.owner = hero;
    p.target = t;                          // homing — cannot miss
    p.slot = 'auto';
    p.dtype = 'physical';
  }

  // One physical damage instance plus the on-hit passive. Returns HP dealt.
  land(u) {
    const hero = this.hero;
    if (!u.alive || u.invulnerable) return 0;
    const sys = hero.abilities;
    const passive = hero.data.passive;
    let dmg = hero.attackDamage;
    if (sys.marksEnabled && sys.consumeMark(u)) dmg += atLevel(passive.bonus, hero.level);
    const dealt = u.takeDamage(dmg, hero, 'physical');
    if (passive.kind === 'lifeOnHit' && hero.alive) {
      const heal = atLevel(passive.heal, hero.level) * (u.kind === 'hero' ? passive.heroMult : 1);
      hero.heal(heal);
    }
    return dealt;
  }
}
