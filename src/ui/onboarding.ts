// First-day guided hints, shown as a note clipped to the day screen.
// Progress is remembered in localStorage under 'vessey-onboarding-v1'
// (a step number, or 'done'). resetHints() brings them back.

const KEY = 'vessey-onboarding-v1';

export interface Hint { target: string; title: string; text: string }

export const HINTS: Hint[] = [
  {
    target: '.people',
    title: 'Everyone gets one job',
    text: 'Pick a job for each person in the house. Their skills decide how much gets done; the line under each job is what to expect. Hurt, sulking or catatonic people can\'t work.',
  },
  {
    target: '.center',
    title: 'The workshop needs hands',
    text: 'Queue ammunition, traps and repairs here, and build machinery to unlock more. Nothing in the queue moves unless somebody is assigned to the Workshop job.',
  },
  {
    target: '.run',
    title: 'Or go yourself',
    text: 'The leader can lead a run in daylight: walk one street, search doors and cars, and come back off the left edge before dark. More loot than scavenging, at your own risk.',
  },
  {
    target: '.dusk',
    title: 'Then, dusk',
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
    <h3 id="hint-h">${h.title}</h3>
    <p>${h.text}</p>
    <div class="hint-b"><button class="mini" data-act="hint-skip">Don't show these</button><button data-act="hint-next">${s + 1 === HINTS.length ? 'Got it' : 'Next ›'}</button></div>
  </aside>`;
}

/** Outline the element the current hint talks about. Call after render. */
export function markHintTarget(root: HTMLElement) {
  const h = hintActive();
  if (!h) return;
  root.querySelector(h.target)?.classList.add('hint-target');
}
