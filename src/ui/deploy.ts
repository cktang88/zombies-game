// Pre-night deployment planner: a side-view strip of Ferry Road with 4 lanes where the
// player places trap kits from stock at dusk. Self-contained (no game state access):
//   renderDeploy(root, { stock, laneCount: 4, roadMinX, roadMaxX, wallX, placementsAllowed, onDone })
// Output: Placement[] = { trap, x (battle screen px), lane (0 far .. laneCount-1 near) }.
// Consumption by the battle is specified in docs/research/08-traps.md §Integration.
import './deploy.css';
import { TRAPS, type Placement, type TrapDef, placementProblem, combos, trapHalfWidth } from '../data/traps';
import { spriteUrl } from '../assets';

export type { Placement };

export interface DeployOpts {
  stock: Record<string, number>; // kits on hand by TRAPS key (G.trapStock)
  laneCount?: number; // default 4
  roadMinX: number; // leftmost battle x a trap may sit at (usually wallX)
  roadMaxX: number; // rightmost battle x (spawns come in past this)
  wallX: number; // battle x of the wall's front face
  placementsAllowed: number; // placementsAllowed(best Building skill) from data/traps.ts
  initial?: Placement[]; // re-open with last night's plan
  title?: string;
  onDone(placements: Placement[]): void;
  onCancel?(): void;
}

export interface DeployHandle {
  get(): Placement[];
  destroy(): void;
}

const LANE_H = 50;
const SCENE_H = 116;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TRIGGER_LABEL: Record<TrapDef['trigger'], string> = {
  step: 'goes off underfoot',
  shot: 'you shoot it to set it off',
  timer: 'lit at dusk, burns down',
  manual: 'pulled by hand',
  always: 'works all night',
};

