import type { Res } from '../types';

// ---------- scavenging sites around Vessey ----------
export interface Site {
  id: string;
  name: string;
  desc: string;
  risk: number; // 0..1 chance-ish of trouble
  loot: Partial<Record<Res, number>>; // expected yield per run at full stock
  weaponChance: number;
  weapons: string[];
  mods?: string[]; // attachments that can turn up here (MODS keys); found on daylight runs
  survivorChance: number;
  minDay: number;
  stock: number; // runs before it's picked clean
}

export const SITES: Site[] = [
  { id: 'route9', name: 'Route 9 houses', desc: 'Split-levels and trailers along the county road. Somebody\'s kitchen, somebody\'s garage.', risk: 0.12, loot: { food: 5, wood: 6, cloth: 3, scrap: 3, light: 6, shell: 2, r22: 20 }, weaponChance: 0.06, weapons: ['revolver', 'r22', 'r22', 'snake410'], mods: ['flashlight', 'sling'], survivorChance: 0.1, minDay: 1, stock: 8 },
  { id: 'diner', name: 'Ferry Diner', desc: 'The walk-in cooler stopped humming a week ago. The whiteboard still says SOUP.', risk: 0.15, loot: { food: 9, fuel: 1, cloth: 1 }, weaponChance: 0.03, weapons: ['service9', 'snake410'], survivorChance: 0.08, minDay: 1, stock: 5 },
  { id: 'rexall', name: 'Rexall pharmacy', desc: 'Looted twice. Not everything was understood by the looters.', risk: 0.25, loot: { meds: 4, food: 2, cloth: 2 }, weaponChance: 0.02, weapons: ['service9', 'm1911'], survivorChance: 0.06, minDay: 1, stock: 5 },
  { id: 'millyard', name: 'Aubin mill yard', desc: 'Pallets, drums, the maintenance shop. Pond 2 smells like bread gone off.', risk: 0.3, loot: { scrap: 10, parts: 3, fuel: 3, wood: 4, flare: 2 }, weaponChance: 0.05, weapons: ['nailer', 'rivet', 'pipe', 'flaregun'], mods: ['flashlight', 'hatchet', 'suppressor'], survivorChance: 0.08, minDay: 2, stock: 9 },
  { id: 'legion', name: 'Legion hall', desc: 'Bingo cards on the floor. A doe walked in here once, during bingo.', risk: 0.2, loot: { food: 3, fuel: 2, light: 14, cloth: 2, shell_slug: 4 }, weaponChance: 0.12, weapons: ['revolver', 'pump', 'coach', 'm1911'], mods: ['speedloader', 'sling'], survivorChance: 0.1, minDay: 2, stock: 5 },
  { id: 'boathouse', name: 'Halvorsen boathouse', desc: 'Ferry family stores: rope, outboard parts, jerry cans, duck guns.', risk: 0.25, loot: { fuel: 6, parts: 3, shell: 10, cloth: 2, flare: 4 }, weaponChance: 0.12, weapons: ['pump', 'coach', 'flaregun', 'flaregun', 'snake410'], mods: ['flashlight', 'choke'], survivorChance: 0.1, minDay: 3, stock: 6 },
  { id: 'deercamp', name: 'Nils\'s deer camp', desc: 'A plywood shack two miles up the Ox Creek trail. Blaze orange on every nail; the buck pole is empty.', risk: 0.3, loot: { food: 5, rifle_sp: 10, ball: 8, bolt: 10, fuel: 2, cloth: 2 }, weaponChance: 0.25, weapons: ['lever', 'hunting', 'muzzle', 'compound', 'crossbow', 'r22'], mods: ['scope', 'scope', 'bipod', 'sling', 'choke'], survivorChance: 0.06, minDay: 3, stock: 4 },
  { id: 'manor', name: 'St. Aubin Manor', desc: 'The nursing home. The residents are still in residence.', risk: 0.45, loot: { meds: 6, food: 3, cloth: 4 }, weaponChance: 0.02, weapons: ['service9', 'r22'], survivorChance: 0.12, minDay: 4, stock: 5 },
  { id: 'school', name: 'Vessey High', desc: 'The gym was the Parish kitchen until it wasn\'t. Chem lab upstairs.', risk: 0.35, loot: { food: 6, fuel: 2, parts: 2, cloth: 3, meds: 1, bolt: 6 }, weaponChance: 0.04, weapons: ['hunting', 'compound'], survivorChance: 0.18, minDay: 4, stock: 6 },
  { id: 'gunshop', name: 'Strand Sporting Goods', desc: 'Deer season opened the week everything ended. Shelves mostly bare.', risk: 0.4, loot: { light: 16, light_hp: 10, shell: 10, shell_slug: 6, rifle: 6, rifle_sp: 8, r22: 60, r556: 10, bolt: 6, cloth: 2 }, weaponChance: 0.3, weapons: ['hunting', 'pump', 'revolver', 'lever', 'scoped', 'ar15', 'compound', 'coach', 'r22'], mods: ['scope', 'reddot', 'choke', 'extmag', 'bipod', 'sling', 'brake'], survivorChance: 0.06, minDay: 5, stock: 4 },
  { id: 'courthouse', name: 'County courthouse', desc: 'The deputies held it with lists and quarantine. Now the lists are all that hold.', risk: 0.55, loot: { light: 22, light_hp: 10, rifle: 6, shell_flech: 6, shell_slug: 4, meds: 2, parts: 2, g40_buck: 1.2 }, weaponChance: 0.35, weapons: ['smg', 'service9', 'autoshot', 'mp93', 'scoped', 'pump', 'm79'], mods: ['drum', 'extmag', 'flashlight', 'taped', 'speedloader', 'reddot'], survivorChance: 0.1, minDay: 8, stock: 4 },
  { id: 'corliss', name: 'The Line at Corliss', desc: 'Thirty kilometres downriver. Sandbags, a dropped bridge, and whatever the Guard left behind.', risk: 0.7, loot: { r556: 60, rifle_ap: 12, light: 16, flare: 4, meds: 4, parts: 4, fuel: 4, rocket: 0.6, g40: 2 }, weaponChance: 0.5, weapons: ['carbine', 'carbine', 'lmg', 'smg', 'ar15', 'law', 'm79'], mods: ['reddot', 'reddot', 'drum', 'bipod', 'extmag', 'brake', 'taped'], survivorChance: 0.12, minDay: 12, stock: 3 },
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
  workbench: { id: 'workbench', name: 'Workbench', desc: 'Vise, files, a reloading press scavenged from a deer camp. Ammo, repairs, traps.', cost: [{}, { scrap: 15, parts: 4 }, { scrap: 30, parts: 10 }], maxLevel: 3 },
  forge: { id: 'forge', name: 'Barrel forge', desc: 'An oil drum and a shop-vac blower. Bends steel for the wall and for armor.', cost: [{ scrap: 20, wood: 10 }, { scrap: 30, parts: 6 }], maxLevel: 2 },
  garden: { id: 'garden', name: 'Cold frames', desc: 'Storm windows over raised beds. Kale, turnips, hope.', cost: [{ wood: 12, cloth: 2 }, { wood: 20, parts: 2 }, { wood: 30, scrap: 10, parts: 4 }], maxLevel: 3 },
  infirmary: { id: 'infirmary', name: 'Infirmary', desc: 'Two cots, a lamp, boiled sheets. Wounds heal faster; amputations survive more often.', cost: [{ wood: 10, cloth: 6 }, { wood: 15, meds: 4, parts: 3 }], maxLevel: 2 },
  still: { id: 'still', name: 'Copper still', desc: 'Turns rot into fuel, and fuel into courage. Makes liquor and firebombs.', cost: [{ scrap: 18, parts: 3 }], maxLevel: 1 },
  generator: { id: 'generator', name: 'Generator', desc: 'A diesel from the boathouse. Powers floodlights and power tools. Drinks fuel.', cost: [{ parts: 10, scrap: 12 }], maxLevel: 1 },
  radio: { id: 'radio', name: 'Radio mast', desc: 'A CB rig on the chimney. Hear the town; be heard by it.', cost: [{ parts: 6, scrap: 8, wood: 4 }], maxLevel: 1 },
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
  mod?: string; // MODS key: an attachment goes onto the bench (G.modStock)
  special?: 'spikes' | 'wire' | 'light' | 'trap' | 'armor' | 'molotov' | 'liquor' | 'fortify' | 'repair' | 'turret';
  desc: string;
}

