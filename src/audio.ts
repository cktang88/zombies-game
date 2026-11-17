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
//  RECORDED SAMPLES — zombies, melee, footsteps, searching, ambience (battle/expedition)
// =====================================================================================
//
//  ~300 short CC0 recordings live in public/sfx/ (≈3 MB mp3, mono; sources in CREDITS.md,
//  rebuilt by tools/sfx-build.py). src/audio/samples.ts fetches them lazily (core sets
//  are preloaded right after the first user gesture), decodes, caches and round-robins
//  the variants. Until a set has decoded — or if it never does — every call below falls
//  back to a procedural sound, so nothing ever goes silent. All of it goes through the
//  same voices, voice cap (40, plus max 7 zombie vocals at once), buses and volume
//  settings as the gun kit.
//
//    sfx.zombieVoice(type, kind, { pan?, far?, delay?, volume? })
//        type: 'sleeper' | 'deer' | 'pulper' | 'crier' | 'ferryman' | 'drag' | 'leaper'
//              | 'spitter' | 'bellwether' | 'deputy'   (unknown ids → sleeper)
//        kind: 'idle'  — ambient groan; call rarely (each zombie every ~4–12 s, ≤ 2–3/s
//                        across the horde: idles are dropped first when vocals pile up)
//              'alert' — spotted the player / reached the barricade
//              'attack'— a swing/bite/lunge (Crier: its scream; Spitter: the spit)
//              'pain'  — took a non-lethal hit (throttled per type, so call it freely)
//              'death' — killed (pair it with impact('head'|'flesh') yourself)
//        Each type has its own voice: Deer pant and snarl, Pulpers gurgle, Criers
//        scream, the Ferryman and the Bellwether are pitched down and huge, Drags are
//        low and quiet, Leapers fast and sharp, Spitters hiss and hawk.
//
//    sfx.melee(kind, weapon?, { pan?, delay?, volume? })
//        kind: 'swing' (the whoosh, call at the start of the swing) | 'hit' (connects
//        with a zombie) | 'heavy' (a charged/critical/finishing blow: crunch + bone).
//        weapon: any weapon id or name — matched loosely: machete/hatchet/axe/knife/
//        sickle/cleaver/blade → blade; crowbar/pipe/wrench/rebar → metal blunt; bat/
//        club/plank/shovel/hammer/sledge → wooden/blunt; heavy ones get the slow whoosh.
//
//    sfx.footstep(surface, { pan?, volume?, far? })
//        surface: 'asphalt' | 'leaves' | 'gravel' | 'wood' | 'grass' | 'mud'
//        One call per footfall (≈ every 0.35–0.5 s walking); throttled at 60 ms.
//
//    sfx.search(kind, { pan?, volume?, delay? })
//        kind: 'door' (open, creaky) | 'close' | 'creak' (floorboard/hinge) | 'rummage'
//        (drawers, boxes, tools, cans; call 1–3 times while a search bar fills) |
//        'drawer' | 'glass' (breaking a window) | 'paper' (a note, a map)
//
//    ambience(scene)   'night' | 'day' | 'run' | 'title' | 'off'
//        Looping recorded beds plus sparse random events, on their own bus (lightly
//        ducked under gunfire, scaled by the sfx volume). Crossfades between scenes.
//          night: wind, crickets, the river; far dogs, far gunfire (other survivors),
//                 creaking trees, rarely a distant blast or the church bell
//          day:   birds, light wind, the river; a dog now and then
//          run:   gusty wind, birds; far dogs, far gunfire, creaks (daylight runs)
//          title: wind and river, an occasional bell across the water
//        While a scene plays, the old wind(on) is a no-op, so calling both is safe.
//        Extra layers: ambienceLayer('fire' | 'generator' | 'static' | 'river', level 0..1)
//        — e.g. a burning barricade or the radio — level 0 removes it.
//
//    sfx.ui(kind?)     'click' (default) | 'type' (typewriter key) | 'paper' | 'stamp'
//
//    muffle(amount 0..1, seconds = 3)  ringing ears: low-passes the whole sfx bus (ambience too)
//                      with a faint high ring, recovering over `seconds`. The battle calls it after
//                      sustained unprotected heavy fire (not with G.flags.earDefenders).
//    distant('dog' | 'gun' | 'bell')   one far-off event across the river (tide-eve barking).
//    stinger('dread' | 'dawn')         a short sting on the music bus.
//
//  The existing calls now blend recordings in: impact('flesh'|'head'|'bone'|'wood'|
//  'metal'|'armor'|'burst') layer real flesh/bone/wood/metal hits over the synth;
//  groan/scream → zombie vocals; thud → a body fall; wallHit → wood hit (+ splinters);
//  fire → crackle; bell → a struck bell; explosion → a recorded blast/far rumble;
//  shoot()/gun() add a quiet real gunshot tail under the pre-rendered procedural shot
//  (rifles, pistols, shotguns; not bows/nailers/suppressed). setReducedGore(true)
//  (the 'reduce gore' setting) turns the wet layers down.
//  Preload a set early if you want it ready for its first use:
//    preloadSamples(['z_scream', ...])  (ids: see src/audio/sample-manifest.ts)
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
import { MeleeKind, SearchKind, Surface, searchFx, step as stepFx, swish } from './audio/foley';
import { Bed, PlayOpts, SampleId, load as loadSample, play as playSample, preload, ready as sampleReady } from './audio/samples';
import { WEAPONS } from './data/weapons';

