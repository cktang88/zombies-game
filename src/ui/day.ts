import type { Survivor, JobId, Res } from '../types';
import { G, dateLabel, ICE_DAY, has, pay, ordinal } from '../state';
import { spriteUrl } from '../assets';
import { WEAPONS } from '../data/weapons';
import { TRAITS } from '../data/traits';
import { SKILL_NAMES } from '../data/names';
import { SITES, BUILDINGS, RECIPES, RES_LABEL, RES_ICON } from '../data/world';
import {
  living, displayName, first, moodBreakdown, computeMood, moodWord, breakThresholds, pain, woundLabel, byId, canWork, canFight,
  isBitten, SKILLS, aimFactor,
} from '../sim/survivors';
import { buildingLevel, queueRecipe, WEATHER_LABEL } from '../sim/day';
import { persona, forecast, threatPoints } from '../sim/director';
import { sfx } from '../audio';

const JOBS: { id: JobId; label: string; hint: string }[] = [
  { id: 'repair', label: 'Repair the wall', hint: 'Building. Uses timber.' },
  { id: 'scavenge', label: 'Scavenge', hint: 'Scavenging. Risky.' },
  { id: 'craft', label: 'Workshop', hint: 'Crafting. Works the queue.' },
  { id: 'farm', label: 'Food', hint: 'Farming. Snares, cold frames.' },
  { id: 'doctor', label: 'Tend wounded', hint: 'Medicine.' },
  { id: 'radio', label: 'Work the radio', hint: 'Social. Needs a radio mast.' },
  { id: 'rest', label: 'Rest', hint: 'Recover.' },
];

let tab = 'workshop';
let detail: string | null = null;

