// Every game system in one place: what it is for, what you spend, what you get, and the catch.
// The guide (src/ui/guide.ts) draws these as icon rows; the day screen shows them on hover (sysTip).
// Numbers come from the code's own constants wherever they are exported (recipes, buildings, the
// day budget, the sally, ammo types, emplacements, traps). A few live as literals inside the sim or
// the battle; those are mirrored here and marked "mirrors" so a balance pass knows to update them.
//
// Built lazily (systems()) so this module never touches night/sally.ts or sim/day.ts while the
// module graph is still loading (battle.ts → pause → help → guide → here would be a cycle).
import type { Res } from '../types';
import { RECIPES, BUILDINGS, RES_ICON, RES_LABEL, FORT_CAP } from './world';
import { AMMO_TYPES, ammoLabel } from './weapons';
import { EMPLACEMENTS } from './emplacements';
import { TRAPS, placementsAllowed } from './traps';
import { DAY_HOURS, DEFAULT_HOURS, DRILL_ROUNDS, SITE_TRAVEL, RUN_SEC_PER_HOUR, REPAIR_WOOD_PER, REPAIR_NO_WOOD, FARM_BASE, FARM_FRAME, FARM_COLD } from '../sim/day';
import { SALLY } from '../night/sally';

/** One icon and an amount: "3 ×timber". `i` is an icon id (public/sprites/icon_<i>.png); `s` a word shown beside it even in compact rows. */
export interface Amt { i: string; n?: string | number; t: string; s?: string }

export type SysGroup = 'jobs' | 'day' | 'build' | 'night';
export const GROUPS: { id: SysGroup; label: string; line: string }[] = [
  { id: 'jobs', label: 'Day jobs', line: 'One job each. Paid for in hours and tiredness.' },
  { id: 'day', label: 'The day', line: 'What the house needs, and the leader\'s run.' },
  { id: 'build', label: 'Build & arm', line: 'Stores in, defences and ammunition out.' },
  { id: 'night', label: 'The night', line: 'What you can do at the wall.' },
];

export interface SystemDef {
  id: string;
  group: SysGroup;
  icon: string;
  name: string;
  /** what it is for, one line */
  what: string;
  spend: Amt[];
  get: Amt[];
  /** the main tradeoff, one sentence */
  tradeoff: string;
  when: string;
  /** the key or the number to remember */
  key?: string;
}

// ---------- helpers ----------
const resIcon = (r: Res) => (RES_ICON[r] ?? 'icon_parts').replace(/^icon_/, '');
/** A cost map as icon amounts. */
export function costAmts(cost: Partial<Record<Res, number>>): Amt[] {
  return Object.entries(cost).map(([k, v]) => ({ i: resIcon(k as Res), n: v, t: RES_LABEL[k as Res].toLowerCase() }));
}
const recipe = (id: string) => RECIPES.find((r) => r.id === id);
/** A recipe's cost plus its bench work, as icon amounts. */
function recipeAmts(id: string): Amt[] {
  const r = recipe(id);
  if (!r) return [];
  return [...costAmts(r.cost), { i: 'job_craft', n: r.work, t: 'bench work' }];
}
const hours = (n: number | string, t = 'of one worker\'s day'): Amt => ({ i: 'st_time', n: `${n}h`, t });
const tired: Amt = { i: 'st_tired', t: 'tiredness' };
const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

