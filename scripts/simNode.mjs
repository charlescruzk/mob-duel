// Headless simulation smoke run (NOT imported by the game). Proves the sim runs in
// plain Node with no DOM and no three.js — the precondition for a server-side match
// (docs/NETCODE.md). Two bots duel for SECONDS of sim time at 20 Hz; the process exits
// 0 when the world advanced, both heroes acted, and nothing threw.
//
//   node scripts/simNode.mjs [seconds] [heroA] [heroB]
import { World } from '../src/sim/core/world.js';
import { Hero } from '../src/sim/hero/hero.js';
import { makeIntent } from '../src/sim/hero/intent.js';
import { HERO_KEYS } from '../src/sim/hero/heroData.js';
import { effects } from '../src/sim/hero/effects.js';
import { Tower } from '../src/sim/units/tower.js';
import { Nexus } from '../src/sim/units/nexus.js';
import { WaveSpawner } from '../src/sim/units/waveSpawner.js';
import { Economy } from '../src/sim/economy/gold.js';
import { Shop } from '../src/sim/economy/shop.js';
import { Consumables } from '../src/sim/economy/consumables.js';
import { initPassives } from '../src/sim/economy/passives.js';
import { HeroBot } from '../src/sim/ai/heroBot.js';
import { Match } from '../src/sim/game/match.js';
import { LANE_BOUNDS, WALL_BOXES, POSITIONS, TEAMS } from '../src/sim/map/laneData.js';

const SECONDS = Number(process.argv[2] || 20);
const keyA = process.argv[3] || HERO_KEYS[0];
const keyB = process.argv[4] || HERO_KEYS[1];
const DT = 0.05;

export function buildHeadlessMatch(playerKey, enemyKey) {
  const world = new World();
  world.setCollision(WALL_BOXES, LANE_BOUNDS);
  const hero = new Hero(playerKey, 'blue', world);
  hero.intent = makeIntent();
  world.add(hero);
  const enemy = new Hero(enemyKey, 'red', world);
  enemy.intent = makeIntent();
  world.add(enemy);
  const towers = {}, nexuses = {};
  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i];
    towers[team] = world.add(new Tower(team, world, POSITIONS[team].tower));
    nexuses[team] = world.add(new Nexus(team, world, POSITIONS[team].nexus));
    nexuses[team].setTower(towers[team]);
  }
  const waves = new WaveSpawner(world);
  const gold = new Economy(world, [hero, enemy]);
  const shop = new Shop(world);
  const consumables = new Consumables(world);
  const passives = initPassives();
  // Both seats are bots: the match's "controller" slot drives blue too.
  const controller = { update: (dt) => blueBot.update(dt) };
  const blueBot = new HeroBot(hero, world);
  const bot = new HeroBot(enemy, world);
  const match = new Match({
    world, scene: null, input: null, hero, enemy, controller, bot, waves, shop, gold, effects,
    towers, nexuses, camera: null, hud: null, abilityBar: null, shopPanel: null, consumables, passives, fx: null,
  });
  return { world, hero, enemy, towers, nexuses, waves, match };
}

const g = buildHeadlessMatch(keyA, keyB);
g.match.skipCountdown();
const t0 = Date.now();
let steps = 0;
for (let t = 0; t < SECONDS - 1e-9; t += DT) { g.match.update(DT); steps++; }
const ms = Date.now() - t0;
const acted = (h) => h.level > 1 || h.gold > 0 || h.hp < h.maxHp || !h.alive;
const summary = {
  simSeconds: Number(g.world.time.toFixed(2)), steps, wallMs: ms,
  blue: { hero: g.hero.heroKey, hp: Math.round(g.hero.hp), level: g.hero.level, gold: Math.round(g.hero.gold), pos: [Number(g.hero.pos.x.toFixed(1)), Number(g.hero.pos.z.toFixed(1))] },
  red: { hero: g.enemy.heroKey, hp: Math.round(g.enemy.hp), level: g.enemy.level, gold: Math.round(g.enemy.gold), pos: [Number(g.enemy.pos.x.toFixed(1)), Number(g.enemy.pos.z.toFixed(1))] },
  units: g.world.units.length, state: g.match.state,
};
console.log(JSON.stringify(summary));
const ok = g.world.time >= SECONDS - 0.1 && steps === Math.round(SECONDS / DT) && acted(g.hero) && acted(g.enemy) && typeof globalThis.document === 'undefined';
if (!ok) { console.log('SIM NODE: FAILED'); process.exit(1); }
console.log('SIM NODE: ok');
