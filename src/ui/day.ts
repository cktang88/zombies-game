import type { Survivor, JobId, Res, WeaponItem, ModSlot } from '../types';
import { G, R, dateLabel, ICE_DAY, has, pay, ordinal, docsFound, rep } from '../state';
import { DOCS, FACTIONS } from '../data/lore';
import { spriteUrl } from '../assets';
import { WEAPONS, MELEE, meleeProfile, CLASS_NAMES, CALIBERS, AMMO_TYPES, MODS, MOD_SLOTS, fireProfile, ammoTypesFor, ammoLabel, selectedAmmo, slotsFor, attachMod, detachMod, type FireProfile } from '../data/weapons';
import { TRAITS } from '../data/traits';
import { SKILL_NAMES } from '../data/names';
import { SITES, BUILDINGS, RECIPES, RES_LABEL, RES_ICON } from '../data/world';
import {
  living, displayName, first, moodBreakdown, computeMood, moodWord, breakThresholds, pain, woundLabel, byId, canWork, canFight,
  isBitten, SKILLS, aimFactor, skillOf, workMult, attr, ATTRS, ATTR_NAMES, level, xpProgress, topSkills, heldProf, prof,
  WEAPON_CLASSES, CLASS_SHORT, progressName, type ProgressKey,
} from '../sim/survivors';
import {
  buildingLevel, queueRecipe, WEATHER_LABEL, DAY_HOURS, DEFAULT_HOURS, jobHours, setJobHours, hoursAvailable, travelHours, survivorSite,
  searchHours, searchFactor, planConfirmed, confirmPlan, ranToday, onRunToday, runDaylightFor, prepareRun, clockLabel, heatNeed,
  drillPlan, emplacements, tomorrowTeaser,
} from '../sim/day';
import { persona, forecast, threatPoints } from '../sim/director';
import { sfx, music } from '../audio';
import { openSettings } from './settings';
import { openHelp } from './help';
import { hintHtml, markHintTarget, nextHint, skipHints } from './onboarding';
import { threadsHtml } from '../sim/threads';
import { calendarHtml } from '../sim/calendar';
import { juiceAfterRender } from './juice';

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

// The top two named reasons behind a mood (skipping the baseline).
function moodWhy(s: Survivor) {
  return moodBreakdown(s)
    .slice(1)
    .filter((p) => p.v !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 2);
}

function warnings(): string[] {
  const w: string[] = [];
  const eat = living().length;
  if (eat) {
    const days = Math.floor(G.stores.food / eat);
    const farmers = living().filter((s) => s.job === 'farm' && canWork(s)).length;
    if (days < 2) w.push(`Food for ${days ? 'one more day' : 'less than a day'}.${farmers ? '' : ' Nobody is on the Food job.'}`);
    else if (days < 4) w.push(`Food for ${days} days.`);
  }
  // ammo: what each equipped gun actually loads (fireProfile.ammoRes), in rounds it can fire
  const ammoNeed = new Map<Res, { guns: number; perShot: number }>();
  for (const s of living().filter(canFight)) {
    const it = G.weapons.find((x) => x.uid === s.weapon);
    if (!it) continue;
    const p = fireProfile(it);
    if (!p.ammoRes) continue;
    const e = ammoNeed.get(p.ammoRes) ?? { guns: 0, perShot: p.perShot };
    e.guns++;
    ammoNeed.set(p.ammoRes, e);
  }
  for (const [a, { guns, perShot }] of ammoNeed) {
    const have = Math.floor((G.stores[a] ?? 0) / (perShot || 1));
    if (have < 12 * guns) w.push(`${have ? `Only ${have}` : 'No'} ${ammoLabel(a).toLowerCase()} for ${guns === 1 ? 'one gun' : `${guns} guns`} on the wall.`);
  }
  if (G.fort.hp / G.fort.maxHp < 0.4 && !living().some((s) => s.job === 'repair' && canWork(s))) w.push('The wall is barely standing and nobody is repairing it.');
  if (G.craftQueue.length && !living().some((s) => s.job === 'craft' && canWork(s))) w.push('Work is queued but nobody is at the bench.');
  const ragged = living().filter((s) => s.rest < 0.25 && s.job !== 'rest' && canWork(s));
  if (ragged.length) w.push(`${ragged.map(first).join(', ')} ${ragged.length === 1 ? 'is' : 'are'} worn out. Give ${ragged.length === 1 ? 'them' : 'them'} short hours or a day of rest.`);
  const heat = heatNeed();
  if (heat > G.stores.fuel) w.push(`The stove needs ${heat} fuel tonight and there is ${Math.floor(G.stores.fuel)}.`);
  return w;
}

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
    const ok = (G.stores[k as Res] ?? 0) >= (v ?? 0);
    return `<span class="cost ${ok ? '' : 'short'}"><img src="${spriteUrl(RES_ICON[k as Res])}" alt="">${v} ${RES_LABEL[k as Res].toLowerCase()}</span>`;
  });
  return parts.length ? parts.join(' ') : '<span class="cost">free</span>';
}

