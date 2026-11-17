// Traps: crafted ahead of time as kits (G.trapStock), placed on the road at dusk with the
// deployment planner (src/ui/deploy.ts), consumed by the night (see docs/research/08-traps.md
// for the runtime spec). Pure data + pure helpers: nothing here imports the game state.
import type { Res } from '../types';
import type { Recipe } from './world';

/** What sets a trap off. */
export type TrapTrigger =
  | 'step' // the first Turned whose feet enter the area
  | 'shot' // a bullet has to hit it (the player; guards only on a FIRE order)
  | 'timer' // starts on its own (lit at dusk / when the night starts) and runs out
  | 'manual' // a key press (or the auto rule in `autoWhen`)
  | 'always'; // works all night until its durability is gone

/** Who (by ZombieDef id) a trap is good or bad against. `leaper` (Buck) and `spitter` (Biler) are upcoming roles. */
export type TurnedId = 'sleeper' | 'deer' | 'drag' | 'pulper' | 'crier' | 'deputy' | 'ferryman' | 'tunneler' | 'raider' | 'bellwether' | 'leaper' | 'spitter';

export interface TrapArea {
  /** circle radius in px around (x, lane centre) — blasts, lures, light */
  radius?: number;
  /** band length along the road in px, centred on x — slicks, strips, fences */
  length?: number;
  /** directional cone (pipe mine): half-angle in degrees, reach in px, pointed away from the wall (+x) */
  cone?: { half: number; reach: number };
  /** true = the band covers every lane (strung across the road); otherwise only its own lane */
  allLanes: boolean;
}

export interface TrapEffects {
  dmg?: number; // one-off damage on trigger (falls off to 40% at the edge of `radius`)
  dps?: number; // damage per second while inside (fire, current)
  stepDmg?: number; // damage per Turned per crossing (shards, nails)
  slow?: number; // speed multiplier while inside (0.55 = wire)
  hold?: number; // seconds a target is stopped in place
  holdCount?: number; // how many targets it can hold at once (bear trap 1, net = the lane)
  burn?: number; // seconds of burning applied (the battle's existing burn)
  ignites?: boolean; // its blast/flame lights oil slicks it touches
  light?: { r: number; time: number }; // light hole in the darkness layer; time 0 = while active
  lure?: { r: number; time: number }; // Turned within r walk to it and mill (speed 0) for `time` s
  cripple?: number; // 0..1 chance per Turned affected to lose its legs (walkers become crawlers)
  knock?: number; // knockback px
  knockdown?: number; // seconds prone (snare: runners go down)
  stun?: number; // seconds frozen (current)
  calm?: number; // sludge: Turned inside lose interest — speed ×calm, cannot keen or attack the wall
  hp?: number; // a barrier's own hit points (net); the Turned tear at it with their wall dps
}

export interface TrapDef {
  id: string;
  name: string;
  /** one line: what this trap is FOR */
  niche: string;
  /** in-voice description for the ledger */
  desc: string;
  icon: string; // sprite id (public/sprites/<icon>.png)
  world?: string; // in-world sprite id drawn on the road; absent = drawn procedurally (see 08-traps.md)
  recipe: { needs: 'workbench' | 'forge' | 'still' | 'generator'; level?: number; cost: Partial<Record<Res, number>>; work: number; makes?: number };
  /** kits used by one placement */
  trigger: TrapTrigger;
  /** for 'manual' traps: when the battle fires it on its own if the player never presses the key */
  autoWhen?: string;
  key?: string; // suggested key for manual traps (battle may remap)
  area: TrapArea;
  fx: TrapEffects;
  /** noise added to the battle's noise meter when it goes off (28 noise = one straggler) */
  noise: number;
  /** how many triggers / steps / shocks / seconds before it is spent. 1 = single use */
  uses: number;
  usesUnit: 'trigger' | 'step' | 'shock' | 'second' | 'body';
  /** distance from the wall's face, in px of road (battle: x − WALL_X) */
  minD: number;
  maxD: number;
  /** what it occupies: two traps on the same layer may not overlap; different layers may (lure on oil) */
  layer: 'ground' | 'object' | 'wall';
  /** what comes back at dawn if it was not spent: 'yes' = the kit; 'partial' = a chance / a share of the cost; 'no' */
  retrieve: 'yes' | 'partial' | 'no';
  retrieveChance?: number; // for 'partial'
  upkeep?: Partial<Record<Res, number>>; // paid each night it is placed (electric fence: fuel)
  requires?: { building?: string; flag?: string }; // to craft (and to run, for the generator)
  good: TurnedId[];
  bad: TurnedId[];
  /** one line on how the Turned beat it — shown in the planner */
  counter: string;
}

