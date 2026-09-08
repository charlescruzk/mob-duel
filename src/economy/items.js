// The four shop items as data (DESIGN.md §8) plus the item→stat aggregation.
// Index order is the `intent.buy` order (0..3) and the Digit1–4 order.
// Every item carries the full stat set so hot loops never branch on missing fields.

export const INVENTORY_SLOTS = 6;
export const CDR_CAP = 0.30;
export const SELL_RATIO = 0.6;

export const ITEMS = [
  {
    index: 0, key: 'swiftsoles', name: 'Swiftsoles', cost: 250, unique: true,
    moveSpeed: 0.6, attackDamage: 0, abilityAmp: 0, maxHp: 0, hpRegen: 0, maxMp: 0, mpRegen: 0, cdr: 0,
    stats: '+0.6 move speed',
  },
  {
    index: 1, key: 'whetstone', name: 'Whetstone Edge', cost: 750, unique: false,
    moveSpeed: 0, attackDamage: 22, abilityAmp: 0.10, maxHp: 0, hpRegen: 0, maxMp: 0, mpRegen: 0, cdr: 0,
    stats: '+22 attack damage, +10% ability amp',
  },
  {
    index: 2, key: 'heartwood', name: 'Heartwood Charm', cost: 800, unique: false,
    moveSpeed: 0, attackDamage: 0, abilityAmp: 0, maxHp: 220, hpRegen: 1.5, maxMp: 0, mpRegen: 0, cdr: 0,
    stats: '+220 max HP, +1.5 HP regen/s',
  },
  {
    index: 3, key: 'aether', name: 'Aether Circlet', cost: 700, unique: false,
    moveSpeed: 0, attackDamage: 0, abilityAmp: 0, maxHp: 0, hpRegen: 0, maxMp: 200, mpRegen: 2.0, cdr: 0.12,
    stats: '+200 max MP, +2.0 MP regen/s, 12% CDR',
  },
];

export const ITEM_BY_KEY = {};
for (let i = 0; i < ITEMS.length; i++) ITEM_BY_KEY[ITEMS[i].key] = ITEMS[i];

// Accepts an index (0..3), a key ('aether') or an item object. Null when unknown.
export function resolveItem(ref) {
  if (typeof ref === 'number') return ref >= 0 && ref < ITEMS.length ? ITEMS[ref] : null;
  if (typeof ref === 'string') return ITEM_BY_KEY[ref] || null;
  if (ref && typeof ref.key === 'string') return ITEM_BY_KEY[ref.key] || null;
  return null;
}

// Number of copies of `item` in the hero's inventory.
export function countItem(hero, item) {
  const inv = hero.items;
  if (!inv) return 0;
  let n = 0;
  for (let i = 0; i < inv.length; i++) if (inv[i] === item) n++;
  return n;
}

// Guarantees the inventory fields exist (one-time allocation per hero).
export function ensureInventory(hero) {
  if (!hero.items) hero.items = [];
  if (!hero.itemStats) {
    hero.itemStats = { attackDamage: 0, abilityAmp: 0, maxHp: 0, hpRegen: 0, maxMp: 0, mpRegen: 0, cdr: 0, moveSpeed: 0 };
  }
  return hero;
}

// Recomputes the hero's total item contribution into `hero.itemStats` (mutated in
// place). Additive across copies; cdr capped at 30% (DESIGN.md §3.5). The HERO
// builder folds these into its derived stats; `hero.applyItem(def)` remains the
// per-purchase hook from the contract.
export function applyItems(hero) {
  ensureInventory(hero);
  const s = hero.itemStats;
  s.attackDamage = 0; s.abilityAmp = 0; s.maxHp = 0; s.hpRegen = 0;
  s.maxMp = 0; s.mpRegen = 0; s.cdr = 0; s.moveSpeed = 0;
  const inv = hero.items;
  for (let i = 0; i < inv.length; i++) {
    const it = inv[i];
    s.attackDamage += it.attackDamage;
    s.abilityAmp += it.abilityAmp;
    s.maxHp += it.maxHp;
    s.hpRegen += it.hpRegen;
    s.maxMp += it.maxMp;
    s.mpRegen += it.mpRegen;
    s.cdr += it.cdr;
    s.moveSpeed += it.moveSpeed;
  }
  if (s.cdr > CDR_CAP) s.cdr = CDR_CAP;
  return s;
}
