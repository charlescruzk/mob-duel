// TouchControls — phone/tablet input (docs/PHASE3.md §6). Pointer events with
// pointerType 'touch' drive: a floating joystick (left 44% of the screen), a look
// drag (the rest, outside buttons), the attack/skill/utility buttons, and manual
// aim by dragging a skill. HeroController calls applyIntent() at the end of its
// update so touch overrides the keyboard fields in the same frame the sim reads.
import { buildTouchUi, refreshButtons, SKILLS as SLOTS } from './touchUi.js';
import { bindPointers } from './touchBind.js';
import { assistedAim, manualAim, aimAtTarget, pickTargetAt, pickTargetNear, pursueDirection, AimIndicator, TargetMarker } from './touchAim.js';

const DEAD = 0.14;                 // joystick dead zone (fraction of radius)
const DRAG_PX = 18;                // finger travel that turns a tap into manual aim
const FULL_PX = 70;                // drag length meaning "full range"
const LOOK_SENS = 2.2;             // touch look is slower than a mouse
const AIM_HOLD = 0.6;              // seconds the cast aim stays pinned (wind-ups resolve later)
const TAP_MS = 260;                // press-and-release inside this is a tap, not a drag
const TAP_PX = 14;
const TAP_RADIUS = 90;             // CSS px around a tap that can claim a unit
const JOY_SHOW_PX = 8;             // the stick only appears once the thumb actually moves
// Pursuit, as every big mobile MOBA does it: holding attack walks you into range of
// the target, but only a short way (Mobile Legends' "Close Pursuit", Honor of Kings'
// "Auto Chase Distance: Close-Range"), and the movement stick always wins (Mobile
// Legends' "Moving Pursuit off"). Wild Rift does the same auto-follow on attack.
const PURSUE_EXTRA = 5.0;          // metres past attack range we are willing to walk
const PURSUE_STOP = 0.35;          // stop this far inside range so attacks do not drop
const PURSUIT_KEY = 'mobaDuel.pursuit';
const scratch = { x: 0, z: 0 };

