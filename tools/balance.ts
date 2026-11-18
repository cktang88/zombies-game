// Balance harness for the night fight. See docs/balance.md.
//   npx tsx tools/balance.ts [--quick] [--md out.md] [--only base|patch]
//   npx tsx tools/balance.ts --cell <gun> [patch] [--z <zombie>]   (debug one gun)
//
// Monte-Carlo model of src/night/battle.ts geometry (muzzle, hitbox(), castShot(), damage(),
// bloom) driven by the fireProfile() contract in src/data/weapons.ts, for every gun x ammo type x
// Turned x distance x shooter skill x firing style. Then: a power-fantasy / domination check and
// a days 1-23 ammunition economy using the real director (threatPoints / planNight).
//
// Everything is run twice: BASE (the data as it is in src/ with the current battle.ts model) and
// PATCH (the battle-model tuning proposed in docs/balance.md, applied in-memory by applyPatch()).
// The data half of the patch (weapons, ammo, Turned, recipes, sites, start stores, switchTime) is
// now in src/ itself, so BASE reads it directly; only the battle.ts model is still patched here.
// Nothing in src/ is modified on disk.
import { WEAPONS, WEAPON_ORDER, AMMO_TYPES, fireProfile, weaponClass, BURN, type FireProfile } from '../src/data/weapons';
import { ZOMBIES, type ZombieDef } from '../src/data/zombies';
import { RECIPES, SITES } from '../src/data/world';
import { newGame } from '../src/sim/newgame';
import { planNight } from '../src/sim/director';
import { G, setState } from '../src/state';
import type { Res, WeaponItem, WeaponDef } from '../src/types';
import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- battle constants (battle.ts)
const WALL_X = 372;
const LANE_TOP = 616, LANE_BOT = 690;
const SURV_Y = 664;
const ZS = 1.3;
const SH = 158;
const MUZZLE = { x: 262 + SH * 0.45, y: SURV_Y - SH * 0.68 }; // the player's slot (guards[0])
const DISTS = [150, 400, 700];
const SKILLS = [2, 5, 8];
const aimOf = (skill: number) => 0.45 + skill * 0.05; // aimFactor() with no traits/wounds
const SLEEPER_HP = () => ZOMBIES.sleeper.hp;
const MOUSE_SD = 8;
// seconds to swing onto a new target: a careful head placement takes longer than a body snap
const ACQUIRE: Record<string, number> = { tap: 0.3, spray: 0.15, guard: 0.2 };
// guns whose value is something this model cannot score (the flare gun lights the road for every gun)
const UTILITY = ['flaregun']; // px, standard deviation of a careful player's mouse placement on a head

// ---------------------------------------------------------------- the battle model (tunable)
interface Model {
  name: string;
  headMul: number; pelletHeadMul: number; falloff: number;
  bloomCap: number;
  bloomDecay: 'linear' | 'exp'; bloomRate: number; bloomHalfLife: number; bloomHold: number;
  bloomK: number; bloomSemi: number; bloomAuto: number; // add = spread*K + (auto ? auto : semi), × bloomMul
  kick: Partial<Record<string, number>> | null; // flat kick per weapon id, else per weaponClass, replacing the add above
  aimedMul: number; aimedDelay: number; aimedBloomMax: number; // aimed shot (doc 05 §3); aimedMul 1 = off
  pelletAim: boolean; // pellet cone scales with aim & bloom (doc 05 §3)
  staggerS: number; // seconds a staggered target loses (0 = not modelled in battle yet)
  pelletFall: [number, number, number] | null; // pellet damage falloff: full until a px, ×min from b px
  headR: number; // head circle radius as a fraction of the head band height (battle.ts hitbox: 0.62)
  salvage: number; // scrap picked off the road at dawn per kill (economy)
  sway: number; // px of crosshair sway at aim 0 (scaled by 1 - aim): survivor skill moves the player's hand
  hpMul: (day: number) => number;
}
// BASE = the battle model as implemented in src/night/battle.ts + src/night/gunplay.ts (balance.md §8 applied):
// per-class kick to a 0.30 cap, hold 0.12 s then 0.15 s half-life, aimed shot ×0.6, sway, pellet cone follows aim,
// buckshot falloff, head radius 0.56, 0.3 s stagger, hp growth 0.02/day, dawn salvage. (Not modelled here: limb
// zones and limbMul, weakspots, heat, Focus, recoil climb.)
const BASE_MODEL: Model = {
  name: 'base', headMul: 3, pelletHeadMul: 2, falloff: 0.7, bloomCap: 0.3,
  bloomDecay: 'exp', bloomRate: 0.12, bloomHalfLife: 0.15, bloomHold: 0.12,
  bloomK: 0.35, bloomSemi: 0.012, bloomAuto: 0.004,
  // gunplay.ts KICK_ID / KICK_CLS (by weapon id first, then WeaponClass)
  kick: { carbine: 0.085, handgun: 0.022, smg: 0.065, shotgun: 0.05, rifle: 0.03, assault: 0.03, marksman: 0.03, heavy: 0.045, bow: 0.02, improvised: 0.04, launcher: 0.05 },
  aimedMul: 0.6, aimedDelay: 0.35, aimedBloomMax: 0.01, pelletAim: true, staggerS: 0.3, pelletFall: [250, 650, 0.35], sway: 16, headR: 0.56, salvage: 0.12,
  hpMul: (day) => 1 + Math.max(0, day - 8) * 0.02,
};
let M: Model = BASE_MODEL;

// ---------------------------------------------------------------- RNG
let seed = 12345;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const range = (a: number, b: number) => a + rnd() * (b - a);
const gauss = (m: number, sd: number) => m + sd * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

// ---------------------------------------------------------------- zombies & hit tests
interface Z { def: ZombieDef; x: number; y: number; hp: number; maxHp: number; scale: number; headless: boolean; burn: number; atWall: boolean; stun: number }
function makeZ(def: ZombieDef, x: number, day = 8): Z {
  const y = range(LANE_TOP, LANE_BOT);
  const scale = 0.92 + ((y - LANE_TOP) / (LANE_BOT - LANE_TOP)) * 0.16;
  const hp = def.hp * M.hpMul(day);
  return { def, x, y, hp, maxHp: hp, scale, headless: false, burn: 0, atWall: false, stun: 0 };
}
function hitbox(z: Z) {
  const h = z.def.height * z.scale * ZS;
  const w = z.def.width * z.scale * ZS;
  const top = z.y - h;
  const headH = h * z.def.head;
  const crawl = z.def.id === 'drag';
  return {
    x1: z.x - w / 2, x2: z.x + w / 2, y1: top + (z.headless ? 0 : headH * 0.8), y2: z.y,
    hx: crawl ? z.x - w * 0.36 : z.x - w * 0.12, hy: crawl ? z.y - h * 0.62 : top + headH * 0.5, hr: z.headless ? 0 : (crawl ? h * 0.3 : headH * M.headR),
  };
}
interface ShotStats { hits: number; heads: number; knockPx: number; stagger: number; kills: Z[]; headKills: number; dmg: number }
const newStats = (): ShotStats => ({ hits: 0, heads: 0, knockPx: 0, stagger: 0, kills: [], headKills: 0, dmg: 0 });

