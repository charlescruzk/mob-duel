// ShotViews — pooled tracer meshes for tower and ranged-minion shots. Listens for the
// sim's 'shotFired' (a launch point and a target unit) and flies a small sphere to the
// target's body height; 'shotsCleared' hides everything on match reset. Purely visual:
// damage already landed when the shot was fired.
import { events } from '../core/events.js';
import { makeShotMesh, shotMaterial, hitHeight } from '../units/unitMeshes.js';

const POOL_SIZE = 48;

export class ShotViews {
  constructor(scene) {
    this.shots = [];
    this.next = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = makeShotMesh('blue');
      scene.add(mesh);
      this.shots.push({ mesh, active: false, target: null, y: 0, speed: 1 });
    }
    this._onFired = (p) => this._fire(p);
    this._onCleared = () => this.clear();
    this._offs = [events.on('shotFired', this._onFired), events.on('shotsCleared', this._onCleared)];
  }

  _fire(p) {
    const s = this.shots[this.next];
    this.next = (this.next + 1) % POOL_SIZE;
    s.active = true;
    s.target = p.target;
    s.y = hitHeight(p.target);
    s.speed = p.speed;
    s.mesh.material = shotMaterial(p.team);
    s.mesh.position.set(p.x, p.y, p.z);
    s.mesh.visible = true;
  }

  update(dt) {
    const list = this.shots;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.active) continue;
      const p = s.mesh.position;
      const dx = s.target.pos.x - p.x;
      const dy = s.y - p.y;
      const dz = s.target.pos.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const step = s.speed * dt;
      if (d <= step || d < 0.05) {
        s.active = false;
        s.target = null;
        s.mesh.visible = false;
        continue;
      }
      const k = step / d;
      p.x += dx * k; p.y += dy * k; p.z += dz * k;
    }
  }

  activeCount() {
    let n = 0;
    for (let i = 0; i < this.shots.length; i++) if (this.shots[i].active) n++;
    return n;
  }

  clear() {
    const list = this.shots;
    for (let i = 0; i < list.length; i++) {
      list[i].active = false;
      list[i].target = null;
      list[i].mesh.visible = false;
    }
  }

  dispose() { for (let i = 0; i < this._offs.length; i++) this._offs[i](); }
}
