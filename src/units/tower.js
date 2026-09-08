// Tower — static lane defence (DESIGN.md §5). Sticky targeting re-evaluated every
// 0.25 s (aggro hero → lone hero → nearest minion), 0.6 s to the first shot after
// acquiring, then one hitscan shot per 1.2 s with the per-hero damage ramp. The shot
// sphere is a pooled visual only; damage lands at fire time so the cadence is exact.
import { Unit } from '../core/unit.js';
import { events } from '../core/events.js';
import { distSqXZ } from '../core/physics.js';
import { RADII, HEIGHTS, TOWER_RANGE } from '../map/laneData.js';
import { makeTowerMesh } from './unitMeshes.js';
import { shots } from './shotPool.js';

const HP = 1800;
const RANGE = TOWER_RANGE;
const RANGE2 = RANGE * RANGE;
const INTERVAL = 1.2;
const ACQUIRE_DELAY = 0.6;
const RETARGET_PERIOD = 0.25;
const HERO_DAMAGE = 95;
const MINION_DAMAGE = 190;
const RAMP_STEP = 0.25;
const RAMP_MAX = 3.0;
const RAMP_TIMEOUT = 2.5;
const AGGRO_WINDOW = 3.0;
const SHOT_SPEED = 25;
const MUZZLE_Y = HEIGHTS.tower + 0.5;

const shotPayload = { tower: null, target: null, amount: 0, ramp: 1 };

export class Tower extends Unit {
  // pos is copied. Caller does world.add(tower).
  constructor(team, world, scene, pos) {
    super('tower', team, RADII.tower, HP, 0);
    this.isStatic = true;
    this.world = world;                  // World.add overwrites with the same value
    this.goldValue = 150;
    this.xpValue = 200;
    this.target = null;                  // read by the bot ("tower is targeting me")
    this.ramp = 1;                       // multiplier used on the last hero shot
    this.aggroHero = null;
    this.aggroUntil = -1;
    this.fireTimer = 0;
    this.retargetTimer = 0;
    this._shotsOnHero = 0;
    this._rampHero = null;
    this._lastHeroShot = -1e9;
    this.pos.copy(pos);
    this.pos.y = 0;
    this.mesh = makeTowerMesh(team);
    if (scene) scene.add(this.mesh);
    shots.attach(scene);
    this.syncMesh();
    this._onDamaged = (p) => this._handleDamaged(p);
    this._unsub = events.on('unitDamaged', this._onDamaged);
  }

  // Match reset: drop the aggro listener. Also self-detaches once removed from a world.
  dispose() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }

  // Rematch with the same object: full HP, a clean lock and ramp, and the aggro
  // listener re-armed — a rematch's world.clear() nulls `world`, after which the
  // next 'unitDamaged' would have self-detached it for good.
  reset() {
    this.revive();
    this.target = null;
    this.aggroHero = null;
    this.aggroUntil = -1;
    this.ramp = 1;
    this.fireTimer = 0;
    this.retargetTimer = 0;
    this._shotsOnHero = 0;
    this._rampHero = null;
    this._lastHeroShot = -1e9;
    if (!this._unsub) this._unsub = events.on('unitDamaged', this._onDamaged);
  }

  _handleDamaged(p) {
    if (!this.alive) return;
    if (!this.world) { this.dispose(); return; }
    const src = p.source;
    if (!src || p.unit.kind !== 'hero' || src.kind !== 'hero') return;
    if (p.unit.team !== this.team || src.team === this.team) return;
    if (!this._inRange(p.unit) || !this._inRange(src)) return;
    this.aggroHero = src;
    this.aggroUntil = this.world.time + AGGRO_WINDOW;
    this._retarget();
  }

  _inRange(u) {
    return distSqXZ(this.pos, u.pos) <= RANGE2;
  }

  _valid(u) {
    return u.alive && !u.invulnerable && this._inRange(u);
  }

  _setTarget(u) {
    if (u === this.target) return;
    this.target = u;
    this.fireTimer = ACQUIRE_DELAY;
    this._shotsOnHero = 0;
    this.ramp = 1;
  }

  // Hero locks are sticky; minion locks follow the priority list each tick.
  _retarget() {
    const world = this.world;
    const cur = this.target;
    if (cur && cur.kind === 'hero' && this._valid(cur)) return;
    let next = null;
    const a = this.aggroHero;
    if (a && world.time <= this.aggroUntil && this._valid(a)) {
      next = a;
    } else {
      next = world.nearestEnemy(this.pos, this.team, RANGE, 'minion');
      if (!next) next = world.nearestEnemy(this.pos, this.team, RANGE, 'hero');
    }
    this._setTarget(next);
  }

  update(dt) {
    const world = this.world;
    if (!world) return;
    if (this.target && !this._valid(this.target)) this._setTarget(null);
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0) {
      this.retargetTimer += RETARGET_PERIOD;
      this._retarget();
    }
    const t = this.target;
    if (!t) return;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer += INTERVAL;
      this._fire(t);
    }
  }

  _fire(t) {
    const now = this.world.time;
    let amount = MINION_DAMAGE;
    if (t.kind === 'hero') {
      if (t !== this._rampHero || now - this._lastHeroShot > RAMP_TIMEOUT) this._shotsOnHero = 0;
      let ramp = 1 + RAMP_STEP * this._shotsOnHero;
      if (ramp > RAMP_MAX) ramp = RAMP_MAX;
      this.ramp = ramp;
      this._shotsOnHero++;
      this._rampHero = t;
      this._lastHeroShot = now;
      amount = HERO_DAMAGE * ramp;
    }
    shots.fire(this.team, this.pos.x, MUZZLE_Y, this.pos.z, t, SHOT_SPEED);
    const dealt = t.takeDamage(amount, this, 'physical');
    shotPayload.tower = this;
    shotPayload.target = t;
    shotPayload.amount = dealt;
    shotPayload.ramp = t.kind === 'hero' ? this.ramp : 1;
    events.emit('towerShot', shotPayload);
  }

  die(source) {
    if (!this.alive) return;
    this.target = null;
    this.aggroHero = null;
    this.ramp = 1;
    super.die(source);
  }
}
