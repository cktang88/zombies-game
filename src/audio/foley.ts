// Foley: impacts, reloads & handling, casings, explosions. All synthesized live —
// each is a handful of nodes and they are throttled by the caller (src/audio.ts).

import { Synth } from './engine';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Impacts
// ---------------------------------------------------------------------------
export type ImpactKind = 'flesh' | 'head' | 'bone' | 'armor' | 'ricochet' | 'wood' | 'ground' | 'burst' | 'metal';
export const IMPACT_KINDS: ImpactKind[] = ['flesh', 'head', 'bone', 'armor', 'ricochet', 'wood', 'ground', 'burst', 'metal'];

function wet(s: Synth, at: number, v: number) {
  s.noise({ at, dur: 0.07, v, type: 'bandpass', f: rnd(900, 1500), f2: rnd(400, 700), q: 3.5, attack: 0.003 });
}

export function impact(s: Synth, kind: ImpactKind) {
  switch (kind) {
    case 'flesh':
      s.noise({ dur: 0.18, v: 0.75, brown: true, type: 'lowpass', f: 650, f2: 220, q: 0.8, attack: 0.002 });
      s.tone({ f: rnd(85, 100), f2: 48, sweep: 0.06, dur: 0.12, v: 0.4 });
      wet(s, 0.008, 0.22);
      break;
    case 'head':
      // crunch, a hollow pop, then a short spray
      s.noise({ dur: 0.07, v: 0.45, type: 'bandpass', f: rnd(1600, 2100), q: 1.5, grit: 0.7, attack: 0.0008 });
      s.tone({ at: 0.004, f: rnd(230, 260), f2: 60, sweep: 0.07, dur: 0.14, v: 0.55 });
      s.noise({ at: 0.004, dur: 0.16, v: 0.6, brown: true, type: 'lowpass', f: 700, f2: 250, attack: 0.002 });
      s.noise({ at: 0.02, dur: 0.25, v: 0.1, type: 'highpass', f: 3000, attack: 0.01 });
      wet(s, 0.03, 0.25);
      break;
    case 'bone':
      s.noise({ dur: 0.015, v: 0.7, type: 'highpass', f: 2600, attack: 0.0004 });
      s.noise({ dur: 0.05, v: 0.45, type: 'bandpass', f: rnd(800, 1000), q: 3, grit: 0.6, attack: 0.0005 });
      s.tone({ f: 160, f2: 70, sweep: 0.03, dur: 0.06, v: 0.25 });
      break;
    case 'armor':
      s.tick(0, 3500, 0.5, 0.012, 3);
      s.ring(0.001, [rnd(2250, 2450), 3720, 5150], 0.32, 0.22);
      s.noise({ dur: 0.06, v: 0.25, brown: true, type: 'lowpass', f: 500, attack: 0.002 });
      break;
    case 'ricochet':
      s.tick(0, 4000, 0.4, 0.01, 3);
      s.tone({ at: 0.01, f: rnd(3000, 3600), f2: rnd(900, 1300), sweep: 0.35, dur: 0.38, v: 0.09, type: 'sine', attack: 0.01 });
      s.noise({ at: 0.01, dur: 0.3, v: 0.12, type: 'bandpass', f: 3200, f2: 1100, q: 6, attack: 0.02 });
      break;
    case 'metal':
      s.tick(0, 2200, 0.55, 0.02, 2.5);
      s.ring(0.001, [rnd(900, 1100), 1650, 2780], 0.22, 0.2);
      break;
    case 'wood':
      s.noise({ dur: 0.12, v: 0.6, type: 'bandpass', f: rnd(320, 400), q: 3, attack: 0.001 });
      s.ring(0.001, [rnd(170, 200), 410], 0.12, 0.18);
      s.noise({ at: 0.004, dur: 0.06, v: 0.14, type: 'highpass', f: 3000, attack: 0.001 }); // splinters
      break;
    case 'ground':
      s.noise({ dur: 0.14, v: 0.35, brown: true, type: 'lowpass', f: 450, attack: 0.002 });
      s.noise({ at: 0.005, dur: 0.07, v: 0.08, type: 'highpass', f: 2500, attack: 0.002 }); // grit
      break;
    case 'burst':
      // the pulper going: a big wet bloom, a sub drop and a few late splats
      s.noise({ dur: 0.7, v: 1, brown: true, type: 'lowpass', f: 900, f2: 180, sweep: 0.4, q: 0.9, grit: 0.3, attack: 0.004 });
      s.tone({ f: 75, f2: 34, sweep: 0.25, dur: 0.4, v: 0.75 });
      for (let i = 0; i < 5; i++) wet(s, rnd(0.02, 0.4), rnd(0.18, 0.32));
      break;
  }
}

