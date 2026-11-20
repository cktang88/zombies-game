// The house as a place: the default day screen. A side-view cut-away of the house on Ferry Road and its
// yard (the player: "why does it feel so dashboard-like ... hover a sprite, click it, it zooms in and has a
// little detail UI"). Every system the ledger shows is a station in the scene; the ledger is still one key
// away (L) for whoever wants the tables.
//
//   Scene     1600×720 scene units (the bg art's size), scaled to fit; a CSS transform is the camera.
//   Stations  hotspots (buttons) over the art: hover glows and names it with a one-line summary, click
//             zooms the camera (~300 ms) and opens a panel beside it with the ledger's own HTML.
//   People    each survivor stands at their job's station as an idling rig (src/anim); hover for a tag,
//             click for their card, drag onto a station (or click a station while one is picked) to
//             give that job.
//   Attention yellow dots from the Today list (today.ts dotKeys) float over stations and people; the
//             Today list itself is a note pinned in the corner; a to-do zooms to its station.
// Panels are rendered in screen space (crisp text); only the art and hotspots sit in the scaled scene.
// day.ts renders this in place of its three columns and hands it its panel builders (HouseCtx), so the
// panels' own data-act clicks keep going through day.ts's handler.
import type { Survivor, JobId, Res } from '../types';
import { G, docsFound } from '../state';
import { spriteUrl } from '../assets';
import { portraitImg } from './portrait';
import { living, first, displayName, canWork, byId, computeMood, moodWord, pain, isBitten } from '../sim/survivors';
import { buildingLevel, onRunToday, ranToday, planConfirmed, confirmPlan, dailyFood, halfRations, heatNeed, breakChance, counselPlan } from '../sim/day';
import { calendar } from '../sim/calendar';
import { wallLine, rackGuns } from '../sim/readiness';
import { RECIPES, SITES, RES_LABEL } from '../data/world';
import { createRig, SPRITE_RIGS, type Rig } from '../anim';
import { sfx } from '../audio';
import { is, keyLabel, keyOf } from './keys';
import { isOpen, markSeen, revealNote, runOpen, JOB_REVEAL, type RevealId } from './today';
import { tip, ico, sec, chip } from './kit';
import './house.css';

export interface HouseCtx {
  dots: Set<string>;
  /** the Today list (today.ts todayHtml) */
  today: string;
  report: string[];
  forecast: string;
  /** the calendar block as the ledger shows it ('' before it opens) */
  calendar: string;
  /** tonight's size as the calendar says it ('BIG', 'bad', 'light') */
  tonightSize: string;
  threads: string;
  keep: string;
  dusk: string;
  survivorCard: (s: Survivor, dots: Set<string>) => string;
  statusTags: (s: Survivor) => string;
  moodChip: (s: Survivor) => string;
  jobOutlook: (s: Survivor, j: JobId) => string;
  jobs: { id: JobId; label: string; hint: string }[];
  siteButton: (s: Survivor) => string;
  costHtml: (cost: Partial<Record<Res, number>>) => string;
  workshop: () => string;
  wall: () => string;
  armory: () => string;
  town: () => string;
  chronicle: () => string;
  graves: () => string;
  run: () => string;
  openSitePick: (id: string) => void;
  rerender: () => void;
}

const W = 1600, H = 720;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------- view mode
const VIEW_KEY = 'vessey-day-view';
let viewMem: 'house' | 'ledger' | null = null;
export function houseView(): boolean {
  if (viewMem === null) { try { viewMem = localStorage.getItem(VIEW_KEY) === 'ledger' ? 'ledger' : 'house'; } catch { viewMem = 'house'; } }
  return viewMem === 'house';
}
function setView(v: 'house' | 'ledger') {
  viewMem = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ }
}
/** The header button that flips between the house and the ledger. */
export function viewButton(): string {
  const k = esc(keyLabel(keyOf('day.view')));
  return houseView()
    ? `<button class="icon hv-viewbtn" data-hs-act="view" aria-label="Ledger view (${k})"${tip(`<b>Ledger view</b> · ${k}<br>Everything in three columns of tables.`)}>☰</button>`
    : `<button class="icon hv-viewbtn" data-hs-act="view" aria-label="House view (${k})"${tip(`<b>House view</b> · ${k}<br>The house and the yard: click a place or a person.`)}>⌂</button>`;
}

// ---------------------------------------------------------------- stations
type StationId = 'infirmary' | 'bunks' | 'radio' | 'kitchen' | 'rack' | 'table' | 'calendar' | 'bench' | 'board' | 'wall' | 'gate' | 'graves';
interface Station {
  id: StationId; name: string; icon: string;
  /** hotspot rect in scene units */
  x: number; y: number; w: number; h: number;
  /** where people stand: feet y, and the x range they spread over */
  feet: number; sx: [number, number];
  job?: JobId;
  /** the ledger tab / reveal it stands for (dots, reveal notes, markSeen) */
  tab?: string; dot?: string; reveal?: RevealId;
  wide?: boolean;
}
const UP = 428, DOWN = 612, YARD = 640;
const STATIONS: Station[] = [
  { id: 'infirmary', name: 'Infirmary', icon: 'job_doctor', x: 198, y: 262, w: 264, h: 166, feet: UP, sx: [250, 430], job: 'doctor' },
  { id: 'bunks', name: 'Bunks', icon: 'job_rest', x: 468, y: 262, w: 190, h: 166, feet: UP, sx: [490, 560], job: 'rest' },
  { id: 'radio', name: 'Radio', icon: 'job_radio', x: 666, y: 262, w: 226, h: 166, feet: UP, sx: [690, 770], job: 'radio', reveal: 'jobs' },
  { id: 'kitchen', name: 'Kitchen', icon: 'food', x: 198, y: 446, w: 248, h: 166, feet: DOWN, sx: [320, 420], job: 'farm' },
  { id: 'rack', name: 'Gun rack', icon: 'pistol', x: 454, y: 446, w: 136, h: 166, feet: DOWN, sx: [560, 585], job: 'drill', tab: 'armory', dot: 'tab:armory', reveal: 'armory', wide: true },
  { id: 'table', name: 'Table', icon: 'job_counsel', x: 596, y: 446, w: 150, h: 166, feet: DOWN, sx: [620, 720], job: 'counsel', tab: 'chronicle', dot: 'tab:chronicle', reveal: 'jobs' },
  { id: 'calendar', name: 'Calendar', icon: 'st_danger', x: 756, y: 452, w: 132, h: 110, feet: DOWN, sx: [800, 860], dot: 'calendar', reveal: 'calendar' },
  { id: 'bench', name: 'Workbench', icon: 'job_craft', x: 928, y: 440, w: 240, h: 200, feet: YARD, sx: [1010, 1130], job: 'craft', tab: 'workshop', dot: 'tab:workshop', reveal: 'workshop', wide: true },
  { id: 'board', name: 'Noticeboard', icon: 'st_faction', x: 1168, y: 500, w: 86, h: 140, feet: YARD, sx: [1200, 1220], tab: 'town', dot: 'tab:town', reveal: 'town', wide: true },
  { id: 'wall', name: 'The wall', icon: 'st_wall', x: 1254, y: 400, w: 182, h: 242, feet: YARD, sx: [1270, 1330], job: 'repair', tab: 'wall', dot: 'tab:wall' },
  { id: 'gate', name: 'The gate', icon: 'job_scavenge', x: 1440, y: 430, w: 160, h: 212, feet: YARD, sx: [1470, 1560], job: 'scavenge', dot: 'run' },
  { id: 'graves', name: 'Graves', icon: 'st_dead', x: 24, y: 520, w: 150, h: 122, feet: YARD, sx: [90, 120], tab: 'graves', dot: 'tab:graves', reveal: 'graves' },
];
/** where a station's name plaque sits, from the top of its hotspot (inside rooms: the top-left corner, clear of heads; 0 = above it) */
const LABEL_DY: Record<StationId, number> = { infirmary: 8, bunks: 8, radio: 8, kitchen: 8, rack: 8, table: 8, calendar: 0, bench: 0, board: 0, wall: 0, gate: 0, graves: 0 };
const ST = (id: string) => STATIONS.find((s) => s.id === id);
const JOB_STATION: Record<string, StationId> = Object.fromEntries(STATIONS.filter((s) => s.job).map((s) => [s.job!, s.id]));
const TAB_STATION: Record<string, StationId> = { workshop: 'bench', wall: 'wall', armory: 'rack', town: 'board', chronicle: 'table', graves: 'graves' };

