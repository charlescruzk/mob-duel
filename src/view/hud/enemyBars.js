// EnemyBars — pooled HP bars projected above every unit but the player's hero.
// 24 divs built once; per frame each is positioned with a transform or hidden.
import * as THREE from 'three';
import { HEIGHTS } from '../../sim/map/laneData.js';
import { ensureHudStyles } from './hudStyles.js';

const POOL = 24;

export class EnemyBars {
  constructor(camera, world, playerHero) {
    this.camera = camera; this.world = world; this.player = playerHero;
    this.bars = [];
    this.vec = new THREE.Vector3();
    this.w = 1; this.h = 1;
    if (typeof document === 'undefined') return;
    ensureHudStyles();
    const hud = document.getElementById('hud');
    if (!hud) return;
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'eb';
      const fill = document.createElement('i');
      el.appendChild(fill);
      hud.appendChild(el);
      this.bars.push({ el, fill, unit: null, _frac: -1, _cls: '' });
    }
  }

  update() {
    if (!this.bars.length || !this.camera) return;
    const units = this.world.units;
    this.w = window.innerWidth; this.h = window.innerHeight;
    let n = 0;
    for (let i = 0; i < units.length && n < this.bars.length; i++) {
      const u = units[i];
      if (u === this.player || !u.alive || u.hp <= 0) continue;
      const height = u.kind === 'hero' ? HEIGHTS.hero : u.kind === 'tower' ? HEIGHTS.tower : u.kind === 'nexus' ? HEIGHTS.nexus : HEIGHTS.minion;
      this.vec.set(u.pos.x, u.pos.y + height + 0.35, u.pos.z).project(this.camera);
      if (this.vec.z > 1 || this.vec.x < -1.1 || this.vec.x > 1.1 || this.vec.y < -1.1 || this.vec.y > 1.1) continue;
      const b = this.bars[n++];
      const sx = (this.vec.x + 1) * 0.5 * this.w, sy = (1 - this.vec.y) * 0.5 * this.h;
      b.el.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
      b.el.style.opacity = '1';
      const cls = 'eb' + (u.team === 'blue' ? ' blue' : '') + (u.kind === 'hero' ? ' big' : '');
      if (cls !== b._cls) { b._cls = cls; b.el.className = cls; }
      const frac = Math.round((u.maxHp > 0 ? u.hp / u.maxHp : 0) * 100) / 100;
      if (frac !== b._frac) { b._frac = frac; b.fill.style.transform = 'scaleX(' + frac + ')'; }
      b.unit = u;
    }
    for (let i = n; i < this.bars.length; i++) { const b = this.bars[i]; if (b.unit) { b.unit = null; b.el.style.opacity = '0'; } }
    this.visible = n;
  }
}
