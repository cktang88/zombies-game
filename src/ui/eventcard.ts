// The incident card: a headline, a face (or an icon), a short hook, and the choices as buttons
// with consequence icons and a one-line hint. The rest of the text folds away.
import type { PendingEvent, Survivor, SkillId } from '../types';
import { byId, displayName, first } from '../sim/survivors';
import { portraitImg } from './portrait';
import { ico, tip, fold, chip, tag } from './kit';
import { TRAITS } from '../data/traits';
import { SKILL_NAMES } from '../data/names';
import { WEAPONS } from '../data/weapons';
import { G } from '../state';

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

/** Survivor records the event carries for people not (yet) with us: strangers at the gate. */
function strangers(ev: PendingEvent): Survivor[] {
  return Object.values(ev.data ?? {}).filter((v): v is Survivor => !!v && typeof v === 'object' && 'skills' in v && 'traits' in v && 'name' in v && !byId((v as Survivor).id));
}
/** The chance a stranger hides a bite (newcomer events; older saves carry only 'bitten'). */
function biteOdds(ev: PendingEvent): number {
  const d = ev.data ?? {};
  return typeof d.biteOdds === 'number' ? d.biteOdds : 'bitten' in d ? 0.3 : 0;
}
/** What a stranger brings: their two best skills, their traits, their gun (or none). Pictures first, the words in tips. */
function strangerRow(n: Survivor, named: boolean, risk = ''): string {
  const top = (Object.entries(n.skills) as [SkillId, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const skills = n.child ? [tag('child', 'Will not fight or work a hard job. Another mouth.', 'warn')]
    : top.map(([k, v]) => chip(`skill_${k}`, `${v}`, `<b>${esc(SKILL_NAMES[k])} ${v}</b> of 10: their best`));
  const traits = n.traits.map((t) => TRAITS[t] ? tag(esc(TRAITS[t].name), `<b>${esc(TRAITS[t].name)}</b>: ${esc(TRAITS[t].desc)}`) : '');
  const w = n.weapon ? G.weapons.find((x) => x.uid === n.weapon) : undefined;
  const gun = w ? chip(WEAPONS[w.def]?.icon?.replace(/^icon_/, '') ?? 'pistol', esc(WEAPONS[w.def]?.name ?? w.def), 'Brings this gun.')
    : chip('pistol', 'no gun', 'Brings no gun: arm them from the rack, or they stand on the wall and do nothing.', 'lo');
  return `<div class="evstr">${named ? `<b class="t-s">${esc(first(n))}</b>` : ''}${risk}${skills.join('')}${traits.join('')}${gun}</div>`;
}

function face(ev: PendingEvent) {
  const sid = ev.data && typeof ev.data.s === 'string' ? ev.data.s : null;
  const s = sid ? byId(sid) : undefined;
  if (s) return `<div class="evface"${tip(esc(displayName(s)))}>${portraitImg(s.sprite, 'portrait')}</div>`;
  const st = strangers(ev);
  if (st.length && st[0].sprite) return `<div class="evface"${tip(esc(displayName(st[0])))}>${portraitImg(st[0].sprite, 'portrait')}</div>`;
  const t = `${ev.title} ${ev.text}`;
  const id = /radio|voice/i.test(t) ? 'st_radio' : /bite|bitten/i.test(t) ? 'st_bite' : /fever|sick|cough/i.test(t) ? 'st_sick' : /guard|union|parish|ferry|line\b/i.test(t) ? 'st_faction' : 'st_danger';
  return `<div class="evface evico">${ico(id, '', 'lg')}</div>`;
}

/** Under the hook: each stranger's skills, traits and gun, and the bite risk for road arrivals. */
function strangerHtml(ev: PendingEvent): string {
  const st = strangers(ev);
  if (!st.length) return '';
  const odds = biteOdds(ev);
  const risk = odds ? chip('st_bite', `${Math.round(odds * 100)}% bitten`, `About ${Math.round(odds * 10)} in 10 off the road hide a bite. Checking them finds it; letting them in unchecked, it turns inside the wall.`, 'warn') : '';
  return `<div class="evstrs">${st.map((n, i) => strangerRow(n, st.length > 1, i === 0 ? risk : '')).join('')}</div>`;
}

/** The modal for G.pendingEvent (keeps .modal.event and [data-act=choice][data-i] for the day screen's handler). */
export function eventModal(ev: PendingEvent) {
  const paras = ev.text.split(/\n\s*\n/);
  const hook = paras[0];
  const rest = paras.slice(1).join('\n\n');
  return `<div class="overlay"><div class="modal event">
      <div class="evhead">${face(ev)}<div><h2>${esc(ev.title)}</h2><p class="evhook">${nl(hook)}</p>${strangerHtml(ev)}</div></div>
      ${rest ? fold('<span class="t-s">Read on</span>', `<p>${nl(rest)}</p>`, { cls: 'evmore', open: rest.length < 260 }) : ''}
      <div class="choices">${ev.choices.map((c, i) => {
        const cs = conseq(c.hint);
        // the hint stays visible (a long press on a button would also choose it); icons say what is at stake, their word on hover
        return `<button data-act="choice" data-i="${i}"><span class="evlabel">${esc(c.label)}</span>${cs.length ? `<span class="evcons">${cs.map(([, id, l]) => `<span data-tip="At stake: ${l}">${ico(id, "", "sm")}</span>`).join('')}</span>` : ''}${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`;
      }).join('')}</div>
    </div></div>`;
}
