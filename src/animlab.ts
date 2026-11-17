// Anim lab: dev page for the cutout bone rig (animlab.html).
import { createRig, gradedAtlas, loadAllGuns, loadRig, measureArms, SPRITE_RIGS, type Rig } from './anim';
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
// survivor art: every surv_* sprite with a part atlas (tools/rigs/surv_*.json); ?surv=<id> picks one
const SURVIVORS = ['surv_rifle', 'surv_pistol', 'surv_shotgun', 'surv_smg', 'surv_idle', 'surv_f_old', 'surv_f_mid', 'surv_m_mid',
  'surv_m_young', 'surv_f_native', 'surv_m_old', 'surv_m_big', 'surv_f_young'];
let survSprite = SURVIVORS.includes(params.get('surv') ?? '') ? params.get('surv')! : 'surv_rifle';
function setSurvivor(id: string) {
  survSprite = id;
  void loadImg(id);
  surv.rig = createRig('survivor', id, { onEvent: (n) => log(`survivor: ${n}`) });
  surv.rig.setWeapon(weapon);
}

function scaleOf(a: Actor) { return a.h / (a.rig.asset?.meta.height ?? 240); }

function setup() {
  surv = { rig: createRig('survivor', survSprite, { onEvent: (n) => log(`survivor: ${n}`) }), x: 220, y: GROUND, h: 270, facing: 1, vx: 0 };
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
  const who = document.createElement('select');
  for (const id of SURVIVORS) { const o = document.createElement('option'); o.value = id; o.textContent = id.replace('surv_', ''); who.appendChild(o); }
  who.value = survSprite;
  who.onchange = () => setSurvivor(who.value);
  s1.appendChild(who);
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

// ---------------------------------------------------------------- gallery (?gallery)
// Every rigged body sprite (SPRITE_RIGS) in rows, walking in place on its own style.
// `__gal` drives it from a test script: play a clip on all, kill all, toggle walking.
const gal: Actor[] = [];
let galWalk = true;
const galIds = Object.keys(SPRITE_RIGS);
const GAL_ROWS = galIds.length > 20 ? [205, 415, 625] : [295, 610];
function gallerySetup() {
  actors.length = 0; gal.length = 0;
  const ids = galIds;
  const per = Math.ceil(ids.length / GAL_ROWS.length);
  const dx = Math.min(128, (W - 110) / per), hh = GAL_ROWS.length > 2 ? 140 : 190;
  ids.forEach((id, i) => {
    const sr = SPRITE_RIGS[id];
    const row = Math.floor(i / per), col = i % per;
    const rig = createRig(sr.kind, id, { style: sr.style, seed: 31 + i * 101 });
    if (sr.weapon) { rig.setWeapon(sr.weapon); rig.aimAt(0, 0); }
    const big = sr.style === 'ferryman' ? 1.2 : sr.style === 'bellwether' ? 1.45 : 1;
    const a: Actor = { rig, x: 70 + col * dx + (row % 2 ? 40 : 0), y: GAL_ROWS[row], h: hh * big, facing: -1, vx: 0, label: id.replace(/^(z|surv)_/, '') };
    rig.autoIdle = false;
    rig.onEvent = (n, r) => log(`${r.spriteId}: ${n}`);
    actors.push(a); gal.push(a);
  });
}
function galleryFrame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  galleryStep(dt);
  galleryRender();
  if (params.has('still')) galleryRender(); else requestAnimationFrame(galleryFrame); // ?still: driven by __gal.step only
}
function galleryStep(dt: number) {
  for (const a of gal) {
    const sr = SPRITE_RIGS[a.rig.spriteId];
    if (sr.weapon && !a.rig.dead) a.rig.aimAt(a.x - 300, a.y - a.h * 0.6);
    // walk in place: the ground scrolls under it at the gait's natural pace
    a.rig.setSpeed(galWalk && !a.rig.dead ? (a.rig.crawling ? 14 : sr.style === 'deer' ? 70 : sr.kind === 'survivor' ? 45 : 26) * (a.h / 190) : 0);
    a.rig.update(dt);
  }
}
function galleryRender() {
  ctx.fillStyle = '#8fa0a6'; ctx.fillRect(0, 0, W, H);
  for (const gy of GAL_ROWS) { ctx.fillStyle = '#4a4436'; ctx.fillRect(0, gy, W, 14); }
  for (const a of gal) {
    const s = a.h / (a.rig.asset?.meta.height ?? 240);
    a.rig.draw(ctx, a.x, a.y, s, a.facing, images.get(a.rig.spriteId));
    if (DEBUG) a.rig.drawSkeleton(ctx);
    ctx.fillStyle = 'rgba(240,235,220,0.9)'; ctx.font = '11px system-ui'; ctx.fillText(a.label ?? '', a.x - 24, a.y + 12);
  }
}
const galApi = {
  actors: gal,
  play: (clip: string, which?: string[]) => gal.forEach((a) => { if (!which || which.includes(a.rig.spriteId)) { a.rig.stop(); a.rig.play(clip); } }),
  attack: () => gal.forEach((a) => { a.rig.stop(); const st = a.rig.style; a.rig.play(SPRITE_RIGS[a.rig.spriteId].weapon ? 'pump' : st.attacks[0]); }),
  fire: () => gal.forEach((a) => { if (SPRITE_RIGS[a.rig.spriteId].weapon) a.rig.fire(1.5); }),
  kill: (kind: K = 'shotgun') => gal.forEach((a) => { if (!a.rig.dead) a.rig.die({ worldImpulse: { x: kind === 'explosion' ? 300 : 200, y: kind === 'explosion' ? -380 : -120 }, at: 'torso', kind, authored: false }); }),
  walk: (v: boolean) => { galWalk = v; },
  reset: () => gallerySetup(),
  debug: (v: boolean) => { DEBUG = v; },
  step: (n: number) => { for (let i = 0; i < n; i++) galleryStep(1 / 60); galleryRender(); },
};