function moodBar(s: Survivor) {
  const th = breakThresholds(s);
  const why = moodWhy(s);
  const whyTxt = why.map((p) => `${p.label} ${p.v > 0 ? '+' : '−'}${Math.abs(p.v)}`).join(' · ');
  return `<div class="mood" tabindex="0" title="${esc(whyTxt)}" aria-label="Mood ${Math.round(s.mood)}, ${esc(moodWord(s.mood))}${whyTxt ? `: ${esc(whyTxt)}` : ''}">
  <div class="moodbar">
    <div class="fill" data-tw="mood_${s.id}" style="width:${s.mood}%;background:${s.mood > 50 ? '#8a9a5b' : s.mood > th.minor ? '#b08a3c' : '#a8322a'}"></div>
    <i style="left:${th.minor}%"></i><i style="left:${th.major}%"></i><i style="left:${th.extreme}%"></i>
  </div>
  <div class="why"><b>${esc(moodWord(s.mood))}</b>${why.map((p) => ` <span class="${p.v > 0 ? 'pos' : 'neg'}">${esc(p.label)} ${p.v > 0 ? '+' : '−'}${Math.abs(p.v)}</span>`).join('')}</div>
  </div>`;
}

function statusTags(s: Survivor) {
  const t: string[] = [];
  if (s.isLeader) t.push('<span class="tag lead">leads the house</span>');
  if (s.breakState) t.push(`<span class="tag bad">${s.breakState.kind === 'away' ? 'away' : s.breakState.kind}</span>`);
  const p = pain(s);
  if (p > 0.05) t.push(`<span class="tag ${p > 0.8 ? 'bad' : 'warn'}">${p > 1 ? 'badly hurt' : p > 0.5 ? 'hurt' : 'scratched up'}</span>`);
  if (isBitten(s) && !s.wounds.some((w) => w.hidden)) t.push('<span class="tag bite">BITTEN</span>');
  if (s.infection > 0.3 && s.wounds.some((w) => w.hidden)) t.push('<span class="tag warn">feverish?</span>');
  if (G.flags[`inspired_${s.id}`]) t.push('<span class="tag good">inspired</span>');
  for (const sc of s.scars) if (sc.label.startsWith('lost')) t.push(`<span class="tag">${esc(sc.label)}</span>`);
  return t.join('');
}

const riskWord = (r: number) => (r < 0.2 ? 'low' : r < 0.4 ? 'some' : r < 0.6 ? 'high' : 'grave');
function siteStock(id: string) {
  const site = SITES.find((x) => x.id === id)!;
  const left = Math.max(0, (G.flags[`stock_${id}`] as number) ?? site.stock);
  return { left, max: site.stock, pips: `${'▮'.repeat(left)}${'▯'.repeat(Math.max(0, site.stock - left))}` };
}

// 07:00–17:00 strip: walking (hatched), working, resting, away on a run.
function hoursBar(s: Survivor) {
  const avail = hoursAvailable(s);
  const h = jobHours(s);
  const travel = s.job === 'scavenge' ? Math.min(h, travelHours(survivorSite(s))) : 0;
  const cells: string[] = [];
  for (let i = 0; i < DAY_HOURS; i++) {
    const k = i < travel / 2 ? 'tr' : i < h - travel / 2 ? 'wk' : i < h ? 'tr' : i < avail ? 'rs' : 'aw';
    cells.push(`<i class="${k}" title="${clockLabel(i)}"></i>`);
  }
  const job = JOBS.find((j) => j.id === s.job)?.label ?? s.job;
  const away = onRunToday(s);
  let label: string;
  if (s.job === 'rest') label = away ? `Out on a run from ${clockLabel(avail)}` : 'Rest all day';
  else if (s.job === 'scavenge') label = `${travel}h walking · ${Math.max(0, h - travel)}h searching${avail - h > 0 ? ` · rest ${avail - h}h` : ''}${h - travel <= 0 ? ' — <b>no time to search</b>' : ''}`;
  else label = `${esc(job)} ${h}h${avail - h > 0 ? ` + rest ${avail - h}h` : ''}${away ? ` · run from ${clockLabel(avail)}` : ''}`;
  const can = s.job !== 'rest' && canWork(s) && avail > 0;
  return `<div class="hours" aria-label="Day plan for ${esc(first(s))}">
    <div class="hstrip">${cells.join('')}</div>
    <div class="hrow"><span class="hlabel">${label}</span>${can ? `<button class="mini hb" data-act="hrs" data-d="-1" data-id="${s.id}" aria-label="Fewer hours" ${h <= 1 ? 'disabled' : ''}>−</button><button class="mini hb" data-act="hrs" data-d="1" data-id="${s.id}" aria-label="More hours" ${h >= avail ? 'disabled' : ''}>+</button>` : ''}</div>
  </div>`;
}

function skillsMini(s: Survivor) {
  const top = topSkills(s, 2).map((k) => `<span${s.passions.includes(k) ? ' class="pas" title="Passion: learns 50% faster"' : ''}>${esc(SKILL_NAMES[k])} ${s.skills[k]}</span>`);
  const heavy = s.training?.heavy ?? 0;
  if (heavy > 0 || emplacements().length) top.push(`<span title="Crew-served weapons (gun nests)">heavy ${heavy}</span>`);
  top.push(`<span class="dim" title="Courage: nerve on the wall · Grit: fatigue and pain">nerve ${attr(s, 'courage')} · grit ${attr(s, 'grit')}</span>`);
  return `<div class="skmini">${top.join('')}</div>`;
}

