// Round shapes for the examples. createShapes() takes the drawing calls of createModel (voxels.js) and keeps them as balls,
// rods, boxes, caps and panels instead of voxels, so one builder (people.js) gives a voxel figure or a smooth one.
// Not part of any package. It serves the examples and may change with them.
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, Mesh, Quaternion, SphereGeometry, Vector3,
} from 'three';

/**
 * A recorder with the calls of createModel: ellipsoid, set, box, line, dome, panel. `smooth` is true, so builders can tell.
 * cell: true shifts everything by half a unit, as voxel cells are (cell x spans x .. x + 1). Pass false to draw in plain units.
 *   line(a, b, c, r = 0.5, flat = false)   a rod with round ends; flat = a plain cylinder with flat ends
 *   panel(points, c)                       a flat convex polygon, seen from both sides (a sail, a flag)
 */
export function createShapes({ cell = true } = {}) {
  const prims = [], H = cell ? 0.5 : 0, pick = (c, ...at) => (typeof c === 'function' ? c(...at) : c), sh = p => [p[0] + H, p[1] + H, p[2] + H];
  return {
    smooth: true, prims,
    ellipsoid(cx, cy, cz, rx, ry, rz, c) { prims.push({ kind: 'ball', p: sh([cx, cy, cz]), r: [rx, ry, rz], c: pick(c, Math.round(cx), Math.round(cy), Math.round(cz)) }); },
    set(x, y, z, c) { if (c) prims.push({ kind: 'ball', p: sh([x, y, z]), r: [0.62, 0.62, 0.62], c }); },
    box(x0, x1, y0, y1, z0, z1, c) { prims.push({ kind: 'box', p: [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (z0 + z1 + 1) / 2], r: [(x1 - x0 + 1) / 2, (y1 - y0 + 1) / 2, (z1 - z0 + 1) / 2], c: pick(c, x0, y0, z0) }); },
    line(a, b, c, r = 0.5, flat = false) { prims.push({ kind: 'rod', a: sh(a), b: sh(b), r, c, flat }); },
    dome(cx, cy, cz, r, h, c) { prims.push({ kind: 'cap', p: sh([cx, cy, cz]), r: [r, h, r], c: pick(c, cx, cz) }); },
    panel(points, c) { prims.push({ kind: 'panel', pts: points.map(sh), c }); },
  };
}

const UNIT = {
  ball: () => new SphereGeometry(1, 24, 16), rod: () => new CylinderGeometry(1, 1, 1, 18, 1), box: () => new BoxGeometry(1, 1, 1),
  cap: () => new SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2),   // the upper half of a ball: a shell, open below
};

/**
 * Meshes for placed shapes: one InstancedMesh for each kind of primitive, and one Mesh for all panels.
 *   placed     [{ model, origin = [0, 0, 0], size = 1, turn = 0, begin = 0, weight = 1 }]: turn is quarter turns about y; begin is any
 *              number you want on every primitive of that model: it becomes the attribute aBegin (per instance, or per vertex for
 *              panels); weight scales how many dabs surfaceDabs gives the model (low for crowns of many overlapping balls)
 *   hex        palette colours as sRGB hex numbers, by index (HEX of createPalette)
 *   material   kind => Material, called once for 'ball', 'rod', 'box', 'cap' and 'panel'. Make 'cap' and 'panel' double-sided.
 * Returns { group, shapes }. shapes lists every primitive in the world, for surfaceDabs:
 * { kind, matrix (unit primitive -> world), color (hex), begin, area (m2, rough) } or { kind: 'panel', tris, color, begin, area }.
 */
