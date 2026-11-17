// Dev sound board (soundboard.html): audition every sound in the kit.
import {
  sfx, music, gunSoundFor, setMasterVolume, setMusicVolume, setSfxVolume, type GunKind, type MusicMode,
  ambience, ambienceLayer, wind, auditionSample, loadSampleSet, sampleLoaded, ZOMBIE_VOICE_KINDS, ZOMBIE_VOICE_TYPES,
} from './audio';
import { GUN_KINDS } from './audio/guns';
import { CASING_KINDS, IMPACT_KINDS, MELEE_KINDS, RELOAD_KINDS, RELOAD_STAGES, SEARCH_KINDS, SURFACES, type ReloadKind } from './audio/foley';
import { SAMPLES, SAMPLE_IDS, sampleFailures } from './audio/samples';
import { runSelfTest } from './audio/selftest';
import { WEAPONS, WEAPON_ORDER } from './data/weapons';

const app = document.getElementById('app')!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const el = (tag: string, props: Record<string, any> = {}, ...kids: (Node | string)[]): any => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const section = (title: string, ...kids: Node[]) => app.append(el('h2', { textContent: title }), ...kids);
const row = (...kids: Node[]) => el('div', { className: 'row' }, ...kids);
const btn = (label: string, fn: () => void): HTMLButtonElement => el('button', { textContent: label, onclick: fn });
const check = (label: string) => {
  const i: HTMLInputElement = el('input', { type: 'checkbox' });
  return { input: i, node: el('label', {}, i, label) };
};

// --- options --------------------------------------------------------------------
const sup = check('suppressed'), far = check('far (guard)'), noAction = check('no action'), fire = check('incendiary');
const dist: HTMLInputElement = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0.6' });
const opts = () => ({
  suppressed: sup.input.checked, far: far.input.checked ? Number(dist.value) : false,
  action: !noAction.input.checked, incendiary: fire.input.checked,
});
section('Shot options', row(sup.node, far.node, el('label', {}, 'distance', dist), noAction.node, fire.node));

// --- gun families ---------------------------------------------------------------
section('Gun families — sfx.gun(kind)', row(...GUN_KINDS.map((k) => btn(k, () => sfx.gun(k, opts())))));

// --- weapons ---------------------------------------------------------------------
section('Weapons — sfx.shoot(defId) (shot + casing)', row(...WEAPON_ORDER.map((id) => {
  const g = gunSoundFor(id);
  const b = btn(WEAPONS[id].name, () => sfx.shoot(id, opts()));
  b.title = `${id} → ${g.kind} · reload ${g.reload} · casing ${g.casing ?? '—'}`;
  return b;
})));

// --- hold-to-fire -------------------------------------------------------------------
let auto: number | null = null;
const hold = (id: string) => {
  const rof = WEAPONS[id].rof;
  const b = btn(`hold: ${WEAPONS[id].name} (${rof}/s)`, () => {});
  const start = () => { stop(); sfx.shoot(id, opts()); auto = window.setInterval(() => sfx.shoot(id, opts()), 1000 / rof); };
  const stop = () => { if (auto !== null) clearInterval(auto); auto = null; };
  b.onpointerdown = start;
  b.onpointerup = b.onpointerleave = stop;
  return b;
};
section('Full auto (hold)', row(hold('lmg'), hold('smg'), hold('carbine'), hold('nailer'),
  btn('mp93 burst', () => { for (let i = 0; i < 3; i++) sfx.shoot('mp93', { ...opts(), delay: i * 0.05 }); }),
  btn('guard volley (far)', () => { for (let i = 0; i < 6; i++) sfx.shoot(['ar15', 'pump', 'hunting', 'service9', 'lever', 'carbine'][i], { far: 0.3 + Math.random() * 0.6, delay: i * 0.22, pan: Math.random() - 0.5 }); })));