export const TRAPS: Record<string, TrapDef> = {
  nailbomb: {
    id: 'nailbomb', name: 'Nail bomb', icon: 'icon_pipebomb',
    niche: 'Burst AoE on a pack. Loud.',
    desc: 'Pipe, roofing nails, a clothespin tripwire. It goes off once, and everyone on Ferry Road hears it.',
    recipe: { needs: 'workbench', cost: { scrap: 4, fuel: 2, parts: 1 }, work: 4 },
    trigger: 'step', area: { radius: 130, allLanes: true },
    fx: { dmg: 160, cripple: 0.5, knock: 40, ignites: true, light: { r: 180, time: 0.6 } },
    noise: 12, uses: 1, usesUnit: 'trigger', minD: 150, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['sleeper', 'deer', 'drag', 'crier'], bad: ['ferryman', 'deputy'],
    counter: 'The first one through sets it off: a lone Deer spends it. Pair it with a lure so a crowd is standing on it.',
  },
  beartrap: {
    id: 'beartrap', name: 'Bear trap', icon: 'icon_trap_bear', world: 'trap_bear',
    niche: 'Holds one big target in place: a Ferryman, a Buck landing.',
    desc: 'A #4 Newhouse from the Halvorsen barn, chain spiked to the road. It has held bigger animals than this.',
    recipe: { needs: 'forge', cost: { scrap: 6, parts: 1 }, work: 4 },
    trigger: 'step', area: { radius: 22, allLanes: false },
    fx: { dmg: 45, hold: 6, holdCount: 1, cripple: 0.6 },
    noise: 1, uses: 3, usesUnit: 'trigger', minD: 40, maxD: 700, layer: 'object', retrieve: 'yes',
    good: ['ferryman', 'leaper', 'deputy', 'pulper'], bad: ['drag', 'deer'],
    counter: 'One jaw, one leg. A Ferryman pulls free in 4 s, not 6. Drags crawl over the pan.',
  },
  roofnails: {
    id: 'roofnails', name: 'Roofing-nail spread', icon: 'icon_trap_nails',
    niche: 'Slows a lane and cripples legs: walkers become Drags.',
    desc: 'Two pounds of galvanized roofing nails, bent into jacks with the vise. Points up whichever way they land.',
    recipe: { needs: 'workbench', cost: { scrap: 3 }, work: 2 },
    trigger: 'always', area: { length: 140, allLanes: false },
    fx: { slow: 0.7, stepDmg: 8, cripple: 0.18 },
    noise: 0, uses: 30, usesUnit: 'step', minD: 60, maxD: 860, layer: 'ground', retrieve: 'partial', retrieveChance: 0.6,
    good: ['sleeper', 'deer', 'leaper'], bad: ['ferryman', 'deputy', 'drag'],
    counter: 'Boots go through (Deputies, Ferrymen). Drags only drag themselves across. Thirty footfalls and the nails are pressed flat.',
  },
  flare: {
    id: 'flare', name: 'Tripwire flare', icon: 'icon_trap_flare',
    niche: 'Lights the road and burns off fog where they come.',
    desc: 'A road flare in a coffee can with a fishing-line pull. Red light for half a minute, and a shadow for every one of them.',
    recipe: { needs: 'still', cost: { fuel: 1, scrap: 1 }, work: 2, makes: 2 },
    trigger: 'step', area: { radius: 300, allLanes: true },
    fx: { light: { r: 300, time: 30 }, burn: 1 },
    noise: 2, uses: 1, usesUnit: 'trigger', minD: 200, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['drag', 'crier', 'deputy', 'spitter'], bad: [],
    counter: 'Light is not damage. On a clear moonlit night with floodlights up it is a wasted slot.',
  },
  oil: {
    id: 'oil', name: 'Oil slick', icon: 'icon_trap_oil',
    niche: 'Slows a band of road; light it and it burns.',
    desc: 'Drained crankcase oil and still dregs, mopped across the asphalt. They slip. Then you throw the bottle.',
    recipe: { needs: 'still', cost: { fuel: 2 }, work: 1 },
    trigger: 'always', area: { length: 120, allLanes: true },
    fx: { slow: 0.75, dps: 22, burn: 2, light: { r: 140, time: 12 } },
    noise: 0, uses: 12, usesUnit: 'second', minD: 120, maxD: 860, layer: 'ground', retrieve: 'no',
    good: ['sleeper', 'crier', 'drag'], bad: ['pulper'],
    counter: 'Unlit it only slows. A Pulper bursting on it puts it out: the bile is wet. Burns 12 s once lit.',
  },
  propane: {
    id: 'propane', name: 'Propane tank', icon: 'icon_trap_propane', world: 'trap_propane',
    niche: 'A bomb you set off with a bullet, when you choose.',
    desc: 'A twenty-pound grill tank from the hardware, painted white so you can find it in the dark. Shoot it.',
    recipe: { needs: 'workbench', cost: { scrap: 2, fuel: 3, parts: 1 }, work: 3 },
    trigger: 'shot', area: { radius: 160, allLanes: true },
    fx: { dmg: 220, knock: 70, burn: 3, ignites: true, light: { r: 240, time: 1 } },
    noise: 14, uses: 1, usesUnit: 'trigger', minD: 180, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['sleeper', 'crier', 'deputy', 'pulper'], bad: ['drag'],
    counter: 'Nothing sets it off but you. Miss it in the dark and it is a white can. Ferrymen kick it down the road.',
  },
  barrels: {
    id: 'barrels', name: 'Burning barrel line', icon: 'icon_trap_barrel', world: 'trap_barrel',
    niche: 'A persistent fire that closes a lane and lights the road.',
    desc: 'Three oil drums with the tops cut out, full of pallet wood and tires. The smoke is black and smells of every car on Route 9.',
    recipe: { needs: 'still', cost: { wood: 6, fuel: 2, scrap: 2 }, work: 3 },
    trigger: 'timer', area: { length: 60, allLanes: false },
    fx: { dps: 18, burn: 2, light: { r: 220, time: 0 } },
    noise: 0, uses: 150, usesUnit: 'second', minD: 120, maxD: 760, layer: 'object', retrieve: 'partial', retrieveChance: 0.7,
    good: ['sleeper', 'deer', 'crier'], bad: ['ferryman', 'drag'],
    counter: 'The Turned balk and step into the next lane, which is the point. Ferrymen walk through and knock a drum over. Burns 150 s from dusk.',
  },
  tincan: {
    id: 'tincan', name: 'Tin-can lure post', icon: 'icon_trap_tincan',
    niche: 'Pulls a crowd to one spot, on your key, for the combo.',
    desc: 'A fence post hung with tin cans and a cowbell, and a pull-cord back to the wall. They turn toward it like cattle at feeding.',
    recipe: { needs: 'workbench', cost: { scrap: 1, parts: 1 }, work: 1 },
    trigger: 'manual', key: 'L', autoWhen: 'the first Turned comes within 120 px of the post',
    area: { radius: 260, allLanes: true },
    fx: { lure: { r: 260, time: 8 } },
    noise: 6, uses: 2, usesUnit: 'trigger', minD: 250, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['sleeper', 'pulper', 'crier', 'deer'], bad: ['ferryman', 'raider'],
    counter: 'Eight seconds, then they remember you. Ferrymen do not turn their heads. The noise brings stragglers.',
  },
  radio: {
    id: 'radio', name: 'Radio lure', icon: 'icon_trap_radio',
    niche: 'A long, loud lure that drowns out a Crier\'s call.',
    desc: 'A Panasonic boombox on a car battery, playing WVSY\'s last tape: the hog report, then twenty minutes of polka. They stand and listen.',
    recipe: { needs: 'generator', cost: { parts: 3, scrap: 2 }, work: 4 },
    trigger: 'manual', key: 'L', autoWhen: 'a Crier begins to keen anywhere on the road',
    area: { radius: 380, allLanes: true },
    fx: { lure: { r: 380, time: 20 } },
    noise: 10, uses: 1, usesUnit: 'trigger', minD: 300, maxD: 860, layer: 'object', retrieve: 'partial', retrieveChance: 0.5,
    good: ['crier', 'sleeper', 'pulper', 'deer'], bad: ['ferryman', 'raider'],
    counter: 'While it plays, a Crier\'s summons walk to the radio, not the wall. Then something smashes it: half the time it does not come back.',
  },
  snare: {
    id: 'snare', name: 'Clothesline snare', icon: 'icon_trap_snare',
    niche: 'Trips anything running: Deer and Bucks go down.',
    desc: 'Galvanized clothesline strung shin-high between two porch posts. The fast ones never see it.',
    recipe: { needs: 'workbench', cost: { cloth: 1, scrap: 2 }, work: 2 },
    trigger: 'always', area: { length: 16, allLanes: true },
    fx: { knockdown: 2.5, slow: 0.85 },
    noise: 0, uses: 6, usesUnit: 'trigger', minD: 80, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['deer', 'leaper', 'raider'], bad: ['drag', 'ferryman', 'sleeper'],
    counter: 'Only trips what is moving fast. Sleepers step over it; Drags go under; a Ferryman snaps it. Six trips.',
  },
  spikepit: {
    id: 'spikepit', name: 'Punji pit', icon: 'icon_trap_pit', world: 'trap_pit',
    niche: 'Kills Drags and slow walkers outright, until it fills.',
    desc: 'A trench cut through the shoulder with Vern\'s backhoe, sharpened stakes, a sheet of plywood and leaves. The deer camp way.',
    recipe: { needs: 'workbench', cost: { wood: 8, scrap: 1 }, work: 5 },
    trigger: 'step', area: { length: 70, allLanes: false },
    fx: { dmg: 140, hold: 3, holdCount: 4 },
    noise: 1, uses: 4, usesUnit: 'body', minD: 160, maxD: 760, layer: 'ground', retrieve: 'partial', retrieveChance: 0.5,
    good: ['drag', 'sleeper', 'pulper', 'tunneler'], bad: ['deer', 'leaper', 'ferryman'],
    counter: 'Four bodies fill it and the rest walk across them. Deer and Bucks jump it. A Ferryman climbs out.',
  },
  electric: {
    id: 'electric', name: 'Electrified fence', icon: 'icon_trap_electric',
    niche: 'All-night stuns at the kill zone. Needs the generator and fuel.',
    desc: 'Chain-link on fence posts, wired to the diesel through a cattle-fence charger from the farm store. Do not lean on it.',
    recipe: { needs: 'generator', cost: { scrap: 8, parts: 4 }, work: 6 },
    trigger: 'always', area: { length: 24, allLanes: true },
    fx: { dmg: 28, stun: 0.6 },
    noise: 2, uses: 30, usesUnit: 'shock', minD: 50, maxD: 260, layer: 'object', retrieve: 'yes',
    upkeep: { fuel: 1 }, requires: { building: 'generator' },
    good: ['deputy', 'sleeper', 'crier', 'deer'], bad: ['pulper', 'ferryman'],
    counter: 'A Pulper bursting on it shorts it for 15 s. Ferrymen are not stunned. Thirty shocks and the charger trips. 1 fuel a night.',
  },
  deadfall: {
    id: 'deadfall', name: 'Car-door deadfall', icon: 'icon_trap_deadfall',
    niche: 'One crushing hit on whatever is climbing the wall.',
    desc: 'A Buick door and a cinder block on a rope over the barricade. Cut the rope. Reset it at dawn.',
    recipe: { needs: 'forge', cost: { scrap: 6, wood: 2 }, work: 3 },
    trigger: 'manual', key: 'G', autoWhen: 'a Turned starts climbing over, or a Buck lands on the wall',
    area: { length: 50, allLanes: false },
    fx: { dmg: 260, knockdown: 2, knock: 30 },
    noise: 4, uses: 1, usesUnit: 'trigger', minD: 0, maxD: 40, layer: 'wall', retrieve: 'partial', retrieveChance: 0.8,
    good: ['leaper', 'ferryman', 'deputy', 'pulper'], bad: ['drag', 'spitter', 'raider'],
    counter: 'One hit, one target, only at the wall. Anything that stays out on the road never meets it.',
  },
  net: {
    id: 'net', name: 'Chain-link net', icon: 'icon_trap_net', world: 'trap_net',
    niche: 'Holds a whole lane for a few seconds while you reload.',
    desc: 'A section of the ballfield backstop, staked low across the lane. They push into it in a heap.',
    recipe: { needs: 'forge', cost: { scrap: 7, parts: 1 }, work: 3 },
    trigger: 'step', area: { length: 30, allLanes: false },
    fx: { hold: 6, holdCount: 99, hp: 240 },
    noise: 1, uses: 1, usesUnit: 'trigger', minD: 100, maxD: 600, layer: 'object', retrieve: 'partial', retrieveChance: 0.5,
    good: ['sleeper', 'deer', 'pulper', 'crier'], bad: ['ferryman', 'leaper'],
    counter: 'They tear at it with their wall strength: a Ferryman is through in a second. Bucks jump it. The heap is a gift for a nail bomb.',
  },
  sludge: {
    id: 'sludge', name: 'Pond-sludge decoy', icon: 'icon_trap_sludge',
    niche: 'The Quiet\'s jar: inside the smear, the Turned lose interest.',
    desc: 'Settling-pond sludge from Pond 2, smeared on the road the way the man from the Quiet showed you. It smells like bread gone off. They stop, and they listen to something.',
    recipe: { needs: 'still', cost: { food: 2, fuel: 1 }, work: 3 },
    trigger: 'always', area: { length: 160, allLanes: true },
    fx: { calm: 0.35 },
    noise: 0, uses: 40, usesUnit: 'second', minD: 80, maxD: 860, layer: 'ground', retrieve: 'no',
    requires: { flag: 'quietJar' },
    good: ['crier', 'deer', 'sleeper', 'spitter'], bad: ['ferryman', 'raider', 'bellwether'],
    counter: 'Forty seconds of Turned standing in it, then it is trodden thin. Criers inside cannot keen. The bell overrides it. The living do not care.',
  },
  pipemine: {
    id: 'pipemine', name: 'Pipe mine', icon: 'icon_trap_pipemine',
    niche: 'A directional cone of nails down the road. Clears a lane-front.',
    desc: 'A steel plate, a C4-shaped pack of black powder, and four hundred roofing nails in epoxy. FRONT TOWARD RIVER, in Marla\'s marker.',
    recipe: { needs: 'workbench', level: 2, cost: { scrap: 6, fuel: 3, parts: 2 }, work: 5 },
    trigger: 'manual', key: 'G', autoWhen: 'three or more Turned are inside the cone',
    area: { cone: { half: 30, reach: 240 }, allLanes: true },
    fx: { dmg: 150, cripple: 0.4, knock: 60 },
    noise: 12, uses: 1, usesUnit: 'trigger', minD: 30, maxD: 220, layer: 'object', retrieve: 'yes',
    good: ['sleeper', 'deer', 'crier', 'pulper'], bad: ['ferryman', 'drag'],
    counter: 'The nails go one way. Anything already past it, or low under the cone (Drags), is safe. Fire too early and the road is empty.',
  },
  glass: {
    id: 'glass', name: 'Glass-shard strip', icon: 'icon_trap_glass',
    niche: 'Cheap, quiet attrition. Wears out.',
    desc: 'Every bottle from the Legion hall, broken into a feed sack and raked across the shoulder. They walk barefoot now, most of them.',
    recipe: { needs: 'workbench', cost: { cloth: 1 }, work: 1, makes: 2 },
    trigger: 'always', area: { length: 100, allLanes: false },
    fx: { stepDmg: 6, slow: 0.9 },
    noise: 0, uses: 25, usesUnit: 'step', minD: 60, maxD: 860, layer: 'ground', retrieve: 'no',
    good: ['drag', 'sleeper', 'tunneler'], bad: ['deputy', 'ferryman', 'raider'],
    counter: 'Boots ignore it. Twenty-five footfalls grind it to sand. A Drag crossing it takes triple.',
  },
};

