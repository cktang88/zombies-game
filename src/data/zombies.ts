// The Turned. Folk names from the people of Vessey.

/**
 * A visible weakspot, anchored on a sprite. x, y are fractions of the drawn sprite box as it
 * faces left (0,0 = top-left, 1,1 = bottom-right at the feet); r is a fraction of its height.
 *   sac      Pulper's belly: a hit bursts it where it stands (shoot it far from the wall)
 *   neck     Deputy's gap under the cracked visor: armour ignored, x2
 *   shoulder Ferryman's bared shoulder bone: crit x2.5, armour ignored
 *   knee     Ferryman: knee hits count as stagger hits (two within 1.2 s = knockdown);
 *            Deer: one knee hit cripples
 *   throat   Crier: a hit >= 20 dmg interrupts the keen; Biler: bursts the bile in its throat
 */
export type WeakKind = 'sac' | 'neck' | 'shoulder' | 'knee' | 'throat';
export interface WeakSpot { kind: WeakKind; x: number; y: number; r: number }
/** Weakspot anchors per sprite id (they differ by pose). */
export const WEAKSPOTS: Record<string, WeakSpot[]> = {
  z_bloater: [{ kind: 'sac', x: 0.42, y: 0.4, r: 0.075 }],
  z_riot: [{ kind: 'neck', x: 0.42, y: 0.17, r: 0.03 }],
  z_brute: [{ kind: 'shoulder', x: 0.66, y: 0.12, r: 0.045 }, { kind: 'knee', x: 0.3, y: 0.82, r: 0.04 }, { kind: 'knee', x: 0.72, y: 0.82, r: 0.04 }],
  z_shrieker: [{ kind: 'throat', x: 0.33, y: 0.16, r: 0.032 }],
  z_runner: [{ kind: 'knee', x: 0.24, y: 0.69, r: 0.04 }, { kind: 'knee', x: 0.73, y: 0.74, r: 0.04 }],
  z_runner2: [{ kind: 'knee', x: 0.5, y: 0.66, r: 0.04 }, { kind: 'knee', x: 0.86, y: 0.8, r: 0.04 }],
  z_spitter: [{ kind: 'throat', x: 0.16, y: 0.27, r: 0.045 }],
};
/** Where the eyes are (fractions, as above): the Buck's ochre eye flare before it jumps. */
export const EYES: Record<string, { x: number; y: number }> = { z_leaper: { x: 0.09, y: 0.13 } };

export interface ZombieDef {
  id: string;
  name: string;
  sprites: string[];
  hp: number;
  speed: number; // px/s
  dps: number; // damage per second to barricade
  cost: number; // threat points
  minDay: number;
  head: number; // fraction of height that is the head hitbox
  width: number; // hitbox width px (display scale)
  height: number; // display height
  armor?: number; // flat damage reduction on body hits
  lore: string;
  burst?: boolean; // bursts on death (pulper)
  scream?: boolean; // summons others
  lunge?: boolean; // sprint bursts
  crawl?: boolean; // low crawler hitbox (Drags)
  special?: boolean; // never drawn by the random budget; only placed by a night special
  ranged?: boolean; // the living: stops short and shoots back
  tunnel?: boolean; // comes up behind the wall
  boss?: boolean; // knockback immune, big HP bar
  toll?: boolean; // the bell: periodically drives the others on
  leap?: boolean; // Buck: crouches short of the wall (eye flare), then vaults it into the guards
  spit?: boolean; // Biler: stops at range and lobs bile globs over the wall
  mass?: number; // corpse-pile mass when it dies against the wall (default 1)
  role?: string; // one line: the default it breaks, and the answer (threat ribbon / intel)
}

