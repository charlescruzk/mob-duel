You are the coding model for **moba-duel**, a browser third-person MOBA. The repo is in
your working directory. You will implement **Phase 2** exactly as specified in
`docs/PHASE2.md`. Work alone, in order, one task at a time, verifying each before the
next. Do not ask questions; where the spec is silent, choose the simplest option that
keeps every existing test passing, and record the choice in `docs/PROGRESS.md`.

## Read first, in this order
1. `CLAUDE.md` — hard rules. They are absolute.
2. `docs/PHASE2.md` — the spec for everything below. Its numbers win over this prompt.
3. `docs/ARCHITECTURE.md` — where code goes and how systems talk (events only).
4. `docs/PROGRESS.md` — what exists and which decisions were already made.
5. `src/hero/heroData.js`, `src/hero/abilities.js`, `src/hero/abilityLib.js`,
   `src/economy/items.js`, `src/economy/shop.js`, `src/ai/botSense.js`,
   `src/ai/botActions.js`, `src/hero/effects.js`, `src/core/engine.js`,
   `scripts/probe.mjs` — the files you will extend. Read each fully before touching it.

## Rules you must not break (from CLAUDE.md, restated)
- No build step, no npm install, no bundler, no TypeScript, no frameworks, no external
  scripts. Three.js and its addons come only from the importmap in `index.html`
  (`import * as THREE from 'three'`, `import { X } from 'three/addons/...'`).
- No asset files. Primitive geometry and canvas-generated textures only.
- Every file under ~300 lines. When a file would pass 300, split it by concern into a
  new file in the same folder and update the file map in `docs/ARCHITECTURE.md`.
- **No per-frame allocation**: nothing on a path that runs every frame may use object or
  array literals, `new`, `.clone()`, `.map()`, `.filter()`, `.slice()`, spread, or
  template strings. Allocate in constructors and one-time build functions; mutate
  module-level scratch objects in place.
- **No DOM churn**: `document.createElement` only in constructors or one-time builds;
  update elements in place. Guard every `getElementById` result against null.
- Cross-system communication goes through `src/core/events.js`. Systems do not import
  each other's classes to call methods.
- `dt` in seconds, passed in. Never read the clock inside a system.
- Anything you add is cleared on hero death, respawn and `match.reset()`.
- No real game's hero, ability or item names. Use only the names in `docs/PHASE2.md`.
- Do not create files outside `src/`, `docs/`, `index.html`, `scripts/`.
- Do not rewrite existing files wholesale. Extend them. Existing behaviour and all 63
  existing probe assertions must keep passing.

## The loop for every task
1. Implement the task.
2. `npm run check` — must print no errors.
3. `npm run probe` — must exit 0, print `(no code errors)`, and every assertion,
   old and new, must be true. Read the probe output; do not assume.
4. If an assertion fails, fix the game, not the assertion. If after **three** honest
   attempts it still fails, leave the assertion in, add a `## Blocked` entry in
   `docs/PROGRESS.md` explaining exactly what fails and why, and move on.
5. Add a short section for the task to `docs/PROGRESS.md`: what was built, every
   assumption you made, and what you could not verify.
6. `git add -A && git commit -m "Phase 2 task N: <name>"`.
Never start task N+1 before task N is committed.

## How probe assertions work
`scripts/probe.mjs` drives headless Chrome. Each feature is a `block(title, expression)`
that runs in the page, pauses the render loop (`g.paused = true`), detaches the
controller and bot, resets the match, and steps the simulation by hand with
`g.step(dt)`. It returns an object of booleans; every key is one assertion. Copy the
`SETUP` pattern used by the existing blocks. Reach objects through `window.__game`
(`g.hero`, `g.enemy`, `g.world`, `g.match`, `g.effects`, and whatever you expose — expose
new systems on `window.__game` in `main.js`). To test a hero other than the default,
the probe can open the page with `?hero=<key>&enemy=<key>&lowfx=1`; add a helper that
opens a second page URL if the harness has only one, following how it opens the first.
Prove **no per-frame allocation** in at least one block by stepping 200 frames and
checking that a pool's array length and a buffer's byte length did not change.

## Tasks, in order

### Task 0 — Orientation and docs
- Run `npm run check` and `npm run probe` once to see the baseline (63/63).
- Add the planned files to the file map in `docs/ARCHITECTURE.md`:
  `src/hero/abilityLibExt.js`, `src/hero/statusExt.js` (only if abilities.js needs the
  room), `src/economy/consumables.js`, `src/economy/passives.js`,
  `src/hud/heroSelect.js`, `src/hud/damageNumbers.js`, `src/fx/particles.js`,
  `src/fx/abilityFx.js`, `src/fx/look.js`, `src/fx/rig.js`, `src/fx/rigAnimator.js`.
  Add the `fx/` folder to the import rule: `fx/` imports `core/`, `map/` and reads unit
  state; sim code never imports `fx/`.