/** castShot() + damage() from battle.ts, with fireProfile extras (armorPen, range, incendiary). */
function castShot(zs: Z[], ang: number, p: FireProfile, pellet: boolean, st: ShotStats) {
  const ox = MUZZLE.x, oy = MUZZLE.y;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const hits: { z: Z; t: number; head: boolean }[] = [];
  for (const z of zs) {
    if (z.hp <= 0) continue;
    const hb = hitbox(z);
    const hx = hb.hx - ox, hy = hb.hy - oy;
    const tc = hx * dx + hy * dy;
    const d2 = hx * hx + hy * hy - tc * tc;
    if (tc > 0 && d2 < hb.hr * hb.hr) { hits.push({ z, t: tc - Math.sqrt(hb.hr * hb.hr - d2), head: true }); continue; }
    const t1 = (hb.x1 - ox) / dx, t2 = (hb.x2 - ox) / dx;
    const t3 = (hb.y1 - oy) / dy, t4 = (hb.y2 - oy) / dy;
    const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
    if (tmax >= 0 && tmin <= tmax) hits.push({ z, t: Math.max(0, tmin), head: false });
  }
  hits.sort((a, b) => a.t - b.t);
  let d = p.dmg;
  let n = 0;
  for (const h of hits) {
    const z = h.z;
    let dd = d * (h.t > p.range ? 0.5 : 1);
    if (pellet && M.pelletFall) { const [a, b, mn] = M.pelletFall; dd *= Math.max(mn, Math.min(1, 1 - ((h.t - a) / (b - a)) * (1 - mn))); }
    if (h.head) dd *= pellet ? M.pelletHeadMul : M.headMul;
    else if (z.def.armor) dd = Math.max(dd * 0.15, dd - z.def.armor * Math.max(0, 1 - p.armorPen));
    z.hp -= dd;
    st.dmg += dd;
    st.hits++;
    if (h.head) st.heads++;
    if (p.incendiary) z.burn = BURN.time;
    if (z.def.id !== 'ferryman') {
      const k = p.knock * (pellet ? 0.25 : 1) * (h.head ? 1.4 : 1) * (z.atWall ? 0.5 : 1);
      z.x += k; st.knockPx += k;
      if (z.atWall && p.knock > 15) z.atWall = false;
    }
    if (!pellet || rnd() < 0.25) { const s = p.stagger; if (rnd() < s) { st.stagger++; z.stun = Math.max(z.stun, M.staggerS); } }
    if (z.hp <= 0 && !st.kills.includes(z)) { st.kills.push(z); if (h.head) { st.headKills++; z.headless = true; } }
    n++;
    if (n > p.pierce) break;
    d *= M.falloff;
  }
}

// ---------------------------------------------------------------- shooters
type Style = 'spray' | 'tap' | 'guard';
interface Shooter { aim: number; style: Style; mag: number; bloom: number; lastShot: number; t: number }

function bloomAt(s: Shooter, t: number): number {
  const dt = t - s.lastShot;
  if (dt <= 0) return s.bloom;
  if (M.bloomDecay === 'linear') return Math.max(0, s.bloom - M.bloomRate * dt);
  const free = Math.max(0, dt - M.bloomHold);
  return s.bloom * Math.pow(0.5, free / M.bloomHalfLife);
}
function bloomAdd(p: FireProfile, def: WeaponDef): number {
  const k = M.kick?.[def.id] ?? M.kick?.[weaponClass(def.id)];
  const add = k !== undefined ? k : p.spread * M.bloomK + (p.auto ? M.bloomAuto : M.bloomSemi);
  return add * p.bloomMul;
}
function aimPoint(z: Z, style: Style, pellets: number, aim: number): { x: number; y: number } {
  const hb = hitbox(z);
  const body = { x: z.x, y: (hb.y1 + hb.y2) / 2 };
  if (style === 'guard') return rnd() < 0.2 + aim * 0.25 ? { x: hb.hx, y: hb.hy } : body;
  // the player's own hand: a careful tap lands within a few px of the head, worse on fast movers
  const sway = M.sway * (1 - aim);
  const sd = Math.hypot(style === 'spray' ? 12 : MOUSE_SD + 0.04 * z.def.speed, sway);
  if (style === 'spray') return { x: body.x + gauss(0, sd), y: body.y + gauss(0, sd) };
  if (pellets > 1) return { x: hb.hx + (body.x - hb.hx) * 0.3 + gauss(0, sd), y: hb.hy + (body.y - hb.hy) * 0.3 + gauss(0, sd) };
  return { x: hb.hx + gauss(0, sd), y: hb.hy + gauss(0, sd) };
}
/** Fire one round (all pellets) at target z from the list zs. Returns nothing; updates st/bloom. */
function fireRound(s: Shooter, p: FireProfile, def: WeaponDef, zs: Z[], z: Z, t: number, st: ShotStats, aimed: boolean) {
  const ap = aimPoint(z, s.style, p.pellets, s.aim);
  const base = Math.atan2(ap.y - MUZZLE.y, ap.x - MUZZLE.x);
  const bl = bloomAt(s, t);
  if (s.style === 'guard') {
    const dist = Math.hypot(ap.x - MUZZLE.x, ap.y - MUZZLE.y);
    const err = (p.spread * 1.2 + (1.15 - s.aim) * 0.07) * (1 + dist / 900);
    for (let i = 0; i < p.pellets; i++) castShot(zs, base + gauss(0, p.pellets > 1 ? p.spread * 0.7 : err * 0.6), p, p.pellets > 1, st);
  } else {
    const am = aimed ? M.aimedMul : 1;
    const single = (p.spread * (1.75 - s.aim) + bl) * am;
    const cone = M.pelletAim ? p.spread * (0.75 + bl / 0.08) * (1.3 - 0.3 * s.aim) * (aimed ? 0.85 : 1) : p.spread;
    for (let i = 0; i < p.pellets; i++) castShot(zs, base + (rnd() + rnd() - 1) * (p.pellets > 1 ? cone : single), p, p.pellets > 1, st);
  }
  if (s.style !== 'guard') s.bloom = Math.min(M.bloomCap, bl + bloomAdd(p, def));
  s.lastShot = t;
}
function reloadTime(p: FireProfile, s: Shooter): number {
  const per = p.reloadPerRound ? p.reload * p.mag : p.reload;
  return per * (s.style === 'guard' ? 1.15 : 1);
}
/** When may this shooter pull the trigger next (after cooldown)? Disciplined waits for bloom. */
function nextPull(s: Shooter, p: FireProfile, def: WeaponDef): { t: number; aimed: boolean } {
  const cd = s.style === 'guard' ? (1 / p.rof) * (p.auto ? 1.3 : 1.6) * range(0.9, 1.25) : 1 / p.rof;
  let t = Math.max(s.t, s.lastShot + cd);
  if (s.style !== 'tap') return { t, aimed: M.aimedMul < 1 && t - s.lastShot >= M.aimedDelay && bloomAt(s, t) < M.aimedBloomMax };
  const thr = Math.max(0.003, 0.2 * p.spread * (1.75 - s.aim));
  const slow = def.rof <= 1.2; // bolt guns
  const delay = M.aimedMul < 1 ? (slow ? Math.max(M.aimedDelay, 0.6) : M.aimedDelay) : 0;
  for (let i = 0; i < 100; i++) {
    const ok = bloomAt(s, t) <= (M.aimedMul < 1 ? Math.min(thr, M.aimedBloomMax) : thr) && t - s.lastShot >= delay;
    if (ok) break;
    t += 0.01;
  }
  return { t, aimed: M.aimedMul < 1 && t - s.lastShot >= delay && bloomAt(s, t) < M.aimedBloomMax };
}

