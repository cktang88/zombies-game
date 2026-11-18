// Pose template for an "aim unit" (docs/research/14 §3, the Flash-shooter approach): the upper body,
// both arms, both hands and the gun of one character in a correct side-view firing pose, as flat
// grey shapes (the rig's own torso and head silhouettes, capsule arms) with the real gun icon in
// place, on magenta. gen-parts.ts sends it as the `guide` image with the character as the reference,
// and the model paints the character over it as ONE drawing. The template's pelvis / neck / pocket /
// muzzle points (image px) are written beside it, as the first guess for tools/cut-unit.ts.
//   npx tsx tools/aim-guide.ts <rig> <weapon> [aim|ready|reload]
//     aim (default) → tools/rigs/src/aimguide_<rig>_<weapon>.png/.json
//     ready         → tools/rigs/src/readyguide_<rig>_<weapon>.*: LOW READY, the same body with the gun turned
//                     muzzle-down (READY_ANGLE) about the shoulder pocket, butt still in the shoulder (long guns),
//                     or a pistol pulled in to a compressed ready at the chest, muzzle down; head up, eyes forward
//     reload        → tools/rigs/src/reloadguide_<rig>_<weapon>.*: the reload key drawing: the gun off the shoulder
//                     at the chest, canted muzzle-up, magazine well toward the support hand, which is at the well
//                     (the middle of clips.ts reloadMag / reloadPistol); tube-fed guns at the hip with the support
//                     hand under the loading port (shellIn), bolt guns level with the strong hand at the open action
//                     (reloadBolt), revolvers muzzle-down with the support hand over the open cylinder (reloadRevolver)
// The json also carries `pocket`: the point the gun turns about between drawings (the butt in the shoulder for
// long guns, the near shoulder for pistols), and `mode`.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { WEAPON_ANCHORS } from '../src/anim/weaponAnchors.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [rig, weapon, modeArg] = process.argv.slice(2);
const mode = (modeArg ?? 'aim') as 'aim' | 'ready' | 'reload';
if (!['aim', 'ready', 'reload'].includes(mode)) throw new Error('mode: aim | ready | reload');
/** low-ready muzzle-down angle (rad): stances.ts lowAngle is 0.75-0.8; a touch less reads better as one drawing */
const READY_ANGLE = 0.7;
if (!rig || !weapon) throw new Error('usage: aim-guide.ts <rig> <weapon>');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, `public/sprites/parts/${rig}.json`), 'utf8'));
const atlas = path.join(ROOT, `public/sprites/parts/${rig}.png`);
const A = WEAPON_ANCHORS[weapon];
const W = 1024, H = 768, K = 4; // image px per rig unit
// a stockless long gun (the riot auto-shotgun's bird's-head grip: `butt` is a few icon px behind the grip) is not
// shouldered: it is held out in front of the chest at shoulder height, the trigger arm bent, sighting down the rib
const stockless = A.hold === 'long' && A.butt !== undefined && Math.abs(A.grip[0] - A.butt[0]) < 30;
const O: [number, number] = [stockless ? 150 : 230, 650]; // the pelvis, image px (further left when the gun is held out)
type P = [number, number];
const px = (p: P): P => [O[0] + p[0] * K, O[1] + p[1] * K];

