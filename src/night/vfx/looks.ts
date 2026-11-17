// What each gun looks like when it fires (docs/research/10-vfx.md §3): the muzzle flash recipe and the round in
// flight. Sizes are px at depth scale 1 (a survivor on the firestep), tuned against the 158 px survivor.
//
// Muzzle-flash anatomy (navweaps tech-090; Wikipedia "Muzzle flash"): a small white-hot PRIMARY flash at the
// muzzle; a reddish INTERMEDIATE disc a little way out where the gas meets its shock (Mach disc); the big
// yellow-orange SECONDARY flash where fuel-rich gas mixes with air and burns (rifles, shotguns, black powder);
// burning powder SPARKS; then SMOKE. Flash hiders (the AR's birdcage) break the plume into prongs and kill most
// of the secondary flash; brakes and the revolver's cylinder gap throw side jets; a suppressor leaves a puff.
import type { FireProfile } from '../../data/weapons';
import { WEAPONS } from '../../data/weapons';

export interface FlashSpec {
  /** white-hot core glow radius */
  core: number;
  /** forward plume length and thickness (0: none) */
  plume: number; plumeW: number;
  /** side petals: count, length, spread (rad, from the bore line) */
  petals: number; petalLen: number; petalA: number;
  /** front-view star burst radius (pistols, SMGs) */
  burst: number;
  /** secondary flash: fireball radius and how far out it blooms */
  ball: number; ballOff: number;
  /** intermediate (Mach) disc radius */
  disc: number;
  /** soft bloom radius */
  bloom: number;
  /** seconds the flash lives (2–5 frames) */
  life: number;
  /** unburnt powder sparks */
  sparks: number;
  /** smoke puffs, their size and colour */
  smoke: number; smokeSize: number; smokeCol: 'smoke' | 'powder' | 'dark' | 'flare' | 'steam';
  /** light: radius and colour ('r,g,b') */
  light: number; lightCol: string;
  /** a jet out of the cylinder gap / lock pan, this far behind the muzzle (revolver, muzzleloader) */
  gap?: number;
  /** backblast length (launchers) */
  back?: number;
  /** a warm wash over the whole scene for a frame (the big ones; off with Screen flashes) */
  wash: number;
  /** tint: 0 normal, 1 red (flare), 2 orange-rich (incendiary) */
  tint?: number;
  /** flame cone particles (dragon's breath) */
  cone?: number;
  /** two barrels side by side: the plume doubled this many px apart (the coach gun's both-barrels blast) */
  twin?: number;
}

export type RoundKind = 'bullet' | 'pellet' | 'slug' | 'ball' | 'arrow' | 'bolt' | 'nail' | 'rivet' | 'flare' | 'rocket' | 'dragon' | 'none';

export interface GunLook {
  id: string;
  flash: FlashSpec;
  round: RoundKind;
  /** visual speed of the round, px/s (a fraction of the real thing so the eye can catch it) */
  speed: number;
  /** every Nth round is a tracer (0: never) */
  tracerEvery: number;
  /** streak width */
  width: number;
  /** casings: what flies out of the port */
  casing: 'brass' | 'hull' | 'link' | 'steel' | null;
}

const F = (o: Partial<FlashSpec>): FlashSpec => ({
  core: 8, plume: 30, plumeW: 12, petals: 0, petalLen: 16, petalA: 0.8, burst: 0, ball: 0, ballOff: 0, disc: 0, bloom: 60,
  life: 0.05, sparks: 0, smoke: 1, smokeSize: 8, smokeCol: 'steam', light: 180, lightCol: '255,196,120', wash: 0, ...o,
});

