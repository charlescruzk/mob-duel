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

### Task 1 — status system: minion CC and new hero status kinds

- [x] Minions gain `applyStatus(kind, seconds, magnitude)` for `stun` / `slow` / `root`
      (PHASE2.md §3.5): stun stops move+attack (timers still tick), slow scales
      `_walkToward`, root stops movement only. Cleared on death and on pool reuse.
- [x] Hero abilities gain `root`, `stealth`, `attackSpeed`, `armorBuff`, `reflect`,
      `bonusNextAuto` with timers in `AbilitySystem.update` and getters
      (`hero.abilities.rooted` etc.). All cleared by `clearStatus()` on death/respawn
      and by `resetAll()`.
- Assumptions (spec silent):
  - Status getters live on `AbilitySystem`, not `Hero` — `hero.js` was at its ~300-line
    cap. Consumers read `hero.abilities.rooted` / `.stealthed` / `.attackSpeedPct` /
    `.armorBuff` / `.reflectPct` / `.bonusAuto`.
  - Root blocks *starting* a dash (checked in `tryCast` before mana is paid) but does not
    interrupt a dash already in progress.
  - `attackSpeed` and `armorBuff` are strongest-wins (re-applying a weaker magnitude
    leaves the stronger one); an equal magnitude refreshes the timer. Slow stays
    strongest-wins per §3.5.
  - `stealth`, `reflect`, `bonusNextAuto` are plain assign (last application wins) —
    each has exactly one source in the planned kits.
- Probe: new block `status: minion CC and hero root/stealth/attackSpeed/armorBuff/
  reflect/bonus` — 6 assertions, **69/69 total** (was 63), exit 0, no code errors.
- Not verifiable by the probe: whether stealth actually reads as invisible on screen
  (rendering-side culling arrives with Phase 2 Task 8/9); how root *feels*.

### Task 2 — attributes, 25 items, consumables, shop panel

- [x] Attributes (PHASE2.md §2): `ATTR` conversion table in `heroData.js` — STR +16
      maxHp/+0.08 hpRegen, AGI +0.004 armor/+0.01 attackSpeed, INT +12 maxMp/
      +0.06 mpRegen/+0.005 amp; primary attribute adds +1 AD per point. Heroes get
      `primary: 'str'` (Brakk) / `'int'` (Ilyra). Caps: item+AGI attack speed 1.5,
      total armor 0.75 (`ARMOR_CAP`, `ATTACK_SPEED_CAP`).
- [x] 25 items in `economy/items.js` (compact `def()` normalizer + shared field lists
      in `economy/itemFields.js`): 3 consumables, tiers 1/2/3, nine passives, CDR cap
      0.30, sell 60 %, stack cap 5. `applyItems` folds all 14 stat fields.
- [x] Item passives in `economy/passives.js`, hooked at the hit paths per the
      ARCHITECTURE file map: burn/cleave/tempo/execute/undertow on autos
      (`heroAttack.land`), rend/flow on ability hits (`abilityLib.abilityHit`),
      spell shield pre-damage in `abilityHit`, second wind + shield recharge + burn
      DoT ticked per frame from `match._live`.
- [x] Consumables: `economy/consumables.js` per-match system — potions tick HoT/mana
      regen, `intent.useItem` (inventory slot index, −1 none) consumed on the rising
      edge for either team; Digit1–6 map to slots 0–5 through the controller. Stacks
      merge to 5 in one slot; cleared on hero death.
- [x] Shop panel: four tabs (Consumables / Tier 1–3), passive text on items, stack
      counts (×N) on inventory slots, sell-one-from-stack.