export const RECIPES: Recipe[] = [
  // --- ammunition: workbench (reloading press), forge (casting), still (incendiaries) ---
  { id: 'ammo_light', name: 'Pistol rounds ×30', needs: 'workbench', cost: { scrap: 3, fuel: 1 }, work: 3, gives: { light: 30 }, desc: 'Reloaded brass, powder cut from shotshells and road flares.' },
  { id: 'ammo_light_hp', name: 'Hollow-points ×24', needs: 'workbench', cost: { light: 24, parts: 1 }, work: 2, gives: { light_hp: 24 }, desc: 'Drill the noses of 24 pistol rounds. More damage; worthless on plate.' },
  { id: 'ammo_shell', name: 'Buckshot ×12', needs: 'workbench', cost: { scrap: 3, fuel: 1, cloth: 1 }, work: 3, gives: { shell: 12 }, desc: 'Nail-and-washer buckshot in hand-crimped hulls.' },
  { id: 'ammo_slug', name: 'Slugs ×10', needs: 'forge', cost: { scrap: 4, fuel: 1, cloth: 1 }, work: 3, gives: { shell_slug: 10 }, desc: 'Wheel weights melted and poured in a muffin tin. One heavy hit; pierces.' },
  { id: 'ammo_flech', name: 'Flechettes ×10', needs: 'workbench', level: 2, cost: { scrap: 4, parts: 1, fuel: 1 }, work: 3, gives: { shell_flech: 10 }, desc: 'Roofing nails clipped headless and packed in wax. They go through.' },
  { id: 'ammo_dragon', name: "Dragon's breath ×8", needs: 'still', cost: { fuel: 2, scrap: 2, cloth: 1 }, work: 3, gives: { shell_fire: 8 }, desc: 'Magnesium shavings from the mill shop. Sets them burning.' },
  { id: 'ammo_r22', name: '.22 re-primed ×50', needs: 'workbench', level: 2, cost: { scrap: 2, parts: 1 }, work: 3, gives: { r22: 50 }, desc: 'Rimfire is not supposed to be reloadable. Cap-gun caps say otherwise.' },
  { id: 'ammo_rifle', name: 'Rifle FMJ ×12', needs: 'workbench', level: 2, cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4, gives: { rifle: 12 }, desc: 'Careful work. A bad load takes fingers.' },
  { id: 'ammo_rifle_sp', name: 'Soft-points ×12', needs: 'workbench', level: 2, cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4, gives: { rifle_sp: 12 }, desc: 'Deer loads: more damage and shove, but they stop in the first body.' },
  { id: 'ammo_rifle_ap', name: 'AP rounds ×8', needs: 'forge', level: 2, cost: { scrap: 6, fuel: 2, parts: 2 }, work: 5, gives: { rifle_ap: 8 }, desc: 'Hardened drill-bit cores turned on the lathe. For Deputies.' },
  { id: 'ammo_r556', name: '5.56 ×30', needs: 'workbench', level: 3, cost: { scrap: 4, fuel: 2, parts: 2 }, work: 5, gives: { r556: 30 }, desc: 'Reformed .223 brass from Strand\'s range bucket.' },
  { id: 'ammo_ball', name: '.50 ball & powder ×10', needs: 'forge', cost: { scrap: 2, fuel: 1 }, work: 2, gives: { ball: 10 }, desc: 'Cast ball, greased patches, homemade black powder.' },
  { id: 'ammo_bolt', name: 'Broadheads ×12', needs: 'workbench', cost: { wood: 3, scrap: 1, cloth: 1 }, work: 3, gives: { bolt: 12 }, desc: 'Dowel shafts, heads ground from saw teeth. For bows and crossbows.' },
  { id: 'ammo_bolt_fire', name: 'Fire bolts ×8', needs: 'still', cost: { wood: 2, fuel: 1, cloth: 1 }, work: 2, gives: { bolt_fire: 8 }, desc: 'Rag-wrapped, still-fuel soaked. They burn, and they do not come back.' },
  { id: 'ammo_flare', name: 'Flare shells ×4', needs: 'still', cost: { fuel: 2, scrap: 1, parts: 1 }, work: 3, gives: { flare: 4 }, desc: 'Road-flare composition packed into 12-gauge hulls.' },
  // --- attachments (go onto the bench; fit them in the armory) ---
  { id: 'mod_suppressor', name: 'Oil-filter suppressor', needs: 'workbench', cost: { scrap: 3, parts: 1 }, work: 3, mod: 'suppressor', desc: 'A truck oil filter on a threaded adapter. Quiet, for a few nights.' },
  { id: 'mod_flashlight', name: 'Duct-taped flashlight', needs: 'workbench', cost: { parts: 2, cloth: 1 }, work: 2, mod: 'flashlight', desc: 'A Maglite taped under the barrel. Lights a cone down the road at night.' },
  { id: 'mod_sling', name: 'Sling & padded stock', needs: 'workbench', cost: { cloth: 3, scrap: 1 }, work: 2, mod: 'sling', desc: 'Less kick, less bloom on long strings of fire.' },
  { id: 'mod_taped', name: 'Taped double mags', needs: 'workbench', cost: { cloth: 1, scrap: 2 }, work: 2, mod: 'taped', desc: 'Two magazines taped together: a much faster reload.' },
  { id: 'mod_sawedoff', name: 'Sawed-off barrel', needs: 'workbench', cost: { scrap: 1 }, work: 2, mod: 'sawedoff', desc: 'Shorter shotgun barrel: wide cone, big shove, weak past the wire.' },
  { id: 'mod_choke', name: 'Full choke', needs: 'workbench', level: 2, cost: { scrap: 2, parts: 2 }, work: 3, mod: 'choke', desc: 'Threaded choke tube turned on the lathe. Tighter buckshot.' },
  { id: 'mod_extmag', name: 'Extended magazine', needs: 'workbench', level: 2, cost: { scrap: 4, parts: 3 }, work: 4, mod: 'extmag', desc: 'Two magazines welded into one long one.' },
  { id: 'mod_speedloader', name: 'Speedloader', needs: 'workbench', level: 2, cost: { scrap: 3, parts: 1 }, work: 3, mod: 'speedloader', desc: 'Twist-lock revolver loader, filed from a pipe cap.' },
  { id: 'mod_hatchet', name: 'Hatchet bayonet', needs: 'forge', cost: { scrap: 4, wood: 2 }, work: 3, mod: 'hatchet', desc: 'A hatchet head clamped under a long gun. Melee at the wall.' },
  { id: 'mod_bipod', name: 'Bipod', needs: 'forge', cost: { scrap: 4, parts: 1 }, work: 3, mod: 'bipod', desc: 'Folding legs for rifles and the LMG: steady on the wall.' },
  { id: 'mod_brake', name: 'Muzzle brake', needs: 'forge', level: 2, cost: { scrap: 4, parts: 2 }, work: 4, mod: 'brake', desc: 'Ported pipe coupling: less climb, more bark.' },
  { id: 'ammo_pipebomb', name: 'Pipe bombs ×3', needs: 'workbench', cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4, gives: { pipebomb: 3 }, desc: 'Capped pipe, powder, roofing nails, a fuse cut short. For the mortar.' },
  // --- improvised guns ---
  { id: 'pipe', name: 'Pipe shotgun', needs: 'workbench', cost: { scrap: 8, wood: 2, parts: 1 }, work: 4, weapon: 'pipe', desc: 'Two pipes and a nail. Takes any shell. Jams.' },
  { id: 'flaregun', name: 'Flare pistol', needs: 'workbench', level: 2, cost: { scrap: 6, parts: 3 }, work: 5, weapon: 'flaregun', desc: 'A drilled-out signal pistol body on a pipe barrel. Fires flare shells.' },
  { id: 'crossbow', name: 'Crossbow', needs: 'forge', cost: { wood: 8, scrap: 6, parts: 2 }, work: 8, weapon: 'crossbow', desc: 'Leaf-spring limbs off a Ford, a winch, a walnut stock. Silent.' },
  { id: 'muzzle', name: '.50 muzzleloader', needs: 'forge', level: 2, cost: { scrap: 12, wood: 6, parts: 3 }, work: 10, weapon: 'muzzle', desc: 'A rifled barrel from a fence-post driver. One huge shot.' },
  { id: 'pipemortar', name: 'Pipe-bomb mortar', needs: 'workbench', level: 2, cost: { scrap: 10, parts: 4, wood: 2 }, work: 8, weapon: 'pipemortar', desc: 'A fence-post tube on a shotgun stock. Lobs pipe bombs over the dead.' },
  { id: 'rivet', name: 'Rivet gun', needs: 'workbench', level: 3, cost: { scrap: 16, parts: 8, fuel: 2 }, work: 12, weapon: 'rivet', desc: 'A boiler-shop rivet hammer on a welding bottle. Quiet; punches plate.' },
  { id: 'repair', name: 'Repair the worst gun', needs: 'workbench', cost: { scrap: 3, parts: 1 }, work: 3, special: 'repair', desc: 'Strip, clean, file, pray.' },
  { id: 'nailer', name: 'Nail driver', needs: 'workbench', level: 2, cost: { scrap: 14, parts: 8, fuel: 2 }, work: 12, weapon: 'nailer', desc: 'A framing nailer fed from a welding bottle. Quiet. Eats scrap.' },
  { id: 'trap', name: 'Nail bomb trap', needs: 'workbench', cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4, special: 'trap', desc: 'Pipe, nails, a tripwire. Goes off once, loudly.' },
  { id: 'fortify', name: 'Reinforce the wall', needs: 'forge', cost: { scrap: 20, wood: 20 }, work: 10, special: 'fortify', desc: '+60 max wall. Sheet steel and railroad ties.' },
  { id: 'spikes', name: 'Spike row', needs: 'forge', cost: { wood: 8, scrap: 4 }, work: 4, special: 'spikes', desc: 'Sharpened rebar at shin height. The Turned impale themselves at the wall.' },
  { id: 'wire', name: 'Wire belt', needs: 'forge', cost: { scrap: 8 }, work: 3, special: 'wire', desc: 'Barbed wire strung across the road. Slows them in the kill zone.' },
  { id: 'armor', name: 'Mill-plate vest', needs: 'forge', cost: { scrap: 10, cloth: 4 }, work: 6, special: 'armor', desc: 'Saw-blade steel sewn into a Carhartt. Lessens wounds. Not bites.' },
  { id: 'turret', name: 'Nail turret', needs: 'generator', cost: { parts: 10, scrap: 20, fuel: 2 }, work: 14, special: 'turret', desc: 'A framing nailer on a tractor-seat swivel, triggered by a doorbell relay. Fires at anything on the road. Eats scrap; needs the generator.' },
  { id: 'light', name: 'Floodlight', needs: 'generator', cost: { parts: 3, scrap: 3 }, work: 3, special: 'light', desc: 'A ballfield lamp on a pole. Burns fuel each night; you see them coming.' },
  { id: 'molotov', name: 'Firebombs ×3', needs: 'still', cost: { fuel: 2, cloth: 1 }, work: 2, gives: { molotov: 3 }, desc: 'Throw with [F] / right click. Fire on the road.' },
  { id: 'liquor', name: 'Liquor', needs: 'still', cost: { food: 3 }, work: 2, gives: { liquor: 2 }, desc: 'Potato moonshine. Medicine for the soul; bad for the aim.' },
  { id: 'fuel', name: 'Distill fuel ×4', needs: 'still', cost: { food: 3, wood: 2 }, work: 3, gives: { fuel: 4 }, desc: 'Rot and sawdust to ethanol.' },
  { id: 'bandage', name: 'Field dressings', needs: 'infirmary', cost: { cloth: 3, fuel: 1 }, work: 2, gives: { meds: 1 }, desc: 'Boiled linen and moonshine.' },
];