export type { GunKind } from './audio/guns';
export type { GunOpts } from './audio/gunbank';
export type { CasingKind, ImpactKind, ReloadKind, ReloadStage, MeleeKind, Surface, SearchKind } from './audio/foley';
export type { SampleId } from './audio/samples';

const CORE_SAMPLES: SampleId[] = [
  'z_groan', 'z_alert', 'z_attack', 'z_pain', 'z_death', 'flesh', 'bone', 'crunch', 'splat', 'bodyfall',
  'wood_hit', 'wood_crack', 'amb_wind', 'amb_crickets', 'ui_click', 'gun_rifle', 'gun_pistol', 'gun_shotgun',
];

let ctx: AudioContext | null = null;
let E: Engine | null = null;
let sfxBus: GainNode | null = null;    // post-compressor sfx volume (wind goes straight here)
let musicBus: GainNode | null = null;  // music input (ducked)
let reverb: ConvolverNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;

const vol = { master: 0.7, music: 0.55, sfx: 0.8, amb: 0.8 };

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    E = new Engine(ctx);
    E.master.gain.value = muted ? 0 : vol.master;
    E.sfxVol.gain.value = vol.sfx;
    E.musicVol.gain.value = vol.music;
    E.ambVol.gain.value = vol.amb;
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
    if (wantScene !== 'off') queueMicrotask(() => ambience(wantScene));
    // render the gun bank in the background (a few hundred ms of offline work)
    const sr = ctx.sampleRate;
    setTimeout(() => void prewarm(sr), 250);
    // then the recorded sets the battle needs first (~1.3 MB); the rest load on first use
    const c0 = ctx;
    setTimeout(() => void preload(c0, CORE_SAMPLES), 900);
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
export function setAmbienceVolume(v: number) {
  vol.amb = clamp01(v);
  ramp(E?.ambVol.gain, vol.amb);
}
/** Current player volumes (tests, the settings page). */
export const volumes = () => ({ ...vol, muted });
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
function fx(len: number, draw: (s: Synth) => void, o: { delay?: number; gate?: string; gap?: number; rev?: number; echo?: number; volume?: number; pri?: number; far?: boolean; pan?: number } = {}) {
  const e = engine();
  if (!e) return;
  const delay = o.delay ?? 0;
  if (o.gate && !e.gate(o.gate, e.now + delay, o.gap ?? 0.025)) return;
  draw(e.synth(delay, len, { gain: o.volume ?? 1, rev: o.rev ?? 0.08, echo: o.echo ?? 0, pri: o.pri ?? 0, far: o.far, pan: o.pan }));
}

// ---------------------------------------------------------------------------
// Recorded samples (src/audio/samples.ts). smp() returns false when the set
// hasn't decoded yet (it starts loading it) — callers then synthesize instead.
// ---------------------------------------------------------------------------
function smp(id: SampleId, o: PlayOpts & { gate?: string; gap?: number } = {}): boolean {
  const e = engine();
  if (!e) return true; // muted: nothing to fall back to either
  if (o.gate && !e.gate(o.gate, e.now + (o.delay ?? 0), o.gap ?? 0.03)) return true;
  return playSample(e, id, { rev: 0.06, pri: 0, ...o });
}

let goreLevel = 1;
/** The 'reduce gore' setting: turns the wet flesh/splatter layers down. */
export function setReducedGore(on: boolean) { goreLevel = on ? 0.35 : 1; }

/** Start loading sample sets now (e.g. the Crier's screams before its first night). */
export function preloadSamples(ids: SampleId[]) {
  const c = ac();
  void preload(c, ids);
}
/** Play the next raw variant of a sample set (sound board; loops play their first 4 s). */
export function auditionSample(id: SampleId) {
  smp(id, { gain: 0.8, spread: 0, gainJitter: 0, pri: 2, maxLen: id.startsWith('amb_') ? 4 : undefined });
}
/** True once a sample set has decoded (the sound board uses this). */
export const sampleLoaded = (id: SampleId) => sampleReady(id);
/** Load one set and report whether it decoded (tests / sound board). */
export async function loadSampleSet(id: SampleId): Promise<boolean> {
  await loadSample(ac(), id);
  return sampleReady(id);
}