// ---------------------------------------------------------------- duel: sequential kills at a fixed distance
interface Cell { burst: number; rpk: number; ttk: number; hs: number; wall: number; noise: number; ammo: number; firstPull: number; stagger: number; kills: number; rounds: number }
function duel(p: FireProfile, def: WeaponDef, zd: ZombieDef, dist: number, skill: number, style: Style, N: number, day = 8): Cell {
  const s: Shooter = { aim: aimOf(skill), style, mag: p.mag, bloom: 0, lastShot: -9, t: 0 };
  let rounds = 0, headKills = 0, knock = 0, stag = 0, firstPull = 0, burst = 0;
  for (let k = 0; k < N; k++) {
    const z = makeZ(zd, MUZZLE.x + dist, day);
    const sweep = ACQUIRE[style] + p.switchTime; // swing onto a new target
    if (style === 'spray' && p.auto && k > 0) {
      // the trigger stays down through the sweep: those rounds go into the dark, and bloom keeps climbing
      for (let tt = Math.max(s.t, s.lastShot + 1 / p.rof); tt < s.t + sweep && s.mag > 0; tt += 1 / p.rof) {
        s.mag--; rounds++;
        s.bloom = Math.min(M.bloomCap, bloomAt(s, tt) + bloomAdd(p, def)); s.lastShot = tt;
      }
    }
    s.t += sweep;
    let shots = 0;
    while (z.hp > 0 && shots < 250) {
      // burning will finish it: a sensible shooter moves on
      if (z.burn > 0 && z.hp <= BURN.dps * z.burn) break;
      if (s.mag <= 0) { s.t = Math.max(s.t, s.lastShot) + reloadTime(p, s); s.mag = p.mag; }
      const np = nextPull(s, p, def);
      s.t = np.t;
      if (rnd() < p.jam) { s.t += p.jamClear; s.lastShot = s.t; continue; }
      const st = newStats();
      const hp0 = z.hp;
      for (let b = 0; b < p.burst && s.mag > 0; b++) {
        s.mag--; rounds++; shots++;
        fireRound(s, p, def, [z], z, s.t + b * p.burstGap, st, np.aimed && b === 0);
        if (z.hp <= 0) break;
      }
      s.t = s.lastShot;
      if (k === 0 && shots <= p.burst) firstPull = hp0 - Math.max(z.hp, -1e9);
      knock += st.knockPx; stag += st.stagger;
      if (st.headKills) headKills++;
      // the target walks back to where it was (duel = fixed distance) except knockback time is banked
      z.x = MUZZLE.x + dist;
    }
    if (k === 0) burst = s.t;
  }
  return {
    burst, rpk: rounds / N, ttk: s.t / N, hs: headKills / N, wall: zd.id === 'ferryman' ? 0 : knock / N / zd.speed,
    noise: (rounds / N) * p.noise * (style === 'guard' ? 0.7 : 1), ammo: (rounds / N) * p.perShot * (1 - p.recoverable),
    firstPull, stagger: stag / N, kills: N, rounds,
  };
}

/** Time to drop ONE target from a loaded, cool gun (mean of `trials` fresh starts). */
function firstKill(p: FireProfile, def: WeaponDef, zd: ZombieDef, dist: number, style: Style, trials: number): number {
  let sum = 0;
  for (let i = 0; i < trials; i++) sum += duel(p, def, zd, dist, 5, style, 1).burst;
  return sum / trials;
}

// ---------------------------------------------------------------- crowd: a dense lane of Sleepers walking in
// A wave of 60 Sleepers walking in at 4 per second from the far end of the road. kpm = 40 / time to
// clear the wave; wallS = zombie-seconds spent clawing at the wall per Sleeper (the pressure the gun
// failed to hold off: knockback, pierce and reload speed all show up here).
interface Crowd { kpm: number; wallS: number; rpk: number }
function crowd(p: FireProfile, def: WeaponDef, skill: number, style: Style, T = 60): Crowd {
  const zd = ZOMBIES.sleeper;
  const zs: Z[] = [];
  const WAVE = 60;
  let last: Z | undefined;
  let spawned = 0;
  const s: Shooter = { aim: aimOf(skill), style, mag: p.mag, bloom: 0, lastShot: -9, t: 0 };
  let kills = 0, rounds = 0, wallS = 0, spawnT = 0, tEnd = T;
  let next = 0.3; let reloadUntil = 0; let pendingAimed = false; let planned = false;
  const dt = 0.01;
  for (let t = 0; t < T; t += dt) {
    spawnT -= dt;
    if (spawnT <= 0 && spawned < WAVE) { zs.push(makeZ(zd, range(1250, 1290))); spawned++; spawnT = 1 / 4; }
    if (spawned >= WAVE && kills >= WAVE) { tEnd = t; break; }
    for (const z of zs) {
      if (z.hp <= 0) continue;
      if (z.burn > 0) { z.burn -= dt; z.hp -= BURN.dps * dt; if (z.hp <= 0) { kills++; continue; } }
      if (z.stun > 0) { z.stun -= dt; continue; }
      const half = (zd.width * z.scale * ZS) / 2;
      if (!z.atWall) { z.x -= zd.speed * dt; if (z.x - half <= WALL_X) { z.x = WALL_X + half; z.atWall = true; } }
      else wallS += dt;
    }
    for (let i = zs.length - 1; i >= 0; i--) if (zs[i].hp <= 0) zs.splice(i, 1);
    if (t < reloadUntil) continue;
    if (s.mag <= 0) { reloadUntil = t + reloadTime(p, s); s.mag = p.mag; planned = false; continue; }
    let tgt: Z | undefined;
    for (const z of zs) if (z.hp > 0 && !(z.burn > 0 && z.hp <= BURN.dps * z.burn) && (!tgt || z.x < tgt.x)) tgt = z;
    if (tgt && p.pellets > 1 && tgt.x > MUZZLE.x + 450) continue; // a shotgunner lets them come
    if (!tgt) continue;
    if (!planned) { s.t = t + (tgt !== last ? ACQUIRE[style] + p.switchTime : 0); last = tgt; const np = nextPull(s, p, def); next = np.t; pendingAimed = np.aimed; planned = true; }
    if (t < next) continue;
    planned = false;
    if (rnd() < p.jam) { reloadUntil = t + p.jamClear; s.lastShot = t; continue; }
    const st = newStats();
    for (let b = 0; b < p.burst && s.mag > 0; b++) { s.mag--; rounds++; fireRound(s, p, def, zs, tgt, t + b * p.burstGap, st, pendingAimed && b === 0); }
    kills += st.kills.length;
  }
  return { kpm: (kills / tEnd) * 60, wallS: wallS / WAVE, rpk: rounds / Math.max(1, kills) };
}

// ---------------------------------------------------------------- profiles & costs
interface Prof { key: string; gun: string; ammo: Res | null; p: FireProfile; def: WeaponDef }
function profiles(): Prof[] {
  const out: Prof[] = [];
  for (const id of WEAPON_ORDER) {
    const def = WEAPONS[id];
    if (!def || def.explosive) continue; // area weapons (launchers) need a blast model: not simulated
    // one pool per gun now (docs/research/19-simplify-resources.md): one profile each, no alternate loads
    const p = fireProfile({ uid: 'b', def: id, cond: 1, kills: 0 } as WeaponItem);
    p.switchTime += SWITCH_PATCH[id] ?? 0;
    out.push({ key: id, gun: id, ammo: def.ammo ?? null, p, def });
  }
  return out;
}
const VALUE: Partial<Record<Res, number>> = { salvage: 1, fuel: 2, food: 0.6 };
/** scrap-equivalent material cost of one stores unit of res, from the cheapest recipe. */
function unitCost(res: Res, depth = 0): number {
  if (VALUE[res] !== undefined) return VALUE[res]!;
  if (depth > 3) return 1;
  let best = Infinity;
  for (const r of RECIPES) {
    const n = r.gives?.[res];
    if (!n) continue;
    let c = 0;
    for (const [k, v] of Object.entries(r.cost)) c += (v ?? 0) * unitCost(k as Res, depth + 1);
    best = Math.min(best, c / n);
  }
  return best === Infinity ? 1 : best;
}
const costPerRound = (pr: Prof) => (pr.p.ammoRes ? unitCost(pr.p.ammoRes) * pr.p.perShot * (1 - pr.p.recoverable) : 0);

