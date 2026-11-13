# PainterlyPass

A three.js post-processing pass that repaints any scene in brush strokes. The default brush paints impressionist oil strokes. A second brush paints pointillist dabs.

The strokes are anchored to surfaces, not to the screen. The pass rebuilds each pixel's 3D position from the depth buffer and lays strokes on each surface's own plane, so when the camera moves the strokes move with the building, the tree or the ground. The sky is painted with strokes fixed to view directions, so it turns with the camera.

The default colour treatment follows habits of Claude Monet's late-1800s paintings (public domain): livelier colour, cool violet shadows that keep their value, warm highlights, and a little unmixed colour in every stroke.

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

Requires three.js r160 or later and a `PerspectiveCamera`. Tested with three.js r160 and r187.

### Toggle the effect with a key

```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // for the plain path; PainterlyPass tone-maps by itself
let painted = true;
addEventListener('keydown', (e) => { if (e.code === 'KeyP') painted = !painted; });
function frame() { painted ? composer.render() : renderer.render(scene, camera); }
```

Without `renderer.toneMapping = ACESFilmicToneMapping`, the plain render has no tone mapping and looks darker and flatter than the painting, so the comparison is not fair. Setting it does not change the painted path: PainterlyPass renders the scene into its own target, where three.js does not tone-map. `examples/basic.html` does the same with one composer: it switches `enabled` on a `RenderPass` + `OutputPass` pair and on the PainterlyPass.

With BakedDebris brush strokes, also switch the strokes, because the cubes stay hidden while strokes exist: call `boom.removeStrokes()` when you turn the painting off (flying cubes come back), and `painter.overlayScene.add(boom.createStrokes({ painter }))` when you turn it on again.

## Brushes

A brush decides what one mark looks like and how it takes its colour. The pass decides where marks go, so every brush stays anchored to surfaces.

```js
import { PainterlyPass, pointillist } from 'painterly-pass';

const painter = new PainterlyPass(scene, camera, { brush: pointillist() });
painter.brush = null;            // back to the default; any brush can be set at any time
```

| Brush | Mark | Colour |
|---|---|---|
| `impressionist()` (default) | An oil stroke: an ellipse with a ragged edge, a paint ridge and bristle streaks. | Livelier colour, cool shadows, warm lights, a little unmixed colour per stroke. |
| `pointillist({ purity, hueSpread, pigments })` | A round dab with an uneven edge. | Divided colour: each dab is one pigment, mixed only with white. The eye mixes the dabs. |

Setting `brush` compiles one shader. Keep one brush object per brush and switch between them, as `examples/basic.html` does.

BakedDebris strokes follow the brush: `boom.createStrokes({ painter })` draws flying pieces as oil strokes with `impressionist()` and as round dabs with `pointillist()`. They change with `painter.brush`.

### pointillist

Each dab picks one pigment from a wheel of `pigments` hues. The hue is the local colour's hue, spread to its neighbours. Greys have no hue of their own, so they take any hue. In the dark, some dabs lean to the shadow colour; in the light, some lean to orange. White brings each pigment up to the tone of the scene. No dab uses black.

| Option | Default | Meaning |
|---|---|---|
| `purity` | `0.8` | 0 = the scene's own colour, 1 = pure pigment hues. |
| `hueSpread` | `0.07` | How far dabs stray to neighbouring hues, in turns of the colour wheel. |
| `pigments` | `12` | Number of pigment hues on the wheel. |

These three are live in `brush.uniforms`: `brush.uniforms.uPurity.value = 1` (also `uHueSpread`, `uPigments`).

The brush also reads these pass options: `strokeSize` (dab spacing), `strokeWidth` (dab size), `saturation`, `shadowTint` (its hue is the pigment of the shadow dabs), `shadowAmount` (their share in the dark), `warmth` (the share of orange dabs in the light), `colorJitter` (value difference between dabs), `contrast` and `canvas`. It ignores `strokeLength`.

At the default dab size each pixel tests 3×3 cells, against 4×4 for the oil brush.

### Your own brush

