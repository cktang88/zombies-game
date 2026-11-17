// Gun recipes: each weapon family is a stack of layers (see docs/research/07-gun-audio.md).
//
//   crack  (transient)   high-passed noise click + square blip, 3–8 ms
//   body                 low-passed noise, cutoff sweeping bright → dark, optional grit
//   boom                 dark brown-noise bloom under the body (big bores)
//   sub                  sine thump falling from ~2.6× to 1× its pitch
//   mech                 action noises timed after the shot (bolt, pump, lever, slide)
//   extra                bespoke layers (bow string, flare fizz, rocket motor, powder hiss)
//   rev / echo           sends to the shared street reverb and the slap-back echo
//
// `level` is the target loudness (RMS of the first 150 ms after rendering), so the
// family balance is set here in one column, independent of how the layers add up.

import { Synth } from './engine';

export type GunKind =
  | 'pistol' | 'pistol45' | 'magnum' | 'burst' | 'smg' | 'rimfire'
  | 'pump' | 'double' | 'autoshot' | 'shotgun410' | 'pipe'
  | 'boltRifle' | 'lever' | 'marksman' | 'muzzleloader'
  | 'ar' | 'carbine' | 'lmg'
  | 'bow' | 'crossbow' | 'flare' | 'nailer' | 'rivet'
  | 'rocket' | 'grenade';

/** [at, freq, level, dur?, q?, ring partials?] */
export type Mech = [number, number, number, number?, number?, number[]?];

export interface GunRecipe {
  level: number;
  len: number;
  crack: number; crackHz: number; crackDur: number; doubleCrack?: boolean;
  body: number; bodyHi: number; bodyLo: number; bodyDur: number; bodyQ: number; bodyAt: number; grit: number;
  boom: number; boomHz: number; boomDur: number;
  sub: number; subHz: number; subDur: number;
  mech: Mech[];
  rev: number; echo: number; duck: number;
  phut?: number;
  extra?: (s: Synth, j: Jitter) => void;
}
export interface Jitter { p: number; fm: number; lv: () => number; tj: () => number }

const BASE: GunRecipe = {
  level: 0.15, len: 0.9,
  crack: 0.6, crackHz: 3000, crackDur: 0.012,
  body: 1, bodyHi: 3500, bodyLo: 450, bodyDur: 0.35, bodyQ: 0.7, bodyAt: 0.0015, grit: 0,
  boom: 0, boomHz: 260, boomDur: 0.6,
  sub: 0.4, subHz: 70, subDur: 0.25,
  mech: [],
  rev: 0.25, echo: 0.15, duck: 0.2,
};
const R = (o: Partial<GunRecipe>): GunRecipe => ({ ...BASE, ...o });

// --- bespoke layers ---------------------------------------------------------
function bowString(s: Synth, j: Jitter, f: number, v: number, dur: number) {
  s.tone({ f: f * 1.08 * j.p, f2: f * j.p, sweep: 0.03, dur, v, type: 'triangle', lp: 900 });
  s.tone({ f: f * 2.01 * j.p, dur: dur * 0.6, v: v * 0.3, type: 'sine' });
  s.noise({ dur: 0.04, v: v * 0.9, type: 'bandpass', f: 900 * j.fm, q: 1.2, attack: 0.0005 }); // string slap
}
function whoosh(s: Synth, at: number, dur: number, v: number, f0: number, f1: number) {
  s.noise({ at, dur, v, type: 'bandpass', f: f0, f2: f1, q: 1.4, attack: dur * 0.25 });
}
function powderHiss(s: Synth) {
  s.noise({ at: 0.06, dur: 1.3, v: 0.1, type: 'bandpass', f: 3200, f2: 1800, q: 0.6, attack: 0.08 });
  // crackle: sparse clicks thinning out
  for (let i = 0; i < 26; i++) {
    const at = 0.08 + Math.pow(Math.random(), 1.8) * 1.2;
    s.tick(at, 2500 + Math.random() * 3500, 0.08 + Math.random() * 0.12, 0.006, 3);
  }
}

