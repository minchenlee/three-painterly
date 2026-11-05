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
  const solid = (x, y, z) => (ground !== null && y < ground) || (o.solid ? o.solid(x, y, z) : false);

  for (let i = 0; i < n; i++) {
    const d = recs[i], base = i * SEGMENTS * 8;
    for (let s = 0; s < SEGMENTS; s++) data[base + s * 8] = -1;
    const put = (slot, t, p, v, w) => { const k = base + slot * 8;
      data[k] = t; data[k + 1] = p[0]; data[k + 2] = p[1]; data[k + 3] = p[2];
      data[k + 4] = v[0]; data[k + 5] = v[1]; data[k + 6] = v[2]; data[k + 7] = w; };

    if (d.t0 > 1e8) { put(0, 0, d.p, [0, 0, 0], 0); continue; }
    let p = d.p.slice(), v = d.v.slice(), w = d.w;
    if (d.kind === 1) {                                       // start from the parent's state at the split
      const par = recs[d.parent];
      if (!par.splitOK) { d.hidden = true; put(0, 0, d.p, [0, 0, 0], 0); continue; }
      const pb = d.parent * SEGMENTS * 8, tau = par.split, h = d.size / 2;
      p = [data[pb + 1] + data[pb + 4] * tau + d.kick[0] * h,
           data[pb + 2] + data[pb + 5] * tau - 0.5 * g * tau * tau + d.kick[1] * h,
           data[pb + 3] + data[pb + 6] * tau + d.kick[2] * h];
      v = [data[pb + 4] + d.kick[0] * d.kickSpeed, data[pb + 5] - g * tau + d.kick[1] * d.kickSpeed, data[pb + 6] + d.kick[2] * d.kickSpeed];
    }
    const h = d.size / 2;
    let t = 0, k = 0, settled = false;
    const until = d.life > 0 ? Math.min(o.duration, d.life + 0.05) : o.duration;   // short-lived pieces need little simulation
    put(k++, 0, p, v, w);
    while (t < until) {
      let x = p[0] + v[0] * dt, y = p[1] + v[1] * dt - 0.5 * g * dt * dt, z = p[2] + v[2] * dt;
      v[1] -= g * dt;
      let hit = false;
      if (t > 0.03 && y > killY) {                            // let pieces leave the hole they came from
        if (v[0] && solid(x + Math.sign(v[0]) * h, p[1], p[2])) { v[0] = -v[0] * e; x = p[0]; hit = true; }
        if (v[2] && solid(x, p[1], z + Math.sign(v[2]) * h)) { v[2] = -v[2] * e; z = p[2]; hit = true; }
        if (v[1] < 0 && solid(x, y - h, z)) {
          y = o.snap ? Math.floor((y - h) / o.snap) * o.snap + o.snap + h : p[1];
          if (ground !== null && y - h < ground) y = ground + h;
          const vy = -v[1] * e; v[0] *= fr; v[2] *= fr; w *= 0.5; hit = true;
          if (vy < stop) settled = true; else v[1] = vy;
        } else if (v[1] > 0 && solid(x, y + h, z)) { y = p[1]; v[1] = -v[1] * e; hit = true; }
      }
      t += dt; p = [x, y, z];
      if (settled) { put(Math.min(k, SEGMENTS - 1), t, p, [0, 0, 0], 0); break; }
      if (hit && k < SEGMENTS - 1) put(k++, t, p, v, w);
      if (y < killY) break;
    }
    if (!settled && p[1] >= killY) put(Math.min(k, SEGMENTS - 1), t, p, [0, 0, 0], 0);
    if (d.split > 0) { const t1 = data[base + 8]; d.splitOK = !(t1 >= 0 && t1 < d.split); }   // cancelled if it hit something first
  }
  return { data, width: SEG_TEX_WIDTH, height: rows };
}