export function buildShapes(placed, { hex, material }) {
  const lists = { ball: [], rod: [], box: [], cap: [] }, panels = [], shapes = [];
  const M = new Matrix4(), T = new Matrix4(), Q = new Quaternion(), P = new Vector3(), S = new Vector3(), A = new Vector3(), B = new Vector3(), UP = new Vector3(0, 1, 0), D = new Vector3();
  let weight = 1;
  const push = (kind, matrix, c, begin, area) => { const s = { kind, matrix: matrix.clone(), color: hex[c], begin, area, weight }; lists[kind].push(s); shapes.push(s); };
  for (const { model, origin = [0, 0, 0], size = 1, turn = 0, begin = 0, weight: w = 1 } of placed) {
    weight = w;
    T.compose(P.set(...origin), Q.setFromAxisAngle(UP, -turn * Math.PI / 2), S.setScalar(size));   // model units -> world; a quarter turn takes +x to +z
    for (const p of model.prims) {
      if (p.kind === 'ball' || p.kind === 'box' || p.kind === 'cap') {
        const k = p.kind === 'box' ? 2 : 1;                       // the unit box has edges of 1, the unit ball a radius of 1
        M.compose(P.set(...p.p), Q.identity(), S.set(p.r[0] * k, p.r[1] * k, p.r[2] * k)).premultiply(T);
        const [a, b, c] = p.r.map(v => v * size);
        push(p.kind, M, p.c, begin, p.kind === 'box' ? 8 * (a * b + b * c + c * a) : (p.kind === 'cap' ? 2 : 4) * Math.PI * (a * b + b * c + c * a) / 3);
      } else if (p.kind === 'rod') {
        A.set(...p.a); B.set(...p.b); D.subVectors(B, A); const len = Math.max(D.length(), 1e-4);
        M.compose(P.addVectors(A, B).multiplyScalar(0.5), Q.setFromUnitVectors(UP, D.clone().divideScalar(len)), S.set(p.r, len, p.r)).premultiply(T);
        push('rod', M, p.c, begin, 2 * Math.PI * p.r * len * size * size);
        if (!p.flat) for (const e of [A, B]) { M.compose(P.copy(e), Q.identity(), S.setScalar(p.r)).premultiply(T); push('ball', M, p.c, begin, 2 * Math.PI * (p.r * size) ** 2); }
      } else if (p.kind === 'panel') {
        const w = p.pts.map(q => new Vector3(...q).applyMatrix4(T)), tris = [];
        let area = 0;
        for (let i = 1; i + 1 < w.length; i++) { tris.push([w[0], w[i], w[i + 1]]); area += A.subVectors(w[i], w[0]).cross(B.subVectors(w[i + 1], w[0])).length() / 2; }
        const s = { kind: 'panel', tris, color: hex[p.c], begin, area, weight }; panels.push(s); shapes.push(s);
      }
    }
  }
  const group = new Group(), col = new Color();
  for (const kind in lists) {
    const list = lists[kind]; if (!list.length) continue;
    const mesh = new InstancedMesh(UNIT[kind](), material(kind), list.length), begins = new Float32Array(list.length);
    list.forEach((s, i) => { mesh.setMatrixAt(i, s.matrix); mesh.setColorAt(i, col.set(s.color)); begins[i] = s.begin; });
    mesh.geometry.setAttribute('aBegin', new InstancedBufferAttribute(begins, 1));
    mesh.name = kind; mesh.frustumCulled = false; group.add(mesh);
  }
  if (panels.length) {
    const pos = [], nor = [], cols = [], begins = [];
    for (const s of panels) { col.set(s.color); for (const t of s.tris) { A.subVectors(t[1], t[0]).cross(B.subVectors(t[2], t[0])).normalize();
      for (const v of t) { pos.push(v.x, v.y, v.z); nor.push(A.x, A.y, A.z); cols.push(col.r, col.g, col.b); begins.push(s.begin); } } }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(cols, 3)); g.setAttribute('aBegin', new Float32BufferAttribute(begins, 1));
    const mat = material('panel'); mat.vertexColors = true;
    const mesh = new Mesh(g, mat); mesh.name = 'panel'; mesh.frustumCulled = false; group.add(mesh);
  }
  return { group, shapes };
}

/**
 * Points on the shapes, on the side that faces `eye`: one for each dab that should cover them.
 *   eye      [x, y, z]
 *   dab      distance from the eye => the size of a dab there (world units)
 *   cover    dabs per dab-sized patch of surface; shapes overlap, so well under 1 is enough
 *   rnd      a seeded generator, 0..1
 * Returns [{ position, color, begin, dist }].
 */
export function surfaceDabs(shapes, { eye, dab, cover = 0.3, rnd }) {
  const out = [], E = new Vector3(...eye), P = new Vector3(), N = new Vector3(), C = new Vector3(), u = [0, 0, 0];
  for (const s of shapes) {
    if (s.kind === 'panel') C.copy(s.tris[0][0]); else C.setFromMatrixPosition(s.matrix);
    const dist = Math.max(C.distanceTo(E), 0.5), want = cover * (s.weight ?? 1) * s.area / dab(dist) ** 2, n = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (s.kind === 'panel') {
        const t = s.tris[Math.floor(rnd() * s.tris.length)]; let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
        P.copy(t[0]).addScaledVector(N.subVectors(t[1], t[0]), a).addScaledVector(N.subVectors(t[2], t[0]), b);
      } else {
        if (s.kind === 'ball' || s.kind === 'cap') { const y = s.kind === 'cap' ? rnd() : 2 * rnd() - 1, a = rnd() * 6.2832, r = Math.sqrt(1 - y * y); u[0] = r * Math.cos(a); u[1] = y; u[2] = r * Math.sin(a); }
        else if (s.kind === 'rod') { const a = rnd() * 6.2832; u[0] = Math.cos(a); u[1] = rnd() - 0.5; u[2] = Math.sin(a); }
        else { const f = Math.floor(rnd() * 3); u[0] = rnd() - 0.5; u[1] = rnd() - 0.5; u[2] = rnd() - 0.5; u[f] = rnd() < 0.5 ? -0.5 : 0.5; }
        P.set(u[0], u[1], u[2]).applyMatrix4(s.matrix);
        if (s.kind !== 'cap') {                                    // a point on the far side: take the one opposite, which faces the eye
          N.subVectors(P, C);
          if (N.dot(C.clone().sub(E)) > 0) { if (s.kind === 'rod') P.set(-u[0], u[1], -u[2]).applyMatrix4(s.matrix); else P.set(-u[0], -u[1], -u[2]).applyMatrix4(s.matrix); }
        }
      }
      out.push({ position: [P.x, P.y, P.z], color: s.color, begin: s.begin, dist });
    }
  }
  return out;
}
