# ARCHITECTURE.md — moba-duel, where code goes and what it promises

This file is the integration contract. Three builders (HERO, UNITS, ECONOMY+BOT) code
against it in parallel without talking to each other. **Every signature below is
verbatim from the scaffold**; if you need something not listed, add it in your own
file and record it in `docs/PROGRESS.md` — do not change a scaffold signature.

Deviations from `docs/DESIGN.md` fixed by the contract (use these, not the doc):

- Radii: `hero 0.5`, `minion 0.35`, `tower 1.2`, `nexus 2.0` (`laneData.RADII`).
- Keyboard: the W ability is on **KeyF** (KeyW is move-forward). Only the controller
  cares; the hero reads `intent.w`.
- Intent carries `buy` (NETCODE.md has it; the builder brief omitted it).

---

## 1. Folder layout

```
index.html                 canvas, importmap (three@0.170.0), #start-overlay, #hud
                           (#ability-bar and #shop roots reserved), boot-error script
src/
  main.js                  boot: builds every object once; ?hero=/?enemy= or the
                           hero-select overlay picks the matchup, then startMatch wires
                           heroes, structures, economy, bot, HUD and window.__game
  core/
    engine.js              Engine: renderer/scene/camera/lights/resize/loop; applies
                           the Look (fx/look.js) and renders through its composer    (scaffold)
    events.js              EventBus + shared `events`                             (scaffold)
    input.js               Input: keyboard/mouse/pointer lock — the only device reader
    physics.js             distXZ, inRangeXZ, separateCircles, resolveCircleVsBoxes,
                           clampToBounds                                          (scaffold)
    unit.js                Unit base class                                         (scaffold)
    world.js               World registry + shared sim step                       (scaffold)
  hero/
    intent.js              makeIntent / clearIntent / copyIntent                  (scaffold)
    heroController.js      Input + camera → HeroIntent                             (scaffold)
    hero.js                class Hero extends Unit                                  HERO
    heroData.js            the two heroes' numbers (DESIGN.md §3)                   HERO
    abilities.js           cooldown/mana/cast-state machine per slot                HERO
    abilityLib.js          the eight ability behaviours (Q/W/E/R × 2)               HERO
    abilityLibExt.js       the new Phase 2 shapes (buff, targeted, cone, zone…)     HERO
    statusExt.js           applyStatus/clearStatus extracted from abilities.js      HERO
    heroStats.js           recomputeStats + refreshArmor (Unyielding) from hero.js  HERO
    heroKnock.js           knockback displacement (Charge) — moves while stunned    HERO
    effects.js             projectiles, telegraphs, dash/blink motion, marks        HERO
  camera/
    thirdPerson.js         ThirdPersonCamera rig                                  (scaffold)
  map/
    laneData.js            every position/radius/bound as data                   (scaffold)
    laneBuilder.js         ground, strip, wall blocks, base markers                (scaffold)
    textures.js            procedural canvas textures (ground, stone, discs, sky)  (scaffold)
    materials.js           toon gradient/material + inverted-hull outline helpers  (Task 9)
  units/
    minion.js              class Minion extends Unit (melee + ranged)                UNITS
    waveSpawner.js         WaveSpawner: t=15 s then every 30 s, 3+2 in formation     UNITS
    tower.js               class Tower extends Unit                                  UNITS
    nexus.js               class Nexus extends Unit                                  UNITS
    unitMeshes.js          primitive meshes for minion/tower/nexus                   UNITS
  economy/
    gold.js                GoldSystem: bounties + trickle from 'unitDied'      ECONOMY+BOT
    items.js               the item table as data (Phase 2: 25 items)          ECONOMY+BOT
    itemStats.js           item→stat aggregation if items.js runs out of room  ECONOMY+BOT
    consumables.js         potion stacking/use (intent.useItem slots 1–6)      ECONOMY+BOT
    passives.js            the nine item passives, called from the hit paths   ECONOMY+BOT
    shop.js                Shop: consumes intent.buy inside the fountain       ECONOMY+BOT
  ai/
    heroBot.js             HeroBot: state machine, writes the red hero's intent  ECONOMY+BOT
    botSense.js            delayed player view, snapshot, BOT_KIT (per-hero cast data) BOT
    botActions.js          per-state intent writers (farm/trade/retreat/push)    ECONOMY+BOT
    botBuy.js              per-hero item priority, potion/heal sustain           ECONOMY+BOT
  fx/                      VISUALS ONLY — imports core/, map/ and reads unit state;
                           sim code never imports fx/. Mesh builders here keep the
                           { group, shield } contract and never mutate sim state.
    particles.js           one THREE.Points particle system, pooled buffers          FX
    abilityFx.js           (heroKey, slot) → colour + emitter recipe table           FX
    look.js                shadows, tone mapping, sky, fog, bloom composer           FX
    rig.js                 procedural hero/minion rigs built from primitives         FX
    rigAnimator.js         joint-angle pose blender driven by unit state             FX
  hud/
    hud.js                 Hud shell: bars, gold, level, timer, respawn, reticle (scaffold)
    abilityBar.js          fills #ability-bar from hero cooldowns                    HERO
    shopPanel.js           fills #shop; visible only in fountain              ECONOMY+BOT
    shopPanelTabs.js       tab/inventory sub-view if shopPanel.js runs out of room   ECONOMY
    heroSelect.js          #hero-select overlay: six cards, pick → start overlay    HUD
    damageNumbers.js       32 pooled floating damage numbers, world→screen           HUD
  game/
    match.js               Match: per-frame order, matchOver freeze, reset      INTEGRATOR
scripts/
  check.mjs                node --check every .js
  probe.mjs                headless-Chrome harness; one `block` per feature
docs/
  DESIGN.md NETCODE.md ARCHITECTURE.md PROGRESS.md
```