- Assumptions (spec silent):
  - `hero.js` was at its ~300-line cap, so item folding lives in `hero/heroItems.js`
    (`applyItemTo`, `refreshItemStats`, `refreshPassives`, `dropKey`); `hero.applyItem`
    is a one-line delegate.
  - Consumable inventory entries are clones built by `shop.buy` via
    `consumableEntry(def)` — the shared `ITEMS` defs stay immutable; `countItem`
    matches by key so bot priority lists survive the refactor.
  - The attack-speed cap applies to the item+AGI stat only; ability attack-speed
    buffs stack on top of the capped value.
  - Fleetfoot Greaves silently replaces Swiftsoles (upgrade chain), matching the
    tier-2-over-tier-1 unique rule.
  - A potion refresh-replaces any running potion (one HoT at a time) — no stacking.
  - `intent.useItem` is an inventory slot index (0–5); using a non-consumable slot is
    a no-op, not an error.
- Probe: two new blocks — `items: attribute conversion, caps, fleet replacement,
  consumables` (14 assertions) and `items: passives — burn, cleave, rend, flow, spell
  shield, tempo, execute, undertow, second wind` (16 assertions), **99/99 total**
  (was 69), exit 0, no code errors.
- Not verifiable by the probe: shop tab feel and click targets; whether burn DoT and
  damage numbers (Task 8) read clearly; item power feel (Task 11 balance pass).

### Task 3 — Vaskra the Longshot

- [x] Roster entry in `heroData.js` (`?hero=vaskra`): agi marksman, 480+60 hp,
      260+25 mp, 8 m range, 0.85 s attack, 55+5 AD, projectileSpeed 26.
- [x] Passive **Headhunter** (`heroAttack.land`): every third consecutive basic attack
      on the same target deals 15 + 5/level true damage; switching targets resets the
      count; count/target cleared on death, respawn, and `reset()`.
- [x] Q **Piercing Shot**: skillshot 14 m, pierces every enemy, *physical* dtype —
      `dtype` threads through `castSkillshot` → projectile → `abilityHit` (default magic).
- [x] W **Quickdraw**: `buff` shape (`abilityLibExt.castBuff`) — attackSpeed status
      +60 % for 4 s, plus autos slow 15 % for 1 s while it runs (`autoSlow*` fields
      applied from `heroAttack.land`, cleared in `clearStatus`).
- [x] E **Tumble**: dash with `noDamage: true` in `stepDash` — arms `bonusNextAuto`
      (30 + 8/level, 3 s), no damage, no slow.
- [x] R **Deadeye**: 1.0 s wind-up (`windup` shape, resolve `skillshot`) interrupted by
      stun with no resolve and no cooldown (generic in `abilities.update` — Brakk R
      behaves the same); projectile `heroesOnly` (skips minions in `effects._sweep`)
      with `execScale` — damage recomputed at impact from target missing-HP fraction
      ×(1 + missing), capped ×2 (`abilityLibExt.projectileHit`).
- [x] Mesh trim (`heroMesh.js`): scout cap + torus-segment bow, trim 0x9fd6ff.
- Assumptions (spec silent):
  - `castBuff` arms the auto-slow on the caster with the buff's own duration — a
    single status covers both halves of the ability.
  - Exec-scale reads the target's HP at *impact*, so heals during the 1 s aim reduce
    the bonus; cap ×2 matches the desc.
  - Stun interrupts *any* wind-up cast (not just Deadeye) — cheapest consistent rule;
    the cast is fully cancelled (no damage, no cooldown).
  - `HERO_KEYS` gains vaskra; `otherHero` still pairs Brakk↔Ilyra for bots until
    Task 7 wires `?enemy=`.
  - Scaling convention: "15 + 5/level" and "30 + 8/level" resolve to the *base* at
    level 1 (same as every other `{base, step}` stat) — probe asserts confirm.
- Probe: new block `vaskra: pierce, quickdraw, tumble, headhunter, deadeye` via the
  new `restart('hero=vaskra&lowfx=1')` helper (hero-specific pages mid-probe) —
  7 assertions, **106/106 total** (was 99), exit 0, no code errors.
- Not verifiable by the probe: bow/cap readability on screen; whether the 1 s Deadeye
  aim telegraph reads; marksman kiting feel.

### Task 4 — Kesh the Hollow

- [x] Roster entry in `heroData.js` (`?hero=kesh`): agi melee assassin, 540+70 hp,
      240+22 mp, 1.8 m range, 0.9 s attack, 60+6 AD, windup 0.2, armor 0.10+0.01.
