import type { Res, WeaponDef, WeaponItem, ModSlot, ModItem, WeaponClass } from '../types';
export type { WeaponClass } from '../types';

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
 *   limbMul    multiplier on damage dealt to arm/leg zones (and their cripple thresholds):
 *              buckshot 1.2, slugs 1.0, soft-point / hollow-point 1.3, .22 0.7
 *   stagger    0..1 per body hit: chance (or impulse) that the hit staggers the target.
 *              Slugs, soft-points, bolts, the muzzleloader high; .22 and nails low.
 *
 *
 * ATTACHMENTS (WeaponItem.mods, folded in by fireProfile — battle code gets them for free):
 *   light      length in px of a flashlight cone from the muzzle at night (0 = none). Light the
 *              road in that cone and let guards see / engage inside it.
 *   melee      damage of a lashed blade when the wall is reached / out of ammo (0 = none;
 *              use instead of the bare hand-to-hand value)
 *   bloomMul   multiply the per-shot bloom you add (sling, brake)
 *   recoilMul  multiply recoil/shake applied to the shooter (brake, padded stock)
 *   braceBloomMul extra bloom multiplier while firing from the wall (bipod); 1 = none
 *   switchTime seconds added when the shooter changes target (scope +, red-dot −); guards'
 *              re-target delay, or the player's spread settle time
 *   range      px beyond which a projectile does half damage (sawed-off ~520; Infinity = none)
 *
 * SHOOTER (survivor skill / perks), optional 2nd argument:
 *   fireProfile(w, { shooter: { reloadMul, spreadMul, jamMul, bloomMul } })
 *   multiplies reload, spread (single projectiles and the pellet cone), jam chance and bloomMul.
 *   jamClear   seconds lost clearing a jam (0.9 base; improvised guns longer). Not scaled by
 *              shooter.jamMul — pass a reloadMul-style factor yourself if skill should speed it.
 *
 *   Suppressors wear: call wearMods(w, roundsFired) after a fight; it lowers mod cond and
 *   removes worn-out mods, returning lines for the morning report.
 *
 * CLASS & LAUNCHERS
 *   cls        WeaponClass (handgun, smg, rifle, assault, marksman, shotgun, heavy, launcher,
 *              bow, improvised) — key for survivor proficiency. Labels in CLASS_NAMES.
 *   explosive  optional { radius, dmg }: on impact (first body hit in the lane, else the lane's
 *              ground row), deal dmg to everything within a ground-space ellipse
 *              (dx/r)² + (dy/(0.3r))² <= 1, falling off linearly to 30% at the edge; armour
 *              ignored. Knock everyone outward by `knock` scaled the same way. The direct-hit
 *              `dmg` still applies to the first body. See blastDamage().
 *   arc        lobbed (40mm, pipe-bomb mortar): ignore bodies on the way; the round lands at
 *              the crosshair's x on the target lane after ~0.6s of flight, then explodes.
 *
 * MELEE (hand weapons — separate from guns):
 *   Items live in G.melee (WeaponItem with def = MELEE key); a survivor carries one gun
 *   (Survivor.weapon) AND one melee weapon (Survivor.melee = uid in G.melee). Never look
 *   melee defs up in WEAPONS. Call meleeProfile(item, { dmgMul, speedMul, staminaMul }):
 *   dmg        per target hit (condition folded in)
 *   reach      px from the body that the swing connects (boat hook ~110, knife ~40)
 *   arc        how many targets one swing can hit (nearest first, across adjacent lanes)
 *   swingTime  wind-up seconds before the hit lands; recovery: seconds after before the next
 *   knock      push-back px; stagger 0..1: chance/impulse to stagger (stop, release a grab)
 *   bleed      dps applied for BLEED_TIME seconds (machete, nail bat)
 *   crit       damage multiplier for an overhead strike to the head (wall: a climber's head;
 *              day runs: swing with the crosshair above the target's head line)
 *   finisher   kills sleeping / downed / crawling targets outright (knife: silently)
 *   stamina    cost per swing out of 100 (regen ~18/s); swinging tired = half damage, slow
 *   noise      noise per swing (chainsaw is loud and draws them)
 *   wear       condition lost per hit; at 0 the item breaks and is removed
 *   fuel       fuel taken from stores per swing (chainsaw); no fuel = it will not start
 *   pry        search-speed multiplier on doors/cars/sheds/caches (crowbar)
 *   Night combat: melee at the wall vs climbers / over-the-wall, and guards out of ammo use
 *   their melee weapon (meleeProfile(dmg)) instead of fists. Proficiency class: 'melee'.
 *
 * Old fields on WeaponDef (dmg, rof, mag, ammo, …) are still present so legacy code
 * compiles, but they ignore ammo types. WEAPON_ORDER lists every gun.
 * ===================================================================================== */

export interface FireProfile {
  dmg: number; pellets: number; spread: number; pierce: number; armorPen: number; knock: number; noise: number;
  incendiary: boolean; flare: boolean; smoke: boolean;
  ammoRes: Res | null; perShot: number; reload: number; reloadPerRound: boolean; mag: number; rof: number; auto: boolean;
  burst: number; burstGap: number; jam: number; recoverable: number;
  limbMul: number; stagger: number;
  light: number; melee: number; bloomMul: number; recoilMul: number; braceBloomMul: number; switchTime: number; range: number;
  jamClear: number;
  cls: WeaponClass;
  explosive?: { radius: number; dmg: number };
  arc?: boolean;
}

export interface ShooterMods { reloadMul?: number; spreadMul?: number; jamMul?: number; bloomMul?: number }

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
  rocket: { id: 'rocket', name: '66mm rockets', types: ['rocket'], icon: 'icon_rocket' },
  g40: { id: 'g40', name: '40mm grenades', types: ['g40', 'g40_buck'], icon: 'icon_g40' },
  pipebomb: { id: 'pipebomb', name: 'Pipe bombs', types: ['pipebomb'], icon: 'icon_pipebomb' },
};