export const TRAP_IDS = Object.keys(TRAPS);

/** Trap kits craft through the ordinary queue; `finishRecipe` adds `trapCount` kits of `trap` to G.trapStock.
 *  (`trap_nailbomb` supersedes the legacy `trap` recipe, which still feeds G.fort.traps; hide the legacy one
 *  in the craft list once the battle reads G.deploy, and run migrateTrapStock on load.) */
export const TRAP_RECIPES: Recipe[] = TRAP_IDS.map((id) => {
  const t = TRAPS[id];
  const n = t.recipe.makes ?? 1;
  return {
    id: `trap_${id}`, name: n > 1 ? `${t.name} ×${n}` : t.name, needs: t.recipe.needs, level: t.recipe.level,
    cost: t.recipe.cost, work: t.recipe.work, trap: id, trapCount: n, desc: `${t.niche} ${t.desc}`,
  };
});

// ---------- placement (the contract between deploy.ts and the battle) ----------

/** One trap on the road. `x` is the battle's screen x (WALL_X = wall face); `lane` 0 (far) .. laneCount−1 (near). */
export interface Placement {
  trap: string;
  x: number;
  lane: number;
}

/** Placements allowed per night: 2 + floor(best Building skill / 3)  (research 05 §8). */
export function placementsAllowed(bestBuilding: number): number {
  return 2 + Math.floor(Math.max(0, bestBuilding) / 3);
}

