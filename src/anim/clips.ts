// Keyframed action clips: plain data, times normalised 0..1 so any clip can be stretched to
// a gameplay duration (a reload clip is played over the gun's fireProfile reload seconds).
//
//   num   numeric channel tracks: [t, value, ease?] (see Channels in skeleton.ts)
//   n/f   near / far hand target tracks: [t, Target | null, ease?]; null = hand returns to its
//         default (the fore-end / grip / gait swing). Targets in gun space follow the gun as
//         it moves, so a hand that "holds the magwell" stays on it while the gun tilts.
//   set   discrete switches at t: hand poses are part of targets; set covers props:
//         mag ('gun' | 'hand' | 'none'), prop (in near hand: 'shell' | 'speedloader' | 'arrow'
//         | 'round' | null), gun ('held' | 'slung' | 'hidden'), headFlip (0|1)
//   ev    animation events [t, name] delivered to play()'s onEvent: audio hooks, gameplay
//         timing (the 'hit' frame of a melee swing, 'claw' of an attack, 'magIn'...)
//   add   additive clip (hit reactions, twitches) layered over whatever plays
//   hold  keep the last frame when finished (knockdown poses, death poses)
import type { Ease } from './math';
import type { NumCh, Target } from './skeleton';

export type Key = [number, number, Ease?];
export type TKey = [number, Target | null, Ease?];
export type SetVal = string | number | null;
export interface Clip {
  id: string;
  dur: number; // authored seconds (only a default; play() can stretch)
  loop?: boolean;
  add?: boolean;
  hold?: boolean;
  fadeIn?: number; fadeOut?: number; // seconds
  num?: Partial<Record<NumCh, Key[]>>;
  n?: TKey[];
  f?: TKey[];
  set?: [number, string, SetVal][];
  ev?: [number, string][];
}

// ---- target shorthands
const G = (p: string, dx = 0, dy = 0, pose?: string, a?: number): Target => ({ s: 'gun', p, dx, dy, pose, a });
const B = (p: string, dx = 0, dy = 0, pose?: string, a?: number): Target => ({ s: 'body', p, dx, dy, pose, a });
const GR = (dx: number, dy = 0, pose?: string, a?: number): Target => ({ s: 'ground', dx, dy, pose, a });
const W = (dx: number, dy: number, pose?: string, a?: number): Target => ({ s: 'world', dx, dy, pose, a });

/** Hand art rotations for holding a mag/shell upright near the body. */
const UP = -0.6;

// =========================================================================== survivors

/** Detachable box magazine (rifles, SMGs, LMG box, nail canister). rack = empty reload. */
function reloadMag(rack: boolean): Clip {
  const k = rack ? 1 : 0.86; // tactical reloads skip the charging handle and end sooner
  const t = (v: number) => v * k;
  return {
    id: rack ? 'reloadMagEmpty' : 'reloadMag',
    dur: 2.2,
    num: {
      ready: [[0, 0], [t(0.1), 0.72], [t(0.86), 0.72], [1, 0]],
      gunTilt: [[0, 0], [t(0.1), -0.28], [t(0.55), -0.28], [t(0.66), -0.12], [t(0.86), -0.08], [1, 0]],
      lean: [[0, 0], [t(0.12), 0.08], [t(0.9), 0.08], [1, 0]],
      head: [[0, 0], [t(0.12), 0.38], [t(0.9), 0.3], [1, 0]],
      crouch: [[0, 0], [t(0.3), 0.05], [t(0.5), 0.08], [1, 0]],
    },
    n: [
      [0, null],
      [t(0.12), G('magwell', 0, 6, 'fist')],
      [t(0.2), G('magwell', 0, 6, 'fist')],
      [t(0.3), G('magwell', -2, 30, 'fist'), 'out'],
      [t(0.38), B('pouch', 2, 0, 'open', 0.4)],
      [t(0.46), B('pouch', 0, 4, 'fist', UP)],
      [t(0.6), G('magwell', 0, 26, 'fist')],
      [t(0.68), G('magwell', 0, 6, 'fist'), 'in'],
      [t(0.72), G('magwell', 0, 14, 'open')],
      [t(0.75), G('magwell', 0, 4, 'open'), 'in'],
      ...(rack ? ([
        [0.82, G('rack', 0, 0, 'pinch')],
        [0.87, G('rack', -13, 0, 'pinch'), 'out'],
        [0.9, G('rack', -13, 0, 'pinch')],
      ] as TKey[]) : []),
      [1, null],
    ],
    set: [[t(0.2), 'mag', 'hand'], [t(0.31), 'mag', 'none'], [t(0.46), 'mag', 'hand'], [t(0.68), 'mag', 'gun']],
    ev: [[t(0.2), 'magOut'], [t(0.31), 'magDrop'], [t(0.46), 'magGrab'], [t(0.68), 'magIn'], [t(0.75), 'slap'], ...(rack ? ([[0.87, 'rack']] as [number, string][]) : [])],
  };
}

/** Pistol: thumb the release, the mag falls free, fresh one from the belt, slide release if empty. */
function reloadPistol(slide: boolean): Clip {
  return {
    id: slide ? 'reloadPistolEmpty' : 'reloadPistol',
    dur: 1.4,
    num: {
      ready: [[0, 0], [0.12, 0.62], [0.86, 0.62], [1, 0]],
      gunTilt: [[0, 0], [0.12, -0.4], [0.6, -0.35], [0.7, -0.2], [1, 0]],
      head: [[0, 0], [0.14, 0.32], [0.88, 0.28], [1, 0]],
    },
    n: [
      [0, null],
      [0.14, B('pouch', 4, -6, 'open', 0.3)],
      [0.3, B('pouch', 0, 4, 'fist', UP)],
      [0.5, G('magwell', 0, 22, 'fist')],
      [0.6, G('magwell', 0, 4, 'fist'), 'in'],
      [0.66, G('magwell', 0, 10, 'open')],
      [0.7, G('magwell', 0, 3, 'open'), 'in'],
      ...(slide ? ([
        [0.78, G('rack', 0, -2, 'pinch')],
        [0.84, G('rack', -9, -2, 'pinch'), 'out'],
        [0.88, G('rack', -9, -2, 'pinch')],
      ] as TKey[]) : []),
      [1, null],
    ],
    set: [[0.1, 'mag', 'none'], [0.3, 'mag', 'hand'], [0.6, 'mag', 'gun']],
    ev: [[0.1, 'magOut'], [0.1, 'magDrop'], [0.3, 'magGrab'], [0.6, 'magIn'], [0.7, 'slap'], ...(slide ? ([[0.84, 'slide']] as [number, string][]) : [])],
  };
}