export interface AmmoType {
  res: Res; caliber: string; name: string; short: string; icon: string; desc: string;
  dmgMul?: number; pellets?: 'slug' | number; spreadMul?: number; pierceAdd?: number; pierceSet?: number;
  armorPen?: number; knockMul?: number; noiseMul?: number; incendiary?: boolean; flare?: boolean; recoverable?: number;
  limbMul?: number; stagger?: number; // overrides
  explosive?: { radius: number; dmg: number } | null; // null removes the blast (40mm buckshot)
  arc?: boolean;
  pelletsSet?: number; dmgSet?: number;
}
export const AMMO_TYPES: Partial<Record<Res, AmmoType>> = {
  r22: { res: 'r22', caliber: 'r22', name: '.22 LR', short: '.22', icon: 'icon_r22', desc: 'Bricks of 500 from every farm closet. Pennies a shot.' },
  light: { res: 'light', caliber: 'pistol', name: 'Pistol ball (FMJ)', short: 'FMJ', icon: 'icon_ammo', desc: 'Round-nose. Goes where you point it.' },
  light_hp: { res: 'light_hp', caliber: 'pistol', name: 'Hollow-points', short: 'HP', icon: 'icon_ammo', desc: '+30% damage and more shove; useless against Deputy plate; no pierce.', dmgMul: 1.3, pierceAdd: -1, armorPen: -0.6, knockMul: 1.15, limbMul: 1.3 },
  shell: { res: 'shell', caliber: 'shot', name: 'Buckshot', short: 'buck', icon: 'icon_shells', desc: 'Nine pellets. The close-range answer.' },
  shell_slug: { res: 'shell_slug', caliber: 'shot', name: 'Slugs', short: 'slug', icon: 'icon_slug', desc: 'One heavy lead slug: accurate, pierces one, cracks plate. Aim matters.', pellets: 'slug', spreadMul: 0.12, pierceAdd: 1, armorPen: 0.4, knockMul: 1.6, limbMul: 1.0, stagger: 0.8 },
  shell_flech: { res: 'shell_flech', caliber: 'shot', name: 'Flechettes', short: 'flech', icon: 'icon_shells', desc: 'Clipped roofing nails: more, lighter projectiles that go through.', pellets: 1.5, dmgMul: 0.7, pierceAdd: 1, armorPen: 0.9, knockMul: 0.5, spreadMul: 0.85, stagger: 0.1 },
  shell_fire: { res: 'shell_fire', caliber: 'shot', name: "Dragon's breath", short: 'fire', icon: 'icon_dragon', desc: 'Magnesium shavings from the mill shop. A cone of fire that sets them burning.', dmgMul: 0.55, spreadMul: 1.25, knockMul: 0.6, noiseMul: 1.2, incendiary: true, flare: true },
  rifle: { res: 'rifle', caliber: 'rifle', name: 'Rifle FMJ', short: 'FMJ', icon: 'icon_ammo', desc: 'Goes through one and into the next.' },
  rifle_sp: { res: 'rifle_sp', caliber: 'rifle', name: 'Soft-points', short: 'SP', icon: 'icon_ammo', desc: 'Deer loads: +30% damage and shove, but they stop in the first body.', dmgMul: 1.3, pierceSet: 0, knockMul: 1.25, armorPen: -0.3, limbMul: 1.3, stagger: 0.6 },
  rifle_ap: { res: 'rifle_ap', caliber: 'rifle', name: 'Armor-piercing', short: 'AP', icon: 'icon_ammo', desc: 'Drill-bit steel cores. Ignore Deputy plate; pierce two more.', dmgMul: 1, armorPen: 0.9, pierceAdd: 2 },
  r556: { res: 'r556', caliber: 'r556', name: '5.56 NATO', short: '5.56', icon: 'icon_r556', desc: 'Green-tip from the Line. Light, fast, plentiful only at Corliss.', armorPen: 0.25 },
  ball: { res: 'ball', caliber: 'ball', name: '.50 ball & powder', short: 'ball', icon: 'icon_ball', desc: 'A lead ball, a patch, a measured charge. Cheap to cast.' },
  bolt: { res: 'bolt', caliber: 'bolt', name: 'Broadheads', short: 'broad', icon: 'icon_bolts', desc: 'Dowel shafts and saw-tooth heads. Most come back.' },
  bolt_fire: { res: 'bolt_fire', caliber: 'bolt', name: 'Fire bolts', short: 'fire', icon: 'icon_bolts', desc: 'Rag-wrapped and dipped in still fuel. They burn, and they do not come back.', dmgMul: 0.8, incendiary: true, recoverable: 0 },
  flare: { res: 'flare', caliber: 'flare', name: 'Flare shells', short: 'flare', icon: 'icon_flares', desc: 'Lights the road and whatever it hits.' },
  rocket: { res: 'rocket', caliber: 'rocket', name: '66mm rocket', short: 'rocket', icon: 'icon_rocket', desc: 'A whole disposable launcher tube per shot. The Guard left a crate; the crate is mostly empty.' },
  g40: { res: 'g40', caliber: 'g40', name: '40mm HE', short: 'HE', icon: 'icon_g40', desc: 'High-explosive grenade. Lobbed; bursts where it lands.' },
  g40_buck: { res: 'g40_buck', caliber: 'g40', name: '40mm buckshot', short: 'buck', icon: 'icon_g40', desc: 'A fat shotgun shell for the thumper: flat-shooting, no blast.', explosive: null, arc: false, pelletsSet: 20, dmgSet: 15, spreadMul: 6, knockMul: 0.5, stagger: 0.6 },
  pipebomb: { res: 'pipebomb', caliber: 'pipebomb', name: 'Pipe bomb', short: 'bomb', icon: 'icon_pipebomb', desc: 'Capped pipe, powder and roofing nails.' },
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
    id: 'service9', cls: 'handgun', name: 'Service pistol', icon: 'icon_pistol', ammo: 'light', caliber: 'pistol',
    dmg: 32, rof: 3.3, mag: 15, reload: 1.3, spread: 0.035, pellets: 1, pierce: 0, knock: 4, auto: false, noise: 1,
    niche: 'Fifteen rounds and never jams: the cheapest dependable gun in the house.',
    desc: 'A deputy\'s sidearm. Ugly, honest, always works.',
  },
  revolver: {
    id: 'revolver', cls: 'handgun', name: '.357 revolver', icon: 'icon_revolver', ammo: 'light', caliber: 'pistol',
    dmg: 55, rof: 2.2, mag: 6, reload: 2.4, spread: 0.02, pellets: 1, pierce: 1, knock: 10, auto: false, noise: 1.4, armorPen: 0.3,
    niche: 'One shot drops a Deer; six chances, then a slow reload.',
    desc: 'Six chances. Somebody\'s grandfather kept it oiled.',
  },
  m1911: {
    id: 'm1911', cls: 'handgun', name: '.45 1911', icon: 'icon_m1911', ammo: 'light', caliber: 'pistol',
    dmg: 42, rof: 3, mag: 7, reload: 1.4, spread: 0.03, pellets: 1, pierce: 0, knock: 18, auto: false, noise: 1.2,
    niche: 'Big slow .45: the most shove of any handgun, holds runners off the wall.',
    desc: 'Carried home from somewhere hot by a man who never talked about it.',
  },
  mp93: {
    id: 'mp93', cls: 'handgun', name: 'Burst machine pistol', icon: 'icon_mp93', ammo: 'light', caliber: 'pistol',
    dmg: 22, rof: 2.4, mag: 21, reload: 1.6, spread: 0.05, pellets: 1, pierce: 0, knock: 3, auto: false, noise: 1.6, burst: 3, burstGap: 0.05,
    niche: 'Three-round bursts: a quick string up the body into the head, one-handed.',
    desc: 'From the County SWAT locker, with the folding grip still taped shut.',
  },
  smg: {
    id: 'smg', cls: 'smg', name: 'Submachine gun', icon: 'icon_smg', ammo: 'light', caliber: 'pistol',
    dmg: 22, rof: 11, mag: 30, reload: 2.0, spread: 0.07, pellets: 1, pierce: 0, knock: 3, auto: true, noise: 2.4,
    niche: 'Pistol-caliber hose for when the wall is crowded; burns a box a night.',
    desc: 'County SWAT locker. Eats ammunition like the dead eat.',
  },
  // --- rimfire ---
  r22: {
    id: 'r22', cls: 'rifle', name: 'Farm .22', icon: 'icon_r22rifle', ammo: 'r22', caliber: 'r22',
    dmg: 22, rof: 5, mag: 25, reload: 1.8, spread: 0.01, pellets: 1, pierce: 0, knock: 1, auto: false, noise: 0.35, limbMul: 0.7, stagger: 0.03,
    niche: 'Quiet, dead accurate and pennies a shot — a headshot tool, useless on bodies.',
    desc: 'Every barn in the county has one behind the door for skunks.',
  },
  // --- shotguns ---
  pump: {
    id: 'pump', cls: 'shotgun', name: 'Pump shotgun', icon: 'icon_shotgun', ammo: 'shell', caliber: 'shot',
    dmg: 16, rof: 1.2, mag: 6, reload: 3.2, spread: 0.13, pellets: 8, pierce: 1, knock: 30, auto: false, noise: 2, reloadPerRound: true,
    niche: 'Feeds every shell — buck, slug, flechette, dragon\'s breath — one at a time.',
    desc: 'Duck gun. Stops anything close enough to smell.',
  },
  coach: {
    id: 'coach', cls: 'shotgun', name: 'Double-barrel coach gun', icon: 'icon_coachgun', ammo: 'shell', caliber: 'shot',
    dmg: 17, rof: 1.4, mag: 2, reload: 2.0, spread: 0.16, pellets: 9, pierce: 1, knock: 40, auto: false, noise: 2.8, burst: 2, burstGap: 0,
    niche: 'Both barrels at once: the hardest point-blank punch and shove in the house.',
    desc: 'Hung over the bar at the Legion. Nobody remembered it was loaded.',
  },
  snake410: {
    id: 'snake410', cls: 'shotgun', name: '.410 snake charmer', icon: 'icon_snake410', ammo: 'shell', caliber: 'shot',
    dmg: 13, rof: 2.2, mag: 1, reload: 0.7, spread: 0.11, pellets: 6, pierce: 0, knock: 14, auto: false, noise: 1.1, perShot: 0.5,
    niche: 'Tiny hulls, half a shell a shot: a shotgun for the young, the old and the frugal.',
    desc: 'A stainless single-shot that lived under a truck seat for snakes.',
  },
  pipe: {
    id: 'pipe', cls: 'improvised', name: 'Pipe shotgun', icon: 'icon_pipegun', ammo: 'shell', caliber: 'shot',
    dmg: 18, rof: 1, mag: 1, reload: 2.3, spread: 0.18, pellets: 8, pierce: 1, knock: 34, auto: false, noise: 2.2, jam: 0.07, craftable: true,
    niche: 'Two pipes and a nail. Cheapest gun you can build; takes any shell; jams.',
    desc: 'Slam the pipes together and the nail does the rest. Usually.',
  },
  autoshot: {
    id: 'autoshot', cls: 'shotgun', name: 'Riot auto-shotgun', icon: 'icon_autoshotgun', ammo: 'shell', caliber: 'shot',
    dmg: 13, rof: 3.2, mag: 8, reload: 3.6, spread: 0.12, pellets: 8, pierce: 1, knock: 22, auto: false, noise: 2.5, reloadPerRound: true,
    niche: 'Semi-auto 12-gauge: clears the wall in seconds and drinks shells doing it.',
    desc: 'County riot gun. The stock says PROPERTY OF in white paint.',
  },
  // --- rifles ---
  hunting: {
    id: 'hunting', cls: 'rifle', name: 'Bolt hunting rifle', icon: 'icon_rifle', ammo: 'rifle', caliber: 'rifle',
    dmg: 130, rof: 1, mag: 5, reload: 3.0, spread: 0.006, pellets: 1, pierce: 3, knock: 18, auto: false, noise: 2.2, armorPen: 0.4,
    niche: '.30-06 through three in a line; the deer-camp workhorse.',
    desc: 'Deer season opened the week everything ended.',
  },
  lever: {
    id: 'lever', cls: 'rifle', name: 'Lever .30-30', icon: 'icon_lever', ammo: 'rifle', caliber: 'rifle',
    dmg: 78, rof: 2, mag: 7, reload: 3.2, spread: 0.012, pellets: 1, pierce: 2, knock: 14, auto: false, noise: 2, reloadPerRound: true,
    niche: 'Fast follow-ups that pierce two, and a tube you can top off between Deer.',
    desc: 'Grandpa\'s brush gun. The stock is worn pale where a hand held it for sixty years.',
  },
  scoped: {
    id: 'scoped', cls: 'marksman', name: 'Scoped .308', icon: 'icon_scoped', ammo: 'rifle', caliber: 'rifle',
    dmg: 135, rof: 0.75, mag: 5, reload: 2.6, spread: 0.0025, pellets: 1, pierce: 3, knock: 20, auto: false, noise: 2.4, armorPen: 0.5,
    niche: 'Pinpoint and brutal: puts a round through a Deputy visor at the far end of the road.',
    desc: 'Glass worth more than the truck it rode in. Strand sold three a season.',
  },
  muzzle: {
    id: 'muzzle', cls: 'marksman', name: '.50 muzzleloader', icon: 'icon_muzzle', ammo: 'ball', caliber: 'ball',
    dmg: 280, rof: 0.5, mag: 1, reload: 3.6, spread: 0.004, pellets: 1, pierce: 4, knock: 45, auto: false, noise: 3, armorPen: 0.8, smoke: true, craftable: true, stagger: 1, switchTime: 0.1,
    niche: 'One enormous shot through four bodies, a cloud of smoke, then a long reload. Ammo is cheap.',
    desc: 'Black-powder season gun. Ram, cap, pray, and wait for the smoke to clear.',
  },
  // --- 5.56 ---
  ar15: {
    id: 'ar15', cls: 'assault', name: 'Range AR-15', icon: 'icon_ar15', ammo: 'r556', caliber: 'r556',
    dmg: 40, rof: 4, mag: 30, reload: 2.2, spread: 0.014, pellets: 1, pierce: 1, knock: 6, auto: false, noise: 2.2,
    niche: 'Accurate semi-auto thirty-rounder: the best all-rounder for a steady shooter.',
    desc: 'Off the rack at Strand Sporting. Red-dot sight, price tag still on the trigger guard.',
  },
  carbine: {
    id: 'carbine', cls: 'assault', name: 'Guard carbine', icon: 'icon_carbine', ammo: 'r556', caliber: 'r556',
    dmg: 32, rof: 8, mag: 30, reload: 2.4, spread: 0.045, pellets: 1, pierce: 1, knock: 8, auto: true, noise: 2.6,
    niche: 'Full-auto rifle rounds: pierce and volume at once, if you can feed it.',
    desc: 'Serial number filed. Someone walked away from the Line.',
  },
  lmg: {
    id: 'lmg', cls: 'heavy', name: 'Line machine gun', icon: 'icon_lmg', ammo: 'r556', caliber: 'r556',
    dmg: 36, rof: 10, mag: 100, reload: 6.5, spread: 0.075, pellets: 1, pierce: 1, knock: 9, auto: true, noise: 3.4, switchTime: 0.15,
    niche: 'A hundred rounds before you stop; the slowest reload in Vessey.',
    desc: 'Belt-fed, bipod bent. It held the bridge at Corliss for eleven hours.',
  },
  // --- quiet & strange ---
  compound: {
    id: 'compound', cls: 'bow', name: 'Compound bow', icon: 'icon_bow', ammo: 'bolt', caliber: 'bolt',
    dmg: 90, rof: 1.1, mag: 1, reload: 0.7, spread: 0.015, pellets: 1, pierce: 1, knock: 6, auto: false, noise: 0.1, recoverable: 0.6, stagger: 0.5,
    niche: 'Silent, and most arrows come back. Wakes nobody on a daylight run.',
    desc: 'Bowhunter\'s rig from a deer stand on the Halvorsen forty.',
  },
  crossbow: {
    id: 'crossbow', cls: 'bow', name: 'Crossbow', icon: 'icon_crossbow', ammo: 'bolt', caliber: 'bolt',
    dmg: 140, rof: 0.6, mag: 1, reload: 1.7, spread: 0.008, pellets: 1, pierce: 2, knock: 12, auto: false, noise: 0.15, armorPen: 0.4, recoverable: 0.5, craftable: true, stagger: 0.7,
    niche: 'A silent heavy bolt that pierces two; slow to span.',
    desc: 'Leaf-spring limbs off a Ford, a cable winch, a walnut stock.',
  },
  flaregun: {
    id: 'flaregun', cls: 'improvised', name: 'Flare pistol', icon: 'icon_flaregun', ammo: 'flare', caliber: 'flare',
    dmg: 30, rof: 1, mag: 1, reload: 1.6, spread: 0.03, pellets: 1, pierce: 0, knock: 4, auto: false, noise: 1, incendiary: true, flare: true, craftable: true,
    niche: 'Sets one burning and lights the road for every gun on the wall.',
    desc: 'Orange plastic from the boathouse emergency kit.',
  },
  nailer: {
    id: 'nailer', cls: 'improvised', name: 'Nail driver', icon: 'icon_nailgun', ammo: 'scrap', caliber: 'nails',
    dmg: 22, rof: 8, mag: 40, reload: 2.6, spread: 0.05, pellets: 1, pierce: 1, knock: 2, auto: true, noise: 0.5, perShot: 0.08, craftable: true, limbMul: 0.8, stagger: 0.04,
    niche: 'Near-silent automatic that feeds on the scrap pile.',
    desc: 'Mill-shop contraption. Quiet. Feeds on scrap.',
  },
  rivet: {
    id: 'rivet', cls: 'improvised', name: 'Rivet gun', icon: 'icon_rivet', ammo: 'scrap', caliber: 'nails',
    dmg: 62, rof: 1.6, mag: 10, reload: 2.2, spread: 0.02, pellets: 1, pierce: 2, knock: 7, auto: false, noise: 0.6, armorPen: 0.6, perShot: 0.25, craftable: true,
    niche: 'Quiet steel rivets that punch through Deputy plate; hungry for scrap.',
    desc: 'A boiler-shop rivet hammer on a compressor bottle. Thunk.',
  },
  // --- launchers ---
  law: {
    id: 'law', cls: 'launcher', name: 'M72 rocket tube', icon: 'icon_law', ammo: 'rocket', caliber: 'rocket',
    dmg: 80, rof: 0.5, mag: 1, reload: 3.5, spread: 0.012, pellets: 1, pierce: 0, knock: 90, auto: false, noise: 7, armorPen: 1, smoke: true, stagger: 1,
    explosive: { radius: 170, dmg: 340 },
    niche: 'One rocket, one hole in the horde: the answer to a Ferryman and everything standing near it.',
    desc: 'Disposable, olive drab, stencilled THE LINE HOLDS. Reloading means unslinging the next tube.',
  },
  m79: {
    id: 'm79', cls: 'launcher', name: '40mm grenade launcher', icon: 'icon_m79', ammo: 'g40', caliber: 'g40',
    dmg: 40, rof: 0.8, mag: 1, reload: 2.2, spread: 0.02, pellets: 1, pierce: 0, knock: 50, auto: false, noise: 3.5, stagger: 1,
    explosive: { radius: 100, dmg: 150 }, arc: true,
    niche: 'Lobs a grenade over the front rank into the middle of the pack; buckshot rounds for the wall.',
    desc: 'A break-open thumper from the County armoury. Somebody wrote RIOT ONLY on it in marker.',
  },
  pipemortar: {
    id: 'pipemortar', cls: 'launcher', name: 'Pipe-bomb mortar', icon: 'icon_pipemortar', ammo: 'pipebomb', caliber: 'pipebomb',
    dmg: 20, rof: 0.4, mag: 1, reload: 3.4, spread: 0.06, pellets: 1, pierce: 0, knock: 40, auto: false, noise: 4, jam: 0.08, craftable: true, stagger: 0.8,
    explosive: { radius: 85, dmg: 115 }, arc: true,
    niche: 'Cheap homemade area damage, lobbed; inaccurate, and one in twelve is a dud.',
    desc: 'A fence-post driver tube on a shotgun stock, and a shotshell to kick the bomb out.',
  },
};