export const RES_LABEL: Record<Res, string> = {
  food: 'Food', scrap: 'Scrap', wood: 'Timber', parts: 'Parts', meds: 'Medicine', fuel: 'Fuel', cloth: 'Cloth', light: 'Pistol ammo', shell: 'Shells', rifle: 'Rifle ammo', liquor: 'Liquor', molotov: 'Firebombs',
  r22: '.22 ammo', light_hp: 'Hollow-points', shell_slug: 'Slugs', shell_flech: 'Flechettes', shell_fire: "Dragon's breath", rifle_sp: 'Soft-points', rifle_ap: 'AP rounds',
  r556: '5.56 ammo', ball: '.50 ball', bolt: 'Broadheads', bolt_fire: 'Fire bolts', flare: 'Flare shells',
  rocket: 'Rockets', g40: '40mm HE', g40_buck: '40mm buckshot', pipebomb: 'Pipe bombs',
};
export const RES_ICON: Record<Res, string> = {
  food: 'icon_food', scrap: 'icon_scrap', wood: 'icon_wood', parts: 'icon_parts', meds: 'icon_meds', fuel: 'icon_fuel', cloth: 'icon_cloth', light: 'icon_ammo', shell: 'icon_ammo', rifle: 'icon_ammo', liquor: 'icon_molotov', molotov: 'icon_molotov',
  r22: 'icon_r22', light_hp: 'icon_ammo', shell_slug: 'icon_slug', shell_flech: 'icon_shells', shell_fire: 'icon_dragon', rifle_sp: 'icon_ammo', rifle_ap: 'icon_ammo',
  r556: 'icon_r556', ball: 'icon_ball', bolt: 'icon_bolts', bolt_fire: 'icon_bolts', flare: 'icon_flares',
  rocket: 'icon_rocket', g40: 'icon_g40', g40_buck: 'icon_g40', pipebomb: 'icon_pipebomb',
};
