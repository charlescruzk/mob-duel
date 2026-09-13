// ThirdPersonCamera — the Smite-style rig from DESIGN.md §1. Yaw/pitch from mouse
// deltas while pointer-locked, camera 7 m behind a smoothed pivot at eye height.
// Exposes yaw, pitch, forwardX/Z, rightX/Z (XZ unit vectors) for the controller.
import * as THREE from 'three';
import { HEIGHTS } from '../../sim/map/laneData.js';

const YAW_SENS = 0.0022;                   // rad / px
const PITCH_SENS = 0.0022;
const PITCH_DEFAULT = -25 * Math.PI / 180;
const PITCH_MIN = -60 * Math.PI / 180;
const PITCH_MAX = -8 * Math.PI / 180;
const DISTANCE = 7.0;
const EYE_HEIGHT = 1.6;
const SMOOTH = 14;                         // pivot lerp rate (1/s); higher = tighter

const scratchDir = new THREE.Vector3();
const OCCLUDER_PAD = 0.9;                  // metres kept between the camera and a structure
const BOOM_STEP = 0.5;
const BOOM_MIN = 2.0;
const BOOM_SMOOTH = 10;
const PITCH_STEP = 0.12;                   // rad per candidate when steepening over a structure
const PITCH_SMOOTH = 8;

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
    this._shakeT = 0;                      // seconds of shake left
    this._shakeAmp = 0;
    this._shakeDur = 1;
    this.occluders = [];                   // { x, z, r }: towers and nexuses the boom must stay out of
    this.dist = DISTANCE;                  // current boom length (shortened near occluders)
    this.pitchEff = PITCH_DEFAULT;         // pitch actually used: steepened to clear a structure
    this._wantPitch = PITCH_DEFAULT;
    this._updateBasis();
  }

  // Camera kick (PHASE2.md §5 feel feedback): decaying random offset on R impacts
  // and own death. Amplitude in metres, seconds the shake lasts.
  shake(amplitude, seconds) {
    if (amplitude > this._shakeAmp || this._shakeT <= 0) {
      this._shakeAmp = amplitude;
      this._shakeDur = seconds > 0 ? seconds : 0.01;
    }
    this._shakeT = seconds;
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
    if (inp && (inp.locked || inp.touchLook)) {   // touch drags write mouseDX without a lock
      this.yaw -= inp.mouseDX * YAW_SENS;
      this.pitch -= inp.mouseDY * PITCH_SENS;
      if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
      else if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;
      this._updateBasis();
    }

    let snapped = false;
    if (this._snap) { this.pivot.copy(targetPos); this._snap = false; snapped = true; }
    else {
      const k = 1 - Math.exp(-SMOOTH * dt);
      this.pivot.x += (targetPos.x - this.pivot.x) * k;
      this.pivot.y += (targetPos.y - this.pivot.y) * k;
      this.pivot.z += (targetPos.z - this.pivot.z) * k;
    }

    const cam = this.camera;
    // Boom: 7 m at the player's pitch unless a structure sits on it; then first
    // steepen the pitch (the camera rises over the structure), and only if that
    // cannot clear it shorten the boom. Eased so the camera never pops.
    const want = this._clearRig();
    const kb = 1 - Math.exp(-BOOM_SMOOTH * dt);
    const kp = 1 - Math.exp(-PITCH_SMOOTH * dt);
    if (snapped) { this.dist = want; this.pitchEff = this._wantPitch; }
    else {
      this.dist += (want - this.dist) * (want < this.dist ? 1 : kb);      // pull in instantly, ease out
      this.pitchEff += (this._wantPitch - this.pitchEff) * (this._wantPitch < this.pitchEff ? 1 : kp);
    }
    const cp = Math.cos(this.pitchEff);
    const sp = Math.sin(this.pitchEff);       // negative when looking down
    const D = this.dist;
    cam.position.x = this.pivot.x - this.forwardX * D * cp;
    cam.position.y = this.pivot.y + EYE_HEIGHT - sp * D;
    cam.position.z = this.pivot.z - this.forwardZ * D * cp;
    scratchDir.set(this.pivot.x, this.pivot.y + EYE_HEIGHT, this.pivot.z);
    cam.lookAt(scratchDir);
    // Decay the kick on top of the settled frame position.
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      const decay = this._shakeT > 0 ? this._shakeT / this._shakeDur : 0;
      const a = this._shakeAmp * decay;
      cam.position.x += (Math.random() * 2 - 1) * a;
      cam.position.y += (Math.random() * 2 - 1) * a * 0.6;
      cam.position.z += (Math.random() * 2 - 1) * a;
      if (this._shakeT <= 0) this._shakeAmp = 0;
    }
  }

  // Longest boom (≤ DISTANCE) at the least-steepened pitch whose camera point is
  // either OCCLUDER_PAD outside every occluder circle (XZ) or above its top. Sets
  // _wantPitch and returns the boom length. Steps of BOOM_STEP / PITCH_STEP; no allocation.
  _clearRig() {
    const occ = this.occluders;
    this._wantPitch = this.pitch;
    if (!occ.length) return DISTANCE;
    for (let d = DISTANCE; d > BOOM_MIN; d -= BOOM_STEP) {
      for (let p = this.pitch; p >= PITCH_MIN - 1e-6; p -= PITCH_STEP) {
        const cp = Math.cos(p), sp = Math.sin(p);
        const cx = this.pivot.x - this.forwardX * d * cp;
        const cz = this.pivot.z - this.forwardZ * d * cp;
        const cy = this.pivot.y + EYE_HEIGHT - sp * d;
        let clear = true;
        for (let i = 0; i < occ.length; i++) {
          const o = occ[i];
          if (cy > o.h) continue;
          const dx = cx - o.x, dz = cz - o.z, rr = o.r + OCCLUDER_PAD;
          if (dx * dx + dz * dz < rr * rr) { clear = false; break; }
        }
        if (clear) { this._wantPitch = p; return d; }
      }
    }
    this._wantPitch = PITCH_MIN;
    return BOOM_MIN;
  }

  // Static units (towers, nexuses) become boom occluders. Call once per match.
  setOccludersFromWorld(world) {
    this.occluders.length = 0;
    const units = world.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.isStatic) this.occluders.push({ x: u.pos.x, z: u.pos.z, r: u.radius, h: (u.kind === 'nexus' ? HEIGHTS.nexus + 0.6 : HEIGHTS.tower) + 0.6 });
    }
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
