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

### Task 5 — Halvard the Wall

- [x] Hero data (`heroData.js`): hp 700/95, mp 230/22, regen 2.2/0.9, AD 55/5,
      armor 0.20/0.012, melee, moveSpeed 5.0. Passive **Unyielding**: below 30 % HP
      +0.15 armor (additive, before the 0.75 cap).
- [x] Stats refactor: `recomputeStats` + new `refreshArmor` extracted to
      `src/hero/heroStats.js`; `hero.update` calls `refreshArmor()` every frame so
      Unyielding tracks HP live (armor reverts when healed above the threshold).
- [x] Q **Shield Bash** (`targeted`): nearest enemy within 2.5 m of the reticle —
      damage then 1 s stun (stun applied *after* the strike so the bash itself can't
      benefit from Opportunist-style bonuses).
- [x] W **Stonewall** (`buff`): +0.20 armor for 4 s and a 15 % reflect. Reflect fires
      in `Unit.takeDamage` *before* mitigation: the attacker takes 15 % of the
      pre-mitigation amount as magic, synchronously, flagged `reflected` so reflects
      never chain. Stacks with Brakk's shield (separate status).
- [x] E **Charge** (`dash` + `knockback`): the FIRST enemy hero within the ability's
      radius stops the dash, takes the damage and is knocked 2.5 m along the dash over
      0.2 s (`heroKnock.js` — knocked units move even while stunned) + stunned 0.4 s.
      The landing AoE fires only when the dash completes without a hero hit. Knock
      step is capped at the remaining distance so the knock never overshoots `dist`.
- [x] R **Earthbreaker** (`windup` → `aoeStun` + zone): 0.5 s wind-up, r5 damage +
      1.2 s stun, then a 3 s zone disc (new `effects` zone pool) that re-applies a
      40 % slow every frame (strongest-wins). The zone dies with its caster
      (`clearStatus` → `endZone`).
- [x] Status plumbing: `applyStatus`/`clearStatus` extracted to `src/hero/statusExt.js`
      (abilities.js delegates); `sys.zone` state + `startZone`/`endZone`/`tickZone` in
      `abilityLibExt.js`; knockback displacement in `heroKnock.js`; file map updated in
      ARCHITECTURE.md.
- [x] Bot kit + mesh: tower-shield plate + crest, trim 0x8a9aa8; BOT_KIT entry with
      q/w/e/r costs, ranges and radii for the bot's cast heuristics.
- Assumptions (spec silent):
  - Dash stops on the first enemy hero contact and skips the landing AoE in that case.
  - Knock displacement runs while stunned (CC gate order) — knocked heroes can't act
    but do travel.
  - Zone slow re-applies each frame with a short (0.5 s) duration rather than ticking
    damage; zone has no damage per tick.
  - Unyielding lives in the per-frame `refreshArmor` rather than an armor getter, so
    item/level changes and the cap interact in one place.
  - Reflect triggers on *any* pre-mitigation damage taken (autos and abilities), and
    reflected damage itself cannot re-reflect.
- Probe lessons recorded for later tasks: zero `mpRegen`/`hpRegen` for exact windows;
  `fresh(h)` does not clear `prevIntent`, so an `edge()` on the same key right after a
  `fresh()` is swallowed — step once between them. A heroData entry missing a numeric
  field breaks page boot silently (probe prints exceptions before the restarts).
- Probe: new block `halvard: shield bash, stonewall reflect, charge knockback,
  earthbreaker zone, unyielding` via `restart('hero=halvard&enemy=ilyra&lowfx=1')` —
  9 assertions, **122/122 total** (was 113), exit 0, no code errors. Two game bugs
  found by the probe: the dash hit-detection passed the knockback object's (missing)
  `radius` to `nearestEnemy` — an undefined maxDist makes the distance test NaN and
  the dash never detected contact; and knockTick overshot `dist` by one step when the
  duration divided evenly into dt.
- Not verifiable by the probe: whether the 2.5 m knock reads as a *hit-stop shove*
  rather than a slide; how oppressive the 40 % zone slow feels; shield-plate silhouette
  readability from behind.

### Task 6 — Lumen the Tidecaller

- [x] Hero data (`heroData.js`): hp 470/60, mp 420/45, regen 1.2/2.0, AD 44/4 at 0.95 s
      interval, ranged (6.5 m, projectile 20 m/s), armor 0.08/0.01, moveSpeed 5.0.
      Passive **Riptide**: landing any ability grants +15 % move speed for 1.5 s.
- [x] `abilityHit` event: emitted from `abilityLib.abilityHit` after damage lands
      (payload `{hero, unit, dealt}` reused at module level per the EventBus rule).
      Lumen subscribes in the Hero constructor and unsubscribes on dispose; other
      heroes' hits are ignored by the owner check.
- [x] Q **Tidal Snare** (`skillshot` + `root`): line skillshot 10 m at speed 20, stops
      at the first enemy hit — damage plus a 1.5 s root. The root rides the projectile
      payload (`p.root = def.rootTime`) and applies in `projectileHit` only when damage
      actually landed (a spell-shielded hit does not root).
