// World — registry of units plus the shared per-frame sim step: unit updates, unit
// separation, wall/lane collision, velocity bookkeeping, mesh sync. Also owns match
// time and a seedable RNG so the sim never touches the clock or Math.random.
import { separateCircles, resolveCircleVsBoxes, clampToBounds, distSqXZ } from './physics.js';
import { events } from './events.js';

// Reused payloads: the view layer builds/hides meshes on these (fx/unitViews.js).
const addedPayload = { unit: null };
const removedPayload = { unit: null };

export class World {
  constructor(seed = 1337) {
    this.units = [];
    this.time = 0;              // match seconds, advanced only by update(dt)
    this.boxes = [];            // wall AABBs { min, max } from laneBuilder
    this.bounds = null;         // { minX, maxX, minZ, maxZ } walkable centre rectangle
    this._seed = seed >>> 0;
    this._removeQueue = [];
  }

  setCollision(boxes, bounds) {
    this.boxes = boxes;
    this.bounds = bounds;
  }

  add(u) {
    if (this.units.indexOf(u) >= 0) return u;
    u.world = this;
    u.prevPos.copy(u.pos);
    this.units.push(u);
    addedPayload.unit = u;
    events.emit('unitAdded', addedPayload);
    return u;
  }

  // Safe to call from inside update/listeners: the splice happens after the step.
  remove(u) {
    if (this._removeQueue.indexOf(u) < 0) this._removeQueue.push(u);
  }

  // First alive-or-dead hero of a team, or null. Heroes persist while dead.
  // Linear scan: the lane holds ~16 units, so this beats keeping a Map in sync.
  unitById(id) {
    if (!id) return null;
    const list = this.units;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  hero(team) {
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === 'hero' && list[i].team === team) return list[i];
    }
    return null;
  }

  // Fill `out` with alive units of `team` (kind === null → any kind). Returns out.
  byTeam(team, kind, out) {
    out.length = 0;
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.alive && u.team === team && (kind === null || u.kind === kind)) out.push(u);
    }
    return out;
  }

  // Nearest alive, non-invulnerable enemy of `team` within maxDist of pos (centre
  // distance). kindFilter: 'hero' | 'minion' | 'tower' | 'nexus' | null. Unit or null.
  // Stealthed heroes are skipped (Veil): towers/minions keep their current target —
  // their sticky-lock logic — but can acquire no new one.
  nearestEnemy(pos, team, maxDist, kindFilter = null) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive || u.invulnerable || u.team === team) continue;
      if (kindFilter !== null && u.kind !== kindFilter) continue;
      if (u.kind === 'hero' && u.stealthed) continue;
      const d2 = distSqXZ(pos, u.pos);
      if (d2 <= bestD2) { bestD2 = d2; best = u; }
    }
    return best;
  }

  // Alive, non-invulnerable enemies of `team` within r of pos, in registry order.
  // Empties and returns the caller's `out` array (no allocation).
  enemiesInRadius(pos, team, r, out, kindFilter = null) {
    out.length = 0;
    const r2 = r * r;
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive || u.invulnerable || u.team === team) continue;
      if (kindFilter !== null && u.kind !== kindFilter) continue;
      if (distSqXZ(pos, u.pos) <= r2) out.push(u);
    }
    return out;
  }

  // Deterministic mulberry32 in [0, 1). The bot's aim error draws from this.
  random() {
    this._seed = (this._seed + 0x6D2B79F5) >>> 0;
    let t = this._seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  update(dt) {
    this.time += dt;
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.alive) u.update(dt);
      else if (u.tickDead) u.tickDead(dt);   // heroes count down their respawn here
    }
    separateCircles(list);
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive || u.isStatic) continue;
      if (this.boxes.length) resolveCircleVsBoxes(u.pos, u.radius, this.boxes);
      if (this.bounds) clampToBounds(u.pos, u.radius, this.bounds);
    }
    const inv = dt > 0 ? 1 / dt : 0;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      u.vel.x = (u.pos.x - u.prevPos.x) * inv;
      u.vel.z = (u.pos.z - u.prevPos.z) * inv;
      u.prevPos.copy(u.pos);
      u.syncMesh();
    }
    this._flushRemovals();
  }

  _flushRemovals() {
    const q = this._removeQueue;
    while (q.length) {
      const u = q.pop();
      const i = this.units.indexOf(u);
      if (i >= 0) this.units.splice(i, 1);
      u.world = null;
      removedPayload.unit = u;
      events.emit('unitRemoved', removedPayload);
    }
  }

  // Full match reset: every unit leaves the registry (the view hides their meshes).
  clear() {
    for (let i = 0; i < this.units.length; i++) this.remove(this.units[i]);
    this._flushRemovals();
    this.time = 0;
  }
}
