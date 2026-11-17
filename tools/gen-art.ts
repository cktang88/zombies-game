// Generates the ledger's painted art (not world sprites): the title key art and the epilogue
// plates. The game falls back to the parallax layers (bg_*) when a plate is missing, so these are
// an upgrade, not a dependency. (Survivor bust portraits are cut by tools/make-portraits.py.)
// Opaque images: no chroma key. Written as JPEG to public/art/<id>.jpg.
//   npx tsx tools/gen-art.ts [--force] [--reprocess] [--jobs=N] [id ...]
// Manifest: tools/art.json { model, style, items: [{ id, prompt, ref?, w, h, aspect? }] }
// A ref is a sprite id: the original generation in tools/.cache/raw/<ref>.png if cached, else
// public/sprites/<ref>.png.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
interface ArtSpec { id: string; prompt: string; ref?: string; w: number; h: number; aspect?: string; position?: string }
interface ArtManifest { model: string; style: string; items: ArtSpec[] }
interface ORResponse {
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  usage?: { cost?: number };
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/art.json'), 'utf8')) as ArtManifest;
const RAW = path.join(ROOT, 'tools/.cache/art-raw');
const OUT = path.join(ROOT, 'public/art');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const MODEL = process.env.SPRITE_MODEL || manifest.model;

async function refDataUrl(id: string): Promise<string> {
  const cands = [path.join(ROOT, 'tools/.cache/raw', `${id}.png`), path.join(ROOT, 'public/sprites', `${id}.png`)];
  const f = cands.find((c) => fs.existsSync(c));
  if (!f) throw new Error(`no reference for ${id}`);
  const buf = await sharp(f).flatten({ background: '#2a2622' }).resize({ width: 768, height: 768, fit: 'inside' }).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function generate(spec: ArtSpec): Promise<{ buf: Buffer; cost: number }> {
  const content: unknown[] = [{ type: 'text', text: `${spec.prompt} ${manifest.style}` }];
  if (spec.ref) content.push({ type: 'image_url', image_url: { url: await refDataUrl(spec.ref) } });
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content }],
        ...(spec.aspect ? { image_config: { aspect_ratio: spec.aspect } } : {}),
      }),
    });
    const j = (await r.json().catch(() => ({}))) as ORResponse;
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (url) return { buf: Buffer.from(url.split(',')[1], 'base64'), cost: j.usage?.cost ?? 0 };
    console.warn('  retry', spec.id, attempt, JSON.stringify(j).slice(0, 160));
    await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
  }
  throw new Error('generation failed');
}

const list = manifest.items.filter((p) => !only.length || only.includes(p.id));
let total = 0;
const jobs = Number(args.find((a) => a.startsWith('--jobs='))?.slice('--jobs='.length)) || 4;
const queue = [...list];
const worker = async () => { for (let p = queue.shift(); p; p = queue.shift()) await one(p); };
await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
async function one(p: ArtSpec) {
  const raw = path.join(RAW, `${p.id}.png`);
  try {
    if (force || !fs.existsSync(raw)) {
      const g = await generate(p);
      fs.writeFileSync(raw, g.buf);
      total += g.cost;
      console.log(`ok ${p.id} ($${g.cost.toFixed(3)})`);
    }
    await sharp(raw).resize({ width: p.w, height: p.h, fit: 'cover', position: p.position ?? 'attention' })
      .jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(OUT, `${p.id}.jpg`));
  } catch (e) {
    console.error(`FAIL ${p.id}`, (e as Error).message);
  }
}
console.log(`done, spent ~$${total.toFixed(3)}`);
