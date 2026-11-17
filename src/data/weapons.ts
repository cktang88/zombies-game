import type { Res, WeaponDef, WeaponItem } from '../types';

/* =====================================================================================
 * THE ARSENAL — weapon & ammunition data, and the firing CONTRACT for night/day combat.
 *
 * Combat code (src/night/battle.ts, src/night/expedition.ts) should NOT read WEAPONS[id]
 * stats directly any more. Call `fireProfile(weaponItem)` once per shot / reload and use
 * the folded numbers. It combines: the weapon def + the selected bullet type
 * (WeaponItem.ammoType, validated against the gun's caliber) + the gun's condition.
 *
 *   dmg        damage per pellet/projectile (condition already folded in)
 *   pellets    projectiles per round (buckshot 8, slug 1)
 *   spread     radians. pellets > 1: the pellet cone (not scaled by aim).
 *              pellets == 1: base spread, scale by shooter aim as before ((1.75 - aim) + bloom).
 *   pierce     extra bodies a projectile passes through (70% damage falloff each, as before)
 *   armorPen   0..1 fraction of a Deputy's body armour ignored; negative = armour counts MORE
 *              (hollow-points). Use armorDamage(dmg, z.def.armor, armorPen) for body hits.
 *   knock      knockback per projectile (pellets still apply ×0.25 each as before)
 *   noise      noise added per round fired
 *   incendiary sets the target burning: apply BURN.dps for BURN.time seconds (stack = refresh)
 *   flare      the round lights the road where it lands: a light of FLARE_LIGHT.r for FLARE_LIGHT.time s
 *   smoke      black-powder cloud at the muzzle (cosmetic, maybe a brief aim penalty)
 *   ammoRes    the stores key rounds are drawn from (null = never runs out)
 *   perShot    stores units consumed per round loaded (nails: 0.05 scrap; .410: 0.5 shell)
 *   reload     if reloadPerRound: seconds PER ROUND (firing interrupts it, like the old pump);
 *              else seconds for the whole magazine
 *   mag        rounds per magazine
 *   rof        trigger pulls (or bursts) per second -> cooldown = 1 / rof
 *   auto       hold to fire
 *   burst      rounds per trigger pull; each takes one round from the mag. burstGap seconds
 *              apart (0 = simultaneously, e.g. both barrels of the coach gun)
 *   jam        chance per trigger pull that the gun jams (~0.9s lost) — wear + improvised guns
 *   recoverable fraction of spent ammo recovered after the fight (arrows & bolts). After a
 *              night: add(ammoRes, Math.floor(spent * recoverable)).
 *
 * Old fields on WeaponDef (dmg, rof, mag, ammo, …) are still present so legacy code
 * compiles, but they ignore ammo types. WEAPON_ORDER lists every gun.
 * ===================================================================================== */

export interface FireProfile {
  dmg: number; pellets: number; spread: number; pierce: number; armorPen: number; knock: number; noise: number;
  incendiary: boolean; flare: boolean; smoke: boolean;
  ammoRes: Res | null; perShot: number; reload: number; reloadPerRound: boolean; mag: number; rof: number; auto: boolean;
  burst: number; burstGap: number; jam: number; recoverable: number;
}

// Burning (dragon's breath, fire bolts, flares)
export const BURN = { dps: 16, time: 3.5 };
export const FLARE_LIGHT = { r: 260, time: 9 };

// ---------- calibers & bullet types ----------
export interface Caliber { id: string; name: string; types: Res[]; icon: string }
export const CALIBERS: Record<string, Caliber> = {
  r22: { id: 'r22', name: '.22 rimfire', types: ['r22'], icon: 'icon_r22' },
  pistol: { id: 'pistol', name: 'Pistol (9mm / .45 / .357)', types: ['light', 'light_hp'], icon: 'icon_ammo' },
  shot: { id: 'shot', name: 'Shotshells (12 ga / .410)', types: ['shell', 'shell_slug', 'shell_flech', 'shell_fire'], icon: 'icon_shells' },
  rifle: { id: 'rifle', name: 'Full-power rifle (.30-30 / .308 / .30-06)', types: ['rifle', 'rifle_sp', 'rifle_ap'], icon: 'icon_ammo' },
  r556: { id: 'r556', name: '5.56 NATO', types: ['r556'], icon: 'icon_r556' },
  ball: { id: 'ball', name: '.50 ball & black powder', types: ['ball'], icon: 'icon_ball' },
  bolt: { id: 'bolt', name: 'Arrows & bolts', types: ['bolt', 'bolt_fire'], icon: 'icon_bolts' },
  flare: { id: 'flare', name: '12 ga flare shells', types: ['flare'], icon: 'icon_flares' },
  nails: { id: 'nails', name: 'Nails & rivets (scrap)', types: ['scrap'], icon: 'icon_scrap' },
};

