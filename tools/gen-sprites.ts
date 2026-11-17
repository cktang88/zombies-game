// Generates game sprites through OpenRouter's cheap image models, then
// chroma-keys the magenta background, trims and downsizes them.
// Usage: npm run sprites -- [--force] [--reprocess] [id ...]
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
  sprites: SpriteSpec[];
}
interface ORResponse {
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  usage?: { cost?: number };
}

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sprites.json'), 'utf8'));
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

async function processOne(s: SpriteSpec): Promise<number> {
  const out = path.join(OUT, `${s.id}.${s.key === false ? 'jpg' : 'png'}`);
  const raw = path.join(RAW, `${s.id}.png`);
  if (!force && !reprocess && fs.existsSync(out) && !only.length) return 0;
  let cost = 0;
  if (force || !fs.existsSync(raw)) {
    const prompt = s.key === false
      ? `${manifest.bgPrefix} ${s.prompt}`
      : `${s.kind === 'icon' ? manifest.iconPrefix : manifest.prefix} ${s.prompt} ${manifest.suffix}`;
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
    img = sharp(trimmed).resize({ height: s.height ?? 160, width: s.width, fit: 'inside' });
  }
  if (s.flip) img = img.flop();
  if (s.key === false) await img.jpeg({ quality: 82, mozjpeg: true }).toFile(out);
  else await img.png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.6 }).toFile(out);
  console.log(`ok ${s.id} ($${cost.toFixed(3)})`);
  return cost;
}

const list = manifest.sprites.filter((s) => !only.length || only.includes(s.id));
let total = 0;
const queue = [...list];
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const s = queue.shift()!;
    try { total += await processOne(s); } catch (e) { console.error(`FAIL ${s.id}`, (e as Error).message); }
  }
}));
console.log(`done, spent ~$${total.toFixed(3)}`);
