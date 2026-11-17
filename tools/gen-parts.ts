// Generates rig art (paper-doll part sheets / neutral "rig poses") with OpenRouter's image
// model, using an existing sprite as a reference image so the character stays recognisable.
// Raw results land in tools/.cache/parts-raw/<id>.png, magenta-keyed copies in
// tools/.cache/parts-keyed/<id>.png. Cutting the keyed images into part PNGs is done by
// tools/segment.ts from the joints placed in tools/rigs/<sprite>.json. Copy the raw you pick
// into tools/rigs/src/ (committed) so the cut is reproducible.
//
// Usage: npx tsx tools/gen-parts.ts [--force] [--manifest=tools/other.json] [--jobs=N] [id ...]
// Manifest (default tools/sprites-parts.json): { model, style, key, parts: [{ id, ref, prompt }] }
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromaKey } from './chroma.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
interface PartSpec {
  id: string; ref?: string; prompt: string;
  /** a pose/layout template (path from the repo root) sent as the FIRST image, before the reference */
  guide?: string;
}
interface PartManifest {
  model: string; style: string; key: string; parts: PartSpec[];
  /** Optional: centre the reference on a w×h magenta canvas at `fill` of its height. The model
   * copies the reference's aspect and framing, so a tightly cropped sprite otherwise comes back
   * as a portrait image with the head and boots cut off by the frame. */
  refCanvas?: { w: number; h: number; fill: number };
}
interface ORResponse {
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  usage?: { cost?: number };
}

const RAW = path.join(ROOT, 'tools/.cache/parts-raw');
const KEYED = path.join(ROOT, 'tools/.cache/parts-keyed');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(KEYED, { recursive: true });
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const manifestArg = args.find((a) => a.startsWith('--manifest='))?.slice('--manifest='.length);
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestArg ?? 'tools/sprites-parts.json'), 'utf8')) as PartManifest;
const MODEL = process.env.SPRITE_MODEL || manifest.model;
// --tag=x writes <id>_x.png (several runs of one prompt side by side)
const tag = args.find((a) => a.startsWith('--tag='))?.slice('--tag='.length);
const outId = (id: string) => (tag ? `${id}_${tag}` : id);

/** Reference image: the original generation if cached, else the shipped sprite. */
async function refDataUrl(id: string): Promise<string> {
  const cands = [path.join(ROOT, 'tools/.cache/raw', `${id}.png`), path.join(ROOT, 'public/sprites', `${id}.png`), path.join(ROOT, 'tools/rigs/src', `${id}.png`)];
  const f = cands.find((c) => fs.existsSync(c));
  if (!f) throw new Error(`no reference for ${id}`);
  // flatten onto magenta so the model sees the house background, cap the size to keep tokens low
  let buf = await sharp(f).flatten({ background: '#ff00ff' }).resize({ width: 768, height: 768, fit: 'inside' }).png().toBuffer();
  const rc = manifest.refCanvas;
  if (rc) {
    const fig = await sharp(f).resize({ height: Math.round(rc.h * rc.fill), width: rc.w, fit: 'inside' }).png().toBuffer();
    const m = await sharp(fig).metadata();
    buf = await sharp({ create: { width: rc.w, height: rc.h, channels: 4, background: '#ff00ff' } })
      .composite([{ input: fig, left: Math.round((rc.w - (m.width ?? 0)) / 2), top: Math.round((rc.h - (m.height ?? 0)) / 2) }])
      .flatten({ background: '#ff00ff' }).png().toBuffer();
  }
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function generate(prompt: string, ref?: string, guide?: string): Promise<{ buf: Buffer; cost: number }> {
  const content: unknown[] = [{ type: 'text', text: prompt }];
  if (guide) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${fs.readFileSync(path.resolve(ROOT, guide)).toString('base64')}` } });
  if (ref) content.push({ type: 'image_url', image_url: { url: await refDataUrl(ref) } });
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content }] }),
    });
    const j = (await r.json().catch(() => ({}))) as ORResponse;
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (url) return { buf: Buffer.from(url.split(',')[1], 'base64'), cost: j.usage?.cost ?? 0 };
    console.warn('  retry', attempt, JSON.stringify(j).slice(0, 160));
    // back off: 402 "in flight budget" / 429 clear once other requests settle
    await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
  }
  throw new Error('generation failed');
}

const list = manifest.parts.filter((p) => !only.length || only.includes(p.id));
let total = 0;
// --jobs=N caps parallel requests (OpenRouter refuses with 402 when too many are in flight)
const jobs = Number(args.find((a) => a.startsWith('--jobs='))?.slice('--jobs='.length)) || list.length;
const queue = [...list];
const worker = async () => { for (let p = queue.shift(); p; p = queue.shift()) await one(p); };
await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
async function one(p: PartSpec) {
  const raw = path.join(RAW, `${outId(p.id)}.png`);
  try {
    if (force || !fs.existsSync(raw)) {
      const g = await generate(`${p.prompt} ${manifest.style} ${manifest.key}`, p.ref, p.guide);
      fs.writeFileSync(raw, g.buf);
      total += g.cost;
      console.log(`ok ${outId(p.id)} ($${g.cost.toFixed(3)})`);
    }
    fs.writeFileSync(path.join(KEYED, `${outId(p.id)}.png`), await chromaKey(fs.readFileSync(raw)));
  } catch (e) {
    console.error(`FAIL ${p.id}`, (e as Error).message);
  }
}
console.log(`done, spent ~$${total.toFixed(3)}`);