export interface AmmoType {
  res: Res; caliber: string; name: string; short: string; icon: string; desc: string;
  dmgMul?: number; pellets?: 'slug' | number; spreadMul?: number; pierceAdd?: number; pierceSet?: number;
  armorPen?: number; knockMul?: number; noiseMul?: number; incendiary?: boolean; flare?: boolean; recoverable?: number;
}
export const AMMO_TYPES: Partial<Record<Res, AmmoType>> = {
  r22: { res: 'r22', caliber: 'r22', name: '.22 LR', short: '.22', icon: 'icon_r22', desc: 'Bricks of 500 from every farm closet. Pennies a shot.' },
  light: { res: 'light', caliber: 'pistol', name: 'Pistol ball (FMJ)', short: 'FMJ', icon: 'icon_ammo', desc: 'Round-nose. Goes where you point it.' },
  light_hp: { res: 'light_hp', caliber: 'pistol', name: 'Hollow-points', short: 'HP', icon: 'icon_ammo', desc: '+30% damage and more shove; useless against Deputy plate; no pierce.', dmgMul: 1.3, pierceAdd: -1, armorPen: -0.6, knockMul: 1.15 },
  shell: { res: 'shell', caliber: 'shot', name: 'Buckshot', short: 'buck', icon: 'icon_shells', desc: 'Nine pellets. The close-range answer.' },
  shell_slug: { res: 'shell_slug', caliber: 'shot', name: 'Slugs', short: 'slug', icon: 'icon_slug', desc: 'One heavy lead slug: accurate, pierces one, cracks plate. Aim matters.', pellets: 'slug', spreadMul: 0.12, pierceAdd: 1, armorPen: 0.4, knockMul: 1.6 },
  shell_flech: { res: 'shell_flech', caliber: 'shot', name: 'Flechettes', short: 'flech', icon: 'icon_shells', desc: 'Clipped roofing nails: more, lighter projectiles that go through.', pellets: 1.5, dmgMul: 0.55, pierceAdd: 1, armorPen: 0.5, knockMul: 0.5, spreadMul: 0.85 },
  shell_fire: { res: 'shell_fire', caliber: 'shot', name: "Dragon's breath", short: 'fire', icon: 'icon_dragon', desc: 'Magnesium shavings from the mill shop. A cone of fire that sets them burning.', dmgMul: 0.55, spreadMul: 1.25, knockMul: 0.6, noiseMul: 1.2, incendiary: true, flare: true },
  rifle: { res: 'rifle', caliber: 'rifle', name: 'Rifle FMJ', short: 'FMJ', icon: 'icon_ammo', desc: 'Goes through one and into the next.' },
  rifle_sp: { res: 'rifle_sp', caliber: 'rifle', name: 'Soft-points', short: 'SP', icon: 'icon_ammo', desc: 'Deer loads: +30% damage and shove, but they stop in the first body.', dmgMul: 1.3, pierceSet: 0, knockMul: 1.25, armorPen: -0.3 },
  rifle_ap: { res: 'rifle_ap', caliber: 'rifle', name: 'Armor-piercing', short: 'AP', icon: 'icon_ammo', desc: 'Drill-bit steel cores. Ignore Deputy plate; pierce one more.', dmgMul: 0.92, armorPen: 0.9, pierceAdd: 1 },
  r556: { res: 'r556', caliber: 'r556', name: '5.56 NATO', short: '5.56', icon: 'icon_r556', desc: 'Green-tip from the Line. Light, fast, plentiful only at Corliss.', armorPen: 0.25 },
  ball: { res: 'ball', caliber: 'ball', name: '.50 ball & powder', short: 'ball', icon: 'icon_ball', desc: 'A lead ball, a patch, a measured charge. Cheap to cast.' },
  bolt: { res: 'bolt', caliber: 'bolt', name: 'Broadheads', short: 'broad', icon: 'icon_bolts', desc: 'Dowel shafts and saw-tooth heads. Most come back.' },
  bolt_fire: { res: 'bolt_fire', caliber: 'bolt', name: 'Fire bolts', short: 'fire', icon: 'icon_bolts', desc: 'Rag-wrapped and dipped in still fuel. They burn, and they do not come back.', dmgMul: 0.8, incendiary: true, recoverable: 0 },
  flare: { res: 'flare', caliber: 'flare', name: 'Flare shells', short: 'flare', icon: 'icon_flares', desc: 'Lights the road and whatever it hits.' },
  scrap: { res: 'scrap', caliber: 'nails', name: 'Scrap (nails & rivets)', short: 'scrap', icon: 'icon_scrap', desc: 'Cut, headed and fed from the scrap pile.' },
};
export const AMMO_RES: Res[] = Object.values(CALIBERS).flatMap((c) => c.types).filter((r) => r !== 'scrap');

