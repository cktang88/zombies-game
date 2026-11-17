// Gamepad: polls navigator.getGamepads() every frame and turns the first pad into the same input
// the keyboard and mouse give (the bindings live in ui/keys.ts: PAD, PAD_STICKS).
//
// At the wall / on a run: right stick moves the crosshair (synthetic mouse moves on the canvas),
// triggers are the mouse buttons, the rest press the bound keys. On runs the left stick walks.
// Anywhere else (the day ledger, menus, the pause menu): the D-pad / left stick moves focus between
// buttons, A clicks, B and Start are Esc.

import { PAD, type PadBind } from '../ui/keys';
import { current, sendKey, sendAction, sendMouse, aim, LW, LH } from './stage';

const DEAD = 0.18;
const AIM_SPEED = 1150; // canvas px per second at full tilt
let started = false;
let last = 0;
let prev: boolean[] = [];
let mode: 'game' | 'menu' = 'menu';
const held = new Map<string, () => void>(); // pressed inputs → their release
const known = new Set<string>();
let padName = '';

/** The connected pad's name, or '' (Settings shows it). */
export function padConnected() { return padName; }

function toast(text: string) {
  document.querySelector('.padtoast')?.remove();
  const d = document.createElement('div');
  d.className = 'padtoast';
  d.setAttribute('role', 'status');
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

function pads(): Gamepad | null {
  let list: (Gamepad | null)[] = [];
  try { list = Array.from(navigator.getGamepads?.() ?? []); } catch { /* not allowed here */ }
  return list.find((p) => p && p.connected) ?? null;
}

function releaseAll() { for (const f of held.values()) f(); held.clear(); }

function hold(tag: string, down: () => void, up: () => void) {
  if (held.has(tag)) return;
  down();
  held.set(tag, up);
}
function release(tag: string) { const f = held.get(tag); if (f) { held.delete(tag); f(); } }

function pressBind(b: PadBind) {
  const tag = `b${b.btn}`;
  switch (b.to) {
    case '@fire': return hold(tag, () => sendMouse('mousedown', 0), () => sendMouse('mouseup', 0));
    case '@alt': return hold(tag, () => sendMouse('mousedown', 2), () => sendMouse('mouseup', 2));
    case '@next': return hold(tag, () => sendKey('keydown', 'Tab'), () => sendKey('keyup', 'Tab'));
    case '@prev': return hold(tag, () => sendKey('keydown', 'Tab', true), () => sendKey('keyup', 'Tab', true));
    case '@pause': return hold(tag, () => { releaseAll(); sendKey('keydown', 'Escape'); }, () => {});
    default: return hold(tag, () => sendAction('keydown', b.to), () => sendAction('keyup', b.to));
  }
}

// ---- menus: focus moves between visible buttons, A clicks
function focusables(): HTMLElement[] {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.overlay, .rotprompt'));
  const root = overlays.sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0))[0] ?? document.body;
  return Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null && !el.closest('.tbtns-pad'));
}
function moveFocus(dx: number, dy: number) {
  const list = focusables();
  if (!list.length) return;
  const a = document.activeElement as HTMLElement | null;
  if (!a || !list.includes(a)) { list[0].focus(); return; }
  const r = a.getBoundingClientRect();
  const ax = r.left + r.width / 2, ay = r.top + r.height / 2;
  let best: HTMLElement | null = null, bd = Infinity;
  for (const el of list) {
    if (el === a) continue;
    const q = el.getBoundingClientRect();
    const ex = q.left + q.width / 2 - ax, ey = q.top + q.height / 2 - ay;
    const along = ex * dx + ey * dy;
    if (along <= 4) continue;
    const d = along + Math.abs(ex * dy - ey * dx) * 2.5;
    if (d < bd) { bd = d; best = el; }
  }
  if (!best) { const i = list.indexOf(a); best = list[(i + (dx + dy > 0 ? 1 : list.length - 1)) % list.length]; }
  best.focus();
  best.scrollIntoView?.({ block: 'nearest' });
}

function menuFrame(btn: boolean[], edge: (i: number) => boolean, p: Gamepad) {
  const lx = p.axes[0] ?? 0, ly = p.axes[1] ?? 0;
  const stick = Math.abs(lx) > 0.6 || Math.abs(ly) > 0.6;
  const dir = stick && !held.has('menustick') ? (Math.abs(lx) > Math.abs(ly) ? [Math.sign(lx), 0] : [0, Math.sign(ly)]) : null;
  if (stick) held.set('menustick', () => {}); else held.delete('menustick');
  if (edge(12)) moveFocus(0, -1);
  else if (edge(13)) moveFocus(0, 1);
  else if (edge(14)) moveFocus(-1, 0);
  else if (edge(15)) moveFocus(1, 0);
  else if (dir) moveFocus(dir[0], dir[1]);
  if (edge(0)) {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body) a.click(); else focusables()[0]?.focus();
  }
  if (edge(1) || edge(9)) sendKey('keydown', 'Escape');
  void btn;
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  const p = pads();
  if (!p) { if (padName) { padName = ''; releaseAll(); prev = []; } return; }
  if (!known.has(p.id)) { known.add(p.id); padName = p.id; toast(`Gamepad connected: ${p.id.replace(/\s*\(.*$/, '') || 'controller'}`); }
  padName = p.id;
  const btn = p.buttons.map((b) => b.pressed || b.value > 0.4);
  const edge = (i: number) => !!btn[i] && !prev[i];
  const s = current();
  const inMenu = !s || !!document.querySelector('.overlay, .rotprompt');
  const m = inMenu ? 'menu' : 'game';
  if (m !== mode) {
    if (m === 'menu') releaseAll();
    mode = m;
    // a button still down from the other mode does nothing until it is let go and pressed again
    prev = btn.slice();
    return;
  }
  if (inMenu) { menuFrame(btn, edge, p); prev = btn; return; }

  const binds = PAD[s!.ctx];
  for (const b of binds) {
    if (btn[b.btn] && !prev[b.btn]) pressBind(b);
    else if (!btn[b.btn] && prev[b.btn]) release(`b${b.btn}`);
  }
  // right stick: the crosshair
  const rx = p.axes[2] ?? 0, ry = p.axes[3] ?? 0;
  const mag = Math.hypot(rx, ry);
  if (mag > DEAD) {
    const k = (Math.min(1, (mag - DEAD) / (1 - DEAD)) ** 1.6) * AIM_SPEED * dt / mag;
    sendMouse('mousemove', 0, Math.max(0, Math.min(LW, aim.x + rx * k)), Math.max(0, Math.min(LH, aim.y + ry * k)));
  }
  // left stick walks on runs
  if (s!.ctx === 'run') {
    const lx = p.axes[0] ?? 0;
    if (lx < -0.35) hold('walkL', () => sendAction('keydown', 'run.left'), () => sendAction('keyup', 'run.left')); else release('walkL');
    if (lx > 0.35) hold('walkR', () => sendAction('keydown', 'run.right'), () => sendAction('keyup', 'run.right')); else release('walkR');
  }
  prev = btn;
}

/** main.ts, once at boot. */
export function startGamepad() {
  if (started || typeof navigator === 'undefined') return;
  started = true;
  addEventListener('gamepaddisconnected', () => { releaseAll(); toast('Gamepad disconnected'); known.clear(); });
  requestAnimationFrame(frame);
}