/** Kill-confirm tick; rises ~6% per kill in a streak (caps after 12). */
export function confirm(s: Synth, streak: number) {
  const f = 1250 * Math.pow(1.06, Math.max(0, Math.min(12, streak - 1)));
  s.tone({ f, dur: 0.06, v: 0.08, type: 'triangle', attack: 0.001 });
  s.tone({ f: f * 2, dur: 0.035, v: 0.03, type: 'sine', attack: 0.001 });
}

// ---------------------------------------------------------------------------
// Reloads & handling
// ---------------------------------------------------------------------------
export type ReloadKind =
  | 'pistol' | 'revolver' | 'smg' | 'rifle' | 'bolt' | 'lever' | 'pump' | 'double' | 'single'
  | 'muzzle' | 'bow' | 'crossbow' | 'flare' | 'lmg' | 'nailer';
export type ReloadStage = 'out' | 'in' | 'rack' | 'shell' | 'bolt' | 'close' | 'arrow';
export const RELOAD_KINDS: ReloadKind[] = ['pistol', 'revolver', 'smg', 'rifle', 'bolt', 'lever', 'pump', 'double', 'single', 'muzzle', 'bow', 'crossbow', 'flare', 'lmg', 'nailer'];
export const RELOAD_STAGES: ReloadStage[] = ['out', 'in', 'rack', 'shell', 'bolt', 'close', 'arrow'];

/** heft: bigger/heavier parts → lower, louder clacks */
const HEFT: Record<ReloadKind, number> = {
  pistol: 0.9, revolver: 0.95, smg: 1, rifle: 1.05, bolt: 1.1, lever: 1.05, pump: 1.15, double: 1.25, single: 0.9,
  muzzle: 1, bow: 0.8, crossbow: 1.1, flare: 0.8, lmg: 1.35, nailer: 1,
};

function clack(s: Synth, at: number, h: number, v: number, f = 1800) {
  s.tick(at, f / h, v, 0.035 * h, 2.5);
  s.ring(at + 0.002, [2900 / h, 4300 / h], 0.07, v * 0.3);
}
function scrape(s: Synth, at: number, h: number, dur: number, v: number) {
  s.noise({ at, dur, v, type: 'bandpass', f: 1700 / h, f2: 1100 / h, q: 2.2, attack: dur * 0.4 });
}
function plasticHull(s: Synth, at: number, v: number) {
  s.noise({ at, dur: 0.06, v, type: 'bandpass', f: rnd(500, 650), q: 2, attack: 0.001 });
  s.tick(at, 1400, v * 0.4, 0.015, 3);
}

