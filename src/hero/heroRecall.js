// Recall flow for Hero, split out of hero.js when it passed the ~300-line cap.
// The hero delegates start/cancel/tick; state stays on the hero (isRecalling,
// recallTimer) so save/reset code does not need to know this module exists.
import { POSITIONS } from '../map/laneData.js';
import { RECALL_TIME } from './heroData.js';
import { events } from '../core/events.js';

const EPS = 1e-6;
const recallPayload = { hero: null, completed: false };

export function startRecall(hero) {
  if (!hero.alive || hero.isRecalling || hero.stunned || hero.isCasting) return false;
  hero.isRecalling = true;
  hero.recallTimer = RECALL_TIME;
  recallPayload.hero = hero; recallPayload.completed = false;
  events.emit('recallStarted', recallPayload);
  return true;
}

export function cancelRecall(hero) {
  if (!hero.isRecalling) return;
  hero.isRecalling = false; hero.recallTimer = 0;
  recallPayload.hero = hero; recallPayload.completed = false;
  events.emit('recallEnded', recallPayload);
}

// Any move, attack, cast or stun breaks the channel; completion teleports home.
export function tickRecall(hero, dt, intent) {
  if (!hero.isRecalling) return;
  if (intent.moveX !== 0 || intent.moveZ !== 0 || intent.attack || hero.stunned || hero.isCasting) {
    cancelRecall(hero);
    return;
  }
  hero.recallTimer -= dt;
  if (hero.recallTimer > EPS) return;
  hero.isRecalling = false; hero.recallTimer = 0;
  const sp = POSITIONS[hero.team].heroSpawn;
  hero.teleport(sp.x, sp.z);
  recallPayload.hero = hero; recallPayload.completed = true;
  events.emit('recallEnded', recallPayload);
}