// --- impacts ---------------------------------------------------------------------
let streak = 0, streakT = 0;
section('Impacts — sfx.impact(kind)', row(...IMPACT_KINDS.map((k) => btn(k, () => sfx.impact(k))),
  btn('confirm (streak)', () => {
    const now = performance.now();
    streak = now - streakT < 1500 ? streak + 1 : 1;
    streakT = now;
    sfx.confirm(streak);
  }),
  btn('headshot kill', () => { sfx.shoot('hunting'); sfx.impact('head', { delay: 0.03 }); sfx.confirm(1); })));

// --- reloads ---------------------------------------------------------------------
const kindSel: HTMLSelectElement = el('select', {}, ...RELOAD_KINDS.map((k) => el('option', { value: k, textContent: k })));
section('Reload stages — sfx.reload(kind, stage)', row(kindSel, ...RELOAD_STAGES.map((st) => btn(st, () => sfx.reload(kindSel.value as ReloadKind, st)))));
section('Full reloads — sfx.reloadFor(defId, seconds)', row(...WEAPON_ORDER.map((id) => btn(id, () => sfx.reloadFor(id, WEAPONS[id].reload)))));

// --- casings & handling ---------------------------------------------------------------
section('Casings & handling', row(...CASING_KINDS.map((k) => btn(`casing ${k}`, () => sfx.casing(k, 0))),
  btn('dry fire', () => sfx.dry()), btn('jam', () => sfx.jam()), btn('overheat', () => sfx.overheat())));
section('Explosions', row(btn('explosion 0.6', () => sfx.explosion(0.6)), btn('explosion 1', () => sfx.explosion(1)),
  btn('explosion 1.8', () => sfx.explosion(1.8)), btn('far explosion', () => sfx.explosion(1, { far: true }))));

// --- legacy -------------------------------------------------------------------------
const legacy = ['click', 'reload', 'shell', 'hit', 'headpop', 'thud', 'wallHit', 'groan', 'scream', 'burst', 'boom', 'fire', 'hurt', 'bell', 'ui'] as const;
section('Legacy sfx.* (still used by the game)', row(...legacy.map((k) => btn(k, () => sfx[k]())),
  btn("shot('pump')", () => sfx.shot('pump')), btn("shot('ar15', far)", () => sfx.shot('ar15', true))));

// --- recorded samples ------------------------------------------------------------------
const pan = (): number => Math.random() * 1.2 - 0.6;
section('Zombie voices — sfx.zombieVoice(type, kind)', ...ZOMBIE_VOICE_TYPES.map((t) =>
  row(el('label', { textContent: t, style: 'min-width:80px' }), ...ZOMBIE_VOICE_KINDS.map((k) => btn(k, () => sfx.zombieVoice(t, k, { pan: pan() })))),
), row(btn('horde (12 mixed)', () => {
  for (let i = 0; i < 12; i++) {
    const t = ZOMBIE_VOICE_TYPES[Math.floor(Math.random() * 5)], k = ZOMBIE_VOICE_KINDS[Math.floor(Math.random() * 3)];
    sfx.zombieVoice(t, k, { pan: pan(), delay: i * 0.18 });
  }
})));
const MELEE_WEAPONS = ['machete', 'hatchet', 'crowbar', 'bat', 'knife', 'sledge', 'fist'];
section('Melee — sfx.melee(kind, weapon)', ...MELEE_WEAPONS.map((w) => row(el('label', { textContent: w, style: 'min-width:80px' }),
  ...MELEE_KINDS.map((k) => btn(k, () => sfx.melee(k, w))),
  btn('swing + hit', () => { sfx.melee('swing', w); sfx.melee('hit', w, { delay: 0.12 }); }))));
let walk: number | null = null;
section('Footsteps — sfx.footstep(surface)', row(...SURFACES.map((s) => btn(s, () => sfx.footstep(s))),
  btn('walk 3 s on asphalt', () => { if (walk) return; let n = 0; walk = window.setInterval(() => { sfx.footstep('asphalt', { pan: n % 2 ? 0.1 : -0.1 }); if (++n > 7) { clearInterval(walk!); walk = null; } }, 420); })));
