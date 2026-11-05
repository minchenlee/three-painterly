/**
 * Turn a three.js mesh into BakedDebris pieces: one cube per grid cell inside the mesh.
 */
import { Color } from 'three';

const MAX_CELLS = 1 << 26;   // 64M cells = 64 MB of grid

/**
 * meshToPieces(mesh, { size = 0.25, fill = 'volume', color })
 * - Cells are `size` cubes on a world grid: cell (i, j, k) spans [i * size, (i + 1) * size) on x, and so on.
 *   A cell is a piece when its centre is inside the mesh (world space, from mesh.matrixWorld).
 * - fill 'volume' keeps every cell inside; 'surface' keeps only inside cells with an empty neighbour (a shell one cell thick).
 * - The mesh must be closed (watertight). Each grid column (x, z) is intersected with the triangles once; inside is
 *   between the 1st and 2nd hit, the 3rd and 4th, and so on.
 * - Colour: `color(x, y, z)` if given; else the colour of the nearer surface straight above or below the cell:
 *   the material colour, times the interpolated vertex colour when the geometry has a `color` attribute.
 * Deterministic: the same mesh and options give the same pieces in the same order.
 */
export function meshToPieces(mesh, { size = 0.25, fill = 'volume', color = null } = {}) {
  if (!(size > 0) || !Number.isFinite(size)) throw new Error(`meshToPieces: size must be a positive number, got ${size}`);
  if (fill !== 'volume' && fill !== 'surface') throw new Error(`meshToPieces: fill must be 'volume' or 'surface', got ${JSON.stringify(fill)}`);
  if (color !== null && typeof color !== 'function') throw new Error('meshToPieces: color must be a function (x, y, z) => colour');
  const g = mesh.geometry, pos = g?.attributes?.position;
  if (!pos) throw new Error('meshToPieces: the mesh has no position attribute');

  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements, nv = pos.count, P = new Float64Array(nv * 3);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let v = 0; v < nv; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    P[v * 3] = wx; P[v * 3 + 1] = wy; P[v * 3 + 2] = wz;
    if (wx < x0) x0 = wx; if (wy < y0) y0 = wy; if (wz < z0) z0 = wz;
    if (wx > x1) x1 = wx; if (wy > y1) y1 = wy; if (wz > z1) z1 = wz;
  }
  if (!(x0 <= x1)) return [];

  // grid: cell (i, j, k) has its centre at ((I0 + i + 0.5) * size, ...)
  const s = size, I0 = Math.floor(x0 / s), J0 = Math.floor(y0 / s), K0 = Math.floor(z0 / s);
  const nx = Math.max(1, Math.ceil(x1 / s) - I0), ny = Math.max(1, Math.ceil(y1 / s) - J0), nz = Math.max(1, Math.ceil(z1 / s) - K0);
  if (nx * ny * nz > MAX_CELLS) throw new Error(`meshToPieces: ${nx}x${ny}x${nz} cells is too many for size ${size}; use a larger size`);

  // triangles, with their material colour
  const idx = g.index, vid = idx ? (t) => idx.getX(t) : (t) => t;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const ranges = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : nv, materialIndex: 0 }];
  const vcol = color ? null : g.attributes.color ?? null, fallback = new Color(0xcccccc);

  // 1. rasterise every triangle onto the (x, z) column centres; one hit per column it covers
  const hCol = [], hY = [], hR = [], hG = [], hB = [];
  for (const r of ranges) {
    const mc = mats[r.materialIndex ?? 0]?.color ?? fallback;
    const end = Math.min(r.start + r.count, idx ? idx.count : nv);
    for (let t = r.start; t + 2 < end; t += 3) {
      let a = vid(t), b = vid(t + 1), c = vid(t + 2);
      if (edge(P, a, b, P[c * 3], P[c * 3 + 2]) < 0) { const tmp = b; b = c; c = tmp; }
      if (!(edge(P, a, b, P[c * 3], P[c * 3 + 2]) > 0)) continue;   // seen edge-on from above: no column crosses it
      const ax = P[a * 3], bx = P[b * 3], cx = P[c * 3], az = P[a * 3 + 2], bz = P[b * 3 + 2], cz = P[c * 3 + 2];
      const iLo = Math.max(0, Math.ceil(Math.min(ax, bx, cx) / s - I0 - 0.5)), iHi = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) / s - I0 - 0.5));
      const kLo = Math.max(0, Math.ceil(Math.min(az, bz, cz) / s - K0 - 0.5)), kHi = Math.min(nz - 1, Math.floor(Math.max(az, bz, cz) / s - K0 - 0.5));
      for (let k = kLo; k <= kHi; k++) {
        const pz = (K0 + k + 0.5) * s;
        for (let i = iLo; i <= iHi; i++) {
          const px = (I0 + i + 0.5) * s;
          const wa = edge(P, b, c, px, pz), wb = edge(P, c, a, px, pz), wc = edge(P, a, b, px, pz);
          if (!inside(wa, P, b, c) || !inside(wb, P, c, a) || !inside(wc, P, a, b)) continue;
          const w = wa + wb + wc;
          hCol.push(i + nx * k);
          hY.push((wa * P[a * 3 + 1] + wb * P[b * 3 + 1] + wc * P[c * 3 + 1]) / w);
          if (color) continue;
          let cr = mc.r, cg = mc.g, cb = mc.b;
          if (vcol) {
            cr *= (wa * vcol.getX(a) + wb * vcol.getX(b) + wc * vcol.getX(c)) / w;
            cg *= (wa * vcol.getY(a) + wb * vcol.getY(b) + wc * vcol.getY(c)) / w;
            cb *= (wa * vcol.getZ(a) + wb * vcol.getZ(b) + wc * vcol.getZ(c)) / w;
          }
          hR.push(cr); hG.push(cg); hB.push(cb);
        }
      }
    }
  }

  // 2. group the hits per column (counting sort, stable), then by height
  const nCol = nx * nz, start = new Int32Array(nCol + 1), order = new Int32Array(hCol.length);
  for (const col of hCol) start[col + 1]++;
  for (let q = 0; q < nCol; q++) start[q + 1] += start[q];
  const fillAt = start.slice(0, nCol);
  for (let h = 0; h < hCol.length; h++) order[fillAt[hCol[h]]++] = h;
  for (let q = 0; q < nCol; q++) if (start[q + 1] - start[q] > 1) {
    const part = Array.from(order.subarray(start[q], start[q + 1])).sort((u, v) => hY[u] - hY[v] || u - v);
    order.set(part, start[q]);
  }

  // 3. inside = between hit 1 and 2, 3 and 4, ... (a cell centre at y counts when y0 <= y < y1)
  const grid = new Uint8Array(nx * ny * nz), cellOf = (i, j, k) => i + nx * (j + ny * k);
  const spans = (q, fn) => {
    const n = start[q + 1] - start[q];
    for (let h = 0; h + 1 < n; h += 2) {   // an odd hit count (open mesh) drops the last hit
      const lo = order[start[q] + h], hi = order[start[q] + h + 1];
      const jLo = Math.max(0, Math.ceil(hY[lo] / s - J0 - 0.5)), jHi = Math.min(ny - 1, Math.ceil(hY[hi] / s - J0 - 0.5) - 1);
      for (let j = jLo; j <= jHi; j++) fn(j, lo, hi);
    }
  };
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) spans(i + nx * k, (j) => { grid[cellOf(i, j, k)] = 1; });

  // 4. pieces, column by column, bottom to top
  const filled = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && grid[cellOf(i, j, k)] === 1;
  const pieces = [];
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) spans(i + nx * k, (j, lo, hi) => {
    if (fill === 'surface' && filled(i - 1, j, k) && filled(i + 1, j, k) && filled(i, j - 1, k) && filled(i, j + 1, k)
      && filled(i, j, k - 1) && filled(i, j, k + 1)) return;
    const x = (I0 + i + 0.5) * s, y = (J0 + j + 0.5) * s, z = (K0 + k + 0.5) * s;
    let c;
    if (color) c = color(x, y, z);
    else { const h = y - hY[lo] <= hY[hi] - y ? lo : hi; c = new Color(hR[h], hG[h], hB[h]); }
    pieces.push({ position: [x, y, z], size: s, color: c });
  });
  return pieces;
}

// Edge function of the directed edge u -> v at (px, pz), seen from above (x, z). It is computed from the
// lexicographically smaller end, so edge(u, v) === -edge(v, u) exactly and two triangles that share an edge agree.
function edge(P, u, v, px, pz) {
  const ux = P[u * 3], uz = P[u * 3 + 2], vx = P[v * 3], vz = P[v * 3 + 2];
  if (ux < vx || (ux === vx && uz <= vz)) return (vx - ux) * (pz - uz) - (vz - uz) * (px - ux);
  return -((ux - vx) * (pz - vz) - (uz - vz) * (px - vx));
}
// A column exactly on an edge belongs to one of the two triangles that share it (the edge's direction decides).
function inside(w, P, u, v) {
  if (w !== 0) return w > 0;
  const dz = P[v * 3 + 2] - P[u * 3 + 2];
  return dz > 0 || (dz === 0 && P[v * 3] - P[u * 3] > 0);
}
