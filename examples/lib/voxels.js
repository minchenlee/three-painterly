// Voxel tools shared by the examples: a hash, a palette, a grid, and a mesher with baked ambient occlusion.
// Not part of any package. It serves the examples and may change with them.
import { BufferAttribute, BufferGeometry, Color } from 'three';

/** A hash of up to three integers, 0..1. The same input gives the same output, so worlds build the same every time. */
export function h01(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
/** A seeded random generator: mulberry32(seed)() gives 0..1. */
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * A palette of up to 255 colours. Voxels hold an index into it; index 0 is empty.
 * def('GRASS1 GRASS2', 0x669848, 0x71a24e) adds colours and names them: C.GRASS1 is the index.
 * PAL[i] is the linear RGB the mesher writes; HEX[i] is the sRGB hex, for BakedDebris piece colours.
 */
export function createPalette() {
  const PAL = [[0, 0, 0]], HEX = [0], C = {};
  function def(names, ...hexes) {
    names.split(' ').forEach((n, i) => {
      if (n in C) throw new Error(`palette: "${n}" is defined twice`);
      if (PAL.length > 255) throw new Error('palette: more than 255 colours');
      const c = new Color(hexes[i]); C[n] = PAL.length; PAL.push([c.r, c.g, c.b]); HEX.push(hexes[i]);
    });
  }
  return { PAL, HEX, C, def };
}

/**
 * A dense grid of palette indices, one byte per voxel. Cell (x, y, z) runs from -ox to nx - ox - 1 on x, and so on.
 * get returns 0 outside the grid; set and setE (set if empty) do nothing there.
 * box fills a block, both ends included; its colour can be a function (x, y, z) => index.
 */
export function createGrid(nx, ny, nz, ox = 0, oy = 0, oz = 0) {
  const data = new Uint8Array(nx * ny * nz);
  const index = (x, y, z) => ((x + ox) * ny + (y + oy)) * nz + (z + oz);
  const ok = (x, y, z) => x >= -ox && x < nx - ox && y >= -oy && y < ny - oy && z >= -oz && z < nz - oz;
  const get = (x, y, z) => (ok(x, y, z) ? data[index(x, y, z)] : 0);
  const set = (x, y, z, c) => { if (ok(x, y, z)) data[index(x, y, z)] = c; };
  const setE = (x, y, z, c) => { if (ok(x, y, z) && !data[index(x, y, z)]) data[index(x, y, z)] = c; };
  const box = (x0, x1, y0, y1, z0, z1, c) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c); };
  return { data, nx, ny, nz, min: [0 - ox, 0 - oy, 0 - oz], max: [nx - ox, ny - oy, nz - oz], index, ok, get, set, setE, box };
}

/* ---------- small models ---------- */
/**
 * A sparse set of voxels for a small model (a figure, a boat, a tree): createModel(detail). Cells are integers from -512
 * to 511 on each axis; shapes take fractional centres and radii and fill the cells whose centres fall inside.
 * With detail 2 or 3 the same calls give a model twice or three times as fine; modelPieces keeps its size in the world.
 *   set(x, y, z, c), get(x, y, z)
 *   ellipsoid(cx, cy, cz, rx, ry, rz, c)      a solid ellipsoid
 *   box(x0, x1, y0, y1, z0, z1, c)            a block, both ends included
 *   line(a, b, c, r = 0.5)                    a rod from point a to point b ([x, y, z]), radius r
 *   dome(cx, cy, cz, r, h, c)                 a thin cap, like the cover of a parasol: radius r, height h, open below
 */
