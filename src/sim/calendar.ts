// The tide calendar, omens, and the smell of the house (design 06, #2).
// Reads the director's cycle without changing it: what the Weather will do
// is planned in director.ts; this file only tells the player what they can know.
import { G, R, log, add, dateLabel, ICE_DAY } from '../state';
import { persona, cyclePos, campWealth } from './director';
import { WEAPONS } from '../data/weapons';
import { living, canFight, addThought, first } from './survivors';
import { activeThreads } from './threads';
import { type Incident, lowestSpotlight } from './incident';

export type CalKind = 'night' | 'tide' | 'band' | 'crossing' | 'ice' | 'raiders' | 'horde' | 'tunnel' | 'unknown';
export interface CalDay {
  day: number;
  date: string;
  kind: CalKind;
  /** sure: scheduled or announced. likely: the Quiet's soft band. unknown: the Coin. */
  certainty: 'sure' | 'likely' | 'unknown';
  label: string;
  weather: string;
  deadlines: string[];
}

const FORCED_LABEL: Record<string, string> = {
  raiders: 'The County is coming up the road.',
  horde: 'The whole east bank is moving.',
  tunnel: 'Scraping under the wall.',
};

function outlook(day: number) {
  if (day === G.day) return G.weather;
  if (day >= 20) return 'snow or hard frost';
  if (day >= 13) return 'cold; fog some mornings';
  return 'rain or fog off the river';
}

function isPeak(day: number) {
  return cyclePos(day).peak && day >= 5;
}

/** What the house can reasonably know about the next n nights. */
export function calendar(n = 7): CalDay[] {
  const p = persona().id;
  const out: CalDay[] = [];
  const threads = activeThreads();
  for (let day = G.day; day < G.day + n; day++) {
    const deadlines = threads.filter((t) => t.deadlineDay === day).map((t) => t.title);
    const base = { day, date: dateLabel(day), weather: outlook(day), deadlines };
    const forced = day === G.day ? (G.flags.forceSpecial as string | undefined) : undefined;
    if (day === ICE_DAY) out.push({ ...base, kind: 'crossing', certainty: 'sure', label: 'The Crossing. The river freezes; they walk across.' });
    else if (forced && FORCED_LABEL[forced]) out.push({ ...base, kind: forced as CalKind, certainty: 'sure', label: FORCED_LABEL[forced] });
    else if (day > ICE_DAY) out.push({ ...base, kind: 'ice', certainty: 'sure', label: 'The river is ice. Every night is a bad night.' });
    else if (p === 'coin') out.push({ ...base, kind: 'unknown', certainty: 'unknown', label: 'The Coin keeps no calendar. Anything.' });
    else if (p === 'siege' && isPeak(day)) out.push({ ...base, kind: 'tide', certainty: 'sure', label: 'A tide night. The whole east bank moves.' });
    else if (p === 'quiet' && (isPeak(day) || isPeak(day - 1) || isPeak(day + 1)) && day >= 4) out.push({ ...base, kind: 'band', certainty: 'likely', label: 'A tide, sometime around here. The Quiet does not keep exact hours.' });
    else out.push({ ...base, kind: 'night', certainty: 'sure', label: 'An ordinary night, if there is such a thing.' });
  }
  return out;
}

/** Days until the next big night (tide/band/crossing), or -1. */
function nextBig(within = 4): { in: number; kind: CalKind } | null {
  const cal = calendar(within + 1);
  for (let i = 1; i < cal.length; i++) {
    const k = cal[i].kind;
    if (k === 'tide' || k === 'band' || k === 'crossing') return { in: i, kind: k };
  }
  return null;
}

