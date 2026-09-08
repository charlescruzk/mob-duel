// Engine — renderer, scene, camera, lights, resize and the frame loop. Owns nothing
// game-specific. `start(cb)` calls cb(dt) every animation frame with dt clamped so a
// backgrounded tab does not produce a giant step on return.
import * as THREE from 'three';

const MAX_DT = 0.05;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1218);
    this.scene.fog = new THREE.Fog(0x0e1218, 60, 140);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    this.camera.position.set(0, 6, 44);

    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    this.sun.position.set(20, 40, 10);
    this.scene.add(this.sun);
    this.ambient = new THREE.HemisphereLight(0x8fb4e8, 0x3a2f24, 0.9);
    this.scene.add(this.ambient);

    // Called with the thrown error if the frame callback throws; the loop stops so the
    // page shows one error instead of one per frame.
    this.onError = null;
    this.running = false;
    this.frame = 0;
    this._last = 0;
    this._cb = null;
    this._tick = (now) => this._onFrame(now);
    this._onResize = () => this.resize();

    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(cb) {
    this._cb = cb;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  _onFrame(now) {
    if (!this.running) return;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (dt < 0) dt = 0;
    try {
      this._cb(dt);
      this.render();
    } catch (err) {
      this.running = false;
      if (this.onError) this.onError(err);
      else throw err;
      return;
    }
    this.frame++;
    requestAnimationFrame(this._tick);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