/** Half-width along the road a trap occupies, for overlap and drawing. */
export function trapHalfWidth(t: TrapDef): number {
  if (t.area.length) return t.area.length / 2;
  if (t.area.cone) return 16;
  return Math.max(14, Math.min(26, t.area.radius ?? 20));
}

/** Why a trap cannot go at (x, lane) given the others; null if it can. */
export function placementProblem(p: Placement, others: Placement[], wallX: number, roadMaxX: number): string | null {
  const t = TRAPS[p.trap];
  if (!t) return 'unknown trap';
  const d = p.x - wallX;
  if (d < t.minD) return t.maxD <= 60 ? 'only at the wall' : `too close: needs ${t.minD}+ from the wall`;
  if (d > t.maxD) return t.maxD <= 60 ? 'only at the wall' : `too far: within ${t.maxD} of the wall`;
  if (p.x > roadMaxX) return 'off the road';
  const hw = trapHalfWidth(t);
  for (const o of others) {
    if (o === p) continue;
    const u = TRAPS[o.trap];
    if (!u || u.layer !== t.layer) continue;
    const sameLane = t.area.allLanes || u.area.allLanes || o.lane === p.lane;
    if (sameLane && Math.abs(o.x - p.x) < hw + trapHalfWidth(u)) return `overlaps the ${u.name.toLowerCase()}`;
  }
  return null;
}

