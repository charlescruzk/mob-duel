// Shop: the only place items enter or leave an inventory. Consumes `intent.buy` for
// both heroes on its rising edge (prev === -1 && buy >= 0) inside update(dt); the
// shop panel and the bot go through the same canBuy/buy/sell API.
import { events } from '../core/events.js';
import { TEAMS, isInFountain } from '../map/laneData.js';
import { ITEMS, INVENTORY_SLOTS, SELL_RATIO, resolveItem, countItem, ensureInventory, applyItems } from './items.js';
import { emitGold } from './gold.js';

// Reused payloads.
const boughtPayload = { hero: null, item: null };
const soldPayload = { hero: null, item: null, refund: 0 };

export class Shop {
  constructor(world) {
    this.world = world;
    this._prevBuy = { blue: -1, red: -1 };
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
    if (hero.items.length >= INVENTORY_SLOTS) return 'slots';
    if (item.unique && countItem(hero, item) > 0) return 'unique';
    if ((hero.gold || 0) < item.cost) return 'gold';
    return 'ok';
  }

  canBuy(hero, itemRef) {
    return this.reason(hero, itemRef) === 'ok';
  }

  // Pays, stores the item, recomputes hero.itemStats, then hands the def to the
  // hero's own applyItem hook (contract). Returns true on success.
  buy(hero, itemRef) {
    if (!this.canBuy(hero, itemRef)) return false;
    const item = resolveItem(itemRef);
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

  // Sells the item in inventory slot `slot` for 60% of cost (fountain only).
  sell(hero, slot) {
    if (!hero || hero.alive === false || !hero.items) return false;
    if (!isInFountain(hero.pos, hero.team)) return false;
    const inv = hero.items;
    if (slot < 0 || slot >= inv.length) return false;
    const item = inv[slot];
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
    }
  }
}
