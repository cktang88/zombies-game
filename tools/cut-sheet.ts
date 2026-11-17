// Cuts an arm kit sheet (docs/research/13-character-technique.md §6) into kit drawings by connected
// components, and takes each drawing's shoulder / elbow / wrist pivots from the pose template it was
// painted over (tools/kit-guide.ts writes the template's .json). Output, at rig scale:
//   public/sprites/parts/kit_<name>.png   the drawings packed in a row per side
//   public/sprites/parts/kit_<name>.json  { bends, near: [KitDraw], far: [KitDraw] }
// KitDraw = { bend, x, y, w, h, s, e, wr } (pivots inside the drawing, px).
//   npx tsx tools/cut-sheet.ts <keyed.png> <guide.json> <name> [--k=2.7]
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [srcArg, guideArg, name] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const K = Number(process.argv.find((a) => a.startsWith('--k='))?.slice(4) ?? 2.7);
const AUTO = process.argv.includes("--auto");
const sideArg = process.argv.find((a) => a.startsWith("--side="))?.slice(7);
/** upper arm + forearm, rig units (surv_rifle 42 + 29): --auto drawings are scaled to it */
const ARM_LEN = Number(process.argv.find((a) => a.startsWith("--len="))?.slice(6) ?? 71);
type P = [number, number];
const guide = JSON.parse(fs.readFileSync(guideArg, 'utf8')) as { w: number; h: number; bends: number[]; rows: { s: P; e: P; w: P }[][]; byLen?: boolean; bendsAt?: number[][] };
const { data, info } = await sharp(srcArg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, gs = W / guide.w; // the model may return another size
const alpha = (i: number) => data[i * 4 + 3];

// connected components (4-neighbour flood fill on alpha > 96)
const lab = new Int32Array(W * H).fill(-1);
const comps: { n: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }[] = [];
for (let i = 0; i < W * H; i++) {
  if (lab[i] >= 0 || alpha(i) <= 96) continue;
  const id = comps.length, c = { n: 0, x0: W, y0: H, x1: 0, y1: 0, cx: 0, cy: 0 };
  const st = [i]; lab[i] = id;
  while (st.length) {
    const j = st.pop()!, x = j % W, y = (j - x) / W;
    c.n++; c.cx += x; c.cy += y; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
    for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && lab[k] < 0 && alpha(k) > 96 && Math.abs((k % W) - x) <= 1) { lab[k] = id; st.push(k); }
  }
  c.cx /= c.n; c.cy /= c.n;
  comps.push(c);
}
const big = comps.map((c, id) => ({ ...c, id })).filter((c) => c.n > W * H * 0.002);
console.log(`${comps.length} components, ${big.length} big`);