- [x] W **Mend** (`heal`): instant 80 + 20/s for 3 s. The HoT lives on `sys.hot` and is
      ticked by the AbilitySystem alongside the zone tick; `clearStatus` zeroes it, so
      it dies with death/respawn/reset like every other status.
- [x] E **Undertow** (`groundAoe.pull`): r3 at the reticle (7 m), 0.4 s telegraph, then
      each enemy inside is displaced up to 2 m toward the centre in one instant step
      (clamped at the centre distance; the world's separation/bounds pass clamps the
      result) plus damage and a 40 % slow 1.5 s.
- [x] R **Deluge** (`groundAoe` + `zone`): r5 at the reticle (6 m), 0.5 s telegraph,
      then a 3.5 s tide — 50 % slow re-applied every frame, 40+12/lvl damage per 0.5 s
      tick, and the caster heals 3 % max HP/s while inside. Reuses the Earthbreaker
      zone machinery via `startZone`; the groundAoe resolver branches on `def.zone`
      (zone instead of burst damage).
- [x] Hero `rooted` getter added (matches `stunned`/`stealthed` accessors) — the probe
      caught that root state had no public read.
- [x] Bot kit + mesh: tidal headpiece + water orb, trim 0x2fa8c8; BOT_KIT entry for the
      bot's cast heuristics.
- Assumptions (spec silent):
  - Mend does **not** trigger Riptide — heals are not "landings" and never emit
    `abilityHit`; only damage instances do.
  - Deluge's zone ticks *are* ability hits, so each tick refreshes Riptide while the
    caster stands inside.
  - Undertow pull is an instant displacement (not knockback speed-over-time), clamped
    so an enemy already inside `pull` metres of the centre doesn't overshoot it.
  - Deluge reuses the groundAoe telegraph (0.5 s) and lands its zone at the clamped
    reticle point; there is no initial burst damage.
- Probe: new block `lumen: tidal snare root, mend heal+hot, undertow pull, deluge zone,
  riptide haste, abilityHit event` via `restart('hero=lumen&enemy=brakk&lowfx=1')` —
  7 assertions, **129/129 total** (was 122), exit 0, no code errors. No game bugs this
  time; the two failures were probe-side: the Hero had no `rooted` getter (added), and
  the first pull test placed the enemy exactly at the field centre, where a pull toward
  the centre correctly does nothing — the test now offsets the enemy 1 m.
- Not verifiable by the probe: whether the 0.4 s telegraph reads as *duckable*; whether
  the 2 m snap-pull feels like a drag or a teleport; Deluge's 3 %/s self-heal balance
  while tanking inside the tide.

### Task 7 — hero select, `?enemy=`, bot for all six

- [x] Hero-select overlay (`src/hud/heroSelect.js`, 140 lines): six cards built once in
      the constructor from HERO_KEYS — procedural 96×96 canvas portrait silhouettes,
      name + title, primary attribute + role badge, the four ability rows and the
      passive. Click → `onPick(key)`; the overlay hides and the start gate shows.
      Every DOM read is guarded; a missing `#hero-select` degrades to the old
      `?hero=` flow.
- [x] `main.js` restructured into `boot()` + `startMatch()`: without `?hero=` the
      select overlay shows and the match is only constructed once a card is clicked;
      with `?hero=` the match builds immediately. `?enemy=` picks the bot hero;
      anything missing/unknown falls back to the seeded default.
- [x] Seeded default enemy: deterministic FNV-1a over the player key, index into the
      other five in HERO_KEYS order — brakk→lumen, ilyra→brakk, vaskra→brakk,
      kesh→halvard, halvard→lumen, lumen→brakk.
- [x] BOT_KIT rewritten to the §6 generic schema: every kit carries `id`, every slot
      `{ cost, range, radius, base, step, minLevel, kind }` with kind ∈ damage | cc |
      buff | escape | heal | stealth. `abilityReady` now gates on `minLevel` (it
      previously read a field that no longer existed — latent bug the probe surfaced).
- [x] `botBuy.js` split out of botActions.js (file was past 300 lines): per-hero item
      priority lists (swiftsoles + two potions opener, then attribute → mid → capstone
      by primary), stack-aware `nextBuy` (merged potion stacks count via `count`), and
      the sustain helpers — `maybePotion` (sip below 60 % HP when no potion is running
      and nothing from the player for 2 s) and `maybeHeal` (Lumen W below half). The
      bot holds the potion through combat: the guard arms on *any* damage from the
      player and on the player casting (incoming pressure), not just magic hits.
- [x] Generalized cast rules in botActions.js: wave-clear picks the first ready
      damage/cc slot and aims AoE vs skillshot by radius; ranged trades open with a
      buff, escape when the player dashes in, cc on cooldown when in range, damage
      casts gated at ≥ 10 % of the player's max HP; retreats cast stealth/buff/heal by
      kind. `useItem` resets with the other intent fields each decision pulse.