function survivorCard(s: Survivor) {
  computeMood(s);
  const site = survivorSite(s);
  const sites = SITES.filter((x) => x.minDay <= G.day);
  const freeWeapons = G.weapons.filter((x) => x.uid === s.weapon || !living().some((o) => o.weapon === x.uid));
  const disabled = !canWork(s);
  const stale = !disabled && G.day > 1 && !planConfirmed(s) && !(onRunToday(s));
  const hp = heldProf(s);
  return `<div class="card surv ${stale ? 'stale' : ''}" data-id="${s.id}">
    <img class="portrait" src="${spriteUrl(s.sprite)}" alt="">
    <div class="body">
      <div class="name"><a data-act="detail" data-id="${s.id}">${esc(displayName(s))}</a> <span class="age">${s.age}</span>${stale ? '<span class="tag carried" title="Yesterday\'s job carried over. Change it, or press Keep to confirm.">same as yesterday?</span>' : ''}</div>
      <div class="tags">${statusTags(s)}</div>
      ${moodBar(s)}
      ${skillsMini(s)}
      <div class="row">
        <select data-act="job" data-id="${s.id}" ${disabled ? 'disabled' : ''} aria-label="Job for ${esc(first(s))}">
          ${JOBS.map((j) => `<option value="${j.id}" ${s.job === j.id ? 'selected' : ''}>${j.label} — ${jobOutlook(s, j.id)}</option>`).join('')}
        </select>
        ${s.job === 'scavenge' ? `<select data-act="site" data-id="${s.id}" aria-label="Where ${esc(first(s))} scavenges">${sites.map((x) => {
          const st = siteStock(x.id);
          const walk = travelHours(x.id);
          const search = Math.max(0, jobHours(s) - walk);
          return `<option value="${x.id}" ${site === x.id ? 'selected' : ''}>${x.name} · ${walk}h walk, ${search}h search · ${st.left <= 0 ? 'picked clean' : `${st.left}/${st.max} left`} · ${riskWord(x.risk)} risk</option>`;
        }).join('')}</select>` : ''}
      </div>
      ${s.job === 'scavenge' ? `<div class="stock" title="What is left at ${esc(SITES.find((x) => x.id === site)?.name ?? '')}: every trip strips it further">${siteStock(site).pips}<span class="dim">${siteStock(site).left <= 0 ? ' picked clean' : ` ${Math.round(searchFactor(searchHours(s)) * 100)}% of a full search`}</span></div>` : ''}
      ${disabled ? '' : hoursBar(s)}
      ${disabled ? '' : `<div class="jobhint">${esc(JOBS.find((j) => j.id === s.job)?.hint ?? '')}${s.job === 'drill' ? ` <span class="dim">${(() => { const d = drillPlan(s); return d.live ? `${d.rounds} ${esc(ammoLabel(d.ammo).toLowerCase())}` : 'no live rounds: dry-fire'; })()}</span>` : ''}</div>`}
      <div class="row small">
        <select data-act="weapon" data-id="${s.id}">
          <option value="">— unarmed —</option>
          ${freeWeapons.map((x) => `<option value="${x.uid}" ${x.uid === s.weapon ? 'selected' : ''}>${esc(x.name ? `"${x.name}"` : WEAPONS[x.def].name)} (${Math.round(x.cond * 100)}%)</option>`).join('')}
        </select>
        ${ammoSelect(G.weapons.find((x) => x.uid === s.weapon), true)}
        ${meleeSelect(s)}
        ${hp ? `<span class="prof" title="${esc(first(s))}'s proficiency with ${esc(CLASS_NAMES[hp.cls].toLowerCase())} (0–10). Grows with drill and use.">${esc(CLASS_SHORT[hp.cls])} ${hp.v}</span>` : ''}
        <span class="aim" title="Aim on the wall">aim ${Math.round(aimFactor(s) * 100)}</span>
        ${s.armor ? `<button class="mini" data-act="unarmor" data-id="${s.id}" title="Mill-plate vest: wounds 30% lighter. Take it off.">vest ✓</button>` : (G.flags.armorStock as number) > 0 ? `<button class="mini" data-act="armor" data-id="${s.id}" title="Give a mill-plate vest">+ vest</button>` : ''}
        ${canFight(s) ? '' : '<span class="tag bad">won\'t stand the wall</span>'}
      </div>
    </div>
  </div>`;
}

// one row on the survivor sheet: base pips, grown pips, empty pips, and the xp bar to the next level
function progRow(s: Survivor, k: ProgressKey, name: string, passion = false) {
  const cur = level(s, k);
  const base = Math.min(cur, (s.base?.[k] as number | undefined) ?? cur);
  return `<div class="skill prog"><span>${esc(name)}${passion ? ' <b class="pas" title="Passion: learns 50% faster">♦</b>' : ''}</span>
    <div class="pips" title="${base} at arrival${cur > base ? `, +${cur - base} learned here` : ''}">${'■'.repeat(base)}<i>${'■'.repeat(cur - base)}</i><span>${'■'.repeat(10 - cur)}</span></div>
    <div class="xpbar" title="${Math.round(xpProgress(s, k) * 100)}% to ${Math.min(10, cur + 1)}"><i style="width:${xpProgress(s, k) * 100}%"></i></div></div>`;
}

