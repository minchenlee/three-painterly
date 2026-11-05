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
  solid: voxelCollider((i, j, k) => grid[i + nx * (j + ny * k)] === 1, 0.25),   // optional; grid: Uint8Array of nx * ny * nz
  ground: 0,
});
scene.add(boom.mesh);

// every frame, or whenever the time changes
boom.setTime(seconds);
```

- Each piece is launched by the nearest burst whose `radius` reaches it. Pieces no burst reaches stay in place, so you can pass a whole model and let the bursts decide what breaks.
- `solid(x, y, z)` should return `true` inside anything the debris should hit: walls, what is still standing, cars, balconies. Remove the pieces that fly from it.
- `solid` is called for every probe of every simulation step: millions of times per bake. Keep it cheap. For voxels, look up a typed array (`grid[i + nx * (j + ny * k)]`); a `Set` of `"i,j,k"` strings builds a string per call and can make the bake many times slower.
- Collider helpers: `voxelCollider(get, cell = 1, origin = [0, 0, 0])` is true where `get(i, j, k)` is truthy, with `i = floor((x - origin[0]) / cell)` (same for y, z). So `origin` is the world position of the minimum corner of cell (0, 0, 0), not its centre. `boxCollider([{ min, max }, …])` is true inside axis-aligned boxes. `anyCollider(a, b, …)` is true where any of them is.
- Changing physics options needs a new bake: `boom.rebake({ restitution: 0.5 })`. `rebake` accepts any option; `gravity`, `sizeScale` and `timeWarp` passed to it also update the GPU. Changing time, time warp or size alone does not need a bake: use `setTime`, `setTimeWarp`, `setSizeScale`.

Requires three.js r160 or later (WebGL 2). Tested with three.js r160 and r187.

## Pieces from a mesh

```js
import { BakedDebris, meshToPieces } from 'baked-debris';

const pieces = meshToPieces(statue, { size: 0.1 });   // world space, from statue.matrixWorld
scene.remove(statue);                                 // the pieces replace the mesh
const boom = new BakedDebris({ pieces, bursts: [{ position: [0, 1, 0], radius: 0.8, time: 0.5 }] });
```

`meshToPieces(mesh, { size = 0.25, fill = 'volume', color })` returns one piece per grid cell whose centre is inside the mesh:

- `size`: cube size. Cells sit on a world grid: cell *i* spans `[i * size, (i + 1) * size)` on each axis, so pieces line up with `voxelCollider(get, size)` (origin `[0, 0, 0]`).
- `fill`: `'volume'` keeps every cell inside. `'surface'` keeps only inside cells that have an empty neighbour: a hollow shell one cell thick, with far fewer pieces.
- `color`: a function `(x, y, z) => colour` for the cell centre. Without it, a piece takes the colour of the nearer surface straight above or below it: the material colour, times the interpolated vertex colour when the geometry has a `color` attribute. Return a number or a `Color`; BakedDebris copies it when it builds, so one shared `Color` is fine as long as you do not change it before then. Without `color`, each piece gets its own `Color`. A multi-material mesh uses each group's material.
- The mesh must be closed (watertight). Each grid column is intersected with the triangles once, and the inside is between the 1st and 2nd hit, the 3rd and 4th, and so on. A column with an odd number of hits (a hole) drops the last one.
- It uses `mesh.matrixWorld` and updates the parents first. It ignores morph targets, skinning and instancing.
- Deterministic: the same mesh and options give the same pieces in the same order.
- Speed: a 10k-triangle torus knot gives about 6k pieces in 3–15 ms (Node). The time grows with the number of cells.

Pieces do not collide with each other, so debris flies through the part of the object that stays. To make it bounce off that part, build a `voxelCollider` from the pieces no burst reaches, and pass it as `solid`.

A piece is reached when it is closer than `radius` to a burst's `position` (unless you set its `burst` or `launchTime`):

```js
const reached = p => bursts.some(b => Math.hypot(p.position[0] - b.position[0], p.position[1] - b.position[1], p.position[2] - b.position[2]) < b.radius);
const cells = pieces.filter(p => !reached(p)).map(p => p.position.map(v => Math.floor(v / size)));
const lo = [0, 1, 2].map(a => cells.reduce((m, c) => Math.min(m, c[a]), Infinity));
const n = [0, 1, 2].map(a => cells.reduce((m, c) => Math.max(m, c[a]), -Infinity) - lo[a] + 1);
const grid = new Uint8Array(n[0] * n[1] * n[2]);
for (const [i, j, k] of cells) grid[(i - lo[0]) + n[0] * ((j - lo[1]) + n[1] * (k - lo[2]))] = 1;
const solid = voxelCollider((i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2]
  && grid[i + n[0] * (j + n[1] * k)] === 1, size, lo.map(v => v * size));
