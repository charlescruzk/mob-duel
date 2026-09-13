// MirrorWorld — applies server snapshots onto REAL local unit objects (Hero, Minion,
// Tower, Nexus) in a local World that is never stepped. Every view system (unit views,
// HUD, animator, particles, audio) therefore works unchanged: they read the same
// fields they read in single player. Positions ease toward the latest snapshot;
// everything else is copied. Server events are re-emitted on the local bus with the
// mapped local units.
import { World } from '../../sim/core/world.js';
import { events } from '../../sim/core/events.js';
import { Hero } from '../../sim/hero/hero.js';
import { makeIntent } from '../../sim/hero/intent.js';
import { Minion } from '../../sim/units/minion.js';
import { Tower } from '../../sim/units/tower.js';
import { Nexus } from '../../sim/units/nexus.js';
import { effects } from '../../sim/hero/effects.js';
import { resolveItem, consumableEntry } from '../../sim/economy/items.js';
import { POSITIONS, WALL_BOXES, LANE_BOUNDS } from '../../sim/map/laneData.js';
import { resolveCircleVsBoxes, clampToBounds } from '../../sim/core/physics.js';

const EASE = 18;                 // 1/s: positions converge on the snapshot in ~60 ms
const CORRECT = 10;              // 1/s: how fast a prediction error is folded back in
const HISTORY = 64;              // predicted positions kept per intent tick (3.2 s)
const SNAP_DIST = 3.0;           // metres: beyond this, snap instead of easing
const spawnScratch = { x: 0, y: 0, z: 0 };
const minionOpts = { ranged: false, wave: 0 };
const payloads = {};             // reused per event name
const ID_KEYS = ['hero', 'unit', 'source', 'target'];
const ZERO3 = [0, 0, 0], ZERO4 = [0, 0, 0, 0], ZERO7 = [0, 0, 0, 0, 0, 0, 0];

export class MirrorWorld {
  constructor() {
    this.world = new World();
    this.byId = new Map();       // server id → local unit
    this.targets = new Map();    // local unit → { x, z, f }
    this.list = [];              // local units in snapshot order (allocation-free iteration)
    this.state = 'countdown';
    this.countdown = 3;
    this.winner = null;
    this.tick = 0;
    this.time = 0;
    this.eventsApplied = 0;
    this.snapshotsApplied = 0;
    this._seen = new Set();
    // Client-side prediction for the local hero's movement (docs/PHASE4.md): the
    // world carries the real collision so predicted steps clamp like the server's.
    this.world.setCollision(WALL_BOXES, LANE_BOUNDS);
    this.local = null; this.localSeat = -1;
    this.history = new Float32Array(HISTORY * 3);   // [tick, x, z] ring by tick
    this.errX = 0; this.errZ = 0;                   // pending correction
    this.corrections = 0; this.predictedFrames = 0;
  }

  setLocal(hero, seat) { this.local = hero; this.localSeat = seat; }

  // NetMatch calls this when it sends the intent for `tick`: remember where we were.
  recordPrediction(tick) {
    if (!this.local) return;
    const i = (tick % HISTORY) * 3;
    this.history[i] = tick; this.history[i + 1] = this.local.pos.x; this.history[i + 2] = this.local.pos.z;
  }

  hero(team) { return this.world.hero(team); }

  // Drain the client's queue: apply the newest snapshot, replay every event in order.
  applyPending(pending) {
    if (!pending.length) return;
    for (let i = 0; i < pending.length; i++) this._replayEvents(pending[i].ev);
    const snap = pending[pending.length - 1];
    pending.length = 0;
    this._apply(snap);
  }

  _apply(s) {
    this.tick = s.tick; this.time = s.time; this.state = s.state; this.countdown = s.cd; this.winner = s.winner;
    this.world.time = s.time;
    if (s.ack && this.localSeat >= 0) this._reconcile(s.ack[this.localSeat]);
    const seen = this._seen; seen.clear();
    for (let i = 0; i < s.u.length; i++) {
      const o = s.u[i];
      let u = this.byId.get(o.id);
      if (!u) u = this._create(o);
      seen.add(o.id);
      this._applyUnit(u, o);
    }
    // Units the server dropped (dead minions) leave the local world too — only a
    // full snapshot can say that; partial ones carry heroes alone.
    if (!s.partial) for (const [id, u] of this.byId) {
      if (seen.has(id)) continue;
      this.byId.delete(id);
      this.targets.delete(u);
      const k = this.list.indexOf(u); if (k >= 0) this.list.splice(k, 1);
      if (u.world) this.world.remove(u);
    }
    this.world._flushRemovals();
    this._applyEffects(s.fx);
    this.snapshotsApplied++;
  }