const J = meta.joints, Pm = meta.parts;
const torsoLen = Math.hypot(J.neck[0] - J.pelvis[0], J.neck[1] - J.pelvis[1]);
const pistol = A.hold === 'pistol';
// hip fire (the LMG's stance, src/anim/stances.ts `hip`): butt tucked under the armpit, gun at the belt line, head up
const hip = A.stance === 'hip';
const lean = mode === 'ready' ? 0.06 : mode === 'reload' ? 0.12 : pistol ? 0.1 : hip ? 0.22 : 0.16; // into the gun (fault #6)
const u: P = [Math.sin(lean), -Math.cos(lean)], v: P = [Math.cos(lean), Math.sin(lean)]; // up the spine, forward
const at = (along: number, fwd: number): P => [u[0] * along + v[0] * fwd, u[1] * along + v[1] * fwd];
const shAlong = -(J.shoulder[1] - J.pelvis[1]), shFwd = J.shoulder[0] - J.pelvis[0];
const neck = at(torsoLen, 0), sh = at(shAlong, shFwd), fsh = at(shAlong + 1, shFwd + 10);
const ua = 0.18 * 240, fa = 0.152 * 240, hand = 9;
const k = A.len / (await sharp(path.join(ROOT, `public/sprites/${A.icon}.png`)).metadata()).width!;
const fl = A.flip ? -1 : 1;
// gun placement: rig units, gun horizontal, `grip` at gp
let gp: P;
// gun rotation (rad, + = muzzle down) about `piv`
let rot = 0, piv: P, pocket: P;
// the reload key drawing follows the gun's reload kind (clips.ts): mag / pistolMag at the chest, muzzle-up, support
// hand at the well; shells / lever (shellIn) down at the hip, about level, support hand feeding the loading port from
// below; bolt (reloadBolt) level at the chest, the strong hand thumbing rounds into the open action, the support hand
// on the fore-end; revolver (reloadRevolver, the speedloader beat) muzzle-down at the chest, support hand above the
// swung-out cylinder
const kind = A.reload;
const tube = kind === 'shells' || kind === 'lever', bolt = kind === 'bolt', wheel = kind === 'revolver';
if (mode === 'reload') {
  // off the shoulder, in front of the chest (clips.ts: the workspace at mid-torso, ~22 forward), canted muzzle-up
  gp = pistol ? at(torsoLen * 0.72, shFwd + 34) : tube ? at(torsoLen * 0.42, shFwd + 28) : at(torsoLen * 0.62, shFwd + 22);
  rot = wheel ? 0.6 : pistol ? -0.4 : tube ? -0.04 : bolt ? -0.08 : -0.3; piv = gp;
  pocket = sh;
} else if (stockless) {
  gp = [sh[0] + (ua + fa) * 0.8, sh[1] - 4];
  pocket = sh;
  if (mode === 'ready') rot = READY_ANGLE;
  piv = gp;
} else if (!pistol) {
  pocket = hip ? at(torsoLen - 50, shFwd + 18) : at(torsoLen - 3 - (mode === 'ready' ? 4 : 0), shFwd + 14);
  const butt = A.butt!;
  gp = [pocket[0] + (A.grip[0] - butt[0]) * k * fl, pocket[1] + (A.grip[1] - butt[1]) * k];
  if (mode === 'ready') rot = READY_ANGLE;
  piv = pocket;
} else {
  pocket = sh;
  // compressed ready: the gun pulled in to the chest, elbows bent and down, muzzle down
  gp = mode === 'ready' ? [sh[0] + (ua + fa) * 0.5, sh[1] + 16] : [sh[0] + (ua + fa) * 0.93, sh[1] - 4];
  if (mode === 'ready') rot = READY_ANGLE;
  piv = gp;
}
const rc = Math.cos(rot), rs = Math.sin(rot);
const turn = (p: P): P => [piv[0] + (p[0] - piv[0]) * rc - (p[1] - piv[1]) * rs, piv[1] + (p[0] - piv[0]) * rs + (p[1] - piv[1]) * rc];
const gpt = (p: P): P => turn([gp[0] + (p[0] - A.grip[0]) * k * fl, gp[1] + (p[1] - A.grip[1]) * k]);
// `butt` (as tools/cut-unit.ts reads it): a point back along the BORE, i.e. the icon's own x axis (the icon is
// drawn level, so the barrel is level in the template). Not the stock's butt: a stock drops below the bore line,
// and a butt-to-muzzle line would tilt the unit's gun frame 5-8 degrees off the drawn barrel.
const muzzle = gpt(A.muzzle), butt = gpt([A.muzzle[0] - 100 * fl, A.muzzle[1]]);
/** elbow-down 2-bone IK (rig units); target pulled in to reach */
function ik(s: P, t: P): [P, P] {
  let dx = t[0] - s[0], dy = t[1] - s[1];
  const d = Math.min(Math.hypot(dx, dy), ua + fa - 0.5);
  const a = Math.atan2(dy, dx); dx = Math.cos(a) * d; dy = Math.sin(a) * d;
  const c = (ua * ua + d * d - fa * fa) / (2 * ua * d), b = Math.acos(Math.max(-1, Math.min(1, c)));
  const e: P = [s[0] + Math.cos(a + b) * ua, s[1] + Math.sin(a + b) * ua];
  return [e, [s[0] + dx, s[1] + dy]];
}
const wristOf = (palm: P, back: number): P => [palm[0] - back, palm[1] + 2];
const rl = mode === 'reload';
const off = (p: P, dx: number, dy: number): P => [p[0] + dx, p[1] + dy]; // rig units, image axes
// the strong hand: the grip, or (bolt reload) just above the open action at the port, thumbing a round down
const [nE, nW] = ik(sh, wristOf(rl && bolt && A.port ? off(gpt(A.port), 0, -5) : gpt(A.grip), hand));
// the support hand: the fore-end (aim / ready), or in a reload at the bottom of the magazine well (mags), under the
// loading port (tubes), above the swung-out cylinder (revolver); a bolt reload keeps it on the fore-end
const well: P | null = A.mag ? [A.mag[0] + A.mag[2] / 2, A.mag[1] + A.mag[3]] : null;
const fore = rl && tube && A.port ? off(gpt(A.port), 1, 3)
  : rl && wheel && A.port ? off(gpt(A.port), -1, -15)
  : rl && !bolt && well ? gpt(well) : A.fore ? gpt(A.fore) : gpt([A.grip[0] - 2 * fl, A.grip[1] + 6]);
