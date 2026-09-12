// Shot tracers, sim side: towers and ranged minions are hitscan (damage lands at fire
// time), so a "shot" is purely a visual announcement. This module only emits
// 'shotFired' with a reused payload; fx/shotViews.js owns the meshes and the flight.
import { events } from '../core/events.js';

const firedPayload = { team: 'blue', x: 0, y: 0, z: 0, target: null, speed: 1 };
const clearedPayload = { reason: 'reset' };

class ShotPool {
  // Launches toward `target` (a Unit; the view follows it live so a walker is tracked).
  fire(team, fromX, fromY, fromZ, target, speed) {
    if (!target) return;
    firedPayload.team = team;
    firedPayload.x = fromX; firedPayload.y = fromY; firedPayload.z = fromZ;
    firedPayload.target = target;
    firedPayload.speed = speed;
    events.emit('shotFired', firedPayload);
    firedPayload.target = null;          // listeners must not keep the reference
  }

  update(dt) { /* flight is view-side; kept so callers need no branch */ }

  clear() { events.emit('shotsCleared', clearedPayload); }
}

export const shots = new ShotPool();
