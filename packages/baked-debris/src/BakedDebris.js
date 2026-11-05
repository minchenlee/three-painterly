import {
  BoxGeometry, DataTexture, FloatType, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  MeshDepthMaterial, MeshStandardMaterial, NearestFilter, PlaneGeometry, RGBADepthPacking, RGBAFormat,
  Color, ShaderMaterial, Vector2,
} from 'three';
import { launchPieces, addSecondary, simulate, mulberry32, validateOptions } from './bake.js';
import { patchCube, patchDepth, strokeVertex, strokeFragment } from './shaders.js';

const MAX_BURSTS = 32;   // must match MAX_BURSTS in shaders.js

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
    material: null,           // a MeshStandardMaterial (or similar) to patch; one is made if omitted
  };

  constructor(options) {
    this.o = Object.assign({}, BakedDebris.defaults, options);
    if (!this.o.pieces || !this.o.bursts) throw new Error('BakedDebris needs `pieces` and `bursts`');
    this._hideFlying = { value: 0 };
    this.uniforms = {
      uTime: { value: 0 }, uWarp: { value: 0 }, uBurstT: { value: 0.3 }, uHover: { value: 0.04 },
      uGravity: { value: this.o.gravity }, uSizeScale: { value: this.o.sizeScale }, uSeg: { value: null }, uSegW: { value: 4096 },
      uBurstShift: { value: new Array(MAX_BURSTS).fill(0) },
    };
    const mat = this.o.material ?? new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mat.vertexColors = true; mat.userData.debrisUniforms = this.uniforms; patchCube(mat, this._hideFlying);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.userData.debrisUniforms = this.uniforms; patchDepth(depth, this._hideFlying);
    this.mesh = new Mesh(new InstancedBufferGeometry(), mat);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.strokes = null;
    this.setTimeWarp(this.o.timeWarp);
    this.rebake();
  }

  /**
   * Re-run the simulation, e.g. after changing pieces, bursts, gravity, restitution or secondary.
   * Any option can be passed; gravity, sizeScale and timeWarp also update the GPU side.
   */
  rebake(changes = {}) {
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

    const n = recs.length, start = new Float32Array(n), size = new Float32Array(n), axis = new Float32Array(n * 3),
      color = new Float32Array(n * 3), kind = new Float32Array(n), split = new Float32Array(n),
      burst = new Float32Array(n), life = new Float32Array(n), rest = new Float32Array(n), c = new Color();
    recs.forEach((d, i) => {
      start[i] = d.t0; size[i] = d.hidden ? 0 : d.size; axis.set(d.axis, i * 3); kind[i] = d.kind;
      burst[i] = d.burst ?? -1; life[i] = d.life ?? 0; rest[i] = d.restT ?? 1e9;
      split[i] = d.kind === 1 ? recs[d.parent].split : (d.splitOK ? d.split : 0);
      c.set(d.color ?? 0xcccccc); color.set([c.r, c.g, c.b], i * 3);   // three converts sRGB hex to linear
    });
    const attrs = { aStart: [start, 1], aSize: [size, 1], aAxis: [axis, 3], aColor: [color, 3], aKind: [kind, 1], aSplit: [split, 1],
      aBurst: [burst, 1], aLife: [life, 1], aRest: [rest, 1] };
    const build = base => { const g = new InstancedBufferGeometry(); g.index = base.index;
      for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
      for (const k in attrs) g.setAttribute(k, new InstancedBufferAttribute(attrs[k][0], attrs[k][1]));
      g.instanceCount = n; return g; };
    this.mesh.geometry.dispose(); this.mesh.geometry = build(new BoxGeometry(1, 1, 1));
    if (this.strokes){ this.strokes.geometry.dispose(); this.strokes.geometry = build(new PlaneGeometry(1, 1)); }
    this._buildStrokeGeo = () => build(new PlaneGeometry(1, 1));
    // keep the GPU in step with the options the bake used
    this.uniforms.uGravity.value = o.gravity;
    if ('sizeScale' in changes) this.setSizeScale(o.sizeScale);
    if ('timeWarp' in changes) this.setTimeWarp(o.timeWarp);
    return this.stats;
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
   * e.g. painter.overlays.push(boom.createStrokes({ painter })). While strokes are on, flying cubes are hidden.
   */
  createStrokes({ painter = null, strokeScale = 1.25, maxWidth = 34, jitter = 0.16 } = {}) {
    const U = Object.assign({}, this.uniforms, {
      tDepth: { value: null }, uUseDepth: { value: false }, uRes: { value: new Vector2(1, 1) }, uPixK: { value: 500 },
      uStrokeScale: { value: strokeScale }, uMaxWidth: { value: maxWidth }, uBright: { value: 1 }, uTint: { value: new Color(1, 1, 1) },
      uJitter: { value: jitter },
    });
    const mat = new ShaderMaterial({ uniforms: U, vertexShader: strokeVertex, fragmentShader: strokeFragment, toneMapped: false });
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
    this._hideFlying.value = 1;
    return mesh;
  }

  /** Stop drawing strokes and show flying cubes again. */
  removeStrokes() {
    if (!this.strokes) return;
    this.strokes.parent?.remove(this.strokes); this.strokes.geometry.dispose(); this.strokes.material.dispose();
    this.strokes = null; this._hideFlying.value = 0;
  }

  dispose() {
    this.removeStrokes();
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.customDepthMaterial.dispose();
    this.uniforms.uSeg.value?.dispose();
  }
}
