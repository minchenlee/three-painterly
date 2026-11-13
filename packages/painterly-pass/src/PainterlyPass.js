import {
  DepthTexture, HalfFloatType, Scene, LinearFilter, Matrix4, NoBlending, ShaderMaterial,
  UnsignedIntType, Vector2, Vector3, WebGLRenderTarget,
} from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { quadVertex, paintFragment, copyFragment } from './shaders.js';
import { impressionist } from './brushes/impressionist.js';

/**
 * Renders a scene and repaints it with brush strokes (impressionist oil by default; see the brush option).
 *
 * Strokes are anchored to surfaces in world space (rebuilt from the depth buffer), so they move with
 * the objects instead of sliding across the screen. Use it in place of a RenderPass:
 *
 *   composer.addPass(new PainterlyPass(scene, camera, { strokeSize: 7 }));
 *
 * or on its own:
 *
 *   const painter = new PainterlyPass(scene, camera);
 *   painter.setSize(w * dpr, h * dpr);
 *   painter.render(renderer);          // draws to the screen
 */
// The paint shader rebuilds positions from a standard depth buffer (NDC z = 2d - 1, far plane = 1.0).
// Fail loudly on setups where that is not true, instead of painting the wrong strokes.
function checkRenderer(renderer) {
  if (renderer.isWebGPURenderer) throw new Error('PainterlyPass needs a WebGLRenderer; WebGPURenderer is not supported');
  const caps = renderer.capabilities || {};
  if (caps.logarithmicDepthBuffer) throw new Error('PainterlyPass does not support logarithmicDepthBuffer; create the WebGLRenderer without it');
  if (caps.reverseDepthBuffer || renderer.reverseDepthBuffer) throw new Error('PainterlyPass does not support reverseDepthBuffer; create the WebGLRenderer without it');
}

const MAX_ANCHORS = 4;

export class PainterlyPass extends Pass {
  static defaults = {
    strokeSize: 7,          // stroke cell size in CSS pixels
    amount: 1,              // 0 = original image, 1 = fully painted
    resolutionScale: 0.7,   // the scene and the painting are made at this fraction of the output size
    toneMapping: true,      // apply an ACES fit to the HDR scene before painting
    exposure: 1,
    saturation: 1.15,       // 1.3 suits pale scenes such as stone streets
    shadowTint: [0.78, 0.80, 1.25],   // multiplier for dark tones: cool, violet shadows
    shadowAmount: 0.55,
    warmth: 0.6,            // how much the highlights lean warm
    colorJitter: 0.07,      // unmixed colour per stroke
    strokeLength: 1,
    strokeWidth: 1,
    contrast: 1.1,
    canvas: 0.035,          // canvas weave strength
    sky: true,              // paint the background too
    brush: null,            // the kind of mark and its colours: impressionist() (the default) or pointillist()
    anchors: [],            // moving objects whose marks ride with them: [{ object, min, max }], at most 4
  };

  constructor(scene, camera, options = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this._uniforms = {
      tScene: { value: null }, tDepth: { value: null }, uRes: { value: new Vector2() }, uS: { value: 7 },
      uAmount: { value: 1 }, uExposure: { value: 1 }, uToneMap: { value: 1 }, uSaturation: { value: 1.3 },
      uShadowTint: { value: new Vector3() }, uShadowAmount: { value: 0.55 }, uWarmth: { value: 0.6 },
      uJitter: { value: 0.07 }, uCanvas: { value: 0.035 }, uLength: { value: 1 }, uWidth: { value: 1 }, uReach: { value: 2 },
      uContrast: { value: 1.1 }, uSky: { value: true },
      uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() }, uViewProj: { value: new Matrix4() },
      uCamPos: { value: new Vector3() }, uPixAng: { value: 0.001 },
      uAnchor: { value: [] }, uAnchorInv: { value: [] }, uAnchorMin: { value: [] }, uAnchorMax: { value: [] },
    };
    for (let i = 0; i < MAX_ANCHORS; i++) { const u = this._uniforms; u.uAnchor.value.push(new Matrix4()); u.uAnchorInv.value.push(new Matrix4()); u.uAnchorMin.value.push(new Vector3()); u.uAnchorMax.value.push(new Vector3()); }
    // Own copies of every default (arrays too), then only the known options: a typo is reported,
    // and options cannot replace Pass fields such as enabled, renderToScreen or render.
    const defaults = PainterlyPass.defaults, copy = v => (Array.isArray(v) ? v.slice() : v);
    for (const k in defaults) this[k] = copy(defaults[k]);
    for (const k in options) {
      if (Object.prototype.hasOwnProperty.call(defaults, k)) this[k] = copy(options[k]);
      else console.warn(`PainterlyPass: unknown option "${k}" ignored`);
    }
    this.needsSwap = true;

