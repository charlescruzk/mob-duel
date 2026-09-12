// GameAudio — WebAudio, all synthesised (no asset files). Built once in main.js and
// ticked from the view step. Listens to the event bus for casts, hits, kills and
// match state; `unlock()` must run inside the first user gesture. Phase 3 fills this
// in (docs/PHASE3.md §7); until then every method is a safe no-op.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
  }
  unlock() { /* create/resume the AudioContext on first gesture */ }
  setMuted(m) { this.muted = !!m; }
  setVolume(v) { this.volume = v; }
  update(dt) { /* ambience/music scheduling */ }
  reset() { /* stop one-shots on match reset */ }
  dispose() {}
}
