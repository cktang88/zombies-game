import { eventModal } from './eventcard';
import type { Survivor, JobId, SkillId, Res, WeaponItem, ModSlot } from '../types';
import { G, R, dateLabel, ICE_DAY, has, pay, ordinal, docsFound, rep } from '../state';
import { DOCS, FACTIONS } from '../data/lore';
import { spriteUrl } from '../assets';
import { portraitImg } from './portrait';
import { WEAPONS, MELEE, meleeProfile, CLASS_NAMES, CALIBERS, AMMO_TYPES, MODS, MOD_SLOTS, fireProfile, ammoTypesFor, ammoLabel, selectedAmmo, slotsFor, attachMod, detachMod, type FireProfile } from '../data/weapons';
import { TRAITS } from '../data/traits';
import { SKILL_NAMES } from '../data/names';
import { SITES, BUILDINGS, RECIPES, RES_LABEL, RES_ICON } from '../data/world';
import {
  living, displayName, first, moodBreakdown, computeMood, moodWord, breakThresholds, pain, woundLabel, byId, canWork, canFight,
  isBitten, SKILLS, aimFactor, skillOf, workMult, attr, ATTRS, ATTR_NAMES, level, xpProgress, topSkills, heldProf, prof,
  WEAPON_CLASSES, CLASS_SHORT, progressName, choosePerk, type ProgressKey,
} from '../sim/survivors';
import { PERKS } from '../data/perks';
import { TRAPS } from '../data/traps';
import {
  buildingLevel, queueRecipe, WEATHER_LABEL, DAY_HOURS, DEFAULT_HOURS, jobHours, setJobHours, hoursAvailable, travelHours, survivorSite,
  searchHours, searchFactor, planConfirmed, confirmPlan, ranToday, onRunToday, runDaylightFor, prepareRun, clockLabel, heatNeed,
  drillPlan, emplacements, tomorrowTeaser, oilGuns, clearPile, choreHand,
} from '../sim/day';
import { calendar } from '../sim/calendar';
import { persona, forecast, threatPoints } from '../sim/director';
import { sfx, music, stinger, distant } from '../audio';
import { openSettings } from './settings';
import { is, keyLabel, keyOf } from './keys';
import { openHelp } from './help';
import { hintHtml, markHintTarget, nextHint, skipHints } from './onboarding';
import { threadsHtml } from '../sim/threads';
import { calendarHtml } from '../sim/calendar';
import { juiceAfterRender } from './juice';
import { siteFindsText } from './sites';
import { sysTip, sysLine } from './guide';
import { todayHtml, dotKeys, pickTodo, applyFlash, markSeen, setRevealAll, isOpen, revealNote, runOpen, JOB_REVEAL, type RevealId } from './today';

const JOBS: { id: JobId; label: string; hint: string }[] = [
  { id: 'repair', label: 'Repair the wall', hint: 'Building. Uses timber. Hard on the back.' },
  { id: 'scavenge', label: 'Scavenge', hint: 'Scavenging. Risky. The walk there and back eats the day.' },
  { id: 'craft', label: 'Workshop', hint: 'Crafting. Works the queue.' },
  { id: 'farm', label: 'Food', hint: 'Farming. Snares, cold frames.' },
  { id: 'doctor', label: 'Tend wounded', hint: 'Medicine.' },
  { id: 'drill', label: 'Drill', hint: 'Shooting practice. Burns rounds; dry-fire teaches half as much.' },
  { id: 'counsel', label: 'Counsel', hint: 'Talk the worst-off down. Fewer breaks tomorrow.' },
  { id: 'radio', label: 'Work the radio', hint: 'Social. Needs a radio mast.' },
  { id: 'rest', label: 'Rest', hint: 'Recover. The whole day off.' },
];

import { tip, ico, fold, chip, pips } from './kit';
import './survivor.css';

// What a job is likely to yield today for this survivor (mirrors sim/day.ts resolveDayWork).
function jobOutlook(s: Survivor, j: JobId): string {
  const m = workMult(s);
  const h = j === 'rest' ? 0 : Math.min(hoursAvailable(s), (G.flags[`hours_${s.id}`] as number) ?? DEFAULT_HOURS);
  const f = h / DEFAULT_HOURS;
  switch (j) {
    case 'repair': {
      const room = Math.max(0, G.fort.maxHp - G.fort.hp);
      return room <= 0 ? 'wall is whole' : `+${Math.min(room, Math.round((40 + skillOf(s, 'building') * 9) * m * f))} wall`;
    }
    case 'craft':
      return G.craftQueue.length ? `${Math.round((3 + skillOf(s, 'crafting') * 0.9) * m * f)} work on the queue` : 'queue is empty';
    case 'farm': {
      const cold = G.weather === 'cold' || G.weather === 'snow' ? 0.6 : 1;
      return `~${Math.round((1.5 + skillOf(s, 'farming') * 0.45 + buildingLevel('garden') * 2.2) * m * cold * f)} food`;
    }
    case 'doctor': {
      const hurt = living().reduce((a, p) => a + p.wounds.filter((w) => !w.tended && !w.hidden).length, 0);
      return hurt ? `tends ${Math.min(hurt, Math.max(1, Math.round((2 + skillOf(s, 'medicine')) * m * f)))} of ${hurt} wounds` : 'nobody needs tending';
    }
    case 'scavenge':
      return `skill ${s.skills.scavenging}/10`;
    case 'drill': {
      const it = G.weapons.find((x) => x.uid === s.weapon);
      if (!it) return 'needs a gun';
      const ammo = selectedAmmo(it);
      const rounds = Math.ceil(10 * f);
      const live = !!ammo && ammo !== 'scrap' && (G.stores[ammo] ?? 0) >= rounds;
      return live ? `${rounds} rounds, ${emplacements().length ? '+ gun nest' : 'live fire'}` : 'dry-fire, half pace';
    }
    case 'counsel': {
      const low = living().filter((o) => o !== s && (o.mood < 60 || o.breakState)).length;
      return low ? `${low} could use it · counsel ${s.skills.psych ?? 0}` : 'everyone is holding';
    }
    case 'radio':
      return buildingLevel('radio') ? `social ${s.skills.social}/10` : 'needs a radio mast';
    case 'rest':
      return s.rest < 0.6 ? 'sleeps it off' : 'a day off';
    default:
      return '';
  }
}

// The named reasons behind a mood, biggest first (skipping the baseline).
function moodWhy(s: Survivor, n = 2) {
  return moodBreakdown(s)
    .slice(1)
    .filter((p) => p.v !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, n);
}

// (the morning warnings now live in the Today list: src/ui/today.ts)

let tab = 'workshop';
let detail: string | null = null;

export interface DayHandlers {
  onDusk: () => void;
  onChoice: (i: number) => void;
  onRun: (site: string) => void;
  rerender: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');

function costHtml(cost: Partial<Record<Res, number>>) {
  const parts = Object.entries(cost).map(([k, v]) => {
    const have = Math.floor(G.stores[k as Res] ?? 0);
    const ok = have >= (v ?? 0);
    return `<span class="cost ${ok ? '' : 'short'}"${tip(`${v} ${RES_LABEL[k as Res].toLowerCase()} · have ${have}`)}><img src="${spriteUrl(RES_ICON[k as Res])}" alt="${RES_LABEL[k as Res]}">${v}</span>`;
  });
  return parts.length ? parts.join('') : '<span class="cost">free</span>';
}

// ---- survivor: a picture and a number first, the sentence on hover (src/ui/kit.ts, survivor.css)
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}`;
const moodTone = (s: Survivor) => (s.mood > 50 ? 'hi' : s.mood > breakThresholds(s).minor ? 'mid' : 'lo');
/** icon with a word that shows only while the icon art is missing (survivor.css hides .fb once it loads) */
const icoFb = (id: string, word: string, cls = 'sm') => `${ico(id, '', cls)}<span class="fb">${esc(word)}</span>`;
const stChip = (st: string, text: string, tipHtml: string, cls = '') =>
  `<span class="chip sv-chip ${cls}"${tip(tipHtml)}>${ico('st_' + st, '', 'sm')}<b>${text}</b></span>`;

function moodTip(s: Survivor, n = 6) {
  const th = breakThresholds(s);
  return `<b>${esc(moodWord(s.mood))}</b> · mood ${Math.round(s.mood)}<br>${moodWhy(s, n).map((p) => `${esc(p.label)} ${signed(p.v)}`).join('<br>')}<br><span class="dim">Breaks below ${Math.round(th.minor)}</span>`;
}

/** mood as one coloured number; the reasons are in its tooltip */
function moodChip(s: Survivor) {
  const up = s.mood > 50;
  return `<span class="chip sv-chip sv-mood ${moodTone(s)}"${tip(moodTip(s))}>${ico(up ? 'st_mood_up' : 'st_mood_down', '', 'sm')}<b>${Math.round(s.mood)}</b></span>`;
}

function moodBar(s: Survivor) {
  const th = breakThresholds(s);
  return `<div class="moodbar sv-moodbar" aria-label="Mood ${Math.round(s.mood)}, ${esc(moodWord(s.mood))}">
    <div class="fill" data-tw="mood_${s.id}" style="width:${s.mood}%;background:${s.mood > 50 ? '#8a9a5b' : s.mood > th.minor ? '#b08a3c' : '#a8322a'}"></div>
    <i style="left:${th.minor}%"></i><i style="left:${th.major}%"></i><i style="left:${th.extreme}%"></i>
  </div>`;
}

/** state at a glance: one icon chip per thing that matters, the explanation on hover */
function statusTags(s: Survivor) {
  const t: string[] = [];
  if (s.isLeader) t.push(stChip('faction', 'lead', '<b>Leads the house</b><br>Goes on the runs. If they fall, it is over.', 'lead'));
  if (s.breakState) t.push(stChip('break', esc(s.breakState.kind === 'away' ? 'away' : s.breakState.kind), `<b>Mental break</b><br>${esc(s.breakState.kind)}, ${Math.ceil(s.breakState.days)} more day${Math.ceil(s.breakState.days) === 1 ? '' : 's'}. Counsel helps.`, 'bad'));
  const p = pain(s);
  const wounds = s.wounds.filter((w) => !w.hidden);
  if (p > 0.05) t.push(stChip('wound', wounds.length > 1 ? String(wounds.length) : p > 1 ? 'bad' : p > 0.5 ? 'hurt' : 'cut', `<b>${p > 1 ? 'Badly hurt' : p > 0.5 ? 'Hurt' : 'Scratched up'}</b><br>${wounds.map((w) => `${esc(woundLabel(w))} ${Math.round(w.severity * 100)}%${w.tended ? ' · tended' : ''}${w.bleeding ? ' · bleeding' : ''}`).join('<br>')}`, p > 0.8 ? 'bad' : 'warn'));
  if (isBitten(s) && !s.wounds.some((w) => w.hidden)) t.push(stChip('bite', 'bitten', '<b>Bitten</b><br>The Turn is coming. Nobody has walked one back.', 'bad bite'));
  if (s.infection > 0.3 && s.wounds.some((w) => w.hidden)) t.push(stChip('sick', '?', '<b>Feverish?</b><br>Sweating, keeping a sleeve down. Something is wrong.', 'warn'));
  if (s.rest < 0.45) t.push(stChip('tired', `${Math.round(s.rest * 100)}%`, `<b>${s.rest < 0.25 ? 'Worn out' : 'Tired'}</b> · rested ${Math.round(s.rest * 100)}%<br>Short hours or a day of rest.`, s.rest < 0.25 ? 'warn' : ''));
  if (s.hunger < 0.35) t.push(stChip('hungry', s.hunger < 0.1 ? 'starving' : 'hungry', `<b>${s.hunger < 0.1 ? 'Starving' : 'Hungry'}</b><br>Fed ${Math.round(s.hunger * 100)}%. Food comes from the stores at dusk.`, s.hunger < 0.1 ? 'bad' : 'warn'));
  if (G.flags[`inspired_${s.id}`]) t.push(stChip('mood_up', 'inspired', '<b>Inspired</b><br>Works and fights better today.', 'good'));
  for (const sc of s.scars) if (sc.label.startsWith('lost')) t.push(stChip('wound', esc(sc.label.replace(/^lost /, '−')), `<b>${esc(sc.label)}</b><br>For good.`));
  if (!s.dead && !canFight(s)) t.push(stChip('wall', 'off wall', `<b>Won't stand the wall</b><br>${esc(first(s))} sits tonight out.`, 'warn'));
  return t.join('');
}

