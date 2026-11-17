// FX lab (fxlab.html): a stand-in night street to fire every gun and set off every effect in src/night/vfx,
// lit or unlit, at any effects quality, frame by frame. Debug handle: window.__fx (see the bottom).
import { loadAssets, img } from './assets';
import { bakeLayer, bakeGround, depthScale } from './night/render';
import { Vfx, laneScale, type Quality } from './night/vfx';
import { WEAPONS, fireProfile, type FireProfile } from './data/weapons';
import type { WeaponItem } from './types';

const cv = document.getElementById('cv') as HTMLCanvasElement;
const c = cv.getContext('2d')!;
const W = 1280, H = 720;
const LANES = [604, 628, 655, 685];
const GROUND_TOP = 596;
const WALL_X = 372;

const ground = document.createElement('canvas');
ground.width = W; ground.height = H;
const gctx = ground.getContext('2d')!;
const dark = document.createElement('canvas');
dark.width = W / 2; dark.height = H / 2;
const dctx = dark.getContext('2d')!;

interface Light { x: number; y: number; r: number; life: number; max: number; color: string }
let lights: Light[] = [];
let lit = false, snow = false, gore = false, auto = false, paused = false;
const vfx = new Vfx({
  ground: gctx,
  light: (x, y, r, life, color) => lights.push({ x, y, r, life, max: life, color }),
  snow: () => snow,
  gore: () => gore,
  flashes: () => true,
});

// ---------- the scene ----------
interface Dummy { x: number; lane: number; sprite: string; burn: number }
const dummies: Dummy[] = [
  { x: 560, lane: 3, sprite: 'z_shambler', burn: 0 }, { x: 700, lane: 1, sprite: 'z_shambler2', burn: 0 },
  { x: 820, lane: 2, sprite: 'z_runner', burn: 0 }, { x: 960, lane: 0, sprite: 'z_brute', burn: 0 }, { x: 1080, lane: 3, sprite: 'z_riot', burn: 0 },
];
const SHOOTER = { x: 300, y: 662, h: 158 };
const muzzle = () => ({ x: SHOOTER.x + 50, y: SHOOTER.y - 129 });
let bg: HTMLCanvasElement | null = null, band: HTMLCanvasElement | null = null;
let fires: { x: number; y: number; w: number; life: number }[] = [];
let lobs: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; pipe: boolean; r: number }[] = [];
let flaming = 0;
let t = 0, lane = 2;

function bodyBox(d: Dummy) {
  const L = LANES[d.lane];
  const h = 120 * 1.3 * depthScale(L);
  return { x: d.x, y: L, h, w: h * 0.4, head: { x: d.x - 4, y: L - h * 0.9, r: h * 0.07 } };
}

// ---------- firing ----------
let wpn = 'ar15';
function prof(id: string, ammo?: string): FireProfile {
  const w: WeaponItem = { uid: 'lab', def: id, cond: 1, kills: 0, mods: {}, ammoType: ammo as WeaponItem['ammoType'] };
  return fireProfile(w);
}
const AMMO: Record<string, string | undefined> = {};
const key = {};

