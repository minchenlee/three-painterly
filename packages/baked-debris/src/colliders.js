/**
 * Collision helpers. A collider is any function (x, y, z) => boolean in world units.
 */

/** Voxel grid collider: `get(ix, iy, iz)` returns a truthy value for filled cells of size `cell`, starting at `origin`. */
export function voxelCollider(get, cell = 1, origin = [0, 0, 0]) {
  return (x, y, z) => !!get(Math.floor((x - origin[0]) / cell), Math.floor((y - origin[1]) / cell), Math.floor((z - origin[2]) / cell));
}

/** Axis-aligned boxes: [{ min: [x, y, z], max: [x, y, z] }, ...]. */
export function boxCollider(boxes) {
  return (x, y, z) => boxes.some(b => x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]);
}

/** Combine several colliders. */
export function anyCollider(...fs) { return (x, y, z) => fs.some(f => f(x, y, z)); }
