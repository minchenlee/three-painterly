import {
  BoxGeometry, DataTexture, FloatType, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  MeshDepthMaterial, MeshDistanceMaterial, MeshStandardMaterial, NearestFilter, PlaneGeometry, RGBADepthPacking, RGBAFormat,
  Color, ShaderMaterial, Vector2,
} from 'three';
import { launchPieces, addSecondary, simulate, mulberry32, validateOptions } from './bake.js';
import { patchCube, patchDepth, strokeVertex, strokeFragment, withDisplace } from './shaders.js';

const MAX_BURSTS = 32;   // must match MAX_BURSTS in shaders.js
// uniforms of the stroke material, besides the debris uniforms; hook uniforms must not reuse these names
const STROKE_UNIFORMS = ['tDepth', 'uUseDepth', 'uRes', 'uPixK', 'uStrokeScale', 'uMaxWidth', 'uBright', 'uTint', 'uJitter', 'uLookAhead', 'uKeep', 'uHideFlying'];
const hashString = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

// a misspelt option is otherwise silently ignored
function warnUnknown(options) {
  for (const k in options) if (!(k in BakedDebris.defaults) && k !== 'pieces' && k !== 'bursts') console.warn(`BakedDebris: unknown option "${k}" is ignored`);
}

/**
 * Explosion debris whose collisions are simulated once ("baked") and then played back on the GPU.
 * Any moment can be shown directly with setTime(t), so playback can be scrubbed, rewound and sped up.
 *
 *   const boom = new BakedDebris({ pieces, bursts, solid: (x, y, z) => world.isSolid(x, y, z), ground: 0 });
 *   scene.add(boom.mesh);
 *   boom.setTime(seconds);
 */
export class BakedDebris {
  static defaults = {
    pieceSize: 0.25,          // default cube size (world units)
    gravity: 9.81,
    speed: [7, 18],           // launch speed range (world units / s) near the burst centre
    stagger: 1,               // 0 = every piece leaves at its burst time; 1 = pieces leave over ~0.85 s
    spin: 9,                  // max spin (rad / s)
    restitution: 0.35,        // bounce: share of speed kept across a hit
    friction: 0.6,            // horizontal speed kept at each floor hit
    stopSpeed: 0.6,           // a floor hit slower than this ends the motion
    ground: 0,                // y of a ground plane, or null
    solid: null,              // (x, y, z) => boolean, extra collision geometry
    snap: 0,                  // voxel size: rest exactly on voxel tops (0 = rest where the hit happened)
    killY: -50,               // pieces that fall below this stop being simulated
    duration: 20,             // seconds of motion simulated per piece
    step: 1 / 90,
    secondary: 0,             // share of flying pieces that burst again in mid-air (0..1)
    secondaryDelay: [0.12, 0.45],
    secondarySpeed: [3.5, 8],
    seed: 4242,
    timeWarp: null,           // { burst: 0.3, hover: 1/25 }: full speed for `burst` s, then the clock slows to `hover`
    sizeScale: 1,             // resize pieces once they fly
    castShadow: true,         // the cubes cast shadows (also settable later on boom.mesh)
    receiveShadow: true,
    displace: null,           // { glsl, uniforms }: GLSL vec3 debrisDisplace(vec3 p, DebrisInfo d) adds an offset per piece
    material: null,           // a MeshStandardMaterial (or similar) to copy and patch; one is made if omitted
  };