// ---------------------------------------------------------------- close-up (?closeup)
// Every survivor rig (and the raiders) holding a gun, at the night's display size, graded and
// inked like the wall's near row: for checking hands, held guns and stances.
//   ?w=<gun>         every sprite holds this gun (w=none: bare hands); w=a,b,c: one column per gun
//   ?only=<id,...>   just these sprites          ?h=<px> body height (default 158)   ?lane=2 far row
//   ?act=<what>      aim (default) | low (low ready) | walk (walking at low ready) | fire (a shot,
//                    caught at the recoil peak) | reload (the gun's reload, empty) | tactical
//   ?at=<0..1>       how far into the reload / walk cycle the still is taken    ?debug: skeleton
//   ?aim=<rad>       aim angle below the horizon (default: a head-height target)  ?cols=<n>
const CU: Actor[] = [];
const cuStill = { act: params.get('act') ?? 'aim', at: +(params.get('at') ?? 0.45) };
function closeupSetup() {
  const only = params.get('only')?.split(',');
  const ids = Object.keys(SPRITE_RIGS).filter((id) => SPRITE_RIGS[id].kind === 'survivor' && (!only || only.includes(id)));
  const guns = (params.get('w') ?? '').split(',').filter(Boolean);
  const cells: [string, string | null][] = [];
  for (const id of ids) {
    if (guns.length > 1) for (const g of guns) cells.push([id, g === 'none' ? null : g]);
    else cells.push([id, guns[0] === 'none' ? null : guns[0] ?? SPRITE_RIGS[id].weapon ?? 'ar15']);
  }
  const h = +(params.get('h') ?? 158), cols = +(params.get('cols') ?? (guns.length > 1 ? guns.length : Math.min(5, cells.length)));
  const dx = Math.max(220, h * 1.25), dy = Math.max(210, h * 1.25);
  cv.width = Math.round(40 + cols * dx); cv.height = Math.round(h + 40 + Math.ceil(cells.length / cols - 1) * dy);
  cells.forEach(([id, gun], i) => {
    const rig = createRig('survivor', id, { seed: 7 + i * 13 });
    rig.setWeapon(gun);
    const a: Actor = { rig, x: 40 + h * 0.35 + (i % cols) * dx, y: h + 20 + Math.floor(i / cols) * dy, h, facing: 1, vx: 0, label: `${id.replace(/^(z|surv)_/, '')} · ${rig.weaponId ?? 'hands'}` };
    CU.push(a);
  });
}
function closeupAim(a: Actor) {
  const ang = params.has('aim') ? +params.get('aim')! : null;
  if (cuStill.act === 'low') { a.rig.clearAim(); return; }
  if (ang === null) a.rig.aimAt(a.x + 600, a.y - a.h * 0.75);
  else a.rig.aimAt(a.x + 600, a.y - a.h * 0.72 + Math.tan(ang) * 600);
}
/** Pose every close-up actor for the still: settle, then run the action to `at`. */
function closeupPose() {
  for (const a of CU) {
    closeupAim(a);
    for (let i = 0; i < 40; i++) { a.rig.update(1 / 60); a.rig.draw(ctx, a.x, a.y, a.h / 240, 1); }
    const def = a.rig.weaponId ? WEAPONS[a.rig.weaponId] : null;
    const act = cuStill.act;
    let secs = 0;
    if (act === 'walk') { a.rig.setSpeed(70 * a.h / 240); secs = 1.2 + cuStill.at; }
    else if (act === 'fire') { a.rig.fire(Math.min(2.5, 0.5 + (def?.knock ?? 6) / 14)); secs = 0.05; }
    else if ((act === 'reload' || act === 'tactical') && def) {
      const rounds = def.reloadPerRound ? 2 : undefined;
      const dur = def.reloadPerRound ? 0.6 : def.reload;
      a.rig.reload(dur, { empty: act === 'reload', rounds });
      secs = dur * (rounds ?? 1) * cuStill.at;
    }
    for (let t = 0; t < secs; t += 1 / 60) { a.rig.update(1 / 60); a.rig.draw(ctx, a.x, a.y, a.h / 240, 1); }
  }
}
function closeupRender(step = false) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#39404a'; ctx.fillRect(0, 0, cv.width, cv.height);
  const far = params.get('lane') === '2';
  const look = far ? { b: 0.9, s: 0.88, fog: 0.06, outline: 1.5 } : { b: 1, s: 1, fog: 0, outline: 2 };
  for (const a of CU) {
    ctx.fillStyle = '#2a2620'; ctx.fillRect(a.x - 60, a.y, 170, 8);
    const s = a.h / 240;
    const as = a.rig.asset;
    if (as) {
      const key = `cu|${far ? 2 : 3}`;
      const filter = `brightness(${look.b}) saturate(${look.s})`;
      const tints: [string, number][] = [['#1b2333', look.fog]];
      const grow = Math.min(6, Math.max(1, Math.round(look.outline / Math.max(0.2, s))));
      a.rig.skin = { atlas: gradedAtlas(as, key, filter, tints, false, grow), dark: gradedAtlas(as, key, filter, tints, true, grow), grow };
      (a.rig as unknown as { gunLook: unknown }).gunLook = { key, filter, tints, ink: look.outline };
    }
    if (step) { closeupAim(a); a.rig.update(1 / 60); }
    a.rig.draw(ctx, a.x, a.y, s, a.facing);
    if (DEBUG) a.rig.drawSkeleton(ctx);
    ctx.fillStyle = 'rgba(240,235,220,0.9)'; ctx.font = '11px system-ui'; ctx.fillText(a.label ?? '', a.x - 50, a.y + 22);
    if (DEBUG) {
      // bone lengths and elbow angles against the real-arm targets (anim/armcheck.ts)
      const m = measureArms(a.rig);
      if (m) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = m.problems.length ? '#ff9a7a' : '#9fe0a0';
        ctx.fillText(`ua ${m.ua.toFixed(3)} fa ${m.fa.toFixed(3)} H · ${m.stance}`, a.x - 50, a.y + 35);
        ctx.fillText(`T ${m.trigger.elbow.toFixed(0)}° ${m.trigger.reach.toFixed(2)} S ${m.support.elbow.toFixed(0)}° ${m.support.reach.toFixed(2)}`, a.x - 50, a.y + 47);
        m.problems.slice(0, 2).forEach((p, k) => ctx.fillText(p, a.x - 50, a.y + 59 + k * 12));
      }
    }
  }
}

