// Gun geometry against real arms: butt→grip (length of pull), butt→fore-end, per weapon, in rig
// units (240 = body height ≈ 1.8 m, so ~133 per metre).  npx tsx tools/gun-lop.ts
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { WEAPON_ANCHORS } from '../src/anim/weaponAnchors';

const M = 240 / 1.8;
for (const [id, a] of Object.entries(WEAPON_ANCHORS)) {
  if (a.hold !== 'long' && a.hold !== 'pistol' && a.hold !== 'tube') continue;
  const f = `public/sprites/${a.icon}.png`;
  if (!existsSync(f)) { console.log(id, 'no icon', f); continue; }
  const md = await sharp(f).metadata();
  const k = a.len / md.width!;
  const d = (p?: [number, number], q?: [number, number]) => (p && q ? Math.abs(p[0] - q[0]) * k : NaN);
  const r = (v: number) => (isNaN(v) ? '   -' : `${v.toFixed(0).padStart(4)} (${(v / M).toFixed(2)} m)`);
  console.log(`${id.padEnd(10)} ${a.hold.padEnd(6)} len ${String(a.len).padStart(3)}  butt→grip ${r(d(a.butt, a.grip))}  butt→fore ${r(d(a.butt, a.fore))}  grip→muzzle ${r(d(a.grip, a.muzzle))}`);
}
