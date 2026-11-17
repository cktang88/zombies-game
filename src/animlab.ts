// Anim lab: dev page for the cutout bone rig (animlab.html).
import { createRig, loadAllGuns, loadRig, type Rig } from './anim';
import { WEAPONS } from './data/weapons';
import { spriteUrl } from './assets';

const cv = document.getElementById('cv') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const W = cv.width, H = cv.height, GROUND = 560;
const params = new URLSearchParams(location.search);
const BENCH = params.get('bench');
let DEBUG = params.has('debug');
const RAGDOLL_CAP = 24;

const images = new Map<string, HTMLImageElement>();
function loadImg(id: string) {
  return new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { images.set(id, im); res(); };
    im.onerror = () => res();
    im.src = spriteUrl(id);
  });
}

// ground decals (baked corpses)
const decal = document.createElement('canvas');
decal.width = W; decal.height = H;
const dctx = decal.getContext('2d')!;

const logLines: string[] = [];
const log = (s: string) => {
  logLines.unshift(`${(performance.now() / 1000).toFixed(2)}  ${s}`);
  logLines.length = Math.min(logLines.length, 6);
  (document.getElementById('log') as HTMLElement).textContent = logLines.join('\n');
};

interface Actor { rig: Rig; x: number; y: number; h: number; facing: 1 | -1; vx: number; label?: string; minX?: number; maxX?: number; respawn?: () => void }
const actors: Actor[] = [];
let mouseX = 900, mouseY = 380;
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  mouseX = ((e.clientX - r.left) / r.width) * W;
  mouseY = ((e.clientY - r.top) / r.height) * H;
});

let surv: Actor;
let deer: Actor, ferry: Actor;
const sleepers: Actor[] = [];
let walking = false;
let weapon = 'ar15';

function scaleOf(a: Actor) { return a.h / (a.rig.asset?.meta.height ?? 240); }

function setup() {
  surv = { rig: createRig('survivor', 'surv_rifle', { onEvent: (n) => log(`survivor: ${n}`) }), x: 220, y: GROUND, h: 270, facing: 1, vx: 0 };
  surv.rig.setWeapon(weapon);
  actors.push(surv);
  const walks = ['limpDrag', 'stiffLurch', 'headLoll', 'dangle'];
  walks.forEach((g, i) => {
    const a: Actor = { rig: createRig('turned', 'z_shambler', { style: 'sleeper', gait: g, seed: 11 + i * 97 }), x: 520 + i * 125, y: GROUND, h: 180, facing: -1, vx: -16 - i * 2, label: g, minX: 460, maxX: 1000 };
    a.rig.autoIdle = false;
    sleepers.push(a);
    actors.push(a);
  });
  deer = { rig: createRig('turned', 'z_runner', { style: 'deer', gait: 'sprint', seed: 5 }), x: 1060, y: GROUND, h: 180, facing: -1, vx: 0, label: 'Deer' };
  ferry = { rig: createRig('turned', 'z_brute', { style: 'ferryman', gait: 'stomp', seed: 9 }), x: 1190, y: GROUND, h: 235, facing: -1, vx: 0, label: 'Ferryman' };
  actors.push(deer, ferry);
  for (const a of [deer, ferry, ...sleepers]) a.rig.onEvent = (n, r) => log(`${r.style.id}: ${n}`);
  deer.rig.play('pantStop');
}

