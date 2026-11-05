# three-painterly

Two small three.js modules, extracted from a voxel street-corner piece. Plain ES modules, no build step. Both need three.js r160 or later (WebGL 2).

<!-- Screenshot / GIF: to be added -->

## PainterlyPass

A post-processing pass that repaints any three.js scene in impressionist brush strokes. It replaces `RenderPass`: it renders the scene itself, rebuilds world positions from depth, and lays strokes on each surface's own plane, so strokes stay on the building, tree or ground when the camera moves. It does its own tone mapping and colour-space output, so do not add an `OutputPass` after it.

```js
composer.addPass(new PainterlyPass(scene, camera, { strokeSize: 7 }));
```

Prior art: Barbara Meier, *Painterly Rendering for Animation* (SIGGRAPH 1996), placed strokes on 3D surfaces; Sekuta82/oil-on-threejs-template does this per mesh in three.js. PainterlyPass does it as a post-process from the depth buffer, so it works on any scene without touching its meshes.

→ [packages/painterly-pass](packages/painterly-pass/README.md) · example: `packages/painterly-pass/examples/basic.html`

## BakedDebris

Explosion debris you can scrub and rewind. Collisions are baked once in the browser against your own `solid(x, y, z)` query and the ground; each piece's path is stored as a few ballistic segments in a float texture, and the GPU evaluates any moment directly. `setTime(t)` can jump anywhere, backwards included, and the result is always the same. Extras: bullet-time (`timeWarp`), secondary blasts, and `createStrokes({ painter })` to draw flying pieces as brush strokes on top of a PainterlyPass.

```js
const boom = new BakedDebris({ pieces, bursts, solid, ground: 0 });
scene.add(boom.mesh);
boom.setTime(seconds);
```

→ [packages/baked-debris](packages/baked-debris/README.md) · example: `packages/baked-debris/examples/explode.html`

## Run the examples

Serve the repository root over HTTP and open an example:

```sh
python3 -m http.server     # or: npx serve .
# http://localhost:8000/packages/painterly-pass/examples/basic.html
# http://localhost:8000/packages/baked-debris/examples/explode.html
# http://localhost:8000/examples/voxel-paris/
```

`examples/voxel-paris` is a larger demo that uses both modules: a Paris street corner of about 5 million voxels, where 12 bursts blow out the ground floor and chosen upper floors. Drag the time slider to scrub or rewind, switch between realistic and painterly rendering, and change the time of day. It loads three.js from a CDN and builds the city in the browser (a few seconds on first load).

## License

MIT. See [LICENSE](LICENSE).