export function ammoLabel(res: Res | null | undefined): string {
  if (!res) return '—';
  return AMMO_TYPES[res]?.name ?? res;
}

// ---------- the guns ----------
// Ammo pools are Res keys; `caliber` decides what else a gun can load.
export const WEAPONS: Record<string, WeaponDef> = {
  // --- handguns ---
  service9: {
    id: 'service9', name: 'Service pistol', icon: 'icon_pistol', ammo: 'light', caliber: 'pistol',
    dmg: 26, rof: 4, mag: 15, reload: 1.3, spread: 0.035, pellets: 1, pierce: 0, knock: 4, auto: false, noise: 1,
    niche: 'Fifteen rounds and never jams: the cheapest dependable gun in the house.',
    desc: 'A deputy\'s sidearm. Ugly, honest, always works.',
  },
  revolver: {
    id: 'revolver', name: '.357 revolver', icon: 'icon_revolver', ammo: 'light', caliber: 'pistol',
    dmg: 55, rof: 2.2, mag: 6, reload: 2.4, spread: 0.02, pellets: 1, pierce: 1, knock: 10, auto: false, noise: 1.4, armorPen: 0.3,
    niche: 'One shot drops a Deer; six chances, then a slow reload.',
    desc: 'Six chances. Somebody\'s grandfather kept it oiled.',
  },
  m1911: {
    id: 'm1911', name: '.45 1911', icon: 'icon_m1911', ammo: 'light', caliber: 'pistol',
    dmg: 38, rof: 3, mag: 7, reload: 1.4, spread: 0.03, pellets: 1, pierce: 0, knock: 16, auto: false, noise: 1.2,
    niche: 'Big slow .45: the most shove of any handgun, holds runners off the wall.',
    desc: 'Carried home from somewhere hot by a man who never talked about it.',
  },
  mp93: {
    id: 'mp93', name: 'Burst machine pistol', icon: 'icon_mp93', ammo: 'light', caliber: 'pistol',
    dmg: 22, rof: 2.4, mag: 21, reload: 1.6, spread: 0.05, pellets: 1, pierce: 0, knock: 3, auto: false, noise: 1.6, burst: 3, burstGap: 0.05,
    niche: 'Three-round bursts: a quick string up the body into the head, one-handed.',
    desc: 'From the County SWAT locker, with the folding grip still taped shut.',
  },
  smg: {
    id: 'smg', name: 'Submachine gun', icon: 'icon_smg', ammo: 'light', caliber: 'pistol',
    dmg: 20, rof: 11, mag: 30, reload: 2.0, spread: 0.07, pellets: 1, pierce: 0, knock: 3, auto: true, noise: 2.4,
    niche: 'Pistol-caliber hose for when the wall is crowded; burns a box a night.',
    desc: 'County SWAT locker. Eats ammunition like the dead eat.',
  },
  // --- rimfire ---
  r22: {
    id: 'r22', name: 'Farm .22', icon: 'icon_r22rifle', ammo: 'r22', caliber: 'r22',
    dmg: 17, rof: 5, mag: 25, reload: 1.8, spread: 0.01, pellets: 1, pierce: 0, knock: 1, auto: false, noise: 0.35,
    niche: 'Quiet, dead accurate and pennies a shot — a headshot tool, useless on bodies.',
    desc: 'Every barn in the county has one behind the door for skunks.',
  },
  // --- shotguns ---
  pump: {
    id: 'pump', name: 'Pump shotgun', icon: 'icon_shotgun', ammo: 'shell', caliber: 'shot',
    dmg: 16, rof: 1.2, mag: 6, reload: 3.2, spread: 0.13, pellets: 8, pierce: 0, knock: 30, auto: false, noise: 2, reloadPerRound: true,
    niche: 'Feeds every shell — buck, slug, flechette, dragon\'s breath — one at a time.',
    desc: 'Duck gun. Stops anything close enough to smell.',
  },
  coach: {
    id: 'coach', name: 'Double-barrel coach gun', icon: 'icon_coachgun', ammo: 'shell', caliber: 'shot',
    dmg: 17, rof: 1.4, mag: 2, reload: 2.0, spread: 0.16, pellets: 9, pierce: 0, knock: 40, auto: false, noise: 2.8, burst: 2, burstGap: 0,
    niche: 'Both barrels at once: the hardest point-blank punch and shove in the house.',
    desc: 'Hung over the bar at the Legion. Nobody remembered it was loaded.',
  },
  snake410: {
    id: 'snake410', name: '.410 snake charmer', icon: 'icon_snake410', ammo: 'shell', caliber: 'shot',
    dmg: 11, rof: 2.2, mag: 1, reload: 0.9, spread: 0.11, pellets: 5, pierce: 0, knock: 10, auto: false, noise: 1.1, perShot: 0.5,
    niche: 'Tiny hulls, half a shell a shot: a shotgun for the young, the old and the frugal.',
    desc: 'A stainless single-shot that lived under a truck seat for snakes.',
  },
  pipe: {
    id: 'pipe', name: 'Pipe shotgun', icon: 'icon_pipegun', ammo: 'shell', caliber: 'shot',
    dmg: 16, rof: 1, mag: 1, reload: 2.3, spread: 0.18, pellets: 8, pierce: 0, knock: 26, auto: false, noise: 2.2, jam: 0.07, craftable: true,
    niche: 'Two pipes and a nail. Cheapest gun you can build; takes any shell; jams.',
    desc: 'Slam the pipes together and the nail does the rest. Usually.',
  },
  autoshot: {
    id: 'autoshot', name: 'Riot auto-shotgun', icon: 'icon_autoshotgun', ammo: 'shell', caliber: 'shot',
    dmg: 13, rof: 3.2, mag: 8, reload: 3.6, spread: 0.12, pellets: 8, pierce: 0, knock: 22, auto: false, noise: 2.5, reloadPerRound: true,
    niche: 'Semi-auto 12-gauge: clears the wall in seconds and drinks shells doing it.',
    desc: 'County riot gun. The stock says PROPERTY OF in white paint.',
  },
  // --- rifles ---
  hunting: {
    id: 'hunting', name: 'Bolt hunting rifle', icon: 'icon_rifle', ammo: 'rifle', caliber: 'rifle',
    dmg: 110, rof: 0.9, mag: 5, reload: 3.0, spread: 0.006, pellets: 1, pierce: 3, knock: 18, auto: false, noise: 2.2, armorPen: 0.2,
    niche: '.30-06 through three in a line; the deer-camp workhorse.',
    desc: 'Deer season opened the week everything ended.',
  },
  lever: {
    id: 'lever', name: 'Lever .30-30', icon: 'icon_lever', ammo: 'rifle', caliber: 'rifle',
    dmg: 78, rof: 2, mag: 7, reload: 3.2, spread: 0.012, pellets: 1, pierce: 2, knock: 14, auto: false, noise: 2, reloadPerRound: true,
    niche: 'Fast follow-ups that pierce two, and a tube you can top off between Deer.',
    desc: 'Grandpa\'s brush gun. The stock is worn pale where a hand held it for sixty years.',
  },
  scoped: {
    id: 'scoped', name: 'Scoped .308', icon: 'icon_scoped', ammo: 'rifle', caliber: 'rifle',
    dmg: 135, rof: 0.75, mag: 5, reload: 2.6, spread: 0.0025, pellets: 1, pierce: 3, knock: 20, auto: false, noise: 2.4, armorPen: 0.5,
    niche: 'Pinpoint and brutal: puts a round through a Deputy visor at the far end of the road.',
    desc: 'Glass worth more than the truck it rode in. Strand sold three a season.',
  },
  muzzle: {
    id: 'muzzle', name: '.50 muzzleloader', icon: 'icon_muzzle', ammo: 'ball', caliber: 'ball',
    dmg: 250, rof: 0.5, mag: 1, reload: 5.5, spread: 0.01, pellets: 1, pierce: 4, knock: 45, auto: false, noise: 3, armorPen: 0.8, smoke: true, craftable: true,
    niche: 'One enormous shot through four bodies, a cloud of smoke, then a long reload. Ammo is cheap.',
    desc: 'Black-powder season gun. Ram, cap, pray, and wait for the smoke to clear.',
  },
  // --- 5.56 ---
  ar15: {
    id: 'ar15', name: 'Range AR-15', icon: 'icon_ar15', ammo: 'r556', caliber: 'r556',
    dmg: 44, rof: 5, mag: 30, reload: 2.2, spread: 0.014, pellets: 1, pierce: 1, knock: 6, auto: false, noise: 2.2,
    niche: 'Accurate semi-auto thirty-rounder: the best all-rounder for a steady shooter.',
    desc: 'Off the rack at Strand Sporting. Red-dot sight, price tag still on the trigger guard.',
  },
  carbine: {
    id: 'carbine', name: 'Guard carbine', icon: 'icon_carbine', ammo: 'r556', caliber: 'r556',
    dmg: 48, rof: 7, mag: 30, reload: 2.4, spread: 0.03, pellets: 1, pierce: 1, knock: 8, auto: true, noise: 2.6,
    niche: 'Full-auto rifle rounds: pierce and volume at once, if you can feed it.',
    desc: 'Serial number filed. Someone walked away from the Line.',
  },
  lmg: {
    id: 'lmg', name: 'Line machine gun', icon: 'icon_lmg', ammo: 'r556', caliber: 'r556',
    dmg: 42, rof: 12, mag: 100, reload: 6.5, spread: 0.06, pellets: 1, pierce: 1, knock: 9, auto: true, noise: 3.4,
    niche: 'A hundred rounds before you stop; the slowest reload in Vessey.',
    desc: 'Belt-fed, bipod bent. It held the bridge at Corliss for eleven hours.',
  },
  // --- quiet & strange ---
  compound: {
    id: 'compound', name: 'Compound bow', icon: 'icon_bow', ammo: 'bolt', caliber: 'bolt',
    dmg: 90, rof: 1.1, mag: 1, reload: 0.7, spread: 0.015, pellets: 1, pierce: 1, knock: 6, auto: false, noise: 0.1, recoverable: 0.6,
    niche: 'Silent, and most arrows come back. Wakes nobody on a daylight run.',
    desc: 'Bowhunter\'s rig from a deer stand on the Halvorsen forty.',
  },
  crossbow: {
    id: 'crossbow', name: 'Crossbow', icon: 'icon_crossbow', ammo: 'bolt', caliber: 'bolt',
    dmg: 140, rof: 0.6, mag: 1, reload: 2.2, spread: 0.008, pellets: 1, pierce: 2, knock: 12, auto: false, noise: 0.15, armorPen: 0.4, recoverable: 0.5, craftable: true,
    niche: 'A silent heavy bolt that pierces two; slow to span.',
    desc: 'Leaf-spring limbs off a Ford, a cable winch, a walnut stock.',
  },
  flaregun: {
    id: 'flaregun', name: 'Flare pistol', icon: 'icon_flaregun', ammo: 'flare', caliber: 'flare',
    dmg: 30, rof: 1, mag: 1, reload: 1.6, spread: 0.03, pellets: 1, pierce: 0, knock: 4, auto: false, noise: 1, incendiary: true, flare: true, craftable: true,
    niche: 'Sets one burning and lights the road for every gun on the wall.',
    desc: 'Orange plastic from the boathouse emergency kit.',
  },
  nailer: {
    id: 'nailer', name: 'Nail driver', icon: 'icon_nailgun', ammo: 'scrap', caliber: 'nails',
    dmg: 22, rof: 6, mag: 40, reload: 2.6, spread: 0.05, pellets: 1, pierce: 1, knock: 2, auto: true, noise: 0.5, perShot: 0.05, craftable: true,
    niche: 'Near-silent automatic that feeds on the scrap pile.',
    desc: 'Mill-shop contraption. Quiet. Feeds on scrap.',
  },
  rivet: {
    id: 'rivet', name: 'Rivet gun', icon: 'icon_rivet', ammo: 'scrap', caliber: 'nails',
    dmg: 62, rof: 1.6, mag: 10, reload: 2.2, spread: 0.02, pellets: 1, pierce: 2, knock: 7, auto: false, noise: 0.6, armorPen: 0.6, perShot: 0.25, craftable: true,
    niche: 'Quiet steel rivets that punch through Deputy plate; hungry for scrap.',
    desc: 'A boiler-shop rivet hammer on a compressor bottle. Thunk.',
  },
};

