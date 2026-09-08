// main.js — builds every long-lived object, hands them to Match, and runs the loop.
// Nothing here simulates: Match owns the per-frame order (docs/ARCHITECTURE.md §2).
// Sets window.__game once; the probe drives the game through __game.step(dt).
// Without `?hero=` the hero-select overlay picks the player hero first; the match is
// only constructed once a hero is chosen.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { events } from './core/events.js';
import { Input } from './core/input.js';
import { World } from './core/world.js';
import { makeIntent } from './hero/intent.js';
import { HeroController } from './hero/heroController.js';
import { ThirdPersonCamera } from './camera/thirdPerson.js';
import { buildLane } from './map/laneBuilder.js';
import { LANE_BOUNDS, POSITIONS, TEAMS } from './map/laneData.js';
import { Hud } from './hud/hud.js';
import { Hero } from './hero/hero.js';
import { HEROES, HERO_KEYS } from './hero/heroData.js';
import { effects } from './hero/effects.js';
import { AbilityBar } from './hud/abilityBar.js';
import { HeroSelect } from './hud/heroSelect.js';
import { Tower } from './units/tower.js';
import { Nexus } from './units/nexus.js';
import { WaveSpawner } from './units/waveSpawner.js';
import { Economy } from './economy/gold.js';
import { Shop } from './economy/shop.js';
import { Consumables } from './economy/consumables.js';
import { initPassives } from './economy/passives.js';
import { ShopPanel } from './hud/shopPanel.js';
import { DamageNumbers } from './hud/damageNumbers.js';
import { ParticleSystem } from './fx/particles.js';
import { AbilityFx } from './fx/abilityFx.js';
import { RigAnimator } from './fx/rigAnimator.js';
import { HeroBot } from './ai/heroBot.js';
import { Match } from './game/match.js';

// `?hero=` / `?enemy=`: a validated key, or null when absent/unknown.
function paramHero(name) {
  const q = new URLSearchParams(location.search).get(name);
  return q && HEROES[q] ? q : null;
}

// Default enemy: a deterministic seeded pick among the other five (FNV-1a on the
// player key) so the same player hero always meets the same opponent.
function seededEnemy(playerKey) {
  let h = 0x811c9dc5;
  for (let i = 0; i < playerKey.length; i++) {
    h ^= playerKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const others = [];
  for (let i = 0; i < HERO_KEYS.length; i++) {
    if (HERO_KEYS[i] !== playerKey) others.push(HERO_KEYS[i]);
  }
  return others[h % others.length];
}

function boot() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) throw new Error('#game-canvas missing');
  const engine = new Engine(canvas);
  const scene = engine.scene;
  const input = new Input(canvas);
  const world = new World();
  const map = buildLane(scene);
  world.setCollision(map.boxes, LANE_BOUNDS);

  const camera = new ThirdPersonCamera(engine.camera, input);
  const controller = new HeroController(input, camera);
  controller.enabled = false;
  const hud = new Hud();

  engine.onError = (err) => {
    const el = document.getElementById('boot-status');
    if (el) { el.textContent = 'FRAME ERROR: ' + (err && err.message ? err.message : err); el.style.color = '#ff6b6b'; }
    console.error(err);
  };

  // The loop is inert until a match exists (hero-select path). The game simulates
  // only while the pointer is locked; unlocked, Match keeps camera/HUD/shop alive.
  let game = null;
  engine.start((dt) => {
    if (!game || game.paused) return;
    if (input.locked || game.forceRun) game.match.update(dt);
    else game.match.idle(dt);
  });

  const selectRoot = document.getElementById('hero-select');
  const overlay = document.getElementById('start-overlay');
  const playerKey = paramHero('hero');
  const enemyKey = paramHero('enemy');

  if (playerKey) {
    game = startMatch(playerKey, enemyKey || seededEnemy(playerKey), {
      engine, input, world, scene, map, camera, controller, hud,
    });
  } else if (selectRoot) {
    selectRoot.classList.remove('hidden');
    if (overlay) overlay.classList.add('hidden');   // pick a hero first
    const bs = document.getElementById('boot-status');
    if (bs) bs.textContent = 'choose your hero · three r' + THREE.REVISION;
    new HeroSelect(selectRoot, (key) => {
      selectRoot.classList.add('hidden');
      if (overlay) overlay.classList.remove('hidden');
      game = startMatch(key, enemyKey || seededEnemy(key), {
        engine, input, world, scene, map, camera, controller, hud,
      });
    });
  }
}

