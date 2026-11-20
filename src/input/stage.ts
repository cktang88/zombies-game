// The night / run stage around the 1280×720 canvas: portrait phones, touch, and the synthetic
// input the gamepad and the on-screen buttons send.
//
// - Portrait phone: a "turn your phone" prompt with two ways on: play sideways (the playfield is
//   rotated 90° so it fills the tall screen; turn the phone and it reads as landscape) or play small.
//   The choice is remembered per browser ('vessey-portrait-v1'); turning to landscape undoes the turn.
// - While rotated, the canvas's getBoundingClientRect is replaced with the unrotated rect and real
//   pointer coordinates are turned to match, so battle.ts / expedition.ts map input unchanged.
// - Touch on the canvas becomes mouse events (aim + fire), following one finger, so a thumb on an
//   on-screen button never steals the aim.
// - On-screen buttons (touch devices): reload / duck / next gun / focus / pause at the wall; walk,
//   search, reload, swing, shove, pause on runs. They press the bound keys (ui/keys.ts).

import { keyOf } from '../ui/keys';

export const LW = 1280, LH = 720;
export type StageCtx = 'night' | 'run';

const mine = new WeakSet<Event>(); // events this module dispatched (the interceptors let them through)
/** The crosshair in canvas coordinates, as last sent or seen. */
export const aim = { x: 800, y: 500 };

let cur: { stage: HTMLElement; pf: HTMLElement; canvas: HTMLCanvasElement; ctx: StageCtx } | null = null;
let rotated = false;

/** The stage in play, if it is still on the page. */
export function current() {
  if (cur && !cur.stage.isConnected) cur = null;
  return cur;
}

// ---- synthetic input
/** Press or release a key (as the KeyboardEvent.key the bindings expect). Sent to the focused
 *  element so the pause menu's capture handler on window still sees it first. */
export function sendKey(type: 'keydown' | 'keyup', key: string, shift = false) {
  const code = key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key === ' ' ? 'Space' : '') : key;
  const e = new KeyboardEvent(type, { key: key.length === 1 && shift ? key.toUpperCase() : key, code, shiftKey: shift, bubbles: true, cancelable: true });
  ((document.activeElement as HTMLElement | null) ?? document.body).dispatchEvent(e);
}
/** Press or release a bound action's key. */
export function sendAction(type: 'keydown' | 'keyup', id: string) { sendKey(type, keyOf(id)); }

/** A mouse event on the canvas at canvas coordinates (default: the crosshair). */
export function sendMouse(type: 'mousemove' | 'mousedown' | 'mouseup', button = 0, x = aim.x, y = aim.y) {
  const s = current();
  if (!s) return;
  aim.x = Math.max(0, Math.min(LW, x));
  aim.y = Math.max(0, Math.min(LH, y));
  const r = s.canvas.getBoundingClientRect();
  const e = new MouseEvent(type, {
    clientX: r.left + (aim.x / LW) * r.width, clientY: r.top + (aim.y / LH) * r.height,
    button, buttons: type === 'mouseup' ? 0 : 1 << (button === 2 ? 1 : button === 1 ? 2 : 0), bubbles: true, cancelable: true,
  });
  mine.add(e);
  s.canvas.dispatchEvent(e);
}

// ---- rotation
function portrait() { return innerHeight > innerWidth && innerWidth < 900; }
function choice(): string | null { try { return localStorage.getItem('vessey-portrait-v1'); } catch { return null; } }
function remember(v: string) { try { localStorage.setItem('vessey-portrait-v1', v); } catch { /* ignore */ } }

function virtualRect(pf: HTMLElement) {
  const b = HTMLElement.prototype.getBoundingClientRect.call(pf);
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const w = pf.offsetWidth, h = pf.offsetHeight;
  return { cx, cy, rect: new DOMRect(cx - w / 2, cy - h / 2, w, h) };
}
/** A screen point → the client point the (unrotated) canvas expects. */
function unturn(px: number, py: number): [number, number] {
  const s = current();
  if (!s || !rotated) return [px, py];
  const { cx, cy } = virtualRect(s.pf);
  // rotate(90deg) turns a local offset (u, v) into the screen offset (-v, u)
  return [cx + (py - cy), cy - (px - cx)];
}
function setRotated(on: boolean) {
  const s = current();
  if (!s) return;
  rotated = on;
  s.stage.classList.toggle('rot', on);
  if (on) s.canvas.getBoundingClientRect = () => virtualRect(s.pf).rect;
  else delete (s.canvas as { getBoundingClientRect?: unknown }).getBoundingClientRect;
}

function prompt(s: NonNullable<typeof cur>) {
  if (s.stage.querySelector('.rotprompt')) return;
  const d = document.createElement('div');
  d.className = 'rotprompt';
  d.setAttribute('role', 'dialog');
  d.innerHTML = `<div class="rotbox">
    <div class="rotphone" aria-hidden="true"></div>
    <h2>Turn your phone sideways</h2>
    <p>${s.ctx === 'run' ? 'The street is wide. Held upright it shrinks to a third.' : 'The road is wide. Held upright the wall shrinks to a third.'}</p>
    <button class="go" data-rot="rotate">Play sideways</button>
    <button data-rot="small">Play small, upright</button>
    <p class="dim small">With rotation locked, "Play sideways" turns the ${s.ctx === 'run' ? 'street' : 'night'} for you: just turn the phone.</p>
  </div>`;
  d.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-rot]') as HTMLElement | null;
    if (!b) return;
    remember(b.dataset.rot!);
    d.remove();
    layout();
  });
  s.stage.appendChild(d);
  // the night waits under the pause menu while the player decides
  if (!document.querySelector('.overlay.pause')) sendKey('keydown', 'Escape');
}

