// GLSL for PainterlyPass. Plain strings so they can be read and edited without a build step.

export const quadVertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Repaints the scene texture with brush strokes. Strokes are laid on each surface's own plane
// (found from the depth buffer), so they stay on the object when the camera moves.
export const paintFragment = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uRes;            // paint target size in pixels
uniform float uS;             // stroke size in paint-target pixels
uniform float uAmount;        // 0 = original, 1 = fully painted
uniform float uExposure;
uniform int uToneMap;         // 1 = ACES fit, 0 = none (input already display-referred)
uniform float uSaturation;
uniform vec3 uShadowTint;
uniform float uShadowAmount;
uniform float uWarmth;
uniform float uJitter;
uniform float uCanvas;
uniform float uLength;
uniform float uWidth;
uniform float uContrast;
uniform bool uSky;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uPixAng;        // radians per paint-target pixel at the screen centre
varying vec2 vUv;

float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Krzysztof Narkowicz's ACES fit
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

vec3 scr(vec2 uv) {
  vec3 c = texture2D(tScene, clamp(uv, vec2(0.001), vec2(0.999))).rgb * uExposure;
  return uToneMap == 1 ? aces(c) : c;
}
vec3 worldAt(vec2 px) {
  vec2 uv = px / uRes;
  float d = texture2D(tDepth, uv).x;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v /= v.w;
  return (uCamWorld * v).xyz;
}
vec3 colAtWorld(vec3 w) { vec4 c = uViewProj * vec4(w, 1.0); return scr(c.xy / c.w * 0.5 + 0.5); }

// The palette: livelier colour, cool shadows that keep their value, warm light,
// and a little unmixed colour in every stroke.
vec3 palette(vec3 c, float r) {
  float L = lum(c);
  c = mix(vec3(L), c, uSaturation);
  c = mix(c, c * uShadowTint + vec3(0.02, 0.0, 0.05), pow(1.0 - L, 2.0) * uShadowAmount);
  c = mix(c, c * vec3(1.08, 0.98, 0.80) + vec3(0.06, 0.04, 0.0), smoothstep(0.45, 1.0, L) * uWarmth);
  c += (vec3(h1(vec2(r, 1.0)), h1(vec2(r, 2.0)), h1(vec2(r, 3.0))) - 0.5) * uJitter;
  return max(c, 0.0);
}

// axis 0/1/2 = surface facing x/y/z; axis 3 = sky, where q holds (azimuth, elevation)
vec3 planeToWorld(vec2 q, int axis, float a) {
  if (axis == 0) return vec3(a, q.y, q.x);
  if (axis == 1) return vec3(q.x, a, q.y);
  if (axis == 2) return vec3(q.x, q.y, a);
  return uCamPos + vec3(sin(q.x) * cos(q.y), sin(q.y), -cos(q.x) * cos(q.y)) * 1.0e4;
}

// Strokes on one plane at cell size C (world units, or radians for the sky).
// Each cell holds one stroke; the 4x4 cells around the pixel are tested and the topmost wins.
// Only the winning stroke is coloured, after the loop: one scene lookup per plane instead of one per hit.
vec4 paintPlane(vec2 q, float C, int axis, float a, float seed, float baseAng, vec3 under) {
  vec2 cell = floor(q / C - 0.5);
  float bestZ = -1.0, bestE = 0.0, bestV = 0.0;
  vec2 bestK = vec2(0.0), bestQ = vec2(0.0);
  for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 k = c + vec2(seed, C * 7.13);
    float z = h1(k + 31.7);
    if (z <= bestZ) continue;
    vec2 ctr = (c + h2(k)) * C;
    float ang = baseAng + (h1(k + 5.3) - 0.5) * 1.6;
    vec2 dir = vec2(cos(ang), sin(ang)), d = q - ctr;
    float u = dot(d, dir), v = dot(d, vec2(-dir.y, dir.x));
    float len = C * uLength * (1.05 + 0.8 * h1(k + 9.1));
    float wid = C * uWidth * (0.40 + 0.18 * h1(k + 2.9));
    float e = (u * u) / (len * len) + (v * v) / (wid * wid)
            + (h1(floor(vec2(u / C * 9.0, v / C * 25.0)) + k) - 0.5) * 0.25;   // ragged bristle edge
    if (e < 1.0) { bestZ = z; bestE = e; bestK = k; bestQ = ctr + dir * u * 0.5; bestV = v / max(wid, 1e-4); }
  }
  if (bestZ < 0.0) return vec4(under, bestZ);
  vec3 col = palette(colAtWorld(planeToWorld(bestQ, axis, a)), h1(bestK + 7.7) * 100.0);
  float ridge = 1.0 + 0.10 * (1.0 - bestE) - 0.10 * smoothstep(0.7, 1.0, bestE);   // impasto ridge
  float bristle = 0.94 + 0.06 * sin(bestV * 18.0 + h1(bestK) * 6.28);               // bristle streaks
  return vec4(col * ridge * bristle, bestZ);
}

