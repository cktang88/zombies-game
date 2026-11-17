// The gunfire & special-effects system for the night (docs/research/10-vfx.md).
//
//   const vfx = new Vfx(host)           host: the ground decal canvas, a light callback, weather
//   vfx.muzzle({...})                   flash, light, smoke, sparks, brass: once per round fired
//   vfx.shotStart(ox, oy, def, fx)      a hitscan shot begins: impacts reported until bullet() wait for the round
//   vfx.impact(surface, x, y, ang, {})  what the round does to what it hit (flesh, armour, wood, road, snow)
//   vfx.bullet({...})                   the round in flight (streak, tracer, pellet, arrow, nail, flare, rocket)
//   vfx.explosion(x, y, radius)         flash, fireball, shock ring, debris, sparks, smoke column, scorch
//   vfx.burn / burnBody / flame         fire pools, burning bodies, the flame projector
//   vfx.update(dt); vfx.drawNormal(c); vfx.drawAdd(c); vfx.drawWall(c)
//
// Visual randomness uses Math.random, never the game's seeded R: effects must not change the simulation.
import { sprites, GLOW, PUFF, type Sprites, type Cv, type GlowCol, type PuffCol } from './sprites';
import {
  Pool, SMOKE, DUST, MIST, BLOOD, CHUNK, SPLINTER, DEBRIS, CASING, ARROWSTUCK, SPARK, EMBER, FIRE, FLAME, GLOW as GLOWK, RING, SHOCK, STREAK,
  F_STAMP, F_WIND, F_SMOKEY, F_GLINT, F_GROUNDED, F_RISE, isAdditive,
} from './pool';
import { gunLook, type FlashSpec, type GunLook, type RoundKind } from './looks';
import type { FireProfile } from '../../data/weapons';

export type Surface = 'flesh' | 'head' | 'armor' | 'wood' | 'ground' | 'metal' | 'snow';
export type Quality = 'high' | 'medium' | 'low';

export interface VfxHost {
  /** persistent decal layer (blood, brass, scorch, chips); drawn under everything */
  ground: CanvasRenderingContext2D | null;
  /** a short-lived light that cuts the darkness ('r,g,b') */
  light(x: number, y: number, r: number, life: number, color: string): void;
  /** snow on the road (impacts throw powder) */
  snow?: () => boolean;
  /** Reduce gore */
  gore?: () => boolean;
  /** Screen flashes allowed (the scene wash) */
  flashes?: () => boolean;
}

const PUFF_KEYS = Object.keys(PUFF) as PuffCol[];
const GLOW_KEYS = Object.keys(GLOW) as GlowCol[];
const pc = (k: PuffCol) => PUFF_KEYS.indexOf(k);
const gc = (k: GlowCol) => GLOW_KEYS.indexOf(k);
const STREAK_KEYS = ['warm', 'tracer', 'pale', 'fire', 'flare', 'green'] as const;
type StreakKey = typeof STREAK_KEYS[number];
const sc = (k: StreakKey) => STREAK_KEYS.indexOf(k);
// solid colours for blood, chunks, debris, splinters
const SOLID = ['#3c0907', '#4e0f0b', '#2e0705', '#5a1a0c', '#240807', '#2c0a08', '#d8ccb4', '#1a1816', '#2c2a26', '#4a4640', '#6a5034', '#8a6a44', '#b08a58', '#e8eef2', '#2a1a14'];
const S_BLOOD = [0, 1, 2, 3], S_GORELESS = [4, 5], S_BONE = 6, S_DARK = [7, 8, 9], S_WOOD = [10, 11, 12], S_SNOW = 13, S_FLESH = 14;

const rnd = Math.random;
const rr = (a: number, b: number) => a + (b - a) * rnd();
const pick = <T>(a: readonly T[]): T => a[(rnd() * a.length) | 0];
const easeOut = (u: number) => 1 - (1 - u) * (1 - u) * (1 - u);
const HORIZON = 330, REF_Y = 664;
/** game-read exaggeration of the photographic flash sizes in looks.ts */
const FLASH_K = 1.5;
/** perspective scale for a ground y (render.ts depthScale) */
export const laneScale = (y: number) => Math.max(0.55, Math.min(1.2, (y - HORIZON) / (REF_Y - HORIZON)));

interface FlashInst { x: number; y: number; ang: number; spec: FlashSpec; s: number; age: number; seed: number; on: boolean; gy: number }
interface Round {
  on: boolean; kind: RoundKind; tracer: boolean; x0: number; y0: number; dx: number; dy: number; len: number; speed: number;
  t: number; width: number; end: 'ground' | 'body' | 'air'; gy: number; seed: number; fire: boolean; arrived: boolean; emit: number; s: number;
}
interface Pend { on: boolean; surf: Surface; x: number; y: number; ang: number; ground: number; power: number; pellet: boolean; t: number }
interface Burner { x: number; y: number; life: number; max: number; kind: 'flare'; emit: number; flick: number }
interface WallMark { x: number; y: number; v: number; rot: number }

export interface MuzzleOpts {
  x: number; y: number; ang: number;
  defId?: string; prof?: FireProfile; suppressed?: boolean;
  /** depth / body scale of the shooter */
  scale?: number;
  /** a guard further back: a little smaller */
  far?: boolean;
  /** ejection port and where the brass lands (y) */
  eject?: { x: number; y: number; ground: number; face: number };
  /** who fired (tracer counting, barrel heat) */
  key?: unknown;
  /** push the muzzle light (default true) */
  light?: boolean;
}
export interface BulletOpts {
  x0: number; y0: number; x1: number; y1: number;
  defId?: string; prof?: FireProfile; pellet?: boolean; suppressed?: boolean;
  /** what stopped it: the road (an impact is spawned when it lands), a body (impacts came via impact()), nothing */
  end: 'ground' | 'body' | 'air';
  /** the lane's feet y (depth) */
  laneY: number;
  key?: unknown;
}

export class Vfx {
  host: VfxHost;
  S: Sprites;
  P: Pool;
  quality: Quality = 'high';
  /** count multiplier from quality */
  qk = 1;
  /** soft-glow (bloom) fill multiplier from quality: these big additive quads are the fill-rate cost on a CPU rasteriser */
  gk = 1;
  t = 0;
  wind = 14;
  private flashes: FlashInst[] = [];
  private rounds: Round[] = [];
  private pend: Pend[] = [];
  private burners: Burner[] = [];
  private wallMarks: WallMark[] = [];
  private wallI = 0;
  private sched: { t: number; fn: () => void }[] = [];
  private counters = new Map<unknown, number>();
  private heat = new Map<unknown, { h: number; t: number; x: number; y: number }>();
  private shot: { x: number; y: number; speed: number } | null = null;
  private rocketsIn: { x: number; arrive: number }[] = [];
  private washA = 0; private washX = 0; private washY = 0; private washR = 600;
  private emitT = new Map<string, number>();
  /** fire pools burning this frame (their glow is drawn once per frame, then the list is cleared) */
  private pools: { x: number; y: number; w: number; k: number }[] = [];
  /** frame cost probe (ms): update + draw, for the perf report */
  cost = { update: 0, draw: 0 };

  constructor(host: VfxHost, quality: Quality = 'high') {
    this.host = host;
    this.S = sprites();
    this.P = new Pool(2000);
    for (let i = 0; i < 48; i++) this.flashes.push({ x: 0, y: 0, ang: 0, spec: null as unknown as FlashSpec, s: 1, age: 0, seed: 0, on: false, gy: 0 });
    for (let i = 0; i < 256; i++) this.rounds.push({ on: false, kind: 'bullet', tracer: false, x0: 0, y0: 0, dx: 1, dy: 0, len: 0, speed: 1, t: 0, width: 1, end: 'air', gy: 0, seed: 0, fire: false, arrived: false, emit: 0, s: 1 });
    for (let i = 0; i < 128; i++) this.pend.push({ on: false, surf: 'ground', x: 0, y: 0, ang: 0, ground: 0, power: 1, pellet: false, t: 0 });
    this.setQuality(quality);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.qk = q === 'high' ? 1 : q === 'medium' ? 0.6 : 0.32;
    this.gk = q === 'high' ? 1 : q === 'medium' ? 0.7 : 0;
    this.P.limit = q === 'high' ? 2000 : q === 'medium' ? 1100 : 450;
    if (this.P.n > this.P.limit) this.P.n = this.P.limit;
  }
  /** n scaled by quality, at least `min` */
  private q(n: number, min = 1) { return Math.max(min, Math.round(n * this.qk)); }
  private gore() { return this.host.gore?.() ?? false; }

  clear() {
    this.P.clear();
    for (const f of this.flashes) f.on = false;
    for (const r of this.rounds) r.on = false;
    for (const p of this.pend) p.on = false;
    this.burners.length = 0;
    this.sched.length = 0;
    this.wallMarks.length = 0;
  }

