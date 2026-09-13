// main.js — builds every long-lived object, hands them to Match, and runs the loop.
// Nothing here simulates: Match owns the per-frame order (docs/ARCHITECTURE.md §2).
// Sets window.__game once; the probe drives the game through __game.step(dt).
// Without `?hero=` the hero-select overlay picks the player hero first; the match is
// only constructed once a hero is chosen.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { events } from '../sim/core/events.js';
import { Input } from './core/input.js';
import { World } from '../sim/core/world.js';
import { makeIntent } from '../sim/hero/intent.js';
import { HeroController } from './heroController.js';
import { ThirdPersonCamera } from './camera/thirdPerson.js';
import { buildLane } from './map/laneBuilder.js';
import { LANE_BOUNDS, POSITIONS, TEAMS } from '../sim/map/laneData.js';
import { Hud } from './hud/hud.js';
import { Hero } from '../sim/hero/hero.js';
import { HEROES, HERO_KEYS } from '../sim/hero/heroData.js';
import { effects } from '../sim/hero/effects.js';
import { AbilityBar } from './hud/abilityBar.js';
import { HeroSelect } from './hud/heroSelect.js';
import { Lobby } from './hud/lobby.js';
import { PauseMenu } from './hud/pauseMenu.js';
import { Tower } from '../sim/units/tower.js';
import { Nexus } from '../sim/units/nexus.js';
import { WaveSpawner } from '../sim/units/waveSpawner.js';
import { Economy } from '../sim/economy/gold.js';
import { Shop } from '../sim/economy/shop.js';
import { Consumables } from '../sim/economy/consumables.js';
import { initPassives } from '../sim/economy/passives.js';
import { ShopPanel } from './hud/shopPanel.js';
import { UnitViews } from './fx/unitViews.js';
import { EffectViews } from './fx/effectViews.js';
import { ShotViews } from './fx/shotViews.js';
import { GameAudio } from './audio/index.js';
import { TouchControls } from './touch.js';
import { buildFx } from './fxBundle.js';
import { wireStartGate } from './gate.js';
import { startOnline } from './online.js';
import { HeroBot } from '../sim/ai/heroBot.js';
import { Match } from '../sim/game/match.js';

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
  // View bridges: built before any unit exists so 'unitAdded' always finds them.
  const unitViews = new UnitViews(scene, world);
  const effectViews = new EffectViews(scene, effects);
  const shotViews = new ShotViews(scene);
  const audio = new GameAudio();
  const touch = new TouchControls(input, canvas);
  const map = buildLane(scene);
  world.setCollision(map.boxes, LANE_BOUNDS);

  const camera = new ThirdPersonCamera(engine.camera, input);
  const controller = new HeroController(input, camera);
  controller.touch = touch;
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
    if (input.locked || touch.active || game.forceRun) game.match.update(dt);
    else game.match.idle(dt);
  });

  const selectRoot = document.getElementById('hero-select');
  const overlay = document.getElementById('start-overlay');
  const playerKey = paramHero('hero');
  const enemyKey = paramHero('enemy');

  const q = new URLSearchParams(location.search);
  const pause = new PauseMenu(overlay, audio, touch);
  const base = { engine, input, world, scene, map, camera, controller, hud, unitViews, effectViews, shotViews, audio, touch, pause };
  if (q.get('server')) {
    // Multiplayer (docs/PHASE4.md): the server simulates; this page mirrors and renders.
    if (overlay) overlay.classList.remove('hidden');
    startOnline({ server: q.get('server'), room: q.get('room') || 'new', hero: playerKey || HERO_KEYS[0], solo: q.has('solo') }, base)
      .then((g) => { game = g; });
  } else if (playerKey) {
    game = startMatch(playerKey, enemyKey || seededEnemy(playerKey), base);
  } else if (selectRoot) {
    selectRoot.classList.remove('hidden');
    if (overlay) overlay.classList.add('hidden');   // pick a hero first
    const bs = document.getElementById('boot-status');
    if (bs) bs.textContent = 'choose your hero · three r' + THREE.REVISION;
    const lobby = new Lobby(selectRoot);
    new HeroSelect(selectRoot, (key) => {
      selectRoot.classList.add('hidden');
      if (overlay) overlay.classList.remove('hidden');
      const online = lobby.onlineParams(key);
      if (online) startOnline(online, base).then((g) => { game = g; });
      else game = startMatch(key, enemyKey || seededEnemy(key), base);
    });
  }
}

// Builds both heroes and everything that hangs off them, wires the start gate, and
// publishes window.__game. Runs once per page load — a pick or `?hero=` triggers it.
function startMatch(playerKey, enemyKey, base) {
  const { engine, input, world, scene, map, camera, controller, hud, unitViews, effectViews, shotViews, audio, touch } = base;

  // Heroes. Each is driven by a plain-data intent — the controller writes the
  // player's, the bot writes the enemy's, and Hero never knows which (NETCODE.md).
  const intent = makeIntent();
  const hero = new Hero(playerKey, 'blue', world);
  hero.intent = intent;
  world.add(hero);
  engine.look.follow(hero.pos);   // the shadow frustum tracks the player hero
  camera.snapTo(hero.pos);
  const enemy = new Hero(enemyKey, 'red', world);
  enemy.intent = makeIntent();
  world.add(enemy);

  // Structures. setTower is what lets a nexus drop its shield when its tower dies.
  const towers = {};
  const nexuses = {};
  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i];
    towers[team] = world.add(new Tower(team, world, POSITIONS[team].tower));
    nexuses[team] = world.add(new Nexus(team, world, POSITIONS[team].nexus));
    nexuses[team].setTower(towers[team]);
  }
  const waves = new WaveSpawner(world);

  // Economy, shop, AI, HUD. Order matters: the bot looks up its opponent through the
  // world, so both heroes must already be registered.
  const gold = new Economy(world, [hero, enemy]);
  const shop = new Shop(world);
  const consumables = new Consumables(world);
  const passives = initPassives();
  const bot = new HeroBot(enemy, world);
  const abilityBar = new AbilityBar(hero);
  const shopPanel = new ShopPanel(shop, input, hero);

  const fx = buildFx(base, world, hero);
  touch.attach(world, camera, hero, controller);
  audio.attach(world, hero, enemy);

  const match = new Match({
    world, scene, input, hero, enemy, controller, bot, waves, shop, gold, effects,
    banner: document.getElementById('match-banner'),
    towers, nexuses, camera, hud, abilityBar, shopPanel, consumables, passives, fx,
  });
  wireStartGate(base, controller, shopPanel);
  fx.result.onPlayAgain = () => match.reset();
  fx.result.onChangeHero = () => { location.search = ''; };

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