interface KitDraw { bend: number; x: number; y: number; w: number; h: number; s: P; e: P; wr: P; fit: number }
const sides: KitDraw[][] = [[], []];
const tiles: { buf: Buffer; w: number; h: number; row: number }[] = [];
for (const [row, list] of guide.rows.entries()) for (const [i, g0] of list.entries()) {
  let g = g0;
  // the component under the template's shoulder→elbow→wrist path (most samples inside it)
  const votes = new Map<number, number>();
  let inside = 0, tot = 0;
  for (const [a, b] of [[g.s, g.e], [g.e, g.w]] as [P, P][]) for (let t = 0; t <= 1; t += 0.05) {
    const x = Math.round((a[0] + (b[0] - a[0]) * t) * gs), y = Math.round((a[1] + (b[1] - a[1]) * t) * gs);
    const l = lab[y * W + x]; tot++;
    if (l >= 0) { votes.set(l, (votes.get(l) ?? 0) + 1); inside++; }
  }
  let best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  // --auto: the model redrew the arms in its own geometry; take the drawing in the template's
  // slot (row, column order) and find its pivots from the art itself
  let piv: { s: P; e: P; w: P; bend: number } | null = null;
  if (AUTO) {
    const inRow = big.filter((c) => (c.cy < H / 2 ? 0 : 1) === row).sort((a, b) => a.cx - b.cx);
    best = inRow[i]?.id;
    if (best !== undefined) piv = autoPivots(best);
    if (best !== undefined && !piv) { console.warn(`row ${row} #${i}: no cuff found, dropped`); continue; }
  }
  if (best === undefined) { console.warn(`row ${row} #${i}: no drawing on the template path`); continue; }
  if (sideArg && sideArg !== (row ? 'far' : 'near')) continue;
  if (piv) g = { s: [piv.s[0] / gs, piv.s[1] / gs], e: [piv.e[0] / gs, piv.e[1] / gs], w: [piv.w[0] / gs, piv.w[1] / gs] };
  const c = comps[best];
  const pad = 2, x0 = Math.max(0, c.x0 - pad), y0 = Math.max(0, c.y0 - pad), w = Math.min(W - 1, c.x1 + pad) - x0 + 1, h = Math.min(H - 1, c.y1 + pad) - y0 + 1;
  const cut = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y0 + y) * W + x0 + x;
    if (lab[j] === best || (lab[j] < 0 && alpha(j) > 0 && near(j, best))) cut.set(data.subarray(j * 4, j * 4 + 4), (y * w + x) * 4);
  }
  // to rig scale: template px / K = rig units
  // hand-placed / found pivots: scale the whole arm to the rig arm length
  const k = piv || guide.byLen ? ARM_LEN / ((Math.hypot(g.e[0] - g.s[0], g.e[1] - g.s[1]) + Math.hypot(g.w[0] - g.e[0], g.w[1] - g.e[1])) * gs) : 1 / (K * gs), tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
  const buf = await sharp(cut, { raw: { width: w, height: h, channels: 4 } }).resize(tw, th, { kernel: 'lanczos3' }).raw().toBuffer();
  const loc = (p: P): P => [+((p[0] * gs - x0) * k).toFixed(2), +((p[1] * gs - y0) * k).toFixed(2)];
  sides[row].push({ bend: piv ? piv.bend : guide.bendsAt?.[row]?.[i] ?? guide.bends[i], x: 0, y: 0, w: tw, h: th, s: loc(g.s), e: loc(g.e), wr: loc(g.w), fit: +(inside / tot).toFixed(2) });
  tiles.push({ buf, w: tw, h: th, row });
  console.log(`${row ? 'far ' : 'near'} ${guide.bends[i]}°: ${w}x${h} → ${tw}x${th}, template path inside the drawing ${Math.round((inside / tot) * 100)}%`);
}
/**
 * Pivots of a drawn arm from its pixels: the wrist is the centre of the cuff opening (the biggest
 * patch of near-black that is wider than an ink line), the shoulder the centre of the round cap
 * farthest from it (deepest point of the distance transform near the far end), the elbow the deepest
 * point behind the outer corner of the bend (or 42/71 of the way for a straight arm).
 */
function autoPivots(id: number): { s: P; e: P; w: P; bend: number } | null {
  const c = comps[id];
  const x0 = c.x0, y0 = c.y0, w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
  const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && lab[(y0 + y) * W + x0 + x] === id;
  const lum = (x: number, y: number) => { const o = ((y0 + y) * W + x0 + x) * 4; return 0.3 * data[o] + 0.59 * data[o + 1] + 0.11 * data[o + 2]; };
  // chamfer distance transform of the mask
  const dt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dt[y * w + x] = inM(x, y) ? 1e9 : 0;
  const d = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dt[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (dt[i]) dt[i] = Math.min(dt[i], d(x - 1, y) + 1, d(x, y - 1) + 1, d(x - 1, y - 1) + 1.414, d(x + 1, y - 1) + 1.414); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (dt[i]) dt[i] = Math.min(dt[i], d(x + 1, y) + 1, d(x, y + 1) + 1, d(x + 1, y + 1) + 1.414, d(x - 1, y + 1) + 1.414); }
  // cuff: near-black pixels with a near-black 9x9 neighbourhood (ink lines are thinner)
  const R = Math.max(3, Math.round(W / 300));
  let wx = 0, wy = 0, wn = 0;
  for (let y = R; y < h - R; y += 2) for (let x = R; x < w - R; x += 2) {
    if (!inM(x, y) || lum(x, y) > 26) continue;
    let ok = true;
    for (let yy = -R; yy <= R && ok; yy += 2) for (let xx = -R; xx <= R && ok; xx += 2) if (!inM(x + xx, y + yy) || lum(x + xx, y + yy) > 32) ok = false;
    if (ok) { wx += x; wy += y; wn++; }
  }
  if (!wn) return null;
  const Wp: P = [wx / wn, wy / wn];
  const deepNear = (p: P, rad: number): P => {
    let b: P = p, bv = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - p[0], y - p[1]) < rad && dt[y * w + x] > bv) { bv = dt[y * w + x]; b = [x, y]; }
    return b;
  };
  let maxDt = 0;
  for (const v of dt) maxDt = Math.max(maxDt, v);
  let F: P = Wp, fd = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inM(x, y)) { const dd = Math.hypot(x - Wp[0], y - Wp[1]); if (dd > fd) { fd = dd; F = [x, y]; } }
  const S = deepNear(F, maxDt * 1.4);
  // outer corner: the mask point farthest from the shoulder-wrist line
  const ux = Wp[0] - S[0], uy = Wp[1] - S[1], ul = Math.hypot(ux, uy) || 1;
  let Pc: P = S, pd = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inM(x, y)) {
    const t = ((x - S[0]) * ux + (y - S[1]) * uy) / ul / ul;
    if (t < 0.15 || t > 0.85) continue;
    const dd = Math.abs((x - S[0]) * uy - (y - S[1]) * ux) / ul;
    if (dd > pd) { pd = dd; Pc = [x, y]; }
  }
  const straight = pd < maxDt * 1.25;
  const E: P = straight ? [S[0] + ux * (42 / 71), S[1] + uy * (42 / 71)] : deepNear(Pc, maxDt * 1.6);
  const a1 = Math.atan2(E[1] - S[1], E[0] - S[0]), a2 = Math.atan2(Wp[1] - E[1], Wp[0] - E[0]);
  let bend = ((a1 - a2) * 180) / Math.PI;
  bend = ((bend % 360) + 540) % 360 - 180;
  const abs = (p: P): P => [p[0] + x0, p[1] + y0];
  return { s: abs(S), e: abs(E), w: abs(Wp), bend: Math.round(bend) };
}
/** soft edge pixels next to the component (kept for antialiasing) */
function near(j: number, id: number) { return lab[j - 1] === id || lab[j + 1] === id || lab[j - W] === id || lab[j + W] === id; }

