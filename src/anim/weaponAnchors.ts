/* Weapon anchor points for the bone rig, estimated by eye from each side-view icon
 * (public/sprites/icon_*.png) on a 10px grid. All points are in the icon's own pixel space.
 * `flip: true` marks icons drawn muzzle-LEFT (icon_pistol, icon_smg, the hatchet); the rig
 * mirrors them so every gun points along +x in "gun space".
 *
 *   grip     palm centre of the trigger hand (pistol grip / stock wrist)
 *   fore     palm centre of the support hand (fore-end, pump, vertical grip)
 *   butt     where the stock meets the shoulder (long guns)
 *   muzzle   muzzle flash / projectile origin
 *   mag      rectangle [x,y,w,h] of the detachable magazine/box/canister: it is cut out of the
 *            icon at load time and becomes its own sprite that the hand can carry
 *   magwell  where the mag seats (its top-centre when inserted)
 *   rack     charging handle / slide rear / bolt handle / lever / pump - what the hand cycles
 *   port     where loose rounds go in (shotgun loading gate, open breech, rifle top, cylinder)
 *   len      on-screen length of the weapon in rig units (240 = character height, ~133 per metre)
 *   hold     how it is held: 'pistol' (1 or 2 hands), 'long' (shouldered), 'tube' (on the
 *            shoulder), 'bow', 'melee'
 *   reload   which reload choreography (see clips.ts RELOADS)
 */
export type HoldKind = 'pistol' | 'long' | 'tube' | 'bow' | 'melee';
export type ReloadKind = 'mag' | 'pistolMag' | 'shells' | 'bolt' | 'lever' | 'break' | 'revolver' | 'bow' | 'crossbow' | 'muzzle' | 'tube' | 'none';
export type V2 = [number, number];
export interface WeaponAnchors {
  icon: string;
  flip?: boolean;
  len: number;
  hold: HoldKind;
  reload: ReloadKind;
  grip: V2;
  fore?: V2;
  butt?: V2;
  muzzle: V2;
  mag?: [number, number, number, number];
  magwell?: V2;
  rack?: V2;
  port?: V2;
  /** one-handed by default (pistols): the support hand may still join when aiming */
  oneHand?: boolean;
}

