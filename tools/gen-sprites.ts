// Generates game sprites through OpenRouter's cheap image models, then
// chroma-keys the magenta background, trims and downsizes them.
// Usage: npm run sprites -- [--force] [--reprocess] [id ...]
//
// Sprite sheets (a manifest's `sheets`): one generation draws several related objects in a row
// on magenta; after the key the sheet is split at the empty columns (or rows, then columns),
// and the pieces go to the sheet's items left→right (top→bottom). A sheet id on the command line
// generates the sheet; an item id generates that item alone (the fallback for a bad slot).
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
interface SpriteSpec {
  id: string;
  prompt: string;
  height?: number;
  width?: number;
  key?: boolean; // false = opaque background layer (jpg)
  kind?: 'icon';
  flip?: boolean;
  position?: string;
}
interface Manifest {
  model: string;
  prefix: string;
  suffix: string;
  bgPrefix: string;
  iconPrefix: string;
  sheetPrefix?: string;
  sprites: SpriteSpec[];
}
// Extra manifests (tools/sprites-*.json) may hold only `sprites` and inherit the rest.
type Partial2 = Partial<Manifest> & { sprites?: SpriteSpec[]; sheets?: Sheet[] };
interface Sheet { id: string; prompt?: string; items: SpriteSpec[] }
interface ORResponse {
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  usage?: { cost?: number };
}

// Read tools/sprites.json first, then every other tools/sprites*.json; each sprite keeps
// its own manifest's prompt prefixes (falling back to the base manifest's).
const files = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => /^sprites.*\.json$/.test(f)).sort((a, b) => (a === 'sprites.json' ? -1 : b === 'sprites.json' ? 1 : a.localeCompare(b)));
const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sprites.json'), 'utf8'));
const owner = new Map<SpriteSpec, Manifest>();
const sheets: { sheet: Sheet; m: Manifest }[] = [];
const inSheet = new Map<SpriteSpec, Sheet>();
for (const f of files) {
  const part: Partial2 = f === 'sprites.json' ? manifest : (JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8')) as Partial2);
  if (!('sprites' in part) && !('sheets' in part)) continue; // rig part manifests (gen-parts.ts)
  const m = { ...manifest, ...part, sprites: part.sprites ?? [] } as Manifest;
  for (const s of m.sprites) owner.set(s, m);
  for (const sh of part.sheets ?? []) {
    sheets.push({ sheet: sh, m });
    for (const s of sh.items) { owner.set(s, m); inSheet.set(s, sh); }
  }
}
const RAW = path.join(ROOT, 'tools/.cache/raw');
const OUT = path.join(ROOT, 'public/sprites');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
const reprocess = args.includes('--reprocess');
const only = args.filter((a) => !a.startsWith('--'));
const MODEL = process.env.SPRITE_MODEL || manifest.model;

async function generate(prompt: string): Promise<{ buf: Buffer; cost: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }),
    });
    const j = (await r.json().catch(() => ({}))) as ORResponse;
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (url) return { buf: Buffer.from(url.split(',')[1], 'base64'), cost: j.usage?.cost ?? 0 };
    console.warn('  retry', attempt, JSON.stringify(j).slice(0, 200));
  }
  throw new Error('generation failed');
}

// Key out the flat magenta (#FF00FF) background with a soft edge + despill.
async function chromaKey(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mag = Math.min(r, b) - g; // how "magenta" the pixel is
    if (mag > 90 && r > 120 && b > 120) data[i + 3] = 0;
    else if (mag > 35) {
      const a = 1 - (mag - 35) / 55;
      data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
      data[i] = Math.min(r, g + 25);
      data[i + 2] = Math.min(b, g + 25);
    } else if (mag > 8) {
      data[i] = r - (mag >> 1);
      data[i + 2] = b - (mag >> 1);
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function processOne(s: SpriteSpec, forced = false): Promise<number> {
  const out = path.join(OUT, `${s.id}.${s.key === false ? 'jpg' : 'png'}`);
  const raw = path.join(RAW, `${s.id}.png`);
  if (!force && !reprocess && !forced && fs.existsSync(out) && !only.length) return 0;
  let cost = 0;
  if (force || !fs.existsSync(raw)) {
    const m = owner.get(s) ?? manifest;
    const prompt = s.key === false
      ? `${m.bgPrefix} ${s.prompt}`
      : `${s.kind === 'icon' || inSheet.has(s) ? m.iconPrefix : m.prefix} ${s.prompt} ${m.suffix}`;
    const g = await generate(prompt);
    fs.writeFileSync(raw, g.buf);
    cost = g.cost;
  }
  let img: Sharp;
  if (s.key === false) {
    img = sharp(raw).resize({ width: s.width ?? 1280, height: s.height, fit: 'cover', position: s.position ?? 'centre' });
  } else {
    const keyed = await chromaKey(fs.readFileSync(raw));
    const trimmed = await sharp(keyed).trim({ threshold: 1 }).toBuffer();
    img = sharp(trimmed).resize({ height: s.height ?? 160, width: s.width, fit: 'inside', withoutEnlargement: !!inSheet.get(s) });
  }
  if (s.flip) img = img.flop();
  if (s.key === false) await img.jpeg({ quality: 82, mozjpeg: true }).toFile(out);
  else await img.png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.6 }).toFile(out);
  console.log(`ok ${s.id} ($${cost.toFixed(3)})`);
  return cost;
}

const outOf = (s: SpriteSpec) => path.join(OUT, `${s.id}.${s.key === false ? 'jpg' : 'png'}`);