Rule of thumb: `core/` and `map/` are imported by everyone; `hero/`, `units/`,
`economy/`, `ai/` import only `core/`, `map/` and their own folder; `fx/` imports
`core/`, `map/` and reads unit state, but sim code (`hero/`, `units/`, `economy/`,
`ai/`, `game/`) never imports `fx/`. Cross-system communication is events (§4).
`hud/` reads state and listens; it never calls sim methods.

---

## 2. Per-frame data flow (the order `main.js` / `match.js` runs)

```
Engine rAF ─► step(dt)   dt ≤ 0.05 s, seconds
  1. controller.update(dt, blueIntent, blueHero.pos)   Input + camera → intent (writer #1)
  2. bot.update(dt)                                    sim state → redHero.intent (writer #2)
  3. waves.update(dt)   shop.update(dt)   gold.update(dt)   (systems that spawn/award)
  4. world.update(dt)                                  ← the sim step, see below
  5. effects.update(dt)                                projectiles/telegraphs resolve hits
  6. camera.update(dt, blueHero.pos)
  7. hud.update(blueHero, world.time)   abilityBar.update(...)   shopPanel.update(...)
  8. input.endFrame()                                  clears justPressed + mouse deltas
Engine renders the scene after step returns.
```

`world.update(dt)` does, in order: `time += dt` → `u.update(dt)` for every **alive**
unit (heroes included — a Hero reads `this.intent`) → `separateCircles(units)` → wall
AABB push-out + lane clamp for every alive non-static unit → `vel = (pos − prevPos)/dt`,
`prevPos = pos`, `syncMesh()` for every unit → flush queued removals.

Consequences builders must respect:

- **Do not clamp/collide in your own update.** Move `this.pos` freely; the world fixes
  overlap and bounds the same frame. Dashes that must stop at walls call
  `resolveCircleVsBoxes(pos, radius, world.boxes)` themselves mid-dash.
- **Teleports use `unit.teleport(x, z)`** so `vel` does not spike (bot aim-lead reads it).
- `u.update` is NOT called while `alive === false`. Instead the world calls
  `u.tickDead(dt)` on any dead unit that defines it. HERO builder implements
  `Hero.tickDead(dt)`: cooldowns keep ticking, `respawnTimer` counts down, and at 0 it
  calls `this.respawn()`. Nobody else needs to remember dead heroes.
- Mesh position/rotation come from `syncMesh()`: `mesh.position = pos`,
  `mesh.rotation.y = facing`. Put visual offsets on children of `mesh`, not on `mesh`.

---

## 3. Contracts (verbatim)

### 3.1 `src/core/events.js`

```js
export class EventBus { on(name, fn) → unsubscribe; off(name, fn); emit(name, payload); clear() }
export const events   // the one shared bus; import it, do not construct another
```
Payload objects are owned by the emitter and REUSED across emits. Copy fields out in
the listener; never store the payload.

