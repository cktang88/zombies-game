// Pose template for an arm kit sheet (docs/research/13-character-technique.md §6, fallback G):
// the arm at the kit's elbow bends, two rows (near arm lit, far arm in shade), upper arm level,
// shoulder on the left, forearm rotating up. Sent to the image model to paint over, so every kit
// drawing lands where we drew it and its shoulder / elbow / wrist pivots are known in advance.
//   npx tsx tools/kit-guide.ts                 grey capsules  → tools/rigs/src/kit_guide_arm.png
//   npx tsx tools/kit-guide.ts --rig=surv_rifle  the rig's own upperArm + forearm art (a rig render)
//                                              → tools/rigs/src/kit_guide_<rig>.png
// Both write a .json beside the png: { bends, rows: [[{ s, e, w }]] } in image px.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
/** elbow bends of the kit drawings, degrees, left to right (forearm rotating up from a level upper arm) */
export const KIT_BENDS = [0, 40, 80, 115, 145];
const W = 1400, H = 700, COL = W / 5;
const rigArg = process.argv.find((a) => a.startsWith('--rig='))?.slice(6);
type P = [number, number];
const rows: { s: P; e: P; w: P }[][] = [[], []];

if (!rigArg) {
  const K = 2.7, UA = 42 * K, FA = 33 * K, T0 = 12 * K, T1 = 9.5 * K, T2 = 8 * K;
  const seg = (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
    const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
    return `<polygon points="${x0 + nx * r0},${y0 + ny * r0} ${x1 + nx * r1},${y1 + ny * r1} ${x1 - nx * r1},${y1 - ny * r1} ${x0 - nx * r0},${y0 - ny * r0}"/>`;
  };
  let body = '';
  KIT_BENDS.forEach((bd, i) => [0, 1].forEach((row) => {
    const sx = i * COL + COL * 0.2, sy = H * (row ? 0.84 : 0.36), b = (-bd * Math.PI) / 180;
    const ex = sx + UA, ey = sy, wx = ex + Math.cos(b) * FA, wy = ey + Math.sin(b) * FA;
    rows[row].push({ s: [sx, sy], e: [ex, ey], w: [wx, wy] });
    const shapes = `<circle cx="${sx}" cy="${sy}" r="${T0}"/><circle cx="${ex}" cy="${ey}" r="${T1}"/>${seg(sx, sy, T0, ex, ey, T1)}${seg(ex, ey, T1, wx, wy, T2)}`;
    const cuff = `<ellipse cx="${wx}" cy="${wy}" rx="${T2 * 0.35}" ry="${T2 * 0.95}" transform="rotate(${-bd} ${wx} ${wy})" fill="#151515"/>`;
    body += `<g fill="#111" stroke="#111" stroke-width="10" stroke-linejoin="round">${shapes}</g><g fill="${row ? '#5e5e5e' : '#9a9a9a'}">${shapes}</g>${cuff}`;
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#ff00ff"/>${body}</svg>`;
  await write('kit_guide_arm', await sharp(Buffer.from(svg)).png().toBuffer());
} else {
  // a rig render: the cut upperArm / forearm parts (clipped at the elbow / wrist as rig.ts does),
  // posed by inverse-mapping every output pixel into the part (bilinear)
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, `public/sprites/parts/${rigArg}.json`), 'utf8'));
  const { data: A, info } = await sharp(path.join(ROOT, `public/sprites/parts/${rigArg}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) out.set([255, 0, 255, 255], i * 4);
  const ua = meta.parts.upperArm, fa = meta.parts.forearm;
  const K = 2.7;
  const sample = (x: number, y: number, m: any): number[] | null => {
    if (x < 0 || y < 0 || x > m.w - 1 || y > m.h - 1) return null;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, r = [0, 0, 0, 0];
    for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
      const xx = Math.min(m.w - 1, x0 + dx), yy = Math.min(m.h - 1, y0 + dy), o = ((m.y + yy) * info.width + m.x + xx) * 4;
      const a = A[o + 3] / 255;
      for (let c = 0; c < 3; c++) r[c] += A[o + c] * a * wt;
      r[3] += a * wt;
    }
    return r[3] > 0.01 ? [r[0] / r[3], r[1] / r[3], r[2] / r[3], r[3]] : null;
  };
  const place = (m: any, P: P, ang: number, clipL: number, shade: number) => {
    const r = ang - m.rest, c = Math.cos(-r), s = Math.sin(-r), cr = Math.cos(m.rest), sr = Math.sin(m.rest);
    const R = Math.hypot(m.w, m.h) * K;
    for (let y = Math.max(0, Math.floor(P[1] - R)); y < Math.min(H, P[1] + R); y++) for (let x = Math.max(0, Math.floor(P[0] - R)); x < Math.min(W, P[0] + R); x++) {
      const dx = (x - P[0]) / K, dy = (y - P[1]) / K;
      const qx = c * dx - s * dy, qy = s * dx + c * dy;
      if (qx * cr + qy * sr > clipL) continue;
      const v = sample(m.px + qx, m.py + qy, m);
      if (!v) continue;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = Math.round(out[o + k] * (1 - v[3]) + v[k] * shade * v[3]);
    }
  };
  KIT_BENDS.forEach((bd, i) => [0, 1].forEach((row) => {
    const sx = i * COL + COL * 0.16, sy = H * (row ? 0.8 : 0.34), b = (-bd * Math.PI) / 180;
    const ex = sx + ua.len * K, wx = ex + Math.cos(b) * fa.len * K, wy = sy + Math.sin(b) * fa.len * K;
    rows[row].push({ s: [sx, sy], e: [ex, sy], w: [wx, wy] });
    const shade = row ? 0.5 : 1;
    place(ua, [sx, sy], 0, Math.hypot(ua.tx - ua.px, ua.ty - ua.py) + 7, shade);
    place(fa, [ex, sy], b, Math.hypot(fa.tx - fa.px, fa.ty - fa.py) + 3, shade);
  }));
  await write(`kit_guide_${rigArg}`, await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
}

async function write(name: string, png: Buffer) {
  fs.writeFileSync(path.join(ROOT, `tools/rigs/src/${name}.png`), png);
  fs.writeFileSync(path.join(ROOT, `tools/rigs/src/${name}.json`), JSON.stringify({ w: W, h: H, bends: KIT_BENDS, rows }, null, 1));
  console.log(`wrote tools/rigs/src/${name}.png/.json`);
}
