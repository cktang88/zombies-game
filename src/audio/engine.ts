// Audio engine core: the bus graph, a tiny synthesis toolkit and voice management.
// Everything here works on any BaseAudioContext, so the same code renders live
// (AudioContext) and offline (OfflineAudioContext: gun pre-rendering, level checks).
//
//  voices ─► sfxIn ─► comp ─► makeup ─► limiter ─► sfxVol ─┐
//    │ └──► farIn ─► lowpass ─────────► sfxIn               │
//    ├──► revIn ─► hp ─► street convolver ─► sfxIn          ├─► master ─► masterLim ─► out
//    └──► echoIn ─► filters ─► delay(+fb) ─► pan ─► sfxIn   │
//  music ─► musicIn (duck) ─► musicVol ────────────────────┤
//  ambience beds ─► ambIn (ducked lightly) ─► sfxVol ──────┘

export type Ctx = BaseAudioContext;

// ---------------------------------------------------------------------------
// Shared sample bank (noise buffers, shaper curves), one per sample rate.
// AudioBuffers are not bound to a context, so live and offline contexts share them.
// ---------------------------------------------------------------------------
type Curve = Float32Array<ArrayBuffer>;
export interface Bank { white: AudioBuffer; brown: AudioBuffer; curves: Map<number, Curve> }
const banks = new Map<number, Bank>();

export function bankFor(c: Ctx): Bank {
  const sr = c.sampleRate;
  let b = banks.get(sr);
  if (b) return b;
  const len = Math.floor(sr * 2);
  const white = c.createBuffer(1, len, sr);
  const w = white.getChannelData(0);
  for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
  const brown = c.createBuffer(1, len, sr);
  const br = brown.getChannelData(0);
  let last = 0, peak = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    br[i] = last;
    peak = Math.max(peak, Math.abs(last));
  }
  for (let i = 0; i < len; i++) br[i] /= peak || 1;
  b = { white, brown, curves: new Map() };
  banks.set(sr, b);
  return b;
}

/** tanh soft-clip curve; k = drive (1 ≈ clean, 7 ≈ crunchy). */
function curve(bank: Bank, k: number): Curve {
  const key = Math.round(k * 10);
  let cv = bank.curves.get(key);
  if (cv) return cv;
  cv = new Float32Array(new ArrayBuffer(1024 * 4));
  const norm = Math.tanh(k);
  for (let i = 0; i < cv.length; i++) {
    const x = (i / (cv.length - 1)) * 2 - 1;
    cv[i] = Math.tanh(k * x) / norm;
  }
  bank.curves.set(key, cv);
  return cv;
}

// ---------------------------------------------------------------------------
// Synth: writes layered one-shots into an output node, relative to time t.
// ---------------------------------------------------------------------------
export interface NoiseOpts {
  at?: number;            // seconds after the synth's base time
  dur: number;            // time from peak to silence (exp ramp to -80 dB)
  v: number;              // peak gain
  type?: BiquadFilterType;
  f: number;              // filter frequency at the start
  f2?: number;            // filter frequency to sweep to
  sweep?: number;         // sweep time (default: dur)
  q?: number;
  attack?: number;
  hold?: number;          // sustain at peak before the decay
  brown?: boolean;        // brown (dark) noise instead of white
  grit?: number;          // 0..1 soft-clip drive
  rate?: number;          // playback rate of the noise buffer
}
export interface ToneOpts {
  at?: number; f: number; f2?: number; sweep?: number; dur: number; v: number;
  type?: OscillatorType; attack?: number; lp?: number;
}

const FLOOR = 0.0001;
const rnd = Math.random;

