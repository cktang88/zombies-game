// Public surface of the animation system. See docs/research/09-animation.md.
export { createRig, Rig, type RigKind, type PlayOpts, type CreateOpts } from './rig';
export { loadRig, loadGun, loadAllGuns, getRig, getGun, gradedAtlas, silAtlas, outlineAtlas, bakedIcon, type RigAsset, type GunLook } from './assets';
export { flipbookStats, setFlipBudget } from './flipbook';
export { CLIPS, RELOADS, type Clip } from './clips';
export { GAITS, type Gait } from './gait';
export { STYLES, SPRITE_RIGS, type Style, type SpriteRig } from './styles';
export { WEAPON_ANCHORS, anchorsFor, type WeaponAnchors } from './weaponAnchors';
export type { DieOpts, DeathKind } from './ragdoll';
export { measureArms, ARM_TARGETS, type ArmReport } from './armcheck';

/** Display scale for a rig drawn `heightPx` tall (rigs are authored 240 units tall). */
export const rigScale = (heightPx: number) => heightPx / 240;
