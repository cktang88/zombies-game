// Shared canvas-HUD pieces for the night and the run: keycap glyphs, small-caps labels, a
// one-line message ticker, and the full key sheet shown while a key is held.
// Type scale: BIG numbers (mag, wall, clock) · body 13 · small caps 13 (labels) · keycap 13. Nothing under 13.
import { keyLabel, keyOf } from '../ui/keys';
import { getSettings } from '../ui/settings';
import { img } from '../assets';

export const FONT = '"Special Elite", monospace';
export const INK = '#e8dcc0';
export const DIM = '#a89c84';
export const FAINT = '#8a7e66';

/**
 * Where the night's weapon panel sits: top right, under the road ribbon, clear of the lanes (at
 * the bottom right it covered the near lane's spawn edge). `rx` is the panel's right reference
 * (the old W), `hb` its bottom reference (the old H): the panel spans hb-92 … hb-18. On touch it
 * steps left of the pause button.
 */
export function weaponPanel(W: number, touch: boolean): { rx: number; hb: number } {
  return { rx: W - (touch ? 96 : 0), hb: 46 + 92 };
}

/** The label printed on a keycap for a bound action ('R', 'Space'); a literal ('RMB', '1-9') passes through. */
export function capOf(id: string): string { return id.includes('.') ? keyLabel(keyOf(id)) : id; }

/** One keycap glyph: a small rounded key with its letter. Returns the width drawn. */
export function keycap(c: CanvasRenderingContext2D, label: string, x: number, y: number, o: { size?: number; alpha?: number; hot?: boolean } = {}): number {
  const s = o.size ?? 13;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.font = `${s}px ${FONT}`;
  const tw = c.measureText(label).width;
  const w = Math.max(s + 6, tw + 8), h = s + 6;
  c.fillStyle = o.hot ? 'rgba(70,56,28,0.9)' : 'rgba(18,16,14,0.85)';
  c.strokeStyle = o.hot ? '#e0c070' : 'rgba(217,205,176,0.55)';
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(x + 0.5, y - h + 3.5, w - 1, h - 1, 3);
  c.fill(); c.stroke();
  // the key's lower lip
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(x + 2, y + 1, w - 4, 1.5);
  c.fillStyle = o.hot ? '#f4e2b0' : '#e2d6b8';
  c.textAlign = 'center';
  c.fillText(label, x + w / 2, y - 1);
  c.restore();
  return w;
}

/** Small-caps label: 13px, letter-spaced, upper case. Returns its width. */
export function caps(c: CanvasRenderingContext2D, text: string, x: number, y: number, color = DIM, align: CanvasTextAlign = 'left', size = 13): number {
  c.save();
  c.font = `${size}px ${FONT}`;
  const t = text.toUpperCase();
  try { (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '1px'; } catch { /* older canvas */ }
  const w = c.measureText(t).width;
  c.textAlign = align;
  c.fillStyle = color;
  c.fillText(t, x, y);
  c.restore();
  return w;
}

export type Hint = { key: string; label: string; hot?: boolean; icon?: string; n?: number };

/** A row of keycap chips: [R] reload  [H] nest. Drawn left to right (or right to left with align 'right'). */
export function hintRow(c: CanvasRenderingContext2D, hints: Hint[], x: number, y: number, align: 'left' | 'center' | 'right' = 'left', alpha = 1): number {
  c.save();
  c.globalAlpha = alpha;
  c.font = `13px ${FONT}`;
  const parts = hints.map((h) => {
    c.font = `13px ${FONT}`;
    const lw = c.measureText(h.label).width;
    c.font = `13px ${FONT}`;
    const kw = Math.max(16, c.measureText(capOf(h.key)).width + 8);
    return { h, w: kw + 5 + (h.icon ? 18 : 0) + lw + (h.n !== undefined ? 16 : 0) };
  });
  const gap = 14;
  const total = parts.reduce((a, p) => a + p.w, 0) + gap * Math.max(0, parts.length - 1);
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 3;
  for (const p of parts) {
    let px = cx + keycap(c, capOf(p.h.key), cx, y, { hot: p.h.hot }) + 5;
    const ic = p.h.icon ? img(p.h.icon) : undefined;
    if (ic) { const ih = 14, iw = Math.min(16, (ic.width / ic.height) * ih); c.drawImage(ic, px, y - 11, iw, ih); px += 18; } else if (p.h.icon) px += 18;
    c.font = `13px ${FONT}`;
    c.textAlign = 'left';
    c.fillStyle = p.h.hot ? '#ecd9a2' : '#cfc3a6';
    c.fillText(p.h.label, px, y);
    if (p.h.n !== undefined) { c.fillStyle = INK; c.fillText(`${p.h.n}`, px + c.measureText(p.h.label).width + 4, y); }
    cx += p.w + gap;
  }
  c.restore();
  return total;
}

/** The player's choice to see key hints at all (a Settings toggle, if the build has one). */
export function keyHintsOn(): boolean {
  const s = getSettings() as unknown as { keyHints?: boolean };
  return s.keyHints !== false;
}

/**
 * The full key sheet, grouped in columns of keycap rows. Shown while the help key is held or the
 * game is paused; otherwise the HUD carries only the hint that matters now.
 */
export function keySheet(c: CanvasRenderingContext2D, W: number, H: number, groups: { title: string; rows: Hint[] }[]) {
  c.save();
  const colW = 200, rowH = 20, pad = 18;
  const rows = Math.max(...groups.map((g) => g.rows.length));
  const w = groups.length * colW + pad * 2 - 20, h = rows * rowH + 50;
  const x0 = (W - w) / 2, y0 = H - h - 40;
  c.fillStyle = 'rgba(10,9,8,0.86)';
  c.strokeStyle = 'rgba(217,205,176,0.25)';
  c.beginPath(); c.roundRect(x0, y0, w, h, 6); c.fill(); c.stroke();
  groups.forEach((g, i) => {
    const x = x0 + pad + i * colW;
    caps(c, g.title, x, y0 + 22, '#c9a95a');
    g.rows.forEach((r, j) => hintRow(c, [r], x, y0 + 44 + j * rowH));
  });
  c.restore();
}

/** The one HUD box: every corner panel (wall, nerve, nests, weapon, road, run status) uses it. */
export const PANEL_FILL = 'rgba(10,9,8,0.6)';
export function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.save();
  c.fillStyle = PANEL_FILL;
  c.strokeStyle = 'rgba(217,205,176,0.12)';
  c.lineWidth = 1;
  c.beginPath(); c.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 4); c.fill(); c.stroke();
  c.restore();
}