  // Compare the server's position for the acked tick with what we predicted then;
  // the difference is folded into the current prediction over the next frames.
  _reconcile(ack) {
    if (ack < 0 || !this.local) return;
    const i = (ack % HISTORY) * 3;
    if (this.history[i] !== ack) return;
    this._ackX = this.history[i + 1]; this._ackZ = this.history[i + 2]; this._ackValid = true;
  }

  _create(o) {
    let u = null;
    if (o.k === 'hero') { u = new Hero(o.hk, o.tm, this.world); u.intent = makeIntent(); }
    else if (o.k === 'minion') { spawnScratch.x = o.x; spawnScratch.z = o.z; minionOpts.ranged = !!o.rg; minionOpts.wave = o.wv | 0; u = new Minion(o.tm, this.world, spawnScratch, minionOpts); }
    else if (o.k === 'tower') u = new Tower(o.tm, this.world, POSITIONS[o.tm].tower);
    else u = new Nexus(o.tm, this.world, POSITIONS[o.tm].nexus);
    u.pos.x = o.x; u.pos.z = o.z; u.facing = o.f;
    u.prevPos.copy(u.pos);
    this.world.add(u);
    this.byId.set(o.id, u);
    this.targets.set(u, { x: o.x, z: o.z, f: o.f });
    this.list.push(u);
    return u;
  }

  _applyUnit(u, o) {
    const t = this.targets.get(u);
    t.x = o.x; t.z = o.z; t.f = o.f;
    if (u === this.local && this._predicting(u)) {
      if (this._ackValid) {
        const ex = o.x - this._ackX, ez = o.z - this._ackZ;
        this._ackValid = false;
        if (Math.abs(ex) > SNAP_DIST || Math.abs(ez) > SNAP_DIST) { u.pos.x = o.x; u.pos.z = o.z; u.prevPos.copy(u.pos); this.errX = 0; this.errZ = 0; }
        else { this.errX = ex; this.errZ = ez; }
        if (ex !== 0 || ez !== 0) this.corrections++;
      }
    } else if (Math.abs(u.pos.x - o.x) > SNAP_DIST || Math.abs(u.pos.z - o.z) > SNAP_DIST) { u.pos.x = o.x; u.pos.z = o.z; u.prevPos.copy(u.pos); }
    u.hp = o.hp; u.maxHp = o.mhp; u.shield = o.sh || 0; u.alive = o.d !== 1; u.invulnerable = o.inv === 1;
    if (o.k === 'minion') {
      const st = o.st || ZERO4;
      u.stunTimer = st[0]; u.slowTimer = st[1]; u.slowPct = st[2]; u.rootTimer = st[3]; u.wave = o.wv;
      return;
    }
    if (o.k !== 'hero') return;
    const ab = u.abilities, at = u.attack;
    u.level = o.lv; u.xp = o.xp; u.mp = o.mp; u.maxMp = o.mmp; u.gold = o.g;
    u.cooldowns.q = o.cd[0]; u.cooldowns.w = o.cd[1]; u.cooldowns.e = o.cd[2]; u.cooldowns.r = o.cd[3];
    const st = o.st || ZERO7;
    ab.stunTimer = st[0]; ab.slowTimer = st[1]; ab.slowPct = st[2]; ab.rootTimer = st[3];
    ab.stealthTimer = st[4]; ab.hasteTimer = st[5]; ab.shieldTimer = st[6];
    const atk = o.atk || ZERO3;
    at.timer = atk[0]; at.windup = atk[1]; at.target = atk[2] ? (this.byId.get(atk[2]) || null) : null;
    if (o.cast) { ab.cast.slot = o.cast[0]; ab.cast.timer = o.cast[1]; ab.cast.def = u.data.abilities[o.cast[0]] || null; }
    else { ab.cast.slot = ''; ab.cast.timer = 0; ab.cast.def = null; }
    if (o.dash) { ab.dash.active = true; ab.dash.dx = o.dash[1]; ab.dash.dz = o.dash[2]; }
    else ab.dash.active = false;
    u.isRecalling = !!o.rc; u.recallTimer = o.rc ? o.rc[1] : 0;
    u.respawnTimer = o.rs || 0;
    u.kills = o.ks; u.deaths = o.ds;
    this._applyItems(u, o.it, o.ic);
  }