export const ZOMBIES: Record<string, ZombieDef> = {
  sleeper: {
    id: 'sleeper', name: 'Sleeper', sprites: ['z_shambler', 'z_shambler2', 'z_mill', 'z_hunter', 'z_manor', 'z_church'], hp: 64, speed: 36, dps: 6, cost: 1, minDay: 1,
    head: 0.17, width: 46, height: 120,
    lore: 'They stand for hours like they\'re waiting on a shift whistle. Don\'t wake a Sleeper.',
  },
  deer: {
    id: 'deer', name: 'Deer', sprites: ['z_runner', 'z_runner2'], hp: 45, speed: 95, dps: 5, cost: 1.6, minDay: 2,
    head: 0.17, width: 48, height: 118, lunge: true, mass: 0.8, role: 'Herds. Shoot them in the pant; legs stop the lunge.',
    lore: 'The young ones, the recent ones. They spook like deer, and they come back like deer.',
  },
  drag: {
    id: 'drag', name: 'Drag', sprites: ['z_crawler'], hp: 40, speed: 20, dps: 4, cost: 0.8, minDay: 2,
    head: 0.45, width: 90, height: 42, crawl: true, mass: 0.5, role: 'Low. The firestep cannot see them at the wall.',
    lore: 'What\'s left after the river or the train. Watch your ankles at the wall.',
  },
  pulper: {
    id: 'pulper', name: 'Pulper', sprites: ['z_bloater'], hp: 120, speed: 22, dps: 8, cost: 3, minDay: 4,
    head: 0.15, width: 66, height: 132, burst: true, mass: 0, role: 'Never inside the line. The sac bursts it early.',
    lore: 'Waterlogged from the settling ponds. Shoot them far, or not at all.',
  },
  crier: {
    id: 'crier', name: 'Crier', sprites: ['z_shrieker'], hp: 60, speed: 30, dps: 3, cost: 4, minDay: 5,
    head: 0.17, width: 40, height: 124, scream: true, role: 'Keens for more. Hit the throat in the wind-up.',
    lore: 'It keens almost in words, and others come. It\'s calling them by name.',
  },
  deputy: {
    id: 'deputy', name: 'Deputy', sprites: ['z_riot'], hp: 120, speed: 28, dps: 7, cost: 3.5, minDay: 7,
    head: 0.16, width: 50, height: 122, armor: 16, mass: 1.3, role: 'Plate soaks body shots. Visor, neck, or legs.',
    lore: 'County issue armor, and nobody left to sign for it. Aim for the broken visor.',
  },
  ferryman: {
    id: 'ferryman', name: 'Ferryman', sprites: ['z_brute'], hp: 520, speed: 20, dps: 24, cost: 9, minDay: 9,
    head: 0.13, width: 92, height: 160, armor: 6, mass: 3, role: 'Shrugs off knockback. Slugs and knees knock it down.',
    lore: 'The big ones from the docks and the kill floor. Slow. They do not stop.',
  },
  leaper: {
    id: 'leaper', name: 'Buck', sprites: ['z_leaper'], hp: 70, speed: 58, dps: 5, cost: 3, minDay: 6,
    head: 0.16, width: 52, height: 112, leap: true, mass: 1, role: 'Crouches, eyes flare, then over the wall. Shoot it in the crouch.',
    lore: 'Farm boys, mostly. They used to vault the cattle gates for a dare. Now they don\'t stop at the gate.',
  },
  spitter: {
    id: 'spitter', name: 'Biler', sprites: ['z_spitter'], hp: 100, speed: 26, dps: 4, cost: 3.5, minDay: 7,
    head: 0.16, width: 54, height: 124, spit: true, mass: 1.1, role: 'Lobs bile from range. Duck [S], or shoot the glob.',
    lore: 'Whatever was in the settling ponds, they drank it. It comes back up hot enough to blister paint.',
  },
  // ---- night specials: never in the random pool ----
  tunneler: {
    id: 'tunneler', name: 'Drag', sprites: ['z_crawler'], hp: 55, speed: 30, dps: 0, cost: 0.8, minDay: 999,
    head: 0.45, width: 90, height: 42, crawl: true, tunnel: true, special: true,
    lore: 'The storm drains run under Ferry Road to the river. Some of them came up the pipe.',
  },
  raider: {
    id: 'raider', name: 'County man', sprites: ['z_raider', 'z_raider2'], hp: 90, speed: 70, dps: 0, cost: 3, minDay: 999,
    head: 0.16, width: 46, height: 122, ranged: true, special: true,
    lore: 'Deputy jackets off the dead, and the habit of taking. The County wants what you have.',
  },
  bellwether: {
    id: 'bellwether', name: 'The Bellwether', sprites: ['z_bellwether'], hp: 1800, speed: 12, dps: 30, cost: 0, minDay: 999,
    head: 0.11, width: 84, height: 200, armor: 5, boss: true, toll: true, special: true,
    lore: 'Somebody rang the All Saints\' bell for forty minutes the night it began. Nobody would say who. Now you know.',
  },
};

