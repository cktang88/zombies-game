// Cuts a single "rig pose" character image into cutout parts for the bone renderer
// (src/anim). Instead of hand-drawing a polygon per part, the rig file only places the
// ~15 joints on the source image; every opaque pixel is then given to the nearest bone
// (distance measured as a capsule, scaled by the bone's thickness, with a heavy penalty
// for falling past a bone's end). Each child part also keeps a round "joint cap" of
// pixels around its proximal joint, and the parent keeps the same disc, so the parts
// overlap at every joint and no seam opens when a limb rotates.
//
// Usage: npx tsx tools/segment.ts [rigId ...]       (default: every tools/rigs/*.json)
// In:  tools/rigs/<id>.json, raw sources in tools/rigs/src/ (or keyed ones in tools/.cache/parts-keyed/)
// Out: public/sprites/parts/<id>.png (atlas) + public/sprites/parts/<id>.json (part rects,
//      pivots, rest angles, joint positions). Debug: tools/.cache/seg-<id>.png
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromaKey } from './chroma.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
type P = [number, number];
interface RigSrc {
  id: string;
  source: string;
  height: number; // output character height (top of head to sole), px
  standHeight?: number; // source px of a standing body (prone rigs); default: the opaque bbox height
  joints: Record<string, P>;
  radius?: Record<string, number>; // per-part thickness as a fraction of source char height
  force?: { part: string; poly: P[] }[]; // pixels inside poly go to `part` ("none" = discard)
  fillMaxX?: number; // the chest-hole fill under the arm stops at this source x
  // added to a part's rest angle (the art is drawn rotated by -bias). z_crawler: its prone
  // source already has the head raised, while the crawl gaits lift the head of upright rigs
  restBias?: Record<string, number>;
  capless?: string[]; // parts that get no joint cap (e.g. a thigh whose hip sits under a long coat or
  // apron: the cap would copy a disc of the coat onto the leg)
  hands?: HandsSrc;
}
/**
 * Alternate hand poses from a generated hands sheet (connected components, left to right).
 * Every pose is cut at its wrist line (the sheet's sleeve cuff is dropped: the forearm part
 * already ends in the body's own sleeve) and scaled so the refPose (an open hand) measures
 * `len` × the head bone (neck → crown) from wrist to fingertip.
 */
interface HandsSrc {
  /** a shared hand library instead of a per-character sheet: tools/rigs/src/hands_<lib>.png, five
   * hands wrist-left in a row (grip, support, open, fist, pinch), poses found automatically */
  lib?: HandLib;
  source?: string;
  refPose?: string;
  /** open-hand length as a fraction of the head bone (default 0.42 ≈ half the chin-to-crown height) */
  len?: number;
  poses?: Record<string, HandPose>;
  /** recolour toward this skin tone (multiply-ish blend) by `tintA` (0..1, default 0.35) */
  tint?: string;
  tintA?: number;
  /** brightness multiplier for the library art (default 1) */
  bright?: number;
}
/** Shared hand libraries (tools/sprites-parts-hands.json): one sheet per skin tone / glove. */
type HandLib = 'light' | 'medium' | 'dark' | 'glove';
const LIB_POSES = ['grip', 'support', 'open', 'fist', 'pinch'];
interface HandPose {
  index: number; wrist: P; tip: P;
  /** palm point (what the hand holds); closed poses default to the centroid of the cut hand */
  grip?: P;
  /** a closed hand wrapped round a rod: grip = the fist's centroid */
  closed?: boolean;
  /** rotate the art (degrees, clockwise on screen) after the cut: brings every closed hand to the
   * gun-frame orientation the rig draws it in (wrist to the left / below, knuckles forward) */
  rot?: number;
  /** keep pixels from this fraction of wrist→tip past the wrist (default -0.04: a sliver of overlap) */
  cut?: number;
  /** drop pixels past this fraction of wrist→tip (a pointing hand trimmed back to its knuckles: a closed grip) */
  trim?: number;
  /** source-px polygons cut out of the pose (e.g. a pointing index finger: the rest is a fist) */
  drop?: P[][];
}
interface Bone { part: string; a: string; b: string; parent?: string; ignore?: boolean; front?: boolean }