// Yields per 8-hour day, skill 0..10 (mirrors sim/day.ts repairAmount / craftPoints / farmAmount / careCount).
const REPAIR = { base: 40, perSkill: 9, woodPer: REPAIR_WOOD_PER, noWood: REPAIR_NO_WOOD };
const CRAFT = { base: 3, perSkill: 0.9 };
const FARM = { base: FARM_BASE, perFrame: FARM_FRAME, cold: FARM_COLD }; // no skill: a Green thumb ×1.5
const CARE = { base: 2, perSkill: 1 };
// Night (mirrors night/battle.ts: setFocus/tickNerve, useRally, dogBark, the floodlight bonus, spikes, wire, molotov).
const NERVE = { base: 55, perShot: 4, focusDrain: 20, focusMin: 10, rally: 20, rallySec: 4 };
const FIRE = { sec: 7, width: 150 };
const LIGHT = { aim: 0.07, sight: 130, max: FORT_CAP.light!, fuel: 0.5 };
const SPIKE_DPS = 3.5;
const WIRE = { slow: 0.55, band: 90, max: FORT_CAP.wire! };
const DOG = { aim: 0.15, sec: 5, mood: 4 };
const COUNSEL_BREAK = 0.35; // sim/survivors.ts counsel(): dawn break chance ×0.35
const COLD_JAM = 1.7; // night/battle.ts: un-oiled guns in the cold jam ×1.7

let cache: SystemDef[] | null = null;
/** Every system, in guide order. */
export function systems(): SystemDef[] {
  return (cache ??= build());
}
export function system(id: string): SystemDef | undefined {
  return systems().find((s) => s.id === id);
}