function fire(id = wpn, opts: { ammo?: string; suppressed?: boolean } = {}) {
  const p = prof(id, opts.ammo ?? AMMO[id]);
  const mz = muzzle();
  const targets = dummies.filter((d) => d.lane === lane);
  const tgt = targets[0] ?? dummies[0];
  const bb = bodyBox(tgt);
  const aimY = id === 'scoped' || id === 'hunting' ? bb.head.y : bb.y - bb.h * 0.6;
  const base = Math.atan2(aimY - mz.y, bb.x - mz.x);
  vfx.muzzle({ x: mz.x, y: mz.y, ang: base, defId: id, prof: p, suppressed: opts.suppressed, scale: 1, eject: { x: SHOOTER.x + 20, y: mz.y + 6, ground: SHOOTER.y - 3, face: 1 }, key });
  if (id === 'm79' || id === 'pipemortar') {
    lobs.push({ x0: mz.x, y0: mz.y, x1: bb.x - 20, y1: LANES[lane], t: 0, dur: 0.6, pipe: id === 'pipemortar', r: id === 'm79' ? 120 : 150 });
    return;
  }
  const n = Math.max(1, Math.round(p.pellets ?? 1));
  for (let i = 0; i < n; i++) {
    const cone = n > 1 ? (p.spread ?? 0.08) * 1.4 : 0.012;
    const a = base + (Math.random() + Math.random() - 1) * cone;
    vfx.shotStart(mz.x, mz.y, id, p);
    const dx = Math.cos(a), dy = Math.sin(a);
    // the body in the lane: does the ray cross its box?
    const tx = (bb.x - mz.x) / dx;
    const yAt = mz.y + dy * tx;
    const hitBody = yAt > bb.y - bb.h && yAt < bb.y && Math.random() < 0.85;
    let ex: number, ey: number, end: 'ground' | 'body' | 'air';
    if (hitBody) {
      ex = bb.x - bb.w * 0.3; ey = yAt;
      const head = Math.abs(yAt - bb.head.y) < bb.head.r * 1.6;
      const armor = tgt.sprite === 'z_riot' && !head;
      vfx.impact(armor ? 'armor' : head ? 'head' : 'flesh', ex, ey, a, { ground: bb.y, power: Math.min(2.2, (p.dmg ?? 30) / 40), pellet: n > 1 });
      end = 'body';
      if (p.incendiary) tgt.burn = 3.5;
    } else {
      const tg = (LANES[lane] - 2 - mz.y) / dy;
      ex = mz.x + dx * tg; ey = mz.y + dy * tg; end = 'ground';
    }
    vfx.bullet({ x0: mz.x, y0: mz.y, x1: ex, y1: ey, defId: id, prof: p, pellet: n > 1, suppressed: opts.suppressed, end, laneY: LANES[lane], key });
    if (p.explosive) vfx.explosion(ex, LANES[lane], p.explosive.radius);
    if (p.flare && !p.incendiary) lights.push({ x: ex, y: LANES[lane], r: 260, life: 9, max: 9, color: '255,90,70' });
  }
}

const EFFECTS: Record<string, () => void> = {
  explosion: () => vfx.explosion(760, LANES[lane], 150),
  'big blast': () => vfx.explosion(820, LANES[lane], 240),
  molotov: () => { vfx.throwArc(SHOOTER.x + 40, SHOOTER.y - 100, 700, LANES[lane] - 8, 0.35); setTimeout(() => { fires.push({ x: 700, y: LANES[lane], w: 150, life: 7 }); lights.push({ x: 700, y: LANES[lane] - 20, r: 300, life: 7, max: 7, color: '255,150,60' }); }, 350); },
  fire: () => { fires.push({ x: 700, y: LANES[lane], w: 150, life: 7 }); lights.push({ x: 700, y: LANES[lane] - 20, r: 300, life: 7, max: 7, color: '255,150,60' }); },
  'burn bodies': () => { for (const d of dummies) d.burn = 6; },
  flamethrower: () => { flaming = 2.2; },
  armor: () => { const d = dummies[4], b = bodyBox(d); for (let i = 0; i < 3; i++) setTimeout(() => vfx.impact('armor', d.x - 8, b.y - b.h * 0.6, -0.1, { ground: b.y }), i * 120); },
  wood: () => { for (let i = 0; i < 6; i++) setTimeout(() => vfx.impact('wood', WALL_X - 6, 600 + Math.random() * 70, Math.PI + 0.1, { ground: 690 }), i * 90); },
  gib: () => { const d = dummies[1], b = bodyBox(d); vfx.gib(b.head.x, b.head.y, b.y, -0.05); },
  ground: () => { for (let i = 0; i < 6; i++) setTimeout(() => vfx.impact(snow ? 'snow' : 'ground', 520 + i * 70, LANES[lane] - 2, 0.15, { ground: LANES[lane] }), i * 60); },
};

