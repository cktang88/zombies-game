// Quadruped cutout rig (dogs, and any four-legged Turned): spine + neck + head + two-bone tail,
// four two-bone legs solved by IK onto gait-driven paw targets, a bite/lunge and a bark, and a
// Verlet ragdoll death built the same way as the humanoid one (ragdoll.ts: point masses, rigid
// trunk, one-way joint limits, decaying "muscles", ground friction, sleep).
//
// Parts come from tools/segment.ts with a custom bone list (tools/rigs/dog.json): torso
// (pelvis→neck), neck, head, tail1, tail2, fUpper/fLower (shoulder→elbow→paw), hUpper/hLower
// (hip→stifle→paw). Only the near legs are cut; the far pair reuses them from the darkened atlas.
//
// Rig space: faces +x, y down, ground y = 0, units = rig px (≈ source px, the dog is 120 tall).
//
// Gaits (leg order NF, FF, NH, FH = near/far fore/hind; phase offsets of each paw's touchdown):
//   walk   lateral-sequence four-beat  NH 0, NF .25, FH .5, FF .75   duty .65
//   trot   diagonal pairs              NH+FF 0, FH+NF .5             duty .45
//   gallop transverse (rotary-ish)     NH 0, FH .1, NF .42, FF .52   duty .3, a suspension phase
// Stride length is fixed per gait and the cadence follows the speed, so stance paws never slide.
import { loadRig, getRig, type RigAsset, type PartMeta } from './assets';
import { clamp, lerp, wrapAngle, ik2 } from './math';

export type QuadGait = 'idle' | 'walk' | 'trot' | 'gallop';
export type QuadAction = 'bite' | 'bark';

// ragdoll / pose points
export const Q_PELVIS = 0, Q_NECK = 1, Q_SKULL = 2, Q_NOSE = 3, Q_TAILB = 4, Q_TAILM = 5, Q_TAILT = 6;
/** leg l (0 NF, 1 FF, 2 NH, 3 FH): root, knee (elbow/stifle), paw */
export const qLeg = (l: number) => [7 + l * 3, 8 + l * 3, 9 + l * 3] as const;
export const Q_POINTS = 19;
const FRONT = (l: number) => l < 2;
const FAR = (l: number) => l % 2 === 1;

interface GaitDef { off: [number, number, number, number]; duty: number; stride: number; lift: number; bob: number; pitch: number; susp: number }
const GAITS: Record<Exclude<QuadGait, 'idle'>, GaitDef> = {
  walk: { off: [0.25, 0.75, 0, 0.5], duty: 0.65, stride: 0.55, lift: 0.12, bob: 1.2, pitch: 0.02, susp: 0 },
  trot: { off: [0.5, 0, 0, 0.5], duty: 0.45, stride: 0.85, lift: 0.18, bob: 2.6, pitch: 0.025, susp: 0 },
  gallop: { off: [0.42, 0.52, 0, 0.1], duty: 0.3, stride: 1.45, lift: 0.26, bob: 4, pitch: 0.16, susp: 5 },
};
/** speed (rig units/s) above which each gait takes over */
export const QUAD_SPEEDS = { walk: 8, trot: 75, gallop: 165 };

interface Geo {
  m: Record<string, PartMeta>;
  ground: number; restT: number; torsoLen: number;
  local: Record<string, [number, number]>; // torso-frame (along, perp) of attached joints
  neckRest: number; headRest: number; t1Rest: number; t2Rest: number;
  up: [number, number]; lo: [number, number]; // front / hind bone lengths: [upper, lower]
  upH: [number, number]; loH: [number, number];
  pawH: [number, number]; pawX: [number, number]; // front, hind
  legLen: number;
}
function geoOf(a: RigAsset): Geo {
  const m = a.meta.parts, J = a.meta.joints;
  const restT = m.torso.rest;
  const c = Math.cos(-restT), s = Math.sin(-restT);
  const local: Geo['local'] = {};
  for (const k of ['shoulder', 'hip', 'tailBase']) local[k] = [J[k][0] * c - J[k][1] * s, J[k][0] * s + J[k][1] * c];
  const ground = a.meta.ground;
  return {
    m, ground, restT, torsoLen: m.torso.len, local,
    neckRest: m.neck.rest, headRest: m.head.rest, t1Rest: m.tail1.rest, t2Rest: m.tail2.rest,
    up: [Math.hypot(J.elbow[0] - J.shoulder[0], J.elbow[1] - J.shoulder[1]), Math.hypot(J.stifle[0] - J.hip[0], J.stifle[1] - J.hip[1])],
    lo: [Math.hypot(J.fPaw[0] - J.elbow[0], J.fPaw[1] - J.elbow[1]), Math.hypot(J.hPaw[0] - J.stifle[0], J.hPaw[1] - J.stifle[1])],
    upH: [m.fUpper.rest, m.hUpper.rest], loH: [m.fLower.rest, m.hLower.rest],
    pawH: [ground - J.fPaw[1], ground - J.hPaw[1]], pawX: [J.fPaw[0], J.hPaw[0]],
    legLen: ground,
  };
}

