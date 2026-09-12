# PHASE3.md — folklore heroes, real combat animation, a living map, mobile, polish

Phase 2 proved six kits and a cel-shaded look. Phase 3 is the **art and feel** phase:
the same six verified kits become folklore characters with authored combat animation,
the grey lane becomes a night forest with a river, particles get loud, the game runs on
a phone, and the rough edges (sound, menus, result screen) get finished. Multiplayer is
Phase 4 (`docs/PHASE4.md`) and depends on the sim/view split that Phase 3 starts.

Rules from `CLAUDE.md` still hold: no assets, no build step, no dependencies. Every
character, tree, river and sound is generated in code. That is a constraint and a style:
commit to stylised silhouettes, strong colour, and motion — not realism.

---

## 1. Direction: dark and whimsical

A moonlit night in a forest where two mythologies meet. Deep indigo sky, a huge moon
with a bite taken out of it (the serpent of Philippine myth that eats moons), fog in the
low ground, fireflies everywhere, bioluminescent mushrooms and glowing river water.
Colours: indigo `#141a33`, moon cream `#f3ead0`, firefly gold `#ffd36b`, river cyan
`#4fd8e0`, mushroom violet `#b57bff`, blood-red accents for the red team, cold blue for
blue. Outlines stay; shading bands stay; bloom gets stronger. Think storybook, not
horror: rounded shapes, big lanterns, exaggerated animation.

The blue base is **Philippine**: a great balete tree with hanging roots, nipa-hut
rooftops, bamboo groves, a serpent-headed nexus. The red base is **Japanese**: a torii
gate, stone lanterns, dark maples, guardian-lion statues as the tower, a shrine nexus.
The river crosses the lane at z = 0 under a stone bridge; the walkable strip and every
collision box are **unchanged** — all of this is dressing outside x = ±7 plus a
cosmetic ford on the strip.

---

## 2. Roster: the six kits become folklore characters

Mechanics, numbers, cooldowns, shapes and every probe assertion from Phase 2 **stay**.
Only identity changes: hero keys, names, ability names, descriptions, portraits, rigs,
clips, VFX palettes. Renaming a key is a repo-wide search-and-replace including the
probe URLs and `BOT_KIT`. Original names inspired by public folklore; no game names.

| Old key | New key | Name | Origin | Primary · role | Silhouette |
|---|---|---|---|---|---|
| `brakk` | `bayani` | Bayani, the Kampilan Datu | Philippines | STR · fighter | broad warrior, kampilan sword, round kalasag shield, red headwrap |
| `halvard` | `oroku` | Oroku, the Oni Warden | Japan | STR · tank | huge horned oni, studded kanabō club, tiger-stripe loincloth |
| `vaskra` | `kazane` | Kazane, the Tengu Fletcher | Japan | AGI · marksman | long-nosed tengu, black wings, tall bow, small cap |
| `kesh` | `lilit` | Lilit, the Manananggal | Philippines | AGI · assassin | slender, bat wings, claws; at stealth the upper body lifts off and the legs stay |
| `ilyra` | `ren` | Ren, the Kitsune Oracle | Japan | INT · mage | fox-masked, nine tails (a chain of cones), floating foxfire |
| `lumen` | `amihan` | Amihan, the Babaylan | Philippines | INT · controller | shaman, feathered headdress, staff with bells, water orb |

### 2.1 Ability names (same slots, same mechanics)

| Hero | P | Q | W | E | R |
|---|---|---|---|---|---|
| Bayani | Anting-Anting (lifesteal amulet) | Kampilan Sweep | Kalasag Guard | Datu's Charge | Earthshaker Stomp |
| Oroku | Oni Hide | Kanabō Smash | Iron Skin | Rampage | Mountain Splitter |
| Kazane | Third Feather | Gale Arrow | Wind Volley | Feather Hop | Mountain Wind Shot |
| Lilit | Night Hunger | Wingbeat | Severance | Talon Sweep | Feast |
| Ren | Foxfire Mark | Kitsunebi | Fox Ring | Nine-Tail Flicker | Spirit Lance |
| Amihan | Monsoon Step | Vine Snare | Healing Chant | Riptide Pull | Rain Chant |

Two flavour tweaks that need no balance change: Lilit's stealth visual is the split
(upper body rises 1.5 m and hovers; legs stay as a static prop until it ends), and Ren's
tails fan out during casts.

---

## 3. Animation system v2 — authored combat clips on a segmented rig

The Phase 2 rig has seven joints and blends single poses. Phase 3 makes movement read
as combat.

**Rig.** Fourteen joints in a fixed order: `pelvis, spine, chest, head, shoulderL,
elbowL, shoulderR, elbowR, hipL, kneeL, hipR, kneeR, weapon, offhand`. Each joint is a
`THREE.Group` with a primitive child (capsules for limbs, a box or sphere for torso and
head). Per-hero parts (horns, wings, tails, headdress, shield) attach to named joints.
A rig exposes `joints[]`, `pose` (Float32Array, 3 rotations per joint) and `rootOffset`
(x, y, z for bob and root motion). Minions get the same rig at 0.7 scale with a flat
"grunt" clip set. Build once; no allocation after.

