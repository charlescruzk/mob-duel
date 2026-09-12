# CLAUDE.md — rules for working in this repo

You are building **moba-duel**: a third-person MOBA in the browser. This repo holds the
**1v1 duel-lane vertical slice** — one lane, two heroes, minion waves, a tower and a nexus
per side, gold from last-hits, a small shop. The purpose of the slice is to prove the core
loop *feels right* before any of the expensive parts (more heroes, three lanes, jungle,
multiplayer) are built:

> last-hit under pressure → trade damage → get zoned by the tower → land a combo →
> recall, buy, come back stronger

Read `docs/DESIGN.md` for the numbers and `docs/ARCHITECTURE.md` for where code goes.
Track status in `docs/PROGRESS.md`.

## Hard constraints

- **No build step, no npm install, no bundler — for this slice.** Everything runs from
  `index.html` served statically; Three.js comes from the importmap. This is a deliberate
  choice for a ~6k-line slice so it runs instantly and verifies headlessly. It is *not* a
  permanent rule: a bundler and TypeScript are expected once the project outgrows it, and
  the file layout is chosen so that migration is mechanical.
- Import Three.js as `import * as THREE from 'three'`, addons as
  `import { X } from 'three/addons/...'`. Do not change the pinned version.
- Vanilla JavaScript ES modules only. No TypeScript, no JSX, no frameworks.
- Keep each file under ~300 lines. Split when it grows past that.
- One concern per file. Follow `docs/ARCHITECTURE.md` exactly.
- No external dependencies of any kind (no other CDN scripts, no npm packages).
- Primitive geometry and procedurally generated canvas textures only. No asset files.
- Do not create files outside `src/`, `docs/`, `index.html`, `scripts/`, and `server/`.
- `server/` (Phase 4) is a Node program using **built-in modules only** (`node:http`,
  `node:crypto`, `node:net`) — the WebSocket handshake and framing are written by hand,
  no `ws` package. It imports the simulation from `src/sim/` unchanged.
- `src/sim/` never imports `three` or touches the DOM. `src/view/` and `src/fx/` read sim
  state and render it; they never mutate it. This is what lets the same sim run on the
  server (`docs/NETCODE.md`).
- **Mobile is a first-class target.** Everything must work with touch and no pointer
  lock (see `docs/PHASE3.md` §6). Test at 390×844 (phone, landscape) and desktop.
- Deployed client: GitHub Pages from `main` at https://charlescruzk.github.io/mob-duel/.
  Nothing may depend on being served from the site root — all paths stay relative.
- No real game's hero, ability or item names. Generic or original names only.

## Coding conventions

- `const` by default, `let` when reassigned, never `var`.
- Named exports. One default export only for a module's main class if it has one.
- Units: 1 world unit = 1 meter. Y is up. Forward is -Z.
- Time: `dt` in seconds, passed explicitly into every `update(dt)`. Never read the clock
  from inside a system.
- Game state lives in objects created in `src/main.js`. No globals except `window.__game`
  for debugging, set once in `main.js`.
- Cross-module communication goes through `src/core/events.js`. Systems never import
  each other's classes just to call methods; they emit and listen.
- Comments explain *why*, not *what*. Keep them short.

## Quality gates (every task, every file you touch)

- **No per-frame allocation.** Nothing on a path that runs every frame allocates: no
  object/array literals, no `new`, no `.clone()`, no `.map()`/`.filter()`, no template
  strings. Module-level scratch objects mutated in place are the pattern.
- **No DOM churn.** `document.createElement` only in a constructor or one-time build.
  Elements are created once and toggled/updated in place.
- **Null-safe DOM.** Every `getElementById` result is guarded. A missing element
  degrades silently — a throw in a per-frame HUD update takes the game down.
- **State resets.** Anything you introduce is cleared on the transitions that should
  clear it (hero death, respawn, match reset).
- **Proven by the harness.** Every feature adds at least one probe assertion that
  would fail if it broke.
- **Honest limitations.** State what you could not verify. The probe cannot see feel,
  balance, or frame rate.

## Verification

```bash
npm run check     # node --check on every .js under src/ and scripts/ — syntax only
npm run probe     # headless Chrome via CDP: boots the page, drives the game, asserts
```

`check` proves nothing about behaviour. A task is *verified* only when `probe` exits 0
with `(no code errors)` and every assertion true.

## Commit discipline

Commit after each completed task with a message naming the task.