const BONES: Bone[] = [
  { part: 'torso', a: 'pelvis', b: 'neck' },
  { part: 'head', a: 'neck', b: 'headTop', parent: 'torso' },
  { part: 'upperArm', front: true, a: 'shoulder', b: 'elbow', parent: 'torso' },
  { part: 'forearm', front: true, a: 'elbow', b: 'wrist', parent: 'upperArm' },
  { part: 'hand', front: true, a: 'wrist', b: 'handTip', parent: 'forearm' },
  { part: 'thigh', a: 'hip', b: 'knee', parent: 'torso' },
  { part: 'shin', a: 'knee', b: 'ankle', parent: 'thigh' },
  { part: 'foot', a: 'ankle', b: 'toe', parent: 'shin' },
  // the far leg is not cut: the renderer reuses the near leg, darkened
  { part: 'x1', a: 'bHip', b: 'bKnee', ignore: true },
  { part: 'x2', a: 'bKnee', b: 'bAnkle', ignore: true },
  { part: 'x3', a: 'bAnkle', b: 'bToe', ignore: true },
];
const DEF_R: Record<string, number> = {
  torso: 0.13, head: 0.075, upperArm: 0.05, forearm: 0.045, hand: 0.045, thigh: 0.065, shin: 0.05, foot: 0.045, x1: 0.06, x2: 0.05, x3: 0.045,
};
const PAD = 2;