function stationOpen(st: Station): boolean {
  if (st.id === 'graves') return G.graves.length > 0;
  if (st.id === 'table') return isOpen('jobs') || isOpen('chronicle');
  return !st.reveal || isOpen(st.reveal);
}
/** Can this job be given (it may wait for a reveal)? */
const jobOpen = (j: JobId) => !JOB_REVEAL[j] || isOpen(JOB_REVEAL[j]!);

// ---------------------------------------------------------------- focus and camera
type Focus = { kind: 'st'; id: StationId } | { kind: 'sv'; id: string } | null;
let focus: Focus = null;
let noteOpen: boolean | null = null; // first render: open, except on a phone
let lastCam: Cam | null = null;
let lastFocusKey = '';
const scrollMem = new Map<string, number>();
let ctxRef: HouseCtx | null = null;
const focusKey = (f: Focus) => (f ? `${f.kind}:${f.id}` : '');

interface Cam { k: number; tx: number; ty: number }
const phone = () => window.innerWidth < 760;
function baseCam(ww: number, wh: number): Cam {
  if (phone()) {
    const k = Math.min(0.95, Math.max(0.42, (wh - 70) / H));
    return { k, tx: 0, ty: Math.max(0, (wh - 70 - H * k) / 2) };
  }
  const k = Math.min(ww / W, (wh - 64) / H);
  return { k, tx: (ww - W * k) / 2, ty: Math.max(0, (wh - 64 - H * k) / 2) };
}
const PANEL_W = (wide: boolean, ww: number) => Math.min(wide ? 520 : 420, Math.round(ww * 0.46));
function focusRect(f: Focus): { x: number; y: number; w: number; h: number } | null {
  if (!f) return null;
  if (f.kind === 'st') { const s = ST(f.id); return s ? { x: s.x, y: s.y, w: s.w, h: s.h } : null; }
  const p = placed.get(f.id);
  return p ? { x: p.x - 70, y: p.y - 180, w: 140, h: 190 } : null;
}
function camFor(f: Focus, ww: number, wh: number): { cam: Cam; side: 'l' | 'r'; pw: number } {
  const b = baseCam(ww, wh);
  const r = focusRect(f);
  const wide = f?.kind === 'st' && !!ST(f.id)?.wide;
  const pw = PANEL_W(wide, ww);
  if (!r || phone()) return { cam: b, side: 'r', pw };
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const side: 'l' | 'r' = b.tx + cx * b.k > ww / 2 ? 'l' : 'r';
  const freeW = ww - pw - 36;
  const want = f!.kind === 'sv' ? 1.5 : Math.min(freeW * 0.62 / r.w, (wh - 80) * 0.62 / r.h);
  const k = Math.max(b.k * 1.15, Math.min(f!.kind === 'sv' ? b.k * 1.6 : b.k * 1.9, f!.kind === 'sv' ? b.k * want : want));
  const freeCx = side === 'r' ? freeW / 2 + 12 : pw + 24 + freeW / 2;
  let tx = freeCx - cx * k, ty = (wh - 64) / 2 - cy * k;
  // keep the scene over the screen where it can (no empty band above the roofline or past the yard)
  ty = Math.min(0, Math.max(wh - 64 - H * k, ty));
  tx = Math.min(side === 'l' ? pw + 24 : 0, Math.max(ww - (side === 'r' ? pw + 24 : 0) - W * k, tx));
  return { cam: { k, tx, ty }, side, pw };
}
const camCss = (c: Cam) => `translate(${c.tx.toFixed(1)}px,${c.ty.toFixed(1)}px) scale(${c.k.toFixed(4)})`;

// ---------------------------------------------------------------- people: where each stands
const placed = new Map<string, { x: number; y: number; face: 1 | -1; st: StationId }>();
function stationOf(s: Survivor): StationId {
  if (!canWork(s)) return pain(s) > 0.5 || s.wounds.some((w) => !w.hidden) ? 'infirmary' : 'bunks';
  return JOB_STATION[s.job] ?? 'bunks';
}
function placePeople() {
  placed.clear();
  const by = new Map<StationId, Survivor[]>();
  for (const s of living()) {
    if (s.breakState?.kind === 'away') continue;
    const st = stationOf(s);
    by.set(st, [...(by.get(st) ?? []), s]);
  }
  for (const [id, ppl] of by) {
    const st = ST(id)!;
    const [a, b] = st.sx;
    const gap = Math.min(64, ppl.length > 1 ? Math.max(40, (b - a) / (ppl.length - 1)) : 0);
    const mid = (a + b) / 2;
    ppl.forEach((s, i) => {
      const x = mid + (i - (ppl.length - 1) / 2) * gap;
      const cx = st.x + st.w / 2;
      placed.set(s.id, { x, y: st.feet, face: x < cx ? 1 : -1, st: id });
    });
  }
}