// ---------- loop ----------
function buildDark() {
  const d = dctx, s = 0.5;
  d.globalCompositeOperation = 'source-over';
  d.clearRect(0, 0, W * s, H * s);
  d.fillStyle = `rgba(4,6,14,${lit ? 0.13 : 0.4})`;
  d.fillRect(0, 0, W * s, H * s);
  d.globalCompositeOperation = 'destination-out';
  const hole = (x: number, y: number, r: number, a: number) => {
    const g = d.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = g; d.fillRect((x - r) * s, (y - r) * s, r * 2 * s, r * 2 * s);
  };
  hole(120, 640, 260, 0.6);
  if (lit) for (let i = 0; i < 3; i++) {
    const g = d.createLinearGradient(260 * s, 0, 1100 * s, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0.1)');
    d.fillStyle = g;
    d.beginPath(); d.moveTo((260 - i * 90) * s, 380 * s); d.lineTo(1200 * s, (560 - i * 30) * s); d.lineTo(1200 * s, 720 * s); d.lineTo((260 - i * 90) * s, 400 * s); d.fill();
  }
  for (const l of lights) hole(l.x, l.y, l.r * (0.7 + 0.3 * (l.life / l.max)), Math.min(1, l.life / l.max + 0.3));
  for (const f of fires) hole(f.x, f.y - 20, 260, 0.9 * Math.min(1, f.life));
}

let frameMs = 0, frames = 0, frameSum = 0, frameMax = 0, vfxSum = 0, vfxMax = 0, nMax = 0;
function step(dt: number) {
  t += dt;
  for (const l of lights) l.life -= dt;
  lights = lights.filter((l) => l.life > 0);
  for (const f of fires) { f.life -= dt; vfx.burn(f.x, f.y, f.w, Math.min(1, f.life), dt); }
  fires = fires.filter((f) => f.life > 0);
  for (const d of dummies) if (d.burn > 0) { d.burn -= dt; const b = bodyBox(d); vfx.burnBody(d.x, b.y, b.h, dt); }
  for (const l of lobs) { l.t += dt; if (l.t >= l.dur) vfx.explosion(l.x1, l.y1, l.r); }
  lobs = lobs.filter((l) => l.t < l.dur);
  if (flaming > 0) { flaming -= dt; const mz = muzzle(); vfx.flame(mz.x, mz.y, mz.x + 300, LANES[lane] - 40, dt); }
  if (auto) { autoT -= dt; if (autoT <= 0) { autoT = 1 / (WEAPONS[wpn]?.rof ?? 10); fire(); } }
  vfx.update(dt);
}
let autoT = 0;

