// The lane as plain data (DESIGN.md §2). Single source of truth for every position
// and radius other modules need. Vector3 so `pos.copy(...)` works directly.
import { Vec3 } from '../core/vec.js';

export const TEAMS = ['blue', 'red'];
export const TEAM_COLOR = { blue: 0x3b6fd6, red: 0xd64a3b };

export function enemyOf(team) { return team === 'blue' ? 'red' : 'blue'; }

// Walkable rectangle for unit CENTRES (inset by radius in physics.clampToBounds).
export const LANE_BOUNDS = { minX: -7, maxX: 7, minZ: -45, maxZ: 45 };
// Visual ground plane.
export const GROUND_BOUNDS = { minX: -24, maxX: 24, minZ: -50, maxZ: 50 };

// Contract radii (integration rules). Note DESIGN.md §2 lists hero 0.4 / nexus 2.5;
// the builders' contract fixes hero 0.5 / nexus 2.0 and every module uses THESE.
export const RADII = { hero: 0.5, minion: 0.35, tower: 1.2, nexus: 2.0 };
export const HEIGHTS = { hero: 1.8, minion: 1.2, tower: 6, nexus: 4 };

export const FOUNTAIN_RADIUS = 8.0;
export const TOWER_RANGE = 10.0;

// dir = the team's "forward" along Z (blue walks toward -Z, red toward +Z).
export const POSITIONS = {
  blue: {
    dir: -1,
    nexus: new Vec3(0, 0, 42),
    tower: new Vec3(3.0, 0, 16),
    minionSpawn: new Vec3(-1.5, 0, 38.5),
    heroSpawn: new Vec3(0, 0, 37),
  },
  red: {
    dir: 1,
    nexus: new Vec3(0, 0, -42),
    tower: new Vec3(3.0, 0, -16),
    minionSpawn: new Vec3(-1.5, 0, -38.5),
    heroSpawn: new Vec3(0, 0, -37),
  },
};

// Minion slot x offsets from minionSpawn.x (melee front row; ranged 2 m behind).
export const MINION_SLOTS = {
  melee: [-1.0, 0, 1.0],
  ranged: [-0.5, 0.5],
  rangedBehind: 2.0,
};

// Jungle-wall blocks: 7 per side, 10 × 3 × 11 m, plus a 48 × 3 × 4 back wall per side.
// { min, max } Vector3 pairs — the physics AABB format.
const WALL_Z = [-39, -26, -13, 0, 13, 26, 39];
export const WALL_BOXES = [];
for (let i = 0; i < WALL_Z.length; i++) {
  const z = WALL_Z[i];
  WALL_BOXES.push({ min: new Vec3(7.5, 0, z - 5.5), max: new Vec3(17.5, 3, z + 5.5) });
  WALL_BOXES.push({ min: new Vec3(-17.5, 0, z - 5.5), max: new Vec3(-7.5, 3, z + 5.5) });
}
WALL_BOXES.push({ min: new Vec3(-24, 0, 45), max: new Vec3(24, 3, 49) });
WALL_BOXES.push({ min: new Vec3(-24, 0, -49), max: new Vec3(24, 3, -45) });

export function isInFountain(pos, team) {
  const n = POSITIONS[team].nexus;
  const dx = pos.x - n.x;
  const dz = pos.z - n.z;
  return dx * dx + dz * dz <= FOUNTAIN_RADIUS * FOUNTAIN_RADIUS;
}

// Centre distance from `pos` to `team`'s tower, minus the tower radius (DESIGN.md §3.1
// range rule for statics). Negative means overlapping.
export function distToTower(pos, team) {
  const t = POSITIONS[team].tower;
  const dx = pos.x - t.x;
  const dz = pos.z - t.z;
  return Math.sqrt(dx * dx + dz * dz) - RADII.tower;
}
