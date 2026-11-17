// Procedural locomotion: a gait is a handful of numbers (stride, lift, duty, bob, limp,
// drag, stiffness, arm hang...) turned into foot targets (solved by leg IK, so feet stay
// planted on the ground without sliding) plus FK arm/head/torso motion.
// Variety comes from (a) several named gait presets per archetype and (b) seeded
// per-instance jitter of every parameter (see jitterGait).
import type { Channels, RigGeom } from './skeleton';
import { clamp, TAU } from './math';

export interface Gait {
  id: string;
  stride: number; // foot travel per step, fraction of leg length
  lift: number; // swing foot lift, fraction of leg length
  duty: number; // fraction of the cycle a foot is planted (0.5 run .. 0.75 shuffle)
  height: number; // pelvis height, fraction of leg length (1 = straight legs)
  bob: number; // pelvis bob, rig units
  lean: number; // base torso lean (rad)
  sway: number; // torso lean oscillation (rad)
  headTilt: number; headSway: number;
  armN: number; armF: number; // arm hang (sh) near/far
  elN: number; elF: number;
  armSwing: number; // shoulder swing amplitude
  armLag: number; // phase lag of the arm swing (floppy, dangling arms)
  limp: number; // 0..1: the near leg is hurt (short, quick stance; pelvis dips)
  drag: number; // 0..1: the far foot drags (no lift, toes down)
  stiff: number; // 0..1: stiff knees (straight legs, lurching pelvis)
  lurch: number; // 0..1: uneven cadence (phase warp)
  speedMul: number; // cadence multiplier at a given ground speed (mostly 1)
  crawl?: boolean; // arm-over-arm crawl instead of walking
  pull?: 'both' | 'one'; // crawl: two-arm or one-arm pull
}

const G = (id: string, o: Partial<Gait>): Gait => ({
  id, stride: 0.72, lift: 0.1, duty: 0.6, height: 0.985, bob: 2, lean: 0.05, sway: 0.02, headTilt: 0, headSway: 0.02,
  armN: 0.15, armF: 0.1, elN: 0.25, elF: 0.3, armSwing: 0.3, armLag: 0, limp: 0, drag: 0, stiff: 0, lurch: 0, speedMul: 1, ...o,
});

