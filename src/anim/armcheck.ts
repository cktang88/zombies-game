// Arm measurements of a posed rig against real proportions and real shooting stances
// (docs/research/11-shooting-poses.md §arms). Used by the animlab ?debug overlay and by
// tools/e2e/pose-check.cjs, which fails when a stance folds an arm up against the shoulder.
import { ARM, F_FA, F_H, F_UA, N_FA, N_H, N_UA } from './skeleton';
import type { Rig } from './rig';

export interface ArmM {
  /** interior angle at the elbow, degrees (180 = straight) */
  elbow: number;
  /** shoulder→wrist over the arm's full length (1 = locked out) */
  reach: number;
  /** wrist forward of / below the shoulder, fraction of height */
  fwd: number; down: number;
}
export interface ArmReport { ua: number; fa: number; trigger: ArmM; support: ArmM; stance: string; problems: string[] }

/** Stance targets: [min, max] elbow (deg), reach, and the trigger wrist's forward distance (×H). */
export const ARM_TARGETS: Record<string, { trig: [number, number]; trigReach: [number, number]; sup: [number, number]; supReach: [number, number]; trigFwd: number }> = {
  rifle: { trig: [60, 115], trigReach: [0.5, 0.85], sup: [125, 178], supReach: [0.82, 0.995], trigFwd: 0.17 },
  shotgun: { trig: [60, 115], trigReach: [0.5, 0.85], sup: [125, 178], supReach: [0.82, 0.995], trigFwd: 0.17 },
  smg: { trig: [55, 115], trigReach: [0.45, 0.85], sup: [95, 178], supReach: [0.7, 0.995], trigFwd: 0.15 },
  hip: { trig: [90, 178], trigReach: [0.7, 1], sup: [140, 180], supReach: [0.9, 1.0], trigFwd: 0.14 },
  pistol: { trig: [150, 180], trigReach: [0.95, 1.0], sup: [135, 180], supReach: [0.9, 1.0], trigFwd: 0.28 },
  pistol1: { trig: [150, 180], trigReach: [0.95, 1.0], sup: [0, 180], supReach: [0, 1.0], trigFwd: 0.28 },
};

function arm(rig: Rig, s: number, e: number, w: number, H: number, L: number): ArmM {
  const J = rig.jx, K = rig.jy;
  const ux = J[s] - J[e], uy = K[s] - K[e], fx = J[w] - J[e], fy = K[w] - K[e];
  const c = (ux * fx + uy * fy) / (Math.hypot(ux, uy) * Math.hypot(fx, fy) || 1);
  return { elbow: Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI, reach: Math.hypot(J[w] - J[s], K[w] - K[s]) / L, fwd: (J[w] - J[s]) / H, down: (K[w] - K[s]) / H };
}

/** Measure a rig as last solved (call after update / draw). Facing right, gun up (aiming). */
export function measureArms(rig: Rig): ArmReport | null {
  const g = rig.geo;
  if (!g) return null;
  const H = g.height, L = g.ua + g.fa;
  // with a firearm the support role is on the far arm and the trigger on the near arm
  const trig = arm(rig, N_UA, N_FA, N_H, H, L), sup = arm(rig, F_UA, F_FA, F_H, H, L);
  const r: ArmReport = { ua: g.ua / H, fa: g.fa / H, trigger: trig, support: sup, stance: rig.stance.id, problems: [] };
  const P = r.problems;
  if (r.ua < ARM.ua[0] - 0.005 || r.ua > ARM.ua[1] + 0.005) P.push(`upper arm ${r.ua.toFixed(3)} H`);
  if (r.fa < ARM.fa[0] - 0.005 || r.fa > ARM.fa[1] + 0.005) P.push(`forearm ${r.fa.toFixed(3)} H`);
  const t = ARM_TARGETS[r.stance];
  if (t) {
    const inR = (v: number, [a, b]: [number, number]) => v >= a && v <= b;
    if (!inR(trig.elbow, t.trig)) P.push(`trigger elbow ${trig.elbow.toFixed(0)}° (want ${t.trig[0]}-${t.trig[1]})`);
    if (!inR(trig.reach, t.trigReach)) P.push(`trigger reach ${trig.reach.toFixed(2)} (want ${t.trigReach[0]}-${t.trigReach[1]})`);
    if (trig.fwd < t.trigFwd) P.push(`trigger hand ${trig.fwd.toFixed(2)} H ahead of the shoulder (want ≥ ${t.trigFwd}): scrunched`);
    if (!inR(sup.elbow, t.sup)) P.push(`support elbow ${sup.elbow.toFixed(0)}° (want ${t.sup[0]}-${t.sup[1]})`);
    if (!inR(sup.reach, t.supReach)) P.push(`support reach ${sup.reach.toFixed(2)} (want ${t.supReach[0]}-${t.supReach[1]})`);
  }
  return r;
}