function build(): SystemDef[] {
  const travel = Object.values(SITE_TRAVEL);
  const tMin = Math.min(...travel), tMax = Math.max(...travel);
  const radio = BUILDINGS.radio.cost[0];
  const garden = BUILDINGS.garden;
  const trapCosts = Object.values(TRAPS).map((t) => t.recipe.work);
  const mg = EMPLACEMENTS.mgnest;
  const fort = recipe('fortify');
  const out: SystemDef[] = [
    // ---------------- day jobs ----------------
    {
      id: 'job_repair', group: 'jobs', icon: 'job_repair', name: 'Repair the wall',
      what: 'Patches the barricade before tonight.',
      spend: [hours(DEFAULT_HOURS), { i: 'wood', n: 1, t: `timber per ${REPAIR.woodPer} wall` }, tired],
      get: [{ i: 'st_wall', n: `+${range(REPAIR.base, REPAIR.base + 10 * REPAIR.perSkill)}`, t: 'wall (Building 0–10)' }],
      tradeoff: 'A whole worker-day and timber, but every point holds them back.',
      when: 'The wall is under two-thirds, or a big night is coming.',
      key: `1 timber per ${REPAIR.woodPer} wall; none: ×${REPAIR.noWood}`,
    },
    {
      id: 'job_scavenge', group: 'jobs', icon: 'job_scavenge', name: 'Scavenge',
      what: 'A worker searches a site in town for you.',
      spend: [hours(DEFAULT_HOURS), { i: 'st_time', n: `${range(tMin, tMax)}h`, t: 'of it spent walking' }, { i: 'st_bite', t: 'a chance of wounds or a bite' }],
      get: [{ i: 'food', t: 'food' }, { i: 'wood', t: 'timber' }, { i: 'scrap', t: 'scrap' }, { i: 'ammo', t: 'rounds' }, { i: 'st_perk', t: 'now and then a gun' }],
      tradeoff: 'Loot without playing, but walking eats hours and bites happen.',
      when: 'Stores are low and nobody is needed at home.',
      key: 'Near sites leave more search time',
    },
    {
      id: 'job_craft', group: 'jobs', icon: 'job_craft', name: 'Workshop',
      what: 'Works through the craft queue.',
      spend: [hours(DEFAULT_HOURS), { i: 'scrap', t: 'whatever the queued recipes cost' }, tired],
      get: [{ i: 'job_craft', n: range(CRAFT.base, Math.round(CRAFT.base + 10 * CRAFT.perSkill)), t: 'work points a day (Building 0–10)' }],
      tradeoff: 'Turns stores into ammo and traps, but only if something is queued.',
      when: 'The queue has work in it and the stores can pay.',
      key: 'Empty queue = a wasted day',
    },
    {
      id: 'job_farm', group: 'jobs', icon: 'job_farm', name: 'Food',
      what: 'Snares, kale, and the cold frames.',
      spend: [hours(DEFAULT_HOURS), tired],
      get: [{ i: 'food', n: `~${Math.round(FARM.base)}`, t: `food, +${FARM.perFrame} per cold-frame level; ×1.5 for a Green thumb` }],
      tradeoff: `No skill needed, so anyone free can do it; small, and ×${FARM.cold} in frost.`,
      when: 'Food will not last the week.',
      key: `Cold frames: ${garden.maxLevel} levels`,
    },
    {
      id: 'job_doctor', group: 'jobs', icon: 'job_doctor', name: 'Tend wounded',
      what: 'Dresses wounds so they heal instead of rotting.',
      spend: [hours(DEFAULT_HOURS), { i: 'meds', n: 1, t: 'medicine per bad wound' }],
      get: [{ i: 'job_doctor', n: range(CARE.base, CARE.base + 10 * CARE.perSkill), t: 'wounds tended (Medicine 0–10)' }, { i: 'st_wound', t: 'tended wounds heal ~3× faster' }],
      tradeoff: 'Stops wounds turning to fever, but wasted on a healthy house.',
      when: 'Anyone is cut, shot or bleeding.',
      key: 'Untended cuts can go septic',
    },
    {
      id: 'job_drill', group: 'jobs', icon: 'job_drill', name: 'Drill',
      what: 'Shooting practice with the gun they carry.',
      spend: [hours(DEFAULT_HOURS), { i: 'ammo', n: DRILL_ROUNDS, t: 'rounds of their own ammo' }],
      get: [{ i: 'skill_shooting', n: '×2', t: 'shooting XP live (×1 dry-fire)' }, { i: 'st_radio', t: 'a lookout: intel on tonight (Shooting 3+)' }],
      tradeoff: `Burns ${DRILL_ROUNDS} rounds today for a better shot every night after.`,
      when: 'Ammo is plentiful and the shooters are green.',
      key: `${DRILL_ROUNDS} rounds per ${DEFAULT_HOURS}h`,
    },
    {
      id: 'job_counsel', group: 'jobs', icon: 'job_counsel', name: 'Counsel',
      what: 'Talks the worst-off down before they break.',
      spend: [hours(DEFAULT_HOURS)],
      get: [{ i: 'st_mood_up', n: 1, t: 'person helped per 4h' }, { i: 'st_break', n: `×${COUNSEL_BREAK}`, t: 'their chance to break at dawn' }],
      tradeoff: 'Produces nothing you can hold, but the frayed do not break.',
      when: 'Someone\'s mood is near the ticks on their bar.',
      key: '1 session per 4 hours',
    },
    {
      id: 'job_radio', group: 'jobs', icon: 'job_radio', name: 'Work the radio',
      what: 'Listens for what is coming tonight.',
      spend: [hours(DEFAULT_HOURS), ...costAmts(radio).map((a) => ({ ...a, t: `${a.t} (the mast, once)` }))],
      get: [{ i: 'st_radio', t: 'tonight\'s threat: counts by wave; packs and timing on a clear signal (Social, Easy talker, The voice)' }, { i: 'st_faction', t: 'news, voices, the Guard\'s story' }],
      tradeoff: 'A worker sits at a dial, but you know what comes tonight.',
      when: 'Before a tide, or when you are guessing what to build.',
      key: 'Needs the radio mast',
    },
    {
      id: 'job_rest', group: 'jobs', icon: 'job_rest', name: 'Rest',
      what: 'The whole day off.',
      spend: [{ i: 'st_time', n: `${DAY_HOURS}h`, t: 'of output lost' }],
      get: [{ i: 'st_tired', n: '+40%', t: 'rest' }, { i: 'st_mood_up', n: '+3', t: 'mood for a day' }],
      tradeoff: 'You lose a worker for a day so they do not break.',
      when: 'Rest is under a quarter, or they are hurt.',
      key: 'Worn-out people work slower',
    },
    // ---------------- the day ----------------
    {
      id: 'hours', group: 'day', icon: 'st_time', name: 'Work hours',
      what: `How much of the ${DAY_HOURS}-hour day each person works.`,
      spend: [tired, { i: 'st_mood_down', t: '"worked to the bone" when ragged' }],
      get: [{ i: 'st_xp', t: 'yield scales with hours' }, { i: 'st_grit', t: 'Tough: a quarter less tired' }],
      tradeoff: 'Long days yield more, but tired people break and work worse.',
      when: `Default ${DEFAULT_HOURS}h; cut it for anyone running ragged.`,
      key: `${DEFAULT_HOURS} of ${DAY_HOURS} hours`,
    },
    {
      id: 'run', group: 'day', icon: 'st_danger', name: 'Lead a run',
      what: 'You walk one street in daylight and pick what to carry.',
      spend: [{ i: 'st_time', n: `${DAY_HOURS}h`, t: 'the leader\'s day (or leave later)' }, { i: 'ammo', t: 'rounds you fire' }, { i: 'st_dead', t: 'the leader can die' }],
      get: [{ i: 'parts', t: 'the best loot: you choose it' }, { i: 'st_perk', t: 'guns, mods, papers' }, { i: 'st_faction', t: 'sometimes a survivor' }],
      tradeoff: 'The best loot, but you play it and the leader can die.',
      when: 'You need something specific: parts, a gun, medicine.',
      key: `${RUN_SEC_PER_HOUR}s of light per hour on the street`,
    },
    {
      id: 'upkeep', group: 'day', icon: 'food', name: 'Food & heat',
      what: 'Every mouth eats; frost nights burn fuel in the stove.',
      spend: [{ i: 'food', n: 1, t: 'per person per day (big eaters 1.6, ascetics 0.7)' }, { i: 'fuel', n: '1/3', t: 'per person on frost nights' }],
      get: [{ i: 'st_hungry', t: 'no hunger, no freezing' }],
      tradeoff: 'Every new face is a gun on the wall and a mouth to feed.',
      when: 'Watch the −N under food and fuel at the top.',
      key: 'Half rations: ×0.5 food, −5 mood, hunger falls',
    },
    {
      id: 'chores', group: 'day', icon: 'cloth', name: 'Chores',
      what: 'One-click jobs from whoever has spare hours.',
      spend: [hours(1, 'and a rag or 1 fuel: oil the guns'), hours('3 / 1', 'haul the bodies, or 2 fuel to burn')],
      get: [{ i: 'st_break', n: `÷${COLD_JAM}`, t: 'jams tonight in the cold' }, { i: 'st_wall', t: 'no ramp of bodies at the wall' }],
      tradeoff: 'A few hours off someone\'s job to save a bad night.',
      when: 'Cold or snow (oil); bodies piled at the wall (haul or burn).',
      key: `Dry guns jam ×${COLD_JAM} in the cold`,
    },
    // ---------------- build & arm ----------------
    {
      id: 'workshop', group: 'build', icon: 'job_craft', name: 'Workshop',
      what: 'Machinery unlocks recipes; the bench makes them.',
      spend: [{ i: 'scrap', t: 'scrap' }, { i: 'parts', t: 'parts' }, { i: 'job_craft', t: 'a crafter\'s day' }],
      get: [{ i: 'ammo', t: 'ammunition' }, { i: 'trap_bear', t: 'trap kits' }, { i: 'pipegun', t: 'guns and mods' }],
      tradeoff: 'Machinery eats parts now that ammo would have used, but unlocks more.',
      when: 'Build a machine when its recipes answer your worst problem.',
      key: `${Object.keys(BUILDINGS).length} machines`,
    },
    {
      id: 'wall', group: 'build', icon: 'st_wall', name: 'The wall',
      what: 'Your health bar at night. If it falls, they climb over.',
      spend: [{ i: 'wood', t: 'timber to repair' }, { i: 'scrap', t: 'scrap for spikes, wire, steel' }],
      get: [{ i: 'st_wall', t: 'time: they chew the wall, not you' }],
      tradeoff: 'Wall bought in timber is hours they spend chewing, not biting.',
      when: 'Always worth topping up before a tide.',
      key: 'Starts at 300',
    },
    {
      id: 'fortify', group: 'build', icon: 'scrap', name: 'Reinforce',
      what: 'Sheet steel and railroad ties: a bigger wall.',
      spend: recipeAmts('fortify'),
      get: [{ i: 'st_wall', n: '+60', t: 'max wall, for good' }],
      tradeoff: 'Costly once, then every repair day fills a deeper wall.',
      when: 'Your wall empties most nights even when repaired.',
      key: fort ? `${fort.work} work at the forge` : 'forge',
    },
    {
      id: 'spikes', group: 'build', icon: 'trap_pit', name: 'Spike rows',
      what: 'Rebar at shin height: they hurt themselves on the wall.',
      spend: recipeAmts('spikes'),
      get: [{ i: 'st_danger', n: SPIKE_DPS, t: 'damage a second per row, to each one at the wall' }],
      tradeoff: 'Cheap and permanent, but only works once they reach the wall.',
      when: 'Lots of them reach the wall each night.',
      key: `${SPIKE_DPS}/s per row`,
    },
    {
      id: 'wirebelt', group: 'build', icon: 'trap_snare', name: 'Wire belts',
      what: 'Barbed wire across the road.',
      spend: recipeAmts('wire'),
      get: [{ i: 'trap_snare', n: `×${WIRE.slow}`, t: `speed in a ${WIRE.band}px band (up to ${WIRE.max})` }],
      tradeoff: 'More time to shoot them, but nothing dies to it alone.',
      when: 'Fast ones (Deer, Bucks) reach the wall too soon.',
      key: `Up to ${WIRE.max} belts`,
    },
    {
      id: 'lights', group: 'build', icon: 'mod_flashlight', name: 'Floodlights',
      what: 'Ballfield lamps on the generator.',
      spend: [...recipeAmts('light'), { i: 'fuel', n: LIGHT.fuel, t: 'fuel each night per light' }],
      get: [{ i: 'skill_shooting', n: `+${Math.round(LIGHT.aim * 100)}%`, t: 'guard aim each' }, { i: 'st_danger', n: `+${LIGHT.sight}px`, t: 'how far the guards see' }],
      tradeoff: 'Guards see farther and aim better, but they drink fuel nightly.',
      when: 'You have the generator and fuel to spare.',
      key: `Up to ${LIGHT.max} count`,
    },
    {
      id: 'turret', group: 'build', icon: 'nailgun', name: 'Nail turret',
      what: 'An automatic nailer on the wall.',
      spend: [...recipeAmts('turret'), { i: 'scrap', n: EMPLACEMENTS.nailturret.perShot, t: 'scrap per nail' }],
      get: [{ i: 'nailgun', n: `${EMPLACEMENTS.nailturret.rof}/s`, t: 'shots with no crew' }],
      tradeoff: 'Fires with nobody on it, but eats scrap all night.',
      when: 'Scrap is piling up and the line is thin.',
      key: `Up to ${FORT_CAP.turret}; needs the generator`,
    },
    {
      id: 'traps', group: 'build', icon: 'trap_bear', name: 'Traps',
      what: 'Kits you place on the road at dusk.',
      spend: [{ i: 'scrap', t: 'scrap, fuel, parts per kit' }, { i: 'job_craft', n: range(Math.min(...trapCosts), Math.max(...trapCosts)), t: 'bench work per kit' }],
      get: [{ i: 'trap_nails', t: 'damage, holds and slows while you shoot' }, { i: 'st_wall', t: 'fewer reach the wall' }],
      tradeoff: 'They work while you shoot, but each kit is bench time.',
      when: 'You know what is coming (radio) and can match the trap.',
      key: `${placementsAllowed(0)} placements + 1 per 3 Building`,
    },
    {
      id: 'emplacements', group: 'build', icon: 'lmg', name: 'Gun nests',
      what: 'Heavy guns on fixed mounts, crewed at night.',
      spend: [...recipeAmts('emp_mgnest'), { i: resIcon(mg.ammo), n: `${mg.rof}/s`, t: `${ammoLabel(mg.ammo).toLowerCase()} while firing` }],
      get: [{ i: 'lmg', n: mg.dmg, t: 'damage a round, belt-fed' }, { i: 'st_xp', t: 'trained crews overheat less' }],
      tradeoff: 'Huge fire from one post, but eats ammo and wants a trained crew.',
      when: 'Late nights, with a 5.56 or rifle stock to feed it.',
      key: '[H] take the nest',
    },
    {
      id: 'roofnest', group: 'build', icon: 'wood', name: 'Roof nest',
      what: 'A deck on the garage roof for one rifle.',
      spend: recipeAmts('roofnest'),
      get: [{ i: 'scoped', n: '+260px', t: 'sight for the guard posted up there' }],
      tradeoff: 'One guard sees far and safe, but is not at the wall.',
      when: 'You have a good rifle shot.',
      key: '[Y] change a guard\'s post',
    },
    {
      id: 'armory', group: 'build', icon: 'rifle', name: 'Armory',
      what: 'Who carries which gun, what it loads, what is fitted.',
      spend: [{ i: 'st_break', t: 'condition: worn guns jam' }, { i: 'ammo', t: 'each gun eats its own caliber' }],
      get: [{ i: 'skill_shooting', t: 'the right gun for each shooter' }, { i: 'mod_scope', t: 'attachments and ammo types' }],
      tradeoff: 'Big guns hit harder but eat scarce ammo; small ones run forever.',
      when: 'Match guns to the ammo you can make or find.',
      key: '[Q] swap guns at the wall',
    },
    {
      id: 'ammo', group: 'build', icon: 'ammo', name: 'Ammo types',
      what: 'Special rounds for the same guns.',
      spend: [{ i: 'parts', t: 'parts and more bench work than plain' }],
      get: [{ i: 'slug', t: 'more damage, pierce, or plate-cracking' }],
      tradeoff: 'Special rounds solve one enemy but cost parts and bench time.',
      when: 'Deputies (plate): AP or slugs. Crowds: buckshot. See the table.',
      key: '[T] swap ammo',
    },
    {
      id: 'mods', group: 'build', icon: 'mod_scope', name: 'Attachments',
      what: 'Scopes, mags, suppressors fitted in the armory.',
      spend: [{ i: 'scrap', t: 'scrap' }, { i: 'parts', t: 'parts' }],
      get: [{ i: 'mod_scope', t: 'one stat better, often another worse' }],
      tradeoff: 'Every attachment helps one thing and usually costs another.',
      when: 'Hover a gun: green numbers better, red worse.',
      key: 'Fit in the Armory',
    },
    {
      id: 'skills', group: 'build', icon: 'st_perk', name: 'Skills & perks',
      what: 'Five skills: Shooting, Building, Medicine, Scavenging, Social. Work raises one; at 4 and 7 pick a perk.',
      spend: [{ i: 'st_time', t: 'days on the same job' }],
      get: [{ i: 'st_perk', n: 2, t: 'perks per skill (at 4 and 7): faster or surer, more or safer' }, { i: 'st_xp', t: 'better yields' }],
      tradeoff: 'Specialists get perks; swapping jobs keeps everyone middling.',
      when: 'Keep people on jobs they have a passion for.',
      key: 'Passion: ×1.5 XP',
    },
    {
      id: 'people', group: 'build', icon: 'st_trait', name: 'Courage, traits, favourite gun',
      what: 'Courage holds the wall at night; each trait names a decision; a favourite gun handles 3 better.',
      spend: [{ i: 'st_courage', t: 'nights on the wall raise Courage; a death or a fall shakes it' }],
      get: [{ i: 'st_trait', t: 'who stands the wall, who goes out, who you counsel, who eats more' }, { i: 'skill_shooting', n: '+3', t: 'handling with their favourite kind of gun (★)' }],
      tradeoff: 'A Coward with a good gun is still a Coward; a Tough one with no gun still takes the hits.',
      when: 'Hover a trait on the sheet: the line says what to do with them.',
      key: '★ in the give menu',
    },
    {
      id: 'town', group: 'build', icon: 'st_faction', name: 'The town',
      what: 'Factions remember your choices; papers tell the story.',
      spend: [{ i: 'st_faction', t: 'choices in events' }],
      get: [{ i: 'st_faction', n: '40+', t: 'friendly: deals and help' }, { i: 'st_danger', n: '−40', t: 'hostile: they come for you' }],
      tradeoff: 'Pleasing one faction often angers another.',
      when: 'Read the event hints before you choose.',
      key: 'Papers come from runs',
    },
    // ---------------- the night ----------------
    {
      id: 'nerve', group: 'night', icon: 'st_courage', name: 'Nerve & focus',
      what: 'Hold right mouse: slow time, tight aim.',
      spend: [{ i: 'st_courage', n: `${NERVE.focusDrain}/s`, t: 'nerve while focusing' }],
      get: [{ i: 'st_time', n: '×0.6', t: 'time' }, { i: 'skill_shooting', n: '×0.4', t: 'spread' }],
      tradeoff: 'Perfect shots for a few seconds, but empty nerve shakes the line.',
      when: 'A Deputy, a Buck mid-leap, a crowd at the wall.',
      key: `RMB · needs ${NERVE.focusMin}+ nerve`,
    },
    {
      id: 'rally', group: 'night', icon: 'st_courage', name: 'Rally',
      what: 'Banked from five headshots in a row.',
      spend: [{ i: 'st_courage', n: 1, t: 'banked rally' }],
      get: [{ i: 'st_courage', n: `+${NERVE.rally}`, t: 'nerve' }, { i: 'skill_shooting', n: '+25%', t: `guard aim for ${NERVE.rallySec}s+` }, { i: 'st_break', t: 'calms panicked guards' }],
      tradeoff: 'Saves a breaking line, but you earn it with headshots.',
      when: 'Guards are panicking or the wall is about to go.',
      key: '[E]',
    },
    {
      id: 'sally', group: 'night', icon: 'm_fireaxe', name: 'Sally',
      what: 'Drop over the wall for a few seconds.',
      spend: [{ i: 'st_courage', n: SALLY.nerve, t: 'nerve' }, { i: 'st_bite', t: 'bites if they reach you' }, { i: 'st_time', n: `${SALLY.cooldown}s`, t: 'cooldown' }],
      get: [{ i: 'trap_bear', t: 're-sets bear traps and snares' }, { i: 'ammo', n: `${SALLY.lootRounds[0]}–${SALLY.lootRounds[1]}`, t: `rounds from ${Math.round(SALLY.loot * 100)}% of kills` }, { i: 'st_wall', t: 'shoves back the pile' }],
      tradeoff: `Re-arms traps and grabs rounds, but ${SALLY.out}s out there can mean a bite.`,
      when: 'A lull, a sprung trap close by, nothing fast on the road.',
      key: `[O] · ${SALLY.out}s out`,
    },
    {
      id: 'firebombs', group: 'night', icon: 'molotov', name: 'Firebombs',
      what: 'A pool of fire across the road.',
      spend: recipeAmts('molotov').concat([{ i: 'molotov', n: 1, t: 'firebomb per throw (a batch makes 3)' }]),
      get: [{ i: 'st_danger', n: `${FIRE.sec}s`, t: `of fire, ${FIRE.width}px wide` }],
      tradeoff: 'Burns a whole crowd, but fuel you also need for heat.',
      when: 'A packed crowd in one spot.',
      key: '[F] or middle mouse',
    },
    {
      id: 'dog', group: 'night', icon: 'st_noise', name: 'The dog',
      what: 'If a stray turns up, you can let it in.',
      spend: [{ i: 'st_faction', t: 'an event choice' }],
      get: [{ i: 'skill_shooting', n: `+${Math.round(DOG.aim * 100)}%`, t: `guard aim for ${DOG.sec}s when it barks` }, { i: 'st_mood_up', n: `+${DOG.mood}`, t: 'mood for everyone' }, { i: 'st_bite', t: 'bites what climbs over' }],
      tradeoff: 'Pure upside in code: say yes.',
      when: 'Whenever the event offers it.',
      key: 'Barks before you see them',
    },
  ];
  return out;
}

