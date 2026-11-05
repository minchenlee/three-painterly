// CPU tests for the bake: no three.js, no GPU. Run with `node --test packages/baked-debris/test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchPieces, addSecondary, simulate, mulberry32, SEGMENTS, validateOptions } from '../src/bake.js';
import { voxelCollider, boxCollider, anyCollider } from '../src/colliders.js';

const base = {
  pieceSize: 0.25, gravity: 9.81, speed: [7, 18], stagger: 1, spin: 9, restitution: 0.35, friction: 0.6, stopSpeed: 0.6,
  ground: 0, solid: null, snap: 0, killY: -50, duration: 20, step: 1 / 90, secondary: 0, secondaryDelay: [0.12, 0.45],
  secondarySpeed: [3.5, 8], seed: 4242,
};
function bake(pieces, over = {}) {
  const o = Object.assign({}, base, over);
  const recs = launchPieces(pieces, [{ position: [0, 0, 0], radius: 0 }], o, mulberry32(o.seed));
  return { o, recs, seg: simulate(recs, o) };
}

// The same evaluation the vertex shader does (shaders.js debrisState), so tests check what is drawn.
function positionAt(seg, recs, i, tl, g) {
  const D = seg.data, b = i * SEGMENTS * 8;
  let A = b;
  if (tl > 0) for (let k = 1; k < SEGMENTS; k++) { const a = b + k * 8; if (D[a] < 0 || D[a] > tl) break; A = a; }
  const dt = Math.max(0, tl - D[A]);
  const rest = tl >= recs[i].restT;
  const P = [D[A + 1] + D[A + 4] * dt, D[A + 2] + D[A + 5] * dt, D[A + 3] + D[A + 6] * dt];
  if (!rest) P[1] -= 0.5 * g * dt * dt;
  return P;
}

test('every record gets an explicit rest time', () => {
  const { recs } = bake([{ position: [0, 2, 0], velocity: [1, 2, 0], launchTime: 0 }, { position: [5, 1, 0] }]);
  for (const d of recs) assert.equal(typeof d.restT, 'number', 'restT missing');
});

test('a piece launched with zero velocity falls (it is not resting)', () => {
  const { o, seg, recs } = bake([{ position: [0, 5, 0], velocity: [0, 0, 0], launchTime: 0 }]);
  const y = positionAt(seg, recs, 0, 0.5, o.gravity)[1];
  assert.ok(Math.abs(y - (5 - 0.5 * o.gravity * 0.25)) < 1e-4, `y at 0.5 s = ${y}`);
});

test('a piece that bounces more often than it has segments never goes through the floor', () => {
  // lively bounce in a narrow shaft: walls at x = ±0.6, so it hits far more than 5 times
  const solid = (x) => Math.abs(x) > 0.6;
  const { o, seg, recs } = bake([{ position: [0, 3, 0], velocity: [9, 4, 0], launchTime: 0, size: 0.2 }],
    { solid, restitution: 0.85, friction: 0.95, stopSpeed: 0.05, duration: 8 });
  for (let t = 0; t <= o.duration; t += 0.005) {
    const [x, y] = positionAt(seg, recs, 0, t, o.gravity);
    assert.ok(y > o.ground - 0.05, `below the floor at t=${t.toFixed(3)}: y=${y}`);
    assert.ok(Math.abs(x) < 0.6 + 0.2, `through a wall at t=${t.toFixed(3)}: x=${x}`);
  }
});

test('bad options are rejected before the bake, naming the field', () => {
  const ok = Object.assign({}, base, { pieces: [{ position: [0, 1, 0] }], bursts: [{ position: [0, 0, 0], radius: 1 }] });
  assert.doesNotThrow(() => validateOptions(ok));
  const bad = [
    [{ step: 0 }, /step/], [{ step: NaN }, /step/], [{ duration: Infinity }, /duration/], [{ duration: -1 }, /duration/],
    [{ gravity: 'x' }, /gravity/], [{ speed: [5] }, /speed/], [{ pieceSize: 0 }, /pieceSize/], [{ solid: 3 }, /solid/],
    [{ ground: NaN }, /ground/], [{ secondary: 2 }, /secondary/], [{ timeWarp: { burst: -1 } }, /timeWarp/],
    [{ pieces: [{ position: [0, NaN, 0] }] }, /pieces\[0\]\.position/],
    [{ pieces: [{ position: [0, 1, 0], velocity: [1, 2] }] }, /pieces\[0\]\.velocity/],
    [{ pieces: [{ position: [0, 1, 0], burst: 5 }] }, /pieces\[0\]\.burst/],
    [{ bursts: [{ position: [0, 0, 0], radius: -1 }] }, /bursts\[0\]\.radius/],
    [{ bursts: null }, /bursts/],
  ];
  for (const [change, re] of bad) assert.throws(() => validateOptions(Object.assign({}, ok, change)), re, JSON.stringify(change));
});