// ---------------------------------------------------------------- one-line summaries
const CAL_WORD: Record<string, string> = { night: 'ordinary', tide: 'a tide', band: 'maybe a tide', crossing: 'the Crossing', ice: 'ice', raiders: 'raiders', horde: 'a horde', tunnel: 'the tunnel', unknown: 'unknown' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const on = (job: JobId) => living().filter((s) => s.job === job && canWork(s) && !onRunToday(s));
const names = (ppl: Survivor[]) => ppl.map(first).join(', ');
function summary(st: Station): string {
  switch (st.id) {
    case 'wall': {
      const r = on('repair');
      return `${Math.ceil(G.fort.hp)}/${G.fort.maxHp}${r.length ? ` · ${names(r)} repairing` : G.fort.hp < G.fort.maxHp ? ' · nobody repairing' : ' · sound'}`;
    }
    case 'bench': {
      const r = on('craft');
      const q = G.craftQueue.map((x) => RECIPES.find((y) => y.id === x.recipe)?.name ?? '');
      return q.length ? `${plural(q.length, 'job')} queued: ${q[0]}${r.length ? '' : ' · nobody at the bench'}` : 'queue empty';
    }
    case 'rack': {
      const idle = wallLine().idle.length;
      return `${plural(G.weapons.length, 'gun')} · ${rackGuns().length} on the rack${idle ? ` · ${idle} can't shoot` : ''}`;
    }
    case 'kitchen': {
      const eat = dailyFood();
      const days = eat > 0 ? Math.floor(G.stores.food / eat) : 0;
      return `${Math.floor(G.stores.food)} food · ${days}d${halfRations() ? ' · half rations' : ''} · stove ${heatNeed()} fuel`;
    }
    case 'infirmary': {
      const hurt = living().reduce((a, p) => a + p.wounds.filter((w) => !w.tended && !w.hidden).length, 0);
      const d = on('doctor');
      return hurt ? `${plural(hurt, 'wound')} untended${d.length ? ` · ${names(d)} tending` : ''}` : 'nobody hurt';
    }
    case 'bunks': {
      const r = living().filter((s) => s.job === 'rest' || !canWork(s));
      const tired = living().filter((s) => s.rest < 0.45 && s.job !== 'rest');
      return `${r.length ? `${names(r)} resting` : 'empty'}${tired.length ? ` · ${tired.length} tired` : ''}`;
    }
    case 'radio': {
      if (!buildingLevel('radio')) return 'no mast yet';
      const r = on('radio');
      return r.length ? `${names(r)} listening` : 'nobody listening';
    }
    case 'table': {
      const risky = living().filter((s) => { computeMood(s); return breakChance(s) > 0; });
      const c = on('counsel');
      return `${risky.length ? `${risky.length} may break` : 'everyone holding'}${c.length ? ` · ${names(c)} counselling` : ''}`;
    }
    case 'calendar': {
      const c = calendar(2);
      const t0 = c[0].kind === 'night' ? (ctxRef?.tonightSize ?? 'ordinary') : CAL_WORD[c[0].kind] ?? c[0].kind;
      return `tonight ${t0}${c[1] ? ` · tomorrow ${CAL_WORD[c[1].kind] ?? c[1].kind}` : ''}`;
    }
    case 'gate': {
      const sc = on('scavenge');
      const run = runOpen() ? (ranToday() ? 'run done' : 'a run waits') : '';
      return [sc.length ? `${names(sc)} scavenging` : 'nobody out', run].filter(Boolean).join(' · ');
    }
    case 'board': {
      const docs = docsFound().length;
      return `the town · ${plural(docs, 'paper')}`;
    }
    case 'graves': {
      const gone = G.graves.length - buried().length;
      return [buried().length ? plural(buried().length, 'grave') : '', gone ? `${gone} gone` : ''].filter(Boolean).join(' · ');
    }
  }
}

// ---------------------------------------------------------------- art
// Existing sprites where there is one; a small ink silhouette (inline SVG) where there is none yet.
const img = (id: string, x: number, y: number, w: number, cls = '') => `<img class="hv-art ${cls}" src="${spriteUrl(id)}" alt="" draggable="false" style="left:${x}px;top:${y}px;width:${w}px" onerror="this.style.visibility='hidden'">`;
const svg = (x: number, y: number, w: number, h: number, body: string, cls = '') => `<svg class="hv-art ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" viewBox="0 0 ${w} ${h}" aria-hidden="true">${body}</svg>`;
/** a painted prop from public/sprites/house/ (3× the scene's units), `w` scene units wide */
const pic = (id: string, x: number, y: number, w: number, cls = '') => img(`house/${id}`, x, y, w, cls);
/** The dead in the ground (G.graves also keeps the ones who deserted: no marker for them). */
const buried = () => G.graves.filter((g) => g.dead?.cause !== 'deserted');
const GRAVE: [string, number, number][] = [['grave_cross', 46, 66], ['grave_board', 34, 62], ['grave_stone', 33, 58]];
const ART: Record<StationId, () => string> = {
  infirmary: () => pic('cot', 236, 340, 166)
    + pic('medcabinet', 410, 325, 45),
  bunks: () => pic('bunks', 490, 287, 154),
  radio: () => pic('radio', 774, 315, 92),
  kitchen: () => pic('stove', 382, 444, 62)
    + pic('pantry_shelf', 302, 478, 78)
    + (G.flags.dog ? img('dog', 352, 560, 84, 'hv-dog') : '')
    + (buildingLevel('still') ? pic('still', 238, 520, 58) : ''),
  rack: () => img('obj_cache', 462, 470, 118),
  table: () => pic('table', 612, 526, 121),
  calendar: () => {
    // the painted calendar's next seven blank days (after the crossed-out ones): danger nights ringed in red pencil
    const c = calendar(7);
    const red = (k: string) => k === 'tide' || k === 'crossing' || k === 'band' || k === 'horde' || k === 'raiders' || k === 'ice';
    const cells: [number, number][] = [[36.2, 48.8], [41.7, 48.8], [47.1, 48.8], [12.9, 55.8], [18.8, 55.8], [24.8, 55.8], [30.8, 55.8]];
    const rings = c.map((d, i) => {
      const [x, y] = cells[i];
      return red(d.kind) ? `<ellipse cx="${x}" cy="${y}" rx="2.9" ry="2.6" fill="none" stroke="#a8261e" stroke-width="1.1" opacity=".9"/>`
        : i === 0 ? `<path d="M${x - 2.4} ${y + 2.4} h4.8" stroke="#2a2018" stroke-width=".8"/>` : '';
    }).join('');
    return pic('calendar', 788, 460, 58) + svg(788, 460, 58, 66, rings);
  },
  bench: () => img('obj_shed', 934, 492, 146)
    + pic('workbench', 1048, 564, 120),
  board: () => pic('noticeboard', 1168, 512, 86),
  wall: () => img('emp_scaffold', 1252, 506, 150, 'hv-back') + img('fort_light', 1232, 430, 58, 'hv-back') + img('barricade', 1262, 450, 196),
  gate: () => pic('gate', 1450, 482, 109)
    + img('obj_duffel', 1500, 606, 64) + img('obj_sign_stop', 1560, 514, 38),
  graves: () => buried().slice(0, 4).map((g, i) => {
    const [id, w, h] = GRAVE[i % GRAVE.length];
    return pic(id, 46 + i * 38 - w / 2, 636 - h - (i % 2) * 3, w);
  }).join('') + (buried().length ? pic('mound', 22, 624, 150) : ''),
};

/** The house shell: the painted cut-away (roof, chimney, two floors, five empty rooms, the side door) over
 *  the yard's soil, the lean-to over the bench, the mast on the roof once built; a CSS layer breathes over the six bulbs. */
const BULBS: [number, number][] = [[328, 280], [560, 278], [781, 280], [298, 469], [560, 467], [761, 469]];
function backdrop(): string {
  const radio = buildingLevel('radio') > 0;
  return `<svg class="hv-shell" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <defs>
      <linearGradient id="hvSoil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a241c"/><stop offset="1" stop-color="#0f0d0b"/></linearGradient>
    </defs>
    <path d="M0 640 Q300 628 600 636 T1250 634 L1600 640 V720 H0Z" fill="url(#hvSoil)"/>
    <path d="M1436 646 L1600 640 V700 L1436 690Z" fill="#1d1a17" opacity=".9"/>
    <!-- lean-to over the bench -->
    <path d="M946 452 L1176 476" stroke="#0a0806" stroke-width="12"/><path d="M946 452 L1176 476" stroke="#3a3128" stroke-width="7"/><path d="M1168 476 V640" stroke="#2a2119" stroke-width="7"/>
  </svg>
  ${radio ? pic('mast', 803, 84, 34, 'hv-shell') : ''}
  <img class="hv-shell hv-house" src="${import.meta.env.BASE_URL}sprites/house/house_cutaway.webp" alt="" draggable="false" style="left:140px;top:94px;width:810px">
  <div class="hv-shell hv-lamps">${BULBS.map(([x, y], i) => `<i style="left:${x}px;top:${y}px;animation-delay:${(-i * 1.37).toFixed(2)}s"></i>`).join('')}</div>`;
}

// ---------------------------------------------------------------- the scene
function personHtml(s: Survivor, dots: Set<string>, ctx: HouseCtx): string {
  const p = placed.get(s.id);
  if (!p) return '';
  computeMood(s);
  const job = ctx.jobs.find((j) => j.id === s.job)?.label ?? s.job;
  const work = canWork(s) ? `${esc(job)} · ${esc(ctx.jobOutlook(s, s.job))}` : 'can\'t work today';
  const stale = canWork(s) && G.day > 1 && !planConfirmed(s) && !onRunToday(s);
  const sel = focus?.kind === 'sv' && focus.id === s.id;
  return `<button class="hv-sv ${stale ? 'stale' : ''} ${sel ? 'on' : ''}" data-sv="${s.id}" style="left:${p.x - 55}px;top:${p.y - 172}px" aria-label="${esc(displayName(s))}: ${esc(job)}">
    <span class="hv-cv" data-cv="${s.id}"></span>
    ${dots.has(`surv:${s.id}`) ? '<span class="hv-pin"><i class="hv-dot"></i></span>' : ''}
    <span class="hv-tag"><span class="hv-lab"><b>${esc(first(s))}</b><span class="t-s">${work}</span>${ctx.moodChip(s)}${breakChip(s)}</span></span>
  </button>`;
}
function breakChip(s: Survivor) {
  const p = breakChance(s);
  if (!p) return '';
  return `<span class="chip ${p >= 0.4 ? 'bad' : 'warn'}">${ico('st_break', '', 'sm')}<b>${Math.round(p * 100)}%</b></span>`;
}

function stationHtml(st: Station, dots: Set<string>): string {
  const open = stationOpen(st);
  if (st.id === 'graves' && !open) return '';
  const art = ART[st.id]();
  if (!open) return `<div class="hv-st off">${art}</div>`;
  const sel = focus?.kind === 'st' && focus.id === st.id;
  const dot = st.dot && dots.has(st.dot);
  const pick = focus?.kind === 'sv' ? byId(focus.id) : null;
  const assign = pick && st.job && jobOpen(st.job) && canWork(pick) ? `<span class="hv-assign">Put ${esc(first(pick))} here: ${esc(ctxRef?.jobs.find((j) => j.id === st.job)?.label ?? st.job)} · ${esc(ctxRef?.jobOutlook(pick, st.job) ?? '')}</span>` : '';
  return `<div class="hv-st ${sel ? 'on' : ''}" data-st="${st.id}">${art}
    <button class="hv-hs" data-hs="${st.id}" style="left:${st.x}px;top:${st.y}px;width:${st.w}px;height:${st.h}px" aria-label="${esc(st.name)}: ${esc(summary(st))}"></button>
    <span class="hv-label ${LABEL_DY[st.id] ? 'corner' : 'above'}" style="left:${LABEL_DY[st.id] ? st.x + 8 : st.x + st.w / 2}px;top:${st.y + LABEL_DY[st.id]}px"><span class="hv-lab">${dot ? '<i class="hv-dot"></i>' : ''}${ico(st.icon, '', 'sm')}<b>${esc(st.name)}</b><span class="hv-sum">${esc(summary(st))}</span>${assign}</span></span>
  </div>`;
}

// ---------------------------------------------------------------- panels
const here = (st: Station) => {
  const ppl = living().filter((s) => placed.get(s.id)?.st === st.id);
  if (!ppl.length) return st.job ? `<p class="t-s dim hv-here">Nobody here. Drag someone onto the ${esc(st.name.toLowerCase())}, or click them, then click it.</p>` : '';
  return `<div class="hv-here">${ppl.map((s) => `<button class="hv-face" data-hs-sv="${s.id}"${tip(`<b>${esc(displayName(s))}</b><br>${esc(ctxRef?.jobOutlook(s, s.job) ?? '')}`)}>${portraitImg(s.sprite, 'portrait')}<span class="t-s">${esc(first(s))}</span></button>`).join('')}</div>`;
};
function kitchenPanel(ctx: HouseCtx, st: Station) {
  const eat = dailyFood();
  const days = eat > 0 ? Math.floor(G.stores.food / eat) : 0;
  const heat = heatNeed();
  const half = halfRations();
  const still = buildingLevel('still') > 0;
  const stillRecipes = RECIPES.filter((r) => r.needs === 'still' && !r.hidden && buildingLevel(r.needs) >= (r.level ?? 1));
  return `${here(st)}
    ${sec('Food', `${Math.floor(G.stores.food)} · eat ${+eat.toFixed(1)}/day`, 'Anyone on Food brings some in: snares, kale, cold frames. Scavengers bring more.')}
    <div class="chips">${chip('food', `${days} day${days === 1 ? '' : 's'} left`, '', days < 3 ? 'warn' : '')}${on('farm').map((s) => chip('job_farm', `${esc(first(s))} ${esc(ctx.jobOutlook(s, 'farm'))}`)).join('')}</div>
    <div class="hv-row"><span class="t-s">Rations</span><button class="mini ${half ? '' : 'on'}" data-hs-act="rations" data-v="full" ${half ? '' : 'disabled'}>full</button><button class="mini ${half ? 'on' : ''}" data-hs-act="rations" data-v="half" ${half ? 'disabled' : ''}${tip('Half the food. Hunger falls a little every day (a slow starve) and mood −5.')}>half</button></div>
    ${sec('Stove', `${Math.floor(G.stores.fuel)} ${RES_LABEL.fuel.toLowerCase()}`, 'The stove burns fuel at night; colder nights want more.')}
    <p class="t-s">${heat ? `Burns <b class="${G.stores.fuel < heat ? 'neg' : ''}">${heat}</b> tonight.` : 'No fire needed tonight.'}</p>
    ${isOpen('workshop') ? `${sec('The still', still ? 'built' : 'none')}${still ? `<div class="hv-recipes">${stillRecipes.map((r) => `<div class="hv-recipe"${tip(`<b>${esc(r.name)}</b><br>${esc(r.desc)}`)}><span class="t-s">${esc(r.name)}</span><span class="ccost">${ctx.costHtml(r.cost)}</span><button class="mini" data-act="queue" data-id="${r.id}">+</button></div>`).join('')}</div><p class="t-xs dim">Queued at the bench; someone must work it.</p>` : '<p class="t-s dim">No still yet. The bench builds one (Machinery).</p>'}` : ''}`;
}
function infirmaryPanel(ctx: HouseCtx, st: Station) {
  const hurt = living().filter((s) => s.wounds.some((w) => !w.hidden) || isBitten(s) || pain(s) > 0.05);
  return `${here(st)}
    ${sec('Wounded', hurt.length, 'Untended wounds bleed, fester and slow people down. Medicine heals and fights infection.')}
    ${hurt.length ? hurt.map((s) => `<div class="hv-person"><button class="hv-face sm" data-hs-sv="${s.id}">${portraitImg(s.sprite, 'portrait')}</button><span class="t-m">${esc(first(s))}</span><span class="sv-state">${ctx.statusTags(s)}</span></div>`).join('') : '<p class="t-s">Nobody hurt.</p>'}
    <div class="chips">${chip('meds', `${Math.floor(G.stores.meds ?? 0)} medicine`)}${buildingLevel('infirmary') ? chip('job_doctor', `infirmary ${buildingLevel('infirmary')}`, 'Better beds: wounds heal faster.') : ''}${on('doctor').map((s) => chip('job_doctor', `${esc(first(s))}: ${esc(ctx.jobOutlook(s, 'doctor'))}`)).join('')}</div>`;
}
function bunksPanel(ctx: HouseCtx, st: Station) {
  const ppl = [...living()].sort((a, b) => a.rest - b.rest);
  return `${here(st)}
    ${sec('Rest', '', 'A day on Rest sleeps off tiredness. Short hours help too (on a person\'s card).')}
    ${ppl.map((s) => `<div class="hv-person"><button class="hv-face sm" data-hs-sv="${s.id}">${portraitImg(s.sprite, 'portrait')}</button><span class="t-m">${esc(first(s))}</span><span class="t-s ${s.rest < 0.45 ? 'neg' : 'dim'}">rested ${Math.round(s.rest * 100)}%</span>${s.job === 'rest' ? '<span class="t-xs">resting</span>' : canWork(s) ? `<button class="mini" data-hs-act="setjob" data-id="${s.id}" data-job="rest">rest</button>` : ''}</div>`).join('')}
    <p class="t-xs dim">${esc(ctx.jobOutlook(ppl[0] ?? living()[0], 'rest'))}</p>`;
}
function radioPanel(ctx: HouseCtx, st: Station) {
  const mast = buildingLevel('radio') > 0;
  return `${here(st)}
    ${sec('The radio', mast ? 'mast up' : 'no mast', ctx.jobs.find((j) => j.id === 'radio')?.hint ?? '')}
    <p class="t-s">${mast ? 'Someone on the radio hears what is coming tonight, wave by wave, and sometimes a voice with something to trade.' : 'Without a mast it is static. The bench builds one (Machinery).'}</p>
    ${on('radio').map((s) => `<p class="t-s">${esc(first(s))}: ${esc(ctx.jobOutlook(s, 'radio'))}</p>`).join('')}
    ${ctx.threads}`;
}
function tablePanel(ctx: HouseCtx, st: Station) {
  const plan = counselPlan();
  const risky = living().filter((s) => { computeMood(s); return breakChance(s, false) > 0 || s.breakState; }).sort((a, b) => breakChance(b, false) - breakChance(a, false));
  return `${here(st)}
    ${isOpen('jobs') ? `${sec('Talk', risky.length ? `${risky.length} near breaking` : 'all holding', ctx.jobs.find((j) => j.id === 'counsel')?.hint ?? '')}
    ${risky.map((s) => `<div class="hv-person"><button class="hv-face sm" data-hs-sv="${s.id}">${portraitImg(s.sprite, 'portrait')}</button><span class="t-m">${esc(first(s))}</span>${ctx.moodChip(s)}<span class="t-s dim">${esc(moodWord(s.mood))}${plan.get(s) ? ` · ${esc(first(plan.get(s)!))} talks to ${s.sex === 'm' ? 'him' : 'her'}` : ''}</span></div>`).join('') || '<p class="t-s">Nobody near breaking.</p>'}` : ''}
    ${isOpen('chronicle') ? `${sec('The journal', G.chronicle.length)}${ctx.chronicle()}` : ''}`;
}
function gatePanel(ctx: HouseCtx, st: Station) {
  const sc = living().filter((s) => s.job === 'scavenge' && canWork(s));
  return `${runOpen() ? `<div class="runwrap"${ctx.dots.has('run') ? ' data-dot' : ''}>${revealNote('run')}${ctx.run()}</div>` : ''}
    ${sec('Scavengers', sc.length, ctx.jobs.find((j) => j.id === 'scavenge')?.hint ?? '')}
    ${sc.map((s) => `<div class="hv-scav"><button class="hv-face sm" data-hs-sv="${s.id}">${portraitImg(s.sprite, 'portrait')}</button><span class="t-m">${esc(first(s))}</span>${ctx.siteButton(s)}</div>`).join('') || `<p class="t-s dim">Nobody out today. Drag someone onto the gate to send them, then pick a place (${SITES.filter((x) => x.minDay <= G.day).length} known).</p>`}`;
}
function calendarPanel(ctx: HouseCtx) {
  return `${ctx.calendar || (ctx.forecast ? `<p class="forecast">${esc(ctx.forecast)}</p>` : '')}${ctx.threads}`;
}
function panelBody(st: Station, ctx: HouseCtx): string {
  const note = st.tab && REVEALS.has(st.tab) ? revealNote(st.tab as RevealId) : '';
  switch (st.id) {
    case 'wall': return `${here(st)}${note}${ctx.wall()}`;
    case 'bench': return `${note}${ctx.workshop()}`;
    case 'rack': return `${note}${ctx.armory()}`;
    case 'board': return `${note}${ctx.town()}`;
    case 'graves': return `${note}${ctx.graves()}`;
    case 'kitchen': return kitchenPanel(ctx, st);
    case 'infirmary': return infirmaryPanel(ctx, st);
    case 'bunks': return bunksPanel(ctx, st);
    case 'radio': return radioPanel(ctx, st);
    case 'table': return tablePanel(ctx, st);
    case 'gate': return gatePanel(ctx, st);
    case 'calendar': return calendarPanel(ctx);
  }
}
const REVEALS = new Set(['workshop', 'armory', 'town', 'chronicle', 'graves']);
function panelHtml(ctx: HouseCtx): string {
  if (!focus) return '';
  if (focus.kind === 'st') {
    const st = ST(focus.id);
    if (!st) return '';
    return `<aside class="hv-panel ${st.wide ? 'wide' : ''}" data-panel="${st.id}" role="dialog" aria-label="${esc(st.name)}">
      <div class="hv-phead">${ico(st.icon)}<div><h2 class="t-l">${esc(st.name)}</h2><div class="t-s dim">${esc(summary(st))}</div></div><button class="close" data-hs-act="back" aria-label="Back to the house">×</button></div>
      <div class="hv-pbody">${panelBody(st, ctx)}</div></aside>`;
  }
  const s = byId(focus.id);
  if (!s) return '';
  return `<aside class="hv-panel sv" data-panel="sv:${s.id}" role="dialog" aria-label="${esc(displayName(s))}">
    <div class="hv-phead"><div><h2 class="t-l">${esc(first(s))}</h2><div class="t-s dim">Drag ${esc(first(s))} onto a place, or click one, to give that job.</div></div><button class="close" data-hs-act="back" aria-label="Back to the house">×</button></div>
    <div class="hv-pbody">${ctx.survivorCard(s, ctx.dots)}<button class="mini link" data-act="detail" data-id="${s.id}">Full sheet ›</button></div></aside>`;
}

// ---------------------------------------------------------------- render
/** Every render of the day screen hands the house its builders (the L key works from the ledger too). */
export function bindHouse(ctx: HouseCtx) { ctxRef = ctx; installKeys(); }
export function houseHtml(ctx: HouseCtx): string {
  ctxRef = ctx;
  if (focus?.kind === 'st' && !(ST(focus.id) && stationOpen(ST(focus.id)!))) focus = null;
  if (focus?.kind === 'sv' && !byId(focus.id)) focus = null;
  placePeople();
  const people = living().filter((s) => placed.has(s.id));
  const away = living().filter((s) => !placed.has(s.id));
  const cam = lastCam ?? { k: 0.8, tx: 0, ty: 0 };
  if (noteOpen === null) noteOpen = !phone();
  const left = ctx.today.match(/class="td (?!done)/g)?.length ?? 0;
  return `<div class="hv-wrap ${focus ? 'zoomed' : ''} ${focus?.kind === 'sv' ? 'picking' : ''}">
    <div class="hv-scroll"><div class="hv-sizer">
    <div class="hv-scene" style="transform:${camCss(cam)};--k:${cam.k};background-image:linear-gradient(rgba(12,12,16,.55),rgba(10,10,12,.35) 40%,rgba(8,8,8,.75)),url(${spriteUrl('bg_far')})">
      ${backdrop()}
      ${STATIONS.map((st) => stationHtml(st, ctx.dots)).join('')}
      <div class="hv-people people">${people.map((s) => personHtml(s, ctx.dots, ctx)).join('')}</div>
    </div></div></div>
    <div class="hv-note ${noteOpen ? 'open' : ''}">
      <button class="hv-notehead" data-hs-act="note" aria-expanded="${noteOpen}"><span class="t-l">Today</span>${left ? `<b class="hv-n">${left}</b>` : '<span class="t-xs">done</span>'}<span class="hv-caret">${noteOpen ? '▾' : '▸'}</span></button>
      <div class="hv-notebody">${ctx.today}
        ${ctx.forecast && !isOpen('calendar') ? `<p class="forecast t-s">${esc(ctx.forecast)}</p>` : ''}
        ${ctx.report.length ? `<p class="t-s hv-latest">${esc(ctx.report[0])}</p>` : ''}
        ${ctx.report.length > 1 ? `<details class="fold hv-morning"><summary><span class="t-s">This morning</span> <span class="t-xs">+${ctx.report.length - 1}</span></summary><div class="fold-body">${ctx.report.slice(1).map((l) => `<p class="t-s">${esc(l)}</p>`).join('')}</div></details>` : ctx.report.length ? '' : '<p class="t-s dim">A quiet morning.</p>'}
        ${away.length ? `<p class="t-xs dim">Away: ${away.map((s) => esc(first(s))).join(', ')}</p>` : ''}
      </div>
    </div>
    ${panelHtml(ctx)}
    <div class="hv-bar">${ctx.keep}<span class="hv-hint t-s">${focus ? `Esc to step back` : 'Click a place or a person · drag a person onto a place'}</span>${ctx.dusk}</div>
  </div>`;
}

/** After day.ts set innerHTML: the camera, the panel's place, the people's canvases, scroll positions. */
export function mountHouse(root: HTMLElement) {
  const wrap = root.querySelector('.hv-wrap') as HTMLElement | null;
  if (!wrap) return;
  installOnce(root);
  const scene = wrap.querySelector('.hv-scene') as HTMLElement;
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const { cam, side, pw } = camFor(focus, ww, wh);
  const panel = wrap.querySelector('.hv-panel') as HTMLElement | null;
  const fr = focusRect(focus);
  if (phone() && panel && fr) {
    // the sheet covers the bottom: lift the scene so what it is about shows above it
    const free = wh - 64 - panel.offsetHeight;
    cam.ty = Math.max(free - H * cam.k, Math.min(0, free / 2 - (fr.y + fr.h / 2) * cam.k));
  }
  const key = focusKey(focus);
  const moved = !!lastCam && key !== lastFocusKey;
  const scroller = wrap.querySelector('.hv-scroll') as HTMLElement;
  if (phone()) {
    (wrap.querySelector('.hv-sizer') as HTMLElement).style.width = `${W * cam.k}px`;
  }
  if (moved && !reduced()) {
    void scene.offsetWidth;
    scene.classList.add('anim');
  }
  scene.style.transform = camCss(cam);
  scene.style.setProperty('--k', String(cam.k));
  lastCam = cam;
  lastFocusKey = key;
  // the panel beside what it is about
  if (panel) {
    if (!phone()) {
      panel.style.width = `${pw}px`;
      panel.style[side === 'l' ? 'left' : 'right'] = '12px';
      const r = focusRect(focus);
      if (r) {
        const cy = cam.ty + (r.y + r.h / 2) * cam.k;
        const ph = panel.offsetHeight;
        panel.style.top = `${Math.round(Math.max(10, Math.min(wh - 64 - ph, cy - ph / 2)))}px`;
      }
    }
    if (moved) {
      panel.classList.add('enter');
      // keyboard and pad: focus goes into the panel (Tab walks it; Esc / B steps back out)
      (panel.querySelector('.close') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    const body = panel.querySelector('.hv-pbody') as HTMLElement | null;
    if (body) {
      const k = panel.dataset.panel!;
      body.scrollTop = scrollMem.get(k) ?? 0;
      body.addEventListener('scroll', () => scrollMem.set(k, body.scrollTop), { passive: true });
    }
  }
  if (phone()) {
    const r = focusRect(focus);
    scroller.scrollLeft = scrollMem.get('wrap') ?? 0;
    if (r && moved) scroller.scrollTo({ left: Math.max(0, (r.x + r.w / 2) * cam.k - ww / 2), behavior: reduced() ? 'auto' : 'smooth' });
    scroller.addEventListener('scroll', () => scrollMem.set('wrap', scroller.scrollLeft), { passive: true });
  }
  // stepping back out: focus returns to the place (or person) it was on
  if (moved && !focus && backTo) (wrap.querySelector(`[data-hs="${backTo}"], [data-sv="${backTo}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  backTo = '';
  mountRigs(wrap);
}
let backTo = '';
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// ---------------------------------------------------------------- people as rigs
interface Body { rig: Rig | null; cv: HTMLCanvasElement; fb: HTMLImageElement; sprite: string; next: number }
const bodies = new Map<string, Body>();
const CV_W = 110, CV_H = 176, DPR = 3; // 3× the scene's units: still sharp at the deepest zoom on a 2× screen
function bodyFor(s: Survivor): Body {
  let b = bodies.get(s.id);
  if (b && b.sprite === s.sprite) return b;
  const cv = document.createElement('canvas');
  cv.width = CV_W * DPR; cv.height = CV_H * DPR;
  cv.className = 'hv-body';
  const fb = new Image();
  fb.src = spriteUrl(s.sprite);
  const rig = SPRITE_RIGS[s.sprite] ? createRig('survivor', s.sprite, { seed: s.id.length * 977 + s.age * 13 }) : null;
  b = { rig, cv, fb, sprite: s.sprite, next: 2 + Math.random() * 5 };
  bodies.set(s.id, b);
  return b;
}
let raf = 0, lastT = 0;
function mountRigs(wrap: HTMLElement) {
  for (const slot of Array.from(wrap.querySelectorAll<HTMLElement>('[data-cv]'))) {
    const s = byId(slot.dataset.cv!);
    if (!s) continue;
    slot.appendChild(bodyFor(s).cv);
  }
  if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
}
const IDLE: Partial<Record<StationId, string[]>> = { bench: ['rummage', 'idleTurn'], kitchen: ['rummage', 'idleTurn'], gate: ['idleTurn'], infirmary: ['rummage'], wall: ['idleTurn'] };
function tick(t: number) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (!document.querySelector('.hv-scene')) { raf = 0; return; }
  if (!document.hidden) {
    for (const [id, b] of bodies) {
      if (!b.cv.isConnected) continue;
      const p = placed.get(id);
      if (!p) continue;
      const c = b.cv.getContext('2d')!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, b.cv.width, b.cv.height);
      const scale = (DPR * 150) / 240;
      if (b.rig) {
        b.next -= dt;
        if (b.next <= 0 && b.rig.ready) {
          b.next = 4 + Math.random() * 7;
          const opts = IDLE[p.st] ?? ['idleTurn'];
          if (!b.rig.isPlaying()) b.rig.play(opts[Math.floor(Math.random() * opts.length)], { duration: 1.6 + Math.random() });
        }
        b.rig.update(dt);
        b.rig.draw(c, (CV_W / 2) * DPR, (CV_H - 4) * DPR, scale, p.face, b.fb.complete && b.fb.naturalWidth ? b.fb : undefined);
      } else if (b.fb.complete && b.fb.naturalWidth) {
        const h = 150 * DPR, w = (b.fb.naturalWidth / b.fb.naturalHeight) * h;
        c.save();
        c.translate((CV_W / 2) * DPR, 0);
        c.scale(p.face, 1);
        c.drawImage(b.fb, -w / 2, (CV_H - 4) * DPR - h, w, h);
        c.restore();
      }
    }
  }
  raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- input
function zoomTo(f: Focus) {
  if (!f && focus) backTo = focus.id;
  focus = f;
  if (f?.kind === 'st') {
    const st = ST(f.id);
    if (st?.tab && REVEALS.has(st.tab)) markSeen(st.tab);
    if (f.id === 'calendar') markSeen('calendar');
    if (f.id === 'gate') markSeen('run');
  }
  sfx.ui('paper');
  ctxRef?.rerender();
}
function assign(s: Survivor, stId: StationId): boolean {
  const st = ST(stId);
  if (!st?.job || !canWork(s) || !jobOpen(st.job)) return false;
  s.job = st.job;
  confirmPlan(s);
  sfx.ui('stamp');
  if (st.job === 'scavenge' && ctxRef) ctxRef.openSitePick(s.id);
  return true;
}

/** day.ts calls this first on every click in the day screen; true = handled. */
export function houseClick(e: MouseEvent): boolean {
  const t = e.target as HTMLElement;
  if (performance.now() < dragEndAt + 80) return true; // the click that ends a drag
  if (t.closest('[data-act=run], [data-act=dusk]')) { focus = null; lastFocusKey = ''; return false; } // leaving the house: come back to the whole of it
  const act = t.closest('[data-hs-act]') as HTMLElement | null;
  if (act) {
    const a = act.dataset.hsAct;
    if (a === 'view') { setView(houseView() ? 'ledger' : 'house'); focus = null; sfx.ui('paper'); ctxRef?.rerender(); return true; }
    if (a === 'back') { zoomTo(null); return true; }
    if (a === 'note') { noteOpen = !noteOpen; sfx.ui('paper'); ctxRef?.rerender(); return true; }
    if (a === 'rations') { G.flags.rations = act.dataset.v === 'half' ? 'half' : 'full'; sfx.ui('stamp'); ctxRef?.rerender(); return true; }
    if (a === 'setjob') { const s = byId(act.dataset.id!); if (s) { s.job = act.dataset.job as JobId; confirmPlan(s); sfx.ui('stamp'); } ctxRef?.rerender(); return true; }
    return false;
  }
  if (!houseView()) return false;
  const face = t.closest('[data-hs-sv]') as HTMLElement | null;
  if (face) { zoomTo({ kind: 'sv', id: face.dataset.hsSv! }); return true; }
  const sv = t.closest('[data-sv]') as HTMLElement | null;
  if (sv) { zoomTo(focus?.kind === 'sv' && focus.id === sv.dataset.sv ? null : { kind: 'sv', id: sv.dataset.sv! }); return true; }
  const hs = t.closest('[data-hs]') as HTMLElement | null;
  if (hs) {
    const id = hs.dataset.hs as StationId;
    if (focus?.kind === 'sv') {
      const s = byId(focus.id);
      if (s && assign(s, id)) { ctxRef?.rerender(); return true; }
    }
    zoomTo(focus?.kind === 'st' && focus.id === id ? null : { kind: 'st', id });
    return true;
  }
  // a click on the bare scene (not the panel, the note or the bar) steps back out
  if (focus && t.closest('.hv-wrap') && !t.closest('.hv-panel, .hv-note, .hv-bar, [data-act]')) { zoomTo(null); return true; }
  return false;
}

/** A Today item was clicked: zoom to where it is fixed. */
export function houseTodo(go: { tab?: string; sel?: string; dot?: string }) {
  if (!houseView()) return;
  const surv = go.dot?.startsWith('surv:') ? go.dot.slice(5) : go.sel?.match(/data-id="([^"]+)"/)?.[1];
  let f: Focus = null;
  if (go.tab && TAB_STATION[go.tab]) f = { kind: 'st', id: TAB_STATION[go.tab] };
  else if (surv && byId(surv)) f = { kind: 'sv', id: surv };
  else if (go.sel?.includes('.calendar')) f = { kind: 'st', id: 'calendar' };
  else if (go.sel?.includes('.run')) f = { kind: 'st', id: 'gate' };
  else if (go.sel?.includes('.sv-card') || go.sel?.includes('.people')) {
    const s = living().find((x) => canWork(x) && !planConfirmed(x)) ?? living()[0];
    if (s) f = { kind: 'sv', id: s.id };
  }
  if (go.dot && !f) { const st = STATIONS.find((x) => x.dot === go.dot); if (st) f = { kind: 'st', id: st.id }; }
  if (f && f.kind === 'st' && !stationOpen(ST(f.id)!)) f = null;
  if (f) focus = f;
}

// drag a person onto a station
let drag: { id: string; x0: number; y0: number; ghost: HTMLElement | null; over: string | null } | null = null;
let dragEndAt = 0;
const installed = new WeakSet<HTMLElement>();
function installOnce(root: HTMLElement) {
  if (installed.has(root)) return;
  installed.add(root);
  root.addEventListener('pointerdown', (e) => {
    if (!houseView() || e.button !== 0) return;
    const sv = (e.target as HTMLElement).closest('[data-sv]') as HTMLElement | null;
    if (!sv) return;
    drag = { id: sv.dataset.sv!, x0: e.clientX, y0: e.clientY, ghost: null, over: null };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
      const s = byId(drag.id);
      if (!s || !canWork(s)) { drag = null; return; }
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'hv-ghost';
      drag.ghost.innerHTML = `${portraitImg(s.sprite, 'portrait')}<span class="t-s">${esc(first(s))}</span><span class="hv-gwhere t-xs"></span>`;
      document.body.appendChild(drag.ghost);
      document.querySelector('.hv-wrap')?.classList.add('dragging');
    }
    drag.ghost.style.left = `${e.clientX + 12}px`;
    drag.ghost.style.top = `${e.clientY + 12}px`;
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.hs) as HTMLElement | undefined;
    const id = under?.dataset.hs ?? null;
    if (id !== drag.over) {
      document.querySelectorAll('.hv-st.drop').forEach((x) => x.classList.remove('drop'));
      drag.over = id;
      const st = id ? ST(id) : null;
      const s = byId(drag.id)!;
      const ok = !!st?.job && jobOpen(st.job);
      if (st && ok) document.querySelector(`.hv-st[data-st="${id}"]`)?.classList.add('drop');
      (drag.ghost.querySelector('.hv-gwhere') as HTMLElement).textContent = st ? (ok ? `${ctxRef?.jobs.find((j) => j.id === st.job)?.label ?? ''} · ${ctxRef?.jobOutlook(s, st.job!) ?? ''}` : `${st.name}: no job here`) : '';
    }
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    dragEndAt = performance.now();
    document.querySelector('.hv-wrap')?.classList.remove('dragging');
    const s = byId(d.id);
    if (s && d.over && assign(s, d.over as StationId)) ctxRef?.rerender();
    else document.querySelectorAll('.hv-st.drop').forEach((x) => x.classList.remove('drop'));
  });
}
let keysOn = false;
function installKeys() {
  if (keysOn) return;
  keysOn = true;
  window.addEventListener('keydown', (e) => {
    if (G.phase !== 'day' || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    if (document.querySelector('.overlay') || G.pendingEvent || !document.querySelector('.day')) return;
    const tg = e.target as HTMLElement | null;
    if (tg && /^(SELECT|INPUT|TEXTAREA)$/.test(tg.tagName)) return;
    if (e.key === 'Escape' && houseView() && focus) { e.preventDefault(); zoomTo(null); return; }
    if (is(e, 'day.view')) { e.preventDefault(); setView(houseView() ? 'ledger' : 'house'); focus = null; sfx.ui('paper'); ctxRef?.rerender(); }
  });
  window.addEventListener('resize', () => {
    const r = document.getElementById('app');
    if (r && houseView() && document.querySelector('.hv-wrap')) { lastFocusKey = focusKey(focus); mountHouse(r); }
  });
}

/** Debug / test handle: the station rects and where each person stands. */
(globalThis as unknown as { __house: object }).__house = { stations: STATIONS, placed, focus: () => focus };
