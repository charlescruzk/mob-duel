// Minion — melee or ranged lane unit (DESIGN.md §4). Walks its slot line toward the
// enemy nexus, acquires targets by priority every 0.5 s, chases within the drop radius,
// stops to attack on its interval. Movement is free; World does separation/clamping.
// Instances are pooled by WaveSpawner: death hides the mesh, reset() brings it back.
import { Unit } from '../core/unit.js';
import { inRangeXZ, distSqXZ } from '../core/physics.js';
import { POSITIONS, RADII, enemyOf } from '../map/laneData.js';
import { makeMinionMesh } from './unitMeshes.js';
import { shots } from './shotPool.js';

const STATS = {
  melee: { hp: 300, hpStep: 12, dmg: 12, dmgStep: 1, range: 1.5, interval: 1.0, gold: 20, xp: 30 },
  ranged: { hp: 220, hpStep: 9, dmg: 18, dmgStep: 1, range: 6.0, interval: 1.2, gold: 16, xp: 25 },
};
const MOVE_SPEED = 3.2;
const ACQUIRE = 7.0;
const DROP = 9.0;
const AGGRO_PERIOD = 0.5;
const SHOT_SPEED = 16;         // ranged minion tracer (DESIGN.md §4: projectile 16 m/s)
const SHOT_Y = 0.9;
const EPS = 1e-6;

// Priority class of a target (lower wins): minion 0, hero 1, structure 2.
function priorityOf(u) {
  if (u.kind === 'minion') return 0;
  if (u.kind === 'hero') return 1;
  return 2;
}

export class Minion extends Unit {
  // opts: { ranged: false, wave: 0 }. pos is copied. Caller does world.add(minion).
  constructor(team, world, scene, pos, opts) {
    const ranged = !!(opts && opts.ranged);
    const wave = opts && opts.wave ? opts.wave : 0;
    const s = ranged ? STATS.ranged : STATS.melee;
    super('minion', team, RADII.minion, s.hp + s.hpStep * wave, 0);
    this.ranged = ranged;
    this.stats = s;
    this.world = world;                   // World.add overwrites; set early for reset()
    this.moveSpeed = MOVE_SPEED;
    this.goldValue = s.gold;
    this.xpValue = s.xp;
    this.range = s.range;
    this.interval = s.interval;
    this.target = null;
    this.attackTimer = 0;
    this.aggroTimer = 0;
    this.slotX = pos.x;
    this.wave = wave;
    this.damage = 0;
    // Crowd control (Phase 2): stun (no move/attack), slow (move × (1−pct)),
    // root (no move, still attacks). Timers tick in update; cleared on death/reuse.
    this.stunTimer = 0;
    this.slowTimer = 0; this.slowPct = 0;
    this.rootTimer = 0;
    this.mesh = makeMinionMesh(team, ranged);
    if (scene) scene.add(this.mesh);
    shots.attach(scene);
    this.reset(pos, wave);
  }

  // (Re)spawn at pos for wave index `wave`: stats rescale, HP refills, mesh reappears.
  reset(pos, wave) {
    const s = this.stats;
    this.wave = wave;
    this.maxHp = s.hp + s.hpStep * wave;
    this.damage = s.dmg + s.dmgStep * wave;
    this.slotX = pos.x;
    this.target = null;
    this.attackTimer = 0;
    this._clearStatus();
    // Stagger the aggro tick per minion so a wave does not retarget in lockstep.
    this.aggroTimer = this.world ? this.world.random() * AGGRO_PERIOD : 0;
    this.pos.copy(pos);
    this.pos.y = 0;
    this.facing = POSITIONS[this.team].dir < 0 ? 0 : Math.PI;
    this.revive();
    this.teleport(pos.x, pos.z);
    this.syncMesh();
  }

