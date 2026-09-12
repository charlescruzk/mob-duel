// Nexus — the win condition (DESIGN.md §6). Static, no attack, 2500 HP. Untargetable
// and undamageable while the same team's tower stands: `invulnerable` is kept in sync
// every frame (so world.nearestEnemy skips it) and takeDamage is refused outright.
import { Unit } from '../core/unit.js';
import { events } from '../core/events.js';
import { RADII } from '../map/laneData.js';

const HP = 2500;
const destroyedPayload = { team: 'blue' };

export class Nexus extends Unit {
  // pos is copied. Caller does world.add(nexus) and nexus.setTower(tower).
  constructor(team, world, pos) {
    super('nexus', team, RADII.nexus, HP, 0);
    this.isStatic = true;
    this.world = world;                  // World.add overwrites with the same value
    this.goldValue = 0;
    this.xpValue = 0;
    this.tower = null;
    this.invulnerable = true;            // no tower registered yet → assume shielded
    this.pos.copy(pos);
    this.pos.y = 0;
  }

  setTower(tower) {
    this.tower = tower || null;
    this._syncShield();
  }

  // Rematch with the same object: full HP, shielded again once its tower is back.
  reset() {
    this.revive();
    this._syncShield();
  }

  get shielded() {
    return !!(this.tower && this.tower.alive);
  }

  _syncShield() {
    this.invulnerable = this.shielded;
  }

  update(dt) {
    this._syncShield();
  }

  takeDamage(amount, source, dtype = 'physical') {
    if (this.shielded) return 0;
    this.invulnerable = false;
    return super.takeDamage(amount, source, dtype);
  }

  die(source) {
    if (!this.alive) return;
    super.die(source);
    destroyedPayload.team = this.team;
    events.emit('nexusDestroyed', destroyedPayload);
  }
}
