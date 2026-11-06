# Changelog

Both packages share one version number until the first public release.

## Unreleased

### examples
- `examples/paint-body`: a person painted as brush strokes that scatter and sway with their motion. MediaPipe pose tracking (camera) or a built-in demo dancer; the camera image stays as the background, with an option to erase the real person.
- `examples/lightspeed-ram`: a cruiser rams a flagship at lightspeed. Both modules, no gravity, a displace hook splits the ship.

## 0.1.0 (2026-11-05)

### painterly-pass
- Sky is detected only where depth is exactly 1.0, so distant objects are no longer painted as sky.
- Array defaults (`shadowTint`) are copied per instance. Unknown options log a warning and are ignored. Options can no longer overwrite `Pass` fields.
- Clear errors for reversed depth, logarithmic depth and `WebGPURenderer`, which are not supported.
- Long strokes are no longer cut off: the search grows with `strokeLength` above 1. The default (`strokeLength` ≤ 1) keeps the 4×4 search and its cost.
- Normals are rebuilt from the neighbour on the same surface, so silhouettes and screen edges get correct stroke directions.

### baked-debris
- New `meshToPieces(mesh, { size, fill, color })`: cube pieces for the inside (`'volume'`) or a one-cell shell (`'surface'`) of a closed mesh, in world space, with material or vertex colours. Deterministic; one triangle pass per grid column.
- `baked-debris/shaders` has types (`src/shaders.d.ts`, `types` condition in `exports`).
- `rebake()` keeps `gravity`, `sizeScale` and `timeWarp` in step on the GPU.
- A piece that uses all 6 segments rests at its last hit instead of falling through the ground. Rest and free fall are marked explicitly, so pieces with zero start velocity fall correctly.
- Options are validated before the bake; invalid values throw with the option name.
- Point-light shadows (`customDistanceMaterial`).
- `createStrokes()` replaces existing strokes; new `lookAhead` option.
- New `createStrokes` option `keep` (default 1): draw only a fixed share of flying pieces, to save overdraw with large strokes.
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
- `npm test` (Node) and `npm run typecheck` at the repository root. GitHub Actions runs both with three.js 0.160.0 and the latest release.
- Docs: P-key toggle for PainterlyPass (with ACES on the plain path and BakedDebris strokes), `voxelCollider` origin, `killY`, "flying" includes landed pieces, overall mood (dusk) needs lights and sky. Tested with three.js r160 and r187.

### Breaking changes against the pre-release code
- `boom.mesh.material` is a clone of the material you pass.
- Instance order differs from `boom.records`.
- Invalid options throw; unknown options warn.
- Bakes with collisions give different paths than before (the wall fix above). Bakes without collisions are unchanged.