/** One shell into a tube magazine (pump / auto shotgun, lever gate). Play with repeat. */
const shellIn: Clip = {
  id: 'shellIn',
  dur: 0.55,
  fadeIn: 0.15, fadeOut: 0.15,
  num: {
    ready: [[0, 0.5], [1, 0.5]],
    gunTilt: [[0, -0.12], [1, -0.12]],
    head: [[0, 0.3], [1, 0.3]],
    lean: [[0, 0.06], [1, 0.06]],
  },
  n: [
    [0, G('port', 10, 8, 'support')],
    [0.32, B('pouch', 0, 0, 'pinch', UP)],
    [0.42, B('pouch', 0, 3, 'pinch', UP)],
    [0.72, G('port', 4, 10, 'pinch', -0.2)],
    [0.84, G('port', -2, 2, 'pinch', -0.2), 'in'],
    [1, G('port', 10, 8, 'support')],
  ],
  set: [[0.42, 'prop', 'shell'], [0.84, 'prop', null]],
  ev: [[0.42, 'shellGrab'], [0.84, 'shellIn']],
};

/** Pump action: fore-end back and forward (after loading or between shots). */
const pump: Clip = {
  id: 'pump',
  dur: 0.45,
  num: { ready: [[0, 0.2], [1, 0]], gunTilt: [[0, -0.05], [0.4, 0.04], [1, 0]] },
  n: [[0, G('fore', 0, 0, 'support')], [0.38, G('fore', -16, 0, 'support'), 'out'], [0.62, G('fore', 0, 0, 'support'), 'in'], [1, G('fore', 0, 0, 'support')]],
  ev: [[0.38, 'pumpBack'], [0.62, 'pumpFwd']],
};

/** Bolt action: open, thumb rounds in from a stripper clip, close. */
const reloadBolt: Clip = {
  id: 'reloadBolt',
  dur: 3.0,
  num: {
    ready: [[0, 0], [0.08, 0.55], [0.9, 0.55], [1, 0]],
    gunTilt: [[0, 0], [0.08, -0.1], [0.9, -0.1], [1, 0]],
    head: [[0, 0], [0.1, 0.32], [0.9, 0.3], [1, 0]],
  },
  n: [
    [0, null],
    [0.1, G('rack', 0, 0, 'pinch')],
    [0.15, G('rack', 0, -6, 'pinch')],
    [0.22, G('rack', -14, -6, 'pinch'), 'out'],
    [0.32, B('pouch', 0, 0, 'pinch', UP)],
    [0.4, B('pouch', 0, 3, 'pinch', UP)],
    [0.52, G('port', 0, -10, 'pinch', 0.3)],
    [0.58, G('port', 0, -2, 'pinch', 0.3), 'in'],
    [0.63, G('port', 0, -9, 'pinch', 0.3)],
    [0.68, G('port', 0, -2, 'pinch', 0.3), 'in'],
    [0.76, G('rack', -14, -6, 'pinch')],
    [0.82, G('rack', 0, -6, 'pinch'), 'in'],
    [0.87, G('rack', 0, 0, 'pinch')],
    [1, null],
  ],
  set: [[0.4, 'prop', 'round'], [0.7, 'prop', null]],
  ev: [[0.15, 'boltUp'], [0.22, 'boltBack'], [0.4, 'roundGrab'], [0.58, 'roundIn'], [0.68, 'roundIn'], [0.82, 'boltFwd'], [0.87, 'boltDown']],
};

/** Cycle the bolt between shots while staying on target. */
const boltCycle: Clip = {
  id: 'boltCycle',
  dur: 0.7,
  num: { ready: [[0, 0], [0.3, 0.12], [1, 0]], head: [[0, 0], [0.5, 0.05], [1, 0]] },
  n: [[0, null], [0.2, G('rack', 0, 0, 'pinch')], [0.32, G('rack', 0, -6, 'pinch')], [0.48, G('rack', -14, -6, 'pinch'), 'out'], [0.62, G('rack', 0, -6, 'pinch'), 'in'], [0.72, G('rack', 0, 0, 'pinch')], [1, null]],
  ev: [[0.32, 'boltUp'], [0.48, 'boltBack'], [0.48, 'eject'], [0.62, 'boltFwd'], [0.72, 'boltDown']],
};

/** Lever cycle: the trigger hand works the lever. */
const leverCycle: Clip = {
  id: 'leverCycle',
  dur: 0.5,
  num: { gunTilt: [[0, 0], [0.4, -0.06], [1, 0]] },
  f: [[0, null], [0.4, G('rack', -2, 16, 'grip', 0.5), 'out'], [0.75, G('grip', 0, 0, 'grip'), 'in'], [1, null]],
  ev: [[0.4, 'leverDown'], [0.4, 'eject'], [0.75, 'leverUp']],
};

/** Revolver: swing the cylinder out, punch the ejector, speedloader in, twist, close. */
const reloadRevolver: Clip = {
  id: 'reloadRevolver',
  dur: 2.4,
  num: {
    ready: [[0, 0], [0.08, 0.8], [0.9, 0.8], [1, 0]],
    gunTilt: [[0, 0], [0.08, -0.4], [0.18, -1.25], [0.3, -1.25], [0.42, 0.55], [0.74, 0.55], [0.86, -0.1], [1, 0]],
    gunDY: [[0, 0], [0.2, -8], [0.32, -8], [0.42, 4], [0.8, 4], [1, 0]],
    cyl: [[0, 0], [0.1, 0], [0.15, 1, 'out'], [0.8, 1], [0.85, 0, 'in']],
    head: [[0, 0], [0.1, 0.3], [0.9, 0.3], [1, 0]],
  },
  n: [
    [0, null],
    [0.1, G('port', 0, 4, 'pinch')],
    [0.2, G('port', 6, -4, 'open')],
    [0.26, G('port', 2, -2, 'open'), 'in'],
    [0.4, B('pouch', 0, 0, 'pinch', UP)],
    [0.48, B('pouch', 0, 3, 'pinch', UP)],
    [0.64, G('port', -4, -14, 'pinch', 1.2)],
    [0.7, G('port', 0, -6, 'pinch', 1.2), 'in'],
    [0.74, G('port', 0, -6, 'pinch', 1.6)],
    [0.79, G('port', 0, -18, 'open', 1.2)],
    [0.85, G('port', 4, 4, 'open'), 'in'],
    [1, null],
  ],
  set: [[0.48, 'prop', 'speedloader'], [0.77, 'prop', null]],
  ev: [[0.14, 'cylOut'], [0.26, 'eject'], [0.48, 'loaderGrab'], [0.7, 'speedIn'], [0.77, 'loaderDrop'], [0.85, 'cylIn']],
};

/** Break action (coach gun, .410, flare pistol, 40mm, pipe guns): open, eject, load, snap shut. */
const reloadBreak: Clip = {
  id: 'reloadBreak',
  dur: 2.0,
  num: {
    ready: [[0, 0], [0.08, 0.6], [0.9, 0.6], [1, 0]],
    gunTilt: [[0, 0], [0.12, 0.25], [0.26, 0.4], [0.8, 0.35], [0.88, -0.1], [0.94, 0], [1, 0]],
    cyl: [[0, 0], [0.12, 0], [0.18, 1, 'out'], [0.82, 1], [0.87, 0, 'in']],
    head: [[0, 0], [0.1, 0.35], [0.9, 0.3], [1, 0]],
  },
  n: [
    [0, null],
    [0.1, G('rack', 0, 0, 'pinch')],
    [0.18, G('fore', -8, 6, 'support'), 'out'],
    [0.26, G('port', 8, -8, 'open')],
    [0.36, B('pouch', 0, 0, 'pinch', UP)],
    [0.44, B('pouch', 0, 3, 'pinch', UP)],
    [0.62, G('port', -8, -12, 'pinch', 0.9)],
    [0.7, G('port', 0, -2, 'pinch', 0.9), 'in'],
    [0.78, G('fore', 0, 4, 'support')],
    [0.87, G('fore', 0, -4, 'support'), 'in'],
    [1, null],
  ],
  set: [[0.44, 'prop', 'shell'], [0.72, 'prop', null]],
  ev: [[0.18, 'breakOpen'], [0.26, 'eject'], [0.44, 'shellGrab'], [0.7, 'shellIn'], [0.87, 'breakClose']],
};

