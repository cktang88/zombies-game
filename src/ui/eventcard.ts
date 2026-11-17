// The incident card: a headline, a face (or an icon), a short hook, and the choices as buttons
// with consequence icons. The full text folds away; each choice's hint shows on hover / long press.
import type { PendingEvent } from '../types';
import { byId, displayName } from '../sim/survivors';
import { portraitImg } from './portrait';
import { ico, tip, fold } from './kit';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');

/** What a choice costs or risks, read off its hint: [icon id, label]. */
const CONSEQ: [RegExp, string, string][] = [
  [/food|eat|mouth|hungry/i, 'food', 'food'],
  [/medicine|meds/i, 'meds', 'medicine'],
  [/ammo|rounds|shot|gun\b/i, 'ammo', 'ammunition'],
  [/timber|wood|steel|parts|scrap|supplies/i, 'parts', 'materials'],
  [/wall/i, 'st_wall', 'the wall'],
  [/hurt|burn|bite|bitten|danger|risk|could get|mad\b|deadly/i, 'st_danger', 'risk'],
  [/mood|spirits|goodbye|forgive|remember|hard to watch|likes/i, 'st_mood_down', 'mood'],
  [/rest|tiring|all day|days?\b/i, 'st_time', 'time'],
  [/radio/i, 'st_radio', 'the radio'],
  [/friendly|union|parish|ferry|guard|county|local 41/i, 'st_faction', 'standing'],
  [/survivor|stranger|another|lose a/i, 'st_trait', 'people'],
];
function conseq(hint = '') {
  const seen = new Set<string>();
  return CONSEQ.filter(([re, id]) => re.test(hint) && !seen.has(id) && seen.add(id)).slice(0, 3);
}

function face(ev: PendingEvent) {
  const sid = ev.data && typeof ev.data.s === 'string' ? ev.data.s : null;
  const s = sid ? byId(sid) : undefined;
  if (s) return `<div class="evface"${tip(esc(displayName(s)))}>${portraitImg(s.sprite, 'portrait')}</div>`;
  const t = `${ev.title} ${ev.text}`;
  const id = /radio|voice/i.test(t) ? 'st_radio' : /bite|bitten/i.test(t) ? 'st_bite' : /fever|sick|cough/i.test(t) ? 'st_sick' : /guard|union|parish|ferry|line\b/i.test(t) ? 'st_faction' : 'st_danger';
  return `<div class="evface evico">${ico(id, '', 'lg')}</div>`;
}

/** The modal for G.pendingEvent (keeps .modal.event and [data-act=choice][data-i] for the day screen's handler). */
export function eventModal(ev: PendingEvent) {
  const paras = ev.text.split(/\n\s*\n/);
  const hook = paras[0];
  const rest = paras.slice(1).join('\n\n');
  return `<div class="overlay"><div class="modal event">
      <div class="evhead">${face(ev)}<div><h2>${esc(ev.title)}</h2><p class="evhook">${nl(hook)}</p></div></div>
      ${rest ? fold('<span class="t-s">Read on</span>', `<p>${nl(rest)}</p>`, { cls: 'evmore', open: rest.length < 260 }) : ''}
      <div class="choices">${ev.choices.map((c, i) => {
        const cs = conseq(c.hint);
        return `<button data-act="choice" data-i="${i}"${tip(c.hint ? esc(c.hint) : '')}><span class="evlabel">${esc(c.label)}</span>${cs.length ? `<span class="evcons">${cs.map(([, id, l]) => ico(id, '', 'sm') + `<i>${l}</i>`).join('')}</span>` : c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`;
      }).join('')}</div>
    </div></div>`;
}
