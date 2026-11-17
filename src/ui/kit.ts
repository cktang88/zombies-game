// UI kit: progressive disclosure for every ledger screen (docs/research/12-ui.md).
//   Show a picture and a number first; the sentence comes on hover (or a long press on touch).
//   tip(html)            → attribute string for any element: data-tip="…" (hover / focus / long press)
//   ico(id, label?)      → <img> of public/sprites/icon_<id>.png (hidden if missing), label as its tip
//   fold(head, body, o)  → a collapsible section (<details>): head shows the summary, body the rest
//   chip(icon, text, t)  → a compact icon+value chip with a tooltip
//   pips(n, max)         → ●●●○○ skill/level pips
// Type scale: .t-xl (screen titles) .t-l (section heads) .t-m (body) .t-s (secondary) .t-xs (meta).

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** data-tip attribute: the html shows in a small floating card on hover, focus or long press. */
export const tip = (html: string | undefined | null) => (html ? ` data-tip="${escAttr(html)}" tabindex="0"` : '');

export function ico(id: string, label = '', cls = '') {
  return `<img class="ico ${cls}" src="${import.meta.env.BASE_URL}sprites/icon_${id}.png" alt="${escAttr(label)}"${label ? tip(label) : ''} onerror="this.style.display='none'">`;
}

export function fold(head: string, body: string, o: { open?: boolean; id?: string; cls?: string } = {}) {
  const open = o.id ? foldState(o.id) ?? o.open : o.open;
  return `<details class="fold ${o.cls ?? ''}"${o.id ? ` data-fold="${o.id}"` : ''}${open ? ' open' : ''}><summary>${head}</summary><div class="fold-body">${body}</div></details>`;
}

export const chip = (icon: string, text: string | number, tipHtml = '', cls = '') =>
  `<span class="chip ${cls}"${tip(tipHtml)}>${icon ? ico(icon) : ''}<b>${text}</b></span>`;

export const pips = (n: number, max = 10, cls = '') => {
  const f = Math.max(0, Math.min(max, Math.round(n)));
  return `<span class="pips ${cls}" aria-label="${f} of ${max}">${'<i class="on"></i>'.repeat(f)}${'<i></i>'.repeat(max - f)}</span>`;
};

// ---- remembered open/closed state per fold id (per browser; a convenience only)
function foldState(id: string): boolean | undefined {
  try { const v = localStorage.getItem('vessey-fold-' + id); return v === null ? undefined : v === '1'; } catch { return undefined; }
}
let installed = false;
/** Install the global tooltip and fold-memory listeners once. */
export function installKit() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const card = document.createElement('div');
  card.className = 'tipcard';
  card.setAttribute('role', 'tooltip');
  document.body.appendChild(card);
  let cur: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    const html = el.dataset.tip;
    if (!html) return;
    cur = el;
    card.innerHTML = html;
    card.classList.add('on');
    const r = el.getBoundingClientRect(), cw = card.offsetWidth, chh = card.offsetHeight;
    let x = r.left + r.width / 2 - cw / 2, y = r.top - chh - 8;
    if (y < 6) y = r.bottom + 8;
    x = Math.max(6, Math.min(window.innerWidth - cw - 6, x));
    card.style.left = `${x}px`; card.style.top = `${y}px`;
  };
  const hide = () => { cur = null; card.classList.remove('on'); };
  const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null);
  document.addEventListener('mouseover', (e) => { const el = find(e.target); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener('focusin', (e) => { const el = find(e.target); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  // touch: a long press shows the card, the next tap anywhere hides it
  let lp = 0;
  document.addEventListener('touchstart', (e) => { const el = find(e.target); clearTimeout(lp); if (el) lp = window.setTimeout(() => show(el), 380); else hide(); }, { passive: true });
  document.addEventListener('touchend', () => clearTimeout(lp), { passive: true });
  document.addEventListener('toggle', (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.dataset?.fold) try { localStorage.setItem('vessey-fold-' + d.dataset.fold, d.open ? '1' : '0'); } catch { /* private window */ }
  }, true);
}
