// Vec3 — the sim's position/velocity type. Deliberately tiny: the sim only ever
// reads x/y/z, `set` and `copy`. Three.js Vector3.copy() accepts any {x,y,z}, so a
// mesh can mirror a Vec3 without the sim importing three (docs/NETCODE.md).
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}
