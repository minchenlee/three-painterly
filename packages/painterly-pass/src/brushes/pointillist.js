// The pointillist brush: small round dabs of pigment that mix in the eye.
// See impressionist.js for the brush interface.

// Divided colour, shared by the dabs on surfaces and the dabs in the air.
const divided = /* glsl */`
uniform float uPurity;      // 0 = the scene's own colour, 1 = pure pigment hues
uniform float uHueSpread;   // how far dabs stray to neighbouring hues, in turns of the colour wheel
uniform float uPigments;    // number of pigment hues on the wheel

vec3 hueRgb(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// x = hue (0..1), y = saturation
vec2 hueSat(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  if (d < 1e-5) return vec2(0.0);
  float h = mx == c.r ? (c.g - c.b) / d : (mx == c.g ? 2.0 + (c.b - c.r) / d : 4.0 + (c.r - c.g) / d);
  return vec2(fract(h / 6.0), d / mx);
}
// The value a dab is matched on: halfway between luma and the strongest channel.
// Luma alone would let a blue dab stay at full strength where a yellow one is dimmed.
float tone(vec3 c) { return 0.5 * (lum(c) + max(c.r, max(c.g, c.b))); }

// Divided colour. Each dab is one pigment from a wheel of uPigments hues, mixed only with white:
// - the hue is the local colour's, spread to its neighbours on the wheel (greys take any hue);
// - in the dark, some dabs lean to the shadow colour; in the light, some lean to orange;
// - the dab is a little purer than the scene, because the spread of hues greys the mix;
// - white brings the pigment up to the tone of the scene, so the eye mixes the right value.
vec3 dividedColour(vec3 c, float r, float saturation, vec3 shadowTint, float shadowAmount, float warmth, float jitter) {
  float r1 = h1(vec2(r, 1.0)), r2 = h1(vec2(r, 2.0)), r3 = h1(vec2(r, 3.0)), r4 = h1(vec2(r, 4.0));
  float L = lum(c);
  c = clamp(mix(vec3(L), c, saturation), 0.0, 1.0);
  vec2 hs = hueSat(c);
  float grey = 1.0 - smoothstep(0.02, 0.15, hs.y);
  float hue = hs.x + (r1 - 0.5) * 2.0 * mix(uHueSpread, 0.5, grey);
  hue = mix(hue, floor(hue * uPigments + r3) / uPigments, uPurity);   // snap to a pigment; the random threshold dithers
  float sat = min(mix(hs.y * (1.0 + 0.4 * uPurity), hs.y + 0.3 * uPurity, grey), 1.0);
  vec3 pig = mix(vec3(1.0), hueRgb(hue), sat);
  float dark = (1.0 - L) * (1.0 - L);
  if (r2 < dark * dark * shadowAmount) pig = mix(pig, mix(vec3(1.0), hueRgb(hueSat(shadowTint).x), 0.85), 0.6 * uPurity);
  else if (r2 > 1.0 - smoothstep(0.45, 1.0, L) * warmth * 0.4) pig = mix(pig, vec3(1.0, 0.62, 0.15), 0.6 * uPurity);
  float Tp = tone(pig), Tt = tone(c);
  Tt += 0.06 * uPurity * (1.0 - Tt) * (1.0 - Tt);                     // no black on this palette: the darks are deep colour
  Tt = clamp(Tt * (1.0 + (r4 - 0.5) * 4.0 * jitter), 0.0, 1.0);
  return Tt > Tp ? mix(pig, vec3(1.0), (Tt - Tp) / max(1.0 - Tp, 1e-4)) : pig * (Tt / max(Tp, 1e-4));
}`;

