// Hit reactions for the Turned: how hard a hit lands against how heavy the body is.
//
// Every hit (battle.damage: a bullet, the pellets of one shell summed, a swing; battle.blast:
// a blast) carries an impulse J. Against the archetype's mass it picks a tier:
//   flinch     the head / torso snaps (the rig's additive hit clip; nothing else changes)
//   stagger    a step or two back, arms out: no walking, no wall damage for a beat (z.stun)
//   stumble    down on a knee or flat on the ground for ~0.8-1.6 s (z.down), then up again;
//              can't attack, takes FINISH_MUL damage while down
//   knockdown  thrown flat and slid back (blasts, slugs, the big rifles on small Turned)
// Leg hits make falls likelier, head hits snap the head back but never knock a body over.
// Per-instance randomness and a diminishing return on repeats keep a pinned body from being
// stun-locked; Ferryman / Bellwether mostly just flinch (the Ferryman's knee and double-stagger
// knockdown stay in battle.ts ferryStagger).
//
// Gameplay state lives on the Zombie (stun, down, slide, react) so Classic drawing reads it as
// well as the rigs (night/actors.ts plays the clips). Tune with IMPACT below (exposed for tests
// as globalThis.__impact).
import type { Zombie } from './battle';

export type Tier = 'flinch' | 'stagger' | 'stumble' | 'knockdown';
export type FallKind = 'knee' | 'back' | 'front' | 'tumble' | 'slide';
export interface Reaction { tier: Tier; kind: FallKind; t0: number; dur: number; dir: number; seed: number }
export interface HitIn {
  /** damage of this hit before head / weakspot multipliers (per pellet) */
  dmg: number;
  /** fireProfile / melee knock (per pellet for shot) */
  knock: number;
  zone: 'head' | 'torso' | 'arm' | 'leg';
  pellet?: boolean;
  melee?: boolean;
  /** a blast's push (knock × falloff): J gets this on top */
  blast?: number;
  /** +1: thrown toward +x (away from the wall), -1 toward the wall */
  dir: number;
}

export const IMPACT = {
  /** body mass by ZombieDef id (styles.ts ragdoll masses, a little evened out) */
  mass: { sleeper: 1, deer: 0.8, drag: 0.7, tunneler: 0.8, pulper: 1.8, crier: 0.9, deputy: 1.35, ferryman: 3.2, leaper: 1.1, spitter: 1.2, raider: 1, bellwether: 4 } as Record<string, number>,
  /** J per unit mass at which each tier starts. stagger 62 -> 85 (balance.md §11): at 62 a guard's
   *  revolver round or one shell of buckshot staggered a Sleeper most times, the staggered bodies were
   *  overtaken by the ones behind (§10 walkLane) and the crowd reached the planks bunched: day-3
   *  houses with a passive leader fell 4 nights in 14. At 85 those hits flinch; rifles, slugs and the
   *  player's aimed shots still stagger. */
  at: { flinch: 8, stagger: 85, stumble: 150, knockdown: 290 },
  /** J = dmg × (DMG0 + knock / KNOCK) + knock × KNOCK_ONCE (the knock term once per shell) */
  DMG0: 0.5, KNOCK: 25, KNOCK_ONCE: 1.5,
  /** blasts: J += push × BLAST */
  BLAST: 7,
  /** per-instance roll on J: × (1 - JIT .. 1 + JIT) */
  JIT: 0.28,
  /** each reaction (stagger or more) in the last REPEAT_T s scales J by REPEAT */
  REPEAT: 0.62, REPEAT_T: 2.2,
  /** zone weights for the fall tiers (legs go out, head shots snap back) */
  zone: { head: 0.85, torso: 1, arm: 0.8, leg: 1.35 } as Record<string, number>,
  /** stun / down seconds [min, max] (scaled within by how far past the threshold the hit is) */
  stagger: [0.28, 0.55], stumble: [0.8, 1.5], knockdown: [1.3, 2.1],
  /** extra slide (px) on top of the shot's own shove, by tier [min, max] */
  push: { stagger: [6, 22], stumble: [12, 32], knockdown: [30, 70] } as Record<string, [number, number]>,
  /** damage taken while down */
  FINISH_MUL: 1.3,
  /** the heaviest tier each archetype can reach (blasts / the knee handle the rest) */
  cap: { ferryman: 'stagger', bellwether: 'flinch', raider: 'stagger' } as Record<string, Tier>,
  /** J/mass a Ferryman needs before a single hit can floor it */
  BIG_ONLY: 520,
};
(globalThis as unknown as { __impact: unknown }).__impact = IMPACT;