// ---------- the smell of the house ----------
/** How much the house's stores, guns and lights draw the dead, and why. */
export function noiseOfHouse(): { level: number; pct: number; reasons: string[] } {
  const s = G.stores;
  const cw = campWealth();
  const wealthPts = Math.min(35, Math.sqrt(cw) * 0.7);
  const day = G.day;
  const base = 10 + 6 * Math.pow(day, 1.02);
  const pawns = living().filter(canFight).length * 3;
  const pct = Math.round((wealthPts / (base + pawns)) * 100);
  const guns = G.weapons.reduce((a, w) => a + 25 + (WEAPONS[w.def]?.dmg ?? 0) * 0.4, 0);
  const parts: { v: number; why: string }[] = [
    { v: s.food, why: `Cooking: ${Math.floor(s.food)} food in the pantry` },
    { v: s.fuel * 1.5 + G.fort.lights * 15, why: G.fort.lights ? `Diesel and ${G.fort.lights} floodlight${G.fort.lights === 1 ? '' : 's'}` : `Woodsmoke and ${Math.floor(s.fuel)} fuel` },
    { v: guns, why: `Gun oil: ${G.weapons.length} gun${G.weapons.length === 1 ? '' : 's'} in the house` },
    { v: G.buildings.reduce((a, b) => a + 30 * b.level, 0), why: 'The bench and the forge ringing all day' },
    { v: s.meds * 3 + s.parts * 2, why: 'Medicine and engine parts, the things worth stealing' },
    { v: (s.light + s.shell * 2 + s.rifle * 2) * 0.15, why: 'Ammunition stacked in the hall' },
    { v: (G.fort.maxHp - 300) * 0.2, why: 'A wall big enough to be seen from the river' },
  ];
  const reasons = parts.filter((x) => x.v > 8).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.why);
  return { level: Math.min(1, wealthPts / 35), pct, reasons };
}

// ---------- omens ----------
const OMENS = [
  { title: 'A red sky over the river', line: 'The sky went the colour of rust at dawn and stayed that way an hour. Old-timers say that means the river is moving.' },
  { title: 'Dogs on Route 9', line: 'The dogs out on Route 9 have not stopped barking since midnight. Something big is moving east of the river.' },
  { title: 'Sleepers facing the house', line: 'The Sleepers at the bottom of Ferry Road are all facing the house this morning. All of them. Nobody saw them turn.' },
  { title: 'The bell, faintly', line: 'Before light, faint, from across the water: the Trinity bell. Three strokes, then nothing.' },
  { title: 'Deer on the ice shelf', line: 'Deer standing on the shore ice at the landing, a dozen of them, not drinking. Looking east.' },
];
function omenFor(day: number) {
  return OMENS[(G.seed + day * 7) % OMENS.length];
}

/** Dawn: omen lines and the "tomorrow" teaser as a big night approaches. */
export function omenTick(): string[] {
  const out: string[] = [];
  const nb = nextBig(3);
  if (G.flags.teaserBy === 'omen') { delete G.flags.teaser; delete G.flags.teaserBy; }
  if (!nb) return out;
  if (nb.kind === 'crossing') {
    if (nb.in <= 2) {
      out.push(nb.in === 1 ? 'Shore ice at the landing reaches halfway across. Tomorrow it will reach the other side.' : 'The ferry cable is rimed white. Two more nights of open water, the radio says.');
      if (nb.in === 1 && !G.flags.teaser) { G.flags.teaser = 'The river closes'; G.flags.teaserBy = 'omen'; }
    }
    return out;
  }
  const om = omenFor(G.day + nb.in);
  if (nb.in === 3 && nb.kind === 'tide') out.push('On the radio, faint: "...east bank\'s restless. Give it three days..."');
  if (nb.in <= 2) {
    out.push(nb.kind === 'band' ? `${om.line} (A tide is near. The Quiet will not say when.)` : om.line);
    if (!G.flags.teaser) { G.flags.teaser = nb.in === 1 ? `${om.title}. Tomorrow, a tide.` : om.title; G.flags.teaserBy = 'omen'; }
  }
  return out;
}

