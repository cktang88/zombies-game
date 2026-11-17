// Procedural sound: no audio files, just shaped noise and oscillators.
//
// =====================================================================================
//  GUN AUDIO API — for the battle / expedition integrator
// =====================================================================================
//
//  One call per trigger pull (per round for bursts; the coach gun's two simultaneous
//  barrels are merged automatically — any two calls of one family within 12 ms are):
//
//    sfx.shoot(def.id, { suppressed, far, incendiary, pan })   // gun + casing, from the weapon id
//    sfx.gun(kind, opts)                                        // just the shot, by family
//
//  `gunSoundFor(defId)` → { kind, reload, casing, casingDelay } tells you everything:
//
//    weapon id   kind          reload     casing        weapon id   kind          reload    casing
//    service9    pistol        pistol     small         hunting     boltRifle     bolt      brass .8s
//    revolver    magnum        revolver   — (on 'out')  lever       lever         lever     brass .45s
//    m1911       pistol45      pistol     brass         scoped      marksman      bolt      brass .9s
//    mp93        burst         pistol     small         muzzle      muzzleloader  muzzle    —
//    smg         smg           smg        small         ar15        ar            rifle     brass
//    r22         rimfire       rifle      small         carbine     carbine       rifle     brass
//    pump        pump          pump       hull .5s      lmg         lmg           lmg       link
//    coach       double        double     — (on 'out')  compound    bow           bow       —
//    snake410    shotgun410    single     —             crossbow    crossbow      crossbow  —
//    pipe        pipe          single     —             flaregun    flare         flare     —
//    autoshot    autoshot      pump       hull .25s     nailer      nailer        nailer    —
//                                                       rivet       rivet         nailer    —
//    (also: rocket, grenade — launchers, not yet in WEAPONS)
//
//  GunOpts: suppressed (WeaponItem has the suppressor mod) · far: true | 0..1 (guards'
//  guns: low-pass + sound-travel delay + more echo) · action: false to skip the pump/
//  bolt/lever cycle (e.g. the last round) · pan -1..1 · delay s · volume · incendiary.
//  Variation is built in: 4 pre-rendered takes per family, round-robin, ±2.5% rate,
//  ±8% gain; so full-auto never machine-guns one sample.
//
//  Impacts (one per projectile is fine — repeats inside 25 ms are merged):
//    sfx.impact('flesh' | 'head' | 'bone' | 'armor' | 'ricochet' | 'metal' | 'wood' | 'ground' | 'burst', { volume?, delay? })
//      body hit → flesh · headshot/decap → head · weakspot/limb snap → bone · Deputy plate
//      → armor (25% of armor hits auto-add a ricochet whine) · barricade → wood · miss →
//      ground · pulper pops → burst
//    sfx.confirm(streak)            kill-confirm tick, pitch +6% per kill in a streak
//                                   (streak = kills within ~1.5 s; 1 for the first)
//
//  Reloads & handling:
//    sfx.reload(kind, stage)        kind = gunSoundFor(id).reload; stage 'out' | 'in' |
//                                   'rack' | 'shell' | 'bolt' | 'close' | 'arrow'
//    sfx.reloadFor(defId, seconds, rounds?) → { cancel() }
//                                   schedules a whole reload's stages across `seconds`;
//                                   cancel() if the reload is interrupted / weapon swapped.
//                                   Per-shell guns (pump, lever, autoshot): call
//                                   sfx.reload(kind, 'shell') per shell instead, then 'rack'.
//    sfx.casing(kind, delay?)       'brass' | 'small' | 'big' | 'hull' | 'link' (shoot() does it)
//    sfx.dry()  sfx.jam()  sfx.overheat()  sfx.explosion(size = 1)
//
//  Legacy calls still work and now use the new kit: shot(id|kind, far), click, reload(),
//  shell, hit, headpop, thud, wallHit, burst, boom, fire, groan, scream, hurt, bell, ui.
//
//  Mix: sfx → glue compressor → limiter → sfx volume → master → limiter. Loud shots duck
//  the music bus briefly. Max 40 voices (oldest low-priority voice is stolen).
//  Dev sound board: /soundboard.html (built alongside the game).
//
// =====================================================================================
//
// Other public API:
//   wind(on)                    low wind ambience used by the night canvases
//   music(mode)                 'title' | 'day' | 'night' | 'off' — crossfades beds
//   setMasterVolume / setMusicVolume / setSfxVolume (0..1)
//   setMuted(bool), muted
//
// Browsers only allow an AudioContext after a user gesture. music() may be called
// before that; the requested mode starts on the first pointer/key press.

