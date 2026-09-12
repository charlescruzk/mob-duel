// AbilityFx (PHASE2.md §5): maps (heroKey, slot) → colour + emitter recipe and turns
// the sim's event stream into particles. Also owns the hit flash (0.1 s 8 % scale pop
// — minion materials are shared per team, so emissive flashes would light them all)
// and the camera kick on R casts and own death. Listens; never mutates sim state.
import * as THREE from 'three';
import { events } from '../../sim/core/events.js';
import { TEAM_COLOR } from '../../sim/map/laneData.js';

const TRAIL_COLOR = new THREE.Color();   // scratch: projectile records carry a hex

// Emitter recipes per ability. b = burst(x,y,z,hex,count,speed,up,life,size),
// r = ring(x,z,hex,count,radius,speed,life,size), c = column(x,z,hex,count,height,life,size).
// `hit` is the impact colour used for every landing of that hero's kit.
const RECIPES = {
  brakk: {
    hit: 0xc8ccd0,
    q: ['b', 14, 7, 0.7, 0.4, 0.16], w: ['r', 20, 0.4, 3, 0.5, 0.18],
    e: ['b', 16, 9, 0.4, 0.35, 0.15], r: ['c', 26, 1.4, 0.7, 0.2],
    auto: ['b', 5, 5, 0.5, 0.25, 0.12],
  },
  ilyra: {
    hit: 0xff8a3c,
    q: ['b', 14, 8, 0.6, 0.4, 0.16], w: ['b', 18, 6, 1.0, 0.45, 0.17],
    e: ['r', 16, 0.2, 4, 0.4, 0.15], r: ['c', 30, 1.4, 0.7, 0.22],
    auto: ['b', 4, 4, 0.6, 0.3, 0.11],
  },
  vaskra: {
    hit: 0x9fd6ff,
    q: ['b', 14, 9, 0.5, 0.4, 0.15], w: ['r', 18, 0.3, 3.5, 0.45, 0.15],
    e: ['b', 12, 6, 0.4, 0.3, 0.14], r: ['c', 26, 1.6, 0.6, 0.2],
    auto: ['b', 4, 4, 0.5, 0.35, 0.11],
  },
  kesh: {
    hit: 0xb06be0,
    q: ['b', 16, 8, 0.6, 0.4, 0.16], w: ['r', 20, 0.2, 3.5, 0.5, 0.16],
    e: ['b', 20, 7, 0.8, 0.4, 0.16], r: ['b', 30, 10, 1.0, 0.5, 0.2],
    auto: ['b', 5, 5, 0.5, 0.3, 0.12],
  },
  halvard: {
    hit: 0xaab8c4,
    q: ['b', 18, 6, 0.5, 0.4, 0.18], w: ['r', 16, 0.5, 3, 0.5, 0.18],
    e: ['b', 20, 8, 0.6, 0.4, 0.17], r: ['c', 30, 1.8, 0.8, 0.22],
    auto: ['b', 5, 4, 0.4, 0.35, 0.13],
  },
  lumen: {
    hit: 0x48c0d8,
    q: ['b', 14, 7, 0.5, 0.4, 0.16], w: ['r', 18, 0.4, 3, 0.5, 0.16],
    e: ['r', 22, 1.5, 5, 0.5, 0.17], r: ['c', 30, 1.8, 0.8, 0.2],
    auto: ['b', 4, 4, 0.5, 0.35, 0.11],
  },
};

const FLASH_POOL = 16;
const FLASH_TIME = 0.1;
const FLASH_POP = 0.08;

// One fixed flash slot per flashing unit (scale pops 8 % and decays back).
class Flash {
  constructor() { this.unit = null; this.timer = 0; }
}

export class AbilityFx {
  constructor(particles, effects, camera, playerHero) {
    this.particles = particles;
    this.effects = effects;
    this.camera = camera;
    this.playerHero = playerHero || null;
    this.flashes = [];
    for (let i = 0; i < FLASH_POOL; i++) this.flashes.push(new Flash());
    this._offs = [
      events.on('abilityCast', (p) => this._onCast(p)),
      events.on('abilityHit', (p) => this._onHit(p)),
      events.on('unitDamaged', (p) => this._onDamaged(p)),
      events.on('unitDied', (p) => this._onDied(p)),
      events.on('heroLevelUp', (p) => this._onLevel(p)),
      events.on('recallStarted', (p) => this._onRecall(p)),
      events.on('heroRespawned', (p) => this._onRespawn(p)),
      events.on('heroDied', (p) => this._onHeroDied(p)),
    ];
  }

  _recipe(heroKey, slot) {
    const kit = RECIPES[heroKey];
    return kit && kit[slot] ? kit[slot] : null;
  }

