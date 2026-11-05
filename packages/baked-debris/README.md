# BakedDebris

Scrubbable explosion debris for three.js.

Collisions are simulated once on the CPU ("baked") against your own collision query and the ground. Each piece's path is stored as a few ballistic segments in a float texture. On the GPU, every piece's position is a direct function of time, so you can scrub, rewind, change speed or jump to any moment, and the result is always the same.

Status: 0.1.0, experimental.

## Use

```js
import { BakedDebris, voxelCollider } from 'baked-debris';

const boom = new BakedDebris({
  pieces: [{ position: [x, y, z], color: 0xd9c4a0, size: 0.25 }, ...],
  bursts: [{ position: [0, 1, 0], direction: [0, 0.3, 1], radius: 1.6, time: 0.5 }],
  solid: voxelCollider((i, j, k) => grid.has(i, j, k), 0.25),   // optional
  ground: 0,
});
scene.add(boom.mesh);

// every frame, or whenever the time changes
boom.setTime(seconds);
```

- Each piece is launched by the nearest burst whose `radius` reaches it. Pieces no burst reaches stay in place, so you can pass a whole model and let the bursts decide what breaks.
- `solid(x, y, z)` should return `true` inside anything the debris should hit: walls, what is still standing, cars, balconies. Remove the pieces that fly from it.
- Changing physics options needs a new bake: `boom.rebake({ restitution: 0.5 })`. `rebake` accepts any option; `gravity`, `sizeScale` and `timeWarp` passed to it also update the GPU. Changing time, time warp or size alone does not need a bake: use `setTime`, `setTimeWarp`, `setSizeScale`.

Requires three.js r160 or later (WebGL 2).

## Options

| Option | Default | Meaning |
|---|---|---|
| `pieceSize` | `0.25` | Cube size when a piece has no `size`. |
| `gravity` | `9.81` | World units per s². |
| `speed` | `[7, 18]` | Launch speed range near the burst centre; pieces further out fly slower. |
| `stagger` | `1` | 0 = every piece leaves at its burst time; 1 = pieces leave over about 0.85 s. |
| `spin` | `9` | Maximum spin, rad/s. |
| `restitution` | `0.35` | Share of speed kept across a hit (floors and walls). |
| `friction` | `0.6` | Horizontal speed kept at each floor hit. |
| `stopSpeed` | `0.6` | A floor hit slower than this ends the motion. |
| `ground` | `0` | y of a ground plane, or `null`. |
| `solid` | `null` | `(x, y, z) => boolean` collision query. |
| `snap` | `0` | Voxel size, so resting pieces sit exactly on voxel tops. |
| `duration` | `20` | Seconds of motion simulated per piece. |
| `step` | `1/90` | Simulation step. |
| `secondary` | `0` | Share of flying pieces that burst again in mid-air into 8 half-size fragments. |
| `secondaryDelay`, `secondarySpeed` | `[0.12, 0.45]`, `[3.5, 8]` | When fragments split off, and how fast. |
| `timeWarp` | `null` | `{ burst: 0.3, hover: 1/25 }`: full speed for `burst` s after launch, then the clock slows to `hover`. Also `setTimeWarp()`. |
| `sizeScale` | `1` | Resize pieces once they fly. Also `setSizeScale()`. |
| `seed` | `4242` | Same seed, same explosion. |
| `material` | new `MeshStandardMaterial` | Material for the cubes. BakedDebris patches a **clone** (`boom.mesh.material`), so the material you pass is not changed and stays usable elsewhere; `dispose()` disposes only the clone. Its `onBeforeCompile` and `customProgramCacheKey` are called on every compile and run after the debris patch, seeing the moved `transformed` and `objectNormal`. Other changes to the passed material after construction (colour, roughness, …) do not reach the clone: change `boom.mesh.material` instead. |

Bursts: `{ position, radius, time = 0, direction = [0, 1, 0], strength = 1 }`. A burst with `radius: 0` launches nothing by itself; use it with pieces that carry their own launch.

Pieces: `{ position, color, size }`, plus these optional fields when you want to launch a piece yourself:

| Field | Meaning |
|---|---|
| `velocity` | Launch velocity `[x, y, z]`. Without it, the nearest burst inside its radius launches the piece. |
| `launchTime` | When the piece leaves. Default: the time of its burst. |
| `burst` | Index of the burst it belongs to, for `setBurstOffsets()` and bullet time. |
| `spin`, `axis` | Spin speed (rad/s) and spin axis. |
| `lifetime` | Seconds until the piece shrinks away (0 = stays). Useful for bits that crumble right after launch. |

`boom.setBurstOffsets([dt0, dt1, …])` moves bursts in time without a rebake: each piece of burst *i* leaves `dt_i` seconds later (or earlier). Collisions are with static geometry only, so the paths stay exact. Only the first 32 bursts can be moved.

After a bake, `boom.stats` gives `{ pieces, flying, secondary }`.

## Brush strokes with PainterlyPass

```js
const painter = new PainterlyPass(scene, camera);
painter.overlayScene.add(boom.createStrokes({ painter }));
```

Flying pieces are then drawn as brush strokes on top of the painting, stretched along their screen velocity: long sweeps when fast, short strokes when hovering. The scene depth from the painter hides strokes behind buildings. While strokes are on, flying cubes are hidden; pieces still in place stay cubes and are painted with the scene. `boom.removeStrokes()` switches back.

To give your own effects (fire, sparks) the same brush look, import the stroke fragment shader: `import { strokeFragment } from 'baked-debris'`. The GLSL pieces and patch functions are also available as `baked-debris/shaders`; that entry is lower-level and may change between versions.

## How it works

1. **Launch.** Direction = away from the burst centre + the burst direction + a little up + noise. Speed falls with distance. Launch time = burst time + a delay that grows with distance and noise.
2. **Bake.** Each flying piece is stepped at `step` against `solid` and the ground. At each hit the velocity is reflected and damped, and a new segment starts: `[start time, position]` and `[velocity, spin]`. Up to 6 segments per piece; a zero velocity marks rest.
3. **Secondary blasts.** A chosen parent breaks at a random moment on its first arc. Its 8 fragments start from the parent's position and velocity at that moment plus an outward kick, and are baked the same way. If the parent hits something first, the split is cancelled.
4. **Playback.** The vertex shader computes the piece's local time (optionally warped), finds the segment for that time in the texture with `texelFetch`, and evaluates the parabola. Shadows use the same code.

## Limitations

- Pieces do not collide with each other.
- Collision uses point probes at the piece's half size, not full boxes; thin geometry can be missed at high speed.
- At most 6 segments per piece: the hit that uses up the last segment ends the motion, and the piece rests at that hit point.
- The bake runs on the main thread: about 0.2–2 s for 10k–200k pieces in tests.

## Example

`examples/explode.html` — two voxel towers, three bursts, a wall to bounce off. It imports PainterlyPass from `../../painterly-pass/src/`, so serve the repository root: `python3 -m http.server` and open `/packages/baked-debris/examples/explode.html`.

## License

MIT. See [LICENSE](LICENSE).