const riskWord = (r: number) => (r < 0.2 ? 'low' : r < 0.4 ? 'some' : r < 0.6 ? 'high' : 'grave');
function siteStock(id: string) {
  const site = SITES.find((x) => x.id === id)!;
  const left = Math.max(0, (G.flags[`stock_${id}`] as number) ?? site.stock);
  return { left, max: site.stock, pips: `${'▮'.repeat(left)}${'▯'.repeat(Math.max(0, site.stock - left))}` };
}

// 07:00–17:00 strip: walking (hatched), working, resting, away on a run. The words are in its tooltip.
function hoursBar(s: Survivor) {
  const avail = hoursAvailable(s);
  const h = jobHours(s);
  const travel = s.job === 'scavenge' ? Math.min(h, travelHours(survivorSite(s))) : 0;
  const cells: string[] = [];
  for (let i = 0; i < DAY_HOURS; i++) {
    const k = i < travel / 2 ? 'tr' : i < h - travel / 2 ? 'wk' : i < h ? 'tr' : i < avail ? 'rs' : 'aw';
    cells.push(`<i class="${k}"></i>`);
  }
  const job = JOBS.find((j) => j.id === s.job)?.label ?? s.job;
  const away = onRunToday(s);
  const noSearch = s.job === 'scavenge' && h - travel <= 0;
  let label: string;
  if (s.job === 'rest') label = away ? `Out on a run from ${clockLabel(avail)}` : 'Rest all day';
  else if (s.job === 'scavenge') label = `${travel}h walking · ${Math.max(0, h - travel)}h searching${avail - h > 0 ? ` · rest ${avail - h}h` : ''}${noSearch ? '<br><b>No time left to search.</b>' : ''}`;
  else label = `${esc(job)} ${h}h${avail - h > 0 ? ` + rest ${avail - h}h` : ''}${away ? ` · run from ${clockLabel(avail)}` : ''}`;
  const legend = '<span class="dim">07:00–17:00 · ▨ walking · ■ work · □ rest</span>';
  const can = s.job !== 'rest' && canWork(s) && avail > 0;
  const short = s.job === 'rest' ? (away ? `run ${clockLabel(avail)}` : 'rest') : `${h}h`;
  return `<div class="hours sv-hours" aria-label="Day plan for ${esc(first(s))}">
    <div class="hstrip"${tip(`${label}<br>${legend}`)}>${cells.join('')}</div>
    <span class="hlabel t-s ${noSearch ? 'bad' : ''}">${short}</span>${can ? `<button class="mini hb" data-act="hrs" data-d="-1" data-id="${s.id}" aria-label="Fewer hours" ${h <= 1 ? 'disabled' : ''}>−</button><button class="mini hb" data-act="hrs" data-d="1" data-id="${s.id}" aria-label="More hours" ${h >= avail ? 'disabled' : ''}>+</button>` : ''}
  </div>`;
}

/** one skill as icon + pips; the name and numbers on hover */
function skillPip(s: Survivor, k: SkillId) {
  const pas = s.passions.includes(k);
  return `<span class="sv-sk"${tip(`<b>${esc(SKILL_NAMES[k])} ${s.skills[k]}</b>${pas ? '<br>Passion: learns 50% faster' : ''}`)}>${icoFb('skill_' + k, SKILL_NAMES[k].slice(0, 5))}${pas ? '<i class="pas">♦</i>' : ''}${pips(s.skills[k], 10)}</span>`;
}

function skillsMini(s: Survivor) {
  const top = topSkills(s, 2).map((k) => skillPip(s, k));
  const heavy = s.training?.heavy ?? 0;
  const at = (st: string, word: string, v: number, t: string) => `<span class="chip sv-chip sv-attr"${tip(t)}>${icoFb(st, word)}<b>${v}</b></span>`;
  const attrs = [
    at('st_courage', 'nerve', attr(s, 'courage'), `<b>Courage ${attr(s, 'courage')}</b><br>Nerve on the wall: holds when it breaks.`),
    at('st_grit', 'grit', attr(s, 'grit'), `<b>Grit ${attr(s, 'grit')}</b><br>Shrugs off fatigue and pain.`),
  ];
  if (heavy > 0 || emplacements().length) attrs.push(at('st_wall', 'heavy', heavy, `<b>Heavy weapons ${heavy}</b><br>Crew-served guns in the nests.`));
  return `<div class="skmini sv-skills">${top.join('')}<span class="sv-attrs">${attrs.join('')}</span></div>`;
}

/** The closed line of a survivor's detail fold: their gun as a picture, its rounds, their aim. */
function gearPeek(s: Survivor) {
  const it = G.weapons.find((x) => x.uid === s.weapon);
  const p = it ? fireProfile(it) : null;
  const rounds = p?.ammoRes ? Math.floor((G.stores[p.ammoRes] ?? 0) / (p.perShot || 1)) : null;
  const gun = it ? `<img class="sv-peekgun" src="${spriteUrl(WEAPONS[it.def].icon)}" alt="" onerror="this.style.display='none'"><span class="t-s">${esc(it.name ? `"${it.name}"` : WEAPONS[it.def].name)}</span>${rounds !== null ? `<b class="t-s ${rounds < 25 ? 'neg' : ''}">${rounds}</b>` : ''}` : '<span class="t-s dim">unarmed</span>';
  return `<span class="sv-peek"${tip('Gun, rounds, skills, hours and mood: open for the details.')}>${gun}<span class="t-xs">aim ${Math.round(aimFactor(s) * 100)}</span></span>`;
}

