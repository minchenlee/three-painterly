import {
  DepthTexture, HalfFloatType, Scene, LinearFilter, Matrix4, NoBlending, ShaderMaterial,
  UnsignedIntType, Vector2, Vector3, WebGLRenderTarget,
} from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { quadVertex, paintFragment, copyFragment } from './shaders.js';

/**
 * Renders a scene and repaints it with impressionist brush strokes.
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
  };

  constructor(scene, camera, options = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
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

    this._paint = new ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tDepth: { value: null }, uRes: { value: new Vector2() }, uS: { value: 7 },
        uAmount: { value: 1 }, uExposure: { value: 1 }, uToneMap: { value: 1 }, uSaturation: { value: 1.3 },
        uShadowTint: { value: new Vector3() }, uShadowAmount: { value: 0.55 }, uWarmth: { value: 0.6 },
        uJitter: { value: 0.07 }, uCanvas: { value: 0.035 }, uLength: { value: 1 }, uWidth: { value: 1 },
        uContrast: { value: 1.1 }, uSky: { value: true },
        uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() }, uViewProj: { value: new Matrix4() },
        uCamPos: { value: new Vector3() }, uPixAng: { value: 0.001 },
      },
      vertexShader: quadVertex, fragmentShader: paintFragment,
      depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
    });
    this._copy = new ShaderMaterial({
      uniforms: { tPaint: { value: null } },
      vertexShader: quadVertex, fragmentShader: copyFragment,
      depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
    });
    this._paintQuad = new FullScreenQuad(this._paint);
    this._copyQuad = new FullScreenQuad(this._copy);
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
    u.uContrast.value = this.contrast;
    u.uSky.value = this.sky;
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
    this._paint.dispose(); this._copy.dispose();
    this._paintQuad.dispose(); this._copyQuad.dispose();
  }
}
