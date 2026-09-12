// AbilityBar — fills #ability-bar with five slots (Passive Q W E R): name, mana cost,
// a cooldown sweep + number, greyed when locked / cooling / unaffordable / busy.
// Built once in the constructor (including its own <style>), updated in place, and
// every DOM lookup is guarded so a missing root degrades to a no-op.
import { SLOTS, R_UNLOCK_LEVEL } from '../../sim/hero/heroData.js';

const KEY_HINT = { p: 'P', q: 'Q', w: 'F', e: 'E', r: 'R' };
const STATES = ['locked', 'cooldown', 'mana', 'busy'];
const CSS =
  '#ability-bar .ab-slot{position:relative;width:64px;height:64px;background:rgba(10,12,18,.78);' +
  'border:1px solid rgba(255,255,255,.28);border-radius:6px;overflow:hidden;font-family:monospace;' +
  'color:#e8e6e0;text-shadow:0 0 3px #000;box-sizing:border-box}' +
  '#ability-bar .ab-key{position:absolute;left:5px;top:3px;font:700 13px/1 monospace;color:#f2c84b}' +
  '#ability-bar .ab-name{position:absolute;left:0;right:0;top:20px;text-align:center;font:11px/1.1 monospace;padding:0 3px}' +
  '#ability-bar .ab-cost{position:absolute;right:5px;bottom:3px;font:10px/1 monospace;color:#7fb3ff}' +
  '#ability-bar .ab-cd{position:absolute;left:0;right:0;bottom:0;height:100%;background:rgba(0,0,0,.62);' +
  'transform-origin:bottom center;transform:scaleY(0)}' +
  '#ability-bar .ab-num{position:absolute;left:0;right:0;top:50%;margin-top:-9px;text-align:center;' +
  'font:700 16px/1 monospace;color:#fff;display:none}' +
  '#ability-bar .ab-slot.cooldown .ab-num{display:block}' +
  '#ability-bar .ab-slot.locked{opacity:.35}' +
  '#ability-bar .ab-slot.mana .ab-cost{color:#ff6b6b}' +
  '#ability-bar .ab-slot.mana,#ability-bar .ab-slot.busy{filter:grayscale(.8) brightness(.75)}' +
  '#ability-bar .ab-slot.passive{border-style:dashed}';

function makeSlot(root, slot) {
  const el = document.createElement('div');
  el.className = slot === 'p' ? 'ab-slot passive' : 'ab-slot';
  const key = document.createElement('div'); key.className = 'ab-key'; key.textContent = KEY_HINT[slot];
  const name = document.createElement('div'); name.className = 'ab-name';
  const cost = document.createElement('div'); cost.className = 'ab-cost';
  const cd = document.createElement('div'); cd.className = 'ab-cd';
  const num = document.createElement('div'); num.className = 'ab-num';
  el.appendChild(key); el.appendChild(name); el.appendChild(cost); el.appendChild(cd); el.appendChild(num);
  root.appendChild(el);
  return { slot, el, name, cost, cd, num, _name: '', _cost: -1, _state: '', _tenths: -1, _frac: -1 };
}

export class AbilityBar {
  constructor(hero = null) {
    this.hero = hero;
    this.root = typeof document !== 'undefined' ? document.getElementById('ability-bar') : null;
    this.slots = [];
    if (!this.root) return;
    if (!document.getElementById('ability-bar-style')) {
      const style = document.createElement('style');
      style.id = 'ability-bar-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.slots.push(makeSlot(this.root, 'p'));
    for (let i = 0; i < SLOTS.length; i++) this.slots.push(makeSlot(this.root, SLOTS[i]));
  }

  setHero(hero) {
    this.hero = hero;
    this.invalidate();
  }

  invalidate() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s._name = ''; s._cost = -1; s._state = ''; s._tenths = -1; s._frac = -1;
    }
  }

  update(hero = this.hero) {
    if (!hero || !this.root || !hero.data) return;
    const data = hero.data;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.slot === 'p') { this._updatePassive(s, hero, data.passive); continue; }
      const def = data.abilities[s.slot];
      if (!def) continue;
      if (s._name !== def.name) { s._name = def.name; s.name.textContent = def.name; s.el.title = def.desc || ''; }
      if (s._cost !== def.cost) { s._cost = def.cost; s.cost.textContent = def.cost + ' MP'; }
      const state = hero.abilityState ? hero.abilityState(s.slot) : 'ready';
      if (state !== s._state) {
        s._state = state;
        for (let k = 0; k < STATES.length; k++) s.el.classList.toggle(STATES[k], STATES[k] === state);
        if (state !== 'cooldown') { s.cd.style.transform = 'scaleY(0)'; s._frac = -1; s._tenths = -1; }
        if (state === 'locked') s.num.textContent = '';
      }
      if (state === 'cooldown') this._updateCooldown(s, hero, def);
    }
  }

  _updatePassive(s, hero, passive) {
    if (!passive) return;
    if (s._name !== passive.name) {
      s._name = passive.name;
      s.name.textContent = passive.name;
      s.cost.textContent = 'passive';
      s.el.title = passive.desc || '';
    }
  }

  // Writes happen only when the displayed tenth / percent changes (≤ 10 writes/s).
  _updateCooldown(s, hero, def) {
    const remaining = hero.cooldowns ? hero.cooldowns[s.slot] : 0;
    const total = def.cd * (1 - (hero.cdr || 0));
    const tenths = Math.ceil(remaining * 10);
    if (tenths !== s._tenths) {
      s._tenths = tenths;
      s.num.textContent = remaining >= 10 ? String(Math.ceil(remaining)) : (tenths / 10).toFixed(1);
    }
    const frac = total > 0 ? Math.round((remaining / total) * 100) : 0;
    if (frac !== s._frac) {
      s._frac = frac;
      s.cd.style.transform = 'scaleY(' + (frac / 100) + ')';
    }
  }
}

export { R_UNLOCK_LEVEL };