export class Synth {
  readonly bank: Bank;
  end: number;
  constructor(readonly c: Ctx, readonly out: AudioNode, readonly t: number, readonly srcs: AudioScheduledSourceNode[] = []) {
    this.bank = bankFor(c);
    this.end = t;
  }
  private nyq(f: number) { return Math.max(20, Math.min(this.c.sampleRate * 0.45, f)); }
  private track(s: AudioScheduledSourceNode, stopAt: number) {
    s.stop(stopAt);
    this.srcs.push(s);
    if (stopAt > this.end) this.end = stopAt;
  }
  private env(g: GainNode, t0: number, v: number, attack: number, hold: number, dur: number) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v, t0 + attack);
    if (hold > 0) g.gain.setValueAtTime(v, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(FLOOR, t0 + attack + hold + dur);
  }

  noise(o: NoiseOpts) {
    if (o.v <= 0.0005 || o.dur <= 0) return;
    const c = this.c;
    const t0 = this.t + (o.at ?? 0);
    const attack = o.attack ?? 0.001, hold = o.hold ?? 0;
    const src = c.createBufferSource();
    const buf = o.brown ? this.bank.brown : this.bank.white;
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.92 + rnd() * 0.16);
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(this.nyq(o.f), t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(this.nyq(o.f2), t0 + (o.sweep ?? o.dur));
    let node: AudioNode = src.connect(f);
    if (o.grit) {
      const pre = c.createGain();
      pre.gain.value = 1 + o.grit * 3;
      const ws = c.createWaveShaper();
      ws.curve = curve(this.bank, 1 + o.grit * 5);
      node = node.connect(pre).connect(ws);
    }
    const g = c.createGain();
    this.env(g, t0, o.v, attack, hold, o.dur);
    node.connect(g).connect(this.out);
    const total = attack + hold + o.dur + 0.02;
    src.start(t0, rnd() * Math.max(0, buf.duration - total - 0.05));
    this.track(src, t0 + total);
  }

  tone(o: ToneOpts) {
    if (o.v <= 0.0005 || o.dur <= 0) return;
    const c = this.c;
    const t0 = this.t + (o.at ?? 0);
    const attack = o.attack ?? 0.002;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(this.nyq(o.f), t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(this.nyq(o.f2), t0 + (o.sweep ?? o.dur));
    const g = c.createGain();
    this.env(g, t0, o.v, attack, 0, o.dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = this.nyq(o.lp);
      node = node.connect(f);
    }
    node.connect(g).connect(this.out);
    osc.start(t0);
    this.track(osc, t0 + attack + o.dur + 0.02);
  }

  /** Metallic ring: inharmonic sine partials, upper ones decaying faster. */
  ring(at: number, freqs: number[], dur: number, v: number) {
    freqs.forEach((f, i) => this.tone({ at, f, dur: dur * (1 - i * 0.18), v: v / Math.sqrt(i + 1), attack: 0.0008 }));
  }

  /** A short band-passed noise tick: clicks, clacks, latches. */
  tick(at: number, f: number, v: number, dur = 0.02, q = 4) {
    this.noise({ at, dur, v, type: 'bandpass', f, q, attack: 0.0005 });
  }
}

// ---------------------------------------------------------------------------
// Street impulse response: facade early reflections + a short dark decay.
// ---------------------------------------------------------------------------
function streetIR(c: Ctx): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.floor(sr * 1.5);
  const ir = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    // early reflections: brick fronts across the road, the porch, the truck
    for (let k = 0; k < 9; k++) {
      const at = Math.floor(sr * (0.008 + rnd() * 0.075));
      const amp = (0.25 + rnd() * 0.5) * (1 - k * 0.06) * (rnd() < 0.5 ? -1 : 1);
      for (let i = 0; i < 40 && at + i < len; i++) d[at + i] += amp * Math.exp(-i / 8) * (rnd() * 0.6 + 0.4);
    }
    // diffuse tail, getting darker as it goes
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const fadeIn = Math.min(1, t / 0.03);
      const n = (rnd() * 2 - 1) * Math.exp(-t / 0.3) * fadeIn * 0.5;
      const a = Math.max(0.04, 0.9 - t * 1.4); // one-pole coefficient: high = bright
      lp += a * (n - lp);
      d[i] += lp;
    }
  }
  return ir;
}

