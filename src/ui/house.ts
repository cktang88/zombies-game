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
  { id: 'board', name: 'Noticeboard', icon: 'st_faction', x: 1174, y: 486, w: 76, h: 154, feet: YARD, sx: [1200, 1220], tab: 'town', dot: 'tab:town', reveal: 'town', wide: true },
  { id: 'wall', name: 'The wall', icon: 'st_wall', x: 1254, y: 400, w: 182, h: 242, feet: YARD, sx: [1270, 1330], job: 'repair', tab: 'wall', dot: 'tab:wall' },
  { id: 'gate', name: 'The gate', icon: 'job_scavenge', x: 1440, y: 430, w: 160, h: 212, feet: YARD, sx: [1470, 1560], job: 'scavenge', dot: 'run' },
  { id: 'graves', name: 'Graves', icon: 'st_dead', x: 24, y: 520, w: 150, h: 122, feet: YARD, sx: [90, 120], tab: 'graves', dot: 'tab:graves', reveal: 'graves' },
];
/** where a station's name plaque sits, from the top of its hotspot (inside rooms: under the ceiling) */
const LABEL_DY: Record<StationId, number> = { infirmary: 22, bunks: 22, radio: 22, kitchen: 22, rack: 22, table: 22, calendar: 0, bench: 0, board: 0, wall: 0, gate: 0, graves: 0 };
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
      return `tonight ${CAL_WORD[c[0].kind] ?? c[0].kind}${c[1] ? ` · tomorrow ${CAL_WORD[c[1].kind] ?? c[1].kind}` : ''}`;
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
    case 'graves':
      return plural(G.graves.length, 'grave');
  }
}