// ---------------------------------------------------------------- UI
function ui() {
  const root = document.getElementById('ui')!;
  const bar = (title: string) => { const d = document.createElement('div'); d.className = 'bar'; d.innerHTML = `<b>${title}</b>`; root.appendChild(d); return d; };
  const btn = (d: HTMLElement, label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; d.appendChild(b); return b; };
  const s1 = bar('Survivor');
  const sel = document.createElement('select');
  const ids = ['service9', 'm1911', 'revolver', 'mp93', 'smg', 'ar15', 'carbine', 'lmg', 'hunting', 'scoped', 'lever', 'r22', 'pump', 'autoshot', 'coach', 'snake410', 'pipe', 'compound', 'crossbow', 'law', 'm79', 'pipemortar', 'flaregun', 'muzzle', 'nailer', 'rivet', 'hatchet'];
  for (const id of ids) { const o = document.createElement('option'); o.value = id; o.textContent = WEAPONS[id]?.name ?? id; sel.appendChild(o); }
  sel.value = weapon;
  sel.onchange = () => { weapon = sel.value; surv.rig.setWeapon(weapon); };
  s1.appendChild(sel);
  btn(s1, 'Fire', () => fire());
  btn(s1, 'Reload (empty)', () => reload(true));
  btn(s1, 'Reload (tactical)', () => reload(false));
  btn(s1, 'Walk', () => { walking = !walking; });
  btn(s1, 'Rummage', () => surv.rig.isPlaying('rummage') ? surv.rig.stop('rummage') : surv.rig.play('rummage'));
  btn(s1, 'Chop', () => { surv.rig.setWeapon('hatchet'); sel.value = 'hatchet'; weapon = 'hatchet'; surv.rig.play('chop'); });
  btn(s1, 'Sweep', () => { surv.rig.setWeapon('hatchet'); sel.value = 'hatchet'; weapon = 'hatchet'; surv.rig.play('sweep'); });
  const s2 = bar('Hit / die');
  for (const z of ['head', 'torso', 'arm', 'leg'] as const) btn(s2, `hit ${z}`, () => surv.rig.hit(z));
  btn(s2, 'die: headshot', () => kill(surv, 'headshot'));
  btn(s2, 'die: shotgun', () => kill(surv, 'shotgun'));
  btn(s2, 'die: explosion', () => kill(surv, 'explosion'));
  btn(s2, 'die: melee', () => kill(surv, 'melee'));
  btn(s2, 'reset', () => reset());
  const s3 = bar('Turned');
  btn(s3, 'claw', () => sleepers[0].rig.play('claw'));
  btn(s3, 'grab-bite', () => sleepers[1].rig.play('grabBite'));
  btn(s3, 'pound (wall)', () => sleepers[2].rig.isPlaying('pound') ? sleepers[2].rig.stop('pound') : sleepers[2].rig.play('pound'));
  btn(s3, 'climb', () => sleepers[3].rig.play('climb'));
  btn(s3, 'stagger', () => sleepers[0].rig.play('stagger'));
  btn(s3, 'knockdown', () => sleepers[1].rig.play('knockdown'));
  btn(s3, 'leg shot → crawl', () => sleepers[2].rig.hit('leg', { cripple: true }));
  btn(s3, 'head snap', () => sleepers[3].rig.hit('head'));
  btn(s3, 'arm spin', () => sleepers[0].rig.hit('arm'));
  btn(s3, 'idle sniff', () => sleepers[1].rig.play('idleSniff'));
  btn(s3, 'turn to noise', () => sleepers[3].rig.play('idleTurn'));
  const s4 = bar('Specials');
  btn(s4, 'Ferryman smash', () => ferry.rig.play('smash'));
  btn(s4, 'Ferryman grab-drag', () => ferry.rig.play('grabDrag'));
  btn(s4, 'Deer pant-stop', () => deer.rig.isPlaying('pantStop') ? deer.rig.stop('pantStop') : deer.rig.play('pantStop'));
  btn(s4, 'Deer lunge', () => deer.rig.play('lunge'));
  btn(s4, 'kill sleepers (mixed)', () => sleepers.forEach((s, i) => kill(s, (['headshot', 'shotgun', 'explosion', 'melee'] as const)[i % 4])));
  btn(s4, 'kill Deer', () => kill(deer, 'shotgun'));
  btn(s4, 'kill Ferryman', () => kill(ferry, 'explosion'));
}

function fire() {
  const r = surv.rig;
  const def = WEAPONS[weapon];
  if (!def || r.isPlaying()) return;
  r.fire(Math.min(2.5, 0.5 + (def.knock ?? 6) / 14));
  log(`fire ${weapon}`);
  if (weapon === 'hunting' || weapon === 'scoped') setTimeout(() => r.play('boltCycle', { duration: Math.min(1, 1 / (def.rof || 1) * 0.8) }), 120);
  if (weapon === 'pump') setTimeout(() => r.play('pump'), 110);
  if (weapon === 'lever') setTimeout(() => r.play('leverCycle'), 110);
}
function reload(empty: boolean) {
  const def = WEAPONS[weapon];
  if (!def) return;
  if (weapon === 'hatchet') return;
  const rounds = def.reloadPerRound ? Math.min(4, def.mag) : undefined;
  surv.rig.reload(def.reload, { empty, rounds, onEnd: () => log('reload done') });
  log(`reload ${weapon} ${def.reload}s${rounds ? ` ×${rounds}` : ''}`);
}

type K = 'headshot' | 'shotgun' | 'explosion' | 'melee';
function kill(a: Actor, kind: K) {
  const r = a.rig;
  if (r.dead) return;
  // impulses in display px/s, world axes; the shooter stands to the left
  const dir = a === surv ? -1 : 1;
  const imp = { headshot: { x: 140 * dir, y: -50 }, shotgun: { x: 260 * dir, y: -150 }, explosion: { x: 300 * dir, y: -420 }, melee: { x: 20 * dir, y: 60 } }[kind];
  const at = kind === 'headshot' ? 'head' : kind === 'melee' ? 'head' : 'torso';
  r.die({ worldImpulse: imp, at, kind: kind === 'headshot' ? 'headshot' : kind, authored: a === ferry ? true : undefined });
  a.vx = 0;
  log(`${r.style.id} dies: ${kind}`);
}
function reset() {
  dctx.clearRect(0, 0, W, H);
  actors.length = 0; sleepers.length = 0;
  setup();
}