/** The pose a frame is built from (everything else follows from it). */
interface Ch { bx: number; by: number; pitch: number; neck: number; head: number; t1: number; t2: number; fx: number[]; fy: number[] }
const newCh = (): Ch => ({ bx: 0, by: 0, pitch: 0, neck: 0, head: 0, t1: 0, t2: 0, fx: [0, 0, 0, 0], fy: [0, 0, 0, 0] });
function mixCh(a: Ch, b: Ch, w: number, o: Ch) {
  o.bx = lerp(a.bx, b.bx, w); o.by = lerp(a.by, b.by, w); o.pitch = lerp(a.pitch, b.pitch, w);
  o.neck = lerp(a.neck, b.neck, w); o.head = lerp(a.head, b.head, w); o.t1 = lerp(a.t1, b.t1, w); o.t2 = lerp(a.t2, b.t2, w);
  for (let l = 0; l < 4; l++) { o.fx[l] = lerp(a.fx[l], b.fx[l], w); o.fy[l] = lerp(a.fy[l], b.fy[l], w); }
}
/** far legs sit a touch forward and higher (they stand on the far side of the body) */
const FAR_DX = 5, FAR_DY = -3;
const BEND = [1, 1, -1, -1]; // fore elbows point back, hind stifles forward (ik2 bend side)

export interface QuadDieOpts { impulse?: { x: number; y: number }; at?: 'head' | 'torso' | 'legs'; calm?: boolean }

export class QuadRig {
  asset: RigAsset | null = null;
  geo: Geo | null = null;
  speed = 0;
  /** force a gait (animlab); null = from speed */
  gaitLock: QuadGait | null = null;
  gait: QuadGait = 'idle';
  private prevGait: QuadGait = 'idle';
  private blend = 1;
  phase = 0;
  t = 0;
  action: QuadAction | null = null;
  actT = 0;
  dead = false;
  ragdoll: QuadRagdoll | null = null;
  /** pose points (rig space, Q_* order) of this frame and the last */
  pts = new Float32Array(Q_POINTS * 2);
  private prev = new Float32Array(Q_POINTS * 2);
  private ch = newCh(); private chA = newCh(); private chB = newCh();
  private ik = { a1: 0, a2: 0, reach: 0 };
  /** paw ground contacts this frame (footfall markers) */
  contact = [true, true, true, true];

  constructor(public id: string, seed = 1) {
    this.t = (seed * 0.618) % 1 * 10;
    const a = getRig(id);
    if (a) this.attach(a);
    else void loadRig(id).then((r) => r && this.attach(r));
  }
  attach(a: RigAsset) { this.asset = a; this.geo = geoOf(a); this.solve(); this.prev.set(this.pts); }
  get ready() { return !!this.geo; }
  get settled() { return !!this.ragdoll?.settled; }

  setSpeed(v: number) { this.speed = Math.max(0, v); }
  play(a: QuadAction) { if (!this.dead) { this.action = a; this.actT = 0; } }

