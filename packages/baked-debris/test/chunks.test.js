// The shader patches find three.js chunks by name (mustReplace). This checks, without a GPU, that every chunk
// they need is still in the installed three.js shaders for the three patched materials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShaderLib, ShaderChunk, MeshStandardMaterial, MeshDepthMaterial, MeshDistanceMaterial, REVISION } from 'three';
import { patchCube, patchDepth, strokeVertex, withDisplace } from '../src/shaders.js';

// onBeforeCompile sees the shader before #include lines are resolved, as here
const run = (material, lib) => {
  const sh = { vertexShader: ShaderLib[lib].vertexShader, fragmentShader: ShaderLib[lib].fragmentShader, uniforms: {} };
  material.userData.debrisUniforms = {};
  material.onBeforeCompile(sh, null);
  return sh.vertexShader;
};

test(`cube patch finds its chunks in ShaderLib.standard (three r${REVISION})`, () => {
  const m = new MeshStandardMaterial(); patchCube(m, { value: 0 });
  const v = run(m, 'standard');
  assert.match(v, /debrisState\(dbP, dbA, dbS, dbT\)/);
  assert.match(v, /vec3 transformed = rotAxis/);
  assert.match(v, /vColor\.rgb = mix\(aColor/);
});

// ShaderLib.distanceRGBA is called 'distance' in later three releases
for (const [name, Mat, lib, key] of [['depth', MeshDepthMaterial, 'depth', undefined], ['distance', MeshDistanceMaterial, ShaderLib.distanceRGBA ? 'distanceRGBA' : 'distance', 'baked-debris-distance']]) {
  test(`shadow patch finds its chunks in ShaderLib.${lib} (${name})`, () => {
    const m = new Mat(); patchDepth(m, { value: 0 }, key);
    assert.match(run(m, lib), /vec3 transformed = rotAxis/);
  });
}

test('every chunk the patches replace exists in ShaderChunk', () => {
  for (const c of ['common', 'beginnormal_vertex', 'begin_vertex', 'color_vertex']) assert.equal(typeof ShaderChunk[c], 'string', c);
});

test('the displace marker is in the stroke shader', () => {
  assert.match(withDisplace(strokeVertex, null), /vec3 debrisDisplace\(vec3 p, DebrisInfo d\) \{ return vec3\(0\.0\); \}/);
});