// ---------------------------------------------------------------- loop
let last = performance.now();
const bg = () => images.get('bg_mid');
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  render();
  requestAnimationFrame(frame);
}
function step(dt: number) {
  surv.vx = walking ? 46 : 0;
  surv.x += surv.vx * dt;
  if (surv.x > 380) surv.x = 120;
  surv.rig.setSpeed(Math.abs(surv.vx));
  if (!surv.rig.dead) surv.rig.aimAt(mouseX, mouseY);
  for (const a of actors) {
    if (a !== surv && !a.rig.dead) {
      const busy = a.rig.isPlaying();
      const vx = busy ? 0 : a.vx;
      a.x += vx * dt;
      if (a.minX !== undefined && a.x < a.minX) a.x = a.maxX!;
      a.rig.setSpeed(Math.abs(vx));
    }
    a.rig.update(dt);
    if (a.rig.settled) {
      a.rig.bakeCorpse(dctx, a.x, a.y, scaleOf(a), a.facing);
      a.respawn?.();
    }
  }
  // capped active ragdolls: bake the oldest first when over budget
  const live = actors.filter((a) => a.rig.ragdoll);
  if (live.length > RAGDOLL_CAP) {
    live.sort((p, q) => (q.rig.ragdoll!.t - p.rig.ragdoll!.t));
    for (const a of live.slice(0, live.length - RAGDOLL_CAP)) { a.rig.bakeCorpse(dctx, a.x, a.y, scaleOf(a), a.facing); a.respawn?.(); }
  }
}
function render() {
  // daylight backdrop
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#8fa6b4'); g.addColorStop(1, '#c9c2a8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const b = bg();
  if (b) { ctx.globalAlpha = 0.8; ctx.drawImage(b, 0, GROUND - 420, W, 440); ctx.globalAlpha = 1; }
  ctx.fillStyle = '#4a4436'; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = '#5b5443'; ctx.fillRect(0, GROUND, W, 6);
  ctx.drawImage(decal, 0, 0);
  for (const a of actors) {
    const s = scaleOf(a);
    // contact shadow
    if (!a.rig.dead) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(a.x, a.y + 2, 34 * s * 1.6, 6 * s * 1.6, 0, 0, Math.PI * 2); ctx.fill(); }
    a.rig.draw(ctx, a.x, a.y, s, a.facing, images.get(a.rig.spriteId));
    if (DEBUG) a.rig.drawSkeleton(ctx);
    if (a.label && !BENCH) { ctx.fillStyle = 'rgba(20,18,16,0.8)'; ctx.font = '11px system-ui'; ctx.fillText(a.label, a.x - 24, GROUND + 22); }
  }
  // crosshair
  if (!BENCH) {
    ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mouseX, mouseY, 7, 0, Math.PI * 2); ctx.moveTo(mouseX - 11, mouseY); ctx.lineTo(mouseX + 11, mouseY); ctx.moveTo(mouseX, mouseY - 11); ctx.lineTo(mouseX, mouseY + 11); ctx.stroke();
  }
}

