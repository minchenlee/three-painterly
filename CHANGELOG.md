# Changelog

Both packages share one version number until the first public release.

## Unreleased

### painterly-pass
- New `brush` option and property. A brush decides the shape and colour of one mark; the pass still decides where marks go. `null` (the default) is the oil brush of 0.1.0, with the same output.
- New exports `impressionist()` and `pointillist({ purity, hueSpread, pigments })`.
- `pointillist()` paints round dabs of divided colour: one pigment per dab, mixed only with white. It tests 3×3 cells per pixel at the default dab size.
- A brush is a plain object (`{ glsl, uniforms, reach, search }`). Writing your own is lower-level and may change.
- New `anchors` option: `[{ object, min, max }]`. Strokes inside the box of an anchor are laid in the object's own space, so a moving object carries its strokes. Up to 4. Without anchors the shader and its output are unchanged.
- New `minStrokeWorld` option: strokes are at least this big in world units, so they grow on screen when the camera moves in close. 0 (the default) keeps the output unchanged.
- A brush can carry a `flying` part: the same mark for BakedDebris strokes. `pointillist()` has one: round dabs, one pigment each; a fast piece draws a trail of up to three (`trail` option).
- Node tests for the brush plumbing (`packages/painterly-pass/test`).

### baked-debris
- Strokes take their look from the brush. `createStrokes({ painter })` follows `painter.brush`, also when it changes later. New `brush` option to set it yourself. With the default brush, or none, strokes are the oil strokes of 0.1.0, with the same output.
- `baked-debris/shaders`: new `oilStroke` (the built-in look) and `strokeShaders(look)`. `strokeVertex` and `strokeFragment` are unchanged in output.
- The stroke vertex shader writes `flat varying float vPiece`: the piece's seed, exact on every pixel.
- Node tests for the stroke look (`test/strokes.test.js`); `test/api.html` compiles a look and switches looks.

### examples
- `examples/grande-jatte`: Seurat's *A Sunday on La Grande Jatte* paints itself in pointillist dabs, then lets you walk in. Dabs are BakedDebris pieces on a clock that runs backwards.
- `examples/lib`: small sparse models (`createModel`, `modelPieces`) in `voxels.js`; a new `shapes.js` keeps the same drawing calls as round shapes; a new `people.js` builds figures, pets and boats of the 1880s on either.
- New `examples/lib`: the voxel grid, palette and mesher (`voxels.js`) and a small-town kit (`town.js`), shared by `voxel-paris` and `balloon-house`. Both demos draw the same pixels as before. `npm test` runs its tests.
- `examples/voxel-paris`: a Brush control in the Paint tab switches between oil strokes and pointillist dabs. The fire follows.
- `examples/lightspeed-ram`: a cruiser rams a flagship at lightspeed. Both modules, no gravity, a displace hook splits the ship.
- `examples/balloon-house`: balloons burst through a roof and carry a house off over a voxel street, in pointillist dabs. Roof and turf debris collide with the voxels. Balloons are pieces with their own velocity and launch time; bullet time is the drag; a displace hook gathers them into a bunch that follows the house. The house is an anchor.

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