void main() {
  vec2 px = gl_FragCoord.xy, uv = px / uRes;
  vec3 base = scr(uv);
  vec3 under = mix(palette(base, 0.5) * 0.95, vec3(0.78, 0.70, 0.58), 0.12);   // thin underpainting on a warm canvas
  float depth = texture2D(tDepth, uv).x;
  vec3 W = worldAt(px);
  vec3 outc;
  if (depth >= 1.0) {   // cleared depth is exactly 1.0; a threshold below it would turn distant objects into sky
    if (!uSky) { gl_FragColor = vec4(base, 1.0); return; }
    vec3 dir = normalize(W - uCamPos);   // sky: strokes fixed to directions, so they turn with the view
    vec2 q = vec2(atan(dir.x, -dir.z), asin(clamp(dir.y, -1.0, 1.0)));
    outc = paintPlane(q, uS * uPixAng, 3, 0.0, 91.0, 0.15, under).rgb;
  } else {
    vec3 N = cross(worldAt(px + vec2(1.0, 0.0)) - W, worldAt(px + vec2(0.0, 1.0)) - W);
    vec3 an = abs(N);
    int axis = an.x > an.y && an.x > an.z ? 0 : (an.y > an.z ? 1 : 2);
    float a = axis == 0 ? W.x : (axis == 1 ? W.y : W.z);
    vec2 q = axis == 0 ? W.zy : (axis == 1 ? W.xz : W.xy);
    float seed = floor(a * 4.0 + 0.5) * 3.17 + float(axis) * 11.3;
    float baseAng = axis == 1 ? 0.3 : 1.35;   // walls: mostly upright strokes; floors: lying down
    // keep strokes about uS pixels on screen: pick two power-of-two cell sizes and cross-fade
    float ideal = max(uS * length(W - uCamPos) * uPixAng, 1e-4);
    float lv = log2(ideal), k0 = floor(lv), f = smoothstep(0.35, 0.65, lv - k0);
    vec4 s0 = paintPlane(q, exp2(k0), axis, a, seed, baseAng, under);
    vec4 s1 = f > 0.01 ? paintPlane(q, exp2(k0 + 1.0), axis, a, seed + 5.0, baseAng, under) : s0;
    outc = mix(s0.rgb, s1.rgb, f);
  }
  outc = (outc - 0.45) * uContrast + 0.45;
  outc *= 1.0 + uCanvas * sin(px.x * 1.9) * sin(px.y * 1.9) + (h1(px) - 0.5) * 0.04;   // canvas weave stays on the canvas
  gl_FragColor = vec4(clamp(mix(base, outc, uAmount), 0.0, 1.0), 1.0);
}`;

// Upscales the painting to the output and converts to the output colour space.
export const copyFragment = /* glsl */`
uniform sampler2D tPaint;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tPaint, vUv);
  #include <colorspace_fragment>
}`;