export class TouchControls {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this.active = false;
    this.world = null; this.rig = null; this.hero = null; this.controller = null;
    this.ui = null;
    this.aimIndicator = null;
    this.onPause = null;
    // joystick / look pointers
    this.joyId = -1; this.joyX = 0; this.joyY = 0; this.jx = 0; this.jz = 0;   // jx/jz world-space
    this.lookId = -1; this.lookX = 0; this.lookY = 0;
    // Tap bookkeeping, shared by both zones: a short press that never travels is a
    // target tap, so the left stick stays movement-only and the right stays camera-only.
    this.tap = { id: -1, x: 0, y: 0, t: 0 };
    this.target = null;
    this.marker = null;
    this.pursuit = true;           // toggled in the pause menu, like the games above
    this.pursuing = false;         // true on frames where pursuit is steering
    try { this.pursuit = localStorage.getItem(PURSUIT_KEY) !== '0'; } catch { /* storage blocked */ }
    this.atkDrag = { id: -1, x0: 0, y0: 0, on: false };
    // buttons: held state and the pending one-frame edges
    this.attackHeld = false;
    this.pending = { q: false, w: false, e: false, r: false, recall: false, useItem: -1, shop: false };
    this.aimHold = 0; this.aimX = 0; this.aimZ = 0;
    this.drag = { id: -1, slot: '', x0: 0, y0: 0, dx: 0, dy: 0, manual: false };
    this.stats = { taps: 0, casts: 0, manualCasts: 0, targets: 0, dragLocks: 0 };
    this.portrait = false;
    if (typeof window === 'undefined') return;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if ((navigator.maxTouchPoints || 0) > 0 && coarse) this.activate();
    this._onFirstTouch = () => this.activate();
    window.addEventListener('touchstart', this._onFirstTouch, { passive: true, once: true });
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.input.touchLook = true;
    document.body.classList.add('touch');
    this.ui = buildTouchUi();
    this.aimIndicator = new AimIndicator();
    this.marker = new TargetMarker();
    bindPointers(this);
    this._orient();
    window.addEventListener('resize', () => this._orient());
  }

  attach(world, camera, hero, controller) {
    this.world = world; this.rig = camera; this.hero = hero; this.controller = controller;
    if (this.ui) { const a = hero.data.abilities; for (let i = 0; i < SLOTS.length; i++) this.ui.skills[SLOTS[i]].sub.textContent = a[SLOTS[i]].name; }
  }

  _orient() { this.portrait = window.innerHeight > window.innerWidth; document.body.classList.toggle('portrait', this.portrait); }

  _joyStart(e) {
    if (this.joyId >= 0) return;
    this.joyId = e.pointerId; this.joyX = e.clientX; this.joyY = e.clientY;
    this.ui.joy.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    this.ui.knob.style.transform = 'translate(0px,0px)';
    this._markTap(e);
  }

  _lookStart(e) {
    if (this.lookId >= 0) return;
    this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
    this._markTap(e);
  }

  _markTap(e) {
    const t = this.tap;
    t.id = e.pointerId; t.x = e.clientX; t.y = e.clientY; t.t = performance.now();
  }

  // True when this pointer went down and up in one spot, quickly.
  _wasTap(e) {
    const t = this.tap;
    if (t.id !== e.pointerId) return false;
    t.id = -1;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    return performance.now() - t.t < TAP_MS && Math.sqrt(dx * dx + dy * dy) < TAP_PX;
  }

  // Tap in the world: lock the enemy under the finger, or clear the lock.
  _pick(x, y) {
    if (!this.world || !this.hero || !this.rig) return;
    const u = pickTargetAt(this.rig.camera, this.world, this.hero, x, y, TAP_RADIUS);
    this.target = u || null;
    this.stats.targets += u ? 1 : 0;
  }

  _skillDown(slot, e) {
    const d = this.drag;
    if (d.id >= 0) return;
    d.id = e.pointerId; d.slot = slot; d.x0 = e.clientX; d.y0 = e.clientY; d.dx = 0; d.dy = 0; d.manual = false;
  }

  _move(e) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.joyId) {
      const radius = this.ui.joy.offsetWidth * 0.5 || 60;
      let dx = e.clientX - this.joyX, dy = e.clientY - this.joyY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const k = len > radius ? radius / len : 1;
      dx *= k; dy *= k;
      this.ui.knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      if (len > JOY_SHOW_PX) this.ui.joy.classList.add('on');
      const f = len / radius;
      if (f < DEAD) { this.jx = 0; this.jz = 0; return; }
      // Screen up = camera forward; screen right = camera right.
      const nx = dx / (len || 1), ny = dy / (len || 1);
      const rig = this.rig;
      if (!rig) return;
      this.jx = rig.rightX * nx - rig.forwardX * ny;
      this.jz = rig.rightZ * nx - rig.forwardZ * ny;
      const l = Math.sqrt(this.jx * this.jx + this.jz * this.jz) || 1;
      this.jx /= l; this.jz /= l;
      e.preventDefault();
    } else if (e.pointerId === this.lookId) {
      this.input.mouseDX += (e.clientX - this.lookX) * LOOK_SENS;
      this.input.mouseDY += (e.clientY - this.lookY) * LOOK_SENS;
      this.lookX = e.clientX; this.lookY = e.clientY;
      e.preventDefault();
    } else if (e.pointerId === this.atkDrag.id) {
      // Drag the attack button toward a unit to lock it, as Wild Rift and Honor of
      // Kings do: the direction picks the target, the finger never leaves the button.
      const a = this.atkDrag;
      const dx = e.clientX - a.x0, dy = e.clientY - a.y0;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_PX && this.hero && this.rig && this.world) {
        if (!a.on) { a.on = true; this.ui.atk.el.classList.add('aiming'); }
        manualAim(this.hero, null, this.rig, dx, dy, FULL_PX, scratch);
        const u = pickTargetNear(this.world, this.hero, scratch.x, scratch.z, 3.5);
        if (u && u !== this.target) { this.target = u; this.stats.dragLocks++; }
      }
      e.preventDefault();
    } else if (e.pointerId === this.drag.id) {
      const d = this.drag;
      d.dx = e.clientX - d.x0; d.dy = e.clientY - d.y0;
      if (!d.manual && Math.sqrt(d.dx * d.dx + d.dy * d.dy) > DRAG_PX) { d.manual = true; this.ui.skills[d.slot].el.classList.add('aiming'); }
      e.preventDefault();
    }
  }

  _up(e) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.joyId) {
      this.joyId = -1; this.jx = 0; this.jz = 0; this.ui.joy.classList.remove('on');
      if (this._wasTap(e)) this._pick(e.clientX, e.clientY);
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1;
      if (this._wasTap(e)) this._pick(e.clientX, e.clientY);
    }
    else if (e.pointerId === this.drag.id) {
      const d = this.drag;
      const b = this.ui.skills[d.slot];
      b.el.classList.remove('aiming');
      const len = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
      // Manual aim released back near the button cancels; anything else casts.
      if (!d.manual || len > DRAG_PX) this._cast(d.slot, d.manual, d.dx, d.dy);
      if (this.aimIndicator) this.aimIndicator.hide();
      d.id = -1; d.slot = ''; d.manual = false;
    }
  }

  _cast(slot, manual, dx, dy) {
    if (!this.hero || !this.rig) return;
    const def = this.hero.data.abilities[slot];
    if (manual) manualAim(this.hero, def, this.rig, dx, dy, FULL_PX, scratch);
    else if (this._locked()) aimAtTarget(this.hero, this.target, scratch);
    else assistedAim(this.world, this.hero, def, this.rig, this.jx, this.jz, scratch);
    this.aimX = scratch.x; this.aimZ = scratch.z; this.aimHold = AIM_HOLD;
    this.pending[slot] = true;
    this.stats.casts++; if (manual) this.stats.manualCasts++;
  }

  // Called by HeroController at the end of its update, before the sim reads intent.
  applyIntent(intent, heroPos, rig) {
    if (!this.active) return;
    intent.moveX = this.jx; intent.moveZ = this.jz;
    intent.attack = this.attackHeld;
    this._pursue(intent);
    const p = this.pending;
    intent.q = p.q; intent.w = p.w; intent.e = p.e; intent.r = p.r; intent.recall = p.recall;
    if (p.useItem >= 0) intent.useItem = p.useItem;
    if (p.shop) { this.input._just.add('KeyP'); }     // the shop panel listens for the key
    p.q = p.w = p.e = p.r = p.recall = false; p.useItem = -1; p.shop = false;
    intent.targetId = this._locked() ? this.target.id : 0;
    if (this.aimHold > 0) { intent.aimX = this.aimX; intent.aimZ = this.aimZ; }
    else if (this._locked()) {
      aimAtTarget(this.hero, this.target, scratch);
      intent.aimX = scratch.x; intent.aimZ = scratch.z;
    } else if (this.attackHeld && this.hero && this.world) {
      assistedAim(this.world, this.hero, null, rig, this.jx, this.jz, scratch);
      intent.aimX = scratch.x; intent.aimZ = scratch.z;
    }
  }

  // Holding attack with the stick idle walks toward whatever we would attack, up to
  // PURSUE_EXTRA past attack range. Any stick input cancels it the same frame.
  _pursue(intent) {
    this.pursuing = false;
    if (!this.pursuit || !this.attackHeld || !this.hero || !this.world) return;
    if (this.jx !== 0 || this.jz !== 0) return;                 // the stick always wins
    const hero = this.hero;
    if (!hero.alive || hero.stunned || hero.isRecalling) return;
    let t = this._locked() ? this.target : null;
    if (!t) {
      assistedAim(this.world, hero, null, this.rig, 0, 0, scratch);
      t = pickTargetNear(this.world, hero, scratch.x, scratch.z, 0.5);
    }
    if (!t) return;
    if (!pursueDirection(hero, t, PURSUE_EXTRA, PURSUE_STOP, scratch)) return;
    intent.moveX = scratch.x; intent.moveZ = scratch.z;
    this.pursuing = true;
  }

  setPursuit(on) {
    this.pursuit = !!on;
    try { localStorage.setItem(PURSUIT_KEY, this.pursuit ? '1' : '0'); } catch { /* storage blocked */ }
  }

  _locked() { const t = this.target; return !!(t && t.alive && t.world && !t.invulnerable); }

  update(dt) {
    if (!this.active || !this.hero) return;
    if (this.aimHold > 0) { this.aimHold -= dt; if (this.aimHold < 0) this.aimHold = 0; }
    if (this.target && !this._locked()) this.target = null;   // it died or left
    if (this.marker) this.marker.follow(this.hero, this._locked() ? this.target : null, dt);
    // Manual aim indicator follows the finger.
    const d = this.drag;
    if (d.manual && this.aimIndicator) {
      manualAim(this.hero, this.hero.data.abilities[d.slot], this.rig, d.dx, d.dy, FULL_PX, scratch);
      this.aimIndicator.show(this.hero, scratch.x, scratch.z);
    }
    refreshButtons(this.ui, this.hero);
  }

  setQuality(q) {
    const s = new URLSearchParams(location.search);
    if (q === 'low') { s.delete('hifx'); s.set('lowfx', '1'); } else { s.delete('lowfx'); s.set('hifx', '1'); }
    location.search = s.toString();
  }

  reset() {
    this.attackHeld = false; this.aimHold = 0; this.jx = 0; this.jz = 0;
    this.pursuing = false; this.atkDrag.id = -1; this.atkDrag.on = false;
    this.target = null;
    if (this.marker) this.marker.hide();
  }
  dispose() {}
}
