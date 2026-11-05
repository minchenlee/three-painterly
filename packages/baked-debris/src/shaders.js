// GLSL shared by the cube material, its shadow material and the brush-stroke material.
// Every piece's state is a pure function of uTime, so any moment can be shown directly.

export const debrisState = /* glsl */`
attribute float aStart;   // launch time (1e9 = never moves)
attribute float aSize;
attribute vec3 aAxis;     // spin axis
attribute vec3 aColor;    // linear colour
attribute float aKind;    // 0 = piece, 1 = fragment of a secondary blast
attribute float aSplit;   // piece: local time it breaks apart (0 = never); fragment: its parent's split time
attribute float aBurst;   // index of the burst that launched it (-1 = none)
attribute float aLife;    // seconds after launch it takes to shrink away (0 = lives forever)
attribute float aRest;    // local time from which the piece rests: no gravity after it (1e9 = never rests)
#define MAX_BURSTS 32
uniform float uBurstShift[MAX_BURSTS];   // per-burst time offset, so bursts can be retimed without a new bake
uniform float uTime;
uniform float uWarp;      // 1 = bullet time
uniform float uBurstT;    // bullet time: seconds at full speed
uniform float uHover;     // bullet time: clock speed afterwards
uniform float uGravity;
uniform float uSizeScale;
float dbOffset = 0.0;    // lets the stroke shader look a moment back in time
uniform highp sampler2D uSeg;
uniform int uSegW;

vec4 segTexel(int t) { return texelFetch(uSeg, ivec2(t % uSegW, t / uSegW), 0); }
vec3 rotAxis(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }

// seconds of physics time since this piece launched (after the optional time warp)
float debrisLocalTime() {
  float start = aStart;
  if (aBurst > -0.5 && aBurst < float(MAX_BURSTS) - 0.5) start += uBurstShift[int(aBurst + 0.5)];
  float tl = uTime + dbOffset - start;
  if (uWarp > 0.5 && tl > 0.0) tl = uBurstT * (1.0 - exp(-tl / uBurstT)) + uHover * tl;
  return tl;
}
// 0..1 glow right after a secondary blast
float debrisGlow() { if (aKind < 0.5) return 0.0; float ph = debrisLocalTime() - aSplit; return ph > 0.0 ? 1.0 - smoothstep(0.0, 0.18, ph) : 0.0; }

void debrisState(out vec3 P, out float ang, out float sc, out float tl0) {
  tl0 = debrisLocalTime();
  float tl = aKind > 0.5 ? tl0 - aSplit : tl0;
  int base = gl_InstanceID * 12;
  vec4 A = segTexel(base), B = segTexel(base + 1);
  P = A.yzw; ang = 0.0; sc = aSize;
  if (aKind > 0.5 && tl <= 0.0) { sc = 0.0; return; }
  if (tl <= 0.0) return;
  for (int k = 1; k < 6; k++) {
    vec4 A2 = segTexel(base + 2 * k);
    if (A2.x < 0.0 || A2.x > tl) break;
    ang += B.w * (A2.x - A.x); A = A2; B = segTexel(base + 2 * k + 1);
  }
  float dt = tl - A.x;
  P = A.yzw + B.xyz * dt;
  if (tl < aRest) P.y -= 0.5 * uGravity * dt * dt;          // explicit marker: a zero velocity can also start a free fall
  ang += B.w * dt;
  sc = aSize * mix(1.0, uSizeScale, smoothstep(0.0, 0.2, tl));
  if (A.x > 0.0) P.y += (sc - aSize) * 0.5;               // resting pieces keep sitting on the floor when resized
  if (aKind < 0.5 && aSplit > 0.0 && tl >= aSplit) sc = 0.0;   // a piece vanishes when it breaks apart
  if (aLife > 0.0) sc *= max(0.0, 1.0 - tl / aLife);            // crumbles to nothing
}
`;

