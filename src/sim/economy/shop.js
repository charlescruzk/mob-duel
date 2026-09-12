// Shop: the only place items enter or leave an inventory. Consumes `intent.buy` for
// both heroes on its rising edge (prev === -1 && buy >= 0) inside update(dt); the
// shop panel and the bot go through the same canBuy/buy/sell API.
import { events } from '../core/events.js';
import { TEAMS, isInFountain } from '../map/laneData.js';
import { ITEMS, INVENTORY_SLOTS, SELL_RATIO, STACK_MAX, resolveItem, countItem, ensureInventory, applyItems, consumableEntry } from './items.js';
import { emitGold } from './gold.js';

// Reused payloads.
const boughtPayload = { hero: null, item: null };
const soldPayload = { hero: null, item: null, refund: 0 };

// True when the hero owns a consumable stack of this key with room for one more.
function stackable(hero, item) {
  const inv = hero.items;
  for (let i = 0; i < inv.length; i++) {
    if (inv[i].consumable && inv[i].key === item.key && inv[i].count < STACK_MAX) return true;
  }
  return false;
}

export class Shop {
  constructor(world) {
    this.world = world;
    this._prevBuy = { blue: -1, red: -1 };
    this._prevSell = { blue: -1, red: -1 };
  }

  inFountain(hero) {
    return !!hero && hero.alive !== false && isInFountain(hero.pos, hero.team);
  }

  // Why a purchase is refused: 'ok' | 'unknown' | 'dead' | 'fountain' | 'slots' |
  // 'unique' | 'gold'. String constants only — safe to call every frame.
  reason(hero, itemRef) {
    const item = resolveItem(itemRef);
    if (!item || !hero) return 'unknown';
    if (hero.alive === false) return 'dead';
    if (!isInFountain(hero.pos, hero.team)) return 'fountain';
    ensureInventory(hero);
    if (item.consumable) {
      // A potion merges into an existing stack with room; only a full stack (or a
      // full inventory) needs a free slot.
      if (!stackable(hero, item) && hero.items.length >= INVENTORY_SLOTS) return 'slots';
    } else {
      if (hero.items.length >= INVENTORY_SLOTS) return 'slots';
      if (item.unique && countItem(hero, item) > 0) return 'unique';
    }
    if ((hero.gold || 0) < item.cost) return 'gold';
    return 'ok';
  }

  canBuy(hero, itemRef) {
    return this.reason(hero, itemRef) === 'ok';
  }

  // Pays, stores the item, recomputes hero.itemStats, then hands the def to the
  // hero's own applyItem hook (contract). Consumables go in as a fresh per-hero
  // stack entry so the shared def stays immutable. Returns true on success.
  buy(hero, itemRef) {
    if (!this.canBuy(hero, itemRef)) return false;
    const def = resolveItem(itemRef);
    const item = def.consumable ? consumableEntry(def) : def;
    hero.gold -= item.cost;
    // Hero.applyItem stores the def and recomputes its own stats; the fallback path
    // (placeholder heroes) keeps hero.items / hero.itemStats consistent itself.
    if (typeof hero.applyItem === 'function') hero.applyItem(item);
    else { hero.items.push(item); applyItems(hero); }
    emitGold(hero, -item.cost, 'buy');
    boughtPayload.hero = hero;
    boughtPayload.item = item;
    events.emit('itemBought', boughtPayload);
    return true;
  }

  // Sells one copy from inventory slot `slot` for 60% of cost (fountain only).
  // A potion stack loses one copy and keeps its slot.
  sell(hero, slot) {
    if (!hero || hero.alive === false || !hero.items) return false;
    if (!isInFountain(hero.pos, hero.team)) return false;
    const inv = hero.items;
    if (slot < 0 || slot >= inv.length) return false;
    const item = inv[slot];
    if (item.consumable && item.count > 1) {
      item.count--;
      const refund = Math.floor(item.cost * SELL_RATIO);
      hero.gold = (hero.gold || 0) + refund;
      emitGold(hero, refund, 'sell');
      soldPayload.hero = hero; soldPayload.item = item; soldPayload.refund = refund;
      events.emit('itemSold', soldPayload);
      return true;
    }
    for (let i = slot; i < inv.length - 1; i++) inv[i] = inv[i + 1];   // no splice → no alloc
    inv.length--;
    const refund = Math.floor(item.cost * SELL_RATIO);
    hero.gold = (hero.gold || 0) + refund;
    applyItems(hero);
    if (typeof hero.recomputeStats === 'function') hero.recomputeStats();
    // Selling a max-HP/MP item takes the same amount back off current (min 1 HP).
    if (item.maxHp) { hero.hp -= item.maxHp; if (hero.hp < 1) hero.hp = 1; }
    if (item.maxMp && typeof hero.mp === 'number') { hero.mp -= item.maxMp; if (hero.mp < 0) hero.mp = 0; }
    emitGold(hero, refund, 'sell');
    soldPayload.hero = hero;
    soldPayload.item = item;
    soldPayload.refund = refund;
    events.emit('itemSold', soldPayload);
    return true;
  }

  // Match reset: the Hero's own reset() empties its inventory; this only clears the
  // buy edge so a held Digit key cannot fire on the first frame of the new match.
  reset() {
    for (let i = 0; i < TEAMS.length; i++) this._prevBuy[TEAMS[i]] = -1;
  }

  update(dt) {
    for (let i = 0; i < TEAMS.length; i++) {
      const team = TEAMS[i];
      const hero = this.world.hero(team);
      if (!hero) continue;
      ensureInventory(hero);
      const intent = hero.intent;
      const want = intent ? intent.buy : -1;
      if (this._prevBuy[team] === -1 && want >= 0 && want < ITEMS.length) this.buy(hero, want);
      this._prevBuy[team] = want;
      // Sell intent (online play routes the panel through the intent; -1 = none).
      const sellWant = intent && typeof intent.sell === 'number' ? intent.sell : -1;
      if (this._prevSell[team] === -1 && sellWant >= 0) this.sell(hero, sellWant);
      this._prevSell[team] = sellWant;
    }
  }
}
