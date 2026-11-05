// CPU side: launch every piece from its burst, simulate it once against the collider,
// and store each ballistic segment so the GPU can look up any moment exactly.

export const SEGMENTS = 6;          // ballistic segments kept per piece (launch + up to 5 bounces/rest)
export const SEG_TEX_WIDTH = 4096;  // texels per row of the segment texture (2 texels per segment)

/** Small deterministic PRNG so the same seed always gives the same explosion. */
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fin = v => typeof v === 'number' && Number.isFinite(v);
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(fin);
const range = v => Array.isArray(v) && v.length === 2 && v.every(fin) && v[0] <= v[1];

/**
 * Check options, pieces and bursts before any memory is allocated. Throws an Error that names the bad field,
 * e.g. "BakedDebris: step must be a finite number > 0 (got 0)". A step of 0 would otherwise loop forever.
 */
export function validateOptions(o) {
  const fail = (field, rule, got) => { throw new Error(`BakedDebris: ${field} must be ${rule} (got ${JSON.stringify(got)})`); };
  const num = (k, rule, ok) => { if (!fin(o[k]) || !ok(o[k])) fail(k, rule, o[k]); };
  num('step', 'a finite number > 0', v => v > 0);
  num('duration', 'a finite number >= 0', v => v >= 0);
  num('gravity', 'a finite number', () => true);
  num('pieceSize', 'a finite number > 0', v => v > 0);
  num('stagger', 'a finite number >= 0', v => v >= 0);
  num('spin', 'a finite number', () => true);
  num('restitution', 'a finite number >= 0', v => v >= 0);
  num('friction', 'a finite number >= 0', v => v >= 0);
  num('stopSpeed', 'a finite number >= 0', v => v >= 0);
  num('snap', 'a finite number >= 0', v => v >= 0);
  num('killY', 'a finite number', () => true);
  num('secondary', 'a number from 0 to 1', v => v >= 0 && v <= 1);
  num('seed', 'a finite number', () => true);
  if (o.sizeScale !== undefined) num('sizeScale', 'a finite number >= 0', v => v >= 0);
  for (const k of ['speed', 'secondaryDelay', 'secondarySpeed']) if (!range(o[k])) fail(k, '[min, max] with finite min <= max', o[k]);
  if (o.ground !== null && !fin(o.ground)) fail('ground', 'a finite number or null', o.ground);
  if (o.solid !== null && typeof o.solid !== 'function') fail('solid', 'a function (x, y, z) => boolean or null', o.solid);
  const w = o.timeWarp;
  if (w != null && (typeof w !== 'object' || (w.burst !== undefined && !(fin(w.burst) && w.burst > 0)) || (w.hover !== undefined && !(fin(w.hover) && w.hover >= 0))))
    fail('timeWarp', 'null or { burst > 0, hover >= 0 }', w);
  if (!Array.isArray(o.bursts)) fail('bursts', 'an array', o.bursts);
  if (!Array.isArray(o.pieces)) fail('pieces', 'an array', o.pieces);
  o.bursts.forEach((b, i) => {
    const f = k => `bursts[${i}].${k}`;
    if (!b || !vec3(b.position)) fail(f('position'), '3 finite numbers', b?.position);
    if (!fin(b.radius) || b.radius < 0) fail(f('radius'), 'a finite number >= 0', b.radius);
    if (b.time !== undefined && !fin(b.time)) fail(f('time'), 'a finite number', b.time);
    if (b.direction !== undefined && !vec3(b.direction)) fail(f('direction'), '3 finite numbers', b.direction);
    if (b.strength !== undefined && !fin(b.strength)) fail(f('strength'), 'a finite number', b.strength);
  });
  const nb = o.bursts.length;
  for (let i = 0; i < o.pieces.length; i++) {
    const p = o.pieces[i], f = k => `pieces[${i}].${k}`;
    if (!p || !vec3(p.position)) fail(f('position'), '3 finite numbers', p?.position);
    if (p.size !== undefined && !(fin(p.size) && p.size > 0)) fail(f('size'), 'a finite number > 0', p.size);
    if (p.velocity !== undefined && !vec3(p.velocity)) fail(f('velocity'), '3 finite numbers', p.velocity);
    if (p.launchTime !== undefined && !fin(p.launchTime)) fail(f('launchTime'), 'a finite number', p.launchTime);
    if (p.burst !== undefined && !(Number.isInteger(p.burst) && p.burst >= -1 && p.burst < nb)) fail(f('burst'), `an integer from -1 to ${nb - 1}`, p.burst);
    if (p.spin !== undefined && !fin(p.spin)) fail(f('spin'), 'a finite number', p.spin);
    if (p.axis !== undefined && !vec3(p.axis)) fail(f('axis'), '3 finite numbers', p.axis);
    if (p.lifetime !== undefined && !(fin(p.lifetime) && p.lifetime >= 0)) fail(f('lifetime'), 'a finite number >= 0', p.lifetime);
  }
}

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Turn pieces + bursts into launched pieces.
 * Each piece is launched by the nearest burst whose radius reaches it; other pieces stay where they are.
 * A piece that has its own `velocity` is launched with it instead (at `launchTime`, or its burst's time).
 * Kinds: 0 = cube, 1 = fragment of a secondary blast.
 */
export function launchPieces(pieces, bursts, o, rnd) {
  const out = [];
  pieces.forEach((pc, i) => {
    const p = pc.position;
    let best = -1, bd = Infinity;
    bursts.forEach((b, j) => {
      const d = Math.hypot(p[0] - b.position[0], p[1] - b.position[1], p[2] - b.position[2]);
      if (d < b.radius && d < bd) { bd = d; best = j; }
    });
    const rec = { kind: 0, burst: best, p: p.slice(), v: [0, 0, 0], t0: 1e9, size: pc.size ?? o.pieceSize,
      color: pc.color, axis: norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), w: 0, split: 0, src: i, life: pc.lifetime ?? 0 };
    if (pc.velocity) {                                        // the caller launched this piece itself
      rec.burst = pc.burst ?? -1;
      rec.v = pc.velocity.slice();
      rec.t0 = pc.launchTime ?? (rec.burst >= 0 ? bursts[rec.burst].time ?? 0 : 0);
      rec.w = pc.spin ?? (rnd() * 2 - 1) * o.spin;
      if (pc.axis) rec.axis = norm(pc.axis);
    } else if (best >= 0) {
      const b = bursts[best], c = b.position, n = b.direction ?? [0, 1, 0], r = b.radius, f = Math.min(1, bd / r);
      const dir = norm([(p[0] - c[0]) / r + n[0] * 1.1 + (rnd() - 0.5) * 0.9,
                        (p[1] - c[1]) / r + n[1] * 1.1 + 0.7 + (rnd() - 0.5) * 0.9,
                        (p[2] - c[2]) / r + n[2] * 1.1 + (rnd() - 0.5) * 0.9]);
      const sp = (o.speed[0] + rnd() * (o.speed[1] - o.speed[0])) * (1.15 - 0.6 * f) * (b.strength ?? 1);
      rec.v = dir.map(x => x * sp);
      rec.t0 = (b.time ?? 0) + (f * 0.35 + rnd() * 0.5) * o.stagger;
      rec.w = (rnd() * 2 - 1) * o.spin;
    }
    out.push(rec);
  });
  return out;
}