test('colliders: boxes, voxels and their union', () => {
  const box = boxCollider([{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [5, 5, 5], max: [6, 6, 6] }]);
  assert.ok(box(0.5, 0.5, 0.5) && box(5.5, 6, 5) && !box(2, 2, 2) && !box(0.5, 1.5, 0.5));
  const vox = voxelCollider((i, j, k) => i === 2 && j === 0 && k === -1, 0.5, [0, 0, 0]);
  assert.ok(vox(1.2, 0.1, -0.2) && !vox(0.2, 0.1, -0.2));
  const any = anyCollider(box, vox);
  assert.ok(any(0.5, 0.5, 0.5) && any(1.2, 0.1, -0.2) && !any(3, 3, 3));
});

// A small scene like examples/explode.html: a hollow voxel tower, two bursts, a wall. Cells no burst reaches stay solid.
function towerScene({ secondary = 0, seed = 4242 } = {}) {
  const S = 0.25, NX = 12, NY = 16, NZ = 12, grid = new Uint8Array(NX * NY * NZ), pieces = [];
  const bursts = [{ position: [1.5, 0.8, 0], direction: [0, 0.3, -1], radius: 1.4, time: 0.2 }, { position: [0, 2.5, 1.5], radius: 1.1, time: 0.6 }];
  const reached = p => bursts.some(b => Math.hypot(p[0] - b.position[0], p[1] - b.position[1], p[2] - b.position[2]) < b.radius);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
    if (!(i === 0 || k === 0 || i === NX - 1 || k === NZ - 1 || j === NY - 1)) continue;
    const position = [(i + 0.5) * S, (j + 0.5) * S, (k + 0.5) * S];
    pieces.push({ position, color: 0xccbbaa });
    if (!reached(position)) grid[i + NX * (j + NY * k)] = 1;
  }
  const cell = (x, y, z) => { const i = Math.floor(x / S), j = Math.floor(y / S), k = Math.floor(z / S);
    return i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ && grid[i + NX * (j + NY * k)] === 1; };
  const wall = (x, y, z) => x >= -3 && x <= 6 && y >= 0 && y <= 2 && z >= -2.6 && z <= -2.2;
  const solid = (x, y, z) => cell(x, y, z) || wall(x, y, z);
  const o = Object.assign({}, base, { solid, snap: S, secondary, seed, duration: 10 });
  const rnd = mulberry32(o.seed);
  let recs = launchPieces(pieces, bursts, o, rnd);
  if (secondary > 0) recs = addSecondary(recs, o, rnd);
  return { o, recs, seg: simulate(recs, o) };
}
const digest = ({ recs, seg }) => createHash('sha256').update(Buffer.from(seg.data.buffer))
  .update(JSON.stringify(recs.map(d => [d.t0, d.restT, d.split ?? 0, d.hidden ? 1 : 0]))).digest('hex').slice(0, 16);

test('at any time, no flying piece is inside solid or below the ground', () => {
  const { o, recs, seg } = towerScene();
  let flying = 0;
  recs.forEach((d, i) => {
    if (d.kind !== 0 || d.t0 > 1e8) return; flying++;
    for (let t = 0; t <= o.duration; t += 1 / 60) {
      const [x, y, z] = positionAt(seg, recs, i, t, o.gravity);
      assert.ok(!o.solid(x, y, z), `piece ${i} inside solid at local t=${t.toFixed(3)}: ${[x, y, z].map(v => v.toFixed(3))}`);
      assert.ok(y >= o.ground - 1e-3, `piece ${i} below the ground at local t=${t.toFixed(3)}: y=${y}`);
    }
  });
  assert.ok(flying > 50, `only ${flying} pieces fly; the scene is too small to test`);
});

// Golden value for this source. If a change to the bake is meant to change the output, check the examples
// by eye and update the value. (Math.sin/exp may differ in the last bit on other engines; then this fails too.)
const GOLDEN = '1f4dea89846d054e';
test('the bake is deterministic and matches the golden output', () => {
  const a = digest(towerScene({ secondary: 0.3 })), b = digest(towerScene({ secondary: 0.3 }));
  assert.equal(a, b, 'two bakes with the same seed differ');
  assert.equal(a, GOLDEN, `bake output changed: ${a}`);
});
