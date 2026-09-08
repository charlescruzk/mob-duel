# DESIGN.md — moba-duel, 1v1 duel-lane vertical slice

Every number in this document is the number. Builders implement it as written; if a
number is missing, that is a bug in this document — say so in `docs/PROGRESS.md`, pick
the nearest sensible value, and mark it `(assumed)` in code.

The slice exists to prove one loop feels right:

> last-hit under pressure → trade damage → get zoned by the tower → land a combo →
> recall, buy, come back stronger

Target match length: **8–12 minutes**. One human vs one bot on one lane.

Conventions used below:
- 1 unit = 1 m. Y up. Blue base at **+Z**, Red base at **−Z**. Blue "forward" is −Z.
- `L` = hero level (1–6). Scaling values are written `base + step × (L − 1)`.
- All percentages are flat multipliers. Armor: `damageTaken = raw × (1 − armor)`.
- Times in seconds, speeds in m/s, cooldowns start when the cast resolves.

---

## 1. Camera and control (Smite-style third person)

- Pointer lock on click. Mouse X turns camera **yaw** (0.0022 rad/px), mouse Y sets
  **pitch** (default −25°, clamped to [−60°, −8°]).
- Camera pivot is the hero at eye height (0, 1.6, 0) local; camera sits **7.0 m** behind
  along the yaw/pitch, pulled in (not through walls — there are no overhead walls; ignore).
- **WASD** is relative to camera yaw: W = camera forward projected onto XZ. The input
  controller converts to a **world-space** unit vector and writes `intent.moveX/moveZ`.
- Hero faces its movement direction; while attacking or casting it faces the reticle.
- **Ground reticle**: ray from camera through screen centre intersected with plane y=0,
  then clamped to **≤ 12.0 m** from the hero. Written as world `intent.aimX/aimZ`.
  Skillshots fire along `normalize(reticle − hero)`; ground-target abilities land at the
  reticle clamped to the ability's cast range; dashes/blinks travel toward the reticle.
- Keys: LMB or Space = `attack`; Q W E R; B = `recall`; Tab = scoreboard (HUD only);
  digits 1–4 = buy item slot (only inside fountain).
- All of the above is the ONLY place input devices are read. See `docs/NETCODE.md`:
  the simulation consumes a plain `HeroIntent` and nothing else.

---

## 2. Lane geometry (exact coordinates)

The lane runs along Z. Mirror symmetry across z = 0 (NOT point symmetry): both towers
sit at x = +3.0, both minion lines at x = −1.5. This is deliberate — identical geometry
for both teams keeps the bot's positional numbers the same as the player's.

| Thing | Blue (+Z) | Red (−Z) | Notes |
|---|---|---|---|
| Ground plane | x ∈ [−24, 24], z ∈ [−50, 50] | same | visual only |
| Walkable lane | x ∈ [−7, 7], z ∈ [−45, 45] | same | hard clamp on unit centres, minus unit radius |
| Nexus centre | (0, 0, **42**) | (0, 0, **−42**) | solid circle r = 2.5, height 4 |
| Tower centre | (3.0, 0, **16**) | (3.0, 0, **−16**) | solid circle r = 1.2, height 6; 26 m in front of nexus |
| Minion spawn | (−1.5, 0, **38.5**) | (−1.5, 0, **−38.5**) | outside the nexus circle |
| Hero spawn | (0, 0, **37**) | (0, 0, **−37**) | facing the lane |
| Fountain zone | dist to own nexus ≤ **8.0** | same | shop + fast regen; tinted disc r = 8 |
| Lane mid | z = 0 | | 32 m between towers |

Jungle-wall blocks (visual hint that the map is wider; collision is the x = ±7 clamp):
each side has **7 blocks**, each 10 m (x) × 3 m (y) × 11 m (z), placed with x from
|7.5| to |17.5| and z centres at −39, −26, −13, 0, 13, 26, 39 (2 m gaps between blocks).
A back wall block 48 × 3 × 4 m sits centred at z = ±47. Behind the nexus is not walkable.

Static collision (XZ circles, push-out): nexus r 2.5, tower r 1.2. Units: hero r 0.4
(capsule h 1.8), minion r 0.35 (h 1.2). All units are solid to each other (circle
push-out, split 50/50 between two units; 100% on the unit when against a static).
Minions walking through their own wave slide past because their slots differ in x.

