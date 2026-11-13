# AGENTS.md

Guide for coding agents that work on this repository. To use the library in another project, read [llms.txt](llms.txt) instead.

## Layout

- `packages/painterly-pass/src/`: `PainterlyPass.js` (the Pass), `shaders.js` (GLSL shared by every brush), `brushes/*.js` (one brush per file: mark shape, palette, canvas), `index.js` (public exports).
- `packages/baked-debris/src/`: `BakedDebris.js` (class, GPU side), `bake.js` (CPU collision bake), `colliders.js` (`voxelCollider`, `boxCollider`, `anyCollider`), `shaders.js` (GLSL and three.js chunk patches; `oilStroke` is the built-in look of flying strokes), `index.js`.
- `packages/*/examples/`: small examples. `examples/`: large demos that use both packages.
- `examples/lib/`: voxel tools shared by the demos. `voxels.js` (hash, palette, grid, mesher with baked ambient occlusion), `town.js` (wooden houses, trees, fences, cars). Not part of any package and not public API.
- `packages/*/test/` and `examples/lib/test/`: `*.test.js` run in Node; `api.html` runs in a browser.

## Rules

- Plain ES modules. No build step, no TypeScript sources, no bundler. Examples load three.js r160 through an importmap.
- Public API = what `src/index.js` exports, plus `baked-debris/shaders` (lower-level, may change). Every public change goes in the package README and in `CHANGELOG.md`.
- Keep `peerDependencies.three` at `>=0.160.0` and keep "Tested with three.js r160 and r…" in each package README and in llms.txt correct.
- BakedDebris output must stay deterministic: same options and seed, same bake. Do not use `Math.random` in the bake; use the seeded generator.
- BakedDebris patches three.js shader chunks by string replacement. If you touch the patch, run `chunks.test.js`; it fails when a chunk it patches is missing.
- PainterlyPass reads the depth buffer as standard depth. Do not remove the renderer checks (WebGPU, logarithmic depth, reverse depth).
- Keep `solid()` hot paths cheap: no allocation per call.
- The default brush (`impressionist()`) must keep its output. After a change to `shaders.js` or `PainterlyPass.js`, compare a screenshot of `basic.html` before and after: no pixel may differ.
- A new brush goes in `src/brushes/`, defines the five functions documented in `brushes/impressionist.js`, and gets a row in the package README. Give it a `flying` part too (the functions of `oilStroke` in `baked-debris/src/shaders.js`), so flying pieces match the painting.
- The oil stroke of BakedDebris must keep its output too. `strokeFragment` is public: effects pair it with their own vertex shader, so it must not need a new varying.
- A voxel demo builds on `examples/lib/`: do not copy the grid or the mesher into a demo. After a change there, compare screenshots of `voxel-paris` and `balloon-house` before and after: no pixel may differ, unless the change is meant to be seen.
- `examples/lib/` imports nothing from the packages, and the packages import nothing from it.
- The two packages do not import each other. A brush is a plain object, and BakedDebris reads only `brush.flying` and `brush.uniforms`.

## Test

```sh
npm install        # three as a dev dependency
npm test           # node --test packages/*/test/*.test.js examples/lib/test/*.test.js
npm run typecheck  # tsc on the hand-written .d.ts files
npm i --no-save three@0.187.0 @types/three@0.187.0 && npm test && npm run typecheck   # another three.js version; npm install restores 0.160.0
python3 -m http.server   # then open packages/baked-debris/test/api.html and the examples
```

GPU checks: run headless Chrome with a real GPU (for example Playwright with `--use-angle=metal --enable-gpu` on macOS). Check that the console has no shader errors. For performance changes, give frame times before and after on the same example.

## Docs style

Short sentences, one idea per sentence, active voice. Do not call anything "the first" or "a new technique". Credit prior art in the README.
