/**
 * Collision helpers. A collider is any function (x, y, z) => boolean in world units.
 */

/** Voxel grid collider: `get(ix, iy, iz)` returns a truthy value for filled cells of size `cell`, starting at `origin`. */
// `get` is called millions of times: index a typed array (i + nx * (j + ny * k)), not a Set of "i,j,k" strings.
export function voxelCollider(get, cell = 1, origin = [0, 0, 0]) {
  const [ox, oy, oz] = origin;
  return (x, y, z) => !!get(Math.floor((x - ox) / cell), Math.floor((y - oy) / cell), Math.floor((z - oz) / cell));
}

// Colliders run for every probe of every step of every piece (millions of calls per bake),
// so they use plain loops and no per-call closures.

/** Axis-aligned boxes: [{ min: [x, y, z], max: [x, y, z] }, ...]. */
export function boxCollider(boxes) {
  const n = boxes.length, B = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) B.set([...boxes[i].min, ...boxes[i].max], i * 6);
  return (x, y, z) => {
    for (let o = 0; o < n * 6; o += 6) if (x >= B[o] && y >= B[o + 1] && z >= B[o + 2] && x <= B[o + 3] && y <= B[o + 4] && z <= B[o + 5]) return true;
    return false;
  };
}

/** Combine several colliders. */
export function anyCollider(...fs) {
  return (x, y, z) => { for (let i = 0; i < fs.length; i++) if (fs[i](x, y, z)) return true; return false; };
}