---

## 3. Heroes

Two original heroes. The player picks one; the bot plays the other.

### 3.1 Base stats and per-level growth

| Stat | **Brakk, the Ironhide** (melee bruiser) | **Ilyra, the Cinderweaver** (ranged mage) |
|---|---|---|
| HP | 620 + 85 × (L−1) → 1045 at L6 | 500 + 65 × (L−1) → 825 at L6 |
| MP | 250 + 25 × (L−1) → 375 at L6 | 380 + 40 × (L−1) → 580 at L6 |
| HP regen /s | 1.8 + 0.2 × (L−1) | 1.0 + 0.1 × (L−1) |
| MP regen /s | 1.0 + 0.1 × (L−1) | 1.8 + 0.2 × (L−1) |
| Move speed | 5.2 | 5.0 |
| Attack range | 2.0 (melee, instant on wind-up end) | 7.0 (homing projectile 20 m/s, cannot miss) |
| Attack damage (AD) | 62 + 6 × (L−1) → 92 at L6 | 48 + 4 × (L−1) → 68 at L6 |
| Attack interval | 1.0 | 0.9 |
| Attack wind-up | 0.25 (damage applies at end; interval includes it) | 0.25 |
| Armor | 15% + 1% × (L−1) → 20% at L6 | 8% + 1% × (L−1) → 13% at L6 |

Basic-attack targeting: among enemy units (minion, hero, tower, nexus) within attack
range of the hero, pick the one whose centre is **nearest the reticle**. None in range
→ no attack, no wind-up. Holding `attack` re-evaluates the target at each wind-up start.
Only basic attacks damage towers and nexuses; abilities never do.
Range checks against a tower or nexus use `dist(centres) − targetRadius`; against heroes
and minions they use centre distance (their radii are small enough to ignore).

### 3.2 Levels and XP

All four active abilities are unlocked at L1; **R unlocks at L4**. No skill points —
abilities scale with `L`. Level-up does not heal.

Cumulative XP thresholds: L2 **120**, L3 **300**, L4 **540**, L5 **840**, L6 **1200**.
No level 7.

XP sources (granted to every enemy hero within **12.0 m** of the dying unit; no last-hit
required): melee minion **30**, ranged minion **25** (140 per full wave), tower **200**
(to the killer's team hero, any distance), hero kill **120 + 30 × victimLevel** (to the
killer). No passive XP. Full soak → L4 at ~2:40 (wave 4), L6 at ~5:15 (wave 9).

### 3.3 Brakk, the Ironhide — gap-closes and sustains

| Slot | Name | Cost | CD | Range | Shape | Effect |
|---|---|---|---|---|---|---|
| Passive | **Ironhide** | — | — | — | on-hit | Each basic attack that lands heals Brakk **6 + 2 × (L−1)**; **×3 vs heroes**. |
| Q | **Cleave** | 40 MP | 6.0 | self | AoE circle r **3.0** centred on Brakk, instant | Damage **60 + 15 × (L−1)** (135 at L6). Hit enemies slowed **30% for 1.0 s**. |
| W | **Bulwark** | 50 MP | 14.0 | self | timer | Shield **90 + 25 × (L−1)** (215 at L6) for **3.0 s**. Shield absorbs damage before HP; remainder expires. Recasting refreshes, does not stack. |
| E | **Lunge** | 55 MP | 11.0 | 6.0 | dash line then AoE circle | Dash toward reticle, distance `clamp(dist(hero, reticle), 1.5, 6.0)`, speed **20 m/s** (≤ 0.3 s), collides with statics/walls (stops early), passes through units. On landing: circle r **1.5** damage **50 + 12 × (L−1)** (110 at L6), slow **40% for 1.0 s**. |
| R (L4) | **Sunder Slam** | 100 MP | 60.0 | self | wind-up then AoE circle | **0.4 s** wind-up (Brakk rooted, can be interrupted only by his own death). Then circle r **3.5**: damage **140 + 35 × (L−1)** (245 at L4, 315 at L6), **stun 0.8 s** (no move, attack, or cast; recall cancelled). |

Intended combo: E in → Q → auto → auto (passive heals) → R when the target is under
~35% or tries to leave → W to absorb the return fire.

### 3.4 Ilyra, the Cinderweaver — kites and pokes

