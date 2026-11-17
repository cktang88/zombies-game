// Crowd LOD: a Turned that is only walking (no clip, no ragdoll, no hit flash) is drawn from a
// flipbook baked at runtime from the same rig - one axis-aligned drawImage instead of ~16
// rotated part draws (×3 with the ink outline and rim passes). Frames are keyed by (sprite,
// gait preset, phase step, scale bucket, look) and shared by every instance; variety comes
// from each instance's own phase and gait preset. The look (lane grade, outline, rim, light)
// is baked into the frame, so a frame costs one full rig draw into a small canvas, once.
import type { Rig } from './rig';

export const FLIP_FRAMES = 12;
export interface Frame { c: HTMLCanvasElement; ox: number; oy: number; s: number }
const cache = new Map<string, Frame>();
const templates = new Map<string, Rig>();
let makeTemplate: ((spriteId: string, style: string, gait: string) => Rig) | null = null;
export function setTemplateFactory(f: (spriteId: string, style: string, gait: string) => Rig) { makeTemplate = f; }
let bytes = 0, bakeMs = 0, bakes = 0;
/** Frames are dropped (oldest first) above this many bytes of canvas. */
export let FLIP_BUDGET = 96 * 1024 * 1024;
export function setFlipBudget(b: number) { FLIP_BUDGET = b; }

export function flipFrame(rig: Rig, scale: number): Frame | null {
  if (!makeTemplate || !rig.asset) return null;
  const gait = rig.gait.id;
  const moving = rig.moving > 0.5;
  const f = moving ? Math.floor(rig.phase * FLIP_FRAMES) % FLIP_FRAMES : -1;
  const sb = Math.round((rig.lodScale || scale) * 40) / 40;
  const key = `${rig.spriteId}|${gait}|${f}|${sb}|${rig.lookKey}`;
  let fr = cache.get(key);
  if (fr) return fr;
  const tk = `${rig.spriteId}|${rig.style.id}|${gait}`;
  let t = templates.get(tk);
  if (!t) { t = makeTemplate(rig.spriteId, rig.style.id, gait); templates.set(tk, t); }
  if (!t.asset) return null;
  const t0 = performance.now();
  t.speedPx = moving ? 30 : 0;
  t.moving = moving ? 1 : 0;
  t.phase = moving ? (f + 0.5) / FLIP_FRAMES : 0;
  t.ds = sb;
  t.update(0);
  // tight canvas round the pose (rig units → px), plus the outline / rim margin
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const p = t.pts;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  const m = 34; // limb thickness past the joint points
  const ox = Math.ceil((-x0 + m) * sb) + 4, oy = Math.ceil((-y0 + m) * sb) + 4;
  const w = Math.ceil((x1 - x0 + m * 2) * sb) + 8, h = Math.ceil((y1 - y0 + m * 2) * sb) + 8;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d')!;
  t.skin = rig.skin; t.outline = rig.outline; t.rim = rig.rim; t.hideHead = false;
  t.draw(x, ox, oy, sb, 1);
  fr = { c, ox, oy, s: sb };
  cache.set(key, fr);
  bakeMs += performance.now() - t0; bakes++;
  bytes += c.width * c.height * 4;
  if (bytes > FLIP_BUDGET) {
    // a Map iterates in insertion order: drop the oldest frames
    for (const [k, v] of cache) {
      if (bytes <= FLIP_BUDGET * 0.8) break;
      cache.delete(k);
      bytes -= v.c.width * v.c.height * 4;
    }
  }
  return fr;
}
export const flipbookStats = () => ({ frames: cache.size, templates: templates.size, mb: +(bytes / 1048576).toFixed(1), bakes, bakeMs: Math.round(bakeMs) });
