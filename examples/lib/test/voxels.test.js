// The voxel tools shared by the examples. Runs in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { h01, mulberry32, createPalette, createGrid, createModel, modelPieces, meshGrid, AOV } from '../voxels.js';
import { peoplePalette, createPeople } from '../people.js';
import { createShapes, buildShapes, surfaceDabs } from '../shapes.js';
import { MeshBasicMaterial, Vector3 } from 'three';
import { townPalette, createTown } from '../town.js';

const palette = () => { const p = createPalette(); p.def('A B', 0xff0000, 0x00ff00); return p; };
const mesh = (grid, p, options = {}) => meshGrid(grid.get, grid.min, grid.max, { palette: p.PAL, ...options });
const colours = g => { const c = g.getAttribute('color').array, out = new Set(); for (let i = 0; i < c.length; i += 3) out.add([c[i], c[i + 1], c[i + 2]].map(v => v.toFixed(3)).join(',')); return out; };

test('h01 and mulberry32 repeat', () => {
  assert.equal(h01(3, -7, 11), h01(3, -7, 11));
  assert.notEqual(h01(3, -7, 11), h01(3, -7, 12));
  assert.ok(h01(1, 2) >= 0 && h01(1, 2) < 1);
  const a = mulberry32(42), b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('palette: names, linear colours, hex, limits', () => {
  const p = palette();
  assert.deepEqual([p.C.A, p.C.B, p.PAL.length], [1, 2, 3]);
  assert.deepEqual(p.PAL[1], [1, 0, 0]);
  assert.equal(p.HEX[2], 0x00ff00);
  p.def('GREY', 0x808080);
  assert.ok(Math.abs(p.PAL[3][0] - 0.2159) < 1e-3, 'sRGB hex becomes linear');
  assert.throws(() => p.def('A', 0x123456), /defined twice/);
});

test('grid: origin, bounds, set if empty, box', () => {
  const g = createGrid(4, 3, 5, 2, 1, 0);
  assert.deepEqual([g.min, g.max], [[-2, -1, 0], [2, 2, 5]]);
  g.set(-2, -1, 0, 7); g.set(1, 1, 4, 9); g.set(2, 0, 0, 5); g.set(0, 0, -1, 5);   // the last two are outside
  assert.deepEqual([g.get(-2, -1, 0), g.get(1, 1, 4), g.get(2, 0, 0), g.get(0, 0, -1), g.get(99, 0, 0)], [7, 9, 0, 0, 0]);
  assert.equal(g.data.filter(Boolean).length, 2);
  g.setE(1, 1, 4, 3); g.setE(0, 0, 0, 3);
  assert.deepEqual([g.get(1, 1, 4), g.get(0, 0, 0)], [9, 3]);
  g.box(-1, 0, 0, 1, 1, 2, (x, y, z) => (x === 0 ? 4 : 0));
  assert.equal(g.get(0, 1, 2), 4); assert.equal(g.get(-1, 1, 2), 0);
});

test('mesher: one voxel is six faces at full brightness', () => {
  const p = palette(), g = createGrid(3, 3, 3, 1, 1, 1);
  g.set(0, 0, 0, p.C.A);
  const m = mesh(g, p);
  assert.equal(m.userData.faces, 6);
  assert.equal(m.getAttribute('position').count, 24); assert.equal(m.index.count, 36);
  assert.deepEqual([...colours(m)], ['1.000,0.000,0.000']);
  m.computeBoundingBox();
  assert.deepEqual([m.boundingBox.min.toArray(), m.boundingBox.max.toArray()], [[0, 0, 0], [1, 1, 1]], 'voxel (0, 0, 0) spans 0..1');
  assert.equal(mesh(createGrid(2, 2, 2), p), null, 'an empty box gives no geometry');
  assert.throws(() => meshGrid(g.get, g.min, g.max), /palette is required/);
});

test('mesher: flat faces of one colour merge, up to 8 voxels a side; other colours do not', () => {
  const p = palette(), g = createGrid(20, 3, 20, 0, 1, 0);
  g.box(0, 7, 0, 0, 0, 7, p.C.A);                              // an 8 x 8 slab: every side is one quad
  assert.equal(mesh(g, p).userData.faces, 6);
  g.box(0, 15, 0, 0, 0, 7, p.C.A);                             // 16 x 8: top, bottom and the long sides need two quads
  assert.equal(mesh(g, p).userData.faces, 2 + 2 * 2 + 2 * 2);
  g.box(0, 15, 0, 0, 0, 7, (x) => (x < 8 ? p.C.A : p.C.B));    // two colours: still split in the middle
  const m = mesh(g, p);
  assert.equal(m.userData.faces, 10); assert.equal(colours(m).size, 2);
});

test('mesher: hidden faces are skipped; noBottomAt drops the underside', () => {
  const p = palette(), g = createGrid(4, 4, 4);
  g.box(0, 1, 0, 0, 0, 0, p.C.A);                              // two voxels side by side: the shared faces are gone
  assert.equal(mesh(g, p).userData.faces, 6);
  assert.equal(mesh(g, p, { noBottomAt: 0 }).userData.faces, 5);
  assert.equal(mesh(g, p, { noBottomAt: -1 }).userData.faces, 6);
});

test('mesher: a step darkens the corner (ambient occlusion)', () => {
  const p = palette(), g = createGrid(6, 4, 6, 1, 0, 1);
  g.box(0, 3, 0, 0, 0, 3, p.C.A); g.box(0, 3, 1, 1, 0, 0, p.C.A);   // a floor with a wall along one edge
  const seen = colours(mesh(g, p));
  for (const k of [AOV[3], AOV[2]]) assert.ok(seen.has(`${k.toFixed(3)},0.000,0.000`), `a vertex at brightness ${k}`);
  assert.ok(seen.size >= 2 && seen.size <= 4);
});

test('mesher: emis adds an attribute and keeps unlike faces apart', () => {
  const p = palette(), g = createGrid(4, 2, 2);
  g.box(0, 3, 0, 0, 0, 0, p.C.A);
  const emis = (c, x) => (x < 2 ? [255, 128, 0, 255] : null);
  const m = mesh(g, p, { emis });
  assert.ok(m.getAttribute('emis'), 'emis attribute'); assert.equal(m.getAttribute('emis').itemSize, 4);
  assert.equal(m.userData.faces, 2 + 4 * 2, 'each long side is two quads: lit and unlit');
  assert.equal(mesh(g, p, { emis, emisKey: () => 0 }).userData.faces, 6, 'one key: they merge again');
  assert.equal(mesh(g, p).getAttribute('emis'), undefined);
});

test('models: shapes fill cells; detail makes the same shape finer', () => {
  const m = createModel();
  m.ellipsoid(0, 0, 0, 1.2, 1.2, 1.2, 5);
  assert.equal(m.cells.size, 7, 'a small ball is a cell and its six neighbours');
  m.set(4, 0, 0, 2); m.set(4, 0, 0, 0);
  assert.equal(m.get(4, 0, 0), 0, 'colour 0 removes a cell');
  const rod = createModel(); rod.line([0, 0, 0], [5, 0, 0], 3);
  assert.equal(rod.cells.size, 6);
  const fine = createModel(2); fine.box(0, 1, 0, 0, 0, 0, 4);
  assert.equal(fine.cells.size, 2 * 8, 'each unit is 2 x 2 x 2 voxels at detail 2');
  const cap = createModel(); cap.dome(0, 0, 0, 4, 2, 6);
  let top = -9; cap.each((x, y) => { top = Math.max(top, y); });
  assert.equal(top, 2); assert.equal(cap.get(0, 2, 0), 6); assert.equal(cap.get(0, 0, 0), 0, 'open below');
});

test('modelPieces: only voxels that show, placed, turned and shaded', () => {
  const p = palette(), m = createModel();
  m.box(0, 2, 0, 2, 0, 2, p.C.A);                              // a 3 x 3 x 3 block: the middle one is buried
  const pieces = modelPieces(m, { palette: p, origin: [10, 0, 0], size: 0.5 });
  assert.equal(pieces.length, 26);
  assert.ok(pieces.every(q => q.size === 0.5 && q.color === 0xff0000), 'a convex block is not darkened');
  assert.deepEqual(pieces.find(q => q.cell.join() === '0,0,0').position, [10.25, 0.25, 0.25]);
  const step = createModel(); step.box(0, 3, 0, 0, 0, 3, p.C.A); step.box(0, 3, 1, 1, 0, 0, p.C.A);
  assert.ok(modelPieces(step, { palette: p }).some(q => q.color !== 0xff0000), 'a floor next to a wall is darkened');
  assert.ok(modelPieces(step, { palette: p, ao: false }).every(q => q.color === 0xff0000));
  const one = createModel(); one.set(3, 0, 1, p.C.B);
  const where = turn => modelPieces(one, { palette: p, turn })[0].position.map(v => v - 0.5);
  assert.deepEqual([where(0), where(1), where(2), where(3)], [[3, 0, 1], [-1, 0, 3], [-3, 0, -1], [1, 0, -3]], 'quarter turns about y');
  assert.deepEqual(modelPieces(one, { palette: p, mirror: true })[0].position.map(v => v - 0.5), [3, 0, -1]);
  const fine = createModel(2); fine.set(0, 0, 0, p.C.A);
  const fp = modelPieces(fine, { palette: p, size: 1 });
  assert.equal(fp.length, 8); assert.equal(fp[0].size, 0.5, 'detail 2 halves the pieces and keeps the size in the world');
});

test('people: every builder gives a figure of a sensible height, the same every time', () => {
  const p = createPalette(); peoplePalette(p.def);
  const kit = createPeople(p.C, 1), height = m => { let top = 0; m.each((x, y) => { top = Math.max(top, y + 1); }); return top; };
  const adult = kit.gent({}), lady = kit.lady({ parasol: p.C.BLACK });
  assert.ok(height(adult) >= 20 && height(adult) <= 24, `a man with a top hat: ${height(adult)} voxels`);
  assert.ok(height(lady) > height(kit.lady({})), 'a parasol is taller than its owner');
  assert.ok(height(kit.seatedLady({})) <= 15 && height(kit.child({})) < height(adult) && height(kit.reclining({})) < 11);
  for (const name of ['lady', 'gent', 'seatedLady', 'seatedGent', 'reclining', 'child', 'dog', 'monkey', 'sailboat', 'steamer', 'scull']) {
    const a = kit[name]({}), b = kit[name]({}); let low = 99; a.each((x, y) => { low = Math.min(low, y); });
    assert.ok(a.cells.size > 20, name); assert.equal(low, 0, `${name} stands on y = 0`);
    assert.deepEqual([...a.cells], [...b.cells], `${name} builds the same twice`);
  }
  assert.ok(createPeople(p.C, 2).gent({}).cells.size > 4 * adult.cells.size, 'detail 2 has about eight times the voxels');
});

test('shapes: the same calls as a voxel model, kept round', () => {
  const m = createShapes();
  m.ellipsoid(0, 0, 0, 2, 1, 2, 5); m.set(3, 0, 0, 2); m.set(3, 1, 0, 0); m.box(0, 1, 0, 0, 0, 0, 4); m.line([0, 0, 0], [0, 4, 0], 3, 0.5); m.line([0, 0, 0], [0, 4, 0], 3, 0.5, true);
  m.dome(0, 5, 0, 3, 1, (x, z) => 6); m.panel([[0, 0, 0], [2, 0, 0], [0, 2, 0]], 7);
  assert.equal(m.smooth, true); assert.equal(createModel().smooth, false);
  assert.deepEqual(m.prims.map(p => p.kind), ['ball', 'ball', 'box', 'rod', 'rod', 'cap', 'panel'], 'colour 0 draws nothing');
  assert.deepEqual(m.prims[0].p, [0.5, 0.5, 0.5], 'a cell is centred half a unit in');
  assert.deepEqual([m.prims[2].p, m.prims[2].r], [[1, 0.5, 0.5], [1, 0.5, 0.5]], 'a box covers whole cells');
  assert.equal(m.prims[5].c, 6);
  assert.deepEqual(createShapes({ cell: false }).ellipsoid(1, 2, 3, 1, 1, 1, 5), undefined);
  const plain = createShapes({ cell: false }); plain.set(1, 2, 3, 5);
  assert.deepEqual(plain.prims[0].p, [1, 2, 3]);
});

test('buildShapes: instanced meshes, placed and turned, with aBegin; surfaceDabs faces the eye', () => {
  const p = palette(), m = createShapes({ cell: false });
  m.ellipsoid(2, 0, 0, 1, 1, 1, p.C.A); m.line([0, 0, 0], [0, 3, 0], p.C.B, 0.5); m.panel([[0, 0, 0], [1, 0, 0], [0, 1, 0]], p.C.A);
  const kinds = [], { group, shapes } = buildShapes([{ model: m, origin: [10, 0, 0], size: 2, turn: 1, begin: 7, weight: 1 }], { hex: p.HEX, material: k => { kinds.push(k); return new MeshBasicMaterial(); } });
  assert.deepEqual(kinds.sort(), ['ball', 'panel', 'rod']);
  const balls = group.children.find(c => c.name === 'ball'), rods = group.children.find(c => c.name === 'rod');
  assert.equal(balls.count, 3, 'one ball and the two round ends of the rod'); assert.equal(rods.count, 1);
  assert.deepEqual([...balls.geometry.getAttribute('aBegin').array], [7, 7, 7]);
  const at = new Vector3().setFromMatrixPosition(shapes[0].matrix);
  assert.ok(Math.abs(at.x - 10) < 1e-6 && Math.abs(at.z - 4) < 1e-6, `a quarter turn takes +x to +z, scaled by size: ${at.toArray()}`);
  assert.ok(Math.abs(shapes[0].area - 4 * Math.PI * 4) < 1e-6, 'a ball of radius 2');
  assert.ok(Math.abs(shapes.find(s => s.kind === 'panel').area - 2) < 1e-6, 'a triangle with legs of 2');
  const eye = [10, 1, 30], dabs = surfaceDabs(shapes, { eye, dab: () => 0.2, cover: 0.5, rnd: mulberry32(3) });
  assert.ok(dabs.length > 100 && dabs.length < 2000, `${dabs.length} dabs`);
  const ball = dabs.filter(d => Math.hypot(d.position[0] - 10, d.position[1], d.position[2] - 4) < 2.01 && d.color === 0xff0000 && d.position[2] > 2);
  assert.ok(ball.length > 20 && ball.every(d => d.position[2] >= 4 - 0.35), 'dabs sit on the half of the ball that faces the eye');
  assert.ok(dabs.every(d => d.begin === 7));
  assert.deepEqual(surfaceDabs(shapes, { eye, dab: () => 0.2, cover: 0.5, rnd: mulberry32(3) }), dabs, 'the same seed gives the same dabs');
  assert.equal(surfaceDabs(shapes.map(s => ({ ...s, weight: 0 })), { eye, dab: () => 0.2, rnd: mulberry32(3) }).length, 0, 'weight scales the count');
});

test('people draw on round shapes too', () => {
  const p = createPalette(); peoplePalette(p.def);
  const kit = createPeople(p.C, createShapes);
  for (const name of ['lady', 'gent', 'seatedLady', 'seatedGent', 'reclining', 'child', 'dog', 'monkey', 'sailboat', 'steamer', 'scull']) {
    const m = kit[name]({});
    assert.ok(m.smooth && m.prims.length >= 5 && m.prims.length < 60, `${name}: ${m.prims.length} shapes`);
    assert.ok(m.prims.every(q => q.c > 0 && q.c < p.PAL.length), `${name}: every shape has a colour`);
  }
  assert.ok(kit.sailboat().prims.some(q => q.kind === 'panel'), 'sails are panels');
  assert.ok(kit.lady({ parasol: p.C.BLACK }).prims.some(q => q.kind === 'cap'), 'a parasol is a cap');
});

test('town kit: a house builds the same every time and fits its numbers', () => {
  const build = () => { const p = createPalette(); townPalette(p.def); const g = createGrid(80, 80, 80, 40, 4, 40), t = createTown(g, p.C);
    const info = t.house(t.place(0, 0), { hw: 12, hd: 10, sid: [p.C.TEAL1, p.C.TEAL2], roof: [p.C.SLATE1, p.C.SLATE2, p.C.SLATE3], door: p.C.MUSTARD, shut: p.C.DKTEAL, dormers: [0], chim: [-11, -8] });
    return { p, g, t, info }; };
  const a = build(), b = build();
  assert.deepEqual(a.g.data, b.g.data);
  assert.equal(a.info.wallTop, 24); assert.ok(a.info.ridge > a.info.wallTop);
  assert.equal(a.g.get(0, 1 + a.info.ridge + 1, 0), a.p.C.SLATE2, 'the ridge cap');
  assert.ok([a.p.C.TEAL1, a.p.C.TEAL2].includes(a.g.get(-12, 8, 9)) || a.g.get(-12, 8, 9) !== 0, 'a side wall stands');
  assert.equal(a.g.get(0, 5, 0), 0, 'hollow inside');
  let glass = 0; for (const c of a.g.data) if (c === a.p.C.GLASS1 || c === a.p.C.GLASS2) glass++;
  assert.ok(glass > 100, 'it has windows');
  // flip turns the house round: the door wall moves from +z to -z
  const f = build(); f.g.data.fill(0); f.t.house(f.t.place(0, 0, true), { hw: 12, hd: 10, sid: [f.p.C.TEAL1, f.p.C.TEAL2], roof: [f.p.C.SLATE1, f.p.C.SLATE2, f.p.C.SLATE3], door: f.p.C.MUSTARD, shut: f.p.C.DKTEAL });
  assert.equal(f.g.get(0, 4, -10), f.p.C.MUSTARD); assert.notEqual(f.g.get(0, 4, 10), f.p.C.MUSTARD);
  assert.ok(mesh(a.g, a.p).userData.faces > 1000);
});

test('town kit: garden things land on the ground convention (things stand from y = 1)', () => {
  const p = createPalette(); townPalette(p.def);
  const g = createGrid(64, 48, 64, 32, 4, 32), t = createTown(g, p.C);
  t.tree(0, 0, 10, 6); t.picket(-10, 12, 10, 12, [-2, 2]); t.flowerBed(-8, -4, 14, 15); t.lamp(12, 12, 1); t.car(-20, -20, p.C.CARRED);
  assert.equal(g.get(0, 1, 0), p.C.TRUNK); assert.equal(g.get(0, 0, 0), 0, 'nothing is written into the ground layer by a tree');
  assert.equal(g.get(-10, 4, 12), p.C.WHITE); assert.equal(g.get(0, 3, 12), 0, 'the gate gap');
  assert.ok([p.C.DIRT1, p.C.DIRT2].includes(g.get(-6, 0, 14)), 'a flower bed replaces the lawn voxel');
  assert.equal(g.get(12, 20, 12), p.C.METAL);
  assert.equal(t.FLOWERS.length, 6);
});
