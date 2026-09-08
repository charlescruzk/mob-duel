// Procedural hero and minion rigs built from primitives (Task 10). Replaces the
// single-capsule bodies: each hero is a small joint tree (pelvis, torso, head, both
// arms, both legs, a class weapon) and each minion a three-part rig. All animation
// state lives on the returned `rig` object — nothing here runs per frame, and the
// { group, shield, mats } contract with heroMesh.js is unchanged.
// Lives in fx/ but is imported by the mesh builders (hero/ , units/) — they are
// visual-only code already importing map/; the sim never imports fx/.
import * as THREE from 'three';
import { RADII, TEAM_COLOR } from '../map/laneData.js';
import { toonMat, addOutline } from '../map/materials.js';

const TRIM = { brakk: 0x6b6b6b, ilyra: 0xf2c84b, vaskra: 0x9fd6ff, kesh: 0xb06be0, halvard: 0x8a9aa8, lumen: 0x2fa8c8 };

// Shared minion materials per team (mirrors the old unitMeshes sharing rule).
const minionBody = {};
const minionGlow = {};
const minionNose = toonMat(0x1a1a1a);

function makeRig(kind, joints, root) {
  return {
    kind,                                   // 'hero' | 'minion' — the animator's index table
    joints,                                 // fixed Object3D table; the only thing animated
    root,                                   // bob/squash/sink offset node
    pose: new Float32Array(joints.length * 3),
    phase: 0, dist: 0, t: 0,
    recoilT: 0, squashT: 0, deadT: 0, wasDash: false,
  };
}

function glowOrb(hex, r) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8),
    new THREE.MeshBasicMaterial({ color: hex, transparent: true }));
}

// Hero rig: pelvis → torso → (head, armL, armR → weapon) + legL/legR at the pelvis.
export function buildHeroRig(heroKey, team) {
  const color = TEAM_COLOR[team];
  const g = new THREE.Group();
  const bodyMat = toonMat(color, true);
  const trimMat = toonMat(TRIM[heroKey] || 0xf2c84b, true);
  const noseMat = toonMat(0xffffff, true);
  const mats = [bodyMat, trimMat, noseMat];

  const root = new THREE.Group(); g.add(root);
  const pelvis = new THREE.Group(); pelvis.position.y = 0.95; root.add(pelvis);
  const torso = new THREE.Group(); torso.position.y = 0.1; pelvis.add(torso);
  const head = new THREE.Group(); head.position.y = 0.68; torso.add(head);
  const armL = new THREE.Group(); armL.position.set(-0.38, 0.58, 0); torso.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.38, 0.58, 0); torso.add(armR);
  const legL = new THREE.Group(); legL.position.set(-0.15, -0.02, 0); pelvis.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.15, -0.02, 0); pelvis.add(legR);
  const weapon = new THREE.Group(); weapon.position.y = -0.5; armR.add(weapon);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3), bodyMat);
  hips.position.y = -0.08; pelvis.add(hips);
  const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.34), bodyMat);
  torsoMesh.position.y = 0.32; torso.add(torsoMesh);
  const armGeo = new THREE.CapsuleGeometry(0.09, 0.28, 3, 6);
  const armLMesh = new THREE.Mesh(armGeo, bodyMat); armLMesh.position.y = -0.26; armL.add(armLMesh);
  const armRMesh = new THREE.Mesh(armGeo, bodyMat); armRMesh.position.y = -0.26; armR.add(armRMesh);
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.3, 3, 6);
  const legLMesh = new THREE.Mesh(legGeo, bodyMat); legLMesh.position.y = -0.28; legL.add(legLMesh);
  const legRMesh = new THREE.Mesh(legGeo, bodyMat); legRMesh.position.y = -0.28; legR.add(legRMesh);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), bodyMat);
  headMesh.position.y = 0.1; head.add(headMesh);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), noseMat);
  nose.position.set(0, 0.1, -0.22); head.add(nose);

  // Class weapon in the right hand; the head accessories carry the hero identity.
  let weaponMat;
  if (heroKey === 'brakk') {
    weaponMat = toonMat(0x9aa2ac, true);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.16), weaponMat);
    blade.position.y = -0.42; weapon.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.22), trimMat);
    guard.position.y = -0.05; weapon.add(guard);
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.36, 0.52), trimMat);
    helm.position.y = 0.24; head.add(helm);
    const pads = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.44), trimMat);
    pads.position.y = 0.56; torso.add(pads);
  } else if (heroKey === 'ilyra') {
    weaponMat = toonMat(0x6a4a30, true);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 8), weaponMat);
    staff.position.y = -0.34; weapon.add(staff);
    const ember = glowOrb(0xff7a30, 0.11); ember.position.y = -0.9; weapon.add(ember);
    mats.push(ember.material);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 10), trimMat);
    hat.position.y = 0.5; head.add(hat);
    const orb = glowOrb(0xff7a30, 0.14); orb.position.set(0.5, 0.44, -0.15); torso.add(orb);
  } else if (heroKey === 'vaskra') {
    weaponMat = toonMat(0x8a6a44, true);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 20, Math.PI), weaponMat);
    bow.rotation.z = Math.PI / 2; bow.position.y = -0.1; weapon.add(bow);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 10), trimMat);
    cap.position.y = 0.3; head.add(cap);
  } else if (heroKey === 'kesh') {
    weaponMat = toonMat(0x4a4f58, true);
    const dagger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.1), weaponMat);
    dagger.position.y = -0.24; weapon.add(dagger);
    const dagger2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.1), weaponMat);
    dagger2.position.y = -0.5; armL.add(dagger2);   // twin daggers: left hand holds its own
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 8), trimMat);
    hood.position.y = 0.42; head.add(hood);
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.24, 0.68), trimMat);
    cowl.position.y = 0.6; torso.add(cowl);
  } else if (heroKey === 'halvard') {
    weaponMat = toonMat(0x8a9aa8, true);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), weaponMat);
    handle.position.y = -0.24; weapon.add(handle);
    const mace = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), weaponMat);
    mace.position.y = -0.52; weapon.add(mace);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.78), trimMat);
    plate.position.set(-0.12, -0.18, 0); armL.add(plate);   // tower shield on the left arm
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.44), trimMat);
    crest.position.y = 0.4; head.add(crest);
  } else {
    weaponMat = toonMat(0x2fa8c8, true);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 8), weaponMat);
    shaft.position.y = -0.32; weapon.add(shaft);
    for (let i = -1; i <= 1; i++) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), weaponMat);
      prong.position.set(i * 0.1, -0.95, 0); prong.rotation.x = Math.PI; weapon.add(prong);
    }
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.44, 3), trimMat);
    crest.rotation.x = Math.PI / 2; crest.position.y = 0.42; head.add(crest);
    const orb = glowOrb(0x2fa8c8, 0.14); orb.position.set(0, 0.5, -0.5); torso.add(orb);
  }
  mats.push(weaponMat);

  const shield = new THREE.Mesh(new THREE.SphereGeometry(RADII.hero * 1.7, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.28, depthWrite: false }));
  shield.position.y = 0.9;
  shield.visible = false;
  g.add(shield);

  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x101216, side: THREE.BackSide, transparent: true,
  });
  addOutline(torsoMesh, 1.04, outlineMat);
  mats.push(outlineMat);
  g.traverse((o) => { if (o.isMesh && o.name !== 'outline') o.castShadow = true; });

  return { group: g, shield, mats, rig: makeRig('hero', [pelvis, torso, head, armL, armR, legL, legR, weapon], root) };
}

