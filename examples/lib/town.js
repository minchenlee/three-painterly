// A small-town kit on top of voxels.js: wooden houses, trees, fences, flower beds, hedges, cars, lamps.
// Not part of any package. It serves the examples and may change with them.
// One voxel is 25 cm. The ground convention: lawn and pavement voxels sit at y = 0, so things stand from y = 1.
import { h01 } from './voxels.js';

/** Add the kit's colours to a palette: townPalette(palette.def). Ground, plants, building parts, and seven house colour sets. */
export function townPalette(def) {
  def('GRASS1 GRASS2 GRASS3', 0x669848, 0x71a24e, 0x5c8e43); def('DIRT1 DIRT2', 0x6f5137, 0x7c5c40);
  def('ASPH1 ASPH2 PAINT CURB', 0x4a4b50, 0x53545a, 0xe8e2c8, 0xb9b3a6); def('WALK1 WALK2 GRAVEL1 GRAVEL2', 0xc9c2b4, 0xbdb5a6, 0xcdbb97, 0xbfae8b);
  def('TRUNK LEAF1 LEAF2 LEAF3 LEAF4 BLOSSOM1 BLOSSOM2 HEDGE1 HEDGE2 STEM', 0x6a4a33, 0x4f8a3a, 0x5d9a42, 0x437a36, 0x6aa84a, 0xf3a6c0, 0xf7c3d4, 0x3f7438, 0x4a8240, 0x4c8a3c);
  def('FL_R FL_Y FL_P FL_W FL_V FL_O', 0xe9382d, 0xf7c81e, 0xf06aa9, 0xf7f4ea, 0x7a59e0, 0xf58a1f);
  def('TRIM WHITE GLASS1 GLASS2 STONE1 STONE2 BRICK1 BRICK2 MORTAR', 0xf3ecd8, 0xf7f5ee, 0x9cc7dc, 0x7fb0cb, 0x9a9a9e, 0x8b8b90, 0xa5482f, 0x963f2a, 0xc9a08a);
  def('PORCH1 PORCH2 FENCEB1 FENCEB2 METAL LAMP DARK', 0xcdb68e, 0xbfa87f, 0x8a6a48, 0x7d5f40, 0x2e3136, 0xfff0b8, 0x3a2f2a);
  def('TEAL1 TEAL2 DKTEAL SLATE1 SLATE2 SLATE3 MUSTARD', 0x2f8088, 0x2a747c, 0x1f5960, 0x7483ad, 0x6876a2, 0x7f8db6, 0xe2a72e);
  def('BUTTER1 BUTTER2 TERRA1 TERRA2 TERRA3 DOORBLUE SHUTGREEN', 0xf0d684, 0xe6ca76, 0xb5553d, 0xa64b35, 0xc1614a, 0x3f6fb0, 0x4f7a56);
  def('BARN1 BARN2 CHAR1 CHAR2 CHAR3', 0xb7412f, 0xa7392a, 0x4b4a50, 0x434248, 0x55545b);
  def('SAGE1 SAGE2 BROWN1 BROWN2 BROWN3 SHUTBROWN', 0x9db88a, 0x90ab7e, 0x7a5a44, 0x6d4f3b, 0x86654d, 0x5a4636);
  def('DUSTY1 DUSTY2 NAVY LILAC1 LILAC2 PLUM CREAM1 CREAM2', 0x8fb0d0, 0x82a3c4, 0x3d5a80, 0xc7b0d8, 0xbaa2cc, 0x6b5a8a, 0xf1e7cf, 0xe6dbc1);
  def('CARRED CARBLUE TIRE CHROME', 0xc8382c, 0x3b6fb8, 0x1d1d20, 0xc9ccd2);
}

/**
 * The kit for one grid: createTown(grid, C) with C from a palette that has the townPalette colours.
 * house(put, options) writes through put(x, y, z, c), so a house can go into any grid: place(cx, cz, flip) gives a put
 * for this grid, and your own put can fill a separate grid for a house that has to move.
 * Everything else writes into the grid, at world voxel coordinates.
 */
