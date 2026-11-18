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
  /** directional cone (none of the six kits uses it now): half-angle in degrees, reach in px, pointed away from the wall (+x) */
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
  world?: string; // in-world sprite id (tools/sprites-traps.json, sprites-world.json); also the planner's road token
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
  upkeep?: Partial<Record<Res, number>>; // paid each night it is placed (none of the six kits has one now)
  requires?: { building?: string; flag?: string }; // to craft (and to run, for the generator)
  good: TurnedId[];
  bad: TurnedId[];
  /** one line on how the Turned beat it — shown in the planner */
  counter: string;
}

/**
 * Six kits, one job each (docs/research/19c-simplify-items.md): trip, cut, hold, burn, pull, blow.
 * Each is easy to read on its own; the depth is in the pairs (lure onto the bomb, trip into the nails,
 * light the oil when the crowd is on it).
 */
export const TRAPS: Record<string, TrapDef> = {
  snare: {
    id: 'snare', name: 'Snare wire', icon: 'icon_trap_snare', world: 'trap_snarepost',
    niche: 'Trips the fast ones: Deer and Bucks go down, and everything wades through it slower.',
    desc: 'Galvanized clothesline and fence wire strung shin-high between porch posts, across every lane. The fast ones never see it.',
    recipe: { needs: 'workbench', cost: { salvage: 3 }, work: 2 },
    trigger: 'always', area: { length: 50, allLanes: true },
    fx: { knockdown: 2.5, slow: 0.6 },
    noise: 0, uses: 8, usesUnit: 'trigger', minD: 80, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['deer', 'leaper', 'raider', 'crier'], bad: ['ferryman', 'drag'],
    counter: 'Eight trips and the wire is down. A Ferryman snaps it; Drags go under it.',
  },
  roofnails: {
    id: 'roofnails', name: 'Nail strip', icon: 'icon_trap_nails', world: 'trap_roofnails',
    niche: 'Hurts every one that crosses, and cripples legs: walkers become Drags.',
    desc: 'Roofing nails bent into jacks with the vise and broken bottles from the Legion hall, raked across the lane. Points up whichever way they land.',
    recipe: { needs: 'workbench', cost: { salvage: 3 }, work: 2 },
    trigger: 'always', area: { length: 140, allLanes: false },
    fx: { slow: 0.75, stepDmg: 10, cripple: 0.18 },
    noise: 0, uses: 30, usesUnit: 'step', minD: 60, maxD: 860, layer: 'ground', retrieve: 'partial', retrieveChance: 0.6,
    good: ['sleeper', 'deer', 'drag', 'leaper', 'tunneler'], bad: ['ferryman', 'deputy'],
    counter: 'Boots go through (Deputies, Ferrymen). A Drag crawling across takes triple. Thirty footfalls and the nails are pressed flat.',
  },
  beartrap: {
    id: 'beartrap', name: 'Bear trap', icon: 'icon_trap_bear', world: 'trap_bear',
    niche: 'Holds one big target in place: a Ferryman, a Buck landing, a Deputy.',
    desc: 'A #4 Newhouse from the Halvorsen barn, chain spiked to the road. It has held bigger animals than this.',
    recipe: { needs: 'forge', cost: { salvage: 8 }, work: 4 },
    trigger: 'step', area: { radius: 22, allLanes: false },
    fx: { dmg: 45, hold: 6, holdCount: 1, cripple: 0.6 },
    noise: 1, uses: 3, usesUnit: 'trigger', minD: 40, maxD: 700, layer: 'object', retrieve: 'yes',
    good: ['ferryman', 'leaper', 'deputy', 'pulper'], bad: ['drag', 'deer'],
    counter: 'One jaw, one leg. A Ferryman pulls free in 4 s, not 6. Drags crawl over the pan. Re-sets itself three times.',
  },
  oil: {
    id: 'oil', name: 'Oil slick', icon: 'icon_trap_oil', world: 'trap_oil',
    niche: 'Slows a band of road; light it with [G] when the crowd is on it, and it burns.',
    desc: 'Drained crankcase oil and still dregs, mopped across the asphalt. They slip. Then you throw the match.',
    recipe: { needs: 'still', cost: { fuel: 2 }, work: 1 },
    trigger: 'manual', key: 'G', autoWhen: 'four or more Turned are on the slick',
    area: { length: 120, allLanes: true },
    fx: { slow: 0.75, dps: 22, burn: 2, light: { r: 200, time: 15 } },
    noise: 0, uses: 15, usesUnit: 'second', minD: 120, maxD: 860, layer: 'ground', retrieve: 'no',
    good: ['sleeper', 'crier', 'drag', 'deer'], bad: ['pulper'],
    counter: 'Unlit it only slows. A Pulper bursting on it puts it out: the bile is wet. Burns 15 s once lit, and lights the road.',
  },
  tincan: {
    id: 'tincan', name: 'Tin-can lure', icon: 'icon_trap_tincan', world: 'trap_tincan',
    niche: 'Pulls a crowd to one spot on [L], and drowns out a Crier while it rattles.',
    desc: 'A fence post hung with tin cans and a cowbell, and a pull-cord back to the wall. They turn toward it like cattle at feeding.',
    recipe: { needs: 'workbench', cost: { salvage: 3 }, work: 1 },
    trigger: 'manual', key: 'L', autoWhen: 'the first Turned comes within 120 px of the post',
    area: { radius: 280, allLanes: true },
    fx: { lure: { r: 280, time: 10 } },
    noise: 6, uses: 2, usesUnit: 'trigger', minD: 250, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['sleeper', 'pulper', 'crier', 'deer'], bad: ['ferryman', 'raider'],
    counter: 'Ten seconds, then they remember you. Ferrymen do not turn their heads. A Crier inside it keens half as often, and its summons walk to the cans.',
  },
  nailbomb: {
    id: 'nailbomb', name: 'Nail bomb', icon: 'icon_pipebomb', world: 'trap_nailbomb',
    niche: 'A burst on a pack: the first one through sets it off, or shoot it when the crowd is on it.',
    desc: 'Pipe, roofing nails, a clothespin tripwire. It goes off once, and everyone on Ferry Road hears it.',
    recipe: { needs: 'workbench', cost: { salvage: 6, fuel: 2 }, work: 4 },
    trigger: 'step', area: { radius: 140, allLanes: true },
    fx: { dmg: 170, cripple: 0.5, knock: 50, burn: 1.5, ignites: true, light: { r: 220, time: 1 } },
    noise: 12, uses: 1, usesUnit: 'trigger', minD: 150, maxD: 860, layer: 'object', retrieve: 'yes',
    good: ['sleeper', 'deer', 'crier', 'pulper'], bad: ['ferryman', 'deputy'],
    counter: 'The first one through sets it off: a lone Deer spends it. Pair it with the lure, or shoot it yourself when they bunch.',
  },
};
/** Kits that were folded into the six above (old saves, old queues, last night's plan): old id -> new id. */
export const TRAP_FOLD: Record<string, string> = {
  glass: 'roofnails', spikepit: 'roofnails', net: 'beartrap', deadfall: 'beartrap', electric: 'beartrap',
  barrels: 'oil', flare: 'oil', radio: 'tincan', sludge: 'tincan', propane: 'nailbomb', pipemine: 'nailbomb',
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
    if (A.fx.lure && B.id === 'nailbomb' && near(a, b, (B.area.radius ?? 0) + 40)) out.add('Lure beside the nail bomb: a crowd standing on it.');
    if (A.fx.ignites && B.id === 'oil' && near(a, b, (A.area.radius ?? 0) + (B.area.length ?? 0) / 2)) out.add(`The ${A.name.toLowerCase()} will light the oil.`);
    if (A.id === 'snare' && B.id === 'roofnails' && b.x < a.x && near(a, b, 160)) out.add('Tripped Deer crawl the rest of the way over the nails.');
    if (A.id === 'snare' && B.id === 'oil' && near(a, b, 140)) out.add('The wire holds them in the oil while it burns.');
    if (A.id === 'beartrap' && B.id === 'nailbomb' && near(a, b, (B.area.radius ?? 0))) out.add('The bear trap holds a big one on the nail bomb.');
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
