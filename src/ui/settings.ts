// Player settings: one ledger page with five tabs (Audio, Video, Gameplay, Controls, Data),
// reachable from the title, the day screen (⚙) and the pause menu at night and on runs.
//
// Storage (localStorage, every access wrapped in try/catch):
//   key 'vessey-settings-v1' → JSON Settings (below); unknown or bad fields fall back to defaults
//   key bindings live in ui/keys.ts ('vessey-keys-v1')
//
// Game code reads settings through the small getters below (reduceShake(), screenFx(),
// hitMarkers() …) rather than parsing storage: the parsed object is cached in memory and
// updated whenever the page changes it.

import { setMasterVolume, setMusicVolume, setReducedGore, setSfxVolume, setAmbienceVolume, setMuted, sfx, volumes } from '../audio';
import { ACTIONS, FIXED, conflicts, keyLabel, keyOf, normKey, reserved, resetKeys, setKey, type KeyCtx } from './keys';
import { resetHints } from './onboarding';

export type TextSize = 'S' | 'M' | 'L';
export interface Settings {
  // ---- audio
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  muted: boolean;
  // ---- video
  /** Character animation: 'rigged' (cutout bone rigs, default) or 'classic' (single images). */
  animation: 'rigged' | 'classic';
  reduceShake: boolean;
  reduceGore: boolean;
  /** Screen flashes (kill / wall / nerve edges) and hitstop (the world holding still on a heavy hit). */
  flashes: boolean;
  hitMarkers: boolean;
  /** Weakspot rings and the other damage-zone tells drawn on the Turned. */
  zoneMarkers: boolean;
  textSize: TextSize;
  highContrast: boolean;
  showFps: boolean;
  // ---- gameplay
  /** Gun handling: 'standard' (default) or 'hardcore' (hidden ammo count, more double-feeds, speed reloads lose the mag). */
  realism: 'standard' | 'hardcore';
  /** Reload by itself when the gun runs dry (otherwise it clicks until you press reload). */
  autoReload: boolean;
  /** Focus on the right mouse button: hold, or click to toggle. */
  focusMode: 'hold' | 'toggle';
  /** The threat ribbon at the top of the night screen (what's coming, from where). */
  threatRibbon: boolean;
}

export const SETTINGS_KEY = 'vessey-settings-v1';
const DEFAULTS: Settings = {
  master: 0.7, music: 0.55, sfx: 0.8, ambience: 0.8, muted: false,
  animation: 'rigged', reduceShake: false, reduceGore: false, flashes: true, hitMarkers: true, zoneMarkers: true, textSize: 'M', highContrast: false, showFps: false,
  realism: 'standard', autoReload: true, focusMode: 'hold', threatRibbon: true,
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  let s: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) s = JSON.parse(raw) as Partial<Settings>;
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  cache = {
    master: num(s.master, DEFAULTS.master),
    music: num(s.music, DEFAULTS.music),
    sfx: num(s.sfx, DEFAULTS.sfx),
    ambience: num(s.ambience, DEFAULTS.ambience),
    muted: bool(s.muted, false),
    animation: s.animation === 'classic' ? 'classic' : 'rigged',
    reduceShake: bool(s.reduceShake, false),
    reduceGore: bool(s.reduceGore, false),
    flashes: bool(s.flashes, true),
    hitMarkers: bool(s.hitMarkers, true),
    zoneMarkers: bool(s.zoneMarkers, true),
    textSize: s.textSize === 'S' || s.textSize === 'L' ? s.textSize : 'M',
    highContrast: bool(s.highContrast, false),
    showFps: bool(s.showFps, false),
    realism: s.realism === 'hardcore' ? 'hardcore' : 'standard',
    autoReload: bool(s.autoReload, true),
    focusMode: s.focusMode === 'toggle' ? 'toggle' : 'hold',
    threatRibbon: bool(s.threatRibbon, true),
  };
  return cache;
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  const s = getSettings();
  s[k] = v;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  applyAudio();
  applyDisplay();
}