// ---------------------------------------------------------------- full sweep
interface Row { pr: Prof; cells: Map<string, Cell>; crowdSpray: Crowd; crowdTap: Crowd; cpr: number; first: Map<string, number> }
const ck = (z: string, d: number, sk: number, st: Style) => `${z}|${d}|${sk}|${st}`;
function sweep(N: number, crowdT: number): Row[] {
  const rows: Row[] = [];
  for (const pr of profiles()) {
    const cells = new Map<string, Cell>();
    for (const zd of Object.values(ZOMBIES)) for (const d of DISTS) for (const sk of SKILLS) for (const st of ['spray', 'tap', 'guard'] as Style[]) {
      if (st === 'guard' && sk === 8) continue;
      cells.set(ck(zd.id, d, sk, st), duel(pr.p, pr.def, zd, d, sk, st, zd.id === 'ferryman' ? Math.ceil(N / 3) : N));
    }
    const first = new Map<string, number>();
    for (const z of ['pulper', 'deputy', 'ferryman', 'crier']) {
      let t = 0;
      for (const d of DISTS) t += Math.min(firstKill(pr.p, pr.def, ZOMBIES[z], d, 'spray', Math.ceil(N / 4)), firstKill(pr.p, pr.def, ZOMBIES[z], d, 'tap', Math.ceil(N / 4)));
      first.set(z, t / DISTS.length);
    }
    rows.push({ pr, cells, first, crowdSpray: crowd(pr.p, pr.def, 5, 'spray', crowdT * 2), crowdTap: crowd(pr.p, pr.def, 5, 'tap', crowdT * 2), cpr: costPerRound(pr) });
  }
  return rows;
}
/** "Competent" player: sprays at the wall (150 px, 40% of kills), taps at 400 (40%) and 700 (20%). */
const COMP_W = [0.4, 0.4, 0.2];
function competent(r: Row, z: string, sk = 5): Cell {
  const cs = [r.cells.get(ck(z, 150, sk, 'spray'))!, r.cells.get(ck(z, 400, sk, 'tap'))!, r.cells.get(ck(z, 700, sk, 'tap'))!];
  const avg = (f: (c: Cell) => number) => cs.reduce((a, c, i) => a + f(c) * COMP_W[i], 0);
  return { burst: avg((c) => c.burst), rpk: avg((c) => c.rpk), ttk: avg((c) => c.ttk), hs: avg((c) => c.hs), wall: avg((c) => c.wall), noise: avg((c) => c.noise), ammo: avg((c) => c.ammo), firstPull: cs[0].firstPull, stagger: avg((c) => c.stagger), kills: 0, rounds: 0 };
}
// first-kill time: mean over seeds is noisy with N small, so average the three distances, best style
const burstAvg = (r: Row, z: string) => r.first.get(z)!;
const bestStyle = (r: Row, z: string, d: number, sk = 5): Cell => {
  const a = r.cells.get(ck(z, d, sk, 'spray'))!, b = r.cells.get(ck(z, d, sk, 'tap'))!;
  return a.ttk <= b.ttk ? a : b;
};

