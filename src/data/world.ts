import type { Res } from '../types';
import { TRAP_RECIPES } from './traps';

// ---------- scavenging sites around Vessey ----------
export interface Site {
  id: string;
  name: string;
  desc: string;
  risk: number; // 0..1 chance-ish of trouble
  loot: Partial<Record<Res, number>>; // expected yield per run at full stock
  weaponChance: number;
  weapons: string[];
  melee?: string[]; // hand weapons that can turn up here (MELEE keys)
  mods?: string[]; // attachments that can turn up here (MODS keys); found on daylight runs
  survivorChance: number;
  minDay: number;
  stock: number; // runs before it's picked clean
}

export const SITES: Site[] = [
  { id: 'route9', name: 'Route 9 houses', desc: 'Split-levels and trailers along the county road. Somebody\'s kitchen, somebody\'s garage.', risk: 0.12, loot: { food: 5, salvage: 11, pistol: 10, shell: 2 }, weaponChance: 0.06, weapons: ['revolver', 'r22', 'r22', 'snake410'], melee: ['hatchet', 'bat', 'hatchet'], mods: ['flashlight', 'sling'], survivorChance: 0.1, minDay: 1, stock: 8 },
  { id: 'diner', name: 'Ferry Diner', desc: 'The walk-in cooler stopped humming a week ago. The whiteboard still says SOUP.', risk: 0.15, loot: { food: 9, fuel: 1, salvage: 1 }, weaponChance: 0.03, weapons: ['service9', 'snake410'], melee: ['knife'], survivorChance: 0.08, minDay: 1, stock: 5 },
  { id: 'rexall', name: 'Rexall pharmacy', desc: 'Looted twice. Not everything was understood by the looters.', risk: 0.25, loot: { meds: 4, food: 2, salvage: 2 }, weaponChance: 0.02, weapons: ['service9', 'm1911'], survivorChance: 0.06, minDay: 1, stock: 5 },
  { id: 'millyard', name: 'Aubin mill yard', desc: 'Pallets, drums, the maintenance shop. Pond 2 smells like bread gone off.', risk: 0.3, loot: { salvage: 18, fuel: 3, shell: 2 }, weaponChance: 0.05, weapons: ['nailer', 'rivet', 'pipe', 'flaregun'], melee: ['crowbar', 'sledge', 'crowbar'], mods: ['flashlight', 'hatchet', 'suppressor'], survivorChance: 0.08, minDay: 2, stock: 9 },
  { id: 'legion', name: 'Legion hall', desc: 'Bingo cards on the floor. A doe walked in here once, during bingo.', risk: 0.2, loot: { food: 3, fuel: 2, pistol: 14, salvage: 2, shell: 3 }, weaponChance: 0.12, weapons: ['revolver', 'pump', 'coach', 'm1911'], melee: ['bat'], mods: ['speedloader', 'sling'], survivorChance: 0.1, minDay: 2, stock: 5 },
  { id: 'boathouse', name: 'Halvorsen boathouse', desc: 'Ferry family stores: rope, outboard parts, jerry cans, duck guns.', risk: 0.25, loot: { fuel: 6, salvage: 6, shell: 12 }, weaponChance: 0.12, weapons: ['pump', 'coach', 'flaregun', 'flaregun', 'snake410'], melee: ['boathook', 'knife', 'boathook'], mods: ['flashlight', 'choke'], survivorChance: 0.1, minDay: 3, stock: 6 },
  { id: 'deercamp', name: 'Nils\'s deer camp', desc: 'A plywood shack two miles up the Ox Creek trail. Blaze orange on every nail; the buck pole is empty.', risk: 0.3, loot: { food: 5, rifle: 14, fuel: 2, salvage: 2 }, weaponChance: 0.25, weapons: ['lever', 'hunting', 'muzzle', 'compound', 'crossbow', 'r22'], melee: ['hatchet', 'fellingaxe', 'knife'], mods: ['scope', 'scope', 'bipod', 'sling', 'choke'], survivorChance: 0.06, minDay: 3, stock: 4 },
  { id: 'hardware', name: 'Lindqvist Hardware & Feed', desc: 'Tools on pegboard, seed in sacks, a rental counter. The bell over the door still rings.', risk: 0.28, loot: { salvage: 18, fuel: 3 }, weaponChance: 0.05, weapons: ['nailer', 'r22'], melee: ['hatchet', 'fellingaxe', 'sledge', 'machete', 'crowbar', 'chainsaw', 'bat'], mods: ['flashlight', 'sling'], survivorChance: 0.06, minDay: 2, stock: 6 },
  { id: 'firehouse', name: 'Vessey Fire Hall', desc: 'Engine 2 is still in the bay, doors open. The volunteers went out on a call and did not come back.', risk: 0.35, loot: { meds: 4, fuel: 5, salvage: 6, shell: 3 }, weaponChance: 0.06, weapons: ['flaregun', 'service9'], melee: ['fireaxe', 'fireaxe', 'crowbar', 'chainsaw', 'boathook'], mods: ['flashlight'], survivorChance: 0.1, minDay: 3, stock: 5 },
  { id: 'manor', name: 'St. Aubin Manor', desc: 'The nursing home. The residents are still in residence.', risk: 0.45, loot: { meds: 6, food: 3, salvage: 3 }, weaponChance: 0.02, weapons: ['service9', 'r22'], survivorChance: 0.12, minDay: 4, stock: 5 },
  { id: 'school', name: 'Vessey High', desc: 'The gym was the Parish kitchen until it wasn\'t. Chem lab upstairs.', risk: 0.35, loot: { food: 6, fuel: 2, salvage: 6, meds: 1 }, weaponChance: 0.04, weapons: ['hunting', 'compound'], melee: ['bat', 'crowbar'], survivorChance: 0.18, minDay: 4, stock: 6 },
  { id: 'gunshop', name: 'Strand Sporting Goods', desc: 'Deer season opened the week everything ended. Shelves mostly bare.', risk: 0.4, loot: { pistol: 40, shell: 13, rifle: 15, salvage: 2 }, weaponChance: 0.3, weapons: ['hunting', 'pump', 'revolver', 'lever', 'scoped', 'ar15', 'compound', 'coach', 'r22'], mods: ['scope', 'reddot', 'choke', 'extmag', 'bipod', 'sling', 'brake'], survivorChance: 0.06, minDay: 5, stock: 4 },
  { id: 'courthouse', name: 'County courthouse', desc: 'The deputies held it with lists and quarantine. Now the lists are all that hold.', risk: 0.55, loot: { pistol: 26, rifle: 6, shell: 8, meds: 2, salvage: 4, explosive: 1.2 }, weaponChance: 0.35, weapons: ['smg', 'service9', 'autoshot', 'mp93', 'scoped', 'pump', 'm79'], melee: ['crowbar'], mods: ['drum', 'extmag', 'flashlight', 'taped', 'speedloader', 'reddot'], survivorChance: 0.1, minDay: 8, stock: 4 },
  { id: 'corliss', name: 'The Line at Corliss', desc: 'Thirty kilometres downriver. Sandbags, a dropped bridge, and whatever the Guard left behind.', risk: 0.7, loot: { rifle: 36, pistol: 16, shell: 4, meds: 4, salvage: 6, fuel: 4, explosive: 3 }, weaponChance: 0.5, weapons: ['carbine', 'carbine', 'lmg', 'smg', 'ar15', 'law', 'm79'], mods: ['reddot', 'reddot', 'drum', 'bipod', 'extmag', 'brake', 'taped'], survivorChance: 0.12, minDay: 12, stock: 3 },
];

