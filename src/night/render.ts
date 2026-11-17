// Shared rendering helpers for the night battle and the daylight run
// (docs/research/04-depth-and-readability.md).
//
// Everything that needs ctx.filter happens here, at bake time, into cached offscreen
// canvases. Per-frame code only stamps them with drawImage.
import { img } from '../assets';

// ---------- depth ----------
export const HORIZON = 330; // vanishing line of the painted background (approx.)
export const REF_Y = 664; // feet y where scale == 1
/** Perspective scale for an actor whose feet are at y. */
export const depthScale = (y: number) => (y - HORIZON) / (REF_Y - HORIZON);

// ---------- canvases ----------
export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w));
  cv.height = Math.max(1, Math.ceil(h));
  return [cv, cv.getContext('2d')!];
}

// ---------- actor bakes ----------
/** Per-lane look: brightness, saturation, fog tint (source-atop α), outline px, rim α. */
export interface Look { b: number; s: number; fog: number; outline: number; rim?: number }
/** Crowd variants: [tint colour, tint α, brightness]. 0 neutral, 1 cold, 2 sickly. */
export const VARIANT_TINT: [string, number, number][] = [['#000', 0, 1], ['#5a6f8c', 0.1, 0.92], ['#8a8a4a', 0.08, 1.06]];
export const FOG_TINT = '#1b2333';
export const OUTLINE = '#050608';

export interface Baked { cv: HTMLCanvasElement; pad: number; h: number }
const cache = new Map<string, Baked>();
const silCache = new Map<string, HTMLCanvasElement>();

const lookKey = (l: Look) => `${l.b}|${l.s}|${l.fog}|${l.outline}`;

/**
 * A sprite baked at display height h: optional outline stamps (8 offsets), the sprite graded
 * by the look (and optional extra brightness/saturation multipliers), the fog tint and the
 * variant tint. `pad` px of transparent margin on every side (default: outline + 1).
 */
