// Recorded samples (public/sfx/*.mp3, CC0 — see CREDITS.md): lazy fetch + decode, a
// per-id cache, shuffle-bag round-robin over the variants, and graceful fallback.
//
// Nothing is fetched until a sound is first asked for (or preload() is called once the
// AudioContext exists). Until an id has at least one decoded variant, play() returns
// false and the caller falls back to its procedural sound — so a missing file, a 404,
// an old browser that can't decode mp3 or a slow connection never silences the game.

import type { Engine, VoiceOpts } from './engine';
import { SAMPLES, type SampleId } from './sample-manifest';

export { SAMPLES, type SampleId };
export const SAMPLE_IDS = Object.keys(SAMPLES) as SampleId[];

interface Entry {
  bufs: AudioBuffer[];
  state: 'loading' | 'ready' | 'failed';
  promise: Promise<void>;
  bag: number[];    // shuffle bag of variant indexes
  last: number;
}

const cache = new Map<SampleId, Entry>();
/** Files that failed to fetch or decode (for the sound board / tests). */
export const sampleFailures: string[] = [];

const base = (() => {
  let b = '/';
  try { b = import.meta.env.BASE_URL || '/'; } catch { /* not under Vite */ }
  return (b.endsWith('/') ? b : b + '/') + 'sfx/';
})();
export const sampleUrl = (id: SampleId, i: number) => `${base}${id}-${i + 1}.mp3`;

// a small fetch queue so a preload doesn't open 300 requests at once
const MAX_INFLIGHT = 6;
let inflight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiting.push(r));
  inflight++;
  try { return await fn(); } finally { inflight--; waiting.shift()?.(); }
}

function decode(c: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // callback form too: older Safari only supports that one
  return new Promise((res, rej) => {
    const p = c.decodeAudioData(data, res, rej);
    if (p && typeof p.then === 'function') p.then(res, rej);
  });
}

/** Strip near-silent padding (mp3 encoder delay) off the start of a buffer, in place where possible. */
function trimLead(c: BaseAudioContext, b: AudioBuffer, loop: boolean): AudioBuffer {
  const d = b.getChannelData(0);
  let i = 0;
  const max = Math.min(d.length, Math.floor(b.sampleRate * 0.08));
  while (i < max && Math.abs(d[i]) < 1e-4) i++;
  let j = d.length;
  if (loop) { const min = Math.max(0, d.length - Math.floor(b.sampleRate * 0.08)); while (j > min && Math.abs(d[j - 1]) < 1e-4) j--; }
  if (i < 8 && j > d.length - 8) return b;
  const out = c.createBuffer(b.numberOfChannels, Math.max(1, j - i), b.sampleRate);
  for (let ch = 0; ch < b.numberOfChannels; ch++) out.copyToChannel(b.getChannelData(ch).subarray(i, j), ch);
  return out;
}

/** Start loading every variant of an id (idempotent). Resolves when all have settled. */
export function load(c: BaseAudioContext, id: SampleId): Promise<void> {
  const have = cache.get(id);
  if (have) return have.promise;
  const meta = SAMPLES[id];
  const e: Entry = { bufs: [], state: 'loading', promise: Promise.resolve(), bag: [], last: -1 };
  cache.set(id, e);
  if (typeof fetch !== 'function') { e.state = 'failed'; return e.promise; }
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < meta.n; i++) {
    const url = sampleUrl(id, i);
    jobs.push(slot(async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = trimLead(c, await decode(c, await r.arrayBuffer()), meta.loop);
        e.bufs.push(buf);
        e.state = 'ready';
      } catch (err) {
        sampleFailures.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
  }
  e.promise = Promise.all(jobs).then(() => { if (!e.bufs.length) e.state = 'failed'; });
  return e.promise;
}

/** Load several ids in the background. */
export function preload(c: BaseAudioContext, ids: readonly SampleId[]): Promise<void> {
  return Promise.all(ids.map((id) => load(c, id))).then(() => undefined);
}

/** True once at least one variant of `id` is decoded. */
export function ready(id: SampleId): boolean {
  return cache.get(id)?.state === 'ready';
}

/** Next variant: shuffle bag (every take before a repeat, never the same twice running). */
export function pick(id: SampleId): AudioBuffer | null {
  const e = cache.get(id);
  if (!e || !e.bufs.length) return null;
  const n = e.bufs.length;
  if (n === 1) return e.bufs[0];
  if (!e.bag.length) {
    e.bag = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [e.bag[i], e.bag[j]] = [e.bag[j], e.bag[i]]; }
    if (e.bag[e.bag.length - 1] === e.last) e.bag.unshift(e.bag.pop()!);
  }
  e.last = e.bag.pop()!;
  return e.bufs[e.last];
}

