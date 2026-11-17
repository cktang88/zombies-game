import type { Survivor, JobId, Res, WeaponItem, ModSlot } from '../types';
import { G, dateLabel, ICE_DAY, has, pay, ordinal, docsFound, rep } from '../state';
import { DOCS, FACTIONS } from '../data/lore';
import { spriteUrl } from '../assets';
import { WEAPONS, CALIBERS, AMMO_TYPES, MODS, MOD_SLOTS, fireProfile, ammoTypesFor, ammoLabel, selectedAmmo, slotsFor, attachMod, detachMod, type FireProfile } from '../data/weapons';
import { TRAITS } from '../data/traits';
import { SKILL_NAMES } from '../data/names';
import { SITES, BUILDINGS, RECIPES, RES_LABEL, RES_ICON } from '../data/world';
import {
  living, displayName, first, moodBreakdown, computeMood, moodWord, breakThresholds, pain, woundLabel, byId, canWork, canFight,
  isBitten, SKILLS, aimFactor, skillOf, workMult,
} from '../sim/survivors';
import { buildingLevel, queueRecipe, WEATHER_LABEL } from '../sim/day';
import { persona, forecast, threatPoints } from '../sim/director';
import { sfx, music } from '../audio';
import { openSettings } from './settings';
import { openHelp } from './help';
import { hintHtml, markHintTarget, nextHint, skipHints } from './onboarding';
import { threadsHtml } from '../sim/threads';

const JOBS: { id: JobId; label: string; hint: string }[] = [
  { id: 'repair', label: 'Repair the wall', hint: 'Building. Uses timber.' },
  { id: 'scavenge', label: 'Scavenge', hint: 'Scavenging. Risky.' },
  { id: 'craft', label: 'Workshop', hint: 'Crafting. Works the queue.' },
  { id: 'farm', label: 'Food', hint: 'Farming. Snares, cold frames.' },
  { id: 'doctor', label: 'Tend wounded', hint: 'Medicine.' },
  { id: 'radio', label: 'Work the radio', hint: 'Social. Needs a radio mast.' },
  { id: 'rest', label: 'Rest', hint: 'Recover.' },
];