### 3.2 `src/core/unit.js`

```js
export class Unit {
  constructor(kind, team, radius, maxHp, armor = 0)
  // kind: 'hero' | 'minion' | 'tower' | 'nexus'    team: 'blue' | 'red'
  id            number, unique, from a module counter
  pos           THREE.Vector3 (y stays 0)      prevPos  Vector3      vel  Vector3 (m/s, XZ)
  facing        yaw radians; 0 faces −Z; set with Math.atan2(-dx, -dz)
  radius hp maxHp armor(0..1) shield alive moveSpeed
  invulnerable  true → takeDamage returns 0 and nearestEnemy/enemiesInRadius skip it
  isStatic      true → never pushed by separation; others take 100% (tower, nexus)
  noCollide     true → skipped by separation entirely
  mesh          Object3D | null      world  World | null (set by World.add)
  takeDamage(amount, source, dtype = 'physical') → number dealt
                dtype 'physical' | 'magic' | 'true'; armor then shield; 'true' skips both;
                emits 'unitDamaged'; calls die(source) at 0
  heal(n) → number healed; emits 'unitHealed'
  die(source)   alive=false, hp=0, shield=0, hides mesh, emits 'unitDied' { unit, source }
  revive()      alive=true, hp=maxHp, shows mesh (heroes call this from respawn())
  teleport(x, z)
  update(dt)    no-op; subclasses override
  syncMesh()
}
```

**Hero** (`src/hero/hero.js`, HERO builder) — `export class Hero extends Unit`:

```js
new Hero(heroKey, team, world, scene)        // heroKey: 'brakk' | 'ilyra'; adds its own mesh to scene
hero.intent                                  // HeroIntent, assigned by main/match after construction
hero.update(dt, intent = this.intent, world = this.world)   // called by World.update as update(dt)
hero.tickDead(dt)                            // called by World.update while !alive; respawns at 0
hero.respawn()                               // revive(), teleport to own heroSpawn, full HP/MP, clears status
// fields the HUD/bot/shop read (names are the contract):
hp maxHp mp maxMp level xp gold shield alive respawnTimer moveSpeed
attackDamage attackRange attackInterval abilityAmp cdr
cooldowns   { q, w, e, r }  seconds remaining (0 = ready)
costs       { q, w, e, r }  mana cost at the current level
isCasting   boolean (wind-up/cast/channel/dash in progress → rooted)
isRecalling boolean         recallTimer  seconds remaining
stunTimer slowTimer slowPct  (slows do not stack: strongest wins)
addGold(n) addXp(n)         // ONLY GoldSystem/XP listeners call these
applyItem(itemDef)          // Shop calls this after paying
```
The hero edge-detects casts itself: keep a `prevIntent` and cast on `false→true`.
Abilities hit via `world.enemiesInRadius(...)` / `world.nearestEnemy(...)` and
`unit.takeDamage(amount, hero, 'magic' | 'physical')`. Abilities NEVER damage
`kind === 'tower' | 'nexus'` — filter those out; basic attacks are the only exception.

**Minion / Tower / Nexus** (UNITS builder) — each `extends Unit`:

```js
new Minion(team, world, scene, pos, { ranged: false, wave: 0 })   // 5th arg is the builder's
new Tower(team, world, scene, pos)     isStatic = true, radius RADII.tower
new Nexus(team, world, scene, pos)     isStatic = true, invulnerable while own tower alive
new WaveSpawner(world, scene)          .update(dt) spawns per DESIGN.md §4 using world.time
```
`pos` is a Vector3 to `copy()`; use `laneData.POSITIONS[team].tower` etc. The caller
does `world.add(unit)` (constructors do not self-register). Minions target through
`world.nearestEnemy(this.pos, this.team, 7.0, 'minion')` then `'hero'` then
`'tower'`/`'nexus'`. Minion gold/XP values are read by GoldSystem from
`unit.goldValue` / `unit.xpValue` fields (numbers) set in the constructors:
melee 20/30, ranged 16/25, tower 150/200, nexus 0/0, hero `250 / (120 + 30 × level)`.

### 3.3 `src/core/world.js`