// --match=<rig>: per-channel gain so the drawings' mean colour equals the rig's own cut arm parts
// (the model drifts the jacket's hue and value; the torso keeps the original's)
// mid-tones only: the kit has thicker ink and black cuff openings that would skew a plain mean
const matchArg = process.argv.find((a) => a.startsWith('--match='))?.slice(8);
if (matchArg) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, `public/sprites/parts/${matchArg}.json`), 'utf8'));
  const { data: A, info: ai } = await sharp(path.join(ROOT, `public/sprites/parts/${matchArg}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const want = [0, 0, 0], got = [0, 0, 0];
  let wn = 0, gn = 0;
  for (const p of ['upperArm', 'forearm'].map((n) => meta.parts[n])) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const o = ((p.y + y) * ai.width + p.x + x) * 4;
    if (A[o + 3] > 200 && A[o] + A[o + 1] + A[o + 2] > 120) { for (let c = 0; c < 3; c++) want[c] += A[o + c]; wn++; }
  }
  for (const t of tiles) for (let o = 0; o < t.buf.length; o += 4) if (t.buf[o + 3] > 200 && t.buf[o] + t.buf[o + 1] + t.buf[o + 2] > 120) { for (let c = 0; c < 3; c++) got[c] += t.buf[o + c]; gn++; }
  const gain = want.map((v, c) => v / wn / Math.max(1, got[c] / gn));
  console.log(`colour match to ${matchArg}: gain ${gain.map((g) => g.toFixed(2)).join(' ')}`);
  for (const t of tiles) for (let o = 0; o < t.buf.length; o += 4) for (let c = 0; c < 3; c++) t.buf[o + c] = Math.min(255, Math.round(t.buf[o + c] * gain[c]));
}

// pack: one row per side, 4 px gutters
const G = 4;
const rowsW = [0, 1].map((r) => tiles.filter((t) => t.row === r).reduce((s, t) => s + t.w + G, G));
const rowsH = [0, 1].map((r) => Math.max(0, ...tiles.filter((t) => t.row === r).map((t) => t.h)) + G);
const AW = Math.max(...rowsW), AH = rowsH[0] + rowsH[1] + G;
const comp: OverlayOptions[] = [];
const xs = [G, G], idx = [0, 0];
for (const t of tiles) {
  const d = sides[t.row][idx[t.row]++];
  d.x = xs[t.row]; d.y = t.row ? rowsH[0] + G : G;
  xs[t.row] += t.w + G;
  comp.push({ input: t.buf, raw: { width: t.w, height: t.h, channels: 4 }, left: d.x, top: d.y });
}
const out = path.join(ROOT, 'public/sprites/parts');
await sharp({ create: { width: AW, height: AH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png({ compressionLevel: 9 }).toFile(path.join(out, `kit_${name}.png`));
fs.writeFileSync(path.join(out, `kit_${name}.json`), JSON.stringify({ id: name, bends: guide.bends, near: sides[0], far: sides[1] }));
console.log(`wrote public/sprites/parts/kit_${name}.png/.json (${AW}x${AH})`);
