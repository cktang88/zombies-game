/// <reference lib="dom" />
// Headless crowd audit (docs/research/09-animation.md §Crowd audit): per Turned type and walk
// variant, the drawn height in metres against a 1.75 m survivor in the same lane, ground speed
// (px/s and m/s), cadence (steps/min), step length, foot skate (how far a planted foot slides over
// a contact, as a fraction of the ground covered meanwhile: 0 = glued) and the knee bend at mid-stance.
//   npx tsx tools/crowd-audit.ts            (table)
//   npx tsx tools/crowd-audit.ts --json     (machine-readable)
// Exit code 1 if any variant's planted feet skate more than 6% of ground speed.
import { readFileSync } from 'node:fs';
import { createRig, loadRig, STYLES, SPRITE_RIGS } from '../src/anim';
import { GAITS } from '../src/anim/gait';
import type { RigAsset, RigMeta } from '../src/anim/assets';
import { ZOMBIES, paceOf } from '../src/data/zombies';
import { N_FT, F_FT, N_TH, N_SN } from '../src/anim/skeleton';

/** One foot's ground contacts: how far it slid over each whole contact (net, so sub-pixel IK
 *  jitter doesn't count), against how far the body travelled meanwhile. */
class Contact {
  x0 = NaN; x = NaN; t = 0; slid = 0; trav = 0;
  step(on: boolean, wx: number, dt: number) {
    if (on) { if (Number.isNaN(this.x0)) { this.x0 = wx; this.t = 0; } this.x = wx; this.t += dt; return; }
    if (!Number.isNaN(this.x0) && this.t > 0.05) { this.slid += Math.abs(this.x - this.x0); this.trav += this.t; }
    this.x0 = NaN;
  }
  static skate(cs: Contact[], v: number) {
    const s = cs.reduce((a, c) => a + c.slid, 0), t = cs.reduce((a, c) => a + c.trav, 0);
    return t > 0 ? s / (t * v) : 0;
  }
}

const ZS = 1.3, SH = 158; // actors.ts: Turned display scale, survivor display height
const LANES = [604, 628, 655, 685];
const depth = (y: number) => (y - 330) / (664 - 330);
const SURV_M = 1.75;
const metas = new Map<string, RigMeta>();
const meta = (id: string) => {
  let m = metas.get(id);
  if (!m) { m = JSON.parse(readFileSync(`public/sprites/parts/${id}.json`, 'utf8')) as RigMeta; metas.set(id, m); }
  return m;
};
const stature = (m: RigMeta) => (m.ground - m.joints.headTop[1]) / m.height; // headTop..ground, fraction of meta.height
const survFrac = stature(meta('surv_rifle'));
/** px per metre in a lane: a 1.75 m survivor is SH * depth px tall there */
const pxPerM = (lane: number) => (SH * depth(LANES[lane]) * survFrac) / SURV_M;

