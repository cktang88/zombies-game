// Procedural sound: no audio files, just shaped noise and oscillators.
//
// Routing:  sfx voices ─► sfxBus ─┐
//           music beds ─► musicBus ┼─► master ─► destination
//                     (reverb send)┘
//
// Public API:
//   sfx.*                       one-shot effects (unchanged)
//   wind(on)                    low wind ambience used by the night canvases
//   music(mode)                 'title' | 'day' | 'night' | 'off' — crossfades beds
//   setMasterVolume / setMusicVolume / setSfxVolume (0..1)
//   setMuted(bool), muted
//
// Browsers only allow an AudioContext after a user gesture. music() may be called
// before that; the requested mode starts on the first pointer/key press.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let reverb: ConvolverNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;

const vol = { master: 0.7, music: 0.55, sfx: 0.8 };

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol.master;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = vol.sfx;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = vol.music;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
  }
  if (ctx.state === 'suspended' && !document.hidden) void ctx.resume();
  return ctx;
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
  ramp(master?.gain, m ? 0 : vol.master);
}
export function setMasterVolume(v: number) {
  vol.master = clamp01(v);
  if (!muted) ramp(master?.gain, vol.master);
}
export function setMusicVolume(v: number) {
  vol.music = clamp01(v);
  ramp(musicBus?.gain, vol.music);
}
export function setSfxVolume(v: number) {
  vol.sfx = clamp01(v);
  ramp(sfxBus?.gain, vol.sfx);
}

function noise(dur: number, freq: number, q: number, v: number, decay: number, type: BiquadFilterType = 'lowpass', when = 0) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(f).connect(g).connect(sfxBus!);
  src.start(t, Math.random(), dur);
}

function tone(freq: number, dur: number, v: number, type: OscillatorType = 'sine', slide = 0, when = 0) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(sfxBus!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  shot(kind: string, far = false) {
    const v = far ? 0.25 : 0.6;
    if (kind === 'pump') { noise(0.5, 900, 0.7, v * 1.2, 0.45); tone(70, 0.2, v * 0.6, 'sine', -30); }
    else if (kind === 'hunting') { noise(0.7, 1600, 0.6, v * 1.3, 0.6); tone(55, 0.3, v * 0.7, 'sine', -20); }
    else if (kind === 'nailer') { noise(0.08, 3000, 2, v * 0.4, 0.07, 'bandpass'); tone(400, 0.05, 0.1, 'square', -200); }
    else if (kind === 'smg' || kind === 'carbine') { noise(0.15, 2200, 0.8, v * 0.8, 0.13); }
    else { noise(0.3, 1800, 0.7, v, 0.25); tone(90, 0.1, v * 0.4, 'sine', -40); }
  },
  click() { tone(1800, 0.03, 0.15, 'square'); },
  reload() { noise(0.05, 2500, 3, 0.2, 0.05, 'bandpass'); noise(0.05, 1800, 3, 0.2, 0.05, 'bandpass', 0.12); },
  shell() { noise(0.04, 3000, 4, 0.18, 0.04, 'bandpass'); },
  hit() { noise(0.08, 500, 1, 0.3, 0.08); },
  headpop() { noise(0.15, 700, 1, 0.5, 0.14); tone(140, 0.08, 0.2, 'sine', -80); },
  thud() { noise(0.15, 220, 1, 0.35, 0.15); },
  wallHit() { noise(0.12, 300, 2, 0.28, 0.12, 'bandpass'); },
  groan() { tone(80 + Math.random() * 60, 0.9, 0.06, 'sawtooth', -30); },
  scream() { tone(900 + Math.random() * 300, 1.2, 0.08, 'sawtooth', 500); tone(1300, 1.0, 0.04, 'triangle', -400); },
  burst() { noise(0.6, 400, 0.6, 0.6, 0.6); },
  boom() { noise(1.2, 300, 0.5, 1, 1.1); tone(45, 0.8, 0.6, 'sine', -20); },
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