**Clips as data.** `src/fx/clips/<heroKey>.js` exports a clip set:
```
{ idle, walk, run, attack: [a1, a2, a3], cast: { q, w, e, r }, hit, death, dash,
  recall, victory }
```
A clip is `{ duration, loop, keys: [{ t, pose: Float32Array-shaped array }],
events: [{ t, name }] }`. Keys are sampled with ease-in-out between neighbours. Shared
base clips in `src/fx/clips/base.js` (idle, walk, run, hit, death, recall) so each hero
file only overrides what is distinctive. Attack clips are **per weapon class**: sword
(3-hit chain: horizontal, rising, overhead), club (2 heavy swings with anticipation),
bow (nock, draw, release with recoil), claws (fast alternating slashes), staff (thrust
and sweep), and the mage's off-hand throws. Melee autos cycle the chain; the chain
resets after 1.5 s without an attack.

**Blend tree.** Lower body: idle ↔ walk ↔ run chosen by speed (0 / 2.5 / 5 m/s) with
0.15 s cross-fades. Upper body (spine and up, plus weapon): attack, cast, hit or recall
clips **overlay** the locomotion so a hero swings while stepping. Full-body overrides:
dash, death, victory. Clip `events` fire visual hooks (`swingStart`, `impact`,
`release`) that trigger weapon trails and particles at the right frame — the sim's hit
timing stays the authority; the clip just matches it.

**Weapon trails.** A ribbon mesh (pre-allocated 24-segment strip) per melee weapon,
fed by the weapon joint's world position between `swingStart` and `impact`, additive
and emissive so it blooms.

**Pose tool.** `?poseTool=1` opens a dev panel (built once in `src/fx/poseTool.js`,
never loaded otherwise): pick hero and clip, scrub time, drag sliders per joint, add a
key, and print the clip as JSON to the console for pasting back into the clip file.
This is how a human fixes an ugly animation without touching code.

---

## 4. Map v2 — a living night forest

All in `src/map/`, built once, instanced where repeated, none of it collidable except
the existing boxes.

- **Sky and moon.** Gradient dome (a large inverted sphere with a canvas gradient),
  a moon disc with the bite, faint stars (a `Points` cloud). Fog colour = horizon.
- **Terrain.** The ground plane gets a procedural height-noise texture and a painted
  path down the lane; a darker forest floor beyond ±7 m, slightly raised (0.4 m) so the
  lane reads as a cut.
- **Foliage (InstancedMesh).** Trees: 4 kinds (balete with root cones, bamboo culms,
  maple with a flat canopy, pine). ~120 instances scattered by a seeded RNG outside the
  strip, scaled 0.8–1.4. Undergrowth: ~600 grass tufts (crossed planes with an alpha
  canvas texture), ~80 glowing mushrooms (emissive violet), ~40 ferns. Everything sways:
  a vertex shader `onBeforeCompile` hook adds a small wind offset by world position and
  time (one uniform updated per frame, no per-instance work).
- **River.** A plane across z ∈ [−4, 4], custom shader: two scrolling procedural noise
  layers, fresnel-ish rim, emissive cyan at the banks; a stone bridge (boxes) over the
  strip; on the strip itself a shallow ford texture only. Lily pads and reeds at the
  banks. No gameplay effect.
- **Bases.** Blue: balete tree (trunk cylinder + hanging root cones), two nipa-hut roofs,
  bamboo, a serpent-head nexus (stacked spheres and a cone jaw, glowing eyes). Red:
  torii gate (two pillars and two beams, vermilion), stone lanterns with warm emissive
  cores, two guardian-lion statues flanking the tower, a shrine nexus with a curved
  roof. Towers keep their radii and heights.
- **Ambient particles.** Fireflies (200 slow wandering emissive points, more near the
  river and the bases), drifting pollen, mist sheets near the ground.
- **Performance budget.** Desktop: < 250 draw calls, 60 fps with a wave clash.
  Phone: `lowfx` tier halves instance counts, drops shadows and bloom, caps pixel ratio
  at 1.5. Measure with a `?stats=1` overlay (draw calls, triangles, fps) built into
  `src/fx/stats.js`.

---

## 5. Particles v2 — readable from across the lane

Replace the `Points` system with an **instanced quad** system (`InstancedMesh` of a
unit plane, 6000 instances, custom shader): billboarded, **stretched along velocity**
for sparks and streaks, per-instance colour, size, rotation, life. Two materials:
additive (fire, sparks, magic) and alpha (smoke, dust, leaves). Procedural sprite
sheet on a canvas: soft dot, spark, smoke puff, leaf, petal, ring — the shader picks a
cell per instance.

