// Type check of the hand-written .d.ts files (npm run typecheck). Never run; it only has to compile.
import { Scene, PerspectiveCamera, Vector3, MeshStandardMaterial } from 'three';
import { BakedDebris, voxelCollider, boxCollider, anyCollider, strokeFragment, type DebrisStats } from 'baked-debris';
import { PainterlyPass } from 'painterly-pass';

const scene = new Scene(), camera = new PerspectiveCamera(50, 1, 0.1, 100);
const painter = new PainterlyPass(scene, camera, { strokeSize: 7, shadowTint: [0.8, 0.8, 1.2], sky: false });
painter.amount = 0.5;
painter.overlayScene.add(new Scene());

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
painter.overlayScene.add(boom.createStrokes({ painter, lookAhead: 0.03 }));
boom.setDisplace(null);
const s: string = strokeFragment;
void stats; void s;

// @ts-expect-error: position needs 3 numbers
new BakedDebris({ pieces: [{ position: [0, 1] }], bursts: [] });
// @ts-expect-error: unknown PainterlyPass option
new PainterlyPass(scene, camera, { strokeSzie: 7 });