/** Bow: arrow from the quiver, nock, draw to the cheek. */
const nockBow: Clip = {
  id: 'nockBow',
  dur: 0.8,
  num: { draw: [[0, 0], [0.66, 0], [1, 1, 'out']], head: [[0, 0], [0.3, -0.15], [0.7, 0.05], [1, 0]] },
  f: [[0, null], [0.25, B('quiver', 0, 0, 'pinch', -1.2)], [0.38, B('quiver', 4, -10, 'pinch', -1.2)], [0.66, G('rack', 0, 0, 'pinch')], [1, null]],
  set: [[0.38, 'fprop', 'arrow'], [0.66, 'fprop', null]],
  ev: [[0.38, 'arrowGrab'], [0.66, 'nock'], [0.98, 'drawn']],
};

/** Crossbow: muzzle down, haul the string back, lay a bolt. */
const reloadCrossbow: Clip = {
  id: 'reloadCrossbow',
  dur: 2.2,
  num: { ready: [[0, 0], [0.1, 0.8], [0.9, 0.8], [1, 0]], gunTilt: [[0, 0], [0.12, 0.7], [0.62, 0.7], [0.75, 0.1], [1, 0]], crouch: [[0, 0], [0.2, 0.15], [0.7, 0.15], [1, 0]], head: [[0, 0], [0.12, 0.4], [0.9, 0.3], [1, 0]] },
  n: [[0, null], [0.14, G('muzzle', -40, -4, 'fist')], [0.28, G('rack', -2, -4, 'fist')], [0.44, G('port', -20, -4, 'fist'), 'out'], [0.56, B('quiver', 0, 0, 'pinch', -1.0)], [0.72, G('port', 10, -6, 'pinch')], [0.8, G('port', 0, -4, 'pinch')], [1, null]],
  set: [[0.6, 'prop', 'arrow'], [0.8, 'prop', null]],
  ev: [[0.44, 'cock'], [0.6, 'arrowGrab'], [0.8, 'boltIn']],
};

/** Muzzleloader: muzzle up, powder, patch & ball, ram twice. */
const reloadMuzzle: Clip = {
  id: 'reloadMuzzle',
  dur: 5.5,
  num: { ready: [[0, 0], [0.08, 1], [0.92, 1], [1, 0]], gunTilt: [[0, 0], [0.08, -1.25], [0.92, -1.25], [1, 0]], gunDY: [[0, 0], [0.08, 26], [0.92, 26], [1, 0]], head: [[0, 0], [0.1, -0.2], [0.9, -0.2], [1, 0]] },
  n: [[0, null], [0.12, B('pouch', 0, 0, 'pinch', UP)], [0.2, G('muzzle', 0, -4, 'pinch', 1.6)], [0.26, G('muzzle', 0, -4, 'pinch', 2.2)], [0.34, B('pouch', 0, 3, 'pinch', UP)], [0.44, G('muzzle', 0, -2, 'pinch', 1.6)],
    [0.52, G('muzzle', -18, -2, 'fist', 1.6)], [0.6, G('muzzle', 6, -2, 'fist', 1.6), 'in'], [0.68, G('muzzle', -18, -2, 'fist', 1.6)], [0.76, G('muzzle', 8, -2, 'fist', 1.6), 'in'], [0.86, G('muzzle', -20, -2, 'fist', 1.6)], [1, null]],
  ev: [[0.24, 'powder'], [0.44, 'ball'], [0.6, 'ram'], [0.76, 'ram']],
};

/** Disposable rocket tube: toss it, pull the next off the back, extend. */
const reloadTube: Clip = {
  id: 'reloadTube',
  dur: 3.5,
  num: { ready: [[0, 0], [0.1, 0.6], [0.85, 0.6], [1, 0]], gunTilt: [[0, 0], [0.1, 0.4], [0.85, 0.2], [1, 0]] },
  n: [[0, null], [0.2, B('chest', 30, 10, 'open')], [0.45, B('back', -4, -10, 'fist')], [0.7, G('muzzle', -40, 0, 'fist')], [0.8, G('muzzle', -10, 0, 'fist'), 'out'], [1, null]],
  set: [[0.2, 'gun', 'hidden'], [0.5, 'gun', 'held']],
  ev: [[0.2, 'tubeDrop'], [0.5, 'tubeGrab'], [0.8, 'extend']],
};

/** Hatchet overhead chop (near arm FK; the weapon rides the hand). */
const chop: Clip = {
  id: 'chop',
  dur: 0.75,
  num: {
    nSh: [[0, 0.7], [0.32, 2.75, 'out'], [0.52, 0.35, 'in'], [0.64, 0.15], [1, 0.7]],
    nEl: [[0, 1.0], [0.32, 1.55], [0.52, 0.15], [0.64, 0.1], [1, 1.0]],
    nWr: [[0, 0.2], [0.32, -0.5], [0.52, 0.45], [1, 0.2]],
    fSh: [[0, 0.3], [0.32, 1.0], [0.52, -0.35], [1, 0.3]],
    fEl: [[0, 0.6], [0.32, 1.2], [0.52, 0.3], [1, 0.6]],
    lean: [[0, 0.05], [0.32, -0.16], [0.54, 0.38], [0.72, 0.3], [1, 0.05]],
    head: [[0, 0], [0.32, -0.12], [0.54, 0.25], [1, 0]],
    crouch: [[0, 0], [0.54, 0.16], [1, 0]],
  },
  ev: [[0.42, 'whoosh'], [0.52, 'hit']],
};
/** Hatchet backhand sweep (second melee variant). */
const sweep: Clip = {
  id: 'sweep',
  dur: 0.6,
  num: {
    nSh: [[0, 0.7], [0.3, 0.2, 'out'], [0.55, 1.9, 'in'], [1, 0.7]],
    nEl: [[0, 1.0], [0.3, 1.9], [0.55, 0.2], [1, 1.0]],
    nWr: [[0, 0.2], [0.3, 0.8], [0.55, -0.3], [1, 0.2]],
    lean: [[0, 0.05], [0.3, -0.05], [0.55, 0.25], [1, 0.05]],
    tilt: [[0, 0], [0.3, -0.05], [0.55, 0.08], [1, 0]],
  },
  ev: [[0.45, 'whoosh'], [0.55, 'hit']],
};