Recipes per ability get **three layers**: anticipation (a gather at the cast joint
during wind-up), release (a burst plus a trail or shockwave), impact (a ground decal
plus debris plus a 0.05 s hit flash on the victim). Ground decals are pooled planes
(scorch, water ring, petals, frost) that fade over 4 s. Ultimate impacts add a screen
vignette flash and a 0.35 s camera shake. Sizes and counts roughly ×3 versus Phase 2;
bloom threshold 0.7, strength 1.0. Every recipe is data in `src/fx/recipes/<heroKey>.js`.

**Hit stop is view-only.** On an ultimate hit the rig animator and particle clock run
at 0.25× for 80 ms; the sim clock never changes (Phase 4 needs the sim deterministic).

---

## 6. Mobile — touch, layout, performance

- **Touch controls** (`src/core/touch.js`, feeds the same `Input` fields): left-half
  virtual joystick for movement (appears where the thumb lands); right-half drag to
  orbit the camera; a radial cluster of buttons bottom-right: attack (hold to auto-
  attack the nearest enemy), Q, W, E, R, recall, shop, potion. Abilities on touch use
  **assisted aim**: the reticle direction is replaced by the direction to the nearest
  enemy hero within the ability's range, else the camera forward. A tap-and-drag on an
  ability button lets the player aim manually with a ground indicator; release casts.
- **No pointer lock on touch.** The start gate is a tap; the game simulates whenever
  the match is live and the page is visible.
- **Layout.** `<meta viewport>` with `viewport-fit=cover`, `touch-action: none` on the
  canvas, HUD scaled with `clamp()` units, safe-area insets, landscape enforced with a
  rotate prompt in portrait, iOS 100vh fix (`height: 100dvh`).
- **Performance tier.** Detect touch and screen size; default `lowfx` on phones; expose
  a quality toggle in the pause menu. Budget: 60 fps on a 2021 phone, 30 fps minimum on
  a 2019 phone.
- **Testing.** The probe adds a touch block: synthesises touch events on the joystick
  and buttons and asserts the intent fields respond; a 390×844 viewport block asserts
  the HUD and hero select fit without horizontal scroll.

---

## 7. Polish list

- **Sound** (`src/audio/`, WebAudio, all synthesised): per-ability cast and impact
  sounds from oscillators and noise with envelopes; footsteps by surface; hit thud;
  last-hit chime; tower shot; level-up; kill sting; low-HP heartbeat; a night ambience
  bed (crickets, wind, water near the river); a short looping music motif (pentatonic,
  two instruments) at low volume. Unlock on first tap. Mute and volume in the pause menu.
- **Menus.** Title screen with the moon and drifting fireflies; hero select cards with
  drawn portraits (canvas: silhouette, mask, colour band, origin glyph), hover/tap
  shows the kit; a pause menu (Esc / button): resume, quality, sound, quit.
- **Result screen.** Winner, duration, kills / deaths, last-hits, gold, damage dealt,
  towers, a "play again" and "change hero" button.
- **HUD.** Enemy HP bar above their head (screen-projected, pooled), minimap strip at
  the top showing both heroes, minions and structures along the lane, kill feed,
  ability tooltips on hover/long-press, cooldown sweeps, low-HP vignette.
- **Game feel.** Hit flash on victims, knockback on autos (2 cm), death ragdoll
  approximation (rig collapses with a bounce), tower shots as fat glowing bolts with a
  telegraph glow on the tower crystal, recall channel spiral, respawn flash, level-up
  pillar.

---

## 8. Sim/view split (start here; Phase 4 finishes it)

Phase 4 needs the simulation to run in Node. The cheapest time to move files is now,
before the rigs and clips attach to them. Phase 3 Task 1 does the mechanical part:

- `src/core/unit.js` drops `three`: `pos` becomes a plain `{ x, y, z }` (a tiny
  `src/sim/vec.js` gives `set/copy/len/dist` helpers); `mesh` and `syncMesh` leave the
  class. The sim emits `unitAdded` / `unitRemoved`; `src/view/unitViews.js` listens and
  owns the mesh per unit (a `Map` filled once per unit, not per frame).
- `src/hero/effects.js` splits into `src/sim/projectiles.js` (motion and hits) and
  `src/view/projectileViews.js` (meshes and trails).
- `src/hero/heroController.js` keeps `three` (it reads the camera); it lives in `view`.
- Folders: `src/sim/` (core, hero, units, economy, ai, game), `src/view/` (camera,
  map, hud, fx, main). `docs/ARCHITECTURE.md` is rewritten to match. Every import path
  changes; the probe's `window.__game` surface does not.
- A new probe block imports the sim in **Node** (`node --input-type=module -e
  "import('./src/sim/game/match.js')"` style) and runs 20 s of a match headlessly with
  no DOM and no `three`. If that runs, Phase 4 can start.

---

## 9. Verification

`npm run check` clean; `npm run probe` exit 0, no code errors, the 181 existing
assertions plus the new ones named in the prompt. The probe cannot judge whether
animation reads as combat, whether the map is beautiful, or phone frame rate — those
are the playtest, with the pose tool and `?stats=1` as the human's instruments.