export interface PlayOpts extends VoiceOpts {
  delay?: number;      // seconds from now
  rate?: number;       // playback rate (pitch + speed); a little random spread is added
  spread?: number;     // ± random rate spread (default 0.04)
  gainJitter?: number; // ± random gain (default 0.1)
  lp?: number;         // optional low-pass (Hz)
  hp?: number;         // optional high-pass (Hz)
  offset?: number;     // seconds into the buffer
  maxLen?: number;     // cut (with a short fade) after this many seconds
}

/**
 * Play one variant of `id` on a fresh engine voice (counts against the voice cap, goes
 * through the sfx bus / reverb / far chain like every other sound).
 * Returns false (and starts loading) if nothing is decoded yet: fall back to synthesis.
 */
export function play(E: Engine, id: SampleId, o: PlayOpts = {}): boolean {
  if (!ready(id)) { void load(E.c, id); return false; }
  const buf = pick(id);
  if (!buf) return false;
  const c = E.c;
  const rate = Math.max(0.25, (o.rate ?? 1) * (1 + ((Math.random() * 2 - 1) * (o.spread ?? 0.04))));
  const gain = Math.max(0, (o.gain ?? 1) * (1 + ((Math.random() * 2 - 1) * (o.gainJitter ?? 0.1))));
  const offset = Math.min(o.offset ?? 0, buf.duration * 0.9);
  const len = Math.min(o.maxLen ?? Infinity, (buf.duration - offset) / rate);
  const t = E.now + Math.max(0, o.delay ?? 0);
  const v = E.voice(t, len + 0.05, { ...o, gain });
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  let node: AudioNode = src;
  if (o.hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; node = node.connect(f); }
  if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node = node.connect(f); }
  node.connect(v.out);
  src.start(t, offset);
  if (o.maxLen !== undefined && o.maxLen < (buf.duration - offset) / rate) {
    v.out.gain.setValueAtTime(gain, t + len - 0.04);
    v.out.gain.linearRampToValueAtTime(0, t + len);
    src.stop(t + len + 0.01);
  }
  v.srcs.push(src);
  return true;
}

// ---------------------------------------------------------------------------
// Looping beds (ambience). Each bed owns a gain node feeding `dest`; it plays a
// procedural stand-in (if given) until the sample decodes, then crossfades over.
// ---------------------------------------------------------------------------
export class Bed {
  readonly out: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private fallback: { stop(): void } | null = null;
  private alive = true;

  constructor(readonly c: BaseAudioContext, dest: AudioNode, readonly id: SampleId, level: number,
    fallback?: (out: AudioNode) => { stop(): void }, fadeIn = 3, private lp?: number) {
    this.out = c.createGain();
    this.out.gain.setValueAtTime(0, c.currentTime);
    this.out.gain.linearRampToValueAtTime(level, c.currentTime + fadeIn);
    this.out.connect(dest);
    if (ready(id)) this.start(0);
    else {
      if (fallback) this.fallback = fallback(this.out);
      void load(c, id).then(() => { if (this.alive && ready(id)) this.start(this.fallback ? 2 : 0); });
    }
  }

  private start(xfade: number) {
    const buf = pick(this.id);
    if (!buf) return;
    const c = this.c;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(xfade ? 0 : 1, t);
    if (xfade) g.gain.linearRampToValueAtTime(1, t + xfade);
    let node: AudioNode = s;
    if (this.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = this.lp; node = node.connect(f); }
    node.connect(g).connect(this.out);
    s.start(t, Math.random() * buf.duration);  // start somewhere random in the loop
    this.src = s;
    const fb = this.fallback;
    this.fallback = null;
    if (fb) setTimeout(() => fb.stop(), xfade * 1000 + 50);
  }

  /** Change the level smoothly. */
  level(v: number, time = 1.5) {
    const t = this.c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(v, t + time);
  }

  stop(fade = 2) {
    this.alive = false;
    const t = this.c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    const s = this.src, fb = this.fallback;
    setTimeout(() => {
      try { s?.stop(); } catch { /* already stopped */ }
      fb?.stop();
      this.out.disconnect();
    }, fade * 1000 + 100);
  }
}
