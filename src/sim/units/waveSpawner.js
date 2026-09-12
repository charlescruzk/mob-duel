// WaveSpawner — DESIGN.md §4 cadence: first wave at t = 15 s, then every 30 s; per team
// 3 melee + 2 ranged in formation, released one every 0.6 s, melee first. Dead minions
// are pooled and reset instead of allocated. Also ticks the shared shot-tracer pool so
// the integrator has one units update() to call.
import { events } from '../core/events.js';
import { POSITIONS, MINION_SLOTS, TEAMS } from '../map/laneData.js';
import { Minion } from './minion.js';
import { shots } from './shotPool.js';

const FIRST_WAVE = 15.0;
const WAVE_PERIOD = 30.0;
const SPAWN_STAGGER = 0.6;   // set to 0 for DESIGN.md's "all five the same tick"
const PER_TEAM = 5;

// Spawn order per team: melee front row, then ranged 2 m behind (toward own nexus).
const FORMATION = [];
for (let i = 0; i < MINION_SLOTS.melee.length; i++) {
  FORMATION.push({ ranged: false, x: MINION_SLOTS.melee[i], back: 0 });
}
for (let i = 0; i < MINION_SLOTS.ranged.length; i++) {
  FORMATION.push({ ranged: true, x: MINION_SLOTS.ranged[i], back: MINION_SLOTS.rangedBehind });
}

const wavePayload = { team: 'blue', index: 0 };
const spawnPos = { x: 0, y: 0, z: 0 };

export class WaveSpawner {
  constructor(world) {
    this.world = world;
    this.pool = [];
    this.waveIndex = 0;          // next wave to release (DESIGN.md `w`, starts at 0)
    this.nextWaveTime = FIRST_WAVE;
    this.waveStart = -1;         // release time of the wave currently staggering out
    this.releasing = false;
    this.released = [0, 0];      // per TEAMS index, 0..PER_TEAM of the current wave
  }

  // matchTime is optional; world.time is the default clock.
  update(dt, matchTime) {
    const now = matchTime === undefined ? this.world.time : matchTime;
    if (now < this.waveStart) this.reset();              // clock went backwards: match reset
    if (!this.releasing && now >= this.nextWaveTime) this._startWave(now);
    if (this.releasing) this._release(now);
    shots.update(dt);
  }

  _startWave(now) {
    this.waveStart = this.nextWaveTime;
    this.nextWaveTime += WAVE_PERIOD;
    this.releasing = true;
    this.released[0] = 0;
    this.released[1] = 0;
    for (let t = 0; t < TEAMS.length; t++) {
      wavePayload.team = TEAMS[t];
      wavePayload.index = this.waveIndex;
      events.emit('waveSpawned', wavePayload);
    }
  }

  _release(now) {
    let done = true;
    for (let t = 0; t < TEAMS.length; t++) {
      while (this.released[t] < PER_TEAM && now >= this.waveStart + this.released[t] * SPAWN_STAGGER) {
        this._spawn(TEAMS[t], FORMATION[this.released[t]], this.waveIndex);
        this.released[t]++;
      }
      if (this.released[t] < PER_TEAM) done = false;
    }
    if (done) {
      this.releasing = false;
      this.waveIndex++;
    }
  }

  _spawn(team, slot, wave) {
    const p = POSITIONS[team];
    spawnPos.x = p.minionSpawn.x + slot.x;
    spawnPos.z = p.minionSpawn.z - p.dir * slot.back;
    const m = this._takeDead(team, slot.ranged);
    if (m) {
      m.reset(spawnPos, wave);
      if (!m.world) this.world.add(m);
      return m;
    }
    const fresh = new Minion(team, this.world, spawnPos, { ranged: slot.ranged, wave });
    this.world.add(fresh);
    this.pool.push(fresh);
    return fresh;
  }

  _takeDead(team, ranged) {
    const pool = this.pool;
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i];
      if (!m.alive && m.team === team && m.ranged === ranged) return m;
    }
    return null;
  }

  aliveCount(team) {
    let n = 0;
    const pool = this.pool;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].alive && pool[i].team === team) n++;
    }
    return n;
  }

  // Full match reset: every pooled minion leaves the world; the clock
  // restarts at the first wave. Safe to call before or after world.clear().
  reset() {
    const pool = this.pool;
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i];
      m.alive = false;
      m.hp = 0;
      m.target = null;
      if (m.world) m.world.remove(m);
    }
    pool.length = 0;
    this.waveIndex = 0;
    this.nextWaveTime = FIRST_WAVE;
    this.waveStart = -1;
    this.releasing = false;
    this.released[0] = 0;
    this.released[1] = 0;
    shots.clear();
  }
}