// ---------- workshop machinery ----------
export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  cost: Partial<Record<Res, number>>[]; // per level (index 0 = build)
  maxLevel: number;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  workbench: { id: 'workbench', name: 'Workbench', desc: 'Vise, files, a reloading press scavenged from a deer camp. Ammo, repairs, traps.', cost: [{}, { salvage: 23 }, { salvage: 50 }], maxLevel: 3 },
  forge: { id: 'forge', name: 'Barrel forge', desc: 'An oil drum and a shop-vac blower. Bends steel for the wall and for armor.', cost: [{ salvage: 30 }, { salvage: 42 }], maxLevel: 2 },
  garden: { id: 'garden', name: 'Cold frames', desc: 'Storm windows over raised beds. Kale, turnips, hope.', cost: [{ salvage: 14 }, { salvage: 24 }, { salvage: 48 }], maxLevel: 3 },
  infirmary: { id: 'infirmary', name: 'Infirmary', desc: 'Two cots, a lamp, boiled sheets. Wounds heal faster; amputations survive more often.', cost: [{ salvage: 16 }, { salvage: 21, meds: 4 }], maxLevel: 2 },
  still: { id: 'still', name: 'Copper still', desc: 'Turns rot into fuel, food into courage, and fuel into firebombs.', cost: [{ salvage: 24 }], maxLevel: 1 },
  generator: { id: 'generator', name: 'Generator', desc: 'A diesel from the boathouse. Powers floodlights and power tools. Drinks fuel.', cost: [{ salvage: 32 }], maxLevel: 1 },
  radio: { id: 'radio', name: 'Radio mast', desc: 'A CB rig on the chimney. Hear the town; be heard by it.', cost: [{ salvage: 24 }], maxLevel: 1 },
};