function segDist(px: number, py: number, a: P, b: P): { d: number; t: number } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy || 1;
  const t = ((px - a[0]) * vx + (py - a[1]) * vy) / L2;
  const L = Math.sqrt(L2);
  const perp = Math.abs((px - a[0]) * vy - (py - a[1]) * vx) / L;
  const over = t < 0 ? -t * L : t > 1 ? (t - 1) * L : 0;
  return { d: Math.hypot(perp, over * 2.2), t };
}
function inPoly(x: number, y: number, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

interface Cut { name: string; buf: Buffer; w: number; h: number; pivot: P; tip: P; rest: number; len: number; grip?: P }

/** A rig source: the committed raw generation (tools/rigs/src, keyed here) or the cache. */
async function loadRaw(name: string) {
  const committed = path.join(ROOT, 'tools/rigs/src', `${name}.png`);
  const buf = fs.existsSync(committed) ? await chromaKey(fs.readFileSync(committed)) : fs.readFileSync(path.join(ROOT, 'tools/.cache/parts-keyed', `${name}.png`));
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Crop a masked region, scale it by s, return the part with pivot/tip in part-local px. */
async function cutPart(name: string, src: { data: Buffer; w: number; h: number }, mask: Uint8Array, s: number, a: P, b: P, g?: P): Promise<Cut | null> {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (mask[y * src.w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y + y0) * src.w + x + x0;
    if (!mask[si]) continue;
    src.data.copy(out, (y * w + x) * 4, si * 4, si * 4 + 4);
  }
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  const buf = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer();
  const pivot: P = [(a[0] - x0) * (W / w), (a[1] - y0) * (H / h)];
  const tip: P = [(b[0] - x0) * (W / w), (b[1] - y0) * (H / h)];
  const grip: P | undefined = g ? [(g[0] - x0) * (W / w), (g[1] - y0) * (H / h)] : undefined;
  return { name, buf, w: W, h: H, pivot, tip, rest: Math.atan2(b[1] - a[1], b[0] - a[0]), len: Math.hypot(b[0] - a[0], b[1] - a[1]) * s, grip };
}

/** Rotate a cut part's art by deg (clockwise on screen) round its centre; points follow. */
async function rotateCut(c: Cut, deg: number): Promise<Cut> {
  const { data, info } = await sharp(c.buf, { raw: { width: c.w, height: c.h, channels: 4 } })
    .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
  const t = (deg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  const cx = c.w / 2, cy = c.h / 2, cx2 = info.width / 2, cy2 = info.height / 2;
  const R = (p: P): P => [cx2 + (p[0] - cx) * cs - (p[1] - cy) * sn, cy2 + (p[0] - cx) * sn + (p[1] - cy) * cs];
  const pivot = R(c.pivot), tip = R(c.tip);
  return { ...c, buf: data, w: info.width, h: info.height, pivot, tip, grip: c.grip ? R(c.grip) : undefined, rest: Math.atan2(tip[1] - pivot[1], tip[0] - pivot[0]) };
}

async function segment(rig: RigSrc) {
  const src = await loadRaw(rig.source);
  const J = rig.joints;
  // opaque bbox -> scale
  let top = 1e9, bot = -1;
  for (let i = 0; i < src.w * src.h; i++) if (src.data[i * 4 + 3] > 40) { const y = (i / src.w) | 0; if (y < top) top = y; if (y > bot) bot = y; }
  const charH = bot - top;
  // standHeight: for a lying/prone source the bbox is not the body height; give the source px
  // a standing body would measure so the parts come out at the same scale as upright rigs
  const s = rig.height / (rig.standHeight ?? charH);
  const R = (p: string) => (rig.radius?.[p] ?? DEF_R[p]) * charH;

  // 1. nearest-bone ownership
  const own = new Int8Array(src.w * src.h).fill(-1);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const i = y * src.w + x;
    if (src.data[i * 4 + 3] < 8) continue;
    let best = 1e9, bi = -1, front = 1e9;
    BONES.forEach((bn, k) => {
      const d = segDist(x, y, J[bn.a], J[bn.b]).d / R(bn.part);
      // the near arm is drawn over the body: inside its capsule it always wins
      if (bn.front && d <= 1 && d < front) { front = d; bi = k; best = -1; }
      if (best >= 0 && d < best) { best = d; bi = k; }
    });
    if (rig.force) for (const f of rig.force) if (inPoly(x, y, f.poly)) bi = f.part === 'none' ? -2 : BONES.findIndex((b) => b.part === f.part);
    own[i] = bi;
  }
  // 2. masks with joint caps (child disc around its proximal joint, shared with the parent)
  const idx = (p: string) => BONES.findIndex((b) => b.part === p);
  const masks = new Map<string, Uint8Array>();
  for (const bn of BONES) if (!bn.ignore) {
    const m = new Uint8Array(src.w * src.h);
    const k = idx(bn.part);
    for (let i = 0; i < m.length; i++) if (own[i] === k) m[i] = 1;
    masks.set(bn.part, m);
  }
  for (const bn of BONES) if (bn.parent && !rig.capless?.includes(bn.part)) {
    const [cx, cy] = J[bn.a];
    const r = R(bn.part) * 1.15;
    const cm = masks.get(bn.part)!, pm = masks.get(bn.parent)!;
    const ck = idx(bn.part), pk = idx(bn.parent);
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(src.h, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(src.w, cx + r); x++) {
        const i = y * src.w + x;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (own[i] === ck || own[i] === pk) { cm[i] = 1; pm[i] = 1; }
      }
  }
  // 2b. the near arm hides part of the chest: give the torso those pixels back (column-wise
  // between torso pixels above and below the arm) and inpaint them by diffusion
  const torsoSrc = { ...src, data: Buffer.from(src.data) };
  {
    const tm = masks.get('torso')!;
    const tk = idx('torso');
    const W = src.w;
    const isHole = new Uint8Array(W * src.h);
    const fillMax = Math.min(W, rig.fillMaxX ?? W);
    for (let x = 0; x < fillMax; x++) {
      let y0 = -1, y1 = -1;
      for (let y = 0; y < src.h; y++) if (own[y * W + x] === tk) { if (y0 < 0) y0 = y; y1 = y; }
      if (y0 < 0) continue;
      for (let y = y0; y <= y1; y++) {
        const i = y * W + x;
        if (!tm[i] && own[i] >= 0 && BONES[own[i]].front && segDist(x, y, J.pelvis, J.neck).d < R('torso') * 0.95) isHole[i] = 1;
      }
    }
    // The chest's front contour behind the arm is unknown: rows where the arm covers the
    // torso's front edge get an edge interpolated between the clear rows above and below
    // (rigs face right, so "front" = +x). Fill up to it and ink it, so a raised arm shows a
    // drawn chest line instead of the straight capsule cut.
    const fx = new Int32Array(src.h).fill(-1);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < W; x++) if (own[y * W + x] === tk) fx[y] = x;
    const occl = (y: number) => {
      if (fx[y] < 0) return false;
      for (let d = 1; d <= 3; d++) { const o = own[y * W + fx[y] + d]; if (o >= 0 && BONES[o].front) return true; }
      return false;
    };
    const edge = new Int32Array(src.h).fill(-1);
    for (let y = 0; y < src.h;) {
      if (!occl(y)) { y++; continue; }
      let y2 = y;
      while (y2 + 1 < src.h && occl(y2 + 1)) y2++;
      const a = fx[y - 1] ?? -1, b = fx[y2 + 1] ?? -1;
      for (let yy = y; yy <= y2; yy++) {
        const u = (yy - y + 1) / (y2 - y + 2);
        const xe = a >= 0 && b >= 0 ? a + (b - a) * u : Math.max(a, b);
        if (xe < 0) continue;
        edge[yy] = Math.round(Math.min(fillMax - 1, Math.max(fx[yy], xe)));
        for (let x = fx[yy] + 1; x < W; x++) {
          const i = yy * W + x;
          if (x <= edge[yy]) { if (!tm[i] && segDist(x, yy, J.pelvis, J.neck).d < R('torso') * 1.6) isHole[i] = 1; }
          else isHole[i] = 0; // nothing in front of the drawn edge
        }
      }
      y = y2 + 1;
    }
    const hole: number[] = [];
    for (let i = 0; i < isHole.length; i++) if (isHole[i]) { tm[i] = 1; hole.push(i); }
    inpaint(torsoSrc.data, W, hole, tm);
    // texture: mirror the chest behind the hole's back boundary into it (seamless at that
    // boundary), mixed with the diffusion colour so the mean tone stays right
    const d = torsoSrc.data;
    for (const i of hole) {
      const x = i % W, y = (i / W) | 0;
      let xb = x - 1;
      while (xb >= 0 && isHole[y * W + xb]) xb--;
      const xm = 2 * xb - x;
      if (xb < 0 || xm < 0) continue;
      const j = y * W + xm;
      if (!tm[j] || isHole[j] || src.data[j * 4 + 3] < 128) continue;
      for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.round(src.data[j * 4 + k] * 0.7 + d[i * 4 + k] * 0.3);
    }
    // ink line along the reconstructed front edge
    const ink = Math.max(3, Math.round(charH * 0.003));
    for (let y = 0; y < src.h; y++) if (edge[y] >= 0) for (let x = edge[y] - ink + 1; x <= edge[y]; x++) {
      const i = y * W + x;
      if (x < 0 || !isHole[i]) continue;
      d[i * 4] = 22; d[i * 4 + 1] = 19; d[i * 4 + 2] = 17; d[i * 4 + 3] = 255;
    }
    keepLargest(tm, W, src.h);
  }
  // 3. cut + scale
  const cuts: Cut[] = [];
  for (const bn of BONES) if (!bn.ignore) {
    const c = await cutPart(bn.part, bn.part === 'torso' ? torsoSrc : src, masks.get(bn.part)!, s, J[bn.a], J[bn.b]);
    if (c) { c.rest += rig.restBias?.[bn.part] ?? 0; cuts.push(c); }
  }
  // 4. alternate hand poses from a hands sheet (connected components, left to right)
  if (rig.hands) {
    const H = rig.hands;
    const hs = await loadRaw(H.lib ? `hands_${H.lib}` : H.source!);
    const comps = components(hs);
    if (H.lib) {
      if (comps.length !== LIB_POSES.length) throw new Error(`hands_${H.lib}: ${comps.length} hands, want ${LIB_POSES.length}`);
      H.refPose = 'open';
      H.poses = libPoses(hs, comps);
      recolour(hs, H);
    }
    /** the pose's component, cut at the wrist line */
    const cutMask = (hp: HandPose): Uint8Array | null => {
      const m0 = comps[hp.index];
      if (!m0) return null;
      const m = new Uint8Array(m0);
      const ax = hp.tip[0] - hp.wrist[0], ay = hp.tip[1] - hp.wrist[1], L2 = ax * ax + ay * ay;
      const c0 = hp.cut ?? -0.04, c1 = hp.trim ?? 1e9;
      for (let i = 0; i < m.length; i++) if (m[i]) {
        const x = i % hs.w, y = (i / hs.w) | 0;
        const t = ((x - hp.wrist[0]) * ax + (y - hp.wrist[1]) * ay) / L2;
        if (t < c0 || t > c1 || hp.drop?.some((poly) => inPoly(x, y, poly))) m[i] = 0;
      }
      keepLargest(m, hs.w, hs.h);
      return m;
    };
    // scale: the open reference hand, wrist → farthest fingertip, = len × the head bone
    const ref = H.poses![H.refPose!];
    const refM = cutMask(ref)!;
    let refLen = 0;
    {
      const ax = ref.tip[0] - ref.wrist[0], ay = ref.tip[1] - ref.wrist[1], L = Math.hypot(ax, ay);
      for (let i = 0; i < refM.length; i++) if (refM[i]) refLen = Math.max(refLen, ((i % hs.w - ref.wrist[0]) * ax + (((i / hs.w) | 0) - ref.wrist[1]) * ay) / L);
    }
    // (a rig whose crown joint sits low, e.g. under a hood, still gets hands of a body its height)
    const headLen = Math.max(Math.hypot(J.headTop[0] - J.neck[0], J.headTop[1] - J.neck[1]) * s, rig.height * 0.19);
    const hsScale = ((H.len ?? 0.42) * headLen) / refLen;
    for (const [pose, hp] of Object.entries(H.poses!)) {
      const m = cutMask(hp);
      if (!m) { console.warn('no hand component', pose); continue; }
      let g: P = hp.grip ?? hp.wrist;
      if (hp.closed) {
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < m.length; i++) if (m[i]) { sx += i % hs.w; sy += (i / hs.w) | 0; n++; }
        g = [sx / n, sy / n];
      }
      let c = await cutPart(`hand_${pose}`, hs, m, hsScale, hp.wrist, hp.tip, g);
      if (!c) continue;
      if (hp.rot) c = await rotateCut(c, hp.rot);
      const dx = c.grip![0] - c.pivot[0], dy = c.grip![1] - c.pivot[1];
      const cs = Math.cos(-c.rest), sn = Math.sin(-c.rest);
      c.grip = [dx * cs - dy * sn, dx * sn + dy * cs];
      cuts.push(c);
    }
  }
  // 5. shelf-pack an atlas
  cuts.sort((a, b) => b.h - a.h);
  const AW = 512;
  let x = 0, y = 0, rowH = 0;
  const place: { c: Cut; x: number; y: number }[] = [];
  for (const c of cuts) {
    if (x + c.w + PAD > AW) { x = 0; y += rowH + PAD; rowH = 0; }
    place.push({ c, x, y });
    x += c.w + PAD;
    rowH = Math.max(rowH, c.h);
  }
  const AH = y + rowH;
  const atlas = Buffer.alloc(AW * AH * 4);
  for (const p of place) for (let yy = 0; yy < p.c.h; yy++) p.c.buf.copy(atlas, ((p.y + yy) * AW + p.x) * 4, yy * p.c.w * 4, (yy + 1) * p.c.w * 4);
  const outDir = path.join(ROOT, 'public/sprites/parts');
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(atlas, { raw: { width: AW, height: AH, channels: 4 } }).png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.5 }).toFile(path.join(outDir, `${rig.id}.png`));
  // joints relative to the pelvis, scaled; ground = sole line
  const O = J.pelvis;
  const rel = (p: P): P => [+((p[0] - O[0]) * s).toFixed(2), +((p[1] - O[1]) * s).toFixed(2)];
  const r2 = (v: number) => +v.toFixed(3);
  const meta = {
    id: rig.id,
    height: rig.height,
    ground: +((bot - O[1]) * s).toFixed(2), // sole y below the pelvis
    joints: Object.fromEntries(Object.entries(J).map(([k, v]) => [k, rel(v)])),
    parts: Object.fromEntries(place.map(({ c, x, y }) => [c.name, { x, y, w: c.w, h: c.h, px: r2(c.pivot[0]), py: r2(c.pivot[1]), tx: r2(c.tip[0]), ty: r2(c.tip[1]), rest: r2(c.rest), len: r2(c.len), ...(c.grip ? { gx: r2(c.grip[0]), gy: r2(c.grip[1]) } : {}) }])),
  };
  fs.writeFileSync(path.join(outDir, `${rig.id}.json`), JSON.stringify(meta));
  // debug overlay: ownership colours
  const dbg = Buffer.from(src.data);
  const COL = [[230, 60, 60], [60, 200, 60], [60, 90, 230], [230, 200, 40], [200, 60, 220], [40, 210, 210], [240, 130, 30], [130, 80, 40], [90, 90, 90], [90, 90, 90], [90, 90, 90]];
  for (let i = 0; i < own.length; i++) if (own[i] >= 0) {
    const c = COL[own[i]];
    for (let k = 0; k < 3; k++) dbg[i * 4 + k] = (dbg[i * 4 + k] + c[k]) >> 1;
  }
  fs.mkdirSync(path.join(ROOT, 'tools/.cache'), { recursive: true });
  await sharp(dbg, { raw: { width: src.w, height: src.h, channels: 4 } }).png().toFile(path.join(ROOT, 'tools/.cache', `seg-${rig.id}.png`));
  console.log(`ok ${rig.id}: ${cuts.length} parts, atlas ${AW}x${AH}, scale ${s.toFixed(3)}`);
}

