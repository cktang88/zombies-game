// The dawn report: a stamped ledger that reveals the night in stages (deaths first, then the tally,
// the wall, the ammo, who carried the night, the morning's news and a teaser). Click to skip ahead.
import './juice.css';
import type { Res, Survivor } from '../types';
import type { NightResult } from '../night/battle';
import { G, dateLabel } from '../state';
import { spriteUrl } from '../assets';
import { RES_LABEL } from '../data/world';
import { ammoLabel, AMMO_TYPES } from '../data/weapons';
import { byId, displayName } from '../sim/survivors';
import { sfx, stinger } from '../audio';
import { countUp } from './juice';

export interface DawnData {
  r: NightResult;
  dead: Survivor[]; // buried this night
  wallBefore: number; // wall HP at dusk
  lines: string[]; // the morning's news (night lines + dawn tick)
  teaser?: string; // title-only teaser of today's incident or omen
  night: number; // the day number of the night just fought
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ammoName = (k: string) => (AMMO_TYPES[k as Res] ? ammoLabel(k as Res) : RES_LABEL[k as Res] ?? k).toLowerCase();

export function showDawnReport(app: HTMLElement, d: DawnData, onClose: () => void) {
  const { r } = d;
  const max = G.fort.maxHp;
  const hpNow = Math.max(0, Math.min(max, G.fort.hp));
  const before = Math.max(hpNow, Math.min(max, d.wallBefore));
  const lost = Math.max(0, Math.round(r.wallLost || before - hpNow));
  const top = Object.entries(r.killsBy ?? {}).sort((a, b) => b[1] - a[1])[0];
  const mvp = top && top[1] > 0 ? byId(top[0]) : undefined;
  const spent = Object.entries(r.ammoUsed ?? {}).filter(([, v]) => v);
  const totalSpent = spent.reduce((a, [, v]) => a + (v ?? 0), 0);

  const div = document.createElement('div');
  div.className = 'overlay dawn';
  div.innerHTML = `<div class="modal ledger dawnrep" role="dialog" aria-label="Dawn report">
    <h2>Dawn, ${dateLabel()} <small>the ${esc(dateLabel(d.night))} night</small></h2>
    ${d.dead.map((s) => `<div class="st deathcard" data-pause="1300" data-bell="1"><img src="${spriteUrl(s.sprite)}" alt=""><div>
      <div class="dn">${esc(displayName(s))}</div>
      <div class="dc">${esc(s.dead?.cause ?? 'died in the night')}</div>
      <div class="de">${esc(s.dead?.epitaph ?? '')}</div></div></div>`).join('')}
    <div class="st tally" data-pause="900">
      <div><b data-count="${r.kills}">0</b><span>put down</span></div>
      <div><b data-count="${r.headshots}">0</b><span>through the head${r.headshots >= 5 ? '<i class="hsstamp">clean</i>' : ''}</span></div>
      <div><b data-count="${totalSpent}">0</b><span>rounds spent</span></div>
    </div>
    <div class="st wallrow" data-pause="1100" data-wall="1">
      <div class="wallbar"><div style="width:${(before / max) * 100}%"></div><span>${Math.ceil(hpNow)} / ${max}${lost ? ` · −${lost}` : ''}</span></div>
      <div class="dim small">${!r.wallHeld ? 'They came over the wall.' : lost > max * 0.4 ? 'The wall took a beating.' : lost ? 'The wall held.' : 'Not a board out of place.'}</div>
    </div>
    ${spent.length ? `<div class="st spent" data-pause="600">Spent: ${spent.map(([k, v]) => `${v} ${esc(ammoName(k))}`).join(', ')}.</div>` : ''}
    ${mvp ? `<div class="st mvp" data-pause="900"><img src="${spriteUrl(mvp.sprite)}" alt=""><div><small>Carried the night</small><b>${esc(displayName(mvp))}</b><div class="dim">${top[1]} put down${r.kills ? `, ${Math.round((top[1] / r.kills) * 100)}% of the night` : ''}.${mvp.dead ? ' Buried this morning.' : ''}</div></div></div>` : ''}
    <div class="st lines" data-pause="500">${d.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
    ${d.teaser ? `<div class="st teaser" data-pause="300"><b>This morning</b>${esc(d.teaser)}</div>` : ''}
    <div class="skiphint">click to skip</div>
    <button class="go" style="visibility:hidden">Continue ›</button>
  </div>`;
  app.appendChild(div);

  const steps = Array.from(div.querySelectorAll<HTMLElement>('.st'));
  const go = div.querySelector('.go') as HTMLButtonElement;
  const hint = div.querySelector('.skiphint') as HTMLElement;
  const stops: (() => void)[] = [];
  let i = 0;
  let timer = 0;
  let done = false;

  const reveal = (el: HTMLElement, instant: boolean) => {
    if (instant) el.style.transition = 'none';
    el.classList.add('in');
    for (const b of Array.from(el.querySelectorAll<HTMLElement>('[data-count]'))) {
      stops.push(countUp(b, 0, +b.dataset.count!, instant ? 0 : 800));
    }
    if (el.dataset.wall) {
      const bar = el.querySelector('.wallbar div') as HTMLElement;
      const to = `${(hpNow / max) * 100}%`;
      if (instant) {
        bar.style.transition = 'none';
        bar.style.width = to;
      } else requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = to)));
    }
    if (el.dataset.bell && !instant) sfx.bell();
    if (!instant) {
      if (el.classList.contains('wallrow') || el.querySelector('.hsstamp')) sfx.ui('stamp');
      else if (el.classList.contains('lines') || el.classList.contains('teaser')) { sfx.ui('type'); window.setTimeout(() => sfx.ui('type'), 110); window.setTimeout(() => sfx.ui('type'), 260); }
      else if (el.classList.contains('spent') || el.classList.contains('mvp')) sfx.ui('paper');
    }
  };
  sfx.ui('paper');
  if (r.wallHeld && !d.dead.length && !r.fell) window.setTimeout(() => stinger('dawn'), 300);
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (; i < steps.length; i++) reveal(steps[i], true);
    for (const s of stops) s();
    hint.remove();
    go.style.visibility = 'visible';
    go.focus();
  };
  const next = () => {
    if (i >= steps.length) return finish();
    const el = steps[i++];
    reveal(el, false);
    timer = window.setTimeout(next, +(el.dataset.pause ?? 600));
  };
  timer = window.setTimeout(next, 250);

  const close = () => {
    sfx.ui();
    window.removeEventListener('keydown', onKey, true);
    div.remove();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!done) finish();
    else if (e.key !== 'Escape') close();
  };
  window.addEventListener('keydown', onKey, true);
  div.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.go')) {
      if (done) close();
      return;
    }
    finish();
  });
}