// ---------------------------------------------------------------- bench
const FLAT = params.has('flat');
/** Baseline: the old single-image draw (same actors, same sizes) for comparison. */
function renderFlat() {
  ctx.fillStyle = '#6f8a9a'; ctx.fillRect(0, 0, W, H);
  const b = bg(); if (b) ctx.drawImage(b, 0, GROUND - 420, W, 440);
  for (const a of actors) {
    const im = images.get(a.rig.spriteId); if (!im) continue;
    const h = a.h, w = (im.width / im.height) * h, bob = Math.abs(Math.sin(performance.now() / 300 + a.x)) * 2;
    ctx.setTransform(a.facing * (a.rig.kind === 'turned' ? -1 : 1), 0, 0, 1, a.x, a.y - bob);
    ctx.drawImage(im, -w / 2, -h, w, h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
async function bench() {
  actors.length = 0; sleepers.length = 0;
  const kinds = [['z_shambler', 'sleeper'], ['z_runner', 'deer'], ['z_shambler', 'sleeper'], ['z_brute', 'ferryman']] as const;
  const survs: Actor[] = [];
  for (let i = 0; i < 150; i++) {
    const [sp, st] = kinds[i % kinds.length];
    const a: Actor = { rig: createRig('turned', sp, { style: st, seed: 1000 + i }), x: 420 + ((i * 53) % 840), y: GROUND - (i % 6) * 14, h: 110 + (st === 'ferryman' ? 30 : 0), facing: -1, vx: -(18 + (i % 7) * 3), minX: 400, maxX: 1270 };
    a.rig.autoIdle = true;
    a.rig.lod = params.has('lod');
    actors.push(a);
  }
  for (let i = 0; i < 6; i++) {
    const a: Actor = { rig: createRig('survivor', 'surv_rifle', { seed: 77 + i }), x: 60 + i * 55, y: GROUND - (i % 3) * 14, h: 120, facing: 1, vx: 0 };
    a.rig.setWeapon(['ar15', 'pump', 'service9', 'smg', 'hunting', 'revolver'][i]);
    actors.push(a); survs.push(a);
  }
  surv = survs[0];
  const ragdolls = BENCH === 'ragdoll' ? 24 : 0;
  const respawnKill = (a: Actor) => () => {
    const idx = actors.indexOf(a);
    const n: Actor = { ...a, rig: createRig('turned', a.rig.spriteId, { style: a.rig.style.id, seed: Math.floor(Math.random() * 1e6) }) };
    n.rig.update(1 / 60); n.rig.draw(ctx, n.x, n.y, scaleOf(n), n.facing);
    n.rig.die({ worldImpulse: { x: 300, y: -200 }, kind: 'shotgun', authored: false });
    n.respawn = respawnKill(n);
    actors[idx] = n;
  };
  for (let i = 0; i < ragdolls; i++) {
    const a: Actor = { rig: createRig('turned', 'z_shambler', { style: 'sleeper', seed: 5000 + i }), x: 450 + i * 32, y: GROUND, h: 110, facing: -1, vx: 0 };
    actors.push(a);
    a.respawn = respawnKill(a);
  }
  await new Promise((r) => setTimeout(r, 300));
  for (const a of actors) { a.rig.update(1 / 60); a.rig.draw(ctx, a.x, a.y, scaleOf(a), a.facing); }
  for (const a of actors.slice(156)) a.rig.die({ worldImpulse: { x: 300, y: -200 }, kind: 'shotgun', authored: false });
  const times: number[] = [];
  const upd: number[] = [];
  let n = 0;
  const N = 600;
  let t0 = performance.now();
  const startWall = t0;
  await new Promise<void>((done) => {
    const tick = () => {
      const s = performance.now();
      const dt = 1 / 60;
      for (const sv of survs) { sv.rig.aimAt(900, 300 + Math.sin(s / 400) * 120); if (n % 20 === 0) sv.rig.fire(1); if (n % 240 === 60) sv.rig.reload(1.6, { empty: true, rounds: 2 }); }
      const u0 = performance.now();
      step(dt);
      const u1 = performance.now();
      if (FLAT) renderFlat(); else render();
      if (params.has('sync')) ctx.getImageData(0, 0, 1, 1); // force the raster to finish inside the timing
      const e = performance.now();
      times.push(e - s); upd.push(u1 - u0);
      if (++n < N) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  t0 = performance.now();
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const res = {
    actors: actors.length, ragdolls, frames: N,
    avgMs: +avg.toFixed(2), p95Ms: +sorted[Math.floor(N * 0.95)].toFixed(2), maxMs: +sorted[N - 1].toFixed(2),
    updateAvgMs: +(upd.reduce((a, b) => a + b, 0) / upd.length).toFixed(2),
    wallFps: +(N / ((t0 - startWall) / 1000)).toFixed(1),
  };
  (window as unknown as { __bench: unknown }).__bench = res;
  (document.getElementById('status') as HTMLElement).textContent = JSON.stringify(res);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
(async () => {
  await Promise.all([loadImg('bg_mid'), loadImg('surv_rifle'), loadImg('z_shambler'), loadImg('z_runner'), loadImg('z_brute'),
    loadRig('surv_rifle'), loadRig('z_shambler'), loadRig('z_runner'), loadRig('z_brute'), loadAllGuns()]);
  setup();
  ui();
  (window as unknown as { __lab: unknown }).__lab = { surv: () => surv, sleepers, deer: () => deer, ferry: () => ferry, fire, reload, kill, setWeapon: (id: string) => { weapon = id; surv.rig.setWeapon(id); }, setWalking: (v: boolean) => { walking = v; }, aim: (x: number, y: number) => { mouseX = x; mouseY = y; }, step, render, reset, debug: (v: boolean) => { DEBUG = v; } };
  if (BENCH) bench();
  else requestAnimationFrame(frame);
})();
