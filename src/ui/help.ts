// The '?' overlay: controls for the wall and for runs, a glossary of the Turned,
// and how moods and breaks work. Written as a page from the house ledger.

import { ZOMBIES } from '../data/zombies';
import { spriteUrl } from '../assets';
import { sfx } from '../audio';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Page = 'day' | 'night' | 'runs' | 'turned' | 'moods';
let page: Page = 'day';

const PAGES: Record<Page, { label: string; html: () => string }> = {
  day: {
    label: 'The day',
    html: () => `
      <p>Each survivor does one job. Work resolves when you go to the wall at dusk.</p>
      <dl class="gloss">
        <dt>Repair the wall</dt><dd>Building skill. Patches the barricade; burns timber.</dd>
        <dt>Scavenge</dt><dd>Scavenging skill. Choose a site. Sites run dry, and the riskier ones bite back.</dd>
        <dt>Workshop</dt><dd>Crafting skill. Works through the craft queue. <b>A queue with nobody at the bench does nothing.</b></dd>
        <dt>Food</dt><dd>Farming skill. Snares and kale, more with cold frames. Everyone eats one a day.</dd>
        <dt>Tend wounded</dt><dd>Medicine. Untended cuts go septic.</dd>
        <dt>Work the radio</dt><dd>Social. Needs a radio mast. Voices, contacts, news from across the river.</dd>
        <dt>Rest</dt><dd>Recovers rest and lifts the mood a little.</dd>
      </dl>
      <p>The leader can also <b>lead a run</b> instead of working: a daylight walk down one street, played by you.</p>
      <p><kbd>Enter</kbd> goes to the wall at dusk when nothing else is open.</p>`,
  },
  night: {
    label: 'The wall',
    html: () => `
      <dl class="keys">
        <dt>Mouse</dt><dd>Aim. The circle is your real spread; it grows while you fire.</dd>
        <dt>Click</dt><dd>Fire. Hold for automatic weapons. Heads take triple damage.</dd>
        <dt><kbd>R</kbd></dt><dd>Reload. Shotguns load one shell at a time; firing interrupts.</dd>
        <dt><kbd>Q</kbd> / <kbd>1</kbd>–<kbd>9</kbd></dt><dd>Swap to another gun from the rack.</dd>
        <dt><kbd>F</kbd> / right-click</dt><dd>Throw a firebomb.</dd>
        <dt>Hold <kbd>Space</kbd></dt><dd>Hurry the night along.</dd>
        <dt><kbd>P</kbd> / <kbd>Esc</kbd></dt><dd>Pause.</dd>
      </dl>
      <p>Everyone else who can fight stands the wall and shoots on their own. The barricade is the health bar; if it falls, they climb over and the defenders get hurt. Noise draws stragglers. Worn guns jam.</p>`,
  },
  runs: {
    label: 'Runs',
    html: () => `
      <dl class="keys">
        <dt><kbd>A</kbd> <kbd>D</kbd> / arrows</dt><dd>Walk.</dd>
        <dt>Hold <kbd>E</kbd></dt><dd>Search a door, car, shed or body. Searching makes noise.</dd>
        <dt>Mouse, click</dt><dd>Aim and fire.</dd>
        <dt><kbd>R</kbd></dt><dd>Reload.</dd>
        <dt><kbd>Space</kbd></dt><dd>Shove. For when you are out of rounds, or close.</dd>
      </dl>
      <p>Sleepers stand still until you get near or loud. The light lasts about two and a half minutes; after that the dead wake everywhere. Walk back off the <b>left edge</b> to go home. Die out there and what you carried stays in the road.</p>`,
  },
  turned: {
    label: 'The Turned',
    html: () => `<div class="turned">${Object.values(ZOMBIES).map((z) => `
      <div class="tz"><img src="${spriteUrl(z.sprites[0])}" alt="" loading="lazy">
        <div><b>${esc(z.name)}</b> <span class="dim">from day ${z.minDay}${z.armor && z.armor > 10 ? ' · armoured' : ''}${z.burst ? ' · bursts' : ''}${z.scream ? ' · calls others' : ''}${z.lunge ? ' · sprints' : ''}</span>
        <p>${esc(z.lore)}</p></div></div>`).join('')}</div>
      <p class="dim">They were all somebody. The town gave them these names.</p>`,
  },
  moods: {
    label: 'Moods & breaks',
    html: () => `
      <p>Mood is a sum of named reasons: the end of the world, hunger, rest, pain, fever, lovers, drink, and thoughts that fade over days ("Friend died", "We held the wall"). Open a survivor's name to see every line.</p>
      <p>The ticks on the mood bar are <b>break thresholds</b>. Below them, a survivor may break at dawn:</p>
      <dl class="gloss">
        <dt>Minor</dt><dd>Sulk on the porch, binge the food, go on a bender, lash out at someone.</dd>
        <dt>Major</dt><dd>Go catatonic, wander off, smash the workbench, hide a bite.</dd>
        <dt>Extreme</dt><dd>Walk off toward the river, desert in the night with supplies, shut down entirely, or end it.</dd>
      </dl>
      <p>Sometimes they find <b>resolve</b> instead: "Not today." After a break comes catharsis, a lift that lasts a few days.</p>
      <p>Fed, rested, tended, doing work they care about, beside someone they love: that is how you keep people.</p>`,
  },
};

export function openHelp(host: HTMLElement = document.body, start?: Page) {
  if (document.querySelector('.overlay.help')) return;
  if (start) page = start;
  const prevFocus = document.activeElement as HTMLElement | null;
  const div = document.createElement('div');
  div.className = 'overlay help';
  const draw = () => {
    div.innerHTML = `<div class="modal ledger wide" role="dialog" aria-modal="true" aria-labelledby="help-h">
      <button class="close" data-h="close" aria-label="Close help">×</button>
      <h2 id="help-h">The house ledger</h2>
      <nav class="htabs" role="tablist">${(Object.keys(PAGES) as Page[]).map((p) => `<button role="tab" aria-selected="${p === page}" class="${p === page ? 'on' : ''}" data-h="${p}">${PAGES[p].label}</button>`).join('')}</nav>
      <div class="hbody">${PAGES[page].html()}</div>
      <button class="go" data-h="close">Close</button>
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
    page = b.dataset.h as Page;
    draw();
    (div.querySelector(`[data-h=${page}]`) as HTMLElement | null)?.focus();
  });
  draw();
  host.appendChild(div);
  (div.querySelector('.htabs .on') as HTMLElement | null)?.focus();
}
