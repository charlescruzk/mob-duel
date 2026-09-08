// Effects — pooled projectiles, short-lived rings and ground zones. One shared
// instance (`effects`) that a Hero attaches to the scene/world on construction;
// main/match calls `effects.update(dt)` after world.update(dt). Pools are built
// once; spawning after that allocates nothing. Projectiles carry their owner's
// onHit(projectile, unit) callback (bind it ONCE in the owner's constructor —
// never a fresh closure per cast).
import * as THREE from 'three';

const PROJECTILE_POOL = 48;
const RING_POOL = 24;
const ZONE_POOL = 4;
const ZONE_Y = 0.04;
const SUBSTEP = 0.3;            // m per swept sub-step so a 30 m/s lance cannot skip a minion
const PROJECTILE_Y = 1.0;

class Projectile {
  constructor(mesh) {
    this.active = false;
    this.mesh = mesh;
    this.pos = new THREE.Vector3();
    this.dx = 0; this.dz = 0;
    this.speed = 0;
    this.radius = 0.5;
    this.remaining = 0;
    this.team = 'blue';
    this.onHit = null;
    this.owner = null;          // free-form: the caller's unit
    this.target = null;         // homing when set; cannot miss; vanishes if the target dies
    this.pierce = false;
    this.heroesOnly = false;    // Deadeye: minions never block or trigger the hit
    this.execScale = false;     // recompute damage from missing HP at impact
    this.slot = '';             // caller tag ('auto' | 'q' | 'r' ...)
    this.damage = 0;
    this.dtype = 'physical';
    this.hits = [];             // pierce bookkeeping: units already struck
  }
}

class Ring {
  constructor(mesh) {
    this.active = false;
    this.mesh = mesh;
    this.life = 0;
    this.maxLife = 0;
  }
}

// A ground zone's visible disc (Earthbreaker's slow field, Deluge). Lifetime and
// position live on the sim side (AbilitySystem.zone); the mesh only fades.
class Zone {
  constructor(mesh) {
    this.active = false;
    this.mesh = mesh;
    this.life = 0;
    this.maxLife = 0;
  }
}

export class Effects {
  constructor() {
    this.scene = null;
    this.world = null;
    this.group = new THREE.Group();
    this.projectiles = [];
    this.rings = [];
    this.zones = [];
    this._built = false;
  }

  // Idempotent. Re-attaching to another scene moves the group.
  attach(scene, world) {
    if (world) this.world = world;
    if (scene && scene !== this.scene) {
      if (this.scene) this.scene.remove(this.group);
      scene.add(this.group);
      this.scene = scene;
    }
    if (!this._built) this._build();
    return this;
  }

  _build() {
    this._built = true;
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < PROJECTILE_POOL; i++) {
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      this.group.add(m);
      this.projectiles.push(new Projectile(m));
    }
    const ring = new THREE.RingGeometry(0.82, 1.0, 40);
    for (let i = 0; i < RING_POOL; i++) {
      const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.05;
      m.visible = false;
      this.group.add(m);
      this.rings.push(new Ring(m));
    }
    const disc = new THREE.CircleGeometry(1, 32);
    for (let i = 0; i < ZONE_POOL; i++) {
      const m = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = ZONE_Y;
      m.visible = false;
      this.group.add(m);
      this.zones.push(new Zone(m));
    }
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
    p.hits.length = 0;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(radius);
    p.mesh.material.color.setHex(color);
    p.mesh.position.copy(p.pos);
    return p;
  }

  spawnRing(pos, radius, life, color = 0xffffff) {
    let r = null;
    for (let i = 0; i < this.rings.length; i++) if (!this.rings[i].active) { r = this.rings[i]; break; }
    if (!r) return null;
    r.active = true;
    r.life = life;
    r.maxLife = life;
    r.mesh.visible = true;
    r.mesh.scale.set(radius, radius, 1);
    r.mesh.position.x = pos.x;
    r.mesh.position.z = pos.z;
    r.mesh.material.color.setHex(color);
    r.mesh.material.opacity = 0.8;
    return r;
  }

  // Ground zone disc. The sim's zone timer is authoritative (startZone/endZone in
  // abilityLibExt.js); `life` here only drives the fade, and the returned Zone is
  // kept by the caller so it can end the disc early.
  spawnZone(pos, radius, life, color = 0xffffff) {
    let z = null;
    for (let i = 0; i < this.zones.length; i++) if (!this.zones[i].active) { z = this.zones[i]; break; }
    if (!z) return null;
    z.active = true;
    z.life = life;
    z.maxLife = life;
    z.mesh.visible = true;
    z.mesh.scale.set(radius, radius, 1);
    z.mesh.position.x = pos.x;
    z.mesh.position.z = pos.z;
    z.mesh.material.color.setHex(color);
    z.mesh.material.opacity = 0.3;
    return z;
  }

  _freeProjectile() {
    const list = this.projectiles;
    for (let i = 0; i < list.length; i++) if (!list[i].active) return list[i];
    return null;
  }

  _release(p) {
    p.active = false;
    p.mesh.visible = false;
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
      if (p.active) p.mesh.position.copy(p.pos);
    }
    const rings = this.rings;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) { r.active = false; r.mesh.visible = false; continue; }
      r.mesh.material.opacity = 0.8 * (r.life / r.maxLife);
    }
    const zones = this.zones;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z.active) continue;
      z.life -= dt;
      if (z.life <= 0) { z.active = false; z.mesh.visible = false; continue; }
      z.mesh.material.opacity = 0.3 * (0.4 + 0.6 * (z.life / z.maxLife));
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
    for (let i = 0; i < this.rings.length; i++) { this.rings[i].active = false; this.rings[i].mesh.visible = false; }
    for (let i = 0; i < this.zones.length; i++) { this.zones[i].active = false; this.zones[i].mesh.visible = false; }
  }
}

// The one shared instance. Heroes call effects.attach(scene, world); main calls update.
export const effects = new Effects();
