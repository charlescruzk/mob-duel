// Consumables (PHASE2.md §4): potions tick their HoT/mana regen and intent.useItem
// is consumed on the rising edge (−1 none, 0..5 inventory slot) from anywhere, for
// either team. Mirrors Shop as a per-match system wired in main.js. Consumable stacks
// are cleared on hero death via the unitDied listener; the match reset resets the
// edge state.
import { TEAMS } from '../map/laneData.js';
import { events } from '../core/events.js';
import { INVENTORY_SLOTS, applyItems } from './items.js';

const EPS = 1e-6;

// Remove every consumable entry from the hero's inventory (one-time folding after).
function clearConsumables(hero) {
  const inv = hero.items;
  let kept = 0;
  for (let i = 0; i < inv.length; i++) {
    if (!inv[i].consumable) inv[kept++] = inv[i];
  }
  if (kept !== inv.length) {
    inv.length = kept;
    hero.potionHpRate = hero.potionHpTimer = hero.potionMpRate = hero.potionMpTimer = 0;
    applyItems(hero);
    hero.recomputeStats();
  }
}

// Use the consumable in `slot`: pop one from the stack, start the regen.
function use(hero, slot) {
  const inv = hero.items;
  if (slot >= inv.length) return false;
  const it = inv[slot];
  if (!it.consumable) return false;
  if (it.count > 1) it.count--;
  else {
    for (let j = slot; j < inv.length - 1; j++) inv[j] = inv[j + 1];
    inv.length--;
  }
  applyItems(hero);
  hero.recomputeStats();
  if (it.useHp > 0) { hero.potionHpRate = it.useHp / it.useTime; hero.potionHpTimer = it.useTime; }
  if (it.useMp > 0) { hero.potionMpRate = it.useMp / it.useTime; hero.potionMpTimer = it.useTime; }
  return true;
}

function tick(hero, dt) {
  if (hero.potionHpTimer > 0) {
    hero.potionHpTimer -= dt;
    if (hero.potionHpTimer <= EPS) { hero.potionHpTimer = 0; hero.potionHpRate = 0; }
    else hero.heal(hero.potionHpRate * dt);
  }
  if (hero.potionMpTimer > 0) {
    hero.potionMpTimer -= dt;
    if (hero.potionMpTimer <= EPS) { hero.potionMpTimer = 0; hero.potionMpRate = 0; }
    else {
      hero.mp += hero.potionMpRate * dt;
      if (hero.mp > hero.maxMp) hero.mp = hero.maxMp;
    }
  }
}

export class Consumables {
  constructor(world) {
    this.world = world;
    this._prev = { blue: -1, red: -1 };
    events.on('unitDied', (p) => { if (p.unit && p.unit.kind === 'hero') clearConsumables(p.unit); });
  }

  // Per-frame: potion regen for every living hero, then the useItem rising edge.
  update(dt) {
    const world = this.world;
    const prev = this._prev;
    for (let t = 0; t < TEAMS.length; t++) {
      const team = TEAMS[t];
      const hero = world.hero(team);
      if (!hero) continue;
      if (hero.alive) {
        tick(hero, dt);
        const want = hero.intent ? hero.intent.useItem : -1;
        if (prev[team] === -1 && want >= 0 && want < INVENTORY_SLOTS) use(hero, want);
        prev[team] = want;
      }
    }
  }

  reset() { this._prev.blue = -1; this._prev.red = -1; }
}