export const FLASHES = {
  pistol: F({ core: 9, plume: 30, plumeW: 13, petals: 2, petalLen: 16, petalA: 0.9, burst: 20, disc: 5, bloom: 70, smoke: 1, smokeSize: 7, light: 200 }),
  m1911: F({ core: 10, plume: 34, plumeW: 15, petals: 2, petalLen: 18, petalA: 0.85, burst: 24, disc: 6, ball: 10, ballOff: 18, bloom: 80, smoke: 2, smokeSize: 8, light: 220, sparks: 2 }),
  revolver: F({ core: 11, plume: 42, plumeW: 16, petals: 2, petalLen: 20, petalA: 0.7, burst: 18, ball: 14, ballOff: 24, disc: 7, bloom: 90, sparks: 5, smoke: 2, smokeSize: 9, light: 240, gap: 22, life: 0.06 }),
  r22: F({ core: 5, plume: 15, plumeW: 7, disc: 0, bloom: 40, smoke: 1, smokeSize: 4, light: 100, life: 0.04 }),
  smg: F({ core: 8, plume: 26, plumeW: 11, petals: 2, petalLen: 14, petalA: 0.95, burst: 18, disc: 4, bloom: 60, smoke: 1, smokeSize: 6, light: 170, life: 0.045 }),
  ar: F({ core: 9, plume: 36, plumeW: 9, petals: 4, petalLen: 15, petalA: 0.32, disc: 6, bloom: 70, smoke: 1, smokeSize: 7, light: 190, life: 0.045 }),
  lmg: F({ core: 11, plume: 50, plumeW: 13, petals: 4, petalLen: 18, petalA: 0.36, disc: 8, bloom: 90, smoke: 1, smokeSize: 8, light: 220, life: 0.045 }),
  rifle: F({ core: 14, plume: 70, plumeW: 22, petals: 2, petalLen: 22, petalA: 0.55, ball: 22, ballOff: 40, disc: 10, bloom: 120, sparks: 4, smoke: 3, smokeSize: 12, light: 300, wash: 0.05, life: 0.06 }),
  marksman: F({ core: 15, plume: 78, plumeW: 22, petals: 4, petalLen: 24, petalA: 0.45, ball: 24, ballOff: 44, disc: 10, bloom: 130, sparks: 4, smoke: 3, smokeSize: 13, light: 310, wash: 0.06, life: 0.06 }),
  shotgun: F({ core: 16, plume: 52, plumeW: 34, petals: 4, petalLen: 22, petalA: 0.75, ball: 30, ballOff: 30, disc: 9, bloom: 130, sparks: 9, smoke: 4, smokeSize: 14, light: 300, wash: 0.06, life: 0.065 }),
  coach: F({ twin: 4, core: 20, plume: 70, plumeW: 44, petals: 6, petalLen: 28, petalA: 0.8, ball: 42, ballOff: 38, disc: 12, bloom: 170, sparks: 16, smoke: 7, smokeSize: 18, light: 380, wash: 0.1, life: 0.08 }),
  snake: F({ core: 11, plume: 34, plumeW: 24, petals: 2, petalLen: 16, petalA: 0.8, ball: 18, ballOff: 20, disc: 6, bloom: 90, sparks: 6, smoke: 3, smokeSize: 10, light: 230, life: 0.055 }),
  pipe: F({ core: 15, plume: 48, plumeW: 36, petals: 5, petalLen: 24, petalA: 1.0, ball: 30, ballOff: 26, disc: 8, bloom: 130, sparks: 22, smoke: 7, smokeSize: 15, smokeCol: 'dark', light: 300, wash: 0.07, life: 0.08 }),
  muzzle: F({ core: 18, plume: 84, plumeW: 34, petals: 2, petalLen: 26, petalA: 0.5, ball: 46, ballOff: 48, disc: 12, bloom: 180, sparks: 28, smoke: 18, smokeSize: 20, smokeCol: 'powder', light: 360, gap: 40, wash: 0.1, life: 0.1 }),
  suppressed: F({ core: 4, plume: 0, plumeW: 0, bloom: 26, smoke: 2, smokeSize: 6, smokeCol: 'steam', light: 60, life: 0.035 }),
  flare: F({ core: 10, plume: 30, plumeW: 16, ball: 14, ballOff: 18, bloom: 100, sparks: 10, smoke: 4, smokeSize: 10, smokeCol: 'flare', light: 260, lightCol: '255,90,80', tint: 1, life: 0.07 }),
  nail: F({ core: 3, plume: 8, plumeW: 6, bloom: 22, smoke: 1, smokeSize: 5, smokeCol: 'steam', light: 50, sparks: 1, life: 0.035 }),
  bow: F({ core: 0, plume: 0, plumeW: 0, bloom: 0, smoke: 0, light: 0, life: 0.01 }),
  law: F({ core: 16, plume: 34, plumeW: 30, ball: 26, ballOff: 22, bloom: 160, sparks: 12, smoke: 10, smokeSize: 18, light: 380, back: 130, wash: 0.1, life: 0.09 }),
  m79: F({ core: 8, plume: 18, plumeW: 22, ball: 14, ballOff: 12, bloom: 70, smoke: 4, smokeSize: 12, light: 170, life: 0.05 }),
  mortar: F({ core: 10, plume: 22, plumeW: 26, ball: 20, ballOff: 16, bloom: 100, sparks: 8, smoke: 8, smokeSize: 16, smokeCol: 'dark', light: 220, life: 0.07 }),
  dragon: F({ core: 18, plume: 60, plumeW: 40, petals: 4, petalLen: 26, petalA: 0.7, ball: 36, ballOff: 34, disc: 10, bloom: 170, sparks: 26, smoke: 5, smokeSize: 14, light: 360, lightCol: '255,150,60', tint: 2, wash: 0.09, life: 0.09, cone: 34 }),
} satisfies Record<string, FlashSpec>;
export type FlashId = keyof typeof FLASHES;