  private pickGait(): QuadGait {
    if (this.gaitLock) return this.gaitLock;
    const v = this.speed, g = this.gait;
    // a little hysteresis so a dog at a gait boundary doesn't flicker between two
    const h = (k: keyof typeof QUAD_SPEEDS) => QUAD_SPEEDS[k] * (g === k ? 0.85 : 1);
    return v >= h('gallop') ? 'gallop' : v >= h('trot') ? 'trot' : v >= h('walk') ? 'walk' : 'idle';
  }

  update(dt: number) {
    if (!this.geo) return;
    this.t += dt;
    if (this.dead) { this.ragdoll?.step(dt); return; }
    const g = this.pickGait();
    if (g !== this.gait) { this.prevGait = this.gait; this.gait = g; this.blend = 0; }
    this.blend = Math.min(1, this.blend + dt / 0.25);
    const G = this.geo;
    if (g !== 'idle') {
      const d = GAITS[g];
      // cadence from speed: a stance paw covers stride*legLen while the body moves speed*duty/f
      const f = clamp((this.speed * d.duty) / (d.stride * G.legLen), 0.5, 4.5);
      this.phase = (this.phase + f * dt) % 1;
    }
    if (this.action) { this.actT += dt; if (this.actT > (this.action === 'bite' ? 0.7 : 0.45)) this.action = null; }
    this.prev.set(this.pts);
    this.solve();
  }

  /** Channels of one gait at the current phase. */
  private gaitCh(g: QuadGait, o: Ch) {
    const G = this.geo!;
    const L = G.legLen;
    o.bx = 0; o.by = 0; o.pitch = 0; o.neck = 0; o.head = 0;
    const t = this.t;
    if (g === 'idle') {
      const br = Math.sin(t * 2.4);
      o.by = br * 0.6; o.pitch = br * 0.006;
      o.neck = Math.sin(t * 0.7) * 0.06 + Math.sin(t * 0.23) * 0.05; o.head = Math.sin(t * 0.9 + 1) * 0.05;
      const wag = Math.sin(t * 7) * 0.22;
      o.t1 = -0.15 + wag; o.t2 = wag * 0.8;
      for (let l = 0; l < 4; l++) { const fr = FRONT(l) ? 0 : 1; o.fx[l] = G.pawX[fr] + (FAR(l) ? FAR_DX : 0); o.fy[l] = -G.pawH[fr] + (FAR(l) ? FAR_DY : 0); }
      return;
    }
    const d = GAITS[g];
    const S = d.stride * L, p = this.phase, TAU = Math.PI * 2;
    for (let l = 0; l < 4; l++) {
      const fr = FRONT(l) ? 0 : 1;
      const u = (p - d.off[l] + 1) % 1;
      let x: number, lift = 0;
      if (u < d.duty) x = S * (0.5 - u / d.duty); // stance: the paw stays put while the body passes
      else {
        const s = (u - d.duty) / (1 - d.duty);
        const e = s * s * (3 - 2 * s);
        x = -S * 0.5 + S * e;
        lift = Math.sin(Math.PI * s) * d.lift * L * (fr ? 1 : 1.15) * (s < 0.5 ? 1 : 0.85);
      }
      // hind paws reach under; fore paws reach out (gallop): bias the stride centre a little
      const bias = g === 'gallop' ? (fr ? -0.08 : 0.06) * L : 0;
      o.fx[l] = G.pawX[fr] + x + bias + (FAR(l) ? FAR_DX : 0);
      o.fy[l] = -G.pawH[fr] - lift + (FAR(l) ? FAR_DY : 0);
    }
    if (g === 'gallop') {
      // the spine rocks: hind drive lifts the rear, fore landing pitches nose-down; the whole
      // body floats in the suspension phase after the fore pair leaves
      o.pitch = Math.sin(TAU * (p - 0.15)) * d.pitch;
      o.by = -Math.max(0, Math.sin(TAU * (p - 0.6))) * d.susp - Math.abs(Math.sin(TAU * p)) * d.bob * 0.4;
      o.neck = -o.pitch * 0.9 + 0.12 + Math.sin(TAU * p) * 0.1;
      o.head = 0.05;
      o.t1 = 0.25 + Math.sin(TAU * p) * 0.15; o.t2 = -0.1 + Math.sin(TAU * p - 0.8) * 0.2;
    } else {
      // two hits per cycle (walk: each pair of supports; trot: each diagonal)
      o.by = -Math.abs(Math.cos(TAU * p * 2)) * d.bob + d.bob * 0.5;
      o.pitch = Math.sin(TAU * p * 2) * d.pitch;
      o.neck = (g === 'trot' ? 0.12 : 0.04) + Math.sin(TAU * p * 2 + 0.6) * 0.04;
      o.head = -0.02;
      const wag = Math.sin(TAU * p * (g === 'walk' ? 1 : 2)) * (g === 'walk' ? 0.25 : 0.12);
      o.t1 = (g === 'trot' ? 0.1 : -0.1) + wag; o.t2 = wag * 0.7;
    }
  }