// zombie vocals: never more than a handful at once; idles yield first
let vocalEnds: number[] = [];
function vocalSlot(e: Engine, kind: ZombieVoiceKind): boolean {
  const now = e.now;
  vocalEnds = vocalEnds.filter((t) => t > now);
  const cap = kind === 'idle' ? 4 : kind === 'alert' ? 6 : 7;
  if (vocalEnds.length >= cap) return false;
  vocalEnds.push(now + (kind === 'idle' ? 1.6 : 0.9));
  return true;
}

export type ZombieVoiceType = 'sleeper' | 'deer' | 'pulper' | 'crier' | 'ferryman' | 'drag' | 'leaper' | 'spitter' | 'bellwether' | 'deputy';
export type ZombieVoiceKind = 'idle' | 'alert' | 'attack' | 'pain' | 'death';
export const ZOMBIE_VOICE_TYPES: ZombieVoiceType[] = ['sleeper', 'deer', 'pulper', 'crier', 'ferryman', 'drag', 'leaper', 'spitter', 'bellwether', 'deputy'];
export const ZOMBIE_VOICE_KINDS: ZombieVoiceKind[] = ['idle', 'alert', 'attack', 'pain', 'death'];

// [sample set, playback rate, gain, extra layer?]
type VoiceSpec = [SampleId, number, number, SampleId?];
const VOICES: Record<ZombieVoiceType, Record<ZombieVoiceKind, VoiceSpec>> = {
  sleeper: { idle: ['z_groan', 1, 0.6], alert: ['z_alert', 1, 0.75], attack: ['z_attack', 1, 0.75], pain: ['z_pain', 1, 0.7], death: ['z_death', 1, 0.8] },
  deputy: { idle: ['z_groan', 0.92, 0.6], alert: ['z_alert', 0.92, 0.75], attack: ['z_attack', 0.92, 0.8], pain: ['z_pain', 0.9, 0.7], death: ['z_death', 0.92, 0.8] },
  deer: { idle: ['z_breath', 1.15, 0.55], alert: ['z_snarl', 1.1, 0.75], attack: ['z_snarl', 1.2, 0.8], pain: ['z_pain', 1.18, 0.7], death: ['z_death', 1.12, 0.75] },
  pulper: { idle: ['z_wet', 0.85, 0.6], alert: ['z_wet', 0.8, 0.75, 'z_groan'], attack: ['z_wet', 0.9, 0.8], pain: ['z_wet', 1, 0.75], death: ['z_death', 0.8, 0.7, 'splat'] },
  crier: { idle: ['z_groan', 1.25, 0.5], alert: ['z_scream', 1, 0.85], attack: ['z_scream', 1.05, 0.9], pain: ['z_pain', 1.3, 0.7], death: ['z_scream', 0.85, 0.75] },
  ferryman: { idle: ['z_big', 0.85, 0.7], alert: ['z_big', 0.8, 0.85], attack: ['z_attack', 0.72, 0.9], pain: ['z_pain', 0.68, 0.8], death: ['z_big', 0.7, 0.95] },
  drag: { idle: ['z_groan', 0.82, 0.45], alert: ['z_alert', 0.85, 0.55], attack: ['z_attack', 0.9, 0.6], pain: ['z_pain', 0.85, 0.55], death: ['z_death', 0.85, 0.6] },
  leaper: { idle: ['z_alert', 1.12, 0.55], alert: ['z_snarl', 1.05, 0.75], attack: ['z_attack', 1.25, 0.85], pain: ['z_pain', 1.2, 0.7], death: ['z_death', 1.15, 0.75] },
  spitter: { idle: ['z_wet', 1.15, 0.55], alert: ['z_spit', 1, 0.7], attack: ['z_spit', 1.05, 0.85], pain: ['z_pain', 1.1, 0.7], death: ['z_wet', 1.05, 0.75, 'z_death'] },
  bellwether: { idle: ['z_big', 0.62, 0.8], alert: ['z_big', 0.58, 0.95], attack: ['z_attack', 0.6, 1], pain: ['z_big', 0.75, 0.85], death: ['z_big', 0.5, 1, 'bell_toll'] },
};

// melee weapon classes, matched loosely on the id/name
type MeleeClass = 'blade' | 'metal' | 'blunt' | 'fist';
function meleeClass(w = ''): { cls: MeleeClass; heavy: boolean } {
  const s = w.toLowerCase();
  const heavy = /axe|hatchet|sledge|maul|crowbar|bat|shovel|pipe|plank|club|rebar|pick/.test(s) && !/knife/.test(s);
  if (/machete|hatchet|axe|knife|sickle|cleaver|blade|sword|scythe|bayonet|saw/.test(s)) return { cls: 'blade', heavy };
  if (/crowbar|pipe|wrench|rebar|iron|tire|spanner|pan/.test(s)) return { cls: 'metal', heavy };
  if (/fist|punch|kick|shove|bash|hand/.test(s)) return { cls: 'fist', heavy: false };
  return { cls: 'blunt', heavy };
}

