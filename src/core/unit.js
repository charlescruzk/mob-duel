// Unit — the base class of every hero, minion, tower and nexus. Holds the fields the
// world, physics, HUD and bot read, and the one damage entry point. Subclasses set
// stats in their constructor and override update(dt).
import { Vec3 } from './vec.js';
import { events } from './events.js';

let nextId = 1;

// Reused payloads: emitted synchronously, listeners must not keep the reference.
const damagedPayload = { unit: null, amount: 0, source: null, dtype: 'physical' };
const diedPayload = { unit: null, source: null };
const healedPayload = { unit: null, amount: 0 };

export class Unit {
  // kind: 'hero' | 'minion' | 'tower' | 'nexus'. team: 'blue' | 'red'.
  constructor(kind, team, radius, maxHp, armor = 0) {
    this.id = nextId++;
    this.kind = kind;
    this.team = team;
    this.pos = new Vec3();
    this.prevPos = new Vec3();
    this.vel = new Vec3();      // written by World.update; read by the bot for aim lead
    this.facing = 0;                     // yaw in radians; 0 faces -Z (Three.js forward)
    this.radius = radius;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.armor = armor;                  // 0..1 fraction; damageTaken = raw × (1 − armor)
    this.shield = 0;                     // absorbed before HP; heroes set this (W Bulwark)
    this.alive = true;
    this.invulnerable = false;           // nexus while its tower stands; skipped by nearestEnemy
    this.isStatic = false;               // tower/nexus: never pushed by separation
    this.noCollide = false;              // skip circle separation entirely (dead/ghost)
    this.moveSpeed = 0;
    this.mesh = null;                    // view-owned slot, filled by fx/unitViews.js
    this.rig = null;                     // view-owned joint table (fx/rig.js)
    this.world = null;                   // set by World.add
  }

  // Returns the HP actually removed (0 when refused). dtype: 'physical' | 'magic' | 'true'.
  // 'true' ignores armor and shields. Source is the Unit that owns the damage instance
  // (hero for abilities/autos, minion, tower) or null (fountain laser). `reflected`
  // marks damage returned by a Stonewall-style reflect so reflected damage is itself
  // never reflected (no loops) and skips mitigation on the way out.
  takeDamage(amount, source, dtype = 'physical', reflected = false) {
    if (!this.alive || this.invulnerable || amount <= 0) return 0;
    if (!reflected && source && this.abilities && this.abilities.reflectTimer > 0 &&
        typeof source.takeDamage === 'function') {
      source.takeDamage(amount * this.abilities.reflectVal, this, 'magic', true);
    }
    let dmg = dtype === 'true' ? amount : amount * (1 - this.armor);
    if (dtype !== 'true' && this.shield > 0) {
      const absorbed = dmg < this.shield ? dmg : this.shield;
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg > this.hp) dmg = this.hp;
    this.hp -= dmg;
    damagedPayload.unit = this;
    damagedPayload.amount = dmg;
    damagedPayload.source = source;
    damagedPayload.dtype = dtype;
    events.emit('unitDamaged', damagedPayload);
    if (this.hp <= 0) this.die(source);
    return dmg;
  }

  heal(n) {
    if (!this.alive || n <= 0) return 0;
    const room = this.maxHp - this.hp;
    const got = n < room ? n : room;
    this.hp += got;
    if (got > 0) {
      healedPayload.unit = this;
      healedPayload.amount = got;
      events.emit('unitHealed', healedPayload);
    }
    return got;
  }

  die(source) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.shield = 0;
    this.vel.set(0, 0, 0);
    diedPayload.unit = this;
    diedPayload.source = source;
    events.emit('unitDied', diedPayload);
  }

  // Bring a dead unit back at full HP (heroes respawn; nothing else does in the slice).
  revive() {
    this.alive = true;
    this.hp = this.maxHp;
    this.shield = 0;
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
  }

  // Move instantly (recall, respawn, blink) without a one-frame velocity spike.
  teleport(x, z) {
    this.pos.x = x; this.pos.z = z;
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
  }

  update(dt) { /* subclasses override; called only while alive */ }

  // Mirrors pos/facing into the view's mesh when one is attached (no-op headless).
  syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
  }
}