/** Diffusion fill: hole pixels take the mean of their known neighbours, repeated until settled. */
function inpaint(data: Buffer, w: number, hole: number[], region: Uint8Array) {
  if (!hole.length) return;
  const known = new Uint8Array(data.length / 4).fill(1);
  for (const i of hole) known[i] = 0;
  // ink outlines would darken the fill: skip neighbours much darker than the region's median
  // (relative, so dark clothing like riot armour still has known pixels to diffuse from)
  const lum: number[] = [];
  for (let i = 0; i < region.length; i += 7) if (region[i] && known[i] && data[i * 4 + 3] > 128) lum.push(data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]);
  lum.sort((a, b) => a - b);
  const inkT = Math.min(110, (lum[lum.length >> 1] ?? 220) * 0.5);
  // seed from nearest known pixels so diffusion converges quickly, then relax
  // only torso pixels and already-filled hole pixels feed the fill (never the arm on top)
  const filled = new Uint8Array(known.length);
  for (let it = 0; it < 400; it++) {
    let fresh = 0;
    for (const i of hole) {
      let r = 0, g = 0, b = 0, n = 0;
      for (const j of [i - 1, i + 1, i - w, i + w, i - w - 1, i - w + 1, i + w - 1, i + w + 1]) {
        if (j < 0 || j * 4 >= data.length) continue;
        if (known[j]) {
          if (!region[j] || data[j * 4 + 3] < 128 || data[j * 4] + data[j * 4 + 1] + data[j * 4 + 2] < inkT) continue;
        } else if (!filled[j]) continue;
        r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; n++;
      }
      if (!n) continue;
      data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n; data[i * 4 + 3] = 255;
      if (!filled[i]) { filled[i] = 1; fresh++; }
    }
    if (!fresh && it > 60) break;
  }
  // anything unreachable (no torso neighbour at all) takes the region's median tone
  const med = lum[lum.length >> 1] ?? 240;
  for (const i of hole) if (!filled[i]) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(med / 3); data[i * 4 + 3] = 255; }
}

