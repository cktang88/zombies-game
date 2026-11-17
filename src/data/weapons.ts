import type { WeaponDef } from '../types';

// Ammo pools: light (pistol/SMG), shell (shotgun), rifle (rifle/carbine). null = infinite (nails are crafted per night).
export const WEAPONS: Record<string, WeaponDef> = {
  service9: {
    id: 'service9', name: 'Service pistol', icon: 'icon_pistol', ammo: 'light',
    dmg: 26, rof: 4, mag: 15, reload: 1.3, spread: 0.035, pellets: 1, pierce: 0, knock: 4, auto: false, noise: 1,
    desc: 'A deputy\'s sidearm. Ugly, honest, always works.',
  },
  revolver: {
    id: 'revolver', name: '.357 revolver', icon: 'icon_revolver', ammo: 'light',
    dmg: 55, rof: 2.2, mag: 6, reload: 2.4, spread: 0.02, pellets: 1, pierce: 1, knock: 10, auto: false, noise: 1.4,
    desc: 'Six chances. Somebody\'s grandfather kept it oiled.',
  },
  pump: {
    id: 'pump', name: 'Pump shotgun', icon: 'icon_shotgun', ammo: 'shell',
    dmg: 16, rof: 1.2, mag: 6, reload: 3.2, spread: 0.13, pellets: 8, pierce: 0, knock: 30, auto: false, noise: 2,
    desc: 'Duck gun. Stops anything close enough to smell.',
  },
  hunting: {
    id: 'hunting', name: 'Bolt hunting rifle', icon: 'icon_rifle', ammo: 'rifle',
    dmg: 110, rof: 0.9, mag: 5, reload: 3.0, spread: 0.006, pellets: 1, pierce: 3, knock: 18, auto: false, noise: 2.2,
    desc: 'Deer season opened the week everything ended.',
  },
  smg: {
    id: 'smg', name: 'Submachine gun', icon: 'icon_smg', ammo: 'light',
    dmg: 20, rof: 11, mag: 30, reload: 2.0, spread: 0.07, pellets: 1, pierce: 0, knock: 3, auto: true, noise: 2.4,
    desc: 'County SWAT locker. Eats ammunition like the dead eat.',
  },
  carbine: {
    id: 'carbine', name: 'Guard carbine', icon: 'icon_carbine', ammo: 'rifle',
    dmg: 48, rof: 7, mag: 30, reload: 2.4, spread: 0.03, pellets: 1, pierce: 1, knock: 8, auto: true, noise: 2.6,
    desc: 'Serial number filed. Someone walked away from the Line.',
  },
  nailer: {
    id: 'nailer', name: 'Nail driver', icon: 'icon_nailgun', ammo: 'scrap',
    dmg: 22, rof: 6, mag: 40, reload: 2.6, spread: 0.05, pellets: 1, pierce: 1, knock: 2, auto: true, noise: 0.5,
    desc: 'Mill-shop contraption. Quiet. Feeds on scrap.',
  },
};

export const WEAPON_ORDER = ['service9', 'revolver', 'pump', 'hunting', 'smg', 'carbine', 'nailer'];

// How many rounds one craft of ammo produces & costs
export const AMMO_NAMES: Record<string, string> = { light: 'Pistol rounds', shell: 'Shells', rifle: 'Rifle rounds', scrap: 'Scrap' };
