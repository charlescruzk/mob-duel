# PHASE2.md — roster of six, build diversity, and a modern look

The slice proved the loop. Phase 2 grows it along the axes the playtest asked for:
**more heroes with real archetypes, items that make builds differ, and a look that
reads as modern.** Nothing here changes the engine rules in `CLAUDE.md`: no build step,
no assets, primitives and canvas textures only, Three.js addons via the importmap.

This file is the spec. `docs/PHASE2_PROMPT.md` is the task list a coding model executes
against it. Numbers here win over the prompt when they disagree.

---

## 1. What other platforms do (research summary)

Three systems are worth stealing from. No real names are used anywhere in the game.

**Attribute triad (Dota-style).** Every hero has a primary attribute among Strength,
Agility, Intelligence. Each point of any attribute gives a small stat: Strength → max HP
and HP regen; Agility → armor and attack speed; Intelligence → max mana, mana regen and
spell power. Only the *primary* attribute also gives attack damage. The result: the same
item is worth different things to different heroes, which is the cheapest source of
build diversity there is.

**Role and subclass taxonomy (League-style, confirmed against Smite).** Six roles cover
every kit ever shipped:

| Role | Subclasses | Signature |
|---|---|---|
| Fighter | Juggernaut (slow, unkillable, high damage), Diver (gap-closes, targets backline) | melee, sustains, mid range |
| Tank | Vanguard (initiates, locks down), Warden (peels, protects) | high HP/armor, hard CC, low damage |
| Mage | Burst (one combo), Battlemage (sustained, close), Artillery (long poke) | ranged, mana-hungry, ability damage |
| Marksman | — | ranged autos, attack speed, item-scaling, fragile |
| Slayer | Assassin (burst + escape, stealth/blink), Skirmisher (extended duels) | melee, mobility, executes |
| Controller | Enchanter (heal/shield/speed allies), Catcher (roots/pulls/zones) | utility, low personal damage |

**Ability shapes.** Every ability in the genre is one of: point-click **targeted**;
**line skillshot** (stops at first hit or pierces); **ground circle** (telegraphed);
**self circle**; **cone**; **dash / hop / blink** (with or without damage); **buff**
(steroid: attack speed, armor, speed); **shield / heal**; **channel** (interruptible);
**zone** (persistent area that ticks); **sniper** (very long, thin, wound-up line);
**stealth**. Crowd control types: **stun** (nothing), **root** (no movement, can act),
**slow**, **knockback / pull** (displacement), **knockup** (a stun with a visual),
**silence** (no casts; not used here), **taunt** (not used here).

**Items.** Every platform ships **consumables** (health potion, mana potion, usually a
ward), **tiered stat items** (cheap components, mid-game pieces, expensive finals), and
**unique passives** on finals (on-hit burn, cleave, spell shield, execute, second wind).
Passives are what make two builds *play* differently rather than merely add differently.

---

## 2. Attribute system (mapped onto the existing stat tables)

The tuned `hp / mp / regen / attackDamage / armor` `{ base, step }` tables in
`heroData.js` **stay exactly as they are** — they already encode each hero's attribute
growth and §10's time-to-kill targets depend on them. The attribute system governs
**items only**.

| Attribute | Per point |
|---|---|
| Strength `str` | +16 max HP, +0.08 HP regen/s |
| Agility `agi` | +0.004 armor (0.4 %), +1 % attack speed |
| Intelligence `int` | +12 max MP, +0.06 MP regen/s, +0.5 % ability amp |
| **Primary** attribute only | +1.0 attack damage per point |

Each hero declares `primary: 'str' | 'agi' | 'int'`. `applyItems()` sums item attributes,
converts them with the table above, and adds attack damage only for the primary one.

New derived stats every hero carries (all default 0): `attackSpeedPct` (attack interval
÷ (1 + pct), capped at +150 %), `lifesteal` (fraction of auto damage healed),
`armor` bonus from items (added to the level armor, total capped at 0.75), and
`passives` — an array of item passive keys resolved once on purchase.

---

## 3. Roster (six heroes; two exist)

| Key | Name | Primary | Role · subclass | Range |
|---|---|---|---|---|
| `brakk` | Brakk the Ironhide | STR | Fighter · Juggernaut | melee 2.0 |
| `halvard` | Halvard the Wall | STR | Tank · Vanguard | melee 2.0 |
| `vaskra` | Vaskra the Longshot | AGI | Marksman (artillery flavour) | ranged 8.0 |
| `kesh` | Kesh the Hollow | AGI | Slayer · Assassin | melee 1.8 |
| `ilyra` | Ilyra the Cinderweaver | INT | Mage · Burst | ranged 7.0 |
| `lumen` | Lumen the Tidecaller | INT | Controller · Catcher (self-sustain) | ranged 6.5 |