interface Row { type: string; sprite: string; gait: string; hM: number; hPx: number[]; vPx: number; vM: number; spm: number; stepM: number; skate: number; knee: number; lodSkate: number }
const rows: Row[] = [];
const json = process.argv.includes('--json');
const LANE = 2;
for (const def of Object.values(ZOMBIES)) {
  if (def.id === 'tunneler') continue;
  for (const sprite of def.sprites) {
    const sr = SPRITE_RIGS[sprite];
    if (!sr) continue;
    await loadRig(sprite);
    const m = meta(sprite);
    const asset = { meta: m, atlas: null, dark: null, shadow: null, flash: null, skins: new Map() } as unknown as RigAsset;
    const style = sr.kind === 'survivor' ? sr.style : STYLES[def.id] ? def.id : sr.style;
    const walks = [...new Set(STYLES[style].walks)];
    const bodyH = def.crawl ? ZOMBIES.sleeper.height : def.height;
    const hM = (bodyH * ZS * stature(m)) / (SH * survFrac) * SURV_M * (def.crawl ? 1 : 1);
    const hPx = LANES.map((_, i) => Math.round(def.crawl ? def.height * ZS * depth(LANES[i]) : bodyH * ZS * depth(LANES[i]) * stature(m)));
    const pace = paceOf(def);
    for (const gait of walks) for (const vk of pace.dash ? [1, pace.dash] : [1]) {
      let shown = gait;
      // a few individuals per variant (seeded jitter of the gait)
      let sk = 0, kn = 0, spm = 0, n = 0, lsk = 0;
      for (const seed of [3, 17, 101]) {
        const rig = createRig(sr.kind, sprite, { seed, style, gait });
        (rig as unknown as { attach(a: RigAsset): void }).attach(asset);
        const ds = (bodyH * ZS * depth(LANES[LANE])) / m.height;
        rig.ds = ds; rig.df = -1;
        const v = def.speed * pace.base * vk; // the type's cruising ground speed (a Deer: and its bolt)
        rig.setSpeed(v);
        const dt = 1 / 120;
        for (let i = 0; i < 240; i++) rig.update(dt); // settle into the stride
        const vRig = v / ds;
        let ph0 = rig.phase, turns = 0, kneeSum = 0, kneeN = 0;
        const feet = [new Contact(), new Contact()];
        const T = 4;
        for (let i = 0; i < T / dt; i++) {
          rig.update(dt);
          if (rig.phase < ph0) turns++;
          ph0 = rig.phase;
          // a planted foot (a crawler's planted hand): world x = rig x + body travel
          const tw = vRig * (i * dt);
          if (rig.gait.crawl) feet[0].step(Math.abs(rig.ch.nHy) < 0.01, rig.ch.nHx + tw, dt);
          else {
            feet[0].step(Math.abs(rig.ch.nFy) < 0.01, rig.jx[N_FT] + tw, dt);
            feet[1].step(Math.abs(rig.ch.fFy) < 0.01, rig.jx[F_FT] + tw, dt);
          }
          if (!rig.gait.crawl && Math.abs(rig.ch.nFy) < 0.01 && Math.abs(rig.ch.fFy) > 0.5) {
            const bend = (t: number, s: number) => Math.abs(Math.atan2(Math.sin(rig.ja[s] - rig.ja[t]), Math.cos(rig.ja[s] - rig.ja[t])));
            kneeSum += bend(N_TH, N_SN); kneeN++;
          }
        }
        shown = rig.gait.id === gait ? gait : `${gait}>${rig.gait.id}`;
        const cyc = (turns + rig.phase) / T;
        sk += Contact.skate(feet, vRig);
        kn += kneeN ? kneeSum / kneeN : 0;
        spm += cyc * 2 * 60;
        n++;
        // the crowd LOD draws the un-jittered preset (flipbook template) at the bucketed stride
        rig.lod = true;
        const lf = new Contact();
        const base = createRig(sr.kind, sprite, { seed: 1, style, gait: rig.gait.id, jitter: false });
        (base as unknown as { attach(a: RigAsset): void }).attach(asset);
        base.ds = ds; base.setSpeed(0);
        for (let i = 0; i < 3 / dt; i++) {
          rig.update(dt);
          base.phase = rig.phase; base.moving = 1; base.speedPx = v; base.strideK = rig.strideKey;
          for (let j = 0; j < 3; j++) base.update(0);
          const tw = vRig * (i * dt);
          if (base.gait.crawl) lf.step(Math.abs(base.ch.nHy) < 0.01, base.ch.nHx + tw, dt);
          else lf.step(Math.abs(base.ch.nFy) < 0.01, base.jx[N_FT] + tw, dt);
        }
        lsk += Contact.skate([lf], vRig);
      }
      const v = def.speed * pace.base * vk;
      const vM = v / pxPerM(LANE);
      const s = spm / n;
      rows.push({ type: def.id, sprite, gait: shown, hM: +hM.toFixed(2), hPx, vPx: +v.toFixed(0), vM: +vM.toFixed(2), spm: Math.round(s), stepM: +(vM / (s / 60)).toFixed(2), skate: +(sk / n).toFixed(3), knee: Math.round(((kn / n) * 180) / Math.PI), lodSkate: +(lsk / n).toFixed(3) });
    }
  }
}
if (json) console.log(JSON.stringify(rows, null, 1));
else {
  const surv = LANES.map((_, i) => Math.round(SH * depth(LANES[i]) * survFrac));
  console.log(`survivor 1.75 m drawn: ${surv.join(' / ')} px in lanes 0-3; ${LANES.map((_, i) => pxPerM(i).toFixed(0)).join(' / ')} px per m; speeds in m/s at lane ${LANE}`);
  console.log('type       sprite        gait          H m   px lanes0-3         px/s  m/s   steps/min step m  skate  lodSkate knee°');
  for (const r of rows) console.log(`${r.type.padEnd(10)} ${r.sprite.padEnd(13)} ${r.gait.padEnd(13)} ${r.hM.toFixed(2)}  ${r.hPx.join('/').padEnd(18)} ${String(r.vPx).padStart(4)}  ${r.vM.toFixed(2)}  ${String(r.spm).padStart(5)}     ${r.stepM.toFixed(2)}   ${(r.skate * 100).toFixed(1).padStart(5)}%  ${(r.lodSkate * 100).toFixed(1).padStart(5)}%  ${r.knee}`);
}
const worst = Math.max(...rows.map((r) => Math.max(r.skate, r.lodSkate)));
if (!json) console.log(`worst foot skate ${(worst * 100).toFixed(1)}% of ground speed`);
process.exit(worst > 0.06 ? 1 : 0);
