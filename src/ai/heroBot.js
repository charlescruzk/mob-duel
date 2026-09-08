// HeroBot: writes the red hero's HeroIntent from sim state, exactly like the player's
// controller would (DESIGN.md §9). Decision tick 0.2 s, intent held between ticks;
// the player is read through a 0.3 s-old snapshot; everything else is read live.
// Never touches the Hero directly — it only writes the intent.
import { events } from '../core/events.js';
import { distSqXZ } from '../core/physics.js';
import * as LANE from '../map/laneData.js';
import { clearIntent } from '../hero/intent.js';
import { DelayedView, makeSnapshot, kitOf, longestReadyRange, inTowerRange, countWithin } from './botSense.js';
import { actRetreat, actRecall, actShop, actPush, actFarm, actTrade, nextBuy } from './botActions.js';

export const TICK = 0.2;
const SAFE_WAVE_N = 2, SAFE_WAVE_R = 8.0;
const CONE_FRESH = 1.6, CONE_TIGHT = 0.6, CONE_TIME = 3.0;
const FLAGS = ['q', 'w', 'e', 'r', 'recall'];

export class HeroBot {
  constructor(hero, world, laneData = LANE, enemyHero = null) {
    this.hero = hero;
    this.world = world;
    this.lane = laneData;
    this.playerUnit = enemyHero;
    this.team = hero.team;
    this.enemyTeam = laneData.enemyOf(hero.team);
    this.kit = kitOf(hero);
    this.state = 'FARM';
    this.stateAge = 0;
    this.tradeRange = 0;
    this.timeOnTarget = 0;
    this.coneScale = CONE_FRESH;
    this._tick = TICK;                 // decide on the first frame
    this.view = new DelayedView();
    this.p = makeSnapshot();
    this.prevFlags = { q: false, w: false, e: false, r: false, recall: false };
    this.prevBuy = -1;
    // Scratch lists (reused every tick).
    this.allies = [];
    this.enemies = [];
    // Helper positions.
    this.farm = { x: 0, z: 0 };
    this.safe = { x: 0, z: 0 };
    this.push = { x: 0, z: 0 };
    // Sensed values (refreshed per tick).
    this.hpPct = 1; this.mpPct = 1; this.inFountain = false; this.inEnemyTower = false;
    this.playerDist = Infinity; this.safeWave = false; this.alliesInEnemyTower = 0;
    this.enemiesNearEnemyTower = 0; this.enemyMinionsNear = 0;
    this.enemyTower = null; this.ownTower = null; this.pushTarget = null;
    this.enemyTowerAlive = false; this.ownTowerAlive = false; this.towerTargetsMe = false;
    // Event memory.
    this.hitByAbilityAt = -1e9;
    this.playerEAt = -1e9;
    this.markedUntil = -1e9;
    this._offs = [
      events.on('unitDamaged', (e) => this._onDamaged(e)),
      events.on('abilityCast', (e) => this._onCast(e)),
      events.on('heroRespawned', (e) => { if (e.hero === this.hero) this.view.reset(); }),
    ];
  }

  _player() {
    if (!this.playerUnit) this.playerUnit = this.world.hero(this.enemyTeam);
    return this.playerUnit;
  }

  _onDamaged(e) {
    const player = this._player();
    if (e.dtype !== 'magic' || !player) return;
    if (e.unit === this.hero && e.source === player) this.hitByAbilityAt = this.world.time;
    else if (e.unit === player && e.source === this.hero) this.markedUntil = this.world.time + 4.0;
  }

  _onCast(e) {
    if (e.slot === 'e' && e.hero === this._player()) this.playerEAt = this.world.time;
  }

  inOwnTowerRange(pos) { return inTowerRange(pos, this.team); }

  reset() {
    this.state = 'FARM'; this.stateAge = 0; this.timeOnTarget = 0; this._tick = TICK;
    this.view.reset(); this.prevBuy = -1;
    for (let i = 0; i < FLAGS.length; i++) this.prevFlags[FLAGS[i]] = false;
    this.hitByAbilityAt = -1e9; this.playerEAt = -1e9; this.markedUntil = -1e9;
  }