function comp(c: Ctx, threshold: number, knee: number, ratio: number, attack: number, release: number) {
  const k = c.createDynamicsCompressor();
  k.threshold.value = threshold;
  k.knee.value = knee;
  k.ratio.value = ratio;
  k.attack.value = attack;
  k.release.value = release;
  return k;
}
function gain(c: Ctx, v: number) {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}

// ---------------------------------------------------------------------------
// Engine: buses + voices.
// ---------------------------------------------------------------------------
export interface Voice { out: GainNode; gain: number; start: number; end: number; pri: number; srcs: AudioScheduledSourceNode[] }
export interface VoiceOpts { gain?: number; far?: boolean; rev?: number; echo?: number; pan?: number; pri?: number }

export class Engine {
  readonly master: GainNode;
  readonly sfxVol: GainNode;
  /** Low-pass on the whole sfx bus (ambience included): ears ringing after heavy fire. 20 kHz = open. */
  readonly muffleLp: BiquadFilterNode;
  readonly sfxIn: GainNode;
  readonly musicIn: GainNode;   // ducking stage
  readonly musicVol: GainNode;
  readonly revIn: GainNode;
  readonly echoIn: GainNode;
  readonly farIn: GainNode;
  /** Ambience beds (recorded loops): straight to the sfx volume, past the glue compressor. */
  readonly ambIn: GainNode;
  maxVoices = 40;
  voices: Voice[] = [];
  private lastAt = new Map<string, number>();

  constructor(readonly c: Ctx) {
    const masterLim = comp(c, -1, 0, 20, 0.001, 0.08);
    masterLim.connect(c.destination);
    this.master = gain(c, 1);
    this.master.connect(masterLim);

    this.sfxVol = gain(c, 1);
    this.muffleLp = c.createBiquadFilter();
    this.muffleLp.type = 'lowpass';
    this.muffleLp.frequency.value = 20000;
    this.muffleLp.Q.value = 0.5;
    this.sfxVol.connect(this.muffleLp).connect(this.master);
    const lim = comp(c, -3, 0, 20, 0.001, 0.1);
    lim.connect(this.sfxVol);
    const makeup = gain(c, 1.45);
    makeup.connect(lim);
    const glue = comp(c, -18, 10, 3.5, 0.004, 0.22);
    glue.connect(makeup);
    this.sfxIn = gain(c, 1);
    this.sfxIn.connect(glue);

    this.ambIn = gain(c, 1);
    this.ambIn.connect(this.sfxVol);

    this.musicVol = gain(c, 1);
    this.musicVol.connect(this.master);
    this.musicIn = gain(c, 1);
    this.musicIn.connect(this.musicVol);

    // street reverb (shared by every shot)
    this.revIn = gain(c, 1);
    const revHp = c.createBiquadFilter();
    revHp.type = 'highpass';
    revHp.frequency.value = 160;
    const conv = c.createConvolver();
    conv.buffer = streetIR(c);
    const revOut = gain(c, 0.9);
    this.revIn.connect(revHp).connect(conv).connect(revOut).connect(this.sfxIn);

    // one slap-back echo off the houses across Ferry Road, slightly to one side
    this.echoIn = gain(c, 1);
    const eLp = c.createBiquadFilter();
    eLp.type = 'lowpass';
    eLp.frequency.value = 2200;
    const eHp = c.createBiquadFilter();
    eHp.type = 'highpass';
    eHp.frequency.value = 220;
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = gain(c, 0.24);
    const fbLp = c.createBiquadFilter();
    fbLp.type = 'lowpass';
    fbLp.frequency.value = 1400;
    const echoOut = gain(c, 0.5);
    const pan = c.createStereoPanner();
    pan.pan.value = 0.35;
    this.echoIn.connect(eLp).connect(eHp).connect(delay);
    delay.connect(fb).connect(fbLp).connect(delay);
    delay.connect(echoOut).connect(pan).connect(this.sfxIn);
    echoOut.connect(gain(c, 0.35)).connect(this.revIn);

    // distance: dull the dry sound, feed more tail
    this.farIn = gain(c, 1);
    const farLp = c.createBiquadFilter();
    farLp.type = 'lowpass';
    farLp.frequency.value = 1150;
    farLp.Q.value = 0.4;
    this.farIn.connect(farLp).connect(this.sfxIn);
    this.farIn.connect(gain(c, 0.5)).connect(this.revIn);
    this.farIn.connect(gain(c, 0.45)).connect(this.echoIn);
  }