/** Crouch and rummage through a pile (scavenging). Loops. */
const rummage: Clip = {
  id: 'rummage',
  dur: 1.8,
  loop: true,
  fadeIn: 0.35, fadeOut: 0.35,
  num: {
    crouch: [[0, 0.8], [0.5, 0.84], [1, 0.8]],
    lean: [[0, 0.82], [0.25, 0.92], [0.5, 0.78], [0.75, 0.9], [1, 0.82]],
    head: [[0, 0.35], [0.5, 0.45], [1, 0.35]],
    nFx: [[0, 18], [1, 18]], fFx: [[0, -16], [1, -16]],
  },
  n: [[0, GR(40, 2, 'open', 0.6)], [0.2, GR(48, 0, 'pinch', 0.9)], [0.35, GR(36, 6, 'pinch', 0.2)], [0.55, GR(44, 2, 'open', 0.7)], [0.75, GR(50, 3, 'fist', 0.4)], [1, GR(40, 2, 'open', 0.6)]],
  f: [[0, GR(30, 2, 'open', 0.8)], [0.3, GR(36, 4, 'open', 1.0)], [0.6, GR(26, 1, 'open', 0.6)], [1, GR(30, 2, 'open', 0.8)]],
  set: [[0, 'gun', 'slung']],
  ev: [[0.2, 'rustle'], [0.55, 'rustle'], [0.75, 'clink']],
};

// ---- hit reactions (additive; zone-specific)
const hitHead: Clip = { id: 'hitHead', dur: 0.45, add: true, fadeIn: 0.02, num: { head: [[0, 0], [0.14, -0.75, 'out'], [1, 0]], lean: [[0, 0], [0.18, -0.2], [1, 0]], gunTilt: [[0, 0], [0.15, -0.3], [1, 0]] } };
const hitTorso: Clip = { id: 'hitTorso', dur: 0.5, add: true, fadeIn: 0.02, num: { lean: [[0, 0], [0.18, -0.32, 'out'], [1, 0]], px: [[0, 0], [0.22, -5], [1, 0]], crouch: [[0, 0], [0.2, 0.08], [1, 0]], head: [[0, 0], [0.2, 0.2], [1, 0]] } };
const hitLeg: Clip = { id: 'hitLeg', dur: 0.6, add: true, fadeIn: 0.02, num: { crouch: [[0, 0], [0.2, 0.32, 'out'], [1, 0]], lean: [[0, 0], [0.2, 0.28], [1, 0]], tilt: [[0, 0], [0.2, 0.12], [1, 0]] } };
const hitArm: Clip = { id: 'hitArm', dur: 0.55, add: true, fadeIn: 0.02, num: { nSh: [[0, 0], [0.15, -1.1, 'out'], [0.45, 0.4], [1, 0]], nEl: [[0, 0], [0.15, 0.9], [1, 0]], lean: [[0, 0], [0.15, -0.12], [1, 0]], gunTilt: [[0, 0], [0.15, 0.35], [1, 0]] } };
const twitch: Clip = { id: 'twitch', dur: 0.3, add: true, num: { head: [[0, 0], [0.2, 0.25, 'step'], [0.5, -0.1], [1, 0]], fSh: [[0, 0], [0.2, 0.4], [1, 0]], tilt: [[0, 0], [0.25, 0.05], [1, 0]] } };

