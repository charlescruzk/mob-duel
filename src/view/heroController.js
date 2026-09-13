// HeroController — turns Input + the camera rig into a HeroIntent every frame.
// This and the bot are the only writers of an intent. Nothing here touches a hero.
import * as THREE from 'three';

const AIM_MAX = 12.0;             // DESIGN.md §1: reticle clamped to ≤ 12 m from the hero
const scratch = new THREE.Vector3();

export class HeroController {
  constructor(input, cameraRig) {
    this.input = input;
    this.rig = cameraRig;
    this.enabled = true;          // false while the overlay is up: intent stays cleared
    this.touch = null;            // TouchControls: overrides the keyboard fields when active
  }

  // heroPos: the driven hero's position (used to clamp the aim point). Writes into
  // `intent` in place; returns it.
  update(dt, intent, heroPos) {
    const inp = this.input;
    const rig = this.rig;
    if (!this.enabled) {
      intent.moveX = 0; intent.moveZ = 0; intent.attack = false;
      intent.q = intent.w = intent.e = intent.r = intent.recall = false;
      intent.buy = -1;
      intent.useItem = -1;
      return intent;
    }

    // WASD relative to camera yaw → world-space unit vector.
    const mx = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
    const mz = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
    let wx = rig.rightX * mx + rig.forwardX * mz;
    let wz = rig.rightZ * mx + rig.forwardZ * mz;
    const len = Math.sqrt(wx * wx + wz * wz);
    if (len > 1e-6) { wx /= len; wz /= len; } else { wx = 0; wz = 0; }
    intent.moveX = wx;
    intent.moveZ = wz;

    intent.attack = inp.mouseDown[0] || inp.isDown('Space');
    // KeyW is move-forward, so the W ability lives on KeyF (assumed; DESIGN.md §1
    // lists both WASD and QWER without resolving the clash).
    intent.q = inp.justPressed('KeyQ');
    intent.w = inp.justPressed('KeyF');
    intent.e = inp.justPressed('KeyE');
    intent.r = inp.justPressed('KeyR');
    intent.recall = inp.justPressed('KeyB');
    // Digit1–6 use inventory slots 0–5 (PHASE2.md §4); buying is shop-panel only.
    intent.useItem = inp.justPressed('Digit1') ? 0
      : inp.justPressed('Digit2') ? 1
      : inp.justPressed('Digit3') ? 2
      : inp.justPressed('Digit4') ? 3
      : inp.justPressed('Digit5') ? 4
      : inp.justPressed('Digit6') ? 5 : -1;

    // Aim: camera-centre ray ∩ ground, clamped to AIM_MAX from the hero. If the ray
    // misses the ground (looking above the horizon) aim AIM_MAX ahead along the camera.
    const hx = heroPos ? heroPos.x : rig.pivot.x;
    const hz = heroPos ? heroPos.z : rig.pivot.z;
    if (!rig.reticleOnGround(scratch)) {
      scratch.set(hx + rig.forwardX * AIM_MAX, 0, hz + rig.forwardZ * AIM_MAX);
    }
    let ax = scratch.x - hx;
    let az = scratch.z - hz;
    const d = Math.sqrt(ax * ax + az * az);
    if (d > AIM_MAX) { ax *= AIM_MAX / d; az *= AIM_MAX / d; }
    intent.aimX = hx + ax;
    intent.aimZ = hz + az;
    if (this.touch && this.touch.active) this.touch.applyIntent(intent, heroPos, rig);
    return intent;
  }
}