// --- the families -----------------------------------------------------------
export const GUNS: Record<GunKind, GunRecipe> = {
  // handguns: crack-forward, short bodies, a slide clack riding the shot
  pistol: R({ level: 0.15, crack: 0.75, crackHz: 3200, body: 1, bodyHi: 3800, bodyLo: 500, bodyDur: 0.3, sub: 0.35, subHz: 88, subDur: 0.18,
    mech: [[0.012, 2400, 0.32, 0.03, 3, [3100, 4700]]], rev: 0.22, echo: 0.15, duck: 0.15, len: 0.8 }),
  pistol45: R({ level: 0.17, crack: 0.7, crackHz: 2800, body: 1.1, bodyHi: 3000, bodyLo: 380, bodyDur: 0.38, sub: 0.5, subHz: 72, subDur: 0.22, boom: 0.25, boomDur: 0.4,
    mech: [[0.014, 2100, 0.34, 0.035, 3, [2700, 4200]]], rev: 0.26, echo: 0.2, duck: 0.22, len: 0.9 }),
  magnum: R({ level: 0.2, crack: 0.95, crackHz: 3600, crackDur: 0.014, body: 1.25, bodyHi: 4400, bodyLo: 400, bodyDur: 0.55, grit: 0.3, boom: 0.45, boomHz: 300, boomDur: 0.6,
    sub: 0.6, subHz: 66, subDur: 0.3, mech: [], rev: 0.38, echo: 0.3, duck: 0.35, len: 1.2 }),
  burst: R({ level: 0.14, crack: 0.7, crackHz: 3400, body: 0.95, bodyHi: 4000, bodyLo: 650, bodyDur: 0.22, sub: 0.3, subHz: 92, subDur: 0.13,
    mech: [[0.01, 2600, 0.25, 0.025, 4]], rev: 0.17, echo: 0.1, duck: 0.12, len: 0.6 }),
  smg: R({ level: 0.11, crack: 0.55, crackHz: 3300, body: 0.9, bodyHi: 3500, bodyLo: 700, bodyDur: 0.2, sub: 0.3, subHz: 95, subDur: 0.12,
    mech: [[0.009, 1800, 0.28, 0.03, 3]], rev: 0.14, echo: 0.08, duck: 0.08, len: 0.55 }),
  rimfire: R({ level: 0.07, crack: 0.6, crackHz: 4200, crackDur: 0.008, body: 0.7, bodyHi: 5200, bodyLo: 1300, bodyDur: 0.12, sub: 0.12, subHz: 140, subDur: 0.07,
    mech: [[0.01, 3600, 0.18, 0.015, 5]], rev: 0.1, echo: 0.1, duck: 0, len: 0.5 }),

  // shotguns: dark, gritty, long bodies and a big sub; the action is the second half of the sound
  pump: R({ level: 0.22, crack: 0.7, crackHz: 2600, body: 1.3, bodyHi: 2600, bodyLo: 260, bodyDur: 0.75, bodyQ: 0.6, grit: 0.5, boom: 0.6, boomHz: 250, boomDur: 0.9,
    sub: 0.85, subHz: 52, subDur: 0.4, rev: 0.42, echo: 0.32, duck: 0.45, len: 1.3,
    mech: [[0.3, 1300, 0.6, 0.07, 2, [2200, 3500]], [0.43, 1650, 0.7, 0.06, 2.5, [2600, 3900]]] }),
  double: R({ level: 0.25, crack: 0.8, crackHz: 2400, crackDur: 0.014, doubleCrack: true, body: 1.6, bodyHi: 2500, bodyLo: 220, bodyDur: 0.9, bodyQ: 0.6, grit: 0.6,
    boom: 0.9, boomHz: 230, boomDur: 1.1, sub: 1, subHz: 46, subDur: 0.5, rev: 0.5, echo: 0.42, duck: 0.6, len: 1.6, mech: [] }),
  autoshot: R({ level: 0.2, crack: 0.7, crackHz: 2700, body: 1.25, bodyHi: 2800, bodyLo: 300, bodyDur: 0.6, bodyQ: 0.6, grit: 0.45, boom: 0.5, boomHz: 260, boomDur: 0.7,
    sub: 0.75, subHz: 55, subDur: 0.32, rev: 0.36, echo: 0.28, duck: 0.4, len: 1.0,
    mech: [[0.016, 1500, 0.45, 0.04, 2.5, [2400]]] }),
  shotgun410: R({ level: 0.14, crack: 0.6, crackHz: 3000, body: 0.95, bodyHi: 3200, bodyLo: 450, bodyDur: 0.42, grit: 0.25, boom: 0.2, boomDur: 0.5,
    sub: 0.4, subHz: 72, subDur: 0.22, rev: 0.28, echo: 0.2, duck: 0.2, len: 0.9, mech: [] }),
  pipe: R({ level: 0.21, crack: 0.75, crackHz: 2300, body: 1.35, bodyHi: 2400, bodyLo: 240, bodyDur: 0.75, bodyQ: 0.8, grit: 0.85, boom: 0.6, boomHz: 240, boomDur: 0.85,
    sub: 0.8, subHz: 50, subDur: 0.4, rev: 0.4, echo: 0.3, duck: 0.45, len: 1.3,
    mech: [[0.004, 1100, 0.45, 0.05, 2, [880, 1430, 2310]]] }), // the pipes slamming together

  // full-power rifles: the hardest crack, a long rolling body and the biggest echo
  boltRifle: R({ level: 0.22, crack: 1, crackHz: 2800, crackDur: 0.014, body: 1.3, bodyHi: 4500, bodyLo: 300, bodyDur: 0.7, grit: 0.35, boom: 0.6, boomHz: 220, boomDur: 1.0,
    sub: 0.7, subHz: 55, subDur: 0.38, rev: 0.5, echo: 0.48, duck: 0.5, len: 1.4,
    mech: [[0.48, 2000, 0.32, 0.03, 4], [0.55, 1200, 0.42, 0.07, 2, [2800, 4100]], [0.7, 1500, 0.4, 0.06, 2.5], [0.79, 2400, 0.45, 0.03, 4, [3300]]] }),
  lever: R({ level: 0.2, crack: 0.9, crackHz: 3000, body: 1.2, bodyHi: 4000, bodyLo: 320, bodyDur: 0.6, grit: 0.3, boom: 0.45, boomHz: 240, boomDur: 0.8,
    sub: 0.6, subHz: 58, subDur: 0.32, rev: 0.45, echo: 0.42, duck: 0.45, len: 1.1,
    mech: [[0.26, 1400, 0.45, 0.05, 2.5, [2500]], [0.37, 1800, 0.5, 0.04, 3, [3200, 4600]]] }),
  marksman: R({ level: 0.23, crack: 1.1, crackHz: 3000, crackDur: 0.016, body: 1.3, bodyHi: 5000, bodyLo: 320, bodyDur: 0.8, grit: 0.35, boom: 0.6, boomHz: 210, boomDur: 1.1,
    sub: 0.75, subHz: 52, subDur: 0.4, rev: 0.55, echo: 0.52, duck: 0.55, len: 1.6,
    mech: [[0.6, 2000, 0.3, 0.03, 4], [0.67, 1200, 0.4, 0.07, 2, [2800, 4100]], [0.84, 1500, 0.38, 0.06, 2.5], [0.93, 2400, 0.42, 0.03, 4, [3300]]] }),
  muzzleloader: R({ level: 0.26, crack: 0.5, crackHz: 4500, crackDur: 0.006, body: 1.6, bodyHi: 2200, bodyLo: 160, bodyDur: 1.3, bodyQ: 0.5, bodyAt: 0.028, grit: 0.4,
    boom: 1, boomHz: 150, boomDur: 1.6, sub: 1, subHz: 42, subDur: 0.7, rev: 0.6, echo: 0.55, duck: 0.7, len: 2.1, mech: [], extra: powderHiss }),

  // 5.56: tight, bright, quick; the auto guns get a little less body so streams stay under the big guns
  ar: R({ level: 0.16, crack: 0.9, crackHz: 3300, body: 1.1, bodyHi: 4800, bodyLo: 600, bodyDur: 0.32, sub: 0.45, subHz: 76, subDur: 0.2,
    mech: [[0.01, 1900, 0.3, 0.03, 3, [1900, 3050]]], rev: 0.35, echo: 0.3, duck: 0.25, len: 0.9 }),
  carbine: R({ level: 0.15, crack: 0.85, crackHz: 3300, body: 1.05, bodyHi: 4500, bodyLo: 620, bodyDur: 0.28, sub: 0.45, subHz: 78, subDur: 0.18,
    mech: [[0.009, 1900, 0.28, 0.03, 3, [1950]]], rev: 0.3, echo: 0.24, duck: 0.18, len: 0.75 }),
  lmg: R({ level: 0.13, crack: 0.8, crackHz: 3000, body: 1.1, bodyHi: 4000, bodyLo: 500, bodyDur: 0.3, grit: 0.2, sub: 0.55, subHz: 68, subDur: 0.2,
    mech: [[0.018, 3500, 0.22, 0.04, 6], [0.03, 2200, 0.2, 0.025, 4]], rev: 0.3, echo: 0.22, duck: 0.14, len: 0.7 }),

  // quiet & strange
  bow: R({ level: 0.05, crack: 0, body: 0, sub: 0, rev: 0.1, echo: 0.04, duck: 0, len: 0.6,
    extra: (s, j) => { bowString(s, j, 96, 0.5, 0.35); whoosh(s, 0.02, 0.32, 0.3, 1900, 600); } }),
  crossbow: R({ level: 0.09, crack: 0.15, crackHz: 3000, body: 0.6, bodyHi: 1100, bodyLo: 300, bodyDur: 0.12, grit: 0.4, sub: 0.7, subHz: 60, subDur: 0.12,
    mech: [[0, 3000, 0.25, 0.012, 5]], rev: 0.15, echo: 0.08, duck: 0.05, len: 0.6,
    extra: (s, j) => { bowString(s, j, 140, 0.4, 0.16); whoosh(s, 0.015, 0.25, 0.25, 2200, 800); } }),
  flare: R({ level: 0.1, crack: 0.25, crackHz: 2500, body: 0.8, bodyHi: 1500, bodyLo: 300, bodyDur: 0.22, bodyQ: 1.6, sub: 0.35, subHz: 110, subDur: 0.12, rev: 0.3, echo: 0.2, duck: 0.1, len: 1.9,
    extra: (s, j) => {
      s.noise({ at: 0.04, dur: 1.4, v: 0.14, type: 'highpass', f: 2800 * j.fm, q: 0.5, attack: 0.05, hold: 0.25, grit: 0.5 });
      s.tone({ at: 0.05, f: 2300 * j.p, f2: 1500 * j.p, dur: 0.9, v: 0.025, type: 'sine', attack: 0.05 });
    } }),
  nailer: R({ level: 0.06, crack: 0.3, crackHz: 5000, crackDur: 0.006, body: 0.5, bodyHi: 6500, bodyLo: 2200, bodyDur: 0.12, bodyQ: 0.5, sub: 0.15, subHz: 180, subDur: 0.05,
    mech: [[0.002, 2600, 0.6, 0.03, 5, [4200, 6100]]], rev: 0.06, echo: 0.04, duck: 0, len: 0.35 }),
  rivet: R({ level: 0.1, crack: 0.25, crackHz: 4000, body: 0.6, bodyHi: 2500, bodyLo: 800, bodyDur: 0.15, sub: 0.6, subHz: 72, subDur: 0.12,
    mech: [[0.003, 1500, 0.4, 0.04, 3, [1700, 2650, 3900]]], rev: 0.1, echo: 0.08, duck: 0.05, len: 0.6,
    extra: (s) => s.noise({ at: 0.04, dur: 0.2, v: 0.12, type: 'highpass', f: 4000, attack: 0.01 }) }), // compressor hiss
  rocket: R({ level: 0.24, crack: 0.6, crackHz: 2200, body: 1.2, bodyHi: 2000, bodyLo: 200, bodyDur: 0.8, grit: 0.5, boom: 0.8, boomHz: 180, boomDur: 1.3,
    sub: 0.7, subHz: 45, subDur: 0.6, rev: 0.6, echo: 0.5, duck: 0.7, len: 2.0,
    extra: (s, j) => s.noise({ at: 0.03, dur: 1.4, v: 0.45, type: 'bandpass', f: 2400 * j.fm, f2: 650 * j.fm, q: 1.1, attack: 0.04, hold: 0.25, grit: 0.4 }) }),
  grenade: R({ level: 0.15, crack: 0.1, crackHz: 2000, body: 0.5, bodyHi: 900, bodyLo: 200, bodyDur: 0.2, sub: 1, subHz: 62, subDur: 0.24, rev: 0.25, echo: 0.2, duck: 0.2, len: 0.8,
    mech: [[0.004, 700, 0.3, 0.06, 3, [420, 690]]] }),
};

