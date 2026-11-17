// Procedural sound: no audio files, just shaped noise and oscillators.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}

function noise(dur: number, freq: number, q: number, vol: number, decay: number, type: BiquadFilterType = 'lowpass', when = 0) {
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
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random(), dur);
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 0, when = 0) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master!);
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
    windNode.connect(f).connect(g).connect(master!);
    windNode.start();
  } else if (!on && windNode) {
    windNode.stop();
    windNode = null;
  }
}