// =========================================================================== Turned
const claw: Clip = {
  id: 'claw', dur: 0.95,
  num: {
    nSh: [[0, 1.35], [0.38, 2.5, 'out'], [0.56, 0.55, 'in'], [1, 1.35]], nEl: [[0, 0.3], [0.38, 1.3], [0.56, 0.1], [1, 0.3]], nWr: [[0, 0], [0.38, -0.5], [0.56, 0.6], [1, 0]],
    fSh: [[0, 1.25], [0.46, 2.35, 'out'], [0.66, 0.5, 'in'], [1, 1.25]], fEl: [[0, 0.3], [0.46, 1.2], [0.66, 0.1], [1, 0.3]],
    lean: [[0, 0.1], [0.38, -0.08], [0.58, 0.38], [1, 0.1]], head: [[0, 0], [0.4, -0.35], [0.6, 0.15], [1, 0]],
  },
  ev: [[0.56, 'claw'], [0.66, 'claw']],
};
const grabBite: Clip = {
  id: 'grabBite', dur: 1.1,
  num: {
    nSh: [[0, 1.3], [0.3, 1.65], [0.55, 1.4], [1, 1.3]], nEl: [[0, 0.3], [0.3, 0.05], [0.55, 1.5, 'in'], [0.8, 1.5], [1, 0.3]],
    fSh: [[0, 1.2], [0.3, 1.6], [0.55, 1.35], [1, 1.2]], fEl: [[0, 0.3], [0.3, 0.05], [0.55, 1.6, 'in'], [0.8, 1.6], [1, 0.3]],
    lean: [[0, 0.1], [0.3, 0.3], [0.62, 0.55, 'in'], [0.8, 0.5], [1, 0.1]], head: [[0, 0], [0.55, -0.4], [0.64, 0.45, 'in'], [0.8, 0.4], [1, 0]],
  },
  ev: [[0.3, 'grab'], [0.64, 'bite']],
};
/** Hammering the barricade with both fists. Loops. */
const pound: Clip = {
  id: 'pound', dur: 0.9, loop: true, fadeIn: 0.2,
  num: {
    nSh: [[0, 1.6], [0.35, 2.7, 'out'], [0.5, 1.25, 'in'], [1, 1.6]], nEl: [[0, 0.6], [0.35, 1.3], [0.5, 0.35], [1, 0.6]],
    fSh: [[0, 2.4], [0.3, 1.25, 'in'], [0.75, 2.75, 'out'], [0.88, 1.25, 'in'], [1, 2.4]], fEl: [[0, 1.2], [0.3, 0.35], [0.75, 1.3], [0.88, 0.35], [1, 1.2]],
    lean: [[0, 0.12], [0.35, -0.06], [0.5, 0.22], [0.88, 0.2], [1, 0.12]], head: [[0, 0.1], [0.5, 0.3], [1, 0.1]],
  },
  ev: [[0.5, 'pound'], [0.88, 'pound']],
};
/** Deer: crouch-telegraph, leap, land. */
const lunge: Clip = {
  id: 'lunge', dur: 1.0,
  num: {
    crouch: [[0, 0], [0.32, 0.5, 'out'], [0.42, 0], [0.7, 0.05], [0.8, 0.4], [1, 0]],
    lean: [[0, 0.4], [0.32, 0.75], [0.5, 0.25], [0.8, 0.6], [1, 0.4]],
    px: [[0, 0], [0.32, -6], [0.72, 46, 'out'], [1, 46]],
    py: [[0, 0], [0.42, 0], [0.56, -34, 'out'], [0.72, 0, 'in'], [1, 0]],
    nSh: [[0, 0.6], [0.32, -0.3], [0.5, 2.0], [0.75, 1.6], [1, 0.6]], fSh: [[0, -0.2], [0.32, -0.5], [0.5, 1.9], [0.75, 1.4], [1, -0.2]],
    nEl: [[0, 1.4], [0.5, 0.2], [1, 1.4]], fEl: [[0, 1.2], [0.5, 0.25], [1, 1.2]],
    nFy: [[0, 0], [0.45, 0], [0.55, -10], [0.72, 0], [1, 0]], fFy: [[0, 0], [0.45, 0], [0.55, -16], [0.72, 0], [1, 0]],
  },
  ev: [[0.32, 'snarl'], [0.42, 'leap'], [0.72, 'land']],
};
/** Deer: stop after a sprint, heaving breath. Loops. */
const pantStop: Clip = {
  id: 'pantStop', dur: 0.62, loop: true, fadeIn: 0.25, fadeOut: 0.3,
  num: {
    lean: [[0, 0.58], [0.4, 0.72, 'out'], [1, 0.58]], head: [[0, -0.35], [0.4, 0.15], [1, -0.35]], crouch: [[0, 0.18], [0.4, 0.24], [1, 0.18]],
    nSh: [[0, -0.05], [0.45, 0.25], [1, -0.05]], fSh: [[0, -0.12], [0.5, 0.18], [1, -0.12]], nEl: [[0, 0.15], [1, 0.15]], fEl: [[0, 0.2], [1, 0.2]],
    nFx: [[0, 14], [1, 14]], fFx: [[0, -16], [1, -16]], tilt: [[0, 0], [0.4, 0.06], [1, 0]],
  },
  ev: [[0, 'pant'], [0.45, 'pant']],
};
/** Ferryman: two-handed overhead smash. */
const smash: Clip = {
  id: 'smash', dur: 1.7,
  num: {
    nSh: [[0, 0.5], [0.45, 3.05, 'out'], [0.6, 3.15], [0.72, 0.55, 'in'], [0.86, 0.5], [1, 0.5]], fSh: [[0, 0.45], [0.47, 3.0, 'out'], [0.6, 3.1], [0.72, 0.5, 'in'], [1, 0.45]],
    nEl: [[0, 0.4], [0.45, 0.75], [0.72, 0.05], [1, 0.4]], fEl: [[0, 0.4], [0.47, 0.8], [0.72, 0.05], [1, 0.4]],
    lean: [[0, 0.12], [0.45, -0.38, 'out'], [0.6, -0.42], [0.73, 0.75, 'in'], [0.86, 0.68], [1, 0.12]],
    crouch: [[0, 0], [0.45, -0.04], [0.74, 0.38, 'in'], [0.88, 0.32], [1, 0]], head: [[0, 0], [0.45, -0.3], [0.73, 0.35], [1, 0]],
  },
  ev: [[0.45, 'roar'], [0.72, 'smash'], [0.74, 'shake']],
};
/** Ferryman: grab a survivor (or plank) and drag it back. */
const grabDrag: Clip = {
  id: 'grabDrag', dur: 1.5,
  num: {
    nSh: [[0, 0.5], [0.3, 1.7, 'out'], [0.45, 1.6], [0.8, 0.5, 'in'], [1, 0.5]], nEl: [[0, 0.4], [0.3, 0.05], [0.45, 0.3], [0.8, 1.6], [1, 0.4]],
    fSh: [[0, 0.45], [0.35, 1.55], [0.8, 0.6], [1, 0.45]], fEl: [[0, 0.4], [0.35, 0.1], [0.8, 1.4], [1, 0.4]],
    lean: [[0, 0.12], [0.3, 0.5], [0.8, -0.25], [1, 0.12]], px: [[0, 0], [0.3, 6], [0.85, -14], [1, -14]],
  },
  ev: [[0.42, 'grab'], [0.8, 'drag']],
};
const stagger: Clip = {
  id: 'stagger', dur: 0.8, fadeIn: 0.05,
  num: {
    lean: [[0, 0.1], [0.2, -0.45, 'out'], [0.55, 0.15], [1, 0.1]], px: [[0, 0], [0.4, -12], [1, -12]],
    nSh: [[0, 1.2], [0.25, 2.3], [0.6, 0.8], [1, 1.2]], fSh: [[0, 1.1], [0.25, -0.4], [0.6, 0.9], [1, 1.1]],
    head: [[0, 0], [0.2, -0.5], [0.6, 0.3], [1, 0]], nFx: [[0, 6], [0.3, -10], [1, 4]], fFx: [[0, -8], [0.5, -20], [1, -8]],
  },
  ev: [[0.3, 'step'], [0.55, 'step']],
};
/** Knocked flat on the back, then up again. */
const knockdown: Clip = {
  id: 'knockdown', dur: 2.4, fadeIn: 0.05,
  num: {
    lean: [[0, 0], [0.18, -0.9, 'in'], [0.3, -1.52], [0.62, -1.52], [0.78, 0.85], [0.9, 0.4], [1, 0]],
    crouch: [[0, 0], [0.26, 0.97, 'in'], [0.66, 0.97], [0.8, 0.7], [0.92, 0.2], [1, 0]],
    px: [[0, 0], [0.3, -24], [1, -24]],
    nSh: [[0, 1.2], [0.2, 2.6], [0.3, 2.2], [0.62, 2.0], [0.74, 0.6], [1, 1.2]], fSh: [[0, 1.1], [0.2, 2.8], [0.3, 2.4], [0.62, 1.8], [0.74, -0.2], [1, 1.1]],
    head: [[0, 0], [0.3, 0.5], [0.62, 0.3], [0.8, -0.2], [1, 0]],
    nFx: [[0, 6], [0.3, 40], [0.66, 40], [0.8, 16], [1, 6]], fFx: [[0, -8], [0.3, 26], [0.66, 30], [0.8, 0], [1, -8]],
    nFy: [[0, 0], [0.3, -8], [0.6, 0], [1, 0]],
  },
  ev: [[0.3, 'thud'], [0.7, 'getUp']],
};
/** Climbing the corpse ramp / over the barricade lip. */
const climb: Clip = {
  id: 'climb', dur: 1.6,
  num: {
    px: [[0, 0], [1, 34]], py: [[0, 0], [0.5, -34], [1, -62]], lean: [[0, 0.5], [0.5, 0.7], [1, 0.35]],
    nSh: [[0, 2.6], [0.3, 1.6], [0.5, 2.7], [0.8, 1.4], [1, 2.4]], fSh: [[0, 1.8], [0.3, 2.7], [0.6, 1.5], [0.85, 2.6], [1, 1.8]],
    nEl: [[0, 0.4], [0.3, 1.3], [0.5, 0.3], [0.8, 1.4], [1, 0.4]], fEl: [[0, 1.2], [0.3, 0.3], [0.6, 1.4], [0.85, 0.3], [1, 1.2]],
    nFx: [[0, 22], [0.25, 22], [0.45, 30], [1, 30]], nFy: [[0, -30], [0.25, -30], [0.4, -66], [1, -66]],
    fFx: [[0, -10], [0.55, -10], [0.75, 14], [1, 14]], fFy: [[0, 0], [0.55, 0], [0.7, -50], [1, -50]], head: [[0, -0.5], [1, -0.3]],
  },
  ev: [[0.3, 'climbStep'], [0.62, 'climbStep'], [0.9, 'climbStep']],
};
// idles
const idleSniff: Clip = { id: 'idleSniff', dur: 1.6, fadeIn: 0.3, fadeOut: 0.3, num: { head: [[0, 0], [0.2, -0.45], [0.3, -0.38], [0.4, -0.48], [0.5, -0.4], [0.62, -0.5], [1, 0]], lean: [[0, 0.05], [0.3, -0.04], [1, 0.05]] }, ev: [[0.3, 'sniff'], [0.5, 'sniff']] };
const idleSway: Clip = { id: 'idleSway', dur: 2.6, fadeIn: 0.4, fadeOut: 0.4, num: { lean: [[0, 0.1], [0.3, 0.24], [0.65, -0.02], [1, 0.1]], tilt: [[0, 0], [0.3, 0.06], [0.65, -0.04], [1, 0]], head: [[0, 0.3], [0.5, 0.6], [1, 0.3]], nSh: [[0, 0.1], [0.5, 0.3], [1, 0.1]], fSh: [[0, 0.05], [0.5, -0.1], [1, 0.05]] } };
const idleTurn: Clip = { id: 'idleTurn', dur: 2.0, fadeIn: 0.15, fadeOut: 0.15, num: { head: [[0, 0], [0.2, -0.2], [0.8, -0.25], [1, 0]], lean: [[0, 0.05], [0.25, -0.06], [1, 0.05]] }, set: [[0.18, 'headFlip', 1], [0.82, 'headFlip', 0]], ev: [[0.18, 'turn']] };
// archetype specials
const keen: Clip = { id: 'keen', dur: 2.0, fadeIn: 0.25, num: { lean: [[0, 0.3], [0.3, -0.35, 'out'], [0.85, -0.3], [1, 0.3]], head: [[0, 0], [0.3, -0.9], [0.85, -0.85], [1, 0]], nSh: [[0, 0.5], [0.3, 0.3], [1, 0.5]], fSh: [[0, 0.4], [0.3, 0.2], [1, 0.4]], nEl: [[0, 1.2], [0.3, 1.6], [1, 1.2]] }, ev: [[0.3, 'scream']] };
const retch: Clip = { id: 'retch', dur: 1.4, num: { lean: [[0, 0.1], [0.35, 0.6], [0.45, 0.4], [0.6, 0.85, 'in'], [1, 0.1]], head: [[0, 0], [0.35, 0.4], [0.6, -0.3], [1, 0]], crouch: [[0, 0], [0.6, 0.2], [1, 0]], nSh: [[0, 0.3], [0.35, 0.6], [0.6, -0.2], [1, 0.3]] }, ev: [[0.35, 'gag'], [0.6, 'spit']] };
const vault: Clip = { id: 'vault', dur: 1.2, num: { crouch: [[0, 0], [0.35, 0.6], [0.45, 0], [0.8, 0.45], [1, 0]], py: [[0, 0], [0.45, 0], [0.62, -60, 'out'], [0.8, 0, 'in'], [1, 0]], px: [[0, 0], [0.45, 0], [0.8, 70], [1, 70]], lean: [[0, 0.3], [0.35, 0.8], [0.6, 0.1], [0.8, 0.7], [1, 0.3]], nFy: [[0, 0], [0.5, -20], [0.78, 0], [1, 0]], fFy: [[0, 0], [0.5, -26], [0.78, 0], [1, 0]] }, ev: [[0.35, 'crouch'], [0.45, 'leap'], [0.8, 'land']] };
const toll: Clip = { id: 'toll', dur: 3.0, num: { lean: [[0, 0.1], [0.4, -0.3, 'out'], [0.6, 0.45, 'in'], [1, 0.1]], nSh: [[0, 0.6], [0.4, 2.4], [0.6, 0.8], [1, 0.6]], fSh: [[0, 0.5], [0.42, 2.3], [0.62, 0.7], [1, 0.5]] }, ev: [[0.6, 'toll']] };
const burstWindup: Clip = { id: 'burstWindup', dur: 1.2, num: { lean: [[0, -0.1], [0.5, -0.3], [0.8, 0.1], [1, -0.4]], crouch: [[0, 0], [0.7, 0.15], [1, -0.05]], nSh: [[0, 0.4], [0.8, 0.8], [1, 2.4]], fSh: [[0, 0.3], [0.8, 0.7], [1, 2.2]] }, ev: [[0.5, 'gurgle'], [1, 'burst']] };
// authored deaths that still beat ragdoll where they matter
const deathChoke: Clip = { id: 'deathChoke', dur: 1.8, hold: true, num: { lean: [[0, 0.1], [0.3, -0.3], [0.7, 0.5], [1, 1.2, 'in']], crouch: [[0, 0], [0.5, 0.3], [1, 0.9, 'in']], head: [[0, 0], [0.3, -0.8], [1, 0.4]] }, n: [[0, null], [0.2, B('face', -4, 14, 'fist')], [0.9, B('face', -4, 14, 'fist')]], f: [[0, null], [0.25, B('face', -8, 16, 'fist')], [0.9, B('face', -8, 16, 'fist')]], ev: [[0.2, 'choke'], [1, 'ragdoll']] };
/** A crippling leg hit: the legs go and it drops to the ground (then crawls). */
const buckle: Clip = { id: 'buckle', dur: 0.8, fadeOut: 0.2, num: { crouch: [[0, 0], [0.35, 0.55, 'in'], [1, 0.0]], lean: [[0, 0.1], [0.35, 0.6], [1, 1.42, 'in']], py: [[0, 0], [0.35, 0], [1, 0]], head: [[0, 0], [0.5, 0.4], [1, -0.9]], nSh: [[0, 1], [0.6, 2.4], [1, 2.6]], fSh: [[0, 1], [0.6, 2.2], [1, 2.4]] }, ev: [[0.35, 'buckle'], [0.95, 'thud']] };
const deathCollapse: Clip = { id: 'deathCollapse', dur: 0.9, hold: true, num: { crouch: [[0, 0], [0.6, 0.85, 'in'], [1, 0.95]], lean: [[0, 0.1], [0.5, 0.4], [1, 1.1, 'in']], head: [[0, 0], [1, 0.6]], nSh: [[0, 0.5], [1, 0.1]], fSh: [[0, 0.4], [1, 0.0]] }, ev: [[0.6, 'knees'], [1, 'ragdoll']] };