```js
export class World {
  constructor(seed = 1337)
  units     Unit[]  (registry order = insertion order)
  time      match seconds; advanced only by update(dt)
  boxes     wall AABBs [{ min: Vector3, max: Vector3 }]   bounds { minX, maxX, minZ, maxZ }
  setCollision(boxes, bounds)
  add(u) → u          sets u.world; idempotent
  remove(u)           queued; applied at the end of update(dt); also removes u.mesh from its parent
  hero(team) → Unit | null            (alive or dead)
  byTeam(team, kind | null, out) → out          alive units only
  nearestEnemy(pos, team, maxDist, kindFilter = null) → Unit | null
                      // `team` is the ASKER's team; alive, non-invulnerable, centre distance ≤ maxDist
  enemiesInRadius(pos, team, r, out, kindFilter = null) → out     // out.length = 0 first
  random() → [0, 1)   seeded mulberry32 — the only RNG the sim may use
  update(dt)          see §2
  clear()             removes every unit (match reset)
}
```
Scratch `out` arrays are module-level in the caller and reused. Never `.filter()`.

### 3.4 `src/core/physics.js`

```js
distXZ(a, b) → m       distSqXZ(a, b)       inRangeXZ(a, b, r) → bool     (a, b: {x, z})
separateCircles(units)                            // alive, non-noCollide; static-aware
resolveCircleVsBoxes(pos, radius, boxes) → bool   // pushes pos out; true if it touched a box
clampToBounds(pos, radius, bounds) → bool
```

### 3.5 `src/hero/intent.js` — HeroIntent

```js
makeIntent() → { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, attack: false,
                 q: false, w: false, e: false, r: false, recall: false, buy: -1 }
clearIntent(i) → i        copyIntent(dst, src) → dst
```
`moveX/moveZ` world-space unit vector or 0,0. `aimX/aimZ` world ground point ≤ 12 m
from the hero. `attack` level-sensitive. `q w e r recall` are cast REQUESTS — a writer
may hold them true for several frames (the bot holds 0.2 s); the hero fires once per
rising edge. `buy` −1 or item index 0..3; the shop consumes it on the rising edge
(`prev === -1 && buy >= 0`). Numbers and booleans only; mutate in place.

### 3.6 `src/hero/heroController.js`

```js
new HeroController(input, cameraRig)
controller.enabled            false → writes a cleared intent (overlay up / lock lost)
controller.update(dt, intent, heroPos) → intent
```
Keys: WASD move (camera-relative), LMB or Space attack, Q / **F** / E / R → q/w/e/r,
B recall, Digit1–4 → buy 0–3. Aim = camera-centre ray ∩ y=0, clamped ≤ 12 m from heroPos.

### 3.7 `src/camera/thirdPerson.js`

```js
new ThirdPersonCamera(camera, input)
yaw pitch                     radians; yaw 0 looks toward −Z; pitch default −25°, [−60°, −8°]
forwardX forwardZ rightX rightZ    XZ unit basis (right = forward × up)
pivot                         Vector3, smoothed target
update(dt, targetPos)         reads input.mouseDX/DY while locked; camera 7 m behind pivot+1.6 m
snapTo(targetPos)             next update jumps the pivot (spawn/respawn/recall)
setYaw(yaw)
reticleOnGround(out) → bool   camera-centre ray ∩ y=0 into `out` (Vector3 or {set})
```

### 3.8 `src/map/laneData.js`

```js
TEAMS ['blue','red']      TEAM_COLOR { blue: 0x3b6fd6, red: 0xd64a3b }     enemyOf(team)
LANE_BOUNDS { minX:-7, maxX:7, minZ:-45, maxZ:45 }     GROUND_BOUNDS x±24 z±50
RADII { hero: 0.5, minion: 0.35, tower: 1.2, nexus: 2.0 }     HEIGHTS { hero 1.8, minion 1.2, tower 6, nexus 4 }
FOUNTAIN_RADIUS 8.0       TOWER_RANGE 10.0
POSITIONS.blue = { dir: -1, nexus (0,0,42), tower (3,0,16), minionSpawn (-1.5,0,38.5), heroSpawn (0,0,37) }
POSITIONS.red  = { dir: +1, nexus (0,0,-42), tower (3,0,-16), minionSpawn (-1.5,0,-38.5), heroSpawn (0,0,-37) }
MINION_SLOTS { melee: [-1, 0, 1], ranged: [-0.5, 0.5], rangedBehind: 2.0 }   // x offsets from minionSpawn.x
WALL_BOXES  16 × { min, max } Vector3 AABBs
isInFountain(pos, team) → bool         distToTower(pos, team) → m (centre dist − tower radius)
```
`dir` is the team's forward along Z: a blue minion walks toward `nexus.z` of red, i.e.
`z += dir × speed × dt`.

