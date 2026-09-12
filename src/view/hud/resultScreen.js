// ResultScreen — winner, duration and the player's numbers when a match ends. Counts
// its own stats from the event bus (works identically in online play, where the
// mirror replays the server's events). Built once; shown on 'matchOver'.
import { events } from '../../sim/core/events.js';
import { ensureHudStyles } from './hudStyles.js';

const ROWS = ['Duration', 'Kills / Deaths', 'Last hits', 'Damage dealt', 'Towers', 'Gold'];

export class ResultScreen {
  constructor() {
    this.hero = null; this.team = 'blue'; this.world = null;
    this.onPlayAgain = null; this.onChangeHero = null;
    this.lastHits = 0; this.damage = 0; this.towers = 0;
    this.shown = false; this.winner = null;
    if (typeof document === 'undefined') return;
    ensureHudStyles();
    const root = document.createElement('div');
    root.id = 'result-screen';
    const box = document.createElement('div'); box.className = 'rs-box';
    this.title = document.createElement('div'); this.title.className = 'rs-title';
    box.appendChild(this.title);
    const table = document.createElement('table');
    this.cells = [];
    for (let i = 0; i < ROWS.length; i++) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = ROWS[i];
      const b = document.createElement('td'); b.textContent = '';
      tr.appendChild(a); tr.appendChild(b); table.appendChild(tr);
      this.cells.push(b);
    }
    box.appendChild(table);
    const btns = document.createElement('div'); btns.className = 'rs-btns';
    const again = document.createElement('button'); again.type = 'button'; again.textContent = 'PLAY AGAIN';
    again.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); if (this.onPlayAgain) this.onPlayAgain(); });
    const change = document.createElement('button'); change.type = 'button'; change.textContent = 'CHANGE HERO';
    change.addEventListener('click', (e) => { e.stopPropagation(); if (this.onChangeHero) this.onChangeHero(); });
    btns.appendChild(again); btns.appendChild(change);
    box.appendChild(btns);
    root.appendChild(box);
    const hud = document.getElementById('hud');
    (hud ? hud.parentNode : document.body).appendChild(root);
    root.style.pointerEvents = 'auto';
    this.root = root;
    this._offs = [
      events.on('matchOver', (p) => this.show(p.winner)),
      events.on('unitDied', (p) => this._onDied(p)),
      events.on('unitDamaged', (p) => { if (this.hero && p.source === this.hero) this.damage += p.amount; }),
    ];
  }

  attach(hero, world) { this.hero = hero; this.team = hero.team; this.world = world; this.resetStats(); }

  resetStats() { this.lastHits = 0; this.damage = 0; this.towers = 0; }

  _onDied(p) {
    if (!this.hero || p.source !== this.hero) return;
    if (p.unit.kind === 'minion') this.lastHits++;
    else if (p.unit.kind === 'tower' && p.unit.team !== this.team) this.towers++;
  }

  show(winner) {
    this.winner = winner;
    this.shown = true;
    if (!this.root) return;
    const won = winner === this.team;
    this.title.textContent = won ? 'VICTORY' : 'DEFEAT';
    this.title.className = 'rs-title ' + (won ? 'win' : 'loss');
    const h = this.hero;
    const t = this.world ? this.world.time : 0;
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    this.cells[0].textContent = m + ':' + (s < 10 ? '0' : '') + s;
    this.cells[1].textContent = (h ? h.kills : 0) + ' / ' + (h ? h.deaths : 0);
    this.cells[2].textContent = String(this.lastHits);
    this.cells[3].textContent = String(Math.round(this.damage));
    this.cells[4].textContent = String(this.towers);
    this.cells[5].textContent = (h ? Math.floor(h.gold) : 0) + ' g';
    this.root.classList.add('show');
  }

  hide() { this.shown = false; if (this.root) this.root.classList.remove('show'); this.resetStats(); }
  dispose() { for (let i = 0; i < this._offs.length; i++) this._offs[i](); }
}
