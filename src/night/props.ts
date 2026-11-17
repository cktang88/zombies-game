// World props drawn from generated sprites (tools/sprites-world.json): emplacements and their
// guns, fortifications, trap objects, run landmarks. Every draw goes through a lane-graded bake
// (render.ts bakeSprite) so far props get the depth grade without a per-frame filter, and every
// helper returns false when its image is missing so the caller can keep its procedural fallback.
import { img } from '../assets';
import { bakeSprite, type Look } from './render';
export { PROP_IDS } from '../data/props';

/** A neutral look for props drawn without a lane (near the wall, behind the line). */
export const NEAR: Look = { b: 1, s: 1, fog: 0, outline: 0 };
const PAD = 2;

export function has(id: string) { return !!img(id); }

/** Width a prop would have at display height h (0 if the image is missing). */
export function propW(id: string, h: number) {
  const im = img(id);
  return im ? (im.width / im.height) * h : 0;
}

/**
 * Stamp a prop with its feet (bottom centre, or `ax` of the width from the left) at (x, y),
 * `h` px tall, graded by `look`. Optional: stretch to width `w`, mirror, alpha, rotation about
 * the anchor. Returns false when the image is missing.
 */
export function drawProp(
  c: CanvasRenderingContext2D, id: string, x: number, y: number, h: number, look: Look = NEAR,
  o: { w?: number; flip?: boolean; alpha?: number; rot?: number; ax?: number; ay?: number; b?: number } = {},
): boolean {
  const hh = Math.max(2, Math.round(h));
  const bk = bakeSprite(id, hh, look, 0, { outline: false, pad: PAD, b: o.b });
  if (!bk) return false;
  const nw = bk.cv.width - PAD * 2;
  const w = o.w ?? nw;
  const ax = o.ax ?? 0.5, ay = o.ay ?? 1;
  const sx = w / nw;
  if (!o.flip && !o.rot && o.alpha === undefined && sx === 1) {
    c.drawImage(bk.cv, Math.round(x - w * ax - PAD), Math.round(y - hh * ay - PAD));
    return true;
  }
  c.save();
  if (o.alpha !== undefined) c.globalAlpha *= o.alpha;
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  c.scale(o.flip ? -sx : sx, 1);
  c.drawImage(bk.cv, -nw * ax - PAD, -hh * ay - PAD);
  c.restore();
  return true;
}

/**
 * Aimable gun parts: each sprite points right; `piv` is the mount point as a fraction of the
 * image (x from the left, y from the top), `len` the display width at scale 1, `muz` the
 * muzzle as a fraction of the width.
 */
export const GUN_PART: Record<string, { id: string; len: number; piv: [number, number]; muz: number; base: string; top: number; minH: number }> = {
  // base sprite: drawn from the pivot down to the post's foot; its pintle sits `top` (fraction
  // of its height) below its top edge; at least `minH` px tall
  mgnest: { id: 'emp_mg_gun', len: 76, piv: [0.42, 0.62], muz: 1, base: 'emp_mg_base', top: 0.12, minH: 34 },
  swivel: { id: 'emp_rifle_gun', len: 72, piv: [0.45, 0.55], muz: 1, base: 'emp_rifle_base', top: 0.06, minH: 30 },
  flamer: { id: 'emp_flamer_gun', len: 58, piv: [0.3, 0.6], muz: 1, base: 'emp_flamer_base', top: 0.1, minH: 40 },
  nailturret: { id: 'emp_nail_gun', len: 48, piv: [0.4, 0.7], muz: 1, base: 'emp_nail_base', top: 0.18, minH: 40 },
};

/** The base under a gun: its pintle at (px, py), its foot on footY. False when missing. */
export function drawGunBase(c: CanvasRenderingContext2D, key: string, px: number, py: number, footY: number, look: Look = NEAR): boolean {
  const g = GUN_PART[key];
  if (!g || !img(g.base)) return false;
  const h = Math.max(g.minH, (footY - py) / (1 - g.top));
  return drawProp(c, g.base, px, py, h, look, { ay: g.top });
}

/** Draw a gun part rotated about its pivot at (px, py). False when the image is missing. */
export function drawGunPart(c: CanvasRenderingContext2D, key: string, px: number, py: number, ang: number, sc = 1, look: Look = NEAR): boolean {
  const g = GUN_PART[key];
  const im = img(g?.id ?? '');
  if (!g || !im) return false;
  const w = g.len * sc, h = (im.height / im.width) * w;
  const bk = bakeSprite(g.id, Math.max(2, Math.round(h)), look, 0, { outline: false, pad: PAD });
  if (!bk) return false;
  const bw = bk.cv.width - PAD * 2, bh = bk.cv.height - PAD * 2;
  c.save();
  c.translate(px, py);
  c.rotate(ang);
  // aiming left of straight up/down: flip so the gun is never upside down
  if (Math.cos(ang) < 0) c.scale(1, -1);
  c.drawImage(bk.cv, -bw * g.piv[0] - PAD, -bh * g.piv[1] - PAD);
  c.restore();
  return true;
}

/** Distance from the pivot to the muzzle along the barrel, for a sprite gun (else `fallback`). */
export function gunReach(key: string, sc: number, fallback: number) {
  const g = GUN_PART[key];
  if (!g || !img(g.id)) return fallback;
  return g.len * sc * (g.muz - g.piv[0]);
}