```

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
| `killY` | `-50` | Pieces that fall below this y stop being simulated. |
| `duration` | `20` | Seconds of motion simulated per piece. |
| `step` | `1/90` | Simulation step. |
| `secondary` | `0` | Share of flying pieces that burst again in mid-air into 8 half-size fragments. |
| `secondaryDelay`, `secondarySpeed` | `[0.12, 0.45]`, `[3.5, 8]` | When fragments split off, and how fast. |
| `timeWarp` | `null` | `{ burst: 0.3, hover: 1/25 }`: full speed for `burst` s after launch, then the clock slows to `hover`. Also `setTimeWarp()`. |
| `sizeScale` | `1` | Resize pieces once they fly. Also `setSizeScale()`. |
| `seed` | `4242` | Same seed, same explosion. |
| `castShadow`, `receiveShadow` | `true` | Shadow flags for `boom.mesh`. Turning off `castShadow` skips the shadow-map passes for all pieces. |
| `displace` | `null` | `{ glsl, uniforms }`: a GPU offset per piece. See [Displace hook](#displace-hook). |
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

Flying pieces are then drawn as brush strokes on top of the painting, stretched along their screen velocity: long sweeps when fast, short strokes when hovering. "Flying" means every piece that has been launched: a piece that has landed stays a stroke (lying flat, because it does not move), and `boom.stats.flying` counts all of them. The scene depth from the painter hides strokes behind buildings. While strokes are on, flying cubes are hidden; pieces still in place stay cubes and are painted with the scene. `boom.removeStrokes()` switches back.

`createStrokes` options: `strokeScale` (1.25), `maxWidth` in CSS pixels (34), `jitter` (0.16), `lookAhead` (−0.03 s: the stroke points from where the piece was a moment ago; use a positive value when you play the clock backwards), `keep` (1: the share of flying pieces drawn as strokes; each piece's choice is fixed, so nothing flickers. With large strokes, a lower `keep` saves overdraw. Change it live with `strokes.material.uniforms.uKeep.value`).

To give your own effects (fire, sparks) the same brush look, import the stroke fragment shader: `import { strokeFragment } from 'baked-debris'`. The GLSL pieces and patch functions are also available as `baked-debris/shaders`; that entry is lower-level and may change between versions.

## Displace hook

Add your own motion on the GPU on top of the bake: a swirl, wind, a wobble. Pass GLSL that defines one function with a fixed signature:

```js
const boom = new BakedDebris({
  pieces, bursts, solid,
  displace: {
    uniforms: { uSwirl: { value: 1.5 }, uCenter: { value: new Vector3(0, 4, 0) } },
    glsl: /* glsl */`
      uniform float uSwirl;
      uniform vec3 uCenter;
      // p: baked position (world space). Return the offset to add.
      vec3 debrisDisplace(vec3 p, DebrisInfo d) {
        if (d.local <= 0.0) return vec3(0.0);            // not launched yet: stay in place
        vec3 r = p - uCenter;
        float a = uSwirl * d.local / (1.0 + length(r.xz));
        return vec3(r.x * cos(a) - r.z * sin(a) - r.x, 0.0, r.x * sin(a) + r.z * cos(a) - r.z);
      }`,
  },
});
boom.uniforms.uSwirl.value = 3;   // live, no recompile
boom.setDisplace(null);           // remove; or pass a new { glsl, uniforms } (recompiles)
```

`DebrisInfo` fields:

| Field | Meaning |
|---|---|
| `time` | Global time of this sample. Strokes sample twice (see `lookAhead`), so use `d.time`, not `uTime`, and the stroke direction follows your motion. |
| `local` | Physics time since launch (after the time warp); `<= 0` = not launched yet. |
| `kind` | 0 = piece, 1 = fragment of a secondary blast. |
| `burst` | Index of the burst that launched it, −1 = none. |
| `index` | The piece's row in the segment texture: stable, usable as a random seed. |
| `rest` | Local time from which the piece rests. |

- The offset moves the whole piece, so cubes stay rigid. Cubes, both shadow materials and strokes use the same hook.
- The hook's uniforms are added to `boom.uniforms`. A name that is already used (`uTime`, `uLookAhead`, …) throws an error.
- GLSL errors appear in the three.js console output between `// --- baked-debris displace hook ---` markers.
- **Collisions do not know the offset.** The bake ran without it, so a large offset pushes pieces through walls and the floor. Keep offsets small near geometry, or fade them out as `d.local` approaches `d.rest`.

