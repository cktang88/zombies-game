// Cuts a generated "aim unit" (docs/research/14 §3: torso + head + both arms + hands + gun drawn as one
// piece in the firing pose, tools/aim-guide.ts + gen-parts.ts) into a rig-scale part with its pivots.
//   npx tsx tools/cut-unit.ts <rig> <weapon> [aim|ready|reload] [--match]
// The mode picks the drawing (tools/aim-guide.ts): aim (the firing pose), ready (low ready) or reload (the
// reload key drawing); <mode> below is that word.
// Source: tools/rigs/src/<mode>unit_<rig>_<weapon>.png (the raw generation picked from tools/.cache/parts-raw).
// Points (source px): tools/rigs/src/<mode>unit_<rig>_<weapon>.points.json when present, else the template's
// own (tools/rigs/src/<mode>guide_<rig>_<weapon>.json, scaled to the source size: the model keeps the
// template's layout, so the gun lands where the template put it):
//   { pelvis?, neck?, muzzle?, butt? (any point back along the bore), pocket?, ppu? (source px per rig unit),
//     cutY?, hips? (cutY at this many rig units below the pelvis), cutX? (drop everything left of x: a second figure or a template ghost), degrey?, shade? }
//   (keys left out come from the template)
// Output: public/sprites/parts/unit_<rig>_<weapon>[_ready|_reload].png/.json at 1 px per rig unit (the atlas
//   scale), json { pelvis, neck, muzzle, bore, pocket? } in output px; bore = the barrel's angle in the drawing
//   (rad); pocket = the point the gun turns about between drawings (the butt in the shoulder, a pistol's shoulder).
// --match: per-channel gain so the unit's mid-tones match the rig's own torso part (the model drifts
//   the clothing's hue and value; the hips under the unit are the rig's).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromaKey } from './chroma.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [rig, weapon, modeArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mode = modeArg ?? 'aim';
if (!['aim', 'ready', 'reload'].includes(mode)) throw new Error('mode: aim | ready | reload');
const name = `${rig}_${weapon}`;
const outName = mode === 'aim' ? name : `${name}_${mode}`;
type P = [number, number];
type Box = [number, number, number, number]; // x0, y0, x1, y1 (source px)
const src = path.join(ROOT, `tools/rigs/src/${mode}unit_${name}.png`);
const { data, info } = await sharp(await chromaKey(fs.readFileSync(src))).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const guide = JSON.parse(fs.readFileSync(path.join(ROOT, `tools/rigs/src/${mode}guide_${name}.json`), 'utf8'));
const pf = path.join(ROOT, `tools/rigs/src/${mode}unit_${name}.points.json`);
const gs = W / guide.w;
// a points file may give only some keys (e.g. just cutY / degrey); the rest come from the template
const pts: { pelvis: P; neck: P; muzzle: P; butt: P; pocket?: P; ppu: number; cutY?: number; hips?: number; cutX?: number; degrey?: boolean | Box[]; shade?: Box[] } = {
  pocket: guide.pocket?.map((v: number) => v * gs),
  pelvis: guide.pelvis.map((v: number) => v * gs), neck: guide.neck.map((v: number) => v * gs), muzzle: guide.muzzle.map((v: number) => v * gs), butt: guide.butt.map((v: number) => v * gs), ppu: guide.k * gs,
  ...(fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {}),
};
if (pts.cutY === undefined && pts.hips !== undefined) pts.cutY = pts.pelvis[1] + pts.hips * pts.ppu;
if (pts.cutY !== undefined) for (let y = Math.round(pts.cutY); y < H; y++) for (let x = 0; x < W; x++) data[(y * W + x) * 4 + 3] = 0;
if (pts.cutX !== undefined) for (let y = 0; y < H; y++) for (let x = 0; x < Math.min(W, Math.round(pts.cutX)); x++) data[(y * W + x) * 4 + 3] = 0;
// degrey: the model sometimes leaves a piece of the template (a flat neutral-grey arm, hip or shadow) unpainted
// behind the figure. Drop large connected areas of flat grey (r = g = b, mid values: the template's greys are
// 5a..bd), plus a 2 px fringe of near-grey round them. Opt-in per unit: a white or grey garment would match too, so
// `degrey` may instead be a list of boxes (source px) that the dropped grey must lie in.
// shade: [[x0, y0, x1, y1], ...] (source px) — boxes where the grey is the FAR ARM the model left unpainted: there it is
// not dropped (the hand would float) but repainted as the arm in shadow (the figure's own mid-tone at ~half value,
// keeping the template's light / dark step); the rig's outline pass inks it like any other edge.
const inBox = (bs: Box[] | undefined, i: number) => (bs ?? []).some(([a, b, c, d]) => { const x = i % W, y = (i - x) / W; return x >= a && x <= c && y >= b && y <= d; });
const inShade = (i: number) => inBox(pts.shade, i);
const inDrop = (i: number) => pts.degrey === true || inBox(Array.isArray(pts.degrey) ? pts.degrey : undefined, i);
if (pts.degrey || pts.shade) {
  const flat = (i: number) => { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; return data[i * 4 + 3] > 0 && (inShade(i) || inDrop(i)) && Math.max(r, g, b) - Math.min(r, g, b) <= 8 && r >= (inShade(i) ? 72 : 110) && r <= 225; };
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
  // the shade colour: the figure's own coloured (not grey) mid-tones, averaged
  const tone = [0, 0, 0]; let tn = 0;
  for (let i = 0; i < W * H; i++) {
    if (kill[i] || data[i * 4 + 3] < 200) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 16 && r + g + b > 150 && r + g + b < 520) { tone[0] += r; tone[1] += g; tone[2] += b; tn++; }
  }
  let n = 0, sh = 0;
  for (let i = 0; i < W * H; i++) {
    if (!kill[i]) continue;
    if (inShade(i)) {
      const v = 0.42 + 0.25 * (data[i * 4] / 255); // keep the template's light / dark arm step, darker overall
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round((tone[c] / Math.max(1, tn)) * v);
      data[i * 4 + 3] = 255; sh++;
    } else { data[i * 4 + 3] = 0; n++; }
  }
  console.log(`degrey: dropped ${n} px of template grey, shaded ${sh} px as the far arm`);
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
await sharp(buf, { raw: { width: ow, height: oh, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(out, `unit_${outName}.png`));
const r = (p: P): P => [+((p[0] - x0) * k).toFixed(2), +((p[1] - y0) * k).toFixed(2)];
fs.writeFileSync(path.join(out, `unit_${outName}.json`), JSON.stringify({ id: outName, pelvis: r(pts.pelvis), neck: r(pts.neck), muzzle: r(mz), bore: +bore.toFixed(4), ...(pts.pocket ? { pocket: r(pts.pocket) } : {}) }));
console.log(`wrote public/sprites/parts/unit_${outName}.png/.json (${ow}x${oh}) muzzle ${mz.map(Math.round)} (guess ${pts.muzzle.map(Math.round)})`);