/**
 * Pose points of a library sheet (every hand wrist-left, fingers right): wrist = the middle of the
 * leftmost columns, tip = the middle of the rightmost ones; grip (what the hand holds) per pose:
 * the trigger hand's curled fingers (left two thirds), the support hand's cup (above the palm),
 * the pinch's thumb-and-index point (where the art's cartridge was: erased, the rig draws its own).
 */
function libPoses(hs: { data: Buffer; w: number; h: number }, comps: Uint8Array[]): Record<string, HandPose> {
  const out: Record<string, HandPose> = {};
  comps.forEach((m, index) => {
    const pose = LIB_POSES[index];
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % hs.w, y = (i / hs.w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const W = x1 - x0, Hh = y1 - y0;
    const band = (a: number, b: number): P => {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % hs.w; if (x >= x0 + W * a && x <= x0 + W * b) { sx += x; sy += (i / hs.w) | 0; n++; } }
      return [sx / n, sy / n];
    };
    let grip: P | undefined;
    if (pose === 'pinch') {
      // the brass cartridge in the art: saturated yellow-orange pixels; remember where, then erase
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < m.length; i++) if (m[i]) {
        const r = hs.data[i * 4], g = hs.data[i * 4 + 1], b = hs.data[i * 4 + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 90 && (mx - mn) / mx > 0.42 && r >= g && g > b * 1.15) { sx += i % hs.w; sy += (i / hs.w) | 0; n++; m[i] = 0; hs.data[i * 4 + 3] = 0; }
      }
      keepLargest(m, hs.w, hs.h);
      if (n > 20) grip = [sx / n, sy / n];
    }
    const wrist = band(0, 0.07), tip = band(0.93, 1);
    if (pose === 'grip') grip = band(0.12, 0.6);
    else if (pose === 'support') { const c = band(0.25, 0.75); grip = [c[0], c[1] - Hh * 0.18]; }
    else if (!grip) grip = band(0.2, 0.8);
    out[pose] = { index, wrist, tip, grip, cut: -0.02 };
  });
  return out;
}
/** Library hands toward a character's skin tone: brightness, then a blend toward `tint`'s hue. */
function recolour(hs: { data: Buffer; w: number; h: number }, H: HandsSrc) {
  const d = hs.data, k = H.bright ?? 1;
  const t = H.tint ? [parseInt(H.tint.slice(1, 3), 16), parseInt(H.tint.slice(3, 5), 16), parseInt(H.tint.slice(5, 7), 16)] : null;
  const a = H.tintA ?? 0.35;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    for (let c = 0; c < 3; c++) {
      let v = d[i + c] * k;
      // multiply by the tint normalised to its own luminance keeps the shading, shifts the hue
      if (t) { const L = (t[0] + t[1] + t[2]) / 3 || 1; v = v * (1 - a) + v * (t[c] / L) * a; }
      d[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

/** Drop specks: keep only the largest 8-connected component of a mask. */
function keepLargest(m: Uint8Array, w: number, h: number) {
  const lab = new Int32Array(m.length);
  let best = 0, bestN = 0, next = 0;
  const stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    next++;
    let n = 0;
    stack.push(i); lab[i] = next;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const x = j % w, y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const k = Y * w + X;
        if (m[k] && !lab[k]) { lab[k] = next; stack.push(k); }
      }
    }
    if (n > bestN) { bestN = n; best = next; }
  }
  for (let i = 0; i < m.length; i++) if (m[i] && lab[i] !== best) m[i] = 0;
}