  // ------------------------------------------------------------------ firing
  muzzle(o: MuzzleOpts) {
    const look = gunLook(o.defId, o.prof, o.suppressed);
    const sp = look.flash;
    const s = (o.scale ?? 1) * (o.far ? 0.85 : 1);
    const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
    if (sp.life > 0.015) {
      const f = this.flashes.find((x) => !x.on) ?? this.flashes[(this.t * 997) % this.flashes.length | 0];
      f.on = true; f.x = o.x; f.y = o.y; f.ang = o.ang; f.spec = sp; f.s = s * FLASH_K * rr(0.9, 1.12); f.age = 0; f.seed = rnd(); f.gy = o.eject?.ground ?? o.y + 110 * s;
    }
    if (sp.light > 0 && o.light !== false) this.host.light(o.x + ca * 12, o.y + sa * 12, sp.light * (o.far ? 0.8 : 1), Math.max(0.05, sp.life), sp.lightCol);
    if (sp.wash > 0 && this.quality !== 'low' && (this.host.flashes?.() ?? true)) {
      this.washA = Math.max(this.washA, sp.wash * (o.far ? 0.5 : 1)); this.washX = o.x; this.washY = o.y; this.washR = 520 * this.gk;
    }
    const P = this.P;
    // smoke: a puff driven forward that brakes hard, then hangs and drifts with the wind
    const ns = this.q(sp.smoke * (o.far ? 0.6 : 1), sp.smoke > 0 ? 1 : 0);
    const pcol = pc(sp.smokeCol);
    const powder = sp.smokeCol === 'powder';
    for (let i = 0; i < ns; i++) {
      const k = i / Math.max(1, ns);
      const v = rr(60, 260) * (powder ? 1.6 : 1) * (1 - k * 0.5);
      const j = P.add(SMOKE, o.x + ca * rr(2, 14) * s, o.y + sa * rr(2, 14) * s, (powder ? rr(3.5, 6) : rr(1.1, 2.2)) * (sp.smoke > 6 ? 1.2 : 1));
      const sp2 = rr(-0.35, 0.35);
      P.vx[j] = Math.cos(o.ang + sp2) * v; P.vy[j] = Math.sin(o.ang + sp2) * v - rr(5, 25);
      P.drag[j] = powder ? 2.2 : 3.2; P.grav[j] = -rr(10, 22);
      P.s0[j] = sp.smokeSize * 0.45 * s; P.s1[j] = sp.smokeSize * rr(1.8, 2.8) * s * (powder ? 1.6 : 1);
      P.a0[j] = powder ? rr(0.55, 0.8) : rr(0.34, 0.52);
      P.col[j] = pcol; P.flags[j] = F_WIND; P.rot[j] = rr(0, 6.28); P.vr[j] = rr(-0.6, 0.6); P.delay[j] = k * 0.05;
    }
    // unburnt powder: sparks thrown down the bore line
    const nk = this.q(sp.sparks * (o.far ? 0.6 : 1), 0);
    for (let i = 0; i < nk; i++) {
      const a = o.ang + rr(-0.3, 0.3) * (sp.cone ? 2 : 1), v = rr(300, 900);
      const j = P.add(SPARK, o.x + ca * 6, o.y + sa * 6, rr(0.12, 0.35) * (sp.smokeCol === 'powder' ? 1.8 : 1));
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 2.5; P.grav[j] = 420; P.s0[j] = rr(0.8, 1.6);
      P.col[j] = sc(sp.tint === 1 ? 'flare' : 'fire');
    }
    // revolver cylinder gap / muzzleloader pan: a little jet straight up and down, back along the gun
    if (sp.gap) for (let i = 0; i < this.q(5, 2); i++) {
      const gx = o.x - ca * sp.gap * s, gy = o.y - sa * sp.gap * s;
      const a = o.ang + (rnd() < 0.5 ? -1 : 1) * Math.PI / 2 + rr(-0.4, 0.4), v = rr(120, 320);
      const j = P.add(SPARK, gx, gy, rr(0.08, 0.2));
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 4; P.grav[j] = 300; P.s0[j] = 1; P.col[j] = sc('warm');
    }
    // backblast: fire and a lot of dust out of the back of the tube
    if (sp.back) {
      for (let i = 0; i < this.q(14, 5); i++) {
        const a = o.ang + Math.PI + rr(-0.25, 0.25), v = rr(300, 900);
        const j = P.add(FIRE, o.x - ca * 30 * s, o.y - sa * 30 * s, rr(0.18, 0.35));
        P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 6; P.s0[j] = 8 * s; P.s1[j] = 26 * s; P.col[j] = 0; P.flags[j] = F_RISE;
      }
      for (let i = 0; i < this.q(12, 4); i++) {
        const a = o.ang + Math.PI + rr(-0.45, 0.45), v = rr(150, 520);
        const j = P.add(SMOKE, o.x - ca * 40 * s, o.y - sa * 40 * s, rr(1.8, 3.2));
        P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 2.6; P.grav[j] = -16; P.s0[j] = 10 * s; P.s1[j] = rr(40, 64) * s;
        P.a0[j] = rr(0.4, 0.6); P.col[j] = pc(i % 2 ? 'smoke' : 'dust'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6.28); P.vr[j] = rr(-0.5, 0.5);
      }
      this.host.light(o.x - ca * 60, o.y - sa * 60, 260, 0.12, '255,170,90');
    }
    // dragon's breath: a cone of burning magnesium
    if (sp.cone) for (let i = 0; i < this.q(sp.cone, 8); i++) {
      const a = o.ang + rr(-0.22, 0.22), v = rr(380, 980);
      const j = P.add(FIRE, o.x + ca * 8, o.y + sa * 8, rr(0.25, 0.55));
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 3.6; P.grav[j] = -40; P.s0[j] = rr(5, 9) * s; P.s1[j] = rr(18, 34) * s;
      P.col[j] = rnd() < 0.4 ? 0 : 1; P.flags[j] = F_RISE;
    }
    // brass: out of the port, spinning, two bounces on the boards, then it stays (a decal)
    if (look.casing && o.eject) {
      const e = o.eject;
      const j = P.add(CASING, e.x, e.y, 3);
      P.vx[j] = -e.face * rr(40, 120); P.vy[j] = -rr(150, 230); P.grav[j] = 900; P.gy[j] = e.ground; P.bounce[j] = 2;
      P.rot[j] = rr(0, 6.28); P.vr[j] = rr(18, 34) * (rnd() < 0.5 ? 1 : -1);
      P.s0[j] = look.casing === 'hull' ? 7 : look.round === 'bullet' && look.speed > 7000 ? 6 : 4.2;
      P.col[j] = ['brass', 'hull', 'link', 'steel'].indexOf(look.casing); P.flags[j] = F_STAMP | F_GLINT;
      if (look.casing === 'link' && rnd() < 0.8) {
        const k = P.add(CASING, e.x + 3, e.y + 2, 3);
        P.vx[k] = -e.face * rr(10, 60); P.vy[k] = -rr(40, 120); P.grav[k] = 900; P.gy[k] = e.ground; P.bounce[k] = 1;
        P.rot[k] = rr(0, 6.28); P.vr[k] = rr(-12, 12); P.s0[k] = 4; P.col[k] = 2; P.flags[k] = F_STAMP;
      }
    }
    // a barrel run hot: wisps keep curling off the muzzle for a while
    if (o.key !== undefined && (o.prof?.auto || look.round === 'pellet')) {
      const h = this.heat.get(o.key) ?? { h: 0, t: 0, x: 0, y: 0 };
      h.h = Math.min(30, h.h * Math.exp(-(this.t - h.t) * 0.25) + (look.round === 'pellet' ? 3 : 1)); h.t = this.t; h.x = o.x; h.y = o.y;
      this.heat.set(o.key, h);
    }
  }

  /** castShot begins: impacts reported before bullet() wait for the round to get there. */
  shotStart(ox: number, oy: number, defId: string | undefined, prof: FireProfile | undefined) {
    const look = gunLook(defId, prof);
    this.shot = look.round === 'none' || look.round === 'rocket' ? null : { x: ox, y: oy, speed: look.speed || 99999 };
  }

