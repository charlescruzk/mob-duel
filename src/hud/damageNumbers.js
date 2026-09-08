// DamageNumbers (PHASE2.md §5 feel feedback): 32 pooled divs, projected world → screen
// each frame, rising and fading over 0.8 s. Built once in the constructor; updates
// touch only transform/opacity. Colour by damage type, larger for hero hits.
import * as THREE from 'three';
import { events } from '../core/events.js';

const POOL = 32;
const LIFE = 0.8;
const RISE = 1.3;
const COLORS = { physical: '#ffd9a0', magic: '#9fc4ff', true: '#ffffff' };

export class DamageNumbers {
  constructor(camera) {
    this.camera = camera;
    this.vec = new THREE.Vector3();    // the one projection scratch, mutated in place
    this.slots = [];
    this._head = 0;
    this.root = null;
    if (!document.body) return;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:6;';
    document.body.appendChild(this.root);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:0;top:0;font:bold 15px sans-serif;'
        + 'color:#ffd9a0;text-shadow:0 1px 2px rgba(0,0,0,0.8);opacity:0;'
        + 'transform:translate(-100px,-100px);will-change:transform,opacity;';
      this.root.appendChild(el);
      this.slots.push({ el, life: 0, x: 0, y: 0, z: 0, hero: false });
    }
    this._offs = [events.on('unitDamaged', (p) => this._onDamaged(p))];
  }

  _onDamaged(p) {
    const unit = p.unit;
    if (!unit || !unit.pos || !(p.amount > 0)) return;
    this.add(unit.pos.x, unit.pos.y + unit.radius * 2 + 0.4, unit.pos.z, p.amount, p.dtype, unit.kind === 'hero');
  }

  // amount may be fractional (mitigated floats) — show one decimal under 10.
  add(x, y, z, amount, dtype, isHero) {
    if (!this.root) return;
    const s = this.slots[this._head];
    this._head = this._head + 1 === POOL ? 0 : this._head + 1;
    s.x = x; s.y = y; s.z = z; s.life = LIFE; s.hero = !!isHero;
    const n = amount < 10 ? (Math.round(amount * 10) / 10) : Math.round(amount);
    s.el.textContent = String(n);
    s.el.style.color = COLORS[dtype] || COLORS.physical;
    s.el.style.fontSize = (isHero ? 19 : 14) + 'px';
    s.el.style.opacity = '1';
  }

  update(dt) {
    if (!this.root || !this.camera || !this.vec) return;
    const w = (window.innerWidth || 1) * 0.5, h = (window.innerHeight || 1) * 0.5;
    const slots = this.slots;
    for (let i = 0; i < POOL; i++) {
      const s = slots[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.el.style.opacity = '0'; continue; }
      const t = 1 - s.life / LIFE;
      this.vec.set(s.x, s.y + t * RISE, s.z).project(this.camera);
      if (this.vec.z > 1) { s.el.style.opacity = '0'; continue; }   // behind the camera
      const px = (this.vec.x * 0.5 + 0.5) * w * 2;
      const py = (-this.vec.y * 0.5 + 0.5) * h * 2;
      s.el.style.transform = 'translate(' + (px - 24) + 'px,' + (py - 12) + 'px)';
      s.el.style.opacity = String(Math.min(1, s.life / (LIFE * 0.5)));
    }
  }

  reset() {
    for (let i = 0; i < POOL; i++) {
      this.slots[i].life = 0;
      this.slots[i].el.style.opacity = '0';
    }
  }

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}