function detailHtml(s: Survivor) {
  computeMood(s);
  const parts = moodBreakdown(s);
  const rels = Object.entries(s.rel)
    .map(([id, r]) => ({ o: byId(id), r }))
    .filter((x) => x.o)
    .sort((a, b) => Math.abs(b.r.opinion) - Math.abs(a.r.opinion) + (b.r.bond ? 100 : 0) - (a.r.bond ? 100 : 0))
    .slice(0, 5);
  const heavy = s.training?.heavy ?? 0;
  return `<div class="modal detail">
    <button class="close" data-act="closedetail">×</button>
    <div class="dhead">
      <img src="${spriteUrl(s.sprite)}" alt="">
      <div>
        <h2>${esc(displayName(s))}</h2>
        <div class="sub">${s.age}, ${s.sex === 'm' ? 'man' : 'woman'} · with us since ${dateLabel(s.arrivedDay)} · ${s.kills} put down${s.dead ? ` · died ${dateLabel(s.dead.day)}` : ''}</div>
        ${s.titles?.length ? `<div class="titles">${s.titles.map((t) => `<span>“${esc(t)}”</span>`).join(' ')}</div>` : ''}
        <p class="story"><b>Before.</b> ${esc(s.before)}</p>
        <p class="story"><b>When it began.</b> ${esc(s.outbreak)}</p>
        ${s.dead ? `<p class="story epitaph">${esc(s.dead.cause)}. <i>${esc(s.dead.epitaph)}</i></p>` : ''}
      </div>
    </div>
    <div class="cols">
      <div>
        <h3>Traits</h3>
        ${s.traits.map((t) => `<div class="trait"><b>${TRAITS[t].name}</b> — ${TRAITS[t].desc}</div>`).join('')}
        <h3>Skills <span class="dim">dark = at arrival · bright = learned here</span></h3>
        ${SKILLS.map((k) => progRow(s, k, SKILL_NAMES[k], s.passions.includes(k))).join('')}
        <h3>Nerve and body</h3>
        ${ATTRS.map((a) => progRow(s, a, ATTR_NAMES[a])).join('')}
        ${heavy > 0 || emplacements().length ? progRow(s, 'heavy', progressName('heavy')) : ''}
        <h3>Guns <span class="dim">proficiency by kind</span></h3>
        <div class="profs">${WEAPON_CLASSES.map((c) => `<span class="${prof(s, c) >= 5 ? 'hi' : prof(s, c) <= 1 ? 'lo' : ''}" title="${Math.round(xpProgress(s, `prof_${c}`) * 100)}% to the next">${esc(CLASS_SHORT[c])} ${prof(s, c)}</span>`).join('')}</div>
      </div>
      <div>
        <h3>Mood ${Math.round(s.mood)} — ${moodWord(s.mood)}</h3>
        ${parts.map((p) => `<div class="mp ${p.v >= 0 ? 'pos' : 'neg'}"><span>${esc(p.label)}</span><b>${p.v > 0 ? '+' : ''}${p.v}</b></div>`).join('')}
        <h3>Body</h3>
        ${s.wounds.filter((w) => !w.hidden).map((w) => `<div class="wound">${esc(woundLabel(w))} · ${Math.round(w.severity * 100)}%${w.tended ? ' · tended' : ''}${w.bleeding ? ' · <b>bleeding</b>' : ''}${w.infected && w.kind !== 'bite' ? ' · <b>infected</b>' : ''}${w.kind === 'bite' && w.infected ? ' · <b class="bite">the Turn</b>' : ''}</div>`).join('') || '<div class="dim">Whole, for now.</div>'}
        ${s.scars.map((sc) => `<div class="wound scar">${esc(sc.label)}</div>`).join('')}
        <div class="dim small">Rested ${Math.round(s.rest * 100)}%</div>
      </div>
      <div>
        <h3>People</h3>
        ${rels.map(({ o, r }) => `<div class="rel"><span>${esc(first(o!))}${o!.dead ? ' †' : ''}</span>${r.bond ? `<em>${r.bond}</em>` : ''}<b class="${r.opinion >= 0 ? 'pos' : 'neg'}">${r.opinion > 0 ? '+' : ''}${r.opinion}</b></div>`).join('') || '<div class="dim">Keeps to themself.</div>'}
        <h3>Remembered for</h3>
        ${s.tales.length ? s.tales.map((t) => `<div class="tale">${esc(t)}</div>`).join('') : '<div class="dim">Nothing yet. Give it time.</div>'}
      </div>
    </div>
  </div>`;
}

