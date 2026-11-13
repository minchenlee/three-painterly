// Hand-written types for painterly-pass. Keep in step with src/PainterlyPass.js (PainterlyPass.defaults).
import { Camera, IUniform, Object3D, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * What one mark looks like and how it is coloured. Use impressionist() or pointillist().
 * Writing your own brush is lower-level and may change: see src/brushes/impressionist.js for the five GLSL functions.
 */
export interface PainterlyBrush {
  name?: string;
  /** GLSL that defines brushPalette, brushGround, brushMark, brushShade and brushFinish. */
  glsl: string;
  /** Extra uniforms for glsl. The pass shares these objects, so changing a value takes effect on the next frame. */
  uniforms?: Record<string, IUniform>;
  /** How far a mark can reach from its centre, in cells. */
  reach(pass: PainterlyPass): number;
  /** Cells per side to test around each pixel. Default: 2 x reach + 1. The pass keeps it between 2 and 7. */
  search?(pass: PainterlyPass, reach: number): number;
  /**
   * The same mark for BakedDebris pieces in the air: GLSL for boom.createStrokes(). Without it, strokes are oil strokes.
   * The interface is oilStroke in baked-debris/shaders.
   */
  flying?: { vertex: string; fragment: string };
}

/** Oil strokes with the palette habits of late-1800s impressionism. The default brush. */
export function impressionist(): PainterlyBrush;

export interface PointillistOptions {
  /** 0 = the scene's own colour, 1 = pure pigment hues mixed only with white. Default 0.8. */
  purity?: number;
  /** How far dabs stray to neighbouring hues, in turns of the colour wheel. Default 0.07. */
  hueSpread?: number;
  /** Number of pigment hues on the colour wheel. Default 12. */
  pigments?: number;
}

/** Round dabs of divided colour, on surfaces and for BakedDebris strokes. Its options are live in brush.uniforms (uPurity, uHueSpread, uPigments). */
export function pointillist(options?: PointillistOptions): PainterlyBrush & {
  uniforms: { uPurity: IUniform<number>; uHueSpread: IUniform<number>; uPigments: IUniform<number> };
  flying: { vertex: string; fragment: string };
};

/** A moving object whose marks ride with it. Marks inside the box are laid in the object's own space. */
export interface PainterlyAnchor {
  /** Its matrixWorld is read on every frame. */
  object: Object3D;
  /** The box that holds the object, in the object's own space. */
  min: [number, number, number];
  max: [number, number, number];
}

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
  /** The kind of mark and its colours. Default null = impressionist(). */
  brush?: PainterlyBrush | null;
  /** Moving objects whose marks ride with them; at most 4. Default []. */
  anchors?: PainterlyAnchor[];
}

/**
 * Renders a scene and repaints it with brush strokes anchored to surfaces (impressionist oil by default).
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
  /** The current brush. Set it at any time (one shader compile); null gives the default. */
  get brush(): PainterlyBrush;
  set brush(value: PainterlyBrush | null | undefined);
  anchors: PainterlyAnchor[];

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
