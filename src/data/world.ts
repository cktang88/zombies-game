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
  survivorChance: number;
  minDay: number;
  stock: number; // runs before it's picked clean
}

export const SITES: Site[] = [
  { id: 'route9', name: 'Route 9 houses', desc: 'Split-levels and trailers along the county road. Somebody\'s kitchen, somebody\'s garage.', risk: 0.12, loot: { food: 5, wood: 6, cloth: 3, scrap: 3, light: 6, shell: 2 }, weaponChance: 0.05, weapons: ['revolver'], survivorChance: 0.1, minDay: 1, stock: 8 },
  { id: 'diner', name: 'Ferry Diner', desc: 'The walk-in cooler stopped humming a week ago. The whiteboard still says SOUP.', risk: 0.15, loot: { food: 9, fuel: 1, cloth: 1 }, weaponChance: 0.03, weapons: ['service9'], survivorChance: 0.08, minDay: 1, stock: 5 },
  { id: 'rexall', name: 'Rexall pharmacy', desc: 'Looted twice. Not everything was understood by the looters.', risk: 0.25, loot: { meds: 4, food: 2, cloth: 2 }, weaponChance: 0.02, weapons: ['service9'], survivorChance: 0.06, minDay: 1, stock: 5 },
  { id: 'millyard', name: 'Aubin mill yard', desc: 'Pallets, drums, the maintenance shop. Pond 2 smells like bread gone off.', risk: 0.3, loot: { scrap: 10, parts: 3, fuel: 3, wood: 4 }, weaponChance: 0.04, weapons: ['nailer'], survivorChance: 0.08, minDay: 2, stock: 9 },
  { id: 'legion', name: 'Legion hall', desc: 'Bingo cards on the floor. A doe walked in here once, during bingo.', risk: 0.2, loot: { food: 3, fuel: 2, light: 14, cloth: 2 }, weaponChance: 0.12, weapons: ['revolver', 'pump'], survivorChance: 0.1, minDay: 2, stock: 5 },
  { id: 'boathouse', name: 'Halvorsen boathouse', desc: 'Ferry family stores: rope, outboard parts, jerry cans, duck guns.', risk: 0.25, loot: { fuel: 6, parts: 3, shell: 10, cloth: 2 }, weaponChance: 0.12, weapons: ['pump'], survivorChance: 0.1, minDay: 3, stock: 6 },
  { id: 'manor', name: 'St. Aubin Manor', desc: 'The nursing home. The residents are still in residence.', risk: 0.45, loot: { meds: 6, food: 3, cloth: 4 }, weaponChance: 0.02, weapons: ['service9'], survivorChance: 0.12, minDay: 4, stock: 5 },
  { id: 'school', name: 'Vessey High', desc: 'The gym was the Parish kitchen until it wasn\'t. Chem lab upstairs.', risk: 0.35, loot: { food: 6, fuel: 2, parts: 2, cloth: 3, meds: 1 }, weaponChance: 0.04, weapons: ['hunting'], survivorChance: 0.18, minDay: 4, stock: 6 },
  { id: 'gunshop', name: 'Strand Sporting Goods', desc: 'Deer season opened the week everything ended. Shelves mostly bare.', risk: 0.4, loot: { light: 20, shell: 12, rifle: 10, cloth: 2 }, weaponChance: 0.3, weapons: ['hunting', 'pump', 'revolver'], survivorChance: 0.06, minDay: 5, stock: 4 },
  { id: 'courthouse', name: 'County courthouse', desc: 'The deputies held it with lists and quarantine. Now the lists are all that hold.', risk: 0.55, loot: { light: 26, rifle: 8, meds: 2, parts: 2 }, weaponChance: 0.35, weapons: ['smg', 'service9', 'pump'], survivorChance: 0.1, minDay: 8, stock: 4 },
  { id: 'corliss', name: 'The Line at Corliss', desc: 'Thirty kilometres downriver. Sandbags, a dropped bridge, and whatever the Guard left behind.', risk: 0.7, loot: { rifle: 30, light: 20, meds: 4, parts: 4, fuel: 4 }, weaponChance: 0.5, weapons: ['carbine', 'carbine', 'smg'], survivorChance: 0.12, minDay: 12, stock: 3 },
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
  special?: 'spikes' | 'wire' | 'light' | 'trap' | 'armor' | 'molotov' | 'liquor' | 'fortify' | 'repair';
  desc: string;
}