  /** bite: crouch back, lunge, snap, recover. bark: head throws up, a small hop of the fore end */
  private actionCh(o: Ch) {
    const a = this.action, k = this.actT;
    if (!a) return;
    if (a === 'bite') {
      const wind = clamp(k / 0.18, 0, 1), strike = clamp((k - 0.18) / 0.12, 0, 1), back = clamp((k - 0.38) / 0.32, 0, 1);
      const sm = (v: number) => v * v * (3 - 2 * v);
      const lunge = sm(strike) * (1 - sm(back));
      const crouch = sm(wind) * (1 - sm(strike));
      o.bx += -7 * crouch + 22 * lunge;
      o.by += 5 * crouch + 2 * lunge;
      o.pitch += 0.06 * crouch - 0.05 * lunge;
      o.neck += -0.15 * crouch + 0.45 * lunge; // neck reaches forward/down
      o.head += 0.15 * crouch - 0.25 * lunge + Math.sin(k * 60) * 0.06 * lunge; // snapping
      // fore paws leave the ground and reach with the lunge; hind stay planted
      for (const l of [0, 1]) { o.fx[l] += 26 * lunge; o.fy[l] -= 9 * Math.sin(Math.PI * clamp((k - 0.15) / 0.4, 0, 1)); }
      o.t1 += 0.3 * lunge;
    } else {
      const e = Math.sin(Math.PI * clamp(k / 0.45, 0, 1));
      o.pitch -= 0.08 * e; o.neck -= 0.3 * e; o.head -= 0.25 * e; o.by -= 2 * e;
      for (const l of [0, 1]) o.fy[l] -= 5 * e;
    }
  }

  private solve() {
    const G = this.geo!;
    const o = this.ch;
    this.gaitCh(this.gait, this.chA);
    if (this.blend < 1) { this.gaitCh(this.prevGait, this.chB); mixCh(this.chB, this.chA, this.blend, o); } else mixCh(this.chA, this.chA, 1, o);
    this.actionCh(o);
    const P = this.pts;
    const set = (i: number, x: number, y: number) => { P[i * 2] = x; P[i * 2 + 1] = y; };
    const px = o.bx, py = -G.ground + o.by;
    const ta = G.restT + o.pitch, tc = Math.cos(ta), ts = Math.sin(ta);
    const att = (k: string): [number, number] => { const [u, v] = G.local[k]; return [px + u * tc - v * ts, py + u * ts + v * tc]; };
    set(Q_PELVIS, px, py);
    const nx = px + tc * G.torsoLen, ny = py + ts * G.torsoLen;
    set(Q_NECK, nx, ny);
    const na = G.neckRest + o.pitch + o.neck, ha = G.headRest + o.pitch + o.neck + o.head;
    const sx = nx + Math.cos(na) * G.m.neck.len, sy = ny + Math.sin(na) * G.m.neck.len;
    set(Q_SKULL, sx, sy);
    set(Q_NOSE, sx + Math.cos(ha) * G.m.head.len, sy + Math.sin(ha) * G.m.head.len);
    const [tbx, tby] = att('tailBase');
    set(Q_TAILB, tbx, tby);
    const a1 = G.t1Rest + o.pitch + o.t1, a2 = G.t2Rest + o.pitch + o.t1 + o.t2; // t > 0 = tail up
    const tmx = tbx + Math.cos(a1) * G.m.tail1.len, tmy = tby + Math.sin(a1) * G.m.tail1.len;
    set(Q_TAILM, tmx, tmy);
    set(Q_TAILT, tmx + Math.cos(a2) * G.m.tail2.len, tmy + Math.sin(a2) * G.m.tail2.len);
    for (let l = 0; l < 4; l++) {
      const fr = FRONT(l) ? 0 : 1;
      let [rx, ry] = att(fr ? 'hip' : 'shoulder');
      if (FAR(l)) { rx += FAR_DX; ry += FAR_DY; }
      const [ri, ki, pi] = qLeg(l);
      const tx = o.fx[l], ty = Math.min(o.fy[l], -G.pawH[fr] + (FAR(l) ? FAR_DY : 0));
      const s = ik2(rx, ry, tx, ty, G.up[fr], G.lo[fr], BEND[l], this.ik);
      set(ri, rx, ry);
      const kx = rx + Math.cos(s.a1) * G.up[fr], ky = ry + Math.sin(s.a1) * G.up[fr];
      set(ki, kx, ky);
      set(pi, kx + Math.cos(s.a2) * G.lo[fr], ky + Math.sin(s.a2) * G.lo[fr]);
      this.contact[l] = ty >= -G.pawH[fr] + (FAR(l) ? FAR_DY : 0) - 0.5;
    }
  }