export const WEAPON_ORDER = [
  'service9', 'revolver', 'm1911', 'mp93', 'smg', 'r22',
  'pump', 'coach', 'snake410', 'pipe', 'autoshot',
  'hunting', 'lever', 'scoped', 'muzzle',
  'ar15', 'carbine', 'lmg',
  'compound', 'crossbow', 'flaregun', 'nailer', 'rivet',
  'law', 'm79', 'pipemortar',
];

export const CLASS_NAMES: Record<WeaponClass, string> = {
  handgun: 'Handguns', smg: 'Submachine guns', rifle: 'Rifles', assault: 'Assault rifles', marksman: 'Marksman rifles',
  shotgun: 'Shotguns', heavy: 'Heavy machine guns', launcher: 'Launchers', bow: 'Bows', improvised: 'Improvised', melee: 'Melee',
};

// Every icon the arsenal needs (spread into the asset preload list).
export const ARSENAL_ICONS: string[] = [...new Set([
  'icon_m_hatchet', 'icon_m_fellingaxe', 'icon_m_crowbar', 'icon_m_bat', 'icon_m_machete', 'icon_m_fireaxe', 'icon_m_sledge', 'icon_m_boathook', 'icon_m_knife', 'icon_m_chainsaw',
  'icon_law', 'icon_m79', 'icon_pipemortar', 'icon_rocket', 'icon_g40', 'icon_pipebomb',
  'icon_mod_scope', 'icon_mod_reddot', 'icon_mod_suppressor', 'icon_mod_brake', 'icon_mod_sawedoff',
  'icon_mod_flashlight', 'icon_mod_hatchet', 'icon_mod_bipod', 'icon_mod_extmag', 'icon_mod_drum', 'icon_mod_taped', 'icon_mod_sling',
  ...Object.values(WEAPONS).map((w) => w.icon),
  ...Object.values(CALIBERS).map((c) => c.icon),
  ...Object.values(AMMO_TYPES).map((a) => a!.icon),
])];

