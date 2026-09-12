// Shared cel-look material helpers (Task 9). Lives in map/ because map/ is the one
// folder every mesh builder may import — this keeps heroMesh/unitMeshes (sim folders)
// from importing fx/. Built once at first use; nothing here runs per frame.
import * as THREE from 'three';

let gradientMap = null;

// 4-step luminance ramp. MeshToonMaterial samples only the red channel, so one byte
// per texel (RedFormat, WebGL2) is enough; NearestFilter keeps the bands hard.
export function toonGradient() {
  if (!gradientMap) {
    const data = new Uint8Array([64, 128, 192, 255]);
    gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

export function toonMat(colorHex, transparent) {
  const m = new THREE.MeshToonMaterial({ color: colorHex, gradientMap: toonGradient() });
  if (transparent) m.transparent = true;
  return m;
}

// Inverted-hull outline: an inflated back-face copy of the mesh, added once per
// builder and named 'outline' so the probe can find it. The caller may pass its own
// material (the hero outline fades with stealth, so it cannot be shared).
const OUTLINE_COLOR = 0x101216;
export function addOutline(mesh, scale, mat) {
  const o = new THREE.Mesh(mesh.geometry, mat || new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR, side: THREE.BackSide,
  }));
  o.name = 'outline';
  o.scale.setScalar(scale || 1.04);
  o.castShadow = false;
  mesh.add(o);
  return o;
}