  die(o: QuadDieOpts = {}) {
    if (this.dead || !this.geo) return;
    this.dead = true;
    this.action = null;
    const r = new QuadRagdoll(1, 0.5, 0.55);
    r.init(this.pts, this.prev, 1 / 60, this.speed);
    r.hit(o);
    this.ragdoll = r;
  }

  /**
   * Draw with the paws' ground line at (x, y), `scale` screen px per rig unit, facing ±1.
   * atlas: a graded variant (same layout) instead of the plain atlas, e.g. gradedAtlas(...).
   */
  draw(c: CanvasRenderingContext2D, x: number, y: number, scale: number, facing = 1, o: { atlas?: CanvasImageSource; far?: CanvasImageSource; flash?: number } = {}) {
    const A = this.asset, G = this.geo;
    if (!A || !G) return;
    const P = this.ragdoll ? this.ragdoll.pts() : this.pts;
    const atlas = o.atlas ?? A.atlas, dark = o.far ?? A.dark;
    c.save();
    c.translate(x, y);
    c.scale(scale * facing, scale);
    const part = (img: CanvasImageSource, name: string, a: number, b: number) => {
      const m = G.m[name];
      if (!m) return;
      const ax = P[a * 2], ay = P[a * 2 + 1];
      const ang = Math.atan2(P[b * 2 + 1] - ay, P[b * 2] - ax);
      c.save();
      c.translate(ax, ay);
      c.rotate(ang - m.rest);
      c.drawImage(img, m.x, m.y, m.w, m.h, -m.px, -m.py, m.w, m.h);
      c.restore();
    };
    const leg = (img: CanvasImageSource, l: number) => {
      const [ri, ki, pi] = qLeg(l);
      const fr = FRONT(l) ? 0 : 1;
      // bone angles from the points; the art's own rest is root→knee / knee→paw (parts were cut
      // on exactly those joints), so part() can be used directly
      part(img, fr ? 'hUpper' : 'fUpper', ri, ki);
      part(img, fr ? 'hLower' : 'fLower', ki, pi);
    };
    // far side first, then the tail, the trunk, the head end, and the near legs over it all
    leg(dark, 3); leg(dark, 1);
    part(atlas, 'tail2', Q_TAILM, Q_TAILT);
    part(atlas, 'tail1', Q_TAILB, Q_TAILM);
    part(atlas, 'torso', Q_PELVIS, Q_NECK);
    part(atlas, 'neck', Q_NECK, Q_SKULL);
    part(atlas, 'head', Q_SKULL, Q_NOSE);
    leg(atlas, 2); leg(atlas, 0);
    if (o.flash && o.flash > 0) {
      c.globalAlpha = clamp(o.flash, 0, 1);
      leg(A.flash, 2); leg(A.flash, 0);
      part(A.flash, 'torso', Q_PELVIS, Q_NECK); part(A.flash, 'head', Q_SKULL, Q_NOSE);
    }
    c.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// Ragdoll: the same Verlet scheme as ragdoll.ts (2 substeps, 4 relaxation passes, 0.996 damping,
// linear muscle decay toward the death pose, kinematic joint-limit projection, sleep), on the
// 19 quadruped points. A dead dog ends on its side: the trunk drops, the legs go out long.
interface QDist { a: number; b: number; d: number; stiff: number }
/** lo/hi/aim are offsets from `base` (the death pose's angle), so a range never straddles ±π */
interface QLim { a: number; j: number; c: number; lo: number; hi: number; base: number; aim: number; axis?: boolean }

export class QuadRagdoll {
  x = new Float32Array(Q_POINTS); y = new Float32Array(Q_POINTS);
  ox = new Float32Array(Q_POINTS); oy = new Float32Array(Q_POINTS);
  dists: QDist[] = []; limits: QLim[] = [];
  t = 0; still = 0; settled = false;
  /** standing trunk height at death (the sink force is scaled by it) */
  private h0 = 1;
  private out = new Float32Array(Q_POINTS * 2);
  private x0 = new Float32Array(Q_POINTS); private y0 = new Float32Array(Q_POINTS);

  constructor(public mass: number, public stiffT: number, public friction: number, public gravity = 1350) {}

  init(cur: Float32Array, prev: Float32Array, dt: number, _speed = 0) {
    for (let i = 0; i < Q_POINTS; i++) {
      this.x[i] = cur[i * 2]; this.y[i] = cur[i * 2 + 1];
      const vx = clamp((cur[i * 2] - prev[i * 2]) / dt, -400, 400), vy = clamp((cur[i * 2 + 1] - prev[i * 2 + 1]) / dt, -400, 400);
      this.ox[i] = this.x[i] - vx / 120; this.oy[i] = this.y[i] - vy / 120;
    }
    this.h0 = Math.max(10, -(this.y[Q_PELVIS] + this.y[Q_NECK]) / 2);
    const D = (a: number, b: number, stiff = 1) => this.dists.push({ a, b, d: Math.hypot(this.x[a] - this.x[b], this.y[a] - this.y[b]), stiff });
    const trunk = [Q_PELVIS, Q_NECK, Q_TAILB, qLeg(0)[0], qLeg(1)[0], qLeg(2)[0], qLeg(3)[0]];
    for (let i = 0; i < trunk.length; i++) for (let k = i + 1; k < trunk.length; k++) D(trunk[i], trunk[k]);
    D(Q_NECK, Q_SKULL); D(Q_SKULL, Q_NOSE); D(Q_NECK, Q_NOSE, 0.2);
    D(Q_TAILB, Q_TAILM); D(Q_TAILM, Q_TAILT);
    for (let l = 0; l < 4; l++) { const [r, k, p] = qLeg(l); D(r, k); D(k, p); }
    const L = (a: number, j: number, c: number, lo: number, hi: number, axis = false) => {
      const l: QLim = { a, j, c, lo, hi, base: 0, aim: 0, axis };
      l.base = this.rel(l);
      this.limits.push(l);
    };
    for (let l = 0; l < 4; l++) {
      const [r, k, p] = qLeg(l);
      // knees fold one way only: fore elbows open forward (rel < 0 flexes), hind stifles the other
      if (l < 2) L(r, k, p, -2.5, 0.9); else L(r, k, p, -0.9, 2.5);
      // the leg swings about the trunk axis: far out along the road, not back under the belly
      if (l < 2) L(Q_PELVIS, r, k, -2.4, 1.0, true); else L(Q_PELVIS, r, k, -1.0, 2.4, true);
    }
    L(Q_PELVIS, Q_NECK, Q_SKULL, -0.9, 0.7, true);
    L(Q_NECK, Q_SKULL, Q_NOSE, -0.6, 0.6);
    L(Q_PELVIS, Q_TAILB, Q_TAILM, -1.0, 1.0, true);
    L(Q_TAILB, Q_TAILM, Q_TAILT, -1.0, 1.0);
  }

  private rel(l: QLim) {
    const pa = l.axis ? Math.atan2(this.y[Q_NECK] - this.y[Q_PELVIS], this.x[Q_NECK] - this.x[Q_PELVIS]) : Math.atan2(this.y[l.j] - this.y[l.a], this.x[l.j] - this.x[l.a]);
    return wrapAngle(Math.atan2(this.y[l.c] - this.y[l.j], this.x[l.c] - this.x[l.j]) - pa);
  }

  /** The killing hit, then the fall: the legs give out (paws thrown out long, fore forward,
   * hind back) and the trunk rolls down onto its side. */
  hit(o: QuadDieOpts) {
    const calm = o.calm ? 0.45 : 1;
    const imp = o.impulse ?? { x: -100, y: -30 };
    const k = 1 / 120;
    const zone = o.at === 'head' ? [Q_SKULL, Q_NOSE, Q_NECK] : o.at === 'legs' ? [8, 9, 11, 12, 14, 15, 17, 18] : [Q_PELVIS, Q_NECK, Q_TAILB];
    for (let i = 0; i < Q_POINTS; i++) {
      const w = zone.includes(i) ? 1 : 0.35;
      this.ox[i] -= (imp.x * calm * w * k) / this.mass; this.oy[i] -= (imp.y * calm * w * k) / this.mass;
    }
    for (let l = 0; l < 4; l++) {
      const [, kn, p] = qLeg(l);
      const s = l < 2 ? 1 : -1;
      this.ox[kn] -= s * 40 * k; this.ox[p] -= s * 110 * k; this.oy[p] += 60 * k;
    }
    for (const i of [Q_PELVIS, Q_NECK, Q_TAILB]) this.oy[i] -= 30 * k; // the trunk drops
    // muscles aim at a lying body: legs long, out of the trunk line
    for (const l of this.limits) if (l.axis && l.j !== Q_NECK && l.j !== Q_TAILB) l.aim = l.j === qLeg(0)[0] || l.j === qLeg(1)[0] ? -0.6 : 0.6;
  }

  step(dt: number) {
    if (this.settled) return;
    this.t += dt;
    const sub = 2, h = dt / sub, damp = 0.996;
    this.x0.set(this.x); this.y0.set(this.y);
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < Q_POINTS; i++) {
        const vx = (this.x[i] - this.ox[i]) * damp, vy = (this.y[i] - this.oy[i]) * damp;
        this.ox[i] = this.x[i]; this.oy[i] = this.y[i];
        this.x[i] += vx; this.y[i] += vy + this.gravity * h * h;
      }
      this.sink(h);
      const musc = this.stiffT > 0 ? clamp(1 - this.t / this.stiffT, 0, 1) : 0;
      for (let it = 0; it < 4; it++) {
        for (const d of this.dists) this.solveDist(d);
        for (const l of this.limits) this.solveLimit(l, musc);
        this.collide();
      }
    }
    const sleep = clamp((this.t - 1.2) / 0.6, 0, 1) * 0.6;
    if (sleep > 0) for (let i = 0; i < Q_POINTS; i++) {
      if (this.y[i] < -10) continue;
      this.ox[i] += (this.x[i] - this.ox[i]) * sleep; this.oy[i] += (this.y[i] - this.oy[i]) * sleep;
    }
    let mv = 0;
    for (let i = 0; i < Q_POINTS; i++) mv = Math.max(mv, Math.abs(this.x[i] - this.x0[i]) + Math.abs(this.y[i] - this.y0[i]));
    this.still = mv < dt * 60 ? this.still + dt : 0;
    if ((this.still > 0.3 && this.t > 0.6) || this.t > 2.6) this.settled = true;
  }