/** Gait presets. Survivors use walk/run; each Turned archetype lists its variants in styles.ts. */
export const GAITS: Record<string, Gait> = {
  walk: G('walk', {}),
  run: G('run', { stride: 0.95, lift: 0.3, duty: 0.42, height: 0.965, bob: 4, lean: 0.22, armSwing: 0.8, elN: 1.3, elF: 1.3 }),
  aimWalk: G('aimWalk', { stride: 0.62, lift: 0.08, duty: 0.65, height: 0.97, bob: 1, lean: 0.04 }),
  // Sleepers
  limpDrag: G('limpDrag', { stride: 0.42, lift: 0.08, duty: 0.68, height: 0.975, bob: 3, lean: 0.18, sway: 0.08, headTilt: 0.35, headSway: 0.08, armN: 1.2, armF: 0.9, elN: 0.25, elF: 0.4, armSwing: 0.12, armLag: 0.6, limp: 0.85, drag: 0.8, lurch: 0.5 }),
  stiffLurch: G('stiffLurch', { stride: 0.5, lift: 0.04, duty: 0.62, height: 1.0, bob: 5, lean: -0.04, sway: 0.12, headTilt: -0.15, headSway: 0.05, armN: 1.45, armF: 1.35, elN: 0.05, elF: 0.1, armSwing: 0.06, stiff: 1, lurch: 0.3 }),
  headLoll: G('headLoll', { stride: 0.46, lift: 0.1, duty: 0.66, height: 0.98, bob: 3, lean: 0.1, sway: 0.1, headTilt: 0.75, headSway: 0.3, armN: 0.15, armF: 0.05, elN: 0.15, elF: 0.2, armSwing: 0.4, armLag: 0.9, lurch: 0.35 }),
  dangle: G('dangle', { stride: 0.5, lift: 0.1, duty: 0.64, height: 0.965, bob: 4, lean: 0.38, sway: 0.06, headTilt: 0.2, headSway: 0.12, armN: -0.05, armF: -0.1, elN: 0.05, elF: 0.08, armSwing: 0.5, armLag: 1.3, lurch: 0.6 }),
  // Deer: sprinting runner
  sprint: G('sprint', { stride: 1.15, lift: 0.36, duty: 0.38, height: 0.955, bob: 5, lean: 0.45, sway: 0.03, headTilt: -0.25, armN: 0.6, armF: -0.2, elN: 1.4, elF: 1.2, armSwing: 1.1, lurch: 0.15 }),
  sprintRagged: G('sprintRagged', { stride: 1.0, lift: 0.3, duty: 0.4, height: 0.95, bob: 6, lean: 0.55, sway: 0.08, headTilt: -0.35, headSway: 0.15, armN: 1.2, armF: 1.0, elN: 0.3, elF: 0.4, armSwing: 0.5, armLag: 0.4, lurch: 0.4 }),
  // Drag: crawls
  crawl: G('crawl', { stride: 0.4, duty: 0.55, crawl: true, pull: 'both', headTilt: -0.9 }),
  crawlOneArm: G('crawlOneArm', { stride: 0.32, duty: 0.6, crawl: true, pull: 'one', headTilt: -0.7, lurch: 0.5 }),
  // Pulper: heavy waddle
  waddle: G('waddle', { stride: 0.3, lift: 0.06, duty: 0.72, height: 0.975, bob: 4, lean: -0.12, sway: 0.15, armN: 0.35, armF: 0.3, elN: 0.3, armSwing: 0.15, armLag: 0.5 }),
  // Crier: stalking
  stalk: G('stalk', { stride: 0.5, lift: 0.18, duty: 0.66, height: 0.94, bob: 1, lean: 0.4, headTilt: -0.4, headSway: 0.05, armN: 0.5, armF: 0.4, elN: 1.2, elF: 1.3, armSwing: 0.1 }),
  // Deputy: armoured trudge
  trudge: G('trudge', { stride: 0.48, lift: 0.08, duty: 0.66, height: 0.98, bob: 2, lean: 0.12, sway: 0.03, headTilt: 0.1, armN: 0.3, armF: 0.25, elN: 0.4, armSwing: 0.15 }),
  // Ferryman: ponderous stomp
  stomp: G('stomp', { stride: 0.42, lift: 0.14, duty: 0.7, height: 0.975, bob: 7, lean: 0.12, sway: 0.1, headTilt: 0.15, armN: 0.5, armF: 0.4, elN: 0.4, elF: 0.4, armSwing: 0.18, armLag: 0.4, speedMul: 0.9 }),
  // Raider: human gait with a gun
  raider: G('raider', { stride: 0.7, lift: 0.18, duty: 0.55, height: 0.975, bob: 3, lean: 0.12 }),
};

/** Seeded per-instance variation of a gait (±12% on magnitudes, small offsets on angles). */
export function jitterGait(g: Gait, r: () => number): Gait {
  const m = (v: number, k = 0.12) => v * (1 + (r() * 2 - 1) * k);
  const o = (v: number, k = 0.08) => v + (r() * 2 - 1) * k;
  return {
    ...g,
    stride: m(g.stride), lift: m(g.lift, 0.2), duty: clamp(o(g.duty, 0.03), 0.35, 0.8), height: clamp(o(g.height, 0.008), 0.9, 1),
    bob: m(g.bob, 0.25), lean: o(g.lean, 0.06), sway: m(g.sway, 0.3), headTilt: o(g.headTilt, 0.12), headSway: m(g.headSway, 0.3),
    armN: o(g.armN, 0.12), armF: o(g.armF, 0.12), elN: o(g.elN), elF: o(g.elF), armSwing: m(g.armSwing, 0.25), armLag: o(g.armLag, 0.2),
    speedMul: m(g.speedMul, 0.1),
  };
}

const swingCurve = (s: number) => s * s * (3 - 2 * s);

/**
 * Write one gait sample into the channels. `phase` 0..1 is the cycle (near foot lifts at
 * phase = duty). legLen in rig units. moving = 0..1 blends from stance to full stride.
 */