/** Add secondary blasts: a share of the flying pieces bursts again in mid-air into 8 half-size fragments. */
export function addSecondary(recs, o, rnd) {
  const kids = [];
  recs.forEach((d, i) => {
    if (d.kind !== 0 || d.t0 > 1e8 || d.life > 0 || rnd() >= o.secondary) return;
    d.split = o.secondaryDelay[0] + rnd() * (o.secondaryDelay[1] - o.secondaryDelay[0]);
    for (let k = 0; k < 8; k++) {
      kids.push({ kind: 1, parent: i, burst: d.burst, life: 0, p: d.p.slice(), v: [0, 0, 0], t0: d.t0, size: d.size / 2, color: d.color,
        axis: norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), w: (rnd() * 2 - 1) * o.spin * 1.5, split: 0,
        kick: norm([rnd() - 0.5, rnd() - 0.5 + 0.35, rnd() - 0.5]),
        kickSpeed: o.secondarySpeed[0] + rnd() * (o.secondarySpeed[1] - o.secondarySpeed[0]) });
    }
  });
  return recs.concat(kids);
}

/**
 * Simulate every flying piece against `solid(x, y, z)` (and an optional ground plane) with a fixed step,
 * and write its segments: [start time, position] and [velocity, spin]. A zero velocity marks rest.
 * Times are local to the piece (seconds since its launch).
 */
