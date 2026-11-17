// Core data model. Everything in GameState is plain JSON so it can be saved.

export type Res = 'food' | 'scrap' | 'wood' | 'parts' | 'meds' | 'fuel' | 'cloth' | 'light' | 'shell' | 'rifle' | 'liquor' | 'molotov'
  // ammunition by caliber & bullet type (see src/data/weapons.ts CALIBERS / AMMO_TYPES)
  | 'r22' | 'light_hp' | 'shell_slug' | 'shell_flech' | 'shell_fire' | 'rifle_sp' | 'rifle_ap' | 'r556' | 'ball' | 'bolt' | 'bolt_fire' | 'flare';
export type Stores = Record<Res, number>;

export type SkillId = 'shooting' | 'building' | 'crafting' | 'medicine' | 'scavenging' | 'farming' | 'social';
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

export type JobId = 'guard' | 'repair' | 'scavenge' | 'craft' | 'farm' | 'doctor' | 'rest' | 'radio' | 'cook';

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
}

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
  niche?: string; // one line: what this gun is FOR
  caliber?: string; // CALIBERS key; decides which ammo types it can load
  armorPen?: number; // 0..1 fraction of a Deputy's body armour ignored (negative = armour hurts more)
  reloadPerRound?: boolean; // loads one round at a time; `reload` stays the full-magazine time
  burst?: number; // rounds fired per trigger pull (default 1)
  burstGap?: number; // seconds between burst rounds (0 = all at once, e.g. both barrels)
  perShot?: number; // ammo units taken from stores per round (default 1; nails 0.05 scrap)
  jam?: number; // base jam chance per shot on top of wear (improvised guns)
  recoverable?: number; // 0..1 of spent ammo picked up after the fight (arrows, bolts)
  incendiary?: boolean; // sets the Turned burning (flare gun)
  flare?: boolean; // the shot lights up where it lands for a few seconds
  smoke?: boolean; // big muzzle smoke cloud (black powder)
  craftable?: boolean;
  limbMul?: number; // damage multiplier on arm/leg zones (default 1, pellets 1.2)
  stagger?: number; // 0..1 stagger chance per body hit (default derived from knockback)
}

export interface WeaponItem {
  uid: string;
  def: string;
  cond: number; // 0..1 condition
  name?: string; // given a name after a memorable event
  kills: number;
  ammoType?: Res; // selected bullet type for this gun (must match its caliber); default = WeaponDef.ammo
  mods?: Partial<Record<ModSlot, ModItem>>; // attachments (see MODS in data/weapons.ts)
}

export type ModSlot = 'optic' | 'muzzle' | 'barrel' | 'under' | 'mag' | 'stock';
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
  spawns: { type: string; t: number; y?: number; name?: string }[];
}