// ---- pacing: no two bodies walk alike (docs/research/09-animation.md §Crowd audit) ----
/**
 * How a type covers ground around its def.speed:
 *   spread   each body's own pace, ±fraction (seeded by its id)
 *   stopP    a shambler stalls every stopP[0]..stopP[1] s (sways, sniffs, then goes on) ...
 *   stopW    ... for stopW[0]..stopW[1] s, easing down to a stand and back up
 *   base     cruising pace / def.speed (Deer cruise slower and bolt)
 *   dash     Deer: the bolt out of the pant, peak multiple of the cruise (decays over DASH_T)
 * Average speed stays def.speed (the stops are paid back by a slightly quicker walk), so the
 * balance tuned on def.speed holds.
 */
export interface Pace { spread: number; base?: number; stopP?: [number, number]; stopW?: [number, number]; dash?: number }
const PACE: Record<string, Pace> = {
  sleeper: { spread: 0.18, stopP: [7, 13], stopW: [0.8, 1.6] },
  deer: { spread: 0.1, base: 0.82, dash: 3 }, // cruise 0.82x, bolt to 3x: about +8% over a pant cycle
  drag: { spread: 0.22, stopP: [4, 7], stopW: [0.5, 1.1] },
  tunneler: { spread: 0.15 },
  pulper: { spread: 0.1, stopP: [9, 15], stopW: [1, 1.8] },
  crier: { spread: 0.1 },
  deputy: { spread: 0.1, stopP: [12, 20], stopW: [0.7, 1.2] },
  ferryman: { spread: 0.05 },
  leaper: { spread: 0.12 },
  spitter: { spread: 0.1 },
  raider: { spread: 0.08 },
  bellwether: { spread: 0 },
};
export const DASH_T = 0.8;
/** Per-body height spread, ± fraction (uniform): ±7% is about the spread of adult heights
 *  (sd ~4%, 1.62-1.86 m round a 1.74 m Sleeper); the made-to-order big ones vary less. */
export const sizeVar = (def: ZombieDef) => (def.boss ? 0.02 : def.id === 'ferryman' ? 0.04 : 0.07);
export function paceOf(def: ZombieDef): Pace & { base: number } { const p = PACE[def.id] ?? { spread: 0.1 };
  return { ...p, base: p.base ?? 1 }; }
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/**
 * Speed multiplier for one body at time t (its own clock, e.g. Zombie.phase): its own pace,
 * an occasional stall, and (Deer) the bolt `dash` s after a pant (dash counts down from DASH_T).
 */
export function paceMul(def: ZombieDef, id: number, t: number, dash = 0): number {
  const p = PACE[def.id];
  if (!p) return 1;
  let m = (p.base ?? 1) * (1 + p.spread * (hash(id) * 2 - 1));
  if (p.stopP && p.stopW) {
    const P = p.stopP[0] + (p.stopP[1] - p.stopP[0]) * hash(id + 0.37);
    const w = p.stopW[0] + (p.stopW[1] - p.stopW[0]) * hash(id + 0.71);
    const c = (t + P * hash(id + 0.13)) % P;
    // ease to a stand and back: 1 - min(1, 1.6 (1 - cos)/2) over the window (mean dip 0.6375 w)
    const stop = c < w ? Math.min(1, 0.8 * (1 - Math.cos((Math.PI * 2 * c) / w))) : 0;
    m *= (1 - stop) / (1 - (0.6375 * w) / P);
  }
  if (p.dash && dash > 0) m *= 1 + (p.dash - 1) * (dash / DASH_T) ** 1.5;
  return m;
}
