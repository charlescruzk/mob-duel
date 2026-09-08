// The 25 shop items as data (PHASE2.md §4) plus the item→stat aggregation.
// Index order is the `intent.buy` order. Every item carries the full stat set
// (zeros where unused) so hot loops never branch on missing fields. Consumables
// stack to 5 in one slot: shop.buy hands the hero a fresh per-hero entry, so the
// shared defs stay immutable and only clones carry a mutable `count`.
import { STAT_FIELDS, ITEM_FIELDS } from './itemFields.js';

export const INVENTORY_SLOTS = 6;
export const CDR_CAP = 0.30;
export const SELL_RATIO = 0.6;
export const STACK_MAX = 5;
export { STAT_FIELDS };

// Zero-filled stat block + the non-stat fields, then the sparse overrides on top.
function def(key, name, cost, tier, stats, extra) {
  const it = {
    key, name, cost, tier, unique: false, consumable: false, passive: '',
    useHp: 0, useTime: 0, useMp: 0,
  };
  for (let i = 0; i < STAT_FIELDS.length; i++) it[STAT_FIELDS[i]] = 0;
  const e = extra || EMPTY;
  for (let i = 0; i < ITEM_FIELDS.length; i++) { const f = ITEM_FIELDS[i]; if (e[f] !== undefined) it[f] = e[f]; }
  for (let i = 0; i < STAT_FIELDS.length; i++) { const f = STAT_FIELDS[i]; if (e[f] !== undefined) it[f] = e[f]; }
  it.stats = stats;
  return it;
}
const EMPTY = {};

export const ITEMS = [
  // Consumables (tier 'c'): used from anywhere via intent.useItem (Digit1–6).
  def('hpotion', 'Health Potion', 50, 'c', 'Heals 150 HP over 10 s', { consumable: true, useHp: 150, useTime: 10 }),
  def('mpotion', 'Mana Potion', 50, 'c', 'Restores 120 MP over 8 s', { consumable: true, useMp: 120, useTime: 8 }),

  // Tier 1
  def('swiftsoles', 'Swiftsoles', 250, 1, '+0.6 move speed', { moveSpeed: 0.6, unique: true }),
  def('ironring', 'Iron Ring', 400, 1, '+12 attack damage', { attackDamage: 12 }),
  def('oxbelt', 'Oxhide Belt', 400, 1, '+12 strength', { str: 12 }),
  def('featherband', 'Feather Band', 400, 1, '+12 agility', { agi: 12 }),
  def('sapphirebead', 'Sapphire Bead', 400, 1, '+12 intellect', { int: 12 }),
  def('sparkshard', 'Spark Shard', 400, 1, '+15% ability amp', { abilityAmp: 0.15 }),
  def('hidevest', 'Hide Vest', 400, 1, '+0.08 armor', { armor: 0.08 }),

  // Tier 2
  def('whetstone', 'Whetstone Edge', 750, 2, '+22 attack damage, +10% ability amp', { attackDamage: 22, abilityAmp: 0.10 }),
  def('heartwood', 'Heartwood Charm', 800, 2, '+220 max HP, +1.5 HP regen/s', { maxHp: 220, hpRegen: 1.5 }),
  def('aether', 'Aether Circlet', 700, 2, '+200 max MP, +2.0 MP regen/s, 12% CDR', { maxMp: 200, mpRegen: 2.0, cdr: 0.12 }),
  def('vampfang', 'Vampiric Fang', 850, 2, '+18 attack damage, 12% lifesteal', { attackDamage: 18, lifesteal: 0.12 }),
  def('brandiron', 'Brand Iron', 800, 2, '+15 attack damage, Burn', { attackDamage: 15, passive: 'burn' }),
  def('wardenplate', 'Warden Plate', 850, 2, '+180 max HP, +0.10 armor', { maxHp: 180, armor: 0.10 }),
  def('stormglass', 'Storm Glass', 850, 2, '+25% ability amp, 8% CDR', { abilityAmp: 0.25, cdr: 0.08 }),
  def('fleetgreaves', 'Fleetfoot Greaves', 900, 2, '+0.9 move speed', { moveSpeed: 0.9, unique: true }),

  // Tier 3 (each carries a passive from economy/passives.js)
  def('titangrip', 'Titan Grip', 1800, 3, '+40 attack damage, +150 max HP, Cleave', { attackDamage: 40, maxHp: 150, passive: 'cleave' }),
  def('voidlens', 'Void Lens', 1900, 3, '+45% ability amp, Rend', { abilityAmp: 0.45, passive: 'rend' }),
  def('colossus', 'Colossus Heart', 1700, 3, '+450 max HP, +3 HP regen/s, Second Wind', { maxHp: 450, hpRegen: 3, passive: 'secondWind' }),
  def('bladedancer', 'Bladedancer Charm', 1800, 3, '+30% attack speed, +20 attack damage, Tempo', { attackSpeedPct: 0.30, attackDamage: 20, passive: 'tempo' }),
  def('nullveil', 'Null Veil', 1600, 3, '+0.20 armor, +200 max MP, Spell Shield', { armor: 0.20, maxMp: 200, passive: 'spellShield' }),
  def('chronoband', 'Chronoband', 1600, 3, '20% CDR, +200 max MP, +15% ability amp, Flow', { cdr: 0.20, maxMp: 200, abilityAmp: 0.15, passive: 'flow' }),
  def('headsman', 'Headsman Edge', 1900, 3, '+35 attack damage, Execute', { attackDamage: 35, passive: 'execute' }),
  def('riverstone', 'Riverstone Idol', 1700, 3, '+250 max HP, +0.10 armor, Undertow', { maxHp: 250, armor: 0.10, passive: 'undertow' }),
];