const ORDER: Tier[] = ['flinch', 'stagger', 'stumble', 'knockdown'];
const rank = (t: Tier | null) => (t ? ORDER.indexOf(t) : -1);
const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.max(0, Math.min(1, u));

/** Per-body hit accumulator (the pellets of one shell land in the same frame). */
interface Acc { t: number; J: number; tier: Tier | null; zone: HitIn['zone']; legs: number; push: number }
const accs = new WeakMap<Zombie, Acc>();
const recent = new WeakMap<Zombie, number[]>();

export function impulseOf(h: HitIn, first: boolean): number {
  const I = IMPACT;
  let J = h.dmg * (I.DMG0 + h.knock / I.KNOCK) + (first ? h.knock * I.KNOCK_ONCE : 0);
  if (h.melee) J *= 1.15; // a swing pushes through
  if (h.blast) J += h.blast * I.BLAST;
  return J;
}

/**
 * Add a hit to this frame's impulse on the body and return the reaction it now earns (only
 * when it is heavier than what this frame already gave it), with the gameplay applied:
 * z.stun / z.down / z.slide / z.react. rnd() is the battle's RNG.
 */
export function react(z: Zombie, h: HitIn, now: number, rnd: () => number): Reaction | null {
  if (z.state === 'dying' || z.hp <= 0) return null;
  const I = IMPACT;
  let a = accs.get(z);
  const first = !a || a.t !== now;
  if (first) { a = { t: now, J: 0, tier: null, zone: h.zone, legs: 0, push: 0 }; accs.set(z, a); }
  const acc = a!;
  const J = impulseOf(h, first);
  acc.J += J;
  if (h.zone === 'leg') acc.legs += J;
  if (h.zone === 'head' || first) acc.zone = h.zone === 'head' ? 'head' : acc.zone;
  // the shell's roll is made once (first pellet) so a load of buckshot doesn't re-roll per pellet
  const id = z.def.id;
  const mass = I.mass[id] ?? 1;
  const hist = (recent.get(z) ?? []).filter((t) => now - t < I.REPEAT_T);
  const rep = Math.pow(I.REPEAT, hist.length);
  const jit = 1 + (((z.id * 9301 + Math.floor(now * 7)) % 997) / 997 * 2 - 1) * I.JIT;
  const zoneW = acc.legs > acc.J * 0.5 ? I.zone.leg : I.zone[acc.zone] ?? 1;
  const r = (acc.J * jit * rep) / mass;
  let tier: Tier | null = r >= I.at.knockdown / zoneW ? 'knockdown' : r >= I.at.stumble / zoneW ? 'stumble' : r >= I.at.stagger ? 'stagger' : r >= I.at.flinch ? 'flinch' : null;
  // head hits snap the head back: never a fall
  if (acc.zone === 'head' && rank(tier) > rank('stagger')) tier = 'stagger';
  const cap = I.cap[id];
  if (cap && rank(tier) > rank(cap)) tier = id === 'ferryman' && (h.blast || r * (z.crippled ? 1.6 : 1) >= I.BIG_ONLY) ? 'knockdown' : cap;
  if (z.def.boss && rank(tier) > rank('flinch')) tier = 'flinch';
  // airborne / climbing out of a drain / in cover: a flinch at most
  if (z.leap || (z.emerge !== undefined && z.emerge > 0) || z.state === 'cover') tier = tier ? 'flinch' : null;
  if (rank(tier) <= rank(acc.tier)) return null;
  acc.tier = tier;
  if (!tier) return null;
  const crawler = !!(z.def.crawl || z.crippled) && id !== 'ferryman';
  const dir = h.dir || 1;
  const over = r / (I.at[tier] || 1);
  let kind: FallKind = 'back';
  let dur = 0;
  if (tier === 'stagger') {
    dur = lerp(I.stagger[0], I.stagger[1], over - 1);
    z.stun = Math.max(z.stun, dur);
  } else if (tier === 'stumble' || tier === 'knockdown') {
    const legs = acc.legs > acc.J * 0.5;
    const roll = rnd();
    if (crawler) kind = 'slide';
    else if (id === 'deer' && tier === 'knockdown') kind = 'tumble';
    else if (tier === 'stumble') kind = legs ? (roll < 0.6 ? 'knee' : 'front') : roll < 0.5 ? 'knee' : roll < 0.8 ? 'back' : 'front';
    else kind = h.blast ? (roll < 0.75 ? 'back' : 'tumble') : legs ? 'front' : roll < 0.8 ? 'back' : 'front';
    const span = tier === 'stumble' ? I.stumble : I.knockdown;
    dur = lerp(span[0], span[1], (over - 1) * 0.8 + rnd() * 0.35) * (kind === 'knee' ? 0.75 : 1) * (crawler ? 0.5 : 1);
    if (crawler) z.stun = Math.max(z.stun, dur); // a Drag is already down: it is shoved and lies still
    else z.down = Math.max(z.down ?? 0, dur);
    if (z.state === 'climb') { z.climb = undefined; z.state = 'walk'; }
  } else dur = 0.3;
  // the slide: on top of the shot's own shove, eased out over a few frames (battle update)
  const p = I.push[tier];
  if (p && (z.state === 'walk' || z.state === 'wall') && !z.def.boss) {
    const want = lerp(p[0], p[1], over - 1 + rnd() * 0.3) * (id === 'ferryman' ? 0.4 : 1) * (crawler ? 1.3 : 1) / Math.sqrt(mass);
    const add = Math.max(0, want - acc.push);
    acc.push += add;
    // a Deer's momentum carries it on toward the wall as it tumbles (dir -1 = toward the wall)
    const d = kind === 'tumble' && id === 'deer' && !h.blast ? -dir * 0.6 : dir;
    z.slide = (z.slide ?? 0) + d * add * 5;
    if (z.state === 'wall' && rank(tier) >= rank('stagger')) z.state = 'walk';
  }
  if (rank(tier) >= rank('stagger')) { hist.push(now); recent.set(z, hist); }
  const rx: Reaction = { tier, kind, t0: now, dur, dir, seed: Math.floor(rnd() * 1e6) };
  if (rank(tier) >= rank('stagger')) z.react = rx;
  return rx;
}

