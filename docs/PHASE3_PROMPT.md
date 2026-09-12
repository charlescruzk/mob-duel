You are the coding model for **moba-duel** (repo: https://github.com/charlescruzk/mob-duel,
deployed at https://charlescruzk.github.io/mob-duel/). You will implement **Phase 3**
exactly as specified in `docs/PHASE3.md`. Work alone, in order, one task at a time,
verifying each before the next. Do not ask questions; where the spec is silent, choose
the simplest option that keeps every existing test passing and record the choice in
`docs/PROGRESS.md`.

## Read first, in this order
1. `CLAUDE.md` — hard rules, including the new `src/sim/` / `src/view/` split, the
   mobile rule, and the deployment rule. They are absolute.
2. `docs/PHASE3.md` — the spec. Its numbers and names win over this prompt.
3. `docs/ARCHITECTURE.md`, `docs/PROGRESS.md` — what exists and why.
4. `src/main.js`, `src/core/unit.js`, `src/hero/effects.js`, `src/fx/rig.js`,
   `src/fx/rigAnimator.js`, `src/fx/particles.js`, `src/fx/abilityFx.js`,
   `src/map/laneBuilder.js`, `src/core/input.js`, `src/hud/heroSelect.js`,
   `scripts/probe.mjs`. Read each fully before touching it.

## Rules you must not break
- No build step, no npm install, no bundler, no TypeScript, no frameworks, no external
  scripts beyond the Three.js importmap. No asset files: every mesh, texture, sound and
  animation is generated in code.
- Every file under ~300 lines; split by concern and update `docs/ARCHITECTURE.md`.
- **No per-frame allocation** (no literals, `new`, `.clone()`, `.map()`, `.filter()`,
  spread, template strings on any per-frame path). Pre-allocate; mutate in place.
- **No DOM churn**; create elements once; guard every `getElementById`.
- Systems talk only through `src/core/events.js`. `src/sim/` never imports `three` or
  touches the DOM. `src/view/` and `src/fx/` never mutate sim state.
- Everything you add resets on hero death, respawn and `match.reset()`.
- No real game's names. Use exactly the names in `docs/PHASE3.md` §2.
- Files only under `src/`, `docs/`, `index.html`, `scripts/`, `server/`.
- All paths relative (the site is served from a sub-path on GitHub Pages).
- Do not rewrite files wholesale; extend. The 181 existing probe assertions keep
  passing (rename keys inside them when §2 renames a hero).

## The loop for every task
1. Implement. 2. `npm run check` — clean. 3. `npm run probe` — exit 0, `(no code
errors)`, every assertion true; read the output. 4. A failing assertion means fix the
game, not the test; after three honest attempts leave it in, add a `## Blocked` entry to
`docs/PROGRESS.md`, and move on. 5. Add a section for the task to `docs/PROGRESS.md`:
built, assumptions, unverified. 6. `git add -A && git commit -m "Phase 3 task N: <name>"`
then `git push origin main` (this deploys the site). Never start N+1 before N is pushed.

## How probe assertions work
`scripts/probe.mjs` drives headless Chrome over CDP. Each feature is a
`block(title, expression)` evaluated in the page; it returns an object of booleans and
every key is an assertion. Copy the `SETUP` pattern. Reach state through
`window.__game` and expose anything new there. Pages can be opened with query
parameters (`?hero=…&enemy=…&lowfx=1`). One block per task proves **no per-frame
allocation** by stepping 200 frames and checking a pool or buffer length is constant.
Viewport-dependent blocks use `Emulation.setDeviceMetricsOverride` and
`Input.dispatchTouchEvent` through the same CDP socket.

## Tasks, in order

### Task 0 — Orientation
Baseline `npm run check` and `npm run probe` (181). Add `## Phase 3` to
`docs/PROGRESS.md`. Commit and push.

### Task 1 — Sim/view split (PHASE3.md §8)
- Move folders: `src/sim/{core,hero,units,economy,ai,game}` and
  `src/view/{camera,map,hud,fx,main.js}`; `index.html` points at `./src/view/main.js`.
  Use `git mv` so history survives. Fix every import path.
- `src/sim/core/unit.js`: `pos` becomes plain `{x,y,z}` via `src/sim/core/vec.js`;
  no `three`, no mesh. Emit `unitAdded` / `unitRemoved` from `World`.
  `src/view/unitViews.js` builds and syncs meshes for units it learns about from those
  events, keeping the existing mesh builders. `effects.js` splits into
  `src/sim/hero/projectiles.js` and `src/view/fx/projectileViews.js`.
- `scripts/simNode.mjs`: runs 20 s of a bot-vs-bot match in Node with no DOM, prints
  the final state, exits 0. Add it to `npm run check`'s script list, or a new
  `npm run sim` script that `probe` calls first.
- Rewrite the file map in `docs/ARCHITECTURE.md`.
- Probe: `simRunsInNode` (probe spawns `node scripts/simNode.mjs` and asserts exit 0),
  `unitViewsTrackWorld` (adding and removing a minion adds and removes one mesh),
  `noThreeInSim` (probe greps `src/sim` for `from 'three'` and asserts zero hits).

### Task 2 — Folklore roster rename (PHASE3.md §2)
- Rename hero keys repo-wide (`git grep -l` then replace): brakk→bayani, halvard→oroku,
  vaskra→kazane, kesh→lilit, ilyra→ren, lumen→amihan. Names, titles, roles, origin
  (`origin: 'ph' | 'jp'`), ability names and descriptions from §2.1. Probe URLs and
  `BOT_KIT` keys follow.
- Hero select: portraits redrawn per §7 (silhouette, mask, colour band, origin glyph);
  card shows origin.
- Probe: `rosterKeysRenamed` (HERO_KEYS equals the six new keys), `abilityNamesMatchSpec`
  (spot-check four names), `originOnEveryHero`. All 181 renamed assertions still true.

### Task 3 — Rig v2 and clip system (PHASE3.md §3)
- `src/view/fx/rig.js` → 14-joint rig with per-hero parts attached to named joints;
  `src/view/fx/rigParts.js` for the parts (horns, wings, tails, headdress, shield,
  weapons). Minion rig at 0.7 scale.
- `src/view/fx/clips/base.js` and one file per hero; clip format from §3; sampling with
  ease-in-out; `events`.
- `src/view/fx/rigAnimator.js` → blend tree: locomotion lower body, overlay upper body,
  full-body overrides; melee attack chain cycling; 0.15 s cross-fades; root offset bob.
- Probe: `clipSamplesBetweenKeys`, `walkRunBlendBySpeed`, `attackOverlaysWalk` (legs
  keep cycling during a swing), `attackChainCycles` (three autos use three clips),
  `deathOverridesAll`, `clipEventFires`, `rigV2NoAllocation`.

### Task 4 — Weapon trails, hit stop, pose tool (PHASE3.md §3)
- Ribbon trail per melee weapon between `swingStart` and `impact`; view-only hit stop
  (0.25× for 80 ms on ultimate hits; sim dt untouched); `?poseTool=1` panel.
- Probe: `trailActiveDuringSwing`, `hitStopDoesNotTouchSim` (sim time advances at full
  rate while the view clock is slowed), `poseToolOnlyWithParam` (no panel element
  without the parameter).

### Task 5 — Particles v2 (PHASE3.md §5)
- `src/view/fx/particles.js` → instanced-quad system (6000), stretched sparks, two
  materials, procedural sprite sheet; `src/view/fx/decals.js` pooled ground decals;
  recipes in `src/view/fx/recipes/<heroKey>.js` with anticipation / release / impact
  layers; vignette flash and camera shake on ultimates; bloom 0.7 / 1.0.
- Probe: `particlesInstanced` (instance count constant, active count rises on cast),
  `sparksStretch` (a spark instance's scale differs along velocity), `decalSpawnsOnImpact`,
  `decalFades`, `particleV2NoAllocation`.

### Task 6 — Map v2 (PHASE3.md §4)
- `src/view/map/`: `sky.js`, `terrain.js`, `foliage.js` (InstancedMesh, wind hook),
  `river.js` (shader), `bases.js` (Philippine and Japanese dressings), `ambient.js`
  (fireflies, pollen, mist), `stats.js` (`?stats=1` overlay). Collision boxes and the
  walkable strip unchanged. `lowfx` halves instance counts.
- Probe: `collisionUnchanged` (box count and lane bounds identical), `foliageInstanced`
  (instance counts match the spec), `riverShaderCompiles` (no program errors in console),
  `lowfxHalvesInstances`, `drawCallBudget` (renderer.info.render.calls < 250 on desktop).

### Task 7 — Mobile (PHASE3.md §6)
- `src/view/touch.js` joystick, look-drag, radial buttons, assisted aim, manual aim
  drag; `Input` gains a `touch` source; no pointer lock on touch; viewport, safe areas,
  `touch-action`, `100dvh`, landscape prompt; performance tier and quality toggle.
- Probe (viewport 844×390 via CDP emulation with touch enabled): `touchJoystickMoves`
  (synthesised touch drag sets `intent.moveX/Z`), `touchAbilityCasts`, `assistedAimFacesEnemy`,
  `noPointerLockOnTouch`, `hudFitsPhone` (no horizontal overflow, buttons inside the
  viewport), `phoneDefaultsLowfx`.

### Task 8 — Sound (PHASE3.md §7)
- `src/view/audio/{engine,sfx,ambience,music}.js`, WebAudio only, unlocked on first
  gesture, every ability and event mapped, mute and volume persisted in `localStorage`
  (guarded). No per-frame allocation: nodes pooled.
- Probe: `audioContextCreatedAfterGesture`, `castTriggersSfx` (a counter on the sfx
  layer), `muteSilencesGain`, `audioNoAllocation`.

### Task 9 — Menus, HUD, result screen, game feel (PHASE3.md §7)
- Title screen, hero select polish, pause menu, result screen with stats, enemy HP
  bars, minimap strip, kill feed, tooltips, cooldown sweeps, low-HP vignette, hit
  flash, auto knockback, tower bolt telegraph, recall spiral, level-up pillar.
- Probe: `resultScreenShowsStats`, `pauseMenuToggles`, `enemyHpBarTracks`,
  `minimapShowsBothHeroes`, `killFeedEntryOnKill`, `hudPoolsConstant`.

### Task 10 — Deployment check and write-up
- Confirm the pushed site loads with no console errors (probe opens the Pages URL when
  `PROBE_REMOTE=1`), hero select works, a match starts.
- `docs/PROGRESS.md`: final assertion count, every assumption, `## Blocked`, and a
  `## Needs a human` list (animation quality per hero, map beauty, phone frame rate on a
  real device, sound taste). Commit `Phase 3 complete`, push.

## Output at the end
Print the final probe count, any `## Blocked` entries, and the five things the human
playtest most needs to check on a phone and on desktop.