import { Engine, Synth, bankFor } from './audio/engine';
import { GunKind } from './audio/guns';
import { GunOpts, playGun, prewarm, resolveGun } from './audio/gunbank';
import {
  CasingKind, ImpactKind, ReloadKind, ReloadStage,
  casing as casingFx, confirm as confirmFx, dryFire, explosion as explosionFx, impact as impactFx,
  jam as jamFx, overheat as overheatFx, reload as reloadFx, reloadPlan,
} from './audio/foley';
import { WEAPONS } from './data/weapons';

export type { GunKind } from './audio/guns';
export type { GunOpts } from './audio/gunbank';
export type { CasingKind, ImpactKind, ReloadKind, ReloadStage } from './audio/foley';

let ctx: AudioContext | null = null;
let E: Engine | null = null;
let sfxBus: GainNode | null = null;    // post-compressor sfx volume (wind goes straight here)
let musicBus: GainNode | null = null;  // music input (ducked)
let reverb: ConvolverNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;

const vol = { master: 0.7, music: 0.55, sfx: 0.8 };

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    E = new Engine(ctx);
    E.master.gain.value = muted ? 0 : vol.master;
    E.sfxVol.gain.value = vol.sfx;
    E.musicVol.gain.value = vol.music;
    sfxBus = E.sfxVol;
    musicBus = E.musicIn;
    noiseBuf = bankFor(ctx).white;
    // a long, dark room for the music: decaying noise impulse
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 4.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(musicBus);
    if (wantMode !== mode) queueMicrotask(() => music(wantMode));
    // render the gun bank in the background (a few hundred ms of offline work)
    const sr = ctx.sampleRate;
    setTimeout(() => void prewarm(sr), 250);
  }
  if (ctx.state === 'suspended' && !document.hidden) void ctx.resume();
  return ctx;
}
function engine(): Engine | null {
  if (muted) return null;
  ac();
  return E;
}

