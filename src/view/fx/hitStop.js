// HitStop — a view-only time dilation: when an ultimate lands on a hero, the animator
// and particle clocks run at SCALE for HOLD seconds. The sim clock never changes
// (Phase 4 needs the sim deterministic), so this only edits `fx.viewScale`.
import { events } from '../../sim/core/events.js';

const HOLD = 0.08;
const SCALE = 0.25;

export class HitStop {
  constructor() {
    this.timer = 0;
    this.scale = 1;
    this._onHit = (p) => {
      if (p.slot === 'r' && p.unit && p.unit.kind === 'hero') { this.timer = HOLD; this.scale = SCALE; }
    };
    this._off = events.on('abilityHit', this._onHit);
  }
  // Returns the dt the view systems should advance by.
  scaled(dt) {
    if (this.timer <= 0) return dt;
    this.timer -= dt;                 // the hold itself counts in real time
    if (this.timer <= 0) { this.timer = 0; this.scale = 1; return dt; }
    return dt * this.scale;
  }
  reset() { this.timer = 0; this.scale = 1; }
  dispose() { this._off(); }
}