  // kind: 'stun' | 'slow' | 'root' (PHASE2.md §3.5). Stun/root take the longer
  // remaining time; slows do not stack — strongest wins, an equal slow extends.
  applyStatus(kind, seconds, magnitude) {
    if (kind === 'stun') { if (seconds > this.stunTimer) this.stunTimer = seconds; }
    else if (kind === 'root') { if (seconds > this.rootTimer) this.rootTimer = seconds; }
    else if (kind === 'slow') {
      if (magnitude > this.slowPct) { this.slowPct = magnitude; this.slowTimer = seconds; }
      else if (magnitude === this.slowPct && seconds > this.slowTimer) this.slowTimer = seconds;
    }
  }

  _clearStatus() {
    this.stunTimer = 0;
    this.slowTimer = 0; this.slowPct = 0;
    this.rootTimer = 0;
  }

  update(dt) {
    const world = this.world;
    if (!world) return;
    if (this.stunTimer > 0) { this.stunTimer -= dt; if (this.stunTimer <= EPS) this.stunTimer = 0; }
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= EPS) { this.slowTimer = 0; this.slowPct = 0; }
    }
    if (this.rootTimer > 0) { this.rootTimer -= dt; if (this.rootTimer <= EPS) this.rootTimer = 0; }
    this.attackTimer -= dt;
    if (this.attackTimer < 0) this.attackTimer = 0;
    if (this.stunTimer > 0) return;      // stunned: no move, no attack (timers still tick)

    let t = this.target;
    if (t && !this._holds(t)) { this.target = null; t = null; }
    this.aggroTimer -= dt;
    if (this.aggroTimer <= 0) {
      this.aggroTimer += AGGRO_PERIOD;
      this._acquire();
      t = this.target;
    }

    if (t) {
      const reach = this.range + (t.isStatic ? t.radius : 0);
      if (inRangeXZ(this.pos, t.pos, reach)) {
        this._face(t.pos.x, t.pos.z);
        if (this.attackTimer <= 0) {
          this._attack(t);
          this.attackTimer = this.interval;
        }
        return;
      }
      if (this.rootTimer <= 0) this._walkToward(t.pos.x, t.pos.z, dt);   // rooted: no move
      return;
    }
    if (this.rootTimer > 0) return;
    this._walkToward(this.slotX, POSITIONS[enemyOf(this.team)].nexus.z, dt);
  }

  die(source) {
    super.die(source);
    this._clearStatus();
  }

  // Keep a target while it is alive, targetable and inside the drop radius.
  _holds(t) {
    if (!t.alive || t.invulnerable) return false;
    const drop = DROP + (t.isStatic ? t.radius : 0);
    return distSqXZ(this.pos, t.pos) <= drop * drop;
  }

  // DESIGN.md §4 priority: minion → hero (7 m) → tower/nexus. A better class
  // replaces the current target; the same class keeps it (no thrash). (assumed)
  _acquire() {
    const world = this.world;
    const cur = this.target;
    const curPri = cur ? priorityOf(cur) : 3;
    if (curPri > 0) {
      const m = world.nearestEnemy(this.pos, this.team, ACQUIRE, 'minion');
      if (m) { this.target = m; return; }
    }
    if (curPri > 1) {
      const h = world.nearestEnemy(this.pos, this.team, ACQUIRE, 'hero');
      if (h) { this.target = h; return; }
    }
    if (curPri > 2) {
      let s = world.nearestEnemy(this.pos, this.team, ACQUIRE + RADII.tower, 'tower');
      if (!s) s = world.nearestEnemy(this.pos, this.team, ACQUIRE + RADII.nexus, 'nexus');
      if (s) this.target = s;
    }
  }

  _attack(t) {
    if (this.ranged) {
      shots.fire(this.team, this.pos.x, SHOT_Y, this.pos.z, t, SHOT_SPEED);
    }
    t.takeDamage(this.damage, this, 'physical');
  }

  _face(x, z) {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    if (dx !== 0 || dz !== 0) this.facing = Math.atan2(-dx, -dz);
  }

  _walkToward(x, z, dt) {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) return;
    const step = this.moveSpeed * (1 - this.slowPct) * dt;
    const k = step < d ? step / d : 1;
    this.pos.x += dx * k;
    this.pos.z += dz * k;
    this.facing = Math.atan2(-dx, -dz);
  }
}