// Start audio (and any pending music) on the first gesture.
function unlock() {
  ac();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
function ramp(p: AudioParam | undefined, v: number) {
  if (!p || !ctx) return;
  p.cancelScheduledValues(ctx.currentTime);
  p.setTargetAtTime(v, ctx.currentTime, 0.05);
}

export function setMuted(m: boolean) {
  muted = m;
  ramp(E?.master.gain, m ? 0 : vol.master);
}
export function setMasterVolume(v: number) {
  vol.master = clamp01(v);
  if (!muted) ramp(E?.master.gain, vol.master);
}
export function setMusicVolume(v: number) {
  vol.music = clamp01(v);
  ramp(E?.musicVol.gain, vol.music);
}
export function setSfxVolume(v: number) {
  vol.sfx = clamp01(v);
  ramp(E?.sfxVol.gain, vol.sfx);
}

// ---------------------------------------------------------------------------
// Weapon → sound mapping
// ---------------------------------------------------------------------------
export interface GunSound { kind: GunKind; reload: ReloadKind; casing: CasingKind | null; casingDelay: number }

const GUN_SOUNDS: Record<string, [GunKind, ReloadKind, CasingKind | null, number?]> = {
  service9: ['pistol', 'pistol', 'small'],
  revolver: ['magnum', 'revolver', null],
  m1911: ['pistol45', 'pistol', 'brass'],
  mp93: ['burst', 'pistol', 'small'],
  smg: ['smg', 'smg', 'small'],
  r22: ['rimfire', 'rifle', 'small'],
  pump: ['pump', 'pump', 'hull', 0.5],
  coach: ['double', 'double', null],
  snake410: ['shotgun410', 'single', null],
  pipe: ['pipe', 'single', null],
  autoshot: ['autoshot', 'pump', 'hull', 0.25],
  hunting: ['boltRifle', 'bolt', 'brass', 0.8],
  lever: ['lever', 'lever', 'brass', 0.45],
  scoped: ['marksman', 'bolt', 'brass', 0.9],
  muzzle: ['muzzleloader', 'muzzle', null],
  ar15: ['ar', 'rifle', 'brass'],
  carbine: ['carbine', 'rifle', 'brass'],
  lmg: ['lmg', 'lmg', 'link'],
  compound: ['bow', 'bow', null],
  crossbow: ['crossbow', 'crossbow', null],
  flaregun: ['flare', 'flare', null],
  nailer: ['nailer', 'nailer', null],
  rivet: ['rivet', 'nailer', null],
};

/** Which sounds a weapon (WEAPONS id) uses. Unknown ids fall back by caliber. */
export function gunSoundFor(defId: string): GunSound {
  const m = GUN_SOUNDS[defId];
  if (m) return { kind: m[0], reload: m[1], casing: m[2], casingDelay: m[3] ?? 0.3 };
  const k = resolveGun(defId);
  if (k) return { kind: k, reload: 'rifle', casing: null, casingDelay: 0.3 };
  const d = WEAPONS[defId];
  const cal = d?.caliber;
  if (cal === 'shot') return { kind: 'pump', reload: 'pump', casing: 'hull', casingDelay: 0.5 };
  if (cal === 'rifle') return { kind: 'boltRifle', reload: 'bolt', casing: 'brass', casingDelay: 0.8 };
  if (cal === 'r556') return { kind: d?.auto ? 'carbine' : 'ar', reload: 'rifle', casing: 'brass', casingDelay: 0.3 };
  if (cal === 'ball') return { kind: 'muzzleloader', reload: 'muzzle', casing: null, casingDelay: 0 };
  if (cal === 'bolt') return { kind: 'crossbow', reload: 'crossbow', casing: null, casingDelay: 0 };
  if (cal === 'nails') return { kind: 'nailer', reload: 'nailer', casing: null, casingDelay: 0 };
  if (cal === 'flare') return { kind: 'flare', reload: 'flare', casing: null, casingDelay: 0 };
  if (cal === 'r22') return { kind: 'rimfire', reload: 'rifle', casing: 'small', casingDelay: 0.3 };
  return { kind: d?.auto ? 'smg' : 'pistol', reload: d?.auto ? 'smg' : 'pistol', casing: 'small', casingDelay: 0.3 };
}

// legacy sfx.shot kinds from shotSound() in weapons.ts
const LEGACY_SHOT: Record<string, GunKind> = { hunting: 'boltRifle', nailer: 'nailer', pump: 'pump', smg: 'smg', carbine: 'carbine' };

// ---------------------------------------------------------------------------
// Small helpers for the legacy one-liners
// ---------------------------------------------------------------------------
function noise(dur: number, freq: number, q: number, v: number, decay: number, type: BiquadFilterType = 'lowpass', when = 0) {
  const e = engine();
  if (!e) return;
  e.synth(when, decay + 0.1, { pri: 0 }).noise({ dur: Math.max(dur, decay), v, f: freq, q, type });
}
function tone(freq: number, dur: number, v: number, type: OscillatorType = 'sine', slide = 0, when = 0) {
  const e = engine();
  if (!e) return;
  e.synth(when, dur + 0.1, { pri: 0 }).tone({ f: freq, f2: slide ? Math.max(20, freq + slide) : undefined, dur, v, type });
}
/** Run a foley synth on a fresh voice. */
function fx(len: number, draw: (s: Synth) => void, o: { delay?: number; gate?: string; gap?: number; rev?: number; echo?: number; volume?: number; pri?: number; far?: boolean } = {}) {
  const e = engine();
  if (!e) return;
  const delay = o.delay ?? 0;
  if (o.gate && !e.gate(o.gate, e.now + delay, o.gap ?? 0.025)) return;
  draw(e.synth(delay, len, { gain: o.volume ?? 1, rev: o.rev ?? 0.08, echo: o.echo ?? 0, pri: o.pri ?? 0, far: o.far }));
}

let casingCount = 0;

export const sfx = {
  // ---- guns ------------------------------------------------------------------------
  /** One shot of a gun family (GunKind or alias like '22', '410', 'rifle-bolt', 'assault'). */
  gun(kind: GunKind | string, opts: GunOpts = {}) {
    const e = engine();
    if (e) playGun(e, kind, opts);
  },
  /** One trigger pull of a WEAPONS id: the shot + its ejected casing. */
  shoot(defId: string, opts: GunOpts = {}) {
    const g = gunSoundFor(defId);
    const e = engine();
    if (!e || !playGun(e, g.kind, opts)) return;
    // casings: skip for distant guns; thin them out under full-auto
    if (g.casing && !opts.far && (g.kind !== 'lmg' && g.kind !== 'smg' && g.kind !== 'carbine' || casingCount++ % 3 === 0)) {
      sfx.casing(g.casing, (opts.delay ?? 0) + g.casingDelay + Math.random() * 0.15);
    }
  },
  // ---- impacts ---------------------------------------------------------------------
  impact(kind: ImpactKind, o: { volume?: number; delay?: number } = {}) {
    const rev = kind === 'burst' ? 0.2 : kind === 'ricochet' || kind === 'armor' ? 0.15 : 0.06;
    fx(kind === 'burst' ? 0.9 : 0.45, (s) => impactFx(s, kind), { ...o, gate: `imp:${kind}`, gap: 0.025, rev, pri: kind === 'head' || kind === 'burst' ? 1 : 0 });
    if (kind === 'armor' && Math.random() < 0.25) fx(0.5, (s) => impactFx(s, 'ricochet'), { delay: (o.delay ?? 0) + 0.02, gate: 'imp:ric', gap: 0.15, rev: 0.2, volume: o.volume });
  },
  /** Kill-confirm tick. streak = consecutive kills within ~1.5 s (1 = first). */
  confirm(streak = 1) {
    fx(0.1, (s) => confirmFx(s, streak), { gate: 'confirm', gap: 0.04, rev: 0, pri: 1 });
  },
  // ---- reloads & handling ----------------------------------------------------------
  /** A reload stage for a reload family. Called with no arguments: the legacy generic sound. */
  reload(kind: ReloadKind = 'rifle', stage: ReloadStage = 'in', delay = 0) {
    fx(0.8, (s) => reloadFx(s, kind, stage), { delay, rev: 0.05, pri: 1 });
  },
  /** Schedule a whole reload for a WEAPONS id across `seconds`. cancel() stops what hasn't played. */
  reloadFor(defId: string, seconds: number, rounds?: number) {
    const g = gunSoundFor(defId);
    const r = rounds ?? WEAPONS[defId]?.mag ?? 1;
    const timers: number[] = [];
    for (const [stage, f] of reloadPlan(g.reload, r)) {
      timers.push(window.setTimeout(() => sfx.reload(g.reload, stage), Math.max(0, f * seconds) * 1000));
    }
    return { cancel() { for (const t of timers) clearTimeout(t); timers.length = 0; } };
  },
  casing(kind: CasingKind = 'brass', delay = 0.3 + Math.random() * 0.15) {
    fx(0.5, (s) => casingFx(s, kind), { delay, gate: `case:${kind}`, gap: 0.05, rev: 0.03 });
  },
  dry() { fx(0.1, dryFire, { gate: 'dry', gap: 0.05, pri: 1 }); },
  jam() { fx(0.4, jamFx, { pri: 1 }); },
  overheat() { fx(1.4, overheatFx, { gate: 'heat', gap: 0.5 }); },
  explosion(size = 1, o: { delay?: number; far?: boolean } = {}) {
    const e = engine();
    if (!e) return;
    fx(3 * size + 0.5, (s) => explosionFx(s, size), { delay: o.delay, far: o.far, rev: 0.6, echo: 0.5, pri: 3, volume: o.far ? 0.5 : 1 });
    e.duck(0.9 * Math.min(1, size), o.delay ?? 0);
  },

  // ---- legacy ----------------------------------------------------------------------
  /** Legacy: a WEAPONS id, a GunKind/alias or a shotSound() name. far = a guard's gun. */
  shot(kind: string, far = false) {
    if (GUN_SOUNDS[kind] || WEAPONS[kind]) { sfx.shoot(kind, { far }); return; }
    sfx.gun(LEGACY_SHOT[kind] ?? resolveGun(kind) ?? 'pistol', { far });
  },
  click() { sfx.dry(); },
  shell() { sfx.reload('pump', 'shell'); },
  hit() { sfx.impact('flesh'); },
  headpop() { sfx.impact('head'); },
  thud() { noise(0.15, 220, 1, 0.35, 0.15); },
  wallHit() { sfx.impact('wood'); },
  groan() { tone(80 + Math.random() * 60, 0.9, 0.06, 'sawtooth', -30); },
  scream() { tone(900 + Math.random() * 300, 1.2, 0.08, 'sawtooth', 500); tone(1300, 1.0, 0.04, 'triangle', -400); },
  burst() { sfx.impact('burst'); },
  boom() { sfx.explosion(1); },
  fire() { noise(0.6, 1200, 0.3, 0.15, 0.6, 'highpass'); },
  hurt() { tone(220, 0.25, 0.12, 'triangle', -120); },
  bell() { tone(392, 3, 0.18, 'sine'); tone(784, 2.5, 0.06, 'sine'); tone(523, 3, 0.05, 'sine'); },
  ui() { tone(600, 0.05, 0.05, 'triangle'); },
};

// Low wind drone for ambience
let windNode: AudioBufferSourceNode | null = null;
export function wind(on: boolean) {
  if (muted && on) return;
  const c = ac();
  if (on && !windNode) {
    windNode = c.createBufferSource();
    windNode.buffer = noiseBuf;
    windNode.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 280;
    const g = c.createGain();
    g.gain.value = 0.06;
    windNode.connect(f).connect(g).connect(sfxBus!);
    windNode.start();
  } else if (!on && windNode) {
    windNode.stop();
    windNode = null;
  }
}

// ---------------------------------------------------------------------------
// Music. Sparse on purpose: a drone, a few notes, then a long silence.
// ---------------------------------------------------------------------------

export type MusicMode = 'title' | 'day' | 'night' | 'off';
let mode: MusicMode = 'off';
let wantMode: MusicMode = 'off';
let bed: { stop: () => void } | null = null;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
// D natural minor, as semitone offsets
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Switch the music bed. Safe to call repeatedly and before any user gesture. */
export function music(m: MusicMode) {
  wantMode = m;
  if (!ctx || m === mode) return;
  bed?.stop();
  bed = null;
  mode = m;
  if (m !== 'off') bed = startBed(m);
}

function startBed(m: Exclude<MusicMode, 'off'>) {
  const c = ctx!;
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(musicBus!);
  out.connect(reverb!);
  out.gain.setValueAtTime(0, c.currentTime);
  out.gain.linearRampToValueAtTime(1, c.currentTime + (m === 'night' ? 5 : 8));

  let alive = true;
  const timers = new Set<number>();
  const oscs: AudioScheduledSourceNode[] = [];
  const later = (sec: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, sec * 1000);
    timers.add(id);
  };

  // --- voices -------------------------------------------------------------
  function drone(freqs: number[], v: number, cutoff: number, wave: OscillatorType = 'sawtooth') {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.6;
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(0.03, 0.07);
    const lg = c.createGain();
    lg.gain.value = cutoff * 0.35;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    oscs.push(lfo);
    const g = c.createGain();
    g.gain.value = v;
    for (const fr of freqs) {
      for (const det of [-7, 6]) {
        const o = c.createOscillator();
        o.type = wave;
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start();
        oscs.push(o);
      }
    }
    f.connect(g).connect(out);
  }

  // a plucked/struck note, somewhere between cello pizzicato and an old upright
  function pluck(freq: number, when: number, v: number, dur = 3.6) {
    const t = c.currentTime + when;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.9);
    const parts: [OscillatorType, number, number][] = [['triangle', 1, 1], ['sine', 2, 0.25], ['sawtooth', 1, 0.18]];
    for (const [type, mul, amp] of parts) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      o.detune.value = rand(-4, 4);
      const og = c.createGain();
      og.gain.value = amp;
      o.connect(og).connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    f.connect(g).connect(out);
  }

  // a slow bowed swell; tremolo for the night strings
  function bowed(freq: number, when: number, v: number, dur: number, tremolo = 0) {
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const vib = c.createOscillator();
    vib.frequency.value = 4.6;
    const vg = c.createGain();
    vg.gain.value = freq * 0.004;
    vib.connect(vg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(1400, freq * 4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = g;
    if (tremolo) {
      const tg = c.createGain();
      tg.gain.value = 0.6;
      const tl = c.createOscillator();
      tl.frequency.value = tremolo;
      const tla = c.createGain();
      tla.gain.value = 0.4;
      tl.connect(tla).connect(tg.gain);
      tl.start(t);
      tl.stop(t + dur + 0.1);
      g.connect(tg);
      node = tg;
    }
    o.connect(f).connect(g);
    node.connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }

  // a church bell across the river: inharmonic partials, muffled by distance
  function bell(when: number, v: number, base = mtof(55)) {
    const t = c.currentTime + when;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    f.connect(out);
    for (const [mul, amp, dec] of [[0.5, 0.6, 7], [1, 1, 6], [1.19, 0.5, 4.5], [1.5, 0.35, 4], [2, 0.3, 3.5], [2.74, 0.15, 2.5]] as const) {
      const o = c.createOscillator();
      o.frequency.value = base * mul;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(f);
      o.start(t);
      o.stop(t + dec + 0.1);
    }
  }

  // a heartbeat-ish thump
  function thump(when: number, v: number) {
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }

  // --- a phrase generator: a few notes, stepwise, falling more than rising ---
  let degree = 4;
  function phrase(root: number, v: number, spacing: [number, number]) {
    const n = 2 + Math.floor(Math.random() * 4);
    let t = 0.1;
    if (Math.random() < 0.5) pluck(mtof(root - 12), t, v * 0.8, 5);
    for (let i = 0; i < n; i++) {
      degree = Math.max(0, Math.min(9, degree + (Math.random() < 0.62 ? -1 : 1) * (Math.random() < 0.8 ? 1 : 2)));
      const oct = Math.floor(degree / 7);
      const midi = root + 12 * oct + MINOR[degree % 7];
      pluck(mtof(midi), t, v * rand(0.7, 1));
      t += rand(spacing[0], spacing[1]);
    }
    if (degree < 2 || degree > 8) degree = 4;
    return t;
  }

  // --- the beds -------------------------------------------------------------
  if (m === 'day' || m === 'title') {
    const title = m === 'title';
    drone([mtof(38), mtof(45)], title ? 0.03 : 0.022, title ? 340 : 260);
    const loop = () => {
      const len = phrase(50, title ? 0.06 : 0.05, title ? [1.4, 2.6] : [1.0, 2.0]);
      if (Math.random() < 0.18) bowed(mtof(38 + 12), len, 0.02, 9);
      later(len + rand(title ? 14 : 12, title ? 26 : 30), loop);
    };
    later(title ? 3 : rand(4, 9), loop);
    const bells = () => {
      if (Math.random() < 0.55) bell(0, 0.045);
      later(rand(50, 120), bells);
    };
    later(title ? 9 : rand(30, 80), bells);
  } else {
    // night: a low minor-second drone, a pulse that slowly quickens, high tremolo now and then
    drone([mtof(33), mtof(34)], 0.03, 170);
    const started = c.currentTime;
    const pulse = () => {
      const tension = Math.min(1, (c.currentTime - started) / 240);
      const period = 1.15 - tension * 0.4;
      thump(0, 0.12 + tension * 0.05);
      thump(0.26, 0.07 + tension * 0.03);
      // the pulse drops out for a while, then comes back
      later(Math.random() < 0.06 ? rand(8, 16) : period, pulse);
    };
    later(3, pulse);
    const strings = () => {
      const base = Math.random() < 0.5 ? 69 : 70;
      bowed(mtof(base), 0, 0.012, rand(7, 11), 9);
      if (Math.random() < 0.5) bowed(mtof(base + 1), 1.5, 0.008, rand(6, 9), 8.5);
      later(rand(22, 45), strings);
    };
    later(rand(10, 20), strings);
    const low = () => {
      bowed(mtof(MINOR[Math.floor(Math.random() * 3)] + 38), 0, 0.03, rand(8, 12));
      later(rand(25, 50), low);
    };
    later(rand(15, 30), low);
  }

  return {
    stop() {
      alive = false;
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 2.5);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      window.setTimeout(() => {
        for (const o of oscs) { try { o.stop(); } catch { /* already stopped */ } }
        out.disconnect();
      }, 2800);
    },
  };
}