| Slot | Name | Cost | CD | Range | Shape | Effect |
|---|---|---|---|---|---|---|
| Passive | **Cinder Mark** | — | — | — | timer | Any Ilyra ability that damages a unit marks it for **4.0 s**. Her next basic attack on a marked unit deals bonus **20 + 8 × (L−1)** (60 at L6) and consumes the mark. |
| Q | **Ember Bolt** | 45 MP | 5.0 | 11.0 | skillshot line | Projectile r **0.5**, speed **18 m/s**, max travel 11 m, **stops at the first enemy unit hit** (minions block it). Damage **70 + 20 × (L−1)** (170 at L6). |
| W | **Scorch Field** | 60 MP | 9.0 | 8.0 | ground AoE circle | Lands at reticle clamped to 8 m. Telegraph ring for **0.5 s**, then circle r **2.5**: damage **60 + 18 × (L−1)** (150 at L6), slow **30% for 1.5 s**. |
| E | **Blink Step** | 50 MP | 14.0 | 4.5 | self blink | Instantly moves Ilyra **4.5 m** toward the reticle direction (clamped to the walkable lane and out of static circles; ignores units). Then **+30% move speed for 1.5 s**. |
| R (L4) | **Solar Lance** | 110 MP | 55.0 | 16.0 | piercing skillshot line | **0.35 s** cast (rooted). Projectile r **0.8**, speed **30 m/s**, travels the full 16 m, **hits every enemy unit** on the way. Damage **180 + 45 × (L−1)** (315 at L4, 405 at L6). |

Intended pattern: Q the hero when the minion line opens → auto to pop the mark → W on
their retreat path → E away from a Lunge → R to finish a target walking away in a line.

### 3.5 Cast rules (both heroes)

- A cast needs: ability unlocked, cooldown 0, MP ≥ cost, hero not dead/stunned/rooted by
  a cast in progress. Failing any → no cast, no cost.
- Instant abilities resolve the same tick. Wind-up/cast-time abilities resolve at the end;
  the hero is rooted meanwhile but the timer is not interrupted by damage.
- Slows multiply move speed; multiple slows do not stack — the strongest applies.
- Cooldown reduction from items: `cd × (1 − cdr)`, cdr capped at **30%**.
- Item ability amplification: every ability damage number × `(1 + abilityAmp)`.
- Death clears: shields, slows, stuns, marks, recall channel, dash/cast in progress.
  Cooldowns keep ticking while dead. Respawn: full HP and MP.

---

## 4. Minions

Wave = **3 melee + 2 ranged** per side. First wave at **t = 15 s**, then every **30 s**.
Wave index `w` starts at 0. Blue minions walk toward −Z, Red toward +Z.

| | Melee | Ranged |
|---|---|---|
| HP | **300 + 12 × w** | **220 + 9 × w** |
| Damage | **12 + 1 × w** | **18 + 1 × w** |
| Attack range | 1.5 | 6.0 |
| Attack interval | 1.0 | 1.2 (projectile 16 m/s, homing) |
| Move speed | 3.2 | 3.2 |
| Gold on last hit | **20** | **16** |
| XP on death | 30 | 25 |
| Armor | 0 | 0 |

Formation (offsets from the spawn point, along the walk direction `d`; lane line
x = −1.5): melee at x offsets −1.0, 0, +1.0 in the front row; ranged at x −0.5, +0.5 and
**2.0 m behind**. All five spawn the same tick in formation. Each minion keeps its own
x slot as its walk line and walks toward `(slotX, enemyNexusZ)`.

Movement: walk the slot line at 3.2 m/s until a target is within attack range, then
stop and attack (facing target). Lose the target → resume walking. Unit collision
push-out applies; minions never path around anything.

Aggro, re-evaluated every **0.5 s** (staggered per minion), acquire radius **7.0 m**,
drop the target when it is dead or more than **9.0 m** away:
1. Nearest enemy **minion** within 7.0 m.
2. Else the enemy **hero** if within 7.0 m.
3. Else the enemy **tower** (or nexus once the tower is dead) if within attack range +
   its radius.
4. Else no target: walk.

Damage instances: each attack is one instance with a source unit. **Gold on a minion
death goes ONLY to the hero whose damage instance killed it** (basic attack or ability).
XP goes to all enemy heroes within 12 m regardless of who killed it. Minion kills by
minions/towers give nobody gold. No gold is lost for missing a last hit.