export const RECIPES: Recipe[] = [
  { id: 'ammo_light', name: 'Pistol rounds ×30', needs: 'workbench', cost: { scrap: 3, fuel: 1 }, work: 3, gives: { light: 30 }, desc: 'Reloaded brass, powder cut from shotshells and road flares.' },
  { id: 'ammo_shell', name: 'Shells ×12', needs: 'workbench', cost: { scrap: 3, fuel: 1, cloth: 1 }, work: 3, gives: { shell: 12 }, desc: 'Nail-and-washer buckshot in hand-crimped hulls.' },
  { id: 'ammo_rifle', name: 'Rifle rounds ×12', needs: 'workbench', level: 2, cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4, gives: { rifle: 12 }, desc: 'Careful work. A bad load takes fingers.' },
  { id: 'repair', name: 'Repair the worst gun', needs: 'workbench', cost: { scrap: 3, parts: 1 }, work: 3, special: 'repair', desc: 'Strip, clean, file, pray.' },
  { id: 'nailer', name: 'Nail driver', needs: 'workbench', level: 2, cost: { scrap: 14, parts: 8, fuel: 2 }, work: 12, weapon: 'nailer', desc: 'A framing nailer fed from a welding bottle. Quiet. Eats scrap.' },
  { id: 'trap', name: 'Nail bomb trap', needs: 'workbench', cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4, special: 'trap', desc: 'Pipe, nails, a tripwire. Goes off once, loudly.' },
  { id: 'fortify', name: 'Reinforce the wall', needs: 'forge', cost: { scrap: 20, wood: 20 }, work: 10, special: 'fortify', desc: '+60 max wall. Sheet steel and railroad ties.' },
  { id: 'spikes', name: 'Spike row', needs: 'forge', cost: { wood: 8, scrap: 4 }, work: 4, special: 'spikes', desc: 'Sharpened rebar at shin height. The Turned impale themselves at the wall.' },
  { id: 'wire', name: 'Wire belt', needs: 'forge', cost: { scrap: 8 }, work: 3, special: 'wire', desc: 'Barbed wire strung across the road. Slows them in the kill zone.' },
  { id: 'armor', name: 'Mill-plate vest', needs: 'forge', cost: { scrap: 10, cloth: 4 }, work: 6, special: 'armor', desc: 'Saw-blade steel sewn into a Carhartt. Lessens wounds. Not bites.' },
  { id: 'light', name: 'Floodlight', needs: 'generator', cost: { parts: 3, scrap: 3 }, work: 3, special: 'light', desc: 'A ballfield lamp on a pole. Burns fuel each night; you see them coming.' },
  { id: 'molotov', name: 'Firebombs ×3', needs: 'still', cost: { fuel: 2, cloth: 1 }, work: 2, gives: { molotov: 3 }, desc: 'Throw with [F] / right click. Fire on the road.' },
  { id: 'liquor', name: 'Liquor', needs: 'still', cost: { food: 3 }, work: 2, gives: { liquor: 2 }, desc: 'Potato moonshine. Medicine for the soul; bad for the aim.' },
  { id: 'fuel', name: 'Distill fuel ×4', needs: 'still', cost: { food: 3, wood: 2 }, work: 3, gives: { fuel: 4 }, desc: 'Rot and sawdust to ethanol.' },
  { id: 'bandage', name: 'Field dressings', needs: 'infirmary', cost: { cloth: 3, fuel: 1 }, work: 2, gives: { meds: 1 }, desc: 'Boiled linen and moonshine.' },
];

export const RES_LABEL: Record<Res, string> = {
  food: 'Food', scrap: 'Scrap', wood: 'Timber', parts: 'Parts', meds: 'Medicine', fuel: 'Fuel', cloth: 'Cloth', light: 'Pistol ammo', shell: 'Shells', rifle: 'Rifle ammo', liquor: 'Liquor', molotov: 'Firebombs',
};
export const RES_ICON: Record<Res, string> = {
  food: 'icon_food', scrap: 'icon_scrap', wood: 'icon_wood', parts: 'icon_parts', meds: 'icon_meds', fuel: 'icon_fuel', cloth: 'icon_cloth', light: 'icon_ammo', shell: 'icon_ammo', rifle: 'icon_ammo', liquor: 'icon_molotov', molotov: 'icon_molotov',
};
