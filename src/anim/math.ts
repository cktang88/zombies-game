// Small math helpers for the rig. Angles are canvas radians (y down, +x = 0, +π/2 = down).
export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'step' | 'back';
export function ease(k: Ease | undefined, t: number): number {
  switch (k) {
    case 'in': return t * t;
    case 'out': return 1 - (1 - t) * (1 - t);
    case 'step': return t < 1 ? 0 : 1;
    case 'back': { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
    case 'linear': return t;
    default: return t * t * (3 - 2 * t); // inout (smoothstep)
  }
}
/** Deterministic per-instance randomness (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Analytic two-bone IK. Root (rx,ry), target (tx,ty), bone lengths a,b. Returns the world
 * angles of both bones. `bend` picks the elbow/knee side: +1 = clockwise of the root→target
 * line (in screen space: below a rightward reach), -1 = the other side.
 */
export function ik2(rx: number, ry: number, tx: number, ty: number, a: number, b: number, bend: number, out: { a1: number; a2: number; reach: number }) {
  let dx = tx - rx, dy = ty - ry;
  let d = Math.hypot(dx, dy);
  const maxD = (a + b) * 0.9995, minD = Math.abs(a - b) + 1e-3;
  out.reach = d / (a + b);
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  if (d < minD) d = minD;
  const base = Math.atan2(dy, dx);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const A = Math.acos(cosA);
  const a1 = base + bend * A;
  const ex = rx + Math.cos(a1) * a, ey = ry + Math.sin(a1) * a;
  out.a1 = a1;
  out.a2 = Math.atan2(ry + dy - ey, rx + dx - ex);
  return out;
}
