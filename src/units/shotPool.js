// Pooled, purely visual shot tracers: a small sphere that flies from a launch point to
// a unit and vanishes on arrival. Damage is applied by the shooter at fire time
// (hitscan), so this file never touches HP — it only makes towers and ranged minions
// legible. One module-level pool serves every shooter; WaveSpawner.update ticks it.
import { makeShotMesh, shotMaterial, hitHeight } from './unitMeshes.js';

const POOL_SIZE = 48;

class ShotPool {
  constructor() {
    this.scene = null;
    this.shots = [];
    this.next = 0;
  }

  // Idempotent; the first shooter (or the spawner) hands over the scene.
  attach(scene) {
    if (this.scene || !scene) return;
    this.scene = scene;
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = makeShotMesh('blue');
      scene.add(mesh);
      this.shots.push({ mesh, active: false, target: null, y: 0, speed: 1 });
    }
  }

  // Launches toward `target` (a Unit; followed live so homing shots track a walker).
  fire(team, fromX, fromY, fromZ, target, speed) {
    if (!this.scene || !target) return;
    const s = this.shots[this.next];
    this.next = (this.next + 1) % POOL_SIZE;
    s.active = true;
    s.target = target;
    s.y = hitHeight(target);
    s.speed = speed;
    s.mesh.material = shotMaterial(team);
    s.mesh.position.set(fromX, fromY, fromZ);
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

  clear() {
    const list = this.shots;
    for (let i = 0; i < list.length; i++) {
      list[i].active = false;
      list[i].target = null;
      list[i].mesh.visible = false;
    }
  }
}

export const shots = new ShotPool();