// ---------------------------------------------------------------- analysis
const ZIDS = () => Object.keys(ZOMBIES);
const f1 = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Analysis { md: string; checks: { name: string; pass: boolean; detail: string }[]; niche: Map<string, string[]>; dominated: string[]; dominant: string[] }
function analyse(rows: Row[], label: string): Analysis {
  const L: string[] = [];
  const checks: Analysis['checks'] = [];
  const defaults = rows;
  // ---- table A: per gun/ammo summary at skill 5
  L.push(`### ${label}: per gun & ammo (skill 5, Sleeper unless noted)`, '');
  L.push('| gun/ammo | dmg×pel | 1st pull %Slp | RPK spray@400 | RPK tap@400 | tap÷spray@700 | TTK s (comp.) | HS% (comp.) | Deer TTK | Deputy RPK (comp.) | Ferry TTK | wave k/min | wall-s/Slp | cost/kill | noise/kill |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const sp4 = r.cells.get(ck('sleeper', 400, 5, 'spray'))!, tp4 = r.cells.get(ck('sleeper', 400, 5, 'tap'))!;
    const sp7 = r.cells.get(ck('sleeper', 700, 5, 'spray'))!, tp7 = r.cells.get(ck('sleeper', 700, 5, 'tap'))!;
    const c = competent(r, 'sleeper');
    const deer = competent(r, 'deer'), dep = competent(r, 'deputy'), fer = competent(r, 'ferryman');
    const crowdBest = r.crowdSpray.wallS <= r.crowdTap.wallS ? r.crowdSpray : r.crowdTap;
    L.push(`| ${r.pr.key} | ${f1(r.pr.p.dmg)}×${r.pr.p.pellets}${r.pr.p.burst > 1 ? `×${r.pr.p.burst}b` : ''} | ${pct(c.firstPull / SLEEPER_HP())} | ${f1(sp4.rpk)} | ${f1(tp4.rpk)} | ${f1(sp7.rpk / tp7.rpk)} | ${f1(c.ttk)} | ${pct(c.hs)} | ${f1(deer.ttk)} | ${f1(dep.rpk)} | ${f1(fer.ttk)} | ${f1(crowdBest.kpm)} | ${crowdBest.wallS.toFixed(2)} | ${f1(c.ammo * r.cpr)} | ${f1(c.noise)} |`);
  }
  L.push('');
  // ---- table B: TTK grid (best style, skill 5) for default ammo, every zombie x distance
  L.push(`### ${label}: time-to-kill grid, default ammo, skill 5, best of spray/tap (s)`, '');
  const zids = ZIDS();
  L.push(`| gun | ${zids.map((z) => DISTS.map((d) => `${z.slice(0, 4)}${d}`).join(' | ')).join(' | ')} |`);
  L.push(`|---|${zids.map(() => DISTS.map(() => '---').join('|')).join('|')}|`);
  for (const r of defaults) L.push(`| ${r.pr.key} | ${zids.map((z) => DISTS.map((d) => f1(bestStyle(r, z, d).ttk)).join(' | ')).join(' | ')} |`);
  L.push('');
  // ---- table C: skill sensitivity
  L.push(`### ${label}: skill sensitivity (Sleeper @400, tap) and guard efficiency`, '');
  L.push('| gun | RPK sk2 | RPK sk5 | RPK sk8 | TTK sk2 | TTK sk8 | guard RPK sk2 | guard RPK sk5 | guard HS% sk5 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of defaults) {
    const g = (sk: number, st: Style) => r.cells.get(ck('sleeper', 400, sk, st))!;
    L.push(`| ${r.pr.key} | ${f1(g(2, 'tap').rpk)} | ${f1(g(5, 'tap').rpk)} | ${f1(g(8, 'tap').rpk)} | ${f1(g(2, 'tap').ttk)} | ${f1(g(8, 'tap').ttk)} | ${f1(g(2, 'guard').rpk)} | ${f1(g(5, 'guard').rpk)} | ${pct(g(5, 'guard').hs)} |`);
  }
  L.push('');

  // ---- niche / domination (default + alt ammo merged per gun: a gun's value is its best ammo per cell)
  type Metric = { name: string; better: 'lo' | 'hi'; val: (r: Row) => number };
  const metrics: Metric[] = [];
  for (const z of zids) for (const d of DISTS) metrics.push({ name: `TTK ${z}@${d}`, better: 'lo', val: (r) => bestStyle(r, z, d).ttk });
  // one big target, gun loaded and cool: the 'answer' to a Ferryman, a Deputy, a Pulper far out
  for (const z of ['pulper', 'deputy', 'ferryman', 'crier']) metrics.push({ name: `first kill ${z}`, better: 'lo', val: (r) => burstAvg(r, z) });
  for (const z of zids) metrics.push({ name: `cost/kill ${z}`, better: 'lo', val: (r) => competent(r, z).ammo * r.cpr + 0.02 });
  for (const z of zids.filter((x) => x !== 'ferryman')) metrics.push({ name: `wall-time bought ${z}`, better: 'hi', val: (r) => competent(r, z).wall });
  // night value: time + ammo (1 s per scrap-eq) + noise (28 noise = one more Sleeper ≈ 1 s)
  for (const z of zids) metrics.push({ name: `value ${z}`, better: 'lo', val: (r) => { const c = competent(r, z); return c.ttk + c.ammo * r.cpr + c.noise / 28; } });
  for (const sk of [2, 5]) for (const d of [150, 400]) metrics.push({ name: `in a guard's hands (shooting ${sk}, ${d} px)`, better: 'lo', val: (r) => r.cells.get(ck('sleeper', d, sk, 'guard'))!.ttk });
  metrics.push({ name: 'guard ammo/kill', better: 'lo', val: (r) => r.cells.get(ck('sleeper', 400, 2, 'guard'))!.ammo * r.cpr + 0.02 });
  metrics.push({ name: 'wave cost/kill', better: 'lo', val: (r) => Math.min(r.crowdSpray.rpk, r.crowdTap.rpk) * r.cpr + 0.02 });
  metrics.push({ name: 'crowd kills/min', better: 'hi', val: (r) => Math.max(r.crowdSpray.kpm, r.crowdTap.kpm) });
  metrics.push({ name: 'crowd wall pressure', better: 'lo', val: (r) => Math.min(r.crowdSpray.wallS, r.crowdTap.wallS) + 0.05 });
  metrics.push({ name: 'quiet (noise/kill)', better: 'lo', val: (r) => competent(r, 'sleeper').noise + 0.05 });
  const guns = [...new Set(rows.map((r) => r.pr.gun))].filter((g) => !UTILITY.includes(g));
  const gunVal = (g: string, m: Metric) => {
    const vs = rows.filter((r) => r.pr.gun === g).map(m.val);
    return m.better === 'lo' ? Math.min(...vs) : Math.max(...vs);
  };
  const table = new Map<string, number[]>(guns.map((g) => [g, metrics.map((m) => gunVal(g, m))]));
  const niche = new Map<string, string[]>();
  const nearBest = new Map<string, number>(); // within 10% of the best TTK (dominance)
  metrics.forEach((m, i) => {
    const vals = guns.map((g) => table.get(g)![i]);
    const best = m.better === 'lo' ? Math.min(...vals) : Math.max(...vals);
    const sorted = [...vals].sort((a, b) => (m.better === 'lo' ? a - b : b - a));
    const third = sorted[Math.min(2, sorted.length - 1)];
    const near = (v: number) => (m.better === 'lo' ? v <= best * 1.05 || v <= third : v >= best * 0.95 || v >= third);
    if (vals.filter(near).length > guns.length / 2) return; // a metric everyone ties on is nobody's niche
    guns.forEach((g) => {
      const v = table.get(g)![i];
      if (near(v)) niche.set(g, [...(niche.get(g) ?? []), m.name]);
      if (m.name.startsWith('TTK') && v <= best * 1.1) nearBest.set(g, (nearBest.get(g) ?? 0) + 1);
    });
  });
  const dominated: string[] = [];
  for (const a of guns) for (const b of guns) {
    if (a === b) continue;
    const va = table.get(a)!, vb = table.get(b)!;
    const all = metrics.every((m, i) => (m.better === 'lo' ? vb[i] <= va[i] * 1.02 : vb[i] >= va[i] * 0.98));
    if (all) dominated.push(`${a} < ${b}`);
  }
  const ttkCells = metrics.filter((m) => m.name.startsWith('TTK')).length;
  const dominant = guns.filter((g) => (nearBest.get(g) ?? 0) >= ttkCells * 0.6);
  // the TTK loop above returned early on tied metrics; recount dominance over every TTK cell
  nearBest.clear();
  metrics.forEach((m, i) => {
    if (!m.name.startsWith('TTK')) return;
    const best = Math.min(...guns.map((g) => table.get(g)![i]));
    guns.forEach((g) => { if (table.get(g)![i] <= best * 1.1) nearBest.set(g, (nearBest.get(g) ?? 0) + 1); });
  });
  dominant.splice(0, dominant.length, ...guns.filter((g) => (nearBest.get(g) ?? 0) >= ttkCells * 0.6));
  L.push(`### ${label}: niches (top-3 or within 5% of the best gun on a metric)`, '');
  L.push('| gun | # niches | examples |', '|---|---|---|');
  for (const g of guns) { const n = niche.get(g) ?? []; L.push(`| ${g} | ${n.length} | ${n.slice(0, 4).join('; ')}${n.length > 4 ? ' …' : ''} |`); }
  L.push('', 'First-kill time (s, loaded & cool, best style, mean of 3 distances): ' + ['pulper', 'deputy', 'ferryman'].map((z) => `${z}: ${guns.map((g) => [g, Math.min(...rows.filter((r) => r.pr.gun === g).map((r) => burstAvg(r, z)))] as [string, number]).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([g, v]) => `${g} ${f1(v)}`).join(', ')}`).join(' · '));
  L.push('', `Dominated pairs (loser < winner on every metric, 2% tolerance): ${dominated.length ? dominated.join(', ') : 'none'}`);
  L.push(`Dominant (near-best TTK in ≥60% of ${ttkCells} zombie×distance cells): ${dominant.length ? dominant.join(', ') : 'none'}`, '');

  // ---- checks
  const multiHit = defaults.filter((r) => r.pr.p.pellets === 1 && r.pr.p.dmg * r.pr.p.burst < SLEEPER_HP() && r.pr.p.rof >= 2);
  const ratios = multiHit.map((r) => ({ k: r.pr.key, v: duel(r.pr.p, r.pr.def, ZOMBIES.sleeper, 700, 5, 'spray', 600).rpk / duel(r.pr.p, r.pr.def, ZOMBIES.sleeper, 700, 5, 'tap', 600).rpk }));
  const autos = ratios.filter((x) => WEAPONS[x.k]?.auto);
  checks.push({ name: 'tap ≥3× fewer rounds than spray @700 (autos)', pass: autos.every((x) => x.v >= 3), detail: autos.map((x) => `${x.k} ${x.v.toFixed(1)}`).join(', ') });
  L.push(`(info) tap÷spray rounds-per-kill @700, semi-autos: ${ratios.filter((x) => !WEAPONS[x.k]?.auto).map((x) => `${x.k} ${x.v.toFixed(1)}`).join(', ')}`, '');
  const hsAll = defaults.map((r) => { const zs = ['sleeper', 'deer', 'drag', 'pulper', 'crier', 'deputy']; return zs.reduce((a, z) => a + competent(r, z).hs, 0) / zs.length; }).sort((a, b) => a - b);
  const med = hsAll[Math.floor(hsAll.length / 2)];
  checks.push({ name: 'median headshot share of the player\'s own kills (competent) 35-65%', pass: med >= 0.35 && med <= 0.65, detail: `median ${pct(med)}, range ${pct(hsAll[0])}..${pct(hsAll[hsAll.length - 1])}` });
  // the whole wall: the leader (competent, ~30% of kills) and guards (shooting 2-5, ~70%)
  const wallHs = defaults.map((r) => { const g = (r.cells.get(ck('sleeper', 400, 2, 'guard'))!.hs + r.cells.get(ck('sleeper', 400, 5, 'guard'))!.hs) / 2; return 0.3 * competent(r, 'sleeper').hs + 0.7 * g; }).sort((a, b) => a - b);
  const wmed = wallHs[Math.floor(wallHs.length / 2)];
  checks.push({ name: 'headshot share of all kills on the wall (leader + guards) 35-55%', pass: wmed >= 0.35 && wmed <= 0.55, detail: `median ${pct(wmed)}, range ${pct(wallHs[0])}..${pct(wallHs[wallHs.length - 1])}` });
  const guardHs = defaults.map((r) => r.cells.get(ck('sleeper', 400, 5, 'guard'))!.hs).sort((a, b) => a - b);
  checks.push({ name: 'guard (skill 5) headshot share 20-45%', pass: guardHs[Math.floor(guardHs.length / 2)] >= 0.2 && guardHs[Math.floor(guardHs.length / 2)] <= 0.45, detail: `median ${pct(guardHs[Math.floor(guardHs.length / 2)])}` });
  const nonAuto = defaults.filter((r) => !r.pr.p.auto && r.pr.p.ammoRes && r.pr.def.caliber !== 'r22' && !UTILITY.includes(r.pr.gun));
  const weakPull = nonAuto.filter((r) => r.pr.p.dmg * r.pr.p.pellets * r.pr.p.burst < 0.5 * SLEEPER_HP()).map((r) => r.pr.key);
  checks.push({ name: 'first trigger pull ≥50% of a Sleeper (non-auto guns except .22 and flare)', pass: weakPull.length === 0, detail: weakPull.length ? `below: ${weakPull.join(', ')}` : 'all' });
  const noOneShot = defaults.filter((r) => r.pr.p.pellets === 1 && r.pr.p.dmg * M.headMul < SLEEPER_HP() && r.pr.def.caliber !== 'r22' && r.pr.def.caliber !== 'nails').map((r) => r.pr.key);
  checks.push({ name: 'one-shot Sleeper headshot for calibres ≥ pistol', pass: noOneShot.length === 0, detail: noOneShot.length ? `fail: ${noOneShot.join(', ')}` : 'all' });
  const noNiche = guns.filter((g) => !(niche.get(g)?.length));
  checks.push({ name: 'every gun has a niche', pass: noNiche.length === 0, detail: noNiche.length ? `no niche: ${noNiche.join(', ')}` : `min ${Math.min(...guns.map((g) => niche.get(g)!.length))} niches` });
  checks.push({ name: 'no gun dominated everywhere', pass: dominated.length === 0, detail: dominated.join(', ') || 'none' });
  checks.push({ name: 'no gun dominant everywhere', pass: dominant.length === 0, detail: dominant.join(', ') || 'none' });
  // sponge check: TTK of each zombie for the median gun vs its threat cost
  const spongeRows: string[] = [];
  for (const z of zids) {
    const t = defaults.map((r) => competent(r, z).ttk).sort((a, b) => a - b);
    const m = t[Math.floor(t.length / 2)];
    spongeRows.push(`${z} ${f1(m)}s (${f1(m / ZOMBIES[z].cost)} s/threat-pt)`);
  }
  L.push(`### ${label}: median competent TTK per Turned (s, and s per threat point)`, '', spongeRows.join(' · '), '');
  L.push(`### ${label}: checks`, '');
  for (const c of checks) L.push(`- ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}: ${c.detail}`);
  L.push('');
  return { md: L.join('\n'), checks, niche, dominated, dominant };
}