// ---- gun handling between reloads (the leader at the wall)
/** Tap-rack: slap the magazine home, rack the action, back on target. */
const tapRack: Clip = {
  id: 'tapRack', dur: 0.9,
  num: { ready: [[0, 0], [0.12, 0.55], [0.8, 0.5], [1, 0]], gunTilt: [[0, 0], [0.12, -0.3], [0.45, -0.1], [0.75, -0.15], [1, 0]], head: [[0, 0], [0.15, 0.3], [0.85, 0.2], [1, 0]] },
  n: [[0, null], [0.14, G('magwell', 0, 22, 'open')], [0.26, G('magwell', 0, 4, 'open'), 'in'], [0.42, G('rack', 0, 0, 'pinch')], [0.58, G('rack', -14, 0, 'pinch'), 'out'], [0.66, G('rack', 0, 0, 'pinch'), 'in'], [1, null]],
  ev: [[0.26, 'tap'], [0.58, 'rack'], [0.66, 'rackFwd']],
};
/** Double-feed: lock the action open, rip the magazine, rack it clear three times, magazine back in, rack. */
const stripFeed: Clip = {
  id: 'stripFeed', dur: 2.6,
  num: {
    ready: [[0, 0], [0.08, 0.75], [0.9, 0.7], [1, 0]],
    gunTilt: [[0, 0], [0.08, -0.4], [0.3, -0.55], [0.6, -0.5], [0.85, -0.2], [1, 0]],
    head: [[0, 0], [0.1, 0.4], [0.9, 0.3], [1, 0]], lean: [[0, 0], [0.1, 0.08], [0.9, 0.08], [1, 0]],
  },
  n: [
    [0, null], [0.08, G('rack', 0, 0, 'pinch')], [0.14, G('rack', -14, 0, 'pinch'), 'out'],
    [0.2, G('magwell', 0, 6, 'fist')], [0.28, G('magwell', -2, 34, 'fist'), 'out'],
    [0.34, G('rack', 0, 0, 'pinch')], [0.39, G('rack', -14, 0, 'pinch'), 'out'], [0.43, G('rack', 0, 0, 'pinch')],
    [0.48, G('rack', -14, 0, 'pinch'), 'out'], [0.52, G('rack', 0, 0, 'pinch')], [0.57, G('rack', -14, 0, 'pinch'), 'out'], [0.6, G('rack', 0, 0, 'pinch')],
    [0.66, G('magwell', 0, 26, 'fist')], [0.74, G('magwell', 0, 6, 'fist'), 'in'],
    [0.8, G('rack', 0, 0, 'pinch')], [0.86, G('rack', -14, 0, 'pinch'), 'out'], [0.9, G('rack', 0, 0, 'pinch')], [1, null],
  ],
  set: [[0.22, 'mag', 'hand'], [0.74, 'mag', 'gun']],
  ev: [[0.14, 'lock'], [0.24, 'magOut'], [0.39, 'rack'], [0.48, 'rack'], [0.57, 'rack'], [0.74, 'magIn'], [0.86, 'rack']],
};
/** A different gun comes up off the sling: low and canted, then on target. */
const drawGun: Clip = {
  id: 'drawGun', dur: 0.6, fadeIn: 0.02,
  num: { ready: [[0, 1], [0.25, 0.9], [1, 0, 'out']], gunTilt: [[0, 0.9], [0.3, 0.6], [1, 0, 'out']], gunDY: [[0, 18], [1, 0, 'out']], head: [[0, 0.25], [1, 0]] },
  n: [[0, B('chest', 10, 10, 'open')], [0.5, null]],
  ev: [[0.05, 'draw'], [0.85, 'ready']],
};

