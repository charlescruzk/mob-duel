// Field lists for the item table (items.js) — kept out of items.js so both the
// def() normalizer and consumer loops share one source without import cycles.

// Every stat an item can add. Zeros for unused fields (hot loops never branch).
export const STAT_FIELDS = [
  'moveSpeed', 'attackDamage', 'abilityAmp', 'maxHp', 'hpRegen', 'maxMp', 'mpRegen',
  'cdr', 'str', 'agi', 'int', 'attackSpeedPct', 'lifesteal', 'armor',
];

// Non-stat fields the def() helper and consumableEntry() copy around.
export const ITEM_FIELDS = ['key', 'name', 'cost', 'tier', 'unique', 'consumable', 'passive', 'useHp', 'useTime', 'useMp'];