A brush is a plain object: `{ glsl, uniforms, reach(pass), search(pass, reach), flying }`. `glsl` defines five functions: `brushPalette`, `brushGround`, `brushMark`, `brushShade` and `brushFinish`. `src/brushes/impressionist.js` documents each one. The optional `flying` part gives BakedDebris strokes the same mark; the BakedDebris README describes it. Without it, strokes are oil strokes. This interface is lower-level and may change.

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
| `brush` | `null` | The brush (see Brushes). `null` = `impressionist()`. |
| `anchors` | `[]` | Moving objects whose strokes ride with them (see Moving objects). At most 4. |

The table describes the default brush. Another brush can read an option in its own way; its section says how.

## Moving objects

Strokes are fixed to the world. That suits a static scene and a moving camera. An object that moves slides under its strokes, as if it passed behind painted glass. To make an object carry its strokes, name it as an anchor:

```js
painter.anchors = [{ object: house, min: [-4, 0, -5], max: [4, 11, 7] }];   // the box that holds the house, in the house's own space
```

Every pixel inside the box gets its strokes laid in the object's own space, so they move and turn with it. The pass reads `object.matrixWorld` on every frame. Up to 4 anchors; changing their number compiles one shader. The box moves with the object: keep it tight, because anything else inside it (the ground under a house, for example) takes the same strokes.

`painter.sceneTarget` holds the scene colour and depth (`sceneTarget.depthTexture`) at paint resolution, for effects that draw on top of the painting.

`painter.overlayScene` is drawn on top of the finished painting with the same camera. BakedDebris uses it for flying brush strokes.

## How it works

1. Render the scene into a half-float target with a depth texture, at `resolutionScale`.
2. For each pixel, rebuild the world position from depth, and the surface direction from the neighbouring pixels.
3. If the position is inside the box of an anchor, continue in that object's own space. Pick the dominant axis of the surface and use the surface's own plane coordinates as the canvas. Lay one mark per grid cell there, at a random offset. The brush gives the mark its shape. The default is an ellipse with a random angle (upright on walls, lying on floors), a ragged bristle edge, a lighter paint ridge and bristle streaks. The topmost mark of the cells around the pixel wins (4x4, or up to 7x7 for strokeLength above 1; 3x3 for pointillist dabs).
4. Each mark takes its colour from the scene at its own centre, projected back to the screen, then passes through the brush's palette.
5. Choose two power-of-two cell sizes from the distance and cross-fade, so strokes stay about `strokeSize` pixels on screen.
6. Add the brush's canvas weave, scale up to the output and convert to the output colour space.

## Prior art

Anchoring strokes to surfaces to avoid the "shower door" effect goes back to Barbara Meier, *Painterly Rendering for Animation* (SIGGRAPH 1996), which placed particles on 3D surfaces. Sekuta82/oil-on-threejs-template does this per mesh in three.js. This pass does it as a post-process from the depth buffer, so it works on any scene without touching its meshes.

The pointillist brush follows the divided colour of Georges Seurat and Paul Signac (1880s, public domain): small dabs of unmixed pigment that mix in the eye. Signac describes the method in *D'Eugène Delacroix au néo-impressionnisme* (1899).

## Limitations

- Strokes are fixed to the world, so a moving object slides under them unless it is an anchor (see Moving objects). Deforming meshes and large crowds of moving objects are not covered.
- Surfaces are mapped by their dominant axis. Strongly slanted or curved surfaces get strokes from the nearest axis plane, which can show a seam where the dominant axis changes.
- Perspective cameras only. `WebGLRenderer` only: `WebGPURenderer` is not supported. A renderer created with `logarithmicDepthBuffer` or `reverseDepthBuffer` is not supported; `render()` throws an error that says so.
- Each pixel samples the scene many times. On weak GPUs lower `resolutionScale` or raise `strokeSize`.
- Transparent objects are painted with whatever is behind them in the depth buffer.

## Example

`examples/basic.html` — a small original scene (meadow, pond, houses, trees). Serve the repository root over HTTP (`npx serve .` or `python3 -m http.server`) and open `/packages/painterly-pass/examples/basic.html`. Press P to compare with the plain render. Press B to switch between the two brushes.

## License

MIT. See [LICENSE](LICENSE).
