# PainterlyPass

A three.js post-processing pass that repaints any scene in impressionist brush strokes.

The strokes are anchored to surfaces, not to the screen. The pass rebuilds each pixel's 3D position from the depth buffer and lays strokes on each surface's own plane, so when the camera moves the strokes move with the building, the tree or the ground. The sky is painted with strokes fixed to view directions, so it turns with the camera.

The colour treatment follows habits of Claude Monet's late-1800s paintings (public domain): livelier colour, cool violet shadows that keep their value, warm highlights, and a little unmixed colour in every stroke.

Status: 0.1.0, experimental.

## Use

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { PainterlyPass } from 'painterly-pass';

const composer = new EffectComposer(renderer);
composer.addPass(new PainterlyPass(scene, camera, { strokeSize: 7 }));   // replaces RenderPass

function frame() { composer.render(); }
```

PainterlyPass renders the scene itself, so put it first and do not add a RenderPass before it. It tone-maps the HDR scene and writes the output colour space itself, so do not add an OutputPass after it when it is the last pass.

Without a composer:

```js
const painter = new PainterlyPass(scene, camera);
painter.setSize(innerWidth * devicePixelRatio, innerHeight * devicePixelRatio);
painter.render(renderer);   // draws to the screen
```

Requires three.js r160 or later and a `PerspectiveCamera`. Last tested with three.js r160.

## Options

All options are also writable properties (`painter.strokeSize = 10`). Unknown options are ignored with a console warning, and each instance gets its own copy of array defaults such as `shadowTint`.

| Option | Default | Meaning |
|---|---|---|
| `strokeSize` | `7` | Stroke cell size in CSS pixels. Strokes keep about this size on screen at every distance. |
| `amount` | `1` | 0 = original image, 1 = fully painted. |
| `resolutionScale` | `0.7` | The scene and the painting are made at this fraction of the output size, then scaled up. Lower is faster. |
| `toneMapping` | `true` | Apply an ACES fit to the HDR scene before painting. Set `false` if the scene is already display-referred. |
| `exposure` | `1` | Exposure before tone mapping. |
| `saturation` | `1.15` | Colour saturation. 1.3 suits pale scenes such as stone streets. |
| `shadowTint` | `[0.78, 0.80, 1.25]` | Multiplier applied to dark tones. |
| `shadowAmount` | `0.55` | How strongly dark tones take the tint. |
| `warmth` | `0.6` | How much highlights lean warm. |
| `colorJitter` | `0.07` | Unmixed colour per stroke. |
| `strokeLength`, `strokeWidth` | `1`, `1` | Stroke proportions. Up to `strokeLength` 1 each pixel tests 4×4 cells (fastest; the tips of the longest strokes can be clipped). Above 1 it tests enough cells for the longest stroke: 5×5 or 6×6, up to 7×7 at 1.53 (about 3× the paint cost of 4×4). Longer strokes are capped to fit. |
| `contrast` | `1.1` | Contrast after painting. |
| `canvas` | `0.035` | Canvas weave strength (fixed to the screen). |
| `sky` | `true` | Paint the background. |

`painter.sceneTarget` holds the scene colour and depth (`sceneTarget.depthTexture`) at paint resolution, for effects that draw on top of the painting.

`painter.overlayScene` is drawn on top of the finished painting with the same camera. BakedDebris uses it for flying brush strokes.

## How it works

1. Render the scene into a half-float target with a depth texture, at `resolutionScale`.
2. For each pixel, rebuild the world position from depth, and the surface direction from the neighbouring pixels.
3. Pick the dominant axis of the surface and use the surface's own plane coordinates as the canvas. Lay one stroke per grid cell there: an ellipse with a random offset and angle (upright on walls, lying on floors), a ragged bristle edge, a lighter paint ridge and bristle streaks. The topmost stroke of the cells around the pixel wins (4x4, or up to 7x7 for strokeLength above 1).
4. Each stroke takes its colour from the scene at its own centre, projected back to the screen, then passes through the palette.
5. Choose two power-of-two cell sizes from the distance and cross-fade, so strokes stay about `strokeSize` pixels on screen.
6. Add the canvas weave, scale up to the output and convert to the output colour space.

## Prior art

Anchoring strokes to surfaces to avoid the "shower door" effect goes back to Barbara Meier, *Painterly Rendering for Animation* (SIGGRAPH 1996), which placed particles on 3D surfaces. Sekuta82/oil-on-threejs-template does this per mesh in three.js. This pass does it as a post-process from the depth buffer, so it works on any scene without touching its meshes.

## Limitations

- Surfaces are mapped by their dominant axis. Strongly slanted or curved surfaces get strokes from the nearest axis plane, which can show a seam where the dominant axis changes.
- Perspective cameras only. `WebGLRenderer` only: `WebGPURenderer` is not supported. A renderer created with `logarithmicDepthBuffer` or `reverseDepthBuffer` is not supported; `render()` throws an error that says so.
- Each pixel samples the scene many times. On weak GPUs lower `resolutionScale` or raise `strokeSize`.
- Transparent objects are painted with whatever is behind them in the depth buffer.

## Example

`examples/basic.html` — a small original scene (meadow, pond, houses, trees). Serve the repository root over HTTP (`npx serve .` or `python3 -m http.server`) and open `/packages/painterly-pass/examples/basic.html`. Press P to compare with the plain render.

## License

MIT. See [LICENSE](LICENSE).
