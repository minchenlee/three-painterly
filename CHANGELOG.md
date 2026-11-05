# Changelog

Both packages share one version number until the first public release.

## Unreleased (0.1.0)

### painterly-pass
- Sky is detected only where depth is exactly 1.0, so distant objects are no longer painted as sky.
- Array defaults (`shadowTint`) are copied per instance. Unknown options log a warning and are ignored. Options can no longer overwrite `Pass` fields.
- Clear errors for reversed depth, logarithmic depth and `WebGPURenderer`, which are not supported.
- Long strokes are no longer cut off: the search grows with `strokeLength` above 1. The default (`strokeLength` ≤ 1) keeps the 4×4 search and its cost.
- Normals are rebuilt from the neighbour on the same surface, so silhouettes and screen edges get correct stroke directions.

### baked-debris
- `rebake()` keeps `gravity`, `sizeScale` and `timeWarp` in step on the GPU.
- A piece that uses all 6 segments rests at its last hit instead of falling through the ground. Rest and free fall are marked explicitly, so pieces with zero start velocity fall correctly.
- Options are validated before the bake; invalid values throw with the option name.
- Point-light shadows (`customDistanceMaterial`).
- `createStrokes()` replaces existing strokes; new `lookAhead` option.
- The passed material is cloned before it is patched; only materials the library creates are disposed.
- Shader patches throw when a three.js chunk is missing.
- `strokeFragment` is exported from `baked-debris/shaders`.
- Resting and hidden pieces skip the vertex work (instance order no longer matches `records`).
- Segment texture size is checked against `maxTextureSize`; memory per piece is documented.
- Faster collider calls; `castShadow` / `receiveShadow` options.
- New `displace` option and `setDisplace()`: a GLSL hook that offsets pieces on top of the bake, applied to cubes, shadows and strokes.
- Fast pieces no longer pass into walls that are still standing: collisions are checked from launch (centre point for the first 0.03 s), and a hit restarts the segment from the start of that step. A property test checks that no piece is drawn inside `solid` at any time.

### Both packages
- Hand-written TypeScript types (`src/index.d.ts`, `types` condition in `exports`).
- `npm test` (Node) and `npm run typecheck` at the repository root.

### Breaking changes against the pre-release code
- `boom.mesh.material` is a clone of the material you pass.
- Instance order differs from `boom.records`.
- Invalid options throw; unknown options warn.
- Bakes with collisions give different paths than before (the wall fix above). Bakes without collisions are unchanged.