/** Connected opaque components (8-neighbour), biggest-first filter, sorted left to right. */
function components(img: { data: Buffer; w: number; h: number }): Uint8Array[] {
  const { w, h, data } = img;
  const lab = new Int32Array(w * h).fill(0);
  const out: { mask: Uint8Array; cx: number; n: number }[] = [];
  let next = 1;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] || data[i * 4 + 3] < 40) continue;
    const mask = new Uint8Array(w * h);
    let n = 0, sx = 0;
    stack.push(i); lab[i] = next;
    while (stack.length) {
      const j = stack.pop()!;
      mask[j] = 1; n++; sx += j % w;
      const x = j % w, y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const k = Y * w + X;
        if (!lab[k] && data[k * 4 + 3] >= 40) { lab[k] = next; stack.push(k); }
      }
    }
    next++;
    if (n > 2000) out.push({ mask, cx: sx / n, n });
  }
  // keep soft edge pixels next to each component
  for (const o of out) {
    const m = o.mask;
    for (let i = 0; i < w * h; i++) if (!m[i] && data[i * 4 + 3] > 0 && data[i * 4 + 3] < 40) {
      const x = i % w;
      if ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || m[i - w] || m[i + w]) m[i] = 1;
    }
  }
  return out.sort((a, b) => a.cx - b.cx).map((o) => o.mask);
}

const only = process.argv.slice(2);
const dir = path.join(ROOT, 'tools/rigs');
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const rig = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RigSrc;
  if (only.length && !only.includes(rig.id)) continue;
  await segment(rig);
}