W stays on **KeyF** (KeyW is move-forward). R unlocks at level 4. Costs, cooldowns and
`{ base, step }` scaling follow the existing schema. Abilities are `'magic'` unless a
line says physical. `windup` casts resolve on the next frame exactly like today.

### 3.1 Vaskra the Longshot — AGI marksman, ranged 8.0
`hp 480/60 · mp 260/25 · hpRegen 1.0/0.1 · mpRegen 1.2/0.12 · moveSpeed 5.1 ·
attackDamage 55/5 · attackInterval 0.85 · windup 0.2 · projectileSpeed 26 · armor 0.08/0.01`

- **Passive — Headhunter.** Every third consecutive basic attack on the same target
  deals bonus **true** damage `15 + 5/level`. The counter resets on target change.
- **Q — Piercing Shot.** 40 mp, 7 s. Line skillshot, 14 m, r 0.5, speed 28, **pierces**.
  `65 + 18/level`, physical.
- **W — Quickdraw.** 45 mp, 12 s. Buff 4 s: +60 % attack speed; autos apply a 15 % slow
  for 1 s.
- **E — Tumble.** 35 mp, 9 s. Hop 3.5 m toward the reticle (a `dash` with no damage,
  speed 16). The next basic attack within 3 s deals bonus `30 + 8/level`.
- **R — Deadeye.** 100 mp, 70 s. **Sniper**: 1.0 s wind-up (interrupted by stun), then a
  line skillshot 30 m, r 0.6, speed 45, first hero hit. `150 + 40/level`, multiplied by
  `1 + missingHpFraction` of the target (a 50 % HP target takes ×1.5, capped ×2).

### 3.2 Kesh the Hollow — AGI assassin, melee 1.8
`hp 540/70 · mp 240/22 · hpRegen 1.4/0.15 · mpRegen 1.0/0.1 · moveSpeed 5.5 ·
attackDamage 60/6 · attackInterval 0.9 · windup 0.2 · projectileSpeed 0 · armor 0.10/0.01`

- **Passive — Opportunist.** +20 % damage (autos and abilities) against slowed, rooted or
  stunned targets.
- **Q — Shadow Step.** 45 mp, 10 s. **Targeted blink**: the enemy unit nearest the
  reticle point within 7 m; Kesh appears 1.2 m behind it, facing it, and deals
  `55 + 15/level`.
- **W — Veil.** 50 mp, 18 s. **Stealth** 3 s: the bot cannot see or target Kesh
  (`botSense` skips stealthed heroes; tower and minions keep their current target but
  acquire no new one); +25 % move speed. Ends early on any attack or cast. The first
  basic attack after Veil deals bonus `40 + 10/level`.
- **E — Fan of Blades.** 40 mp, 7 s. **Cone** 60°, 4.5 m, `60 + 16/level`, 20 % slow 1 s.
- **R — Verdict.** 90 mp, 60 s. Targeted, 5 m. `120 + 30/level`, **doubled** if the
  target is below 30 % HP. Killing a hero with it refunds 50 % of the cooldown.

### 3.3 Halvard the Wall — STR tank, melee 2.0
`hp 700/95 · mp 230/22 · hpRegen 2.2/0.25 · mpRegen 0.9/0.1 · moveSpeed 5.0 ·
attackDamage 55/5 · attackInterval 1.1 · windup 0.3 · projectileSpeed 0 · armor 0.20/0.012`

- **Passive — Unyielding.** Below 30 % HP, +15 % armor (additive, before the cap).
- **Q — Shield Bash.** 40 mp, 8 s. Targeted, 2.5 m. `50 + 14/level`, **stun 1.0 s**.
- **W — Stonewall.** 50 mp, 16 s. Buff 4 s: +0.20 armor; **reflects** 15 % of
  pre-mitigation damage taken back to the attacker as magic.
- **E — Charge.** 55 mp, 12 s. Dash 8 m, speed 18, r 1.2. The first enemy hero hit is
  **knocked back** 2.5 m along the dash direction and stunned 0.4 s; `40 + 10/level`.
- **R — Earthbreaker.** 100 mp, 65 s. 0.5 s wind-up, then circle r 5: `120 + 30/level`,
  **knockup** (a 1.2 s stun with a hop visual), then a **zone** r 5 for 3 s that slows 40 %.

### 3.4 Lumen the Tidecaller — INT controller, ranged 6.5
`hp 470/60 · mp 420/45 · hpRegen 1.2/0.12 · mpRegen 2.0/0.22 · moveSpeed 5.0 ·
attackDamage 44/4 · attackInterval 0.95 · windup 0.25 · projectileSpeed 20 · armor 0.08/0.01`

- **Passive — Riptide.** Landing any ability grants +15 % move speed for 1.5 s.
- **Q — Tidal Snare.** 50 mp, 9 s. Line skillshot 10 m, r 0.6, speed 20, first hit.
  `55 + 14/level`, **root 1.5 s**.
