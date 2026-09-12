// HeroIntent — the ONLY thing a hero consumes (docs/NETCODE.md §3). Plain numbers and
// booleans, mutated in place, never replaced. Written by src/hero/heroController.js
// (local player) or src/ai/heroBot.js (bot); read by src/hero/hero.js.
//
//   moveX/moveZ  world-space unit vector (or both 0); camera yaw already applied
//   aimX/aimZ    world-space ground point (reticle), ≤ 12 m from the hero
//   attack       level-sensitive: true while the attack key/button is held
//   q w e r      cast requests; the HERO edge-detects (fires on false→true). A writer
//                may hold true for several frames (the bot holds intent 0.2 s) — that
//                is one cast, not many.
//   recall       same edge rule as casts
//   buy          -1 = nothing; 0..24 = item index (DESIGN.md §8 order). The shop
//                consumes it on the rising edge (previous value was -1).
//   useItem      -1 = nothing; 0..5 = inventory slot (PHASE2.md §4). The consumables
//                system consumes it on the rising edge, from anywhere.

export function makeIntent() {
  return {
    moveX: 0, moveZ: 0,
    aimX: 0, aimZ: 0,
    attack: false,
    q: false, w: false, e: false, r: false,
    recall: false,
    buy: -1,
    useItem: -1,
    sell: -1,
  };
}

export function clearIntent(i) {
  i.moveX = 0; i.moveZ = 0;
  i.aimX = 0; i.aimZ = 0;
  i.attack = false;
  i.q = false; i.w = false; i.e = false; i.r = false;
  i.recall = false;
  i.buy = -1;
  i.useItem = -1;
  i.sell = -1;
  return i;
}

export function copyIntent(dst, src) {
  dst.moveX = src.moveX; dst.moveZ = src.moveZ;
  dst.aimX = src.aimX; dst.aimZ = src.aimZ;
  dst.attack = src.attack;
  dst.q = src.q; dst.w = src.w; dst.e = src.e; dst.r = src.r;
  dst.recall = src.recall;
  dst.buy = src.buy; dst.sell = src.sell;
  dst.useItem = src.useItem;
  return dst;
}