export const GUN_KINDS = Object.keys(GUNS) as GunKind[];

/** Friendly aliases accepted by sfx.gun(). */
export const GUN_ALIASES: Record<string, GunKind> = {
  '22': 'rimfire', '410': 'shotgun410', snake: 'shotgun410', shotgun: 'pump', coach: 'double',
  'rifle-bolt': 'boltRifle', bolt: 'boltRifle', hunting: 'boltRifle', scoped: 'marksman', sniper: 'marksman',
  muzzle: 'muzzleloader', assault: 'ar', ar15: 'ar', auto: 'carbine', machinegun: 'lmg', compound: 'bow',
  flaregun: 'flare', nail: 'nailer', rpg: 'rocket', launcher: 'grenade', '45': 'pistol45', m1911: 'pistol45',
  revolver: 'magnum', '357': 'magnum', service9: 'pistol', mp93: 'burst',
};

/** Recipe variants. */
export function suppressed(r: GunRecipe): GunRecipe {
  return {
    ...r,
    level: r.level * 0.42,
    crack: r.crack * 0.12, crackHz: r.crackHz * 1.5,
    body: r.body * 0.5, bodyHi: Math.min(r.bodyHi, 1100), bodyDur: r.bodyDur * 0.45, grit: 0,
    boom: r.boom * 0.2, sub: r.sub * 0.4, subDur: r.subDur * 0.6,
    mech: r.mech.map((m) => [m[0], m[1], m[2] * 1.8, m[3], m[4], m[5]] as Mech), // the action is what you hear now
    rev: r.rev * 0.3, echo: r.echo * 0.12, duck: r.duck * 0.2,
    phut: 0.55,
  };
}
export function distant(r: GunRecipe): GunRecipe {
  return {
    ...r,
    crack: r.crack * 0.15, body: r.body * 1.1, bodyHi: r.bodyHi * 0.55,
    boom: r.boom * 1.2, sub: r.sub * 0.6,
    mech: r.mech.map((m) => [m[0], m[1], m[2] * 0.25, m[3], m[4], undefined] as Mech),
    rev: r.rev * 1.4, echo: r.echo * 1.6, duck: r.duck * 0.25,
  };
}

