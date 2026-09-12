// One match in one worker thread. The sim uses module singletons (event bus, effect
// pools), so every room gets its own module instances by living in its own worker.
// Messages in: { t:'seat', seat, hero } (a player took a seat), { t:'leave', seat },
// { t:'intent', seat, tick, i }, { t:'start' }. Messages out: { t:'snap', ... } every
// tick once started, { t:'over', winner }.
import { parentPort } from 'node:worker_threads';
import { events } from '../src/sim/core/events.js';
import { effects } from '../src/sim/hero/effects.js';
import { HeroBot } from '../src/sim/ai/heroBot.js';
import { HERO_KEYS } from '../src/sim/hero/heroData.js';
import { buildHeadlessMatch } from '../scripts/simNode.mjs';
import { TICK_MS, TICK_DT, sanitizeIntent, encodeUnit, encodeEffects } from '../src/net/protocol.mjs';

const seats = [{ hero: HERO_KEYS[0], taken: false }, { hero: HERO_KEYS[1], taken: false }];
let g = null;
let tick = 0;
let timer = null;
let nextAt = 0;
const eventLog = [];
const pendingTick = [-1, -1];   // last intent tick received per seat
const appliedTick = [-1, -1];   // ...and the one the last sim step consumed
const EVENT_NAMES = ['abilityCast', 'abilityHit', 'unitDamaged', 'unitHealed', 'unitDied', 'heroDied', 'heroRespawned',
  'heroLevelUp', 'recallStarted', 'recallEnded', 'shotFired', 'nexusDestroyed', 'matchOver', 'gold'];

function idOf(x) { return x && typeof x === 'object' && 'id' in x ? x.id : (x == null ? 0 : x); }

function logEvent(name, p) {
  // Flatten payloads to ids/numbers; the client re-emits them with local units.
  const e = { n: name };
  if (p) for (const k of Object.keys(p)) { const v = p[k]; e[k] = (v && typeof v === 'object') ? idOf(v) : v; }
  eventLog.push(e);
}

function start() {
  if (g) { g.match.reset(); eventLog.length = 0; return; }   // rematch
  g = buildHeadlessMatch(seats[0].hero, seats[1].hero);
  ensureBots();                                // before the seats reference them
  // Empty seats are played by the bot; taken seats are driven by network intents.
  g.match.controller = seats[0].taken ? null : { update: (dt) => bots[0].update(dt) };
  g.match.bot = seats[1].taken ? null : bots[1];
  for (const n of EVENT_NAMES) events.on(n, (p) => logEvent(n, p));
  tick = 0;
  nextAt = Date.now();
  loop();
}
const bots = [];
function ensureBots() { if (!bots.length && g) { bots.push(new HeroBot(g.hero, g.world), new HeroBot(g.enemy, g.world)); } }

function loop() {
  ensureBots();
  const now = Date.now();
  let steps = 0;
  while (now >= nextAt && steps < 5) {        // catch up at most 5 ticks after a stall
    appliedTick[0] = pendingTick[0]; appliedTick[1] = pendingTick[1];
    g.match.update(TICK_DT);
    tick++;
    nextAt += TICK_MS;
    steps++;
    // A bot seat keeps its own intent object; a player's intent is what arrived last.
  }
  if (steps > 0) emitSnapshot();
  if (nextAt < now) nextAt = now;            // stalled badly: resync, don't spiral
  timer = setTimeout(loop, Math.max(1, nextAt - Date.now()));
}

function emitSnapshot() {
  const w = g.world;
  const units = new Array(w.units.length);
  for (let i = 0; i < w.units.length; i++) units[i] = encodeUnit(w.units[i]);
  const snap = {
    t: 'snap', tick, time: Math.round(w.time * 100) / 100, state: g.match.state,
    cd: Math.round(g.match.countdown * 100) / 100, winner: g.match.winner, ack: [appliedTick[0], appliedTick[1]],
    u: units, fx: encodeEffects(effects), ev: eventLog.length ? eventLog.slice() : [],
  };
  eventLog.length = 0;
  parentPort.postMessage(snap);
  if (g.match.state === 'over') { parentPort.postMessage({ t: 'over', winner: g.match.winner }); }
}

parentPort.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'seat') { const s = seats[m.seat]; if (s) { s.taken = true; if (HERO_KEYS.includes(m.hero)) s.hero = m.hero; } }
  else if (m.t === 'leave') { const s = seats[m.seat]; if (s) { s.taken = false; if (g) { if (m.seat === 0) g.match.controller = { update: (dt) => bots[0].update(dt) }; else g.match.bot = bots[1]; } } }
  else if (m.t === 'start') start();
  else if (m.t === 'intent' && g) {
    const hero = m.seat === 0 ? g.hero : g.enemy;
    if (!seats[m.seat] || !seats[m.seat].taken) return;
    sanitizeIntent(m.i, hero.intent);
    pendingTick[m.seat] = m.tick | 0;
  } else if (m.t === 'stop') { if (timer) clearTimeout(timer); process.exit(0); }
});
