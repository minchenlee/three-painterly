// Hand-written types for baked-debris/shaders. Keep in step with src/shaders.js.
// Lower-level than the main entry; it may change between versions.
import { IUniform, Material } from 'three';

/** GLSL: the piece state (position, spin angle, size, time since launch) as a function of uTime. Contains the displace hook mark. */
export const debrisState: string;
/** Brush-stroke vertex shader with the oil look (includes debrisState). */
export const strokeVertex: string;
/** Brush-stroke fragment shader with the oil look, for effects that should match the debris strokes. */
export const strokeFragment: string;
/**
 * The built-in look of a stroke: an oil stroke with a full head and a thin tail.
 * vertex defines float strokeStretch(float spd); fragment defines vec3 strokePalette(vec3 c, float r),
 * bool strokeMark(vec2 q, float seed, out float w) and vec3 strokeShade(vec3 col, vec2 q, float seed, float w).
 */
export const oilStroke: { vertex: string; fragment: string };
/** The complete stroke shaders for one look (default oilStroke). The vertex shader still holds the displace hook mark: pass it to withDisplace. */
export function strokeShaders(look?: { vertex: string; fragment: string }): { vertex: string; fragment: string };

/** Put the displace hook (GLSL that defines debrisDisplace, or null for none) into a shader that contains debrisState. */
export function withDisplace(src: string, glsl: string | null): string;
/** String.replace that throws when `find` is missing; `where` names the caller in the error. */
export function mustReplace(src: string, find: string, repl: string, where: string): string;
/**
 * Patch a cube material (MeshStandardMaterial etc.) so position, spin, normal and colour come from the bake.
 * Reads material.userData.debrisUniforms and material.userData.debrisDisplace. The hooks of `source`
 * (default: the material as it was) run after the patch.
 */
export function patchCube(material: Material, hideFlyingU: IUniform<number>, source?: Pick<Material, 'onBeforeCompile' | 'customProgramCacheKey'> | null): void;
/** Patch a shadow material (MeshDepthMaterial or MeshDistanceMaterial) the same way. `key` is its program cache key. */
export function patchDepth(material: Material, hideFlyingU: IUniform<number>, key?: string): void;
