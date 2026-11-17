// Cuts a generated "aim unit" (docs/research/14 §3: torso + head + both arms + hands + gun drawn as one
// piece in the firing pose, tools/aim-guide.ts + gen-parts.ts) into a rig-scale part with its pivots.
//   npx tsx tools/cut-unit.ts <rig> <weapon> [--match]
// Source: tools/rigs/src/aimunit_<rig>_<weapon>.png (the raw generation picked from tools/.cache/parts-raw).
// Points (source px): tools/rigs/src/aimunit_<rig>_<weapon>.points.json when present, else the template's
// own (tools/rigs/src/aimguide_<rig>_<weapon>.json, scaled to the source size: the model keeps the
// template's layout, so the gun lands where the template put it):
//   { pelvis?, neck?, muzzle?, butt? (any point back along the bore), ppu? (source px per rig unit), cutY?, degrey? }
//   (keys left out come from the template)
// Output: public/sprites/parts/unit_<rig>_<weapon>.png/.json at 1 px per rig unit (the atlas scale),
//   json { pelvis, neck, muzzle, bore } in output px; bore = the barrel's angle in the drawing (rad).
// --match: per-channel gain so the unit's mid-tones match the rig's own torso part (the model drifts
//   the clothing's hue and value; the hips under the unit are the rig's).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromaKey } from './chroma.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [rig, weapon] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const name = `${rig}_${weapon}`;
type P = [number, number];
const src = path.join(ROOT, `tools/rigs/src/aimunit_${name}.png`);
const { data, info } = await sharp(await chromaKey(fs.readFileSync(src))).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const guide = JSON.parse(fs.readFileSync(path.join(ROOT, `tools/rigs/src/aimguide_${name}.json`), 'utf8'));
const pf = path.join(ROOT, `tools/rigs/src/aimunit_${name}.points.json`);
const gs = W / guide.w;
// a points file may give only some keys (e.g. just cutY / degrey); the rest come from the template
const pts: { pelvis: P; neck: P; muzzle: P; butt: P; ppu: number; cutY?: number; degrey?: boolean } = {
  pelvis: guide.pelvis.map((v: number) => v * gs), neck: guide.neck.map((v: number) => v * gs), muzzle: guide.muzzle.map((v: number) => v * gs), butt: guide.butt.map((v: number) => v * gs), ppu: guide.k * gs,
  ...(fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {}),
};
if (pts.cutY !== undefined) for (let y = Math.round(pts.cutY); y < H; y++) for (let x = 0; x < W; x++) data[(y * W + x) * 4 + 3] = 0;
// degrey: the model sometimes leaves a piece of the template (a flat neutral-grey arm, hip or shadow) unpainted
// behind the figure. Drop large connected areas of flat grey (r = g = b, mid values: the template's greys are
// 5a..bd), plus a 2 px fringe of near-grey round them. Opt-in per unit: a white or grey garment would match too.
if (pts.degrey) {
  const flat = (i: number) => { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; return data[i * 4 + 3] > 0 && Math.max(r, g, b) - Math.min(r, g, b) <= 8 && r >= 110 && r <= 225; };
  const seen = new Uint8Array(W * H), kill = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !flat(i)) continue;
    const comp: number[] = [], st = [i]; seen[i] = 1;
    while (st.length) {
      const j = st.pop()!; comp.push(j);
      const x = j % W;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (k >= 0 && k < W * H && !seen[k] && flat(k)) { seen[k] = 1; st.push(k); }
    }
    if (comp.length >= 400) for (const j of comp) kill[j] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const add: number[] = [];
    for (let i = 0; i < W * H; i++) if (!kill[i] && data[i * 4 + 3] > 0) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], x = i % W;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) continue;
      if ((x > 0 && kill[i - 1]) || (x < W - 1 && kill[i + 1]) || (i >= W && kill[i - W]) || (i + W < W * H && kill[i + W])) add.push(i);
    }
    for (const i of add) kill[i] = 1;
  }
  let n = 0;
  for (let i = 0; i < W * H; i++) if (kill[i]) { data[i * 4 + 3] = 0; n++; }
  console.log(`degrey: dropped ${n} px of template grey`);
}

