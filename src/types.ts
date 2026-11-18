// Core data model. Everything in GameState is plain JSON so it can be saved.

// Four materials: food, salvage (timber, scrap, parts and cloth in one pile), fuel, medicine. Then ammunition.
export type Res = 'food' | 'salvage' | 'meds' | 'fuel'
  // ammunition: three pools (src/data/weapons.ts AMMO_TYPES); every gun draws from one
  | 'pistol' | 'shell' | 'rifle'
  // explosives: one count, thrown at night (firebombs) or fired from a launcher
  | 'explosive';
export type Stores = Record<Res, number>;

// Five skills (docs/research/19b-simplify-survivors.md). Old saves had crafting, farming and psych: migrateSurvivor folds them in.
export type SkillId = 'shooting' | 'building' | 'medicine' | 'scavenging' | 'social';
export type BodyPart = 'head' | 'torso' | 'larm' | 'rarm' | 'lleg' | 'rleg';

export interface Wound {
  part: BodyPart;
  kind: 'bite' | 'scratch' | 'laceration' | 'fracture' | 'burn' | 'gunshot' | 'bruise';
  severity: number; // 0..1, heals down to 0
  bleeding: boolean;
  infected: boolean; // bite infection (the Turn) or sepsis
  tended: boolean;
  dayGot: number;
  hidden?: boolean; // a bite the survivor is concealing
}

export interface Scar {
  part: BodyPart;
  label: string; // "lost left eye", "mangled right hand"
  accuracy?: number; // additive modifiers
  work?: number;
  speed?: number;
}

export interface Thought {
  id: string;
  label: string;
  mood: number; // contribution
  days: number; // remaining days (fractional)
  stack?: number;
  about?: string; // survivor id
}

export interface Relation {
  opinion: number; // -100..100
  bond?: 'lover' | 'spouse' | 'sibling' | 'parent' | 'child' | 'friend' | 'rival';
}

export type JobId = 'guard' | 'repair' | 'scavenge' | 'craft' | 'farm' | 'doctor' | 'rest' | 'radio' | 'cook' | 'drill' | 'counsel';

export interface Survivor {
  id: string;
  name: string;
  nick?: string;
  age: number;
  sex: 'm' | 'f';
  sprite: string;
  before: string; // backstory: life before
  outbreak: string; // backstory: what they did when it began
  traits: string[];
  skills: Record<SkillId, number>; // 0..10
  passions: SkillId[];
  hunger: number; // 0 (starving) .. 1 (fed)
  rest: number; // 0..1
  mood: number; // 0..100, computed
  thoughts: Thought[];
  wounds: Wound[];
  scars: Scar[];
  rel: Record<string, Relation>;
  job: JobId;
  weapon: string | null; // weapon instance id
  melee?: string | null; // melee weapon instance id (G.melee), carried alongside the gun
  armor: string | null;
  kills: number;
  daysSurvived: number;
  arrivedDay: number;
  breakState: null | { kind: string; days: number };
  infection: number; // 0..1, progress of the turn
  isLeader: boolean;
  dead?: { day: number; cause: string; epitaph: string };
  tales: string[]; // short memorable things they did
  titles?: string[]; // earned epithets
  child?: boolean; // a non-combatant child: eats, lifts spirits, never stands the wall
  // ---- progression (src/sim/survivors.ts: gainXp / level / attr; optional so old saves load) ----
  // xp toward the NEXT level of a skill, attribute or training track, keyed by ProgressKey.
  // Level-up when xp >= 100 * (level + 1). Award it with gainXp(), never write it directly.
  xp?: Partial<Record<string, number>>;
  // Courage 0..10: night nerve, panic and flight. The one attribute. (Old saves also carry grit: the Tough trait now.)
  attrs?: { courage: number; grit?: number };
  // Favourite kind of gun: handles it as if Shooting were FAV_BONUS higher (src/sim/survivors.ts handling()).
  // Fixed at arrival (the backstory's gun, else a roll). The one choice it makes: who gets which gun.
  fav?: WeaponClass;
  // Old saves only: per-class proficiency and heavy-weapons training, folded into Shooting and fav on load.
  training?: { heavy?: number };
  prof?: Partial<Record<string, number>>;
  // Values at arrival (skills and attributes), to show growth on the survivor sheet.
  base?: Partial<Record<string, number>>;
  // Perks (src/data/perks.ts) kept, by id; and offers waiting for a pick (two perk ids for a skill reaching 4 or 7).
  // An offer not picked by the second dawn is picked for them. Optional so old saves load.
  perks?: string[];
  perkOffers?: { skill: SkillId; tier: 4 | 7; options: string[]; day: number }[];
}

