// EffectViews — meshes for the sim's projectile, ring and zone records. Pools are
// index-aligned with `effects` (same sizes, built once); update() mirrors every
// record into its mesh. The sim never sees these objects.
import * as THREE from 'three';
import { PROJECTILE_POOL, RING_POOL, ZONE_POOL } from '../../sim/hero/effects.js';

const ZONE_Y = 0.04;

export class EffectViews {
  constructor(scene, effects) {
    this.effects = effects;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.projectiles = [];
    this.rings = [];
    this.zones = [];
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < PROJECTILE_POOL; i++) {
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      m.userData.color = 0xffffff;
      this.group.add(m);
      this.projectiles.push(m);
    }
    const ring = new THREE.RingGeometry(0.82, 1.0, 40);
    for (let i = 0; i < RING_POOL; i++) this.rings.push(this._disc(ring, 0.05, 0.8));
    const disc = new THREE.CircleGeometry(1, 32);
    for (let i = 0; i < ZONE_POOL; i++) this.zones.push(this._disc(disc, ZONE_Y, 0.3));
  }

  _disc(geometry, y, opacity) {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.visible = false;
    m.userData.color = 0xffffff;
    this.group.add(m);
    return m;
  }

  update() {
    const fx = this.effects;
    const ps = fx.projectiles, pm = this.projectiles;
    for (let i = 0; i < pm.length; i++) {
      const p = ps[i], m = pm[i];
      m.visible = p.active;
      if (!p.active) continue;
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      m.scale.setScalar(p.radius);
      if (m.userData.color !== p.color) { m.userData.color = p.color; m.material.color.setHex(p.color); }
    }
    this._syncDiscs(fx.rings, this.rings);
    this._syncDiscs(fx.zones, this.zones);
  }

  _syncDiscs(recs, meshes) {
    for (let i = 0; i < meshes.length; i++) {
      const d = recs[i], m = meshes[i];
      m.visible = d.active;
      if (!d.active) continue;
      m.position.x = d.x; m.position.z = d.z;
      m.scale.set(d.radius, d.radius, 1);
      m.material.opacity = d.alpha;
      if (m.userData.color !== d.color) { m.userData.color = d.color; m.material.color.setHex(d.color); }
    }
  }
}