  /** Four legs make a table: a dead dog would stand propped on them. While the trunk is still
   * up, it is pulled down and the legs are splayed out along the road (fore forward, hind back),
   * fading out late like ragdoll.ts's tipOver so a body that has not gone down only slides. */
  private sink(h: number) {
    const hgt = -(this.y[Q_PELVIS] + this.y[Q_NECK]) / 2 / this.h0;
    const late = clamp((2.0 - this.t) / 0.5, 0, 1);
    if (hgt < 0.2 || late <= 0) return;
    const k = Math.min(3, hgt * 2) * late, a = h * h;
    const dir = Math.sign(this.x[Q_NECK] - this.x[Q_PELVIS]) || 1;
    for (const i of [Q_PELVIS, Q_NECK, Q_TAILB, qLeg(0)[0], qLeg(1)[0], qLeg(2)[0], qLeg(3)[0]]) this.y[i] += 1500 * k * a;
    // the splay is a push between paw and trunk (no net force: a body must not skate away)
    const sp = hgt > 0.2 && this.t < 1.6 ? 1 : 0;
    let net = 0;
    for (let l = 0; l < 4; l++) {
      const s = (l < 2 ? 1 : -1) * dir * sp, [, kn, p] = qLeg(l);
      this.x[kn] += 300 * s * k * a; this.x[p] += 600 * s * k * a;
      net += 900 * s * k * a;
    }
    for (const i of [Q_PELVIS, Q_NECK, Q_TAILB, qLeg(0)[0], qLeg(1)[0], qLeg(2)[0], qLeg(3)[0]]) {
      this.x[i] -= net / 7;
      // legs levering against the road turn the pull into a skid: the trunk loses its sideways speed
      this.ox[i] += (this.x[i] - this.ox[i]) * 0.08 * Math.min(1, k);
    }
  }