// ---------- crafting recipes ----------
export interface Recipe {
  id: string;
  name: string;
  needs: string; // building id
  level?: number;
  cost: Partial<Record<Res, number>>;
  work: number; // work points (a skilled crafter makes ~8/day)
  gives?: Partial<Record<Res, number>>;
  weapon?: string;
  melee?: string; // MELEE key: a hand weapon goes into G.melee
  mod?: string; // MODS key: an attachment goes onto the bench (G.modStock)
  trap?: string; // TRAPS key: makes trap kits into G.trapStock (see data/traps.ts)
  trapCount?: number; // kits per craft (default 1)
  emplacement?: string; // EMPLACEMENTS key (data/emplacements.ts): builds a crew-served gun into G.flags.emplacements
  empRepair?: boolean; // restores the worst emplacement's condition
  hidden?: boolean; // kept for old queues/saves, not offered in the craft list
  special?: 'spikes' | 'wire' | 'light' | 'trap' | 'armor' | 'drink' | 'fortify' | 'repair' | 'turret' | 'duffel' | 'repairMelee' | 'roofnest';
  desc: string;
}

export const RECIPES: Recipe[] = [
  // --- ammunition: three pools, all at the workbench (rifle rounds need the bench at level 2) ---
  { id: 'ammo_light', name: 'Pistol rounds ×36', needs: 'workbench', cost: { salvage: 2, fuel: 1 }, work: 2, gives: { pistol: 36 }, desc: 'Reloaded brass, powder cut from shotshells and road flares. Feeds every handgun, the SMG and the farm .22.' },
  { id: 'ammo_shell', name: 'Shotgun shells ×16', needs: 'workbench', cost: { salvage: 3, fuel: 1 }, work: 2, gives: { shell: 16 }, desc: 'Nail-and-washer buckshot in hand-crimped hulls. Feeds every shotgun and the flare pistol.' },
  { id: 'ammo_rifle', name: 'Rifle rounds ×15', needs: 'workbench', level: 2, cost: { salvage: 5, fuel: 1 }, work: 2, gives: { rifle: 15 }, desc: 'Careful work; a bad load takes fingers. Feeds every rifle, the muzzleloader, and the AR, carbine and MG at half a round a shot.' },
  { id: 'duffel', name: 'Duffel bag', needs: 'workbench', cost: { salvage: 6 }, work: 3, special: 'duffel', desc: 'A canvas duffel for runs: +4 pack slots for whoever leads them. One is enough.' },
  // --- attachments (go onto the bench; fit them in the armory) ---
  { id: 'mod_suppressor', name: 'Oil-filter suppressor', needs: 'workbench', cost: { salvage: 5 }, work: 3, mod: 'suppressor', desc: 'A truck oil filter on a threaded adapter. Quiet, for a few nights.' },
  { id: 'mod_flashlight', name: 'Duct-taped flashlight', needs: 'workbench', cost: { salvage: 5 }, work: 2, mod: 'flashlight', desc: 'A Maglite taped under the barrel. Lights a cone down the road at night.' },
  { id: 'mod_sling', name: 'Sling & padded stock', needs: 'workbench', cost: { salvage: 4 }, work: 2, mod: 'sling', desc: 'Less kick, less bloom on long strings of fire.' },
  { id: 'mod_taped', name: 'Taped double mags', needs: 'workbench', cost: { salvage: 3 }, work: 2, mod: 'taped', desc: 'Two magazines taped together: a much faster reload.' },
  { id: 'mod_sawedoff', name: 'Sawed-off barrel', needs: 'workbench', cost: { salvage: 1 }, work: 2, mod: 'sawedoff', desc: 'Shorter shotgun barrel: wide cone, big shove, weak past the wire.' },
  { id: 'mod_choke', name: 'Full choke', needs: 'workbench', level: 2, cost: { salvage: 6 }, work: 3, mod: 'choke', desc: 'Threaded choke tube turned on the lathe. Tighter buckshot.' },
  { id: 'mod_extmag', name: 'Extended magazine', needs: 'workbench', level: 2, cost: { salvage: 10 }, work: 4, mod: 'extmag', desc: 'Two magazines welded into one long one.' },
  { id: 'mod_speedloader', name: 'Speedloader', needs: 'workbench', level: 2, cost: { salvage: 5 }, work: 3, mod: 'speedloader', desc: 'Twist-lock revolver loader, filed from a pipe cap.' },
  { id: 'mod_hatchet', name: 'Hatchet bayonet', needs: 'forge', cost: { salvage: 6 }, work: 3, mod: 'hatchet', desc: 'A hatchet head clamped under a long gun. Melee at the wall.' },
  { id: 'mod_bipod', name: 'Bipod', needs: 'forge', cost: { salvage: 6 }, work: 3, mod: 'bipod', desc: 'Folding legs for rifles and the LMG: steady on the wall.' },
  { id: 'mod_brake', name: 'Muzzle brake', needs: 'forge', level: 2, cost: { salvage: 8 }, work: 4, mod: 'brake', desc: 'Ported pipe coupling: less climb, more bark.' },
  // --- improvised hand weapons ---
  { id: 'm_spear', name: 'Rebar spear', needs: 'forge', cost: { salvage: 4 }, work: 3, melee: 'spear', desc: 'Rebar ground to a point. Reach on the cheap.' },
  { id: 'm_nailbat', name: 'Nail bat', needs: 'workbench', cost: { salvage: 5 }, work: 2, melee: 'nailbat', desc: 'Nails through a bat. Shove and bleed.' },
  { id: 'm_sawblade', name: 'Saw-blade machete', needs: 'forge', cost: { salvage: 6 }, work: 4, melee: 'sawblade', desc: 'Cut from a broken mill bandsaw blade.' },
  { id: 'm_hatchet', name: 'Hatchet', needs: 'forge', level: 2, cost: { salvage: 6 }, work: 4, melee: 'hatchet', desc: 'Forge a head from a leaf spring, fit a hickory handle.' },
  // --- improvised guns ---
  { id: 'pipe', name: 'Pipe shotgun', needs: 'workbench', cost: { salvage: 12 }, work: 4, weapon: 'pipe', desc: 'Two pipes and a nail. Eats shotgun shells. Jams.' },
  { id: 'flaregun', name: 'Flare pistol', needs: 'workbench', level: 2, cost: { salvage: 12 }, work: 5, weapon: 'flaregun', desc: 'A drilled-out signal pistol body on a pipe barrel. Packs road-flare composition into two shotgun shells a shot.' },
  { id: 'crossbow', name: 'Crossbow', needs: 'forge', cost: { salvage: 18 }, work: 8, weapon: 'crossbow', desc: 'Leaf-spring limbs off a Ford, a winch, a walnut stock. Silent.' },
  { id: 'muzzle', name: '.50 muzzleloader', needs: 'forge', level: 2, cost: { salvage: 24 }, work: 10, weapon: 'muzzle', desc: 'A rifled barrel from a fence-post driver. One huge shot.' },
  { id: 'pipemortar', name: 'Pipe-bomb mortar', needs: 'workbench', level: 2, cost: { salvage: 20 }, work: 8, weapon: 'pipemortar', desc: 'A fence-post tube on a shotgun stock. Lobs explosives from the still over the dead.' },
  { id: 'rivet', name: 'Rivet gun', needs: 'workbench', level: 3, cost: { salvage: 32, fuel: 2 }, work: 12, weapon: 'rivet', desc: 'A boiler-shop rivet hammer on a welding bottle. Quiet; punches plate.' },
  { id: 'repair_melee', name: 'Sharpen & re-haft', needs: 'workbench', cost: { salvage: 3 }, work: 2, special: 'repairMelee', desc: 'Grind the worst edge, re-wedge the loosest handle (+50% condition).' },
  { id: 'repair', name: 'Repair the worst gun', needs: 'workbench', cost: { salvage: 5 }, work: 3, special: 'repair', desc: 'Strip, clean, file, pray.' },
  { id: 'nailer', name: 'Nail driver', needs: 'workbench', level: 2, cost: { salvage: 30, fuel: 2 }, work: 12, weapon: 'nailer', desc: 'A framing nailer fed from a welding bottle. Quiet. Eats salvage.' },
  { id: 'trap', name: 'Nail bomb trap', needs: 'workbench', cost: { salvage: 6, fuel: 2 }, work: 4, special: 'trap', hidden: true, desc: 'Pipe, nails, a tripwire. Goes off once, loudly.' },
  { id: 'fortify', name: 'Reinforce the wall', needs: 'forge', cost: { salvage: 40 }, work: 10, special: 'fortify', desc: '+60 max wall. Sheet steel and railroad ties.' },
  { id: 'roofnest', name: 'Roof nest', needs: 'workbench', cost: { salvage: 16 }, work: 5, special: 'roofnest', desc: 'A plank deck and sandbags on the garage roof: one rifle sees farther and steadier, out of reach while the wall stands. Post a guard there at dusk.' },
  { id: 'spikes', name: 'Spike row', needs: 'forge', cost: { salvage: 12 }, work: 4, special: 'spikes', desc: 'Sharpened rebar at shin height. The Turned impale themselves at the wall.' },
  { id: 'wire', name: 'Wire belt', needs: 'forge', cost: { salvage: 8 }, work: 3, special: 'wire', desc: 'Barbed wire strung across the road. Slows them in the kill zone.' },
  { id: 'armor', name: 'Mill-plate vest', needs: 'forge', cost: { salvage: 14 }, work: 6, special: 'armor', desc: 'Saw-blade steel sewn into a Carhartt. Lessens wounds. Not bites.' },
  { id: 'turret', name: 'Nail turret', needs: 'generator', cost: { salvage: 40, fuel: 2 }, work: 14, special: 'turret', desc: 'A framing nailer on a tractor-seat swivel, triggered by a doorbell relay. Fires at anything on the road. Eats salvage; needs the generator.' },
  { id: 'light', name: 'Floodlight', needs: 'generator', cost: { salvage: 9 }, work: 3, special: 'light', desc: 'A ballfield lamp on a pole. Burns fuel each night; you see them coming.' },
  { id: 'molotov', name: 'Firebombs & pipe bombs ×3', needs: 'still', cost: { fuel: 2, salvage: 2 }, work: 2, gives: { explosive: 3 }, desc: 'Three explosives: thrown with [F] / right click (fire on the road), or fed to a launcher.' },
  { id: 'drink', name: 'A round from the still', needs: 'still', cost: { food: 3 }, work: 2, special: 'drink', desc: 'Potato moonshine, poured when it is done: +mood for two days, anyone sulking comes back to work, and a Drinker is settled for two dawns.' },
  { id: 'fuel', name: 'Distill fuel ×4', needs: 'still', cost: { food: 3, salvage: 2 }, work: 3, gives: { fuel: 4 }, desc: 'Rot and sawdust to ethanol.' },
  { id: 'bandage', name: 'Field dressings', needs: 'infirmary', cost: { salvage: 3, fuel: 1 }, work: 2, gives: { meds: 1 }, desc: 'Boiled linen and moonshine.' },
];
// --- trap kits (data/traps.ts): placed on the road at dusk with the deployment planner ---
RECIPES.push(...TRAP_RECIPES);
// --- crew-served emplacements (data/emplacements.ts): manned at night from the firestep or the roof scaffold ---
RECIPES.push(
  { id: 'emp_mgnest', name: 'MG nest', needs: 'forge', level: 2, cost: { salvage: 42 }, work: 10, emplacement: 'mgnest', desc: 'Belt-fed 5.56 from the Line on a sandbagged tripod, with a spare barrel. Huge fire; overheats in untrained hands. Eats rifle rounds (half a round a shot).' },
  { id: 'emp_swivel', name: 'Swivel deer rifle', needs: 'forge', cost: { salvage: 18 }, work: 6, emplacement: 'swivel', desc: 'A .30-06 on a pontoon-boat seat bolted to a post: slow, braced, through four in a line. Eats rifle rounds.' },
  { id: 'emp_flamer', name: 'Propane flame projector', needs: 'workbench', level: 2, cost: { salvage: 18, fuel: 4 }, work: 8, emplacement: 'flamer', desc: 'A weed burner on two grill tanks over the barricade: a short cone that sets everything burning. Drinks fuel.' },
  { id: 'emp_repair', name: 'Overhaul a gun nest', needs: 'forge', cost: { salvage: 8 }, work: 3, empRepair: true, desc: 'New springs, a cleaned feed tray, the sandbags restacked (+50% condition on the most worn emplacement).' },
);

/**
 * Wall builds that stop helping past a count: night/battle.ts reads at most 3 floodlights (sight and
 * aim) and 3 wire belts, night/emplacements.ts mounts at most 2 nail turrets. The workshop will not
 * queue past these.
 */
export const FORT_CAP: Partial<Record<string, number>> = { light: 3, wire: 3, turret: 2 };

export const RES_LABEL: Record<Res, string> = {
  food: 'Food', salvage: 'Salvage', meds: 'Medicine', fuel: 'Fuel', pistol: 'Pistol rounds', shell: 'Shotgun shells', rifle: 'Rifle rounds', explosive: 'Explosives',
};
export const RES_ICON: Record<Res, string> = {
  food: 'icon_food', salvage: 'icon_scrap', meds: 'icon_meds', fuel: 'icon_fuel', pistol: 'icon_ammo', shell: 'icon_shells', rifle: 'icon_r556', explosive: 'icon_molotov',
};
