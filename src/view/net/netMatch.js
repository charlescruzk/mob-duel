// NetMatch — the online counterpart of sim/game/match.js with the same surface the
// loop, probe and HUD use (update, idle, state, countdown, winner, time, hero, enemy).
// It never simulates: it sends the local intent every tick, applies snapshots through
// the mirror, and presents. Edge inputs (casts, buys) are latched between ticks so a
// one-frame press can never fall between two sends.
import { TICK_DT } from '../../net/protocol.mjs';
import { copyIntent, makeIntent, clearIntent } from '../../sim/hero/intent.js';

const EDGES = ['q', 'w', 'e', 'r', 'recall'];

export class NetMatch {
  constructor(g) {
    this.client = g.client; this.mirror = g.mirror; this.world = g.mirror.world;
    this.input = g.input; this.controller = g.controller;
    this.camera = g.camera; this.hud = g.hud; this.abilityBar = g.abilityBar; this.shopPanel = g.shopPanel;
    this.fx = g.fx || null; this.effects = g.effects;
    this.banner = g.banner || null;
    this.seat = g.seat;
    this.team = g.seat === 0 ? 'blue' : 'red';
    this.hero = g.hero; this.enemy = g.enemy;
    this.intent = this.hero.intent;         // written by the controller each frame
    this.outgoing = makeIntent();           // what actually goes on the wire this tick
    this._acc = 0; this._tick = 0;
    this.mirror.setLocal(this.hero, this.seat);
    this._bannerText = null;
    this._showBanner('READY');
    this.bot = null;                        // the server runs the bot
  }

  get state() { return this.mirror.state; }
  get countdown() { return this.mirror.countdown; }
  get winner() { return this.mirror.winner; }
  get time() { return this.mirror.time; }

  update(dt) {
    const hero = this.hero;
    if (this.controller) this.controller.update(dt, hero.intent, hero.pos);
    this._latch(hero.intent);
    this._acc += dt;
    if (this._acc >= TICK_DT) {
      this._acc -= TICK_DT;
      if (this._acc > TICK_DT) this._acc = 0;
      this.mirror.recordPrediction(this._tick);
      this.client.sendIntent(this._tick++, this.outgoing);
      this._unlatch();
    }
    this.mirror.applyPending(this.client.pending);
    this.mirror.update(dt);
    this._present(dt);
    if (this.input) this.input.endFrame();
    if (this.mirror.state === 'countdown') this._showBanner(this.mirror.countdown > 0 ? String(Math.ceil(this.mirror.countdown)) : 'FIGHT');
    else if (this.mirror.state === 'over') this._showBanner(this.mirror.winner === this.team ? 'VICTORY' : 'DEFEAT');
    else this._showBanner('');
  }

  idle(dt) {
    this.mirror.applyPending(this.client.pending);
    this.mirror.update(dt);
    this._present(dt);
    if (this.input) this.input.endFrame();
  }

  // Continuous fields overwrite; edge fields accumulate until the next send.
  _latch(i) {
    const o = this.outgoing;
    o.moveX = i.moveX; o.moveZ = i.moveZ; o.aimX = i.aimX; o.aimZ = i.aimZ; o.attack = i.attack;
    for (let k = 0; k < EDGES.length; k++) if (i[EDGES[k]]) o[EDGES[k]] = true;
    if (i.buy >= 0) o.buy = i.buy;
    if (i.useItem >= 0) o.useItem = i.useItem;
    if (i.sell >= 0) o.sell = i.sell;
  }

  _unlatch() {
    const o = this.outgoing;
    for (let k = 0; k < EDGES.length; k++) o[EDGES[k]] = false;
    o.buy = -1; o.useItem = -1; o.sell = -1;
  }

  // Remote shop: the panel calls these instead of the local Shop.
  remoteBuy(index) { this.outgoing.buy = index; }
  remoteSell(slot) { this.outgoing.sell = slot; }

  _present(dt) {
    if (this.camera) this.camera.update(dt, this.hero.pos);
    if (this.hud) this.hud.update(this.hero, this.mirror.time);
    if (this.abilityBar) this.abilityBar.update();
    if (this.shopPanel) this.shopPanel.update(dt);
    if (this.fx) this.fx.update(dt);
  }

  _showBanner(text) {
    if (text === this._bannerText) return;
    this._bannerText = text;
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.display = text ? 'block' : 'none';
  }

  // Server-authoritative: a rematch asks the server; nothing resets locally.
  reset() { this.client.start(); }
  skipCountdown() {}
  dispose() { this.client.close(); }
}