A wave is "cleared" the usual way. Max minions alive per side is not capped; 8 waves
of stalemate is 40 units per side — the sim must handle 100 units without allocation.

---

## 5. Tower

| Stat | Value |
|---|---|
| HP | **1800**, no regen, armor 0 |
| Range | **10.0 m** from tower centre to unit centre |
| Attack interval | **1.2 s**, projectile 25 m/s homing, first shot 0.6 s after acquiring |
| Damage vs hero | **95 × ramp**; ramp starts 1.00 and is +0.25 per consecutive shot on the **same hero**, capped at **3.00** (shot 9). Ramp resets when the tower changes target or has not fired at that hero for 2.5 s. |
| Damage vs minion | **190** flat (no ramp). Melee minion dies in 2 shots, ranged in 2. |
| Gold on death | **150** to the killing team's hero |
| XP on death | 200 to the killing team's hero |
| Damageable by | basic attacks only (hero and minion). Abilities do nothing to it. |

Targeting, re-evaluated every 0.25 s but **sticky** — once locked on a hero, the tower
keeps that hero until it dies, leaves range, or the tower dies:
1. **Aggro hero**: an enemy hero that damaged an allied hero while both were inside the
   tower's range, within the last 3.0 s. (Damage to minions never triggers this.)
2. Enemy hero inside range when **no enemy minion is inside range**.
3. Nearest enemy minion inside range.
4. Otherwise idle (ramp resets).

Rule: **the nexus cannot take damage until its tower is dead** (damage to it is dropped
and the attack is refused as a target). Towers never respawn.

Level-1 hero under tower with ramp (armor applied): Ilyra takes 87, 109, 131, 153 →
survives **4 shots (4.8 s)**, dies on the 5th. Brakk takes 81, 101, 121, 141, 161 →
survives **5 shots (6.0 s)**, dies on the 6th. This is the "zoned by the tower" target.

---

## 6. Nexus

HP **2500**, no attack, no regen, armor 0. Solid circle r 2.5. Targetable by basic
attacks only, only after the same team's tower is dead. HP reaching 0 = **match over**;
the other team wins. Show the result, freeze the sim, offer restart (full match reset).

---

## 7. Economy, death, recall, fountain

**Gold**: start **400**. Passive trickle **1.5 gold/s** from t = 0 (90/min), paid to
both heroes always, including while dead. Last hits: melee 20, ranged 16 (92 per full
wave). Hero kill bounty **250** to the killer (kills by tower/minions pay nothing).
Tower **150**. Expected income for a competent laner: ~250–300 gold/min.

**Death**: respawn timer **8 + 3 × (L−1)** s (8, 11, 14, 17, 20, 23). Respawn at own
hero spawn with full HP/MP. No gold loss. The camera stays on the corpse position
(HUD shows the timer), then snaps to the respawn.

**Recall** (`intent.recall` rising edge): **6.0 s** channel, hero stands still. The
channel is **cancelled by any movement input, attack, or ability cast**, and by the
hero's death or a stun. Taking damage does **not** cancel it (deliberate: keeps the
rule simple and makes "recall under pressure" a real gamble — 6 s is longer than an
L6 time-to-kill). On completion: teleport to own hero spawn, HP/MP unchanged (fountain
regen does the rest). Recall has no cooldown and no mana cost. Pressing recall again
during the channel does nothing.

**Fountain**: while inside the fountain zone (≤ 8.0 m from own nexus) the hero regens
**+8% max HP/s and +8% max MP/s** on top of base regen (empty → full in ~12 s). The
shop is open only inside the zone. Enemy heroes inside your fountain zone take **150
true damage/s** (unblockable fountain laser, no ramp) — this only exists so the bot
cannot be baited into a stupid dive.

---

## 8. Items (shop; 6 inventory slots)

Buy only inside the fountain zone, only when gold ≥ cost and a slot is free (or the item
is a Swiftsoles-style unique already owned → refuse). Stats apply instantly and stack
additively across copies. No selling in the slice. Bot uses the same shop API.

| # | Name | Cost | Stats | Unique? |
|---|---|---|---|---|
| 1 | **Swiftsoles** | **250** | +0.6 move speed | yes (one pair) |
| 2 | **Whetstone Edge** | **750** | +22 attack damage, +10% ability amplification | no |
| 3 | **Heartwood Charm** | **800** | +220 max HP, +1.5 HP regen/s | no |
| 4 | **Aether Circlet** | **700** | +200 max MP, +2.0 MP regen/s, 12% cooldown reduction (cap 30% total) | no |