// ---------------------------------------------------------------- economy, days 1-23
// A "sensible player": crafts only up to ~3 nights of stock per calibre (6 from day 19, when the radio
// says the river is freezing); one crafter (crafting 3) on ammunition every day (two from day 8, three from
// day 15; a still making 2 fuel a day from day 6), one
// scavenger (scavenging 3; two from day 8) at the best ammo sites that still have stock, a loadout that grows with the days, the leader
// fighting as a competent player (skill 5) and the rest as guards (skill 3).
interface Slot { gun: string; who: 'leader' | 'guard' }
function loadout(day: number): Slot[] {
  if (day <= 3) return [{ gun: 'service9', who: 'leader' }, { gun: 'revolver', who: 'guard' }, { gun: 'pump', who: 'guard' }];
  if (day <= 7) return [{ gun: 'service9', who: 'leader' }, { gun: 'revolver', who: 'guard' }, { gun: 'pump', who: 'guard' }, { gun: 'lever', who: 'guard' }];
  if (day <= 11) return [{ gun: 'lever', who: 'leader' }, { gun: 'revolver', who: 'guard' }, { gun: 'pump', who: 'guard' }, { gun: 'service9', who: 'guard' }, { gun: 'r22', who: 'guard' }];
  return [{ gun: 'ar15', who: 'leader' }, { gun: 'smg', who: 'guard' }, { gun: 'pump', who: 'guard' }, { gun: 'hunting', who: 'guard' }, { gun: 'service9', who: 'guard' }];
}
// fraction of kills by slot: the leader takes a larger share
const share = (slots: Slot[]) => slots.map((s) => (s.who === 'leader' ? 1.6 : 1) / slots.reduce((a, x) => a + (x.who === 'leader' ? 1.6 : 1), 0));
interface EconDay { day: number; pts: number; zombies: number; hp: number; spent: Partial<Record<Res, number>>; gained: Partial<Record<Res, number>>; stock: Partial<Record<Res, number>>; stragglers: number; scrap: number; fuel: number; parts: number }
function economy(seeds: number, N: number): { days: EconDay[]; md: string } {
  const rpkCache = new Map<string, { rpk: number; noise: number }>();
  const rpkOf = (gun: string, who: Slot['who'], z: string, day: number) => {
    const hpBand = Math.round(M.hpMul(day) * 20) / 20;
    const key = `${gun}|${who}|${z}|${hpBand}`;
    if (!rpkCache.has(key)) {
      const def = WEAPONS[gun];
      const p = fireProfile({ uid: 'e', def: gun, cond: 0.85, kills: 0 });
      p.switchTime += SWITCH_PATCH[gun] ?? 0;
      let rpk = 0, noise = 0;
      for (const d of DISTS) {
        const st: Style = who === 'guard' ? 'guard' : d === 150 ? 'spray' : 'tap';
        const c = duel(p, def, ZOMBIES[z], d, who === 'guard' ? 3 : 5, st, N, day);
        rpk += c.rpk / 3; noise += c.noise / 3;
      }
      // in a crowd a miss often hits the next one: crowd efficiency credit
      rpkCache.set(key, { rpk: rpk * 0.85, noise: noise * 0.85 });
    }
    return rpkCache.get(key)!;
  };
  const acc: EconDay[] = [];
  const lastSpent: Partial<Record<Res, number>> = {}; // a sensible crafter stops at ~3 nights of stock
  for (let sd = 0; sd < seeds; sd++) {
    newGame(['siege', 'quiet', 'coin'][sd % 3], 5000 + sd);
    const stores = { ...G.stores, ...START } as Record<Res, number>;
    const siteStock = new Map(SITES.map((s) => [s.id, s.stock]));
    let crafted = 0;
    for (const k of Object.keys(lastSpent)) delete lastSpent[k as Res];
    for (let day = 1; day <= 23; day++) {
      G.day = day;
      setState(G);
      const gained: Partial<Record<Res, number>> = {};
      const addR = (k: Res, n: number) => { stores[k] = (stores[k] ?? 0) + n; gained[k] = (gained[k] ?? 0) + n; };
      // --- scavenging: best ammo-value site
      const slots = loadout(day);
      const calibers = new Set(slots.map((s) => WEAPONS[s.gun].ammo));
      const siteVal = (s: (typeof SITES)[number]) => Object.entries(s.loot).reduce((a, [k, v]) => a + (calibers.has(k as Res) ? 3 : k === 'salvage' ? (stores.salvage < 15 ? 4 : 1) : k === 'fuel' ? (stores.fuel < 6 ? 3 : 0.5) : 0.2) * (v ?? 0), 0) * Math.max(0.15, siteStock.get(s.id)! / s.stock);
      const open = SITES.filter((s) => s.minDay <= day && day >= 2 + (s.risk > 0.5 ? 6 : 0));
      for (const site of open.sort((a, b) => siteVal(b) - siteVal(a)).slice(0, day >= 8 ? 2 : 1)) {
        const fullness = Math.max(0.15, siteStock.get(site.id)! / site.stock);
        const mult = (0.55 + 3 * 0.12) * fullness * 0.95;
        for (const [k, v] of Object.entries(site.loot)) addR(k as Res, Math.round((v ?? 0) * mult));
        siteStock.set(site.id, siteStock.get(site.id)! - 1);
      }
      // --- background income from the rest of the house (repair/farm jobs bring nothing; radio/trade a little)
      addR('salvage', 3);
      // --- crafting: 5.7 work/day, ammo for the most-depleted caliber in the loadout; half the materials go to the wall
      let work = (3 + 3 * 0.9) * (day >= 15 ? 3 : day >= 8 ? 2 : 1); // more crafters as the house grows
      if (day >= 6) addR('fuel', 2); // the still: rot and sawdust to fuel
      const needs = [...calibers].filter((c): c is Res => !!c).sort((a, b) => (stores[a] ?? 0) / perNight(a) - (stores[b] ?? 0) / perNight(b));
      for (const res of needs) {
        const r = RECIPES.find((x) => x.gives?.[res] && !Object.keys(x.cost).some((k) => k !== 'salvage' && AMMO_TYPES[k as Res]));
        if (!r || (r.level ?? 1) > (day >= 11 ? 3 : day >= 5 ? 2 : 1) || (r.needs !== 'workbench' && day < 4)) continue;
        while (work >= r.work && (stores[res] ?? 0) < (day >= 19 ? 6 : 3) * perNight(res) && Object.entries(r.cost).every(([k, v]) => (stores[k as Res] ?? 0) * 0.5 >= (v ?? 0))) {
          for (const [k, v] of Object.entries(r.cost)) stores[k as Res] -= v ?? 0;
          addR(res, r.gives![res]!);
          work -= r.work;
          crafted++;
        }
      }
      // --- the night
      const plan = planNight();
      const spent: Partial<Record<Res, number>> = {};
      const sh = share(slots);
      let noise = 0; let hp = 0; let n = 0;
      const killOne = (type: string, weight = 1) => {
        n += weight; hp += ZOMBIES[type].hp * M.hpMul(day) * weight;
        slots.forEach((s, i) => {
          const def = WEAPONS[s.gun];
          const r = rpkOf(s.gun, s.who, type, day);
          if (def.ammo) spent[def.ammo] = (spent[def.ammo] ?? 0) + r.rpk * sh[i] * weight * (def.perShot ?? 1);
          noise += r.noise * sh[i] * weight;
        });
      };
      for (const sp of plan.spawns) killOne(sp.type);
      // stragglers: every 28 noise brings one more (70% sleeper / 30% deer), which makes more noise
      let strag = 0;
      for (let i = 0; i < 6 && noise >= 28; i++) { const k = Math.floor(noise / 28); noise -= k * 28; strag += k; killOne('sleeper', k * 0.7); killOne('deer', k * 0.3); }
      for (const [k, v] of Object.entries(spent)) { stores[k as Res] = Math.max(0, (stores[k as Res] ?? 0) - (v ?? 0)); lastSpent[k as Res] = v; }
      if (M.salvage) stores.salvage += n * M.salvage; // brass, nails and buckles off the road at dawn
      G.stores = { ...G.stores, ...stores };
      const row = acc[day - 1] ?? { day, pts: 0, zombies: 0, hp: 0, spent: {}, gained: {}, stock: {}, stragglers: 0, scrap: 0, fuel: 0, parts: 0 };
      row.pts += plan.points / seeds; row.zombies += n / seeds; row.hp += hp / seeds; row.stragglers += strag / seeds;
      for (const [k, v] of Object.entries(spent)) row.spent[k as Res] = (row.spent[k as Res] ?? 0) + (v ?? 0) / seeds;
      for (const [k, v] of Object.entries(gained)) row.gained[k as Res] = (row.gained[k as Res] ?? 0) + (v ?? 0) / seeds;
      for (const k of ['pistol', 'shell', 'rifle'] as Res[]) row.stock[k] = (row.stock[k] ?? 0) + (stores[k] ?? 0) / seeds;
      row.scrap += stores.salvage / seeds; row.fuel += stores.fuel / seeds;
      acc[day - 1] = row;
    }
    void crafted;
  }
  const L: string[] = [];
  L.push('| day | threat | Turned | HP total | stragglers | spent pistol/shell/rifle | gained (same) | stock (same) | salvage/fuel | verdict |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of acc) {
    const k: Res[] = ['pistol', 'shell', 'rifle'];
    const g = (o: Partial<Record<Res, number>>) => k.map((x) => Math.round(o[x] ?? 0)).join('/');
    const nights = k.filter((x) => (r.spent[x] ?? 0) > 1).map((x) => (r.stock[x] ?? 0) / (r.spent[x] ?? 1));
    const minN = nights.length ? Math.min(...nights) : 9;
    const verdict = minN < 0.5 ? 'BROKE' : minN < 1.5 ? 'tight' : minN < 4 ? 'hover' : 'HOARD';
    L.push(`| ${r.day} | ${Math.round(r.pts)} | ${Math.round(r.zombies)} | ${Math.round(r.hp)} | ${r.stragglers.toFixed(1)} | ${g(r.spent)} | ${g(r.gained)} | ${g(r.stock)} | ${Math.round(r.scrap)}/${Math.round(r.fuel)} | ${verdict} (${minN.toFixed(1)} nights) |`);
  }
  return { days: acc, md: L.join('\n') };
  function perNight(res: Res) { return Math.max(10, lastSpent[res] ?? (res === 'pistol' ? 40 : 15)); }
}

