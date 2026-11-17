/// <reference lib="dom" />
// Headless check that ragdoll deaths end lying flat (not kneeling / sitting upright).
// npx tsx tools/ragdoll-check.ts [sprite...]   (exit code 1 if any body settles upright)
import { readFileSync } from 'node:fs';
import { createRig, loadRig, QuadRig } from '../src/anim';
import type { RigAsset, RigMeta } from '../src/anim/assets';
import type { DieOpts } from '../src/anim/ragdoll';

const sprites = process.argv.slice(2).length ? process.argv.slice(2) : ['z_shambler', 'z_runner', 'z_brute', 'z_riot', 'surv_rifle', 'z_bloater'];
const cases: (DieOpts & { name: string; speed?: number })[] = [
  { name: 'none', impulse: { x: 0, y: 0 } },
  { name: 'tap-front', impulse: { x: -60, y: -10 }, at: 'torso', kind: 'shot' },
  { name: 'tap-back', impulse: { x: 60, y: -10 }, at: 'torso', kind: 'shot' },
  { name: 'head', impulse: { x: -120, y: -30 }, at: 'head', kind: 'headshot' },
  { name: 'melee', impulse: { x: -40, y: 0 }, at: 'torso', kind: 'melee' },
  { name: 'calm', impulse: { x: -200, y: -60 }, at: 'torso', kind: 'shot', calm: true },
  { name: 'leg', impulse: { x: -90, y: 0 }, at: 'legN', kind: 'shot' },
  { name: 'shotgun', impulse: { x: -600, y: -200 }, at: 'torso', kind: 'shotgun' },
  { name: 'walking', impulse: { x: -50, y: 0 }, speed: 40 },
];
let bad = 0, natural = 0, n = 0, tSum = 0;
for (const id of sprites) {
  await loadRig(id); // fails in node (no fetch base): attach the atlas meta by hand
  const meta = JSON.parse(readFileSync(`public/sprites/parts/${id}.json`, 'utf8')) as RigMeta;
  const asset = { meta, atlas: null, dark: null, shadow: null, flash: null, skins: new Map() } as unknown as RigAsset;
  for (const c of cases) {
    const rig = createRig(id.startsWith('surv') ? 'survivor' : 'turned', id, { seed: 7, style: id === 'z_brute' ? 'ferryman' : undefined });
    (rig as unknown as { attach(a: RigAsset): void }).attach(asset);
    rig.ds = 0.6; rig.df = -1;
    rig.setSpeed(c.speed ?? 0);
    for (let i = 0; i < 40; i++) rig.update(1 / 60);
    rig.die({ ...c, authored: false });
    let t = 0;
    while (!rig.settled && t < 4) { rig.update(1 / 60); t += 1 / 60; }
    const r = rig.ragdoll!;
    const g = rig.geo!;
    const up = (r.y[0] - r.y[1]) / g.torsoLen; // pelvis below neck: 1 standing, 0 flat
    const seat = -r.y[0] / g.legLen; // pelvis height over the ground
    const ok = up < 0.45 && seat < 0.45;
    n++; tSum += t;
    if (r.t < 2.6) natural++; // came to rest on its own (not the 2.6 s cap)
    if (!ok) bad++;
    console.log(`${id.padEnd(12)} ${c.name.padEnd(10)} upright ${up.toFixed(2)} seat ${seat.toFixed(2)} t ${t.toFixed(2)} slide ${(r.x[0] / g.legLen).toFixed(2)} ${ok ? '' : '  <-- NOT FLAT'}`);
  }
}
// quadrupeds (src/anim/quad.ts): the trunk ends on the road, whatever gait it died in
{
  const meta = JSON.parse(readFileSync('public/sprites/parts/dog.json', 'utf8')) as RigMeta;
  const asset = { meta, atlas: null, dark: null, shadow: null, flash: null, skins: new Map() } as unknown as RigAsset;
  for (const c of cases) for (const v of [0, 120, 260]) {
    const rig = new QuadRig('dog', 3);
    rig.attach(asset);
    rig.setSpeed(c.speed ?? v);
    for (let i = 0; i < 40; i++) rig.update(1 / 60);
    rig.die({ impulse: c.impulse, at: c.at === 'head' ? 'head' : c.at === 'legN' ? 'legs' : 'torso', calm: c.calm });
    let t = 0;
    while (!rig.settled && t < 4) { rig.update(1 / 60); t += 1 / 60; }
    const r = rig.ragdoll!, L = rig.geo!.legLen;
    const seat = -Math.min(r.y[0], r.y[1]) / L; // the higher of hips / chest over the road
    const ok = seat < 0.35;
    n++; tSum += t;
    if (r.t < 2.6) natural++;
    if (!ok) bad++;
    console.log(`${'dog'.padEnd(12)} ${(c.name + '@' + v).padEnd(14)} trunk ${seat.toFixed(2)} t ${t.toFixed(2)} ${ok ? '' : '  <-- NOT DOWN'}`);
  }
}
console.log(`${natural}/${n} came to rest on their own (the rest hit the 2.6 s cap); mean ${(tSum / n).toFixed(2)} s`);
console.log(bad ? `${bad} not flat` : 'all flat');
process.exit(bad ? 1 : 0);