- Add a `## Phase 2` heading to `docs/PROGRESS.md`. Commit.

### Task 1 — Status system: minion CC and new status kinds
- Give `Minion` an `applyStatus(kind, seconds, magnitude)` for `stun` (no move, no
  attack), `slow` (move speed × (1 − magnitude)), `root` (no move, still attacks). Timers
  count down in `Minion.update`; reset on death and pool reuse.
- Extend the hero status machine (`abilities.js`) with `root`, `stealth`,
  `attackSpeed` (magnitude = fraction added), `armorBuff`, `reflect`, `bonusNextAuto`.
  A rooted hero cannot move or dash but can attack and cast. All timers reset on death
  and `resetAll()`.
- Probe: `minionSlowed`, `minionRooted`, `minionStunned`, `heroRootedStillAttacks`,
  `statusClearsOnDeath`.

### Task 2 — Attributes, 25 items, consumables, shop panel
- `items.js`: replace the four-item table with the 25 items from PHASE2.md §4, every
  item carrying the full stat set. Keep `resolveItem`, `countItem`, `ensureInventory`,
  `applyItems` exports working. `applyItems` converts `str/agi/int` with the §2 table,
  adds attack damage only for `hero.primary`, sums `attackSpeedPct`, `lifesteal`,
  `armor`, and fills `hero.passives` (an array sized 6, filled in place).
  Split into `items.js` (data) and `itemStats.js` (aggregation) if over 300 lines.
- `heroData.js`: add `primary` to Brakk (`'str'`) and Ilyra (`'int'`).
- `hero.js`: attack interval ÷ (1 + attackSpeedPct) capped at 2.5×; lifesteal heals on
  auto hit; item armor adds to level armor, total capped 0.75.
- `consumables.js`: stacking to 5 per slot (a parallel `hero.itemCounts` array), use via
  a rising edge on `intent.useItem` (add the field to `intent.js`, default −1), heal or
  mana over time tracked on the hero, usable anywhere, cleared on death.
- `passives.js`: implement Burn, Cleave, Rend, Second Wind, Tempo, Spell Shield, Flow,
  Execute, Undertow as functions called from the existing auto-hit and ability-hit
  paths. Bind once; no closures per hit.
- `input.js` / `heroController.js`: Digit1–6 write `intent.useItem`; they no longer buy.
- `shopPanel.js`: four tabs, six inventory slots with stack counts, click to buy, click an
  owned slot to sell. Build once; update in place. Split into `shopPanel.js` +
  `shopPanelTabs.js` if needed.
- Probe: `strItemGivesHpToAll`, `strItemGivesAdOnlyToStr`, `attackSpeedShortensInterval`,
  `lifestealHeals`, `potionStacksToFive`, `potionHealsOverTime`, `potionUsableInLane`,
  `spellShieldBlocksOneHit`, `burnTicks`, `inventoryClearsOnReset`.

### Task 3 — Vaskra the Longshot (AGI marksman)
- Add the hero to `heroData.js` per §3.1 and to `HERO_KEYS`; make `otherHero` return a
  sensible default (Brakk ↔ Ilyra, everyone else → Brakk) — hero select fixes it later.
- New shapes in `src/hero/abilityLibExt.js`: `buff` (applies a status), `dash` option
  `noDamage`, `skillshot` option `execScale` (damage × (1 + missing HP fraction), cap ×2),
  and the `bonusNextAuto` consumption in `heroAttack.js`. Headhunter passive: counter on
  the hero, reset on target change, true damage on the third hit.
- Dispatch the new shapes from `abilities.js` (extend the `switch`, or move the switch
  into `abilityLibExt.js` if `abilities.js` would pass 300).
- Mesh: a distinct head accessory and a bow (torus segment) in `heroMesh.js`
  (split per-hero pieces into `heroMeshParts.js` when the file grows).
- Probe (page opened with `?hero=vaskra&enemy=brakk&lowfx=1`): `vaskraQPierces`
  (hits two minions in a line), `vaskraWRaisesAttackSpeed`, `vaskraEHopsNoDamage`,
  `vaskraEBonusAuto`, `vaskraHeadhunterThirdHit`, `vaskraRExecScales` (a 50 % HP target
  takes 1.5×), `vaskraRInterruptedByStun`.