// What a job is likely to yield today for this survivor (mirrors sim/day.ts resolveDayWork).
function jobOutlook(s: Survivor, j: JobId): string {
  const m = workMult(s);
  switch (j) {
    case 'repair': {
      const room = Math.max(0, G.fort.maxHp - G.fort.hp);
      return room <= 0 ? 'wall is whole' : `+${Math.min(room, Math.round((40 + skillOf(s, 'building') * 9) * m))} wall`;
    }
    case 'craft':
      return G.craftQueue.length ? `${Math.round((3 + skillOf(s, 'crafting') * 0.9) * m)} work on the queue` : 'queue is empty';
    case 'farm': {
      const cold = G.weather === 'cold' || G.weather === 'snow' ? 0.6 : 1;
      return `~${Math.round((1.5 + skillOf(s, 'farming') * 0.45 + buildingLevel('garden') * 2.2) * m * cold)} food`;
    }
    case 'doctor': {
      const hurt = living().reduce((a, p) => a + p.wounds.filter((w) => !w.tended && !w.hidden).length, 0);
      return hurt ? `tends ${Math.min(hurt, Math.round((2 + skillOf(s, 'medicine')) * m))} of ${hurt} wounds` : 'nobody needs tending';
    }
    case 'scavenge':
      return `skill ${s.skills.scavenging}/10`;
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
  const ammoNeed = new Map<Res, number>();
  for (const s of living()) {
    const it = G.weapons.find((x) => x.uid === s.weapon);
    const a = it ? WEAPONS[it.def]?.ammo : null;
    if (a) ammoNeed.set(a, (ammoNeed.get(a) ?? 0) + 1);
  }
  for (const [a, n] of ammoNeed) {
    const have = Math.floor(G.stores[a] ?? 0);
    if (have < 12 * n) w.push(`${have ? `Only ${have}` : 'No'} ${(RES_LABEL[a] ?? a).toLowerCase()} for ${n === 1 ? 'one gun' : `${n} guns`} on the wall.`);
  }
  if (G.fort.hp / G.fort.maxHp < 0.4 && !living().some((s) => s.job === 'repair' && canWork(s))) w.push('The wall is barely standing and nobody is repairing it.');
  if (G.craftQueue.length && !living().some((s) => s.job === 'craft' && canWork(s))) w.push('Work is queued but nobody is at the bench.');
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
    <div class="fill" style="width:${s.mood}%;background:${s.mood > 50 ? '#8a9a5b' : s.mood > th.minor ? '#b08a3c' : '#a8322a'}"></div>
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

function survivorCard(s: Survivor) {
  computeMood(s);
  const w = G.weapons.find((x) => x.uid === s.weapon);
  const site = (G.flags[`site_${s.id}`] as string) ?? 'route9';
  const sites = SITES.filter((x) => x.minDay <= G.day);
  const freeWeapons = G.weapons.filter((x) => x.uid === s.weapon || !living().some((o) => o.weapon === x.uid));
  const disabled = !canWork(s);
  return `<div class="card surv" data-id="${s.id}">
    <img class="portrait" src="${spriteUrl(s.sprite)}" alt="">
    <div class="body">
      <div class="name"><a data-act="detail" data-id="${s.id}">${esc(displayName(s))}</a> <span class="age">${s.age}</span></div>
      <div class="tags">${statusTags(s)}</div>
      ${moodBar(s)}
      <div class="row">
        <select data-act="job" data-id="${s.id}" ${disabled ? 'disabled' : ''} aria-label="Job for ${esc(first(s))}">
          ${JOBS.map((j) => `<option value="${j.id}" ${s.job === j.id ? 'selected' : ''}>${j.label} — ${jobOutlook(s, j.id)}</option>`).join('')}
        </select>
        ${s.job === 'scavenge' ? `<select data-act="site" data-id="${s.id}" aria-label="Where ${esc(first(s))} scavenges">${sites.map((x) => {
          const st = (G.flags[`stock_${x.id}`] as number) ?? x.stock;
          return `<option value="${x.id}" ${site === x.id ? 'selected' : ''}>${x.name}${st <= 0 ? ' (picked clean)' : ''} — ${x.risk < 0.2 ? 'low' : x.risk < 0.4 ? 'some' : x.risk < 0.6 ? 'high' : 'grave'} risk</option>`;
        }).join('')}</select>` : ''}
      </div>
      ${disabled ? '' : `<div class="jobhint">${esc(JOBS.find((j) => j.id === s.job)?.hint ?? '')}</div>`}
      <div class="row small">
        <select data-act="weapon" data-id="${s.id}">
          <option value="">— unarmed —</option>
          ${freeWeapons.map((x) => `<option value="${x.uid}" ${x.uid === s.weapon ? 'selected' : ''}>${esc(x.name ? `"${x.name}"` : WEAPONS[x.def].name)} (${Math.round(x.cond * 100)}%)</option>`).join('')}
        </select>
        ${ammoSelect(G.weapons.find((x) => x.uid === s.weapon), true)}
        <span class="aim" title="Aim on the wall">aim ${Math.round(aimFactor(s) * 100)}</span>
        ${s.armor ? `<button class="mini" data-act="unarmor" data-id="${s.id}" title="Mill-plate vest: wounds 30% lighter. Take it off.">vest ✓</button>` : (G.flags.armorStock as number) > 0 ? `<button class="mini" data-act="armor" data-id="${s.id}" title="Give a mill-plate vest">+ vest</button>` : ''}
        ${canFight(s) ? '' : '<span class="tag bad">won\'t stand the wall</span>'}
      </div>
    </div>
  </div>`;
  void w;
}

function detailHtml(s: Survivor) {
  computeMood(s);
  const parts = moodBreakdown(s);
  const rels = Object.entries(s.rel)
    .map(([id, r]) => ({ o: byId(id), r }))
    .filter((x) => x.o)
    .sort((a, b) => Math.abs(b.r.opinion) - Math.abs(a.r.opinion) + (b.r.bond ? 100 : 0) - (a.r.bond ? 100 : 0))
    .slice(0, 5);
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
        <h3>Skills</h3>
        ${SKILLS.map((k) => `<div class="skill"><span>${SKILL_NAMES[k]}${s.passions.includes(k) ? ' 🔥' : ''}</span><div class="pips">${'■'.repeat(s.skills[k])}<span>${'■'.repeat(10 - s.skills[k])}</span></div></div>`).join('')}
      </div>
      <div>
        <h3>Mood ${Math.round(s.mood)} — ${moodWord(s.mood)}</h3>
        ${parts.map((p) => `<div class="mp ${p.v >= 0 ? 'pos' : 'neg'}"><span>${esc(p.label)}</span><b>${p.v > 0 ? '+' : ''}${p.v}</b></div>`).join('')}
        <h3>Body</h3>
        ${s.wounds.filter((w) => !w.hidden).map((w) => `<div class="wound">${esc(woundLabel(w))} · ${Math.round(w.severity * 100)}%${w.tended ? ' · tended' : ''}${w.bleeding ? ' · <b>bleeding</b>' : ''}${w.infected && w.kind !== 'bite' ? ' · <b>infected</b>' : ''}${w.kind === 'bite' && w.infected ? ' · <b class="bite">the Turn</b>' : ''}</div>`).join('') || '<div class="dim">Whole, for now.</div>'}
        ${s.scars.map((sc) => `<div class="wound scar">${esc(sc.label)}</div>`).join('')}
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

function runHtml() {
  const l = living().find((s) => s.isLeader);
  if (!l) return '';
  if (G.flags.ranToday === G.day) return '<div class="run dim">You have already been out today.</div>';
  if (!canWork(l)) return `<div class="run dim">${esc(first(l))} is in no shape to go out.</div>`;
  const sites = SITES.filter((x) => x.minDay <= G.day);
  return `<div class="run"><h3>Lead a run yourself</h3>
    <p class="dim">${esc(first(l))} goes alone, on foot, in daylight. More loot than a scavenging job, and you choose the risks. ${esc(first(l))} will do no other work today.</p>
    <select data-act="runsite">${sites.map((x) => `<option value="${x.id}">${x.name} — ${x.risk < 0.2 ? 'low' : x.risk < 0.4 ? 'some' : x.risk < 0.6 ? 'high' : 'grave'} risk</option>`).join('')}</select>
    <button data-act="run">Go ›</button></div>`;
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
    <div class="wallbar"><div style="width:${(f.hp / f.maxHp) * 100}%"></div><span>${Math.ceil(f.hp)} / ${f.maxHp}</span></div>
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
    if (p.recoverable > 0) tags.push(`${Math.round(p.recoverable * 100)}% ammo recovered`);
    if (p.noise <= 0.6) tags.push('quiet');
    else if (p.noise >= 2.5) tags.push('loud');
    if (p.jam >= 0.02) tags.push(`jams ${Math.round(p.jam * 100)}%`);
    const types = ammoTypesFor(w.def);
    return `<div class="gun"><img src="${spriteUrl(d.icon)}" alt=""><div><b>${w.name ? `"${esc(w.name)}" ` : ''}${d.name}</b> <span class="dim">${Math.round(w.cond * 100)}% · ${w.kills} kills · ${holder ? first(holder) : 'on the rack'}</span>
      ${d.niche ? `<div class="bd"><i>${esc(d.niche)}</i></div>` : ''}
      <div class="bd dim">${esc(d.desc)}</div>
      <div class="stats">dmg ${Math.round(p.dmg)}${p.pellets > 1 ? `×${p.pellets}` : ''} · ${+p.rof.toFixed(2)}/s · mag ${p.mag} · reload ${p.reloadPerRound ? `${p.reload.toFixed(2)}s/round` : `${+p.reload.toFixed(1)}s`}${p.pierce ? ` · pierce ${p.pierce}` : ''}${p.perShot !== 1 ? ` · ${p.perShot} ${ammoLabel(p.ammoRes).toLowerCase()}/shot` : ''}${tags.length ? ` · ${tags.join(' · ')}` : ''}</div>
      <div class="stats">${types.length > 1 ? `loaded with ${ammoSelect(w)}` : `ammo: ${esc(ammoLabel(p.ammoRes).toLowerCase())} (${Math.floor(G.stores[p.ammoRes!] ?? 0)})`}${p.ammoRes && AMMO_TYPES[p.ammoRes] ? ` <span class="dim">— ${esc(AMMO_TYPES[p.ammoRes]!.desc)}</span>` : ''}</div>
      ${modSlotsHtml(w)}${modDeltaHtml(w)}</div></div>`;
  }).join('')}
  <p class="dim">Weapons on the rack can be picked up on the wall at night with [Q] or number keys. Worn guns jam. On a daylight run, [T] switches bullet type.</p></div>`;
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

export function renderDay(root: HTMLElement, h: DayHandlers, report: string[]) {
  const ice = ICE_DAY - G.day;
  const fc = forecast();
  const res: Res[] = ['food', 'wood', 'scrap', 'parts', 'cloth', 'fuel', 'meds', 'light', 'shell', 'rifle', 'liquor', 'molotov'];
  const eat = living().length;
  const sel = detail ? byId(detail) : null;
  root.innerHTML = `<div class="day" style="background-image:linear-gradient(rgba(10,10,12,.72),rgba(10,10,12,.9)),url(${spriteUrl('bg_far')})">
    <header>
      <div class="date"><b>${dateLabel()}</b> · day ${G.day} · ${WEATHER_LABEL[G.weather] ?? G.weather}</div>
      <div class="ice">${ice > 0 ? `River freezes in <b>${ice}</b> day${ice === 1 ? '' : 's'}` : ice === 0 ? '<b>The river is freezing tonight.</b>' : 'The river is ice.'}</div>
      <div class="hbtns"><button class="icon" data-act="help" aria-label="Help and controls" title="Help and controls">?</button><button class="icon" data-act="settings" aria-label="Settings" title="Settings">⚙</button></div>
      <div class="stores">${res.map((r) => `<span title="${RES_LABEL[r]}" class="${r === 'food' && G.stores.food < eat * 2 ? 'low' : ''}"><img src="${spriteUrl(RES_ICON[r])}" alt="">${Math.floor(G.stores[r])}<em>${RES_LABEL[r].replace(' ammo', '').toLowerCase()}</em></span>`).join('')}</div>
    </header>
    <main>
      <section class="people">
        <h2>The house <span class="dim">${living().length} living · eat ${eat}/day${G.flags.dog ? ` · and ${G.flags.dog}` : ''}</span></h2>
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
        ${threadsHtml()}
        <div class="weather">The Weather: <b>${persona().name}</b><br><span class="dim">Tonight feels like ${threatPoints() > 60 ? 'a long one' : threatPoints() > 30 ? 'a bad one' : 'any other night'}.</span></div>
        ${runHtml()}
        <button class="dusk" data-act="dusk">Go to the wall at dusk ›<small>Enter</small></button>
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
  duskKey = h.onDusk;
  installKeys();

  root.onchange = (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.act === 'runsite') return;
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
    if (t.dataset.act === 'job') s.job = t.value as JobId;
    if (t.dataset.act === 'site') G.flags[`site_${s.id}`] = t.value;
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
        for (const [k, v] of Object.entries(r.cost)) G.stores[k as Res] += v ?? 0;
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
      music('off');
      const sel = root.querySelector('select[data-act=runsite]') as HTMLSelectElement;
      h.onRun(sel.value);
      return;
    } else if (act === 'dusk') {
      h.onDusk();
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
