// A tiny 2D Verlet ragdoll on the same skeleton as the cutout rig (no physics library:
// ~19 points, ~40 constraints, a few µs per body per step).
//   - point masses at the joints, distance constraints per bone, the torso kept rigid
//   - per-joint angle limits (knees and elbows only bend one way) so it never folds into
//     a broken-doll pose
//   - ground plane at y = 0 (rig space) with friction, optional barricade face (x plane)
//   - "active ragdoll": for a short window the joints are pulled toward the pose the body
//     died in, with stiffness decaying to zero, so it reads as a body and not a sack
// Coordinates are rig-local (character faces +x, y down, ground y = 0, units = rig px).
import { clamp, wrapAngle } from './math';

export const P_PELVIS = 0, P_NECK = 1, P_HEAD = 2, P_SH = 3, P_NEL = 4, P_NWR = 5, P_NTIP = 6, P_FEL = 7, P_FWR = 8, P_FTIP = 9,
  P_NHIP = 10, P_NKNEE = 11, P_NANK = 12, P_NTOE = 13, P_FHIP = 14, P_FKNEE = 15, P_FANK = 16, P_FTOE = 17, P_FSH = 18, P_HEADBASE = 19;
export const RAGDOLL_POINTS = 20;
const HANG: [number, number, number][] = [[P_SH, P_NEL, P_NWR], [P_FSH, P_FEL, P_FWR]];
const TRUNK: boolean[] = [];
for (const i of [P_PELVIS, P_NECK, P_SH, P_FSH, P_NHIP, P_FHIP]) TRUNK[i] = true;

/** For each part (skeleton.ts order): [from point, to point]. */
export const PART_POINTS: [number, number][] = [
  [P_PELVIS, P_NECK], [P_HEADBASE, P_HEAD], [P_SH, P_NEL], [P_NEL, P_NWR], [P_NWR, P_NTIP], [P_FSH, P_FEL], [P_FEL, P_FWR], [P_FWR, P_FTIP],
  [P_NHIP, P_NKNEE], [P_NKNEE, P_NANK], [P_NANK, P_NTOE], [P_FHIP, P_FKNEE], [P_FKNEE, P_FANK], [P_FANK, P_FTOE],
];

interface Dist { a: number; b: number; d: number; stiff: number }
/** Angle limit at joint j between bone (a→j) and bone (j→c), rel = angle(j→c) - angle(a→j) - off. */
interface Limit { a: number; j: number; c: number; lo: number; hi: number; off: number; target: number; relax?: boolean; limp?: boolean }

export type DeathKind = 'shot' | 'headshot' | 'shotgun' | 'explosion' | 'melee' | 'generic';
export interface DieOpts {
  /** impulse in rig units/s, rig-local (x forward of the body). */
  impulse?: { x: number; y: number };
  /** which body zone the killing hit landed on */
  at?: 'head' | 'torso' | 'armN' | 'armF' | 'legN' | 'legF';
  kind?: DeathKind;
  /** barricade face in rig-local x (bodies can't fall through it); side: +1 = wall is ahead */
  wallX?: number;
  /** gore setting: detach a limb on a heavy hit */
  dismember?: 'head' | 'armN' | null;
  /** reduce-gore: calmer impulses, no dismemberment */
  calm?: boolean;
  /** skip the fall-flat bias (collapse()) */
  noCollapse?: boolean;
}

export class Ragdoll {
  x = new Float32Array(RAGDOLL_POINTS);
  y = new Float32Array(RAGDOLL_POINTS);
  ox = new Float32Array(RAGDOLL_POINTS);
  oy = new Float32Array(RAGDOLL_POINTS);
  dists: Dist[] = [];
  limits: Limit[] = [];
  t = 0;
  still = 0;
  settled = false;
  wallX = Infinity;
  detached = new Set<string>();
  /** fall-flat bias (collapse()): ±1 = the side the trunk is tipped toward, 0 = none */
  tip = 0;
  private torsoL = 1;
  private fx = new Float32Array(RAGDOLL_POINTS);
  private fy = new Float32Array(RAGDOLL_POINTS);

