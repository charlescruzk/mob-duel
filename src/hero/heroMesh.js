// Procedural hero meshes: a team-coloured capsule body plus a distinguishing head
// shape per hero, a facing nose, and a hidden shield bubble the Hero toggles.
// Materials that fade during Veil are returned in `mats` (opacity 1 → 0.35).
// Visual offsets live on children; the group itself is placed by Unit.syncMesh().
import * as THREE from 'three';
import { RADII, HEIGHTS, TEAM_COLOR } from '../map/laneData.js';

const BODY_R = RADII.hero * 0.84;

const TRIM = { brakk: 0x6b6b6b, ilyra: 0xf2c84b, vaskra: 0x9fd6ff, kesh: 0xb06be0, halvard: 0x8a9aa8, lumen: 0x2fa8c8 };

export function buildHeroMesh(heroKey, team) {
  const color = TEAM_COLOR[team];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color, transparent: true });
  const trimMat = new THREE.MeshLambertMaterial({ color: TRIM[heroKey] || 0xf2c84b, transparent: true });
  const noseMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
  const mats = [bodyMat, trimMat, noseMat];

  const bodyH = HEIGHTS.hero - 2 * BODY_R;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_R, bodyH, 4, 12), bodyMat);
  body.position.y = HEIGHTS.hero / 2;
  g.add(body);

  if (heroKey === 'brakk') {
    // Ironhide: blocky helm and shoulder plates.
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.62), trimMat);
    helm.position.y = HEIGHTS.hero - 0.1;
    g.add(helm);
    const pads = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.22, 0.5), trimMat);
    pads.position.y = HEIGHTS.hero - 0.5;
    g.add(pads);
  } else if (heroKey === 'halvard') {
    // Wall: a tower shield plate on the left flank and a crested helm.
    const shieldPlate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.85), trimMat);
    shieldPlate.position.set(-0.5, HEIGHTS.hero * 0.55, 0);
    g.add(shieldPlate);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.5), trimMat);
    crest.position.y = HEIGHTS.hero - 0.05;
    g.add(crest);
  } else if (heroKey === 'vaskra') {
    // Longshot: a brimmed scout cap and a bow held out to the right.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.14, 10), trimMat);
    cap.position.y = HEIGHTS.hero - 0.05;
    g.add(cap);
    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.045, 8, 20, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x8a6a44 }));
    bow.position.set(0.55, HEIGHTS.hero * 0.6, 0);
    bow.rotation.z = Math.PI / 2;
    g.add(bow);
  } else if (heroKey === 'kesh') {
    // Hollow: a pointed hood and a cowl collar.
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.6, 8), trimMat);
    hood.position.y = HEIGHTS.hero + 0.12;
    g.add(hood);
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.28, 0.75), trimMat);
    cowl.position.y = HEIGHTS.hero - 0.32;
    g.add(cowl);
  } else if (heroKey === 'lumen') {
    // Tidecaller: a tidal headpiece and a floating water orb held out front.
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 3), trimMat);
    crest.rotation.x = Math.PI / 2;
    crest.position.y = HEIGHTS.hero + 0.08;
    g.add(crest);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x2fa8c8 }));
    orb.position.set(0, HEIGHTS.hero * 0.65, -0.55);
    g.add(orb);
  } else {
    // Cinderweaver: a tall cone hat and a floating ember orb.
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.7, 10), trimMat);
    hat.position.y = HEIGHTS.hero + 0.2;
    g.add(hat);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a30 }));
    orb.position.set(0.55, HEIGHTS.hero * 0.65, -0.2);
    g.add(orb);
  }

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.45), noseMat);
  nose.position.set(0, HEIGHTS.hero * 0.7, -RADII.hero);
  g.add(nose);

  const shield = new THREE.Mesh(new THREE.SphereGeometry(RADII.hero * 1.7, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.28, depthWrite: false }));
  shield.position.y = HEIGHTS.hero / 2;
  shield.visible = false;
  g.add(shield);

  return { group: g, shield, mats };
}

// Stealth fade: the stealthed hero reads at 0.35 opacity (own view; enemy-side
// view culling comes with the render pass work in Task 8/9).
export function applyStealthFade(hero) {
  const op = hero.abilities.stealthed ? 0.35 : 1;
  const list = hero.meshMats;
  for (let i = 0; i < list.length; i++) list[i].opacity = op;
}