export const WEAPON_ORDER = [
  'service9', 'revolver', 'm1911', 'mp93', 'smg', 'r22',
  'pump', 'coach', 'snake410', 'pipe', 'autoshot',
  'hunting', 'lever', 'scoped', 'muzzle',
  'ar15', 'carbine', 'lmg',
  'compound', 'crossbow', 'flaregun', 'nailer', 'rivet',
];

// Every icon the arsenal needs (spread into the asset preload list).
export const ARSENAL_ICONS: string[] = [...new Set([
  ...Object.values(WEAPONS).map((w) => w.icon),
  ...Object.values(CALIBERS).map((c) => c.icon),
  ...Object.values(AMMO_TYPES).map((a) => a!.icon),
])];

// Legacy pool names (still used by some night code).
export const AMMO_NAMES: Record<string, string> = { light: 'Pistol rounds', shell: 'Shells', rifle: 'Rifle rounds', scrap: 'Scrap' };

export function caliberOf(defId: string): Caliber | null {
  const d = WEAPONS[defId];
  return d?.caliber ? CALIBERS[d.caliber] ?? null : null;
}

/** Bullet types this gun can load (first = its default). */
export function ammoTypesFor(defId: string): Res[] {
  const d = WEAPONS[defId];
  const c = caliberOf(defId);
  if (!d?.ammo) return [];
  return c ? [d.ammo, ...c.types.filter((t) => t !== d.ammo)] : [d.ammo];
}