  constructor(public mass: number, public stiffT: number, public friction: number, public gravity = 1350) {}

  /** Start from two consecutive solved poses (cur, prev) so the body keeps its motion. */
  init(cur: Float32Array, prev: Float32Array, dt: number, headRestRel: number) {
    for (let i = 0; i < RAGDOLL_POINTS; i++) {
      this.x[i] = cur[i * 2]; this.y[i] = cur[i * 2 + 1];
      // carry over the animated velocity (clamped so a teleporting pose can't launch it)
      const vx = clamp((cur[i * 2] - prev[i * 2]) / dt, -400, 400), vy = clamp((cur[i * 2 + 1] - prev[i * 2 + 1]) / dt, -400, 400);
      this.ox[i] = this.x[i] - vx * (1 / 120);
      this.oy[i] = this.y[i] - vy * (1 / 120);
    }
    const D = (a: number, b: number, stiff = 1) => this.dists.push({ a, b, d: Math.hypot(this.x[a] - this.x[b], this.y[a] - this.y[b]), stiff });
    const torso = [P_PELVIS, P_NECK, P_SH, P_FSH, P_NHIP, P_FHIP];
    for (let i = 0; i < torso.length; i++) for (let k = i + 1; k < torso.length; k++) D(torso[i], torso[k]);
    D(P_NECK, P_HEADBASE); D(P_HEADBASE, P_HEAD); D(P_SH, P_HEAD, 0.15); // the last: soft neck
    D(P_SH, P_NEL); D(P_NEL, P_NWR); D(P_NWR, P_NTIP);
    D(P_FSH, P_FEL); D(P_FEL, P_FWR); D(P_FWR, P_FTIP);
    D(P_NHIP, P_NKNEE); D(P_NKNEE, P_NANK); D(P_NANK, P_NTOE);
    D(P_FHIP, P_FKNEE); D(P_FKNEE, P_FANK); D(P_FANK, P_FTOE);
    const L = (a: number, j: number, c: number, lo: number, hi: number, off = 0) => {
      const l: Limit = { a, j, c, lo, hi, off, target: 0 };
      l.target = this.rel(l);
      this.limits.push(l);
    };
    // conventions: knee/elbow from skeleton.ts (shin = thigh + knee; forearm = upper - el)
    L(P_NHIP, P_NKNEE, P_NANK, 0, 2.5); L(P_FHIP, P_FKNEE, P_FANK, 0, 2.5);
    L(P_NKNEE, P_NANK, P_NTOE, -2.1, -0.6); L(P_FKNEE, P_FANK, P_FTOE, -2.1, -0.6);
    L(P_SH, P_NEL, P_NWR, -2.6, 0); L(P_FSH, P_FEL, P_FWR, -2.6, 0);
    L(P_NEL, P_NWR, P_NTIP, -1.1, 1.1); L(P_FEL, P_FWR, P_FTIP, -1.1, 1.1);
    for (const l of this.limits.slice(-4)) l.limp = true;
    // hips & neck are measured against the torso axis (pelvis → neck)
    L(P_PELVIS, P_NHIP, P_NKNEE, -2.3, 0.5, Math.PI); L(P_PELVIS, P_FHIP, P_FKNEE, -2.3, 0.5, Math.PI);
    L(P_PELVIS, P_HEADBASE, P_HEAD, -0.75, 0.75, headRestRel);
  }

  private rel(l: Limit): number {
    const pa = l.a === P_PELVIS && (l.j === P_NHIP || l.j === P_FHIP || l.j === P_HEADBASE)
      ? Math.atan2(this.y[P_NECK] - this.y[P_PELVIS], this.x[P_NECK] - this.x[P_PELVIS])
      : Math.atan2(this.y[l.j] - this.y[l.a], this.x[l.j] - this.x[l.a]);
    const ca = Math.atan2(this.y[l.c] - this.y[l.j], this.x[l.c] - this.x[l.j]);
    return wrapAngle(ca - pa - l.off);
  }

