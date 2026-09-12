// Bot shopping and self-sustain (PHASE2.md §6): the per-hero item priority lists,
// the stack-aware next-buy pick, and the potion/heal sustain helpers. Split from
// botActions.js to keep each file on one concern; same bot-shaped call signature.
import { ITEMS, INVENTORY_SLOTS } from '../economy/items.js';
import { abilityReady, REACTION_DELAY } from './botSense.js';

// Item priority per hero (indices into ITEMS): everyone opens with swiftsoles and
// two health potions, then attribute → mid → capstone by primary. STR: ox belt →
// warden plate → titan grip / colossus; AGI: feather band → vampire fang →
// bladedancer; INT: sapphire bead → stormglass → void lens.
const PRIORITY = {
  bayani:   [2, 0, 0, 4, 14, 17],
  oroku: [2, 0, 0, 4, 14, 19],
  kazane:  [2, 0, 0, 5, 12, 20],
  lilit:    [2, 0, 0, 5, 12, 20],
  ren:   [2, 0, 0, 6, 15, 18],
  amihan:   [2, 0, 0, 6, 15, 18],
};
const need = new Array(25).fill(0);
const EMPTY_INV = [];

// Copies owned of an item, counting stack contents (countItem counts entries; two
// merged potions are one entry with count 2).
function copiesOf(hero, item) {
  const inv = hero && hero.items;
  if (!inv || !item) return 0;
  let n = 0;
  for (let i = 0; i < inv.length; i++) {
    if (inv[i] === item || inv[i].key === item.key) n += inv[i].count || 1;
  }
  return n;
}

// Next priority-list item the bot can afford and does not yet own enough of; -1 when
// none. Keyed on the hero id in its kit, not on melee/ranged.
export function nextBuy(b) {
  const hero = b.hero;
  if (!hero.items || hero.items.length >= INVENTORY_SLOTS) return -1;
  const list = PRIORITY[b.kit.id] || PRIORITY.bayani;
  for (let i = 0; i < ITEMS.length; i++) need[i] = 0;
  for (let i = 0; i < list.length; i++) {
    const idx = list[i];
    need[idx]++;
    if (copiesOf(hero, ITEMS[idx]) >= need[idx]) continue;
    if ((hero.gold || 0) >= ITEMS[idx].cost) return idx;
  }
  return -1;
}

// --- self-sustain -------------------------------------------------------------

// Sip a health potion below 60 % HP, when no potion is running and no ability has
// hit the bot for 2 s (not in combat). Sets intent.useItem; the consumables system
// consumes it on its rising edge.
export function maybePotion(b, intent) {
  const hero = b.hero;
  if (b.hpPct >= 0.6 || hero.potionHpTimer > 0) return false;
  if (b.world.time - b.hitByAbilityAt < 2.0) return false;
  const inv = hero.items || EMPTY_INV;
  for (let i = 0; i < inv.length && i < INVENTORY_SLOTS; i++) {
    const it = inv[i];
    if (it && it.key === 'hpotion') { intent.useItem = i; return true; }
  }
  return false;
}

// Cast the heal slot (Amihan W) below half HP.
export function maybeHeal(b, intent) {
  if (b.kit.w.kind !== 'heal' || b.hpPct >= 0.5) return false;
  return cast(b, intent, 'w');
}

// Local cast gate (same rules as botActions.cast — botActions imports this file, so
// the helper is duplicated rather than shared).
function cast(b, intent, slot) {
  if (b.stateAge < REACTION_DELAY) return false;
  if (b.prevFlags[slot]) return false;
  if (!abilityReady(b.kit, slot, b.hero)) return false;
  intent[slot] = true;
  return true;
}