// ---- hit reactions for the Turned (night/impact.ts tiers). Stretched to the simulation's
// stun / down time; every fall clip ends standing (the get-up is part of it), x stays with the
// simulation's slide (no px), py only for lying low.
/** Stagger B: knocked back on the heels, arms windmilling for balance. */
const staggerB: Clip = {
  id: 'staggerB', dur: 0.8, fadeIn: 0.04,
  num: {
    lean: [[0, 0.1], [0.18, -0.55, 'out'], [0.45, -0.2], [0.7, 0.25], [1, 0.1]], crouch: [[0, 0], [0.5, 0.12], [1, 0]],
    nSh: [[0, 1.0], [0.2, 2.9], [0.45, 0.2], [0.7, 2.2], [1, 1.0]], fSh: [[0, 0.9], [0.25, -0.6], [0.5, 2.6], [0.75, 0.4], [1, 0.9]],
    nEl: [[0, 0.3], [0.3, 0.9], [0.6, 0.2], [1, 0.3]], fEl: [[0, 0.3], [0.4, 1.0], [1, 0.3]],
    head: [[0, 0], [0.15, -0.7], [0.5, 0.25], [1, 0]], nFx: [[0, 6], [0.25, -14], [0.6, -4], [1, 4]], fFx: [[0, -8], [0.45, -24], [1, -10]],
  },
  ev: [[0.25, 'step'], [0.5, 'step']],
};
/** Stagger C: the hit turns the shoulders, a dip, a lurch to recover. */
const staggerC: Clip = {
  id: 'staggerC', dur: 0.7, fadeIn: 0.04,
  num: {
    lean: [[0, 0.1], [0.15, -0.25, 'out'], [0.5, 0.45], [1, 0.1]], crouch: [[0, 0], [0.3, 0.22], [0.7, 0.05], [1, 0]], tilt: [[0, 0], [0.2, -0.12], [0.6, 0.08], [1, 0]],
    nSh: [[0, 1.1], [0.2, 0.2], [0.55, 1.8], [1, 1.1]], fSh: [[0, 1.0], [0.25, 2.2], [0.6, 0.6], [1, 1.0]],
    head: [[0, 0], [0.12, -0.6], [0.4, 0.55], [0.75, 0.1], [1, 0]], nFx: [[0, 6], [0.35, -6], [1, 6]], fFx: [[0, -8], [0.2, -18], [0.6, -12], [1, -8]],
  },
  ev: [[0.35, 'step']],
};
/** Dropped to the near knee (a leg hit): hand to the road, then up. */
const kneeDrop: Clip = {
  id: 'kneeDrop', dur: 1.3, fadeIn: 0.04, fadeOut: 0.15,
  num: {
    crouch: [[0, 0], [0.14, 0.62, 'in'], [0.66, 0.58], [0.9, 0.15, 'inout'], [1, 0]], lean: [[0, 0.1], [0.14, 0.62], [0.5, 0.45], [0.75, 0.55], [1, 0.1]],
    nFx: [[0, 6], [0.12, 26], [0.75, 26], [1, 6]], fFx: [[0, -8], [0.14, -34], [0.72, -34], [1, -8]],
    head: [[0, 0], [0.14, 0.5], [0.5, 0.15], [0.7, -0.25], [1, 0]],
    nSh: [[0, 1.0], [0.14, 0.5], [0.66, 0.5], [1, 1.0]], fSh: [[0, 0.9], [0.14, 1.6], [0.6, 1.2], [1, 0.9]], fEl: [[0, 0.3], [0.2, 0.9], [1, 0.3]],
  },
  n: [[0, null], [0.14, GR(30, 0, 'open', 0.3)], [0.62, GR(30, 0, 'open', 0.3)], [0.85, null]],
  ev: [[0.14, 'thud'], [0.7, 'getUp']],
};
/** Knees buckle on both sides: kneeling, swaying, then up (a hard body hit). */
const kneelSway: Clip = {
  id: 'kneelSway', dur: 1.5, fadeIn: 0.04, fadeOut: 0.15,
  num: {
    crouch: [[0, 0], [0.16, 0.85, 'in'], [0.68, 0.82], [0.9, 0.2, 'inout'], [1, 0]], lean: [[0, 0.1], [0.16, 0.25], [0.35, -0.12], [0.52, 0.3], [0.7, 0.6], [1, 0.1]],
    nFx: [[0, 6], [0.16, -22], [0.72, -22], [1, 6]], fFx: [[0, -8], [0.16, -30], [0.72, -30], [1, -8]],
    head: [[0, 0], [0.16, 0.7], [0.4, -0.3], [0.6, 0.6], [1, 0]],
    nSh: [[0, 1.0], [0.16, 0.1], [0.6, 0.25], [0.8, 1.6], [1, 1.0]], fSh: [[0, 0.9], [0.16, 0.0], [0.6, 0.2], [0.8, 1.4], [1, 0.9]],
  },
  ev: [[0.16, 'thud'], [0.72, 'getUp']],
};
/** Pitched forward onto hands and knees, then pushed back up. */
const fallFront: Clip = {
  id: 'fallFront', dur: 1.9, fadeIn: 0.04, fadeOut: 0.15,
  num: {
    lean: [[0, 0.1], [0.14, 0.9, 'in'], [0.22, 1.38], [0.62, 1.3], [0.78, 0.9], [0.9, 0.35], [1, 0.1]],
    crouch: [[0, 0], [0.22, 0.95, 'in'], [0.66, 0.95], [0.84, 0.6], [1, 0]], py: [[0, 0], [0.22, 14], [0.62, 14], [0.8, 0], [1, 0]],
    nFx: [[0, 6], [0.22, -36], [0.66, -36], [0.84, 0], [1, 6]], fFx: [[0, -8], [0.22, -48], [0.66, -48], [0.84, -16], [1, -8]],
    head: [[0, 0], [0.22, -0.7], [0.55, -0.4], [0.8, 0.2], [1, 0]],
  },
  n: [[0, null], [0.16, GR(62, 2, 'open', 0.2), 'out'], [0.66, GR(60, 2, 'open', 0.2)], [0.86, null]],
  f: [[0, null], [0.2, GR(46, 2, 'open', 0.3), 'out'], [0.62, GR(46, 2, 'open', 0.3)], [0.84, null]],
  ev: [[0.2, 'thud'], [0.7, 'getUp']],
};
/** Flat on the back, a roll to the side and up on an elbow (a variant of knockdown). */
const fallBack: Clip = {
  id: 'fallBack', dur: 2.2, fadeIn: 0.04, fadeOut: 0.15,
  num: {
    lean: [[0, 0.05], [0.16, -0.95, 'in'], [0.26, -1.5], [0.55, -1.45], [0.66, -0.6], [0.78, 0.7], [0.9, 0.35], [1, 0.1]],
    crouch: [[0, 0], [0.24, 0.97, 'in'], [0.68, 0.97], [0.84, 0.6], [1, 0]], py: [[0, 0], [0.26, 16], [0.62, 16], [0.8, 0], [1, 0]],
    nSh: [[0, 1.2], [0.16, 2.9], [0.3, 2.5], [0.55, 2.2], [0.66, 0.4], [0.8, 0.9], [1, 1.1]], fSh: [[0, 1.1], [0.16, 2.4], [0.3, 2.7], [0.6, 1.7], [0.75, -0.3], [1, 1.0]],
    nEl: [[0, 0.3], [0.3, 0.1], [0.6, 1.4], [1, 0.3]],
    head: [[0, 0], [0.2, 0.7], [0.4, 0.3], [0.62, -0.4], [0.8, 0.2], [1, 0]],
    nFx: [[0, 6], [0.26, 44], [0.58, 40], [0.72, 22], [0.86, 4], [1, 6]], fFx: [[0, -8], [0.26, 30], [0.58, 36], [0.74, -2], [1, -8]],
    nFy: [[0, 0], [0.2, -18], [0.32, 0], [1, 0]], fFy: [[0, 0], [0.24, -10], [0.34, 0], [1, 0]],
  },
  ev: [[0.26, 'thud'], [0.66, 'getUp']],
};
/** A running body (Deer) taken off its feet: goes over forward with its momentum, scrambles up. */
const tumble: Clip = {
  id: 'tumble', dur: 1.8, fadeIn: 0.03, fadeOut: 0.15,
  num: {
    lean: [[0, 0.3], [0.1, 1.2, 'in'], [0.2, 1.6], [0.32, 1.2], [0.6, 1.25], [0.8, 0.6], [1, 0.2]],
    crouch: [[0, 0], [0.18, 0.9, 'in'], [0.66, 0.92], [0.86, 0.4], [1, 0]], py: [[0, 0], [0.2, 18], [0.6, 16], [0.8, 0], [1, 0]],
    tilt: [[0, 0], [0.16, 0.3], [0.3, -0.15], [0.5, 0], [1, 0]],
    nSh: [[0, 1.0], [0.12, 2.6], [0.3, 0.6], [0.6, 0.4], [0.82, 1.4], [1, 1.0]], fSh: [[0, 0.9], [0.14, 2.8], [0.32, 1.9], [0.62, 0.3], [1, 0.9]],
    head: [[0, 0], [0.18, -0.6], [0.4, 0.4], [0.7, -0.2], [1, 0]],
    nFx: [[0, 6], [0.2, -50], [0.62, -40], [0.82, -6], [1, 6]], fFx: [[0, -8], [0.18, -30], [0.6, -54], [0.84, -14], [1, -8]],
    nFy: [[0, 0], [0.12, -26], [0.22, 0], [1, 0]],
  },
  ev: [[0.2, 'thud'], [0.72, 'getUp']],
};

