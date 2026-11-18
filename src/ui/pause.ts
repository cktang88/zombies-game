// The pause menu at the wall and on runs: Resume / Settings / Help / Quit to title.
// While it is open the battle or run is frozen and gets no input: the menu's own key handler
// sits in the capture phase and swallows every key; the overlay covers the canvas.

import { sfx } from '../audio';
import { openSettings } from './settings';
import { openHelp } from './help';
import { keyLabel, keyOf } from './keys';
import { tip } from './kit';

let quitHandler: (() => void) | null = null;
/** main.ts: what "Quit to title" does once the night or run has been torn down. */
export function onQuitToTitle(f: () => void) { quitHandler = f; }

export function openPause(host: HTMLElement, o: { where: 'night' | 'run'; resume: () => void; quit?: () => void }) {
  if (document.querySelector('.overlay.pause')) return;
  const div = document.createElement('div');
  div.className = 'overlay pause';
  const pk = keyLabel(keyOf(o.where === 'night' ? 'night.pause' : 'run.pause'));
  const loss = o.where === 'night' ? 'The night starts over from dusk when you continue.' : 'The run is lost: the leader comes home empty-handed.';
  div.innerHTML = `<div class="modal ledger pausebox" role="dialog" aria-modal="true" aria-labelledby="pause-h">
    <h2 id="pause-h">Paused</h2>
    <div class="pausebtns">
      <button class="go" data-p="resume"${tip(o.where === 'night' ? 'The road holds still.' : 'The street holds still.')}><i aria-hidden="true">▶</i>Resume <span class="pkeys"><kbd>${pk}</kbd><kbd>Esc</kbd></span></button>
      <button data-p="settings"><i aria-hidden="true">⚙</i>Settings</button>
      <button data-p="help"><i aria-hidden="true">?</i>Help</button>
      <button data-p="quit"><i aria-hidden="true">✕</i>Quit to title</button>
    </div>
    <p class="pconfirm" hidden><span${tip(loss)}>${o.where === 'night' ? 'Lose tonight?' : 'Lose the run?'}</span> <button data-p="quit-yes">Quit</button> <button data-p="quit-no">Stay</button></p>
  </div>`;
  const close = () => {
    div.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', swallow, true);
  };
  const resume = () => { close(); o.resume(); };
  // capture phase: nothing below (the battle, the run, the day screen) sees a key while paused
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.overlay.settings, .overlay.help')) return; // their own Esc closes them
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.key === 'Escape' || k === keyOf(o.where === 'night' ? 'night.pause' : 'run.pause')) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) resume(); return; }
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; } // focus moves / buttons work
    e.stopPropagation();
    e.preventDefault();
  };
  const swallow = (e: KeyboardEvent) => { if (!document.querySelector('.overlay.settings')) e.stopPropagation(); };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', swallow, true);
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = (e.target as HTMLElement).closest('[data-p]') as HTMLElement | null;
    if (!b) return;
    sfx.ui();
    const conf = div.querySelector('.pconfirm') as HTMLElement;
    switch (b.dataset.p) {
      case 'resume': return resume();
      case 'settings': return openSettings(host);
      case 'help': return openHelp(host, o.where === 'night' ? 'night' : 'runs');
      case 'quit': conf.hidden = false; (conf.querySelector('[data-p=quit-no]') as HTMLElement).focus(); return;
      case 'quit-no': conf.hidden = true; return;
      case 'quit-yes': close(); (o.quit ?? (() => {}))(); quitHandler?.(); return;
    }
  });
  div.addEventListener('mousedown', (e) => e.stopPropagation());
  host.appendChild(div);
  (div.querySelector('[data-p=resume]') as HTMLElement).focus();
}
