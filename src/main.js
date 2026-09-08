// main.js — builds every long-lived object, hands them to Match, and runs the loop.
// Nothing here simulates: Match owns the per-frame order (docs/ARCHITECTURE.md §2).
// Sets window.__game once; the probe drives the game through __game.step(dt).
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
import { HEROES, otherHero } from './hero/heroData.js';
import { effects } from './hero/effects.js';
import { AbilityBar } from './hud/abilityBar.js';
import { Tower } from './units/tower.js';
import { Nexus } from './units/nexus.js';
import { WaveSpawner } from './units/waveSpawner.js';
import { Economy } from './economy/gold.js';
import { Shop } from './economy/shop.js';
import { Consumables } from './economy/consumables.js';
import { initPassives } from './economy/passives.js';
import { ShopPanel } from './hud/shopPanel.js';
import { HeroBot } from './ai/heroBot.js';
import { Match } from './game/match.js';

// The player defaults to the melee bruiser; `?hero=ilyra` swaps kits. The bot always
// takes whichever kit the player did not.
function pickHero() {
  const q = new URLSearchParams(location.search).get('hero');
  return q && HEROES[q] ? q : 'brakk';
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
  const hud = new Hud();

  // Heroes. Each is driven by a plain-data intent — the controller writes the
  // player's, the bot writes the enemy's, and Hero never knows which (NETCODE.md).
  const playerKey = pickHero();
  const intent = makeIntent();
  const hero = new Hero(playerKey, 'blue', world, scene);
  hero.intent = intent;
  world.add(hero);
  camera.snapTo(hero.pos);
  const enemy = new Hero(otherHero(playerKey), 'red', world, scene);
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

  const match = new Match({
    world, scene, input, hero, enemy, controller, bot, waves, shop, gold, effects,
    towers, nexuses, camera, hud, abilityBar, shopPanel, consumables, passives,
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
  controller.enabled = false;

  engine.onError = (err) => {
    const el = document.getElementById('boot-status');
    if (el) { el.textContent = 'FRAME ERROR: ' + (err && err.message ? err.message : err); el.style.color = '#ff6b6b'; }
    console.error(err);
  };

  const game = {
    engine, input, events, world, camera, controller, intent, map, hud,
    hero, enemy, bot, towers, nexuses, waves, gold, shop, shopPanel, abilityBar,
    consumables, passives,
    effects, match, laneData: { POSITIONS, TEAMS, LANE_BOUNDS },
    three: THREE.REVISION,
    // Probe controls: `paused` stops the loop from simulating so step(dt) is the only
    // clock; `forceRun` simulates without pointer lock.
    paused: false,
    forceRun: false,
    step: (dt) => match.update(dt),
  };

  // The game simulates only while the pointer is locked (the overlay is the pause
  // screen); unlocked, Match keeps the camera, HUD and shop panel responsive.
  engine.start((dt) => {
    if (game.paused) return;
    if (input.locked || game.forceRun) match.update(dt);
    else match.idle(dt);
  });

  window.__game = game;
  const bs = document.getElementById('boot-status');
  if (bs) bs.textContent = 'ready · three r' + THREE.REVISION + ' · ' + playerKey + ' vs ' + enemy.heroKey;
}

boot();