const L = (id: FlashId, round: RoundKind, speed: number, tracerEvery: number, width: number, casing: GunLook['casing']): GunLook => ({ id, flash: FLASHES[id], round, speed, tracerEvery, width, casing });

const BY_ID: Record<string, GunLook> = {
  service9: L('pistol', 'bullet', 5200, 0, 1.2, 'brass'),
  m1911: L('m1911', 'bullet', 4800, 0, 1.4, 'brass'),
  mp93: L('pistol', 'bullet', 5200, 0, 1.2, 'brass'),
  revolver: L('revolver', 'bullet', 5600, 0, 1.4, null),
  smg: L('smg', 'bullet', 5000, 0, 1.2, 'brass'),
  r22: L('r22', 'bullet', 4400, 0, 0.9, 'brass'),
  pump: L('shotgun', 'pellet', 4200, 0, 1.1, 'hull'),
  autoshot: L('shotgun', 'pellet', 4200, 0, 1.1, 'hull'),
  coach: L('coach', 'pellet', 4300, 0, 1.2, null),
  snake410: L('snake', 'pellet', 3800, 0, 1, null),
  pipe: L('pipe', 'pellet', 3600, 0, 1.2, null),
  hunting: L('rifle', 'bullet', 9500, 0, 1.6, 'brass'),
  lever: L('rifle', 'bullet', 8000, 0, 1.6, 'brass'),
  scoped: L('marksman', 'bullet', 10500, 0, 1.7, 'brass'),
  muzzle: L('muzzle', 'ball', 3600, 0, 2, null),
  ar15: L('ar', 'bullet', 9000, 0, 1.4, 'brass'),
  carbine: L('ar', 'bullet', 8800, 5, 1.4, 'brass'),
  lmg: L('lmg', 'bullet', 8600, 4, 1.6, 'link'),
  compound: L('bow', 'arrow', 2300, 0, 1, null),
  crossbow: L('bow', 'bolt', 2700, 0, 1, null),
  flaregun: L('flare', 'flare', 1100, 0, 3, null),
  nailer: L('nail', 'nail', 2600, 0, 1, null),
  rivet: L('nail', 'rivet', 2400, 0, 1.2, null),
  law: L('law', 'rocket', 2600, 0, 3, null),
  m79: L('m79', 'none', 0, 0, 0, null),
  pipemortar: L('mortar', 'none', 0, 0, 0, null),
};
const BY_CLS: Record<string, GunLook> = {
  handgun: BY_ID.service9, smg: BY_ID.smg, shotgun: BY_ID.pump, rifle: BY_ID.hunting, assault: BY_ID.ar15, marksman: BY_ID.scoped,
  heavy: BY_ID.lmg, bow: BY_ID.compound, improvised: BY_ID.nailer, launcher: BY_ID.law,
};

const cache = new Map<string, GunLook>();
/**
 * The look for a gun. `defId` is trusted only when its class matches the profile's (an emplacement's crew carries
 * their own gun, but fires the mount's profile). Ammo changes the round: slugs, dragon's breath, flares, fire bolts.
 */
export function gunLook(defId: string | undefined, p: FireProfile | undefined, suppressed = false): GunLook {
  const d = defId ? WEAPONS[defId] : undefined;
  const id = d && (!p || d.cls === p.cls) ? defId! : '';
  const key = `${id}|${p?.cls ?? ''}|${p?.pellets ?? 0}|${p?.incendiary ? 1 : 0}|${p?.flare ? 1 : 0}|${suppressed ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // no gun and no profile: the battle's own nail turret
  let L0 = BY_ID[id] ?? (p ? BY_CLS[p.cls] : undefined) ?? (defId ? BY_ID.service9 : BY_ID.nailer);
  if (p) {
    const shotgun = L0.round === 'pellet';
    if (shotgun && p.incendiary && p.pellets > 1) L0 = { ...L0, flash: FLASHES.dragon, round: 'dragon', speed: 2600, width: 1.6 };
    else if (shotgun && p.pellets <= 1) L0 = { ...L0, round: 'slug', speed: 5200, width: 2 };
    else if (p.flare && L0.round !== 'flare') L0 = { ...L0, round: 'flare', speed: 1100, flash: FLASHES.flare };
    else if ((L0.round === 'arrow' || L0.round === 'bolt') && p.incendiary) L0 = { ...L0, id: 'firebolt' };
  }
  if (suppressed) L0 = { ...L0, flash: FLASHES.suppressed, tracerEvery: 0 };
  cache.set(key, L0);
  return L0;
}