// ---------------------------------------------------------------- boot
if (params.has('closeup')) (async () => {
  const ids = Object.keys(SPRITE_RIGS);
  await Promise.all([...ids.map(loadRig), loadAllGuns()]);
  closeupSetup();
  closeupPose();
  closeupRender();
  (window as unknown as { __cu: unknown }).__cu = { render: closeupRender, actors: CU, measure: () => CU.map((a) => ({ label: a.label, m: measureArms(a.rig) })) };
  const tick = () => { closeupRender(true); requestAnimationFrame(tick); };
  if (!params.has('still')) requestAnimationFrame(tick);
})();
else if (params.has('gallery')) (async () => {
  const ids = Object.keys(SPRITE_RIGS);
  await Promise.all([...ids.map(loadImg), ...ids.map(loadRig), loadAllGuns()]);
  gallerySetup();
  (window as unknown as { __gal: unknown }).__gal = galApi;
  if (params.has('still')) galleryRender(); else requestAnimationFrame(galleryFrame); // ?still: driven by __gal.step only
})();
else (async () => {
  await Promise.all([loadImg('bg_mid'), loadImg('surv_rifle'), loadImg(survSprite), loadRig(survSprite), loadImg('z_shambler'), loadImg('z_runner'), loadImg('z_brute'),
    loadRig('surv_rifle'), loadRig('z_shambler'), loadRig('z_runner'), loadRig('z_brute'), loadAllGuns()]);
  setup();
  ui();
  (window as unknown as { __lab: unknown }).__lab = { surv: () => surv, sleepers, deer: () => deer, ferry: () => ferry, fire, reload, kill, setWeapon: (id: string) => { weapon = id; surv.rig.setWeapon(id); }, setSurvivor, setWalking: (v: boolean) => { walking = v; }, aim: (x: number, y: number) => { mouseX = x; mouseY = y; }, step, render, reset, debug: (v: boolean) => { DEBUG = v; } };
  if (BENCH) bench();
  else requestAnimationFrame(frame);
})();