// Weapon class: a survivor's favourite (Survivor.fav) (see CLASS_NAMES in data/weapons.ts)
export type WeaponClass = 'handgun' | 'smg' | 'rifle' | 'assault' | 'marksman' | 'shotgun' | 'heavy' | 'launcher' | 'bow' | 'improvised' | 'melee';

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  ammo: Res | null;
  dmg: number;
  rof: number; // shots per second
  mag: number;
  reload: number; // seconds
  spread: number; // radians
  pellets: number;
  pierce: number;
  knock: number;
  auto: boolean;
  noise: number; // draws more zombies
  desc: string;
  // --- arsenal extensions (all optional; read them through fireProfile() in data/weapons.ts) ---
  cls: WeaponClass;
  niche?: string; // one line: what this gun is FOR
  caliber?: string; // CALIBERS key: the physical cartridge (sound, tracer); CALIBERS maps it to an ammo pool
  armorPen?: number; // 0..1 fraction of a Deputy's body armour ignored (negative = armour hurts more)
  reloadPerRound?: boolean; // loads one round at a time; `reload` stays the full-magazine time
  burst?: number; // rounds fired per trigger pull (default 1)
  burstGap?: number; // seconds between burst rounds (0 = all at once, e.g. both barrels)
  perShot?: number; // ammo units taken from stores per round (default 1; nails 0.05 scrap)
  jam?: number; // base jam chance per shot on top of wear (improvised guns)
  recoverable?: number; // 0..1 of spent ammo picked up after the fight (unused: bows draw on no store)
  incendiary?: boolean; // sets the Turned burning (flare gun)
  flare?: boolean; // the shot lights up where it lands for a few seconds
  smoke?: boolean; // big muzzle smoke cloud (black powder)
  craftable?: boolean;
  switchTime?: number; // base seconds to swing onto a new target (heavy guns); attachments add to it
  explosive?: { radius: number; dmg: number }; // blast on impact (launchers)
  arc?: boolean; // lobbed: lands where aimed instead of travelling a straight ray
  limbMul?: number; // damage multiplier on arm/leg zones (default 1, pellets 1.2)
  stagger?: number; // 0..1 stagger chance per body hit (default derived from knockback)
}

export interface WeaponItem {
  uid: string;
  def: string;
  cond: number; // 0..1 condition
  name?: string; // given a name after a memorable event
  kills: number;
  mods?: Partial<Record<ModSlot, ModItem>>; // attachments (see MODS in data/weapons.ts)
}

export type ModSlot = 'optic' | 'muzzle' | 'under' | 'mag' | 'stock';
export interface ModItem {
  uid: string;
  def: string; // MODS key
  cond: number; // 0..1; mods with a `life` wear out with use (suppressors)
}

export interface Building {
  id: string;
  level: number;
}

export interface ChronicleEntry {
  day: number;
  text: string;
  kind: 'death' | 'arrival' | 'event' | 'battle' | 'social' | 'break' | 'craft' | 'lore' | 'tale';
}

export interface GameState {
  version: number;
  seed: number;
  day: number;
  phase: 'day' | 'night' | 'over';
  stores: Stores;
  survivors: Survivor[];
  graves: Survivor[];
  weapons: WeaponItem[];
  modStock?: ModItem[]; // spare attachments on the bench
  melee?: WeaponItem[]; // melee weapons (def = MELEE key in data/weapons.ts); kept apart from guns
  trapStock?: Record<string, number>; // trap kits by TRAPS key (data/traps.ts); read with `?? {}`
  deploy?: { trap: string; x: number; lane: number }[]; // tonight's road placements (= traps.ts Placement[]); set at dusk, cleared at dawn
  buildings: Building[];
  fort: { hp: number; maxHp: number; level: number; spikes: number; wire: number; lights: number; traps: number; turrets?: number };
  craftQueue: { recipe: string; progress: number }[];
  chronicle: ChronicleEntry[];
  director: { tension: number; lastBigDay: number; wealth: number; mode: string; cooldowns: Record<string, number> };
  pendingEvent: PendingEvent | null;
  flags: Record<string, number | string | boolean>;
  stats: { kills: number; shots: number; hits: number; headshots: number };
  nextNight: NightPlan | null;
  weather: string;
  uid: number;
}

export interface EventChoice {
  label: string;
  hint?: string;
  effect: string; // effect id resolved by events.ts
  data?: Record<string, unknown>;
  fx?: ChoiceFx; // the real stakes, shown as chips on the card (ui/eventcard.ts); keep in step with resolve()
}

/** What a choice really does, read off its resolve() code. Every field optional. */
export interface ChoiceFx {
  cost?: Partial<Record<Res, number>>; // spent from the stores; the choice is disabled when we cannot pay
  gain?: Partial<Record<Res, number>>;
  rep?: Record<string, number>; // faction id → standing change
  odds?: number; // chance it goes well, 0..1
  risk?: string; // what can go wrong, a few words (the tip of a danger chip)
  who?: string; // the survivor id who goes or is at stake
  away?: number; // days that survivor is away
  mood?: number; // mood change for the house (or for who)
  wall?: number; // max wall change
  people?: number; // newcomers joining
  gun?: string; // a weapon def gained
}

export interface PendingEvent {
  id: string;
  title: string;
  text: string;
  choices: EventChoice[];
  data?: Record<string, unknown>;
}

export interface NightPlan {
  points: number;
  label: string;
  special?: string; // fog, horde, rain, siren...
  spawns: { type: string; t: number; y?: number; name?: string; pack?: string; dark?: boolean }[]; // pack: a combination template (sim/director.ts); dark: forms up close, in the dark
}