// Legacy pool names (still used by some night code).
export const AMMO_NAMES: Record<string, string> = { light: 'Pistol rounds', shell: 'Shells', rifle: 'Rifle rounds', scrap: 'Scrap' };


// ---------- melee ----------
export interface MeleeDef {
  id: string; name: string; icon: string; niche: string; desc: string;
  dmg: number; reach: number; arc: number; swingTime: number; recovery: number; knock: number; stagger: number;
  bleed?: number; crit: number; finisher?: boolean; stamina: number; noise: number; wear: number; fuel?: number; pry?: number;
  craftable?: boolean;
}
export const BLEED_TIME = 4;
export const MELEE: Record<string, MeleeDef> = {
  hatchet: {
    id: 'hatchet', name: 'Hatchet', icon: 'icon_m_hatchet', dmg: 34, reach: 55, arc: 1, swingTime: 0.2, recovery: 0.22, knock: 10, stagger: 0.25, crit: 2, stamina: 8, noise: 0.15, wear: 0.004,
    niche: 'Fast and cheap: two quick chops while anything heavier is still winding up.',
    desc: 'A Plumb hatchet from the kindling box by the stove.',
  },
  fellingaxe: {
    id: 'fellingaxe', name: 'Felling axe', icon: 'icon_m_fellingaxe', dmg: 60, reach: 72, arc: 3, swingTime: 0.5, recovery: 0.45, knock: 22, stagger: 0.5, crit: 2, stamina: 20, noise: 0.2, wear: 0.003,
    niche: 'A slow, wide cleave through three at once.',
    desc: 'A Michigan-pattern head on a hickory helve, sharpened for pulpwood.',
  },
  crowbar: {
    id: 'crowbar', name: 'Crowbar', icon: 'icon_m_crowbar', dmg: 30, reach: 60, arc: 1, swingTime: 0.28, recovery: 0.3, knock: 30, stagger: 0.7, crit: 1.8, stamina: 12, noise: 0.25, wear: 0.0008, pry: 1.8,
    niche: 'Knocks them down, never breaks, and pries doors and cars open nearly twice as fast.',
    desc: 'Thirty inches of mill-shop steel. Opens anything, eventually.',
  },
  bat: {
    id: 'bat', name: 'Aluminum bat', icon: 'icon_m_bat', dmg: 26, reach: 65, arc: 2, swingTime: 0.26, recovery: 0.3, knock: 55, stagger: 0.8, crit: 1.8, stamina: 12, noise: 0.3, wear: 0.002,
    niche: 'Shove and stagger: buys room more than it kills.',
    desc: 'Vessey Vikings JV, 2019. The dents are newer.',
  },
  machete: {
    id: 'machete', name: 'Machete', icon: 'icon_m_machete', dmg: 30, reach: 60, arc: 2, swingTime: 0.2, recovery: 0.2, knock: 6, stagger: 0.2, bleed: 9, crit: 2, stamina: 9, noise: 0.1, wear: 0.004,
    niche: 'Fast, wide, and everything it touches keeps bleeding.',
    desc: 'Brush machete from the county road crew. Somebody kept it sharp.',
  },
  fireaxe: {
    id: 'fireaxe', name: 'Fire axe', icon: 'icon_m_fireaxe', dmg: 70, reach: 70, arc: 2, swingTime: 0.45, recovery: 0.4, knock: 25, stagger: 0.6, crit: 3, stamina: 18, noise: 0.2, wear: 0.002,
    niche: 'Heavy crits: an overhead blow splits a head in one.',
    desc: 'Red-handled pick-head axe off Engine 2. VESSEY VFD on the blade.',
  },
  sledge: {
    id: 'sledge', name: 'Sledgehammer', icon: 'icon_m_sledge', dmg: 55, reach: 70, arc: 2, swingTime: 0.65, recovery: 0.6, knock: 95, stagger: 1, crit: 2, stamina: 28, noise: 0.4, wear: 0.0008,
    niche: 'Huge knockback that even rocks a Ferryman; slow and exhausting.',
    desc: 'Eight pounds of fence-post driver. Two swings and you need a breather.',
  },
  boathook: {
    id: 'boathook', name: 'Boat hook', icon: 'icon_m_boathook', dmg: 22, reach: 115, arc: 1, swingTime: 0.3, recovery: 0.3, knock: 40, stagger: 0.45, crit: 1.6, stamina: 10, noise: 0.1, wear: 0.003,
    niche: 'Reach: hits at nearly twice arm\'s length and holds one off the wall.',
    desc: 'Ash pole and a bronze hook from the Halvorsen ferry.',
  },
  knife: {
    id: 'knife', name: 'Filleting knife', icon: 'icon_m_knife', dmg: 18, reach: 40, arc: 1, swingTime: 0.15, recovery: 0.15, knock: 2, stagger: 0.05, crit: 2.5, finisher: true, stamina: 5, noise: 0, wear: 0.003,
    niche: 'Silent finisher: sleeping, downed or crawling ones die without a sound.',
    desc: 'A Rapala fillet knife from a tackle box. Thin, quick, quiet.',
  },
  chainsaw: {
    id: 'chainsaw', name: 'Chainsaw', icon: 'icon_m_chainsaw', dmg: 24, reach: 62, arc: 2, swingTime: 0.06, recovery: 0.06, knock: 4, stagger: 0.5, bleed: 6, crit: 1.5, stamina: 2, noise: 2.2, wear: 0.0015, fuel: 0.04,
    niche: 'Devastating and continuous — burns fuel, and every one of them hears it.',
    desc: 'A Husqvarna from the hardware rental shelf. Hold it down.',
  },
  // improvised (craftable)
  spear: {
    id: 'spear', name: 'Rebar spear', icon: 'icon_m_boathook', dmg: 30, reach: 100, arc: 2, swingTime: 0.3, recovery: 0.35, knock: 18, stagger: 0.35, crit: 1.6, stamina: 10, noise: 0.1, wear: 0.006, craftable: true,
    niche: 'Reach on the cheap: thrusts through two in a line.',
    desc: 'Number-5 rebar ground to a point, tape for a grip.',
  },
  nailbat: {
    id: 'nailbat', name: 'Nail bat', icon: 'icon_m_bat', dmg: 32, reach: 65, arc: 2, swingTime: 0.28, recovery: 0.3, knock: 45, stagger: 0.7, bleed: 5, crit: 1.8, stamina: 12, noise: 0.3, wear: 0.006, craftable: true,
    niche: 'A bat that also opens them up: shove plus bleed.',
    desc: 'Sixteen-penny nails through a Louisville Slugger.',
  },
  sawblade: {
    id: 'sawblade', name: 'Saw-blade machete', icon: 'icon_m_machete', dmg: 34, reach: 60, arc: 2, swingTime: 0.24, recovery: 0.24, knock: 8, stagger: 0.2, bleed: 7, crit: 2, stamina: 10, noise: 0.15, wear: 0.007, craftable: true,
    niche: 'Bandsaw steel from the mill: a heavier, ragged machete.',
    desc: 'Cut from a broken head-rig bandsaw blade, ground on the bench grinder.',
  },
};
export const MELEE_ORDER = Object.keys(MELEE);
export const MELEE_ICONS: string[] = [...new Set(Object.values(MELEE).map((m) => m.icon))];

