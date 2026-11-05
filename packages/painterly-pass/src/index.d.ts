// Hand-written types for painterly-pass. Keep in step with src/PainterlyPass.js (PainterlyPass.defaults).
import { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

/** Options of new PainterlyPass(scene, camera, options). Each is also a field you can change at any time. */
export interface PainterlyPassOptions {
  /** Stroke cell size in CSS pixels. Default 7. */
  strokeSize?: number;
  /** 0 = original image, 1 = fully painted. Default 1. */
  amount?: number;
  /** The scene and the painting are made at this fraction of the output size. Default 0.7. */
  resolutionScale?: number;
  /** Apply an ACES fit to the HDR scene before painting. Default true. */
  toneMapping?: boolean;
  /** Default 1. */
  exposure?: number;
  /** Default 1.15; 1.3 suits pale scenes such as stone streets. */
  saturation?: number;
  /** RGB multiplier for dark tones (cool, violet shadows). Default [0.78, 0.80, 1.25]. */
  shadowTint?: [number, number, number];
  /** Default 0.55. */
  shadowAmount?: number;
  /** How much the highlights lean warm. Default 0.6. */
  warmth?: number;
  /** Unmixed colour per stroke. Default 0.07. */
  colorJitter?: number;
  /** Default 1. */
  strokeLength?: number;
  /** Default 1. */
  strokeWidth?: number;
  /** Default 1.1. */
  contrast?: number;
  /** Canvas weave strength. Default 0.035. */
  canvas?: number;
  /** Paint the background too. Default true. */
  sky?: boolean;
}

/**
 * Renders a scene and repaints it with impressionist brush strokes anchored to surfaces.
 * Use it in place of a RenderPass in an EffectComposer, or on its own with setSize + render.
 * Needs a WebGLRenderer without logarithmic or reversed depth, and a PerspectiveCamera.
 */
export class PainterlyPass extends Pass implements Required<PainterlyPassOptions> {
  static defaults: Readonly<Required<PainterlyPassOptions>>;
  constructor(scene: Scene, camera: Camera, options?: PainterlyPassOptions);

  scene: Scene;
  camera: Camera;
  strokeSize: number;
  amount: number;
  resolutionScale: number;
  toneMapping: boolean;
  exposure: number;
  saturation: number;
  shadowTint: [number, number, number];
  shadowAmount: number;
  warmth: number;
  colorJitter: number;
  strokeLength: number;
  strokeWidth: number;
  contrast: number;
  canvas: number;
  sky: boolean;

  /** HDR scene colour + depth texture at the paint resolution; null until the first render. */
  sceneTarget: WebGLRenderTarget | null;
  paintTarget: WebGLRenderTarget | null;
  /** Drawn on top of the painting with the same camera, e.g. BakedDebris brush strokes. */
  overlayScene: Scene;

  /** Output size in device pixels (EffectComposer calls this for you). */
  setSize(width: number, height: number): void;
  /** Draws to writeBuffer, or to the screen when renderToScreen is set or no buffer is given. */
  render(renderer: WebGLRenderer, writeBuffer?: WebGLRenderTarget | null, readBuffer?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean): void;
  dispose(): void;
}