/** True when the player asked for less screen shake. */
export const reduceShake = () => getSettings().reduceShake;
/** True when the player asked for less gore. */
export const reduceGore = () => getSettings().reduceGore;
/** Multiply camera shake amplitudes by this (0.2 when reduced, else 1). */
export const shakeScale = () => (getSettings().reduceShake ? 0.2 : 1);
/** Gun-handling realism: 'standard' (default) or 'hardcore'. */
export const realism = (): 'standard' | 'hardcore' => getSettings().realism;
/** Character animation the player chose: 'rigged' (bone rigs) or 'classic' (single images).
 * The night code asks night/actors.ts rigsOn(), which also honours the automatic fallback. */
export const animationSetting = (): 'rigged' | 'classic' => getSettings().animation;
/** Screen flashes and hitstop on (default). */
export const screenFx = () => getSettings().flashes;
export const hitMarkers = () => getSettings().hitMarkers;
export const zoneMarkers = () => getSettings().zoneMarkers;
export const autoReload = () => getSettings().autoReload;
export const focusToggle = () => getSettings().focusMode === 'toggle';
export const threatRibbon = () => getSettings().threatRibbon;

export function applyAudio() {
  const s = getSettings();
  setMasterVolume(s.master);
  setMusicVolume(s.music);
  setSfxVolume(s.sfx);
  setAmbienceVolume(s.ambience);
  setMuted(s.muted);
  setReducedGore(s.reduceGore);
}

// ---- display: text size and contrast on the document, the frame counter
const TEXT_SCALE: Record<TextSize, number> = { S: 0.9, M: 1, L: 1.18 };
export function applyDisplay() {
  if (typeof document === 'undefined') return;
  const s = getSettings();
  const r = document.documentElement;
  r.style.setProperty('--ui-scale', String(TEXT_SCALE[s.textSize]));
  r.dataset.text = s.textSize;
  r.classList.toggle('hc', s.highContrast);
  fpsMeter(s.showFps);
}
let fpsEl: HTMLElement | null = null;
let fpsRaf = 0;
function fpsMeter(on: boolean) {
  if (!on) { cancelAnimationFrame(fpsRaf); fpsRaf = 0; fpsEl?.remove(); fpsEl = null; return; }
  if (fpsEl) return;
  fpsEl = document.createElement('div');
  fpsEl.className = 'fps';
  fpsEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fpsEl);
  let n = 0, t0 = performance.now(), worst = 0, last = t0;
  const tick = (now: number) => {
    n++;
    worst = Math.max(worst, now - last);
    last = now;
    if (now - t0 >= 500 && fpsEl) {
      fpsEl.textContent = `${Math.round((n * 1000) / (now - t0))} fps · ${worst.toFixed(0)} ms`;
      n = 0; t0 = now; worst = 0;
    }
    fpsRaf = requestAnimationFrame(tick);
  };
  fpsRaf = requestAnimationFrame(tick);
}
applyAudio();
applyDisplay();
/** debug / test handle: globalThis.__settings */
(globalThis as unknown as { __settings: unknown }).__settings = { get: () => ({ ...getSettings() }), set: setSetting, volumes, shakeScale };

// ---- fullscreen (not saved: browsers only allow it from a click)
const fsOn = () => !!document.fullscreenElement;
async function toggleFullscreen() {
  try {
    if (fsOn()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* refused (iframe, iOS): nothing to do */
  }
}

// ---- data: export / import / reset
const DATA_KEYS = { save: 'vessey-save-v1', legacy: 'vessey-legacy-v1', settings: SETTINGS_KEY, keys: 'vessey-keys-v1', hints: 'vessey-onboarding-v1' } as const;
function exportData() {
  const out: Record<string, unknown> = { format: 'vessey-export', v: 1, at: new Date().toISOString() };
  for (const [k, key] of Object.entries(DATA_KEYS)) {
    try { const raw = localStorage.getItem(key); if (raw !== null) out[k] = raw; } catch { /* ignore */ }
  }
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vessey-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
/** Returns an error message, or null when the file was taken (the page then reloads). */
export function importData(text: string): string | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text) as Record<string, unknown>; } catch { return 'That file is not a Vessey export (not JSON).'; }
  if (!o || o.format !== 'vessey-export') return 'That file is not a Vessey export.';
  if (typeof o.save === 'string') {
    try { const s = JSON.parse(o.save) as { version?: number }; if (s.version !== 1) return 'The save in that file is from another version.'; } catch { return 'The save in that file is damaged.'; }
  }
  try {
    for (const [k, key] of Object.entries(DATA_KEYS)) if (typeof o[k] === 'string') localStorage.setItem(key, o[k] as string);
  } catch {
    return 'This browser would not store it (storage full or blocked).';
  }
  return null;
}
function removeKey(key: string) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
const hasKey = (key: string) => { try { return localStorage.getItem(key) !== null; } catch { return false; } };