export interface MeleeProfile {
  cls: 'melee'; dmg: number; reach: number; arc: number; swingTime: number; recovery: number; knock: number; stagger: number;
  bleed: number; crit: number; finisher: boolean; stamina: number; noise: number; wear: number; fuel: number; pry: number;
}
export interface MeleeMods { dmgMul?: number; speedMul?: number; staminaMul?: number }
/** Melee CONTRACT: hand weapon + condition (+ optional survivor modifiers). Pure. */
export function meleeProfile(w: WeaponItem, mods: MeleeMods = {}): MeleeProfile {
  const d = MELEE[w.def];
  const cond = Math.max(0, Math.min(1, w.cond));
  const sp = mods.speedMul ?? 1;
  return {
    cls: 'melee',
    dmg: Math.round(d.dmg * (0.7 + 0.3 * cond) * (mods.dmgMul ?? 1)),
    reach: d.reach, arc: d.arc,
    swingTime: d.swingTime * sp, recovery: d.recovery * sp,
    knock: d.knock, stagger: d.stagger, bleed: d.bleed ?? 0, crit: d.crit, finisher: !!d.finisher,
    stamina: d.stamina * (mods.staminaMul ?? 1), noise: d.noise, wear: d.wear, fuel: d.fuel ?? 0, pry: d.pry ?? 1,
  };
}
/** Bare hands, for a survivor without a melee weapon. */
export const FISTS: MeleeProfile = { cls: 'melee', dmg: 8, reach: 45, arc: 1, swingTime: 0.2, recovery: 0.6, knock: 60, stagger: 0.3, bleed: 0, crit: 1, finisher: false, stamina: 10, noise: 0.1, wear: 0, fuel: 0, pry: 1 };

