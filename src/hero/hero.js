// Hero — a playable unit driven purely by a HeroIntent (DESIGN.md §3, §7). Stats are
// resolved from heroData base + level + items; casting lives in AbilitySystem, autos
// in BasicAttack. Edge-detects q/w/e/r/recall itself. Emits the contract events.
import { Unit } from '../core/unit.js';
import { events } from '../core/events.js';
import { distXZ } from '../core/physics.js';
import { POSITIONS, RADII, enemyOf, isInFountain } from '../map/laneData.js';
import {
  HEROES, SLOTS, atLevel, respawnTime, MAX_LEVEL, XP_TO_LEVEL, XP_SHARE_RADIUS,
  RECALL_TIME, FOUNTAIN_REGEN_PCT, FOUNTAIN_LASER_DPS, CDR_CAP, HERO_KILL_GOLD,
} from './heroData.js';
import { AbilitySystem } from './abilities.js';
import { BasicAttack } from './heroAttack.js';
import { buildHeroMesh } from './heroMesh.js';
import { effects } from './effects.js';

const START_GOLD = 400, EPS = 1e-6;
const INVENTORY_SLOTS = 6;
const ITEM_KEYS = ['moveSpeed', 'attackDamage', 'abilityAmp', 'maxHp', 'hpRegen', 'maxMp', 'mpRegen', 'cdr'];

// Reused payloads (EventBus rule: listeners copy fields out).
const levelPayload = { hero: null, level: 1 };
const goldPayload = { hero: null, gold: 0 };
const castPayload = { hero: null, slot: 'q', key: 'q' };
const respawnPayload = { hero: null };
const recallPayload = { hero: null, completed: false };
const diedPayload = { hero: null, source: null };

export class Hero extends Unit {
  constructor(heroKey, team, world, scene) {
    const data = HEROES[heroKey];
    if (!data) throw new Error('unknown hero: ' + heroKey);
    super('hero', team, RADII.hero, atLevel(data.hp, 1), atLevel(data.armor, 1));
    this.heroKey = heroKey;
    this.data = data;
    this.world = world;
    this.intent = null;
    this.prevIntent = { q: false, w: false, e: false, r: false, recall: false };
    this.level = 1; this.xp = 0; this.gold = START_GOLD;
    this.kills = 0; this.deaths = 0;
    this.items = [];                        // up to INVENTORY_SLOTS item defs
    this.itemStats = { moveSpeed: 0, attackDamage: 0, abilityAmp: 0, maxHp: 0, hpRegen: 0, maxMp: 0, mpRegen: 0, cdr: 0 };
    this.maxMp = 0; this.mp = 0; this.hpRegen = 0; this.mpRegen = 0;
    this.attackDamage = 0; this.attackRange = data.attackRange; this.attackInterval = data.attackInterval;
    this.abilityAmp = 0; this.cdr = 0;
    this.goldValue = HERO_KILL_GOLD;
    this.respawnTimer = 0;
    this.isRecalling = false; this.recallTimer = 0;
    this.abilities = new AbilitySystem(this, data);
    this.cooldowns = this.abilities.cooldowns;
    this.costs = this.abilities.costs;
    this.attack = new BasicAttack(this);
    this.recomputeStats();
    this.hp = this.maxHp; this.mp = this.maxMp;

    const built = buildHeroMesh(heroKey, team);
    this.mesh = built.group;
    this.shieldMesh = built.shield;
    if (scene) scene.add(this.mesh);
    this.pos.copy(POSITIONS[team].heroSpawn);
    this.facing = team === 'blue' ? 0 : Math.PI;
    this.syncMesh();
    effects.attach(scene, world);
    this._onUnitDied = (p) => this._handleUnitDied(p.unit, p.source);
    this._unsub = events.on('unitDied', this._onUnitDied);
  }

  // Contract read-throughs.
  get xpValue() { return 120 + 30 * this.level; }
  get isCasting() { return this.abilities.isCasting; }
  get stunTimer() { return this.abilities.stunTimer; }
  get slowTimer() { return this.abilities.slowTimer; }
  get slowPct() { return this.abilities.slowPct; }
  get stunned() { return this.abilities.stunned; }
  get inFountain() { return isInFountain(this.pos, this.team); }

  abilityState(slot) { return this.abilities.state(slot); }
  ready(slot) { return this.abilities.ready(slot); }

