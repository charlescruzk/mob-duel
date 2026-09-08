// Match — owns the per-frame order (ARCHITECTURE.md §2), the countdown → live → over
// state machine, the 'matchOver' freeze and the full rematch reset. Constructs
// nothing: main.js hands it every long-lived object. `time` is world.time.
import { events } from '../core/events.js';
import { clearIntent } from '../hero/intent.js';
import { TEAMS, enemyOf } from '../map/laneData.js';

const COUNTDOWN = 3.0;
const RESTART_GRACE = 1.5;        // a click that landed the killing blow must not restart
const overPayload = { winner: null };

export class Match {
  constructor(g) {
    this.world = g.world; this.scene = g.scene; this.input = g.input;
    this.hero = g.hero; this.enemy = g.enemy;
    // Intent writers. The probe sets either to null to write that intent by hand.
    this.controller = g.controller; this.bot = g.bot;
    this.waves = g.waves; this.shop = g.shop; this.gold = g.gold; this.effects = g.effects;
    this.consumables = g.consumables; this.passives = g.passives;
    this.towers = g.towers; this.nexuses = g.nexuses;
    this.camera = g.camera; this.hud = g.hud; this.abilityBar = g.abilityBar; this.shopPanel = g.shopPanel;
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this.winner = null;
    this.overAge = 0;
    this.banner = document.getElementById('match-banner');
    this._bannerText = null;
    this._showBanner('READY');
    this._offs = [
      events.on('nexusDestroyed', (p) => this.end(enemyOf(p.team))),
      events.on('heroRespawned', (p) => { if (p.hero === this.hero) this.camera.snapTo(this.hero.pos); }),
      events.on('recallEnded', (p) => { if (p.hero === this.hero && p.completed) this.camera.snapTo(this.hero.pos); }),
    ];
  }

  get time() { return this.world.time; }

  // One whole frame. What window.__game.step(dt) and the engine loop call.
  update(dt) {
    if (this.state === 'live') this._live(dt);
    else if (this.state === 'countdown') this._countdown(dt);
    else this._over(dt);
  }

  // Not simulating (overlay up, shop open): keep camera/HUD/shop responsive.
  idle(dt) {
    this._present(dt);
    this.input.endFrame();
  }

  _live(dt) {
    const hero = this.hero;
    if (this.controller) this.controller.update(dt, hero.intent, hero.pos);
    if (this.bot) this.bot.update(dt);
    this.waves.update(dt);
    this.shop.update(dt);
    if (this.consumables) this.consumables.update(dt);
    this.gold.update(dt);
    if (this.passives) this.passives.update(this.world, dt);
    this.world.update(dt);
    this.effects.update(dt);
    this._present(dt);
    this.input.endFrame();
  }

  _countdown(dt) {
    this.countdown -= dt;
    this._showBanner(this.countdown > 0 ? String(Math.ceil(this.countdown)) : 'FIGHT');
    if (this.countdown <= 0) this.skipCountdown();
    this._present(dt);
    this.input.endFrame();
  }

  _over(dt) {
    this.overAge += dt;
    clearIntent(this.hero.intent);
    clearIntent(this.enemy.intent);
    if (this.overAge >= RESTART_GRACE && (this.input.justPressed('Enter') || this.input.mouseJustPressed(0))) {
      this.reset();
    }
    this._present(dt);
    this.input.endFrame();
  }

  _present(dt) {
    this.camera.update(dt, this.hero.pos);
    this.hud.update(this.hero, this.world.time);
    this.abilityBar.update();
    this.shopPanel.update(dt);
  }

  _showBanner(text) {
    if (text === this._bannerText) return;
    this._bannerText = text;
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.display = text ? 'block' : 'none';
  }

  skipCountdown() {
    if (this.state !== 'countdown') return;
    this.state = 'live';
    this.countdown = 0;
    this._showBanner('');
  }

  end(winner) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.winner = winner;
    this.overAge = 0;
    clearIntent(this.hero.intent);
    clearIntent(this.enemy.intent);
    overPayload.winner = winner;
    events.emit('matchOver', overPayload);
    this._showBanner((winner === 'blue' ? 'BLUE' : 'RED') + ' WINS — click or Enter for a rematch');
  }

  // Full rematch: minions gone, structures restored, heroes back to L1/400 g at spawn,
  // clock to 0. Unit objects keep their identity (the bot and probe hold references).
  reset() {
    this.waves.reset();
    this.world.clear();
    this.effects.reset();
    // Re-register BEFORE resetting: clear() nulled every unit's `world`, and a reset
    // that respawns or re-arms a listener must see a live world, not null.
    this._readd(this.hero);
    this._readd(this.enemy);
    this.hero.reset();
    this.enemy.reset();
    for (let i = 0; i < TEAMS.length; i++) {
      const t = TEAMS[i];
      this._readd(this.towers[t]);
      this._readd(this.nexuses[t]);
      this.towers[t].reset();
      this.nexuses[t].reset();
    }
    this.gold.reset();
    this.shop.reset();
    if (this.consumables) this.consumables.reset();
    if (this.passives) this.passives.reset(this.world);
    if (this.bot) this.bot.reset();
    this.abilityBar.invalidate();
    this.hud.invalidate();
    clearIntent(this.hero.intent);
    clearIntent(this.enemy.intent);
    this.camera.snapTo(this.hero.pos);
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this.winner = null;
    this.overAge = 0;
    this._showBanner('READY');
  }

  // world.clear() detached the mesh from the scene along with the unit.
  _readd(u) {
    this.world.add(u);
    if (u.mesh && !u.mesh.parent && this.scene) this.scene.add(u.mesh);
  }

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
  }
}