const glsl = divided + /* glsl */`
vec3 brushPalette(vec3 c, float r) { return dividedColour(c, r, uSaturation, uShadowTint, uShadowAmount, uWarmth, uJitter); }

// a pale lay-in of the local colour on a cream ground
vec3 brushGround(vec3 base) {
  float L = lum(base);
  return mix(mix(vec3(L), base, uSaturation), vec3(0.93, 0.90, 0.82), 0.04 + 0.22 * L);
}

// A round dab, a little oval, with no common direction and an uneven edge.
float brushMark(vec2 d, float C, vec2 k, float ang, out vec2 at, out float v) {
  ang = h1(k + 5.3) * 6.2832;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 p = vec2(dot(d, dir), dot(d, vec2(-dir.y, dir.x))) / C;
  float rad = min(uWidth * (0.56 + 0.14 * h1(k + 2.9)), uReach / 1.3);
  p /= rad * vec2(1.0 + 0.22 * h1(k + 9.1), 1.0);
  at = vec2(0.0);
  v = 0.0;
  return dot(p, p) + (h1(floor(p * 5.0) + k) - 0.5) * 0.16;
}

// thick in the middle, thin at the rim
vec3 brushShade(vec3 col, float e, float v, vec2 k) { return col * (1.05 - 0.11 * smoothstep(0.45, 1.0, e)); }

// canvas weave
vec3 brushFinish(vec3 col, vec2 px) {
  return col * (1.0 + uCanvas * sin(px.x * 1.9) * sin(px.y * 1.9) + (h1(px) - 0.5) * 0.03);
}`;

// The same dab for BakedDebris pieces in the air (createStrokes): the interface is oilStroke in baked-debris/shaders.
// One piece is one dab of one pigment, so a wall that blows apart comes apart into its pigments.
// The palette values are fixed, like those of the oil stroke; uJitter is the jitter option of createStrokes.
// Pieces carry their unlit colour, which is paler than the lit scene: the palette takes it a little darker and purer.
const flying = {
  vertex: /* glsl */`
float strokeStretch(float spd) { return 1.0 + min(spd * 0.0006, 0.35); }   // round; a fast dab is a little longer`,
  fragment: divided + /* glsl */`
flat varying float vPiece;   // exact per piece: one dab is one pigment, so the choice must not change inside the dab
vec3 strokePalette(vec3 c, float r) { return dividedColour(c * 0.9, vPiece * 100.0, 1.5, vec3(0.78, 0.80, 1.25), 0.55, 0.6, uJitter); }
bool strokeMark(vec2 q, float seed, out float w) {
  w = dot(q, q) / 0.6 + (h1(floor(q * 5.0) + vPiece * 37.0) - 0.5) * 0.16;   // the uneven edge of the surface dab
  return w < 1.0;
}
vec3 strokeShade(vec3 col, vec2 q, float seed, float w) { return col * (1.05 - 0.11 * smoothstep(0.45, 1.0, w)); }`,
};

// Largest dab: radius 0.70 x strokeWidth cells, x 1.22 for the oval, x 1.06 for the uneven edge (about 1.3 in all).
const reach = pass => 0.70 * 1.3 * pass.strokeWidth;

const defaults = { purity: 0.8, hueSpread: 0.07, pigments: 12 };

/**
 * Round dabs of divided colour, after Georges Seurat's and Paul Signac's method.
 * It reads these PainterlyPass options: strokeSize (dab spacing), strokeWidth (dab size), saturation,
 * shadowTint (its hue is the pigment of the shadow dabs), shadowAmount (their share in the shade),
 * warmth (share of orange dabs in the light), colorJitter (value difference between dabs), contrast, canvas.
 * Its own options are live in brush.uniforms: uPurity, uHueSpread, uPigments.
 * BakedDebris strokes made with this brush are round dabs of the same pigments.
 */
export function pointillist(options = {}) {
  for (const k in options) if (!Object.prototype.hasOwnProperty.call(defaults, k)) console.warn(`pointillist: unknown option "${k}" ignored`);
  const o = { ...defaults, ...options };
  return {
    name: 'pointillist', glsl, reach, flying,
    uniforms: { uPurity: { value: o.purity }, uHueSpread: { value: o.hueSpread }, uPigments: { value: o.pigments } },
  };
}
