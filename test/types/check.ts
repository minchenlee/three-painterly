// Type check of the hand-written .d.ts files (npm run typecheck). Never run; it only has to compile.
import { Scene, PerspectiveCamera, Vector3, MeshStandardMaterial, Mesh, BoxGeometry } from 'three';
import { BakedDebris, voxelCollider, boxCollider, anyCollider, strokeFragment, meshToPieces, type DebrisStats } from 'baked-debris';
import { withDisplace, patchCube, strokeFragment as rawStroke, oilStroke, strokeShaders } from 'baked-debris/shaders';
import { PainterlyPass, impressionist, pointillist, type PainterlyBrush } from 'painterly-pass';

const scene = new Scene(), camera = new PerspectiveCamera(50, 1, 0.1, 100);
const painter = new PainterlyPass(scene, camera, { strokeSize: 7, shadowTint: [0.8, 0.8, 1.2], sky: false });
painter.amount = 0.5;
painter.overlayScene.add(new Scene());
const dabs = pointillist({ purity: 0.9, pigments: 12 });
dabs.uniforms.uPurity.value = 0.5;
painter.brush = dabs;
painter.brush = null;
painter.minStrokeWorld = 0.03;
painter.anchors = [{ object: new Mesh(), min: [-1, 0, -1], max: [1, 2, 1] }];
new PainterlyPass(scene, camera, { anchors: painter.anchors });
// @ts-expect-error: an anchor needs its box
painter.anchors = [{ object: new Mesh() }];
const oil: PainterlyBrush = impressionist();
const mine: PainterlyBrush = { glsl: oil.glsl, reach: p => p.strokeWidth, uniforms: { uMine: { value: 1 } } };
new PainterlyPass(scene, camera, { brush: mine });
const brushName: string | undefined = painter.brush.name;
void brushName;
// @ts-expect-error: unknown pointillist option
pointillist({ purty: 1 });

const grid = new Uint8Array(8 * 8 * 8);
const solid = anyCollider(voxelCollider((i, j, k) => grid[i + 8 * (j + 8 * k)], 0.25), boxCollider([{ min: [0, 0, 0], max: [1, 1, 1] }]));
const boom = new BakedDebris({
  pieces: [{ position: [0, 1, 0], color: 0xd9c4a0 }, { position: [1, 1, 0], velocity: [1, 2, 0], launchTime: 0.2, lifetime: 0.5 }],
  bursts: [{ position: [0, 0, 0], radius: 2, time: 0.5 }],
  solid, ground: 0, castShadow: false, material: new MeshStandardMaterial(), timeWarp: { burst: 0.3 },
  displace: { uniforms: { uCenter: { value: new Vector3() } }, glsl: 'vec3 debrisDisplace(vec3 p, DebrisInfo d) { return vec3(0.0); }' },
});
scene.add(boom.mesh);
boom.setTime(1.5);
const stats: DebrisStats = boom.rebake({ restitution: 0.5 });
painter.overlayScene.add(boom.createStrokes({ painter, lookAhead: 0.03, keep: 0.5 }));
boom.setDisplace(null);
painter.overlayScene.add(boom.createStrokes({ painter, brush: pointillist() }));   // a PainterlyPass and its brushes fit createStrokes
boom.createStrokes({ brush: { flying: oilStroke, uniforms: { uMine: { value: 1 } } } });
boom.createStrokes({ brush: mine });
const fire: string = strokeShaders(pointillist().flying).fragment + withDisplace(strokeShaders().vertex, null);
void fire;
// @ts-expect-error: a look needs both parts
boom.createStrokes({ brush: { flying: { vertex: '' } } });
const s: string = strokeFragment;
void stats; void s;

const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
const pieces = meshToPieces(cube, { size: 0.1, fill: 'surface' });
new BakedDebris({ pieces: [...pieces, ...meshToPieces(cube, { color: (x, y) => (y > 0 ? 0xff0000 : 'blue') })], bursts: [] });
const n: number = pieces[0].size;
const g: string = withDisplace(rawStroke, null);
patchCube(new MeshStandardMaterial(), { value: 0 });
void n; void g;
// @ts-expect-error: fill is 'volume' or 'surface'
meshToPieces(cube, { fill: 'shell' });

// @ts-expect-error: position needs 3 numbers
new BakedDebris({ pieces: [{ position: [0, 1] }], bursts: [] });
// @ts-expect-error: unknown PainterlyPass option
new PainterlyPass(scene, camera, { strokeSzie: 7 });