export function createTown(grid, C) {
  const { set, setE } = grid;
  const FLOWERS = [C.FL_R, C.FL_Y, C.FL_P, C.FL_W, C.FL_V, C.FL_O];
  /** A put for house(): the house stands at (cx, cz); flip turns it round to face the other way. */
  const place = (cx, cz, flip = false, ground = 1) => (x, y, z, c) => set(flip ? cx - x : cx + x, ground + y, flip ? cz - z : cz + z, c);

  /**
   * A wooden house. x runs across the front, y up from the ground, z towards the front; (0, 0, 0) is the middle of the floor.
   * hw, hd: half width and half depth of the walls. floors: 1 or 2. axis: 'x' = ridge along the front, 'z' = a gable to the front.
   * sid: two clapboard shades. roof: three shingle shades. door, shut (shutters), trim: one colour each. gable: two shades, optional.
   * porch: depth in voxels, 0 for none. chim: [x, z] of the chimney corner. dormers: x positions on the front slope (axis 'x').
   * Returns { wallTop, ridge, roofY(x, z) } for whoever needs to cut into it.
   */
  function house(put, o) {
    const { hw, hd, floors = 2, axis = 'x', slope = 0.75, sid, trim = C.TRIM, roof, door, shut, porch = 8, chim = null, dormers = [], doorX = 0, gable = null } = o;
    const wallTop = 2 + floors * 11, over = 2;
    const run = axis === 'x' ? (x, z) => hd + over - Math.abs(z) : (x, z) => hw + over - Math.abs(x);
    const roofY = (x, z) => wallTop + Math.floor(run(x, z) * slope);
    const ridge = wallTop + Math.floor(((axis === 'x' ? hd : hw) + over) * slope);
    const shingle = (x, y, z) => roof[Math.floor(h01(x >> 1, y, z >> 1) * 3)];
    const centres = (half, skip) => { const n = Math.max(1, Math.floor((2 * half - 5) / 11)), out = []; for (let i = 0; i < n; i++) { const c = Math.round(-half + (2 * half) * (i + 0.5) / n); if (skip === undefined || Math.abs(c - skip) > 6) out.push(c); } return out; };
    // a window in a wall plane: glass with a cross bar, a frame, shutters. Returns 0 outside it.
    const win = (u, y, c, y0, w = 2, h = 6) => {
      const du = u - c, dy = y - y0;
      if (dy < -1 || dy > h || Math.abs(du) > w + 2) return 0;
      if (Math.abs(du) === w + 2) return dy >= 0 && dy < h ? shut : 0;
      if (Math.abs(du) === w + 1 || dy === -1 || dy === h) return trim;
      return du === 0 || dy === (h >> 1) ? trim : (h01(c, y0, u + y) < 0.5 ? C.GLASS1 : C.GLASS2);
    };
    const wallColour = (x, y, z) => {
      const ax = Math.abs(x), az = Math.abs(z), front = z === hd, sideWall = ax === hw;
      if (ax === hw && az === hd) return trim;                                           // corner boards
      if (floors > 1 && y === 13) return trim;                                           // the band between the floors
      if (y === wallTop - 1) return trim;                                                // the frieze under the eaves
      const u = sideWall ? z : x, half = sideWall ? hd : hw;
      if (y >= wallTop) {                                                                // the gable: an attic window, shingles
        const a = (Math.abs(u) <= 1 && y >= wallTop + 3 && y <= wallTop + 6) ? (u === 0 || y === wallTop + 3 || y === wallTop + 6 ? trim : C.GLASS1) : 0;
        return a || (gable ? gable[(u + y) & 1] : sid[y & 1]);
      }
      if (front) {
        const dx = x - doorX;
        if (dx >= -2 && dx <= 1 && y <= 10) return y >= 8 && y <= 9 ? C.GLASS2 : (dx === -2 || dx === 1 || y === 2 || y === 6 ? door : door);
        if (dx >= -3 && dx <= 2 && y <= 11) return trim;
      }
      for (let f = 0; f < floors; f++) for (const c of centres(half, front && f === 0 ? doorX : undefined)) { const w = win(u, y, c, 5 + f * 11); if (w) return w; }
      return sid[y & 1];                                                                 // clapboards
    };
    // foundation, walls, a floor under the attic
    for (let x = -hw; x <= hw; x++) for (let z = -hd; z <= hd; z++) {
      const edge = Math.abs(x) === hw || Math.abs(z) === hd;
      if (edge) { for (let y = 0; y < 2; y++) put(x, y, z, h01(x, y, z) < 0.5 ? C.STONE1 : C.STONE2);
        const top = (axis === 'x' ? Math.abs(x) === hw : Math.abs(z) === hd) ? roofY(x, z) : wallTop;
        for (let y = 2; y < top; y++) put(x, y, z, wallColour(x, y, z)); }
      else { put(x, wallTop, z, C.DARK); put(x, 1, z, C.DARK); }
    }
    // roof: two voxels thick, shingles in three shades, trim boards on the rake
    for (let x = -hw - over; x <= hw + over; x++) for (let z = -hd - over; z <= hd + over; z++) {
      const y = roofY(x, z), rake = axis === 'x' ? Math.abs(x) === hw + over : Math.abs(z) === hd + over;
      put(x, y, z, rake ? trim : shingle(x, y, z)); put(x, y + 1, z, y + 1 >= ridge ? roof[1] : shingle(x, y + 1, z));
    }
    // dormers on the front slope (ridge along x only): a small gabled box with a window
    for (const cx of dormers) {
      const top = wallTop + 9, zf = hd - 3;
      for (let dx = -4; dx <= 4; dx++) for (let z = zf; z >= -hd; z--) {
        const x = cx + dx, ry = top + Math.floor((4 - Math.abs(dx)) * 0.75), base = roofY(x, z);
        if (ry <= base) break;
        if (Math.abs(dx) <= 3) for (let y = base + 2; y < ry; y++) if (z === zf || Math.abs(dx) === 3) put(x, y, z, z === zf ? (Math.abs(dx) === 3 || y === top - 1 ? trim : (Math.abs(dx) <= 1 && y >= wallTop + 4 && y <= wallTop + 7 ? C.GLASS1 : sid[y & 1])) : sid[y & 1]);
        put(x, ry, z, Math.abs(dx) === 4 || z === zf ? trim : shingle(x, ry, z)); if (z < zf || Math.abs(dx) < 4) put(x, ry + 1, z, shingle(x, ry + 1, z));
      }
    }
    // porch across the front: deck, posts, a rail with a gap at the steps, a low roof
    if (porch) {
      const z1 = hd + porch, posts = [-hw, hw]; for (let x = -hw + 9; x < hw - 4; x += 9) posts.push(x);
      for (let x = -hw; x <= hw; x++) for (let z = hd + 1; z <= z1; z++) {
        put(x, 2, z, (x & 3) === 0 ? C.PORCH2 : C.PORCH1);
        if (z === z1 || Math.abs(x) === hw) { for (let y = 0; y < 2; y++) if ((x + z + y) & 1) put(x, y, z, trim);                    // lattice skirt
          const gap = z === z1 && x - doorX >= -3 && x - doorX <= 2;
          if (!gap) { put(x, 5, z, trim); if ((x + z) & 1) { put(x, 3, z, trim); put(x, 4, z, trim); } } }
        const ry = 14 - Math.floor((z - hd) / 4); put(x, ry, z, shingle(x, ry, z));
      }
      for (let x = -hw - 1; x <= hw + 1; x++) { const ry = 14 - Math.floor((z1 + 1 - hd) / 4); put(x, ry, z1 + 1, trim); put(x, ry - 1, z1, trim); }
      for (const x of posts) for (let y = 3; y <= 12; y++) put(x, y, z1, trim);
      for (let s = 0; s < 2; s++) for (let x = doorX - 3; x <= doorX + 2; x++) put(x, 1 - s, z1 + 1 + s, C.PORCH2);                    // steps
    }
    // chimney: brick with mortar courses, a stone cap
    if (chim) { const [cx, cz] = chim, top = ridge + 7;
      for (let x = cx; x < cx + 4; x++) for (let z = cz; z < cz + 4; z++) for (let y = 0; y < top; y++) put(x, y, z, y % 4 === 3 ? C.MORTAR : (h01(x + (y >> 2 & 1), y >> 2, z) < 0.5 ? C.BRICK1 : C.BRICK2));
      for (let x = cx - 1; x < cx + 5; x++) for (let z = cz - 1; z < cz + 5; z++) put(x, top, z, C.STONE1);
      for (let x = cx + 1; x < cx + 3; x++) for (let z = cz + 1; z < cz + 3; z++) put(x, top + 1, z, C.METAL);
    }
    return { wallTop, ridge, roofY };
  }

  function tree(x, z, h, r, blossom = false) {
    for (let y = 1; y <= h; y++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) set(x + a, y, z + b, C.TRUNK);
    const L = blossom ? [C.BLOSSOM1, C.BLOSSOM2, C.BLOSSOM1, C.LEAF4] : [C.LEAF1, C.LEAF2, C.LEAF3, C.LEAF4];
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const d = Math.hypot(a, b * 1.25, c) / r + (h01(x + a >> 1, b >> 1, z + c >> 1) - 0.5) * 0.45;   // a lumpy ball, hollow inside
      if (d > 1 || d < 0.55) continue;
      setE(x + a, h + Math.round(r * 0.55) + b, z + c, L[Math.floor(h01(x + a >> 1, b, z + c >> 1) * 4)]);
    }
  }
  function picket(x0, z0, x1, z1, gap = null) {                    // a white fence along one axis; gap = [from, to] along it
    const along = x0 !== x1, n = along ? x1 - x0 : z1 - z0;
    for (let i = 0; i <= n; i++) { const x = along ? x0 + i : x0, z = along ? z0 : z0 + i, u = along ? x : z;
      if (gap && u > gap[0] && u < gap[1]) continue;
      set(x, 3, z, C.WHITE); if ((i & 1) === 0) for (let y = 1; y <= 4; y++) set(x, y, z, C.WHITE); }
  }
  function boards(x0, z0, x1, z1, h = 7) { const along = x0 !== x1, n = along ? x1 - x0 : z1 - z0;   // a tall brown fence between back yards
    for (let i = 0; i <= n; i++) for (let y = 1; y <= h - ((i & 3) === 0 ? 0 : 1); y++) set(along ? x0 + i : x0, y, along ? z0 : z0 + i, (i & 3) === 0 ? C.FENCEB2 : C.FENCEB1); }
  function flowerBed(x0, x1, z0, z1) { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { set(x, 0, z, h01(x, z) < 0.5 ? C.DIRT1 : C.DIRT2);
    const r = h01(x, z, 7); if (r < 0.55) { const hgt = 1 + (r < 0.2 ? 1 : 0); for (let y = 1; y < hgt; y++) set(x, y, z, C.STEM); set(x, hgt, z, FLOWERS[Math.floor(h01(x >> 1, z >> 1, 9) * 6)]); } } }
  function hedge(x0, x1, z0, z1, h = 5) { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = 1; y <= h - (h01(x, z, 4) < 0.25 ? 1 : 0); y++) set(x, y, z, h01(x >> 1, y, z >> 1) < 0.5 ? C.HEDGE1 : C.HEDGE2); }
  function car(x, z, body) {                                       // parked along x: 20 long, 9 wide
    for (let a = 0; a < 20; a++) for (let b = 0; b < 9; b++) {
      const wheel = (a >= 2 && a <= 5) || (a >= 14 && a <= 17);
      if (wheel && (b === 0 || b === 8)) { for (let y = 0; y < 3; y++) set(x + a, y, z + b, y === 1 && (a === 3 || a === 4 || a === 15 || a === 16) ? C.CHROME : C.TIRE); }
      for (let y = 1; y <= 4; y++) if (!(wheel && (b === 0 || b === 8) && y < 3)) set(x + a, y, z + b, y === 1 && (a === 0 || a === 19) ? C.CHROME : body);
      if (a >= 5 && a <= 14) for (let y = 5; y <= 7; y++) set(x + a, y, z + b, y === 7 ? body : ((a === 5 || a === 14 || b === 0 || b === 8) && (a + b) % 5 ? C.GLASS2 : (b === 0 || b === 8 || a === 5 || a === 14 ? body : 0)));
    }
    set(x + 19, 3, z + 1, C.LAMP); set(x + 19, 3, z + 7, C.LAMP); set(x, 3, z + 1, C.FL_R); set(x, 3, z + 7, C.FL_R);
  }
  function lamp(x, z, dz) { for (let y = 1; y <= 20; y++) set(x, y, z, C.METAL); for (let i = 1; i <= 3; i++) set(x, 20, z + dz * i, C.METAL); set(x, 19, z + dz * 3, C.LAMP); set(x, 19, z + dz * 2, C.LAMP); }
  function mailbox(x, z, c) { set(x, 1, z, C.FENCEB1); set(x, 2, z, C.FENCEB1); set(x, 3, z, C.FENCEB1); for (let a = 0; a < 2; a++) for (let b = -1; b <= 1; b++) set(x + a, 4, z + b, c); set(x, 5, z, c); }

  return { FLOWERS, place, house, tree, picket, boards, flowerBed, hedge, car, lamp, mailbox };
}