// which recorded shot sits under each procedural gun family
const GUN_LAYER: Partial<Record<GunKind, [SampleId, number]>> = {
  pistol: ['gun_pistol', 1.05], pistol45: ['gun_pistol', 0.95], magnum: ['gun_pistol', 0.85], burst: ['gun_pistol', 1.08],
  smg: ['gun_pistol', 1.1], rimfire: ['gun_pistol', 1.25],
  pump: ['gun_shotgun', 1], double: ['gun_shotgun', 0.95], autoshot: ['gun_shotgun', 1.03], shotgun410: ['gun_shotgun', 1.12], pipe: ['gun_shotgun', 0.9],
  boltRifle: ['gun_rifle', 1], lever: ['gun_rifle', 1.05], marksman: ['gun_rifle', 0.97], muzzleloader: ['gun_shotgun', 0.8],
  ar: ['gun_rifle', 1.08], carbine: ['gun_rifle', 1.1], lmg: ['gun_rifle', 1.02],
};
function gunLayer(kindIn: string, o: GunOpts) {
  const kind = resolveGun(kindIn);
  const L = kind && !o.suppressed ? GUN_LAYER[kind] : undefined;
  if (!L) return;
  const far = !!o.far;
  const d = o.far === true ? 0.6 : typeof o.far === 'number' ? o.far : 0;
  smp(L[0], {
    rate: L[1], gain: (o.volume ?? 1) * (far ? 0.5 - d * 0.3 : 0.32), far, pan: o.pan, pri: 0, rev: 0.12, echo: far ? 0.3 : 0.1,
    delay: (o.delay ?? 0) + (far ? 0.015 + d * 0.07 : 0), gate: `gl:${L[0]}`, gap: 0.06, maxLen: 1.4,
  });
}

let casingCount = 0;