// ---------------------------------------------------------------- feel numbers (derived, for the integrator)
function feel(rows: Row[]): string {
  const L: string[] = [];
  L.push('| gun | class | pull dmg (body) | hitstop ms | shake px | recoil kick px | knock px/hit | knock feel |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const p = r.pr.p;
    const pull = p.dmg * p.pellets * p.burst;
    // hitstop scales with log of trigger-pull damage relative to a Sleeper, clamped; autos get none per shot
    const rel = pull / SLEEPER_HP();
    const hit = p.auto ? 0 : Math.round(Math.max(18, Math.min(110, 40 + 45 * Math.log2(Math.max(0.25, rel)))));
    const shake = Math.round(Math.max(1, Math.min(14, (p.auto ? 1.2 : 2.5) + 3.2 * Math.sqrt(rel) * p.recoilMul)) * 10) / 10;
    const kick = Math.round(Math.max(2, Math.min(22, 3 + 7 * Math.sqrt(rel))) * (p.auto ? 0.5 : 1));
    const kpx = p.knock * (p.pellets > 1 ? 0.25 * p.pellets : 1);
    L.push(`| ${r.pr.key} | ${weaponClass(r.pr.gun)} | ${f1(pull)} | ${hit} | ${shake} | ${kick} | ${f1(kpx)} | ${kpx >= 40 ? 'heavy: stagger anim + dust' : kpx >= 15 ? 'medium: 120 ms flinch' : 'light: 60 ms flinch'} |`);
  }
  return L.join('\n');
}

