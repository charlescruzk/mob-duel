// Item purchase folding for Hero — split out of hero.js to keep it under ~300
// lines. Works on plain item defs; consumables arrive as per-hero clones
// (shop.buy hands over consumableEntry(def)) so the shared ITEMS defs stay
// immutable and only clones carry a mutable `count`.

const INVENTORY_SLOTS = 6;
export const ITEM_KEYS = [
  'moveSpeed', 'attackDamage', 'abilityAmp', 'maxHp', 'hpRegen', 'maxMp', 'mpRegen',
  'cdr', 'str', 'agi', 'int', 'attackSpeedPct', 'lifesteal', 'armor',
];

// Shop calls this after paying. Raising max HP/MP raises current by the same
// amount. Consumable stacks merge into an existing slot; a full stack (or no
// room) refuses.
export function applyItemTo(hero, def) {
  if (!def) return false;
  const inv = hero.items;
  if (def.consumable) {
    for (let i = 0; i < inv.length; i++) {
      if (inv[i].key === def.key && inv[i].count < 5) { inv[i].count++; return refreshItemStats(hero); }
    }
    if (inv.length >= INVENTORY_SLOTS) return false;
    inv.push(def);
    return refreshItemStats(hero);
  }
  if (inv.length >= INVENTORY_SLOTS) return false;
  if (def.key === 'fleetgreaves') dropKey(hero, 'swiftsoles');   // replaces Swiftsoles
  inv.push(def);
  refreshItemStats(hero);
  hero.hp += def.maxHp || 0; if (hero.hp > hero.maxHp) hero.hp = hero.maxHp;
  hero.mp += def.maxMp || 0; if (hero.mp > hero.maxMp) hero.mp = hero.maxMp;
  return true;
}

// Refolds the whole inventory into hero.itemStats (mutated in place), rebuilds
// hero.passives, and recomputes derived stats.
export function refreshItemStats(hero) {
  const s = hero.itemStats, inv = hero.items;
  for (let k = 0; k < ITEM_KEYS.length; k++) s[ITEM_KEYS[k]] = 0;
  for (let i = 0; i < inv.length; i++) {
    const it = inv[i];
    for (let k = 0; k < ITEM_KEYS.length; k++) s[ITEM_KEYS[k]] += it[ITEM_KEYS[k]] || 0;
  }
  if (s.cdr > 0.30) s.cdr = 0.30;
  refreshPassives(hero);
  hero.recomputeStats();
  return true;
}

// Item passives (PHASE2.md §4 tier 3): rebuilt from the inventory on every change;
// economy/passives.js reads it and owns the runtime state.
function refreshPassives(hero) {
  const list = hero.passives;
  list.length = 0;
  const inv = hero.items;
  for (let i = 0; i < inv.length; i++) {
    const p = inv[i].passive;
    if (p && list.indexOf(p) < 0) list.push(p);
  }
}

function dropKey(hero, key) {
  const inv = hero.items;
  for (let i = inv.length - 1; i >= 0; i--) {
    if (inv[i].key === key) {
      for (let j = i; j < inv.length - 1; j++) inv[j] = inv[j + 1];
      inv.length--;
    }
  }
}