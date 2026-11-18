// First-day guided hints, shown as a note clipped to the day screen.
// Progress is remembered in localStorage under 'vessey-onboarding-v1'
// (a step number, or 'done'). resetHints() brings them back.

import { tip, ico } from './kit';

const KEY = 'vessey-onboarding-v1';

/** short: the one line on the note; text: the full explanation, on hover / long press of the (?) */
export interface Hint { target: string; icon: string; title: string; short: string; text: string }

// The workshop and the run used to have a note each here; they now open on later days with their
// own one-line note (src/ui/today.ts REVEAL), so day 1 teaches only the list, the jobs and dusk.
export const HINTS: Hint[] = [
  {
    target: '.today',
    icon: 'st_time',
    title: 'Today',
    short: 'What needs doing, most urgent first. Click one to go there.',
    text: 'The list under the date is worked out from the house each morning: a low wall, short food, idle hands, a bad night on the calendar. Click an item to jump to where you fix it; it ticks off when it is done. A yellow dot marks anything with something waiting.',
  },
  {
    target: '.people',
    icon: 'job_guard',
    title: 'Everyone gets one job',
    short: 'Pick a job for each person. Skills set the output.',
    text: 'Pick a job for each person in the house. Their skills decide how much gets done; the line in each job list is what to expect. Hurt, sulking or catatonic people can\'t work. Open the line under a person for their gun, skills and hours.',
  },
  {
    target: '.dusk',
    icon: 'st_time',
    title: 'Then, dusk',
    short: 'Go to the wall [Enter]. Aim for the head.',
    text: 'When the jobs are set, go to the wall (or press Enter). The day\'s work resolves, and the night comes up the road. Aim for the head. The ? button has the controls.',
  },
];

function read(): number | 'done' {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'done') return 'done';
    const n = v ? parseInt(v, 10) : 0;
    return isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
function write(v: number | 'done') {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* ignore */
  }
}

let mem: number | 'done' | null = null;
const step = () => (mem ??= read());

export function hintActive(): Hint | null {
  const s = step();
  return s === 'done' || s >= HINTS.length ? null : HINTS[s];
}

export function nextHint() {
  const s = step();
  mem = s === 'done' || s + 1 >= HINTS.length ? 'done' : s + 1;
  write(mem);
}
export function skipHints() {
  mem = 'done';
  write(mem);
}
export function resetHints() {
  mem = 0;
  write(0);
}

/** The note itself. Actions: data-act="hint-next" / "hint-skip". */
export function hintHtml(): string {
  const h = hintActive();
  if (!h) return '';
  const s = step() as number;
  return `<aside class="hint" role="note" aria-live="polite" aria-labelledby="hint-h">
    <div class="hint-clip" aria-hidden="true"></div>
    <div class="hint-n">${s + 1} / ${HINTS.length}</div>
    <h3 id="hint-h">${ico(h.icon)}${h.title}</h3>
    <p>${h.short}<span class="qi"${tip(h.text)} aria-label="More">?</span></p>
    <div class="hint-b"><button class="mini link" data-act="hint-skip">Don't show these</button><button data-act="hint-next">${s + 1 === HINTS.length ? 'Got it' : 'Next ›'}</button></div>
  </aside>`;
}

/** Outline the element the current hint talks about. Call after render. */
export function markHintTarget(root: HTMLElement) {
  const h = hintActive();
  if (!h) return;
  root.querySelector(h.target)?.classList.add('hint-target');
}