// ================================================================= THE PATCH (docs/balance.md)
// Exact numbers proposed for src/. Each line is one change. applyPatch() mutates the imported
// module objects in-memory only.
type WPatch = Partial<WeaponDef>;
// The battle-model patch from balance.md §4a is now implemented in src/ (see BASE_MODEL), so this layer is empty.
const PATCH_MODEL: Partial<Model> = {
  name: 'patch',
};
// The data changes below were applied to src/ (weapons.ts, zombies.ts, world.ts, newgame.ts;
// see docs/balance.md §4b–c). They stay as empty layers so new data experiments can go here.
const WEAPON_PATCH: Record<string, WPatch> = {};
// extra swing time added on top of fireProfile().switchTime (WeaponDef.switchTime is now real)
const PATCH_SWITCH: Record<string, number> = {};
const SWITCH_PATCH: Record<string, number> = {};
// newgame.ts starting stores override (src now starts at 70 pistol rounds; the doc proposed 80)
const START_PATCH: Partial<Record<Res, number>> = {};
const START: Partial<Record<Res, number>> = {};
const ZOMBIE_PATCH: Record<string, Partial<ZombieDef>> = {};
const RECIPE_PATCH: Record<string, { cost?: Partial<Record<Res, number>>; gives?: Partial<Record<Res, number>>; work?: number }> = {};
const SITE_PATCH: Record<string, Partial<Record<Res, number>>> = {};
export const PATCH = { model: PATCH_MODEL, weapons: WEAPON_PATCH, zombies: ZOMBIE_PATCH, recipes: RECIPE_PATCH, sites: SITE_PATCH };

function applyPatch() {
  M = { ...BASE_MODEL, ...PATCH_MODEL };
  Object.assign(SWITCH_PATCH, PATCH_SWITCH);
  Object.assign(START, START_PATCH);
  for (const [id, p] of Object.entries(WEAPON_PATCH)) if (WEAPONS[id]) Object.assign(WEAPONS[id], p);
  for (const [id, p] of Object.entries(ZOMBIE_PATCH)) if (ZOMBIES[id]) Object.assign(ZOMBIES[id], p);
  for (const [id, p] of Object.entries(RECIPE_PATCH)) { const r = RECIPES.find((x) => x.id === id); if (r) { if (p.cost) r.cost = p.cost; if (p.gives) r.gives = p.gives; if (p.work) r.work = p.work; } }
  for (const [id, p] of Object.entries(SITE_PATCH)) { const st = SITES.find((x) => x.id === id); if (st) Object.assign(st.loot, p); }
}
function patchList(): string {
  const L: string[] = [];
  let n = 0;
  const base = snapshot.weapons;
  for (const [id, p] of Object.entries(WEAPON_PATCH)) for (const [k, v] of Object.entries(p)) { n++; L.push(`- weapons.ts \`${id}.${k}\`: ${String((base[id] as unknown as Record<string, unknown>)?.[k] ?? '—')} → **${String(v)}**`); }
  for (const [id, p] of Object.entries(ZOMBIE_PATCH)) for (const [k, v] of Object.entries(p)) { n++; L.push(`- zombies.ts \`${id}.${k}\`: ${String((snapshot.zombies[id] as unknown as Record<string, unknown>)?.[k] ?? '—')} → **${String(v)}**`); }
  for (const [id, p] of Object.entries(RECIPE_PATCH)) { n++; L.push(`- world.ts recipe \`${id}\`: ${JSON.stringify(snapshot.recipes[id])} → **${JSON.stringify({ ...snapshot.recipes[id], ...p })}**`); }
  for (const [k, v] of Object.entries(START_PATCH)) { n++; L.push(`- newgame.ts starting stores \`${k}\`: 130 → **${v}**`); }
  for (const [id, v] of Object.entries(PATCH_SWITCH)) { n++; L.push(`- weapons.ts \`${id}.switchTime\` (new optional WeaponDef field, added in baseProfile): 0 → **${v}**`); }
  for (const [id, p] of Object.entries(SITE_PATCH)) for (const [k, v] of Object.entries(p)) { n++; L.push(`- world.ts site \`${id}.loot.${k}\`: ${snapshot.sites[id]?.[k as Res] ?? '—'} → **${v}**`); }
  for (const [k, v] of Object.entries(PATCH_MODEL)) { if (k === 'name') continue; n++; L.push(`- battle.ts model \`${k}\`: ${k === 'hpMul' ? '1+0.03×(day−8)' : JSON.stringify((BASE_MODEL as unknown as Record<string, unknown>)[k])} → **${k === 'hpMul' ? '1+0.02×(day−8)' : JSON.stringify(v)}**`); }
  return `${n} changes\n\n${L.join('\n')}`;
}
const snapshot = {
  weapons: JSON.parse(JSON.stringify(WEAPONS)) as Record<string, WeaponDef>,
  zombies: JSON.parse(JSON.stringify(ZOMBIES)) as Record<string, ZombieDef>,
  sites: Object.fromEntries(SITES.map((x) => [x.id, { ...x.loot }])) as Record<string, Partial<Record<Res, number>>>,
  recipes: Object.fromEntries(RECIPES.map((r) => [r.id, { cost: r.cost, gives: r.gives, work: r.work }])) as Record<string, { cost: unknown; gives: unknown; work: number }>,
};

// ================================================================= main
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : '';
const N = quick ? 40 : 120;
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };

function run(label: string) {
  seed = 12345;
  const t0 = Date.now();
  const rows = sweep(N, quick ? 30 : 60);
  const a = analyse(rows, label);
  say(a.md);
  seed = 777;
  const e = economy(quick ? 6 : 12, quick ? 25 : 50);
  say(`### ${label}: ammunition economy, days 1-23 (mean of seeds; sensible player)\n\n${e.md}\n`);
  say(`### ${label}: feel numbers\n\n${feel(rows)}\n`);
  const recipeCost = RECIPES.filter((r) => r.gives && Object.keys(r.gives).some((k) => AMMO_TYPES[k as Res])).map((r) => { const k = Object.keys(r.gives!)[0] as Res; return `${k} ${unitCost(k).toFixed(2)}`; });
  say(`Unit cost per round (scrap-eq; scrap 1, wood .5, cloth 1, fuel 2, parts 3): ${recipeCost.join(' · ')}\n`);
  console.error(`[${label}] ${((Date.now() - t0) / 1000).toFixed(1)}s, ${a.checks.filter((c) => c.pass).length}/${a.checks.length} checks pass`);
  return a;
}
if (args.includes('--cell')) {
  // debug: --cell <gun> [patch] — print every distance/style cell vs a Sleeper
  const g = args[args.indexOf('--cell') + 1];
  if (args.includes('patch')) applyPatch();
  const pr = profiles().find((x) => x.key === g)!;
  const zid = args.includes('--z') ? args[args.indexOf('--z') + 1] : 'sleeper';
  for (const d of DISTS) for (const st of ['spray', 'tap'] as Style[]) console.log(`${g} first kill ${zid} ${d} ${st}: ${firstKill(pr.p, pr.def, ZOMBIES[zid], d, st, 200).toFixed(2)}`);
  for (const d of DISTS) for (const st of ['spray', 'tap', 'guard'] as Style[]) {
    const c = duel(pr.p, pr.def, ZOMBIES[zid], d, 5, st, 300);
    console.log(`${g} ${d} ${st}: rpk ${c.rpk.toFixed(2)} ttk ${c.ttk.toFixed(2)} hs ${pct(c.hs)} burst ${c.burst.toFixed(2)}`);
  }
  process.exit(0);
}
if (only !== 'patch') run('BASE');
if (only !== 'base') { applyPatch(); say(`### Patch list\n\n${patchList()}\n`); run('PATCH'); }
if (mdOut) writeFileSync(mdOut, out.join('\n'));