### 3.9 `src/map/laneBuilder.js` / `textures.js`

```js
buildLane(scene) → { boxes: WALL_BOXES, positions: POSITIONS, group }
makeGroundTexture(rx, ry)  makeStoneTexture(rx, ry)  makeDiscTexture(hex) → THREE.CanvasTexture
```

### 3.10 `src/hud/hud.js`

```js
new Hud()
hud.update(hero, time)     reads hero.hp maxHp mp maxMp gold level alive respawnTimer
hud.showReticle(bool)      hud.invalidate()
```
Reserved DOM roots: `#ability-bar` (HERO: abilityBar.js) and `#shop` (ECONOMY: shopPanel.js).
Build children once in your constructor; update in place; guard every lookup.

### 3.11 `src/core/input.js` / `engine.js`

```js
new Input(canvasEl)   isDown(code) justPressed(code) mouseDown[0..2] mouseJustPressed(b)
                      mouseDX mouseDY locked onLockChange(fn) requestPointerLock() endFrame()
new Engine(canvas)    renderer scene camera sun ambient  start(cb(dt))  stop()  resize()  onError
```
Nothing outside `input.js` may add a keyboard/mouse listener.

---

## 4. Event table (`events.emit(name, payload)`)

| Event | Payload (reused object) | Emitted by | Listened by |
|---|---|---|---|
| `unitDamaged` | `{ unit, amount, source, dtype }` | `Unit.takeDamage` | tower aggro (hero-on-hero in range), HUD flash, bot (W trigger) |
| `unitHealed` | `{ unit, amount }` | `Unit.heal` | HUD |
| `unitDied` | `{ unit, source }` | `Unit.die` | **GoldSystem (bounties + XP — the ONLY gold/XP source)**, WaveSpawner/Tower bookkeeping, Nexus (tower dead → vulnerable), Match (nexus → `matchOver`) |
| `heroLevelUp` | `{ hero, level }` | Hero | abilityBar, HUD |
| `goldChanged` | `{ hero, gold }` | Hero.addGold | shopPanel |
| `abilityCast` | `{ hero, slot }` | Hero (`slot` 'q'\|'w'\|'e'\|'r') | abilityBar, bot (W reaction) |
| `heroRespawned` | `{ hero }` | Hero.respawn | camera snap (match), bot |
| `recallStarted` / `recallEnded` | `{ hero, completed }` | Hero | HUD |
| `itemBought` | `{ hero, item }` | Shop | shopPanel, HUD |
| `waveSpawned` | `{ team, index }` | WaveSpawner | probe/debug |
| `matchOver` | `{ winner }` | Match (on nexus `unitDied`) | HUD overlay, freeze |

`source` on `unitDied` is the Unit whose damage instance killed (a Hero for autos and
abilities, a Minion, a Tower) or `null` (fountain laser). Gold goes to `source` only
when `source.kind === 'hero'`. XP goes to every enemy hero within 12 m of `unit.pos`
(tower: to the killing team's hero at any distance).

---

## 5. `main.js` INTEGRATE hooks

Search `src/main.js` for `// INTEGRATE:` — each names the object to construct and the
exact line it slots into. `window.__game` is set once with
`{ engine, input, events, world, camera, controller, intent, map, hud, hero, step, three }`;
`step(dt)` is the whole frame and is what the probe drives. `match.js` should add
`match`, `enemy`, `bot`, `waves`, `shop`, `gold` to that object.

## 6. Verification

`npm run check` (syntax) then `npm run probe`. The scaffold block in `scripts/probe.mjs`
asserts: intent moves the hero at 5.2 m/s, `vel` tracks it, mesh syncs, lane clamp at
7 − radius, camera 7 m behind the pivot, reticle hits the ground, armor/shield/true
damage maths, death and revive events, world queries, intent plainness, 16 wall boxes.
Add one `block` per feature; drive with `window.__game.step(dt)` or `world.update(dt)`.