  bullet(o: BulletOpts) {
    const sh = this.shot;
    this.shot = null;
    const look = gunLook(o.defId, o.prof, o.suppressed);
    let kind = look.round;
    if (kind === 'none') { this.flushPend(sh, 0); return; }
    if (o.pellet && kind !== 'dragon') kind = 'pellet';
    const dx = o.x1 - o.x0, dy = o.y1 - o.y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) { this.flushPend(sh, 0); return; }
    const key = o.key ?? 'anon';
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    const r = this.rounds.find((x) => !x.on) ?? this.rounds[n % this.rounds.length];
    r.on = true; r.kind = kind; r.tracer = look.tracerEvery > 0 && n % look.tracerEvery === 0;
    r.x0 = o.x0; r.y0 = o.y0; r.dx = dx / len; r.dy = dy / len; r.len = len;
    r.speed = (look.speed || 4000) * (kind === 'pellet' ? rr(0.85, 1.1) : 1); r.t = 0; r.width = look.width; r.end = o.end; r.gy = o.laneY;
    r.seed = rnd(); r.fire = look.id === 'firebolt' || kind === 'dragon'; r.arrived = false; r.emit = 0; r.s = laneScale(o.laneY);
    // impacts that happened along this shot land when the round gets there
    this.flushPend(sh, r.speed);
    if (o.end === 'ground') this.queue(this.host.snow?.() ? 'snow' : 'ground', o.x1, o.y1, Math.atan2(dy, dx), o.laneY, o.pellet ? 0.6 : 1, !!o.pellet, Math.max(0, len - 18) / r.speed);
    if (kind === 'rocket') this.rocketsIn.push({ x: o.x1, arrive: this.t + len / r.speed });
  }

  private flushPend(sh: { x: number; y: number; speed: number } | null, speed: number) {
    for (const p of this.pend) {
      if (!p.on || p.t >= 0) continue;
      p.t = sh && speed > 0 ? this.t + Math.hypot(p.x - sh.x, p.y - sh.y) / speed : this.t;
    }
  }
  private queue(surf: Surface, x: number, y: number, ang: number, ground: number, power: number, pellet: boolean, delay: number) {
    const p = this.pend.find((q) => !q.on);
    if (!p) { this.doImpact(surf, x, y, ang, ground, power, pellet); return; }
    p.on = true; p.surf = surf; p.x = x; p.y = y; p.ang = ang; p.ground = ground; p.power = power; p.pellet = pellet; p.t = delay < 0 ? -1 : this.t + delay;
  }

  /**
   * A round hit something at (x, y), travelling along ang. ground: the lane's feet y (where droplets land).
   * During a shot (between shotStart and bullet) the effect waits for the round to arrive.
   */
  impact(surf: Surface, x: number, y: number, ang: number, o: { ground: number; power?: number; pellet?: boolean }) {
    const power = Math.max(0.3, Math.min(2.5, o.power ?? 1));
    if (Number.isNaN(ang)) ang = this.shot ? Math.atan2(y - this.shot.y, x - this.shot.x) : 0;
    if (this.shot) this.queue(surf, x, y, ang, o.ground, power, !!o.pellet, -1);
    else this.doImpact(surf, x, y, ang, o.ground, power, !!o.pellet);
  }

  private doImpact(surf: Surface, x: number, y: number, ang: number, ground: number, power: number, pellet: boolean) {
    const P = this.P;
    const s = laneScale(ground);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pk = pellet ? 0.55 : 1;
    if (surf === 'flesh' || surf === 'head') {
      const less = this.gore();
      const head = surf === 'head';
      const g = (head ? 1.6 : 1) * power * pk;
      // the mist: a dark burst at the hole, mostly blown out the far side
      for (let i = 0; i < this.q(head ? 3 : 2, 1); i++) {
        const j = P.add(MIST, x + ca * rr(-4, 18), y + sa * rr(-4, 18) + rr(-3, 3), rr(0.22, 0.42) * (head ? 1.3 : 1));
        P.vx[j] = ca * rr(30, 120) * g; P.vy[j] = sa * rr(30, 120) * g - rr(0, 20); P.drag[j] = 5; P.grav[j] = 30;
        P.s0[j] = 4 * s; P.s1[j] = rr(12, 22) * s * Math.sqrt(g) * (less ? 0.6 : 1); P.a0[j] = less ? 0.5 : 0.7;
        P.col[j] = pc(less ? 'mistDark' : 'mist'); P.rot[j] = rr(0, 6.28);
      }
      // exit spray (forward, fast) and a little back-spatter out of the entry
      const nd = this.q((head ? 14 : 7) * g * (less ? 0.35 : 1), 1);
      for (let i = 0; i < nd; i++) {
        const fwd = rnd() < 0.78;
        const a = (fwd ? ang : ang + Math.PI) + rr(-0.55, 0.55);
        const v = (fwd ? rr(120, 460) : rr(60, 180)) * Math.sqrt(g);
        const j = P.add(BLOOD, x, y, 1.6);
        P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v - rr(40, 160); P.grav[j] = 900; P.drag[j] = 0.6;
        P.gy[j] = ground + rr(-4, 4); P.s0[j] = rr(1.4, 3) * s * (less ? 0.7 : 1);
        P.col[j] = less ? pick(S_GORELESS) : pick(S_BLOOD); P.flags[j] = F_STAMP;
      }
      if (!less && (head || power > 1.4) && !pellet) {
        for (let i = 0; i < this.q(head ? 6 : 3, 1); i++) {
          const a = ang + rr(-0.6, 0.5), v = rr(120, 380);
          const j = P.add(CHUNK, x, y, 2);
          P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v - rr(80, 220); P.grav[j] = 900; P.gy[j] = ground + rr(-5, 5);
          P.s0[j] = rr(1.8, 3.6) * s; P.rot[j] = rr(0, 6); P.vr[j] = rr(-14, 14);
          P.col[j] = head && rnd() < 0.35 ? S_BONE : rnd() < 0.5 ? S_FLESH : 0; P.flags[j] = F_STAMP; P.bounce[j] = 1;
        }
      }
      return;
    }
    if (surf === 'armor' || surf === 'metal') {
      // steel: a white pop, sparks thrown back off the plate, sometimes a ricochet whining off
      const j0 = P.add(GLOWK, x, y, 0.07);
      P.s0[j0] = 22 * s; P.s1[j0] = 34 * s; P.col[j0] = gc('white');
      for (let i = 0; i < this.q(12 * pk, 3); i++) {
        const a = ang + Math.PI + rr(-1.1, 1.1), v = rr(200, 720);
        const j = P.add(SPARK, x, y, rr(0.15, 0.45));
        P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v - rr(0, 150); P.grav[j] = 700; P.drag[j] = 1.2; P.gy[j] = ground; P.bounce[j] = 1;
        P.s0[j] = rr(0.8, 1.5); P.col[j] = sc(rnd() < 0.5 ? 'warm' : 'fire');
      }
      if (!pellet && rnd() < 0.4) {
        const a = ang + Math.PI + rr(-0.9, 0.9) - 0.5;
        const j = P.add(STREAK, x, y, 0.12);
        P.vx[j] = Math.cos(a) * 2400; P.vy[j] = Math.sin(a) * 2400; P.s0[j] = 1.4; P.col[j] = sc('warm');
      }
      this.host.light(x, y, 60, 0.05, '255,220,160');
      return;
    }
    if (surf === 'wood') {
      for (let i = 0; i < this.q(8 * pk, 2); i++) {
        const a = ang + Math.PI + rr(-1, 1), v = rr(80, 320);
        const j = P.add(SPLINTER, x, y, rr(0.7, 1.4));
        P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v - rr(40, 140); P.grav[j] = 900; P.gy[j] = ground; P.bounce[j] = 1;
        P.s0[j] = rr(2.5, 5); P.rot[j] = rr(0, 6); P.vr[j] = rr(-20, 20); P.col[j] = pick(S_WOOD);
      }
      const j = P.add(DUST, x, y, rr(0.6, 1));
      P.vx[j] = -ca * 30; P.vy[j] = -10; P.drag[j] = 3; P.s0[j] = 4; P.s1[j] = 16; P.a0[j] = 0.45; P.col[j] = pc('dust'); P.flags[j] = F_WIND;
      this.wallMark(x, y);
      return;
    }
    // the road: a dust puff that lifts and drifts, chips, sometimes grit sparks, a chip mark left behind
    const snow = surf === 'snow';
    for (let i = 0; i < this.q(2 * pk + 1, 1); i++) {
      const j = P.add(DUST, x + rr(-3, 3), y - 2, rr(0.6, 1.1) * (snow ? 1.3 : 1));
      P.vx[j] = rr(-25, 25) + ca * 20; P.vy[j] = -rr(25, 70); P.drag[j] = 2.5; P.grav[j] = 15;
      P.s0[j] = 3 * s; P.s1[j] = rr(12, 20) * s * pk * (snow ? 1.4 : 1); P.a0[j] = snow ? 0.75 : 0.5; P.col[j] = pc(snow ? 'snow' : 'dust');
      P.flags[j] = F_WIND; P.rot[j] = rr(0, 6.28);
    }
    for (let i = 0; i < this.q(5 * pk, 1); i++) {
      const a = -Math.PI / 2 + rr(-0.9, 0.9) + ca * 0.3, v = rr(90, 300);
      const j = P.add(DEBRIS, x, y - 1, 1.2);
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.grav[j] = 900; P.gy[j] = y + rr(0, 3); P.bounce[j] = 1;
      P.s0[j] = rr(1, 2.2) * s; P.rot[j] = rr(0, 6); P.vr[j] = rr(-15, 15); P.col[j] = snow ? S_SNOW : pick(S_DARK);
    }
    if (!snow && !pellet && rnd() < 0.3) for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + rr(-0.8, 0.8), v = rr(150, 400);
      const j = P.add(SPARK, x, y, rr(0.08, 0.2));
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.grav[j] = 800; P.s0[j] = 0.9; P.col[j] = sc('warm');
    }
    const g = this.host.ground;
    if (g && !snow) {
      const im = pick(this.S.chip);
      g.globalAlpha = 0.6;
      g.drawImage(im, x - 3 * s, y - 1.2 * s, 6 * s, 2.4 * s);
      g.globalAlpha = 1;
    }
  }

  private wallMark(x: number, y: number) {
    const m = { x, y, v: (rnd() * 4) | 0, rot: rr(-0.3, 0.3) };
    if (this.wallMarks.length < 70) this.wallMarks.push(m);
    else this.wallMarks[this.wallI++ % 70] = m;
  }

  /** A headshot that takes the head: bone, gore and a spray (not under Reduce gore). */
  gib(x: number, y: number, ground: number, ang: number) {
    if (this.gore()) return;
    const sh = this.shot;
    if (Number.isNaN(ang)) ang = sh ? Math.atan2(y - sh.y, x - sh.x) : 0;
    if (sh) { this.after(Math.hypot(x - sh.x, y - sh.y) / sh.speed, () => { this.shot = null; this.gib(x, y, ground, ang); }); return; }
    this.doImpact('head', x, y, ang, ground, 2.2, false);
    const P = this.P;
    for (let i = 0; i < this.q(10, 3); i++) {
      const a = ang + rr(-1.2, 0.6), v = rr(150, 420);
      const j = P.add(CHUNK, x, y, 2.4);
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v - rr(120, 300); P.grav[j] = 900; P.gy[j] = ground + rr(-6, 6);
      P.s0[j] = rr(2, 4.5); P.rot[j] = rr(0, 6); P.vr[j] = rr(-16, 16); P.col[j] = rnd() < 0.3 ? S_BONE : pick([0, 1, S_FLESH]); P.flags[j] = F_STAMP; P.bounce[j] = 1;
    }
  }

  // ------------------------------------------------------------------ explosions & fire
  /** A blast on the road at (x, y) (feet y), radius in px of the game's blast. */
  explosion(x: number, y: number, radius: number) {
    // a rocket still in the air toward here: the bang waits for it
    for (let i = 0; i < this.rocketsIn.length; i++) {
      const r = this.rocketsIn[i];
      if (Math.abs(r.x - x) < 160 && r.arrive > this.t + 0.005) {
        this.rocketsIn.splice(i, 1);
        this.after(r.arrive - this.t, () => this.explosion(x, y, radius));
        return;
      }
    }
    const P = this.P;
    const sz = Math.max(0.6, Math.min(1.7, radius / 150)) * laneScale(y);
    const cy = y - 18 * sz;
    // (1) the instant: a white pop, a hot glow, a light that floods the road, the wash
    let j = P.add(GLOWK, x, cy, 0.09); P.s0[j] = 100 * sz; P.s1[j] = 130 * sz; P.col[j] = gc('white'); P.a0[j] = 0.9;
    j = P.add(GLOWK, x, cy, 0.4); P.s0[j] = 200 * sz * (0.5 + 0.5 * this.gk); P.s1[j] = 280 * sz * (0.5 + 0.5 * this.gk); P.col[j] = gc('orange'); P.a0[j] = 0.8;
    this.host.light(x, y - 40, 520 * sz, 0.5, '255,170,80');
    if (this.gk > 0 && (this.host.flashes?.() ?? true)) { this.washA = Math.max(this.washA, 0.22); this.washX = x; this.washY = cy; this.washR = 700 * this.gk; }
    // (2) the shock: a bright ring racing out along the road, and the air ring with its dark refraction band
    j = P.add(RING, x, y, 0.3); P.s0[j] = 20 * sz; P.s1[j] = 300 * sz; P.flags[j] = F_GROUNDED; P.a0[j] = 0.45;
    if (this.quality !== 'low') {
      j = P.add(SHOCK, x, cy, 0.2); P.s0[j] = 20 * sz; P.s1[j] = 230 * sz; P.a0[j] = 0.6;
      j = P.add(RING, x, cy, 0.16); P.s0[j] = 20 * sz; P.s1[j] = 220 * sz; P.a0[j] = 0.14;
    }
    // (3) the fireball: a white-hot core and lobes punched out, braked, rising, cooling through the ramp
    j = P.add(FIRE, x, cy, 0.42); P.s0[j] = 60 * sz; P.s1[j] = 96 * sz; P.vy[j] = -60; P.col[j] = 0; P.flags[j] = F_RISE;
    const nf = this.q(16 * sz + 6, 6);
    for (let i = 0; i < nf; i++) {
      const a = -Math.PI / 2 + rr(-1.5, 1.5), v = rr(180, 520) * sz;
      j = P.add(FIRE, x + Math.cos(a) * 10, cy + Math.sin(a) * 6, rr(0.35, 0.75));
      P.vx[j] = Math.cos(a) * v * 1.3; P.vy[j] = Math.sin(a) * v * 0.8; P.drag[j] = 5.5; P.grav[j] = -90;
      P.s0[j] = rr(18, 32) * sz; P.s1[j] = rr(40, 66) * sz; P.col[j] = rnd() < 0.5 ? 0 : 1; P.flags[j] = F_RISE; P.rot[j] = rr(0, 6.28);
    }
    this.after(0.07, () => {
      for (let i = 0; i < this.q(6, 3); i++) {
        const k = P.add(FIRE, x + rr(-30, 30) * sz, cy - rr(0, 30) * sz, rr(0.5, 0.8));
        P.vx[k] = rr(-60, 60); P.vy[k] = -rr(120, 260) * sz; P.drag[k] = 2.5; P.grav[k] = -60;
        P.s0[k] = 30 * sz; P.s1[k] = rr(50, 76) * sz; P.col[k] = 1; P.flags[k] = F_RISE; P.rot[k] = rr(0, 6.28);
      }
    });
    // (4) what it throws: sparks, burning embers, road debris trailing smoke
    for (let i = 0; i < this.q(30 * sz, 8); i++) {
      const a = -Math.PI / 2 + rr(-1.4, 1.4), v = rr(300, 1000) * sz;
      j = P.add(SPARK, x, cy, rr(0.25, 0.8));
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 1.4; P.grav[j] = 650; P.gy[j] = y + rr(-6, 8); P.bounce[j] = 1;
      P.s0[j] = rr(1, 2); P.col[j] = sc(rnd() < 0.5 ? 'fire' : 'warm');
    }
    for (let i = 0; i < this.q(14 * sz, 4); i++) {
      j = P.add(EMBER, x + rr(-40, 40) * sz, cy - rr(0, 40), rr(1.5, 3.5));
      P.vx[j] = rr(-160, 160); P.vy[j] = -rr(80, 300); P.drag[j] = 1.6; P.grav[j] = -20; P.s0[j] = rr(1.4, 2.6); P.flags[j] = F_WIND;
    }
    for (let i = 0; i < this.q(12 * sz, 4); i++) {
      const a = -Math.PI / 2 + rr(-1.2, 1.2), v = rr(260, 720) * sz;
      j = P.add(DEBRIS, x + rr(-10, 10), cy, 3);
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.grav[j] = 1000; P.gy[j] = y + rr(-10, 12); P.bounce[j] = 1;
      P.s0[j] = rr(2, 5) * sz; P.rot[j] = rr(0, 6); P.vr[j] = rr(-14, 14); P.col[j] = pick(S_DARK); P.flags[j] = i < 5 ? F_SMOKEY : 0;
    }
    // (5) a skirt of dust thrown along the road, then the smoke column that takes over as the fire dies
    for (let i = 0; i < this.q(12, 4); i++) {
      const dir = i % 2 ? 1 : -1;
      j = P.add(DUST, x + dir * rr(0, 30) * sz, y - rr(2, 10), rr(1.2, 2.2));
      P.vx[j] = dir * rr(150, 520) * sz; P.vy[j] = -rr(5, 30); P.drag[j] = 3.4; P.grav[j] = -6;
      P.s0[j] = 12 * sz; P.s1[j] = rr(38, 60) * sz; P.a0[j] = 0.55; P.col[j] = pc(this.host.snow?.() ? 'snow' : 'dust'); P.flags[j] = F_WIND | F_GROUNDED; P.rot[j] = rr(0, 6.28);
    }
    for (let i = 0; i < this.q(14 * sz, 5); i++) {
      j = P.add(SMOKE, x + rr(-40, 40) * sz, cy - rr(0, 40) * sz, rr(3, 5.5));
      P.vx[j] = rr(-60, 60); P.vy[j] = -rr(40, 130) * sz; P.drag[j] = 1.2; P.grav[j] = -26;
      P.s0[j] = 20 * sz; P.s1[j] = rr(70, 120) * sz; P.a0[j] = rr(0.55, 0.8); P.col[j] = pc(i % 3 ? 'dark' : 'smoke');
      P.flags[j] = F_WIND; P.rot[j] = rr(0, 6.28); P.vr[j] = rr(-0.4, 0.4); P.delay[j] = rr(0.1, 0.35);
    }
    // (6) the scorch appears as the fireball clears, not under the flash
    this.after(0.12, () => {
      const g = this.host.ground;
      if (!g) return;
      const w = radius * 0.9 * laneScale(y);
      g.globalAlpha = 0.85;
      g.drawImage(pick(this.S.scorch), x - w, y - w * 0.3 + 2, w * 2, w * 0.6);
      g.globalAlpha = 1;
    });
  }

  /** One frame of a fire pool (molotov, burning fuel) centred on (x, y) feet, w wide; strength 0..1. */
  burn(x: number, y: number, w: number, strength: number, dt: number) {
    const P = this.P;
    const k = Math.min(1, strength) * P.room * this.qk;
    const s = laneScale(y);
    if (this.pools.length < 16) this.pools.push({ x, y, w, k: Math.min(1, strength) });
    // licking tongues: tall ones in the middle, short ones at the edges
    const nt = dt * 38 * k * (w / 150);
    for (let n = Math.floor(nt) + (this.chance(nt % 1) ? 1 : 0); n > 0; n--) {
      const u = rr(-0.5, 0.5), mid = 1 - Math.abs(u) * 1.2;
      const j = P.add(FLAME, x + u * w, y + rr(-5, 8), rr(0.4, 0.8));
      P.vx[j] = rr(-10, 10) + this.wind * 0.2; P.vy[j] = -rr(30, 70); P.s0[j] = rr(18, 34) * s * (0.6 + 0.4 * strength) * (0.6 + 0.5 * mid); P.s1[j] = 3; P.asp[j] = rr(1.3, 2.3) * (0.7 + 0.5 * mid); P.col[j] = (rnd() * 6) | 0;
    }
    // the burning bed: low lumps of fire along the ground
    if (this.chance(dt * 30 * k * (w / 150))) {
      const j = P.add(FIRE, x + rr(-0.45, 0.45) * w, y - rr(4, 14) * s, rr(0.45, 0.8));
      P.vy[j] = -rr(30, 70); P.vx[j] = this.wind * 0.3; P.grav[j] = -30; P.s0[j] = rr(12, 18) * s; P.s1[j] = rr(22, 34) * s; P.col[j] = 1 + ((rnd() * 2) | 0); P.rot[j] = rr(0, 6.28);
    }
    if (this.chance(dt * 6 * k)) {
      const j = P.add(EMBER, x + rr(-0.4, 0.4) * w, y - rr(10, 50), rr(1.2, 2.6));
      P.vx[j] = rr(-30, 30); P.vy[j] = -rr(40, 120); P.drag[j] = 0.8; P.grav[j] = -10; P.s0[j] = rr(1.2, 2.2); P.flags[j] = F_WIND;
    }
    if (this.chance(dt * 7 * k)) {
      const j = P.add(SMOKE, x + rr(-0.3, 0.3) * w, y - 60 * s, rr(3, 5));
      P.vx[j] = rr(-10, 10); P.vy[j] = -rr(40, 70); P.drag[j] = 0.4; P.grav[j] = -8; P.s0[j] = 14 * s; P.s1[j] = rr(60, 90) * s;
      P.a0[j] = rr(0.45, 0.7); P.col[j] = pc('dark'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6.28); P.vr[j] = rr(-0.3, 0.3);
    }
    // fires gutter: a flickering light, not a steady lamp
    if (this.chance(dt * 9)) this.host.light(x + rr(-0.2, 0.2) * w, y - 30, rr(170, 250) * (0.5 + 0.5 * strength), 0.14, '255,140,60');
  }

  /** A burning body: tongues over its height, a smoke wisp. */
  burnBody(x: number, y: number, h: number, dt: number) {
    const P = this.P;
    const k = P.room * this.qk;
    const s = laneScale(y);
    if (this.chance(dt * 26 * k)) {
      const j = P.add(FLAME, x + rr(-0.18, 0.18) * h * 0.5, y - rr(0.05, 0.7) * h, rr(0.3, 0.6));
      P.vx[j] = rr(-10, 10); P.vy[j] = -rr(40, 80); P.s0[j] = rr(10, 18) * s; P.s1[j] = 2; P.asp[j] = rr(1.8, 2.4); P.col[j] = (rnd() * 6) | 0;
    }
    if (this.chance(dt * 4 * k)) {
      const j = P.add(SMOKE, x, y - h * 0.85, rr(1.6, 2.6));
      P.vx[j] = rr(-10, 10); P.vy[j] = -rr(30, 60); P.drag[j] = 0.5; P.grav[j] = -8; P.s0[j] = 8 * s; P.s1[j] = rr(30, 46) * s;
      P.a0[j] = 0.5; P.col[j] = pc('dark'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6.28);
    }
    if (this.chance(dt * 3 * k)) {
      const j = P.add(EMBER, x, y - rr(0.3, 0.9) * h, rr(0.8, 1.6));
      P.vx[j] = rr(-30, 30); P.vy[j] = -rr(40, 90); P.drag[j] = 1; P.s0[j] = 1.4; P.flags[j] = F_WIND;
    }
  }

  /** One frame of the flame projector: a stream of burning fuel from (x0, y0) toward (x1, y1). */
  flame(x0: number, y0: number, x1: number, y1: number, dt: number) {
    const P = this.P;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const a0 = Math.atan2(dy, dx);
    const n = Math.max(1, Math.round(dt * 110 * this.qk));
    for (let i = 0; i < n; i++) {
      const a = a0 + rr(-0.07, 0.07), v = len * rr(2.4, 3.2);
      const j = P.add(FIRE, x0 + rr(-2, 2), y0 + rr(-2, 2), rr(0.38, 0.55));
      P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.drag[j] = 3.2; P.grav[j] = -110;
      P.s0[j] = rr(4, 7); P.s1[j] = rr(30, 46); P.col[j] = rnd() < 0.3 ? 0 : 1; P.flags[j] = F_RISE; P.rot[j] = rr(0, 6.28); P.delay[j] = (i / n) * dt;
    }
    // the liquid core at the nozzle
    const j = P.add(GLOWK, x0 + Math.cos(a0) * 10, y0 + Math.sin(a0) * 10, 0.06);
    P.s0[j] = 40; P.s1[j] = 46; P.col[j] = gc('warm'); P.a0[j] = 0.8;
    if (this.chance(dt * 10)) this.host.light(x0 + dx * 0.5, y0 + dy * 0.5, 280, 0.16, '255,150,60');
    if (this.chance(dt * 14 * this.qk)) {
      const k = P.add(SMOKE, x0 + dx * rr(0.5, 0.9), y0 + dy * rr(0.5, 0.9) - 30, rr(2, 3.4));
      P.vx[k] = rr(20, 80); P.vy[k] = -rr(40, 80); P.drag[k] = 0.6; P.grav[k] = -12; P.s0[k] = 14; P.s1[k] = rr(56, 80);
      P.a0[k] = 0.6; P.col[k] = pc('dark'); P.flags[k] = F_WIND; P.rot[k] = rr(0, 6.28);
    }
  }

  /** Something thrown in an arc (the firebomb): a bottle with a burning rag. */
  throwArc(x0: number, y0: number, x1: number, y1: number, dur: number) {
    const r = this.rounds.find((x) => !x.on);
    if (!r) return;
    const len = Math.hypot(x1 - x0, y1 - y0);
    r.on = true; r.kind = 'none'; r.tracer = false; r.x0 = x0; r.y0 = y0; r.dx = (x1 - x0) / len; r.dy = (y1 - y0) / len; r.len = len;
    r.speed = len / dur; r.t = 0; r.width = 1; r.end = 'air'; r.gy = y1; r.seed = rnd(); r.fire = true; r.arrived = false; r.emit = 0; r.s = 1;
  }

  /** A burning flare lying on the road for `time` s. */
  flareDown(x: number, y: number, time: number) {
    this.burners.push({ x, y, life: time, max: time, kind: 'flare', emit: 0, flick: 0 });
  }

  /** The grenade / bomb in flight (battle draws the lob path; this draws the round and leaves its trail). */
  drawLob(c: CanvasRenderingContext2D, x: number, y: number, k: number, pipe: boolean) {
    const im = pipe ? this.S.pipebomb : this.S.grenade;
    const m = c.getTransform();
    rot(c, m, im, x, y, 14, 10, k * 18, 0.5, 0.5, 1);
    c.setTransform(m);
    // the trail: a thin smoke thread (pipe bombs: a spitting fuse)
    const key = `lob${(x / 40) | 0}`;
    const last = this.emitT.get(key) ?? 0;
    if (this.t - last > 0.025) {
      this.emitT.set(key, this.t);
      if (this.emitT.size > 64) this.emitT.clear();
      const P = this.P;
      const j = P.add(SMOKE, x, y, rr(0.6, 1.1));
      P.vy[j] = -10; P.s0[j] = 3; P.s1[j] = rr(10, 16); P.a0[j] = 0.35; P.col[j] = pc('smoke'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6);
      if (pipe) {
        const s2 = P.add(SPARK, x - 6, y - 3, rr(0.1, 0.25));
        P.vx[s2] = rr(-120, 40); P.vy[s2] = rr(-160, -40); P.grav[s2] = 500; P.s0[s2] = 1; P.col[s2] = sc('warm');
      }
    }
  }

  // ------------------------------------------------------------------ simulation
  private chance(p: number) { return rnd() < p; }
  private after(sec: number, fn: () => void) { this.sched.push({ t: this.t + sec, fn }); }

  update(dt: number) {
    const t0 = performance.now();
    this.t += dt;
    this.wind = 16 + 10 * Math.sin(this.t * 0.31) + 5 * Math.sin(this.t * 1.7);
    this.washA = Math.max(0, this.washA - dt * 5);
    for (const f of this.flashes) if (f.on && (f.age += dt) >= f.spec.life) f.on = false;
    if (this.sched.length) {
      for (let i = this.sched.length - 1; i >= 0; i--) if (this.sched[i].t <= this.t) { const s = this.sched[i]; this.sched.splice(i, 1); s.fn(); }
    }
    for (const p of this.pend) if (p.on && p.t >= 0 && p.t <= this.t) { p.on = false; this.doImpact(p.surf, p.x, p.y, p.ang, p.ground, p.power, p.pellet); }
    if (this.rocketsIn.length) this.rocketsIn = this.rocketsIn.filter((r) => r.arrive > this.t - 0.5);
    this.updateRounds(dt);
    this.updateBurners(dt);
    // hot barrels curl a wisp now and then
    if (this.heat.size) for (const [k, h] of this.heat) {
      const cur = h.h * Math.exp(-(this.t - h.t) * 0.25);
      if (cur < 0.5) { this.heat.delete(k); continue; }
      if (cur > 6 && this.chance(dt * (cur - 5) * 0.8 * this.qk)) {
        const j = this.P.add(SMOKE, h.x, h.y, rr(1.2, 2));
        this.P.vy[j] = -rr(20, 40); this.P.vx[j] = rr(-5, 10); this.P.grav[j] = -10; this.P.s0[j] = 2; this.P.s1[j] = rr(10, 18);
        this.P.a0[j] = 0.22; this.P.col[j] = pc('steam'); this.P.flags[j] = F_WIND; this.P.rot[j] = rr(0, 6);
      }
    }
    this.updatePool(dt);
    this.cost.update = performance.now() - t0;
  }

  private updateRounds(dt: number) {
    const P = this.P;
    for (const r of this.rounds) {
      if (!r.on) continue;
      r.t += dt;
      const d = r.speed * r.t + 18;
      if (!r.arrived && d >= r.len) {
        r.arrived = true;
        const x = r.x0 + r.dx * r.len, y = r.y0 + r.dy * r.len;
        if ((r.kind === 'arrow' || r.kind === 'bolt') && r.end === 'ground') {
          const j = P.add(ARROWSTUCK, x, y, 8);
          P.rot[j] = Math.atan2(r.dy, r.dx) + rr(-0.15, 0.15); P.col[j] = r.kind === 'bolt' ? 1 : 0; P.s0[j] = r.s;
        }
        if (r.kind === 'nail' || r.kind === 'rivet') { /* the chip and dust come from the ground impact */ }
        if (r.kind === 'flare') this.flareDown(x, Math.max(y, r.gy - 2), 9);
        if (r.kind === 'none' && r.fire) { /* the firebomb: the battle lights the pool itself */ }
      }
      // trails
      if (!r.arrived && (r.kind === 'flare' || r.kind === 'rocket' || r.fire)) {
        r.emit += dt;
        const step = (r.kind === 'rocket' ? 0.005 : r.kind === 'flare' ? 0.01 : 0.016) / Math.max(0.4, this.qk);
        while (r.emit > step) {
          r.emit -= step;
          // spread the sub-steps back along the path, so the trail is a ribbon, not beads
          const [hx, hy] = this.roundPos(r, Math.max(0, Math.min(d - r.emit * r.speed, r.len)));
          if (r.kind === 'rocket') {
            const j = P.add(SMOKE, hx - r.dx * 14, hy - r.dy * 14, rr(1.6, 2.8));
            P.vx[j] = -r.dx * 40 + rr(-10, 10); P.vy[j] = -r.dy * 40 + rr(-14, 4); P.drag[j] = 1.5; P.grav[j] = -8;
            P.s0[j] = 11; P.s1[j] = rr(26, 40); P.a0[j] = 0.4; P.col[j] = pc('steam'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6);
            if (this.chance(0.3)) {
              const k = P.add(FIRE, hx - r.dx * 12, hy - r.dy * 12, 0.06);
              P.vx[k] = -r.dx * 300; P.vy[k] = -r.dy * 300; P.s0[k] = 5; P.s1[k] = 9; P.col[k] = 0;
            }
          } else if (r.kind === 'flare') {
            const j = P.add(SMOKE, hx, hy, rr(1.2, 2));
            P.vy[j] = -10; P.s0[j] = 4; P.s1[j] = rr(12, 18); P.a0[j] = 0.35; P.col[j] = pc('flare'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6);
            const k = P.add(SPARK, hx, hy, rr(0.1, 0.3));
            P.vx[k] = rr(-80, 80); P.vy[k] = rr(-60, 80); P.grav[k] = 400; P.s0[k] = 1; P.col[k] = sc('flare');
          } else {
            const k = P.add(EMBER, hx, hy, rr(0.25, 0.6));
            P.vx[k] = -r.dx * rr(20, 80) + rr(-20, 20); P.vy[k] = -r.dy * 40 + rr(-30, 10); P.grav[k] = 120; P.s0[k] = rr(1, 1.8);
            if (r.kind === 'none' && this.chance(0.5)) {
              const f = P.add(FIRE, hx, hy, 0.18); P.s0[f] = 5; P.s1[f] = 10; P.col[f] = 1; P.vy[f] = -40;
            }
          }
        }
        if (r.kind === 'rocket' || r.kind === 'flare') {
          const [hx, hy] = this.roundPos(r, Math.min(d, r.len));
          if (this.chance(dt * 30)) this.host.light(hx, hy, r.kind === 'rocket' ? 160 : 200, 0.06, r.kind === 'rocket' ? '255,180,100' : '255,80,70');
        }
      }
      // done: the round (and its afterglow) has gone
      const after = r.tracer ? 0.07 : 0.03;
      if (r.arrived && r.t > r.len / r.speed + after) r.on = false;
      if (r.t > 3) r.on = false;
    }
  }

  /** Where the round's head is at distance d along its path (flares and bottles arc). */
  private roundPos(r: Round, d: number): [number, number] {
    let x = r.x0 + r.dx * d, y = r.y0 + r.dy * d;
    if (r.kind === 'flare' || (r.kind === 'none' && r.fire)) {
      const u = Math.min(1, d / r.len);
      y -= Math.sin(u * Math.PI) * Math.min(160, r.len * 0.18);
    }
    return [x, y];
  }

  private updateBurners(dt: number) {
    const P = this.P;
    for (let i = this.burners.length - 1; i >= 0; i--) {
      const b = this.burners[i];
      b.life -= dt;
      if (b.life <= 0) { this.burners.splice(i, 1); continue; }
      const k = Math.min(1, b.life / 1.5) * this.qk * P.room;
      if (this.chance(dt * 24 * k)) {
        const j = P.add(SPARK, b.x, b.y - 3, rr(0.15, 0.4));
        const a = -Math.PI / 2 + rr(-0.9, 0.9), v = rr(60, 200);
        P.vx[j] = Math.cos(a) * v; P.vy[j] = Math.sin(a) * v; P.grav[j] = 300; P.s0[j] = 1; P.col[j] = sc('flare');
      }
      if (this.chance(dt * 6 * k)) {
        const j = P.add(SMOKE, b.x, b.y - 6, rr(2.4, 4));
        P.vx[j] = rr(-5, 5); P.vy[j] = -rr(20, 40); P.drag[j] = 0.5; P.grav[j] = -6; P.s0[j] = 5; P.s1[j] = rr(34, 56);
        P.a0[j] = 0.4; P.col[j] = pc('flare'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6);
      }
    }
  }

  private updatePool(dt: number) {
    const P = this.P;
    const g = this.host.ground;
    const wind = this.wind;
    for (let i = P.n - 1; i >= 0; i--) {
      if (P.delay[i] > 0) { P.delay[i] -= dt; if (P.delay[i] > 0) continue; }
      P.age[i] += dt;
      const k = P.kind[i];
      if (P.age[i] >= P.life[i]) {
        // fire leaves smoke behind as it cools
        if ((P.flags[i] & F_RISE) && rnd() < 0.55 * this.qk) {
          const x = P.x[i], y = P.y[i], s = P.s1[i];
          P.kill(i);
          const j = P.add(SMOKE, x, y, rr(1.4, 2.8));
          P.vy[j] = -rr(20, 50); P.vx[j] = rr(-10, 10); P.drag[j] = 0.8; P.grav[j] = -18; P.s0[j] = s * 0.5; P.s1[j] = s * rr(1.3, 1.9);
          P.a0[j] = 0.5; P.col[j] = pc('dark'); P.flags[j] = F_WIND; P.rot[j] = rr(0, 6);
          continue;
        }
        P.kill(i);
        continue;
      }
      if (k === RING || k === SHOCK || k === GLOWK || k === ARROWSTUCK) continue;
      const fl = P.flags[i];
      const dr = P.drag[i] > 0 ? Math.exp(-P.drag[i] * dt) : 1;
      P.vx[i] *= dr; P.vy[i] *= dr;
      P.vy[i] += P.grav[i] * dt;
      if (fl & F_WIND) P.vx[i] += (wind - P.vx[i]) * Math.min(1, dt * 0.6);
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
      P.rot[i] += P.vr[i] * dt;
      if ((fl & F_SMOKEY) && this.chance(dt * 30)) {
        const j = P.add(SMOKE, P.x[i], P.y[i], rr(0.5, 0.9));
        P.s0[j] = 2; P.s1[j] = rr(8, 14); P.a0[j] = 0.4; P.col[j] = pc('dark'); P.flags[j] = F_WIND; P.vy[j] = -10;
      }
      // landing on the lane's ground row: bounce, or settle and become a decal
      const gy = P.gy[i];
      if (gy > 0 && P.vy[i] > 0 && P.y[i] >= gy) {
        P.y[i] = gy;
        if (P.bounce[i] > 0) {
          P.bounce[i]--;
          P.vy[i] *= -rr(0.25, 0.4); P.vx[i] *= 0.55; P.vr[i] *= 0.5;
          if (k === CASING && (fl & F_GLINT)) P.flags[i] |= 64; // tink
          continue;
        }
        if ((fl & F_STAMP) && g) this.stamp(g, i);
        if (k === SPARK || k === DEBRIS || k === SPLINTER) { P.vx[i] = 0; P.vy[i] = 0; P.grav[i] = 0; P.gy[i] = 0; P.life[i] = Math.min(P.life[i], P.age[i] + (k === SPARK ? 0.05 : 0.6)); continue; }
        P.kill(i);
      }
    }
  }

  private stamp(g: CanvasRenderingContext2D, i: number) {
    const P = this.P;
    const k = P.kind[i];
    const x = P.x[i], y = P.y[i];
    if (k === BLOOD || k === CHUNK) {
      const less = this.gore();
      const s = P.s0[i] * (k === CHUNK ? 2.2 : 3.2) * (1 + Math.min(1.5, Math.abs(P.vx[i]) / 300));
      g.globalAlpha = less ? 0.5 : 0.8;
      g.drawImage(less ? pick(this.S.splatDark) : pick(this.S.splat), x - s, y - s * 0.32, s * 2, s * 0.64);
      if (k === CHUNK) { g.fillStyle = SOLID[P.col[i]]; g.globalAlpha = 0.9; g.fillRect(x - P.s0[i] / 2, y - P.s0[i] * 0.3, P.s0[i], P.s0[i] * 0.6); }
      g.globalAlpha = 1;
    } else if (k === CASING) {
      const im = this.casingImg(P.col[i]);
      const w = P.s0[i];
      g.save();
      g.translate(x, y);
      g.rotate(Math.round(P.rot[i] / 0.5) * 0.12);
      g.globalAlpha = 0.9;
      g.drawImage(im, -w / 2, -w * 0.21, w, w * 0.42);
      g.restore();
    }
  }
  private casingImg(i: number): Cv { const c = this.S.casing; return i === 1 ? c.hull : i === 2 ? c.link : i === 3 ? c.steel : c.brass; }

  // ------------------------------------------------------------------ drawing
  /** Bullet holes on the barricade (draw just after the wall). */
  drawWall(c: CanvasRenderingContext2D) {
    for (const m of this.wallMarks) c.drawImage(this.S.hole[m.v], m.x - 5, m.y - 5, 10, 10);
  }

  /** Normal-blend effects: smoke, dust, blood, debris, brass, arrows, rockets. Draw after the actors. */
  drawNormal(c: CanvasRenderingContext2D) {
    const t0 = performance.now();
    const P = this.P, S = this.S;
    const m = c.getTransform();
    this.drawSmoke(c, m);
    let fill = '';
    for (let i = 0; i < P.n; i++) {
      const k = P.kind[i];
      if (isAdditive(k) && k !== SHOCK) continue;
      if (P.delay[i] > 0) continue;
      const u = P.age[i] / P.life[i];
      const x = P.x[i], y = P.y[i];
      if (k === SMOKE || k === DUST || k === MIST) {
        continue; // drawn into the half-resolution smoke layer (drawSmoke)
      } else if (k === BLOOD) {
        // a droplet stretched along its velocity
        const s = P.s0[i];
        const sp = Math.hypot(P.vx[i], P.vy[i]);
        const L = Math.min(s * 5, s * 1.4 + sp * 0.01);
        rot(c, m, P.col[i] >= 4 ? S.dropDark : S.drop, x, y, L * 1.6, s * 1.3, Math.atan2(P.vy[i], P.vx[i]), 0.75, 0.5, Math.min(1, (1 - u) * 4));
      } else if (k === CHUNK) {
        const s = P.s0[i] * 1.6;
        rot(c, m, P.col[i] === S_BONE ? S.bone[(P.seed[i] * 2) | 0] : S.gib[(P.seed[i] * 3) | 0], x, y, s, s, P.rot[i], 0.5, 0.5, Math.min(1, (1 - u) * 5));
      } else if (k === DEBRIS || k === SPLINTER) {
        const col = SOLID[P.col[i]];
        if (col !== fill) { c.setTransform(m); c.fillStyle = fill = col; }
        c.globalAlpha = Math.min(1, (1 - u) * 5);
        const s = P.s0[i];
        if (k === SPLINTER) rotRect(c, m, x, y, s * 2.4, Math.max(0.8, s * 0.35), P.rot[i]);
        else rotRect(c, m, x, y, s * 1.3, s, P.rot[i]);
      } else if (k === CASING) {
        const w = P.s0[i];
        rot(c, m, this.casingImg(P.col[i]), x, y, w, w * 0.42, P.rot[i], 0.5, 0.5, 1);
      } else if (k === ARROWSTUCK) {
        const im = P.col[i] ? S.bolt : S.arrow;
        const L = (P.col[i] ? 38 : 50) * P.s0[i];
        // buried a third of its length in the road
        rot(c, m, im, x, y, L, L * (16 / im.width), P.rot[i], 0.72, 0.5, Math.min(1, (1 - u) * 6));
      } else if (k === SHOCK) {
        const s = P.s0[i] + (P.s1[i] - P.s0[i]) * easeOut(u);
        rot(c, m, S.shock, x, y, s * 2, s * 2, 0, 0.5, 0.5, (1 - u) * P.a0[i]);
      }
    }
    c.globalAlpha = 1;
    c.setTransform(m);
    // solid rounds: arrows, bolts, nails, rockets, bottles
    for (const r of this.rounds) {
      if (!r.on || r.arrived) continue;
      const d = Math.min(r.len, r.speed * r.t + 18);
      const [hx, hy] = this.roundPos(r, d);
      let ang = Math.atan2(r.dy, r.dx);
      if (r.kind === 'arrow' || r.kind === 'bolt') {
        const im = r.kind === 'bolt' ? S.bolt : S.arrow;
        const L = (r.kind === 'bolt' ? 38 : 50) * r.s;
        rot(c, m, im, hx, hy, L, L * (16 / im.width), ang, 1, 0.5, 1);
      } else if (r.kind === 'nail' || r.kind === 'rivet') {
        rot(c, m, r.kind === 'rivet' ? S.rivet : S.nail, hx, hy, 10 * r.s, 3 * r.s, ang, 1, 0.5, 1);
      } else if (r.kind === 'rocket') {
        rot(c, m, S.rocket, hx, hy, 30 * r.s, 7.5 * r.s, ang, 1, 0.5, 1);
      } else if (r.kind === 'none' && r.fire) {
        const u = d / r.len;
        ang = r.t * 14;
        rot(c, m, S.bottle, hx, hy, 15, 7, ang, 0.5, 0.5, 1);
        void u;
      }
    }
    c.setTransform(m);
    this.cost.draw = performance.now() - t0;
  }

  /**
   * Smoke, dust and blood mist are big, soft and many: on a CPU rasteriser their fill is most of the cost of the
   * whole system. They go into a half-resolution layer (only the dirty rectangle is cleared and blitted), which is
   * then stretched over the scene in one drawImage (after siege-game's half-resolution smoke field).
   */
  private smokeCv: HTMLCanvasElement | null = null;
  private smokeCx: CanvasRenderingContext2D | null = null;
  private drawSmoke(c: CanvasRenderingContext2D, m: DOMMatrix) {
    const P = this.P, S = this.S;
    const W = c.canvas.width, H = c.canvas.height;
    const K = this.quality === 'high' ? 0.5 : 0.4;
    if (!this.smokeCv || this.smokeCv.width !== Math.ceil(W * K)) {
      this.smokeCv = document.createElement('canvas');
      this.smokeCv.width = Math.ceil(W * K); this.smokeCv.height = Math.ceil(H * K);
      this.smokeCx = this.smokeCv.getContext('2d')!;
    }
    const g = this.smokeCx!;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    let any = false;
    for (let i = 0; i < P.n; i++) {
      const k = P.kind[i];
      if ((k !== SMOKE && k !== DUST && k !== MIST) || P.delay[i] > 0) continue;
      const u = P.age[i] / P.life[i];
      const s = P.s0[i] + (P.s1[i] - P.s0[i]) * easeOut(u);
      const fadeIn = Math.min(1, P.age[i] / 0.06);
      const a = P.a0[i] * fadeIn * Math.pow(1 - u, k === MIST ? 1.6 : 1.2);
      if (a < 0.01 || s < 0.6) continue;
      if (!any) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(this.dirty[0], this.dirty[1], this.dirty[2], this.dirty[3]); any = true; }
      // screen space (the caller's transform is a translate / uniform scale: shake, the day run's camera)
      const x = m.a * P.x[i] + m.e, y = m.d * P.y[i] + m.f;
      const s2 = s * m.a;
      const r = s2 * 1.42;
      if (x - r < x0) x0 = x - r; if (y - r < y0) y0 = y - r; if (x + r > x1) x1 = x + r; if (y + r > y1) y1 = y + r;
      const im = S.puff[PUFF_KEYS[P.col[i]]][(P.seed[i] * 4) | 0];
      const sy = P.flags[i] & F_GROUNDED ? 0.55 : 1;
      // unrotated (an axis-aligned scaled blit is the fast path); the four variants and the drift hide it
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(im, (x - s2) * K, (y - s2 * sy) * K, s2 * 2 * K, s2 * 2 * sy * K);
    }
    if (!any) {
      if (this.dirty[2] > 0) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(this.dirty[0], this.dirty[1], this.dirty[2], this.dirty[3]); this.dirty[2] = 0; }
      return;
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // the layer's dirty rect (layer px), clamped; clear it next frame, blit it now
    const lx = Math.max(0, Math.floor(x0 * K) - 1), ly = Math.max(0, Math.floor(y0 * K) - 1);
    const lw = Math.min(this.smokeCv!.width, Math.ceil(x1 * K) + 1) - lx, lh = Math.min(this.smokeCv!.height, Math.ceil(y1 * K) + 1) - ly;
    this.dirty = [lx, ly, Math.max(0, lw), Math.max(0, lh)];
    if (lw <= 0 || lh <= 0) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.drawImage(this.smokeCv!, lx, ly, lw, lh, lx / K, ly / K, lw / K, lh / K);
    c.setTransform(m);
  }
  private dirty: [number, number, number, number] = [0, 0, 0, 0];

  /** Additive light: flashes, tracers, sparks, fire, glows. Draw after the darkness, before the vignette. */
  drawAdd(c: CanvasRenderingContext2D) {
    const t0 = performance.now();
    const P = this.P, S = this.S;
    const m = c.getTransform();
    const prev = c.globalCompositeOperation;
    c.globalCompositeOperation = 'lighter';
    // the scene wash: one frame of warm light over everything near a big gun or a blast
    if (this.washA > 0.004) {
      const R0 = this.washR;
      rot(c, m, S.glow.warm, this.washX, this.washY, R0 * 2, R0 * 1.4, 0, 0.5, 0.5, Math.min(0.5, this.washA));
    }
    // the glow of each fire pool: a hot smear on the road and a soft column of light over it
    for (const p of this.pools) {
      const fl = 0.85 + 0.15 * Math.sin(this.t * 19 + p.x) * Math.sin(this.t * 7.7);
      rot(c, m, S.glow.orange, p.x, p.y, p.w * 2.2, p.w * 0.5, 0, 0.5, 0.5, 0.55 * p.k * fl);
      if (this.gk > 0) rot(c, m, S.glow.ember, p.x, p.y - p.w * 0.35, p.w * 2 * this.gk, p.w * 1.6 * this.gk, 0, 0.5, 0.5, 0.22 * p.k * fl);
    }
    this.pools.length = 0;
    // burning flares on the road
    for (const b of this.burners) {
      const fl = 0.75 + 0.25 * Math.sin(this.t * 31 + b.x) * Math.sin(this.t * 17.3);
      const a = Math.min(1, b.life / 1.2) * fl;
      rot(c, m, S.glow.flare, b.x, b.y - 4, 90, 70, 0, 0.5, 0.5, a * 0.8);
      rot(c, m, S.glow.white, b.x, b.y - 3, 14, 12, 0, 0.5, 0.5, a);
    }
    for (let i = 0; i < P.n; i++) {
      const k = P.kind[i];
      if (!isAdditive(k) || k === SHOCK) continue;
      if (P.delay[i] > 0) continue;
      const u = P.age[i] / P.life[i];
      const x = P.x[i], y = P.y[i];
      if (k === SPARK || k === STREAK) {
        const sp = Math.hypot(P.vx[i], P.vy[i]);
        const L = Math.min(k === STREAK ? 140 : 40, 3 + sp * (k === STREAK ? 0.04 : 0.028));
        const w = P.s0[i] * 3;
        const im = S.streak[STREAK_KEYS[P.col[i]]];
        rot(c, m, im, x, y, L, w, Math.atan2(P.vy[i], P.vx[i]), 1, 0.5, Math.min(1, (1 - u) * 2.5));
      } else if (k === EMBER) {
        const tw = 0.6 + 0.4 * Math.sin(this.t * 23 + P.seed[i] * 60);
        const s = P.s0[i] * (1 - u * 0.5);
        rot(c, m, S.glow.ember, x, y, s * 7, s * 7, 0, 0.5, 0.5, (1 - u) * tw * 0.8);
        rot(c, m, S.glow.pale, x, y, s * 2, s * 2, 0, 0.5, 0.5, (1 - u) * tw);
      } else if (k === FIRE) {
        const s = P.s0[i] + (P.s1[i] - P.s0[i]) * easeOut(u);
        const stage = Math.min(3, ((u * 3.6) | 0) + P.col[i]);
        const im = S.fire[stage][(P.seed[i] * 4) | 0];
        const a = (u < 0.1 ? 1 : 1 - (u - 0.1) / 0.9) * 0.95;
        rot(c, m, im, x, y, s * 2, s * 2, this.gk === 1 ? P.rot[i] : 0, 0.5, 0.5, a);
        if (u < 0.35 && this.gk === 1) rot(c, m, S.glow.orange, x, y, s * 3.4, s * 3.4, 0, 0.5, 0.5, (0.35 - u) * 0.9);
      } else if (k === FLAME) {
        const s = P.s0[i] * (1 - u * 0.6);
        const h = s * P.asp[i];
        const a = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const sway = Math.sin(this.t * 7 + P.seed[i] * 20) * 0.12;
        rot(c, m, S.flame[P.col[i] % 6], x, y, (P.seed[i] > 0.5 ? 1.45 : -1.45) * s, h, sway, 0.5, 1, a);
        if (P.seed[i] < 0.4 * this.gk) rot(c, m, S.glow.orange, x, y - h * 0.4, s * 3, h * 1.4, 0, 0.5, 0.5, a * 0.35);
      } else if (k === GLOWK) {
        const s = P.s0[i] + (P.s1[i] - P.s0[i]) * u;
        rot(c, m, S.glow[GLOW_KEYS[P.col[i]]], x, y, s * 2, s * 2, 0, 0.5, 0.5, P.a0[i] * (1 - u) * (1 - u));
      } else if (k === RING) {
        const s = P.s0[i] + (P.s1[i] - P.s0[i]) * easeOut(u);
        const sy = P.flags[i] & F_GROUNDED ? 0.28 : 1;
        rot(c, m, S.ring, x, y, s * 2, s * 2 * sy, 0, 0.5, 0.5, P.a0[i] * (1 - u));
      }
    }
    // casings catch the light as they spin
    if (this.quality !== 'low') for (let i = 0; i < P.n; i++) {
      if (P.kind[i] !== CASING || !(P.flags[i] & F_GLINT) || P.age[i] > 0.8) continue;
      const ph = Math.sin(P.rot[i] * 2);
      if (ph > 0.85) rot(c, m, S.glow.pale, P.x[i], P.y[i], 9, 9, 0, 0.5, 0.5, (ph - 0.85) * 5);
    }
    this.drawRounds(c, m);
    this.drawFlashes(c, m);
    c.setTransform(m);
    c.globalAlpha = 1;
    c.globalCompositeOperation = prev;
    this.cost.draw += performance.now() - t0;
  }

  private drawRounds(c: CanvasRenderingContext2D, m: DOMMatrix) {
    const S = this.S;
    for (const r of this.rounds) {
      if (!r.on) continue;
      const d = Math.min(r.len, r.speed * r.t + 18);
      const ang = Math.atan2(r.dy, r.dx);
      const [hx, hy] = this.roundPos(r, d);
      const gone = r.arrived ? Math.max(0, 1 - (r.t - r.len / r.speed) / (r.tracer ? 0.07 : 0.03)) : 1;
      switch (r.kind) {
        case 'bullet': case 'slug': case 'ball': case 'pellet': case 'nail': case 'rivet': case 'dragon': {
          // motion blur: the streak is the distance the round covers in ~one frame (longer for tracers)
          const blur = r.tracer ? 0.026 : r.kind === 'pellet' ? 0.011 : r.kind === 'dragon' ? 0.03 : 0.014;
          const L = Math.min(d - 18 + 1, Math.min(r.tracer ? 230 : 120, r.speed * blur)) ;
          if (L <= 1) break;
          const s = r.s;
          if (r.tracer) {
            rot(c, m, S.streak.tracer, hx, hy, L * 1.1, 9 * s * r.width, ang, 1, 0.5, 0.75 * gone);
            rot(c, m, S.streak.warm, hx, hy, L, 3.2 * s * r.width, ang, 1, 0.5, gone);
            rot(c, m, S.glow.tracer, hx, hy, 26 * s, 26 * s, 0, 0.5, 0.5, 0.8 * gone);
            rot(c, m, S.glow.white, hx, hy, 7 * s, 7 * s, 0, 0.5, 0.5, gone);
          } else if (r.kind === 'dragon') {
            rot(c, m, S.streak.fire, hx, hy, L, 7 * s, ang, 1, 0.5, gone);
            rot(c, m, S.glow.orange, hx, hy, 18 * s, 18 * s, 0, 0.5, 0.5, 0.8 * gone);
          } else if (r.kind === 'pellet') {
            rot(c, m, S.streak.warm, hx, hy, L, 4.4 * s, ang, 1, 0.5, 0.85 * gone);
            rot(c, m, S.glow.warm, hx, hy, 9 * s, 7 * s, ang, 0.6, 0.5, 0.45 * gone);
          } else if (r.kind === 'nail' || r.kind === 'rivet') {
            rot(c, m, S.streak.pale, hx, hy, L * 0.6, 2.4 * s, ang, 1, 0.5, 0.35 * gone);
          } else {
            // an ordinary round: a faint hot thread with a brighter head, gone in a frame or two
            rot(c, m, S.streak.warm, hx, hy, L, (3.5 + 2 * r.width) * s, ang, 1, 0.5, 0.75 * gone);
            rot(c, m, S.glow.warm, hx, hy, 16 * s, 12 * s, ang, 0.6, 0.5, 0.7 * gone);
          }
          break;
        }
        case 'flare': {
          if (r.arrived) break;
          rot(c, m, S.glow.flare, hx, hy, 70, 70, 0, 0.5, 0.5, 0.95);
          rot(c, m, S.glow.white, hx, hy, 12, 12, 0, 0.5, 0.5, 1);
          break;
        }
        case 'rocket': {
          if (r.arrived) break;
          const bx = hx - r.dx * 30 * r.s, by = hy - r.dy * 30 * r.s;
          rot(c, m, S.petal[(r.t * 60) & 3], bx, by, 34 * r.s, 10 * r.s, ang + Math.PI, 0, 0.5, 1);
          rot(c, m, S.glow.warm, bx, by, 60, 60, 0, 0.5, 0.5, 0.85);
          rot(c, m, S.glow.white, bx, by, 12, 12, 0, 0.5, 0.5, 1);
          break;
        }
        case 'arrow': case 'bolt': {
          if (r.fire && !r.arrived) {
            const tx = hx - r.dx * 6, ty = hy - r.dy * 6;
            rot(c, m, S.glow.orange, tx, ty, 34, 34, 0, 0.5, 0.5, 0.8);
            rot(c, m, S.flame[(r.t * 30) % 6 | 0], tx, ty + 2, 10, 18, -ang * 0.2, 0.5, 1, 0.9);
          } else if (!r.arrived) {
            // the fletching hisses: a faint air streak behind the shaft
            rot(c, m, S.streak.pale, hx - r.dx * 40 * r.s, hy - r.dy * 40 * r.s, 60, 3, ang, 1, 0.5, 0.18);
          }
          break;
        }
        case 'none': {
          if (r.fire && !r.arrived) {
            rot(c, m, S.glow.orange, hx + 6, hy - 2, 40, 40, 0, 0.5, 0.5, 0.8);
            rot(c, m, S.flame[(r.t * 30) % 6 | 0], hx + 6, hy, 9, 16, 0, 0.5, 1, 0.9);
          }
          break;
        }
      }
    }
  }

  private drawFlashes(c: CanvasRenderingContext2D, m: DOMMatrix) {
    const S = this.S;
    for (const f of this.flashes) {
      if (!f.on) continue;
      const sp = f.spec;
      const k = f.age / sp.life; // 0 → 1
      const I = k < 0.2 ? 1 : Math.pow(1 - (k - 0.2) / 0.8, 1.3);
      const s = f.s;
      const ca = Math.cos(f.ang), sa = Math.sin(f.ang);
      const v = (f.seed * 6) | 0;
      const red = sp.tint === 1;
      // the light the flash throws on the road under the gun
      if (sp.light > 120 && this.gk > 0) rot(c, m, red ? S.glow.flare : S.glow.warm, f.x + ca * 30, f.gy, sp.light * 1.3, sp.light * 0.22, 0, 0.5, 0.5, 0.3 * I);
      // bloom first, under the hard shapes
      if (sp.bloom) {
        const b = sp.bloom * (this.gk || 0.35);
        rot(c, m, red ? S.glow.flare : S.glow.warm, f.x + ca * sp.plume * 0.3 * s, f.y + sa * sp.plume * 0.3 * s, b * 2 * s, b * 1.5 * s, f.ang, 0.5, 0.5, 0.6 * I);
      }
      // secondary flash: the fuel-rich gas catching in the air, a beat after the primary
      if (sp.ball && k > 0.1) {
        const kb = Math.min(1, (k - 0.1) / 0.5);
        const r0 = sp.ball * s * (0.45 + 0.4 * kb);
        const stage = Math.min(3, (kb * 3) | 0);
        const bx = f.x + ca * sp.ballOff * s * (0.8 + 0.4 * kb), by = f.y + sa * sp.ballOff * s * (0.8 + 0.4 * kb) - kb * 4;
        rot(c, m, S.fire[stage][v & 3], bx, by, r0 * 2, r0 * 1.7, f.ang + f.seed * 3, 0.5, 0.5, (0.8 - kb * 0.5) * I);
      }
      // the forward plume (two layers: a long outer flame and a short white-hot inner one)
      if (sp.plume) {
        const L = sp.plume * s * (0.75 + 0.5 * Math.min(1, k * 2.5));
        const W = sp.plumeW * s * (1 + 0.3 * k);
        rot(c, m, S.plume[v], f.x, f.y, L, W, f.ang + (f.seed - 0.5) * 0.08, 0.03, 0.5, I);
        if (sp.twin) rot(c, m, S.plume[(v + 2) % 6], f.x - sa * sp.twin * s, f.y + ca * sp.twin * s, L * 0.92, W * 0.9, f.ang - 0.05, 0.03, 0.5, I);
        rot(c, m, S.plume[(v + 3) % 6], f.x, f.y, L * 0.55, W * 0.7, f.ang, 0.03, 0.5, I);
      }
      // side petals: the star (pistols), the birdcage prongs (AR, LMG), the brake jets
      for (let p = 0; p < sp.petals; p++) {
        const side = p % 2 ? -1 : 1;
        const tier = (p >> 1);
        const a = f.ang + side * sp.petalA * (1 + tier * 0.7) + (Math.sin(f.seed * 50 + p * 7) * 0.12);
        const L = sp.petalLen * s * (0.75 + 0.35 * Math.abs(Math.sin(f.seed * 31 + p * 3))) * (1 - tier * 0.25) * (0.8 + 0.4 * Math.min(1, k * 3));
        const ox = f.x + ca * 3 * s, oy = f.y + sa * 3 * s;
        rot(c, m, S.petal[(v + p) & 3], ox, oy, L, L * 0.2, a, 0, 0.5, I);
      }
      // front-view star squashed into the side view
      if (sp.burst) {
        const bs = sp.burst * s * (0.8 + 0.4 * k);
        rot(c, m, S.burst[v & 3], f.x + ca * 4 * s, f.y + sa * 4 * s, bs * 2, bs * 1.4, f.ang + f.seed, 0.5, 0.5, I * 0.85);
      }
      // the intermediate (Mach) disc: a reddish lens across the bore, a little way out
      if (sp.disc) {
        const dx = f.x + ca * sp.plume * 0.42 * s, dy = f.y + sa * sp.plume * 0.42 * s;
        rot(c, m, S.glow.orange, dx, dy, sp.disc * 1.2 * s, sp.disc * 3.6 * s, f.ang, 0.5, 0.5, I * 0.9);
      }
      // revolver cylinder gap / muzzleloader lock: a jet out of the side, behind the muzzle
      if (sp.gap) {
        const gx = f.x - ca * sp.gap * s, gy = f.y - sa * sp.gap * s;
        rot(c, m, S.petal[v & 3], gx, gy, 14 * s, 4 * s, f.ang - Math.PI / 2, 0, 0.5, I);
        rot(c, m, S.petal[(v + 1) & 3], gx, gy, 10 * s, 3 * s, f.ang + Math.PI / 2, 0, 0.5, I);
        rot(c, m, S.glow.warm, gx, gy, 26 * s, 26 * s, 0, 0.5, 0.5, I * 0.7);
      }
      // backblast
      if (sp.back) {
        rot(c, m, S.plume[v], f.x - ca * 26 * s, f.y - sa * 26 * s, sp.back * s * (0.7 + 0.6 * k), 40 * s, f.ang + Math.PI, 0.03, 0.5, I);
      }
      // the primary flash: a white-hot core right at the crown
      if (sp.core) {
        rot(c, m, S.glow.warm, f.x, f.y, sp.core * 2.2 * s, sp.core * 1.8 * s, f.ang, 0.4, 0.5, I * 0.8);
        rot(c, m, S.glow.white, f.x + ca * 2, f.y + sa * 2, sp.core * 1.0 * s, sp.core * 0.8 * s, f.ang, 0.5, 0.5, I);
      }
    }
  }
}

