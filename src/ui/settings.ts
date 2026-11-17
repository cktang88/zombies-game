// Player settings: volumes and comfort toggles.
//
// Storage (localStorage, every access wrapped in try/catch):
//   key 'vessey-settings-v1' → JSON { master, music, sfx, reduceShake, reduceGore }
//     master/music/sfx: 0..1 volumes
//     reduceShake: boolean — night/run canvases should scale screen shake down (see shakeScale())
//     reduceGore:  boolean — night/run canvases should draw fewer/smaller blood decals and sprays
//
// The night code should read these through the getters below (reduceShake(),
// reduceGore(), shakeScale()) rather than parsing storage itself. They are cheap:
// the parsed object is cached in memory and updated whenever the panel changes it.

import { setMasterVolume, setMusicVolume, setSfxVolume, sfx } from '../audio';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  reduceShake: boolean;
  reduceGore: boolean;
}

export const SETTINGS_KEY = 'vessey-settings-v1';
const DEFAULTS: Settings = { master: 0.7, music: 0.55, sfx: 0.8, reduceShake: false, reduceGore: false };

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
  cache = {
    master: num(s.master, DEFAULTS.master),
    music: num(s.music, DEFAULTS.music),
    sfx: num(s.sfx, DEFAULTS.sfx),
    reduceShake: s.reduceShake === true,
    reduceGore: s.reduceGore === true,
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
}

/** True when the player asked for less screen shake. */
export const reduceShake = () => getSettings().reduceShake;
/** True when the player asked for less gore. */
export const reduceGore = () => getSettings().reduceGore;
/** Multiply camera shake amplitudes by this (0.2 when reduced, else 1). */
export const shakeScale = () => (getSettings().reduceShake ? 0.2 : 1);

export function applyAudio() {
  const s = getSettings();
  setMasterVolume(s.master);
  setMusicVolume(s.music);
  setSfxVolume(s.sfx);
}
applyAudio();

// ---------------------------------------------------------------------------
// The panel. Opens as a modal over whatever is on screen.
// ---------------------------------------------------------------------------

export function openSettings(host: HTMLElement = document.body, onClose?: () => void) {
  if (document.querySelector('.overlay.settings')) return;
  const s = getSettings();
  const prevFocus = document.activeElement as HTMLElement | null;
  const div = document.createElement('div');
  div.className = 'overlay settings';
  const slider = (k: 'master' | 'music' | 'sfx', label: string) =>
    `<label class="set-row"><span>${label}</span><input type="range" min="0" max="100" step="5" data-k="${k}" value="${Math.round(s[k] * 100)}" aria-label="${label} volume"><output>${Math.round(s[k] * 100)}</output></label>`;
  const toggle = (k: 'reduceShake' | 'reduceGore', label: string, note: string) =>
    `<label class="set-row check"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span>${label}<small>${note}</small></span></label>`;
  div.innerHTML = `<div class="modal ledger" role="dialog" aria-modal="true" aria-labelledby="set-h">
    <button class="close" data-s="close" aria-label="Close settings">×</button>
    <h2 id="set-h">Settings</h2>
    <h3>Sound</h3>
    ${slider('master', 'Master')}
    ${slider('music', 'Music')}
    ${slider('sfx', 'Effects')}
    <h3>Comfort</h3>
    ${toggle('reduceShake', 'Reduce screen shake', 'Gunfire and the wall falling barely move the camera.')}
    ${toggle('reduceGore', 'Reduce gore', 'Less blood on the road. The dead still fall.')}
    <p class="dim small">Saved on this device.</p>
    <button class="go" data-s="close">Done</button>
  </div>`;
  const close = () => {
    div.remove();
    window.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  window.addEventListener('keydown', onKey, true);
  div.addEventListener('input', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLInputElement;
    const k = t.dataset.k as keyof Settings | undefined;
    if (!k) return;
    if (t.type === 'range') {
      setSetting(k as 'master' | 'music' | 'sfx', +t.value / 100);
      const o = t.parentElement?.querySelector('output');
      if (o) o.textContent = t.value;
    } else {
      setSetting(k as 'reduceShake' | 'reduceGore', t.checked);
    }
  });
  div.addEventListener('change', (e) => {
    e.stopPropagation();
    if ((e.target as HTMLInputElement).type === 'range') sfx.ui();
  });
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t === div || t.closest('[data-s=close]')) { sfx.ui(); close(); }
  });
  host.appendChild(div);
  (div.querySelector('input') as HTMLElement | null)?.focus();
}
