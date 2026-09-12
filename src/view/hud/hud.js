// HUD shell: HP/MP bars + numbers, gold, level, match timer, respawn timer, reticle.
// Greps its elements once; every getElementById result is guarded. Writes to the DOM
// only when a displayed value changes. The ability bar (#ability-bar) and shop (#shop)
// roots are reserved in index.html for src/hud/abilityBar.js and src/hud/shopPanel.js.

const byId = (id) => document.getElementById(id);

function fmtTime(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

export class Hud {
  constructor() {
    this.root = byId('hud');
    this.hpBar = byId('hp-bar');
    this.mpBar = byId('mp-bar');
    this.hpNum = byId('hp-num');
    this.mpNum = byId('mp-num');
    this.gold = byId('gold');
    this.level = byId('level-badge');
    this.timer = byId('match-timer');
    this.respawn = byId('respawn-timer');
    this.reticle = byId('reticle');
    // Last written values — the DOM is touched only on change.
    this._hp = -1; this._maxHp = -1; this._mp = -1; this._maxMp = -1;
    this._gold = -1; this._level = -1; this._sec = -1; this._respawn = -1;
    this._reticleShown = true;
  }

  // hero: any object with hp/maxHp; optional mp/maxMp/gold/level/respawnTimer.
  // time: match seconds.
  update(hero, time) {
    if (hero) {
      const hp = Math.ceil(hero.hp || 0);
      const maxHp = Math.ceil(hero.maxHp || 0);
      const mp = Math.ceil(hero.mp || 0);
      const maxMp = Math.ceil(hero.maxMp || 0);
      if (hp !== this._hp || maxHp !== this._maxHp) {
        this._hp = hp; this._maxHp = maxHp;
        if (this.hpBar) this.hpBar.style.transform = 'scaleX(' + (maxHp > 0 ? hp / maxHp : 0) + ')';
        if (this.hpNum) this.hpNum.textContent = hp + ' / ' + maxHp;
      }
      if (mp !== this._mp || maxMp !== this._maxMp) {
        this._mp = mp; this._maxMp = maxMp;
        if (this.mpBar) this.mpBar.style.transform = 'scaleX(' + (maxMp > 0 ? mp / maxMp : 0) + ')';
        if (this.mpNum) this.mpNum.textContent = mp + ' / ' + maxMp;
      }
      const gold = Math.floor(hero.gold || 0);
      if (gold !== this._gold) {
        this._gold = gold;
        if (this.gold) this.gold.textContent = gold + ' g';
      }
      const level = hero.level || 1;
      if (level !== this._level) {
        this._level = level;
        if (this.level) this.level.textContent = 'LV ' + level;
      }
      const rs = hero.alive === false ? Math.ceil(hero.respawnTimer || 0) : 0;
      if (rs !== this._respawn) {
        this._respawn = rs;
        if (this.respawn) {
          this.respawn.style.display = rs > 0 ? 'block' : 'none';
          if (rs > 0) this.respawn.textContent = 'RESPAWN ' + rs;
        }
      }
    }
    const sec = Math.floor(time || 0);
    if (sec !== this._sec) {
      this._sec = sec;
      if (this.timer) this.timer.textContent = fmtTime(sec);
    }
  }

  showReticle(on) {
    if (on === this._reticleShown) return;
    this._reticleShown = on;
    if (this.reticle) this.reticle.hidden = !on;
  }

  // Force every field to rewrite on the next update (match reset).
  invalidate() {
    this._hp = this._maxHp = this._mp = this._maxMp = -1;
    this._gold = this._level = this._sec = this._respawn = -1;
  }
}