function layout() {
  const s = current();
  if (!s) { removeEventListener('resize', layout); return; }
  const p = portrait();
  const c = choice();
  if (!p) s.stage.querySelector('.rotprompt')?.remove();
  setRotated(p && c === 'rotate');
  if (p && !c) prompt(s);
}

// ---- pointer → canvas
function hook(s: NonNullable<typeof cur>) {
  const { stage, canvas } = s;
  let finger: number | null = null;
  const toLogical = (px: number, py: number) => {
    const [vx, vy] = unturn(px, py);
    const r = canvas.getBoundingClientRect();
    return [((vx - r.left) / r.width) * LW, ((vy - r.top) / r.height) * LH];
  };
  const onTouch = (e: TouchEvent) => {
    if (e.target !== canvas) return;
    e.preventDefault();
    e.stopPropagation();
    for (const t of Array.from(e.changedTouches)) {
      if (e.type === 'touchstart' && finger === null) finger = t.identifier;
      if (t.identifier !== finger) continue;
      const [x, y] = toLogical(t.clientX, t.clientY);
      if (e.type === 'touchstart') { sendMouse('mousemove', 0, x, y); sendMouse('mousedown', 0, x, y); }
      else if (e.type === 'touchmove') sendMouse('mousemove', 0, x, y);
      else { sendMouse('mouseup', 0, x, y); finger = null; }
    }
    touchUi(s);
  };
  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) stage.addEventListener(t, onTouch as EventListener, { capture: true, passive: false });
  const onMouse = (e: MouseEvent) => {
    if (e.target !== canvas || mine.has(e)) return;
    const [x, y] = toLogical(e.clientX, e.clientY);
    if (!rotated) { aim.x = x; aim.y = y; return; } // unrotated: the canvas reads it as it is
    e.stopPropagation();
    sendMouse(e.type as 'mousemove', e.button, x, y);
  };
  for (const t of ['mousemove', 'mousedown', 'mouseup']) stage.addEventListener(t, onMouse as EventListener, true);
}

// ---- on-screen buttons
type Btn = { label: string; cls: string; act: string; hold?: boolean; aria: string };
const NIGHT_BTNS: Btn[] = [
  { label: 'Duck', cls: 'l1', act: 'night.duck', hold: true, aria: 'Duck (hold)' },
  { label: 'Focus', cls: 'l2', act: '@alt', hold: true, aria: 'Focus (hold)' },
  { label: 'Reload', cls: 'r1', act: 'night.reload', hold: true, aria: 'Reload (hold: speed reload)' },
  { label: 'Gun', cls: 'r2', act: 'night.weapon', aria: 'Next gun' },
  // a firebomb lands where the last tap aimed; a rally banked from a headshot streak (no keys on a phone)
  { label: 'Bomb', cls: 'r3', act: 'night.firebomb', aria: 'Throw a firebomb where you last aimed' },
  { label: 'Rally', cls: 'r4', act: 'night.rally', aria: 'Rally the line' },
  { label: 'II', cls: 'tp', act: '@pause', aria: 'Pause' },
];
const RUN_BTNS: Btn[] = [
  { label: '◀', cls: 'w1', act: 'run.left', hold: true, aria: 'Walk left' },
  { label: '▶', cls: 'w2', act: 'run.right', hold: true, aria: 'Walk right' },
  { label: 'Reload', cls: 'r1', act: 'run.reload', aria: 'Reload' },
  { label: 'Search', cls: 'r2', act: 'run.search', hold: true, aria: 'Search / revive (hold)' },
  { label: 'Swing', cls: 'r3', act: 'run.swing', hold: true, aria: 'Swing' },
  { label: 'Shove', cls: 'r4', act: 'run.shove', aria: 'Shove' },
  { label: 'II', cls: 'tp', act: '@pause', aria: 'Pause' },
];
function press(act: string, down: boolean) {
  if (act === '@pause') { if (down) sendKey('keydown', 'Escape'); return; }
  if (act === '@alt') { sendMouse(down ? 'mousedown' : 'mouseup', 2); return; }
  sendAction(down ? 'keydown' : 'keyup', act);
}
function touchUi(s: NonNullable<typeof cur>) {
  if (s.pf.querySelector('.tbtns-pad')) return;
  const wrap = document.createElement('div');
  wrap.className = 'tbtns-pad';
  for (const b of s.ctx === 'night' ? NIGHT_BTNS : RUN_BTNS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tb ${b.cls}`;
    el.textContent = b.label;
    el.setAttribute('aria-label', b.aria);
    let held = false;
    const up = () => { if (!held) return; held = false; el.classList.remove('on'); press(b.act, false); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      held = true;
      el.classList.add('on');
      press(b.act, true);
      if (!b.hold) up();
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    wrap.appendChild(el);
  }
  s.pf.appendChild(wrap);
}
export function touchDevice() {
  try { return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/** main.ts: after the Battle / Expedition is built on the stage's canvas. */
export function mountStage(stage: HTMLElement, ctx: StageCtx) {
  const canvas = stage.querySelector('canvas')!;
  const pf = canvas.parentElement as HTMLElement;
  stage.dataset.ctx = ctx;
  cur = { stage, pf, canvas, ctx };
  rotated = false;
  aim.x = ctx === 'night' ? 800 : 900; aim.y = 500; // where Battle / Expedition start the crosshair
  hook(cur);
  if (touchDevice()) touchUi(cur);
  removeEventListener('resize', layout);
  addEventListener('resize', layout);
  layout();
}
