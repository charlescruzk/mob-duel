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
index.html                     canvas, importmap (three@0.170.0), overlays, HUD roots, boot watchdog
src/sim/                       THE SIMULATION. No three, no DOM. Runs in the browser and in Node
                               (scripts/simNode.mjs) unchanged — the future server (docs/PHASE4.md).
src/view/                      Everything that renders or reads a device. Reads sim state, never writes it.
  sim/ai/botActions.js         farm/trade/retreat actions
  sim/ai/botBuy.js             item priorities
  sim/ai/botSense.js           BOT_KIT per hero + perception
  sim/ai/heroBot.js            HeroBot state machine
  sim/core/events.js           EventBus + shared `events` (the only cross-system channel)
  sim/core/physics.js          XZ helpers: separateCircles, resolveCircleVsBoxes, clampToBounds
  sim/core/unit.js             Unit base class; `mesh`/`rig` are view-owned slots
  sim/core/vec.js              Vec3 {x,y,z} with set/copy — the sim never imports three
  sim/core/world.js            World registry, sim step, emits unitAdded/unitRemoved
  sim/economy/consumables.js   potions: stacks and use
  sim/economy/gold.js          Economy: bounties, trickle, XP
  sim/economy/itemFields.js    full stat field set
  sim/economy/items.js         25 items as data
  sim/economy/passives.js      item passives
  sim/economy/shop.js          buy/sell in fountain
  sim/game/match.js            per-frame order, countdown/live/over, reset; presentation optional
  sim/hero/abilities.js        cooldown/mana/cast/status state machine
  sim/hero/abilityLib.js       ability resolvers (shapes)
  sim/hero/abilityLibExt.js    Phase 2 shapes: targeted, cone, buff, heal, stealth, zones
  sim/hero/effects.js          projectile/ring/zone records and hit sweeps (no meshes)
  sim/hero/hero.js             class Hero extends Unit
  sim/hero/heroAttack.js       basic attack timing and on-hit
  sim/hero/heroData.js         every hero as data
  sim/hero/heroItems.js        item application
  sim/hero/heroKnock.js        knockback/pull displacement
  sim/hero/heroRecall.js       recall channel
  sim/hero/heroStats.js        derived stats
  sim/hero/intent.js           HeroIntent plain data
  sim/hero/statusExt.js        extra status kinds
  sim/map/laneData.js          positions, radii, bounds, wall boxes (data only)
  sim/units/minion.js          Minion
  sim/units/nexus.js           Nexus
  sim/units/shotPool.js        emits shotFired (tracers are view-side)
  sim/units/tower.js           Tower
  sim/units/waveSpawner.js     waves + minion pool
  view/camera/thirdPerson.js   ThirdPersonCamera
  view/core/engine.js          renderer/scene/lights/loop + Look
  view/core/input.js           keyboard/mouse/pointer lock
  view/fx/abilityFx.js         event → particle recipes, hit flash, shake
  view/fx/effectViews.js       meshes mirroring effects records
  view/fx/look.js              shadows, tone mapping, bloom, sky
  view/fx/particles.js         particle pool
  view/fx/rig.js               procedural rigs
  view/fx/rigAnimator.js       pose blending
  view/fx/shotViews.js         tracer flight from shotFired
  view/fx/unitMeshes.js        tower/nexus/shot meshes
  view/fx/unitViews.js         unitAdded/unitRemoved → meshes, shield bubble, stealth fade
  view/heroController.js       Input + camera → HeroIntent
  view/hud/abilityBar.js       cooldowns
  view/hud/damageNumbers.js    pooled floating numbers
  view/hud/heroSelect.js       six-card overlay
  view/hud/hud.js              bars, gold, timer
  view/hud/shopPanel.js        shop tabs
  view/main.js                 boot, hero select, startMatch, window.__game
  view/map/laneBuilder.js      lane meshes
  view/map/materials.js        toon materials, outlines
  view/map/textures.js         canvas textures
scripts/check.mjs              node --check every .js
scripts/probe.mjs              headless-Chrome harness + loader for scripts/probes/*.mjs
scripts/probes/*.mjs           one plug-in per feature: `export default async (ctx) => {}`
scripts/simNode.mjs            bot-vs-bot match in plain Node (npm run sim)
docs/                          DESIGN NETCODE ARCHITECTURE PROGRESS PHASE2 PHASE3 PHASE4
```

Rule of thumb: `sim/` imports only `sim/`. `view/` imports `sim/` (data, events, classes) and `three`. Cross-system communication is events (§4). The view learns about units from `unitAdded` / `unitRemoved`, about shots from `shotFired`, and mirrors `effects` records each frame; `Unit.mesh` and `Unit.rig` are view-owned slots the sim never writes.

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

### 3.1 `src/sim/core/events.js`

```js
export class EventBus { on(name, fn) → unsubscribe; off(name, fn); emit(name, payload); clear() }
export const events   // the one shared bus; import it, do not construct another
```
Payload objects are owned by the emitter and REUSED across emits. Copy fields out in
the listener; never store the payload.

### 3.2 `src/sim/core/unit.js`

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

**Hero** (`src/sim/hero/hero.js`, HERO builder) — `export class Hero extends Unit`:

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

### 3.3 `src/sim/core/world.js`

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

### 3.4 `src/sim/core/physics.js`

```js
distXZ(a, b) → m       distSqXZ(a, b)       inRangeXZ(a, b, r) → bool     (a, b: {x, z})
separateCircles(units)                            // alive, non-noCollide; static-aware
resolveCircleVsBoxes(pos, radius, boxes) → bool   // pushes pos out; true if it touched a box
clampToBounds(pos, radius, bounds) → bool
```

### 3.5 `src/sim/hero/intent.js` — HeroIntent

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

### 3.6 `src/view/heroController.js`

```js
new HeroController(input, cameraRig)
controller.enabled            false → writes a cleared intent (overlay up / lock lost)
controller.update(dt, intent, heroPos) → intent
```
Keys: WASD move (camera-relative), LMB or Space attack, Q / **F** / E / R → q/w/e/r,
B recall, Digit1–4 → buy 0–3. Aim = camera-centre ray ∩ y=0, clamped ≤ 12 m from heroPos.

### 3.7 `src/view/camera/thirdPerson.js`

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

### 3.8 `src/sim/map/laneData.js`

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

### 3.9 `src/view/map/laneBuilder.js` / `textures.js`

```js
buildLane(scene) → { boxes: WALL_BOXES, positions: POSITIONS, group }
makeGroundTexture(rx, ry)  makeStoneTexture(rx, ry)  makeDiscTexture(hex) → THREE.CanvasTexture
```

### 3.10 `src/view/hud/hud.js`

```js
new Hud()
hud.update(hero, time)     reads hero.hp maxHp mp maxMp gold level alive respawnTimer
hud.showReticle(bool)      hud.invalidate()
```
Reserved DOM roots: `#ability-bar` (HERO: abilityBar.js) and `#shop` (ECONOMY: shopPanel.js).
Build children once in your constructor; update in place; guard every lookup.

### 3.11 `src/view/core/input.js` / `engine.js`

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

Search `src/view/main.js` for `// INTEGRATE:` — each names the object to construct and the
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