/**
 * The one word-over-a-body style: 13 px (16 for a big moment), centred, on a faint dark backing,
 * kept on screen. Callers set globalAlpha for fades. Returns the width drawn.
 */
export function worldLabel(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, big = false): number {
  c.font = `${big ? 16 : 13}px ${FONT}`;
  c.textAlign = 'center';
  const tw = c.measureText(text).width;
  const cx = Math.min(1280 - 6 - tw / 2, Math.max(6 + tw / 2, x));
  const h = big ? 18 : 15;
  c.fillStyle = 'rgba(8,8,10,0.5)';
  c.fillRect(cx - tw / 2 - 4, y - h + 3, tw + 8, h + 1);
  c.fillStyle = color;
  c.fillText(text, cx, y);
  return tw;
}

/** Status dot: a filled circle with a dark ring, optionally pulsing. */
export function dot(c: CanvasRenderingContext2D, x: number, y: number, color: string, r = 3, pulse = 0) {
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.7)';
  c.beginPath(); c.arc(x, y, r + 1.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = color;
  c.globalAlpha = 1 - pulse * 0.4;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.restore();
}

/**
 * One line of news at a time, top centre. New lines queue behind the current one (a repeat is
 * dropped); each fades in and out, and a long queue hurries the line on screen.
 */
export class Ticker {
  q: { text: string; life: number; max: number }[] = [];
  push(text: string, life = 4) {
    if (this.q.some((m) => m.text === text)) return;
    this.q.push({ text, life: Math.min(5, life), max: Math.min(5, life) });
    if (this.q.length > 4) this.q.splice(1, 1); // the oldest waiting line goes
  }
  tick(dt: number) {
    const m = this.q[0];
    if (!m) return;
    m.life -= dt * (this.q.length > 2 ? 2 : 1);
    if (m.life <= 0) this.q.shift();
  }
  get length() { return this.q.length; }
  draw(c: CanvasRenderingContext2D, W: number, y: number, size = 16) {
    const m = this.q[0];
    if (!m) return;
    const a = Math.min(1, (m.max - m.life) * 5, m.life * 2);
    c.save();
    c.font = `${size}px ${FONT}`;
    c.textAlign = 'center';
    const tw = Math.min(W - 60, c.measureText(m.text).width);
    c.fillStyle = `rgba(10,9,8,${0.55 * a})`;
    c.beginPath(); c.roundRect(W / 2 - tw / 2 - 12, y - size, tw + 24, size + 10, 4); c.fill();
    c.fillStyle = `rgba(236,224,196,${a})`;
    c.fillText(m.text, W / 2, y, W - 60);
    if (this.q.length > 1) { c.fillStyle = `rgba(200,180,140,${0.6 * a})`; c.font = `13px ${FONT}`; c.fillText('•'.repeat(Math.min(3, this.q.length - 1)), W / 2, y + 12); }
    c.restore();
  }
}

/** A touch screen with no keyboard to speak of: keycaps mean nothing there. */
export function coarsePointer(): boolean {
  try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch { return false; }
}