// drop specks: keep connected components (alpha > 100) of at least 1% of the largest
const lab = new Int32Array(W * H).fill(-1), sizes: number[] = [];
for (let i = 0; i < W * H; i++) {
  if (lab[i] >= 0 || data[i * 4 + 3] <= 100) continue;
  const id = sizes.length, st = [i];
  lab[i] = id; let n = 0;
  while (st.length) {
    const j = st.pop()!; n++;
    const x = j % W, y = (j - x) / W;
    for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) if (k >= 0 && lab[k] < 0 && data[k * 4 + 3] > 100) { lab[k] = id; st.push(k); }
  }
  sizes.push(n);
}
const big = Math.max(...sizes);
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let i = 0; i < W * H; i++) {
  const x = i % W, y = (i - x) / W;
  const id = lab[i] >= 0 ? lab[i] : [i - 1, i + 1, i - W, i + W].map((k) => (k >= 0 && k < W * H ? lab[k] : -1)).find((v) => v >= 0) ?? -1;
  if (id < 0 || sizes[id] < big * 0.01) { data[i * 4 + 3] = 0; continue; }
  x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
}
// the muzzle: the opaque pixel farthest along the bore near the guessed muzzle
const bore = Math.atan2(pts.muzzle[1] - pts.butt[1], pts.muzzle[0] - pts.butt[0]);
let best = -1e9, mz: P = pts.muzzle;
for (let y = Math.round(pts.muzzle[1] - 25); y <= pts.muzzle[1] + 25; y++) for (let x = Math.round(pts.muzzle[0] - 120); x <= pts.muzzle[0] + 120; x++) {
  if (x < 0 || y < 0 || x >= W || y >= H || data[(y * W + x) * 4 + 3] < 128) continue;
  const t = (x - pts.butt[0]) * Math.cos(bore) + (y - pts.butt[1]) * Math.sin(bore);
  const off = Math.abs(-(x - pts.muzzle[0]) * Math.sin(bore) + (y - pts.muzzle[1]) * Math.cos(bore));
  if (off < 14 && t > best) { best = t; mz = [x, y]; }
}
const pad = 8;
x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
const k = 1 / pts.ppu;
const ow = Math.round((x1 - x0 + 1) * k), oh = Math.round((y1 - y0 + 1) * k);
const buf = await sharp(data, { raw: info }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).resize(ow, oh, { kernel: 'lanczos3' }).raw().toBuffer();
if (process.argv.includes('--match')) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, `public/sprites/parts/${rig}.json`), 'utf8'));
  const { data: A, info: ai } = await sharp(path.join(ROOT, `public/sprites/parts/${rig}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const want = [0, 0, 0], got = [0, 0, 0];
  let wn = 0, gn = 0;
  const p = meta.parts.torso;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const o = ((p.y + y) * ai.width + p.x + x) * 4;
    if (A[o + 3] > 200 && A[o] + A[o + 1] + A[o + 2] > 120) { for (let c = 0; c < 3; c++) want[c] += A[o + c]; wn++; }
  }
  // the unit's torso region only (below the gun line, behind the hands): the bottom-left quarter
  for (let y = Math.round(oh * 0.55); y < oh; y++) for (let x = 0; x < ow * 0.4; x++) {
    const o = (y * ow + x) * 4;
    if (buf[o + 3] > 200 && buf[o] + buf[o + 1] + buf[o + 2] > 120) { for (let c = 0; c < 3; c++) got[c] += buf[o + c]; gn++; }
  }
  // half-way: the drawing's own palette is the point of the exercise
  const gain = want.map((v, c) => 1 + (v / wn / Math.max(1, got[c] / gn) - 1) * 0.5);
  console.log(`colour match to ${rig} torso: gain ${gain.map((g) => g.toFixed(2)).join(' ')}`);
  for (let o = 0; o < buf.length; o += 4) for (let c = 0; c < 3; c++) buf[o + c] = Math.min(255, Math.round(buf[o + c] * gain[c]));
}
const out = path.join(ROOT, 'public/sprites/parts');
await sharp(buf, { raw: { width: ow, height: oh, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(out, `unit_${name}.png`));
const r = (p: P): P => [+((p[0] - x0) * k).toFixed(2), +((p[1] - y0) * k).toFixed(2)];
fs.writeFileSync(path.join(out, `unit_${name}.json`), JSON.stringify({ id: name, pelvis: r(pts.pelvis), neck: r(pts.neck), muzzle: r(mz), bore: +bore.toFixed(4) }));
console.log(`wrote public/sprites/parts/unit_${name}.png/.json (${ow}x${oh}) muzzle ${mz.map(Math.round)} (guess ${pts.muzzle.map(Math.round)})`);