  constructor(options) {
    warnUnknown(options);
    this.o = {};
    for (const k in BakedDebris.defaults) { const v = BakedDebris.defaults[k]; this.o[k] = Array.isArray(v) ? v.slice() : v; }
    Object.assign(this.o, options);
    if (!this.o.pieces || !this.o.bursts) throw new Error('BakedDebris needs `pieces` and `bursts`');
    this._hideFlying = { value: 0 };
    this.uniforms = {
      uTime: { value: 0 }, uWarp: { value: 0 }, uBurstT: { value: 0.3 }, uHover: { value: 0.04 },
      uGravity: { value: this.o.gravity }, uSizeScale: { value: this.o.sizeScale }, uSeg: { value: null }, uSegW: { value: 4096 },
      uBurstShift: { value: new Array(MAX_BURSTS).fill(0) },
    };
    // a passed material is cloned, so it stays usable elsewhere; its hooks still run (see patchCube)
    const src = this.o.material, mat = src ? src.clone() : new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mat.vertexColors = true; mat.userData.debrisUniforms = this.uniforms; patchCube(mat, this._hideFlying, src);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.userData.debrisUniforms = this.uniforms; patchDepth(depth, this._hideFlying);
    this.mesh = new Mesh(new InstancedBufferGeometry(), mat);
    const dist = new MeshDistanceMaterial();
    dist.userData.debrisUniforms = this.uniforms; patchDepth(dist, this._hideFlying, 'baked-debris-distance');
    this.mesh.customDepthMaterial = depth;
    this.mesh.customDistanceMaterial = dist;     // point-light shadows
    this.mesh.castShadow = this.o.castShadow; this.mesh.receiveShadow = this.o.receiveShadow;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = renderer => this._checkTexture(renderer);
    this._displace = { glsl: null, hash: '0', names: [] };
    for (const m of [mat, depth, dist]) m.userData.debrisDisplace = this._displace;
    this.strokes = null;
    this.setTimeWarp(this.o.timeWarp);
    validateOptions(this.o);
    if (this.o.displace) this.setDisplace(this.o.displace);
    this.rebake();
  }