// ---------------------------------------------------------------------------
// The page. Opens as a modal over whatever is on screen.
// ---------------------------------------------------------------------------

type Tab = 'audio' | 'video' | 'gameplay' | 'controls' | 'data';
const TABS: [Tab, string][] = [['audio', 'Audio'], ['video', 'Video'], ['gameplay', 'Gameplay'], ['controls', 'Controls'], ['data', 'Data']];
let tab: Tab = 'audio';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openSettings(host: HTMLElement = document.body, onClose?: () => void, start?: Tab) {
  if (document.querySelector('.overlay.settings')) return;
  if (start) tab = start;
  const prevFocus = document.activeElement as HTMLElement | null;
  const div = document.createElement('div');
  div.className = 'overlay settings';
  let capture: string | null = null; // action id waiting for a key
  let note = '';
  let confirmId: string | null = null;

  const slider = (k: 'master' | 'music' | 'sfx' | 'ambience', label: string) => {
    const s = getSettings();
    return `<label class="set-row"><span>${label}</span><input type="range" min="0" max="100" step="5" data-k="${k}" value="${Math.round(s[k] * 100)}" aria-label="${label} volume"><output>${Math.round(s[k] * 100)}</output></label>`;
  };
  const check = (k: keyof Settings, label: string, note: string, on: boolean) =>
    `<label class="set-row check"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span>${label}<small>${note}</small></span></label>`;
  const choice = (k: keyof Settings, label: string, opts: [string, string][], cur: string, note = '') =>
    `<div class="set-row choice" role="radiogroup" aria-label="${label}"><span>${label}${note ? `<small>${note}</small>` : ''}</span><span class="seg">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-choice="${k}" data-v="${v}">${l}</button>`).join('')}</span></div>`;

  const body = (): string => {
    const s = getSettings();
    switch (tab) {
      case 'audio': return `
        ${slider('master', 'Master')}${slider('music', 'Music')}${slider('sfx', 'Effects')}${slider('ambience', 'Ambience')}
        ${check('muted', 'Mute everything', 'The same as the title screen\'s "sound off".', s.muted)}`;
      case 'video': return `
        ${choice('animation', 'Animation', [['rigged', 'Rigged'], ['classic', 'Classic']], s.animation, 'Rigged: bone rigs that aim, reload, walk and fall. Classic: single images, lighter (used by itself if the rigs can\'t load or run too slowly).')}
        ${check('reduceShake', 'Reduce screen shake', 'Gunfire and the wall falling barely move the camera.', s.reduceShake)}
        ${check('reduceGore', 'Reduce gore', 'Less blood on the road, no heads coming off. The dead still fall.', s.reduceGore)}
        ${check('flashes', 'Screen flashes and hitstop', 'The screen edge warms on a kill, the wall bar flashes, heavy hits hold the world still for a few frames.', s.flashes)}
        ${check('hitMarkers', 'Hit markers', 'A tick at the crosshair for every hit, coloured by where it landed.', s.hitMarkers)}
        ${check('zoneMarkers', 'Damage-zone markers', 'Faint rings on the Turned\'s weak spots (neck, shoulder, knees, the Biler\'s sac).', s.zoneMarkers)}
        ${choice('textSize', 'Text size', [['S', 'S'], ['M', 'M'], ['L', 'L']], s.textSize)}
        ${check('highContrast', 'High-contrast text', 'Brighter ink, darker paper, no ruled lines.', s.highContrast)}
        <div class="set-row choice"><span>Fullscreen<small>Not saved: the browser asks each time.</small></span><span class="seg"><button type="button" data-act="fullscreen" aria-pressed="${fsOn()}">${fsOn() ? 'Leave fullscreen' : 'Go fullscreen'}</button></span></div>
        ${check('showFps', 'Show frame rate', 'A small counter in the corner: frames per second and the slowest frame.', s.showFps)}`;
      case 'gameplay': return `
        ${choice('realism', 'Realism', [['standard', 'Standard'], ['hardcore', 'Hardcore']], s.realism, 'Hardcore: no exact round count, double-feeds are commoner, and a speed reload leaves the magazine in the snow.')}
        ${check('autoReload', 'Reload when empty', 'The gun reloads by itself when it runs dry. Off: it clicks until you press reload.', s.autoReload)}
        ${choice('focusMode', 'Focus (right mouse)', [['hold', 'Hold'], ['toggle', 'Toggle']], s.focusMode)}
        ${check('threatRibbon', 'Threat ribbon', 'The strip at the top of the night: what is coming up the road and from which side.', s.threatRibbon)}
        <div class="set-row choice"><span>Tutorial hints<small>The notes clipped to the first day's ledger.</small></span><span class="seg"><button type="button" data-act="hints">Show them again</button></span></div>`;
      case 'controls': {
        const clash = conflicts();
        const ctxs: [KeyCtx, string][] = [['night', 'At the wall'], ['run', 'Daylight runs'], ['day', 'The day']];
        return `<p class="dim small">Click a key, then press the new one (Esc cancels). Mouse, number keys, Tab, Shift, the arrows and Esc are fixed.</p>
          ${note ? `<p class="setnote" role="status">${esc(note)}</p>` : ''}
          ${ctxs.map(([c, label]) => `<h3>${label}</h3><div class="keylist">
            ${ACTIONS.filter((a) => a.ctx === c).map((a) => {
              const cl = clash.get(a.id);
              return `<div class="keyrow${cl ? ' clash' : ''}"><span>${esc(a.label)}${cl ? `<small>also ${esc(cl.join(', ').toLowerCase())}</small>` : ''}</span><button type="button" class="kbd${capture === a.id ? ' wait' : ''}" data-bind="${a.id}" aria-label="${esc(a.label)}: ${esc(keyLabel(keyOf(a.id)))}. Click to change.">${capture === a.id ? 'press a key…' : esc(keyLabel(keyOf(a.id)))}</button></div>`;
            }).join('')}
            ${FIXED[c].map(([k, l]) => `<div class="keyrow fixed"><span>${esc(l)}</span><kbd>${esc(k)}</kbd></div>`).join('')}
          </div>`).join('')}
          <button type="button" data-act="resetkeys">Reset all keys to defaults</button>`;
      }
      case 'data': {
        const conf = (id: string, label: string, warn: string) => confirmId === id
          ? `<span class="warn">${warn}</span> <button type="button" class="danger" data-act="${id}-yes">Yes, ${label.toLowerCase()}</button> <button type="button" data-act="cancel">Keep it</button>`
          : `<button type="button" data-act="${id}" ${id === 'delsave' && !hasKey(DATA_KEYS.save) ? 'disabled' : ''}>${label}</button>`;
        return `<p class="dim small">Everything lives in this browser. Export it to keep a copy or move it to another device.</p>
          ${note ? `<p class="setnote" role="status">${esc(note)}</p>` : ''}
          <div class="datarow"><button type="button" data-act="export">Export save to a file</button><span class="dim small">The game in progress, the Ledger, settings and keys.</span></div>
          <div class="datarow"><label class="filebtn"><input type="file" accept="application/json,.json" data-act="import">Import a save file…</label><span class="dim small">Replaces what is here, then reloads.</span></div>
          <div class="datarow">${conf('resetlegacy', 'Reset the Ledger', 'Every inscribed name, unlocked boon and best score goes. Sure?')}<span class="dim small">The legacy across runs.</span></div>
          <div class="datarow">${conf('delsave', 'Delete the saved game', 'The house on Ferry Road is forgotten. Sure?')}<span class="dim small">${hasKey(DATA_KEYS.save) ? 'The game in progress.' : 'No game saved.'}</span></div>`;
      }
    }
  };

  const draw = () => {
    div.innerHTML = `<div class="modal ledger" role="dialog" aria-modal="true" aria-labelledby="set-h">
      <button class="close" data-s="close" aria-label="Close settings">×</button>
      <h2 id="set-h">Settings</h2>
      <nav class="htabs" role="tablist">${TABS.map(([t, l]) => `<button role="tab" aria-selected="${t === tab}" class="${t === tab ? 'on' : ''}" data-tab="${t}">${l}</button>`).join('')}</nav>
      <div class="sbody" data-tabbody="${tab}">${body()}</div>
      <p class="dim small">Saved on this device.</p>
      <button class="go" data-s="close">Done</button>
    </div>`;
  };
  const redraw = (focusSel?: string) => {
    const scroll = div.querySelector('.modal')?.scrollTop ?? 0;
    draw();
    const m = div.querySelector('.modal');
    if (m) m.scrollTop = scroll;
    if (focusSel) (div.querySelector(focusSel) as HTMLElement | null)?.focus();
  };

  const close = () => {
    div.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('fullscreenchange', onFs);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    // nothing behind the page (battle, run, day screen) sees a key while it's open
    e.stopPropagation();
    if (capture) {
      e.preventDefault();
      const id = capture;
      capture = null;
      if (e.key !== 'Escape') {
        const a = ACTIONS.find((x) => x.id === id)!;
        const k = normKey(e);
        const why = reserved(a.ctx, k);
        if (why) note = `${keyLabel(k)} can't be used: ${why}.`;
        else { setKey(id, k); note = `${a.label}: ${keyLabel(k)}.`; sfx.ui(); }
      } else note = '';
      redraw(`[data-bind="${id}"]`);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const onKeyUp = (e: KeyboardEvent) => e.stopPropagation();
  const onFs = () => { if (tab === 'video') redraw(); };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('fullscreenchange', onFs);

  div.addEventListener('input', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLInputElement;
    const k = t.dataset.k as keyof Settings | undefined;
    if (!k) return;
    if (t.type === 'range') {
      setSetting(k as 'master' | 'music' | 'sfx' | 'ambience', +t.value / 100);
      const o = t.parentElement?.querySelector('output');
      if (o) o.textContent = t.value;
    } else if (t.type === 'checkbox') {
      setSetting(k as 'muted', t.checked);
    }
  });
  div.addEventListener('change', async (e) => {
    e.stopPropagation();
    const t = e.target as HTMLInputElement;
    if (t.type === 'range') sfx.ui();
    if (t.dataset.act === 'import' && t.files?.[0]) {
      const err = importData(await t.files[0].text());
      if (err) { note = err; redraw(); return; }
      note = 'Imported. Reloading…';
      redraw();
      setTimeout(() => location.reload(), 400);
    }
  });
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t === div || t.closest('[data-s=close]')) { sfx.ui(); close(); return; }
    const tb = t.closest('[data-tab]') as HTMLElement | null;
    if (tb) { sfx.ui(); tab = tb.dataset.tab as Tab; capture = null; note = ''; confirmId = null; redraw(`[data-tab=${tab}]`); return; }
    const ch = t.closest('[data-choice]') as HTMLElement | null;
    if (ch) {
      sfx.ui();
      setSetting(ch.dataset.choice as 'textSize', ch.dataset.v as TextSize);
      redraw(`[data-choice=${ch.dataset.choice}][data-v="${ch.dataset.v}"]`);
      return;
    }
    const bind = t.closest('[data-bind]') as HTMLElement | null;
    if (bind) { sfx.ui(); capture = bind.dataset.bind!; note = ''; redraw(`[data-bind="${capture}"]`); return; }
    const act = (t.closest('[data-act]') as HTMLElement | null)?.dataset.act;
    if (!act || act === 'import') return;
    sfx.ui();
    switch (act) {
      case 'fullscreen': void toggleFullscreen(); return;
      case 'hints': resetHints(); note = ''; (t as HTMLButtonElement).textContent = 'They will show on the next day screen'; return;
      case 'resetkeys': resetKeys(); note = 'Every key is back to its default.'; break;
      case 'export': exportData(); note = 'Exported.'; break;
      case 'resetlegacy': case 'delsave': confirmId = act; break;
      case 'cancel': confirmId = null; break;
      case 'resetlegacy-yes': removeKey(DATA_KEYS.legacy); confirmId = null; note = 'The Ledger is blank.'; break;
      case 'delsave-yes': removeKey(DATA_KEYS.save); confirmId = null; note = 'The saved game is gone. (A game still on screen saves again at the next dawn.)'; break;
    }
    redraw(`[data-act="${act}"]`);
  });
  draw();
  host.appendChild(div);
  (div.querySelector('.htabs .on') as HTMLElement | null)?.focus();
}