// ---------- the trade-offs matrix (guide's "at a glance") ----------
export interface MatrixRow { label: string; icon: string; spend: Amt[]; get: Amt[]; catch: string; sys?: string }
export interface MatrixBlock { title: string; rows: MatrixRow[] }

/** One ammo pool: what a batch costs at the bench, what it feeds. */
function ammoRow(res: Res): MatrixRow | null {
  const a = AMMO_TYPES[res];
  if (!a) return null;
  const r = RECIPES.find((x) => x.gives && x.gives[res]);
  const n = r?.gives?.[res] ?? 0;
  const icon = a.icon.replace(/^icon_/, '');
  return {
    label: a.name, icon,
    spend: r ? [...costAmts(r.cost), { i: 'job_craft', n: r.work, t: 'bench work' }, { i: icon, n: `→${n}`, t: 'rounds per batch' }] : [{ i: 'st_danger', t: 'found only' }],
    get: [{ i: icon, t: a.guns, s: 'feeds' }], catch: a.desc,
  };
}

export function matrix(): MatrixBlock[] {
  const S = systems();
  const row = (id: string, label?: string, c?: string): MatrixRow => {
    const s = S.find((x) => x.id === id)!;
    return { label: label ?? s.name, icon: s.icon, spend: s.spend, get: s.get, catch: c ?? s.tradeoff, sys: s.id };
  };
  const travel = Object.values(SITE_TRAVEL);
  return [
    { title: 'Each job (one worker, one day)', rows: S.filter((s) => s.group === 'jobs').map((s) => row(s.id)) },
    {
      title: 'A run, or stay home',
      rows: [
        row('run', 'Lead a run'),
        { label: 'Leader works at home', icon: 'job_repair', spend: [{ i: 'st_time', n: `${DEFAULT_HOURS}h`, t: 'the leader\'s day' }], get: [{ i: 'st_wall', t: 'one more worker\'s yield' }], catch: 'Safe and certain, but no guns, parts or papers.' },
        row('job_scavenge', 'Send a scavenger', `Hands-off, but ${Math.min(...travel)}–${Math.max(...travel)}h walking and no choosing.`),
      ],
    },
    {
      title: 'Repair the wall, or build traps',
      rows: [
        row('job_repair', 'Repair (a day)'),
        row('job_craft', 'Craft trap kits (a day)', 'Kills on the road, but a kit is spent or retrieved.'),
        row('spikes', 'Spike row (once)'),
        row('fortify', 'Reinforce (once)'),
      ],
    },
    { title: 'Ammunition: three pools', rows: (['pistol', 'shell', 'rifle'] as Res[]).map(ammoRow).filter((x): x is MatrixRow => !!x) },
    { title: 'At the wall', rows: [row('sally'), row('nerve'), row('firebombs'), row('rally')] },
  ];
}