    this._size = new Vector2(1, 1);
    this._targetSize = new Vector2(0, 0);
    this.sceneTarget = null;      // HDR scene colour + depth at the paint resolution (readable by other effects)
    this.paintTarget = null;
    this.overlayScene = new Scene();   // drawn on top of the painting, e.g. BakedDebris brush strokes

    this._paint = null;           // built for the current brush by _ensurePaint
    this._copy = new ShaderMaterial({
      uniforms: { tPaint: { value: null } },
      vertexShader: quadVertex, fragmentShader: copyFragment,
      depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
    });
    this._paintQuad = new FullScreenQuad(null);
    this._copyQuad = new FullScreenQuad(this._copy);
    this._ensurePaint();
  }

  /** The brush: what one mark looks like and how it is coloured. Set it at any time; null gives the default. */
  get brush() { return this._brush; }
  set brush(value) {
    const brush = value ?? impressionist();
    if (brush === this._brush) return;
    if (typeof brush.glsl !== 'string' || typeof brush.reach !== 'function') throw new Error('PainterlyPass: a brush needs glsl (a string) and reach (a function)');
    for (const k in brush.uniforms) if (k in this._uniforms) throw new Error(`PainterlyPass: brush uniform "${k}" is used by the pass; choose another name`);
    this._brush = brush;
    this._brushChanged = true;
  }

  // The paint material holds the brush's GLSL, so a new brush needs a new material (one shader compile).
  _ensurePaint() {
    if (this._paint && !this._brushChanged) return;
    this._paint?.dispose();
    this._paint = new ShaderMaterial({
      uniforms: { ...this._uniforms, ...this._brush.uniforms },   // uniform objects are shared: brush.uniforms stays live
      defines: { SEARCH: 4, ANCHORS: 0 },
      vertexShader: quadVertex, fragmentShader: paintFragment(this._brush.glsl),
      depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
    });
    this._paintQuad.material = this._paint;
    this._brushChanged = false;
  }

  /** Output size in device pixels (EffectComposer calls this for you). */
  setSize(width, height) {
    this._size.set(Math.max(1, width), Math.max(1, height));
  }

  _ensureTargets() {
    const w = Math.max(2, Math.round(this._size.x * this.resolutionScale));
    const h = Math.max(2, Math.round(this._size.y * this.resolutionScale));
    if (this.sceneTarget && this._targetSize.x === w && this._targetSize.y === h) return;
    this.sceneTarget?.depthTexture?.dispose(); this.sceneTarget?.dispose(); this.paintTarget?.dispose();
    this.sceneTarget = new WebGLRenderTarget(w, h, { type: HalfFloatType });
    this.sceneTarget.depthTexture = new DepthTexture(w, h, UnsignedIntType);
    this.paintTarget = new WebGLRenderTarget(w, h, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
    this._targetSize.set(w, h);
  }

  _syncUniforms(renderer) {
    const u = this._paint.uniforms, cam = this.camera;
    cam.updateMatrixWorld();
    u.tScene.value = this.sceneTarget.texture;
    u.tDepth.value = this.sceneTarget.depthTexture;
    u.uRes.value.copy(this._targetSize);
    u.uS.value = this.strokeSize * renderer.getPixelRatio() * this.resolutionScale;
    u.uAmount.value = this.amount;
    u.uExposure.value = this.exposure;
    u.uToneMap.value = this.toneMapping ? 1 : 0;
    u.uSaturation.value = this.saturation;
    u.uShadowTint.value.fromArray(this.shadowTint);
    u.uShadowAmount.value = this.shadowAmount;
    u.uWarmth.value = this.warmth;
    u.uJitter.value = this.colorJitter;
    u.uCanvas.value = this.canvas;
    u.uLength.value = this.strokeLength;
    u.uWidth.value = this.strokeWidth;
    // The brush says how far a mark reaches from its centre, in cells. Each pixel tests enough cells for that
    // reach (2 x reach + 1 per side), or the number the brush asks for; at most 7 x 7, where the reach is capped to fit.
    const brush = this._brush, reach = brush.reach(this);
    const search = Math.min(7, Math.max(2, Math.ceil(brush.search ? brush.search(this, reach) : 2 * reach + 1)));
    if (this._paint.defines.SEARCH !== search) { this._paint.defines.SEARCH = search; this._paint.needsUpdate = true; }   // recompiles only when the window size changes
    u.uReach.value = search === 7 ? Math.min(reach, 3) : reach;   // also the early-out radius
    u.uContrast.value = this.contrast;
    u.uSky.value = this.sky;
    // Anchors: pixels inside an anchor's box (in the object's own space) get their marks laid in that space.
    const anchors = this.anchors || [], n = Math.min(anchors.length, MAX_ANCHORS);
    if (anchors.length > MAX_ANCHORS && !this._warnedAnchors) { console.warn(`PainterlyPass: only the first ${MAX_ANCHORS} anchors are used`); this._warnedAnchors = true; }
    if (this._paint.defines.ANCHORS !== n) { this._paint.defines.ANCHORS = n; this._paint.needsUpdate = true; }   // recompiles only when the count changes
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      if (!a?.object?.isObject3D || !a.min || !a.max) throw new Error(`PainterlyPass: anchors[${i}] needs object (an Object3D), min and max ([x, y, z] in the object's own space)`);
      a.object.updateWorldMatrix(true, false);
      u.uAnchor.value[i].copy(a.object.matrixWorld); u.uAnchorInv.value[i].copy(a.object.matrixWorld).invert();
      u.uAnchorMin.value[i].fromArray(a.min); u.uAnchorMax.value[i].fromArray(a.max);
    }
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cam.getWorldPosition(u.uCamPos.value);
    const halfTan = Math.tan((cam.fov * Math.PI) / 360) / (cam.zoom || 1);
    u.uPixAng.value = (2 * halfTan) / this._targetSize.y;
  }

  render(renderer, writeBuffer = null /*, readBuffer, deltaTime, maskActive */) {
    if (!this.camera.isPerspectiveCamera) throw new Error('PainterlyPass needs a PerspectiveCamera');
    if (this._checkedRenderer !== renderer) { checkRenderer(renderer); this._checkedRenderer = renderer; }
    if (this._size.x <= 1) { const s = renderer.getDrawingBufferSize(new Vector2()); this.setSize(s.x, s.y); }
    this._ensureTargets();
    this._ensurePaint();

    const prevTarget = renderer.getRenderTarget(), prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(this.scene, this.camera);

    this._syncUniforms(renderer);
    renderer.setRenderTarget(this.paintTarget);
    this._paintQuad.render(renderer);

    this._copy.uniforms.tPaint.value = this.paintTarget.texture;
    renderer.setRenderTarget(this.renderToScreen || !writeBuffer ? null : writeBuffer);
    this._copyQuad.render(renderer);

    if (this.overlayScene.children.length) {
      renderer.autoClear = false;
      renderer.render(this.overlayScene, this.camera);
    }

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.sceneTarget?.depthTexture?.dispose(); this.sceneTarget?.dispose(); this.paintTarget?.dispose();
    this._paint?.dispose(); this._copy.dispose();
    this._paintQuad.dispose(); this._copyQuad.dispose();
  }
}