section('Searching — sfx.search(kind)', row(...SEARCH_KINDS.map((k) => btn(k, () => sfx.search(k)))));
section('UI — sfx.ui(kind)', row(...(['click', 'type', 'paper', 'stamp'] as const).map((k) => btn(k, () => sfx.ui(k)))));
section('Ambience — ambience(scene), ambienceLayer(kind, level)', row(
  ...(['night', 'day', 'run', 'title', 'off'] as const).map((s) => btn(`ambience ${s}`, () => ambience(s))),
  ...(['fire', 'generator', 'static', 'river'] as const).map((k) => {
    let on = false;
    return btn(`layer ${k}`, () => { on = !on; ambienceLayer(k, on ? 0.5 : 0); });
  }),
  btn('wind on', () => wind(true)), btn('wind off', () => wind(false))));

// every recorded set, raw: decode check + audition
const sampStatus = el('div', { id: 'samples-status' });
section('Recorded sample sets (public/sfx, CC0 — CREDITS.md)', sampStatus, row(btn('Load & decode all', () => void loadAll()),
  ...SAMPLE_IDS.map((id) => btn(`${id} ×${SAMPLES[id].n}`, () => {
    if (!sampleLoaded(id)) { void loadSampleSet(id).then(() => auditionSample(id)); return; }
    auditionSample(id);
  }))));
async function loadAll() {
  sampStatus.textContent = 'loading…';
  const res = await Promise.all(SAMPLE_IDS.map(async (id) => [id, await loadSampleSet(id)] as const));
  const bad = res.filter(([, ok]) => !ok).map(([id]) => id);
  const files = SAMPLE_IDS.reduce((n, id) => n + SAMPLES[id].n, 0);
  sampStatus.className = sampleFailures.length ? 'bad' : 'ok';
  sampStatus.textContent = `${res.length} sets · ${files} files · ${sampleFailures.length} failed` +
    (bad.length ? `\nsets with nothing decoded: ${bad.join(', ')}` : '') + (sampleFailures.length ? '\n' + sampleFailures.join('\n') : '');
  const out = { sets: res.length, files, failures: [...sampleFailures], emptySets: bad };
  (window as unknown as { __samplesResult: unknown }).__samplesResult = out;
  return out;
}
(window as unknown as { __loadAllSamples: typeof loadAll }).__loadAllSamples = loadAll;

// --- music & mix --------------------------------------------------------------------
const slider = (label: string, v: number, fn: (v: number) => void) => {
  const i: HTMLInputElement = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(v) });
  i.oninput = () => fn(Number(i.value));
  return el('label', {}, label, i);
};
section('Music & mix', row(...(['title', 'day', 'night', 'off'] as MusicMode[]).map((m) => btn(`music ${m}`, () => music(m))),
  slider('master', 0.7, setMasterVolume), slider('music', 0.55, setMusicVolume), slider('sfx', 0.8, setSfxVolume)));

// --- level check ---------------------------------------------------------------------
const status = el('div', { id: 'status' });
const table = el('table');
section('Offline level check', row(btn('Run level check', () => void check2())), status, table);
async function check2() {
  status.textContent = 'rendering…';
  const r = await runSelfTest();
  status.className = r.failures.length ? 'bad' : 'ok';
  status.textContent = `${r.rows.length} sounds · chain peak ${r.chain.peak.toFixed(3)} · clipped ${r.chain.clipped} · max voices ${r.chain.maxVoices}\n` +
    (r.failures.length ? r.failures.join('\n') : 'all OK');
  table.replaceChildren(el('tr', {}, el('th', { textContent: 'sound' }), el('th', { textContent: 'peak' }), el('th', { textContent: 'rms 150ms' }), el('th', { textContent: '' })),
    ...r.rows.map((x): Node => el('tr', { className: x.ok ? '' : 'bad' }, el('td', { textContent: x.name }), el('td', { textContent: x.peak.toFixed(3) }),
      el('td', { textContent: x.rms.toFixed(4) }), el('td', { textContent: x.note ?? '' }))));
  (window as unknown as { __selftestResult: unknown }).__selftestResult = r;
}
(window as unknown as { __selftest: typeof runSelfTest }).__selftest = runSelfTest;
export type { GunKind };