export function applyGait(ch: Channels, g: Gait, phase: number, geo: RigGeom, moving: number) {
  const legLen = geo.legLen;
  ch.handIK = 0;
  // lurch: warp the phase so steps come unevenly
  const ph = phase + g.lurch * 0.06 * Math.sin(TAU * phase);
  if (g.crawl) return applyCrawl(ch, g, ph, geo, moving);
  const stride = g.stride * legLen * moving;
  const lift = g.lift * legLen * moving;
  const foot = (q: number, hurt: number, drag: number): [number, number, number] => {
    q = ((q % 1) + 1) % 1;
    const duty = g.duty * (1 - hurt * 0.25);
    const st = stride * (1 - hurt * 0.35);
    if (q < duty) {
      const s = q / duty;
      return [st / 2 - st * s, 0, 0];
    }
    const s = (q - duty) / (1 - duty);
    const x = -st / 2 + st * swingCurve(s);
    const y = -lift * (1 - drag * 0.9) * Math.sin(Math.PI * s);
    return [x, y, drag * 0.7 * Math.sin(Math.PI * s)];
  };
  const [nx, ny, na] = foot(ph, g.limp, 0);
  const [fx, fy, fa] = foot(ph + 0.5, 0, g.drag);
  const spread = (1 - moving) * legLen * 0.1;
  ch.nFx = nx + spread * 0.6; ch.nFy = ny; ch.fFx = fx - spread * 0.6; ch.fFy = fy;
  ch.nAnk = na; ch.fAnk = fa;
  ch.footIK = 1;
  // pelvis: highest at mid-stance, dips on the hurt leg; stiff legs vault over
  const mid = Math.cos(TAU * 2 * (ph - g.duty * 0.5));
  const hurtDip = g.limp * 5 * Math.max(0, Math.cos(TAU * (ph - g.duty * 0.5)));
  const H = legLen * (g.stiff ? 1.0 - 0.03 * (1 - g.stiff) : g.height);
  ch.py = -H - g.bob * mid * moving + hurtDip * moving - (1 - moving) * 0;
  ch.px = 0;
  ch.tilt = g.stiff * 0.08 * Math.sin(TAU * ph) * moving;
  ch.lean = g.lean * (0.4 + 0.6 * moving) + g.sway * Math.sin(TAU * 2 * ph + 0.6) * moving + g.limp * 0.06 * Math.sin(TAU * ph);
  ch.head = g.headTilt + g.headSway * Math.sin(TAU * ph + 1.2);
  const sw = g.armSwing * moving;
  ch.nSh = g.armN - sw * Math.sin(TAU * ph - g.armLag);
  ch.fSh = g.armF + sw * Math.sin(TAU * ph - g.armLag);
  ch.nEl = g.elN + Math.abs(sw) * 0.15 * (1 + Math.sin(TAU * ph - g.armLag));
  ch.fEl = g.elF + Math.abs(sw) * 0.15 * (1 - Math.sin(TAU * ph - g.armLag));
}

function applyCrawl(ch: Channels, g: Gait, ph: number, geo: RigGeom, moving: number) {
  // torso horizontal, belly on the ground, legs trailing; hands plant on the ground ahead
  // and pull (IK, so a planted hand stays put while the body slides over it)
  const legLen = geo.legLen;
  ch.lean = 1.42 + 0.05 * Math.sin(TAU * ph) * moving;
  ch.tilt = 0;
  ch.py = -geo.height * 0.085 - 2 * Math.abs(Math.sin(TAU * ph)) * moving;
  ch.px = -legLen * 0.1;
  ch.head = g.headTilt + 0.08 * Math.sin(TAU * ph);
  ch.footIK = 0;
  ch.nHip = -1.45 + 0.12 * Math.sin(TAU * ph) * moving; ch.nKnee = 0.25 + 0.3 * Math.max(0, Math.sin(TAU * ph)) * moving;
  ch.fHip = -1.38 - 0.1 * Math.sin(TAU * ph) * moving; ch.fKnee = 0.45 * moving + 0.15;
  ch.nAnk = 0.9; ch.fAnk = 0.9;
  const shX = ch.px + geo.torsoLen * 0.9;
  const near = shX + (geo.ua + geo.fa) * 0.75, far = shX + (geo.ua + geo.fa) * 0.15;
  const stride = (near - far) * Math.max(0.25, moving);
  const hand = (q: number): [number, number] => {
    q = ((q % 1) + 1) % 1;
    if (q < g.duty) return [near - stride * (q / g.duty), 0];
    const s = (q - g.duty) / (1 - g.duty);
    return [near - stride + stride * swingCurve(s), -geo.height * 0.06 * Math.sin(Math.PI * s)];
  };
  const a = hand(ph);
  const b = g.pull === 'one' ? [shX + geo.ua * 0.3, -geo.height * 0.02] : hand(ph + 0.5);
  ch.nHx = a[0]; ch.nHy = a[1]; ch.fHx = b[0]; ch.fHy = b[1]; ch.handIK = 1;
  if (g.pull === 'one') { ch.fSh = 0.9; ch.fEl = 2.0; }
}