function draw() {
  const f0 = performance.now();
  if (!bg && img('bg_mid')) {
    bg = bakeLayer('bg_mid', 1600, 740, 'brightness(0.94) saturate(0.55) contrast(0.8) blur(1.2px)', '#4b5568', 0.4, false);
    band = bakeGround(W, H - GROUND_TOP, GROUND_TOP, LANES, { rut: 0.06, base: ['rgba(22,23,26,0.15)', 'rgba(22,23,26,0.42)', 'rgba(16,17,20,0.62)'] });
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#20232a'; c.fillRect(0, 0, W, H);
  if (bg) c.drawImage(bg, -160, -20);
  if (band) c.drawImage(band, 0, GROUND_TOP);
  c.drawImage(ground, 0, 0);
  buildDark();
  c.drawImage(dark, 0, 0, W, H);
  // light pools on the road under the floodlights
  // actors
  const bar = img('barricade');
  if (bar) c.drawImage(bar, WALL_X - 120, 548, 150, (150 / bar.width) * bar.height);
  vfx.drawWall(c);
  const sv = img('surv_rifle');
  if (sv) { const h = SHOOTER.h, w = (sv.width / sv.height) * h; c.drawImage(sv, SHOOTER.x - w / 2, SHOOTER.y - h, w, h); }
  for (const d of [...dummies].sort((a, b) => a.lane - b.lane)) {
    const im = img(d.sprite);
    if (!im) continue;
    const b = bodyBox(d);
    const w = (im.width / im.height) * b.h;
    c.save(); c.translate(d.x, 0); c.scale(-1, 1);
    c.drawImage(im, -w / 2, b.y - b.h, w, b.h);
    c.restore();
  }
  for (const l of lobs) {
    const k = l.t / l.dur;
    const x = l.x0 + (l.x1 - l.x0) * k;
    const y = l.y0 + (l.y1 - 20 - l.y0) * k - Math.sin(k * Math.PI) * (120 + Math.abs(l.x1 - l.x0) * 0.2);
    vfx.drawLob(c, x, y, k, l.pipe);
  }
  vfx.drawNormal(c);
  if (snow) { c.fillStyle = 'rgba(230,235,240,0.7)'; for (let i = 0; i < 120; i++) c.fillRect((i * 97.3 + t * (20 + (i % 5) * 6)) % W, (i * 53.7 + t * (40 + (i % 7) * 9)) % H, 2, 2); }
  c.globalAlpha = 0.4; c.drawImage(dark, 0, 0, W, H); c.globalAlpha = 1;
  vfx.drawAdd(c);
  // the battle's own light glows and vignette
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const a = (l.life / l.max) * 0.25;
    const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.6);
    g.addColorStop(0, `rgba(${l.color},${a})`); g.addColorStop(1, `rgba(${l.color},0)`);
    c.fillStyle = g; c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  c.restore();
  c.save(); c.translate(W / 2, H * 0.42); c.scale(1.7, 1);
  const v = c.createRadialGradient(0, 0, H * 0.32, 0, 0, H * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.38)');
  c.fillStyle = v; c.fillRect(-W, -H, W * 2, H * 2); c.restore();
  frameMs = performance.now() - f0;
  frames++; frameSum += frameMs; frameMax = Math.max(frameMax, frameMs);
  const vc = vfx.cost.update + vfx.cost.draw;
  vfxSum += vc; vfxMax = Math.max(vfxMax, vc); nMax = Math.max(nMax, vfx.P.n);
  (document.getElementById('status') as HTMLElement).textContent =
    `particles ${vfx.P.n}/${vfx.P.limit}  vfx update ${vfx.cost.update.toFixed(2)} ms  vfx draw ${vfx.cost.draw.toFixed(2)} ms  frame ${frameMs.toFixed(2)} ms  sprites built in ${vfx.S.ms.toFixed(0)} ms`;
}

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) step(dt);
  draw();
  requestAnimationFrame(loop);
}

