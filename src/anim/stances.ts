// Shooting stances and depth layering per weapon class, as data (docs/research/11-shooting-poses.md).
//
// Rig space faces RIGHT and the camera sees the character's RIGHT side. A right-handed shooter's
// trigger (strong) arm is therefore the NEAR arm, drawn over the gun; the support (weak, left) arm
// is the FAR arm: its upper arm hides behind the torso, its forearm runs under the gun (in front of
// the chest, behind the gun) and its hand wraps the fore-end. The weak (far, left) foot leads.
//
// Hand ROLES vs physical SIDES: clips (clips.ts) address hands by role: `n` = support / off hand
// (mags, shells, the pump), `f` = trigger / strong hand. With a firearm in the hands the rig solves
// role n on the far arm and role f on the near arm (Rig.swap); bare-handed or with a hand weapon,
// role n is the near (right) arm, so a hatchet is swung with the right hand.

/** Draw slots, in physical terms: n = near (camera side, right), f = far (left). */
export type Slot =
  | 'fLeg' | 'nLeg' | 'torso' | 'head'
  | 'fUA' | 'fFA' | 'fH' | 'nUA' | 'nFA' | 'nH' | 'nShadow'
  | 'gun' | 'slung' | 'string' | 'melee';

export type StanceId = 'free' | 'rifle' | 'shotgun' | 'smg' | 'hip' | 'pistol' | 'pistol1' | 'bow' | 'tube';

export interface Stance {
  id: StanceId;
  /** back-to-front draw order */
  layers: Slot[];
  /** standing foot x (fraction of leg length, + = forward of the pelvis): [near, far]. Far = weak foot, leads. */
  feet: [number, number];
  /** pelvis height while planted (fraction of leg length; < 1 = soft knees) */
  height: number;
  /** base forward lean of the torso while aiming (rad) and its share of the aim angle */
  lean: number; leanAim: number;
  /** head follows this share of the aim angle; `cheek` = the head drops onto the stock (cheek weld) */
  headAim: number; cheek: boolean;
  /** [up, forward] rig units in the torso frame: long guns put the butt there relative to the NECK base
   * (the shoulder pocket sits beside it, the bore at about collar height, so the cheek can drop onto
   * the comb); pistols lift the grip by `up` from the near shoulder toward the eye line */
  pocket: [number, number];
  /** pistols: fraction of arm reach the gun is pushed out to */
  ext?: number;
  /** low ready: muzzle-down angle (rad) when not aiming / walking; pocket drop (rig units) */
  lowAngle: number; lowDrop: number;
  /** recoil: torso rocks back (rad per recoil unit) and the pelvis shifts back */
  recoilLean: number; recoilBack: number;
}

/** The far (support) arm passes behind the torso, its forearm runs under the gun, its hand wraps the
 * fore-end in front of the gun; the trigger arm and hand are over everything. Head before the gun:
 * the stock covers the jaw (cheek weld seen from the right). */
const LONG: Slot[] = ['fLeg', 'fUA', 'slung', 'torso', 'nLeg', 'head', 'fFA', 'gun', 'fH', 'nShadow', 'nUA', 'nFA', 'nH'];
/** Two-handed pistol: the far arm reaches out behind the near one; the support hand cups the grip behind it. */
const PISTOL: Slot[] = ['fLeg', 'fUA', 'slung', 'torso', 'nLeg', 'head', 'fFA', 'fH', 'gun', 'nShadow', 'nUA', 'nFA', 'nH'];
/** Bow: the bow hand is the far (left) one, the right hand draws the string to the cheek. */
const BOW: Slot[] = ['fLeg', 'fUA', 'torso', 'nLeg', 'head', 'fFA', 'gun', 'fH', 'string', 'nShadow', 'nUA', 'nFA', 'nH'];
/** Bare hands / hand weapons: the classic order, far limbs behind the trunk. */
const FREE: Slot[] = ['fLeg', 'fUA', 'fFA', 'slung', 'torso', 'head', 'nLeg', 'gun', 'fH', 'string', 'nShadow', 'nUA', 'nFA', 'nH', 'melee'];

const S = (id: StanceId, o: Partial<Stance>): Stance => ({
  id, layers: LONG, feet: [-0.2, 0.24], height: 0.955, lean: 0.12, leanAim: 0.25, headAim: 0.8, cheek: true,
  pocket: [-3, 1], lowAngle: 0.8, lowDrop: 6, recoilLean: 0.009, recoilBack: 0.12, ...o,
});

export const STANCES: Record<StanceId, Stance> = {
  free: S('free', { layers: FREE, feet: [0.06, -0.06], height: 0.985, lean: 0, leanAim: 0, headAim: 0.4, cheek: false, recoilLean: 0.004, recoilBack: 0 }),
  // bladed rifle stance: weak foot ~0.45 leg lengths ahead of the strong one, soft knees, nose over the toes
  rifle: S('rifle', {}),
  // a shotgun is fought more aggressively: more lean into the recoil, a bit lower
  shotgun: S('shotgun', { lean: 0.16, height: 0.945, feet: [-0.22, 0.25], recoilLean: 0.012, recoilBack: 0.2 }),
  // short stock: the same weld, the gun sits a little higher and closer
  smg: S('smg', { lean: 0.14, pocket: [-2, 1] }),
  // hip fire (LMG): butt tucked under the armpit, gun at the belt line, wide and low, leaning into it
  hip: S('hip', { lean: 0.24, leanAim: 0.15, height: 0.93, feet: [-0.26, 0.26], headAim: 0.4, cheek: false, pocket: [-50, 10], lowAngle: 0.45, lowDrop: 4, recoilLean: 0.006, recoilBack: 0.25 }),
  // two-handed pistol (isosceles seen from the side: both arms out, slight forward lean, head erect)
  pistol: S('pistol', { layers: PISTOL, feet: [-0.14, 0.16], height: 0.965, lean: 0.12, leanAim: 0.2, headAim: 0.45, cheek: false, pocket: [9, 0], ext: 0.94, lowAngle: 0.75, lowDrop: 0, recoilLean: 0.006, recoilBack: 0.05 }),
  pistol1: S('pistol1', { layers: PISTOL, feet: [-0.12, 0.14], height: 0.97, lean: 0.08, leanAim: 0.15, headAim: 0.45, cheek: false, pocket: [9, 0], ext: 0.97, lowAngle: 0.8, lowDrop: 0, recoilLean: 0.006, recoilBack: 0.05 }),
  bow: S('bow', { layers: BOW, feet: [-0.16, 0.18], height: 0.97, lean: 0.04, leanAim: 0.15, headAim: 0.6, cheek: false, lowAngle: 0.5, lowDrop: 0, recoilLean: 0, recoilBack: 0 }),
  // launcher tube on the shoulder: upright, braced
  tube: S('tube', { lean: 0.1, leanAim: 0.2, headAim: 0.6, cheek: false, pocket: [2, -2], lowAngle: 0.35, lowDrop: 4, recoilLean: 0.014, recoilBack: 0.3 }),
};
