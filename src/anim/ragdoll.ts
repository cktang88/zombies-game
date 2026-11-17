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

/** For each part (skeleton.ts order): [from point, to point]. */
export const PART_POINTS: [number, number][] = [
  [P_PELVIS, P_NECK], [P_HEADBASE, P_HEAD], [P_SH, P_NEL], [P_NEL, P_NWR], [P_NWR, P_NTIP], [P_FSH, P_FEL], [P_FEL, P_FWR], [P_FWR, P_FTIP],
  [P_NHIP, P_NKNEE], [P_NKNEE, P_NANK], [P_NANK, P_NTOE], [P_FHIP, P_FKNEE], [P_FKNEE, P_FANK], [P_FANK, P_FTOE],
];

interface Dist { a: number; b: number; d: number; stiff: number }
/** Angle limit at joint j between bone (a→j) and bone (j→c), rel = angle(j→c) - angle(a→j) - off. */
interface Limit { a: number; j: number; c: number; lo: number; hi: number; off: number; target: number }

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
    let maxMove = 0;
    for (let s = 0; s < sub; s++) {
      const damp = 0.996;
      for (let i = 0; i < RAGDOLL_POINTS; i++) {
        const vx = (this.x[i] - this.ox[i]) * damp, vy = (this.y[i] - this.oy[i]) * damp;
        this.ox[i] = this.x[i]; this.oy[i] = this.y[i];
        this.x[i] += vx; this.y[i] += vy + this.gravity * h * h;
      }
      // muscles: stiffness decays linearly over stiffT
      const musc = this.stiffT > 0 ? clamp(1 - this.t / this.stiffT, 0, 1) : 0;
      for (let it = 0; it < 4; it++) {
        for (const d of this.dists) this.solveDist(d);
        for (const l of this.limits) this.solveLimit(l, musc);
        this.collide();
      }
      for (let i = 0; i < RAGDOLL_POINTS; i++) maxMove = Math.max(maxMove, Math.abs(this.x[i] - this.ox[i]) + Math.abs(this.y[i] - this.oy[i]));
    }
    this.still = maxMove < 0.25 ? this.still + dt : 0;
    if ((this.still > 0.3 && this.t > 0.6) || this.t > 2.6) this.settled = true;
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
        if (this.oy[i] < this.y[i] - 2) this.oy[i] = this.y[i] + (this.y[i] - this.oy[i]) * 0.2; // little bounce
      }
      if (this.x[i] > this.wallX) { this.x[i] = this.wallX; this.ox[i] = this.x[i]; }
    }
  }
}