export function bakeSprite(
  sprite: string, h: number, look: Look, variant: number,
  o: { outline?: boolean; b?: number; s?: number; pad?: number } = {},
): Baked | null {
  const outline = o.outline !== false && look.outline > 0;
  const bm = o.b ?? 1, sm = o.s ?? 1;
  const pad = o.pad ?? Math.ceil(look.outline) + 1;
  const key = `${sprite}|${Math.round(h)}|${lookKey(look)}|${variant}|${outline ? 1 : 0}|${bm}|${sm}|${pad}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const im = img(sprite);
  if (!im) return null;
  const w = (im.width / im.height) * h;
  const [cv, x] = canvas(w + pad * 2, h + pad * 2);
  if (outline) stampOutline(x, sprite, pad, w, h, look.outline);
  const [tint, ta, vb] = VARIANT_TINT[variant] ?? VARIANT_TINT[0];
  x.filter = `brightness(${(look.b * vb * bm).toFixed(3)}) saturate(${(look.s * sm).toFixed(3)})`;
  x.drawImage(im, pad, pad, w, h);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-atop';
  if (look.fog) { x.globalAlpha = look.fog; x.fillStyle = FOG_TINT; x.fillRect(0, 0, cv.width, cv.height); }
  if (ta) { x.globalAlpha = ta; x.fillStyle = tint; x.fillRect(0, 0, cv.width, cv.height); }
  const b = { cv, pad, h };
  cache.set(key, b);
  return b;
}

function stampOutline(x: CanvasRenderingContext2D, sprite: string, pad: number, w: number, h: number, px: number) {
  const sil = silhouette(sprite, OUTLINE);
  if (!sil) return;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    x.drawImage(sil, pad + Math.cos(a) * px, pad + Math.sin(a) * px, w, h);
  }
}

/** Only the outline stamps, laid out like bakeSprite(…, {pad}) so the two align. */
export function bakeOutline(sprite: string, h: number, px: number, pad: number): HTMLCanvasElement | null {
  const key = `o|${sprite}|${Math.round(h)}|${px}|${pad}`;
  const hit = silCache.get(key);
  if (hit) return hit;
  const im = img(sprite);
  if (!im) return null;
  const w = (im.width / im.height) * h;
  const [cv, x] = canvas(w + pad * 2, h + pad * 2);
  stampOutline(x, sprite, pad, w, h, px);
  silCache.set(key, cv);
  return cv;
}

/** A flat-colour silhouette at display height h, laid out like bakeSprite(…, {pad}). */
export function bakeSil(sprite: string, h: number, color: string, pad: number): HTMLCanvasElement | null {
  const key = `s|${sprite}|${Math.round(h)}|${color}|${pad}`;
  const hit = silCache.get(key);
  if (hit) return hit;
  const sil = silhouette(sprite, color);
  const im = img(sprite);
  if (!sil || !im) return null;
  const w = (im.width / im.height) * h;
  const [cv, x] = canvas(w + pad * 2, h + pad * 2);
  x.drawImage(sil, pad, pad, w, h);
  silCache.set(key, cv);
  return cv;
}

// one scratch canvas for building rim bands
let scratch: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;
function rimBand(sprite: string, w: number, h: number, pad: number, color: string, dx: number, dy: number): HTMLCanvasElement | null {
  const sil = silhouette(sprite, color);
  if (!sil) return null;
  const cw = Math.ceil(w + pad * 2), ch = Math.ceil(h + pad * 2);
  if (!scratch || scratch[0].width < cw || scratch[0].height < ch) scratch = canvas(Math.max(cw, scratch?.[0].width ?? 0), Math.max(ch, scratch?.[0].height ?? 0));
  const [cv, x] = scratch;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, cv.width, cv.height);
  x.drawImage(sil, pad + dx, pad + dy, w, h);
  // only the part of the shifted silhouette that sticks out past the body
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(sil, pad, pad, w, h);
  x.globalCompositeOperation = 'source-over';
  return cv;
}

/** A thin rim band (shifted silhouette minus the body), laid out like bakeSprite(…, {pad}). */
export function bakeEdge(sprite: string, h: number, color: string, dx: number, dy: number, pad: number): HTMLCanvasElement | null {
  const key = `e|${sprite}|${Math.round(h)}|${color}|${dx}|${dy}|${pad}`;
  const hit = silCache.get(key);
  if (hit) return hit;
  const im = img(sprite);
  if (!im) return null;
  const w = (im.width / im.height) * h;
  const band = rimBand(sprite, w, h, pad, color, dx, dy);
  if (!band) return null;
  const [cv, x] = canvas(w + pad * 2, h + pad * 2);
  x.drawImage(band, 0, 0);
  silCache.set(key, cv);
  return cv;
}

/**
 * Everything about a crowd body that does not change frame to frame, in one canvas, so a
 * body is a single drawImage: outline, graded sprite, fog, variant tint, an optional flat
 * shade over all of it (the unlit "near-silhouette"), and an optional rim band on top.
 */
export function bakeComposite(
  sprite: string, h: number, look: Look, variant: number, pad: number,
  o: { shade?: [string, number]; rim?: [string, number, number, number] } = {},
): Baked | null {
  const key = `c|${sprite}|${Math.round(h)}|${lookKey(look)}|${variant}|${pad}|${o.shade?.join() ?? ''}|${o.rim?.join() ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const im = img(sprite);
  if (!im) return null;
  const w = (im.width / im.height) * h;
  const [cv, x] = canvas(w + pad * 2, h + pad * 2);
  if (look.outline > 0) stampOutline(x, sprite, pad, w, h, look.outline);
  const [tint, ta, vb] = VARIANT_TINT[variant] ?? VARIANT_TINT[0];
  x.filter = `brightness(${(look.b * vb).toFixed(3)}) saturate(${look.s.toFixed(3)})`;
  x.drawImage(im, pad, pad, w, h);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-atop';
  if (look.fog) { x.globalAlpha = look.fog; x.fillStyle = FOG_TINT; x.fillRect(0, 0, cv.width, cv.height); }
  if (ta) { x.globalAlpha = ta; x.fillStyle = tint; x.fillRect(0, 0, cv.width, cv.height); }
  if (o.shade) { x.globalAlpha = o.shade[1]; x.fillStyle = o.shade[0]; x.fillRect(0, 0, cv.width, cv.height); }
  x.globalCompositeOperation = 'source-over';
  if (o.rim && o.rim[1] > 0) {
    const band = rimBand(sprite, w, h, pad, o.rim[0], o.rim[2], o.rim[3]);
    if (band) { x.globalAlpha = o.rim[1]; x.drawImage(band, 0, 0); }
  }
  x.globalAlpha = 1;
  const b = { cv, pad, h };
  cache.set(key, b);
  return b;
}

// source-size silhouettes, the input to the display-size bakes above
const srcSil = new Map<string, HTMLCanvasElement>();
function silhouette(sprite: string, color: string): HTMLCanvasElement | null {
  const key = sprite + color;
  const hit = srcSil.get(key);
  if (hit) return hit;
  const im = img(sprite);
  if (!im) return null;
  const [cv, x] = canvas(im.width, im.height);
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = color;
  x.fillRect(0, 0, cv.width, cv.height);
  srcSil.set(key, cv);
  return cv;
}

// ---------- background layers ----------
/**
 * A painted layer baked once through a filter (darken / desaturate / blur = depth of field),
 * with an atmospheric lift gradient in `fog` that is thickest over the far street band.
 * `mirror` appends a flipped copy (for tiling).
 */
export function bakeLayer(id: string, w: number, h: number, filter: string, fog: string, fogA: number, mirror: boolean): HTMLCanvasElement {
  const [cv, x] = canvas(mirror ? w * 2 : w, h);
  const im = img(id);
  if (im) {
    x.filter = filter;
    x.drawImage(im, 0, 0, w, h);
    if (mirror) { x.save(); x.translate(w * 2, 0); x.scale(-1, 1); x.drawImage(im, 0, 0, w, h); x.restore(); }
    x.filter = 'none';
  }
  const hex = (a: number) => Math.round(a * 255).toString(16).padStart(2, '0');
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `${fog}00`);
  g.addColorStop(0.5, `${fog}${hex(fogA)}`);
  g.addColorStop(0.72, `${fog}${hex(fogA)}`);
  g.addColorStop(0.85, `${fog}${hex(fogA * 0.4)}`);
  x.fillStyle = g;
  x.fillRect(0, 0, cv.width, h);
  return cv;
}