export function createModel(detail = 1) {
  // detail: every unit of the shapes below becomes `detail` voxels, so the same builder gives a finer model
  const cells = new Map(), d = detail, f = v => v * d + (d - 1) / 2;   // a coarse coordinate -> the middle of its block of fine cells
  const key = (x, y, z) => (x + 512) + (y + 512) * 1024 + (z + 512) * 1048576;
  const put = (x, y, z, c) => { const k = key(x, y, z); if (c) cells.set(k, c); else cells.delete(k); };
  const set = (x, y, z, c) => { const X = Math.round(x) * d, Y = Math.round(y) * d, Z = Math.round(z) * d; for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) for (let k = 0; k < d; k++) put(X + i, Y + j, Z + k, c); };
  const get = (x, y, z) => cells.get(key(x, y, z)) || 0;                // fine cells
  const coarse = v => Math.floor(v / d);
  const ellipsoid = (cx, cy, cz, rx, ry, rz, c) => {
    const X = f(cx), Y = f(cy), Z = f(cz), RX = rx * d, RY = ry * d, RZ = rz * d;
    for (let x = Math.ceil(X - RX); x <= Math.floor(X + RX); x++) for (let y = Math.ceil(Y - RY); y <= Math.floor(Y + RY); y++) for (let z = Math.ceil(Z - RZ); z <= Math.floor(Z + RZ); z++)
      if (((x - X) / RX) ** 2 + ((y - Y) / RY) ** 2 + ((z - Z) / RZ) ** 2 <= 1) put(x, y, z, typeof c === 'function' ? c(coarse(x), coarse(y), coarse(z)) : c);
  };
  const box = (x0, x1, y0, y1, z0, z1, c) => { for (let x = x0 * d; x < (x1 + 1) * d; x++) for (let y = y0 * d; y < (y1 + 1) * d; y++) for (let z = z0 * d; z < (z1 + 1) * d; z++) put(x, y, z, typeof c === 'function' ? c(coarse(x), coarse(y), coarse(z)) : c); };
  const line = (a, b, c, r = 0.5) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 2 * d));
    for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      if (r * d <= 0.5) put(Math.round(f(x)), Math.round(f(y)), Math.round(f(z)), c); else ellipsoid(x, y, z, r, r, r, c); }
  };
  const dome = (cx, cy, cz, r, h, c) => {
    const X = f(cx), Z = f(cz), R = r * d, top = (x, z) => { const q = Math.hypot(x - X, z - Z) / R; return q <= 1 ? Math.round(f(cy) + h * d * Math.sqrt(1 - q * q)) : null; };
    for (let x = Math.ceil(X - R); x <= Math.floor(X + R); x++) for (let z = Math.ceil(Z - R); z <= Math.floor(Z + R); z++) {
      const y = top(x, z); if (y === null) continue;
      let low = y; for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = top(x + i, z + j); if (n !== null) low = Math.min(low, n + 1); }   // no gaps on the steep rim
      for (let yy = Math.min(low, y); yy <= y; yy++) put(x, yy, z, typeof c === 'function' ? c(x / d, z / d) : c);
    }
  };
  const each = fn => { for (const [k, c] of cells) fn((k % 1024) - 512, (Math.floor(k / 1024) % 1024) - 512, Math.floor(k / 1048576) - 512, c); };
  return { cells, detail, set, get, ellipsoid, box, line, dome, each };
}

/**
 * The voxels of a model that show a face, as BakedDebris pieces: [{ position, size, color, cell }].
 *   palette    { PAL } of createPalette()
 *   origin     where cell (0, 0, 0) starts, in world units; size: the edge of one unit of the model (one voxel at detail 1)
 *   turn       quarter turns about y (0..3); mirror: flip z first
 *   ao         bake ambient occlusion into each colour, as the mesher does (default true)
 * cell is the model cell [x, y, z], for ordering or grouping. Colours are sRGB hex numbers.
 */
export function modelPieces(model, { palette, origin = [0, 0, 0], size: unit = 1, turn = 0, mirror = false, ao = true }) {
  const size = unit / (model.detail || 1), out = [], col = new Color(), { get } = model, sol = (x, y, z) => (get(x, y, z) ? 1 : 0);
  const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], q = [0, 0, 0], o1 = [0, 0, 0], o2 = [0, 0, 0];
  model.each((x, y, z, c) => {
    let sum = 0, n = 0;
    for (const d of D) {
      if (sol(x + d[0], y + d[1], z + d[2])) continue;
      if (!ao) { n++; sum++; continue; }
      const k = d[0] ? 0 : (d[1] ? 1 : 2), ua = (k + 1) % 3, va = (k + 2) % 3;
      q[0] = x + d[0]; q[1] = y + d[1]; q[2] = z + d[2];
      for (const cu of [-1, 1]) for (const cv of [-1, 1]) {            // the four corners of this face
        o1[0] = q[0]; o1[1] = q[1]; o1[2] = q[2]; o2[0] = q[0]; o2[1] = q[1]; o2[2] = q[2]; o1[ua] += cu; o2[va] += cv;
        const s1 = sol(o1[0], o1[1], o1[2]), s2 = sol(o2[0], o2[1], o2[2]); o1[va] += cv; const s3 = sol(o1[0], o1[1], o1[2]);
        sum += AOV[(s1 && s2) ? 0 : 3 - (s1 + s2 + s3)]; n++;
      }
    }
    if (!n) return;                                                  // buried: never seen
    const b = sum / n, rgb = palette.PAL[c], zz = mirror ? -z : z;
    const [rx, rz] = [[x, zz], [-zz, x], [-x, -zz], [zz, -x]][turn & 3];
    out.push({ position: [origin[0] + (rx + 0.5) * size, origin[1] + (y + 0.5) * size, origin[2] + (rz + 0.5) * size], size, color: col.setRGB(rgb[0] * b, rgb[1] * b, rgb[2] * b).getHex(), cell: [x, y, z] });
  });
  return out;
}