/** The knockback slide eases out (battle update, every Turned, every step). */
export function slideStep(z: Zombie, dt: number, maxX: number) {
  const v = z.slide ?? 0;
  if (!v) return;
  z.x = Math.min(maxX, z.x + v * dt);
  const nv = v * Math.exp(-dt * 7);
  z.slide = Math.abs(nv) < 4 ? 0 : nv;
}

/**
 * Classic (single image) approximation of a reaction: tilt / sink / squash while staggered or
 * down, then rising back over the last third. null: no override.
 */
export function classicPose(z: Zombie, h: number, now: number): { rot: number; dy: number; sy: number } | null {
  const rx = z.react;
  const down = z.down ?? 0;
  if (!rx || now - rx.t0 > rx.dur + 0.05) {
    if (down > 0) return { rot: 1.05, dy: h * 0.12, sy: 1 }; // the Ferryman's knockdown
    return null;
  }
  const u = (now - rx.t0) / Math.max(0.05, rx.dur);
  // in over the first 18%, held, back up over the last 30%
  const k = Math.min(1, u / 0.18) * Math.min(1, (1 - u) / 0.3);
  if (rx.tier === 'stagger') return { rot: (0.12 + Math.sin(u * 14) * 0.05) * k, dy: 0, sy: 1 };
  switch (rx.kind) {
    case 'knee': return { rot: 0.1 * k, dy: 0, sy: 1 - 0.28 * k };
    case 'front': return { rot: -1.1 * k, dy: h * 0.14 * k, sy: 1 - 0.05 * k };
    case 'slide': return { rot: 0, dy: 0, sy: 1 };
    default: return { rot: 1.15 * k, dy: h * 0.13 * k, sy: 1 };
  }
}