/** The omen as a small decision, the day before a tide. */
export const OMEN_INCIDENT: Incident = {
  id: 'omen',
  cooldown: 5,
  weight: () => {
    const nb = nextBig(2);
    return nb && nb.kind !== 'crossing' && nb.in === 1 && persona().id !== 'coin' ? 3 : 0;
  },
  make: () => {
    const om = omenFor(G.day + 1);
    const s = lowestSpotlight(living().filter((x) => !x.child));
    return {
      id: 'omen', title: om.title,
      text: `${om.line}\n\n${s ? `${first(s)} says what everyone is thinking: ` : ''}"Tomorrow night. It's tomorrow night."`,
      data: { s: s?.id },
      choices: [
        { label: 'Everyone on the wall today', hint: '8 timber. +50 wall before the tide. A tiring day.', effect: 'wall' },
        { label: 'Rest. Eat. Be ready.', hint: 'Everyone rests a little; spirits steady.', effect: 'rest' },
        { label: 'It\'s just the sky', effect: 'none' },
      ],
    };
  },
  resolve: (c) => {
    if (c === 0) {
      if (G.stores.wood < 8) return 'We did not have the timber. We stood at the wall anyway and looked at the road.';
      add('wood', -8);
      G.fort.maxHp += 20; G.fort.hp = Math.min(G.fort.maxHp, G.fort.hp + 50);
      for (const s of living()) s.rest = Math.max(0, s.rest - 0.1);
      log('event', 'An omen at dawn. We spent the day on the wall.');
      return 'By dusk the wall was higher by a course of railroad ties. Our hands were raw.';
    }
    if (c === 1) {
      for (const s of living()) { s.rest = Math.min(1, s.rest + 0.15); addThought(s, { id: 'ready', label: 'We know it\'s coming', mood: 4, days: 2 }, 1); }
      return 'Somebody made a real breakfast. We ate it slowly, all of us, at the same table.';
    }
    if (R.chance(0.5)) for (const s of living()) addThought(s, { id: 'dread', label: 'The sky this morning', mood: -3, days: 2 }, 1);
    return 'Nobody mentioned it again. Everybody kept looking.';
  },
};

// ---------- the day-screen hook ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const GLYPH: Record<CalKind, string> = { night: '·', tide: '●', band: '◌', crossing: '❄', ice: '❄', raiders: '⚑', horde: '●', tunnel: '▼', unknown: '?' };
const BLOOD = '#b0302a';

/** Compact 7-day ledger strip plus the noise meter. */
export function calendarHtml(): string {
  const cal = calendar(7);
  const n = noiseOfHouse();
  const cell = (c: CalDay, i: number) => {
    const red = c.kind === 'tide' || c.kind === 'horde' || c.kind === 'raiders' || c.kind === 'band';
    const ice = c.kind === 'crossing' || c.kind === 'ice';
    const title = `${c.date}: ${c.label} Weather: ${c.weather}.${c.deadlines.length ? ` Deadline: ${c.deadlines.join(', ')}.` : ''}`;
    return `<div class="calday ${i === 0 ? 'today' : ''} ${red ? 'red' : ice ? 'ice' : ''} ${c.kind === 'crossing' ? 'crossing' : ''}" title="${esc(title)}">
      <div class="cd">${i === 0 ? 'tonight' : c.date.split(' ')[1]}</div>
      <div class="cg ${c.certainty === 'likely' ? 'likely' : ''}">${GLYPH[c.kind]}</div>
      <div class="cdl">${c.deadlines.length ? '◆' : ''}</div></div>`;
  };
  const today = cal[0];
  const key = cal.some((c) => c.kind === 'tide') ? `<span style="color:${BLOOD}">●</span> tide` : cal.some((c) => c.kind === 'band') ? `<span style="color:${BLOOD}">◌</span> tide, roughly` : cal.some((c) => c.kind === 'unknown') ? '? the Coin keeps no calendar' : '';
  return `<div class="calendar">
    <div class="calstrip">${cal.map(cell).join('')}</div>
    <div class="calkey">${esc(today.label)}${key ? ` · ${key}` : ''}${cal.some((c) => c.kind === 'crossing') ? ' · ❄ the Crossing' : ''}${cal.some((c) => c.deadlines.length) ? ' · ◆ thread deadline' : ''}</div>
    <div class="smell" title="${esc(n.reasons.join('; '))}">
      <div class="row"><span style="white-space:nowrap">Smell of the house</span>
        <div class="bar"><div style="width:${Math.round(n.level * 100)}%;background:${n.level > 0.7 ? BLOOD : '#c8a05a'}"></div></div>
        <b style="white-space:nowrap">+${n.pct}%</b></div>
      <div class="dim" style="font-size:.9em">${n.reasons.length ? esc(n.reasons.join('. ')) + '. Hoarding draws bigger nights.' : 'A lean house. Nothing much to smell.'}</div>
    </div></div>`;
}