/** Named combos the planner points out (and the battle should honour). */
export function combos(ps: Placement[]): string[] {
  const out = new Set<string>();
  const near = (a: Placement, b: Placement, r: number) => Math.abs(a.x - b.x) <= r;
  for (const a of ps) for (const b of ps) {
    if (a === b) continue;
    const A = TRAPS[a.trap], B = TRAPS[b.trap];
    if (!A || !B) continue;
    if (A.fx.lure && B.id === 'oil' && near(a, b, A.fx.lure.r * 0.5)) out.add('Lure on the oil: pull them in, then light it.');
    if (A.fx.lure && (B.id === 'nailbomb' || B.id === 'propane') && near(a, b, (B.area.radius ?? 0) + 40)) out.add(`Lure beside the ${B.name.toLowerCase()}: a crowd standing on it.`);
    if (A.fx.ignites && B.id === 'oil' && near(a, b, (A.area.radius ?? 0) + (B.area.length ?? 0) / 2)) out.add(`The ${A.name.toLowerCase()} will light the oil.`);
    if (A.id === 'barrels' && B.id === 'oil' && near(a, b, 90)) out.add('Barrels beside the oil: it will catch on its own.');
    if (A.id === 'net' && (B.id === 'nailbomb' || B.id === 'propane') && b.x > a.x && near(a, b, (B.area.radius ?? 0))) out.add(`The net heaps them up on the ${B.name.toLowerCase()}.`);
    if (A.id === 'flare' && B.id === 'propane' && near(a, b, A.fx.light!.r)) out.add('The flare lights the propane tank for your shot.');
    if (A.id === 'snare' && B.id === 'spikepit' && b.x < a.x && near(a, b, 120)) out.add('Tripped Deer fall short of the pit, then crawl in.');
    if (A.id === 'roofnails' && B.id === 'spikepit' && near(a, b, 140)) out.add('Crippled walkers crawl into the pit.');
  }
  return [...out];
}