// ---------- UI ----------
const GUNS = ['service9', 'm1911', 'revolver', 'mp93', 'r22', 'smg', 'ar15', 'carbine', 'lmg', 'hunting', 'lever', 'scoped', 'muzzle', 'pump', 'autoshot', 'coach', 'snake410', 'pipe', 'compound', 'crossbow', 'flaregun', 'nailer', 'rivet', 'law', 'm79', 'pipemortar'];
function ui() {
  const el = document.getElementById('ui')!;
  const bar = (label: string, html: string) => `<div class="bar"><b>${label}</b>${html}</div>`;
  el.innerHTML =
    bar('guns', GUNS.map((g) => `<button data-g="${g}">${WEAPONS[g]?.name ?? g}</button>`).join('')) +
    bar('ammo', '<button data-a="slug">pump: slug</button><button data-a="dragon">pump: dragon\'s breath</button><button data-a="firebolt">crossbow: fire bolt</button><button data-a="supp">service9 suppressed</button>') +
    bar('effects', Object.keys(EFFECTS).map((k) => `<button data-e="${k}">${k}</button>`).join('')) +
    bar('scene', '<button data-s="lit">floodlit</button><button data-s="snow">snow</button><button data-s="gore">reduce gore</button><button data-s="auto">hold trigger</button><button data-s="lane">lane</button><button data-s="clear">clear decals</button><button data-s="heavy">perf: heavy scene</button>') +
    bar('quality', ['high', 'medium', 'low'].map((q) => `<button data-q="${q}">${q}</button>`).join(''));
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.g) { wpn = b.dataset.g; fire(); }
    if (b.dataset.a === 'slug') fire('pump', { ammo: 'shell_slug' });
    if (b.dataset.a === 'dragon') fire('pump', { ammo: 'shell_fire' });
    if (b.dataset.a === 'firebolt') fire('crossbow', { ammo: 'bolt_fire' });
    if (b.dataset.a === 'supp') fire('service9', { suppressed: true });
    if (b.dataset.e) EFFECTS[b.dataset.e]();
    if (b.dataset.q) vfx.setQuality(b.dataset.q as Quality);
    const s = b.dataset.s;
    if (s === 'lit') lit = !lit;
    if (s === 'snow') snow = !snow;
    if (s === 'gore') gore = !gore;
    if (s === 'auto') auto = !auto;
    if (s === 'lane') lane = (lane + 1) % 4;
    if (s === 'clear') { gctx.clearRect(0, 0, W, H); vfx.clear(); }
    if (s === 'heavy') heavy();
    b.blur();
  });
}

/** The perf scene: an LMG on the trigger, a shotgun every half second, a blast every 1.5 s, a fire burning. */
let heavyId = 0;
function heavy() {
  clearInterval(heavyId);
  wpn = 'lmg'; auto = true;
  fires.push({ x: 900, y: LANES[1], w: 150, life: 30 });
  let n = 0;
  const id = heavyId = window.setInterval(() => {
    n++;
    const l0 = lane; lane = (n % 4); fire('pump'); lane = l0;
    if (n % 3 === 0) vfx.explosion(650 + (n % 5) * 90, LANES[n % 4], 150);
    if (n > 60) clearInterval(id);
  }, 500);
}

(globalThis as unknown as { __fx: object }).__fx = {
  vfx, fire: (id: string, o?: { ammo?: string; suppressed?: boolean }) => fire(id, o), effect: (k: string) => EFFECTS[k](),
  pause: (p = true) => { paused = p; }, step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt); draw(); },
  set: (o: { lit?: boolean; snow?: boolean; gore?: boolean; lane?: number; auto?: boolean; wpn?: string }) => { if (o.lit !== undefined) lit = o.lit; if (o.snow !== undefined) snow = o.snow; if (o.gore !== undefined) gore = o.gore; if (o.lane !== undefined) lane = o.lane; if (o.auto !== undefined) auto = o.auto; if (o.wpn) wpn = o.wpn; },
  quality: (q: Quality) => vfx.setQuality(q), clear: () => { clearInterval(heavyId); gctx.clearRect(0, 0, W, H); vfx.clear(); fires = []; lights = []; lobs = []; for (const d of dummies) d.burn = 0; flaming = 0; auto = false; },
  heavy, stats: () => ({ n: vfx.P.n, nMax, frames, frameAvg: frameSum / Math.max(1, frames), frameMax, vfxAvg: vfxSum / Math.max(1, frames), vfxMax }), resetStats: () => { frames = 0; frameSum = 0; frameMax = 0; vfxSum = 0; vfxMax = 0; nMax = 0; },
  ready: false, laneScale,
};
void loadAssets().then(() => {
  ui();
  requestAnimationFrame(loop);
  (globalThis as unknown as { __fx: { ready: boolean } }).__fx.ready = true;
});
