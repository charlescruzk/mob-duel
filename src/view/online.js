// startOnline — the multiplayer entry (docs/PHASE4.md). Connects to the match server,
// joins a room, waits for the first snapshot so the mirror has real Hero objects, then
// builds the same view bundle as single player around a NetMatch. Query parameters:
//   ?server=ws://host:8787/ws&room=new|CODE&hero=key[&solo=1]
import * as THREE from 'three';
import { NetClient } from './net/client.js';
import { MirrorWorld } from './net/mirror.js';
import { NetMatch } from './net/netMatch.js';
import { AbilityBar } from './hud/abilityBar.js';
import { ShopPanel } from './hud/shopPanel.js';
import { Shop } from '../sim/economy/shop.js';
import { effects } from '../sim/hero/effects.js';
import { buildFx } from './fxBundle.js';
import { wireStartGate } from './gate.js';

function status(text, isError) {
  const el = document.getElementById('boot-status');
  if (!el) return;
  el.textContent = text;
  if (isError) el.style.color = '#ff6b6b';
}

// Resolves with the game object once the match is live enough to render.
export async function startOnline(opts, base) {
  const { engine, input, camera, controller, hud, unitViews, effectViews, shotViews, audio, touch } = base;
  const client = new NetClient(opts.server);
  const mirror = new MirrorWorld();
  status('connecting to ' + opts.server + ' …');
  try { await client.connect(); }
  catch { status('could not connect to ' + opts.server, true); return null; }
  client.join(opts.room || 'new', opts.hero, opts.solo);
  const joined = await waitFor(() => client.joined || client.error, 5000);
  if (!joined || client.error) { status('join failed: ' + (client.error || 'timeout'), true); return null; }
  status('room ' + client.joined.room + ' · seat ' + client.joined.seat + (client.started ? '' : ' · waiting for opponent (share the code)'));
  await waitFor(() => client.pending.length > 0, 10 * 60 * 1000);   // first snapshot = match started
  mirror.applyPending(client.pending);
  const team = client.seat === 0 ? 'blue' : 'red';
  const hero = mirror.hero(team);
  const enemy = mirror.hero(team === 'blue' ? 'red' : 'blue');
  if (!hero || !enemy) { status('bad first snapshot', true); return null; }
  engine.look.follow(hero.pos);
  camera.snapTo(hero.pos);
  // The red seat looks down the lane the other way.
  if (team === 'red') camera.yaw = Math.PI;

  const shop = new Shop(mirror.world);                 // read-only helper for the panel's refusal text
  const abilityBar = new AbilityBar(hero);
  const shopPanel = new ShopPanel(shop, input, hero);
  const fx = buildFx(base, mirror.world, hero);
  touch.attach(mirror.world, camera, hero, controller);
  audio.attach(mirror.world, hero, enemy);
  const match = new NetMatch({
    client, mirror, input, controller, camera, hud, abilityBar, shopPanel, fx, effects,
    banner: document.getElementById('match-banner'), seat: client.seat, hero, enemy,
  });
  shopPanel.remote = match;
  wireStartGate(base, controller, shopPanel);

  const game = {
    engine, input, camera, controller, intent: hero.intent, map: base.map, hud,
    world: mirror.world, hero, enemy, shop, shopPanel, abilityBar, fx, effects, match,
    net: { client, mirror, seat: client.seat, room: client.joined.room, online: true },
    bot: null, towers: null, nexuses: null, waves: null, gold: null, consumables: null, passives: null,
    three: THREE.REVISION, paused: false, forceRun: false,
    step: (dt) => match.update(dt),
  };
  window.__game = game;
  status('online · room ' + client.joined.room + ' · ' + hero.heroKey + ' vs ' + enemy.heroKey + ' · three r' + THREE.REVISION);
  return game;
}

function waitFor(pred, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const v = pred();
      if (v) { resolve(v); return; }
      if (performance.now() - t0 > timeoutMs) { resolve(null); return; }
      setTimeout(tick, 30);
    };
    tick();
  });
}
