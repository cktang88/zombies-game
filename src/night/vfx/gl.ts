// The WebGL2 effects layer (docs/research/10-vfx.md §6). One offscreen WebGL2 canvas, shared by every Vfx
// (browsers cap live contexts), fed straight from the SoA particle pool into preallocated instance buffers:
//
//   drawNormal  → smoke / dust / mist and fire / flame tongues are splatted as noise-lumped blobs into two
//                 half-resolution fields ("2D metaballs", after siege-game src/fx.ts); the smoke field is then
//                 thresholded and cel-shaded (two tones + a rim from its density gradient, two opacity steps)
//                 and drawn back into the 2D scene where the Canvas2D smoke layer used to go.
//   drawAdd     → (a) heat haze / shockwave refraction: if anything distorts this frame, the 2D canvas is
//                 uploaded once and drawn back displaced inside the sources' scissor box (source-over);
//                 (b) the additive layer: every sprite the Canvas2D path would blit (flashes, tracers, sparks,
//                 embers, glows, rings) as one instanced draw from an atlas of the same procedural sprites,
//                 plus the heat field thresholded into the banded fire ramp, plus a cheap bloom
//                 (bright-pass at quarter res, separable 5-tap blur via 3 linear taps), drawn back 'lighter'.
//
// Fallback: getContext failure, context loss, quality below High, or the governor → the Canvas2D paths.
import { Pool, SMOKE, DUST, MIST, FIRE, FLAME, F_GROUNDED } from './pool';
import type { Sprites } from './sprites';

/** GL effect level: 3 = everything, 2 = bloom off, 1 = haze off too, 0 = GL off (the governor walks down this). */
export type GLLevel = 0 | 1 | 2 | 3;
const LEVEL_NAME = ['GL off (Canvas2D fallback)', 'haze off', 'bloom off', 'full'];

const MAX_SPRITES = 6144; // instances per flush (a flush past this just draws and continues)
const SPR_F = 12; // floats per sprite instance
const BLOB_F = 12; // floats per field blob instance
const MAX_HAZE = 16;

const easeOut = (u: number) => 1 - (1 - u) * (1 - u) * (1 - u);
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ------------------------------------------------------------------ shaders
const NOISE = `
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<3;i++){ s += a*noise(p); p = p * 2.07 + 17.3; a *= .5; } return s / 0.875; }
`;
// canvas px (y down) → clip
const TO_CLIP = `vec4 toClip(vec2 p){ return vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }`;