export const sfx = {
  // ---- guns ------------------------------------------------------------------------
  /** One shot of a gun family (GunKind or alias like '22', '410', 'rifle-bolt', 'assault'). */
  gun(kind: GunKind | string, opts: GunOpts = {}) {
    const e = engine();
    if (e && playGun(e, kind, opts)) gunLayer(kind, opts);
  },
  /** One trigger pull of a WEAPONS id: the shot + its ejected casing. */
  shoot(defId: string, opts: GunOpts = {}) {
    const g = gunSoundFor(defId);
    const e = engine();
    if (!e || !playGun(e, g.kind, opts)) return;
    gunLayer(g.kind, opts);
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
    // recorded layer on top (wet/bone/wood/metal texture the synth can't do)
    const v = o.volume ?? 1, delay = o.delay ?? 0, gate = `ims:${kind}`;
    switch (kind) {
      case 'flesh': smp('flesh', { gain: 0.55 * v * goreLevel, delay, gate, gap: 0.05 }); break;
      case 'head':
        smp('crunch', { gain: 0.6 * v, delay, gate, gap: 0.05, pri: 1 });
        smp('splat', { gain: 0.5 * v * goreLevel, delay: delay + 0.012, gate: 'ims:head2', gap: 0.05, rate: 1.1 });
        break;
      case 'bone': smp('bone', { gain: 0.6 * v, delay, gate, gap: 0.05 }); break;
      case 'burst': smp('splat', { gain: 0.8 * v * goreLevel, delay, gate, gap: 0.05, pri: 1, rev: 0.15, rate: 0.85 }); break;
      case 'wood': smp('wood_hit', { gain: 0.6 * v, delay, gate, gap: 0.05 }); break;
      case 'metal': smp('metal_hit', { gain: 0.45 * v, delay, gate, gap: 0.05 }); break;
      case 'armor': smp('metal_hit', { gain: 0.3 * v, delay, gate, gap: 0.06, rate: 1.2 }); break;
      default: break;
    }
  },
  /** Kill-confirm tick. streak = consecutive kills within ~1.5 s (1 = first). */
  confirm(streak = 1) {
    fx(0.1, (s) => confirmFx(s, streak), { gate: 'confirm', gap: 0.04, rev: 0, pri: 1 });
  },
  // ---- reloads & handling ----------------------------------------------------------
  /** A reload stage for a reload family. Called with no arguments: the legacy generic sound. */
  reload(kind: ReloadKind = 'rifle', stage: ReloadStage = 'in', delay = 0, o: { volume?: number; pan?: number; far?: boolean } = {}) {
    // another defender's reload down the line: quieter, panned, low priority (never steals a voice)
    fx(0.8, (s) => reloadFx(s, kind, stage), { delay, rev: o.far ? 0.12 : 0.05, pri: o.volume !== undefined ? 0 : 1, volume: o.volume, pan: o.pan, far: o.far, gate: o.volume !== undefined ? `greload:${stage}` : undefined, gap: 0.06 });
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
    const r = 1 / Math.sqrt(Math.max(0.4, size));
    if (o.far) smp('explosion_far', { gain: 0.7, delay: o.delay, far: true, rate: r, pri: 2 });
    else {
      smp('explosion', { gain: 0.5 * Math.min(1.3, size), delay: o.delay, rate: r, rev: 0.4, pri: 2 });
      smp('explosion_far', { gain: 0.55 * Math.min(1.3, size), delay: (o.delay ?? 0) + 0.02, rate: r, pri: 2, rev: 0.3 });
    }
    e.duck(0.9 * Math.min(1, size), o.delay ?? 0);
  },

  // ---- zombies (recorded) ----------------------------------------------------------------
  /** A zombie vocalization. See the header for the type/kind vocabulary. */
  zombieVoice(type: ZombieVoiceType | string, kind: ZombieVoiceKind, o: { pan?: number; far?: boolean; delay?: number; volume?: number } = {}) {
    const e = engine();
    if (!e) return;
    const t: ZombieVoiceType = (ZOMBIE_VOICE_TYPES as string[]).includes(type) ? (type as ZombieVoiceType) : 'sleeper';
    const spec = VOICES[t][kind] ?? VOICES[t].idle;
    // per type+kind throttle: a horde of pains in one frame is one pain
    const gap = kind === 'idle' ? 0.35 : kind === 'pain' ? 0.12 : 0.08;
    if (!e.gate(`zv:${t}:${kind}`, e.now + (o.delay ?? 0), gap)) return;
    if (!vocalSlot(e, kind)) return;
    const big = t === 'ferryman' || t === 'bellwether';
    const vol = (o.volume ?? 1) * spec[2];
    const po: PlayOpts = {
      rate: spec[1], gain: vol, pan: o.pan, far: o.far, delay: o.delay, spread: 0.06,
      rev: big ? 0.25 : 0.1, echo: big || kind === 'alert' ? 0.12 : 0, pri: kind === 'idle' ? 0 : 1,
      lp: t === 'drag' ? 2400 : undefined,
    };
    if (playSample(e, spec[0], po)) {
      const extra = spec[3];
      if (extra) playSample(e, extra, { ...po, gain: vol * (extra === 'splat' ? 0.6 * goreLevel : 0.5), rate: extra === 'bell_toll' ? 1 : spec[1], delay: (o.delay ?? 0) + 0.05 });
      // the big ones get a sub-octave double for weight
      if (big && kind !== 'idle') playSample(e, spec[0], { ...po, rate: spec[1] * 0.5, gain: vol * 0.35, spread: 0.01 });
      return;
    }
    // procedural stand-in until the recordings decode
    const F: Partial<Record<ZombieVoiceType, number>> = { crier: 1100, deer: 260, leaper: 200, spitter: 180, ferryman: 55, bellwether: 45, drag: 70 };
    const f = F[t] ?? 95;
    const scream = t === 'crier' && kind !== 'idle' && kind !== 'pain';
    const rr = (a: number, b: number) => a + Math.random() * (b - a);
    fx(1.3, (s) => {
      if (scream) { s.tone({ f: f * rr(0.9, 1.1), f2: f * 1.4, dur: 1.1, v: 0.08, type: 'sawtooth', lp: 3500, attack: 0.05 }); return; }
      const d = kind === 'idle' ? 0.9 : kind === 'death' ? 0.8 : 0.4;
      s.tone({ f: f * rr(0.85, 1.2), f2: f * (kind === 'pain' ? 1.4 : 0.7), dur: d, v: 0.09, type: 'sawtooth', lp: 900, attack: 0.04 });
      s.noise({ dur: d, v: 0.06, type: 'bandpass', f: f * 6, q: 2, attack: 0.05 });
    }, { delay: o.delay, volume: o.volume, far: o.far, rev: 0.1, pri: kind === 'idle' ? 0 : 1 });
  },

  // ---- melee (recorded) --------------------------------------------------------------------
  /** A melee swing / hit / heavy hit. weapon: any id or name (matched loosely; see header). */
  melee(kind: MeleeKind, weapon?: string, o: { pan?: number; delay?: number; volume?: number } = {}) {
    const e = engine();
    if (!e) return;
    const { cls, heavy } = meleeClass(weapon);
    const v = o.volume ?? 1, d0 = o.delay ?? 0;
    const base = { pan: o.pan, delay: d0, pri: 1, rev: 0.05 };
    if (kind === 'swing') {
      if (!smp(heavy ? 'swing_heavy' : 'swing', { ...base, gain: 0.5 * v, rate: heavy ? 0.85 : cls === 'blade' ? 1.1 : 1, gate: 'mel:sw', gap: 0.06 })) {
        fx(0.4, (s) => swish(s, heavy), { ...base, volume: v, gate: 'mel:sw', gap: 0.06 });
      }
      return;
    }
    if (!e.gate('mel:hit', e.now + d0, 0.05)) return;
    const hv = kind === 'heavy';
    const hitId: SampleId = cls === 'blade' ? 'flesh' : 'blunt';
    const ok = smp(hitId, { ...base, gain: (hv ? 0.85 : 0.65) * v * (cls === 'blade' ? goreLevel : 1), rate: hv ? 0.85 : cls === 'fist' ? 1.15 : 1 });
    if (cls === 'blade') smp('blade', { ...base, gain: 0.3 * v, rate: hv ? 0.8 : 0.95, delay: d0 + 0.005 });
    if (cls === 'metal') smp('metal_hit', { ...base, gain: 0.25 * v, rate: 1.1 });
    if (cls === 'blunt' && heavy) smp('wood_hit', { ...base, gain: 0.25 * v, rate: 1.2 });
    if (hv) {
      smp('crunch', { ...base, gain: 0.5 * v, delay: d0 + 0.01 });
      smp('bone', { ...base, gain: 0.5 * v, delay: d0 + 0.03 });
    }
    if (!ok) fx(0.45, (s) => impactFx(s, hv ? 'bone' : 'flesh'), { ...base, volume: v });
  },

  // ---- expedition foley (recorded) -------------------------------------------------------
  /** One footfall on a surface ('asphalt' | 'leaves' | 'gravel' | 'wood' | 'grass' | 'mud'). */
  footstep(surface: Surface | string = 'asphalt', o: { pan?: number; volume?: number; far?: boolean } = {}) {
    const id: SampleId = surface === 'leaves' || surface === 'grass' ? 'step_leaves' : surface === 'gravel' || surface === 'mud' ? 'step_gravel'
      : surface === 'wood' ? 'step_wood' : 'step_asphalt';
    const v = (o.volume ?? 1) * (surface === 'grass' ? 0.45 : 0.55);
    if (!smp(id, { gain: v, pan: o.pan, far: o.far, rate: surface === 'mud' ? 0.8 : 1, spread: 0.08, gainJitter: 0.2, rev: 0.03, gate: 'step', gap: 0.06 })) {
      fx(0.2, (s) => stepFx(s, surface), { volume: o.volume, far: o.far, gate: 'step', gap: 0.06, rev: 0.03 });
    }
  },
  /** Searching a house: 'door' | 'close' | 'creak' | 'rummage' | 'drawer' | 'glass' | 'paper'. */
  search(kind: SearchKind | string, o: { pan?: number; volume?: number; delay?: number } = {}) {
    const ids: Record<string, SampleId> = { door: 'door_open', close: 'door_close', creak: 'door_creak', rummage: 'rummage', drawer: 'rummage', glass: 'glass', paper: 'ui_paper' };
    const id = ids[kind] ?? 'rummage';
    const v = (o.volume ?? 1) * (kind === 'glass' ? 0.75 : 0.6);
    const ok = smp(id, { gain: v, pan: o.pan, delay: o.delay, rev: 0.1, pri: 1, gate: `srch:${kind}`, gap: 0.08 });
    if (ok && kind === 'door' && Math.random() < 0.5) smp('door_creak', { gain: v * 0.6, pan: o.pan, delay: (o.delay ?? 0) + 0.05, rev: 0.12 });
    if (!ok) fx(0.8, (s) => searchFx(s, kind), { volume: o.volume, delay: o.delay, rev: 0.1 });
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
  thud() {
    if (smp('bodyfall', { gain: 0.7, gate: 'thud', gap: 0.05 })) noise(0.12, 220, 1, 0.18, 0.12);
    else noise(0.15, 220, 1, 0.35, 0.15);
  },
  wallHit() {
    sfx.impact('wood');
    if (Math.random() < 0.3) smp('wood_crack', { gain: 0.45, delay: 0.02, gate: 'crack', gap: 0.4, rev: 0.1 });
  },
  groan() { if (!smp('z_groan', { gain: 0.55, spread: 0.08, gate: 'groan', gap: 0.3, rev: 0.1 })) tone(80 + Math.random() * 60, 0.9, 0.06, 'sawtooth', -30); },
  scream() {
    if (smp('z_scream', { gain: 0.8, gate: 'scream', gap: 0.2, rev: 0.15, echo: 0.15, pri: 1 })) return;
    tone(900 + Math.random() * 300, 1.2, 0.08, 'sawtooth', 500); tone(1300, 1.0, 0.04, 'triangle', -400);
  },
  burst() { sfx.impact('burst'); },
  boom() { sfx.explosion(1); },
  fire() { if (!smp('fire_burst', { gain: 0.6, gate: 'fire', gap: 0.15, maxLen: 1.6 })) noise(0.6, 1200, 0.3, 0.15, 0.6, 'highpass'); },
  hurt() { tone(220, 0.25, 0.12, 'triangle', -120); },
  bell() {
    tone(392, 3, 0.18, 'sine'); tone(784, 2.5, 0.06, 'sine'); tone(523, 3, 0.05, 'sine');
    smp('bell_toll', { gain: 0.35, rate: 0.98, spread: 0.01, rev: 0.4, echo: 0.2, pri: 1 });  // the strike
  },
  /** UI sound: 'click' (default) | 'type' | 'paper' | 'stamp'. */
  ui(kind: 'click' | 'type' | 'paper' | 'stamp' = 'click') {
    const id: SampleId = kind === 'type' ? 'ui_type' : kind === 'paper' ? 'ui_paper' : kind === 'stamp' ? 'ui_stamp' : 'ui_click';
    if (!smp(id, { gain: kind === 'stamp' ? 0.6 : 0.45, rev: 0, pri: 1, spread: 0.03, gate: `ui:${kind}`, gap: 0.03 })) tone(600, 0.05, 0.05, 'triangle');
  },
};

// ---------------------------------------------------------------------------
// Ears: sustained unprotected gunfire dulls everything for a few seconds (a low-pass on the
// whole sfx bus, ambience included) with a faint high ring under it. Subtle by design.
// ---------------------------------------------------------------------------
let muffleUntil = 0;
/** Muffle the sfx bus: amount 0..1 (1 ≈ 900 Hz cutoff), recovering over `seconds`. */
export function muffle(amount: number, seconds = 3) {
  const e = engine();
  if (!e || !ctx) return;
  const a = clamp01(amount);
  if (a <= 0) return;
  const now = ctx.currentTime;
  if (now < muffleUntil - 0.5) return; // already ringing: don't restart the ramp
  muffleUntil = now + seconds;
  const f = e.muffleLp.frequency;
  const low = 20000 * Math.pow(900 / 20000, a);
  f.cancelScheduledValues(now);
  f.setValueAtTime(Math.max(low, f.value), now);
  f.exponentialRampToValueAtTime(low, now + 0.08);
  f.setValueAtTime(low, now + seconds * 0.35);
  f.exponentialRampToValueAtTime(20000, now + seconds);
  // the ring: a thin sine around 6 kHz, very quiet, fading with the muffle (past the low-pass)
  const o = ctx.createOscillator();
  o.frequency.value = 5600 + Math.random() * 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.01 * a, now + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  o.connect(g).connect(e.master);
  o.start(now);
  o.stop(now + seconds + 0.1);
}

/** Something far off over the river: 'dog' barks, 'gun' shots, 'bell'. */
export function distant(kind: 'dog' | 'gun' | 'bell', o: { delay?: number; gain?: number } = {}) {
  const id: SampleId = kind === 'dog' ? 'dog_far' : kind === 'gun' ? 'gun_far' : 'bell_toll';
  smp(id, { gain: o.gain ?? 0.4, far: true, delay: o.delay, pan: Math.random() * 1.4 - 0.7, rev: 0.3, echo: 0.2, pri: 0, rate: 0.95 + Math.random() * 0.1 });
}

/** A short sting on the music bus: 'dread' (a low swell and a cracked minor second, for a bad
 *  night coming) or 'dawn' (an open fifth). Plays whatever the music mode. */
export function stinger(kind: 'dread' | 'dawn') {
  if (muted) return;
  const c = ac();
  if (!musicBus || !reverb) return;
  const now = c.currentTime + 0.05;
  const out = c.createGain();
  out.connect(musicBus);
  out.connect(reverb);
  const notes = kind === 'dread' ? [[38, 0, 4.5, 0.16], [50, 0.2, 4, 0.08], [51, 1.1, 3.2, 0.05]] : [[50, 0, 3.5, 0.09], [57, 0.3, 3.4, 0.07], [62, 0.7, 3, 0.05]];
  for (const [m, at, dur, v] of notes) {
    const o = c.createOscillator();
    o.type = kind === 'dread' ? 'sawtooth' : 'triangle';
    o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'dread' ? 420 : 1600;
    const g = c.createGain();
    g.gain.setValueAtTime(0, now + at);
    g.gain.linearRampToValueAtTime(v, now + at + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    o.connect(lp).connect(g).connect(out);
    o.start(now + at);
    o.stop(now + at + dur + 0.1);
  }
}

// Low wind for ambience: the recorded wind bed once it has decoded, filtered noise until then.
function noiseWind(out: AudioNode, level = 0.06, cutoff = 280) {
  const c = ac();
  const n = c.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.value = level;
  n.connect(f).connect(g).connect(out);
  n.start();
  return { stop() { try { n.stop(); } catch { /* stopped */ } g.disconnect(); } };
}
let windBed: Bed | null = null;
export function wind(on: boolean) {
  if (muted && on) return;
  const c = ac();
  if (on && !windBed && !scene) {
    windBed = new Bed(c, E!.ambIn, 'amb_wind', 0.5, (out) => noiseWind(out, 0.12), 1.5);
  } else if (!on && windBed) {
    windBed.stop(1);
    windBed = null;
  }
}

// ---------------------------------------------------------------------------
// Ambience scenes: looping recorded beds + sparse random events (see header).
// ---------------------------------------------------------------------------
export type AmbienceScene = 'night' | 'day' | 'run' | 'title';
interface SceneDef {
  beds: [SampleId, number, number?][];           // id, level, optional low-pass
  events: [SampleId, number, number, number][];  // id, mean gap (s), gain, far 0..1
}
const SCENES: Record<AmbienceScene, SceneDef> = {
  night: {
    beds: [['amb_wind', 0.5], ['amb_crickets', 0.22], ['amb_river', 0.16, 1800]],
    events: [['dog_far', 40, 0.35, 0.8], ['gun_far', 55, 0.45, 1], ['tree_creak', 35, 0.3, 0.3], ['explosion_far', 240, 0.5, 1], ['bell_toll', 150, 0.25, 1]],
  },
  day: {
    beds: [['amb_birds', 0.4], ['amb_wind', 0.18], ['amb_river', 0.14, 2500]],
    events: [['dog_far', 70, 0.3, 0.9], ['bell_toll', 200, 0.2, 1]],
  },
  run: {
    beds: [['amb_gust', 0.38], ['amb_birds', 0.15]],
    events: [['dog_far', 45, 0.35, 0.8], ['gun_far', 70, 0.4, 1], ['tree_creak', 40, 0.3, 0.4]],
  },
  title: {
    beds: [['amb_wind', 0.32, 1400], ['amb_river', 0.26, 2200]],
    events: [['bell_toll', 45, 0.22, 1], ['dog_far', 90, 0.2, 1]],
  },
};
let scene: AmbienceScene | null = null;
let wantScene: AmbienceScene | 'off' = 'off';
let sceneBeds: Bed[] = [];
let sceneTimers: number[] = [];
const layers = new Map<string, Bed>();

/** Switch the ambience scene ('off' stops it). Safe before the first gesture: starts on it. */
export function ambience(s: AmbienceScene | 'off') {
  wantScene = s;
  if (!ctx) return;  // started on the first gesture (see ac())
  if (s === 'off' ? scene === null : s === scene) return;
  for (const b of sceneBeds) b.stop(2.5);
  for (const t of sceneTimers) clearTimeout(t);
  sceneBeds = [];
  sceneTimers = [];
  scene = s === 'off' ? null : s;
  if (!scene) return;  // (muted: the beds still run, under a master gain of 0)
  if (windBed) { windBed.stop(2); windBed = null; }
  const c = ac();
  const def = SCENES[scene];
  for (const [id, level, lp] of def.beds) {
    sceneBeds.push(new Bed(c, E!.ambIn, id, level, id === 'amb_wind' || id === 'amb_gust' ? (out) => noiseWind(out, 0.12) : undefined, 4, lp));
  }
  const mine = scene;
  for (const [id, gap, gain, far] of def.events) {
    void loadSample(c, id);
    const next = () => {
      const t = window.setTimeout(() => {
        if (scene !== mine) return;
        const e = engine();
        if (e && !document.hidden) {
          playSample(e, id, { gain, far: far > 0.5, pan: Math.random() * 1.6 - 0.8, rev: 0.3, echo: 0.2, pri: 0, rate: 0.95 + Math.random() * 0.1, lp: far > 0.5 ? 2200 : undefined });
        }
        next();
      }, gap * (0.4 + Math.random() * 1.2) * 1000);
      sceneTimers.push(t);
    };
    next();
  }
}

/** An extra looping layer over the scene: 'fire' | 'generator' | 'static' | 'river'. level 0 removes it. */
export function ambienceLayer(kind: 'fire' | 'generator' | 'static' | 'river', level: number) {
  if (muted && level > 0) return;
  const id: SampleId = kind === 'fire' ? 'amb_fire' : kind === 'generator' ? 'amb_generator' : kind === 'static' ? 'amb_static' : 'amb_river';
  const have = layers.get(kind);
  if (level <= 0) { have?.stop(1); layers.delete(kind); return; }
  if (have) { have.level(level); return; }
  const c = ac();
  layers.set(kind, new Bed(c, E!.ambIn, id, level, undefined, 1.5));
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