export const ITEM_BY_KEY = {};
for (let i = 0; i < ITEMS.length; i++) ITEM_BY_KEY[ITEMS[i].key] = ITEMS[i];

// Accepts an index (0..24), a key ('aether') or an item object. Null when unknown.
export function resolveItem(ref) {
  if (typeof ref === 'number') return ref >= 0 && ref < ITEMS.length ? ITEMS[ref] : null;
  if (typeof ref === 'string') return ITEM_BY_KEY[ref] || null;
  if (ref && typeof ref.key === 'string') return ITEM_BY_KEY[ref.key] || null;
  return null;
}

// Number of copies of `item` in the hero's inventory. Consumable stacks are
// per-hero clones, so copies match by key (shared defs match by identity too).
export function countItem(hero, item) {
  const inv = hero && hero.items;
  if (!inv || !item) return 0;
  let n = 0;
  for (let i = 0; i < inv.length; i++) if (inv[i] === item || inv[i].key === item.key) n++;
  return n;
}

// A fresh consumable entry for one hero's inventory (clone with count 1). The
// shared def is never pushed itself — clones are the only mutable item state.
export function consumableEntry(def) {
  const it = {};
  const e = ITEM_FIELDS;
  for (let i = 0; i < e.length; i++) it[e[i]] = def[e[i]];
  for (let i = 0; i < STAT_FIELDS.length; i++) { const f = STAT_FIELDS[i]; it[f] = def[f] || 0; }
  it.count = 1;
  return it;
}

// Guarantees the inventory fields exist (one-time allocation per hero).
export function ensureInventory(hero) {
  if (!hero.items) hero.items = [];
  if (!hero.itemStats) {
    hero.itemStats = { moveSpeed: 0, attackDamage: 0, abilityAmp: 0, maxHp: 0, hpRegen: 0, maxMp: 0, mpRegen: 0, cdr: 0, str: 0, agi: 0, int: 0, attackSpeedPct: 0, lifesteal: 0, armor: 0 };
  }
  return hero;
}

// Recomputes the hero's total item contribution into `hero.itemStats` (mutated in
// place). Additive across copies; cdr capped at 30% (DESIGN.md §3.5). Hero.js
// folds these into its derived stats; `hero.applyItem(def)` remains the
// per-purchase hook from the contract.
export function applyItems(hero) {
  ensureInventory(hero);
  const s = hero.itemStats;
  for (let i = 0; i < STAT_FIELDS.length; i++) s[STAT_FIELDS[i]] = 0;
  const inv = hero.items;
  for (let i = 0; i < inv.length; i++) {
    const it = inv[i];
    for (let k = 0; k < STAT_FIELDS.length; k++) s[STAT_FIELDS[k]] += it[STAT_FIELDS[k]] || 0;
  }
  if (s.cdr > CDR_CAP) s.cdr = CDR_CAP;
  return s;
}