// String.replace that fails loudly: a missing chunk (e.g. after a three.js update) would otherwise
// leave the pieces at their bake positions without any error.
export function mustReplace(src, find, repl, where) {
  if (!src.includes(find)) throw new Error(`baked-debris (${where}): shader chunk "${find}" not found; this three.js version is not supported`);
  return src.replace(find, repl);
}

// Cube material (MeshStandardMaterial etc.): position, spin, normal and colour come from the bake.
// The hooks of `source` (default: the material itself, as it was) run after the debris patch, so they can add fog,
// lighting tweaks and so on; they see `transformed` and `objectNormal` already moved by the debris code.
// Both hooks are looked up on every call, so later changes to `source` still apply.
export function patchCube(material, hideFlyingU, source = null) {
  const src = source ?? { onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey.bind(material) };
  material.onBeforeCompile = (sh, renderer) => {
    Object.assign(sh.uniforms, material.userData.debrisUniforms, { uHideFlying: hideFlyingU });
    let v = sh.vertexShader;
    v = mustReplace(v, '#include <common>', '#include <common>\n' + debrisState + '\nuniform float uHideFlying;', 'cube');
    v = mustReplace(v, '#include <beginnormal_vertex>', `
        vec3 dbP; float dbA; float dbS; float dbT; debrisState(dbP, dbA, dbS, dbT);
        if (uHideFlying > 0.5 && aStart < 1.0e8 && (aKind > 0.5 || dbT > 0.0)) dbS = 0.0;   // drawn as strokes instead
        vec3 objectNormal = rotAxis(normal, aAxis, dbA);`, 'cube');
    v = mustReplace(v, '#include <begin_vertex>', 'vec3 transformed = rotAxis(position * dbS, aAxis, dbA) + dbP;', 'cube');
    v = mustReplace(v, '#include <color_vertex>', '#if defined(USE_COLOR)\n vColor = mix(aColor, vec3(2.4, 1.3, 0.45), 0.9 * debrisGlow());\n#endif', 'cube');
    sh.vertexShader = v;
    src.onBeforeCompile.call(source ?? material, sh, renderer);
  };
  material.customProgramCacheKey = () => 'baked-debris-cube|' + src.customProgramCacheKey.call(source ?? material);
}

// Shadow materials (MeshDepthMaterial for sun/spot lights, MeshDistanceMaterial for point lights):
// no normal chunk, so the state is computed in begin_vertex.
export function patchDepth(material, hideFlyingU, key = 'baked-debris-depth') {
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, material.userData.debrisUniforms, { uHideFlying: hideFlyingU });
    let v = sh.vertexShader;
    v = mustReplace(v, '#include <common>', '#include <common>\n' + debrisState + '\nuniform float uHideFlying;', key);
    v = mustReplace(v, '#include <begin_vertex>', `
        vec3 dbP; float dbA; float dbS; float dbT; debrisState(dbP, dbA, dbS, dbT);
        if (uHideFlying > 0.5 && aStart < 1.0e8 && (aKind > 0.5 || dbT > 0.0)) dbS = 0.0;
        vec3 transformed = rotAxis(position * dbS, aAxis, dbA) + dbP;`, key);
    sh.vertexShader = v;
  };
  material.customProgramCacheKey = () => key;
}