  update(dt, intent = this.hero.intent) {
    const player = this._player();
    if (!intent) return;
    if (player) this.view.sample(this.world.time, player);
    this.stateAge += dt;
    this._tick += dt;
    if (this._tick < TICK) { this._clampAim(intent); return; }
    this._tick = 0;
    // Pulse bookkeeping: remember last tick's flags, then drop them so the hero sees
    // a rising edge on the next request.
    for (let i = 0; i < FLAGS.length; i++) { this.prevFlags[FLAGS[i]] = intent[FLAGS[i]]; intent[FLAGS[i]] = false; }
    this.prevBuy = intent.buy;
    intent.buy = -1;
    this._sense(player);
    const next = this._decide();
    if (next !== this.state) { this.state = next; this.stateAge = 0; }
    this.timeOnTarget = this.state === 'TRADE' ? this.timeOnTarget + TICK : 0;
    const t = this.timeOnTarget / CONE_TIME;
    this.coneScale = CONE_FRESH + (CONE_TIGHT - CONE_FRESH) * (t > 1 ? 1 : t);
    this._act(intent);
  }

  // A held reticle can end up > 12 m away after a teleport (recall, respawn, blink);
  // pull it back every frame like the player's controller would.
  _clampAim(intent) {
    const pos = this.hero.pos;
    const dx = intent.aimX - pos.x, dz = intent.aimZ - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= 121) return;
    const k = 11 / Math.sqrt(d2);
    intent.aimX = pos.x + dx * k; intent.aimZ = pos.z + dz * k;
  }

  _sense(player) {
    const hero = this.hero, world = this.world, lane = this.lane;
    const pos = hero.pos;
    this.hpPct = hero.maxHp > 0 ? hero.hp / hero.maxHp : 0;
    this.mpPct = hero.maxMp > 0 ? hero.mp / hero.maxMp : 1;
    this.inFountain = lane.isInFountain(pos, this.team);
    this.inEnemyTower = inTowerRange(pos, this.enemyTeam);
    if (player) this.view.read(world.time, this.p);
    const p = this.p;
    // A stealthed player drops out of the bot's senses entirely (Veil, PHASE2.md §3.2).
    this.playerDist = player && p.alive && p.visible !== false
      ? Math.sqrt(distSqXZ(pos, p)) : Infinity;

    world.byTeam(this.team, 'minion', this.allies);
    world.byTeam(this.enemyTeam, 'minion', this.enemies);
    this.safeWave = countWithin(this.allies, pos.x, pos.z, SAFE_WAVE_R) >= SAFE_WAVE_N;
    const et = lane.POSITIONS[this.enemyTeam].tower;
    this.alliesInEnemyTower = countWithin(this.allies, et.x, et.z, lane.TOWER_RANGE);
    this.enemiesNearEnemyTower = countWithin(this.enemies, et.x, et.z, lane.TOWER_RANGE);
    this.enemyMinionsNear = countWithin(this.enemies, pos.x, pos.z, 12.0);

    this.enemyTower = null; this.ownTower = null; this.pushTarget = null;
    let enemyNexus = null;
    const list = world.units;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.kind === 'tower') { if (u.team === this.team) this.ownTower = u; else this.enemyTower = u; }
      else if (u.kind === 'nexus' && u.team === this.enemyTeam) enemyNexus = u;
    }
    this.enemyTowerAlive = !!(this.enemyTower && this.enemyTower.alive);
    this.ownTowerAlive = !!(this.ownTower && this.ownTower.alive);
    this.towerTargetsMe = this.enemyTowerAlive && this.enemyTower.target === hero;
    this.pushTarget = this.enemyTowerAlive ? this.enemyTower
      : (enemyNexus && enemyNexus.alive && !enemyNexus.invulnerable ? enemyNexus : null);
    this._positions();
  }

  // farmPos / safePos / pushPos (DESIGN.md §9 helper positions), clamped to the lane.
  _positions() {
    const lane = this.lane, dir = lane.POSITIONS[this.team].dir;
    const ownT = lane.POSITIONS[this.team].tower, et = lane.POSITIONS[this.enemyTeam].tower;
    const b = lane.LANE_BOUNDS;
    let front = -Infinity;
    for (let i = 0; i < this.allies.length; i++) {
      const z = this.allies[i].pos.z * dir;
      if (z > front) front = z;
    }
    if (front === -Infinity) { this.farm.x = 1.0; this.farm.z = ownT.z + dir * 6.0; }
    else if (this.kit.melee) { this.farm.x = 1.0; this.farm.z = (front - 1.0) * dir; }
    else { this.farm.x = 1.5; this.farm.z = (front - 4.5) * dir; }
    // FARM never walks into the enemy tower's range.
    const edgeZ = et.z - dir * (lane.TOWER_RANGE + 0.5);
    if ((this.farm.z - edgeZ) * dir > 0) this.farm.z = edgeZ;
    this.safe.x = 1.0; this.safe.z = ownT.z - dir * 3.0;
    // pushPos: attack range − 0.5 from the target's edge, on the side away from the player.
    const reach = (this.hero.attackRange || 2.0) - 0.5 + lane.RADII.tower;
    const target = this.pushTarget ? this.pushTarget.pos : et;
    const away = this.p.x < target.x ? 0.5 : -0.5;
    const n = Math.sqrt(away * away + 1);
    this.push.x = target.x + (away / n) * reach;
    this.push.z = target.z - dir * (1 / n) * reach;
    if (this.alliesInEnemyTower === 0 && this.enemyTowerAlive) {
      // No wave inside: hold just outside tower range instead of diving.
      this.push.z = et.z - dir * (lane.TOWER_RANGE + 1.0);
    }
    const r = lane.RADII.hero;
    clampXZ(this.farm, b, r); clampXZ(this.safe, b, r); clampXZ(this.push, b, r);
  }

  _retreatEnter() {
    const p = this.p;
    if (this.hpPct < 0.35) return true;
    if (this.inEnemyTower && this.enemyTowerAlive && (this.towerTargetsMe || this.alliesInEnemyTower === 0)) return true;
    return !this.safeWave && this.playerDist <= 8.0 && (p.hpPct - this.hpPct) > 0.20;
  }

  _decide() {
    const hero = this.hero, p = this.p, s = this.state;
    if (!hero.alive) return 'DEAD';
    // RECALL outranks RETREAT when nothing can reach the bot (assumed): the §9 order
    // would otherwise trap a <35% HP bot in RETREAT, whose exit needs ≥45% HP.
    const recallOk = (this.hpPct < 0.45 || this.mpPct < 0.20) && this.playerDist >= 20.0 &&
      this.enemyMinionsNear === 0 && !this.inFountain && !(this.inEnemyTower && this.enemyTowerAlive);
    if (recallOk && (s === 'RECALL' || s === 'RETREAT' || s === 'FARM')) return 'RECALL';
    // In the fountain: shop and heal up (recall arrival, respawn, or a retreat that got
    // this far). RETREAT is checked after — safePos lies outside the fountain.
    if (this.inFountain) {
      const canShop = (hero.gold || 0) >= 250 && nextBuy(this) >= 0;
      const low = this.hpPct < 0.45 || this.mpPct < 0.20;
      if (s === 'SHOP' ? (canShop || this.hpPct < 0.95 || this.mpPct < 0.80)
        : (s === 'RECALL' || canShop || low)) return 'SHOP';
    }
    const retreatExit = this.hpPct >= 0.45 && !(this.inEnemyTower && this.enemyTowerAlive) &&
      (this.playerDist >= 10.0 || this.safeWave);
    if (s === 'RETREAT' ? !retreatExit : this._retreatEnter()) return 'RETREAT';
    if (s === 'RECALL') return this.playerDist < 20.0 ? 'RETREAT' : 'RECALL';
    if (recallOk) return 'RECALL';
    const pushExit = (p.alive && this.playerDist <= 20.0) || (this.inEnemyTower && this.alliesInEnemyTower === 0);
    const pushEnter = (!p.alive || this.playerDist >= 25.0) && this.safeWave;
    if (s === 'PUSH' ? !pushExit : pushEnter) return 'PUSH';
    if (s === 'TRADE') {
      if (this.stateAge < 2.5 && this.playerDist <= this.tradeRange + 2.0 && !this._retreatEnter()) return 'TRADE';
    } else {
      const reach = longestReadyRange(this.kit, hero);
      const playerUnderOwnTower = this.enemyTowerAlive && inTowerRange(p, this.enemyTeam);
      if (reach > 0 && this.playerDist <= reach && this.mpPct >= 0.40 && this.safeWave &&
          this.hpPct >= p.hpPct - 0.10 && !this.inEnemyTower && !playerUnderOwnTower) {
        this.tradeRange = reach;
        return 'TRADE';
      }
    }
    return 'FARM';
  }

  _act(intent) {
    if (this.state !== 'DEAD') {
      // Every state leaves a valid reticle (≤ 12 m): default to "at my feet".
      intent.aimX = this.hero.pos.x; intent.aimZ = this.hero.pos.z;
    }
    switch (this.state) {
      case 'DEAD': clearIntent(intent); return;
      case 'RETREAT': actRetreat(this, intent); return;
      case 'RECALL': actRecall(this, intent); return;
      case 'SHOP': actShop(this, intent); return;
      case 'PUSH': actPush(this, intent); return;
      case 'TRADE': actTrade(this, intent); return;
      default: actFarm(this, intent);
    }
  }

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
  }
}

function clampXZ(p, b, r) {
  if (p.x < b.minX + r) p.x = b.minX + r; else if (p.x > b.maxX - r) p.x = b.maxX - r;
  if (p.z < b.minZ + r) p.z = b.minZ + r; else if (p.z > b.maxZ - r) p.z = b.maxZ - r;
}