- **W — Mend.** 60 mp, 11 s. **Heal** self `80 + 28/level` instantly, then `20 + 5/level`
  per second for 3 s.
- **E — Undertow.** 65 mp, 12 s. Ground circle at the reticle (7 m), r 3, 0.4 s telegraph:
  enemies are **pulled** 2 m toward the centre, `50 + 15/level`, 40 % slow 1.5 s.
- **R — Deluge.** 120 mp, 70 s. **Zone** at the reticle (6 m), r 5, 3.5 s: Lumen inside
  heals 3 % max HP per second; enemies inside are slowed 50 % and take `40 + 12/level`
  every 0.5 s.

### 3.5 New ability shapes and status kinds
Shapes to add (existing: `selfAoe shield dash windup skillshot groundAoe blink`):
`targeted`, `targetedBlink`, `cone`, `buff`, `heal`, `stealth`, `zone`, plus options on
existing shapes: `dash.noDamage`, `dash.knockback`, `groundAoe.pull`, `skillshot.execScale`.
Status kinds to add (existing: `stun slow haste shield`): `root`, `stealth`,
`attackSpeed`, `armorBuff`, `reflect`, `bonusNextAuto`. **Minions gain `applyStatus`**
for `stun`, `slow`, `root` so CC works on the wave.

---

## 4. Items (25: 2 consumables, 7 tier 1, 8 tier 2, 8 tier 3)

Flat purchase, no combining. Six slots. Buying and selling stay fountain-only.
Consumables **stack to 5 in one slot** and are used with **Digit1–6** (the slot) from
anywhere; a rising edge on `intent.useItem` (−1 = none, 0..5 = slot). Digit keys no
longer buy; buying is by click in the shop panel (the bot keeps using `intent.buy`).

| Tier | Key | Name | Cost | Stats | Passive |
|---|---|---|---|---|---|
| C | `hpotion` | Health Potion | 50 | heals 150 over 10 s | consumable, stack 5 |
| C | `mpotion` | Mana Potion | 50 | restores 120 MP over 8 s | consumable, stack 5 |
| 1 | `swiftsoles` | Swiftsoles | 250 | +0.6 move speed | unique |
| 1 | `ironring` | Iron Ring | 400 | +12 attack damage | |
| 1 | `oxbelt` | Ox Belt | 400 | +12 STR | |
| 1 | `featherband` | Feather Band | 400 | +12 AGI | |
| 1 | `sapphirebead` | Sapphire Bead | 400 | +12 INT | |
| 1 | `sparkshard` | Spark Shard | 400 | +15 % ability amp | |
| 1 | `hidevest` | Hide Vest | 400 | +0.08 armor | |
| 2 | `whetstone` | Whetstone Edge | 750 | +22 AD, +10 % amp | |
| 2 | `heartwood` | Heartwood Charm | 800 | +220 HP, +1.5 HP regen | |
| 2 | `aether` | Aether Circlet | 700 | +200 MP, +2.0 MP regen, 12 % CDR | |
| 2 | `vampfang` | Vampire Fang | 850 | +18 AD, 12 % lifesteal | |
| 2 | `brandiron` | Brand Iron | 800 | +15 AD | **Burn**: autos deal `15 + 2/level` magic over 2 s |
| 2 | `wardenplate` | Warden Plate | 850 | +180 HP, +0.10 armor | |
| 2 | `stormglass` | Stormglass | 850 | +25 % amp, 8 % CDR | |
| 2 | `fleetgreaves` | Fleetfoot Greaves | 900 | +0.9 move speed | unique; replaces Swiftsoles |
| 3 | `titangrip` | Titan's Grip | 1800 | +40 AD, +150 HP | **Cleave**: melee autos deal 30 % to enemies within 2 m of the target |
| 3 | `voidlens` | Voidlens Staff | 1900 | +45 % amp | **Rend**: ability hits deal +4 % target max HP magic |
| 3 | `colossus` | Colossus Heart | 1700 | +450 HP, +3 HP regen | **Second Wind**: below 30 % HP heal 15 % max over 4 s, 60 s CD |
| 3 | `bladedancer` | Bladedancer | 1800 | +30 % attack speed, +20 AD | **Tempo**: every third auto +40 magic |
| 3 | `nullveil` | Nullveil | 1600 | +0.20 armor, +200 MP | **Spell Shield**: blocks one enemy ability hit every 40 s |
| 3 | `chronoband` | Chronoband | 1600 | 20 % CDR, +200 MP, +15 % amp | **Flow**: each ability hit refunds 5 MP |
| 3 | `headsman` | Headsman's Edge | 1900 | +35 AD | **Execute**: autos vs heroes below 40 % HP deal +15 % |
| 3 | `riverstone` | Riverstone | 1700 | +250 HP, +0.10 armor | **Undertow**: after a cast, the next auto slows 30 % for 1 s |