/** Take the kits for a night's placements out of stock. Returns the new stock (does not mutate). */
export function spendStock(stock: Record<string, number>, ps: Placement[]): Record<string, number> {
  const s = { ...stock };
  for (const p of ps) s[p.trap] = Math.max(0, (s[p.trap] ?? 0) - 1);
  return s;
}

/**
 * Dawn: what comes back. `spent` = placements that triggered/wore out during the night (by index).
 * Retrieval of 'partial' traps rolls `rand()` against retrieveChance.
 */
export function dawnRetrieve(ps: Placement[], spent: Set<number>, rand: () => number): Record<string, number> {
  const back: Record<string, number> = {};
  ps.forEach((p, i) => {
    const t = TRAPS[p.trap];
    if (!t || t.retrieve === 'no') return;
    // multi-use traps that were triggered but not used up come back too (spent = used up)
    if (spent.has(i)) return;
    if (t.retrieve === 'partial' && rand() > (t.retrieveChance ?? 0.5)) return;
    back[p.trap] = (back[p.trap] ?? 0) + 1;
  });
  return back;
}

/** Migration: old saves kept nail bombs as G.fort.traps. Fold them into the kit stock; the caller then sets G.fort.traps = 0. */
export function migrateTrapStock(stock: Record<string, number> | undefined, legacyTraps: number): Record<string, number> {
  const s = { ...(stock ?? {}) };
  if (legacyTraps > 0) s.nailbomb = (s.nailbomb ?? 0) + legacyTraps;
  return s;
}