export interface DayHandlers {
  onDusk: () => void;
  onChoice: (i: number) => void;
  rerender: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');

function costHtml(cost: Partial<Record<Res, number>>) {
  const parts = Object.entries(cost).map(([k, v]) => {
    const ok = G.stores[k as Res] >= (v ?? 0);
    return `<span class="cost ${ok ? '' : 'short'}"><img src="${spriteUrl(RES_ICON[k as Res])}" alt="">${v} ${RES_LABEL[k as Res].toLowerCase()}</span>`;
  });
  return parts.length ? parts.join(' ') : '<span class="cost">free</span>';
}

function moodBar(s: Survivor) {
  const th = breakThresholds(s);
  return `<div class="moodbar" title="${esc(moodWord(s.mood))}">
    <div class="fill" style="width:${s.mood}%;background:${s.mood > 50 ? '#8a9a5b' : s.mood > th.minor ? '#b08a3c' : '#a8322a'}"></div>
    <i style="left:${th.minor}%"></i><i style="left:${th.major}%"></i><i style="left:${th.extreme}%"></i>
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
        <select data-act="job" data-id="${s.id}" ${disabled ? 'disabled' : ''}>
          ${JOBS.map((j) => `<option value="${j.id}" ${s.job === j.id ? 'selected' : ''}>${j.label}</option>`).join('')}
        </select>
        ${s.job === 'scavenge' ? `<select data-act="site" data-id="${s.id}">${sites.map((x) => {
          const st = (G.flags[`stock_${x.id}`] as number) ?? x.stock;
          return `<option value="${x.id}" ${site === x.id ? 'selected' : ''}>${x.name}${st <= 0 ? ' (picked clean)' : ''} — ${x.risk < 0.2 ? 'low' : x.risk < 0.4 ? 'some' : x.risk < 0.6 ? 'high' : 'grave'} risk</option>`;
        }).join('')}</select>` : ''}
      </div>
      <div class="row small">
        <select data-act="weapon" data-id="${s.id}">
          <option value="">— unarmed —</option>
          ${freeWeapons.map((x) => `<option value="${x.uid}" ${x.uid === s.weapon ? 'selected' : ''}>${esc(x.name ? `"${x.name}"` : WEAPONS[x.def].name)} (${Math.round(x.cond * 100)}%)</option>`).join('')}
        </select>
        <span class="aim" title="Aim on the wall">aim ${Math.round(aimFactor(s) * 100)}</span>
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
      <li>Nail-bomb traps: <b>${f.traps}</b> <span class="dim">— one use each, out in the road</span></li>
      <li>Firebombs: <b>${G.stores.molotov}</b> <span class="dim">— [F] or right-click at night</span></li>
    </ul>
  </div>`;
}

function armoryHtml() {
  return `<div class="armory">${G.weapons.map((w) => {
    const d = WEAPONS[w.def];
    const holder = living().find((s) => s.weapon === w.uid);
    return `<div class="gun"><img src="${spriteUrl(d.icon)}" alt=""><div><b>${w.name ? `"${esc(w.name)}" ` : ''}${d.name}</b> <span class="dim">${Math.round(w.cond * 100)}% · ${w.kills} kills · ${holder ? first(holder) : 'on the rack'}</span>
      <div class="bd">${d.desc}</div>
      <div class="stats">dmg ${d.dmg}${d.pellets > 1 ? `×${d.pellets}` : ''} · ${d.rof}/s · mag ${d.mag} · reload ${d.reload}s · ${d.ammo ? RES_LABEL[d.ammo as Res].toLowerCase() : '—'}${d.pierce ? ` · pierce ${d.pierce}` : ''}</div></div></div>`;
  }).join('')}
  <p class="dim">Weapons on the rack can be picked up on the wall at night with [Q] or number keys. Worn guns jam.</p></div>`;
}

function chronicleHtml() {
  const byDay = new Map<number, string[]>();
  for (const e of G.chronicle) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(`<p class="ce ${e.kind}">${esc(e.text)}</p>`);
  }
  return `<div class="chron">${[...byDay.entries()].reverse().map(([d, l]) => `<h3>${dateLabel(d)} — the ${ordinal(d)} day</h3>${l.join('')}`).join('')}</div>`;
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
      <div class="stores">${res.map((r) => `<span title="${RES_LABEL[r]}" class="${r === 'food' && G.stores.food < eat * 2 ? 'low' : ''}"><img src="${spriteUrl(RES_ICON[r])}" alt="">${Math.floor(G.stores[r])}<em>${RES_LABEL[r].replace(' ammo', '').toLowerCase()}</em></span>`).join('')}</div>
    </header>
    <main>
      <section class="people">
        <h2>The house <span class="dim">${living().length} living · eat ${eat}/day${G.flags.dog ? ` · and ${G.flags.dog}` : ''}</span></h2>
        ${living().map(survivorCard).join('')}
      </section>
      <section class="center">
        <nav>${['workshop', 'wall', 'armory', 'chronicle', 'graves'].map((t) => `<button class="${tab === t ? 'on' : ''}" data-act="tab" data-id="${t}">${t}</button>`).join('')}</nav>
        <div class="tabbody">${tab === 'workshop' ? workshopHtml() : tab === 'wall' ? wallHtml() : tab === 'armory' ? armoryHtml() : tab === 'chronicle' ? chronicleHtml() : gravesHtml()}</div>
      </section>
      <section class="report">
        <h2>This morning</h2>
        <div class="lines">${report.length ? report.map((l) => `<p>${esc(l)}</p>`).join('') : '<p class="dim">A quiet morning.</p>'}</div>
        ${fc ? `<p class="forecast">${esc(fc)}</p>` : ''}
        <div class="weather">The Weather: <b>${persona().name}</b><br><span class="dim">Tonight feels like ${threatPoints() > 60 ? 'a long one' : threatPoints() > 30 ? 'a bad one' : 'any other night'}.</span></div>
        <button class="dusk" data-act="dusk">Go to the wall at dusk ›</button>
      </section>
    </main>
    ${G.pendingEvent ? `<div class="overlay"><div class="modal event">
      <h2>${esc(G.pendingEvent.title)}</h2>
      <p>${nl(G.pendingEvent.text)}</p>
      <div class="choices">${G.pendingEvent.choices.map((c, i) => `<button data-act="choice" data-i="${i}">${esc(c.label)}${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('')}</div>
    </div></div>` : ''}
    ${sel ? `<div class="overlay" data-act="closedetail">${detailHtml(sel)}</div>` : ''}
  </div>`;

  root.onchange = (e) => {
    const t = e.target as HTMLSelectElement;
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
    } else if (act === 'dusk') {
      h.onDusk();
      return;
    }
    sfx.ui();
    h.rerender();
  };
}
