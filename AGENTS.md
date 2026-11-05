# AGENTS.md

Guide for coding agents that work on this repository. To use the library in another project, read [llms.txt](llms.txt) instead.

## Layout

- `packages/painterly-pass/src/`: `PainterlyPass.js` (the Pass), `shaders.js` (GLSL strings), `index.js` (public exports).
- `packages/baked-debris/src/`: `BakedDebris.js` (class, GPU side), `bake.js` (CPU collision bake), `colliders.js` (`voxelCollider`, `boxCollider`, `anyCollider`), `shaders.js` (GLSL and three.js chunk patches), `index.js`.
- `packages/*/examples/`: small examples. `examples/`: large demos that use both packages.
- `packages/*/test/`: `*.test.js` run in Node; `api.html` runs in a browser.

## Rules

- Plain ES modules. No build step, no TypeScript sources, no bundler. Examples load three.js r160 through an importmap.
- Public API = what `src/index.js` exports, plus `baked-debris/shaders` (lower-level, may change). Every public change goes in the package README and in `CHANGELOG.md`.
- Keep `peerDependencies.three` at `>=0.160.0` and keep "Last tested with three.js r…" in each package README correct.
- BakedDebris output must stay deterministic: same options and seed, same bake. Do not use `Math.random` in the bake; use the seeded generator.
- BakedDebris patches three.js shader chunks by string replacement. If you touch the patch, run `chunks.test.js`; it fails when a chunk it patches is missing.
- PainterlyPass reads the depth buffer as standard depth. Do not remove the renderer checks (WebGPU, logarithmic depth, reverse depth).
- Keep `solid()` hot paths cheap: no allocation per call.

## Test

```sh
npm install        # three as a dev dependency
npm test           # node --test packages/*/test/*.test.js
python3 -m http.server   # then open packages/baked-debris/test/api.html and the examples
```

GPU checks: run headless Chrome with a real GPU (for example Playwright with `--use-angle=metal --enable-gpu` on macOS). Check that the console has no shader errors. For performance changes, give frame times before and after on the same example.

## Docs style

Short sentences, one idea per sentence, active voice. Do not call anything "the first" or "a new technique". Credit prior art in the README.