  private solveDist(c: QDist) {
    const dx = this.x[c.b] - this.x[c.a], dy = this.y[c.b] - this.y[c.a];
    const d = Math.hypot(dx, dy) || 1e-4;
    const k = ((d - c.d) / d) * 0.5 * c.stiff;
    this.x[c.a] += dx * k; this.y[c.a] += dy * k; this.x[c.b] -= dx * k; this.y[c.b] -= dy * k;
  }
  private solveLimit(l: QLim, musc: number) {
    const r = wrapAngle(this.rel(l) - l.base);
    let want = r < l.lo ? l.lo : r > l.hi ? l.hi : r;
    if (musc > 0) want += (l.aim - want) * musc * 0.35;
    const delta = wrapAngle(want - r);
    if (Math.abs(delta) < 1e-4) return;
    this.rotate(l.c, l.j, delta * 0.5);
    // a leg's paw follows its knee
    const leg = [0, 1, 2, 3].find((q) => qLeg(q)[1] === l.c);
    if (leg !== undefined) this.rotate(qLeg(leg)[2], l.j, delta * 0.5);
    if (l.c === Q_SKULL) this.rotate(Q_NOSE, l.j, delta * 0.5);
    if (l.c === Q_TAILM) this.rotate(Q_TAILT, l.j, delta * 0.5);
    if (r >= l.lo && r <= l.hi) return;
    this.ox[l.c] += (this.x[l.c] - this.ox[l.c]) * 0.35; this.oy[l.c] += (this.y[l.c] - this.oy[l.c]) * 0.35;
  }
  private rotate(p: number, about: number, a: number) {
    const c = Math.cos(a), s = Math.sin(a);
    const dx = this.x[p] - this.x[about], dy = this.y[p] - this.y[about];
    const nx = this.x[about] + dx * c - dy * s, ny = this.y[about] + dx * s + dy * c;
    this.ox[p] += nx - this.x[p]; this.oy[p] += ny - this.y[p];
    this.x[p] = nx; this.y[p] = ny;
  }
  private collide() {
    const f = this.friction;
    for (let i = 0; i < Q_POINTS; i++) {
      // body thickness: a lying dog's trunk is ~a third of its leg length deep
      const r = i === Q_PELVIS || i === Q_NECK ? 9 : i === Q_SKULL ? 7 : i === Q_TAILB ? 6 : 2.5;
      if (this.y[i] > -r) {
        this.y[i] = -r;
        this.ox[i] = this.x[i] - (this.x[i] - this.ox[i]) * (1 - f);
        if (this.oy[i] < this.y[i] - 2) this.oy[i] = this.y[i] + (this.y[i] - this.oy[i]) * 0.2;
      }
    }
  }
  pts(): Float32Array {
    for (let i = 0; i < Q_POINTS; i++) { this.out[i * 2] = this.x[i]; this.out[i * 2 + 1] = this.y[i]; }
    return this.out;
  }
}