export function reload(s: Synth, kind: ReloadKind, stage: ReloadStage) {
  const h = HEFT[kind];
  switch (stage) {
    case 'out':
      if (kind === 'revolver') {
        s.tick(0, 2600, 0.35, 0.015);                         // latch
        s.ring(0.02, [2100, 3300], 0.1, 0.12);                // cylinder swings out
        for (let i = 0; i < 4; i++) s.ring(0.18 + i * rnd(0.02, 0.05), [rnd(3800, 5200), rnd(6000, 7200)], 0.07, 0.1); // empties fall
      } else if (kind === 'double' || kind === 'single' || kind === 'flare') {
        s.noise({ dur: 0.07, v: 0.5, type: 'bandpass', f: 650 / h, q: 2, attack: 0.002 }); // break open
        s.ring(0.002, [1150 / h, 1900 / h], 0.1, 0.15);
        plasticHull(s, 0.14, 0.3);
        if (kind === 'double') plasticHull(s, 0.19, 0.25);
      } else if (kind === 'lmg') {
        s.tick(0, 1500, 0.4, 0.03, 2);
        s.noise({ at: 0.02, dur: 0.12, v: 0.4, type: 'bandpass', f: 800, q: 2, attack: 0.005 }); // feed cover up
        s.ring(0.03, [900, 1500], 0.14, 0.14);
      } else if (kind === 'bolt') {
        reload(s, kind, 'bolt');
      } else {
        s.tick(0, 3000 / h, 0.32, 0.015, 5);                  // mag release
        scrape(s, 0.015, h, 0.09, 0.22);                      // mag slides out
      }
      break;
    case 'in':
      if (kind === 'muzzle') {
        for (let i = 0; i < 3; i++) scrape(s, i * 0.17, 1.6, 0.12, 0.22);     // ramrod strokes
        s.noise({ at: 0.48, dur: 0.06, v: 0.35, brown: true, type: 'lowpass', f: 400 }); // seat the ball
      } else if (kind === 'lmg') {
        s.noise({ dur: 0.18, v: 0.22, type: 'bandpass', f: 3200, q: 5, attack: 0.03 }); // belt links rattle
        for (let i = 0; i < 6; i++) s.tick(0.02 + i * 0.025, rnd(2800, 4200), 0.12, 0.01, 6);
      } else if (kind === 'bolt') {
        scrape(s, 0, h, 0.12, 0.2);                            // rounds pressed into the magazine
        s.tick(0.13, 2200, 0.3, 0.02);
      } else {
        scrape(s, 0, h, 0.06, 0.18);
        clack(s, 0.06, h, 0.5, 2000);                          // seat & lock
      }
      break;
    case 'rack':
      if (kind === 'pump') {
        clack(s, 0, h, 0.6, 1300);
        clack(s, 0.12, h, 0.7, 1650);
      } else if (kind === 'lever') {
        clack(s, 0, h, 0.45, 1400);
        clack(s, 0.1, h, 0.5, 1800);
      } else {
        s.noise({ dur: 0.05, v: 0.25, type: 'bandpass', f: 1400 / h, q: 2, attack: 0.005 }); // pull back
        clack(s, 0.1, h, 0.55, 1900);                          // slam home
      }
      break;
    case 'shell':
      s.noise({ dur: 0.05, v: 0.3, type: 'bandpass', f: 900 / h, q: 2, attack: 0.004 });   // thumbed in
      s.tick(0.045, 2500 / h, 0.3, 0.015, 4);                                              // past the latch
      break;
    case 'bolt':
      s.tick(0, 2000, 0.32, 0.03, 4);
      clack(s, 0.07, h, 0.4, 1200);
      s.noise({ at: 0.2, dur: 0.06, v: 0.25, type: 'bandpass', f: 1500, q: 2.5, attack: 0.01 });
      clack(s, 0.29, h, 0.45, 2400);
      break;
    case 'close':
      if (kind === 'revolver') {
        s.tick(0, 2400, 0.4, 0.02);
        s.ring(0.002, [3000, 4500], 0.08, 0.12);
        s.noise({ at: 0.03, dur: 0.15, v: 0.06, type: 'bandpass', f: 4000, q: 8 });           // the spin
      } else if (kind === 'muzzle') {
        s.tick(0, 3500, 0.3, 0.012, 5);                        // cap pressed on the nipple
        s.tick(0.18, 2200, 0.35, 0.02, 4);                     // hammer to half-cock
      } else {
        s.noise({ dur: 0.06, v: 0.6, type: 'bandpass', f: 700 / h, q: 2, attack: 0.001 });
        s.ring(0.001, [1500 / h, 2400 / h], 0.12, 0.2);
      }
      break;
    case 'arrow':
      if (kind === 'crossbow') {
        for (let i = 0; i < 8; i++) s.tick(i * 0.07, rnd(2600, 3000), 0.22, 0.012, 6);       // winch ratchet
        s.tone({ f: 70, f2: 110, sweep: 0.55, dur: 0.6, v: 0.05, type: 'sawtooth', lp: 400, attack: 0.1 }); // cable strain
        s.tick(0.6, 1800, 0.45, 0.025, 3);                    // latch
      } else {
        s.tick(0, 1200, 0.25, 0.02, 3);                       // nock on the string
        s.tone({ at: 0.05, f: 60, f2: 95, sweep: 0.45, dur: 0.5, v: 0.04, type: 'sawtooth', lp: 350, attack: 0.15 }); // draw creak
      }
      break;
  }
}

/** Stage schedule for a full reload of `seconds`: [stage, fraction of the time]. */
export function reloadPlan(kind: ReloadKind, rounds = 1): [ReloadStage, number][] {
  switch (kind) {
    case 'revolver': {
      const plan: [ReloadStage, number][] = [['out', 0.02]];
      for (let i = 0; i < Math.min(6, rounds); i++) plan.push(['shell', 0.3 + i * 0.08]);
      plan.push(['close', 0.88]);
      return plan;
    }
    case 'pump': case 'lever': {
      const plan: [ReloadStage, number][] = [];
      const n = Math.max(1, Math.min(8, rounds));
      for (let i = 0; i < n; i++) plan.push(['shell', 0.05 + (i / n) * 0.8]);
      if (kind === 'pump') plan.push(['rack', 0.9]);
      return plan;
    }
    case 'bolt': return [['bolt', 0.02], ['in', 0.5], ['bolt', 0.84]];
    case 'double': case 'single': case 'flare': return [['out', 0.03], ['shell', 0.5], ['close', 0.86]];
    case 'muzzle': return [['in', 0.25], ['close', 0.85]];
    case 'bow': return [['arrow', 0.15]];
    case 'crossbow': return [['arrow', 0.2]];
    case 'lmg': return [['out', 0.03], ['in', 0.45], ['close', 0.75], ['rack', 0.9]];
    default: return [['out', 0.03], ['in', 0.55], ['rack', 0.82]];
  }
}

