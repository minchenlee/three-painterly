// Hand-written types for baked-debris. Keep in step with src/BakedDebris.js (BakedDebris.defaults) and src/colliders.js.
import { ColorRepresentation, IUniform, Material, Mesh, ShaderMaterial, InstancedBufferGeometry } from 'three';

export type Vec3 = [number, number, number];
/** Collision geometry in world units: true inside anything the debris should hit. Called millions of times per bake. */
export type Collider = (x: number, y: number, z: number) => boolean;

/** One piece: a cube that stays in place or is launched. */
export interface DebrisPiece {
  /** Centre, world units. */
  position: Vec3;
  /** Cube size. Default: options.pieceSize. */
  size?: number;
  color?: ColorRepresentation;
  /** Own launch velocity; with launchTime, the piece does not take its launch from a burst. */
  velocity?: Vec3;
  /** Own launch time, seconds. */
  launchTime?: number;
  /** Burst it belongs to (for setBurstOffsets); -1 = none. Default: the nearest burst that reaches it. */
  burst?: number;
  /** Spin, rad/s. */
  spin?: number;
  /** Spin axis. */
  axis?: Vec3;
  /** Seconds after launch it takes to shrink away; 0 = lives forever. */
  lifetime?: number;
}

export interface DebrisBurst {
  position: Vec3;
  /** Pieces closer than this are launched; 0 = only pieces with their own velocity/launchTime. */
  radius: number;
  /** Seconds. Default 0. */
  time?: number;
  /** Added to the outward direction. */
  direction?: Vec3;
  /** Launch speed multiplier. Default 1. */
  strength?: number;
}

/**
 * GPU offset per piece (README "Displace hook"). glsl defines
 *   vec3 debrisDisplace(vec3 p, DebrisInfo d)
 * and may declare its own uniforms; the uniforms are added to boom.uniforms (a clashing name throws).
 * The offset moves the whole piece in the cubes, both shadow materials and the strokes. The bake does not know it.
 */
export interface DebrisDisplace {
  glsl: string;
  uniforms?: Record<string, IUniform>;
}

/**
 * GLSL struct passed to debrisDisplace (documentation only; it exists in the shader, not in JS):
 *   time  global time of this sample (strokes sample twice, so use it instead of uTime)
 *   local physics time since launch (after the time warp); <= 0 = not launched yet
 *   kind  0 = piece, 1 = fragment of a secondary blast
 *   burst index of the burst that launched it, -1 = none
 *   index the piece's row in the segment texture: stable, usable as a random seed
 *   rest  local time from which the piece rests
 */
export type DebrisInfo = { time: number; local: number; kind: number; burst: number; index: number; rest: number };

export interface TimeWarp {
  /** Seconds at full speed. Default 0.3. */
  burst?: number;
  /** Clock speed afterwards. Default 1/25. */
  hover?: number;
}

export interface BakedDebrisOptions {
  pieces: DebrisPiece[];
  bursts: DebrisBurst[];
  /** Default cube size, world units. Default 0.25. */
  pieceSize?: number;
  /** Default 9.81. */
  gravity?: number;
  /** Launch speed range near the burst centre, world units/s. Default [7, 18]. */
  speed?: [number, number];
  /** 0 = every piece leaves at its burst time; 1 = pieces leave over about 0.85 s. Default 1. */
  stagger?: number;
  /** Max spin, rad/s. Default 9. */
  spin?: number;
  /** Share of speed kept across a hit. Default 0.35. */
  restitution?: number;
  /** Horizontal speed kept at each floor hit. Default 0.6. */
  friction?: number;
  /** A floor hit slower than this ends the motion. Default 0.6. */
  stopSpeed?: number;
  /** y of a ground plane, or null. Default 0. */
  ground?: number | null;
  /** Extra collision geometry. Default null. */
  solid?: Collider | null;
  /** Voxel size: rest exactly on voxel tops (0 = rest where the hit happened). Default 0. */
  snap?: number;
  /** Pieces below this stop being simulated. Default -50. */
  killY?: number;
  /** Seconds of motion simulated per piece. Default 20. */
  duration?: number;
  /** Simulation step, seconds. Default 1/90. */
  step?: number;
  /** Share of flying pieces that burst again in mid-air, 0..1. Default 0. */
  secondary?: number;
  /** Default [0.12, 0.45]. */
  secondaryDelay?: [number, number];
  /** Default [3.5, 8]. */
  secondarySpeed?: [number, number];
  /** Default 4242. */
  seed?: number;
  /** null = real time, or bullet time. Default null. */
  timeWarp?: TimeWarp | null;
  /** Resize pieces once they fly. Default 1. */
  sizeScale?: number;
  /** Default true. */
  castShadow?: boolean;
  /** Default true. */
  receiveShadow?: boolean;
  /** GPU offset per piece. Default null. */
  displace?: DebrisDisplace | null;
  /** Material for the cubes. A clone is patched; the passed material is not changed. Default: a new MeshStandardMaterial. */
  material?: Material | null;
}