  recomputeStats() {
    const d = this.data, L = this.level, s = this.itemStats;
    this.maxHp = atLevel(d.hp, L) + s.maxHp;
    this.maxMp = atLevel(d.mp, L) + s.maxMp;
    this.hpRegen = atLevel(d.hpRegen, L) + s.hpRegen;
    this.mpRegen = atLevel(d.mpRegen, L) + s.mpRegen;
    this.moveSpeed = d.moveSpeed + s.moveSpeed;
    this.attackDamage = atLevel(d.attackDamage, L) + s.attackDamage;
    this.armor = atLevel(d.armor, L);
    this.abilityAmp = s.abilityAmp;
    this.cdr = s.cdr > CDR_CAP ? CDR_CAP : s.cdr;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.mp > this.maxMp) this.mp = this.maxMp;
  }

  // --- per-frame ---------------------------------------------------------

  update(dt, intent = this.intent, world = this.world) {
    const sys = this.abilities;
    this._regen(dt);
    if (isInFountain(this.pos, enemyOf(this.team))) {
      this.takeDamage(FOUNTAIN_LASER_DPS * dt, null, 'true');
      if (!this.alive) return;
    }
    const ax = intent ? intent.aimX : this.pos.x;
    const az = intent ? intent.aimZ : this.pos.z;
    sys.update(dt, world, ax, az);
    if (!this.alive) return;
    if (sys.stunned) { this.cancelRecall(); this.attack.interrupt(); }
    if (intent) {
      this._edges(intent, ax, az);
      this._recall(dt, intent);
      this._move(dt, intent);
      this.attack.update(dt, intent, world);
      if (!sys.dash.active && (intent.attack || this.attack.active || sys.isCasting)) {
        this.facing = Math.atan2(-(ax - this.pos.x), -(az - this.pos.z));
      }
    }
    if (this.shieldMesh) this.shieldMesh.visible = this.shield > 0;
  }

  _regen(dt) {
    const f = this.inFountain ? FOUNTAIN_REGEN_PCT : 0;
    this.hp += (this.hpRegen + f * this.maxHp) * dt;
    this.mp += (this.mpRegen + f * this.maxMp) * dt;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.mp > this.maxMp) this.mp = this.maxMp;
  }

  _edges(intent, ax, az) {
    const prev = this.prevIntent;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      const v = !!intent[s];
      if (v && !prev[s] && this.abilities.tryCast(s, ax, az)) {
        this.cancelRecall();
        castPayload.hero = this; castPayload.slot = s; castPayload.key = s;
        events.emit('abilityCast', castPayload);
      }
      prev[s] = v;
    }
    const r = !!intent.recall;
    if (r && !prev.recall) this.startRecall();
    prev.recall = r;
  }

  _recall(dt, intent) {
    if (!this.isRecalling) return;
    if (intent.moveX !== 0 || intent.moveZ !== 0 || intent.attack || this.stunned || this.isCasting) {
      this.cancelRecall();
      return;
    }
    this.recallTimer -= dt;
    if (this.recallTimer > EPS) return;
    this.isRecalling = false; this.recallTimer = 0;
    const sp = POSITIONS[this.team].heroSpawn;
    this.teleport(sp.x, sp.z);
    recallPayload.hero = this; recallPayload.completed = true;
    events.emit('recallEnded', recallPayload);
  }

  _move(dt, intent) {
    if (this.stunned || this.abilities.rooted || this.isCasting || this.isRecalling) return;
    const mx = intent.moveX, mz = intent.moveZ;
    if (mx === 0 && mz === 0) return;
    const v = this.moveSpeed * this.abilities.speedMult * dt;
    this.pos.x += mx * v;
    this.pos.z += mz * v;
    this.facing = Math.atan2(-mx, -mz);
  }

  onAttackStart() { this.cancelRecall(); }

  startRecall() {
    if (!this.alive || this.isRecalling || this.stunned || this.isCasting) return false;
    this.isRecalling = true;
    this.recallTimer = RECALL_TIME;
    recallPayload.hero = this; recallPayload.completed = false;
    events.emit('recallStarted', recallPayload);
    return true;
  }

  cancelRecall() {
    if (!this.isRecalling) return;
    this.isRecalling = false; this.recallTimer = 0;
    recallPayload.hero = this; recallPayload.completed = false;
    events.emit('recallEnded', recallPayload);
  }

  // kind: 'slow' | 'stun' | 'haste' | 'shield' | 'root' | 'stealth' |
  //       'attackSpeed' | 'armorBuff' | 'reflect' | 'bonusNextAuto' (PHASE2.md §3.5).
  applyStatus(kind, seconds, magnitude) {
    if (!this.alive) return;
    this.abilities.applyStatus(kind, seconds, magnitude);
    if (kind === 'stun') { this.cancelRecall(); this.attack.interrupt(); }
  }

  // --- death / respawn ---------------------------------------------------

  die(source) {
    if (!this.alive) return;
    this.deaths++;
    this.respawnTimer = respawnTime(this.level);
    this.cancelRecall();
    this.abilities.clearStatus();
    this.attack.reset();
    if (this.shieldMesh) this.shieldMesh.visible = false;
    super.die(source);
    diedPayload.hero = this; diedPayload.source = source;
    events.emit('heroDied', diedPayload);
  }

  tickDead(dt) {
    this.abilities.tickCooldowns(dt);
    this.respawnTimer -= dt;
    if (this.respawnTimer <= EPS) this.respawn();
  }

  respawn() {
    this.respawnTimer = 0;
    this.abilities.clearStatus();
    this.attack.reset();
    this.isRecalling = false; this.recallTimer = 0;
    this.revive();
    this.mp = this.maxMp;
    const sp = POSITIONS[this.team].heroSpawn;
    this.teleport(sp.x, sp.z);
    this.facing = this.team === 'blue' ? 0 : Math.PI;
    this.syncMesh();
    respawnPayload.hero = this;
    events.emit('heroRespawned', respawnPayload);
  }

  // --- progression -------------------------------------------------------

  _handleUnitDied(unit, source) {
    if (unit === this || unit.team === this.team) return;
    if (unit.kind === 'hero' && source === this) this.kills++;
    if (!Hero.xpFromEvents) return;
    const xp = unit.xpValue || 0;
    if (!xp) return;
    if (source === this) { this.addXp(xp); return; }
    if (unit.kind === 'tower') { if (source && source.team === this.team) this.addXp(xp); return; }
    if (this.alive && distXZ(unit.pos, this.pos) <= XP_SHARE_RADIUS) this.addXp(xp);
  }

  addXp(n) {
    if (n <= 0) return;
    this.xp += n;
    while (this.level < MAX_LEVEL && this.xp >= XP_TO_LEVEL[this.level + 1]) {
      this.level++;
      this.recomputeStats();             // level-up does not heal
      levelPayload.hero = this; levelPayload.level = this.level;
      events.emit('heroLevelUp', levelPayload);
    }
  }

  addGold(n) {
    this.gold += n;
    goldPayload.hero = this; goldPayload.gold = this.gold;
    events.emit('goldChanged', goldPayload);
  }

  // Shop calls this after paying. Raising max HP/MP raises current by the same amount.
  applyItem(def) {
    if (!def || this.items.length >= INVENTORY_SLOTS) return false;
    this.items.push(def);
    const s = this.itemStats;
    for (let k = 0; k < ITEM_KEYS.length; k++) s[ITEM_KEYS[k]] = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      for (let k = 0; k < ITEM_KEYS.length; k++) s[ITEM_KEYS[k]] += it[ITEM_KEYS[k]] || 0;
    }
    if (s.cdr > CDR_CAP) s.cdr = CDR_CAP;
    this.recomputeStats();
    this.hp += def.maxHp || 0; if (this.hp > this.maxHp) this.hp = this.maxHp;
    this.mp += def.maxMp || 0; if (this.mp > this.maxMp) this.mp = this.maxMp;
    return true;
  }

  // Full match reset (level, gold, items, cooldowns, position).
  reset() {
    this.level = 1; this.xp = 0; this.gold = START_GOLD; this.kills = 0; this.deaths = 0;
    this.items.length = 0;
    for (let k = 0; k < ITEM_KEYS.length; k++) this.itemStats[ITEM_KEYS[k]] = 0;
    this.abilities.resetAll();
    this.attack.reset();
    this.isRecalling = false; this.recallTimer = 0;
    this.prevIntent.q = this.prevIntent.w = this.prevIntent.e = this.prevIntent.r = this.prevIntent.recall = false;
    this.recomputeStats();
    this.respawn();
  }

  dispose() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

// GoldSystem (src/economy/gold.js) awards XP on 'unitDied'; the hero's own XP listener
// stays off so XP is never granted twice. Flip to true only when running without it.
Hero.xpFromEvents = false;