export const CLIPS: Record<string, Clip> = Object.fromEntries([
  staggerB, staggerC, kneeDrop, kneelSway, fallFront, fallBack, tumble,
  reloadMag(true), reloadMag(false), reloadPistol(true), reloadPistol(false), shellIn, pump, reloadBolt, boltCycle, leverCycle, reloadRevolver,
  reloadBreak, nockBow, reloadCrossbow, reloadMuzzle, reloadTube, chop, sweep, rummage, hitHead, hitTorso, hitLeg, hitArm, twitch,
  claw, grabBite, pound, lunge, pantStop, smash, grabDrag, stagger, knockdown, climb, idleSniff, idleSway, idleTurn, keen, retch, vault, toll, burstWindup,
  deathChoke, deathCollapse, buckle, tapRack, stripFeed, drawGun,
].map((c) => [c.id, c]));

/** Which clip(s) a reload kind uses. `perRound` clips are repeated once per round loaded. */
export const RELOADS: Record<string, { clip: string; empty?: string; perRound?: boolean; finish?: string }> = {
  mag: { clip: 'reloadMag', empty: 'reloadMagEmpty' },
  pistolMag: { clip: 'reloadPistol', empty: 'reloadPistolEmpty' },
  shells: { clip: 'shellIn', perRound: true, finish: 'pump' },
  lever: { clip: 'shellIn', perRound: true, finish: 'leverCycle' },
  bolt: { clip: 'reloadBolt' },
  revolver: { clip: 'reloadRevolver' },
  break: { clip: 'reloadBreak' },
  bow: { clip: 'nockBow' },
  crossbow: { clip: 'reloadCrossbow' },
  muzzle: { clip: 'reloadMuzzle' },
  tube: { clip: 'reloadTube' },
};
