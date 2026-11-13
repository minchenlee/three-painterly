// Brush plumbing of PainterlyPass. Runs in Node: no GL context, so shaders are not compiled here.
// Compile checks need a browser: open examples/basic.html and switch brushes (see AGENTS.md, GPU checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D, PerspectiveCamera, Scene } from 'three';
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

test('pointillist has a flying part for BakedDebris strokes; impressionist leaves the built-in oil stroke', () => {
  const { flying } = pointillist();
  assert.match(flying.vertex, /float strokeStretch\(float \w+\)/);
  for (const re of [/vec3 strokePalette\(vec3 \w+, float \w+\)/, /bool strokeMark\(vec2 \w+, float \w+, out float \w+\)/, /vec3 strokeShade\(vec3 \w+, vec2 \w+, float \w+, float \w+\)/])
    assert.equal(flying.fragment.match(new RegExp(re, 'g'))?.length, 1, String(re));
  assert.match(flying.fragment, /flat varying float vPiece;/);
  assert.match(flying.vertex, /varying float vTrail;/); assert.match(flying.fragment, /varying float vTrail;/);
  assert.equal(pointillist({ trail: 0 }).uniforms.uTrail.value, 0);
  assert.equal(impressionist().flying, undefined);
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

test('anchors set the ANCHORS define and the matrices; none by default', () => {
  const pass = make();
  sync(pass);
  assert.equal(pass._paint.defines.ANCHORS, 0);
  assert.deepEqual(pass.anchors, []);
  assert.notEqual(pass.anchors, PainterlyPass.defaults.anchors, 'each pass has its own list');
  const parent = new Object3D(), object = new Object3D();
  parent.add(object); parent.position.set(0, 10, 0); object.position.set(3, 0, 0);
  pass.anchors = [{ object, min: [-1, -2, -3], max: [1, 2, 3] }];
  const v = pass._paint.version;
  sync(pass);
  assert.equal(pass._paint.defines.ANCHORS, 1);
  assert.ok(pass._paint.version > v, 'a new count recompiles');
  const u = pass._paint.uniforms;
  assert.deepEqual(u.uAnchor.value[0].elements.slice(12, 15), [3, 10, 0], 'the world matrix includes the parents');
  assert.deepEqual(u.uAnchorInv.value[0].elements.slice(12, 15), [-3, -10, 0]);
  assert.deepEqual([u.uAnchorMin.value[0].toArray(), u.uAnchorMax.value[0].toArray()], [[-1, -2, -3], [1, 2, 3]]);
  const v2 = pass._paint.version;
  object.position.x = 5; sync(pass);
  assert.equal(u.uAnchor.value[0].elements[12], 5, 'the matrix is read on every frame');
  assert.equal(pass._paint.version, v2, 'a moving anchor does not recompile');
  pass.brush = pointillist(); sync(pass);
  assert.equal(pass._paint.defines.ANCHORS, 1, 'a new brush keeps the anchors');
  pass.dispose();
});

test('at most 4 anchors are used; a malformed anchor throws', () => {
  const anchor = () => ({ object: new Object3D(), min: [0, 0, 0], max: [1, 1, 1] });
  const pass = make({ anchors: [anchor(), anchor(), anchor(), anchor(), anchor()] });
  const warn = console.warn, seen = [];
  console.warn = m => seen.push(m);
  try { sync(pass); sync(pass); } finally { console.warn = warn; }
  assert.equal(pass._paint.defines.ANCHORS, 4);
  assert.equal(seen.length, 1, 'one warning');
  assert.match(seen[0], /first 4 anchors/);
  pass.anchors = [{ object: {}, min: [0, 0, 0], max: [1, 1, 1] }];
  assert.throws(() => sync(pass), /anchors\[0\] needs object/);
  pass.anchors = [{ object: new Object3D(), min: [0, 0, 0] }];
  assert.throws(() => sync(pass), /anchors\[0\] needs object/);
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
