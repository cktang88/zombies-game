// Offline level check for the sound kit (used by the dev sound board and CI-ish
// Playwright runs). Renders every sound in an OfflineAudioContext and reports
// peak / loudness, flags silent or clipping sounds, and stress-tests the full
// bus chain with LMG fire + shotguns + an explosion.

import { Engine, Synth } from './engine';
import { GUN_KINDS } from './guns';
import { TAKES, ensureGun, playGun } from './gunbank';
import {
  CASING_KINDS, IMPACT_KINDS, RELOAD_KINDS, RELOAD_STAGES,
  casing, confirm, dryFire, explosion, impact, jam, overheat, reload,
} from './foley';

export interface Row { name: string; peak: number; rms: number; ok: boolean; note?: string }
export interface Report { sampleRate: number; rows: Row[]; chain: { peak: number; clipped: number; maxVoices: number }; failures: string[] }

const SR = 44100;

function stats(b: AudioBuffer, win = 0.15) {
  let peak = 0, s = 0, n = 0;
  const w = Math.floor(b.sampleRate * win);
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (i < w) { s += d[i] * d[i]; n++; }
    }
  }
  return { peak, rms: Math.sqrt(s / Math.max(1, n)) };
}
/** Loudest 150 ms window — foley sounds don't all start loud. */
function maxWindowRms(b: AudioBuffer) {
  const d = b.getChannelData(0);
  const w = Math.floor(b.sampleRate * 0.15);
  let best = 0;
  for (let st = 0; st + w <= d.length || st === 0; st += Math.floor(w / 3)) {
    let s = 0;
    const end = Math.min(d.length, st + w);
    for (let i = st; i < end; i++) s += d[i] * d[i];
    best = Math.max(best, Math.sqrt(s / Math.max(1, end - st)));
    if (end >= d.length) break;
  }
  return best;
}

async function dry(len: number, draw: (s: Synth) => void) {
  const oc = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
  draw(new Synth(oc, oc.destination, 0.01));
  return oc.startRendering();
}

export async function runSelfTest(): Promise<Report> {
  const rows: Row[] = [];
  const failures: string[] = [];
  const add = (name: string, peak: number, rms: number, minRms: number, maxPeak: number) => {
    const ok = peak <= maxPeak && rms >= minRms;
    const note = peak > maxPeak ? 'too hot' : rms < minRms ? 'too quiet' : undefined;
    rows.push({ name, peak, rms, ok, note });
    if (!ok) failures.push(`${name}: ${note} (peak ${peak.toFixed(3)}, rms ${rms.toFixed(4)})`);
  };

  // guns: rendered takes (what actually plays), dry/suppressed/distant
  for (const k of GUN_KINDS) {
    for (const [tag, sup, far] of [['', false, false], [' suppressed', true, false], [' far', false, true]] as const) {
      const e = await ensureGun(SR, k, sup, far);
      if (!e) { failures.push(`${k}${tag}: no render`); continue; }
      let peak = 0, rms = 0;
      for (const b of e.bufs) { const s = stats(b); peak = Math.max(peak, s.peak); rms += s.rms / TAKES; }
      add(`gun ${k}${tag}`, peak, rms, 0.01, 0.96);
      if (!sup && !far) {
        // takes must differ (variation)
        const a = e.bufs[0].getChannelData(0), b = e.bufs[1].getChannelData(0);
        let diff = 0, en = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) { diff += (a[i] - b[i]) ** 2; en += a[i] * a[i]; }
        if (diff / Math.max(1e-9, en) < 0.05) failures.push(`gun ${k}: takes are near-identical`);
      }
    }
  }

  // foley, dry (pre-bus): must have energy and must not clip
  const foley: [string, number, (s: Synth) => void][] = [];
  for (const k of IMPACT_KINDS) foley.push([`impact ${k}`, 1, (s) => impact(s, k)]);
  for (let i = 1; i <= 12; i += 5) foley.push([`confirm ${i}`, 0.2, (s) => confirm(s, i)]);
  for (const k of RELOAD_KINDS) for (const st of RELOAD_STAGES) foley.push([`reload ${k}/${st}`, 1, (s) => reload(s, k, st)]);
  for (const k of CASING_KINDS) foley.push([`casing ${k}`, 0.6, (s) => casing(s, k)]);
  foley.push(['dry', 0.2, dryFire], ['jam', 0.5, jam], ['overheat', 1.5, overheat], ['explosion 1', 3.5, (s) => explosion(s, 1)], ['explosion 2', 6, (s) => explosion(s, 2)]);
  for (const [name, len, draw] of foley) {
    const b = await dry(len, draw);
    add(name, stats(b).peak, maxWindowRms(b), 0.004, name.startsWith('explosion') ? 2.5 : 1.2);
  }

  // full chain stress: LMG at 12 rps for 3 s over shotguns, a muzzleloader and an explosion
  const oc = new OfflineAudioContext(2, SR * 5, SR);
  const E = new Engine(oc);
  let maxVoices = 0;
  const shots: [number, string, object?][] = [];
  for (let i = 0; i < 36; i++) shots.push([0.1 + i / 12, 'lmg']);
  for (let i = 0; i < 20; i++) shots.push([0.2 + i * 0.15, 'carbine', { far: 0.5 }]);
  shots.push([0.5, 'pump'], [0.9, 'double'], [0.9, 'double'], [1.4, 'muzzleloader'], [1.6, 'boltRifle'], [2.2, 'marksman'], [2.6, 'rocket']);
  const concurrent = () => {
    let m = 0;
    for (const v of E.voices) m = Math.max(m, E.voices.filter((w) => w.start <= v.start && w.end > v.start).length);
    return m;
  };
  for (const [t, k, o] of shots) { playGun(E, k, { ...(o ?? {}), delay: t }); maxVoices = Math.max(maxVoices, concurrent()); }
  for (let i = 0; i < 24; i++) { const s = E.synth(0.3 + i * 0.1, 0.5, { rev: 0.06 }); impact(s, IMPACT_KINDS[i % IMPACT_KINDS.length]); }
  explosion(E.synth(2.0, 3.5, { rev: 0.6, echo: 0.5, pri: 3 }), 1.4);
  maxVoices = Math.max(maxVoices, concurrent());
  const out = await oc.startRendering();
  let peak = 0, clipped = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = out.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++; }
  }
  if (peak > 1) failures.push(`chain peak ${peak.toFixed(3)} > 1`);
  if (clipped > 0) failures.push(`chain clipped ${clipped} samples`);
  if (maxVoices > E.maxVoices) failures.push(`voices ${maxVoices} > cap ${E.maxVoices}`);
  return { sampleRate: SR, rows, chain: { peak, clipped, maxVoices }, failures };
}