### Task 4 — Kesh the Hollow (AGI assassin)
- Hero per §3.2. New shapes: `targetedBlink` (nearest enemy unit within 7 m of the
  reticle point; appear 1.2 m behind it along its facing, face it), `cone` (60°, 4.5 m;
  hit test by angle and distance, no allocation), `stealth` (status; mesh opacity 0.35
  for the player, `botSense` and tower/minion acquisition skip stealthed heroes; ends on
  attack/cast), `targeted` (nearest enemy within range of the reticle), Verdict's
  below-30 % doubling and cooldown refund on a hero kill via `unitDied`. Opportunist in
  the damage path.
- Probe (`?hero=kesh&enemy=ilyra&lowfx=1`): `keshQBlinksBehind`, `keshWStealthHidesFromBot`
  (bot snapshot has no player position while stealthed), `keshWEndsOnAttack`,
  `keshEConeHitsFrontOnly`, `keshRDoublesBelow30`, `keshRRefundsOnKill`,
  `keshOpportunistBonus`.

### Task 5 — Halvard the Wall (STR tank)
- Hero per §3.3. Shapes: `targeted` reuse for Q with stun; `buff` with `armorBuff` and
  `reflect` (reflect resolves in `takeDamage` before mitigation, as magic, source =
  the reflecting hero, never reflecting reflected damage); `dash.knockback` (first
  enemy hero hit is displaced 2.5 m along the dash over 0.2 s, clamped to bounds and
  boxes, stunned 0.4 s); `zone` (a pooled ground disc mesh with a tick timer; here a
  slow field) chained after R's `aoeStun`. Unyielding in the armor getter.
- Probe (`?hero=halvard&enemy=ilyra&lowfx=1`): `halvardQStuns`, `halvardWReflects`,
  `halvardWArmorBuff`, `halvardEKnocksBack`, `halvardRStunsThenSlows`,
  `halvardUnyieldingBelow30`.

### Task 6 — Lumen the Tidecaller (INT controller)
- Hero per §3.4. Shapes: `skillshot` with `root`; `heal` (instant + over-time, on the
  hero's own regen path); `groundAoe.pull` (move each enemy inside 2 m toward the centre,
  clamped); `zone` reuse for Deluge with self-heal for the caster inside and tick damage
  plus slow for enemies. Riptide haste on any ability hit (needs the `abilityHit` event —
  emit it from `abilityLib.abilityHit`, payload object reused).
- Probe (`?hero=lumen&enemy=brakk&lowfx=1`): `lumenQRoots`, `lumenWHealsInstantAndOverTime`,
  `lumenEPullsToward`, `lumenRTicksAndSlows`, `lumenRHealsCasterInside`,
  `lumenRiptideHaste`, `abilityHitEventFires`.

### Task 7 — Hero select overlay, `?enemy=`, bot for all six
- `src/hud/heroSelect.js`: `#hero-select` overlay in `index.html` with six cards built
  once (canvas portrait: a coloured silhouette per class, name, title, attribute badge,
  role, four ability names + descriptions from `heroData`). Click picks the player hero
  and reveals the existing start overlay. `?hero=` pre-selects and skips the overlay.
  `?enemy=` picks the bot; default is a seeded random choice among the other five.
  Hero construction moves to a function `main.js` calls after selection; nothing else in
  the per-frame order changes.
- `botSense.BOT_KIT` for all six heroes with the generic per-slot schema from §6 and
  `kind`; `botActions` rules per §6; item priority lists per hero; the bot buys two
  health potions at start and uses one when below 60 % HP and not in combat.
- Probe: `heroSelectHasSixCards`, `enemyParamPicksHero`, `defaultEnemyDiffersFromPlayer`,
  `botVaskraFarms` (page `?hero=brakk&enemy=vaskra&lowfx=1`: bot last-hits within 90 s),
  `botKeshTrades`, `botHalvardCcsWhenClose`, `botLumenHealsBelowHalf`, `botUsesPotion`.

### Task 8 — Particles, ability FX, damage numbers, hit feedback
- `src/fx/particles.js`: `ParticleSystem(scene, max = 3000)` per §5 — one `THREE.Points`,
  pre-allocated `BufferAttribute`s (position, colour, size, alpha), `Float32Array`
  velocity/life/gravity/drag, round-robin allocation, `ShaderMaterial` (additive, soft
  circle, size attenuation, alpha from life). Emitters `burst`, `ring`, `trail`, `column`.
  `update(dt)` sets `needsUpdate` once per attribute per frame. `reset()` kills all.