export const WEAPON_ANCHORS: Record<string, WeaponAnchors> = {
  // ---- handguns
  service9: { icon: 'icon_pistol', flip: true, len: 28, hold: 'pistol', reload: 'pistolMag', grip: [108, 66], muzzle: [2, 15], mag: [96, 62, 32, 34], magwell: [114, 62], rack: [128, 12] },
  revolver: { icon: 'icon_revolver', len: 40, hold: 'pistol', reload: 'revolver', grip: [44, 64], muzzle: [188, 20], port: [108, 26], rack: [58, 8] },
  m1911: { icon: 'icon_m1911', len: 30, hold: 'pistol', reload: 'pistolMag', grip: [34, 64], muzzle: [148, 15], mag: [12, 60, 32, 36], magwell: [30, 60], rack: [6, 14] },
  mp93: { icon: 'icon_mp93', len: 40, hold: 'pistol', reload: 'pistolMag', grip: [26, 68], fore: [100, 58], muzzle: [126, 16], mag: [14, 62, 22, 34], magwell: [25, 62], rack: [6, 12] },
  flaregun: { icon: 'icon_flaregun', len: 34, hold: 'pistol', reload: 'break', grip: [26, 70], muzzle: [148, 25], port: [86, 25], rack: [62, 44] },
  // ---- SMG / carbines
  smg: { icon: 'icon_smg', flip: true, len: 74, hold: 'long', reload: 'mag', grip: [120, 55], fore: [45, 48], butt: [172, 40], muzzle: [2, 18], mag: [48, 50, 22, 42], magwell: [59, 50], rack: [36, 12] },
  ar15: { icon: 'icon_ar15', len: 118, hold: 'long', reload: 'mag', grip: [70, 58], fore: [165, 30], butt: [4, 34], muzzle: [240, 30], mag: [112, 50, 30, 44], magwell: [126, 50], rack: [90, 22] },
  carbine: { icon: 'icon_carbine', len: 112, hold: 'long', reload: 'mag', grip: [74, 58], fore: [180, 30], butt: [4, 30], muzzle: [260, 22], mag: [113, 50, 32, 46], magwell: [128, 50], rack: [96, 24] },
  lmg: { icon: 'icon_lmg', len: 132, hold: 'long', reload: 'mag', grip: [74, 58], fore: [195, 30], butt: [4, 36], muzzle: [255, 30], mag: [94, 44, 32, 36], magwell: [110, 44], rack: [62, 24] },
  nailer: { icon: 'icon_nailgun', len: 62, hold: 'long', reload: 'mag', grip: [34, 64], fore: [100, 46], butt: [4, 22], muzzle: [222, 22], mag: [48, 68, 64, 26], magwell: [80, 68], rack: [60, 10] },
  rivet: { icon: 'icon_rivet', len: 46, hold: 'pistol', reload: 'mag', grip: [38, 52], muzzle: [90, 15], mag: [40, 48, 30, 48], magwell: [55, 50], rack: [20, 10] },
  // ---- rifles
  hunting: { icon: 'icon_rifle', len: 146, hold: 'long', reload: 'bolt', grip: [104, 60], fore: [230, 48], butt: [4, 64], muzzle: [370, 32], mag: [152, 52, 30, 18], magwell: [166, 52], rack: [138, 44], port: [166, 40] },
  scoped: { icon: 'icon_scoped', len: 146, hold: 'long', reload: 'bolt', grip: [90, 50], fore: [190, 36], butt: [4, 44], muzzle: [330, 30], mag: [128, 42, 26, 28], magwell: [141, 42], rack: [112, 26], port: [140, 32] },
  r22: { icon: 'icon_r22rifle', len: 132, hold: 'long', reload: 'mag', grip: [146, 34], fore: [300, 20], butt: [5, 58], muzzle: [446, 12], mag: [206, 34, 30, 22], magwell: [221, 34], rack: [172, 22] },
  lever: { icon: 'icon_lever', len: 134, hold: 'long', reload: 'lever', grip: [148, 44], fore: [300, 24], butt: [4, 54], muzzle: [445, 15], rack: [150, 62], port: [196, 32] },
  muzzle: { icon: 'icon_muzzle', len: 172, hold: 'long', reload: 'muzzle', grip: [140, 42], fore: [300, 26], butt: [4, 62], muzzle: [445, 20], port: [445, 20], rack: [400, 36] },
  // ---- shotguns
  pump: { icon: 'icon_shotgun', len: 140, hold: 'long', reload: 'shells', grip: [120, 54], fore: [340, 34], butt: [6, 64], muzzle: [465, 10], port: [175, 44], rack: [340, 34] },
  autoshot: { icon: 'icon_autoshotgun', len: 124, hold: 'long', reload: 'shells', grip: [24, 62], fore: [250, 26], butt: [8, 32], muzzle: [350, 15], port: [120, 42], rack: [150, 12] },
  coach: { icon: 'icon_coachgun', len: 124, hold: 'long', reload: 'break', grip: [112, 40], fore: [240, 26], butt: [4, 62], muzzle: [372, 15], port: [172, 18], rack: [165, 30] },
  snake410: { icon: 'icon_snake410', len: 124, hold: 'long', reload: 'break', grip: [120, 44], fore: [250, 22], butt: [6, 70], muzzle: [373, 10], port: [176, 16], rack: [165, 30] },
  pipe: { icon: 'icon_pipegun', len: 120, hold: 'long', reload: 'break', grip: [126, 40], fore: [260, 26], butt: [6, 56], muzzle: [366, 15], port: [160, 20], rack: [150, 30] },
  // ---- bows
  compound: { icon: 'icon_bow', len: 128, hold: 'bow', reload: 'bow', grip: [140, 55], muzzle: [268, 36], rack: [92, 36] },
  crossbow: { icon: 'icon_crossbow', len: 118, hold: 'long', reload: 'crossbow', grip: [104, 50], fore: [160, 42], butt: [6, 54], muzzle: [270, 48], rack: [222, 40], port: [190, 30] },
  // ---- launchers
  law: { icon: 'icon_law', len: 120, hold: 'tube', reload: 'tube', grip: [155, 80], fore: [70, 66], butt: [190, 45], muzzle: [434, 42] },
  m79: { icon: 'icon_m79', len: 96, hold: 'long', reload: 'break', grip: [126, 50], fore: [220, 36], butt: [4, 70], muzzle: [280, 25], port: [182, 26], rack: [165, 36] },
  pipemortar: { icon: 'icon_pipemortar', len: 118, hold: 'long', reload: 'break', grip: [114, 64], fore: [200, 40], butt: [4, 60], muzzle: [322, 25], port: [152, 26], rack: [140, 36] },
  // ---- melee
  hatchet: { icon: 'icon_mod_hatchet', flip: true, len: 62, hold: 'melee', reload: 'none', grip: [160, 26], muzzle: [10, 26] },
  // the hand weapons of data/weapons.ts MELEE (icons 72 px tall, handle on the left)
  fellingaxe: { icon: 'icon_m_fellingaxe', len: 80, hold: 'melee', reload: 'none', grip: [30, 40], muzzle: [250, 30] },
  crowbar: { icon: 'icon_m_crowbar', len: 70, hold: 'melee', reload: 'none', grip: [40, 38], muzzle: [368, 36] },
  bat: { icon: 'icon_m_bat', len: 78, hold: 'melee', reload: 'none', grip: [60, 40], muzzle: [450, 30] },
  machete: { icon: 'icon_m_machete', len: 66, hold: 'melee', reload: 'none', grip: [80, 38], muzzle: [650, 40] },
  fireaxe: { icon: 'icon_m_fireaxe', len: 74, hold: 'melee', reload: 'none', grip: [24, 44], muzzle: [165, 30] },
  sledge: { icon: 'icon_m_sledge', len: 80, hold: 'melee', reload: 'none', grip: [22, 40], muzzle: [190, 36] },
  boathook: { icon: 'icon_m_boathook', len: 120, hold: 'melee', reload: 'none', grip: [60, 38], muzzle: [422, 30] },
  knife: { icon: 'icon_m_knife', len: 34, hold: 'melee', reload: 'none', grip: [110, 38], muzzle: [582, 20] },
  chainsaw: { icon: 'icon_m_chainsaw', len: 70, hold: 'melee', reload: 'none', grip: [44, 22], muzzle: [200, 40] },
};

/** Fallback by weapon class for guns added later without hand-placed anchors. */
export function anchorsFor(defId: string): WeaponAnchors {
  return WEAPON_ANCHORS[defId] ?? WEAPON_ANCHORS.hunting;
}
