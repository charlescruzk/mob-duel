// Hero mesh = the procedural rig (Task 10). This file is the adapter hero.js imports:
// it keeps the buildHeroMesh signature and the stealth-fade helper, while the joint
// tree, weapons and accessories live in fx/rig.js.
import { buildHeroRig } from '../fx/rig.js';

export function buildHeroMesh(heroKey, team) {
  return buildHeroRig(heroKey, team);
}

// Stealth fade: the stealthed hero reads at 0.35 opacity (own view; enemy-side
// view culling comes with the render pass work).
export function applyStealthFade(hero) {
  const op = hero.abilities.stealthed ? 0.35 : 1;
  const list = hero.meshMats;
  for (let i = 0; i < list.length; i++) list[i].opacity = op;
}