/* ---------- mesher ---------- */
/** Brightness of a vertex with 0, 1, 2 or 3 open neighbours around its corner: the baked ambient occlusion. */
export const AOV = [0.5, 0.68, 0.84, 1.0];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const ORD_P = [[0, 0], [1, 0], [1, 1], [0, 1]], ORD_N = [[0, 0], [0, 1], [1, 1], [1, 0]];
const MAXF = 300000, GREEDY_MAX = 8;
let sP = null, sN = null, sC = null, sI = null, sE = null;   // scratch buffers, made on the first call and reused

/**
 * Mesh the voxels of a box: only the faces you can see, each vertex darkened by the voxels around its corner.
 * Neighbouring faces with the same colour and flat shading merge into one quad, up to 8 voxels (2 m at 25 cm) a side,
 * so per-vertex lighting and fog stay smooth.
 *
 *   at(x, y, z)   the palette index of a voxel, 0 = empty; called outside the box too, for neighbours
 *   lo, hi        the box: lo included, hi excluded, each [x, y, z]
 *   palette       PAL of createPalette()
 *   noBottomAt    faces that look down at y <= this are skipped (the underside of the ground)
 *   emis          optional (c, x, y, z) => [r, g, b, a] in bytes, or null: adds an "emis" attribute for a shader patch
 *   emisKey       optional: maps an emis value to a small number; faces merge only when it is equal (default: set or not)
 *
 * Returns a BufferGeometry in voxel units (position, normal, color, index, and emis if asked), or null when the box
 * shows no face. geometry.userData.faces is the number of quads. At most 300,000 quads per call: mesh in chunks.
 */
