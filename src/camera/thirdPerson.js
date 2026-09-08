// ThirdPersonCamera — the Smite-style rig from DESIGN.md §1. Yaw/pitch from mouse
// deltas while pointer-locked, camera 7 m behind a smoothed pivot at eye height.
// Exposes yaw, pitch, forwardX/Z, rightX/Z (XZ unit vectors) for the controller.
import * as THREE from 'three';

const YAW_SENS = 0.0022;                   // rad / px
const PITCH_SENS = 0.0022;
const PITCH_DEFAULT = -25 * Math.PI / 180;
const PITCH_MIN = -60 * Math.PI / 180;
const PITCH_MAX = -8 * Math.PI / 180;
const DISTANCE = 7.0;
const EYE_HEIGHT = 1.6;
const SMOOTH = 14;                         // pivot lerp rate (1/s); higher = tighter

const scratchDir = new THREE.Vector3();

export class ThirdPersonCamera {
  constructor(camera, input) {
    this.camera = camera;
    this.input = input;
    this.yaw = 0;                          // 0 = looking toward -Z (blue's forward)
    this.pitch = PITCH_DEFAULT;
    this.pivot = new THREE.Vector3();      // smoothed target position (ground point)
    this.forwardX = 0; this.forwardZ = -1;
    this.rightX = 1; this.rightZ = 0;
    this._snap = true;
    this._updateBasis();
  }

  // Jump the pivot to the target on the next update (spawn, respawn, recall).
  snapTo(targetPos) {
    this.pivot.copy(targetPos);
    this._snap = true;
  }

  setYaw(yaw) {
    this.yaw = yaw;
    this._updateBasis();
  }

  _updateBasis() {
    this.forwardX = -Math.sin(this.yaw);
    this.forwardZ = -Math.cos(this.yaw);
    this.rightX = Math.cos(this.yaw);
    this.rightZ = -Math.sin(this.yaw);
  }

  update(dt, targetPos) {
    const inp = this.input;
    if (inp && inp.locked) {
      this.yaw -= inp.mouseDX * YAW_SENS;
      this.pitch -= inp.mouseDY * PITCH_SENS;
      if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
      else if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;
      this._updateBasis();
    }

    if (this._snap) { this.pivot.copy(targetPos); this._snap = false; }
    else {
      const k = 1 - Math.exp(-SMOOTH * dt);
      this.pivot.x += (targetPos.x - this.pivot.x) * k;
      this.pivot.y += (targetPos.y - this.pivot.y) * k;
      this.pivot.z += (targetPos.z - this.pivot.z) * k;
    }

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);          // negative when looking down
    const cam = this.camera;
    cam.position.x = this.pivot.x - this.forwardX * DISTANCE * cp;
    cam.position.y = this.pivot.y + EYE_HEIGHT - sp * DISTANCE;
    cam.position.z = this.pivot.z - this.forwardZ * DISTANCE * cp;
    scratchDir.set(this.pivot.x, this.pivot.y + EYE_HEIGHT, this.pivot.z);
    cam.lookAt(scratchDir);
  }

  // Ray from the camera through screen centre ∩ plane y=0. Writes `out`, returns
  // true on hit; false (out untouched) when looking at or above the horizon.
  reticleOnGround(out) {
    const cam = this.camera;
    scratchDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (scratchDir.y >= -1e-4) return false;
    const t = -cam.position.y / scratchDir.y;
    out.set(cam.position.x + scratchDir.x * t, 0, cam.position.z + scratchDir.z * t);
    return true;
  }
}