// ---------- attachments ----------
// Which attachment family a gun belongs to (finer than proficiency class for fitting purposes).
type ModFamily = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'lmg' | 'bow' | 'tool';
export function weaponClass(defId: string): WeaponClass {
  return WEAPONS[defId]?.cls ?? 'improvised';
}
function modFamily(defId: string): ModFamily {
  const d = WEAPONS[defId];
  if (!d || d.cls === 'launcher') return 'tool';
  if (d.caliber === 'nails') return 'tool';
  if (d.caliber === 'bolt') return 'bow';
  if (defId === 'lmg') return 'lmg';
  if (d.caliber === 'shot') return 'shotgun';
  if (defId === 'flaregun' || (d.caliber === 'pistol' && !d.auto)) return 'pistol';
  if (d.caliber === 'pistol') return 'smg';
  return 'rifle';
}
// guns that take a detachable box magazine
const BOX_MAG = ['service9', 'm1911', 'mp93', 'smg', 'r22', 'ar15', 'carbine'];
const TUBE_MAG = ['pump', 'autoshot', 'lever'];
const LONG = (id: string) => ['shotgun', 'rifle', 'lmg'].includes(modFamily(id)) && id !== 'pipe';

export interface ModDef {
  id: string; name: string; slot: ModSlot; icon: string; niche: string; desc: string;
  fits: (defId: string) => boolean;
  dmgMul?: number; spreadMul?: number; coneMul?: number; rofMul?: number; magMul?: number; reloadMul?: number;
  noiseMul?: number; knockMul?: number; bloomMul?: number; recoilMul?: number; braceBloomMul?: number;
  switchTime?: number; light?: number; melee?: number; range?: number; armorPen?: number;
  life?: number; // rounds before it wears out (suppressor)
}
export const MOD_SLOTS: { id: ModSlot; name: string }[] = [
  { id: 'optic', name: 'optic' }, { id: 'muzzle', name: 'muzzle' }, { id: 'barrel', name: 'barrel' },
  { id: 'under', name: 'under-barrel' }, { id: 'mag', name: 'magazine' }, { id: 'stock', name: 'stock' },
];
export const MODS: Record<string, ModDef> = {
  scope: {
    id: 'scope', name: 'Deer scope', slot: 'optic', icon: 'icon_mod_scope',
    niche: 'Pinpoint at range; slow to swing onto a new target.',
    desc: 'A 3-9x from a stand on the Halvorsen forty. Zeroed for a buck at a hundred yards.',
    fits: (id) => ['rifle', 'bow'].includes(modFamily(id)) && id !== 'muzzle',
    spreadMul: 0.35, rofMul: 0.85, switchTime: 0.35,
  },
  reddot: {
    id: 'reddot', name: 'Red-dot sight', slot: 'optic', icon: 'icon_mod_reddot',
    niche: 'Faster, tighter snap shots on anything with a front sight.',
    desc: 'Pulled off a Guard rifle at Corliss. The battery is the precious part.',
    fits: (id) => !['tool', 'bow', 'lmg'].includes(modFamily(id)) && id !== 'pipe' && id !== 'flaregun',
    spreadMul: 0.72, switchTime: -0.12,
  },
  suppressor: {
    id: 'suppressor', name: 'Oil-filter suppressor', slot: 'muzzle', icon: 'icon_mod_suppressor',
    niche: 'Turns a shot into a cough; a little weaker, and it burns out.',
    desc: 'A truck oil filter on a threaded adapter. Good for a few nights of shooting.',
    fits: (id) => ['pistol', 'smg', 'rifle'].includes(modFamily(id)) && !['muzzle', 'revolver', 'flaregun'].includes(id),
    noiseMul: 0.3, dmgMul: 0.92, life: 240,
  },
  brake: {
    id: 'brake', name: 'Muzzle brake', slot: 'muzzle', icon: 'icon_mod_brake',
    niche: 'Kills muzzle climb so follow-ups land; louder for everyone.',
    desc: 'Slotted pipe coupling, ported on the lathe.',
    fits: (id) => ['rifle', 'lmg', 'shotgun', 'smg'].includes(modFamily(id)) && !['pipe', 'muzzle', 'r22', 'coach'].includes(id),
    recoilMul: 0.6, bloomMul: 0.72, noiseMul: 1.3,
  },
  choke: {
    id: 'choke', name: 'Full choke', slot: 'muzzle', icon: 'icon_mod_brake',
    niche: 'Tightens the shot cone: buckshot that reaches the back of the road.',
    desc: 'Screw-in turkey choke from Strand\'s counter.',
    fits: (id) => modFamily(id) === 'shotgun' && !['pipe', 'flaregun'].includes(id),
    coneMul: 0.62, knockMul: 0.9,
  },
  sawedoff: {
    id: 'sawedoff', name: 'Sawed-off barrel', slot: 'barrel', icon: 'icon_mod_sawedoff',
    niche: 'A wide, brutal cone and more shove — for the wall only; weak past the wire.',
    desc: 'Hacksaw, file, and a decision you cannot undo. (Detach it and it goes back on the shelf.)',
    fits: (id) => ['pump', 'coach', 'snake410'].includes(id),
    coneMul: 1.45, knockMul: 1.3, switchTime: -0.1, range: 520,
  },
  flashlight: {
    id: 'flashlight', name: 'Duct-taped flashlight', slot: 'under', icon: 'icon_mod_flashlight',
    niche: 'A cone of light down the barrel: see them, and so does everyone on the wall.',
    desc: 'A Maglite and most of a roll of duct tape.',
    fits: (id) => modFamily(id) !== 'tool' && id !== 'flaregun',
    light: 340,
  },
  hatchet: {
    id: 'hatchet', name: 'Hatchet bayonet', slot: 'under', icon: 'icon_mod_hatchet',
    niche: 'A blade at the wall when the gun runs dry; heavy on the muzzle.',
    desc: 'A Plumb hatchet head hose-clamped under the barrel.',
    fits: LONG,
    melee: 45, spreadMul: 1.06,
  },
  bipod: {
    id: 'bipod', name: 'Bipod', slot: 'under', icon: 'icon_mod_bipod',
    niche: 'Braced on the wall, bloom all but vanishes; clumsy to swing.',
    desc: 'Folding legs off a range rifle, or two bent tent stakes.',
    fits: (id) => ['hunting', 'scoped', 'ar15', 'carbine', 'lmg', 'muzzle', 'lever'].includes(id),
    braceBloomMul: 0.45, switchTime: 0.15,
  },
  extmag: {
    id: 'extmag', name: 'Extended magazine', slot: 'mag', icon: 'icon_mod_extmag',
    niche: 'Half again as many rounds; a slower, fumblier reload.',
    desc: 'A longer box, or a tube extension clamped to the barrel.',
    fits: (id) => BOX_MAG.includes(id) || TUBE_MAG.includes(id),
    magMul: 1.5, reloadMul: 1.15,
  },
  drum: {
    id: 'drum', name: 'Drum magazine', slot: 'mag', icon: 'icon_mod_drum',
    niche: 'Two and a half magazines in one; a long reload and a heavy, wandering muzzle.',
    desc: 'A County SWAT drum. Rattles like a coffee can of bolts.',
    fits: (id) => ['smg', 'carbine', 'ar15'].includes(id),
    magMul: 2.5, reloadMul: 1.6, spreadMul: 1.1,
  },
  taped: {
    id: 'taped', name: 'Taped double mags', slot: 'mag', icon: 'icon_mod_taped',
    niche: 'Two magazines taped head to tail: flip and go, a much faster reload.',
    desc: 'The oldest trick there is. Electrical tape, and practice.',
    fits: (id) => BOX_MAG.includes(id) && id !== 'r22',
    reloadMul: 0.6,
  },
  speedloader: {
    id: 'speedloader', name: 'Speedloader', slot: 'mag', icon: 'icon_mod_taped',
    niche: 'Six at once into the cylinder: halves the revolver\'s reload.',
    desc: 'A twist-lock loader from a dead deputy\'s belt.',
    fits: (id) => id === 'revolver',
    reloadMul: 0.5,
  },
  sling: {
    id: 'sling', name: 'Sling & padded stock', slot: 'stock', icon: 'icon_mod_sling',
    niche: 'Less kick and bloom from long strings of fire.',
    desc: 'A rifle sling and a cut-down boot insole for a recoil pad.',
    fits: (id) => LONG(id) || id === 'crossbow' || id === 'smg',
    recoilMul: 0.7, bloomMul: 0.8, switchTime: 0.05,
  },
};
export const MOD_ICONS: string[] = [...new Set(Object.values(MODS).map((m) => m.icon))];

