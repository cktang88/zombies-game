// The '?' overlay: controls for the wall and for runs, a glossary of the Turned,
// and how moods and breaks work. Written as a page from the house ledger.

import { ZOMBIES } from '../data/zombies';
import { portraitImg } from './portrait';
import { sfx } from '../audio';
import { tip, ico, fold } from './kit';
import { ACTIONS, FIXED, keyLabel, keyOf, type KeyCtx } from './keys';
import { guideHtml, guideClick, guideFocus } from './guide';

/** The bindings for a context, as the ledger's key list (live: rebinding shows here). */
function keyList(ctx: KeyCtx): string {
  return `<dl class="keys">${FIXED[ctx].map(([k, l]) => `<dt>${esc(k)}</dt><dd>${esc(l)}</dd>`).join('')}${ACTIONS.filter((a) => a.ctx === ctx).map((a) => `<dt><kbd>${esc(keyLabel(keyOf(a.id)))}</kbd></dt><dd>${esc(a.label)}</dd>`).join('')}</dl>`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Page = 'guide' | 'night' | 'runs' | 'turned' | 'moods';
let page: Page = 'guide';

/** A picture card: icon or portrait, a name, one line; the rest on hover / long press. */
const card = (pic: string, name: string, line: string, more = '') =>
  `<div class="hcard"${tip(more)}>${pic}<div><b class="t-m">${name}</b><span class="t-s">${line}</span></div></div>`;
const PAGES: Record<Page, { label: string; html: () => string }> = {
  // the day jobs live in the guide's cards (with what each costs and gives); the day keys sit under it
  guide: { label: 'How it works', html: () => `${guideHtml()}<p class="t-s hkeys"><kbd>${esc(keyLabel(keyOf('day.dusk')))}</kbd> to the wall at dusk · <kbd>${esc(keyLabel(keyOf('day.help')))}</kbd> this ledger · hover anything for more.</p>` },
  night: {
    label: 'The wall',
    html: () => `
      <p class="t-l">Aim for the head. Hold the wall.</p>
      <div class="hcards">
        ${card(ico('job_guard'), 'The others', 'Shoot on their own.', 'Everyone else who can fight stands the wall.')}
        ${card(ico('st_noise'), 'Noise', 'Draws stragglers.', 'Every shot carries. Quiet guns draw fewer.')}
        ${card(ico('st_break'), 'Jams', 'Worn guns jam.', 'Keep them maintained in the workshop.')}
      </div>
      ${fold(`<span class="t-s">Keys</span> <span class="t-xs fold-peek">mouse aims · click fires · ${esc(keyLabel(keyOf('night.reload')))} reload · Esc pause</span>`, keyList('night') + '<p class="t-s">Every key can be changed in Settings › Controls.</p>', { id: 'help-keys-night' })}`,
  },
  runs: {
    label: 'Runs',
    html: () => `
      <p class="t-l">One street, one light, home off the left edge.</p>
      <div class="hcards">
        ${card(ico('st_tired'), 'Sleepers', 'Wake if you get close.', 'They stand still until you get near or loud.')}
        ${card(ico('st_time'), 'The light', 'About 2½ minutes.', 'After that the dead wake everywhere.')}
        ${card(ico('st_dead'), 'Dying out there', 'The loot stays.', 'What you carried stays in the road.')}
      </div>
      ${fold('<span class="t-s">Keys</span>', keyList('run'), { id: 'help-keys-run' })}`,
  },
  turned: {
    label: 'The Turned',
    html: () => `<div class="turned hcards">${Object.values(ZOMBIES).map((z) => {
      const tags = [z.minDay >= 100 ? 'special nights' : `day ${z.minDay}+`, z.armor && z.armor > 10 ? 'armoured' : '', z.burst ? 'bursts' : '', z.scream ? 'calls others' : '', z.lunge ? 'sprints' : ''].filter(Boolean);
      return `<div class="tz hcard"${tip(`<b>${esc(z.name)}</b><br>${esc(z.lore)}`)}>${portraitImg(z.sprites[0], 'tzport')}<div><b class="t-m">${esc(z.name)}</b><span class="t-xs">${tags.join(' · ')}</span></div></div>`;
    }).join('')}</div>
      <p class="t-s">They were all somebody. The town gave them these names. Hover one for its story.</p>`,
  },
  moods: {
    label: 'Moods & breaks',
    html: () => `
      <p class="t-l">Fed, rested, tended, loved: that is how you keep people.</p>
      <div class="hcards">
        ${card(ico('st_mood_up'), 'Mood', 'A sum of reasons.', 'The end of the world, hunger, rest, pain, fever, lovers, drink, and thoughts that fade over days ("Friend died", "We held the wall"). Open a survivor\'s name to see every line.')}
        ${card(ico('st_break'), 'Breaks', 'Below the ticks, at dawn.', 'The ticks on the mood bar are break thresholds. Below them, a survivor may break at dawn.')}
        ${card(ico('st_courage'), 'Resolve', '"Not today."', 'Sometimes they find resolve instead. After a break comes catharsis, a lift that lasts a few days.')}
      </div>
      ${fold('<span class="t-s">What a break looks like</span>', `<dl class="gloss">
        <dt>Minor</dt><dd>Sulk on the porch, binge the food, go on a bender, lash out.</dd>
        <dt>Major</dt><dd>Catatonic, wander off, smash the workbench, hide a bite.</dd>
        <dt>Extreme</dt><dd>Walk toward the river, desert with supplies, shut down, or end it.</dd>
      </dl>`, { id: 'help-breaks' })}`,
  },
};

export function openHelp(host: HTMLElement = document.body, start?: Page) {
  if (document.querySelector('.overlay.help')) return;
  if (start) page = start;
  if (!PAGES[page]) page = 'guide';
  const prevFocus = document.activeElement as HTMLElement | null;
  const div = document.createElement('div');
  div.className = 'overlay help';
  const draw = () => {
    div.innerHTML = `<div class="modal ledger wide" role="dialog" aria-modal="true" aria-labelledby="help-h">
      <button class="close" data-h="close" aria-label="Close help">×</button>
      <h2 id="help-h">The house ledger</h2>
      <nav class="htabs" role="tablist">${(Object.keys(PAGES) as Page[]).map((p) => `<button role="tab" aria-selected="${p === page}" class="${p === page ? 'on' : ''}" data-h="${p}">${PAGES[p].label}</button>`).join('')}</nav>
      <div class="hbody">${PAGES[page].html()}</div>
    </div>`;
  };
  const close = () => {
    div.remove();
    window.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  window.addEventListener('keydown', onKey, true);
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t === div) return close();
    const b = t.closest('[data-h]') as HTMLElement | null;
    if (!b) return;
    sfx.ui();
    if (b.dataset.h === 'close') return close();
    if (guideClick(b.dataset.h!)) {
      draw();
      (div.querySelector(guideFocus(b.dataset.h!)) as HTMLElement | null)?.focus();
      div.querySelector('.modal')?.scrollIntoView({ block: 'start' });
      return;
    }
    page = b.dataset.h as Page;
    draw();
    (div.querySelector(`[data-h=${page}]`) as HTMLElement | null)?.focus();
  });
  draw();
  host.appendChild(div);
  (div.querySelector('.htabs .on') as HTMLElement | null)?.focus();
}
