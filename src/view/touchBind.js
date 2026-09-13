// Pointer plumbing for TouchControls: which zone or button a touch belongs to, and
// the preventDefault rules. Kept apart from the control logic so neither file grows
// past the size limit. Every listener calls back into the TouchControls instance.

import { SKILLS as SLOTS } from './touchUi.js';

export function bindPointers(tc) {
    const ui = tc.ui;
    const opts = { passive: false };
    const move = (e) => tc._move(e), up = (e) => tc._up(e);
    ui.move.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; e.preventDefault(); tc._joyStart(e); }, opts);
    ui.look.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; e.preventDefault(); tc._lookStart(e); }, opts);
    window.addEventListener('pointermove', move, opts);
    window.addEventListener('pointerup', up, opts);
    window.addEventListener('pointercancel', up, opts);
    const bindBtn = (b, onDown, onUp) => {
      b.el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; e.preventDefault(); e.stopPropagation(); b.el.classList.add('press'); onDown(e); }, opts);
      const rel = (e) => { b.el.classList.remove('press'); if (onUp) onUp(e); };
      b.el.addEventListener('pointerup', rel, opts);
      b.el.addEventListener('pointercancel', rel, opts);
    };
    bindBtn(ui.atk, (e) => {
      tc.attackHeld = true; tc.stats.taps++;
      tc.atkDrag.id = e.pointerId; tc.atkDrag.x0 = e.clientX; tc.atkDrag.y0 = e.clientY; tc.atkDrag.on = false;
    }, () => {
      tc.attackHeld = false;
      tc.atkDrag.id = -1;
      if (tc.atkDrag.on) { tc.atkDrag.on = false; tc.ui.atk.el.classList.remove('aiming'); }
    });
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      bindBtn(ui.skills[slot], (e) => tc._skillDown(slot, e), null);
    }
    bindBtn(ui.rec, () => { tc.pending.recall = true; });
    bindBtn(ui.pot, () => { tc.pending.useItem = 0; });
    bindBtn(ui.shop, () => { tc.pending.shop = true; });
    bindBtn(ui.menu, () => { if (tc.onPause) tc.onPause(); });
}
