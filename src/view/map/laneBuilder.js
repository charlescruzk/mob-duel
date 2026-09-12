// Builds the static lane meshes: ground, walkable strip, jungle-wall blocks, base
// markers. Tower and nexus MESHES belong to src/units/unitMeshes.js (they are units).
// Returns { boxes, positions, group } — boxes are the physics AABBs from laneData.
import * as THREE from 'three';
import {
  GROUND_BOUNDS, LANE_BOUNDS, WALL_BOXES, POSITIONS, TEAMS, TEAM_COLOR, FOUNTAIN_RADIUS,
} from '../../sim/map/laneData.js';
import { makeGroundTexture, makeStoneTexture, makeDiscTexture } from './textures.js';

export function buildLane(scene) {
  const group = new THREE.Group();
  group.name = 'lane';

  // Ground plane (visual only; the lane clamp is the collision).
  const gw = GROUND_BOUNDS.maxX - GROUND_BOUNDS.minX;
  const gd = GROUND_BOUNDS.maxZ - GROUND_BOUNDS.minZ;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gd),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(gw / 4, gd / 4), roughness: 0.9 }),
  );
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((GROUND_BOUNDS.minX + GROUND_BOUNDS.maxX) / 2, 0, (GROUND_BOUNDS.minZ + GROUND_BOUNDS.maxZ) / 2);
  group.add(ground);

  // Lighter walkable strip so the x = ±7 edge is readable.
  const lw = LANE_BOUNDS.maxX - LANE_BOUNDS.minX;
  const ld = LANE_BOUNDS.maxZ - LANE_BOUNDS.minZ;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(lw, ld),
    new THREE.MeshLambertMaterial({ color: 0x8a8f7a, transparent: true, opacity: 0.22 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.01;
  group.add(strip);

  // Mid-lane line at z = 0.
  const mid = new THREE.Mesh(
    new THREE.PlaneGeometry(lw, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  mid.rotation.x = -Math.PI / 2;
  mid.position.y = 0.02;
  group.add(mid);

  // Wall blocks. One shared material; each block its own box (14 draws — fine).
  const stone = new THREE.MeshLambertMaterial({ map: makeStoneTexture() });
  for (let i = 0; i < WALL_BOXES.length; i++) {
    const b = WALL_BOXES[i];
    const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), stone);
    m.position.set((b.min.x + b.max.x) / 2, sy / 2, (b.min.z + b.max.z) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Base markers: fountain disc per team, spawn pads.
  for (let t = 0; t < TEAMS.length; t++) {
    const team = TEAMS[t];
    const p = POSITIONS[team];
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(FOUNTAIN_RADIUS * 2, FOUNTAIN_RADIUS * 2),
      new THREE.MeshBasicMaterial({ map: makeDiscTexture(TEAM_COLOR[team]), transparent: true, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.nexus.x, 0.03, p.nexus.z);
    group.add(disc);

    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.9, 24),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.8 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(p.heroSpawn.x, 0.04, p.heroSpawn.z);
    group.add(pad);

    // Tower-range hint ring (DESIGN.md §5: 10 m) so "zoned by the tower" is legible.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(9.85, 10.0, 64),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.35 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.tower.x, 0.04, p.tower.z);
    group.add(ring);
  }

  scene.add(group);
  return { boxes: WALL_BOXES, positions: POSITIONS, group };
}
