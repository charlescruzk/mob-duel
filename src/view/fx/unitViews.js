// UnitViews — the bridge from sim units to meshes. The sim announces units through
// 'unitAdded' / 'unitRemoved'; this builds a mesh (rig) per unit once, keeps it across
// pool reuse and match resets, and fills the unit's view-owned `mesh` / `rig` slots
// that the camera-side systems (RigAnimator, AbilityFx, HUD) read. Nothing here writes
// sim state.
import { events } from '../../sim/core/events.js';
import { buildHeroRig, buildMinionRig } from './rig.js';
import { makeTowerMesh, makeNexusMesh } from './unitMeshes.js';

const STEALTH_OPACITY = 0.35;

export class UnitViews {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.views = new Map();          // unit → view record (built once per unit)
    this.list = [];                  // same records, for allocation-free iteration
    this._onAdded = (p) => this._added(p.unit);
    this._onRemoved = (p) => this._removed(p.unit);
    // Rigged units keep the mesh up for the death fall (the animator sinks it);
    // unrigged structures vanish instantly, as before the split.
    this._onDied = (p) => { const v = this.views.get(p.unit); if (v) v.mesh.visible = !!v.rig; };
    this._onRespawn = (p) => { const v = this.views.get(p.hero); if (v) v.mesh.visible = true; };
    this._offs = [
      events.on('unitAdded', this._onAdded),
      events.on('unitRemoved', this._onRemoved),
      events.on('unitDied', this._onDied),
      events.on('heroRespawned', this._onRespawn),
    ];
  }

  _added(u) {
    let v = this.views.get(u);
    if (!v) {
      v = this._build(u);
      this.views.set(u, v);
      this.list.push(v);
    }
    u.mesh = v.mesh;
    u.rig = v.rig;
    if (!v.mesh.parent) this.scene.add(v.mesh);
    v.mesh.visible = true;
    v.mesh.scale.setScalar(1);
    u.syncMesh();
  }

  _removed(u) {
    const v = this.views.get(u);
    if (v) v.mesh.visible = false;
  }

  _build(u) {
    if (u.kind === 'hero') {
      const b = buildHeroRig(u.heroKey, u.team);
      return { unit: u, mesh: b.group, shield: b.shield, mats: b.mats || null, rig: b.rig || null, stealthOn: false };
    }
    if (u.kind === 'minion') {
      const b = buildMinionRig(u.ranged, u.team);
      return { unit: u, mesh: b.group, shield: null, mats: null, rig: b.rig || null, stealthOn: false };
    }
    const mesh = u.kind === 'tower' ? makeTowerMesh(u.team) : makeNexusMesh(u.team);
    return { unit: u, mesh, shield: null, mats: null, rig: null, stealthOn: false };
  }

  // Per frame: hero shield bubble and stealth fade follow sim state.
  update() {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const u = v.unit;
      if (u.kind !== 'hero') continue;
      if (v.shield) v.shield.visible = u.alive && u.shield > 0;
      const stealthOn = !!u.stealthed;
      if (stealthOn !== v.stealthOn && v.mats) {
        v.stealthOn = stealthOn;
        const op = stealthOn ? STEALTH_OPACITY : 1;
        for (let m = 0; m < v.mats.length; m++) v.mats[m].opacity = op;
      }
    }
  }

  // Meshes currently shown (probe: tracks world membership).
  visibleCount() {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].mesh.visible) n++;
    return n;
  }

  dispose() {
    for (let i = 0; i < this._offs.length; i++) this._offs[i]();
    this._offs.length = 0;
  }
}
