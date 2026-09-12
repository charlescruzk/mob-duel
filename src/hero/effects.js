// Effects — pooled projectiles, short-lived rings and ground zones, sim side. No
// three.js: every record is plain numbers that fx/effectViews.js mirrors into meshes.
// Pools are built once in the constructor; spawning after that allocates nothing.
// Projectiles carry their owner's onHit(projectile, unit) callback (bind it ONCE in
// the owner's constructor — never a fresh closure per cast).
import { Vec3 } from '../core/vec.js';

export const PROJECTILE_POOL = 48;
export const RING_POOL = 24;
export const ZONE_POOL = 8;
const SUBSTEP = 0.3;            // m per swept sub-step so a 30 m/s lance cannot skip a minion
const PROJECTILE_Y = 1.0;

class Projectile {
  constructor() {
    this.active = false;
    this.pos = new Vec3();
    this.dx = 0; this.dz = 0;
    this.speed = 0;
    this.radius = 0.5;
    this.remaining = 0;
    this.team = 'blue';
    this.onHit = null;
    this.owner = null;          // free-form: the caller's unit
    this.target = null;         // homing when set; cannot miss; vanishes if the target dies
    this.pierce = false;
    this.heroesOnly = false;
    this.execScale = false;
    this.slot = '';             // caller tag ('auto' | 'q' | 'r' ...)
    this.damage = 0;
    this.dtype = 'physical';
    this.color = 0xffffff;      // view hint only
    this.hits = [];             // pierce bookkeeping: units already struck
  }
}

// Rings and zones share a shape: a disc at (x, z) whose `alpha` fades with life.
class Disc {
  constructor(baseAlpha) {
    this.active = false;
    this.x = 0; this.z = 0;
    this.radius = 1;
    this.life = 0;
    this.maxLife = 0;
    this.color = 0xffffff;
    this.baseAlpha = baseAlpha;
    this.alpha = 0;
  }
}

export class Effects {
  constructor() {
    this.world = null;
    this.projectiles = [];
    this.rings = [];
    this.zones = [];
    for (let i = 0; i < PROJECTILE_POOL; i++) this.projectiles.push(new Projectile());
    for (let i = 0; i < RING_POOL; i++) this.rings.push(new Disc(0.8));
    for (let i = 0; i < ZONE_POOL; i++) this.zones.push(new Disc(0.3));
  }

  // Idempotent. The world is what projectiles sweep against.
  attach(world) {
    if (world) this.world = world;
    return this;
  }

  // from: {x,z}; dir: {x,z} (normalised by the caller); onHit(projectile, unit) is
  // invoked for each struck enemy of `team` (alive, non-invulnerable, non-static).
  // Returns the projectile so the caller can set target/pierce/slot/damage/dtype, or
  // null when the pool is exhausted.
  spawnProjectile(from, dir, speed, range, radius, onHit, team, color = 0xffffff) {
    const p = this._freeProjectile();
    if (!p) return null;
    p.active = true;
    p.pos.set(from.x, PROJECTILE_Y, from.z);
    p.dx = dir.x; p.dz = dir.z;
    p.speed = speed;
    p.radius = radius;
    p.remaining = range;
    p.team = team;
    p.onHit = onHit;
    p.owner = null;
    p.target = null;
    p.pierce = false;
    p.heroesOnly = false;
    p.execScale = false;
    p.slot = '';
    p.damage = 0;
    p.dtype = 'physical';
    p.color = color;
    p.hits.length = 0;
    return p;
  }

  spawnRing(pos, radius, life, color = 0xffffff) {
    return this._spawnDisc(this.rings, pos, radius, life, color);
  }

  // Ground zone disc. The sim's zone timer is authoritative (startZone/endZone in
  // abilityLibExt.js); `life` here only drives the fade, and the returned record is
  // kept by the caller so it can end the disc early (active = false).
  spawnZone(pos, radius, life, color = 0xffffff) {
    return this._spawnDisc(this.zones, pos, radius, life, color);
  }