// ---------------------------------------------------------------- art
// Existing sprites where there is one; a small ink silhouette (inline SVG) where there is none yet.
const img = (id: string, x: number, y: number, w: number, cls = '') => `<img class="hv-art ${cls}" src="${spriteUrl(id)}" alt="" draggable="false" style="left:${x}px;top:${y}px;width:${w}px" onerror="this.style.visibility='hidden'">`;
const svg = (x: number, y: number, w: number, h: number, body: string, cls = '') => `<svg class="hv-art ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" viewBox="0 0 ${w} ${h}" aria-hidden="true">${body}</svg>`;
const INK = 'stroke="#070605" stroke-width="3" stroke-linejoin="round"';
const ART: Record<StationId, () => string> = {
  infirmary: () => svg(222, 352, 180, 76, `<rect x="6" y="20" width="168" height="16" rx="3" fill="#cbbf9f" ${INK}/><rect x="6" y="14" width="40" height="12" rx="5" fill="#e6dcc6" ${INK}/>
      <path d="M50 22 q60 -8 120 0 v12 h-120z" fill="#6b5b45" ${INK}/><path d="M14 36 v36 M166 36 v36 M14 56 h152" fill="none" stroke="#1d1813" stroke-width="5"/><path d="M14 36 v36 M166 36 v36" fill="none" ${INK}/>`)
    + svg(408, 330, 44, 98, `<rect x="4" y="4" width="36" height="50" fill="#2c261f" ${INK}/><rect x="10" y="12" width="10" height="14" fill="#8e2a20" stroke="#070605" stroke-width="2"/><rect x="24" y="16" width="10" height="10" fill="#cbbf9f" stroke="#070605" stroke-width="2"/><path d="M8 54 v40 M36 54 v40" stroke="#1d1813" stroke-width="4"/>`),
  bunks: () => svg(548, 292, 104, 136, `<path d="M8 4 v128 M96 4 v128" stroke="#2c241b" stroke-width="8"/><path d="M8 4 v128 M96 4 v128" fill="none" ${INK} stroke-width="2"/>
      <rect x="10" y="40" width="84" height="14" fill="#5a4c3a" ${INK}/><path d="M14 40 q34 -12 76 -2 v2z" fill="#6f6250" ${INK}/>
      <rect x="10" y="104" width="84" height="14" fill="#5a4c3a" ${INK}/><path d="M14 104 q30 -14 76 -4 v4z" fill="#3f4a3a" ${INK}/>`),
  radio: () => {
    const mast = buildingLevel('radio') > 0;
    return svg(774, 336, 110, 92, `<rect x="4" y="38" width="102" height="10" fill="#3a2f24" ${INK}/><path d="M12 48 v42 M98 48 v42" stroke="#2a2119" stroke-width="6"/>
      ${mast ? `<rect x="22" y="8" width="62" height="30" rx="3" fill="#3d4136" ${INK}/><circle cx="36" cy="23" r="7" fill="#1a1c17" stroke="#070605" stroke-width="2"/><rect x="50" y="14" width="26" height="8" fill="#b8862f" opacity=".75"/><circle cx="56" cy="30" r="3" fill="#a8462a"/><circle cx="68" cy="30" r="3" fill="#cbbf9f"/><path d="M78 8 l14 -8" stroke="#070605" stroke-width="3"/>` : '<path d="M30 30 h40 v8 h-40z" fill="#2c261f" stroke="#070605" stroke-width="2"/>'}`);
  },
  kitchen: () => svg(212, 498, 92, 114, `<rect x="6" y="30" width="80" height="80" fill="#26221d" ${INK}/><rect x="16" y="54" width="60" height="34" fill="#141210" ${INK} stroke-width="2"/>
      <path d="M22 80 q8 -16 12 -2 q6 -14 10 0 q6 -12 10 0" fill="none" stroke="#c96b2a" stroke-width="3"/><rect x="34" y="0" width="16" height="32" fill="#1d1a16" ${INK}/><rect x="2" y="24" width="88" height="8" fill="#3a332b" ${INK}/>`)
    + svg(316, 470, 120, 50, `<rect x="2" y="30" width="116" height="7" fill="#3a2f24" ${INK}/><rect x="10" y="10" width="14" height="20" rx="3" fill="#6b7a4c" opacity=".85" ${INK} stroke-width="2"/><rect x="28" y="14" width="14" height="16" rx="3" fill="#b8862f" opacity=".7" ${INK} stroke-width="2"/><rect x="48" y="6" width="18" height="24" rx="2" fill="#5a4c3a" ${INK} stroke-width="2"/><rect x="74" y="12" width="30" height="18" fill="#4a3f30" ${INK} stroke-width="2"/>`)
    + (G.flags.dog ? img('dog', 352, 560, 84, 'hv-dog') : '')
    + (buildingLevel('still') ? svg(392, 528, 44, 84, `<ellipse cx="22" cy="58" rx="18" ry="22" fill="#9a5a2a" ${INK}/><path d="M22 36 v-20 q0 -12 16 -12" fill="none" stroke="#9a5a2a" stroke-width="5"/><path d="M22 36 v-20 q0 -12 16 -12" fill="none" stroke="#070605" stroke-width="1.5"/>`) : ''),
  rack: () => img('obj_cache', 462, 470, 118),
  table: () => svg(606, 540, 134, 72, `<rect x="16" y="14" width="102" height="9" fill="#4a3c2c" ${INK}/><path d="M24 23 v46 M110 23 v46" stroke="#2a2119" stroke-width="6"/>
      <path d="M2 30 v40 M2 40 h14 v30" fill="none" stroke="#3a2f24" stroke-width="5"/><path d="M132 30 v40 M132 40 h-14 v30" fill="none" stroke="#3a2f24" stroke-width="5"/>
      <rect x="54" y="4" width="22" height="10" fill="#cbbf9f" stroke="#070605" stroke-width="2"/><circle cx="92" cy="9" r="5" fill="#6b5b45" stroke="#070605" stroke-width="2"/>`),
  calendar: () => {
    const c = calendar(7);
    const red = (k: string) => k === 'tide' || k === 'crossing' || k === 'band' || k === 'horde' || k === 'raiders' || k === 'ice';
    const cells = c.map((d, i) => `<rect x="${6 + (i % 4) * 16}" y="${26 + Math.floor(i / 4) * 16}" width="13" height="13" fill="${i === 0 ? '#e6dcc6' : '#cbbf9f'}" stroke="#4a4235" stroke-width="1"/>${red(d.kind) ? `<circle cx="${12.5 + (i % 4) * 16}" cy="${32.5 + Math.floor(i / 4) * 16}" r="4" fill="#a8322a"/>` : ''}`).join('');
    return svg(784, 462, 76, 64, `<rect x="2" y="2" width="72" height="60" fill="#d8ccad" ${INK} stroke-width="2"/><rect x="2" y="2" width="72" height="18" fill="#7a2a20" ${INK} stroke-width="2"/><circle cx="38" cy="6" r="3" fill="#070605"/>${cells}`);
  },
  bench: () => img('obj_shed', 934, 492, 146)
    + svg(1062, 556, 112, 84, `<rect x="2" y="16" width="108" height="12" fill="#5a4630" ${INK}/><path d="M10 28 v54 M100 28 v54 M10 62 h90" fill="none" stroke="#2a2119" stroke-width="6"/>
      <rect x="66" y="4" width="26" height="12" fill="#3d4136" stroke="#070605" stroke-width="2"/><path d="M14 16 l18 -12 l6 6 l-14 6z" fill="#6b5b45" stroke="#070605" stroke-width="2"/><circle cx="50" cy="12" r="4" fill="#9a8f7a" stroke="#070605" stroke-width="2"/>`),
  board: () => svg(1176, 498, 72, 142, `<path d="M12 30 v110 M60 30 v110" stroke="#2a2119" stroke-width="7"/><rect x="2" y="2" width="68" height="62" fill="#4a3c2c" ${INK}/><path d="M2 2 l34 -0 l34 0" stroke="#070605" stroke-width="3"/>
      <rect x="8" y="10" width="22" height="26" fill="#d8ccad" transform="rotate(-4 19 23)" stroke="#070605" stroke-width="1.5"/><rect x="36" y="8" width="26" height="20" fill="#cbbf9f" transform="rotate(3 49 18)" stroke="#070605" stroke-width="1.5"/><rect x="14" y="40" width="40" height="18" fill="#bfb08a" stroke="#070605" stroke-width="1.5"/><path d="M18 46 h30 M18 51 h24" stroke="#4a4235" stroke-width="1.5"/>`),
  wall: () => img('emp_scaffold', 1252, 506, 150, 'hv-back') + img('fort_light', 1232, 430, 58, 'hv-back') + img('barricade', 1262, 450, 196),
  gate: () => svg(1452, 470, 54, 172, `<path d="M6 0 v172 M48 0 v172" stroke="#1d1813" stroke-width="8"/><g ${INK} stroke-width="2"><rect x="8" y="20" width="38" height="150" fill="#3a2f24"/></g>
      <path d="M8 40 L46 120 M8 120 L46 40" stroke="#241c14" stroke-width="5"/><path d="M8 60 h38 M8 100 h38 M8 140 h38" stroke="#070605" stroke-width="2"/>`)
    + img('obj_duffel', 1500, 606, 64) + img('obj_sign_stop', 1560, 514, 38),
  graves: () => G.graves.slice(0, 4).map((g, i) => svg(30 + i * 36, 572 - (i % 2) * 6, 30, 70, `<path d="M15 4 v62 M4 20 h22" stroke="#4a4235" stroke-width="6" stroke-linecap="round"/><path d="M15 4 v62 M4 20 h22" stroke="#070605" stroke-width="1.5"/>`)).join('')
    + svg(24, 628, 150, 16, '<ellipse cx="75" cy="10" rx="72" ry="6" fill="#241e18"/>'),
};

