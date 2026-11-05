// CPU tests for the bake: no three.js, no GPU. Run with `node --test packages/baked-debris/test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPieces, simulate, mulberry32, SEGMENTS } from '../src/bake.js';

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