function survivorCard(s: Survivor, dots: Set<string> = new Set()) {
  computeMood(s);
  const site = survivorSite(s);
  const sites = SITES.filter((x) => x.minDay <= G.day);
  const freeWeapons = G.weapons.filter((x) => x.uid === s.weapon || !living().some((o) => o.weapon === x.uid));
  const disabled = !canWork(s);
  const stale = !disabled && G.day > 1 && !planConfirmed(s) && !(onRunToday(s));
  const hp = heldProf(s);
  const jobDef = JOBS.find((j) => j.id === s.job);
  const drill = s.job === 'drill' ? (() => { const d = drillPlan(s); return d.live ? `${d.rounds} ${esc(ammoLabel(d.ammo).toLowerCase())}` : 'No live rounds: dry-fire.'; })() : '';
  const jobTip = `<b>${esc(jobDef?.label ?? s.job)}</b> · ${esc(jobOutlook(s, s.job))}<br>${esc(jobDef?.hint ?? '')}${drill ? `<br>${drill}` : ''}`;
  const st = s.job === 'scavenge' ? siteStock(site) : null;
  return `<div class="card surv sv-card ${stale ? 'stale' : ''}" data-id="${s.id}"${dots.has(`surv:${s.id}`) ? ' data-dot' : ''}>
    ${portraitImg(s.sprite, `portrait${s.isLeader ? ' lead' : ''}`)}
    <div class="body">
      <div class="name"><a data-act="detail" data-id="${s.id}">${esc(displayName(s))}</a> <span class="age t-xs">${s.age}</span>${s.perkOffers?.length ? `<a class="tag sv-perknew" data-act="detail" data-id="${s.id}"${tip(`<b>New perk</b><br>${esc(progressName(s.perkOffers[0].skill))} reached ${s.perkOffers[0].tier}: pick one on the sheet.`)}>${ico('st_perk', '', 'sm')}perk</a>` : ''}${stale ? `<span class="tag carried"${tip("Yesterday's job carried over. Change it, or press Keep to confirm.")}>same?</span>` : ''}</div>
      <div class="sv-state">${moodChip(s)}${statusTags(s)}</div>
      <div class="row sv-jobrow">
        <span class="sv-job"${tip(jobTip)}>${ico('job_' + s.job, '', '')}</span>
        <select data-act="job" data-id="${s.id}" ${disabled ? 'disabled' : ''} aria-label="Job for ${esc(first(s))}"${sysTip('job_' + s.job)}>
          ${JOBS.filter((j) => j.id === s.job || !JOB_REVEAL[j.id] || isOpen(JOB_REVEAL[j.id]!)).map((j) => `<option value="${j.id}" ${s.job === j.id ? 'selected' : ''} title="${esc(sysLine('job_' + j.id))}">${j.label} — ${jobOutlook(s, j.id)}</option>`).join('')}
        </select>
        ${s.job === 'scavenge' ? `<select data-act="site" data-id="${s.id}" aria-label="Where ${esc(first(s))} scavenges">${sites.map((x) => {
          const xs = siteStock(x.id);
          const walk = travelHours(x.id);
          const search = Math.max(0, jobHours(s) - walk);
          return `<option value="${x.id}" ${site === x.id ? 'selected' : ''}>${x.name}: ${siteFindsText(x)} · ${walk}h walk, ${search}h search · ${xs.left <= 0 ? 'picked clean' : `${xs.left}/${xs.max} left`} · ${riskWord(x.risk)} risk</option>`;
        }).join('')}</select>` : ''}
      </div>
      ${st ? `<div class="stock"${tip(`<b>${esc(SITES.find((x) => x.id === site)?.name ?? '')}</b>: ${st.left <= 0 ? 'picked clean' : `${st.left} of ${st.max} left`}<br>Every trip strips it further. ${Math.round(searchFactor(searchHours(s)) * 100)}% of a full search today.`)}>${st.pips}</div>` : ''}
      ${fold(gearPeek(s), `${moodBar(s)}${skillsMini(s)}${disabled ? '' : hoursBar(s)}
      <div class="row small sv-gear">
        <select data-act="weapon" data-id="${s.id}" aria-label="Gun for ${esc(first(s))}">
          <option value="">— unarmed —</option>
          ${freeWeapons.map((x) => `<option value="${x.uid}" ${x.uid === s.weapon ? 'selected' : ''}>${esc(x.name ? `"${x.name}"` : WEAPONS[x.def].name)} (${Math.round(x.cond * 100)}%)</option>`).join('')}
        </select>
        ${ammoSelect(G.weapons.find((x) => x.uid === s.weapon), true)}
        ${meleeSelect(s)}
        ${hp ? `<span class="chip sv-chip"${tip(`<b>${esc(CLASS_NAMES[hp.cls])} ${hp.v}</b><br>${esc(first(s))}'s proficiency (0–10). Grows with drill and use.`)}><b>${esc(CLASS_SHORT[hp.cls])} ${hp.v}</b></span>` : ''}
        <span class="chip sv-chip"${tip('<b>Aim on the wall</b><br>Shooting, traits, arm wounds, mood and rest.')}><b>aim ${Math.round(aimFactor(s) * 100)}</b></span>
        ${s.armor ? `<button class="mini" data-act="unarmor" data-id="${s.id}"${tip('Mill-plate vest: wounds 30% lighter. Click to take it off.')}>vest ✓</button>` : (G.flags.armorStock as number) > 0 ? `<button class="mini" data-act="armor" data-id="${s.id}"${tip('Give a mill-plate vest: wounds 30% lighter.')}>+ vest</button>` : ''}
      </div>`, { id: `sv-more-${s.id}`, cls: 'sv-more' })}
    </div>
  </div>`;
}

// one row on the survivor sheet: icon, pips (dark = at arrival, bright = learned here), the xp bar; numbers on hover
function progRow(s: Survivor, k: ProgressKey, name: string, icon: string, passion = false) {
  const cur = level(s, k);
  const base = Math.min(cur, (s.base?.[k] as number | undefined) ?? cur);
  const xp = xpProgress(s, k);
  const t = `<b>${esc(name)} ${cur}</b><br>${base} at arrival${cur > base ? `, +${cur - base} learned here` : ''}<br>${cur >= 10 ? 'Mastered' : `${Math.round(xp * 100)}% to ${cur + 1}`}${passion ? '<br>Passion: learns 50% faster' : ''}`;
  return `<div class="sv-prog"${tip(t)}><span class="sv-pi">${ico(icon, '', 'sm')}${passion ? '<i class="pas">♦</i>' : ''}</span><span class="sv-pn t-s">${esc(name)}</span>
    <span class="pips sv-pips">${'<i class="on"></i>'.repeat(base)}${'<i class="on new"></i>'.repeat(cur - base)}${'<i></i>'.repeat(Math.max(0, 10 - cur))}</span>
    <b class="sv-lv">${cur}</b><span class="xpbar"><i style="width:${xp * 100}%"></i></span></div>`;
}

// Perks kept (chips), and offers waiting (a skill reached 4 or 7): pick one, or they pick at the second dawn.
function perksHtml(s: Survivor) {
  const kept = (s.perks ?? []).filter((id) => PERKS[id]);
  const offers = s.dead ? [] : s.perkOffers ?? [];
  if (!kept.length && !offers.length) return '';
  const body = `${offers.map((o) => `<div class="sv-offer"><div class="t-xs">${esc(progressName(o.skill))} ${o.tier} · choose one</div>
      <div class="sv-offers">${o.options.map((id) => `<button class="sv-perkbtn" data-act="perk" data-id="${s.id}" data-perk="${id}"><b class="t-m">${esc(PERKS[id].name)}</b><span class="t-s">${esc(PERKS[id].desc)}</span></button>`).join('')}</div></div>`).join('')}
    ${kept.length ? `<div class="sv-chips">${kept.map((id) => `<span class="chip sv-chip"${tip(`<b>${esc(PERKS[id].name)}</b> · ${esc(progressName(PERKS[id].skill))} ${PERKS[id].tier}<br>${esc(PERKS[id].desc)}`)}>${ico('st_perk', '', 'sm')}<b>${esc(PERKS[id].name)}</b></span>`).join('')}</div>` : ''}`;
  const head = `<span class="t-l">Perks</span>${offers.length ? `<span class="sv-meta sv-hot">${ico('st_perk', '', 'sm')}${offers.length} to choose</span>` : `<span class="sv-meta">${kept.length}</span>`}`;
  // an open offer always shows (no remembered state); kept perks remember the reader's choice
  return offers.length ? fold(head, body, { open: true, cls: 'sv-fold sv-perks' }) : fold(head, body, { id: 'sv-perks', open: false, cls: 'sv-fold' });
}

function detailHtml(s: Survivor) {
  computeMood(s);
  const parts = moodBreakdown(s);
  const named = parts.slice(1).filter((p) => p.v !== 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const rels = Object.entries(s.rel)
    .map(([id, r]) => ({ id, o: byId(id), r }))
    .filter((x) => x.o)
    .sort((a, b) => Math.abs(b.r.opinion) - Math.abs(a.r.opinion) + (b.r.bond ? 100 : 0) - (a.r.bond ? 100 : 0));
  const heavy = s.training?.heavy ?? 0;
  const wounds = s.wounds.filter((w) => !w.hidden);
  const best = topSkills(s, 1)[0];
  const mp = (p: { label: string; v: number }) => `<div class="mp ${p.v >= 0 ? 'pos' : 'neg'}"><span>${esc(p.label)}</span><b>${signed(p.v)}</b></div>`;

  const traits = fold(`<span class="t-l">Traits</span><span class="sv-meta">${s.traits.map((t) => esc(TRAITS[t].name)).join(' · ')}</span>`,
    `<div class="sv-chips">${s.traits.map((t) => `<span class="chip sv-chip"${tip(`<b>${esc(TRAITS[t].name)}</b><br>${esc(TRAITS[t].desc)}`)}>${ico('st_trait', '', 'sm')}<b>${esc(TRAITS[t].name)}</b></span>`).join('')}</div>`,
    { id: 'sv-traits', open: true, cls: 'sv-fold' });

  const skills = fold(`<span class="t-l">Skills</span><span class="sv-meta">best ${esc(SKILL_NAMES[best])} ${s.skills[best]}</span>`,
    `${SKILLS.map((k) => progRow(s, k, SKILL_NAMES[k], 'skill_' + k, s.passions.includes(k))).join('')}
    <div class="t-xs sv-sub">Nerve and body</div>
    ${progRow(s, 'courage', ATTR_NAMES.courage, 'st_courage')}${progRow(s, 'grit', ATTR_NAMES.grit, 'st_grit')}
    ${heavy > 0 || emplacements().length ? progRow(s, 'heavy', progressName('heavy'), 'st_wall') : ''}
    <div class="t-xs sv-sub">Guns</div>
    <div class="sv-chips">${WEAPON_CLASSES.map((c) => `<span class="chip sv-chip sv-gun ${prof(s, c) >= 5 ? 'good' : prof(s, c) <= 1 ? 'lo' : ''}"${tip(`<b>${esc(CLASS_NAMES[c])} ${prof(s, c)}</b><br>${Math.round(xpProgress(s, `prof_${c}`) * 100)}% to the next`)}><b>${esc(CLASS_SHORT[c])} ${prof(s, c)}</b></span>`).join('')}</div>`,
    { id: 'sv-skills', open: true, cls: 'sv-fold' });

  const mood = fold(`<span class="t-l">Mood</span><span class="sv-meta"><b class="sv-big ${moodTone(s)}">${Math.round(s.mood)}</b> ${esc(moodWord(s.mood))}</span>`,
    `${moodBar(s)}
    ${named.slice(0, 3).map(mp).join('') || '<div class="t-s">Nothing on their mind.</div>'}
    ${named.length > 3 ? fold(`<span class="t-s">All ${parts.length} reasons</span>`, parts.map(mp).join(''), { id: 'sv-moodall', cls: 'sv-fold sv-inner' }) : ''}`,
    { id: 'sv-mood', open: true, cls: 'sv-fold' });

  const body = fold(`<span class="t-l">Body</span><span class="sv-meta">${wounds.length ? `${ico('st_wound', '', 'sm')}${wounds.length} wound${wounds.length > 1 ? 's' : ''}` : 'whole'} · rested ${Math.round(s.rest * 100)}%</span>`,
    `${wounds.map((w) => `<div class="sv-wound"${tip(`<b>${esc(woundLabel(w))}</b><br>${Math.round(w.severity * 100)}% severe${w.tended ? ' · tended' : ' · untended'}${w.bleeding ? '<br>Bleeding.' : ''}${w.infected ? (w.kind === 'bite' ? '<br>The Turn.' : '<br>Infected.') : ''}`)}>${ico(w.kind === 'bite' ? 'st_bite' : 'st_wound', '', 'sm')}<span>${esc(woundLabel(w))}</span><span class="xpbar sev"><i style="width:${w.severity * 100}%"></i></span>${w.bleeding ? '<b class="neg">bleeding</b>' : ''}${w.infected ? `<b class="neg">${w.kind === 'bite' ? 'the Turn' : 'infected'}</b>` : ''}${w.tended ? '<span class="t-xs">tended</span>' : ''}</div>`).join('') || '<div class="t-s">Whole, for now.</div>'}
    ${s.scars.length ? `<div class="sv-chips">${s.scars.map((sc) => `<span class="chip sv-chip"${tip('<b>Scar</b><br>For good.')}><b>${esc(sc.label)}</b></span>`).join('')}</div>` : ''}
    <div class="sv-chips">${stChip('tired', `${Math.round(s.rest * 100)}%`, `<b>Rested ${Math.round(s.rest * 100)}%</b>`)}${stChip('hungry', `${Math.round(s.hunger * 100)}%`, `<b>Fed ${Math.round(s.hunger * 100)}%</b>`)}</div>`,
    { id: 'sv-body', open: wounds.length > 0, cls: 'sv-fold' });

  const people = fold(`<span class="t-l">People</span><span class="sv-meta">${rels.length}</span>`,
    rels.map(({ id, o, r }) => {
      const about = s.thoughts.filter((t) => t.about === id);
      const back = o!.rel[s.id]?.opinion;
      const t = `<b>${esc(first(o!))}</b>${r.bond ? ` · ${r.bond}` : ''}${o!.dead ? ' · dead' : ''}<br>${esc(first(s))}'s opinion ${signed(r.opinion)} (−100…+100)${back !== undefined ? `<br>${esc(first(o!))} thinks ${signed(back)} back` : ''}${about.length ? `<br>${about.map((a) => `${esc(a.label)} ${signed(Math.round(a.mood))}`).join('<br>')}` : ''}`;
      return `<div class="rel sv-rel"${tip(t)}>${ico(o!.dead ? 'st_dead' : r.opinion >= 0 ? 'st_love' : 'st_hate', '', 'sm')}<span>${esc(first(o!))}${o!.dead ? ' †' : ''}</span>${r.bond ? `<em>${r.bond}</em>` : ''}<b class="${r.opinion >= 0 ? 'pos' : 'neg'}">${signed(r.opinion)}</b></div>`;
    }).join('') || '<div class="t-s">Keeps to themself.</div>',
    { id: 'sv-people', open: true, cls: 'sv-fold' });

  const story = fold(`<span class="t-l">Backstory</span><span class="sv-meta">${s.tales.length ? `${s.tales.length} tale${s.tales.length > 1 ? 's' : ''}` : ''}</span>`,
    `<p class="story"><b>Before.</b> ${esc(s.before)}</p>
    <p class="story"><b>When it began.</b> ${esc(s.outbreak)}</p>
    <div class="t-xs sv-sub">Remembered for</div>
    ${s.tales.length ? s.tales.map((t) => `<div class="tale">${esc(t)}</div>`).join('') : '<div class="t-s">Nothing yet. Give it time.</div>'}`,
    { id: 'sv-story', open: false, cls: 'sv-fold' });

  return `<div class="modal detail sv-sheet">
    <button class="close" data-act="closedetail" aria-label="Close">×</button>
    <div class="dhead sv-head">
      ${portraitImg(s.sprite, `portrait big${s.dead ? ' dead' : ''}`)}
      <div class="sv-id">
        <h2 class="t-xl">${esc(displayName(s))}</h2>
        ${s.titles?.length ? `<div class="titles t-s">${s.titles.map((t) => `<span>“${esc(t)}”</span>`).join(' ')}</div>` : ''}
        <div class="t-s sv-line"><span${tip(`${s.sex === 'm' ? 'Man' : 'Woman'}, ${s.age}`)}>${s.age}</span> · <span${tip('Arrived at the house')}>since ${dateLabel(s.arrivedDay)}</span> · <span${tip('Turned put down, all told')}>${s.kills} put down</span>${s.dead ? ` · <b>died ${dateLabel(s.dead.day)}</b>` : ''}</div>
        <div class="sv-state">${s.dead ? '' : moodChip(s)}${s.dead ? '' : statusTags(s)}</div>
        ${s.dead ? `<p class="story epitaph">${esc(s.dead.cause)}. <i>${esc(s.dead.epitaph)}</i></p>` : ''}
      </div>
    </div>
    <div class="sv-cols">
      <div>${perksHtml(s)}${skills}${traits}</div>
      <div>${mood}${body}${people}${story}</div>
    </div>
  </div>`;
}

// Companion for a run (expedition.ts reads G.flags.runMate); they give up their day's work.
function runMateSelect(l: Survivor) {
  const mates = living().filter((s) => s !== l && canWork(s) && !s.breakState);
  if (!mates.length) return '';
  const cur = G.flags.runMate as string | undefined;
  return `<select data-act="runmate" aria-label="Companion"${tip('Take one along: they shoot, carry 6 more, and can drag you home. They keep your hours: home work until you leave, then the road.')}>
    <option value="">alone</option>
    ${mates.map((s) => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>+ ${esc(first(s))}${s.weapon ? '' : ' (unarmed)'}</option>`).join('')}</select>`;
}

let runLeave = 0;
let runSite = 'route9';
function runHtml() {
  const l = living().find((s) => s.isLeader);
  if (!l) return '';
  if (ranToday()) return '<div class="run dim t-s">Already out today.</div>';
  if (!canWork(l)) return `<div class="run dim t-s">${esc(first(l))} is in no shape to go out.</div>`;
  const sites = SITES.filter((x) => x.minDay <= G.day);
  if (!sites.some((x) => x.id === runSite)) runSite = sites[0].id;
  const secs = runDaylightFor(runSite, runLeave);
  const streetH = Math.max(0, DAY_HOURS - runLeave - travelHours(runSite));
  const site = SITES.find((x) => x.id === runSite)!;
  const st = siteStock(runSite);
  const why = `${esc(first(l))} goes on foot, alone or with one other. Far sites eat the day in walking; leaving late leaves less light on the street. ${runLeave ? `${esc(first(l))} works ${runLeave}h at home first.` : `${esc(first(l))} does no other work today.`}`;
  return `<div class="run"><div class="t-l rhead"${tip(why)}>Lead a run <span class="qm">?</span></div>
    <select data-act="runsite" aria-label="Run destination">${sites.map((x) => {
      const s2 = siteStock(x.id);
      return `<option value="${x.id}" ${x.id === runSite ? 'selected' : ''}>${x.name}: ${siteFindsText(x)} · ${travelHours(x.id)}h · ${s2.left <= 0 ? 'picked clean' : `${s2.left}/${s2.max}`} · ${riskWord(x.risk)} risk</option>`;
    }).join('')}</select>
    <div class="runrow">
      <select data-act="runleave" aria-label="Leave at">${[0, 2, 4, 6].map((h) => `<option value="${h}" ${h === runLeave ? 'selected' : ''}>leave ${clockLabel(h)}</option>`).join('')}</select>
      ${runMateSelect(l)}
    </div>
    <div class="runchips">${chip('st_time', `${travelHours(runSite)}h`, 'Walking there and back')}${chip('st_danger', riskWord(site.risk), `Risk at ${esc(site.name)}`, site.risk >= 0.4 ? 'warn' : '')}<span class="chip"${tip(`Loot left at ${esc(site.name)}: ${st.left} of ${st.max}`)}>${pips(st.left, st.max)}</span></div>
    <div class="rundl"${tip('Grey: work at home · hatched: walking · gold: on the street')}><div class="hstrip">${Array.from({ length: DAY_HOURS }, (_, i) => `<i class="${i < runLeave ? 'wk' : i < runLeave + travelHours(runSite) / 2 ? 'tr' : i < DAY_HOURS - travelHours(runSite) / 2 ? 'st' : 'tr'}"></i>`).join('')}</div>
    <span class="t-xs">${streetH}h street · ${secs}s light</span></div>
    <button data-act="run" ${secs < 30 ? 'disabled title="Not enough daylight left to make it worth the walk"' : ''}>Go ›</button></div>`;
}

// The picture for a recipe: what it makes.
const SPECIAL_ICON: Record<string, string> = {
  spikes: 'icon_trap_pit', wire: 'icon_trap_snare', light: 'icon_mod_flashlight', trap: 'icon_trap_nails', molotov: 'icon_molotov', liquor: 'icon_molotov',
  fortify: 'icon_st_wall', repair: 'icon_parts', turret: 'icon_nailgun', duffel: 'icon_cloth', repairMelee: 'icon_m_hatchet', roofnest: 'icon_wood', armor: 'icon_scrap',
};
function recipeIcon(r: (typeof RECIPES)[number]): string {
  if (r.weapon && WEAPONS[r.weapon]) return WEAPONS[r.weapon].icon;
  if (r.melee && MELEE[r.melee]) return MELEE[r.melee].icon;
  if (r.mod && MODS[r.mod]) return MODS[r.mod].icon;
  if (r.trap) return TRAPS[r.trap]?.icon ?? 'icon_trap_bear';
  const g = r.gives && (Object.keys(r.gives)[0] as Res | undefined);
  if (g) return RES_ICON[g];
  return SPECIAL_ICON[r.special ?? ''] ?? 'icon_parts';
}
// The make list's groups, in this order.
type MakeGroup = 'ammo' | 'traps' | 'weapons' | 'mods' | 'defence' | 'gear';
const MAKE_GROUPS: { id: MakeGroup; label: string; icon: string }[] = [
  { id: 'ammo', label: 'Ammunition', icon: 'icon_ammo' },
  { id: 'traps', label: 'Trap kits', icon: 'icon_trap_bear' },
  { id: 'weapons', label: 'Weapons', icon: 'icon_pipegun' },
  { id: 'mods', label: 'Attachments', icon: 'icon_mod_scope' },
  { id: 'defence', label: 'The wall', icon: 'icon_st_wall' },
  { id: 'gear', label: 'Gear & supplies', icon: 'icon_parts' },
];
function makeGroup(r: (typeof RECIPES)[number]): MakeGroup {
  if (r.trap) return 'traps';
  if (r.mod) return 'mods';
  if (r.weapon || r.melee) return 'weapons';
  if (r.emplacement || r.empRepair || ['spikes', 'wire', 'light', 'turret', 'fortify', 'roofnest', 'trap'].includes(r.special ?? '')) return 'defence';
  const g = Object.keys(r.gives ?? {}) as Res[];
  if (g.length && g.every((k) => AMMO_TYPES[k] || k === 'molotov')) return 'ammo';
  return 'gear';
}
const BUILD_ICON: Record<string, string> = { workbench: 'icon_job_craft', forge: 'icon_scrap', garden: 'icon_job_farm', infirmary: 'icon_job_doctor', still: 'icon_molotov', generator: 'icon_fuel', radio: 'icon_job_radio' };
const pic = (sprite: string, cls = '') => `<img class="pic ${cls}" src="${spriteUrl(sprite)}" alt="" onerror="this.style.visibility='hidden'">`;

function workshopHtml() {
  const builds = Object.values(BUILDINGS).map((b) => {
    const lvl = buildingLevel(b.id);
    const next = b.cost[lvl];
    return `<div class="wcard build ${lvl ? 'built' : 'unbuilt'}"${tip(`<b>${esc(b.name)}</b><br>${esc(b.desc)}`)}>
      ${pic(BUILD_ICON[b.id] ?? 'icon_parts')}
      <div class="cbody"><div class="cname">${b.name}</div>${pips(lvl, b.maxLevel)}
      ${lvl < b.maxLevel ? `<div class="ccost">${costHtml(next)}</div>` : '<div class="t-xs">full</div>'}</div>
      ${lvl < b.maxLevel ? `<button class="mini" data-act="build" data-id="${b.id}" ${has(next) ? '' : 'disabled'}>${lvl ? '▲' : 'Build'}</button>` : ''}
    </div>`;
  }).join('');
  const recipes = RECIPES.filter((r) => !r.hidden && !(r.special === 'roofnest' && G.flags.roofNest) && buildingLevel(r.needs) >= (r.level ?? 1)).sort((a, b) => +has(b.cost) - +has(a.cost));
  const locked = RECIPES.filter((r) => !r.hidden && buildingLevel(r.needs) < (r.level ?? 1));
  const crafters = living().filter((s) => s.job === 'craft' && canWork(s));
  const queue = G.craftQueue.length ? G.craftQueue.map((q, i) => {
    const r = RECIPES.find((x) => x.id === q.recipe)!;
    return `<div class="q">${pic(recipeIcon(r), 'sm')}<span class="t-s">${r.name}</span><div class="qbar"><div style="width:${(q.progress / r.work) * 100}%"></div></div><button data-act="unqueue" data-i="${i}" title="Cancel (refund)">×</button></div>`;
  }).join('') : '<div class="t-s">Bench idle.</div>';
  const card = (r: (typeof RECIPES)[number]) => `<div class="wcard recipe ${has(r.cost) ? '' : 'cant'}"${tip(`<b>${esc(r.name)}</b> · ${r.work} work<br>${esc(r.desc)}`)}>
      ${pic(recipeIcon(r))}
      <div class="cbody"><div class="cname">${r.name}</div><div class="ccost">${costHtml(r.cost)}</div></div>
      <button class="mini" data-act="queue" data-id="${r.id}" ${has(r.cost) ? '' : 'disabled'} aria-label="Queue ${esc(r.name)}">+</button></div>`;
  // the make list in collapsible groups, each headed by a picture and "ready / total"; affordable first
  const groups = MAKE_GROUPS.map((g) => ({ ...g, rs: recipes.filter((r) => makeGroup(r) === g.id) })).filter((g) => g.rs.length);
  const groupHtml = groups.map((g) => {
    const ready = g.rs.filter((r) => has(r.cost));
    const peek = ready.slice(0, 5).map((r) => pic(recipeIcon(r), 'sm')).join('');
    return fold(`${pic(g.icon, 'sm')}<span class="mk-name">${g.label}</span> <span class="t-xs mk-n"${tip(`${ready.length} of ${g.rs.length} you can afford now`)}>${ready.length}/${g.rs.length}</span><span class="mk-peek">${peek}</span>`,
      `<div class="cards">${g.rs.map(card).join('')}</div>`, { id: `ws-make-${g.id}`, open: g.id === 'ammo', cls: `mk${ready.length ? '' : ' none'}` });
  }).join('');
  return `<div class="ws">
    <div class="wsq"><span class="t-l">Queue</span> ${crafters.length ? chip('job_craft', crafters.map(first).join(', '), 'At the bench today') : chip('st_danger', 'nobody', 'Nobody on the Workshop job', 'warn')}
      ${queue}</div>
    ${fold(`<span class="t-l">Make</span> <span class="t-xs">${recipes.filter((r) => has(r.cost)).length}/${recipes.length}</span>`, `<div class="mkgroups">${groupHtml}</div>
      ${locked.length ? `<div class="t-xs"${tip(`Needs more machinery: ${esc(locked.map((r) => r.name).join(', '))}.`)}>+${locked.length} locked</div>` : ''}`, { id: 'ws-make', open: true })}
    ${fold(`<span class="t-l">Machinery</span> <span class="t-xs">${G.buildings.length}/${Object.keys(BUILDINGS).length}</span>`, `<div class="cards">${builds}</div>`, { id: 'ws-mach', open: true })}
  </div>`;
}

function wallHtml() {
  const f = G.fort;
  const repairers = living().filter((s) => s.job === 'repair' && canWork(s));
  const frac = f.hp / f.maxHp;
  const fortRow: [string, number, string][] = [
    ['icon_st_wall', f.level, 'Reinforcements: more wall. Forge: reinforce the wall.'],
    ['icon_trap_pit', f.spikes, 'Spike rows: the dead hurt themselves at the wall.'],
    ['icon_trap_snare', f.wire, 'Wire belts: slow them in the road.'],
    ['icon_mod_flashlight', f.lights, 'Floodlights: better aim, less dark. Burn fuel.'],
    ['icon_nailgun', f.turrets ?? 0, 'Nail turrets: auto-fire from the wall, eat scrap.'],
    ['icon_trap_nails', f.traps, 'Nail-bomb traps: one use each, out in the road.'],
    ['icon_molotov', G.stores.molotov, 'Firebombs: [F] or right-click at night.'],
  ];
  return `<div class="wall">
    <div class="wallbar"${tip(frac > 0.8 ? 'The wall is sound.' : frac > 0.4 ? 'The wall is chewed. Planks split, the car door hangs.' : 'The wall is barely a wall.')}><div data-tw="wall" style="width:${frac * 100}%"></div><span>${Math.ceil(f.hp)} / ${f.maxHp}</span></div>
    <div class="chips">${repairers.length ? chip('job_repair', repairers.map(first).join(', '), 'Repairing today') : chip('st_danger', 'no repairs', 'Nobody is assigned to repair it.', 'warn')}${chip('wood', G.stores.wood, 'Timber for repairs')}</div>
    <div class="fortgrid">${fortRow.filter(([, n]) => n > 0 || isOpen('workshop')).map(([icon, n, t]) => `<span class="ftile ${n ? '' : 'none'}"${tip(t)}>${pic(icon)}<b>${n}</b></span>`).join('')}</div>
    ${isOpen('chores') ? revealNote('chores') + choresHtml() : ''}
  </div>`;
}

// One-click chores: a few hours of someone's day (the leader first), no job slot needed.
function choresHtml() {
  const out: string[] = [];
  const cold = G.weather === 'cold' || G.weather === 'snow' || G.day >= 20;
  if (G.flags.oiledDay === G.day) out.push(`<span class="chip good"${tip('The cold will not seize them tonight.')}>✓ guns oiled</span>`);
  else {
    const hand = choreHand(1);
    const can = !!hand && ((G.stores.cloth ?? 0) >= 1 || (G.stores.fuel ?? 0) >= 1);
    out.push(`<button class="mini ${cold ? 'urgent' : ''}" data-act="oil" ${can ? '' : 'disabled'}${tip(`1 hour${hand ? ` (${esc(first(hand))})` : ''} · a rag or 1 fuel · ${cold ? '<b>dry guns jam in this cold</b>' : 'fewer stoppages in the cold'}`)}>Oil the guns</button>`);
  }
  if (G.flags.pileCarry) {
    let tot = 0;
    try { tot = (JSON.parse(G.flags.pileCarry as string) as number[]).reduce((a, b) => a + b, 0); } catch { tot = 0; }
    const h3 = choreHand(3), h1 = choreHand(1);
    const pile = `Bodies against the wall from last night (${tot >= 6 ? 'a ramp by tonight' : 'a low heap'}).`;
    out.push(`<button class="mini" data-act="pile" data-how="haul" ${h3 ? '' : 'disabled'}${tip(`${pile} 3 hours, grim work.`)}>Haul bodies</button>`);
    out.push(`<button class="mini" data-act="pile" data-how="burn" ${h1 && (G.stores.fuel ?? 0) >= 2 ? '' : 'disabled'}${tip(`${pile} 2 fuel, 1 hour.`)}>Burn pile</button>`);
  }
  return `<div class="chores"><span class="t-l"${tip('Done by whoever has the hours: the leader first.')}>Chores</span> ${out.join(' ')}</div>`;
}

// Hand weapon carried alongside the gun (Survivor.melee → G.melee).
function meleeSelect(s: Survivor) {
  const all = G.melee ?? [];
  if (!all.length && !s.melee) return '';
  const free = all.filter((k) => k.uid === s.melee || !living().some((o) => o !== s && o.melee === k.uid));
  return `<select data-act="melee" data-id="${s.id}" title="Hand weapon: [V] on runs; at the wall when the gun runs dry" style="flex:0 1 auto;min-width:0">
    <option value="">fists</option>
    ${free.map((k) => `<option value="${k.uid}" ${k.uid === s.melee ? 'selected' : ''}>${esc(MELEE[k.def].name)} ${Math.round(k.cond * 100)}%</option>`).join('')}</select>`;
}

// Bullet-type dropdown for one gun (only when its caliber has more than one type).
function ammoSelect(w: WeaponItem | undefined, compact = false) {
  if (!w) return '';
  const types = ammoTypesFor(w.def);
  if (types.length < 2) return '';
  const cur = selectedAmmo(w);
  return `<select data-act="ammo" data-w="${w.uid}" title="Bullet type" ${compact ? 'style="flex:0 1 auto;min-width:0"' : ''}>${types.map((t) => {
    const n = Math.floor(G.stores[t] ?? 0);
    return `<option value="${t}" ${t === cur ? 'selected' : ''}>${esc(compact ? AMMO_TYPES[t]!.short : ammoLabel(t))} (${n})</option>`;
  }).join('')}</select>`;
}

// Attachment slots for one gun: a small icon per slot; an invisible dropdown over it attaches/detaches.
function modSlotsHtml(w: WeaponItem) {
  const slots = slotsFor(w.def);
  if (!slots.length) return '';
  const stock = G.modStock ?? [];
  return `<div class="mslots">${slots.map((slot) => {
    const cur = w.mods?.[slot];
    const md = cur ? MODS[cur.def] : null;
    const spare = stock.filter((m) => MODS[m.def]?.slot === slot && MODS[m.def].fits(w.def));
    const name = MOD_SLOTS.find((x) => x.id === slot)!.name;
    const t = md ? `<b>${esc(md.name)}</b> (${esc(name)})<br>${esc(md.niche)}` : `${esc(name)}: empty${spare.length ? ` · ${spare.length} spare fits` : ''}`;
    return `<span class="mslot ${md ? 'full' : ''} ${!md && spare.length ? 'avail' : ''}"${tip(t)}>
      ${md ? `<img src="${spriteUrl(md.icon)}" alt="">` : `<i>${esc(name.slice(0, 1))}</i>`}
      <select data-act="mod" data-w="${w.uid}" data-slot="${slot}" aria-label="${esc(name)} slot">
        <option value="">${md ? '— detach —' : '— empty —'}</option>
        ${cur ? `<option value="${cur.uid}" selected>${esc(md!.name)}${cur.cond < 1 ? ` ${Math.round(cur.cond * 100)}%` : ''}</option>` : ''}
        ${spare.map((m) => `<option value="${m.uid}">${esc(MODS[m.def].name)}${m.cond < 1 ? ` ${Math.round(m.cond * 100)}%` : ''}</option>`).join('')}
      </select></span>`;
  }).join('')}</div>`;
}

// What the attachments change, green when better and red when worse (shown in the gun's tooltip).
function modDeltaHtml(w: WeaponItem) {
  if (!w.mods || !Object.keys(w.mods).length) return '';
  const a = fireProfile(w, { noMods: true }), b = fireProfile(w);
  const rows: [keyof FireProfile, string, boolean][] = [
    ['dmg', 'dmg', true], ['spread', 'spread', false], ['rof', 'rate', true], ['mag', 'mag', true], ['reload', 'reload', false],
    ['noise', 'noise', false], ['knock', 'shove', true], ['bloomMul', 'bloom', false], ['recoilMul', 'kick', false],
    ['braceBloomMul', 'bloom on the wall', false], ['switchTime', 'target switch', false], ['light', 'light', true], ['melee', 'melee', true], ['range', 'range', true],
  ];
  const out: string[] = [];
  for (const [k, label, up] of rows) {
    const x = a[k] as number, y = b[k] as number;
    if (x === y || Math.abs(x - y) < 1e-6) continue;
    const better = up ? y > x : y < x;
    let txt: string;
    if (k === 'switchTime') txt = `${y > x ? '+' : '−'}${Math.abs(y - x).toFixed(2)}s`;
    else if (k === 'light' || k === 'melee') txt = `${Math.round(y)}`;
    else if (k === 'range') txt = Number.isFinite(y) ? `${Math.round(y)}px` : '∞';
    else if (k === 'mag') txt = `${x}→${y}`;
    else txt = `${y > x ? '+' : '−'}${Math.round(Math.abs(y / x - 1) * 100)}%`;
    out.push(`<span style="color:${better ? '#9db070' : '#c0604a'}">${label} ${txt}</span>`);
  }
  return out.length ? `<div>mods: ${out.join(' · ')}</div>` : '';
}

const condBar = (c: number) => `<span class="cond ${c < 0.4 ? 'bad' : c < 0.7 ? 'mid' : ''}"><i style="width:${Math.round(c * 100)}%"></i></span>`;

function armoryHtml() {
  let total = 0;
  const stock = Object.values(CALIBERS).map((c) => {
    const items = c.types.map((t) => {
      const n = Math.floor(G.stores[t] ?? 0);
      total += t === 'scrap' ? 0 : n;
      return `<span class="chip ${n ? '' : 'none'}"${tip(`<b>${esc(ammoLabel(t))}</b><br>${esc(AMMO_TYPES[t]!.desc)}`)}><img src="${spriteUrl(AMMO_TYPES[t]!.icon)}" alt=""><b>${n}</b></span>`;
    }).join('');
    return `<div class="calrow"><span class="t-s">${esc(c.name.replace(/\s*\(.*\)/, ''))}</span>${items}</div>`;
  }).join('');
  const order = Object.keys(WEAPONS);
  const guns = [...G.weapons].sort((a, b) => order.indexOf(a.def) - order.indexOf(b.def));
  const spare = G.modStock ?? [];
  const gunCards = guns.map((w) => {
    const d = WEAPONS[w.def];
    const p = fireProfile(w);
    const holder = living().find((s) => s.weapon === w.uid);
    const tags: string[] = [];
    if (p.auto) tags.push('full-auto');
    if (p.burst > 1) tags.push(p.burstGap <= 0 ? `${p.burst} barrels at once` : `${p.burst}-round burst`);
    if (p.reloadPerRound) tags.push('loads one at a time');
    if (p.armorPen > 0.3) tags.push('cracks plate');
    if (p.armorPen < 0) tags.push('poor vs plate');
    if (p.incendiary) tags.push('incendiary');
    if (p.flare) tags.push('lights the road');
    if (p.smoke) tags.push('smoke');
    if (p.explosive) tags.push(`blast ${p.explosive.dmg} r${p.explosive.radius}`);
    if (p.arc) tags.push('lobbed');
    if (p.recoverable > 0) tags.push(`${Math.round(p.recoverable * 100)}% ammo recovered`);
    if (p.noise <= 0.6) tags.push('quiet');
    else if (p.noise >= 2.5) tags.push('loud');
    if (p.jam >= 0.02) tags.push(`jams ${Math.round(p.jam * 100)}%`);
    const types = ammoTypesFor(w.def);
    const stats = `dmg ${Math.round(p.dmg)}${p.pellets > 1 ? `×${p.pellets}` : ''} · ${+p.rof.toFixed(2)}/s · mag ${p.mag} · reload ${p.reloadPerRound ? `${p.reload.toFixed(2)}s/round` : `${+p.reload.toFixed(1)}s`}${p.pierce ? ` · pierce ${p.pierce}` : ''}${p.perShot !== 1 ? ` · ${p.perShot} ${ammoLabel(p.ammoRes).toLowerCase()}/shot` : ''}`;
    const t = `<b>${esc(d.name)}</b> · ${esc(CLASS_NAMES[d.cls].toLowerCase())}${d.niche ? `<br><i>${esc(d.niche)}</i>` : ''}<br>${stats}${tags.length ? `<br>${tags.join(' · ')}` : ''}${modDeltaHtml(w)}<br><span class="dim">${esc(d.desc)}</span>`;
    const n = p.ammoRes ? Math.floor(G.stores[p.ammoRes] ?? 0) : 0;
    const ammo = types.length > 1 ? ammoSelect(w, true) : p.ammoRes ? `<span class="chip ${n ? '' : 'warn'}"${tip(`${esc(ammoLabel(p.ammoRes))}${AMMO_TYPES[p.ammoRes] ? `<br>${esc(AMMO_TYPES[p.ammoRes]!.desc)}` : ''}`)}><img src="${spriteUrl(RES_ICON[p.ammoRes] ?? 'icon_ammo')}" alt=""><b>${n}</b></span>` : '';
    return `<div class="gcard ${holder ? 'held' : ''}">
      <div class="gpic"${tip(t)}><img src="${spriteUrl(d.icon)}" alt="${esc(d.name)}"></div>
      <div class="gname"${tip(t)}>${w.name ? `"${esc(w.name)}"` : esc(d.name)}</div>
      <div class="gmeta">${condBar(w.cond)}<span class="t-xs"${tip(`${Math.round(w.cond * 100)}% condition · ${w.kills} kills`)}>${holder ? esc(first(holder)) : 'rack'}</span></div>
      <div class="gfoot">${ammo}${modSlotsHtml(w)}</div>
    </div>`;
  }).join('');
  const melee = (G.melee ?? []).map((k) => {
    const d = MELEE[k.def];
    const p = meleeProfile(k);
    const holder = living().find((s) => s.melee === k.uid);
    const tags: string[] = [];
    if (p.arc > 1) tags.push(`hits ${p.arc}`);
    if (p.reach >= 90) tags.push('long reach');
    if (p.bleed) tags.push('bleed');
    if (p.finisher) tags.push('silent finisher');
    if (p.pry > 1) tags.push(`pries ×${p.pry}`);
    if (p.fuel) tags.push(`${p.fuel} fuel/swing`);
    if (p.noise >= 1) tags.push('loud');
    const t = `<b>${esc(d.name)}</b><br><i>${esc(d.niche)}</i><br>dmg ${p.dmg} · reach ${p.reach}px · swing ${+(p.swingTime + p.recovery).toFixed(2)}s · shove ${p.knock} · stagger ${Math.round(p.stagger * 100)}% · overhead ×${p.crit} · stamina ${p.stamina}${tags.length ? `<br>${tags.join(' · ')}` : ''}<br><span class="dim">${esc(d.desc)}</span>`;
    return `<div class="gcard sm ${holder ? 'held' : ''}"${tip(t)}><div class="gpic"><img src="${spriteUrl(d.icon)}" alt=""></div><div class="gname">${esc(d.name)}</div>
      <div class="gmeta">${condBar(k.cond)}<span class="t-xs">${holder ? esc(first(holder)) : 'rack'}</span></div></div>`;
  }).join('');
  return `<div class="armory">
  <div class="sechead"><span class="t-l">Guns</span> <span class="t-xs">${guns.length}</span><span class="qm"${tip('Weapons on the rack can be picked up on the wall at night with [Q] or number keys. Worn guns jam. On a daylight run, [T] switches bullet type. Hover a gun for its numbers; click a slot to fit an attachment.')}>?</span></div>
  <div class="gungrid">${gunCards}</div>
  ${fold(`<span class="t-l">Ammunition</span> <span class="t-xs">${total} rounds</span>`, stock, { id: 'arm-ammo' })}
  ${fold(`<span class="t-l">Spare attachments</span> <span class="t-xs">${spare.length}</span>`, `<div class="chips">${spare.length ? spare.map((m) => `<span class="chip"${tip(`<b>${esc(MODS[m.def].name)}</b><br>${esc(MODS[m.def].niche)}`)}><img src="${spriteUrl(MODS[m.def].icon)}" alt=""><b>${esc(MODS[m.def].name.toLowerCase())}</b>${m.cond < 1 ? ` ${Math.round(m.cond * 100)}%` : ''}</span>`).join('') : '<span class="t-s">None. Craft them or find them on runs.</span>'}</div>`, { id: 'arm-mods' })}
  ${fold(`<span class="t-l">Hand weapons</span> <span class="t-xs">${(G.melee ?? []).length}</span>`, melee ? `<div class="gungrid">${melee}</div>` : '<p class="t-s">None. Hatchets and crowbars turn up at the hardware store and the mill; the forge can make a few.</p>', { id: 'arm-melee' })}
  </div>`;
}

function chronicleHtml() {
  const byDay = new Map<number, string[]>();
  for (const e of G.chronicle) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(`<p class="ce ${e.kind}">${esc(e.text)}</p>`);
  }
  const days = [...byDay.entries()].reverse();
  if (!days.length) return '<p class="t-s">Nothing written yet.</p>';
  const firstLine = new Map<number, string>();
  for (const e of G.chronicle) if (!firstLine.has(e.day) || e.kind === 'death') firstLine.set(e.day, e.text);
  const head = (d: number, l: string[]) => `<span class="t-m">${dateLabel(d)}</span> <span class="t-xs">${l.length}</span> <span class="t-s csum">${esc(firstLine.get(d) ?? '')}</span>`;
  const [d0, l0] = days[0];
  return `<div class="chron">${fold(head(d0, l0), l0.join(''), { open: true })}${days.slice(1).map(([d, l]) => fold(head(d, l), l.join(''))).join('')}</div>`;
}

function townHtml() {
  const found = docsFound();
  const word = (v: number) => (v >= 40 ? 'friendly' : v >= 10 ? 'warm' : v > -10 ? 'unknown' : v > -40 ? 'cold' : 'hostile');
  return `<div class="town">
    <div class="sechead"><span class="t-l">Vessey</span></div>
    <div class="factions">${FACTIONS.map((f) => `<div class="faction"${tip(esc(f.desc))}>${ico('st_faction')}<b>${f.name}</b> <span class="rep r${word(rep(f.id))}">${word(rep(f.id))}</span></div>`).join('')}</div>
    ${fold(`<span class="t-l">Papers</span> <span class="t-xs">${found.length} / ${DOCS.length}</span>`, found.length ? found.map((id) => DOCS.find((d) => d.id === id)!).map((d) => fold(`<span class="t-m">${esc(d.title)}</span>`, `<div class="doc"><p>${esc(d.text)}</p></div>`)).join('') : '<p class="t-s">Nothing yet. Lead runs and search doors, sheds and bodies.</p>', { id: 'town-papers' })}
  </div>`;
}

function gravesHtml() {
  if (!G.graves.length) return '<p class="t-s">No graves yet behind the house.</p>';
  return `<div class="graves">${G.graves.map((g) => `<div class="grave" data-act="detail" data-id="${g.id}"${tip(`<b>${esc(displayName(g))}</b>, ${g.age}<br>${dateLabel(g.arrivedDay)} – ${dateLabel(g.dead!.day)}<br>${esc(g.dead!.cause)}<br><i>${esc(g.dead!.epitaph)}</i>`)}>
    ${portraitImg(g.sprite, 'portrait dead')}<div class="gtext"><div class="gn">${esc(displayName(g))}</div>
    <div class="gd">${dateLabel(g.dead!.day)}</div></div></div>`).join('')}</div>`;
}

const STORE_RES: Res[] = ['food', 'wood', 'scrap', 'parts', 'cloth', 'fuel', 'meds', 'liquor', 'molotov'];
const STORE_USE: Partial<Record<Res, string>> = {
  food: 'One a day for every mouth.', wood: 'Repairs the wall; builds frames and machinery.', scrap: 'Ammo, traps, the forge.', parts: 'Machinery, guns, upgrades.',
  cloth: 'Bandages, rags to oil the guns, wicks.', fuel: 'The stove at night; reloading powder; the still.', meds: 'The doctor heals and fights infection with these.',
  liquor: 'Courage for the breaking; the still makes it.', molotov: 'Firebombs: [F] or right-click at night.',
};

// One compact chip for every round in the house, with a per-caliber breakdown on hover/focus.
function ammoChip() {
  const rows = Object.values(CALIBERS).map((c) => {
    const types = c.types.filter((t) => t !== 'scrap');
    const n = types.reduce((a, t) => a + Math.floor(G.stores[t] ?? 0), 0);
    return { c, types, n };
  }).filter((r) => r.types.length);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const keys = rows.flatMap((r) => r.types).join(' ');
  const t = `<b>Ammunition</b><br>${rows.filter((r) => r.n).map((r) => `${esc(r.c.name.replace(/\s*\(.*\)/, ''))}: ${r.types.filter((x) => (G.stores[x] ?? 0) >= 1).map((x) => `${Math.floor(G.stores[x] ?? 0)} ${esc((AMMO_TYPES[x]?.short ?? ammoLabel(x)).toLowerCase())}`).join(' · ')}`).join('<br>')}`;
  return `<span class="schip ammochip" data-res-group="${keys}"${tip(t)}><img src="${spriteUrl(RES_ICON.light)}" alt="rounds"><span class="n">${total}</span></span>`;
}

let duskArmed = false; // first dusk press with carried-over plans only highlights them

export function renderDay(root: HTMLElement, h: DayHandlers, report: string[]) {
  const ice = ICE_DAY - G.day;
  const fc = forecast();
  const eat = living().length;
  const sel = detail ? byId(detail) : null;
  const stale = living().filter((s) => canWork(s) && G.day > 1 && !planConfirmed(s) && !(onRunToday(s)));
  const heat = heatNeed();
  // threatPoints() rolls the director's jitter; peek without advancing the seeded RNG so re-renders stay deterministic
  const r0 = R.s;
  const tp = threatPoints();
  R.s = r0;
  const tonight = calendar(1)[0];
  const dread = tonight.kind === 'tide' || tonight.kind === 'crossing' || tonight.kind === 'band';
  if (dread && G.flags.dreadCue !== G.day) {
    // once per tide day: a sting, and the dogs out on Route 9
    G.flags.dreadCue = G.day;
    window.setTimeout(() => { stinger('dread'); distant('dog', { delay: 1.2 }); distant('dog', { delay: 3.4, gain: 0.3 }); distant('dog', { delay: 7, gain: 0.35 }); }, 400);
  }
  // the tabs open over the first days (src/ui/today.ts REVEAL); the Wall is there from the start
  const tabs = ['workshop', 'wall', 'armory', 'town', 'chronicle', 'graves'].filter((t) => t === 'wall' || isOpen(t as RevealId));
  if (!tabs.includes(tab)) tab = tabs.includes('workshop') ? 'workshop' : 'wall';
  const strip = todayHtml(keyLabel(keyOf('day.dusk')));
  const dots = dotKeys();
  const sky = dread ? 'linear-gradient(rgba(70,14,10,.62),rgba(24,8,8,.78) 45%,rgba(10,10,12,.92))' : 'linear-gradient(rgba(10,10,12,.72),rgba(10,10,12,.9))';
  root.innerHTML = `<div class="day ${duskArmed && stale.length ? 'armed' : ''} ${dread ? 'dread' : ''}" style="background-image:${sky},url(${spriteUrl('bg_far')})">
    <header>
      <div class="date"${tip(`${WEATHER_LABEL[G.weather] ?? G.weather}<br>This town's seed: ${G.seed}${G.flags.daily ? ` · daily ${esc(String(G.flags.daily))}` : ''}. Start a new game from it on the title screen to replay the same Vessey.`)}><b class="t-xl">${dateLabel()}</b> <span class="t-xs">day ${G.day}</span> <span class="t-s wx">${WEATHER_LABEL[G.weather] ?? G.weather}</span></div>
      <div class="ice"${tip(ice > 0 ? `The river freezes in ${ice} day${ice === 1 ? '' : 's'}. Then the dead can cross.` : ice === 0 ? 'The river is freezing tonight.' : 'The river is ice.')}>${ico('st_cold')}<b>${ice > 0 ? `${ice}d` : ice === 0 ? 'tonight' : 'ice'}</b></div>
      <div class="hbtns"><button class="icon" data-act="help" aria-label="Help and controls" title="Help and controls">?</button><button class="icon" data-act="settings" aria-label="Settings" title="Settings">⚙</button></div>
      <div class="stores">${STORE_RES.filter((r) => isOpen('stores') || ['food', 'wood', 'scrap', 'fuel'].includes(r) || (r === 'molotov' && G.stores.molotov > 0)).map((r) => {
        const low = (r === 'food' && G.stores.food < eat * 2) || (r === 'fuel' && G.stores.fuel < heat);
        const use = r === 'food' ? `Eat ${eat}/day.` : r === 'fuel' && heat ? `The stove burns ${heat} tonight.` : '';
        return `<span data-res="${r}" class="schip ${low ? 'low' : ''}"${tip(`<b>${RES_LABEL[r]}</b><br>${STORE_USE[r] ?? ''}${use ? `<br>${use}` : ''}`)}><img src="${spriteUrl(RES_ICON[r])}" alt="${RES_LABEL[r]}"><span class="n">${Math.floor(G.stores[r] ?? 0)}</span>${r === 'fuel' && heat ? `<em class="heat">−${heat}</em>` : r === 'food' && eat ? `<em>−${eat}</em>` : ''}</span>`;
      }).join('')}${ammoChip()}</div>
    </header>
    ${strip}
    <main>
      <section class="people">
        <h2 class="t-l">The house <span class="t-xs"${tip(`${living().length} living · eat ${eat}/day${G.flags.dog ? ` · and ${esc(String(G.flags.dog))}` : ''} · daylight ${clockLabel(0)}–${clockLabel(DAY_HOURS)}`)}>${living().length} living${G.flags.dog ? ' + dog' : ''}</span></h2>
        ${stale.length ? `<div class="carryover ${duskArmed ? 'flash' : ''}"><span>${stale.length === 1 ? `${esc(first(stale[0]))}'s job` : `${stale.length} jobs`} carried over from yesterday.</span><button class="mini" data-act="keepplans">Keep ${stale.length === 1 ? 'it' : 'them'}</button></div>` : ''}
        ${living().map((s) => survivorCard(s, dots)).join('')}
      </section>
      <section class="center">
        <nav>${tabs.map((t) => `<button class="${tab === t ? 'on' : ''}" data-act="tab" data-id="${t}"${sysTip(t)}${dots.has(`tab:${t}`) ? ' data-dot' : ''}>${t}</button>`).join('')}</nav>
        ${revealNote(tab as RevealId)}
        <div class="tabbody">${tab === 'workshop' ? workshopHtml() : tab === 'wall' ? wallHtml() : tab === 'armory' ? armoryHtml() : tab === 'town' ? townHtml() : tab === 'chronicle' ? chronicleHtml() : gravesHtml()}</div>
      </section>
      <section class="report">
        <h2 class="t-l">This morning</h2>
        <div class="lines">${report.length ? report.slice(0, 2).map((l) => `<p>${esc(l)}</p>`).join('') + (report.length > 2 ? fold(`<span class="t-xs">+${report.length - 2} more</span>`, report.slice(2).map((l) => `<p>${esc(l)}</p>`).join('')) : '') : '<p class="t-s">A quiet morning.</p>'}</div>
        ${fc ? `<p class="forecast">${esc(fc)}</p>` : ''}
        ${isOpen('calendar') ? `<div class="calwrap"${dots.has('calendar') ? ' data-dot' : ''}>${revealNote('calendar')}${calendarHtml()}</div>` : ''}
        ${threadsHtml()}
        ${isOpen('calendar') ? `<div class="weather"${tip(`Tonight feels like ${tp > 60 ? 'a long one' : tp > 30 ? 'a bad one' : 'any other night'}.${heat ? ` The stove will want ${heat} fuel.` : ''}`)}><span class="t-xs">The Weather</span> <b>${persona().name}</b> ${pips(Math.min(5, Math.ceil(tp / 20)), 5, tp > 60 ? 'red' : '')}</div>` : ''}
        ${runOpen() ? `<div class="runwrap"${dots.has('run') ? ' data-dot' : ''}>${revealNote('run')}${runHtml()}</div>` : ''}
        <button class="dusk" data-act="dusk">${duskArmed && stale.length ? 'Yesterday\'s jobs are marked. Go anyway ›' : 'Go to the wall at dusk ›'}<small>${esc(keyLabel(keyOf('day.dusk')))}</small></button>
      </section>
    </main>
    ${G.pendingEvent ? eventModal(G.pendingEvent) : ''}
    ${sel ? `<div class="overlay" data-act="closedetail">${detailHtml(sel)}</div>` : ''}
    ${G.pendingEvent || sel ? '' : hintHtml()}
  </div>`;
  if (!G.pendingEvent && !sel) markHintTarget(root);
  juiceAfterRender(root);
  applyFlash(root);
  // Going to the wall with jobs nobody looked at today: the first press highlights them, the second goes.
  const goDusk = () => {
    const left = living().filter((s) => canWork(s) && G.day > 1 && !planConfirmed(s) && !(onRunToday(s)));
    if (left.length && !duskArmed) {
      duskArmed = true;
      sfx.ui();
      h.rerender();
      return;
    }
    duskArmed = false;
    for (const s of living()) confirmPlan(s);
    sfx.ui('stamp');
    h.onDusk();
  };
  duskKey = goDusk;
  installKeys();

  root.onchange = (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.act === 'runmate') { if (t.value) G.flags.runMate = t.value; else delete G.flags.runMate; h.rerender(); return; }
    if (t.dataset.act === 'runsite') {
      runSite = t.value;
      h.rerender();
      return;
    }
    if (t.dataset.act === 'runleave') {
      runLeave = +t.value;
      h.rerender();
      return;
    }
    if (t.dataset.act === 'mod') {
      const w = G.weapons.find((x) => x.uid === t.dataset.w);
      G.modStock ??= [];
      if (w) {
        if (t.value) attachMod(G.modStock, w, t.value);
        else detachMod(G.modStock, w, t.dataset.slot as ModSlot);
      }
      sfx.ui();
      h.rerender();
      return;
    }
    if (t.dataset.act === 'ammo') {
      const w = G.weapons.find((x) => x.uid === t.dataset.w);
      if (w) w.ammoType = t.value as Res;
      sfx.ui();
      h.rerender();
      return;
    }
    const s = byId(t.dataset.id ?? '');
    if (!s) return;
    if (t.dataset.act === 'job') {
      s.job = t.value as JobId;
      confirmPlan(s);
    }
    if (t.dataset.act === 'site') {
      G.flags[`site_${s.id}`] = t.value;
      confirmPlan(s);
    }
    if (t.dataset.act === 'melee') {
      const prev = living().find((o) => o.melee === t.value && o !== s);
      if (prev) prev.melee = null;
      s.melee = t.value || null;
    }
    if (t.dataset.act === 'weapon') {
      const prev = living().find((o) => o.weapon === t.value && o !== s);
      if (prev) prev.weapon = null;
      s.weapon = t.value || null;
    }
    sfx.ui();
    h.rerender();
  };
  root.onclick = (e) => {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) return;
    const act = el.dataset.act;
    if (el.tagName === 'SELECT') return;
    if (act === 'closedetail') {
      if (e.target !== el && el.classList.contains('overlay')) return;
      detail = null;
    } else if (act === 'detail') { detail = el.dataset.id!; sfx.ui('paper'); h.rerender(); return; }
    else if (act === 'todo') {
      const go = pickTodo(+el.dataset.i!);
      if (go.tab) { tab = go.tab; markSeen(go.tab); }
      sfx.ui('paper');
      h.rerender();
      return;
    } else if (act === 'revealall') {
      setRevealAll(true);
      sfx.ui('paper');
      h.rerender();
      return;
    } else if (act === 'tab') {
      tab = el.dataset.id!;
      markSeen(tab);
      if (tab === 'chronicle') { sfx.ui('type'); window.setTimeout(() => sfx.ui('type'), 90); window.setTimeout(() => sfx.ui('type'), 210); } else sfx.ui('paper');
      h.rerender();
      return;
    } else if (act === 'oil' || act === 'pile') {
      const line = act === 'oil' ? oilGuns() : clearPile(el.dataset.how === 'burn' ? 'burn' : 'haul');
      if (line) report.push(line);
      sfx.ui('stamp');
      h.rerender();
      return;
    }
    else if (act === 'queue') queueRecipe(el.dataset.id!);
    else if (act === 'unqueue') {
      const i = +el.dataset.i!;
      const q = G.craftQueue[i];
      if (q) {
        const r = RECIPES.find((x) => x.id === q.recipe)!;
        for (const [k, v] of Object.entries(r.cost)) G.stores[k as Res] = (G.stores[k as Res] ?? 0) + (v ?? 0);
        G.craftQueue.splice(i, 1);
      }
    } else if (act === 'build') {
      const b = BUILDINGS[el.dataset.id!];
      const lvl = buildingLevel(b.id);
      const cost = b.cost[lvl];
      if (has(cost)) {
        pay(cost);
        const ex = G.buildings.find((x) => x.id === b.id);
        if (ex) ex.level++;
        else G.buildings.push({ id: b.id, level: 1 });
        sfx.ui('stamp');
        h.rerender();
        return;
      }
    } else if (act === 'choice') {
      h.onChoice(+el.dataset.i!);
      return;
    } else if (act === 'hrs') {
      const s = byId(el.dataset.id!);
      if (s) {
        setJobHours(s, jobHours(s) + +el.dataset.d!);
        confirmPlan(s);
      }
    } else if (act === 'keepplans') {
      for (const s of living()) confirmPlan(s);
      duskArmed = false;
    } else if (act === 'armor') {
      const s = byId(el.dataset.id!);
      if (s && (G.flags.armorStock as number) > 0) { s.armor = 'vest'; G.flags.armorStock = (G.flags.armorStock as number) - 1; }
    } else if (act === 'perk') {
      const s = byId(el.dataset.id!);
      const line = s ? choosePerk(s, el.dataset.perk!) : '';
      if (line) { report.push(line); sfx.ui('stamp'); }
    } else if (act === 'unarmor') {
      const s = byId(el.dataset.id!);
      if (s?.armor) { s.armor = null; G.flags.armorStock = ((G.flags.armorStock as number) ?? 0) + 1; }
    } else if (act === 'settings') {
      sfx.ui();
      openSettings(root);
      return;
    } else if (act === 'help') {
      sfx.ui();
      openHelp(root);
      return;
    } else if (act === 'hint-next') nextHint();
    else if (act === 'hint-skip') skipHints();
    else if (act === 'run') {
      if (runDaylightFor(runSite, runLeave) < 30) return;
      music('off');
      // the run's daylight: G.flags.runDaylight (seconds), set here for the run code to read
      prepareRun(runSite, runLeave);
      runLeave = 0;
      h.onRun(runSite);
      return;
    } else if (act === 'dusk') {
      goDusk();
      return;
    }
    sfx.ui();
    h.rerender();
  };
}

// Enter = go to the wall, when nothing modal is open and focus isn't on a control.
// '?' opens the help ledger.
let duskKey: (() => void) | null = null;
let keysInstalled = false;
function installKeys() {
  if (keysInstalled) return;
  keysInstalled = true;
  window.addEventListener('keydown', (e) => {
    // Esc (and the pad's B) closes the survivor sheet when it is the top layer
    if (e.key === 'Escape' && !e.defaultPrevented && G.phase === 'day') {
      const ovs = document.querySelectorAll('.overlay');
      const top = ovs[ovs.length - 1] as HTMLElement | undefined;
      if (top?.dataset.act === 'closedetail' && top.closest('.day')) {
        e.preventDefault();
        (top.querySelector('.close[data-act=closedetail]') as HTMLElement | null)?.click();
        return;
      }
    }
    if (G.phase !== 'day' || !duskKey || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!document.querySelector('.day') || document.querySelector('.overlay') || G.pendingEvent) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(SELECT|INPUT|TEXTAREA|BUTTON|A)$/.test(t.tagName)) return;
    if (is(e, 'day.dusk')) {
      e.preventDefault();
      const f = duskKey;
      duskKey = null;
      f();
    } else if (is(e, 'day.help')) {
      openHelp((document.getElementById('app') as HTMLElement | null) ?? document.body);
    }
  });
}
