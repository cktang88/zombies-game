// Crowd LOD: a Turned that is only walking (no clip, no ragdoll, no hit flash) is drawn from a
// flipbook baked at runtime from the same rig - one axis-aligned drawImage instead of ~16
// rotated part draws. Frames are keyed by (sprite, gait preset, phase step, scale bucket) and
// shared by every instance; variety comes from each instance's own phase and gait preset.
// Baking a frame costs one full rig draw into a small canvas, once.
import type { Rig } from './rig';

export const FLIP_FRAMES = 16;
interface Frame { c: HTMLCanvasElement; ox: number; oy: number }
const cache = new Map<string, Frame>();
const templates = new Map<string, Rig>();
let makeTemplate: ((spriteId: string, style: string, gait: string) => Rig) | null = null;
export function setTemplateFactory(f: (spriteId: string, style: string, gait: string) => Rig) { makeTemplate = f; }

export function flipFrame(rig: Rig, scale: number): Frame | null {
  if (!makeTemplate || !rig.asset) return null;
  const gait = rig.gait.id;
  const moving = rig.moving > 0.5;
  const f = moving ? Math.floor(rig.phase * FLIP_FRAMES) % FLIP_FRAMES : -1;
  const sb = Math.round(scale * 40) / 40;
  const key = `${rig.spriteId}|${gait}|${f}|${sb}`;
  let fr = cache.get(key);
  if (fr) return fr;
  const tk = `${rig.spriteId}|${rig.style.id}|${gait}`;
  let t = templates.get(tk);
  if (!t) { t = makeTemplate(rig.spriteId, rig.style.id, gait); templates.set(tk, t); }
  if (!t.asset) return null;
  const units = t.asset.meta.height;
  const h = Math.ceil(units * sb * 1.25), w = Math.ceil(units * sb * 1.5);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  const ox = Math.round(w * 0.45), oy = Math.round(h * 0.9);
  t.speedPx = moving ? 30 : 0;
  t.moving = moving ? 1 : 0;
  t.phase = moving ? (f + 0.5) / FLIP_FRAMES : 0;
  t.ds = sb;
  t.update(0);
  t.draw(x, ox, oy, sb, 1);
  fr = { c, ox, oy };
  cache.set(key, fr);
  return fr;
}
export const flipbookStats = () => ({ frames: cache.size, templates: templates.size });