## How it works

1. **Launch.** Direction = away from the burst centre + the burst direction + a little up + noise. Speed falls with distance. Launch time = burst time + a delay that grows with distance and noise.
2. **Bake.** Each flying piece is stepped at `step` against `solid` and the ground. At each hit the velocity is reflected and damped, and a new segment starts: `[start time, position]` and `[velocity, spin]`. Up to 6 segments per piece. Each piece also stores the local time from which it rests; gravity stops there (a zero velocity alone can be the top of a free fall).
3. **Secondary blasts.** A chosen parent breaks at a random moment on its first arc. Its 8 fragments start from the parent's position and velocity at that moment plus an outward kick, and are baked the same way. If the parent hits something first, the split is cancelled.
4. **Playback.** The vertex shader computes the piece's local time (optionally warped), finds the segment for that time in the texture with `texelFetch`, and evaluates the parabola. Shadows use the same code.

## Limitations

- Pieces do not collide with each other.
- World space only. Positions, bursts and `solid` are in world units, and the bake collides in world space. Do not move, rotate or scale `boom.mesh` or its parents: the cubes would move away from what they hit, and the brush strokes (which ignore the mesh transform) would stay behind. To place an explosion, move the pieces and bursts before the bake.
- Collision uses point probes at the piece's half size, not full boxes; thin geometry can be missed at high speed. In the first 0.03 s after launch only the piece's centre is probed, so pieces flush against what still stands can leave their hole.
- At most 6 segments per piece: the hit that uses up the last segment ends the motion, and the piece rests at that hit point.
- Memory per record (a piece, or one of the 8 fragments of a secondary blast): 192 B in the segment texture on the GPU plus the same 192 B kept on the CPU, and 56 B of instance attributes for the cubes (another 56 B while strokes are on). 100k records ≈ 44 MB. The texture is 4096 texels wide and `ceil(records × 12 / 4096)` tall; if that is more than the GPU's `maxTextureSize` (often 16384, so about 5.5M records), the first render throws an error naming the limit.
- The bake runs on the main thread: about 0.2–2 s for 10k–200k pieces in tests.

## Example

`examples/explode.html` — two voxel towers, three bursts, a wall to bounce off. It imports PainterlyPass from `../../painterly-pass/src/`, so serve the repository root: `python3 -m http.server` and open `/packages/baked-debris/examples/explode.html`.

## License

MIT. See [LICENSE](LICENSE).