/** Per-take variation. Pass (i, n) to stratify takes so round-robin variants always differ. */
export function jitter(i = 0, n = 1): Jitter {
  const u = (i + Math.random()) / n;              // 0..1, one bin per take
  const w = (((i * 2 + 1) % n) + Math.random()) / n; // a different ordering for the filter
  return {
    p: 0.96 + u * 0.08,
    fm: 0.88 + w * 0.24,
    lv: () => 0.9 + Math.random() * 0.2,
    tj: () => 0.94 + Math.random() * 0.12,
  };
}

/** Lay one shot of recipe r into the synth. */
export function synthGun(s: Synth, r: GunRecipe, j: Jitter, action = true) {
  const { p, fm, lv } = j;
  if (r.crack > 0) {
    s.noise({ dur: r.crackDur, v: r.crack * lv(), type: 'highpass', f: r.crackHz * fm, q: 0.5, attack: 0.0004 });
    s.tone({ f: 1700 * p, dur: 0.005, v: r.crack * 0.22 * lv(), type: 'square', attack: 0.0003 });
    if (r.doubleCrack) s.noise({ at: 0.0045, dur: r.crackDur, v: r.crack * 0.8 * lv(), type: 'highpass', f: r.crackHz * fm * 0.9, q: 0.5, attack: 0.0004 });
  }
  if (r.body > 0) {
    s.noise({ at: r.bodyAt, dur: r.bodyDur, v: r.body * lv(), type: 'lowpass', f: r.bodyHi * fm, f2: r.bodyLo * fm, sweep: r.bodyDur * 0.5, q: r.bodyQ, grit: r.grit, attack: 0.001 });
  }
  if (r.boom > 0) {
    s.noise({ at: r.bodyAt + 0.002, dur: r.boomDur, v: r.boom * lv(), type: 'lowpass', f: r.boomHz * fm, q: 0.8, brown: true, attack: 0.004 });
  }
  if (r.sub > 0) {
    s.tone({ at: r.bodyAt, f: r.subHz * 2.6 * p, f2: r.subHz * p, sweep: 0.05, dur: r.subDur, v: r.sub * lv(), attack: 0.002 });
  }
  if (r.phut) {
    s.noise({ dur: 0.08, v: r.phut * lv(), type: 'bandpass', f: 520 * fm, q: 1.3, attack: 0.002 });
    s.noise({ dur: 0.05, v: r.phut * 0.4 * lv(), type: 'bandpass', f: 1800 * fm, q: 2, attack: 0.001 });
  }
  if (action) {
    for (const [at, f, v, dur = 0.03, q = 3, ring] of r.mech) {
      const t = at * j.tj();
      s.tick(t, f * p, v * lv(), dur, q);
      if (ring) s.ring(t + 0.002, ring.map((x) => x * p), 0.09, v * 0.32 * lv());
    }
  }
  r.extra?.(s, j);
}