  // rec: ['b', count, speed, up, life, size] | ['r', count, radius, speed, life, size]
  //      | ['c', count, height, life, size]
  _emit(rec, x, y, z, hex) {
    const kind = rec[0], p = this.particles;
    if (kind === 'b') p.burst(x, y, z, hex, rec[1], rec[2], rec[3], rec[4], rec[5]);
    else if (kind === 'r') p.ring(x, z, hex, rec[1], rec[2], rec[3], rec[4], rec[5]);
    else p.column(x, z, hex, rec[1], rec[2], rec[3], rec[4]);
  }

  _onCast(p) {
    const hero = p.hero;
    if (!hero || !hero.alive) return;
    const rec = this._recipe(hero.heroKey, p.slot);
    if (rec) this._emit(rec, hero.pos.x, 0.9, hero.pos.z, RECIPES[hero.heroKey].hit);
    // Camera kick on ultimate wind-ups: the player's own R bites harder.
    if (p.slot === 'r' && this.camera && this.camera.shake) {
      this.camera.shake(hero === this.playerHero ? 0.28 : 0.14, 0.3);
    }
  }

  _onHit(p) {
    const hero = p.hero, unit = p.unit;
    if (!hero || !unit || !unit.pos) return;
    const kit = RECIPES[hero.heroKey];
    this.particles.burst(unit.pos.x, 0.9, unit.pos.z, kit ? kit.hit : 0xffffff, 8, 5, 0.8, 0.35, 0.14);
  }

  _onDamaged(p) {
    const unit = p.unit;
    if (!unit || !unit.mesh || !unit.alive) return;
    this._flash(unit);
  }

  _onDied(p) {
    const unit = p.unit;
    if (!unit || !unit.pos) return;
    this.particles.burst(unit.pos.x, 0.7, unit.pos.z, TEAM_COLOR[unit.team] || 0xffffff, 24, 8, 1.2, 0.55, 0.18);
    // Free a flash slot that would otherwise hold a dead unit's scale.
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      if (f.unit === unit) { f.unit = null; f.timer = 0; unit.mesh.scale.setScalar(1); }
    }
  }

  _onLevel(p) {
    const hero = p.hero;
    if (!hero || !hero.pos) return;
    this.particles.ring(hero.pos.x, hero.pos.z, 0xffd23e, 22, 0.6, 3.2, 0.6, 0.2);
  }

  _onRecall(p) {
    const hero = p.hero;
    if (!hero || !hero.pos) return;
    this.particles.column(hero.pos.x, hero.pos.z, TEAM_COLOR[hero.team] || 0xffffff, 18, 2.2, 0.7, 0.16);
  }

  _onRespawn(p) {
    const hero = p.hero;
    if (!hero || !hero.pos) return;
    this.particles.burst(hero.pos.x, 0.6, hero.pos.z, TEAM_COLOR[hero.team] || 0xffffff, 20, 6, 1.1, 0.5, 0.18);
  }

  _onHeroDied(p) {
    const hero = p.hero;
    if (!hero || !hero.pos) return;
    // Own death kicks hard; the enemy's death is just the unitDied burst.
    if (hero === this.playerHero && this.camera && this.camera.shake) this.camera.shake(0.4, 0.45);
  }

  _flash(unit) {
    let f = null;
    for (let i = 0; i < this.flashes.length; i++) {
      if (this.flashes[i].unit === unit) { f = this.flashes[i]; break; }
      if (!f && !this.flashes[i].unit) f = this.flashes[i];
    }
    if (!f) return;
    f.unit = unit;
    f.timer = FLASH_TIME;
  }

  // Per frame: decay flashes, emit projectile trails. No allocation.
  update(dt) {
    const flashes = this.flashes;
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      if (!f.unit) continue;
      f.timer -= dt;
      const t = f.timer > 0 ? f.timer / FLASH_TIME : 0;
      if (t <= 0 || !f.unit.alive || !f.unit.mesh) {
        if (f.unit.mesh) f.unit.mesh.scale.setScalar(1);
        f.unit = null; f.timer = 0;
      } else {
        f.unit.mesh.scale.setScalar(1 + FLASH_POP * t);
      }
    }
    const list = this.effects ? this.effects.projectiles : null;
    if (list) {
      const trail = this.particles.trailRgb;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.active) trail.call(this.particles, p.pos.x, p.pos.y, p.pos.z, TRAIL_COLOR.setHex(p.color), 0.13);
      }
    }
  }

  reset() {
    const flashes = this.flashes;
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      if (f.unit && f.unit.mesh) f.unit.mesh.scale.setScalar(1);
      f.unit = null; f.timer = 0;
    }
  }

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
  }
}