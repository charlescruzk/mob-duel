// RigAnimator — procedural joint animation, driven from the render step (fx layer).
// Reads unit state (velocity, attack wind-up, casting, stun, death) and blends each
// rig's pose toward a target at 12 rad/s. Target poses are flat number arrays; every
// mutable state lives on the rig object, so nothing here allocates per frame.
import { events } from '../../sim/core/events.js';

const STRIDE = 1.15;          // metres per walk cycle
const BLEND = 12;             // rad/s toward the target pose
const RECOIL_TIME = 0.15;
const SQUASH_TIME = 0.25;
const SWING_BLEND = 30;       // rad/s for the attack swing — a snap, not a lean
const MAX_SPEED = 5.2;        // full walk amplitude at base move speed

// Joint index tables: the rig's fixed joint order. Hero: pelvis, torso, head, armL,
// armR, legL, legR, weapon. Minion: three parts.
const HERO_I = { pelvis: 0, torso: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6, weapon: 7 };
const MINION_I = { torso: 0, legL: 1, legR: 2 };

// Scratch target pose (hero-sized; the minion table uses indices 0..2 of it).
const TARGET = new Float32Array(8 * 3);

export class RigAnimator {
  constructor(world) {
    this.world = world;
    // Hit recoil: any damage snaps the victim's rig into recoil for 0.15 s.
    this._offRecoil = events.on('unitDamaged', (p) => {
      const rig = p.unit && p.unit.rig;
      if (rig && p.unit.alive) rig.recoilT = RECOIL_TIME;
    });
  }

  dispose() { this._offRecoil(); }

  update(dt) {
    const units = this.world.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.rig) this._updateRig(u, u.rig, dt);
    }
  }

  _updateRig(u, rig, dt) {
    const I = rig.kind === 'hero' ? HERO_I : MINION_I;
    const pose = rig.pose;
    const root = rig.root;
    rig.t += dt;

    TARGET.fill(0);
    // Death: a scripted fall (pelvis tips back over 0.5 s, arms out), then sink
    // after 1 s; the mesh hides once it is under ground.
    if (!u.alive) {
      rig.deadT += dt;
      const f = Math.min(1, rig.deadT / 0.5);
      TARGET[I.armL * 3 + 2] = 1.2;
      TARGET[I.armR * 3 + 2] = -1.2;
      const k = Math.min(1, BLEND * dt);
      for (let i = 0; i < pose.length; i++) pose[i] += (TARGET[i] - pose[i]) * k;
      pose[I.pelvis * 3] = -1.5 * f * f;              // scripted fall overrides the blend
      root.position.y = rig.deadT > 1.0 ? -Math.min(1, rig.deadT - 1.0) * 1.4 : 0;
      if (rig.deadT > 2.2 && u.mesh && u.mesh.visible) u.mesh.visible = false;
      this._apply(rig);
      return;
    }
    rig.deadT = 0;

    const speed = Math.sqrt(u.vel.x * u.vel.x + u.vel.z * u.vel.z);
    const stunned = u.stunTimer > 0;

    // Dash landing: the cast ends and the unit is still moving fast → squash-stretch.
    const dash = u.kind === 'hero' && u.abilities.dash ? u.abilities.dash.active : false;
    if (rig.wasDash && !dash && speed > 3) rig.squashT = SQUASH_TIME;
    rig.wasDash = dash;

    // Distance-driven walk cycle: phase = distance / stride, opposite arm swing.
    let walkAmp = 0;
    if (speed > 0.3 && !stunned) {
      rig.dist += speed * dt;
      rig.phase = (rig.dist / STRIDE) * Math.PI * 2;
      walkAmp = Math.min(1, speed / MAX_SPEED);
      const s = Math.sin(rig.phase) * walkAmp;
      TARGET[I.legL * 3] = s * 0.7;
      TARGET[I.legR * 3] = -s * 0.7;
      if (rig.kind === 'hero') {
        TARGET[I.armL * 3] = -s * 0.45;
        TARGET[I.armR * 3] = s * 0.45;
      }
    }

    // State poses layer on top of the walk.
    if (stunned) {
      TARGET[I.torso * 3] = 0.55;
      if (rig.kind === 'hero') { TARGET[I.head * 3] = 0.4; TARGET[I.armL * 3] = 0.25; TARGET[I.armR * 3] = 0.25; }
    } else if (u.isCasting) {
      if (rig.kind === 'hero') { TARGET[I.armL * 3] = -2.1; TARGET[I.armR * 3] = -0.7; }
    }

    // Attack swing sweeps weapon + right arm from raised to struck over the wind-up.
    // Applied after the pose blend at its own faster rate: the target sweeps through
    // in one wind-up, and at the walk blend the pose would only ever half-raise.
    let swingW = 0, swingA = 0, swinging = false;
    if (rig.kind === 'hero' && u.attack && u.attack.active) {
      const total = u.data.windup || 0.3;
      const t = 1 - u.attack.windup / total;
      swingW = -2.2 + 3.0 * t;
      swingA = -1.4 + 1.8 * t;
      swinging = true;
    }

    // Hit recoil bends the torso; decays over RECOIL_TIME.
    if (rig.recoilT > 0) {
      rig.recoilT -= dt;
      if (rig.recoilT < 0) rig.recoilT = 0;
      TARGET[I.torso * 3] += (rig.recoilT / RECOIL_TIME) * 0.35;
    }

    // Idle breathing when nothing else moves the torso.
    if (speed <= 0.3 && !stunned && !u.isCasting) TARGET[I.torso * 3] += Math.sin(rig.t * 2.2) * 0.03;

    const k = Math.min(1, BLEND * dt);
    for (let i = 0; i < pose.length; i++) pose[i] += (TARGET[i] - pose[i]) * k;

    if (swinging) {
      const ks = Math.min(1, SWING_BLEND * dt);
      pose[I.weapon * 3] += (swingW - pose[I.weapon * 3]) * ks;
      pose[I.armR * 3] += (swingA - pose[I.armR * 3]) * ks;
    }

    // Vertical: walk bob, or idle breath — blended so respawn undoes the sink.
    let bob = 0;
    if (walkAmp > 0) bob = Math.abs(Math.cos(rig.phase)) * 0.04 * walkAmp;
    else if (!stunned) bob = Math.sin(rig.t * 2.2) * 0.008;
    root.position.y += (bob - root.position.y) * k;

    // Squash-stretch on dash landing: one dip below 1, one overshoot above.
    if (rig.squashT > 0) {
      rig.squashT -= dt;
      if (rig.squashT < 0) rig.squashT = 0;
      const p = 1 - rig.squashT / SQUASH_TIME;
      const sy = 1 - 0.3 * Math.sin(2 * Math.PI * p);
      root.scale.set(1 + (1 - sy) * 0.5, sy, 1 + (1 - sy) * 0.5);
    } else {
      root.scale.set(1, 1, 1);
    }

    this._apply(rig);
  }

  _apply(rig) {
    const j = rig.joints;
    const p = rig.pose;
    for (let i = 0; i < j.length; i++) {
      j[i].rotation.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
  }
}