  _applyItems(u, indices, counts) {
    const inv = u.items;
    let same = inv.length === indices.length;
    for (let i = 0; same && i < inv.length; i++) if (inv[i].index !== indices[i] || (inv[i].count || 0) !== (counts[i] || 0)) same = false;
    if (same) return;
    inv.length = 0;
    for (let i = 0; i < indices.length; i++) {
      const def = resolveItem(indices[i]);
      if (!def) continue;
      if (def.consumable) { const e = consumableEntry(def); e.count = counts[i] || 1; inv.push(e); }
      else inv.push(def);
    }
  }

  _applyEffects(fx) {
    const P = effects.projectiles, R = effects.rings, Z = effects.zones;
    for (let i = 0; i < P.length; i++) P[i].active = false;
    for (let i = 0; i < R.length; i++) R[i].active = false;
    for (let i = 0; i < Z.length; i++) Z[i].active = false;
    for (let i = 0; i < fx.p.length; i++) {
      const a = fx.p[i], p = P[a[0]]; if (!p) continue;
      p.active = true; p.pos.x = a[1]; p.pos.y = a[2]; p.pos.z = a[3]; p.color = a[4]; p.radius = a[5]; p.slot = a[6]; p.team = a[7];
    }
    this._discs(fx.rg, R); this._discs(fx.zn, Z);
  }

  _discs(list, pool) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i], d = pool[a[0]]; if (!d) continue;
      d.active = true; d.x = a[1]; d.z = a[2]; d.radius = a[3]; d.life = a[4]; d.maxLife = a[5]; d.color = a[6];
      d.alpha = d.baseAlpha * (d.maxLife > 0 ? d.life / d.maxLife : 1);
    }
  }

  _replayEvents(ev) {
    if (!ev) return;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      let p = payloads[e.n];
      if (!p) { p = {}; payloads[e.n] = p; }
      for (const k in e) {
        if (k === 'n') continue;
        p[k] = ID_KEYS.indexOf(k) >= 0 ? (this.byId.get(e[k]) || null) : e[k];
      }
      if ((e.n === 'unitDied' || e.n === 'unitDamaged' || e.n === 'unitHealed') && !p.unit) continue;
      if ((e.n === 'abilityCast' || e.n === 'heroDied' || e.n === 'heroRespawned' || e.n === 'heroLevelUp' || e.n === 'recallStarted' || e.n === 'recallEnded') && !p.hero) continue;
      events.emit(e.n, p);
      this.eventsApplied++;
    }
  }

  _predicting(u) { return u.alive && !u.abilities.dash.active && !u.stunned && !u.abilities.rooted && !u.isCasting && !u.isRecalling; }

  // Per frame: ease positions toward targets, derive velocity, mirror into meshes.
  update(dt) {
    const k = 1 - Math.exp(-EASE * dt);
    const inv = dt > 0 ? 1 / dt : 0;
    const list = this.list;
    const kc = 1 - Math.exp(-CORRECT * dt);
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const t = this.targets.get(u);
      if (u === this.local && this._predicting(u)) {
        u._move(dt, u.intent);
        if (this.world.boxes.length) resolveCircleVsBoxes(u.pos, u.radius, this.world.boxes);
        if (this.world.bounds) clampToBounds(u.pos, u.radius, this.world.bounds);
        u.pos.x += this.errX * kc; u.pos.z += this.errZ * kc;
        this.errX -= this.errX * kc; this.errZ -= this.errZ * kc;
        this.predictedFrames++;
        // Facing: the server's while acting, our own while walking.
        if (u.intent.moveX === 0 && u.intent.moveZ === 0) { let df0 = t.f - u.facing; while (df0 > Math.PI) df0 -= Math.PI * 2; while (df0 < -Math.PI) df0 += Math.PI * 2; u.facing += df0 * k; }
        u.vel.x = (u.pos.x - u.prevPos.x) * inv; u.vel.z = (u.pos.z - u.prevPos.z) * inv;
        u.prevPos.copy(u.pos); u.syncMesh();
        continue;
      }
      u.pos.x += (t.x - u.pos.x) * k;
      u.pos.z += (t.z - u.pos.z) * k;
      let df = t.f - u.facing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      u.facing += df * k;
      u.vel.x = (u.pos.x - u.prevPos.x) * inv;
      u.vel.z = (u.pos.z - u.prevPos.z) * inv;
      u.prevPos.copy(u.pos);
      u.syncMesh();
    }
  }
}