  _spawnDisc(list, pos, radius, life, color) {
    let d = null;
    for (let i = 0; i < list.length; i++) if (!list[i].active) { d = list[i]; break; }
    if (!d) return null;
    d.active = true;
    d.x = pos.x; d.z = pos.z;
    d.radius = radius;
    d.life = life; d.maxLife = life;
    d.color = color;
    d.alpha = d.baseAlpha;
    return d;
  }

  _freeProjectile() {
    const list = this.projectiles;
    for (let i = 0; i < list.length; i++) if (!list[i].active) return list[i];
    return null;
  }

  _release(p) {
    p.active = false;
    p.onHit = null;
    p.owner = null;
    p.target = null;
    p.hits.length = 0;
  }

  activeProjectiles() {
    let n = 0;
    for (let i = 0; i < this.projectiles.length; i++) if (this.projectiles[i].active) n++;
    return n;
  }

  update(dt) {
    const list = this.projectiles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active) continue;
      if (p.target) this._stepHoming(p, dt);
      else this._stepLinear(p, dt);
    }
    const rings = this.rings;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) { r.active = false; continue; }
      r.alpha = r.baseAlpha * (r.life / r.maxLife);
    }
    const zones = this.zones;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z.active) continue;
      z.life -= dt;
      if (z.life <= 0) { z.active = false; continue; }
      z.alpha = z.baseAlpha * (0.4 + 0.6 * (z.life / z.maxLife));
    }
  }

  _stepHoming(p, dt) {
    const t = p.target;
    if (!t.alive) { this._release(p); return; }
    let dx = t.pos.x - p.pos.x;
    let dz = t.pos.z - p.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const step = p.speed * dt;
    if (d <= step + t.radius) {
      if (p.onHit) p.onHit(p, t);
      this._release(p);
      return;
    }
    dx /= d; dz /= d;
    p.dx = dx; p.dz = dz;
    p.pos.x += dx * step;
    p.pos.z += dz * step;
  }

  _stepLinear(p, dt) {
    let step = p.speed * dt;
    if (step > p.remaining) step = p.remaining;
    const n = step > SUBSTEP ? Math.ceil(step / SUBSTEP) : 1;
    const sub = step / n;
    const world = this.world;
    for (let s = 0; s < n; s++) {
      p.pos.x += p.dx * sub;
      p.pos.z += p.dz * sub;
      p.remaining -= sub;
      if (world && this._sweep(p, world.units)) return;   // consumed (non-pierce hit)
    }
    if (p.remaining <= 1e-6) this._release(p);
  }

  // Returns true when the projectile was released by a non-piercing hit.
  _sweep(p, units) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || u.invulnerable || u.isStatic || u.team === p.team) continue;
      if (p.heroesOnly && u.kind !== 'hero') continue;
      const dx = u.pos.x - p.pos.x;
      const dz = u.pos.z - p.pos.z;
      const rr = p.radius + u.radius;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (p.pierce) {
        if (p.hits.indexOf(u) >= 0) continue;
        p.hits.push(u);
        if (p.onHit) p.onHit(p, u);
        continue;
      }
      if (p.onHit) p.onHit(p, u);
      this._release(p);
      return true;
    }
    return false;
  }

  // Match reset / hero death cleanup for the caller's projectiles only.
  releaseOwnedBy(owner) {
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (p.active && p.owner === owner) this._release(p);
    }
  }

  reset() {
    for (let i = 0; i < this.projectiles.length; i++) if (this.projectiles[i].active) this._release(this.projectiles[i]);
    for (let i = 0; i < this.rings.length; i++) this.rings[i].active = false;
    for (let i = 0; i < this.zones.length; i++) this.zones[i].active = false;
  }
}

// The one shared instance. Heroes call effects.attach(world); Match calls update.
export const effects = new Effects();