export function simulate(recs, o) {
  const n = recs.length, rows = Math.max(1, Math.ceil((n * SEGMENTS * 2) / SEG_TEX_WIDTH));
  const data = new Float32Array(SEG_TEX_WIDTH * rows * 4);
  const g = o.gravity, dt = o.step, e = o.restitution, fr = o.friction, stop = o.stopSpeed;
  const ground = o.ground, killY = o.killY;
  const hasGround = ground !== null, collider = o.solid, snap = o.snap;
  const solid = (x, y, z) => (hasGround && y < ground) || (collider ? collider(x, y, z) : false);
  // Plain numbers only inside the loop: no arrays are made per step, which keeps big bakes free of GC pauses.
  let base = 0;
  const put = (slot, t, px, py, pz, vx, vy, vz, w) => { const k = base + slot * 8;
    data[k] = t; data[k + 1] = px; data[k + 2] = py; data[k + 3] = pz;
    data[k + 4] = vx; data[k + 5] = vy; data[k + 6] = vz; data[k + 7] = w; };

  for (let i = 0; i < n; i++) {
    const d = recs[i];
    base = i * SEGMENTS * 8;
    for (let s = 0; s < SEGMENTS; s++) data[base + s * 8] = -1;

    d.restT = 0;                                              // local time from which the piece rests (no gravity)
    if (d.t0 > 1e8) { put(0, 0, d.p[0], d.p[1], d.p[2], 0, 0, 0, 0); continue; }
    let px = d.p[0], py = d.p[1], pz = d.p[2], vx = d.v[0], vy = d.v[1], vz = d.v[2], w = d.w;
    if (d.kind === 1) {                                       // start from the parent's state at the split
      const par = recs[d.parent];
      if (!par.splitOK) { d.hidden = true; put(0, 0, d.p[0], d.p[1], d.p[2], 0, 0, 0, 0); continue; }
      const pb = d.parent * SEGMENTS * 8, tau = par.split, h = d.size / 2;
      px = data[pb + 1] + data[pb + 4] * tau + d.kick[0] * h;
      py = data[pb + 2] + data[pb + 5] * tau - 0.5 * g * tau * tau + d.kick[1] * h;
      pz = data[pb + 3] + data[pb + 6] * tau + d.kick[2] * h;
      vx = data[pb + 4] + d.kick[0] * d.kickSpeed; vy = data[pb + 5] - g * tau + d.kick[1] * d.kickSpeed; vz = data[pb + 6] + d.kick[2] * d.kickSpeed;
    }
    const h = d.size / 2;
    let t = 0, k = 0, settled = false;
    const until = d.life > 0 ? Math.min(o.duration, d.life + 0.05) : o.duration;   // short-lived pieces need little simulation
    put(k++, 0, px, py, pz, vx, vy, vz, w);
    while (t < until) {
      let x = px + vx * dt, y = py + vy * dt - 0.5 * g * dt * dt, z = pz + vz * dt;
      vy -= g * dt;
      let hit = false;
      if (t > 0.03 && y > killY) {                            // let pieces leave the hole they came from
        if (vx && solid(x + Math.sign(vx) * h, py, pz)) { vx = -vx * e; x = px; hit = true; }
        if (vz && solid(x, py, z + Math.sign(vz) * h)) { vz = -vz * e; z = pz; hit = true; }
        if (vy < 0 && solid(x, y - h, z)) {
          y = snap ? Math.floor((y - h) / snap) * snap + snap + h : py;
          if (hasGround && y - h < ground) y = ground + h;
          const up = -vy * e; vx *= fr; vz *= fr; w *= 0.5; hit = true;
          if (up < stop) settled = true; else vy = up;
        } else if (vy > 0 && solid(x, y + h, z)) { y = py; vy = -vy * e; hit = true; }
      }
      t += dt; px = x; py = y; pz = z;
      // out of segments: the last one is a rest at this hit point, so what is drawn never runs on through a wall or floor
      if (hit && k === SEGMENTS - 1) settled = true;
      if (settled) { put(k, t, px, py, pz, 0, 0, 0, 0); d.restT = t; break; }
      if (hit) put(k++, t, px, py, pz, vx, vy, vz, w);
      if (y < killY) break;
    }
    if (!settled && py >= killY) { put(Math.min(k, SEGMENTS - 1), t, px, py, pz, 0, 0, 0, 0); d.restT = t; }
    else if (!settled) d.restT = 1e9;                        // fell out of the world: keeps falling
    if (d.split > 0) { const t1 = data[base + 8]; d.splitOK = !(t1 >= 0 && t1 < d.split); }   // cancelled if it hit something first
  }
  return { data, width: SEG_TEX_WIDTH, height: rows };
}