// Minion rig, three parts: torso, legL, legR — the same walk cycle as the heroes.
export function buildMinionRig(ranged, team) {
  const g = new THREE.Group();
  if (!minionBody[team]) {
    minionBody[team] = toonMat(TEAM_COLOR[team]);
    minionGlow[team] = toonMat(TEAM_COLOR[team]);
    minionGlow[team].emissive.setHex(TEAM_COLOR[team]);
    minionGlow[team].emissiveIntensity = 0.9;
  }
  const bodyMat = minionBody[team];

  const root = new THREE.Group(); g.add(root);
  const torso = new THREE.Group(); torso.position.y = ranged ? 0.42 : 0.5; root.add(torso);
  const legL = new THREE.Group(); legL.position.set(-0.12, -0.04, 0); torso.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.12, -0.04, 0); torso.add(legR);

  const h = ranged ? 0.8 : 1.0;
  const torsoMesh = new THREE.Mesh(
    ranged ? new THREE.BoxGeometry(0.45, h, 0.45) : new THREE.BoxGeometry(0.5, h, 0.5), bodyMat);
  torsoMesh.position.y = h / 2; torso.add(torsoMesh);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), minionNose);
  nose.position.set(0, h * 0.7, -0.32); torso.add(nose);
  if (ranged) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 6), minionGlow[team]);
    spike.position.y = h + 0.24; torso.add(spike);
  }
  const legGeo = new THREE.CapsuleGeometry(0.08, 0.2, 3, 6);
  const legLMesh = new THREE.Mesh(legGeo, bodyMat); legLMesh.position.y = -0.2; legL.add(legLMesh);
  const legRMesh = new THREE.Mesh(legGeo, bodyMat); legRMesh.position.y = -0.2; legR.add(legRMesh);

  addOutline(torsoMesh, 1.04);
  g.traverse((o) => { if (o.isMesh && o.name !== 'outline') o.castShadow = true; });

  return { group: g, rig: makeRig('minion', [torso, legL, legR], root) };
}