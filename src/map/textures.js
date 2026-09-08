// Procedural canvas textures. Built once at load; nothing here runs per frame.
import * as THREE from 'three';

// Small deterministic hash so the textures look the same on every boot.
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function finish(canvas, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Mossy dirt with faint grid lines every 32 px so distance is readable in the lane.
export function makeGroundTexture(repeatX = 12, repeatY = 25) {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  g.fillStyle = '#3f4a35';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const n = hash(x, y, 7);
      const v = 52 + Math.floor(n * 28);
      g.fillStyle = `rgb(${v + 6},${v + 14},${v - 6})`;
      g.fillRect(x, y, 4, 4);
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i <= size; i += 32) {
    g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, size); g.stroke();
    g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(size, i + 0.5); g.stroke();
  }
  return finish(c, repeatX, repeatY);
}

// Grey stone blocks with mortar lines for the jungle walls.
export function makeStoneTexture(repeatX = 2, repeatY = 1) {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2c30';
  g.fillRect(0, 0, size, size);
  const bw = 64, bh = 32;
  for (let row = 0; row < size / bh; row++) {
    const off = (row & 1) ? bw / 2 : 0;
    for (let col = -1; col < size / bw + 1; col++) {
      const x = col * bw + off;
      const y = row * bh;
      const n = hash(col + 3, row + 5, 11);
      const v = 96 + Math.floor(n * 40);
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + 2, y + 2, bw - 4, 3);
    }
  }
  return finish(c, repeatX, repeatY);
}

// Flat tinted disc for fountain zones and base pads.
export function makeDiscTexture(hex) {
  const size = 128;
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const col = '#' + hex.toString(16).padStart(6, '0');
  grad.addColorStop(0, col + 'cc');
  grad.addColorStop(0.85, col + '66');
  grad.addColorStop(1, col + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
