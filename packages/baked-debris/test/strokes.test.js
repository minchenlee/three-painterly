// The look of flying strokes (createStrokes). Runs in Node: no GL context, so shaders are not compiled here.
// test/api.html compiles them in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BakedDebris, strokeFragment } from '../src/index.js';
import { oilStroke, strokeShaders, strokeVertex, withDisplace } from '../src/shaders.js';

const make = (over = {}) => new BakedDebris({ pieces: [{ position: [0, 1, 0] }, { position: [0.3, 1, 0] }], bursts: [{ position: [0, 0.5, 0], radius: 2 }], ...over });
const renderer = { getDrawingBufferSize: v => v.set(64, 64), getRenderTarget: () => null, getPixelRatio: () => 1 };
const camera = { fov: 45, zoom: 1 };
const draw = mesh => mesh.onBeforeRender(renderer, null, camera);   // what the renderer calls before each draw

// a small look of its own: a square mark in the piece colour
const square = name => ({
  name,
  flying: {
    vertex: 'float strokeStretch(float spd) { return 1.0; }',
    fragment: `uniform float uMine; // ${name}
      vec3 strokePalette(vec3 c, float r) { return c * uMine; }
      bool strokeMark(vec2 q, float seed, out float w) { w = 0.0; return true; }
      vec3 strokeShade(vec3 col, vec2 q, float seed, float w) { return col; }`,
  },
  uniforms: { uMine: { value: 1 } },
});

test('strokeVertex and strokeFragment are the oil look, complete', () => {
  assert.deepEqual(strokeShaders(), { vertex: strokeVertex, fragment: strokeFragment });
  assert.deepEqual(strokeShaders(oilStroke), { vertex: strokeVertex, fragment: strokeFragment });
  for (const fn of ['strokePalette(vec3 c, float r)', 'strokeMark(vec2 q, float seed, out float w)', 'strokeShade(vec3 col, vec2 q, float seed, float w)'])
    assert.equal(strokeFragment.split(fn + ' {').length, 2, `${fn} is defined once`);
  assert.match(strokeVertex, /float strokeStretch\(float spd\) \{/);
  assert.ok(!/stroke look \*\//.test(strokeVertex + strokeFragment), 'no hook mark is left');
  assert.match(strokeVertex, /flat varying float vPiece;/);
  assert.ok(!/vPiece/.test(strokeFragment), 'the oil fragment needs no vPiece, so it links with any vertex shader');
});

test('a malformed look throws', () => {
  assert.throws(() => strokeShaders({ vertex: 'x' }), /stroke look needs vertex and fragment/);
  assert.throws(() => make().createStrokes({ brush: { flying: { fragment: 'x' } } }), /stroke look needs vertex and fragment/);
});

test('no brush, or a brush without a flying part, gives the oil stroke', () => {
  const boom = make();
  for (const options of [{}, { brush: { name: 'no flying part', uniforms: { uOther: { value: 1 } } } }, { painter: { sceneTarget: null } }, { painter: { sceneTarget: null, brush: {} } }]) {
    const m = boom.createStrokes(options).material;
    assert.equal(m.fragmentShader, strokeFragment);
    assert.equal(m.vertexShader, withDisplace(strokeVertex, null));
    assert.ok(!('uOther' in m.uniforms), 'uniforms of a brush without a flying part are not added');
  }
  boom.dispose();
});

test('the brush option sets the look and shares the brush uniforms', () => {
  const boom = make(), brush = square('a');
  const mesh = boom.createStrokes({ brush, painter: { sceneTarget: null, brush: square('painter') } });
  assert.deepEqual({ vertex: mesh.material.vertexShader, fragment: mesh.material.fragmentShader },
    { vertex: withDisplace(strokeShaders(brush.flying).vertex, null), fragment: strokeShaders(brush.flying).fragment });
  assert.equal(mesh.material.uniforms.uMine, brush.uniforms.uMine);
  const v = mesh.material.version;
  draw(mesh);
  assert.equal(mesh.material.version, v, 'a given brush stays: the painter\'s brush is not followed');
  boom.dispose();
});

test('without the brush option, strokes follow painter.brush', () => {
  const boom = make(), a = square('a'), b = square('b'), painter = { sceneTarget: null, brush: a };
  const mesh = boom.createStrokes({ painter }), m = mesh.material;
  assert.match(m.fragmentShader, /uniform float uMine; \/\/ a\n/);
  let v = m.version;
  draw(mesh);
  assert.equal(m.version, v, 'the same brush does not recompile');
  painter.brush = b; draw(mesh);
  assert.match(m.fragmentShader, /uniform float uMine; \/\/ b\n/);
  assert.equal(m.uniforms.uMine, b.uniforms.uMine);
  assert.ok(m.version > v, 'a new brush recompiles');
  painter.brush = null; draw(mesh);
  assert.equal(m.fragmentShader, strokeFragment);
  assert.ok(!('uMine' in m.uniforms), 'the old brush uniforms are removed');
  assert.ok('uKeep' in m.uniforms && 'uTime' in m.uniforms, 'built-in uniforms stay');
  boom.dispose();
});

test('the displace hook and the look combine in either order', () => {
  const lift = { glsl: 'uniform float uLift; vec3 debrisDisplace(vec3 p, DebrisInfo d) { return vec3(0.0, uLift, 0.0); }', uniforms: { uLift: { value: 1 } } };
  const brush = square('a'), want = withDisplace(strokeShaders(brush.flying).vertex, lift.glsl);
  const first = make({ displace: lift });
  assert.equal(first.createStrokes({ brush }).material.vertexShader, want);
  const later = make(), painter = { sceneTarget: null, brush: null };
  const mesh = later.createStrokes({ painter });
  later.setDisplace(lift);
  painter.brush = brush; draw(mesh);
  assert.equal(mesh.material.vertexShader, want);
  later.setDisplace(null);
  assert.equal(mesh.material.vertexShader, withDisplace(strokeShaders(brush.flying).vertex, null));
  first.dispose(); later.dispose();
});

test('uniform name clashes throw', () => {
  const clash = name => ({ ...square('c'), uniforms: { [name]: { value: 1 } } });
  assert.throws(() => make().createStrokes({ brush: clash('uKeep') }), /brush uniform "uKeep" clashes/);
  assert.throws(() => make().createStrokes({ brush: clash('uTime') }), /brush uniform "uTime" clashes/);
  const boom = make();
  boom.createStrokes({ brush: square('a') });
  assert.throws(() => boom.setDisplace({ glsl: 'vec3 debrisDisplace(vec3 p, DebrisInfo d) { return vec3(0.0); }', uniforms: { uMine: { value: 2 } } }), /displace uniform "uMine" clashes/);
  boom.removeStrokes();
  assert.equal(boom._stroke, null);
  boom.dispose();
});
