// Procedural meshes for minions, towers, nexuses and the shot tracer. Geometries and
// materials are built once per team and shared by every instance — nothing here is
// ever disposed, and nothing here runs per frame. Every mesh is a Group whose visual
// offsets live on children, so Unit.syncMesh can drive the group directly.
import * as THREE from 'three';
import { TEAM_COLOR, RADII, HEIGHTS } from '../map/laneData.js';
import { toonMat, addOutline } from '../map/materials.js';
import { buildMinionRig } from '../fx/rig.js';

const SQRT2 = Math.SQRT2;

// A 4-segment cylinder is a diamond in XZ; the 45° twist makes it an axis-aligned box.
// Circumradius × √2 = half-width, so the tower footprint matches its collision radius.
const geo = {
  towerPlinth: new THREE.BoxGeometry(RADII.tower * 2.2, 0.3, RADII.tower * 2.2),
  towerBody: new THREE.CylinderGeometry(0.7 * SQRT2, RADII.tower * SQRT2, HEIGHTS.tower, 4, 1),
  towerTop: new THREE.OctahedronGeometry(0.6, 0),
  nexusBase: new THREE.CylinderGeometry(RADII.nexus, RADII.nexus * 1.1, 0.6, 16, 1),
  nexusCrystal: new THREE.OctahedronGeometry(1.5, 0),
  shot: new THREE.SphereGeometry(0.16, 8, 6),
};

const bodyMats = {};
const glowMats = {};
const shotMats = {};
const plinthMat = toonMat(0x6b6b66);

function bodyMat(team) {
  if (!bodyMats[team]) bodyMats[team] = toonMat(TEAM_COLOR[team]);
  return bodyMats[team];
}

function glowMat(team) {
  if (!glowMats[team]) {
    glowMats[team] = toonMat(TEAM_COLOR[team]);
    glowMats[team].emissive.setHex(TEAM_COLOR[team]);
    glowMats[team].emissiveIntensity = 0.9;
  }
  return glowMats[team];
}

// Unlit so the tracer reads against any lighting; swapped onto pooled shot meshes.
export function shotMaterial(team) {
  if (!shotMats[team]) shotMats[team] = new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team] });
  return shotMats[team];
}

export function makeMinionMesh(team, ranged) {
  return buildMinionRig(ranged, team).group;   // three-part rig with the walk cycle
}

export function makeTowerMesh(team) {
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(geo.towerPlinth, plinthMat);
  plinth.position.y = 0.15;
  g.add(plinth);
  const body = new THREE.Mesh(geo.towerBody, bodyMat(team));
  body.position.y = HEIGHTS.tower / 2;
  body.rotation.y = Math.PI / 4;
  g.add(body);
  const top = new THREE.Mesh(geo.towerTop, glowMat(team));
  top.position.y = HEIGHTS.tower + 0.5;
  g.add(top);
  addOutline(body, 1.04);
  g.traverse((o) => { if (o.isMesh && o.name !== 'outline') o.castShadow = true; });
  return g;
}

export function makeNexusMesh(team) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(geo.nexusBase, plinthMat);
  base.position.y = 0.3;
  g.add(base);
  const crystal = new THREE.Mesh(geo.nexusCrystal, glowMat(team));
  crystal.position.y = 0.6 + 1.5 * 1.3;
  crystal.scale.set(1, 1.3, 1);
  g.add(crystal);
  addOutline(crystal, 1.04);
  g.traverse((o) => { if (o.isMesh && o.name !== 'outline') o.castShadow = true; });
  return g;
}

export function makeShotMesh(team) {
  const m = new THREE.Mesh(geo.shot, shotMaterial(team));
  m.visible = false;
  return m;
}

// Where a shot visually lands on a unit (mesh height, not collision).
export function hitHeight(unit) {
  if (unit.kind === 'hero') return HEIGHTS.hero * 0.55;
  if (unit.kind === 'tower') return HEIGHTS.tower * 0.5;
  if (unit.kind === 'nexus') return HEIGHTS.nexus * 0.5;
  return HEIGHTS.minion * 0.5;
}
