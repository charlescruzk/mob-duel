// ParticleSystem (PHASE2.md §5): ONE THREE.Points for the whole match. All state is
// flat Float32Arrays pre-allocated here — round-robin emit overwrites the oldest —
// so emitting and simulating allocate nothing. Additive soft-circle points, size
// attenuated, alpha from remaining life. fx/ never touches sim state.
import * as THREE from 'three';

const VERT = [
  'attribute float aSize;',
  'attribute float aAlpha;',
  'attribute vec3 aColor;',
  'varying float vAlpha;',
  'varying vec3 vColor;',
  'void main() {',
  '  vAlpha = aAlpha;',
  '  vColor = aColor;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = aSize * (220.0 / max(1.0, -mv.z));',
  '  gl_Position = projectionMatrix * mv;',
  '}'].join('\n');

const FRAG = [
  'varying float vAlpha;',
  'varying vec3 vColor;',
  'void main() {',
  '  float d = length(gl_PointCoord - vec2(0.5));',
  '  float a = vAlpha * smoothstep(0.5, 0.15, d);',
  '  if (a < 0.01) discard;',
  '  gl_FragColor = vec4(vColor, a);',
  '}'].join('\n');

const FLOOR_Y = 0.06;              // particles never sink into the ground plane

export class ParticleSystem {
  constructor(scene, max = 3000) {
    this.max = max;
    const n3 = max * 3;
    this.pos = new Float32Array(n3);
    this.vel = new Float32Array(n3);
    this.col = new Float32Array(n3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this._head = 0;
    this._color = new THREE.Color();

    const geo = new THREE.BufferGeometry();
    this._attrs = {
      position: new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
      aColor: new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
      aSize: new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
      aAlpha: new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    };
    geo.setAttribute('position', this._attrs.position);
    geo.setAttribute('aColor', this._attrs.aColor);
    geo.setAttribute('aSize', this._attrs.aSize);
    geo.setAttribute('aAlpha', this._attrs.aAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 500);  // never re-culled
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    if (scene) scene.add(this.points);
    this._geo = geo;
  }

  alive() {
    let n = 0;
    const life = this.life;
    for (let i = 0; i < this.max; i++) if (life[i] > 0) n++;
    return n;
  }

  // Write one particle at the ring head and advance it. r/g/b come pre-scaled 0..1.
  _spawn(x, y, z, r, g, b, vx, vy, vz, life, size, grav, drag) {
    const i = this._head;
    this._head = i + 1 === this.max ? 0 : i + 1;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.alpha[i] = 1;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  _rgb(hex) { this._color.setHex(hex); return this._color; }

  // Radial puff with an upward bias (impacts, casts, deaths).
  burst(x, y, z, hex, count, speed, up, life, size) {
    const c = this._rgb(hex);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const p = Math.random() * Math.PI - Math.PI / 2;   // -pi/2..pi/2, flattened below
      const s = speed * (0.5 + Math.random() * 0.5);
      const cs = Math.cos(p) * s;
      this._spawn(x, y, z, c.r, c.g, c.b,
        Math.cos(a) * cs, Math.abs(Math.sin(p)) * s * up + 0.4, Math.sin(a) * cs,
        life * (0.7 + Math.random() * 0.6), size, 6, 2.5);
    }
  }

  // Expanding horizontal ring at ground height (level-ups, buffs, zones).
  ring(x, z, hex, count, radius, speed, life, size) {
    const c = this._rgb(hex);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.2;
      const px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      this._spawn(px, FLOOR_Y, pz, c.r, c.g, c.b,
        Math.cos(a) * speed, 0.3, Math.sin(a) * speed, life, size, -0.4, 1.5);
    }
  }

  // Rising column (recall channel, ultimate wind-ups, fountains).
  column(x, z, hex, count, height, life, size) {
    const c = this._rgb(hex);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.5;
      this._spawn(x + Math.cos(a) * r, Math.random() * height * 0.3, z + Math.sin(a) * r,
        c.r, c.g, c.b,
        (Math.random() - 0.5) * 0.4, 2.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.4,
        life * (0.8 + Math.random() * 0.4), size, -0.5, 0.8);
    }
  }

  // One spark per call — projectile trails call this every frame per live projectile.
  trail(x, y, z, hex, size) {
    const c = this._rgb(hex);
    this._spawn(x, y, z, c.r, c.g, c.b,
      (Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.4, (Math.random() - 0.5) * 0.6,
      0.35, size, 0, 4);
  }

  // Same as trail but from a live THREE.Color (projectile meshes carry their colour).
  trailRgb(x, y, z, c, size) {
    this._spawn(x, y, z, c.r, c.g, c.b,
      (Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, (Math.random() - 0.5) * 0.6,
      0.35, size, 0, 4);
  }

  update(dt) {
    const pos = this.pos, vel = this.vel, life = this.life, maxLife = this.maxLife;
    const alpha = this.alpha, grav = this.grav, drag = this.drag;
    for (let i = 0; i < this.max; i++) {
      const l = life[i];
      if (l <= 0) continue;
      const nl = l - dt;
      if (nl <= 0) { life[i] = 0; alpha[i] = 0; continue; }
      life[i] = nl;
      const i3 = i * 3;
      const d = 1 - drag[i] * dt;
      let vy = (vel[i3 + 1] - grav[i] * dt) * d;
      if (vy < -8) vy = -8;
      vel[i3 + 1] = vy;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vy * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < FLOOR_Y) pos[i3 + 1] = FLOOR_Y;
      alpha[i] = nl / maxLife[i];
    }
    // One needsUpdate per attribute per frame.
    const a = this._attrs;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
    this.alpha.fill(0);
    this._attrs.aAlpha.needsUpdate = true;
  }
}