// Builds both heroes and everything that hangs off them, wires the start gate, and
// publishes window.__game. Runs once per page load — a pick or `?hero=` triggers it.
function startMatch(playerKey, enemyKey, base) {
  const { engine, input, world, scene, map, camera, controller, hud } = base;

  // Heroes. Each is driven by a plain-data intent — the controller writes the
  // player's, the bot writes the enemy's, and Hero never knows which (NETCODE.md).
  const intent = makeIntent();
  const hero = new Hero(playerKey, 'blue', world, scene);
  hero.intent = intent;
  world.add(hero);
  engine.look.follow(hero.pos);   // the shadow frustum tracks the player hero
  camera.snapTo(hero.pos);
  const enemy = new Hero(enemyKey, 'red', world, scene);
  enemy.intent = makeIntent();
  world.add(enemy);

  // Structures. setTower is what lets a nexus drop its shield when its tower dies.
  const towers = {};
  const nexuses = {};
  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i];
    towers[team] = world.add(new Tower(team, world, scene, POSITIONS[team].tower));
    nexuses[team] = world.add(new Nexus(team, world, scene, POSITIONS[team].nexus));
    nexuses[team].setTower(towers[team]);
  }
  const waves = new WaveSpawner(world, scene);

  // Economy, shop, AI, HUD. Order matters: the bot looks up its opponent through the
  // world, so both heroes must already be registered.
  const gold = new Economy(world, [hero, enemy]);
  const shop = new Shop(world);
  const consumables = new Consumables(world);
  const passives = initPassives();
  const bot = new HeroBot(enemy, world);
  const abilityBar = new AbilityBar(hero);
  const shopPanel = new ShopPanel(shop, input, hero);

  // Visuals (fx/ never touches sim state): one particle pool, the event→recipe
  // mapper, and the pooled damage numbers. Match.update drives fx.update; Match.reset
  // clears it, and fx.reset is also what hero death leaves to the systems themselves.
  const particles = new ParticleSystem(scene, 3000);
  const abilityFx = new AbilityFx(particles, effects, camera, hero);
  const damageNumbers = new DamageNumbers(engine.camera);
  const rigAnimator = new RigAnimator(world);
  const fx = {
    particles, abilityFx, damageNumbers, rigAnimator,
    update(dt) { abilityFx.update(dt); rigAnimator.update(dt); particles.update(dt); damageNumbers.update(dt); },
    reset() { particles.reset(); abilityFx.reset(); damageNumbers.reset(); },
  };

  const match = new Match({
    world, scene, input, hero, enemy, controller, bot, waves, shop, gold, effects,
    towers, nexuses, camera, hud, abilityBar, shopPanel, consumables, passives, fx,
  });

  // Start gate and pointer lock. Opening the shop releases the lock on purpose, so
  // that release must not re-raise the start overlay on top of the panel.
  const overlay = document.getElementById('start-overlay');
  let started = false;
  const start = () => {
    if (!started) {
      started = true;
      if (overlay) overlay.classList.add('hidden');
    }
    controller.enabled = true;
    input.requestPointerLock();
  };
  if (overlay) overlay.addEventListener('click', start);
  input.onLockChange = (locked) => {
    if (!locked && started && overlay && !shopPanel.open) {
      overlay.classList.remove('hidden');
      controller.enabled = false;
    } else if (locked && overlay) {
      overlay.classList.add('hidden');
      controller.enabled = true;
    }
    hud.showReticle(locked || !started);
  };

  const game = {
    engine, input, events, world, camera, controller, intent, map, hud,
    hero, enemy, bot, towers, nexuses, waves, gold, shop, shopPanel, abilityBar,
    consumables, passives, fx,
    effects, match, laneData: { POSITIONS, TEAMS, LANE_BOUNDS },
    three: THREE.REVISION,
    // Probe controls: `paused` stops the loop from simulating so step(dt) is the only
    // clock; `forceRun` simulates without pointer lock.
    paused: false,
    forceRun: false,
    step: (dt) => match.update(dt),
  };

  window.__game = game;
  const bs = document.getElementById('boot-status');
  if (bs) bs.textContent = 'ready · three r' + THREE.REVISION + ' · ' + hero.heroKey + ' vs ' + enemy.heroKey;
  return game;
}

boot();