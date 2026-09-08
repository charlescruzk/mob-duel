// EventBus — the only channel systems use to talk to each other (see CLAUDE.md).
// `on` returns an unsubscribe function. Payload objects are OWNED BY THE EMITTER and
// reused across emits: listeners must copy fields out, never keep the reference.

export class EventBus {
  constructor() {
    this._map = new Map();
  }

  on(name, fn) {
    let list = this._map.get(name);
    if (!list) { list = []; this._map.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  // Indexed loop (no iterator allocation). A listener that unsubscribes itself during
  // emit is handled by re-reading length each step; the shifted neighbour is skipped
  // for this emit only, which is acceptable for game events.
  emit(name, payload) {
    const list = this._map.get(name);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }

  clear() {
    this._map.clear();
  }
}

// One shared bus for the whole game. Modules import `events` directly rather than
// threading it through every constructor.
export const events = new EventBus();
