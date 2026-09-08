# PROGRESS.md — moba-duel

**Status: Phase 2 in progress — see `## Phase 2` below.**
The 1v1 duel-lane vertical slice is built and verified.
`npm run check` 38/38 · `npm run probe` exit 0, `(no code errors)`, **63/63 assertions true**.

Play it: `npm run serve` → http://127.0.0.1:8090/index.html (`?hero=ilyra` to take the mage).

The slice proves this loop: last-hit under pressure → trade damage → get zoned by the
tower → land a combo → recall, buy, come back stronger. You (blue, Brakk the melee
bruiser) vs a bot (red, Ilyra the ranged mage) on one ~90 m lane; minion waves from 15 s
then every 30 s; a tower and a nexus per side; gold from last-hits; four items bought in
the fountain; levels 1–6 with R at 4; recall; death and respawn; destroy their tower,
then their nexus. Click or Enter after a result for a rematch.

Built by six agents in one workflow — design → scaffold → (hero | units | economy+bot in
parallel, disjoint files) → integrate. The integrator hit a session limit after writing
`match.js`; the integration below was finished by hand. `(assumed)` marks a DESIGN.md
gap a builder had to decide.

## Scaffold (architect)

- [x] Engine, EventBus, Input, physics, Unit, World, HeroIntent, HeroController,
      ThirdPersonCamera, laneData/laneBuilder/textures, HUD shell. 20 probe assertions.
- Contract deviations from DESIGN.md: radii hero 0.5 / nexus 2.0 (design says 0.4 /
  2.5) — the contract wins (assumed). W ability on **KeyF** because KeyW is move-forward
  (assumed). Camera pitch is mouse-adjustable (−25° default, [−60°, −8°]).

## HERO builder — `src/hero/*`, `src/hud/abilityBar.js`

- [x] Both kits playable per DESIGN.md §3; verified 77/77 in a scratch harness before
      integration. Extra files `heroAttack.js` and `heroMesh.js` keep `hero.js` at 300.
- `Hero.xpFromEvents` defaults **false**: `economy/gold.js` awards XP on `unitDied`, so
  a true default would double it (assumed). The hero listener stays for kill counting.
- Dash/wind-up casts on frame N start on frame N+1 (edge-detected after the ability
  tick) — one frame of latency, accounted for in the probe.
- **Minions have no `applyStatus`**, so Q/W/E slows and the R stun affect only heroes
  (assumed; add it to `Minion` if minion CC is wanted).
- Fountain laser (§7) lives in `Hero.update` with source `null`.
- Cinder Mark bonus and Ironhide heal are not multiplied by `abilityAmp`; abilities are
  `'magic'`, autos `'physical'` (design is silent; armor applies to both).
- Recall is cancelled by move input, `intent.attack`, a successful cast, stun, or death.
- Ilyra's auto is a homing projectile (cannot miss; vanishes if the target dies).
  Skillshots ignore towers/nexuses entirely. Abilities never damage statics.
- Countdowns snap to 0 at ≤1e-6 to defeat float drift.

## UNITS builder — `src/units/*`

- [x] Minion, WaveSpawner, Tower, Nexus, shared meshes, plus `shotPool.js` (pooled
      visual tracers; **all tower and minion damage is hitscan at fire time** so the
      cadence is exact and probe-testable). Verified 44/44 in a scratch harness.
- Spawn stagger 0.6 s per minion, melee first (design says same tick) — `SPAWN_STAGGER`
  in `waveSpawner.js`; a wave is spread ~7.7 m along z (assumed).
- Minions walk toward an acquired target until in range (melee range 1.5 < acquire 7);
  structures are acquired at 7 m + radius so melee steer into the tower (assumed).
  Retarget stickiness: a better priority class replaces the target every 0.5 s.
- Tower: any target change sets the 0.6 s first-shot delay; hero locks are sticky until
  death / out of range / tower death; ramp resets on target change or >2.5 s idle.
  Tower damage is `'physical'`. Dead tower/nexus are hidden (no rubble mesh).
- `WaveSpawner.update` allocates only when the pool is empty (first ~2 waves).

## ECONOMY + BOT builder — `src/economy/*`, `src/hud/shopPanel.js`, `src/ai/*`

- [x] Economy (trickle 1.5 g/s, last-hit / kill / tower bounties, XP rules), Shop,
      ShopPanel, HeroBot (+ `botSense.js`, `botActions.js`). Verified headless with stubs.
- **Selling exists** at 60% (design §8 says no selling) — click an owned slot (assumed).
- RETREAT/RECALL ordering: §9 as written traps a <35% bot in RETREAT forever; RECALL wins
  when safe (no enemy hero in 20 m, no minion in 12 m, not under a live tower). Inside
  the fountain the SHOP/heal branch is evaluated before RETREAT (assumed).
- Aim error: 7° × `coneScale`, 1.6 on entering TRADE easing to 0.6 after 3 s (design: a
  fixed ±7°). Reaction: 0.3 s stale player snapshot AND casts blocked until 0.3 s after a
  state change; with the 0.2 s tick the first cast lands 0.4 s in.
- Bot casts pulse one tick then drop, so the Hero always sees a rising edge; bot buys are
  one per 0.4 s. Ranged last-hit flight compensation estimates HP-loss rate instead of
  keeping per-minion history (no allocation).