Every item object carries the **full** stat set (zeros where unused) so hot loops never
branch on missing fields: `moveSpeed attackDamage abilityAmp maxHp hpRegen maxMp mpRegen
cdr str agi int attackSpeedPct lifesteal armor passive consumable stack tier`.

Shop panel: four tabs (Consumables · Tier 1 · Tier 2 · Tier 3), built once, updated in
place; an inventory row of six slots showing stack counts; click an owned slot to sell.

---

## 5. Look: lighting, cel shading, particles, procedural animation

**Decision on "2D shaded as 3D".** Billboarded sprites break under a free third-person
camera (no facing, wrong at low pitch, no shadows). The look the request describes is
**cel shading**: flat colour bands with dark outlines on true 3D geometry. Three.js does
this natively (`MeshToonMaterial` + a 4-step gradient map + inverted-hull outlines), it
keeps every existing mesh, and it is what modern stylised titles ship. That is the route.

**Lighting.** Shadow maps on (PCF soft, 2048², the sun's orthographic frustum follows the
player, ±40 m); ACES filmic tone mapping, exposure 1.05; a procedural sky-gradient
background texture; ground as `MeshStandardMaterial` (roughness 0.9); a cool fill light
opposite the sun; fog retuned to the sky colour. Bloom via the addon
`EffectComposer + RenderPass + UnrealBloomPass + OutputPass` (threshold 0.9, strength 0.6,
radius 0.4) so only emissive things glow: projectiles, orbs, particles, fountain.
`?lowfx=1` disables shadows and the composer (the probe passes it for speed).

**Particles.** One `THREE.Points` with pre-allocated buffers for 3000 particles and a
`ShaderMaterial` (additive, soft-circle, size attenuation, alpha from remaining life).
CPU simulation in flat `Float32Array`s (velocity, life, gravity, drag). Round-robin
allocation overwrites the oldest. Emitters: `burst`, `ring`, `trail`, `column`. An
ability-FX table maps `(heroKey, slot)` → colour + emitter recipe and listens to
`abilityCast`, the new `abilityHit`, `unitDamaged`, `unitDied`, `heroLevelUp`,
`recallStarted`, `heroRespawned`. Projectiles emit trails while active. Plus feel
feedback: pooled floating damage numbers (32 divs, projected each frame), a 0.1 s
hit flash (emissive pulse or 8 % scale pop), and a camera kick on R impacts and own death.

**Procedural animation.** Each hero becomes a small rig of primitives: pelvis, torso,
head, two arm pivots at the shoulders, two leg pivots at the hips, a class weapon in the
right hand (sword, staff, bow, twin daggers, shield + mace, trident), and the existing
per-hero head accessories. A `RigAnimator` reads unit state every frame (velocity,
attack wind-up, casting, stunned, dead) and blends joint angles toward a target pose at
12 rad/s: idle breathing, distance-driven walk cycle (phase = distance / stride,
opposite arm swing, 4 cm bob), attack swing from a raised pose over the wind-up, cast
pose with the off-hand up, hit recoil, death (fall over 0.5 s, sink after 1 s), squash
and stretch on dash landing. Minions get a three-part rig with the same walk cycle.
No allocation per frame: joints live in fixed arrays on the rig.

---

## 6. Hero select and bot generalisation

A `#hero-select` overlay with six cards (portrait drawn on a canvas, name, title,
attribute badge, role, four ability names with descriptions). Picking a hero shows the
existing start overlay. `?hero=` still pre-selects; `?enemy=` picks the bot's hero
(default: a seeded random choice among the other five).

`botSense.BOT_KIT` grows to six entries with one generic schema per slot:
`{ cost, range, base, step, minLevel, kind }` where kind is
`'damage' | 'cc' | 'buff' | 'escape' | 'heal' | 'stealth'`. Rules in `botActions`:
`buff` before engaging; `cc` when the player is inside its range; `damage` when in range
and it does ≥ 10 % of the player's HP; `escape` in RETREAT aimed toward home; `heal`
below 50 %; `stealth` when retreating. Item priority per hero (indices into `ITEMS`):
STR heroes ox belt → warden plate → titan/colossus; AGI heroes feather band → vampire
fang → bladedancer; INT heroes sapphire bead → stormglass → voidlens; everyone starts
with swiftsoles and two health potions.

---

## 7. Verification

Every task adds probe assertions (named in the prompt). Targets after phase 2:
`npm run check` clean; `npm run probe` exit 0, `(no code errors)`, the original 63 still
true plus the new ones. The probe cannot see feel, frame rate, or whether the cel look
reads well — those go to a playtest, and dials stay in `heroData.js` / `items.js`.