  get now() { return this.c.currentTime; }

  /** Throttle: false if `key` already played within `gap` seconds of time t. */
  gate(key: string, t: number, gap: number): boolean {
    const last = this.lastAt.get(key);
    if (last !== undefined && Math.abs(t - last) < gap) return false;
    this.lastAt.set(key, t);
    return true;
  }

  /** Allocate a voice (stealing the oldest low-priority one past the cap). */
  voice(t: number, len: number, o: VoiceOpts = {}): Voice {
    const now = this.now;
    this.voices = this.voices.filter((v) => v.end > now);
    const pri = o.pri ?? 1;
    // voices that will still be sounding when this one starts
    const live = this.voices.filter((v) => v.end > t && v.start <= t + 0.001);
    while (live.length >= this.maxVoices) {
      let vi = 0;
      for (let i = 1; i < live.length; i++) {
        const a = live[i], b = live[vi];
        if (a.pri < b.pri || (a.pri === b.pri && a.start < b.start)) vi = i;
      }
      this.kill(live[vi], Math.max(now, t));
      live.splice(vi, 1);
    }
    const c = this.c;
    const g = o.gain ?? 1;
    const out = gain(c, g);
    let tail: AudioNode = out;
    if (o.pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail = out.connect(p);
    }
    tail.connect(o.far ? this.farIn : this.sfxIn);
    if (o.rev) tail.connect(gain(c, o.rev)).connect(this.revIn);
    if (o.echo) tail.connect(gain(c, o.echo)).connect(this.echoIn);
    const v: Voice = { out, gain: g, start: t, end: t + len, pri, srcs: [] };
    this.voices.push(v);
    return v;
  }

  /** Fade a voice out at time `at` (default now) and stop its sources. */
  kill(v: Voice, at = this.now, fade = 0.03) {
    const g = v.out.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(v.gain, at);
    g.linearRampToValueAtTime(0, at + fade);
    for (const s of v.srcs) { try { s.stop(at + fade + 0.01); } catch { /* not started / already stopped */ } }
    v.end = at;
  }

  /** Make a voice and a Synth writing into it; `len` is a max length guess (cap bookkeeping). */
  synth(delay: number, len: number, o: VoiceOpts = {}): Synth {
    const t = this.now + Math.max(0, delay);
    const v = this.voice(t, len, o);
    return new Synth(this.c, v.out, t, v.srcs);
  }

  /** Briefly duck the music under a loud sound. amount 0..1. */
  duck(amount: number, delay = 0) {
    if (amount <= 0.02) return;
    const g = this.musicIn.gain;
    const t = this.now + delay;
    const target = 1 - Math.min(0.65, amount * 0.6);
    g.cancelScheduledValues(t);
    g.setTargetAtTime(target, t, 0.012);
    g.setTargetAtTime(1, t + 0.08 + amount * 0.12, 0.25);
    // the night ambience dips a little too, so a shot reads over the wind
    const a = this.ambIn.gain;
    a.cancelScheduledValues(t);
    a.setTargetAtTime(1 - Math.min(0.4, amount * 0.35), t, 0.02);
    a.setTargetAtTime(1, t + 0.15 + amount * 0.2, 0.6);
  }
}
