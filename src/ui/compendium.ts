// The Compendium: one book of everything there is to have, and how to get it. Guns (the same catalogue as
// the gun rack, from sim/catalogue.ts), hand weapons, attachments, trap kits and the Turned met so far.
// Opened from the book button in the day header, the C key (day), and the pause menu at night and on runs.
import { G } from '../state';
import { spriteUrl } from '../assets';
import { sfx } from '../audio';
import { queueRecipe } from '../sim/day';
import { buyOffer } from '../sim/landing';
import { gunCatalogue, meleeEntries, modEntries, trapEntries, turnedEntries, markCodexSeen, codexNew, type CodexEntry } from '../sim/catalogue';
import { catalogueHtml } from './catalogue';
import { tip } from './kit';

type Page = 'guns' | 'melee' | 'mods' | 'traps' | 'turned';
let page: Page = 'guns';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The header button: a book, with a dot when something new turned up since the last look. */
export function codexButton(): string {
  return `<button class="icon codexbtn" data-act="codex" aria-label="Compendium (C)"${tip('<b>Compendium</b> · C<br>Every gun, hand weapon, attachment, trap kit and Turned: what you have, and how to get the rest.')}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 4.5 Q6.5 3 10 4.5 V16.5 Q6.5 15 3 16.5Z M17 4.5 Q13.5 3 10 4.5 V16.5 Q13.5 15 17 16.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>${codexNew() ? '<i class="cdot"></i>' : ''}</button>`;
}

function entryCard(e: CodexEntry, kind: 'pic' | 'turned' = 'pic'): string {
  const hidden = kind === 'turned' && !e.known;
  const t = hidden ? `Not met yet. ${esc(e.how)}.` : `<b>${esc(e.name)}</b><br>${esc(e.line)}<br><span class="dim">${esc(e.stats)}</span>${e.extra && kind === 'turned' ? `<br><i>${esc(e.extra)}</i>` : ''}`;
  return `<div class="cx-entry ${e.known ? '' : 'unknown'} cx-${kind}"${tip(t)}>
    <div class="cx-pic"><img src="${spriteUrl(e.icon)}" alt="" onerror="this.style.visibility='hidden'"></div>
    <div class="cx-body"><div class="cx-name">${e.known || kind !== 'turned' ? esc(e.name) : '? ? ?'}</div>
      <div class="cx-line">${kind === 'turned' && !e.known ? 'Not met yet.' : esc(e.line)}</div>
      <div class="cx-stats">${kind === 'turned' && !e.known ? '' : esc(e.stats)}</div>
      <div class="cx-how">${esc(kind === 'turned' ? (e.known ? 'Met at the wall' : e.how) : e.how)}${e.extra && kind !== 'turned' ? ` · <b>${esc(e.extra)}</b>` : ''}</div></div>
  </div>`;
}
const count = (xs: CodexEntry[]) => `${xs.filter((x) => x.known).length}/${xs.length}`;

function body(): string {
  switch (page) {
    case 'guns': return catalogueHtml(undefined, { foldPrefix: 'cx' });
    case 'melee': return `<p class="cx-intro">One hand weapon each, carried with the gun: [V] on runs, at the wall when the gun runs dry.</p><div class="cx-grid">${meleeEntries().map((e) => entryCard(e)).join('')}</div>`;
    case 'mods': return `<p class="cx-intro">Fitted at the gun rack, one per slot. Spares wait on the bench.</p><div class="cx-grid">${modEntries().map((e) => entryCard(e)).join('')}</div>`;
    case 'traps': return `<p class="cx-intro">Made at the bench, laid on the road at dusk.</p><div class="cx-grid">${trapEntries().map((e) => entryCard(e)).join('')}</div>`;
    case 'turned': return `<p class="cx-intro">What comes up Ferry Road, and what stops it. The ones not met yet stay blank.</p><div class="cx-grid">${turnedEntries().map((e) => entryCard(e, 'turned')).join('')}</div>`;
  }
}

export function openCompendium(host: HTMLElement = document.body, o: { onChange?: () => void } = {}) {
  if (document.querySelector('.overlay.codex')) return;
  const prevFocus = document.activeElement as HTMLElement | null;
  const live = G.phase === 'day';
  const div = document.createElement('div');
  div.className = 'overlay codex';
  let scroll = 0;
  const draw = () => {
    const c = gunCatalogue();
    const tabs: [Page, string][] = [
      ['guns', `Guns ${c.owned}/${c.total}${c.rareOwned ? ` · ★${c.rareOwned}` : ''}`],
      ['melee', `Hand weapons ${count(meleeEntries())}`],
      ['mods', `Attachments ${count(modEntries())}`],
      ['traps', `Trap kits ${count(trapEntries())}`],
      ['turned', `The Turned ${count(turnedEntries())}`],
    ];
    div.innerHTML = `<div class="modal ledger codexbook ${live ? '' : 'ro'}" role="dialog" aria-modal="true" aria-labelledby="cx-h">
      <button class="close" data-c="close" aria-label="Close the Compendium">×</button>
      <h2 id="cx-h">Compendium</h2>
      <nav class="htabs" role="tablist">${tabs.map(([p, l]) => `<button role="tab" aria-selected="${p === page}" class="${p === page ? 'on' : ''}" data-c="${p}">${esc(l)}</button>`).join('')}</nav>
      <div class="cx-body-wrap">${body()}</div>
    </div>`;
    const w = div.querySelector('.cx-body-wrap') as HTMLElement;
    w.scrollTop = scroll;
    w.addEventListener('scroll', () => { scroll = w.scrollTop; }, { passive: true });
  };
  const close = () => {
    div.remove();
    window.removeEventListener('keydown', onKey, true);
    markCodexSeen();
    o.onChange?.();
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key.toLowerCase() === 'c' && !(e.target as HTMLElement)?.closest?.('input,select,textarea'))) { e.stopPropagation(); e.preventDefault(); close(); }
  };
  window.addEventListener('keydown', onKey, true);
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t === div) return close();
    const act = t.closest('[data-act]') as HTMLElement | null;
    if (act && live) {
      if (act.dataset.act === 'queue') { queueRecipe(act.dataset.id!); sfx.ui('stamp'); draw(); return; }
      if (act.dataset.act === 'landbuy') { if (buyOffer(act.dataset.key!)) sfx.ui('stamp'); draw(); return; }
    }
    const b = t.closest('[data-c]') as HTMLElement | null;
    if (!b) return;
    sfx.ui('paper');
    if (b.dataset.c === 'close') return close();
    page = b.dataset.c as Page;
    scroll = 0;
    draw();
    (div.querySelector(`[data-c=${page}]`) as HTMLElement | null)?.focus();
  });
  div.addEventListener('mousedown', (e) => e.stopPropagation());
  draw();
  host.appendChild(div);
  (div.querySelector(`[data-c=${page}]`) as HTMLElement | null)?.focus();
}
