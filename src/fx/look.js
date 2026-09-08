// Look — the rendering layer: shadow mapping, tone mapping, sky/fog, the cool fill
// light and the bloom composer. Applied from engine.js: the engine is the render
// layer, so this is the one fx/ import a core/ file makes (sim never imports fx/).
// `?lowfx` strips the shadow map and the composer so software-GL harnesses stay fast;
// visuals degrade, nothing about the sim changes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeSkyTexture } from '../map/textures.js';

// Fog colour = sky horizon, so distant ground melts into the sky band.
export const SKY_ZENITH = 0x24425f;
export const SKY_HORIZON = 0xa8c4de;

export class Look {
  constructor(engine, lowfx) {
    this.engine = engine;
    this.lowfx = lowfx;
    const scene = engine.scene;
    const renderer = engine.renderer;

    // Filmic tone mapping applies on both paths (OutputPass reads it for the composer).
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene.background = makeSkyTexture(SKY_ZENITH, SKY_HORIZON);
    scene.fog.color.setHex(SKY_HORIZON);

    // The directional light's target must live in the scene for its matrixWorld (and
    // therefore the light direction) to follow the player. The fill shares that
    // target from the opposite side, so shadowed faces stay readable, not blue-black.
    this.fill = new THREE.DirectionalLight(0x6a86c8, 0.55);
    this.fill.target = engine.sun.target;
    scene.add(this.fill);
    scene.add(engine.sun.target);

    const sun = engine.sun;
    if (!lowfx) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;             // ortho frustum around the player
      c.left = -40; c.right = 40; c.top = 40; c.bottom = -40;
      c.near = 1; c.far = 160;
      c.updateProjectionMatrix();
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }

    this.composer = null;
    if (!lowfx) {
      const size = new THREE.Vector2(window.innerWidth || 1, window.innerHeight || 1);
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(scene, engine.camera));
      this.composer.addPass(new UnrealBloomPass(size, 0.6, 0.4, 0.9));   // strength, radius, threshold
      this.composer.addPass(new OutputPass());
    }

    this._target = null;   // the player hero's pos Vector3, held by reference
  }

  // The shadow frustum tracks this position; the sim mutates the Vector3 in place.
  follow(pos) { this._target = pos; }

  // Engine calls this every frame after the step, before the render.
  preRender() {
    const t = this._target;
    if (!t) return;
    const sun = this.engine.sun;
    sun.position.set(t.x + 20, 40, t.z + 10);
    sun.target.position.set(t.x, 0, t.z);
    this.fill.position.set(t.x - 20, 30, t.z - 10);
  }

  resize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.engine.renderer.render(this.engine.scene, this.engine.camera);
  }
}