export function modFits(modId: string, defId: string): boolean {
  return !!MODS[modId]?.fits(defId);
}
/** Slots this gun has any attachment for. */
export function slotsFor(defId: string): ModSlot[] {
  return MOD_SLOTS.map((s) => s.id).filter((slot) => Object.values(MODS).some((m) => m.slot === slot && m.fits(defId)));
}
/** Moves a mod from the spare stock onto the gun (swapping out whatever was there). */
export function attachMod(stock: ModItem[], w: WeaponItem, modUid: string): boolean {
  const i = stock.findIndex((m) => m.uid === modUid);
  if (i < 0) return false;
  const m = stock[i];
  const def = MODS[m.def];
  if (!def || !def.fits(w.def)) return false;
  stock.splice(i, 1);
  w.mods = w.mods ?? {};
  const old = w.mods[def.slot];
  if (old) stock.push(old);
  w.mods[def.slot] = m;
  return true;
}
export function detachMod(stock: ModItem[], w: WeaponItem, slot: ModSlot): void {
  const m = w.mods?.[slot];
  if (!m) return;
  delete w.mods![slot];
  stock.push(m);
}
/** Wear attachments with a life (suppressors) by rounds fired; returns lines for the log. */
export function wearMods(w: WeaponItem, rounds: number): string[] {
  const out: string[] = [];
  if (!w.mods || rounds <= 0) return out;
  for (const [slot, m] of Object.entries(w.mods) as [ModSlot, ModItem][]) {
    const life = MODS[m.def]?.life;
    if (!life) continue;
    m.cond = Math.max(0, m.cond - rounds / life);
    if (m.cond <= 0) {
      delete w.mods[slot];
      out.push(`The ${MODS[m.def].name.toLowerCase()} on the ${WEAPONS[w.def].name.toLowerCase()} is burnt out.`);
    }
  }
  return out;
}

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