  /** Kick the body. Velocity change = impulse / mass; the hit zone takes most of it. */
  hit(o: DieOpts) {
    const calm = o.calm ? 0.45 : 1;
    const imp = o.impulse ?? { x: -120, y: -40 };
    const ix = (imp.x * calm) / this.mass, iy = (imp.y * calm) / this.mass;
    const zone: Record<string, number[]> = {
      head: [P_HEAD, P_HEADBASE, P_NECK], torso: [P_NECK, P_SH, P_FSH, P_PELVIS], armN: [P_NEL, P_NWR, P_NTIP], armF: [P_FEL, P_FWR, P_FTIP],
      legN: [P_NKNEE, P_NANK, P_NTOE], legF: [P_FKNEE, P_FANK, P_FTOE],
    };
    const pts = zone[o.at ?? 'torso'] ?? zone.torso;
    const k = 1 / 120; // one Verlet substep (step() runs two per 1/60 s frame)
    for (let i = 0; i < RAGDOLL_POINTS; i++) {
      const w = pts.includes(i) ? 1 : 0.3;
      this.ox[i] -= ix * w * k;
      this.oy[i] -= iy * w * k;
    }
    if (o.kind === 'explosion') {
      // spin about the pelvis
      const cx = this.x[P_PELVIS], cy = this.y[P_PELVIS], s = (Math.sign(imp.x) || 1) * 5 * calm / this.mass;
      for (let i = 0; i < RAGDOLL_POINTS; i++) { this.ox[i] += (this.y[i] - cy) * s * k; this.oy[i] -= (this.x[i] - cx) * s * k; }
    }
    if (o.kind === 'melee') {
      // dropped where it stood: knees forward, no throw
      for (const i of [P_NKNEE, P_FKNEE]) this.ox[i] -= 60 * k;
    }
    if (o.dismember && !o.calm) this.detach(o.dismember);
  }

  /**
   * Fall flat, not to the knees: the less the killing hit throws the body, the more its trunk
   * is tipped past the feet (backward unless the hit drives it forward), the knees are
   * buckled the other way, and the muscles let go of the standing hip/knee pose sooner.
   */
  collapse(ix: number, iy: number, crawling: boolean) {
    if (crawling) return;
    const mag = Math.hypot(ix, iy) / this.mass;
    const k = clamp(1 - mag / 520, 0.25, 1);
    const dir = Math.abs(ix) > 40 ? Math.sign(ix) : -1;
    const s = 1 / 120;
    this.tip = dir;
    this.torsoL = Math.max(1, Math.hypot(this.x[P_NECK] - this.x[P_PELVIS], this.y[P_NECK] - this.y[P_PELVIS]));
    for (const i of [P_HEAD, P_HEADBASE, P_NECK, P_SH, P_FSH]) this.ox[i] -= dir * 240 * k * s;
    // backward: the knees give first (buckle forward); forward: stiff-legged, onto the face
    if (dir < 0) for (const i of [P_NKNEE, P_FKNEE]) this.ox[i] -= 70 * k * s;
    this.oy[P_PELVIS] -= 40 * k * s; // the seat drops
    // the death pose's hips and knees are a stand: let the muscles aim at a straight, lying body
    for (const l of this.limits) {
      if (l.j === P_NKNEE || l.j === P_FKNEE) { l.target = 0.15; l.relax = true; }
      if (l.j === P_NHIP || l.j === P_FHIP) { l.target = 0.05; l.relax = true; }
    }
    this.stiffT *= 0.6 + 0.4 * (1 - k);
  }

  detach(what: 'head' | 'armN') {
    if (this.detached.has(what)) return;
    this.detached.add(what);
    if (what === 'head') this.dists = this.dists.filter((d) => !(d.a === P_NECK && d.b === P_HEADBASE) && !(d.a === P_SH && d.b === P_HEAD));
    if (what === 'armN') this.dists = this.dists.filter((d) => !(d.a === P_SH && d.b === P_NEL));
    this.limits = this.limits.filter((l) => !(what === 'head' && l.c === P_HEAD));
  }