/**
 * The ground plane: dark asphalt, speckle, faint tyre ruts along the lane ys.
 * `top` is the screen y of the canvas' first row; the result is `w` wide and `h` tall.
 */
export function bakeGround(w: number, h: number, top: number, lanes: number[], o: { rut?: number; base?: [string, string, string] } = {}): HTMLCanvasElement {
  const [gc, g] = canvas(w, h);
  const grd = g.createLinearGradient(0, 0, 0, gc.height);
  const [a, b, c] = o.base ?? ['rgba(22,23,26,0.2)', 'rgba(22,23,26,0.6)', 'rgba(12,12,14,0.85)'];
  grd.addColorStop(0, a);
  grd.addColorStop(0.25, b);
  grd.addColorStop(1, c);
  g.fillStyle = grd;
  g.fillRect(0, 0, gc.width, gc.height);
  for (let i = 0; i < 900 * (w / 1536); i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
    g.fillRect((i * 97.13) % gc.width, 20 + ((i * 53.7) % (gc.height - 20)), 2, 1);
  }
  g.fillStyle = `rgba(200,200,210,${o.rut ?? 0.05})`;
  for (const ly of lanes) for (let x0 = 0; x0 < gc.width; x0 += 64) g.fillRect(x0 + (ly % 7), ly - top + 2, 40, 2);
  return gc;
}

let fgC: HTMLCanvasElement | null = null;
/** Foreground strip: near-black weeds, kerb rubble and a tyre; 2560×40, tiles horizontally. */
export function fgStrip(): HTMLCanvasElement {
  if (fgC) return fgC;
  const [fc, f] = canvas(2560, 40);
  f.fillStyle = '#07080b';
  f.globalAlpha = 0.9;
  for (let x0 = 0; x0 < 2560; x0 += 6 + ((x0 * 7) % 11)) {
    const hh = 6 + ((x0 * 13) % 17);
    f.beginPath(); f.moveTo(x0, 40); f.lineTo(x0 + 2 + ((x0 * 3) % 5), 40 - hh); f.lineTo(x0 + 5, 40); f.fill();
  }
  for (let x0 = 90; x0 < 2560; x0 += 230 + ((x0 * 17) % 190)) { f.beginPath(); f.ellipse(x0, 36, 14 + (x0 % 13), 7, 0, 0, 7); f.fill(); }
  for (const tx of [700, 1900]) { f.beginPath(); f.ellipse(tx, 30, 22, 12, 0, 0, 7); f.fill(); }
  fgC = fc;
  return fc;
}

/** Add a contact-shadow ellipse to the current path (callers batch many, then fill once). */
export function shadowEllipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry = rx * 0.22) {
  if (rx <= 0.5) return;
  c.moveTo(x + rx, y);
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}