/** Which existing procedural shot sound (sfx.shot kind) a gun should use. */
export function shotSound(defId: string): string {
  const d = WEAPONS[defId];
  if (!d) return 'service9';
  if (d.caliber === 'nails' || d.caliber === 'bolt' || d.caliber === 'r22') return 'nailer';
  if (d.caliber === 'shot' || d.caliber === 'flare' || d.cls === 'launcher') return 'pump';
  if (d.caliber === 'rifle' || d.caliber === 'ball') return 'hunting';
  if (d.auto) return 'smg';
  return defId;
}

/** Blast damage at a ground-space offset (dx, dy from the impact foot point), or 0 if outside. */
export function blastDamage(ex: { radius: number; dmg: number }, dx: number, dy: number): number {
  const q = (dx / ex.radius) ** 2 + (dy / (0.3 * ex.radius)) ** 2;
  if (q > 1) return 0;
  return ex.dmg * (1 - 0.7 * Math.sqrt(q));
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
export function fireProfile(w: WeaponItem, opts: { noMods?: boolean; shooter?: ShooterMods } = {}): FireProfile {
  const p = baseProfile(w);
  const sh = opts.shooter;
  if (sh) {
    p.reload *= sh.reloadMul ?? 1;
    p.spread *= sh.spreadMul ?? 1;
    p.jam = Math.min(1, p.jam * (sh.jamMul ?? 1));
    p.bloomMul *= sh.bloomMul ?? 1;
  }
  if (opts.noMods || !w.mods) return p;
  for (const m of Object.values(w.mods)) {
    const md = m && MODS[m.def];
    if (!md || !md.fits(w.def)) continue;
    p.dmg = Math.round(p.dmg * (md.dmgMul ?? 1) * 10) / 10;
    if (p.pellets > 1) p.spread *= md.coneMul ?? 1;
    else p.spread *= md.spreadMul ?? 1;
    if (p.pellets > 1 && md.spreadMul && md.spreadMul > 1) p.spread *= md.spreadMul; // weight still hurts
    p.rof *= md.rofMul ?? 1;
    if (md.magMul) p.mag = Math.max(1, Math.round(p.mag * md.magMul));
    p.reload *= md.reloadMul ?? 1;
    p.noise *= md.noiseMul ?? 1;
    p.knock *= md.knockMul ?? 1;
    p.bloomMul *= md.bloomMul ?? 1;
    p.recoilMul *= md.recoilMul ?? 1;
    p.braceBloomMul *= md.braceBloomMul ?? 1;
    p.switchTime += md.switchTime ?? 0;
    p.light = Math.max(p.light, md.light ?? 0);
    p.melee = Math.max(p.melee, md.melee ?? 0);
    p.range = Math.min(p.range, md.range ?? Infinity);
    p.armorPen = Math.max(-1, Math.min(1, p.armorPen + (md.armorPen ?? 0)));
  }
  p.switchTime = Math.max(0, p.switchTime);
  return p;
}

function baseProfile(w: WeaponItem): FireProfile {
  const d = WEAPONS[w.def];
  const res = selectedAmmo(w);
  const a = res ? AMMO_TYPES[res] : undefined;
  const cond = Math.max(0, Math.min(1, w.cond));
  let pellets = d.pellets;
  let dmg = d.dmg;
  let spread = d.spread;
  let knock = d.knock;
  if (a?.pelletsSet) pellets = a.pelletsSet;
  if (a?.dmgSet) dmg = a.dmgSet;
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
    limbMul: a?.limbMul ?? d.limbMul ?? (pellets > 1 ? 1.2 : 1),
    stagger: Math.max(0, Math.min(1, a?.stagger ?? d.stagger ?? (knock * (pellets > 1 ? pellets * 0.25 : 1)) / (pellets > 1 ? 90 : 45))),
    light: 0, melee: 0, bloomMul: 1, recoilMul: 1, braceBloomMul: 1, switchTime: d.switchTime ?? 0, range: Infinity,
    jamClear: d.jam ? 1.8 : d.caliber === 'ball' ? 1.4 : 0.9,
    cls: d.cls,
    explosive: a?.explosive === null ? undefined : a?.explosive ?? d.explosive,
    arc: a?.arc ?? d.arc,
  };
}