// Flying pieces as brush strokes: a camera-facing quad stretched along the piece's screen velocity.
export const strokeVertex = /* glsl */`
${debrisState}
uniform vec2 uRes;          // output size in device pixels
uniform float uPixK;        // pixels per world unit at distance 1
uniform float uStrokeScale;
uniform float uMaxWidth;    // device pixels
varying vec2 vQ; varying vec3 vCol; varying float vSeed; varying float vGlow;
void main() {
  vec3 P0; float a0; float s0; float t0; debrisState(P0, a0, s0, t0);
  bool show = s0 > 0.0 && aStart < 1.0e8 && (aKind > 0.5 || t0 > 0.0);
  dbOffset = -0.03; vec3 P1; float a1; float s1; float t1; debrisState(P1, a1, s1, t1); dbOffset = 0.0;
  vec4 c0 = projectionMatrix * viewMatrix * vec4(P0, 1.0), c1 = projectionMatrix * viewMatrix * vec4(P1, 1.0);
  if (!show || c0.w <= 0.1 || c1.w <= 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 dv = (c0.xy / c0.w - c1.xy / c1.w) * 0.5 * uRes;
  float spd = length(dv) / 0.03;                                     // pixels per second
  vSeed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
  vec2 dir = spd > 6.0 ? dv / length(dv) : vec2(cos(vSeed * 6.283), sin(vSeed * 6.283));
  float tw = 0.35 * sin(a0);                                        // a gentle curl instead of 3D tumbling
  dir = vec2(dir.x * cos(tw) - dir.y * sin(tw), dir.x * sin(tw) + dir.y * cos(tw));
  float wid = clamp(s0 * uPixK / c0.w * uStrokeScale, 1.5, uMaxWidth);
  float len = wid * (2.2 + min(spd * 0.004, 5.0));                   // fast = long sweep, hovering = short stroke
  vec2 off = dir * position.x * len + vec2(-dir.y, dir.x) * position.y * wid;
  gl_Position = c0 + vec4(off / (0.5 * uRes) * c0.w, 0.0, 0.0);
  vQ = position.xy * 2.0; vCol = aColor; vGlow = debrisGlow();
}`;

export const strokeFragment = /* glsl */`
uniform sampler2D tDepth;   // scene depth from PainterlyPass (any resolution)
uniform bool uUseDepth;
uniform vec2 uRes;
uniform float uBright;
uniform vec3 uTint;
uniform float uJitter;
varying vec2 vQ; varying vec3 vCol; varying float vSeed; varying float vGlow;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 palette(vec3 c, float r) {
  float L = lum(c);
  c = mix(vec3(L), c, 1.35);
  c = mix(c, c * vec3(0.78, 0.80, 1.25) + vec3(0.02, 0.0, 0.05), pow(1.0 - L, 2.0) * 0.55);
  c = mix(c, c * vec3(1.08, 0.98, 0.80) + vec3(0.06, 0.04, 0.0), smoothstep(0.45, 1.0, L) * 0.6);
  c += (vec3(h1(vec2(r, 1.0)), h1(vec2(r, 2.0)), h1(vec2(r, 3.0))) - 0.5) * uJitter;   // broken colour
  return max(c, 0.0);
}
void main() {
  float u = vQ.x, v = vQ.y;                     // u: along the stroke (+ = direction of travel), v: across
  float rag = (h1(vec2(floor(v * 6.0), vSeed * 37.0)) - 0.5) * 0.35;
  float hw = sqrt(max(0.0, 1.0 - u * u)) * (0.55 + 0.45 * (u * 0.5 + 0.5));   // full head, thin tail
  if (abs(v) > hw * (0.82 + 0.18 * h1(vec2(floor(u * 14.0), vSeed * 7.0))) || u < -0.85 + rag || u > 0.95 + rag * 0.3) discard;
  if (h1(vec2(floor(u * 10.0), floor(v * 6.0) + vSeed * 13.0)) < 0.06 && u < 0.4) discard;   // dry-brush gaps
  if (uUseDepth && gl_FragCoord.z > texture2D(tDepth, gl_FragCoord.xy / uRes).x + 1e-5) discard;   // behind the scene
  vec3 col = palette(vCol * uBright * uTint, vSeed * 100.0);
  col = mix(col, vec3(2.4, 1.3, 0.45), 0.9 * vGlow);
  col *= (1.0 + 0.14 * (1.0 - abs(v) / max(hw, 1e-3))) * (0.9 + 0.1 * sin(v * 24.0 + vSeed * 6.283));
  col *= (0.92 + 0.08 * smoothstep(-0.9, 0.2, u)) * (0.88 + 0.22 * vSeed);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  #include <colorspace_fragment>
}`;