export interface DebrisStats {
  /** Records: pieces plus secondary fragments. */
  pieces: number;
  flying: number;
  secondary: number;
}

export interface CreateStrokesOptions {
  /** A PainterlyPass: its scene depth hides strokes behind buildings. */
  painter?: { sceneTarget: { depthTexture?: unknown } | null } | null;
  /** Default 1.25. */
  strokeScale?: number;
  /** CSS pixels. Default 34. */
  maxWidth?: number;
  /** Default 0.16. */
  jitter?: number;
  /** Seconds to the second sample that points the stroke; > 0 when the clock runs backwards. Default -0.03. */
  lookAhead?: number;
  /** Share of flying pieces drawn as strokes, 0..1; each piece's choice is fixed. Lower it for large strokes to save overdraw. Live: material.uniforms.uKeep. Default 1. */
  keep?: number;
}

/**
 * Explosion debris whose collisions are simulated once ("baked") and then played back on the GPU.
 * Any moment can be shown with setTime(t), forward or backward. World space only: do not move or scale boom.mesh.
 */
export class BakedDebris {
  static defaults: Readonly<Required<Omit<BakedDebrisOptions, 'pieces' | 'bursts'>>>;
  constructor(options: BakedDebrisOptions);

  /** The cubes. Its material is a patched clone of options.material. */
  mesh: Mesh<InstancedBufferGeometry, Material>;
  /** The stroke mesh while strokes are on, else null. */
  strokes: Mesh<InstancedBufferGeometry, ShaderMaterial> | null;
  /** Shared uniforms (uTime, uGravity, …) plus the displace hook's uniforms. */
  uniforms: Record<string, IUniform>;
  /** The options in use. */
  o: Required<Omit<BakedDebrisOptions, 'material' | 'displace'>> & Pick<BakedDebrisOptions, 'material' | 'displace'>;
  /** Baked records (pieces then fragments), in bake order. Internal fields may change between versions. */
  records: object[];
  stats: DebrisStats;

  /** Re-run the simulation; any option can be passed. Throws on invalid options, naming the field. */
  rebake(changes?: Partial<BakedDebrisOptions>): DebrisStats;
  /** Show the explosion at t seconds. */
  setTime(t: number): void;
  setTimeWarp(w: TimeWarp | null): void;
  setSizeScale(s: number): void;
  /** Seconds added to burst i and its pieces, without a new bake. Only the first 32 bursts. */
  setBurstOffsets(offsets: number[]): void;
  /** Replace or remove (null) the displace hook. Recompiles; changing its uniform values does not. */
  setDisplace(h: DebrisDisplace | null): void;
  /** Flying pieces as brush strokes; add the mesh to painter.overlayScene. Replaces existing strokes. */
  createStrokes(options?: CreateStrokesOptions): Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Stop drawing strokes and show flying cubes again. */
  removeStrokes(): void;
  dispose(): void;
}

/** Voxel grid: get(i, j, k) is truthy for filled cells of size cell, starting at origin. Use a typed-array lookup. */
export function voxelCollider(get: (i: number, j: number, k: number) => unknown, cell?: number, origin?: Vec3): Collider;
/** Axis-aligned boxes. */
export function boxCollider(boxes: { min: Vec3; max: Vec3 }[]): Collider;
/** True where any of the colliders is. */
export function anyCollider(...colliders: Collider[]): Collider;

/** The brush-stroke fragment shader, for effects that should match the debris strokes. */
export const strokeFragment: string;
