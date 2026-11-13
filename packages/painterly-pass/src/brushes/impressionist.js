// The impressionist oil brush: the default brush of PainterlyPass.
//
// A brush is a plain object: { name, glsl, uniforms, reach(pass), search(pass, reach) }.
// glsl defines five functions. It can use the helpers h1, h2 and lum, and every uniform of
// paintHead in ../shaders.js (uSaturation, uShadowTint, uShadowAmount, uWarmth, uJitter, uLength,
// uWidth, uContrast, uCanvas, uReach, ...).
//
//   vec3 brushPalette(vec3 c, float r)   colour of one mark; c = scene colour at the mark, r = random per mark
//   vec3 brushGround(vec3 base)          what shows between the marks; base = scene colour at the pixel
//   float brushMark(vec2 d, float C, vec2 k, float ang, out vec2 at, out float v)
//                                        d = pixel minus mark centre on the plane, C = cell size (same unit as d),
//                                        k = key of the cell (seed for h1/h2), ang = direction hint of the plane.
//                                        Returns < 1 inside the mark. at = offset from the centre where the mark
//                                        takes its colour; v = any value, passed on to brushShade.
//   vec3 brushShade(vec3 col, float e, float v, vec2 k)   relief of the mark; e = what brushMark returned
//   vec3 brushFinish(vec3 col, vec2 px)  canvas or paper, in paint-target pixels
//
// reach(pass) returns how far a mark can reach from its centre, in cells. The pass tests enough cells
// around each pixel for that reach (2 * reach + 1 per side, at most 7), or search(pass, reach) cells.

const glsl = /* glsl */`
// The palette: livelier colour, cool shadows that keep their value, warm light,
// and a little unmixed colour in every stroke.
vec3 brushPalette(vec3 c, float r) {
  float L = lum(c);
  c = mix(vec3(L), c, uSaturation);
  c = mix(c, c * uShadowTint + vec3(0.02, 0.0, 0.05), pow(1.0 - L, 2.0) * uShadowAmount);
  c = mix(c, c * vec3(1.08, 0.98, 0.80) + vec3(0.06, 0.04, 0.0), smoothstep(0.45, 1.0, L) * uWarmth);
  c += (vec3(h1(vec2(r, 1.0)), h1(vec2(r, 2.0)), h1(vec2(r, 3.0))) - 0.5) * uJitter;
  return max(c, 0.0);
}

// thin underpainting on a warm canvas
vec3 brushGround(vec3 base) { return mix(brushPalette(base, 0.5) * 0.95, vec3(0.78, 0.70, 0.58), 0.12); }

// An ellipse with a random angle around the plane's direction and a ragged bristle edge.
// The stroke takes its colour halfway between the pixel and its centre line.
float brushMark(vec2 d, float C, vec2 k, float ang, out vec2 at, out float v) {
  ang += (h1(k + 5.3) - 0.5) * 1.6;
  vec2 dir = vec2(cos(ang), sin(ang));
  float u = dot(d, dir), w = dot(d, vec2(-dir.y, dir.x)), cap = uReach / 1.0607;
  float len = C * min(uLength * (1.05 + 0.8 * h1(k + 9.1)), cap);
  float wid = C * min(uWidth * (0.40 + 0.18 * h1(k + 2.9)), cap);
  at = dir * u * 0.5;
  v = w / max(wid, 1e-4);
  return (u * u) / (len * len) + (w * w) / (wid * wid)
       + (h1(floor(vec2(u / C * 9.0, w / C * 25.0)) + k) - 0.5) * 0.25;   // ragged bristle edge
}

vec3 brushShade(vec3 col, float e, float v, vec2 k) {
  float ridge = 1.0 + 0.10 * (1.0 - e) - 0.10 * smoothstep(0.7, 1.0, e);   // impasto ridge
  float bristle = 0.94 + 0.06 * sin(v * 18.0 + h1(k) * 6.28);              // bristle streaks
  return col * ridge * bristle;
}

// canvas weave
vec3 brushFinish(vec3 col, vec2 px) {
  return col * (1.0 + uCanvas * sin(px.x * 1.9) * sin(px.y * 1.9) + (h1(px) - 0.5) * 0.04);
}`;

// Longest stroke reach in cells: half-length up to 1.85 x strokeLength (half-width 0.58 x strokeWidth),
// x 1.0607 for the ragged edge.
const reach = pass => 1.0607 * Math.max(1.85 * pass.strokeLength, 0.58 * pass.strokeWidth);
// Up to strokeLength 1 the 4 x 4 search is kept for speed (the longest tips can be clipped).
// Longer strokes test more cells, up to 7 x 7; beyond that, the pass caps the reach to fit.
const search = (pass, r) => (pass.strokeLength <= 1 ? 4 : Math.max(4, Math.ceil(2 * r + 1)));

/** Oil strokes with the palette habits of late-1800s impressionism. The default brush. It has no options of its own. */
export function impressionist() {
  return { name: 'impressionist', glsl, uniforms: {}, reach, search };
}
