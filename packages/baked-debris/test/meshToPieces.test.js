// meshToPieces in Node: three.js geometry, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, BoxGeometry, TorusKnotGeometry, SphereGeometry, MeshStandardMaterial, BufferAttribute, Color } from 'three';
import { meshToPieces } from '../src/meshToPieces.js';

const box = (w, h, d, color = 0x336699) => new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color }));
const bounds = (ps) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of ps) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.position[a]); hi[a] = Math.max(hi[a], p.position[a]); }
  return { lo, hi };
};
const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: ${a} vs ${b}`));

test('volume: a 2 m box with 0.25 m cells gives 8 x 8 x 8 pieces', () => {
  const ps = meshToPieces(box(2, 2, 2), { size: 0.25 });
  assert.equal(ps.length, 512);
  const { lo, hi } = bounds(ps);
  near(lo, [-0.875, -0.875, -0.875], 'min centre');
  near(hi, [0.875, 0.875, 0.875], 'max centre');
  assert.ok(ps.every((p) => p.size === 0.25));
});

test('volume: a box off the cell grid gives the cells whose centres are inside', () => {
  // x: -0.6..0.6 holds centres -0.375..0.375 (4); y: -0.3..0.3 holds -0.125, 0.125 (2); z: -1..1 holds 8
  assert.equal(meshToPieces(box(1.2, 0.6, 2), { size: 0.25 }).length, 4 * 2 * 8);
});

test('surface: the box is hollow (one cell thick)', () => {
  const ps = meshToPieces(box(2, 2, 2), { size: 0.25, fill: 'surface' });
  assert.equal(ps.length, 8 ** 3 - 6 ** 3);
  const inner = ps.filter((p) => p.position.every((v) => Math.abs(v) < 0.75));
  assert.equal(inner.length, 0);
});

test('volume of a sphere is close to 4/3 pi r^3', () => {
  const s = 0.1, ps = meshToPieces(new Mesh(new SphereGeometry(1, 48, 32)), { size: s });
  const v = ps.length * s ** 3, want = (4 / 3) * Math.PI * 0.995;   // the 48x32 sphere is slightly smaller than r = 1
  assert.ok(Math.abs(v - want) / want < 0.03, `volume ${v.toFixed(3)} vs ${want.toFixed(3)}`);
});

test('the world matrix is used (position, rotation, scale, parents)', () => {
  const m = box(1, 2, 3);
  m.rotation.y = Math.PI / 2;   // 3 m along x, 1 m along z
  m.scale.set(2, 1, 1);         // local x (now world z) doubles: 2 m along z
  const parent = new Mesh();
  parent.position.set(10, 5, -4);
  parent.add(m);
  const ps = meshToPieces(m, { size: 0.25 });
  assert.equal(ps.length, 12 * 8 * 8);
  const { lo, hi } = bounds(ps);
  near(lo, [10 - 1.375, 5 - 0.875, -4 - 0.875], 'min centre');
  near(hi, [10 + 1.375, 5 + 0.875, -4 + 0.875], 'max centre');
});

test('same input, same output', () => {
  const knot = () => new Mesh(new TorusKnotGeometry(1, 0.4, 128, 16), new MeshStandardMaterial({ color: 0xaa5533 }));
  for (const fill of ['volume', 'surface']) {
    const a = meshToPieces(knot(), { size: 0.08, fill }), b = meshToPieces(knot(), { size: 0.08, fill });
    assert.ok(a.length > 1000, `${fill}: ${a.length}`);
    assert.deepEqual(a.map((p) => [...p.position, p.color.getHex()]), b.map((p) => [...p.position, p.color.getHex()]));
  }
});

test('colour: material colour by default', () => {
  const ps = meshToPieces(box(1, 1, 1, 0x336699), { size: 0.25 });
  assert.ok(ps.every((p) => p.color instanceof Color && p.color.getHex() === 0x336699));
  assert.notEqual(ps[0].color, ps[1].color, 'each piece has its own Color');
});

test('colour: vertex colours are interpolated and multiplied by the material colour', () => {
  const m = box(1, 1, 1, 0xffffff), pos = m.geometry.attributes.position, c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) c.set(pos.getY(i) > 0 ? [1, 0, 0] : [0, 0, 1], i * 3);   // red top, blue bottom
  m.geometry.setAttribute('color', new BufferAttribute(c, 3));
  const ps = meshToPieces(m, { size: 0.25 });
  for (const p of ps) {
    const want = p.position[1] > 0 ? [1, 0, 0] : [0, 0, 1];   // the nearer of the top and bottom faces
    near([p.color.r, p.color.g, p.color.b], want, `piece at y=${p.position[1]}`);
  }
  m.material.color.set(0x808080);
  const half = m.material.color.r;
  near([meshToPieces(m, { size: 0.25 })[0].color.b], [half], 'times material colour');
});

test('colour: a function overrides it', () => {
  const ps = meshToPieces(box(1, 1, 1), { size: 0.25, color: (x, y) => (y > 0 ? 0xff0000 : 0x00ff00) });
  assert.ok(ps.every((p) => p.color === (p.position[1] > 0 ? 0xff0000 : 0x00ff00)));
});

test('bad options throw with the option name', () => {
  assert.throws(() => meshToPieces(box(1, 1, 1), { size: 0 }), /size/);
  assert.throws(() => meshToPieces(box(1, 1, 1), { fill: 'shell' }), /fill/);
  assert.throws(() => meshToPieces(box(100, 100, 100), { size: 0.01 }), /size/);
});

test('volume matches a ray-parity check per cell (torus knot)', async () => {
  const { Raycaster, Vector3, DoubleSide } = await import('three');
  const m = new Mesh(new TorusKnotGeometry(1, 0.4, 96, 12), new MeshStandardMaterial({ side: DoubleSide }));
  m.position.set(0.3, 2, -0.7); m.rotation.set(0.4, 0.9, 0.2);
  const s = 0.15, got = new Set(meshToPieces(m, { size: s }).map((p) => p.position.map((v) => Math.round(v / s - 0.5)).join()));
  m.updateMatrixWorld(true);
  const ray = new Raycaster(), box = { lo: [-3, -1, -4], hi: [4, 5, 3] };
  let want = 0, diff = 0;
  for (let i = Math.floor(box.lo[0] / s); i < box.hi[0] / s; i++) for (let k = Math.floor(box.lo[2] / s); k < box.hi[2] / s; k++) {
    ray.set(new Vector3((i + 0.5) * s, -10, (k + 0.5) * s), new Vector3(0, 1, 0));
    const ys = ray.intersectObject(m).map((h) => h.point.y);
    for (let j = Math.floor(box.lo[1] / s); j < box.hi[1] / s; j++) {
      const y = (j + 0.5) * s, inside = ys.filter((h) => h < y).length % 2 === 1;
      if (inside) want++;
      if (inside !== got.has(`${i},${j},${k}`)) diff++;
    }
  }
  assert.ok(want > 2000, `${want} cells`);
  assert.equal(diff, 0, `${diff} of ${want} cells differ`);
  assert.equal(got.size, want);
});