const SPRITE_VS = `#version 300 es
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 iOA; // origin xy, axis-u xy (canvas px)
layout(location=2) in vec4 iVB; // axis-v xy, alpha, -
layout(location=3) in vec4 iUV; // atlas u0 v0 u1 v1
uniform vec2 uRes;
out vec2 vUv; out float vA;
${TO_CLIP}
void main(){ vec2 p = iOA.xy + aQ.x * iOA.zw + aQ.y * iVB.xy; vUv = mix(iUV.xy, iUV.zw, aQ); vA = iVB.z; gl_Position = toClip(p); }`;
const SPRITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas; in vec2 vUv; in float vA; out vec4 o;
void main(){ o = texture(uAtlas, vUv) * vA; }`;

// field blobs: a quad of ±1 around (x, y) with half-sizes (sx, sy); iC = (seed, age, lean, kind)
const BLOB_VS = `#version 300 es
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 iA; // x y sx sy
layout(location=2) in vec4 iB; // r g b a (smoke: tone, alpha; heat: heat in .a)
layout(location=3) in vec4 iC; // seed u lean kind
uniform vec2 uRes;
out vec2 vQ; out vec4 vCol; out vec4 vC;
${TO_CLIP}
void main(){
  vQ = aQ * 2.0 - 1.0; vCol = iB; vC = iC;
  vec2 off = vec2(vQ.x * iA.z, vQ.y * iA.w);
  if (iC.w > 0.5) off.x += iC.z * (1.0 - vQ.y) * 0.5 * iA.w; // tongue: the tip leans
  else { float a = iC.x * 6.2832 + iC.y * 2.0 * (fract(iC.x * 7.13) - 0.5); off = mat2(cos(a), sin(a), -sin(a), cos(a)) * off; }
  gl_Position = toClip(iA.xy + off);
}`;
const SMOKE_FS = `#version 300 es
precision highp float;
in vec2 vQ; in vec4 vCol; in vec4 vC; out vec4 o;
${NOISE}
void main(){
  float r = length(vQ);
  if (r > 1.0) discard;
  float s = vC.x, t = vC.y;
  float n = fbm(vQ * 1.5 + vec2(s * 23.0 + t * 0.9, s * 7.0 - t * 0.7));
  float m = clamp((1.0 - r) * 1.7 - (n - 0.5) * (0.35 + 0.7 * r) - t * t * (n + 0.2) * 0.9, 0.0, 1.0);
  float d = m * vCol.a;
  o = vec4(vCol.rgb * d, d);
}`;
const HEAT_FS = `#version 300 es
precision highp float;
uniform float uTime;
in vec2 vQ; in vec4 vCol; in vec4 vC; out vec4 o;
${NOISE}
void main(){
  vec2 q = vQ;
  // teardrop, narrower toward the top (q.y < 0 is up): a lone tongue still reads as flame, not a disc
  float up = clamp(-q.y, 0.0, 1.0);
  float taper = 1.0 + (vC.w > 0.5 ? 1.3 : 0.6) * up;
  float r = length(vec2(q.x * taper, q.y * (q.y > 0.0 ? 1.25 : 1.0)));
  float n = noise(q * 1.8 + vec2(vC.x * 37.0, vC.x * 11.0 + uTime * 3.0));
  float m = clamp(1.0 - r - (n - 0.5) * 0.6, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  o = vec4(m * vCol.a, 0.0, 0.0, 1.0);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aQ;
out vec2 vUv;
void main(){ vUv = aQ; gl_Position = vec4(aQ * 2.0 - 1.0, 0.0, 1.0); }`;
// p = canvas px (y down) of this fragment, from vUv (v = 1 at the top)
const PX = `vec2 px(){ return vec2(vUv.x, 1.0 - vUv.y) * uRes; }`;

const FIRE_FS = `#version 300 es
precision highp float;
uniform sampler2D uHeat; uniform float uTime; uniform float uWind; uniform vec2 uRes;
in vec2 vUv; out vec4 o;
${NOISE}
${PX}
void main(){
  float h = texture(uHeat, vUv).r;
  if (h < 0.04) discard;
  vec2 w = px() * 0.028;
  float t = uTime;
  // licks: noise stretched vertically, scrolled upward, sheared by the wind
  vec2 nw = vec2((w.x - uWind * 0.01 * (0.05 * w.y + 0.3 * t)) * 1.7, w.y * 0.75 + t * 2.3);
  float n = fbm(nw);
  float n2 = noise(w * vec2(4.0, 2.5) + vec2(0.0, t * 5.5));
  float hc = 1.0 - exp(-h * 1.1);
  float e = hc - (n - 0.5) * 0.55 - (n2 - 0.5) * (0.14 + 0.28 * hc);
  float aa = max(fwidth(e) * 0.7, 1e-3);
  #define BAND(th) smoothstep(th - aa, th + aa, e)
  float a = BAND(0.11);
  if (a <= 0.0) discard;
  // the same temperature ramp as the Canvas2D fire blobs: deep-red rim, red, orange, yellow, pale core
  vec3 col = vec3(0.42, 0.07, 0.03);
  col = mix(col, vec3(0.80, 0.18, 0.05), BAND(0.18));
  col = mix(col, vec3(1.00, 0.46, 0.10), BAND(0.29));
  col = mix(col, vec3(1.00, 0.70, 0.20), BAND(0.5));
  col = mix(col, vec3(0.98, 0.88, 0.58), BAND(0.8));
  col *= a * 0.95;
  o = vec4(col, max(col.r, max(col.g, col.b)));
}`;

const SMOKECOMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSmoke; uniform sampler2D uHeat; uniform vec2 uTexel; uniform float uTime; uniform float uWind; uniform vec2 uRes;
in vec2 vUv; out vec4 o;
${NOISE}
${PX}
void main(){
  vec4 s = texture(uSmoke, vUv);
  float d = s.a;
  if (d < 0.02) discard;
  vec3 tone = s.rgb / d;
  vec2 w = px() * 0.02;
  float n = fbm(w + vec2(-uWind * 0.01 * uTime, uTime * 0.35));
  float de = d * (0.75 + 0.5 * n) - 0.03;
  float aa = max(fwidth(de) * 0.8, 1e-3);
  float a = smoothstep(0.12 - aa, 0.12 + aa, de);
  if (a <= 0.0) discard;
  // two tones (three with the rim) from the density gradient, lit from the top-left
  vec2 ox = vec2(uTexel.x * 3.0, 0.0), oy = vec2(0.0, uTexel.y * 3.0);
  // texture v runs up the canvas, so canvas-down is -v
  float gx = texture(uSmoke, vUv + ox).a - texture(uSmoke, vUv - ox).a;
  float gy = texture(uSmoke, vUv - oy).a - texture(uSmoke, vUv + oy).a;
  vec2 g = vec2(gx, gy);
  float sh = dot(-g, normalize(vec2(-0.55, -0.85))) / (length(g) + 0.06);
  tone = sh > 0.3 ? tone * 1.18 + 0.06 : sh < -0.3 ? tone * 0.68 : tone * 0.94;
  tone *= mix(1.0, 0.88, smoothstep(0.5, 1.4, d));
  // silhouette band: a darker edge, the cel outline
  tone *= mix(0.78, 1.0, smoothstep(0.12 + aa, 0.17 + aa, de));
  // fire under the smoke lights its belly
  float hg = texture(uHeat, vUv - oy * 2.0).r + 0.5 * texture(uHeat, vUv).r;
  tone += vec3(0.95, 0.38, 0.08) * step(0.12, hg) * min(1.0, hg) * 0.45;
  tone = min(tone, vec3(0.92));
  // two opacity steps: wisps see-through, the body solid
  float op = mix(0.5, 0.88, smoothstep(0.22 - aa, 0.22 + aa, de));
  float A = a * op;
  o = vec4(tone * A, A);
}`;

const BRIGHT_FS = `#version 300 es
precision mediump float;
uniform sampler2D uSrc; uniform vec2 uTexel; in vec2 vUv; out vec4 o;
void main(){
  // 4 bilinear taps = a 4x4 box downsample, then a soft-knee bright pass
  vec3 c = (texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
          + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(0.5, 1.0, l), 1.0);
}`;
const BLUR_FS = `#version 300 es
precision mediump float;
uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUv; out vec4 o;
// 5-tap gaussian folded into 3 linear taps
void main(){ o = vec4(texture(uSrc, vUv).rgb * 0.294 + (texture(uSrc, vUv + uDir * 1.333).rgb + texture(uSrc, vUv - uDir * 1.333).rgb) * 0.353, 1.0); }`;
const FINAL_FS = `#version 300 es
precision mediump float;
uniform sampler2D uAdd; uniform sampler2D uBloom; uniform float uBloomK; in vec2 vUv; out vec4 o;
void main(){
  vec3 c = texture(uAdd, vUv).rgb + texture(uBloom, vUv).rgb * uBloomK;
  c = min(c, vec3(1.0));
  // premultiplied with alpha = the brightest channel: valid for the 2D canvas, and 'lighter' adds the colour
  o = vec4(c, max(c.r, max(c.g, c.b)));
}`;
const HAZE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uRes; uniform float uTime;
uniform vec4 uSrcA[${MAX_HAZE}]; // x y r strength
uniform vec4 uSrcB[${MAX_HAZE}]; // kind u - -
uniform int uN;
in vec2 vUv; out vec4 o;
${NOISE}
${PX}
void main(){
  vec2 p = px();
  vec2 off = vec2(0.0);
  float edge = 0.0;
  for (int i = 0; i < ${MAX_HAZE}; i++) {
    if (i >= uN) break;
    vec4 A = uSrcA[i]; vec4 B = uSrcB[i];
    vec2 dv = p - A.xy;
    float d = length(dv);
    vec2 dir = d > 0.001 ? dv / d : vec2(0.0);
    if (B.x < 0.5) {
      // shockwave: a lens ring at radius r, pushing out on its leading edge and in behind it
      float w = max(8.0, A.z * 0.22);
      float x = (d - A.z) / w;
      float k = x * exp(-x * x * 2.0);
      off += dir * k * A.w;
      edge += exp(-x * x * 3.0) * A.w * 0.04 * sign(-x);
    } else if (B.x < 1.5) {
      // heat over a fire: rising, wavering shimmer in a column above (x, y), half-width r
      float fx = 1.0 - smoothstep(0.5, 1.0, abs(dv.x) / A.z);
      float fy = smoothstep(-A.z * 2.6, -A.z * 0.2, dv.y) * (1.0 - smoothstep(-A.z * 0.1, A.z * 0.25, dv.y));
      float f = fx * fy;
      if (f > 0.0) {
        float n = noise(vec2(p.x * 0.05, p.y * 0.035 + uTime * 3.2)) - 0.5;
        float n2 = noise(vec2(p.x * 0.11 + 7.0, p.y * 0.08 + uTime * 5.0)) - 0.5;
        off += vec2(n * 1.6 + n2, n2 * 0.6 - 0.3) * A.w * f;
      }
    } else {
      // muzzle blast: a short radial puff of hot gas
      float f = exp(-d * d / (A.z * A.z));
      off += dir * f * A.w * (d / A.z);
    }
  }
  float m = length(off);
  if (m < 0.06) discard;
  // the scene is uploaded unflipped: texture v = canvas y / H
  vec4 s = texture(uScene, (p + off) / uRes);
  s.rgb *= 1.0 + clamp(edge, -0.12, 0.12);
  float a = clamp(m * 1.5, 0.0, 1.0);
  o = s * a;
}`;

// ------------------------------------------------------------------ the layer
interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class VfxGL {
  cv: HTMLCanvasElement;
  gl: WebGL2RenderingContext | null = null;
  /** set when getContext failed or a shader did not compile: Canvas2D for good */
  broken = false;
  lost = false;
  level: GLLevel = 3;
  /** governor off (tests, fxlab "pin") */
  pinned = false;
  /** budget the governor holds the frame to (ms); default ≈ 45 fps */
  budgetMs = 1000 / 45;
  /** CPU ms spent on GL work last frame, and what happened */
  ms = 0;
  stats = { sprites: 0, smoke: 0, heat: 0, haze: 0, uploads: 0 };
  W = 0; H = 0;
  private progs: Record<string, Prog> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private blobVao: WebGLVertexArrayObject | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private sprBuf: WebGLBuffer | null = null;
  private blobBuf: WebGLBuffer | null = null;
  private atlas: WebGLTexture | null = null;
  private sceneTex: WebGLTexture | null = null;
  private atlasFor: Sprites | null = null;
  private uv = new Map<object, Float32Array>();
  private add: Target | null = null;
  private smokeT: Target | null = null;
  private heatT: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;
  private floatFB = false;
  // instance data (preallocated; no per-particle allocation)
  private spr = new Float32Array(MAX_SPRITES * SPR_F);
  private nSpr = 0;
  private smoke: Float32Array;
  private nSmoke = 0;
  private heat: Float32Array;
  private nHeat = 0;
  private hzA = new Float32Array(MAX_HAZE * 4);
  private hzB = new Float32Array(MAX_HAZE * 4);
  private nHz = 0;
  private hzBox = [0, 0, 0, 0];
  private tones: Float32Array;
  private missing = new Set<object>();
  // governor
  private gLast = 0; private gSum = 0; private gN = 0; private gT0 = 0; private gOver = 0;
  log: string[] = [];

  constructor(tones: string[], cap = 2000) {
    this.cv = document.createElement('canvas');
    this.smoke = new Float32Array(cap * BLOB_F);
    this.heat = new Float32Array(cap * BLOB_F);
    this.tones = new Float32Array(tones.length * 3);
    tones.forEach((t, i) => this.tones.set(hex(t), i * 3));
    this.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.gl = null; this.note('context lost: Canvas2D fallback'); }, false);
    this.cv.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); this.note('context restored'); }, false);
    this.init();
  }

  get on() { return !this.broken && !this.lost && !!this.gl && this.level > 0; }
  get bloom() { return this.level >= 3; }
  get haze() { return this.level >= 2; }

  private note(s: string) { this.log.push(s); console.info(`[vfx] ${s}`); }

  private init() {
    const gl = this.cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) { this.broken = true; return; }
    this.gl = gl;
    this.floatFB = !!gl.getExtension('EXT_color_buffer_float');
    this.atlasFor = null; this.uv.clear();
    this.add = this.smokeT = this.heatT = this.bloomA = this.bloomB = null;
    this.W = this.H = 0;
    try {
      this.progs = {
        sprite: this.prog(SPRITE_VS, SPRITE_FS, ['uRes', 'uAtlas']),
        smoke: this.prog(BLOB_VS, SMOKE_FS, ['uRes']),
        heat: this.prog(BLOB_VS, HEAT_FS, ['uRes', 'uTime']),
        fire: this.prog(QUAD_VS, FIRE_FS, ['uHeat', 'uTime', 'uWind', 'uRes']),
        smokeComp: this.prog(QUAD_VS, SMOKECOMP_FS, ['uSmoke', 'uHeat', 'uTexel', 'uTime', 'uWind', 'uRes']),
        bright: this.prog(QUAD_VS, BRIGHT_FS, ['uSrc', 'uTexel']),
        blur: this.prog(QUAD_VS, BLUR_FS, ['uSrc', 'uDir']),
        final: this.prog(QUAD_VS, FINAL_FS, ['uAdd', 'uBloom', 'uBloomK']),
        haze: this.prog(QUAD_VS, HAZE_FS, ['uScene', 'uRes', 'uTime', 'uSrcA', 'uSrcB', 'uN']),
      };
    } catch (e) {
      this.broken = true; this.gl = null;
      console.warn('[vfx] WebGL2 shaders failed; Canvas2D effects', e);
      return;
    }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    // sprites
    this.sprBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.spr.byteLength, gl.DYNAMIC_DRAW);
    this.vao = this.instVao(quad, this.sprBuf, SPR_F, [4, 4, 4]);
    // blobs
    this.blobBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.blobBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.smoke.byteLength, gl.DYNAMIC_DRAW);
    this.blobVao = this.instVao(quad, this.blobBuf, BLOB_F, [4, 4, 4]);
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.sceneTex = this.tex(gl.LINEAR);
  }

  private instVao(quad: WebGLBuffer | null, buf: WebGLBuffer | null, stride: number, sizes: number[]) {
    const gl = this.gl!;
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    let off = 0;
    sizes.forEach((n, i) => {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, n, gl.FLOAT, false, stride * 4, off * 4);
      gl.vertexAttribDivisor(i + 1, 1);
      off += n;
    });
    gl.bindVertexArray(null);
    return v;
  }

  private prog(vs: string, fs: string, names: string[]): Prog {
    const gl = this.gl!;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }

  private tex(filter: number) {
    const gl = this.gl!;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number, float: boolean): Target {
    const gl = this.gl!;
    const tex = this.tex(gl.LINEAR);
    if (float && this.floatFB) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && float) {
      // half-float not renderable after all: plain bytes
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      this.floatFB = false;
      return this.target(w, h, false);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  /** Size the canvas and the render targets to the 2D canvas; build the sprite atlas once per sprite set. */
  private ensure(W: number, H: number, S: Sprites) {
    const gl = this.gl!;
    if (this.W !== W || this.H !== H || !this.add) {
      this.W = W; this.H = H;
      this.cv.width = W; this.cv.height = H;
      const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
      this.add = this.target(W, H, true);
      this.smokeT = this.target(hw, hh, true);
      this.heatT = this.target(hw, hh, true);
      this.bloomA = this.target(Math.ceil(W / 4), Math.ceil(H / 4), true);
      this.bloomB = this.target(Math.ceil(W / 4), Math.ceil(H / 4), true);
    }
    if (this.atlasFor !== S) this.buildAtlas(S, gl);
  }

  /** Shelf-pack every procedural sprite canvas into one texture; uv rects by canvas. */
  private buildAtlas(S: Sprites, gl: WebGL2RenderingContext) {
    const list: HTMLCanvasElement[] = [];
    const seen = new Set<object>();
    const walk = (o: unknown) => {
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      seen.add(o);
      if (o instanceof HTMLCanvasElement) { list.push(o); return; }
      for (const v of Object.values(o as Record<string, unknown>)) walk(v);
    };
    walk(S);
    list.sort((a, b) => b.height - a.height);
    const max = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const AW = Math.min(max, 2048), P = 2;
    let x = 0, y = 0, rowH = 0;
    const pos: [number, number][] = [];
    for (const c of list) {
      if (x + c.width + P > AW) { x = 0; y += rowH + P; rowH = 0; }
      pos.push([x, y]);
      x += c.width + P; rowH = Math.max(rowH, c.height);
    }
    let AH = 1;
    while (AH < y + rowH) AH *= 2;
    AH = Math.min(AH, max);
    const cv = document.createElement('canvas');
    cv.width = AW; cv.height = AH;
    const g = cv.getContext('2d')!;
    this.uv.clear();
    list.forEach((c, i) => {
      const [px, py] = pos[i];
      g.drawImage(c, px, py);
      // half-texel inset so bilinear sampling never reaches the neighbour
      this.uv.set(c, new Float32Array([(px + 0.5) / AW, (py + 0.5) / AH, (px + c.width - 0.5) / AW, (py + c.height - 0.5) / AH]));
    });
    if (!this.atlas) this.atlas = this.tex(gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    this.atlasFor = S;
  }

  // ------------------------------------------------------------------ feeding
  /** Begin a frame's additive sprite batch. */
  beginSprites() { this.nSpr = 0; }

  /**
   * One sprite blit, same arguments as the Canvas2D `rot` helper: the composed 2D transform (a b c d e f)
   * and the image rect (-ax·w, -ay·h, w, h). Returns false if the image is not in the atlas.
   */
  sprite(im: object, a: number, b: number, c: number, d: number, e: number, f: number, x0: number, y0: number, w: number, h: number, alpha: number): boolean {
    const r = this.uv.get(im);
    if (!r) { if (!this.missing.has(im)) { this.missing.add(im); console.warn('[vfx] sprite not in the GL atlas'); } return false; }
    if (this.nSpr >= MAX_SPRITES) this.flushSprites();
    const o = this.nSpr++ * SPR_F, s = this.spr;
    s[o] = a * x0 + c * y0 + e; s[o + 1] = b * x0 + d * y0 + f;
    s[o + 2] = a * w; s[o + 3] = b * w;
    s[o + 4] = c * h; s[o + 5] = d * h; s[o + 6] = alpha; s[o + 7] = 0;
    s[o + 8] = r[0]; s[o + 9] = r[1]; s[o + 10] = r[2]; s[o + 11] = r[3];
    return true;
  }

  /**
   * Fill the smoke and heat fields' instance buffers straight from the pool (screen space through the caller's
   * translate/uniform-scale transform), and collect the haze sources. Called once a frame.
   */
  gather(P: Pool, m: DOMMatrix, t: number) {
    let ns = 0, nh = 0;
    const sm = this.smoke, ht = this.heat, tones = this.tones;
    const sc = m.a;
    for (let i = 0; i < P.n; i++) {
      const k = P.kind[i];
      if (P.delay[i] > 0) continue;
      const u = P.age[i] / P.life[i];
      if (k === SMOKE || k === DUST || k === MIST) {
        const s = P.s0[i] + (P.s1[i] - P.s0[i]) * easeOut(u);
        const fadeIn = Math.min(1, P.age[i] / 0.06);
        const a = P.a0[i] * fadeIn * Math.pow(1 - u, k === MIST ? 1.6 : 1.2) * 1.5;
        if (a < 0.01 || s < 0.6) continue;
        const o = ns++ * BLOB_F, ti = P.col[i] * 3;
        const r = s * sc * 1.05;
        sm[o] = m.a * P.x[i] + m.e; sm[o + 1] = m.d * P.y[i] + m.f; sm[o + 2] = r; sm[o + 3] = r * (P.flags[i] & F_GROUNDED ? 0.55 : 1);
        sm[o + 4] = tones[ti]; sm[o + 5] = tones[ti + 1]; sm[o + 6] = tones[ti + 2]; sm[o + 7] = a;
        sm[o + 8] = P.seed[i]; sm[o + 9] = u; sm[o + 10] = 0; sm[o + 11] = 0;
      } else if (k === FIRE) {
        const s = P.s0[i] + (P.s1[i] - P.s0[i]) * easeOut(u);
        const stage = u * 3.6 + P.col[i];
        const temp = Math.max(0.12, 1.15 - 0.27 * stage);
        const a = (u < 0.1 ? 1 : 1 - (u - 0.1) / 0.9);
        const o = nh++ * BLOB_F;
        const r = s * sc * 0.95;
        ht[o] = m.a * P.x[i] + m.e; ht[o + 1] = m.d * P.y[i] + m.f; ht[o + 2] = r; ht[o + 3] = r;
        ht[o + 4] = 0; ht[o + 5] = 0; ht[o + 6] = 0; ht[o + 7] = a * temp;
        ht[o + 8] = P.seed[i]; ht[o + 9] = u; ht[o + 10] = 0; ht[o + 11] = 0;
      } else if (k === FLAME) {
        const s = P.s0[i] * (1 - u * 0.6) * sc;
        const h = s * P.asp[i];
        const a = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const o = nh++ * BLOB_F;
        // the tongue's base is at (x, y): centre the blob half its height up
        ht[o] = m.a * P.x[i] + m.e; ht[o + 1] = m.d * P.y[i] + m.f - h * 0.48; ht[o + 2] = s * 0.7; ht[o + 3] = h * 0.62;
        ht[o + 4] = 0; ht[o + 5] = 0; ht[o + 6] = 0; ht[o + 7] = a * 1.05;
        ht[o + 8] = P.seed[i]; ht[o + 9] = u; ht[o + 10] = Math.sin(t * 7 + P.seed[i] * 20) * 0.25; ht[o + 11] = 1;
      }
    }
    this.nSmoke = ns; this.nHeat = nh;
  }

  /** Haze sources for this frame (kind 0 shock ring, 1 heat column, 2 muzzle blast), in canvas px. */
  beginHaze() { this.nHz = 0; this.hzBox[0] = 1e9; this.hzBox[1] = 1e9; this.hzBox[2] = -1e9; this.hzBox[3] = -1e9; }
  hazeSrc(kind: number, x: number, y: number, r: number, str: number) {
    if (this.nHz >= MAX_HAZE || r < 2 || str < 0.05) return;
    const i = this.nHz++ * 4;
    this.hzA[i] = x; this.hzA[i + 1] = y; this.hzA[i + 2] = r; this.hzA[i + 3] = str;
    this.hzB[i] = kind; this.hzB[i + 1] = 0; this.hzB[i + 2] = 0; this.hzB[i + 3] = 0;
    // the box the distortion can reach
    const ext = kind === 0 ? r * 1.25 + 12 : kind === 1 ? r * 1.05 : r * 2.2;
    const top = kind === 1 ? y - r * 2.7 : y - ext;
    const bot = kind === 1 ? y + r * 0.3 : y + ext;
    const b = this.hzBox;
    if (x - ext < b[0]) b[0] = x - ext; if (top < b[1]) b[1] = top;
    if (x + ext > b[2]) b[2] = x + ext; if (bot > b[3]) b[3] = bot;
  }
  get hazeCount() { return this.nHz; }

  // ------------------------------------------------------------------ rendering
  private bindQuad() { this.gl!.bindVertexArray(this.quadVao); }
  private use(name: string) { const p = this.progs[name]; this.gl!.useProgram(p.p); return p.u; }
  private bindTex(unit: number, t: WebGLTexture | null) { const gl = this.gl!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }
  private to(t: Target | null) { const gl = this.gl!; gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : this.W, t ? t.h : this.H); }

  /** Render both fields (smoke and heat) into their half-resolution targets. */
  fields(W: number, H: number, S: Sprites, time: number) {
    const gl = this.gl!;
    this.ensure(W, H, S);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.blobVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.blobBuf);
    this.to(this.smokeT);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.nSmoke) {
      const u = this.use('smoke');
      gl.uniform2f(u.uRes, W, H);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.smoke, 0, this.nSmoke * BLOB_F);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nSmoke);
    }
    this.to(this.heatT);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.nHeat) {
      const u = this.use('heat');
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uTime, time);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.heat, 0, this.nHeat * BLOB_F);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nHeat);
    }
    this.stats.smoke = this.nSmoke; this.stats.heat = this.nHeat;
  }

  /** The cel-shaded smoke composite into the GL canvas; returns false if there is no smoke (skip the blit). */
  smokeComposite(time: number, wind: number): boolean {
    if (!this.nSmoke) return false;
    const gl = this.gl!;
    this.to(null);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    this.bindQuad();
    const u = this.use('smokeComp');
    this.bindTex(0, this.smokeT!.tex); this.bindTex(1, this.heatT!.tex);
    gl.uniform1i(u.uSmoke, 0); gl.uniform1i(u.uHeat, 1);
    gl.uniform2f(u.uTexel, 1 / this.smokeT!.w, 1 / this.smokeT!.h);
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWind, wind); gl.uniform2f(u.uRes, this.W, this.H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  /** Haze: upload the 2D scene once, draw it back displaced inside the sources' box. Returns false if none. */
  hazeComposite(scene: HTMLCanvasElement, time: number): boolean {
    if (!this.nHz || !this.haze) return false;
    const gl = this.gl!;
    const b = this.hzBox;
    const x0 = Math.max(0, Math.floor(b[0])), y0 = Math.max(0, Math.floor(b[1]));
    const x1 = Math.min(this.W, Math.ceil(b[2])), y1 = Math.min(this.H, Math.ceil(b[3]));
    if (x1 <= x0 || y1 <= y0) return false;
    this.bindTex(0, this.sceneTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    this.stats.uploads++;
    this.to(null);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, this.H - y1, x1 - x0, y1 - y0);
    this.bindQuad();
    const u = this.use('haze');
    gl.uniform1i(u.uScene, 0); gl.uniform2f(u.uRes, this.W, this.H); gl.uniform1f(u.uTime, time);
    gl.uniform4fv(u.uSrcA, this.hzA); gl.uniform4fv(u.uSrcB, this.hzB); gl.uniform1i(u.uN, this.nHz);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    this.stats.haze = this.nHz;
    return true;
  }

  private flushSprites() {
    if (!this.nSpr) return;
    const gl = this.gl!;
    gl.bindVertexArray(this.vao);
    const u = this.use('sprite');
    gl.uniform2f(u.uRes, this.W, this.H);
    this.bindTex(0, this.atlas); gl.uniform1i(u.uAtlas, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.spr, 0, this.nSpr * SPR_F);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nSpr);
    this.stats.sprites += this.nSpr;
    this.nSpr = 0;
  }

  /** Start the additive pass: clear the additive target. Sprites pushed after this land in it. */
  beginAdd() {
    const gl = this.gl!;
    this.to(this.add);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.stats.sprites = 0;
    this.nSpr = 0;
  }

  /** Fire field (banded ramp) into the additive target, then sprites, then bloom and the final blit to the canvas. */
  endAdd(time: number, wind: number, bloomK: number) {
    const gl = this.gl!;
    this.to(this.add);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (this.nHeat) {
      this.bindQuad();
      const u = this.use('fire');
      this.bindTex(0, this.heatT!.tex);
      gl.uniform1i(u.uHeat, 0); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWind, wind); gl.uniform2f(u.uRes, this.W, this.H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.flushSprites();
    gl.disable(gl.BLEND);
    this.bindQuad();
    const useBloom = this.bloom && bloomK > 0;
    if (useBloom) {
      const A = this.bloomA!, B = this.bloomB!;
      this.to(A);
      let u = this.use('bright');
      this.bindTex(0, this.add!.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uTexel, 1 / this.add!.w, 1 / this.add!.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      u = this.use('blur');
      gl.uniform1i(u.uSrc, 0);
      for (let pass = 0; pass < 2; pass++) {
        this.to(B); this.bindTex(0, A.tex); gl.uniform2f(u.uDir, (pass + 1) / A.w, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.to(A); this.bindTex(0, B.tex); gl.uniform2f(u.uDir, 0, (pass + 1) / A.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    this.to(null);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const u = this.use('final');
    this.bindTex(0, this.add!.tex); this.bindTex(1, this.bloomA!.tex);
    gl.uniform1i(u.uAdd, 0); gl.uniform1i(u.uBloom, 1); gl.uniform1f(u.uBloomK, useBloom ? bloomK : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ------------------------------------------------------------------ governor
  /**
   * Once a frame (from drawAdd): average the frame interval over 2 s windows; two windows in a row over budget
   * step GL down one level (bloom off → haze off → GL off), logged once per step.
   */
  govern(now: number) {
    if (this.pinned || this.level === 0) { this.gLast = now; return; }
    if (this.gLast) {
      const dt = now - this.gLast;
      if (dt > 0 && dt < 250) { this.gSum += dt; this.gN++; } // a hidden tab or a breakpoint is not a slow frame
    }
    this.gLast = now;
    if (!this.gT0) this.gT0 = now;
    if (now - this.gT0 < 2000) return;
    const avg = this.gN ? this.gSum / this.gN : 0;
    this.gT0 = now; this.gSum = 0; this.gN = 0;
    if (avg > this.budgetMs) this.gOver++; else this.gOver = 0;
    if (this.gOver >= 2) {
      this.gOver = 0;
      this.level = (this.level - 1) as GLLevel;
      this.note(`frame time ${avg.toFixed(1)} ms over the ${this.budgetMs.toFixed(1)} ms budget: GL effects → ${LEVEL_NAME[this.level]}`);
    }
  }
  setLevel(l: GLLevel, pin = true) { this.level = l; this.pinned = pin; this.gOver = 0; this.gT0 = 0; this.gSum = 0; this.gN = 0; }
  get levelName() { return LEVEL_NAME[this.level]; }
}

let SHARED: VfxGL | null = null;
let tried = false;
/** The one shared GL layer (null when WebGL2 is unavailable). `?gl=0` in the URL turns it off. */
export function sharedGL(tones: string[]): VfxGL | null {
  if (SHARED) return SHARED.broken ? null : SHARED;
  if (tried) return null;
  tried = true;
  try {
    if (typeof document === 'undefined' || new URLSearchParams(location.search).get('gl') === '0') return null;
    SHARED = new VfxGL(tones);
    return SHARED.broken ? null : SHARED;
  } catch (e) {
    console.warn('[vfx] WebGL2 unavailable; Canvas2D effects', e);
    return null;
  }
}