/** The house shell: roof, two floors, room walls, windows, lamplight; the yard and the road. One SVG. */
function backdrop(): string {
  const lamp = (cx: number, cy: number, r = 120) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#hvLamp)"/>`;
  const radio = buildingLevel('radio') > 0;
  return `<svg class="hv-shell" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <defs>
      <pattern id="hvPlank" width="30" height="40" patternUnits="userSpaceOnUse"><rect width="30" height="40" fill="#2a2018"/><path d="M0 0 v40" stroke="#130e0a" stroke-width="3"/><path d="M14 12 v6" stroke="#1d1611" stroke-width="2"/></pattern>
      <pattern id="hvPlank2" width="34" height="40" patternUnits="userSpaceOnUse"><rect width="34" height="40" fill="#251d16"/><path d="M0 0 v40" stroke="#110c09" stroke-width="3"/></pattern>
      <pattern id="hvShingle" width="40" height="16" patternUnits="userSpaceOnUse"><rect width="40" height="16" fill="#1b1815"/><path d="M0 15 h40 M20 0 v15" stroke="#0b0908" stroke-width="2"/></pattern>
      <radialGradient id="hvLamp"><stop offset="0" stop-color="#f0b060" stop-opacity=".34"/><stop offset=".5" stop-color="#d08a40" stop-opacity=".12"/><stop offset="1" stop-color="#d08a40" stop-opacity="0"/></radialGradient>
      <linearGradient id="hvSoil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a241c"/><stop offset="1" stop-color="#0f0d0b"/></linearGradient>
      <linearGradient id="hvShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".4" stop-color="#000" stop-opacity="0"/></linearGradient>
    </defs>
    <path d="M0 640 Q300 628 600 636 T1250 634 L1600 640 V720 H0Z" fill="url(#hvSoil)"/>
    <path d="M1436 646 L1600 640 V700 L1436 690Z" fill="#1d1a17" opacity=".9"/>
    <!-- lean-to over the bench -->
    <path d="M926 452 L1176 476" stroke="#0a0806" stroke-width="12"/><path d="M926 452 L1176 476" stroke="#3a3128" stroke-width="7"/><path d="M1168 476 V640" stroke="#2a2119" stroke-width="7"/>
    <!-- roof, chimney${radio ? ', mast' : ''} -->
    <rect x="292" y="112" width="40" height="96" fill="#2a2119" stroke="#070605" stroke-width="4"/>
    ${radio ? '<path d="M820 160 V40 M808 70 L832 70 M812 100 L828 100 M820 40 L770 150 M820 40 L870 150" stroke="#0a0806" stroke-width="3" fill="none"/><circle cx="820" cy="38" r="3" fill="#a8462a"/>' : ''}
    <path d="M160 252 L545 104 L930 252Z" fill="url(#hvShingle)" stroke="#070605" stroke-width="6" stroke-linejoin="round"/>
    <path d="M330 220 h430 l-215 -86z" fill="#120f0c" opacity=".55"/>
    <!-- rooms -->
    <rect x="196" y="256" width="698" height="174" fill="url(#hvPlank)"/>
    <rect x="196" y="444" width="698" height="170" fill="url(#hvPlank2)"/>
    ${lamp(330, 300, 150)}${lamp(560, 300, 110)}${lamp(780, 300, 130)}${lamp(300, 480, 140)}${lamp(560, 480, 120)}${lamp(760, 480, 130)}
    <rect x="196" y="256" width="698" height="174" fill="url(#hvShade)"/><rect x="196" y="444" width="698" height="170" fill="url(#hvShade)"/>
    <!-- windows (boarded) -->
    <g stroke="#070605" stroke-width="3"><rect x="590" y="290" width="54" height="64" fill="#2b3640"/><rect x="250" y="476" width="50" height="58" fill="#2b3640"/><rect x="684" y="292" width="52" height="60" fill="#2b3640"/></g>
    <g stroke="#3a2f24" stroke-width="9"><path d="M586 308 L648 330 M586 336 L648 318"/><path d="M246 492 L304 516"/><path d="M680 306 L740 336"/></g>
    <!-- hanging bulbs -->
    <g stroke="#0a0806" stroke-width="2"><path d="M330 256 v22 M560 256 v18 M780 256 v20 M300 444 v20 M560 444 v18 M760 444 v20"/></g>
    <g fill="#f3c27a"><circle cx="330" cy="282" r="5"/><circle cx="560" cy="278" r="4"/><circle cx="780" cy="280" r="5"/><circle cx="300" cy="468" r="5"/><circle cx="560" cy="466" r="4"/><circle cx="760" cy="468" r="5"/></g>
    <!-- beams and floors -->
    <g fill="#16110d" stroke="#070605" stroke-width="3">
      <rect x="462" y="256" width="10" height="174"/><rect x="658" y="256" width="10" height="174"/><rect x="446" y="444" width="10" height="170"/>
      <rect x="176" y="428" width="738" height="18"/><rect x="176" y="612" width="738" height="16"/>
      <rect x="178" y="250" width="20" height="380"/><rect x="892" y="250" width="20" height="270"/><rect x="176" y="244" width="738" height="14"/>
    </g>
    <path d="M912 520 h22 v108 h-22z" fill="#0d0b09"/><path d="M912 628 h40 v-6 h-34z" fill="#2a2119" stroke="#070605" stroke-width="2"/>
  </svg>`;
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
    <span class="hv-label ${LABEL_DY[st.id] ? '' : 'above'}" style="left:${st.x + st.w / 2}px;top:${st.y + LABEL_DY[st.id]}px"><span class="hv-lab">${dot ? '<i class="hv-dot"></i>' : ''}${ico(st.icon, '', 'sm')}<b>${esc(st.name)}</b><span class="hv-sum">${esc(summary(st))}</span>${assign}</span></span>
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
export function bindHouse(ctx: HouseCtx) { ctxRef = ctx; }
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
        <details class="fold hv-morning"><summary><span class="t-s">This morning</span> <span class="t-xs">${ctx.report.length}</span></summary><div class="fold-body">${ctx.report.length ? ctx.report.map((l) => `<p class="t-s">${esc(l)}</p>`).join('') : '<p class="t-s">A quiet morning.</p>'}</div></details>
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
    if (moved) panel.classList.add('enter');
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
  mountRigs(wrap);
}
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// ---------------------------------------------------------------- people as rigs
interface Body { rig: Rig | null; cv: HTMLCanvasElement; fb: HTMLImageElement; sprite: string; next: number }
const bodies = new Map<string, Body>();
const CV_W = 110, CV_H = 176, DPR = 2;
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