// Companion for a run (expedition.ts reads G.flags.runMate); they give up their day's work.
function runMateSelect(l: Survivor) {
  const mates = living().filter((s) => s !== l && canWork(s) && !s.breakState);
  if (!mates.length) return '';
  const cur = G.flags.runMate as string | undefined;
  return `<select data-act="runmate" title="Take one along: they shoot, carry 6 more, and can drag you home. They keep your hours: home work until you leave, then the road.">
    <option value="">— go alone —</option>
    ${mates.map((s) => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>with ${esc(first(s))}${s.weapon ? '' : ' (unarmed)'}</option>`).join('')}</select>`;
}

let runLeave = 0;
let runSite = 'route9';
function runHtml() {
  const l = living().find((s) => s.isLeader);
  if (!l) return '';
  if (ranToday()) return '<div class="run dim">You have already been out today.</div>';
  if (!canWork(l)) return `<div class="run dim">${esc(first(l))} is in no shape to go out.</div>`;
  const sites = SITES.filter((x) => x.minDay <= G.day);
  if (!sites.some((x) => x.id === runSite)) runSite = sites[0].id;
  const secs = runDaylightFor(runSite, runLeave);
  const streetH = Math.max(0, DAY_HOURS - runLeave - travelHours(runSite));
  return `<div class="run"><h3>Lead a run yourself</h3>
    <p class="dim">${esc(first(l))} goes on foot, alone or with one other. Far sites eat the day in walking; leaving late leaves less light on the street. ${runLeave ? `${esc(first(l))} works ${runLeave}h at home first.` : `${esc(first(l))} does no other work today.`}</p>
    <select data-act="runsite" aria-label="Run destination">${sites.map((x) => {
      const st = siteStock(x.id);
      return `<option value="${x.id}" ${x.id === runSite ? 'selected' : ''}>${x.name} · ${travelHours(x.id)}h walk · ${st.left <= 0 ? 'picked clean' : `${st.left}/${st.max} left`} · ${riskWord(x.risk)} risk</option>`;
    }).join('')}</select>
    <select data-act="runleave" aria-label="Leave at">${[0, 2, 4, 6].map((h) => `<option value="${h}" ${h === runLeave ? 'selected' : ''}>Leave at ${clockLabel(h)}${h ? ` (work ${h}h first)` : ''}</option>`).join('')}</select>
    ${runMateSelect(l)}
    <div class="rundl"><div class="hstrip">${Array.from({ length: DAY_HOURS }, (_, i) => `<i class="${i < runLeave ? 'wk' : i < runLeave + travelHours(runSite) / 2 ? 'tr' : i < DAY_HOURS - travelHours(runSite) / 2 ? 'st' : 'tr'}"></i>`).join('')}</div>
    <span>${streetH}h on the street · ${secs}s of daylight</span></div>
    <button data-act="run" ${secs < 30 ? 'disabled title="Not enough daylight left to make it worth the walk"' : ''}>Go ›</button></div>`;
}

function workshopHtml() {
  const builds = Object.values(BUILDINGS).map((b) => {
    const lvl = buildingLevel(b.id);
    const next = b.cost[lvl];
    return `<div class="build ${lvl ? 'built' : ''}">
      <div class="bh"><b>${b.name}</b>${lvl ? `<span class="lvl">${'●'.repeat(lvl)}${'○'.repeat(b.maxLevel - lvl)}</span>` : ''}</div>
      <div class="bd">${b.desc}</div>
      ${lvl < b.maxLevel ? `<div class="bc">${costHtml(next)} <button data-act="build" data-id="${b.id}" ${has(next) ? '' : 'disabled'}>${lvl ? 'Upgrade' : 'Build'}</button></div>` : ''}
    </div>`;
  }).join('');
  const recipes = RECIPES.filter((r) => buildingLevel(r.needs) >= (r.level ?? 1));
  const locked = RECIPES.filter((r) => buildingLevel(r.needs) < (r.level ?? 1));
  const crafters = living().filter((s) => s.job === 'craft' && canWork(s));
  return `<div class="ws">
    <div class="wscol">
      <h3>Queue <span class="dim">${crafters.length ? `${crafters.map(first).join(', ')} at the bench` : 'nobody assigned to the workshop'}</span></h3>
      ${G.craftQueue.length ? G.craftQueue.map((q, i) => {
        const r = RECIPES.find((x) => x.id === q.recipe)!;
        return `<div class="q"><span>${r.name}</span><div class="qbar"><div style="width:${(q.progress / r.work) * 100}%"></div></div><button data-act="unqueue" data-i="${i}" title="Cancel (refund)">×</button></div>`;
      }).join('') : '<div class="dim">The bench is idle.</div>'}
      <h3>Make</h3>
      ${recipes.map((r) => `<div class="recipe"><div><b>${r.name}</b> <span class="dim">${r.work} work</span><div class="bd">${r.desc}</div><div>${costHtml(r.cost)}</div></div><button data-act="queue" data-id="${r.id}" ${has(r.cost) ? '' : 'disabled'}>Queue</button></div>`).join('')}
      ${locked.length ? `<div class="dim small">Needs more machinery: ${locked.map((r) => r.name).join(', ')}.</div>` : ''}
    </div>
    <div class="wscol"><h3>Machinery</h3>${builds}</div>
  </div>`;
}

function wallHtml() {
  const f = G.fort;
  const repairers = living().filter((s) => s.job === 'repair' && canWork(s));
  return `<div class="wall">
    <div class="wallbar"><div data-tw="wall" style="width:${(f.hp / f.maxHp) * 100}%"></div><span>${Math.ceil(f.hp)} / ${f.maxHp}</span></div>
    <p>${f.hp / f.maxHp > 0.8 ? 'The wall is sound.' : f.hp / f.maxHp > 0.4 ? 'The wall is chewed. Planks split, the car door hangs.' : 'The wall is barely a wall.'} ${repairers.length ? `${repairers.map(first).join(' and ')} will work on it today.` : '<b>Nobody is assigned to repair it.</b>'} Timber: ${G.stores.wood}.</p>
    <ul class="fort">
      <li>Reinforcements: <b>${f.level}</b> <span class="dim">(Forge: reinforce the wall)</span></li>
      <li>Spike rows: <b>${f.spikes}</b> <span class="dim">— the dead hurt themselves at the wall</span></li>
      <li>Wire belts: <b>${f.wire}</b> <span class="dim">— slows them in the road</span></li>
      <li>Floodlights: <b>${f.lights}</b> <span class="dim">— better aim, less dark; burns fuel</span></li>
      <li>Nail turrets: <b>${f.turrets ?? 0}</b> <span class="dim">— auto-fire from the wall, eat scrap</span></li>
      <li>Nail-bomb traps: <b>${f.traps}</b> <span class="dim">— one use each, out in the road</span></li>
      <li>Firebombs: <b>${G.stores.molotov}</b> <span class="dim">— [F] or right-click at night</span></li>
    </ul>
  </div>`;
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

// Attachment slots for one gun: icon box + attach/detach dropdown per slot.
function modSlotsHtml(w: WeaponItem) {
  const slots = slotsFor(w.def);
  if (!slots.length) return '';
  const stock = G.modStock ?? [];
  return `<div class="stats" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${slots.map((slot) => {
    const cur = w.mods?.[slot];
    const md = cur ? MODS[cur.def] : null;
    const spare = stock.filter((m) => MODS[m.def]?.slot === slot && MODS[m.def].fits(w.def));
    const name = MOD_SLOTS.find((x) => x.id === slot)!.name;
    return `<span title="${esc(md ? `${md.name}: ${md.niche}` : `${name}: empty`)}" style="display:inline-flex;align-items:center;gap:4px;border:1px ${md ? 'solid #6a5d45' : 'dashed #4a4235'};padding:2px 4px;border-radius:3px">
      ${md ? `<img src="${spriteUrl(md.icon)}" alt="" style="width:34px;height:20px;object-fit:contain">` : `<i style="min-width:34px;white-space:nowrap;text-align:center;opacity:.5">${name}</i>`}
      <select data-act="mod" data-w="${w.uid}" data-slot="${slot}" style="max-width:150px;font-size:12px">
        <option value="">${md ? '— detach —' : '— empty —'}</option>
        ${cur ? `<option value="${cur.uid}" selected>${esc(md!.name)}${cur.cond < 1 ? ` ${Math.round(cur.cond * 100)}%` : ''}</option>` : ''}
        ${spare.map((m) => `<option value="${m.uid}">${esc(MODS[m.def].name)}${m.cond < 1 ? ` ${Math.round(m.cond * 100)}%` : ''}</option>`).join('')}
      </select></span>`;
  }).join('')}</div>`;
}

// What the attachments change, green when better and red when worse.
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
  return out.length ? `<div class="stats">mods: ${out.join(' · ')}</div>` : '';
}

function armoryHtml() {
  const stock = Object.values(CALIBERS).map((c) => {
    const items = c.types.map((t) => {
      const n = Math.floor(G.stores[t] ?? 0);
      return `<span class="cost ${n ? '' : 'short'}" title="${esc(AMMO_TYPES[t]!.desc)}"><img src="${spriteUrl(AMMO_TYPES[t]!.icon)}" alt="">${n} ${esc(ammoLabel(t).toLowerCase())}</span>`;
    }).join(' ');
    return `<div class="stats" style="padding:2px 0"><b style="color:var(--ink)">${esc(c.name)}</b> · ${items}</div>`;
  }).join('');
  const order = Object.keys(WEAPONS);
  const guns = [...G.weapons].sort((a, b) => order.indexOf(a.def) - order.indexOf(b.def));
  return `<div class="armory">
  <h3>Ammunition <span class="dim">by caliber · hover a type for what it does</span></h3>
  ${stock}
  <h3>On the bench <span class="dim">spare attachments · fit them in a gun's slots below</span></h3>
  <div class="stats">${(G.modStock ?? []).length ? (G.modStock ?? []).map((m) => `<span class="cost" title="${esc(MODS[m.def].niche)}"><img src="${spriteUrl(MODS[m.def].icon)}" alt="">${esc(MODS[m.def].name.toLowerCase())}${m.cond < 1 ? ` ${Math.round(m.cond * 100)}%` : ''}</span>`).join(' ') : 'Nothing spare. Craft attachments at the workbench and forge, or find them on runs.'}</div>
  <h3>Guns</h3>
  ${guns.map((w) => {
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
    return `<div class="gun"><img src="${spriteUrl(d.icon)}" alt=""><div><b>${w.name ? `"${esc(w.name)}" ` : ''}${d.name}</b> <span class="dim">${CLASS_NAMES[d.cls].toLowerCase()} · ${Math.round(w.cond * 100)}% · ${w.kills} kills · ${holder ? first(holder) : 'on the rack'}</span>
      ${d.niche ? `<div class="bd"><i>${esc(d.niche)}</i></div>` : ''}
      <div class="bd dim">${esc(d.desc)}</div>
      <div class="stats">dmg ${Math.round(p.dmg)}${p.pellets > 1 ? `×${p.pellets}` : ''} · ${+p.rof.toFixed(2)}/s · mag ${p.mag} · reload ${p.reloadPerRound ? `${p.reload.toFixed(2)}s/round` : `${+p.reload.toFixed(1)}s`}${p.pierce ? ` · pierce ${p.pierce}` : ''}${p.perShot !== 1 ? ` · ${p.perShot} ${ammoLabel(p.ammoRes).toLowerCase()}/shot` : ''}${tags.length ? ` · ${tags.join(' · ')}` : ''}</div>
      <div class="stats">${types.length > 1 ? `loaded with ${ammoSelect(w)}` : `ammo: ${esc(ammoLabel(p.ammoRes).toLowerCase())} (${Math.floor(G.stores[p.ammoRes!] ?? 0)})`}${p.ammoRes && AMMO_TYPES[p.ammoRes] ? ` <span class="dim">— ${esc(AMMO_TYPES[p.ammoRes]!.desc)}</span>` : ''}</div>
      ${modSlotsHtml(w)}${modDeltaHtml(w)}</div></div>`;
  }).join('')}
  <h3>Hand weapons <span class="dim">one per survivor, beside the gun · [V] / right-click on runs</span></h3>
  ${(G.melee ?? []).length ? (G.melee ?? []).map((k) => {
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
    return `<div class="gun"><img src="${spriteUrl(d.icon)}" alt=""><div><b>${esc(d.name)}</b> <span class="dim">melee · ${Math.round(k.cond * 100)}% · ${k.kills} kills · ${holder ? first(holder) : 'on the rack'}</span>
      <div class="bd"><i>${esc(d.niche)}</i></div>
      <div class="bd dim">${esc(d.desc)}</div>
      <div class="stats">dmg ${p.dmg} · reach ${p.reach}px · swing ${+(p.swingTime + p.recovery).toFixed(2)}s · shove ${p.knock} · stagger ${Math.round(p.stagger * 100)}% · overhead ×${p.crit} · stamina ${p.stamina}${tags.length ? ` · ${tags.join(' · ')}` : ''}</div></div></div>`;
  }).join('') : '<p class="dim">None. Hatchets and crowbars turn up at the hardware store and the mill; the forge can make a few.</p>'}
  <p class="dim">Weapons on the rack can be picked up on the wall at night with [Q] or number keys. Worn guns jam. On a daylight run, [T] switches bullet type. Blades and handles wear: sharpen and re-haft at the workbench.</p></div>`;
}

function chronicleHtml() {
  const byDay = new Map<number, string[]>();
  for (const e of G.chronicle) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(`<p class="ce ${e.kind}">${esc(e.text)}</p>`);
  }
  return `<div class="chron">${[...byDay.entries()].reverse().map(([d, l]) => `<h3>${dateLabel(d)} — the ${ordinal(d)} day</h3>${l.join('')}`).join('')}</div>`;
}

function townHtml() {
  const found = docsFound();
  const word = (v: number) => (v >= 40 ? 'friendly' : v >= 10 ? 'warm' : v > -10 ? 'unknown' : v > -40 ? 'cold' : 'hostile');
  return `<div class="town">
    <h3>Vessey</h3>
    ${FACTIONS.map((f) => `<div class="faction"><b>${f.name}</b> <span class="rep r${word(rep(f.id))}">${word(rep(f.id))}</span><div class="bd">${f.desc}</div></div>`).join('')}
    <h3>Papers <span class="dim">${found.length} of ${DOCS.length} found — searched from the ruins on runs</span></h3>
    ${found.length ? found.map((id) => DOCS.find((d) => d.id === id)!).map((d) => `<div class="doc"><b>${esc(d.title)}</b><p>${esc(d.text)}</p></div>`).join('') : '<p class="dim">Nothing yet. Lead runs and search doors, sheds and bodies.</p>'}
  </div>`;
}

function gravesHtml() {
  if (!G.graves.length) return '<p class="dim">No graves yet behind the house.</p>';
  return `<div class="graves">${G.graves.map((g) => `<div class="grave" data-act="detail" data-id="${g.id}">
    <div class="gn">${esc(displayName(g))}</div>
    <div class="gd">${g.age} · ${dateLabel(g.arrivedDay)} – ${dateLabel(g.dead!.day)}</div>
    <div class="gc">${esc(g.dead!.cause)}</div>
    <div class="ge">${esc(g.dead!.epitaph)}</div></div>`).join('')}</div>`;
}

const STORE_RES: Res[] = ['food', 'wood', 'scrap', 'parts', 'cloth', 'fuel', 'meds', 'liquor', 'molotov'];

// One compact chip for every round in the house, with a per-caliber breakdown on hover/focus.
function ammoChip() {
  const rows = Object.values(CALIBERS).map((c) => {
    const types = c.types.filter((t) => t !== 'scrap');
    const n = types.reduce((a, t) => a + Math.floor(G.stores[t] ?? 0), 0);
    return { c, types, n };
  }).filter((r) => r.types.length);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const keys = rows.flatMap((r) => r.types).join(' ');
  return `<span class="ammochip" tabindex="0" data-res-group="${keys}" title="Ammunition by caliber"><img src="${spriteUrl(RES_ICON.light)}" alt=""><span class="n">${total}</span><em>rounds ▾</em>
    <span class="ammopop" role="tooltip">${rows.map((r) => `<span class="${r.n ? '' : 'dim'}"><b>${esc(r.c.name)}</b> ${r.types.map((t) => `${Math.floor(G.stores[t] ?? 0)} ${esc((AMMO_TYPES[t]?.short ?? ammoLabel(t)).toLowerCase())}`).join(' · ')}</span>`).join('')}</span></span>`;
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
  root.innerHTML = `<div class="day ${duskArmed && stale.length ? 'armed' : ''}" style="background-image:linear-gradient(rgba(10,10,12,.72),rgba(10,10,12,.9)),url(${spriteUrl('bg_far')})">
    <header>
      <div class="date"><b>${dateLabel()}</b> · day ${G.day} · ${WEATHER_LABEL[G.weather] ?? G.weather} <span class="seed" title="This town's seed. Start a new game from it on the title screen to replay the same Vessey.">seed ${G.seed}${G.flags.daily ? ` · daily ${esc(String(G.flags.daily))}` : ''}</span></div>
      <div class="ice">${ice > 0 ? `River freezes in <b>${ice}</b> day${ice === 1 ? '' : 's'}` : ice === 0 ? '<b>The river is freezing tonight.</b>' : 'The river is ice.'}</div>
      <div class="hbtns"><button class="icon" data-act="help" aria-label="Help and controls" title="Help and controls">?</button><button class="icon" data-act="settings" aria-label="Settings" title="Settings">⚙</button></div>
      <div class="stores">${STORE_RES.map((r) => `<span data-res="${r}" title="${RES_LABEL[r]}${r === 'fuel' && heat ? ` · the stove burns ${heat} tonight` : ''}" class="${(r === 'food' && G.stores.food < eat * 2) || (r === 'fuel' && G.stores.fuel < heat) ? 'low' : ''}"><img src="${spriteUrl(RES_ICON[r])}" alt=""><span class="n">${Math.floor(G.stores[r] ?? 0)}</span><em>${RES_LABEL[r].replace(' ammo', '').toLowerCase()}${r === 'fuel' && heat ? ` <b class="heat">−${heat}/night</b>` : ''}</em></span>`).join('')}${ammoChip()}</div>
    </header>
    <main>
      <section class="people">
        <h2>The house <span class="dim">${living().length} living · eat ${eat}/day${G.flags.dog ? ` · and ${G.flags.dog}` : ''} · daylight ${clockLabel(0)}–${clockLabel(DAY_HOURS)}</span></h2>
        ${stale.length ? `<div class="carryover ${duskArmed ? 'flash' : ''}"><span>${stale.length === 1 ? `${esc(first(stale[0]))}'s job` : `${stale.length} jobs`} carried over from yesterday.</span><button class="mini" data-act="keepplans">Keep ${stale.length === 1 ? 'it' : 'them'}</button></div>` : ''}
        ${living().map(survivorCard).join('')}
      </section>
      <section class="center">
        <nav>${['workshop', 'wall', 'armory', 'town', 'chronicle', 'graves'].map((t) => `<button class="${tab === t ? 'on' : ''}" data-act="tab" data-id="${t}">${t}</button>`).join('')}</nav>
        <div class="tabbody">${tab === 'workshop' ? workshopHtml() : tab === 'wall' ? wallHtml() : tab === 'armory' ? armoryHtml() : tab === 'town' ? townHtml() : tab === 'chronicle' ? chronicleHtml() : gravesHtml()}</div>
      </section>
      <section class="report">
        <h2>This morning</h2>
        ${warnings().map((w) => `<p class="stamp" role="alert">${esc(w)}</p>`).join('')}
        <div class="lines">${report.length ? report.map((l) => `<p>${esc(l)}</p>`).join('') : '<p class="dim">A quiet morning.</p>'}</div>
        ${fc ? `<p class="forecast">${esc(fc)}</p>` : ''}
        ${calendarHtml()}
        ${threadsHtml()}
        <div class="weather">The Weather: <b>${persona().name}</b><br><span class="dim">Tonight feels like ${tp > 60 ? 'a long one' : tp > 30 ? 'a bad one' : 'any other night'}.${heat ? ` The stove will want ${heat} fuel.` : ''}</span></div>
        ${runHtml()}
        <button class="dusk" data-act="dusk">${duskArmed && stale.length ? 'Yesterday\'s jobs are marked. Go anyway ›' : 'Go to the wall at dusk ›'}<small>Enter</small></button>
      </section>
    </main>
    ${G.pendingEvent ? `<div class="overlay"><div class="modal event">
      <h2>${esc(G.pendingEvent.title)}</h2>
      <p>${nl(G.pendingEvent.text)}</p>
      <div class="choices">${G.pendingEvent.choices.map((c, i) => `<button data-act="choice" data-i="${i}">${esc(c.label)}${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('')}</div>
    </div></div>` : ''}
    ${sel ? `<div class="overlay" data-act="closedetail">${detailHtml(sel)}</div>` : ''}
    ${G.pendingEvent || sel ? '' : hintHtml()}
  </div>`;
  if (!G.pendingEvent && !sel) markHintTarget(root);
  juiceAfterRender(root);
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
    } else if (act === 'detail') detail = el.dataset.id!;
    else if (act === 'tab') tab = el.dataset.id!;
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
    if (G.phase !== 'day' || !duskKey || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!document.querySelector('.day') || document.querySelector('.overlay') || G.pendingEvent) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(SELECT|INPUT|TEXTAREA|BUTTON|A)$/.test(t.tagName)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const f = duskKey;
      duskKey = null;
      f();
    } else if (e.key === '?') {
      openHelp((document.getElementById('app') as HTMLElement | null) ?? document.body);
    }
  });
}
