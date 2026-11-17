// Gun bank: every gun variant is rendered once (4 round-robin takes) in an
// OfflineAudioContext, loudness-normalized, then played back as a single buffer
// source per shot. That keeps LMG fire at ~4 nodes per round instead of ~40,
// and gives each family an exact, deliberate loudness (GunRecipe.level).

import { Engine, Synth } from './engine';
import { GUNS, GUN_ALIASES, GunKind, GunRecipe, distant, jitter, suppressed, synthGun } from './guns';

export interface GunOpts {
  /** Oil-filter suppressor (or any can) fitted: a "phut" + the action. */
  suppressed?: boolean;
  /** Somebody else's gun down the wall: true ≈ 0.6, or a distance 0 (here) .. 1 (far end). */
  far?: boolean | number;
  /** Play the mechanical action (pump/bolt/lever cycle) after the shot. Default true. */
  action?: boolean;
  /** Stereo position -1..1. */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /** Extra gain, default 1. */
  volume?: number;
  /** Dragon's breath / fire bolt: adds a roaring whoosh. */
  incendiary?: boolean;
}

export const TAKES = 4;

export function resolveGun(kind: string): GunKind | null {
  if (kind in GUNS) return kind as GunKind;
  return GUN_ALIASES[kind] ?? null;
}

export function recipeFor(kind: GunKind, sup: boolean, far: boolean): GunRecipe {
  let r = GUNS[kind];
  if (sup) r = suppressed(r);
  if (far) r = distant(r);
  return r;
}

interface Entry { bufs: AudioBuffer[]; rr: number; norm: number }
const bank = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry | null>>();
const normGuess = new Map<string, number>(); // kind → norm, for the live fallback

const keyOf = (sr: number, kind: GunKind, sup: boolean, far: boolean, action: boolean) =>
  `${sr}|${kind}|${sup ? 's' : ''}${far ? 'f' : ''}${action ? 'a' : ''}`;

export const canRender = () => typeof OfflineAudioContext !== 'undefined';

function rms(d: Float32Array, from: number, to: number) {
  let s = 0;
  const b = Math.min(d.length, to);
  for (let i = from; i < b; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, b - from));
}
function peak(d: Float32Array) {
  let p = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  return p;
}

/** Render (once) the TAKES variants for a gun; resolves to null where offline rendering is unavailable. */
export function ensureGun(sr: number, kind: GunKind, sup = false, far = false, action = true): Promise<Entry | null> {
  const key = keyOf(sr, kind, sup, far, action);
  const have = bank.get(key);
  if (have) return Promise.resolve(have);
  let p = pending.get(key);
  if (p) return p;
  if (!canRender()) return Promise.resolve(null);
  const r = recipeFor(kind, sup, far);
  p = Promise.all(Array.from({ length: TAKES }, async (_, i) => {
    const len = Math.ceil(r.len * sr);
    const oc = new OfflineAudioContext(1, len, sr);
    synthGun(new Synth(oc, oc.destination, 0), r, jitter(i, TAKES), action);
    return oc.startRendering();
  })).then((bufs) => {
    const win = Math.floor(sr * 0.15);
    const fade = Math.floor(sr * 0.03);
    const loud = bufs.reduce((a, b) => a + rms(b.getChannelData(0), 0, win), 0) / bufs.length;
    const norm = loud > 1e-6 ? r.level / loud : 1;
    for (const b of bufs) {
      const d = b.getChannelData(0);
      const pk = peak(d) * norm;
      const g = pk > 0.95 ? norm * (0.95 / pk) : norm;
      for (let i = 0; i < d.length; i++) d[i] *= g;
      for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade; // no click at the cut
    }
    const e: Entry = { bufs, rr: Math.floor(Math.random() * TAKES), norm };
    bank.set(key, e);
    pending.delete(key);
    if (!normGuess.has(`${kind}${sup}${far}`)) normGuess.set(`${kind}${sup}${far}`, norm);
    return e;
  }).catch(() => { pending.delete(key); return null; });
  pending.set(key, p);
  return p;
}

/** Pre-render every family (dry and distant) so the first shots of a night are cheap. */
export async function prewarm(sr: number, kinds: GunKind[] = Object.keys(GUNS) as GunKind[]) {
  for (const k of kinds) await ensureGun(sr, k);
  for (const k of kinds) await ensureGun(sr, k, false, true);
}

export function distanceOf(far: GunOpts['far']): number {
  if (!far) return 0;
  return far === true ? 0.6 : Math.max(0, Math.min(1, far));
}

/** Play one shot on an engine. Returns false if gated (duplicate within 12 ms). */
export function playGun(E: Engine, kindIn: string, o: GunOpts = {}): boolean {
  const kind = resolveGun(kindIn);
  if (!kind) return false;
  const d = distanceOf(o.far);
  const far = d > 0;
  const sup = !!o.suppressed;
  const action = o.action !== false;
  const r = recipeFor(kind, sup, far);
  const delay = Math.max(0, o.delay ?? 0) + (far ? 0.015 + d * 0.07 : 0); // sound travel
  const t = E.now + delay;
  if (!E.gate(`gun:${kind}${far ? 'f' : ''}`, t, 0.012)) return false;
  const vol = (o.volume ?? 1) * (far ? 0.85 - d * 0.55 : 1) * (0.92 + Math.random() * 0.16);
  const v = E.voice(t, r.len + 0.05, { gain: vol, far, rev: r.rev, echo: r.echo, pan: o.pan, pri: far ? 1 : 2 });
  const key = keyOf(E.c.sampleRate, kind, sup, far, action);
  const e = bank.get(key);
  if (e) {
    // round-robin, never the same take twice in a row
    e.rr = (e.rr + 1 + Math.floor(Math.random() * (TAKES - 1))) % TAKES;
    const src = E.c.createBufferSource();
    src.buffer = e.bufs[e.rr];
    src.playbackRate.value = 0.975 + Math.random() * 0.05;
    src.connect(v.out);
    src.start(t);
    src.stop(t + r.len + 0.05);
    v.srcs.push(src);
  } else {
    v.gain = v.out.gain.value = vol * (normGuess.get(`${kind}${sup}${far}`) ?? 0.5);
    synthGun(new Synth(E.c, v.out, t, v.srcs), r, jitter(), action);
    void ensureGun(E.c.sampleRate, kind, sup, far, action);
  }
  if (o.incendiary) {
    const s = new Synth(E.c, v.out, t, v.srcs);
    s.noise({ at: 0.01, dur: 0.7, v: 0.35 / Math.max(0.2, v.gain), type: 'bandpass', f: 1300, f2: 450, q: 0.7, attack: 0.04, grit: 0.4 });
  }
  E.duck(r.duck * (o.volume ?? 1), delay);
  return true;
}