Buying an item that raises max HP/MP raises current HP/MP by the same amount.
Total cost of one of each: 2500 — reachable by minute 9 with decent farm.

---

## 9. Bot (enemy hero AI)

The bot writes a `HeroIntent` exactly like the player's input controller. It has no
access the player lacks: it reads sim state, not a special API. Difficulty knobs are
module-level constants:

| Knob | Value |
|---|---|
| Decision tick | every **0.2 s** (intent held between ticks) |
| Reaction delay | **0.3 s**: the bot reads the player's position, velocity, HP, and ability state from a ring buffer **0.3 s old**. Everything else (minion HP, own state) is read live. |
| Aim error, skillshots | direction rotated by uniform random in **[−7°, +7°]** |
| Aim error, ground AoE | landing point offset by a uniform random point in a disc of **r 0.8 m** |
| Aim lead | aims at `target.pos + target.vel × 0.25` (with the delayed data) |
| Last-hit timing | attacks a minion only when `minion.hp ≤ ownAD × 0.9` (ranged: also accounts for 0.35 s projectile flight using the minion's recent HP loss rate). The 0.9 factor makes it lose ~20% of contested last hits. |
| Safe wave | ≥ **2** allied minions alive within **8.0 m** of the bot |

Helper positions (own tower = tower on the bot's side; "behind" = toward own nexus):
- `farmPos`: melee bot = 1.0 m behind the frontmost allied minion's z, x = +1.0; ranged
  bot = 4.5 m behind it, x = +1.5. No allied minions alive → 6.0 m in front of own tower.
- `safePos`: 3.0 m behind own tower, x = +1.0.
- `pushPos`: attack range − 0.5 m from the enemy tower, on the side away from the player.

State machine, evaluated top to bottom every decision tick; the first true condition
wins (hysteresis is written into each condition):

1. **DEAD** — hero is dead. Intent all zero. Exit on respawn → FARM.
2. **RETREAT** — enter if any: HP < **35%** max; OR bot is inside the enemy tower's
   range and (the tower is targeting the bot OR no allied minion is inside that range);
   OR no safe wave and the player is within 8.0 m with `player.hp% − bot.hp% > 20`.
   Action: move toward `safePos`; if the player is within 4.0 m and E is ready, cast E
   toward `safePos`; Brakk casts W if HP < 50%. Attack nothing. Exit when HP ≥ **45%**
   and outside enemy tower range and (the player is ≥ 10 m away or a safe wave exists).
3. **RECALL** — enter if (HP < **45%** OR MP < **20%**) AND no enemy hero within
   **20.0 m** AND no enemy minion within 12.0 m AND not already in the fountain.
   Action: stand still, `recall = true` until the channel completes. If the player comes
   within 20 m, drop to RETREAT (which walks; walking cancels the channel — correct).
   On arrival in fountain: **SHOP** (buy the first affordable item from the priority
   list each tick: Brakk = Swiftsoles, Whetstone Edge, Heartwood Charm, Whetstone Edge,
   Heartwood Charm; Ilyra = Swiftsoles, Aether Circlet, Whetstone Edge, Heartwood Charm,
   Whetstone Edge), then wait until HP ≥ 95% and MP ≥ 80%, then FARM (walking out).
   Also SHOP whenever the bot happens to be in the fountain (respawn) with gold ≥ 250.
4. **PUSH** — enter if (player is dead OR player is ≥ **25.0 m** away) AND a safe wave
   exists. Action: move toward `pushPos`; attack minions freely (no last-hit wait); once
   no enemy minion is within 10 m of the enemy tower, attack the tower while ≥ 1 allied
   minion is inside its range; Ilyra uses W on groups of ≥ 2 minions. Exit when the
   player is within **20.0 m** and alive, or no allied minion is left inside the enemy
   tower's range (then step out of tower range → FARM).
5. **TRADE** — enter if the player is within the bot's longest ready ability's range,
   AND MP ≥ **40%** max, AND safe wave, AND `bot.hp% ≥ player.hp% − 10`, AND the bot is
   outside enemy tower range, AND the player is not inside their own tower's range.
   Action, each tick (using delayed/aimed data):
   - Ilyra: Q when a straight line to the player is not blocked by an enemy minion
     (sample the line every 0.5 m against minion circles); W at the player's lead
     position; auto-attack the player while a mark is on them or Q is on cooldown; if
     the player closes to < 4.5 m, move away from them (toward `safePos`) while
     attacking; E away if the player is < 3.0 m and Brakk's E just resolved; R when
     `player.hp ≤ R damage + Q damage` or when Q and W are both on cooldown and
     `player.hp% < 50`.
   - Brakk: E onto the player when within 6.0 m and HP > **55%**; Q when the player is
     within 3.0 m; auto-attack the player; W when the player's ability lands on Brakk or
     HP < 60%; R when the player is within 3.5 m and `player.hp ≤ R damage + 2 × AD`,
     or when the player is within 3.5 m and is casting/channelling (recall interrupt).
   Exit after **2.5 s** in state, or when the player is > ability range + 2 m, or any
   RETREAT condition → FARM (TRADE re-enters immediately if still valid, which is fine:
   the 2.5 s cap just forces a re-check of mana and wave safety).
6. **FARM** (default) — move toward `farmPos` (stop within 0.5 m). Every tick: pick the
   enemy minion within attack range (+1.0 m, walking in) with the lowest HP satisfying
   the last-hit rule; if found, aim at it and `attack = true`; otherwise `attack = false`
   (the bot does not push the wave while the player is alive and within 25 m). Brakk
   uses Q when ≥ 2 enemy minions within 3.0 m each have `hp ≤ Q damage`; Ilyra uses W
   when ≥ 3 enemy minions inside a 2.5 m circle each have `hp ≤ W damage`. Ranged bot
   kites: if the player (delayed) is within 4.5 m, move away from them while attacking.
   Bot never walks inside the enemy tower's range in FARM.

Restrictions that keep it beatable and honest: the bot never casts on the same tick it
enters a state (the 0.3 s delay covers that); it never reads the player's *current*
frame; its skillshots miss a strafing player about a third of the time at 9+ m; it
retreats on the same thresholds every time, so a player can learn to bait it.

---

## 10. Feel targets (what the probe and the playtest check)

| Target | Number |
|---|---|
| Time-to-kill a full-HP standing enemy hero at **L1**, full combo + autos, no items | Brakk on Ilyra: E 50 + Q 60 + 7 autos ≈ **8 s**. Ilyra on Brakk: Q, W, marked autos ≈ **10 s**. Nobody dies at L1 without tower or minion help — by design. |
| Time-to-kill at **L6**, full combo + autos, no items | Brakk on Ilyra (825 HP, 13% armor): E 110 + Q 135 + R 315 + 5 autos @ 92 ≈ **5.5 s**. Ilyra on Brakk (1045 HP, 20% armor): Q 170 + W 150 + R 405 + 2 marked autos + 4 autos ≈ **6 s**. With one Whetstone Edge: **~4.5 s** either way. |
| Combo-only kill threshold at L6 | Brakk's E+Q+R = 560 raw → 487 after armor: kills Ilyra below ~59% HP. Ilyra's Q+W+R = 725 raw → 580 after armor: kills Brakk below ~55% (one marked auto on top: ~65%). "Land a combo" means the fight is decided from about half HP. |
| Tower shots survived at L1 | Ilyra **4** (4.8 s), Brakk **5** (6.0 s). At L6 with a Heartwood Charm: Brakk ~9. |
| Last-hit window | A melee minion is killable once `hp ≤ AD` (62 at L1). Under a full enemy wave it loses ~70 HP/s → window **≈ 0.9 s**; under ranged minions only (~30 HP/s) → **≈ 2.0 s**. The tower two-shots minions: under tower the window is one 1.2 s beat. |
| Recall round trip | 6 s channel + ~10 s fountain + 32 m walk at 5.2 m/s ≈ **22 s** — you miss about one wave. |
| First tower falls | minutes **6–8** in a normal game; a wave alone strips ~300 HP per crash. |
| Nexus falls | minutes **9–11**. Brakk L6 solo on a nexus: 2500 / 92 dps ≈ 27 s. |
| Wave value | 92 gold + 140 XP; ~6 waves to first item of 750. |

Anything not covered here is the builder's call, recorded in `docs/PROGRESS.md`.