- Tower-bounty XP goes to the killing team's hero regardless of who killed it.

## Integrator — `src/game/match.js`, `src/main.js`, `scripts/probe.mjs`

- [x] `Match`: countdown → live → over, the exact per-frame order every builder asked
      for, `matchOver` freeze, click/Enter rematch with a 1.5 s grace.
- [x] `main.js` wires everything; `window.__game.step(dt)` runs one frame; `paused`
      stops the render loop from simulating so the probe owns the clock; `forceRun`
      simulates without pointer lock; `?hero=` picks the kit.
- **Fixes made in builders' files, root cause each:**
  - `Tower.reset()` / `Nexus.reset()` did not exist (`match.reset()` calls both). Added.
    `Tower.reset()` **re-arms the aggro listener**: `World._flushRemovals()` nulls
    `unit.world`, and `_handleDamaged` then calls `dispose()` on the next hit — after any
    rematch, towers would silently have stopped punishing hero-on-hero aggression.
    Asserted by `towerAggroSurvivesReset`.
  - `match.reset()` reset units *before* re-adding them, so `hero.reset()` ran with
    `hero.world === null`. Reordered: re-add, then reset.
  - `#match-banner` was referenced by `match.js` but missing from `index.html` — the
    countdown, FIGHT and winner text never showed. Added with CSS.
  - The shop panel releases pointer lock on open; `main.js`'s lock handler now skips
    re-raising the start overlay while `shopPanel.open` (economy builder's note #10).
- **Test-side fixes (the game was right, the test was wrong):** Brakk's Q is a self
  circle r3 and the test had parked the mage 4 m away; the scaffold's `nearestEnemyNull`
  asserted an empty world at 100 m — kept its real meaning (a hero is never its own
  enemy) at radius 1.

### Probe assertions (63)

- scaffold (20): walkedForward velTracked meshSynced facingMove laneClamped timeAdvanced
  cameraDistance cameraBehind reticleHitsGround armorApplied trueIgnoresArmor
  deathEmitted revived byTeam nearestEnemyNull nearestEnemyFromRed enemiesInRadius
  rngDeterministic intentPlain mapBoxes
- hero (7): heroMoves heroStopsAtWall recallStarts recallChannelsAndTeleports
  movingCancelsRecall heroDies deathRespawnsAtNexus
- abilities (12): abilityCastsAndDamages brakkWShields brakkEDashDamages ultLockedAtLevel1
  manaGates manaGateHolds cooldownGates ilyraQSkillshotDamages ilyraWDamages ilyraEBlinks
  xpLevelsUp ultUnlocksAtLevel4
- minions / tower / nexus / match (16): noMinionsBefore15 minionWaveSpawnsAt15s
  minionsWalk minionsFight lastHitGoldToKiller lastHitGoldOnlyToKiller
  towerTargetsMinionsFirst towerSwitchesToAggressiveHero towerShootsHero towerDamageRamps
  nexusImmuneWhileTowerAlive towerKillPaysBounty nexusExposedAfterTower
  nexusDestroyedEndsMatch matchResetWorks towerAggroSurvivesReset
- economy / shop / bot (8): shopRefusesOutsideFountain shopBuysInFountain itemStatsApply
  buyIntentEdge botReachesFarm botFarmsLastHits botRetreatsLowHp botRetreatMovesHome

## Needs a human (the probe cannot see any of this)

- **The loop itself.** Whether last-hitting is learnable, whether the tower zones fairly,
  whether Brakk's combo and Ilyra's kite both *feel* right — the entire reason the slice
  exists. Time-to-kill at L1 and L6 against DESIGN.md §10's targets.
- Whether the bot is fun to duel or merely correct; whether 0.3–0.4 s reaction reads as
  human; whether its RETREAT threshold makes it cowardly.
- Frame rate with a full wave clash (~12 units + projectiles + rings); mesh and tracer
  look; the camera's smoothing and pitch limits; the shop panel's pointer-lock flow.
- Balance dials, all in `heroData.js` / the unit constants: attack damage, cooldowns,
  tower `HERO_DAMAGE` and ramp, minion HP per wave, item stat lines.

## Phase 2 — roster of six, build diversity, modern look

Spec: `docs/PHASE2.md`. Baseline before any Phase 2 work: `npm run check` 38/38 files,
`npm run probe` exit 0, `(no code errors)`, **63/63 assertions true**.

Planned file map additions (now in `docs/ARCHITECTURE.md`): `hero/abilityLibExt.js`,
`hero/statusExt.js` (only if abilities.js needs the room), `economy/itemStats.js`
(split-out if items.js overflows), `economy/consumables.js`, `economy/passives.js`,
`hud/shopPanelTabs.js` (split-out if needed), `hud/heroSelect.js`, `hud/damageNumbers.js`,
and a new `fx/` folder (`particles.js`, `abilityFx.js`, `look.js`, `rig.js`,
`rigAnimator.js`) whose import rule is: fx imports `core/` and `map/` and reads unit
state; sim code never imports `fx/`.

## Known gaps, deliberately not in the slice

- Multiplayer. `docs/NETCODE.md` is the decision: server-authoritative at 20 Hz, intents
  in, snapshots out. The `HeroIntent` plain-data rule is honoured everywhere so the sim
  moves to a server unchanged — but no server exists.
- Minion CC, a second lane, jungle, more heroes, a build step (see CLAUDE.md).