/** Selected ammo, falling back to the gun's default if the selection is invalid. */
export function selectedAmmo(w: WeaponItem): Res | null {
  const d = WEAPONS[w.def];
  if (!d?.ammo) return null;
  return w.ammoType && ammoTypesFor(w.def).includes(w.ammoType) ? w.ammoType : d.ammo;
}

/** Body-hit damage against armour (Deputies). armorPen 1 = full damage. */
export function armorDamage(dmg: number, armor: number | undefined, armorPen: number): number {
  if (!armor) return dmg;
  return Math.max(dmg * 0.15, dmg - armor * Math.max(0, 1 - armorPen));
}

/** How many rounds the stores can still feed this profile. */
export function roundsInStores(p: FireProfile, stores: Partial<Record<Res, number>>): number {
  if (!p.ammoRes) return Infinity;
  return Math.floor((stores[p.ammoRes] ?? 0) / p.perShot + 1e-6);
}

/** THE CONTRACT: weapon + selected ammo + condition -> numbers to shoot with. Pure. */
export function fireProfile(w: WeaponItem): FireProfile {
  const d = WEAPONS[w.def];
  const res = selectedAmmo(w);
  const a = res ? AMMO_TYPES[res] : undefined;
  const cond = Math.max(0, Math.min(1, w.cond));
  let pellets = d.pellets;
  let dmg = d.dmg;
  let spread = d.spread;
  let knock = d.knock;
  if (a?.pellets === 'slug' && pellets > 1) {
    dmg = dmg * pellets * 0.7;
    pellets = 1;
    spread = Math.max(0.012, spread * (a.spreadMul ?? 1));
  } else {
    if (typeof a?.pellets === 'number' && pellets > 1) pellets = Math.round(pellets * a.pellets);
    if (a?.spreadMul) spread *= a.spreadMul;
  }
  dmg *= (a?.dmgMul ?? 1) * (0.85 + 0.15 * cond);
  knock *= a?.knockMul ?? 1;
  spread *= 1 + (1 - cond) * 0.4;
  let pierce = a?.pierceSet ?? d.pierce + (a?.pierceAdd ?? 0);
  pierce = Math.max(0, pierce);
  const armorPen = Math.max(-1, Math.min(1, (d.armorPen ?? 0) + (a?.armorPen ?? 0)));
  const rpr = !!d.reloadPerRound;
  return {
    dmg: Math.round(dmg * 10) / 10,
    pellets,
    spread,
    pierce,
    armorPen,
    knock,
    noise: d.noise * (a?.noiseMul ?? 1),
    incendiary: !!(d.incendiary || a?.incendiary),
    flare: !!(d.flare || a?.flare),
    smoke: !!d.smoke,
    ammoRes: res,
    perShot: d.perShot ?? 1,
    reload: rpr ? d.reload / d.mag : d.reload,
    reloadPerRound: rpr,
    mag: d.mag,
    rof: d.rof,
    auto: d.auto,
    burst: d.burst ?? 1,
    burstGap: d.burstGap ?? 0.06,
    jam: (d.jam ?? 0) + (cond < 0.5 ? (0.5 - cond) * 0.08 : 0),
    recoverable: a?.recoverable ?? d.recoverable ?? 0,
  };
}
