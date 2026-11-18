// "How it works": every system as a picture card (src/data/systems.ts). Click a card for what it
// costs, what it gives and the catch, laid out as icon rows (spend → get). A second view puts the big
// choices side by side ("trade-offs at a glance"). Lives as a page of the help ledger (help.ts); the
// day screen also borrows sysTip(id) to show a system's tradeoff on hover.
import { systems, system, GROUPS, matrix, type Amt, type SystemDef } from '../data/systems';
import { tip, ico } from './kit';
import './guide.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type View = { kind: 'cards' } | { kind: 'sys'; id: string } | { kind: 'matrix' };
let view: View = { kind: 'cards' };

/** One icon amount. `full`: the words beside it; otherwise the words are its tooltip. */
function amt(a: Amt, full: boolean) {
  const n = a.n !== undefined && a.n !== '' ? `<b>${esc(String(a.n))}</b>` : '';
  return full
    ? `<li class="gx-amt">${ico(a.i)}${n}<span>${esc(a.t)}</span></li>`
    : `<span class="gx-amt"${tip(esc(`${a.n !== undefined ? `${a.n} ` : ''}${a.t}`))}>${ico(a.i)}${n}</span>`;
}
const amts = (list: Amt[], full: boolean) => (full ? `<ul class="gx-list">${list.map((a) => amt(a, true)).join('')}</ul>` : `<span class="gx-row">${list.map((a) => amt(a, false)).join('')}</span>`);

/** Spend → get as one compact strip of icons (for cards, tips and the matrix). */
const flow = (s: { spend: Amt[]; get: Amt[] }) => `<span class="gx-flow">${amts(s.spend, false)}<i class="gx-arrow" aria-label="gives">→</i>${amts(s.get, false)}</span>`;

/** The day screen's hover: name, spend → get, and the tradeoff. A tip() attribute string ('' if unknown). */
export function sysTip(id: string): string {
  const s = system(id);
  if (!s) return '';
  const row = (l: Amt[]) => l.map((a) => `${ico(a.i, '', 'sm')}${a.n !== undefined ? `<b>${esc(String(a.n))}</b>` : ''}`).join(' ');
  return tip(`<b>${esc(s.name)}</b> · <span class="dim">${esc(s.what)}</span><br><span class="gx-tspend">${row(s.spend)}</span> → <span class="gx-tget">${row(s.get)}</span><br><i>${esc(s.tradeoff)}</i>`);
}

function cardsHtml() {
  return GROUPS.map((g) => {
    const list = systems().filter((s) => s.group === g.id);
    return `<section class="gx-group"><h3 class="t-l">${esc(g.label)} <span class="t-s">${esc(g.line)}</span></h3>
      <div class="gx-cards">${list.map((s) => `<button class="gx-card" data-h="g:sys:${s.id}" aria-label="${esc(s.name)}: ${esc(s.what)}">
        ${ico(s.icon, '', 'lg')}<span class="gx-ct"><b>${esc(s.name)}</b><span class="t-s">${esc(s.what)}</span></span></button>`).join('')}</div></section>`;
  }).join('');
}

function sysHtml(s: SystemDef) {
  const list = systems().filter((x) => x.group === s.group);
  const i = list.indexOf(s);
  const prev = list[(i - 1 + list.length) % list.length], next = list[(i + 1) % list.length];
  return `<div class="gx-sys">
    <div class="gx-nav"><button class="mini" data-h="g:cards">‹ All systems</button>
      <span class="gx-step"><button class="mini" data-h="g:sys:${prev.id}" aria-label="Previous: ${esc(prev.name)}">‹ ${esc(prev.name)}</button><button class="mini" data-h="g:sys:${next.id}" aria-label="Next: ${esc(next.name)}">${esc(next.name)} ›</button></span></div>
    <div class="gx-head">${ico(s.icon, '', 'xl')}<div><h3 class="t-xl">${esc(s.name)}</h3><p class="t-m">${esc(s.what)}</p></div></div>
    <div class="gx-ledger">
      <div class="gx-col spend"><h4 class="t-xs">You spend</h4>${amts(s.spend, true)}</div>
      <div class="gx-big" aria-hidden="true">→</div>
      <div class="gx-col get"><h4 class="t-xs">You get</h4>${amts(s.get, true)}</div>
    </div>
    <p class="gx-trade"><span class="t-xs">The catch</span>${esc(s.tradeoff)}</p>
    <div class="gx-when"><span class="t-xs">Use it when</span><span class="t-m">${esc(s.when)}</span></div>
    ${s.key ? `<div class="gx-key"><span class="t-xs">Remember</span><kbd>${esc(s.key)}</kbd></div>` : ''}
  </div>`;
}

function matrixHtml() {
  return `<p class="t-s">The big choices side by side. Hover an icon for its words; click a row for the whole card.</p>
  ${matrix().map((b) => `<section class="gx-mblock"><h3 class="t-l">${esc(b.title)}</h3>
    <table class="gx-matrix"><thead><tr><th class="t-xs">Choice</th><th class="t-xs">You spend</th><th class="t-xs"></th><th class="t-xs">You get</th><th class="t-xs">The catch</th></tr></thead><tbody>
    ${b.rows.map((r) => `<tr${r.sys ? ` data-h="g:sys:${r.sys}" class="go"` : ''}>
      <th scope="row">${ico(r.icon)}<span>${esc(r.label)}</span></th>
      <td class="spend">${amts(r.spend, false)}</td><td class="gx-arrow">→</td><td class="get">${amts(r.get, false)}</td>
      <td class="t-s">${esc(r.catch)}</td></tr>`).join('')}
    </tbody></table></section>`).join('')}`;
}

/** The guide page body (help.ts draws it under its tabs). */
export function guideHtml(): string {
  const on = (k: View['kind']) => (view.kind === k || (k === 'cards' && view.kind === 'sys') ? ' on' : '');
  const sub = `<nav class="gx-sub" role="tablist"><button role="tab" class="${on('cards')}" aria-selected="${view.kind !== 'matrix'}" data-h="g:cards">Every system</button><button role="tab" class="${on('matrix')}" aria-selected="${view.kind === 'matrix'}" data-h="g:matrix">Trade-offs at a glance</button></nav>`;
  const s = view.kind === 'sys' ? system(view.id) : undefined;
  const body = view.kind === 'matrix' ? matrixHtml() : s ? sysHtml(s) : cardsHtml();
  return `<div class="guide">${view.kind === 'cards' ? '<p class="t-l gx-lede">Everything costs something. Here is what, and what it buys.</p>' : ''}${sub}${body}</div>`;
}

/** Handle a guide click (data-h="g:…"). Returns true when the guide's view changed. */
export function guideClick(h: string): boolean {
  if (!h.startsWith('g:')) return false;
  const p = h.slice(2);
  if (p === 'cards') view = { kind: 'cards' };
  else if (p === 'matrix') view = { kind: 'matrix' };
  else if (p.startsWith('sys:') && system(p.slice(4))) view = { kind: 'sys', id: p.slice(4) };
  else return false;
  return true;
}

/** Open the guide on one system's card (or the grid). */
export function guideShow(id?: string) {
  view = id && system(id) ? { kind: 'sys', id } : { kind: 'cards' };
}

/** A card's open state for the focus restore after a redraw. */
export const guideFocus = (h: string) => (h.startsWith('g:sys:') ? '.gx-nav [data-h="g:cards"]' : `[data-h="${h}"]`);
