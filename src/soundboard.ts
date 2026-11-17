// Dev sound board (soundboard.html): audition every sound in the kit.
import { sfx, music, gunSoundFor, setMasterVolume, setMusicVolume, setSfxVolume, type GunKind, type MusicMode } from './audio';
import { GUN_KINDS } from './audio/guns';
import { CASING_KINDS, IMPACT_KINDS, RELOAD_KINDS, RELOAD_STAGES, type ReloadKind } from './audio/foley';
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
