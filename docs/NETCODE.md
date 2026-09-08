# NETCODE.md — the multiplayer decision (not implemented in this slice)

This slice is single-player: one human, one bot, one simulation running in the browser.
Multiplayer is out of scope, but the slice's code is written so the simulation can be
lifted onto a server **unchanged**. This document records the decision and the one rule
the slice must honour to keep that true.

---

## 1. Why client-authoritative netcode is impossible for a MOBA

"Trust the client" works for a co-op toy where cheating hurts only the cheater. A MOBA
is a competitive economy: every number is a resource the opponent is fighting over, and
every one of them is trivially forged in a browser (open devtools, edit a field).

Concretely, if the client is authoritative:

- **Cooldowns**: the client reports "Q is ready"; a cheater reports it every tick and has
  a 0 s cooldown. The opponent has no way to know.
- **Gold and last hits**: the client says "my damage instance killed that minion";
  two clients both say it; there is no tie-breaker that isn't a server. A cheater claims
  every minion.
- **Damage**: the client sends "I hit you for 170". The opponent's client must either
  believe it (cheatable) or recompute it from its own view (desync: two clients with
  different positions, cooldowns, and HP disagree on who died, and the game forks).
- **Position**: the client sends its own position; speedhacks, teleports, dodging skill-
  shots by rewriting where you were.
- **Hidden state**: with no server there is nothing to hide state behind — every client
  has the whole world in memory, so fog/telegraph information is free to a cheater.

Peer-to-peer lockstep (both clients run the same deterministic sim from the same inputs)
solves cheating for *values* but not for *information*, needs bit-exact determinism
across browsers and float paths (Three.js math is not guaranteed bit-exact across
engines), stalls both players on the slowest connection, and cannot resolve a dropped
peer. It is the wrong tool for a real-time ranked format.

Conclusion: **every cooldown, gold pickup, damage roll, and position must be resolved by
a server the players do not control.** The client is a renderer and an input device.

---

## 2. Target architecture

```
  local input ──► HeroIntent ──┐
                               ├─► [ client ] ──intent/tick──► [ server: authoritative sim @ 20 Hz ]
  bot AI     ──► HeroIntent ──┘        ▲                                 │
                                       └────────── snapshot/tick ─────────┘
```

- **Server-authoritative simulation at a fixed 20 Hz tick** (dt = 0.05 s). The sim is
  the same code as the slice's `src/sim/*`: heroes, minions, towers, nexus, gold, XP,
  items, bot AI. It never renders and never reads a device.
- **Clients send one `HeroIntent` per tick**, tagged with a tick number. Nothing else
  goes up: no positions, no damage, no cooldowns, no "I bought X" (buying is an intent
  too: `buy: 0..4`, resolved server-side against gold and fountain position).
- **Server broadcasts a state snapshot every tick** (or every 2nd tick if bandwidth
  needs it): for each unit — id, type, position, facing, HP, MP, shield, level, status
  timers; per hero — cooldowns, gold, items, XP. Snapshots are delta-compressed against
  the last acknowledged one. Events that need a one-shot visual (a Q fired, a kill, a
  level-up) ride along as an event list on the snapshot.
- **Client-side prediction for the local hero's movement only.** The client applies its
  own `moveX/moveZ` immediately using the same movement function as the server, keeps a
  ring buffer of (tick, intent, predictedPos), and on each snapshot rewinds to the
  server's position for that tick and re-applies the intents since. Nothing else is
  predicted — not abilities, not attacks, not gold. Pressing Q shows a "casting" flash
  locally; the projectile appears when the server says so (≤ 1 RTT later).
- **Interpolation for everything else.** All remote units (enemy hero, all minions,
  projectiles) are rendered **100 ms in the past**, interpolated between the two
  snapshots that bracket the render time. Smooth at 20 Hz, no extrapolation needed.
- **No lag compensation.** Abilities resolve on the server against server positions at
  the server tick they arrive. A skillshot that looked like a hit on the client but
  missed on the server is a miss. This is acceptable because the aiming model is a
  ground reticle and slow projectiles (18–30 m/s), not hitscan: at 60 ms RTT a 5 m/s
  hero moves 0.3 m, and projectile radii are 0.5–0.8 m. Interpolation delay plus RTT
  under ~150 ms is the playable envelope; above that we show a warning, not a rewind.
- **Bot on the server.** The bot AI is just another `HeroIntent` producer running in the
  server process. A human can drop in and replace it by taking over its intent slot.

Bandwidth budget (rough): intent up = ~12 bytes × 20 Hz; snapshot down for 2 heroes +
~40 minions + ~10 projectiles ≈ 1.5 KB × 20 Hz = 30 KB/s uncompressed, ~8 KB/s with
deltas. Fine over WebSocket; WebRTC DataChannel (unreliable, unordered) is the later
optimisation for intents.

---

## 3. The one rule the slice must honour

> **The hero is driven by a plain-data `HeroIntent` object — numbers and booleans
> only — produced by either the local input controller or the bot AI, and the
> simulation never reads input devices directly.**

```js
// src/sim/intent.js — the only thing a hero consumes. Plain data. No methods.
export function createIntent() {
  return {
    moveX: 0, moveZ: 0,   // world-space unit vector (or zero); camera yaw already applied
    aimX: 0,  aimZ: 0,    // world-space ground reticle position
    attack: false,
    q: false, w: false, e: false, r: false,
    recall: false,
    buy: -1,              // 0..3 = item index this tick, -1 = none (see DESIGN §8)
  };
}
```

What this means in practice for the slice:

- `src/input/*` (keyboard, mouse, pointer lock, camera yaw) writes into the local hero's
  intent. `src/ai/*` writes into the bot hero's intent. Neither touches a hero directly.
- `src/sim/*` reads `hero.intent` and nothing else. No `window`, no `document`, no
  `KeyboardEvent`, no `performance.now()`, no `Math.random()` without a seedable RNG
  passed in. Time comes in as `dt` (the slice runs it at the render loop's dt today; the
  server will run it at a fixed 0.05).
- Intent is **mutated in place, never replaced** (zero per-frame allocation; also the
  shape the network layer will serialise into a fixed-size buffer).
- Intent fields are edge-sensitive where the design says so (Q/W/E/R/recall/buy fire on
  the rising edge; attack and move are level-sensitive). The sim tracks the previous
  intent itself so a held key over a dropped packet does not double-cast.
- Rendering (`src/render/*`, `src/hud/*`) reads sim state and never writes it. The HUD
  never calls a sim method; it listens on `src/core/events.js`.
- Anything that would be "obviously fine" to read from the DOM inside the sim (hero
  position from a mesh, reticle from a raycaster) goes through intent or state instead.
  If the sim imports Three.js for anything other than `Vector2/Vector3` math, that is a
  bug.

A probe assertion enforces this: `grep` `src/sim/` for `document`, `window`, `addEventListener`,
`performance.now`, and `requestAnimationFrame` must return nothing.

---

## 4. Hosting implication

Static hosting (a CDN, GitHub Pages, an S3 bucket) is enough for the slice: `index.html`
plus modules. It is **not** enough for multiplayer: the authoritative sim needs **a real
server process** — a Node process running `src/sim/*` at 20 Hz behind a WebSocket
endpoint, with a matchmaker in front of it and one sim instance per match. That means a
host with persistent processes (a VPS, Fly/Railway-style containers, or a dedicated
game-server host), a region choice (RTT is the whole ballgame — see §2), TLS
termination for `wss://`, and someone paying for it per running match. The client
stays static; only the sim moves. That is the whole point of the rule in §3.
