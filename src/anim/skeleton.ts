// The fixed humanoid cutout skeleton: part indices, the per-frame channel set every layer
// writes into, and the rest geometry derived from a part atlas.
//
// Angle conventions (rig space faces RIGHT, y down, canvas radians):
//   torso world   = -π/2 + tilt + lean           (lean > 0 = top of the torso forward)
//   head world    = torso + (rest head - rest torso) + head     (head > 0 = chin down)
//   upper arm     = torso + π - sh                (sh 0 = hanging, π/2 = straight forward)
//   forearm       = upper arm - el                (el > 0 = elbow flexed)
//   hand          = forearm - wr
//   thigh         = π/2 + tilt - hip              (hip > 0 = thigh forward)
//   shin          = thigh + knee                  (knee > 0 = flexed)
//   foot          = shin - π/2 + ank              (ank > 0 = toes down)
import type { RigMeta } from './assets';

// part indices
export const TORSO = 0, HEAD = 1, N_UA = 2, N_FA = 3, N_H = 4, F_UA = 5, F_FA = 6, F_H = 7, N_TH = 8, N_SN = 9, N_FT = 10, F_TH = 11, F_SN = 12, F_FT = 13;
export const PART_COUNT = 14;
export const PART_NAMES = ['torso', 'head', 'upperArm', 'forearm', 'hand', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'thigh', 'shin', 'foot'];

export type TargetSpace = 'gun' | 'body' | 'ground' | 'world';
/** Where a hand (or foot) should go. gun: an anchor name of the held weapon; body: a named
 * body point (BODY_POINTS); ground: dx forward of the root, dy up; world: rig-local px.
 * `a` = rotation of the hand art (gun space: relative to the gun; else absolute). */
export interface Target { s: TargetSpace; p?: string; dx?: number; dy?: number; a?: number; pose?: string }

/** Body points in the torso frame: [along torso from pelvis (fraction of torso length), forward px]. */
export const BODY_POINTS: Record<string, [number, number]> = {
  chest: [0.62, 16], belt: [0.08, 6], pouch: [0.1, 14], hip: [0.02, -4], face: [1.12, 14], mouth: [1.1, 18],
  shoulder: [0.92, 4], back: [0.95, -18], quiver: [1.0, -14], belly: [0.35, 18], groin: [-0.05, 10],
};

export interface Channels {
  px: number; py: number; tilt: number; lean: number; head: number; crouch: number;
  nSh: number; nEl: number; nWr: number; fSh: number; fEl: number; fWr: number;
  nHip: number; nKnee: number; nAnk: number; fHip: number; fKnee: number; fAnk: number;
  nFx: number; nFy: number; fFx: number; fFy: number; footIK: number;
  nHx: number; nHy: number; fHx: number; fHy: number; handIK: number;
  ready: number; gunTilt: number; gunDX: number; gunDY: number; aimW: number;
  nIK: number; fIK: number; cyl: number; draw: number; flash: number;
}
export type NumCh = keyof Channels;
export const CH_DEFAULT: Channels = {
  px: 0, py: 0, tilt: 0, lean: 0, head: 0, crouch: 0,
  nSh: 0.15, nEl: 0.25, nWr: 0, fSh: 0.1, fEl: 0.3, fWr: 0,
  nHip: 0, nKnee: 0.05, nAnk: 0, fHip: 0, fKnee: 0.05, fAnk: 0,
  nFx: 6, nFy: 0, fFx: -8, fFy: 0, footIK: 1,
  nHx: 0, nHy: 0, fHx: 0, fHy: 0, handIK: 0,
  ready: 0, gunTilt: 0, gunDX: 0, gunDY: 0, aimW: 1,
  nIK: 0, fIK: 0, cyl: 0, draw: 0, flash: 0,
};

/** Rest geometry of one character, in rig units, relative to the pelvis. */
export interface RigGeom {
  torsoLen: number; restTorso: number; restHeadRel: number;
  sh: [number, number]; // shoulder in torso frame (along, perp)
  fShOff: number; // far shoulder perp offset
  nHip: [number, number]; fHip: [number, number]; // hips in pelvis frame
  ua: number; fa: number; hand: number; th: number; sn: number; ft: number; headLen: number;
  legLen: number; // thigh + shin + ankle height
  ankleH: number;
  height: number;
}
const cache = new WeakMap<RigMeta, RigGeom>();
export function geomOf(meta: RigMeta): RigGeom {
  const hit = cache.get(meta);
  if (hit) return hit;
  const J = meta.joints, P = meta.parts;
  const restT = Math.atan2(J.neck[1] - J.pelvis[1], J.neck[0] - J.pelvis[0]);
  const ux = Math.cos(restT), uy = Math.sin(restT), vx = -uy, vy = ux; // v = forward-ish (right of up)
  const inT = (p: [number, number]): [number, number] => {
    const dx = p[0] - J.pelvis[0], dy = p[1] - J.pelvis[1];
    return [dx * ux + dy * uy, dx * vx + dy * vy];
  };
  const len = (n: string, a: string, b: string) => P[n]?.len ?? Math.hypot(J[b][0] - J[a][0], J[b][1] - J[a][1]);
  const ankleH = Math.max(4, (meta.ground - J.ankle[1]) * 0.9);
  const g: RigGeom = {
    torsoLen: Math.hypot(J.neck[0] - J.pelvis[0], J.neck[1] - J.pelvis[1]),
    restTorso: restT,
    restHeadRel: Math.atan2(J.headTop[1] - J.neck[1], J.headTop[0] - J.neck[0]) - restT,
    sh: inT(J.shoulder),
    fShOff: -0.035 * meta.height,
    nHip: inT(J.hip),
    fHip: inT(J.bHip ?? J.hip),
    ua: len('upperArm', 'shoulder', 'elbow'), fa: len('forearm', 'elbow', 'wrist'), hand: len('hand', 'wrist', 'handTip'),
    th: len('thigh', 'hip', 'knee'), sn: len('shin', 'knee', 'ankle'), ft: len('foot', 'ankle', 'toe'),
    headLen: len('head', 'neck', 'headTop'),
    legLen: 0, ankleH, height: meta.height,
  };
  g.legLen = g.th + g.sn + ankleH;
  cache.set(meta, g);
  return g;
}