// ---------- blitting helpers: rotate/scale around an anchor without save/restore ----------
/** drawImage `im` at (x, y), w×h, rotated by `a` about the anchor (ax, ay) in 0..1 of the image, with alpha. */
function rot(c: CanvasRenderingContext2D, m: DOMMatrix, im: CanvasImageSource, x: number, y: number, w: number, h: number, a: number, ax: number, ay: number, alpha: number) {
  // a negative width mirrors the image about the anchor
  const fl = w < 0 ? -1 : 1;
  if (fl < 0) w = -w;
  if (alpha <= 0.004 || w < 0.3 || h < 0.3) return;
  const cs = Math.cos(a), sn = Math.sin(a);
  c.setTransform((m.a * cs + m.c * sn) * fl, (m.b * cs + m.d * sn) * fl, m.c * cs - m.a * sn, m.d * cs - m.b * sn, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  c.globalAlpha = alpha > 1 ? 1 : alpha;
  c.drawImage(im, -ax * w, -ay * h, w, h);
}
/** A filled rect L×W centred at (x, y), rotated by a (fillStyle and alpha already set). */
function rotRect(c: CanvasRenderingContext2D, m: DOMMatrix, x: number, y: number, L: number, W: number, a: number) {
  const cs = Math.cos(a), sn = Math.sin(a);
  c.setTransform(m.a * cs + m.c * sn, m.b * cs + m.d * sn, m.c * cs - m.a * sn, m.d * cs - m.b * sn, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  c.fillRect(-L / 2, -W / 2, L, W);
}

export type { GunLook };
export { gunLook };
