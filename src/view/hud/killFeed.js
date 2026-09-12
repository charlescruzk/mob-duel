// KillFeed — the last few hero kills, top right. Four pooled rows, each fading after
// 6 s; built once, text swapped in place.
import { events } from '../../sim/core/events.js';
import { ensureHudStyles } from './hudStyles.js';

const ROWS = 4;
const LIFE = 6;

export class KillFeed {
  constructor() {
    this.rows = [];
    this.count = 0;
    if (typeof document === 'undefined') return;
    ensureHudStyles();
    const hud = document.getElementById('hud');
    if (!hud) return;
    const root = document.createElement('div');
    root.id = 'kill-feed';
    for (let i = 0; i < ROWS; i++) {
      const row = document.createElement('div');
      const a = document.createElement('b'); const mid = document.createElement('span'); const b = document.createElement('b');
      row.appendChild(a); row.appendChild(mid); row.appendChild(b);
      root.appendChild(row);
      this.rows.push({ el: row, a, mid, b, t: 0 });
    }
    hud.appendChild(root);
    this._off = events.on('heroDied', (p) => this.push(p.hero, p.source));
  }

  push(victim, killer) {
    if (!this.rows.length || !victim) return;
    // Shift older rows down; the newest goes on top.
    for (let i = this.rows.length - 1; i > 0; i--) this._copy(this.rows[i - 1], this.rows[i]);
    const r = this.rows[0];
    const k = killer && killer.kind === 'hero' ? killer : null;
    r.a.textContent = k ? k.data.name : (killer && killer.kind ? killer.kind : 'the fountain');
    r.a.className = k ? k.team : (killer ? killer.team : '');
    r.mid.textContent = ' killed ';
    r.b.textContent = victim.data.name;
    r.b.className = victim.team;
    r.t = LIFE;
    r.el.classList.add('show');
    this.count++;
  }

  _copy(from, to) {
    to.a.textContent = from.a.textContent; to.a.className = from.a.className;
    to.mid.textContent = from.mid.textContent;
    to.b.textContent = from.b.textContent; to.b.className = from.b.className;
    to.t = from.t;
    to.el.classList.toggle('show', from.t > 0);
  }

  update(dt) {
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) { r.t = 0; r.el.classList.remove('show'); }
    }
  }

  reset() { for (let i = 0; i < this.rows.length; i++) { this.rows[i].t = 0; this.rows[i].el.classList.remove('show'); } }
}