export function meshGrid(at, lo, hi, { palette, noBottomAt = -Infinity, emis = null, emisKey = em => (em ? 1 : 0) } = {}) {
  if (!palette) throw new Error('meshGrid: palette is required');
  if (!sP) { sP = new Float32Array(MAXF * 12); sN = new Int8Array(MAXF * 12); sC = new Float32Array(MAXF * 12); sI = new Uint32Array(MAXF * 6); }
  if (emis && !sE) sE = new Uint8Array(MAXF * 16);
  let nf = 0;
  const q = [0, 0, 0], o1 = [0, 0, 0], o2 = [0, 0, 0], ao = [0, 0, 0, 0], cell = [0, 0, 0], v = [0, 0, 0];
  const emit = (D, d, s, ua, va, ord, bx, by, bz, w, h, col, a4, em) => {
    if (nf >= MAXF) return;
    const vb = nf * 4;
    if (emis) for (let i = 0; i < 16; i++) sE[nf * 16 + i] = em ? em[i & 3] : 0;
    for (let i = 0; i < 4; i++) { const cu = ord[i][0], cv = ord[i][1];
      v[0] = bx; v[1] = by; v[2] = bz; if (s > 0) v[d] += 1; v[ua] += cu * w; v[va] += cv * h;
      const k = AOV[a4[i]], o = (vb + i) * 3;
      sP[o] = v[0]; sP[o + 1] = v[1]; sP[o + 2] = v[2]; sN[o] = D[0]; sN[o + 1] = D[1]; sN[o + 2] = D[2];
      sC[o] = col[0] * k; sC[o + 1] = col[1] * k; sC[o + 2] = col[2] * k; }
    const ii = nf * 6;                                             // split the quad along the diagonal that keeps the shading smooth
    if (a4[0] + a4[2] > a4[1] + a4[3]) { sI[ii] = vb; sI[ii + 1] = vb + 1; sI[ii + 2] = vb + 2; sI[ii + 3] = vb; sI[ii + 4] = vb + 2; sI[ii + 5] = vb + 3; }
    else { sI[ii] = vb + 1; sI[ii + 1] = vb + 2; sI[ii + 2] = vb + 3; sI[ii + 3] = vb + 1; sI[ii + 4] = vb + 3; sI[ii + 5] = vb; }
    nf++;
  };
  for (let f = 0; f < 6; f++) {
    const D = DIRS[f], d = f >> 1, s = (f & 1) ? -1 : 1, ua = (d + 1) % 3, va = (d + 2) % 3, ord = s > 0 ? ORD_P : ORD_N;
    const nu = hi[ua] - lo[ua], nv = hi[va] - lo[va], mask = new Int32Array(nu * nv);
    for (let sl = lo[d]; sl < hi[d]; sl++) {
      mask.fill(0);
      for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
        cell[d] = sl; cell[ua] = lo[ua] + a; cell[va] = lo[va] + b;
        const x = cell[0], y = cell[1], z = cell[2], c = at(x, y, z); if (!c) continue;
        if (at(x + D[0], y + D[1], z + D[2])) continue; if (f === 3 && y <= noBottomAt) continue;
        q[0] = x + D[0]; q[1] = y + D[1]; q[2] = z + D[2];
        for (let i = 0; i < 4; i++) { const cu = ord[i][0], cv = ord[i][1];
          o1[0] = q[0]; o1[1] = q[1]; o1[2] = q[2]; o1[ua] += cu ? 1 : -1;
          o2[0] = q[0]; o2[1] = q[1]; o2[2] = q[2]; o2[va] += cv ? 1 : -1;
          const s1 = at(o1[0], o1[1], o1[2]) ? 1 : 0, s2 = at(o2[0], o2[1], o2[2]) ? 1 : 0;
          o1[va] += cv ? 1 : -1; const s3 = at(o1[0], o1[1], o1[2]) ? 1 : 0;
          ao[i] = (s1 && s2) ? 0 : 3 - (s1 + s2 + s3); }
        const em = emis ? emis(c, x, y, z) : null;
        if (ao[0] === ao[1] && ao[1] === ao[2] && ao[2] === ao[3]) mask[a * nv + b] = 1 + c + 256 * ao[0] + 1024 * emisKey(em);
        else emit(D, d, s, ua, va, ord, x, y, z, 1, 1, palette[c], ao.slice(), em);   // an AO gradient: keep the single face
      }
      for (let a = 0; a < nu; a++) for (let b = 0; b < nv;) {
        const k = mask[a * nv + b]; if (!k) { b++; continue; }
        let h = 1; while (b + h < nv && h < GREEDY_MAX && mask[a * nv + b + h] === k) h++;
        let w = 1; grow: while (a + w < nu && w < GREEDY_MAX) { for (let t = 0; t < h; t++) if (mask[(a + w) * nv + b + t] !== k) break grow; w++; }
        for (let i = 0; i < w; i++) for (let t = 0; t < h; t++) mask[(a + i) * nv + b + t] = 0;
        const kk = k - 1, c = kk & 255, al = (kk >> 8) & 3;
        cell[d] = sl; cell[ua] = lo[ua] + a; cell[va] = lo[va] + b;
        emit(D, d, s, ua, va, ord, cell[0], cell[1], cell[2], w, h, palette[c], [al, al, al, al], emis ? emis(c, cell[0], cell[1], cell[2]) : null);
        b += h;
      }
    }
  }
  if (!nf) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(sP.slice(0, nf * 12), 3));
  g.setAttribute('normal', new BufferAttribute(sN.slice(0, nf * 12), 3, true));
  g.setAttribute('color', new BufferAttribute(sC.slice(0, nf * 12), 3));
  if (emis) g.setAttribute('emis', new BufferAttribute(sE.slice(0, nf * 16), 4, true));
  g.setIndex(new BufferAttribute(sI.slice(0, nf * 6), 1));
  g.userData.faces = nf;
  return g;
}
