// Assisted and manual aim for touch casts. Assisted: the nearest enemy hero inside the
// ability's range, else the nearest minion, else a point ahead. Mobility skills
// (dash/blink) default to the joystick direction. Manual: a drag vector in screen
// space mapped onto the camera basis. A ground ring shows the manual aim point.
import * as THREE from 'three';

const AIM_MAX = 12.0;
const near = [];   // scratch out-array for enemiesInRadius

export function assistedAim(world, hero, def, rig, joyX, joyZ, out) {
  const hx = hero.pos.x, hz = hero.pos.z;
  const shape = def ? def.shape : 'auto';
  const range = def ? (def.range || def.distance || def.maxDist || 0) : hero.attackRange;
  if (shape === 'dash' || shape === 'blink') {
    let dx = joyX, dz = joyZ;
    if (dx === 0 && dz === 0) { dx = rig.forwardX; dz = rig.forwardZ; }
    const r = Math.max(1, Math.min(range || AIM_MAX, AIM_MAX));
    out.x = hx + dx * r; out.z = hz + dz * r;
    return out;
  }
  const r = Math.max(1.5, Math.min(range > 0 ? range : hero.attackRange + 1.5, AIM_MAX));
  let best = null, bestD = Infinity, bestHero = false;
  near.length = 0;
  world.enemiesInRadius(hero.pos, hero.team, r, near);
  for (let i = 0; i < near.length; i++) {
    const u = near[i];
    if (!u.alive || u.invulnerable) continue;
    if (shape !== 'auto' && (u.kind === 'tower' || u.kind === 'nexus')) continue;   // abilities never hit statics
    const isHero = u.kind === 'hero';
    const dx = u.pos.x - hx, dz = u.pos.z - hz;
    const d = dx * dx + dz * dz;
    if ((isHero && !bestHero) || (isHero === bestHero && d < bestD)) { best = u; bestD = d; bestHero = isHero; }
  }
  near.length = 0;
  if (best) { out.x = best.pos.x; out.z = best.pos.z; return out; }
  const ahead = r * 0.6;
  out.x = hx + rig.forwardX * ahead; out.z = hz + rig.forwardZ * ahead;
  return out;
}

// Drag (dx, dy) in CSS pixels → a point `reach` fraction of the range along the
// camera-relative direction. `px` is the drag length that means "full range".
export function manualAim(hero, def, rig, dx, dy, px, out) {
  const range = Math.max(1.5, Math.min((def && (def.range || def.distance || def.maxDist)) || hero.attackRange, AIM_MAX));
  let wx = rig.rightX * dx - rig.forwardX * dy;
  let wz = rig.rightZ * dx - rig.forwardZ * dy;
  const len = Math.sqrt(wx * wx + wz * wz);
  if (len < 1e-6) { out.x = hero.pos.x + rig.forwardX * range * 0.5; out.z = hero.pos.z + rig.forwardZ * range * 0.5; return out; }
  const reach = Math.min(1, Math.sqrt(dx * dx + dy * dy) / px) * range;
  out.x = hero.pos.x + (wx / len) * reach; out.z = hero.pos.z + (wz / len) * reach;
  return out;
}

// Ground ring shown while aiming manually. Built once, parented to the hero mesh's
// scene lazily (the touch layer never receives the scene directly).
export class AimIndicator {
  constructor() {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0x4fd8e0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.06;
    this.mesh.visible = false;
    this.line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1),
      new THREE.MeshBasicMaterial({ color: 0x4fd8e0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    this.line.rotation.x = -Math.PI / 2;
    this.line.position.y = 0.05;
    this.line.visible = false;
    this.attached = false;
  }
  show(hero, x, z) {
    if (!this.attached) {
      const scene = hero.mesh && hero.mesh.parent;
      if (!scene) return;
      scene.add(this.mesh); scene.add(this.line); this.attached = true;
    }
    this.mesh.position.x = x; this.mesh.position.z = z; this.mesh.visible = true;
    const dx = x - hero.pos.x, dz = z - hero.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    this.line.visible = d > 0.5;
    this.line.position.x = hero.pos.x + dx * 0.5; this.line.position.z = hero.pos.z + dz * 0.5;
    this.line.scale.y = d;
    this.line.rotation.z = Math.atan2(-dx, -dz);
  }
  hide() { this.mesh.visible = false; this.line.visible = false; }
}