- `src/fx/abilityFx.js`: a table `(heroKey, slot) → { color, emitter, count, ... }` for
  all 24 abilities and the autos; listens to `abilityCast`, `abilityHit`, `unitDamaged`
  (or the existing damage event — check `unit.js` for its name), `unitDied`,
  `heroLevelUp`, `recallStarted`, `heroRespawned`. Projectile trails: iterate the
  projectile pool from `effects` each frame without allocating.
- `src/hud/damageNumbers.js`: 32 pooled divs, world → screen projection with a shared
  scratch `Vector3`, rise and fade over 0.8 s, colour by damage type, larger for hero
  hits. `src/fx/look.js` (or the unit mesh): 0.1 s hit flash. Camera kick in
  `thirdPerson.js` (`shake(amplitude, seconds)`) fired on R impacts and own death.
- Expose `g.fx` on `window.__game`.
- Probe: `particlesEmitOnCast`, `particlesEmitOnHit`, `particlesDieOut`,
  `particleBuffersConstant` (200 frames, no length change), `damageNumberShows`,
  `damageNumbersPoolConstant`, `fxResetsOnMatchReset`.

### Task 9 — Lighting, cel shading, outlines, bloom, sky
- `src/fx/look.js` applied from `engine.js`: shadows (PCF soft, 2048², sun frustum
  ±40 m following the player each frame by mutating the light position and target),
  ACES filmic tone mapping (exposure 1.05), sky-gradient background from `textures.js`,
  ground `MeshStandardMaterial` roughness 0.9, cool fill light opposite the sun, fog
  colour = sky horizon colour.
- Cel shading: a 4-step gradient `DataTexture` (NearestFilter) and `MeshToonMaterial` on
  heroes, minions, towers and nexuses; inverted-hull outlines (a `BackSide` black mesh
  at scale 1.04 added once in each mesh builder). Keep team colours readable.
- Bloom: `EffectComposer`, `RenderPass`, `UnrealBloomPass` (threshold 0.9, strength 0.6,
  radius 0.4), `OutputPass` from `three/addons/postprocessing/`. Resize updates the
  composer. `?lowfx=1` disables shadows and the composer; the probe passes it.
- Probe: `shadowsEnabledByDefault` (page without `lowfx`), `lowfxDisablesComposer`,
  `heroUsesToonMaterial`, `outlineMeshPresent`, `renderStillRuns` (a frame renders
  without a console error).

### Task 10 — Procedural rig animation
- `src/fx/rig.js`: `buildHeroRig(heroKey, team)` returns the group plus a fixed joint
  table (pelvis, torso, head, armL, armR, legL, legR, weapon) built from primitives with
  the class weapon and existing head accessories; `buildMinionRig(ranged, team)` is a
  three-part rig. Replace the bodies in `heroMesh.js` / `unitMeshes.js` with these,
  keeping the `{ group, shield }` contract and the outline from Task 9.
- `src/fx/rigAnimator.js`: `RigAnimator` with `update(unit, dt)` per §5: state from
  velocity, attack wind-up, casting, stunned, dead; target poses as flat number arrays;
  blend at 12 rad/s; distance-driven walk cycle; attack swing over the wind-up; cast
  pose; hit recoil for 0.15 s after damage; death fall then sink; squash-stretch on dash
  landing. All state lives on the rig object. Called from the place that syncs meshes
  (`Unit.syncMesh` or the render step) — never from the sim.
- Probe: `walkCycleAdvancesWithDistance`, `idleDoesNotAdvanceWalk`, `attackSwingsArm`,
  `deathPoseFalls`, `respawnRestoresPose`, `rigNoAllocation` (joint table length and a
  pose array length constant over 200 frames).

### Task 11 — Balance pass and write-up
- Play each matchup through the probe's helpers where possible: at L1 and L6, full combo
  plus autos, record time-to-kill for all six heroes against Brakk and Ilyra in a table
  in `docs/PROGRESS.md`. Adjust `{ base, step }` numbers only if a hero kills a full-HP
  L1 hero without minion or tower help (the design forbids it) or cannot kill from
  50 % HP at L6 with a full combo.
- Finish `docs/PROGRESS.md`: the full probe assertion list with the new count, every
  assumption, a `## Needs a human` list (feel, frame rate with particles and shadows,
  whether the cel look reads well, bot personality for the four new heroes).
- Final `npm run check` + `npm run probe`, then commit `Phase 2 complete`.

## Output at the end
Print: the final probe count (old + new), the list of any `## Blocked` entries, and the
five things the human playtest most needs to check.
