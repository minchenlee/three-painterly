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
