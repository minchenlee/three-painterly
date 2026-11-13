// Brush plumbing of PainterlyPass. Runs in Node: no GL context, so shaders are not compiled here.
// Compile checks need a browser: open examples/basic.html and switch brushes (see AGENTS.md, GPU checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene } from 'three';
import { PainterlyPass, impressionist, pointillist } from '../src/index.js';
import { paintHead, paintBody } from '../src/shaders.js';

const hooks = [
  /vec3 brushPalette\(vec3 \w+, float \w+\)/, /vec3 brushGround\(vec3 \w+\)/,
  /float brushMark\(vec2 \w+, float \w+, vec2 \w+, float \w+, out vec2 \w+, out float \w+\)/,
  /vec3 brushShade\(vec3 \w+, float \w+, float \w+, vec2 \w+\)/, /vec3 brushFinish\(vec3 \w+, vec2 \w+\)/,
];
const fakeRenderer = { getPixelRatio: () => 1 };
function make(options) {
  const pass = new PainterlyPass(new Scene(), new PerspectiveCamera(45, 1, 0.1, 100), options);
  pass.setSize(64, 64);
  return pass;
}
// what one frame would set, without drawing
function sync(pass) {
  pass._ensureTargets(); pass._ensurePaint(); pass._syncUniforms(fakeRenderer);
  return { search: pass._paint.defines.SEARCH, reach: pass._paint.uniforms.uReach.value };
}

test('every brush defines the five brush functions once', () => {
  for (const brush of [impressionist(), pointillist()]) {
    for (const re of hooks) assert.equal(brush.glsl.match(new RegExp(re, 'g'))?.length, 1, `${brush.name}: ${re}`);
    assert.equal(typeof brush.reach, 'function');
  }
});

test('the default brush is impressionist; the shader is head + brush + body', () => {
  const pass = make();
  assert.equal(pass.brush.name, 'impressionist');
  assert.equal(pass._paint.fragmentShader, paintHead + '\n' + impressionist().glsl + '\n' + paintBody);
  pass.dispose();
});

test('impressionist keeps the search window of 0.1.0', () => {
  // 0.1.0: reach = 1.0607 * max(1.85 * strokeLength, 0.58 * strokeWidth);
  // search = strokeLength <= 1 ? 4 : min(7, max(4, ceil(2 * reach + 1))); uReach = search == 7 ? min(reach, 3) : reach
  for (const [strokeLength, strokeWidth] of [[1, 1], [0.5, 1], [1, 6], [1.01, 1], [1.2, 1], [1.4, 1], [1.53, 1], [2.5, 1], [1.1, 4]]) {
    const reach = 1.0607 * Math.max(1.85 * strokeLength, 0.58 * strokeWidth);
    const search = strokeLength <= 1 ? 4 : Math.min(7, Math.max(4, Math.ceil(2 * reach + 1)));
    const pass = make({ strokeLength, strokeWidth });
    assert.deepEqual(sync(pass), { search, reach: search === 7 ? Math.min(reach, 3) : reach }, `strokeLength ${strokeLength}, strokeWidth ${strokeWidth}`);
    pass.dispose();
  }
});

test('pointillist tests 3 x 3 cells at the default dab size and more for large dabs', () => {
  const pass = make({ brush: pointillist() });
  assert.equal(pass.brush.name, 'pointillist');
  const a = sync(pass);
  assert.equal(a.search, 3);
  assert.ok(a.reach <= 1, 'a 3 x 3 window holds a reach of 1 cell');   // (search - 1) / 2
  pass.strokeWidth = 2;
  const b = sync(pass);
  assert.ok(b.search >= 2 * b.reach + 1 && b.search <= 7);
  pass.strokeWidth = 40;
  assert.deepEqual(sync(pass), { search: 7, reach: 3 });
  pass.dispose();
});

test('brush uniforms are live and belong to one brush', () => {
  const a = pointillist({ purity: 0.5 }), b = pointillist();
  assert.equal(a.uniforms.uPurity.value, 0.5);
  assert.equal(b.uniforms.uPurity.value, 0.8);
  const pass = make({ brush: a });
  assert.equal(pass._paint.uniforms.uPurity, a.uniforms.uPurity);
  assert.equal(pass._paint.uniforms.uSaturation, pass._uniforms.uSaturation);
  pass.dispose();
});

test('setting brush builds a new material; null gives the default', () => {
  const pass = make();
  const first = pass._paint;
  let disposed = false; first.addEventListener('dispose', () => { disposed = true; });
  pass.brush = pointillist();
  sync(pass);
  assert.notEqual(pass._paint, first);
  assert.ok(disposed, 'the old material is disposed');
  assert.equal(pass._paintQuad.material, pass._paint);
  assert.ok(pass._paint.fragmentShader.includes('uPigments'));
  const same = pass._paint;
  pass.brush = pass.brush; sync(pass);
  assert.equal(pass._paint, same, 'the same brush does not rebuild');
  pass.brush = null; sync(pass);
  assert.equal(pass.brush.name, 'impressionist');
  assert.ok(!pass._paint.fragmentShader.includes('uPigments'));
  pass.dispose();
});

test('bad brushes throw; unknown pointillist options warn', () => {
  assert.throws(() => make({ brush: { glsl: 'x' } }), /brush needs glsl/);
  assert.throws(() => make({ brush: { reach: () => 1 } }), /brush needs glsl/);
  assert.throws(() => make({ brush: { ...pointillist(), uniforms: { uRes: { value: 1 } } } }), /brush uniform "uRes"/);
  const warn = console.warn, seen = [];
  console.warn = m => seen.push(m);
  try { pointillist({ purty: 1 }); } finally { console.warn = warn; }
  assert.match(seen[0], /unknown option "purty"/);
});