- [x] Passive **Opportunist** (`economy/passives.js opportunistMult`): autos and
      abilities deal +20 % to slowed/rooted/stunned targets. Called from both damage
      paths (`abilityHit` and `heroAttack.land`) — one helper, no cycle between
      abilityLib and abilityLibExt.
- [x] Q **Shadow Step** (`targetedBlink`, `abilityLibExt.castTargetedBlink`): nearest
      enemy within 7 m *of the reticle point*; appear 1.2 m behind along its facing
      (clamped to bounds/boxes/statics), face it, instant strike. Fizzles before mana
      when nothing is in reach.
- [x] W **Veil** (`stealth` shape): stealth status 3 s, +25 % move speed rides the
      stealth timer via `stealthHaste` in `speedMult`. Ends on any other cast
      (`tryCast`), on attack start (`heroAttack.update`), or expiry — all paths go
      through `endStealth`, which arms the first-attack bonus (40 + 10/level, 3 s
      window) through the existing `bonusNextAuto` path. Mesh fades to 0.35 opacity
      (`heroMesh.applyStealthFade`, change-detected in `hero.update`).
- [x] Stealth vs AI: `botSense.DelayedView.sample` marks `visible = hero.stealthed !==
      true`; `heroBot._sense` reads `playerDist = Infinity` for an invisible player;
      `world.nearestEnemy` skips stealthed heroes — so towers/minions keep a current
      target via their sticky lock but can acquire no new one.
- [x] E **Fan of Blades** (`cone`, `castCone`): 60°/4.5 m angle-and-distance test over
      `world.units` (scratch direction vector, no allocation), 20 % slow 1 s.
- [x] R **Verdict** (`targeted`, `castTargeted`): strike nearest enemy within 5 m of
      the reticle, doubled below 30 % HP (read at cast). Cooldown starts *before* the
      resolve, so the synchronous `unitDied` refund can halve it: a hero kill within
      the 1 s strike window (`strikeUnit`/`strikeUntil`, tracked on abilities) halves
      the remaining cooldown (`hero._handleUnitDied`).
- [x] `?enemy=` wired minimally in `main.js` (`pickEnemy`) — Task 4's probe needs it;
      the hero-select UI itself stays Task 7. Bot still just takes the enemy's kit.
- [x] Mesh trim (`heroMesh.js`): pointed hood + cowl collar, trim 0xb06be0; body/
      trim/nose materials now transparent so the stealth fade can drive them.
- Assumptions (spec silent):
  - Targeted shapes search *around the reticle point* (per prompt wording), not around
    the caster; statics excluded; stealthed heroes excluded.
  - Refund halves the *remaining* cooldown (×0.5), not a flat −30 s.
  - Veil bonus window is 3 s from leaving stealth, whether the leave was expiry,
    attack or cast — one rule.
  - Stealth mesh fade applies to every viewer until Task 8/9 adds per-team view
    culling; the bot-visibility rule is the authoritative "hidden" for AI.
  - Opportunist reads the *target's* CC timers — a rooted minion hit by the cone
    itself takes the +20 % (root is CC). Probe asserts this conflation deliberately.
- Probe: new block `kesh: blink, veil, cone, opportunist, verdict` via
  `restart('hero=kesh&enemy=ilyra&lowfx=1')` — 7 assertions, **113/113 total**
  (was 106), exit 0, no code errors. One game fix found by the probe: Hero lacked a
  `stealthed` read-through, so `botSense` never saw the stealth (added getter).
- Not verifiable by the probe: hood/cowl readability; how readable 0.35 opacity is in
  practice; whether blink-behind feels responsive at 1.2 m.

## Known gaps, deliberately not in the slice

- Multiplayer. `docs/NETCODE.md` is the decision: server-authoritative at 20 Hz, intents
  in, snapshots out. The `HeroIntent` plain-data rule is honoured everywhere so the sim
  moves to a server unchanged — but no server exists.
- Minion CC, a second lane, jungle, more heroes, a build step (see CLAUDE.md).