export function renderDeploy(root: HTMLElement, opts: DeployOpts): DeployHandle {
  const lanes = opts.laneCount ?? 4;
  const { wallX, roadMaxX } = opts;
  const roadMinX = Math.max(opts.roadMinX, wallX);
  const viewMin = wallX - 70; // a little of the yard behind the wall
  const viewMax = roadMaxX + 30;
  const span = viewMax - viewMin;
  const placed: Placement[] = (opts.initial ?? []).filter((p) => TRAPS[p.trap]).map((p) => ({ ...p }));
  let kit: string | null = null; // palette selection for tap-to-place
  let sel = -1; // selected placed token
  let msg = '';
  let k = 1; // css px per battle px
  let drag: null | { kind: 'new' | 'move'; trap: string; idx: number; id: number; sx: number; sy: number; moved: boolean; ghost: HTMLElement; at: Placement | null } = null;

  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'dep';
  el.tabIndex = -1;
  root.appendChild(el);
  el.innerHTML = `
    <header class="dep-h"><h2>${esc(opts.title ?? 'Dusk. The road.')}</h2><span class="dep-count"></span></header>
    <p class="dep-help">Pick a kit, then tap a lane, or drag it onto the road. Drag a placed trap to move it; tap it to see it or take it up.</p>
    <div class="dep-kits" role="toolbar" aria-label="Trap kits"></div>
    <div class="dep-scroll"><div class="dep-strip">
      <div class="dep-scene"><img class="dep-wallimg" alt="" draggable="false"><div class="dep-pegs"></div></div>
      <div class="dep-road" aria-label="Ferry Road, four lanes"></div>
    </div></div>
    <div class="dep-msg" aria-live="polite"></div>
    <div class="dep-info"></div>
    <div class="dep-sum"></div>
    <footer class="dep-f"><button type="button" class="dep-clear">Take all up</button>${opts.onCancel ? '<button type="button" class="dep-cancel">Back</button>' : ''}<button type="button" class="dep-done">Set them. Night falls.</button></footer>`;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const kitsEl = $('.dep-kits'), scroll = $('.dep-scroll'), strip = $('.dep-strip'), scene = $('.dep-scene'), road = $('.dep-road');
  const msgEl = $('.dep-msg'), infoEl = $('.dep-info'), sumEl = $('.dep-sum'), countEl = $('.dep-count'), pegs = $('.dep-pegs');
  ($('.dep-wallimg') as HTMLImageElement).src = spriteUrl('barricade');
  road.style.height = `${lanes * LANE_H}px`;
  scene.style.height = `${SCENE_H}px`;
  scene.style.backgroundImage = `linear-gradient(rgba(12,14,22,.45), rgba(12,14,22,.25) 60%, rgba(10,10,12,.8)), url("${spriteUrl('bg_mid')}")`;

  const left = (x: number) => (x - viewMin) * k;
  const avail = (id: string) => (opts.stock[id] ?? 0) - placed.filter((p) => p.trap === id).length;
  const active = () => (drag ? drag.trap : kit ?? (sel >= 0 ? placed[sel]?.trap : null));

  function layout() {
    const w = scroll.clientWidth || 1200;
    k = Math.max(0.85, Math.min(1.5, w / span));
    strip.style.width = `${Math.round(span * k)}px`;
    scene.style.backgroundSize = `auto, ${1600 * k}px ${740 * k}px`;
    // battle draws bg_mid at (-160, -20) 1600×740; line battle y=616 (lane top) up with the scene's bottom
    scene.style.backgroundPosition = `0 0, ${(-160 - viewMin) * k}px ${SCENE_H - (616 + 20) * k}px`;
    const wi = $('.dep-wallimg');
    wi.style.left = `${left(wallX) - 64}px`;
    let h = '';
    for (let d = 100; wallX + d <= viewMax - 10; d += 100) h += `<span style="left:${left(wallX + d)}px">${d}</span>`;
    pegs.innerHTML = h;
    draw();
  }

  function pointToPlacement(cx: number, cy: number, trap: string): Placement | null {
    const r = road.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top - 30 || cy > r.bottom + 30) return null;
    const x = Math.round((viewMin + (cx - r.left) / k) / 5) * 5;
    const lane = Math.max(0, Math.min(lanes - 1, Math.floor((cy - r.top) / LANE_H)));
    const t = TRAPS[trap];
    // wall traps snap onto the wall face
    const xs = t.layer === 'wall' ? Math.max(wallX + t.minD, Math.min(wallX + t.maxD, x)) : x;
    return { trap, x: xs, lane };
  }

  function problem(p: Placement, ignore = -1): string | null {
    if (p.x < roadMinX && TRAPS[p.trap].layer !== 'wall') return 'behind the wall';
    return placementProblem(p, placed.filter((_, i) => i !== ignore), wallX, roadMaxX);
  }

  function tokenHtml(p: Placement, i: number, cls = ''): string {
    const t = TRAPS[p.trap];
    const hw = trapHalfWidth(t) * k;
    const top = t.area.allLanes ? 0 : p.lane * LANE_H;
    const h = t.area.allLanes ? lanes * LANE_H : LANE_H;
    const w = Math.max(30, hw * 2);
    const band = t.area.length ? `<i class="dep-band ${t.layer}" style="width:${hw * 2}px"></i>` : '';
    return `<div class="dep-tok ${t.layer}${t.area.allLanes ? ' all' : ''}${i === sel ? ' sel' : ''} ${cls}" data-i="${i}" style="left:${left(p.x) - w / 2}px;top:${top}px;width:${w}px;height:${h}px" title="${esc(t.name)}">${band}<img src="${spriteUrl(t.icon)}" alt="${esc(t.name)}" draggable="false"></div>`;
  }

  function zoneHtml(trap: string): string {
    const t = TRAPS[trap];
    const a = Math.max(viewMin, wallX + t.minD), b = Math.min(roadMaxX, wallX + t.maxD);
    return `<div class="dep-zone bad" style="left:0;width:${left(a)}px"></div><div class="dep-zone ok" style="left:${left(a)}px;width:${Math.max(0, left(b) - left(a))}px"></div><div class="dep-zone bad" style="left:${left(b)}px;right:0"></div>`;
  }

  function reachHtml(p: Placement): string {
    const t = TRAPS[p.trap];
    const r = t.area.radius ?? t.fx.lure?.r ?? t.fx.light?.r;
    if (t.area.cone) return `<div class="dep-reach cone" style="left:${left(p.x)}px;width:${t.area.cone.reach * k}px"></div>`;
    if (!r || t.area.length) return '';
    return `<div class="dep-reach" style="left:${left(p.x - r)}px;width:${2 * r * k}px"></div>`;
  }

  function draw() {
    const act = active();
    let h = '';
    for (let l = 0; l < lanes; l++) h += `<div class="dep-lane" style="top:${l * LANE_H}px;height:${LANE_H}px"><span>${l === 0 ? 'far' : l === lanes - 1 ? 'near' : ''}</span></div>`;
    h += `<div class="dep-behind" style="width:${left(wallX)}px"></div>`;
    h += `<div class="dep-pulper" style="left:${left(wallX + 180)}px" title="Pulper line: kill them past here"></div>`;
    for (let d = 100; wallX + d <= viewMax - 10; d += 100) h += `<div class="dep-peg" style="left:${left(wallX + d)}px"></div>`;
    if (act) h += zoneHtml(act);
    if (sel >= 0 && placed[sel]) h += reachHtml(placed[sel]);
    placed.forEach((p, i) => { if (!(drag?.kind === 'move' && drag.idx === i && drag.moved)) h += tokenHtml(p, i); });
    road.innerHTML = h;
    // palette
    const ids = Object.keys(TRAPS).filter((id) => (opts.stock[id] ?? 0) > 0);
    kitsEl.innerHTML = ids.length
      ? ids.map((id) => { const n = avail(id); return `<button type="button" class="dep-kit${kit === id ? ' on' : ''}" data-kit="${id}" ${n <= 0 ? 'aria-disabled="true"' : ''} title="${esc(TRAPS[id].niche)}"><img src="${spriteUrl(TRAPS[id].icon)}" alt="" draggable="false"><span>${esc(TRAPS[id].name)}</span><b>${n}</b></button>`; }).join('')
      : '<p class="dep-none">No kits made. Traps are crafted at the workbench, forge, still and generator.</p>';
    countEl.textContent = `${placed.length} / ${opts.placementsAllowed} placed`;
    countEl.classList.toggle('full', placed.length >= opts.placementsAllowed);
    msgEl.textContent = msg;
    // info card
    const it = act ? TRAPS[act] : null;
    infoEl.innerHTML = it ? `<img src="${spriteUrl(it.icon)}" alt=""><div><b>${esc(it.name)}</b> <span class="dep-niche">${esc(it.niche)}</span>
      <p>${esc(it.desc)}</p>
      <p class="dep-meta">${esc(TRIGGER_LABEL[it.trigger])}${it.key ? ` [${it.key}]` : ''}${it.area.allLanes ? ' · all lanes' : ' · one lane'} · ${it.layer === 'wall' ? 'at the wall only' : `${it.minD}–${it.maxD} out`} · ${it.noise >= 8 ? 'loud' : it.noise >= 3 ? 'audible' : 'quiet'} · ${it.retrieve === 'yes' ? 'comes back at dawn' : it.retrieve === 'partial' ? 'may come back' : 'used up'}${it.upkeep ? ` · ${Object.entries(it.upkeep).map(([r, n]) => `${n} ${r}`).join(', ')} a night` : ''}</p>
      <p class="dep-counter"><b>Good on</b> ${it.good.join(', ') || '—'} · <b>poor on</b> ${it.bad.join(', ') || '—'}. ${esc(it.counter)}</p>
      ${sel >= 0 && !drag && placed[sel] ? '<button type="button" class="dep-remove">Take it up</button>' : ''}</div>` : '';
    // summary
    const cs = combos(placed);
    sumEl.innerHTML = placed.length ? `<h3>Tonight's road</h3><ol>${placed.map((p) => ({ p, d: p.x - wallX })).sort((a, b) => a.d - b.d).map(({ p, d }) => `<li>${esc(TRAPS[p.trap].name)} <span>${TRAPS[p.trap].layer === 'wall' ? 'at the wall' : `${d} out`}${TRAPS[p.trap].area.allLanes ? ', across the road' : `, lane ${p.lane + 1}`}</span></li>`).join('')}</ol>${cs.length ? `<ul class="dep-combos">${cs.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}` : '<h3>Tonight\'s road</h3><p class="dep-none">Nothing on the road yet.</p>';
  }

  function say(m: string) { msg = m; msgEl.textContent = m; }

  function tryPlace(p: Placement): boolean {
    if (placed.length >= opts.placementsAllowed) { say(`No more hands: ${opts.placementsAllowed} placements tonight. A better builder sets more.`); return false; }
    if (avail(p.trap) <= 0) { say(`No ${TRAPS[p.trap].name.toLowerCase()} kits left.`); return false; }
    const why = problem(p);
    if (why) { say(`${TRAPS[p.trap].name}: ${why}.`); return false; }
    placed.push(p);
    sel = placed.length - 1;
    if (avail(p.trap) <= 0) kit = null;
    say('');
    return true;
  }

  // ---------- pointer handling (mouse + touch through Pointer Events) ----------
  function startDrag(e: PointerEvent, kind: 'new' | 'move', trap: string, idx: number) {
    const ghost = document.createElement('div');
    ghost.className = 'dep-ghost';
    ghost.innerHTML = `<img src="${spriteUrl(TRAPS[trap].icon)}" alt=""><span></span>`;
    ghost.style.display = 'none';
    document.body.appendChild(ghost);
    drag = { kind, trap, idx, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, ghost, at: null };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 7) return;
    if (!drag.moved) { drag.moved = true; draw(); }
    e.preventDefault();
    const g = drag.ghost;
    g.style.display = 'block';
    g.style.left = `${e.clientX}px`;
    g.style.top = `${e.clientY}px`;
    const p = pointToPlacement(e.clientX, e.clientY, drag.trap);
    drag.at = p;
    const why = !p ? 'drop it on the road' : drag.kind === 'new' && placed.length >= opts.placementsAllowed ? 'no more placements' : problem(p, drag.kind === 'move' ? drag.idx : -1);
    g.classList.toggle('bad', !!why);
    (g.querySelector('span') as HTMLElement).textContent = why ?? (p ? `${p.x - wallX} out${TRAPS[drag.trap].area.allLanes ? '' : ` · lane ${p.lane + 1}`}` : '');
    // nudge the strip when dragging near its edges (phones)
    const r = scroll.getBoundingClientRect();
    if (e.clientX > r.right - 30) scroll.scrollLeft += 12;
    else if (e.clientX < r.left + 30) scroll.scrollLeft -= 12;
  }
  function endDrag() {
    if (!drag) return;
    drag.ghost.remove();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    drag = null;
  }
  function onCancel() { endDrag(); draw(); }
  function onUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    if (!d.moved) {
      // a click/tap: select
      if (d.kind === 'new') { kit = kit === d.trap ? null : d.trap; sel = -1; say(kit ? `${TRAPS[kit].name}: tap a lane to set it.` : ''); }
      else { sel = d.idx; kit = null; say(''); }
      endDrag(); draw();
      return;
    }
    const p = pointToPlacement(e.clientX, e.clientY, d.trap);
    if (d.kind === 'new') { if (p) tryPlace(p); else say(''); }
    else if (p) {
      const why = problem(p, d.idx);
      if (why) say(`${TRAPS[d.trap].name}: ${why}. Left where it was.`);
      else { placed[d.idx] = p; sel = d.idx; say(''); }
    } else { placed.splice(d.idx, 1); sel = -1; say(`${TRAPS[d.trap].name} taken up.`); }
    endDrag(); draw();
  }

  el.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const kb = t.closest('.dep-kit') as HTMLElement | null;
    if (kb) {
      const id = kb.dataset.kit!;
      if (avail(id) <= 0) { say(`No ${TRAPS[id].name.toLowerCase()} kits left.`); return; }
      e.preventDefault();
      startDrag(e, 'new', id, -1);
      return;
    }
    const tok = t.closest('.dep-tok') as HTMLElement | null;
    if (tok) {
      e.preventDefault();
      const i = Number(tok.dataset.i);
      startDrag(e, 'move', placed[i].trap, i);
      return;
    }
    if (t.closest('.dep-road')) roadDown = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  // a tap on the road (not a scroll) places the selected kit, or clears the selection
  let roadDown: { x: number; y: number; id: number } | null = null;
  road.addEventListener('pointerup', (e) => {
    if (!roadDown || roadDown.id !== e.pointerId || drag) return;
    const moved = Math.hypot(e.clientX - roadDown.x, e.clientY - roadDown.y) > 8;
    roadDown = null;
    if (moved) return;
    if (kit) { const p = pointToPlacement(e.clientX, e.clientY, kit); if (p) tryPlace(p); }
    else { sel = -1; say(''); }
    draw();
  });
  road.addEventListener('pointercancel', () => { roadDown = null; });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.dep-remove') && sel >= 0) { const n = TRAPS[placed[sel].trap].name; placed.splice(sel, 1); sel = -1; say(`${n} taken up.`); draw(); }
    else if (t.closest('.dep-clear')) { placed.length = 0; sel = -1; kit = null; say('Everything taken up.'); draw(); }
    else if (t.closest('.dep-done')) opts.onDone(placed.map((p) => ({ ...p })));
    else if (t.closest('.dep-cancel')) opts.onCancel?.();
  });
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { placed.splice(sel, 1); sel = -1; draw(); }
    else if (e.key === 'Escape') { kit = null; sel = -1; say(''); draw(); }
    else if (sel >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const p = placed[sel];
      const q = { ...p, x: p.x + (e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0), lane: Math.max(0, Math.min(lanes - 1, p.lane + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0))) };
      if (!problem(q, sel)) { placed[sel] = q; draw(); }
      e.preventDefault();
    }
  });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null;
  ro?.observe(scroll);
  layout();

  return {
    get: () => placed.map((p) => ({ ...p })),
    destroy() { endDrag(); ro?.disconnect(); root.innerHTML = ''; },
  };
}

/** Dev harness for deploy-test.html (not part of the game build). */
export function mountDeployTest(root: HTMLElement) {
  const out = document.createElement('pre');
  out.className = 'dep-testout';
  const stock: Record<string, number> = { nailbomb: 2, beartrap: 1, roofnails: 2, flare: 2, oil: 2, propane: 1, barrels: 1, tincan: 1, radio: 1, snare: 1, spikepit: 1, electric: 1, deadfall: 1, net: 1, sludge: 1, pipemine: 1, glass: 2 };
  const box = document.createElement('div');
  root.append(box, out);
  const h = renderDeploy(box, {
    stock, laneCount: 4, roadMinX: 372, roadMaxX: 1240, wallX: 372, placementsAllowed: 6,
    initial: [{ trap: 'oil', x: 700, lane: 1 }, { trap: 'tincan', x: 710, lane: 2 }],
    onDone: (ps) => { out.textContent = JSON.stringify(ps); },
  });
  (globalThis as unknown as { __deploy: DeployHandle }).__deploy = h;
}