  step(dt: number) {
    if (this.settled) return;
    this.t += dt;
    const sub = 2, h = dt / sub;
    const x0 = this.fx, y0 = this.fy;
    x0.set(this.x); y0.set(this.y);
    // late in the fall the body loses energy faster (contacts and joint limits fighting the
    // ground otherwise keep ankles and wrists buzzing on the spot and the body never sleeps)
    const damp = 0.996;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < RAGDOLL_POINTS; i++) {
        const vx = (this.x[i] - this.ox[i]) * damp, vy = (this.y[i] - this.oy[i]) * damp;
        this.ox[i] = this.x[i]; this.oy[i] = this.y[i];
        this.x[i] += vx; this.y[i] += vy + this.gravity * h * h;
      }
      this.limitSpin(h);

      if (this.tip) this.tipOver(h);
      // muscles: stiffness decays linearly over stiffT
      const musc = this.stiffT > 0 ? clamp(1 - this.t / this.stiffT, 0, 1) : 0;
      for (let it = 0; it < 4; it++) {
        for (const d of this.dists) this.solveDist(d);
        // a body that has gone down lets its legs go long (no folded-knee kneeling)
        // ...but only once the trunk is down: straightening the legs while it is still kneeling
        // levered the hips back up and threw the body over a second time (the "flop")
        const relax = this.tip && this.trunkUp() < 0.3 ? 0.18 * clamp((this.t - 0.3) / 0.5, 0, 1) * clamp((2.2 - this.t) / 0.6, 0, 1) : 0;
        // elbows and wrists go limp at once (a reach held through the fall swings the arms overhead)
        for (const l of this.limits) this.solveLimit(l, l.limp ? 0 : l.relax ? Math.max(musc, relax) : musc);
        this.hangArms();
        this.collide();
      }
    }
    // settling: late in the fall, whatever lies on the road loses its velocity (ankles and
    // wrists caught between a joint limit and the ground otherwise buzz on the spot for
    // seconds); limbs still in the air keep falling
    const sleep = clamp((this.t - 1.2) / 0.6, 0, 1) * 0.6;
    if (sleep > 0) for (let i = 0; i < RAGDOLL_POINTS; i++) {
      if (this.y[i] < -14) continue;
      this.ox[i] += (this.x[i] - this.ox[i]) * sleep;
      this.oy[i] += (this.y[i] - this.oy[i]) * sleep;
    }
    // net movement over the whole step (in-step jitter that goes nowhere doesn't count)
    let maxMove = 0;
    for (let i = 0; i < RAGDOLL_POINTS; i++) maxMove = Math.max(maxMove, Math.abs(this.x[i] - x0[i]) + Math.abs(this.y[i] - y0[i]));
    this.still = maxMove < 1.0 * dt * 60 ? this.still + dt : 0;
    const propped = this.tip !== 0 && -this.y[P_PELVIS] > 0.3 * this.torsoL * 1.6 && this.t < 2.2;
    if ((this.still > 0.3 && this.t > 0.6 && !propped) || this.t > 2.6) this.settled = true;
  }

  /** Dead arms hang: each elbow and wrist is drawn gently toward lying along the trunk (shoulder → hips side).
   * Without it a zombie's reach is carried through the fall and the arms end up flung overhead. */
  private hangArms() {
    const tx = this.x[P_PELVIS] - this.x[P_NECK], ty = this.y[P_PELVIS] - this.y[P_NECK];
    const tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
    for (const [sh, el, wr] of HANG) {
      if (this.detached.has('armN') && sh === P_SH) continue;
      const k = 0.06;
      const ue = Math.hypot(this.x[el] - this.x[sh], this.y[el] - this.y[sh]);
      this.x[el] += (this.x[sh] + ux * ue - this.x[el]) * k; this.y[el] += (this.y[sh] + uy * ue - this.y[el]) * k;
      const uf = Math.hypot(this.x[wr] - this.x[el], this.y[wr] - this.y[el]);
      this.x[wr] += (this.x[el] + ux * uf - this.x[wr]) * k * 0.6; this.y[wr] += (this.y[el] + uy * uf - this.y[wr]) * k * 0.6;
    }
  }
  private trunkUp() { return Math.abs(this.y[P_PELVIS] - this.y[P_NECK]) / this.torsoL; }
  /** Bodies crumple, they don't cartwheel: the whole body's rotation about its centre of mass
   * is damped and capped (a standing fall to flat needs about 4 rad/s at the end; more is a flop). */
  maxSpin = 4.5;
  private lyingT = 0;
  private limitSpin(h: number) {
    let cx = 0, cy = 0, vx = 0, vy = 0;
    const n = RAGDOLL_POINTS;
    for (let i = 0; i < n; i++) { cx += this.x[i]; cy += this.y[i]; vx += this.x[i] - this.ox[i]; vy += this.y[i] - this.oy[i]; }
    cx /= n; cy /= n; vx /= n; vy /= n;
    let L = 0, I = 0;
    for (let i = 0; i < n; i++) {
      const rx = this.x[i] - cx, ry = this.y[i] - cy;
      L += rx * (this.y[i] - this.oy[i] - vy) - ry * (this.x[i] - this.ox[i] - vx);
      I += rx * rx + ry * ry;
    }
    if (I < 1) return;
    const w = L / I; // rad per substep
    const cap = this.maxSpin * h;
    // lying: the trunk is flat and the hips are on the road. From then on it is dead weight:
    // the rotation drains away fast (a downed body that keeps rocking or rolling reads as a flop)
    const lying = this.trunkUp() < 0.3 && -this.y[P_PELVIS] < 0.45 * this.torsoL;
    this.lyingT = lying ? this.lyingT + h : 0;
    const drag = this.lyingT > 0.12 ? 0.85 : 0.985;
    const keep = Math.abs(w) > cap ? cap / Math.abs(w) : 1;
    const dw = w * (1 - keep * drag); // always a little angular drag, hard cap above maxSpin
    if (this.lyingT > 0.12) for (let i = 0; i < n; i++) {
      this.ox[i] += (this.x[i] - this.ox[i]) * 0.12; this.oy[i] += (this.y[i] - this.oy[i]) * 0.06;
    }
    if (Math.abs(dw) < 1e-7) return;
    for (let i = 0; i < n; i++) {
      const rx = this.x[i] - cx, ry = this.y[i] - cy;
      // remove dw of rigid rotation: v -= dw × r
      this.ox[i] -= ry * dw; this.oy[i] += rx * dw;
    }
  }

  /** A body can balance sitting upright (the rigid trunk on its hips) or kneeling face-down
   * (pelvis propped on folded knees). Real ones don't: nudge the trunk over until it lies. */
  private tipOver(h: number) {
    const up = (this.y[P_PELVIS] - this.y[P_NECK]) / this.torsoL;
    // follow the way it is actually going over
    const lx = (this.x[P_NECK] - this.x[P_PELVIS]) / this.torsoL;
    if (Math.abs(lx) > 0.35) this.tip = Math.sign(lx);
    else if (up > 0.3) {
      // sitting up: go over away from the knees
      const kx = (this.x[P_NKNEE] + this.x[P_FKNEE]) / 2 - this.x[P_PELVIS];
      if (Math.abs(kx) > 0.2 * this.torsoL) this.tip = -Math.sign(kx);
    }
    const seat = -this.y[P_PELVIS] / this.torsoL;
    // the nudges fade out late: one that hasn't worked by now only slides the body along the
    // road (ankles creeping) and keeps it from ever sleeping
    const a = h * h;
    if (up > 0.2) {
      // a pure torque on the trunk (top one way, hips the other) so the body doesn't slide
      const f = 2000 * (up - 0.1) * this.tip * a;
      for (const i of [P_NECK, P_HEADBASE, P_HEAD, P_SH, P_FSH]) this.x[i] += f;
      for (const i of [P_PELVIS, P_NHIP, P_FHIP]) this.x[i] -= f * 5 / 3;
    }
    const late = clamp((2.0 - this.t) / 0.5, 0, 1);
    if (seat > 0.3 && late > 0) {
      // propped up on the knees (or sitting on the heels): the hips sink, the legs straighten out
      const k = Math.min(3, seat * 2) * late;
      for (const i of [P_PELVIS, P_NHIP, P_FHIP]) this.y[i] += 1400 * k * a;
      for (const i of [P_NKNEE, P_FKNEE]) this.y[i] += 400 * k * a;
      // thighs swing out in line with the trunk (away from the head)
      for (const i of [P_NKNEE, P_FKNEE]) this.x[i] -= 400 * this.tip * k * a;
      for (const i of [P_NECK, P_SH, P_FSH]) this.x[i] += 260 * this.tip * k * a;
    }
  }

  private solveDist(c: Dist) {
    const dx = this.x[c.b] - this.x[c.a], dy = this.y[c.b] - this.y[c.a];
    const d = Math.hypot(dx, dy) || 1e-4;
    const k = ((d - c.d) / d) * 0.5 * c.stiff;
    this.x[c.a] += dx * k; this.y[c.a] += dy * k;
    this.x[c.b] -= dx * k; this.y[c.b] -= dy * k;
  }

  private solveLimit(l: Limit, musc: number) {
    const r = this.rel(l);
    let want = r < l.lo ? l.lo : r > l.hi ? l.hi : r;
    if (musc > 0) want = want + wrapAngle(l.target - want) * musc * 0.35;
    const delta = wrapAngle(want - r);
    if (Math.abs(delta) < 1e-4) return;
    // rotate the child about the joint (and the parent a little the other way)
    this.rotate(l.c, l.j, delta * 0.5);
    // muscles alone don't brake the fall (bleeding every joint they drive made bodies topple
    // in slow motion and settle on their knees)
    if (r >= l.lo && r <= l.hi) return;
    // a limit fighting contact otherwise pumps energy: bleed the child's velocity
    const c = l.c;
    this.ox[c] += (this.x[c] - this.ox[c]) * 0.35; this.oy[c] += (this.y[c] - this.oy[c]) * 0.35;
    this.ox[l.j] += (this.x[l.j] - this.ox[l.j]) * 0.2; this.oy[l.j] += (this.y[l.j] - this.oy[l.j]) * 0.2;
  }
  private rotate(p: number, about: number, a: number) {
    const c = Math.cos(a), s = Math.sin(a);
    const dx = this.x[p] - this.x[about], dy = this.y[p] - this.y[about];
    const nx = this.x[about] + dx * c - dy * s, ny = this.y[about] + dx * s + dy * c;
    // move the previous position by the same amount: a joint limit is a kinematic projection
    // and must not inject velocity (otherwise limits fighting the ground pump energy in)
    this.ox[p] += nx - this.x[p]; this.oy[p] += ny - this.y[p];
    this.x[p] = nx; this.y[p] = ny;
  }

  private collide() {
    const f = this.friction;
    for (let i = 0; i < RAGDOLL_POINTS; i++) {
      // body thickness: points sit a little above the ground
      const r = i === P_HEAD || i === P_PELVIS || i === P_NECK ? 5 : 2.5;
      if (this.y[i] > -r) {
        this.y[i] = -r;
        this.ox[i] = this.x[i] - (this.x[i] - this.ox[i]) * (1 - f); // friction
        if (this.oy[i] < this.y[i]) this.oy[i] = this.y[i]; // dead weight: no bounce
      }
      // a body lying on the road stays down: the trunk can't be levered back up off it
      // (folding legs, a head against its limit and a sliding body otherwise lifted the hips)
      if (this.lyingT > 0.15 && TRUNK[i] && this.y[i] < -r - 6) { this.y[i] = -r - 6; this.oy[i] = this.y[i]; }
      if (this.x[i] > this.wallX) { this.x[i] = this.wallX; this.ox[i] = this.x[i]; }
    }
  }
}
