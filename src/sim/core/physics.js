// Flat-ground (y = 0) XZ physics helpers. Every function here is allocation-free and
// mutates the given Vector3 positions in place. Units are circles; walls are AABBs
// given as { min: Vector3, max: Vector3 }; the lane is a rectangle of walkable centres.

export function distXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distSqXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function inRangeXZ(a, b, r) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz <= r * r;
}

// Push overlapping alive units apart. Split is by radius (bigger unit moves less);
// a unit flagged `isStatic` (tower, nexus) never moves — the other takes 100%.
// O(n²) over the array; fine for the ~100-unit budget in DESIGN.md §4.
export function separateCircles(units) {
  const n = units.length;
  for (let i = 0; i < n; i++) {
    const a = units[i];
    if (!a.alive || a.noCollide) continue;
    for (let j = i + 1; j < n; j++) {
      const b = units[j];
      if (!b.alive || b.noCollide) continue;
      if (a.isStatic && b.isStatic) continue;
      const minD = a.radius + b.radius;
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      let d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      if (d2 < 1e-8) { dx = 1e-3 * ((i & 1) ? 1 : -1); dz = 1e-3; d2 = dx * dx + dz * dz; }
      const d = Math.sqrt(d2);
      const overlap = minD - d;
      const nx = dx / d;
      const nz = dz / d;
      if (a.isStatic) {
        b.pos.x += nx * overlap; b.pos.z += nz * overlap;
      } else if (b.isStatic) {
        a.pos.x -= nx * overlap; a.pos.z -= nz * overlap;
      } else {
        const wa = b.radius / minD;   // a moves proportionally to b's size
        const wb = a.radius / minD;
        a.pos.x -= nx * overlap * wa; a.pos.z -= nz * overlap * wa;
        b.pos.x += nx * overlap * wb; b.pos.z += nz * overlap * wb;
      }
    }
  }
}

// Resolve one circle against a list of AABBs (XZ only; boxes are y-agnostic).
// Returns true if any push-out happened (dashes use this to stop early).
export function resolveCircleVsBoxes(pos, radius, boxes) {
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = pos.x < b.min.x ? b.min.x : (pos.x > b.max.x ? b.max.x : pos.x);
    const cz = pos.z < b.min.z ? b.min.z : (pos.z > b.max.z ? b.max.z : pos.z);
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 < 1e-8) {
      // Centre inside the box: push out through the nearest face.
      const toMinX = pos.x - b.min.x, toMaxX = b.max.x - pos.x;
      const toMinZ = pos.z - b.min.z, toMaxZ = b.max.z - pos.z;
      const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      if (m === toMinX) pos.x = b.min.x - radius;
      else if (m === toMaxX) pos.x = b.max.x + radius;
      else if (m === toMinZ) pos.z = b.min.z - radius;
      else pos.z = b.max.z + radius;
      continue;
    }
    const d = Math.sqrt(d2);
    const push = radius - d;
    dx /= d; dz /= d;
    pos.x += dx * push;
    pos.z += dz * push;
  }
  return hit;
}

// Hard clamp of a unit centre to the walkable rectangle, inset by its radius.
// bounds = { minX, maxX, minZ, maxZ }. Returns true if clamped.
export function clampToBounds(pos, radius, bounds) {
  let c = false;
  const x0 = bounds.minX + radius, x1 = bounds.maxX - radius;
  const z0 = bounds.minZ + radius, z1 = bounds.maxZ - radius;
  if (pos.x < x0) { pos.x = x0; c = true; } else if (pos.x > x1) { pos.x = x1; c = true; }
  if (pos.z < z0) { pos.z = z0; c = true; } else if (pos.z > z1) { pos.z = z1; c = true; }
  return c;
}