- Assumptions (spec silent):
  - The seeded enemy is FNV-1a of the player key (documented above); `?enemy=` always
    wins when it names a valid hero.
  - SHOP holds while `nextBuy` returns anything affordable — the previous gold ≥ 250
    gate made the bot walk out with one item and never buy its 50 g potions.
  - A player cast arms the bot's "in combat" guard from wind-up start (the bot cannot
    know whether the spell is aimed at it, and holding the potion through a combo is
    correct play).
  - Bot damage-cast gate: ≥ 10 % of the player's max HP expected damage.
- Probe: new blocks — hero select (10 assertions, bare page, click a card → match
  builds), `?enemy=` (3), seeded default (2), bot vaskra/kesh/halvard/lumen behaviour
  (2–3 each), bot potion buy/sip/hold (4). **156/156 total** (was 129), exit 0, no
  code errors. Game bugs found: the SHOP gold gate above, and `abilityReady` reading
  the dead `a.level` field. Probe bug found: `restart()` appended query params to the
  first page's URL, producing duplicate `hero` params — every "swap hero" page
  silently booted Brakk (URLSearchParams takes the first value); restart now rebuilds
  from the bare base URL with a fresh cache-buster, and the first load pins
  `enemy=ilyra` to keep the old default the earliest blocks assume.
- Not verifiable by the probe: whether the card grid reads as pickable and the
  portraits as distinct silhouettes; whether the seeded matchup feels fair; bot
  potion timing under real pressure (the probe tests the guard, not the judgement).

### Task 8 — particles, ability FX, damage numbers, hit feedback

- [x] `src/fx/particles.js`: one `THREE.Points` over 3000 pre-allocated slots — flat
      Float32Arrays for position/velocity/colour/size/alpha/life/gravity/drag, round-
      robin emit (oldest overwritten), `ShaderMaterial` with additive blending, soft
      circle falloff, size attenuation and alpha from remaining life. `update(dt)` sets
      needsUpdate once per attribute per frame; ground clamps at y 0.06. Emitters:
      `burst`, `ring`, `column`, and per-frame `trail` / `trailRgb`.
- [x] `src/fx/abilityFx.js`: recipe table for all 24 abilities + autos per hero
      (emitter kind, count, speed, life, size, per-kit hit colour); listens to
      `abilityCast` (cast flourish + camera kick on R), `abilityHit` (impact burst),
      `unitDamaged` (hit flash), `unitDied` (death burst in team colour),
      `heroLevelUp` (gold ring), `recallStarted` (column), `heroRespawned` (burst),
      `heroDied` (hard camera kick on own death). Projectile trails iterate the
      effects pool each frame reading each mesh's live colour — no allocation.
- [x] Hit flash: 0.1 s 8 % scale pop from a fixed 16-slot pool on the fx side. Scale,
      not emissive — minion body materials are shared per team, so an emissive pulse
      would light every minion on the team at once. Flashes die with the unit and
      clear on fx.reset.
- [x] `src/hud/damageNumbers.js`: 32 pooled divs built once, `unitDamaged` listener
      fills the round-robin head; per-frame world→screen projection through one shared
      `Vector3.project(camera)`, rise 1.3 m and fade over 0.8 s, colour by damage type,
      19 px for hero hits vs 14 px. Behind-camera numbers hide rather than wrap.
- [x] Camera kick: `thirdPerson.shake(amplitude, seconds)` — decaying random offset on
      top of the settled frame; a louder shake replaces a quieter one rather than
      stacking.
- [x] Wiring: `main.js` builds the three systems once per page and exposes `g.fx`;
      `Match._present` calls `fx.update(dt)` after the camera update (numbers project
      through the fresh frame); `Match.reset` calls `fx.reset()`.
- Assumptions (spec silent):
  - Camera kick fires on R **cast** (wind-up) rather than impact — `abilityHit` does
    not carry the slot, and a kick on wind-up reads the same to the player.
  - `lowfx` does not disable particles (one 3000-slot pool is cheap; the composer and
    shadows are the expensive parts, disabled in Task 9).
  - Damage numbers show the mitigated amount actually removed (post-armor/shield).
- Probe: new block `fx: particles emit on cast/hit and die out, buffers constant,
  damage numbers pool, fx reset` — 8 assertions, **164/164 total** (was 156), exit 0,
  no code errors, passed on the first run.
- Not verifiable by the probe: whether the bursts read as juicy or as noise; flash and
  kick amplitude at real frame rate; damage-number readability over a busy lane.

## Known gaps, deliberately not in the slice

- Multiplayer. `docs/NETCODE.md` is the decision: server-authoritative at 20 Hz, intents
  in, snapshots out. The `HeroIntent` plain-data rule is honoured everywhere so the sim
  moves to a server unchanged — but no server exists.
- Minion CC, a second lane, jungle, more heroes, a build step (see CLAUDE.md).
