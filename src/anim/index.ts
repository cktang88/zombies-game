// Public surface of the animation system. See docs/research/09-animation.md.
export { createRig, Rig, type RigKind, type PlayOpts, type CreateOpts } from './rig';
export { loadRig, loadGun, loadAllGuns, getRig, getGun } from './assets';
export { CLIPS, RELOADS, type Clip } from './clips';
export { GAITS, type Gait } from './gait';
export { STYLES, type Style } from './styles';
export { WEAPON_ANCHORS, anchorsFor, type WeaponAnchors } from './weaponAnchors';
export type { DieOpts, DeathKind } from './ragdoll';

/** Display scale for a rig drawn `heightPx` tall (rigs are authored 240 units tall). */
export const rigScale = (heightPx: number) => heightPx / 240;