/** Split a keyed sheet into `n` pieces: empty-column runs; failing that, rows then columns. */
async function splitSheet(keyed: Buffer, n: number): Promise<{ x: number; y: number; w: number; h: number }[] | null> {
  const { data, info } = await sharp(keyed).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const on = (x: number, y: number) => data[(y * W + x) * 4 + 3] > 40;
  const runs = (len: number, filled: (i: number) => number, minGap: number) => {
    const segs: [number, number, number][] = []; // start, end, mass
    let st = -1, mass = 0, gap = 0;
    for (let i = 0; i <= len; i++) {
      const f = i < len ? filled(i) : 0;
      if (f > 1) { if (st < 0) { st = i; mass = 0; } mass += f; gap = 0; }
      else if (st >= 0 && ++gap >= minGap) { segs.push([st, i - gap, mass]); st = -1; gap = 0; }
    }
    if (st >= 0) segs.push([st, len - 1, mass]);
    return segs;
  };
  // drop specks, then merge across the narrowest gaps while there are too many pieces
  const tidy = (segs: [number, number, number][]) => {
    const tot = segs.reduce((a, q) => a + q[2], 0);
    const out = segs.filter((q) => q[2] > tot * 0.012);
    while (out.length > n) {
      let bi = 0;
      for (let i = 1; i < out.length - 1; i++) if (out[i + 1][0] - out[i][1] < out[bi + 1][0] - out[bi][1]) bi = i;
      out.splice(bi, 2, [out[bi][0], out[bi + 1][1], out[bi][2] + out[bi + 1][2]]);
    }
    return out;
  };
  const colMass = (y0: number, y1: number) => (x: number) => { let c = 0; for (let y = y0; y <= y1; y++) if (on(x, y)) c++; return c; };
  const box = (x0: number, x1: number, y0: number, y1: number) => {
    let a = H, b = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (on(x, y)) { if (y < a) a = y; if (y > b) b = y; }
    return { x: x0, y: a, w: x1 - x0 + 1, h: b - a + 1 };
  };
  const cols = tidy(runs(W, colMass(0, H - 1), 6));
  if (cols.length === n) return cols.map(([a, b]) => box(a, b, 0, H - 1));
  const rows = tidy(runs(H, (y) => { let c = 0; for (let x = 0; x < W; x++) if (on(x, y)) c++; return c; }, 6)).filter(Boolean);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const [r0, r1] of rows) for (const [a, b] of tidy(runs(W, colMass(r0, r1), 6))) out.push(box(a, b, r0, r1));
  if (out.length > n) return null;
  return out.length === n ? out : null;
}

async function processSheet(sh: Sheet, m: Manifest): Promise<{ cost: number; failed: SpriteSpec[] }> {
  const raw = path.join(RAW, `${sh.id}.png`);
  let cost = 0;
  if (force || !fs.existsSync(raw)) {
    const list = sh.items.map((s, i) => `${i + 1}) ${s.prompt}`).join(' ');
    const prompt = `${m.sheetPrefix ?? m.iconPrefix} A sprite sheet of exactly ${sh.items.length} separate isolated objects laid out left to right in a single row, in this order, with wide empty magenta gaps between them; no object touches or overlaps another, each object is complete and uncropped, no labels or numbers. ${sh.prompt ?? ''} The objects: ${list} ${m.suffix}`;
    const g = await generate(prompt);
    fs.writeFileSync(raw, g.buf);
    cost = g.cost;
  }
  const keyed = await chromaKey(fs.readFileSync(raw));
  const boxes = await splitSheet(keyed, sh.items.length);
  if (!boxes) { console.warn(`SHEET ${sh.id}: could not split into ${sh.items.length}; falling back to single generations`); return { cost, failed: [...sh.items] }; }
  const failed: SpriteSpec[] = [];
  const area = boxes.reduce((a, b) => a + b.w * b.h, 0);
  for (let i = 0; i < sh.items.length; i++) {
    const s = sh.items[i], b = boxes[i];
    // a sliver or a speck is not the object asked for
    if (b.w < 16 || b.h < 12 || b.w * b.h < area * 0.02) { console.warn(`  slot ${s.id}: too small (${b.w}x${b.h})`); failed.push(s); continue; }
    const piece = await sharp(keyed).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toBuffer();
    let img = sharp(await sharp(piece).trim({ threshold: 1 }).toBuffer()).resize({ height: s.height ?? 160, width: s.width, fit: 'inside', withoutEnlargement: true });
    if (s.flip) img = img.flop();
    await img.png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.6 }).toFile(outOf(s));
    console.log(`ok ${s.id} (sheet ${sh.id}, ${b.w}x${b.h})`);
  }
  return { cost, failed };
}

let total = 0;
// sheets: named on the command line, or (no ids) any with an item not generated yet
const sheetList = sheets.filter(({ sheet }) => (only.length ? only.includes(sheet.id) : force || reprocess || sheet.items.some((s) => !fs.existsSync(outOf(s)))));
const fallback: SpriteSpec[] = [];
await Promise.all(sheetList.map(async ({ sheet, m }) => {
  try { const r = await processSheet(sheet, m); total += r.cost; fallback.push(...r.failed); } catch (e) { console.error(`FAIL ${sheet.id}`, (e as Error).message); }
}));
// singles: named items, every plain sprite (unless only sheets were named), and failed slots
const list = [...owner.keys()].filter((s) => (only.length ? only.includes(s.id) : !inSheet.has(s)));
for (const s of fallback) if (!list.includes(s)) list.push(s);
const queue = [...list];
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const s = queue.shift()!;
    const forced = fallback.includes(s);
    try { total += await processOne(s, forced); } catch (e) { console.error(`FAIL ${s.id}`, (e as Error).message); }
  }
}));
console.log(`done, spent ~$${total.toFixed(3)}`);
