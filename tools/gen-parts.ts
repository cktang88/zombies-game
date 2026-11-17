// Generates rig art (paper-doll part sheets / neutral "rig poses") with OpenRouter's image
// model, using an existing sprite as a reference image so the character stays recognisable.
// Raw results land in tools/.cache/parts-raw/<id>.png, magenta-keyed copies in
// tools/.cache/parts-keyed/<id>.png. Cutting the keyed images into part PNGs is done by
// tools/segment.ts from the joints placed in tools/rigs/<sprite>.json. Copy the raw you pick
// into tools/rigs/src/ (committed) so the cut is reproducible.
//
// Usage: npx tsx tools/gen-parts.ts [--force] [--manifest=tools/other.json] [id ...]
// Manifest (default tools/sprites-parts.json): { model, style, key, parts: [{ id, ref, prompt }] }
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromaKey } from './chroma.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
interface PartSpec { id: string; ref?: string; prompt: string }
interface PartManifest { model: string; style: string; key: string; parts: PartSpec[] }
interface ORResponse {
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  usage?: { cost?: number };
}

const RAW = path.join(ROOT, 'tools/.cache/parts-raw');
const KEYED = path.join(ROOT, 'tools/.cache/parts-keyed');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(KEYED, { recursive: true });
const args = process.argv.slice(2);
const manifestArg = args.find((a) => a.startsWith('--manifest='))?.slice('--manifest='.length);
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestArg ?? 'tools/sprites-parts.json'), 'utf8')) as PartManifest;
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const MODEL = process.env.SPRITE_MODEL || manifest.model;

/** Reference image: the original generation if cached, else the shipped sprite. */
async function refDataUrl(id: string): Promise<string> {
  const cands = [path.join(ROOT, 'tools/.cache/raw', `${id}.png`), path.join(ROOT, 'public/sprites', `${id}.png`)];
  const f = cands.find((c) => fs.existsSync(c));
  if (!f) throw new Error(`no reference for ${id}`);
  // flatten onto magenta so the model sees the house background, cap the size to keep tokens low
  const buf = await sharp(f).flatten({ background: '#ff00ff' }).resize({ width: 768, height: 768, fit: 'inside' }).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function generate(prompt: string, ref?: string): Promise<{ buf: Buffer; cost: number }> {
  const content: unknown[] = [{ type: 'text', text: prompt }];
  if (ref) content.push({ type: 'image_url', image_url: { url: await refDataUrl(ref) } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content }] }),
    });
    const j = (await r.json().catch(() => ({}))) as ORResponse;
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (url) return { buf: Buffer.from(url.split(',')[1], 'base64'), cost: j.usage?.cost ?? 0 };
    console.warn('  retry', attempt, JSON.stringify(j).slice(0, 300));
  }
  throw new Error('generation failed');
}

const list = manifest.parts.filter((p) => !only.length || only.includes(p.id));
let total = 0;
await Promise.all(list.map(async (p) => {
  const raw = path.join(RAW, `${p.id}.png`);
  try {
    if (force || !fs.existsSync(raw)) {
      const g = await generate(`${p.prompt} ${manifest.style} ${manifest.key}`, p.ref);
      fs.writeFileSync(raw, g.buf);
      total += g.cost;
      console.log(`ok ${p.id} ($${g.cost.toFixed(3)})`);
    }
    fs.writeFileSync(path.join(KEYED, `${p.id}.png`), await chromaKey(fs.readFileSync(raw)));
  } catch (e) {
    console.error(`FAIL ${p.id}`, (e as Error).message);
  }
}));
console.log(`done, spent ~$${total.toFixed(3)}`);