// ---------------------------------------------------------------------------
// Casings
// ---------------------------------------------------------------------------
export type CasingKind = 'brass' | 'small' | 'big' | 'hull' | 'link';
export const CASING_KINDS: CasingKind[] = ['brass', 'small', 'big', 'hull', 'link'];

export function casing(s: Synth, kind: CasingKind) {
  if (kind === 'hull') {
    // plastic shotgun hull: a dull thump and one short bounce
    plasticHull(s, 0, 0.32);
    plasticHull(s, rnd(0.09, 0.13), 0.14);
    return;
  }
  const base = kind === 'small' ? 5200 : kind === 'big' ? 3300 : 4200;
  const v = kind === 'small' ? 0.1 : kind === 'big' ? 0.16 : 0.13;
  const bounces = 2 + Math.floor(Math.random() * 3);
  let t = 0, gap = rnd(0.07, 0.11), amp = v;
  for (let i = 0; i < bounces; i++) {
    const f = base * rnd(0.95, 1.05);
    s.tick(t, f * 0.8, amp * 1.2, 0.006, 4);
    s.ring(t + 0.001, [f, f * 1.51, f * 2.23], 0.09 * (1 - i * 0.15), amp);
    t += gap;
    gap *= 0.62;
    amp *= 0.55;
  }
  if (kind === 'link') s.tick(rnd(0.01, 0.03), 2600, 0.12, 0.012, 5);
}

// ---------------------------------------------------------------------------
// Handling faults
// ---------------------------------------------------------------------------
export function dryFire(s: Synth) {
  s.tick(0, 3400, 0.4, 0.012, 5);
  s.ring(0.001, [5200, 7400], 0.03, 0.05);
}
export function jam(s: Synth) {
  s.tick(0, 3000, 0.35, 0.012, 5);                                   // the click that didn't fire
  s.noise({ at: 0.06, dur: 0.1, v: 0.55, type: 'bandpass', f: 520, q: 2.5, attack: 0.002 }); // clunk
  s.ring(0.062, [700, 1150], 0.12, 0.15);
  s.noise({ at: 0.14, dur: 0.12, v: 0.2, type: 'bandpass', f: 1500, f2: 900, q: 2, attack: 0.03 }); // grinding
}
export function overheat(s: Synth) {
  s.noise({ dur: 1.1, v: 0.18, type: 'highpass', f: 3500, attack: 0.15, hold: 0.3 });
  s.noise({ at: 0.05, dur: 0.9, v: 0.06, type: 'bandpass', f: 6000, q: 4, attack: 0.1, hold: 0.2 });
  for (let i = 0; i < 10; i++) s.tick(rnd(0.05, 1.1), rnd(4000, 7000), 0.06, 0.004, 4); // sizzle
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------
export function explosion(s: Synth, size = 1) {
  const z = Math.max(0.4, Math.min(2, size));
  s.noise({ dur: 0.03, v: 0.8, type: 'highpass', f: 1800, attack: 0.0005 });                        // the crack
  s.noise({ dur: 1.2 * z, v: 1.3, type: 'lowpass', f: 2200, f2: 140, sweep: 0.5 * z, q: 0.6, grit: 0.6, attack: 0.002 }); // blast
  s.tone({ f: 120, f2: 28, sweep: 0.35 * z, dur: 1.4 * z, v: 1, attack: 0.004 });                    // sub
  s.noise({ at: 0.04, dur: 2.4 * z, v: 0.7, brown: true, type: 'lowpass', f: 130, q: 0.7, attack: 0.15, hold: 0.2 }); // rumble
  const bits = Math.round(14 * z);
  for (let i = 0; i < bits; i++) {                                                                  // debris raining down
    const at = 0.3 + Math.pow(Math.random(), 0.7) * 1.6 * z;
    if (Math.random() < 0.6) s.tick(at, rnd(1200, 4500), rnd(0.05, 0.16), rnd(0.01, 0.03), rnd(2, 5));
    else s.noise({ at, dur: 0.08, v: rnd(0.1, 0.2), brown: true, type: 'lowpass', f: rnd(300, 600) });
  }
}