  /**
   * Re-run the simulation, e.g. after changing pieces, bursts, gravity, restitution or secondary.
   * Any option can be passed; gravity, sizeScale and timeWarp also update the GPU side.
   */
  rebake(changes = {}) {
    warnUnknown(changes);
    validateOptions(Object.assign({}, this.o, changes));   // throws before anything changes
    Object.assign(this.o, changes);
    const o = this.o, rnd = mulberry32(o.seed);
    let recs = launchPieces(o.pieces, o.bursts, o, rnd);
    if (o.secondary > 0) recs = addSecondary(recs, o, rnd);
    const seg = simulate(recs, o);
    this.records = recs;
    this.stats = {
      pieces: recs.length,
      flying: recs.filter(d => d.kind === 0 && d.t0 < 1e8).length,
      secondary: recs.filter(d => d.split > 0 && d.splitOK).length,
    };

    const tex = new DataTexture(seg.data, seg.width, seg.height, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter; tex.needsUpdate = true;
    this.uniforms.uSeg.value?.dispose(); this.uniforms.uSeg.value = tex; this.uniforms.uSegW.value = seg.width;

    // Instance order (C1): pieces that never move, then flying pieces, then fragments, then hidden ones.
    // aIndex keeps each piece's row in the texture (fragments start from their parent's row, so rows stay in bake
    // order). Hidden pieces are never drawn; with strokes on, cubes draw only the first two groups and strokes
    // draw only the last two drawn groups.
    const n = recs.length, group = d => d.hidden ? 3 : d.kind === 1 ? 2 : d.t0 < 1e8 ? 1 : 0;
    const count = [0, 0, 0, 0]; for (const d of recs) count[group(d)]++;
    const next = [0, count[0], count[0] + count[1], count[0] + count[1] + count[2]], order = new Uint32Array(n);
    recs.forEach((d, i) => { order[next[group(d)]++] = i; });
    this._groups = { still: count[0], flying: count[1], fragments: count[2], hidden: count[3] };
    const index = new Float32Array(n), start = new Float32Array(n), size = new Float32Array(n), axis = new Float32Array(n * 3),
      color = new Float32Array(n * 3), kind = new Float32Array(n), split = new Float32Array(n),
      burst = new Float32Array(n), life = new Float32Array(n), rest = new Float32Array(n), c = new Color();
    for (let j = 0; j < n; j++) {
      const i = order[j], d = recs[i];
      index[j] = i; start[j] = d.t0; size[j] = d.hidden ? 0 : d.size; axis.set(d.axis, j * 3); kind[j] = d.kind;
      burst[j] = d.burst ?? -1; life[j] = d.life ?? 0; rest[j] = d.restT ?? 1e9;
      split[j] = d.kind === 1 ? recs[d.parent].split : (d.splitOK ? d.split : 0);
      c.set(d.color ?? 0xcccccc); color.set([c.r, c.g, c.b], j * 3);   // three converts sRGB hex to linear
    }
    const attrs = { aIndex: [index, 1], aStart: [start, 1], aSize: [size, 1], aAxis: [axis, 3], aColor: [color, 3], aKind: [kind, 1],
      aSplit: [split, 1], aBurst: [burst, 1], aLife: [life, 1], aRest: [rest, 1] };
    const build = (base, from, to) => { const g = new InstancedBufferGeometry(); g.index = base.index;
      for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
      for (const k in attrs) { const [a, w] = attrs[k]; g.setAttribute(k, new InstancedBufferAttribute(a.subarray(from * w, to * w), w)); }
      g.instanceCount = to - from; return g; };
    const drawn = n - count[3];
    this.mesh.geometry.dispose(); this.mesh.geometry = build(new BoxGeometry(1, 1, 1), 0, drawn);
    this._buildStrokeGeo = () => build(new PlaneGeometry(1, 1), count[0], drawn);
    if (this.strokes) { this.strokes.geometry.dispose(); this.strokes.geometry = this._buildStrokeGeo(); }
    this._syncCounts();
    // keep the GPU in step with the options the bake used
    this.uniforms.uGravity.value = o.gravity;
    if ('sizeScale' in changes) this.setSizeScale(o.sizeScale);
    if ('timeWarp' in changes) this.setTimeWarp(o.timeWarp);
    if ('displace' in changes) this.setDisplace(o.displace);
    return this.stats;
  }

  // the segment texture is 4096 texels wide and grows in height with the piece count
  _checkTexture(renderer) {
    const tex = this.uniforms.uSeg.value, max = renderer.capabilities.maxTextureSize;
    if (this._checked === tex) return;
    const { width, height } = tex.image;
    if (width > max || height > max) throw new Error(`BakedDebris: ${this.records.length} pieces need a ${width}x${height} segment texture, `
      + `but this GPU's maxTextureSize is ${max}. Use at most ${Math.floor(max * Math.min(max, width) / 12)} pieces (fragments count).`);
    this._checked = tex;
  }

  // cubes skip fragments while strokes draw them (flying pieces stay in: they are cubes until they launch)
  _syncCounts() {
    const g = this._groups;
    this.mesh.geometry.instanceCount = g.still + g.flying + (this.strokes ? 0 : g.fragments);
  }

  /**
   * Add a GPU offset to every piece: { glsl, uniforms }, where glsl defines vec3 debrisDisplace(vec3 p, DebrisInfo d)
   * and may declare its own uniforms; null removes it. Cubes, both shadow materials and strokes use it.
   * Changing the code recompiles; changing boom.uniforms.<name>.value does not. The bake does not know the offset.
   */
  setDisplace(h) {
    validateOptions(Object.assign({}, this.o, { displace: h }));
    const old = this._displace.names, names = h?.uniforms ? Object.keys(h.uniforms) : [];
    for (const k of names) if ((k in this.uniforms && !old.includes(k)) || STROKE_UNIFORMS.includes(k))
      throw new Error(`BakedDebris: displace uniform "${k}" clashes with a built-in uniform; rename it`);
    for (const k of old) { delete this.uniforms[k]; if (this.strokes) delete this.strokes.material.uniforms[k]; }
    for (const k of names) { this.uniforms[k] = h.uniforms[k]; if (this.strokes) this.strokes.material.uniforms[k] = h.uniforms[k]; }
    Object.assign(this._displace, { glsl: h ? h.glsl : null, hash: h ? hashString(h.glsl) : '0', names });
    this.o.displace = h ?? null;
    for (const m of [this.mesh.material, this.mesh.customDepthMaterial, this.mesh.customDistanceMaterial]) m.needsUpdate = true;
    if (this.strokes) { this.strokes.material.vertexShader = withDisplace(strokeVertex, this._displace.glsl); this.strokes.material.needsUpdate = true; }
  }

  /** Show the explosion at `t` seconds. Exact for any t, forward or backward. */
  setTime(t) { this.uniforms.uTime.value = t; }

  /** null for real time, or { burst, hover } for bullet time. */
  setTimeWarp(w) {
    this.uniforms.uWarp.value = w ? 1 : 0;
    if (w) { this.uniforms.uBurstT.value = w.burst ?? 0.3; this.uniforms.uHover.value = w.hover ?? 1 / 25; }
  }

  setSizeScale(s) { this.uniforms.uSizeScale.value = s; }

  /**
   * Move bursts in time without a new bake: offsets[i] seconds are added to burst i and to every piece it launched.
   * Collisions are with static geometry, so the paths stay exact. Only the first 32 bursts can be moved.
   */
  setBurstOffsets(offsets) {
    const u = this.uniforms.uBurstShift.value;
    for (let i = 0; i < MAX_BURSTS; i++) u[i] = offsets[i] ?? 0;
  }

  /**
   * Flying pieces drawn as brush strokes (for PainterlyPass). Returns a Mesh to render after the painting,
   * e.g. painter.overlayScene.add(boom.createStrokes({ painter })). While strokes are on, flying cubes are hidden.
   * lookAhead: seconds between the two samples that point the stroke (default -0.03, a moment back). Use a positive
   * value when the clock runs backwards, so strokes still point the way pieces move on screen.
   * keep: the share of flying pieces drawn as strokes (0..1, default 1). Each piece's choice is fixed, so nothing
   * flickers; with large strokes, a lower keep saves overdraw. Change it later with mesh.material.uniforms.uKeep.value.
   */
  createStrokes({ painter = null, strokeScale = 1.25, maxWidth = 34, jitter = 0.16, lookAhead = -0.03, keep = 1 } = {}) {
    if (!(keep >= 0 && keep <= 1)) throw new Error(`BakedDebris: createStrokes keep must be between 0 and 1, got ${keep}`);
    this.removeStrokes();                                     // one stroke mesh at a time
    const U = Object.assign({}, this.uniforms, {
      tDepth: { value: null }, uUseDepth: { value: false }, uRes: { value: new Vector2(1, 1) }, uPixK: { value: 500 },
      uStrokeScale: { value: strokeScale }, uMaxWidth: { value: maxWidth }, uBright: { value: 1 }, uTint: { value: new Color(1, 1, 1) },
      uJitter: { value: jitter }, uLookAhead: { value: lookAhead }, uKeep: { value: keep },
    });
    const mat = new ShaderMaterial({ uniforms: U, vertexShader: withDisplace(strokeVertex, this._displace.glsl), fragmentShader: strokeFragment, toneMapped: false });
    const mesh = new Mesh(this._buildStrokeGeo(), mat);
    mesh.frustumCulled = false;
    const size = new Vector2();
    mesh.onBeforeRender = (renderer, scene, camera) => {     // keep screen size, depth and pixel scale current
      renderer.getDrawingBufferSize(size);
      const target = renderer.getRenderTarget();
      if (target) size.set(target.width, target.height);
      U.uRes.value.copy(size);
      U.uPixK.value = size.y / (2 * Math.tan((camera.fov * Math.PI) / 360) / (camera.zoom || 1));
      U.uMaxWidth.value = maxWidth * renderer.getPixelRatio();
      const dt = painter?.sceneTarget?.depthTexture ?? null;
      U.tDepth.value = dt; U.uUseDepth.value = !!dt;
    };
    this.strokes = mesh;
    this._hideFlying.value = 1; this._syncCounts();
    return mesh;
  }

  /** Stop drawing strokes and show flying cubes again. */
  removeStrokes() {
    if (!this.strokes) return;
    this.strokes.parent?.remove(this.strokes); this.strokes.geometry.dispose(); this.strokes.material.dispose();
    this.strokes = null; this._hideFlying.value = 0; this._syncCounts();
  }

  dispose() {
    this.removeStrokes();
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.customDepthMaterial.dispose(); this.mesh.customDistanceMaterial.dispose();
    this.uniforms.uSeg.value?.dispose();
  }
}