const [fE, fW] = ik(fsh, wristOf([fore[0], fore[1] + 3], hand));

const partPng = async (n: string, grey: string) => {
  const m = Pm[n];
  const buf = await sharp(atlas).extract({ left: m.x, top: m.y, width: m.w, height: m.h }).png().toBuffer();
  const flat = await sharp({ create: { width: m.w, height: m.h, channels: 4, background: grey } }).composite([{ input: buf, blend: 'dest-in' }]).png().toBuffer();
  return { m, url: `data:image/png;base64,${flat.toString('base64')}` };
};
const img = (url: string, w: number, h: number, pivot: P, at: P, rot: number) =>
  `<image href="${url}" width="${w}" height="${h}" transform="translate(${at[0]} ${at[1]}) rotate(${(rot * 180) / Math.PI}) scale(${K}) translate(${-pivot[0]} ${-pivot[1]})"/>`;
const torso = await partPng('torso', '#8c8c8c'), head = await partPng('head', '#a2a2a2');
const gunBuf = await sharp(path.join(ROOT, `public/sprites/${A.icon}.png`)).png().toBuffer();
const gm = await sharp(gunBuf).metadata();
const line = (a: P, b: P, w: number, c: string) => { const [x0, y0] = px(a), [x1, y1] = px(b); return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${c}" stroke-width="${w * K}" stroke-linecap="round"/>`; };
const arm = (s: P, e: P, w: P, c: string) => line(s, e, 13, c) + line(e, w, 10, c) + line(w, [w[0] + hand, w[1] + 1], 9, c);
// aim: chin down onto the stock (not in hip fire); ready: head up, eyes forward; reload: looking down at the well
const headRot = -Math.PI / 2 + lean + (mode === 'ready' ? 0.08 : mode === 'reload' ? 0.45 : pistol || hip ? 0.05 : stockless ? 0.15 : 0.3) - Pm.head.rest;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="#ff00ff"/>
${rl && wheel ? '' : arm(fsh, fE, fW, '#5a5a5a')}
${img(torso.url, torso.m.w, torso.m.h, [torso.m.px, torso.m.py], px([0, 0]), -Math.PI / 2 + lean - Pm.torso.rest)}
${img(head.url, head.m.w, head.m.h, [head.m.px, head.m.py], px(neck), headRot)}
${rl && wheel ? arm(fsh, fE, fW, '#5a5a5a') : '' /* the support hand over the open cylinder, in front of the chest and the bowed head */}
<image href="data:image/png;base64,${gunBuf.toString('base64')}" width="${gm.width}" height="${gm.height}" transform="translate(${px(piv)[0]} ${px(piv)[1]}) rotate(${(rot * 180) / Math.PI}) translate(${-px(piv)[0]} ${-px(piv)[1]}) translate(${px(gp)[0]} ${px(gp)[1]}) scale(${k * K * fl} ${k * K}) translate(${-A.grip[0]} ${-A.grip[1]})"/>
${arm(sh, nE, nW, '#bdbdbd')}
</svg>`;
const out = path.join(ROOT, `tools/rigs/src/${mode}guide_${rig}_${weapon}`);
await sharp(Buffer.from(svg)).png().toFile(out + '.png');
fs.writeFileSync(out + '.json', JSON.stringify({ w: W, h: H, k: K, pelvis: px([0, 0]), neck: px(neck), shoulder: px(sh), muzzle: px(muzzle), butt: px(butt), pocket: px(pocket), mode }, null, 1));
console.log('wrote', out + '.png');
