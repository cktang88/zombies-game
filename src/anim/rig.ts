// The cutout bone rig: layers → channels → FK/IK → pre-baked part bitmaps drawn with
// ctx.setTransform only (no save/restore, no per-frame canvas allocation).
//
// Layers, in order, each frame:
//   1 locomotion   procedural gait (gait.ts) or crawl, scaled by how fast the body moves
//   2 aim          survivors: torso lean + head follow the aim angle; the gun is placed on
//                  the shoulder (long guns) or at arm's length (pistols); hands IK to the grip
//                  and fore-end anchors of the weapon (weaponAnchors.ts)
//   3 action clip  keyframed data (clips.ts) overriding channels / hand targets, faded in/out,
//                  stretched to the requested duration, firing events
//   4 additive     hit reactions, twitches, recoil spring, breathing
//   5 solve        analytic 2-bone IK for arms (elbow down) and legs (knee forward)
// Death hands the pose to a Verlet ragdoll (ragdoll.ts) seeded with the pose's velocities
// plus the killing hit's impulse; once it settles the caller bakes it into the ground.
import { getGun, getRig, loadGun, loadRig, type GunAsset, type PartMeta, type RigAsset } from './assets';
import { CLIPS, RELOADS, type Clip, type Key, type TKey } from './clips';
import { GAITS, applyGait, jitterGait, type Gait } from './gait';
import { clamp, ease, ik2, lerp, lerpAngle, rng, wrapAngle } from './math';
import { DieOpts, PART_POINTS, P_HEADBASE, RAGDOLL_POINTS, Ragdoll } from './ragdoll';
import {
  BODY_POINTS, CH_DEFAULT, F_FA, F_FT, F_H, F_SN, F_TH, F_UA, HEAD, N_FA, N_FT, N_H, N_SN, N_TH, N_UA, PART_COUNT, PART_NAMES, TORSO,
  geomOf, type Channels, type NumCh, type RigGeom, type Target,
} from './skeleton';
import { STYLES, type Style } from './styles';
import { anchorsFor, type WeaponAnchors } from './weaponAnchors';

export type RigKind = 'survivor' | 'turned';
export interface PlayOpts {
  /** seconds for one pass of the clip (default: the clip's authored duration) */
  duration?: number;
  /** play the clip this many times back to back (shell-by-shell loading) */
  repeat?: number;
  onEvent?: (name: string, rig: Rig) => void;
  onEnd?: (rig: Rig) => void;
}
export interface CreateOpts {
  seed?: number;
  /** STYLES key; default 'survivor' for survivors, 'sleeper' for Turned */
  style?: string;
  /** force a gait preset (else one of the style's walks, picked by seed) */
  gait?: string;
  /** called for every animation event of every clip (audio hook) */
  onEvent?: (name: string, rig: Rig) => void;
}
interface Active {
  clip: Clip;
  opts: PlayOpts;
  dur: number; // seconds per pass
  age: number; // seconds since start
  reps: number;
  ended: boolean;
  lastT: number; // normalised time at the previous update (for events / sets)
  lastRep: number;
  endAge?: number;
}
interface Prop {
  kind: 'mag' | 'casing' | 'shell' | 'loader' | 'gun';
  x: number; y: number; vx: number; vy: number; a: number; va: number; life: number; k: number;
  src?: CanvasImageSource; sx?: number; sy?: number; sw?: number; sh?: number; flip?: boolean; rest?: boolean;
}
type HandT = { x: number; y: number; rho: number; pose: string } | null;

const ADDITIVE_ALWAYS: Partial<Record<NumCh, true>> = { px: true, py: true };
let nextSeed = 1;

export function createRig(kind: RigKind, spriteId: string, opts: CreateOpts = {}): Rig {
  return new Rig(kind, spriteId, opts);
}

export class Rig {
  readonly kind: RigKind;
  readonly spriteId: string;
  readonly seed: number;
  style: Style;
  asset: RigAsset | null | undefined;
  geo: RigGeom | null = null;
  gait: Gait;
  baseGait: Gait;
  crawling = false;
  onEvent?: (name: string, rig: Rig) => void;
  /** set by the game each frame: ground speed in px/s (display space) */
  speedPx = 0;
  phase = 0;
  moving = 0;
  t = 0;
  ch: Channels = { ...CH_DEFAULT };
  // weapon
  weaponId: string | null = null;
  anchors: WeaponAnchors | null = null;
  gun: GunAsset | null = null;
  oneHand = false;
  magState: 'gun' | 'hand' | 'none' = 'gun';
  prop: string | null = null;
  fprop: string | null = null;
  gunState: 'held' | 'slung' | 'hidden' = 'held';
  headFlip = 0;
  aimWX = 0; aimWY = 0; hasAim = false;
  aimAngle = 0;
  recoil = 0; recoilV = 0;
  flashT = 0;
  // last draw transform (so aimAt can take world coords)
  dx = 0; dy = 0; ds = 0.5; df = 1;
  // layers
  actions: Active[] = [];
  // solved pose (rig space)
  jx = new Float32Array(PART_COUNT);
  jy = new Float32Array(PART_COUNT);
  ja = new Float32Array(PART_COUNT);
  handN = 'hand'; handF = 'hand';
  gx = 0; gy = 0; ga = 0; gk = 1; gunVisible = false;
  rhoN = 0; rhoF = 0; palmNX = 0; palmNY = 0; palmFX = 0; palmFY = 0;
  pts = new Float32Array(RAGDOLL_POINTS * 2);
  prevPts = new Float32Array(RAGDOLL_POINTS * 2);
  hasPts = false;
  // death
  ragdoll: Ragdoll | null = null;
  dead = false;
  props: Prop[] = [];
  /** idle behaviours scheduled automatically when standing still (Turned) */
  autoIdle = false;
  private idleIn = 3;
  private r: () => number;

  constructor(kind: RigKind, spriteId: string, o: CreateOpts) {
    this.kind = kind;
    this.spriteId = spriteId;
    this.seed = o.seed ?? nextSeed++ * 7919;
    this.r = rng(this.seed);
    this.style = STYLES[o.style ?? (kind === 'survivor' ? 'survivor' : 'sleeper')] ?? STYLES.sleeper;
    const walk = o.gait ?? this.style.walks[Math.floor(this.r() * this.style.walks.length)];
    this.baseGait = kind === 'turned' ? jitterGait(GAITS[walk] ?? GAITS.walk, this.r) : GAITS[walk] ?? GAITS.walk;
    this.gait = this.baseGait;
    this.crawling = !!this.gait.crawl;
    this.phase = this.r();
    this.onEvent = o.onEvent;
    this.asset = getRig(spriteId);
    if (this.asset === undefined) loadRig(spriteId).then((a) => this.attach(a));
    else this.attach(this.asset);
  }
  private attach(a: RigAsset | null) {
    this.asset = a;
    this.geo = a ? geomOf(a.meta) : null;
  }
  /** true when the part atlas is loaded (else draw() falls back to the single image) */
  get ready() { return !!this.asset; }

  // ------------------------------------------------------------------ public API
  setWeapon(defId: string | null, opts: { oneHand?: boolean } = {}) {
    this.weaponId = defId;
    this.oneHand = !!opts.oneHand;
    this.magState = 'gun';
    this.prop = null;
    this.gunState = 'held';
    if (!defId) { this.anchors = null; this.gun = null; return; }
    this.anchors = anchorsFor(defId);
    this.gun = getGun(defId) ?? null;
    if (!this.gun) loadGun(defId).then((g) => { if (this.weaponId === defId) this.gun = g; });
  }
  /** Aim at a point in world (display) coordinates; uses the last draw() transform. */
  aimAt(x: number, y: number) { this.aimWX = x; this.aimWY = y; this.hasAim = true; }
  clearAim() { this.hasAim = false; }
  /** Ground speed in display px/s; drives the gait cadence (feet don't slide). */
  setSpeed(pxPerSec: number) { this.speedPx = pxPerSec; }
  setGait(id: string) { const g = GAITS[id]; if (g) { this.gait = this.kind === 'turned' ? jitterGait(g, this.r) : g; this.crawling = !!g.crawl; } }

  play(clipId: string | Clip, opts: PlayOpts = {}): boolean {
    const clip = typeof clipId === 'string' ? CLIPS[clipId] : clipId;
    if (!clip || this.dead && !clip.hold) return false;
    if (!clip.add) {
      // a new action replaces the current one (fading from wherever it was)
      for (const a of this.actions) if (!a.clip.add && !a.ended) { a.ended = true; a.endAge = a.age; this.finish(a, true); }
    }
    this.actions.push({ clip, opts, dur: Math.max(0.05, opts.duration ?? clip.dur), age: 0, reps: Math.max(1, opts.repeat ?? 1), ended: false, lastT: -1e-6, lastRep: 0 });
    return true;
  }
  isPlaying(clipId?: string) { return this.actions.some((a) => !a.ended && !a.clip.add && (!clipId || a.clip.id === clipId)); }
  stop(clipId?: string) { for (const a of this.actions) if (!clipId || a.clip.id === clipId) { if (!a.ended) { a.ended = true; a.endAge = a.age; this.finish(a, true); } } }

  /**
   * Play the right reload for the held weapon, stretched to `seconds` (fireProfile reload).
   * For per-round guns (pump, lever) pass rounds: the clip repeats once per round
   * (seconds = per-round time) and the finishing action (pump / lever) follows.
   */
  reload(seconds: number, o: { empty?: boolean; rounds?: number; onEvent?: (n: string, r: Rig) => void; onEnd?: (r: Rig) => void } = {}) {
    const a = this.anchors;
    if (!a) return false;
    const spec = RELOADS[a.reload];
    if (!spec) return false;
    const clip = (o.empty && spec.empty) || spec.clip;
    if (spec.perRound) {
      const n = Math.max(1, o.rounds ?? 1);
      return this.play(clip, {
        duration: seconds, repeat: n, onEvent: o.onEvent,
        onEnd: () => { if (spec.finish) this.play(spec.finish, { onEvent: o.onEvent, onEnd: o.onEnd }); else o.onEnd?.(this); },
      });
    }
    return this.play(clip, { duration: seconds, onEvent: o.onEvent, onEnd: o.onEnd });
  }

  /** A shot: recoil kick (strength ~ weapon knock/caliber), muzzle flash flag, casing out. */
  fire(strength = 1) {
    this.recoilV += 9 * strength;
    this.ch.flash = 1;
    this.flashMuzzle = 0.06;
    const a = this.anchors;
    if (a && (a.reload === 'mag' || a.reload === 'pistolMag') && this.gun) this.spawnCasing();
  }
  flashMuzzle = 0;

  /** Hit reaction by zone. Turned: a crippling leg hit may drop them to a crawl. */
  hit(zone: 'head' | 'torso' | 'arm' | 'leg', o: { cripple?: boolean; flash?: boolean } = {}) {
    if (this.dead) return;
    this.flashT = o.flash === false ? 0 : 0.09;
    if (zone === 'leg' && o.cripple && !this.crawling) {
      this.play('buckle', { onEnd: () => { this.stop(); this.setGait(this.style.id === 'drag' ? 'crawl' : (this.r() < 0.5 ? 'crawl' : 'crawlOneArm')); } });
      return;
    }
    this.play(zone === 'head' ? 'hitHead' : zone === 'arm' ? 'hitArm' : zone === 'leg' ? 'hitLeg' : 'hitTorso');
  }

  /**
   * Kill the rig. Authored archetype deaths (Pulper burst, Crier choke, collapse) play first
   * and hand over to the ragdoll on their 'ragdoll' event; otherwise straight to ragdoll.
   * impulse is in DISPLAY px/s and world axes (x right) - it is converted to rig space.
   */
  die(o: DieOpts & { authored?: boolean; worldImpulse?: { x: number; y: number }; wallWorldX?: number } = {}) {
    if (this.dead) return;
    const opts: DieOpts = { ...o };
    if (o.worldImpulse) opts.impulse = { x: (o.worldImpulse.x * this.df) / this.ds, y: o.worldImpulse.y / this.ds };
    if (o.wallWorldX !== undefined) opts.wallX = ((o.wallWorldX - this.dx) * this.df) / this.ds;
    const authored = this.style.deaths.filter((d) => d !== 'ragdoll' && CLIPS[d]);
    if (o.authored !== false && authored.length && (o.authored || this.r() < authored.length / this.style.deaths.length)) {
      const id = authored[Math.floor(this.r() * authored.length)];
      this.actions = this.actions.filter((a) => a.clip.add);
      this.play(id, { onEvent: (n) => { if (n === 'ragdoll' || n === 'burst') this.startRagdoll(opts); } });
      this.dead = true;
      return;
    }
    this.dead = true;
    this.startRagdoll(opts);
  }
  /** Ragdoll settled (or timed out): bake it into the ground layer and drop it. */
  get settled() { return !!this.ragdoll?.settled; }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    dt = Math.min(dt, 1 / 20);
    this.t += dt;
    this.updateProps(dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flashMuzzle = Math.max(0, this.flashMuzzle - dt);
    if (this.ragdoll) { this.ragdoll.step(dt); return; }
    const g = this.geo;
    if (!g) return;
    // 1. locomotion
    const speedRig = this.speedPx / Math.max(0.05, this.ds);
    this.moving += ((speedRig > 1 ? 1 : 0) - this.moving) * Math.min(1, dt * 6);
    const gait = this.gait;
    const strideLen = Math.max(1, (gait.crawl ? 0.45 * (g.ua + g.fa) : gait.stride * g.legLen));
    this.phase = (this.phase + (dt * speedRig * gait.duty * gait.speedMul) / strideLen + (gait.crawl ? 0 : 0)) % 1;
    const ch = this.ch;
    Object.assign(ch, CH_DEFAULT);
    applyGait(ch, gait, this.phase, g, this.moving);
    // breathing
    const br = Math.sin(this.t * (this.kind === 'turned' ? 1.3 : 2.1) + this.seed);
    ch.py += br * 0.8 * (1 - this.moving * 0.7);
    ch.lean += br * 0.012;
    if (this.kind === 'survivor' && this.anchors?.hold === 'bow') ch.draw = this.hasAim ? 1 : 0;
    // 2-4. action clips
    this.gunState = 'held';
    const tgt = { n: null as { k0: TKey | null; k1: TKey | null; u: number; w: number } | null, f: null as { k0: TKey | null; k1: TKey | null; u: number; w: number } | null };
    for (const a of this.actions) this.sampleClip(a, dt, tgt);
    this.actions = this.actions.filter((a) => !(a.ended && this.fadeW(a) <= 0.001));
    if (this.autoIdle && this.kind === 'turned') this.scheduleIdle(dt);
    // recoil spring (critically-damped-ish)
    this.recoilV += (-this.recoil * 260 - this.recoilV * 26) * dt;
    this.recoil += this.recoilV * dt;
    this.ch.flash = Math.max(0, this.ch.flash - dt * 12);
    // 5. solve
    this.prevPts.set(this.pts);
    this.solve(tgt);
    if (!this.hasPts) { this.prevPts.set(this.pts); this.hasPts = true; }
  }

  private fadeW(a: Active): number {
    const total = a.dur * a.reps;
    const fi = a.clip.fadeIn ?? 0.1, fo = a.clip.fadeOut ?? 0.12;
    let w = fi > 0 ? clamp(a.age / fi, 0, 1) : 1;
    if (a.ended) return Math.min(w, fo > 0 ? clamp((fo - (a.age - (a.endAge ?? a.age))) / fo, 0, 1) : 0);
    if (a.clip.hold || a.clip.loop) return w;
    return Math.min(w, fo > 0 ? clamp((total - a.age) / fo, 0, 1) : 1);
  }

  private sampleClip(a: Active, dt: number, tgt: { n: unknown; f: unknown }) {
    const c = a.clip;
    a.age += dt;
    const total = a.dur * a.reps;
    let t: number, wrapped = false;
    if (c.loop) { t = (a.age % a.dur) / a.dur; wrapped = t < a.lastT; }
    else {
      const raw = a.age / a.dur;
      const rep = Math.min(a.reps - 1, Math.floor(raw));
      t = a.age >= total ? 1 : raw - rep;
      wrapped = rep > a.lastRep;
      a.lastRep = rep;
    }
    if (!a.ended) {
      const crossed = (x: number) => (wrapped ? x > a.lastT || x <= t : x > a.lastT && x <= t);
      if (c.set) for (const [st, k, v] of c.set) if (crossed(st)) this.applySet(k, v);
      if (c.ev) for (const [et, name] of c.ev) if (crossed(et)) this.emit(name, a);
    }
    a.lastT = t;
    if (!c.loop && !c.hold && !a.ended && a.age >= total) {
      a.ended = true;
      a.endAge = a.age - (c.fadeOut ?? 0.12);
      this.finish(a, false);
    }
    const w = this.fadeW(a);
    if (w <= 0) return;
    // sticky sets: keep slung/hidden while the clip is active
    if (c.set) for (const [st, k, v] of c.set) if (k === 'gun' && st <= t) this.gunState = v as 'held';
    const ch = this.ch as unknown as Record<string, number>;
    if (c.num) for (const k in c.num) {
      const v = sampleKeys(c.num[k as NumCh]!, t);
      if (c.add || ADDITIVE_ALWAYS[k as NumCh]) ch[k] += v * w;
      else ch[k] = lerp(ch[k], v, w);
    }
    const tt = tgt as { n: { k0: TKey | null; k1: TKey | null; u: number; w: number } | null; f: { k0: TKey | null; k1: TKey | null; u: number; w: number } | null };
    if (c.n) tt.n = { ...bracket(c.n, t), w };
    if (c.f) tt.f = { ...bracket(c.f, t), w };
  }

  private finish(a: Active, interrupted: boolean) {
    if (!interrupted || a.clip.loop) a.opts.onEnd?.(this);
    if (a.clip.set) {
      // make sure props end in a sane state if a clip is cut short
      if (interrupted) { if (this.magState !== 'gun') this.magState = 'gun'; this.prop = null; this.fprop = null; }
    }
  }
  private emit(name: string, a: Active) {
    if (name === 'magDrop') this.spawnMag();
    if (name === 'eject' || name === 'rack' || name === 'pumpBack' || name === 'leverDown') this.spawnCasing(name === 'pumpBack' || (name === 'eject' && this.anchors?.reload === 'break'));
    if (name === 'loaderDrop') this.spawnLoader();
    a.opts.onEvent?.(name, this);
    this.onEvent?.(name, this);
  }
  private applySet(k: string, v: string | number | null) {
    if (k === 'mag') this.magState = v as 'gun';
    else if (k === 'prop') this.prop = v as string | null;
    else if (k === 'fprop') this.fprop = v as string | null;
    else if (k === 'headFlip') this.headFlip = v as number;
  }
  private scheduleIdle(dt: number) {
    if (this.isPlaying()) return;
    this.idleIn -= dt * (this.moving < 0.3 ? 1 : 0.35);
    if (this.idleIn > 0) return;
    this.idleIn = 2.5 + this.r() * 5;
    const pool = this.moving < 0.3 ? this.style.idles : ['twitch'];
    const id = pool[Math.floor(this.r() * pool.length)];
    if (id && CLIPS[id] && !(CLIPS[id].loop)) this.play(id);
  }

  // ------------------------------------------------------------------ solve
  private solve(tgt: { n: { k0: TKey | null; k1: TKey | null; u: number; w: number } | null; f: { k0: TKey | null; k1: TKey | null; u: number; w: number } | null }) {
    const g = this.geo!, ch = this.ch, P = this.asset!.meta.parts;
    const a = this.anchors;
    const holding = !!(a && this.kind === 'survivor' && this.weaponId);
    // aim angle from the shoulder (approximate: unleaned frame) to the aim point
    let aim = 0;
    if (this.hasAim) {
      const lx = ((this.aimWX - this.dx) * this.df) / this.ds, ly = (this.aimWY - this.dy) / this.ds;
      const sx = ch.px + g.sh[1], sy = ch.py + g.sh[0] * -1;
      aim = clamp(Math.atan2(ly - sy, Math.max(8, lx - sx)), -1.2, 1.0);
    }
    this.aimAngle = aim;
    const aimW = holding && this.gunState === 'held' && a!.hold !== 'melee' ? (1 - ch.ready) * (this.hasAim ? 1 : 0.4) : 0;
    if (holding && a!.hold !== 'melee') {
      ch.lean += aim * 0.2 * aimW + (this.hasAim ? 0.04 : 0);
      ch.head += aim * (a!.hold === 'long' || a!.hold === 'tube' ? 0.75 : 0.5) * aimW;
      ch.lean -= this.recoil * 0.004;
    }
    // ---- trunk
    const crouchDrop = ch.crouch * g.legLen * 0.5;
    const pelX = ch.px, pelY = ch.py + crouchDrop;
    const tiltA = -Math.PI / 2 + ch.tilt;
    const T = tiltA + ch.lean;
    const ux = Math.cos(T), uy = Math.sin(T), vx = -uy, vy = ux;
    const pux = Math.cos(tiltA), puy = Math.sin(tiltA), pvx = -puy, pvy = pux;
    const J = this.jx, K = this.jy, A = this.ja;
    J[TORSO] = pelX; K[TORSO] = pelY; A[TORSO] = T;
    const neckX = pelX + ux * g.torsoLen, neckY = pelY + uy * g.torsoLen;
    J[HEAD] = neckX; K[HEAD] = neckY; A[HEAD] = T + g.restHeadRel + ch.head;
    const shX = pelX + ux * g.sh[0] + vx * g.sh[1], shY = pelY + uy * g.sh[0] + vy * g.sh[1];
    const fshX = shX + vx * g.fShOff, fshY = shY + vy * g.fShOff;
    J[N_UA] = shX; K[N_UA] = shY; J[F_UA] = fshX; K[F_UA] = fshY;
    J[N_TH] = pelX + pux * g.nHip[0] + pvx * g.nHip[1]; K[N_TH] = pelY + puy * g.nHip[0] + pvy * g.nHip[1];
    J[F_TH] = pelX + pux * g.fHip[0] + pvx * g.fHip[1]; K[F_TH] = pelY + puy * g.fHip[0] + pvy * g.fHip[1];
    // ---- legs
    this.solveLeg(N_TH, N_SN, N_FT, ch.nFx, ch.nFy, ch.nHip, ch.nKnee, ch.nAnk, tiltA);
    this.solveLeg(F_TH, F_SN, F_FT, ch.fFx, ch.fFy, ch.fHip, ch.fKnee, ch.fAnk, tiltA);
    // ---- weapon placement
    this.gunVisible = false;
    let defN: HandT = null, defF: HandT = null;
    const gun = this.gun;
    if (holding && gun && this.gunState === 'held' && a!.hold !== 'melee') {
      this.gunVisible = true;
      const k = a!.len / gun.w;
      const fl = a!.flip ? -1 : 1;
      this.gk = k;
      const loc = (p: [number, number]): [number, number] => [(p[0] - a!.grip[0]) * k * fl, (p[1] - a!.grip[1]) * k];
      const muz = loc(a!.muzzle);
      let gAimA = 0, gX = 0, gY = 0;
      const reach = (g.ua + g.fa);
      if (a!.hold === 'long' || a!.hold === 'tube') {
        const butt = loc(a!.butt ?? a!.grip);
        const up = a!.hold === 'tube' ? 10 : 5, fw = a!.hold === 'tube' ? 2 : 9;
        const pocketX = shX + vx * fw + ux * up, pocketY = shY + vy * fw + uy * up;
        const d = Math.atan2(muz[1] - butt[1], muz[0] - butt[0]);
        gAimA = aim - d;
        const c = Math.cos(gAimA), s = Math.sin(gAimA);
        gX = pocketX - (butt[0] * c - butt[1] * s); gY = pocketY - (butt[0] * s + butt[1] * c);
      } else if (a!.hold === 'pistol') {
        const ext = this.oneHand ? 0.9 : 0.8;
        gAimA = aim - Math.atan2(muz[1], muz[0]) * 0.5;
        gX = shX + Math.cos(aim) * reach * ext + vx * 2; gY = shY + Math.sin(aim) * reach * ext + 3;
      } else if (a!.hold === 'bow') {
        gAimA = aim - Math.PI / 2;
        gX = shX + Math.cos(aim) * reach * 0.93; gY = shY + Math.sin(aim) * reach * 0.93;
      }
      // low ready / reload carry: grip in front of the belly, muzzle canted by gunTilt
      const rX = pelX + ux * g.torsoLen * 0.42 + vx * 18 + ch.gunDX, rY = pelY + uy * g.torsoLen * 0.42 + vy * 18 + ch.gunDY;
      const rA = (a!.hold === 'bow' ? -Math.PI / 2 + 0.3 : 0.32) + ch.gunTilt;
      const rw = this.hasAim ? ch.ready : Math.max(ch.ready, 0.55);
      this.ga = lerpAngle(gAimA + ch.gunTilt * 0.3, rA, rw) - this.recoil * 0.03;
      this.gx = lerp(gX, rX, rw) - Math.cos(this.ga) * this.recoil * 0.9;
      this.gy = lerp(gY, rY, rw) - Math.sin(this.ga) * this.recoil * 0.9;
      // default hand targets
      const gp = (p: [number, number], dx = 0, dy = 0) => this.gunPt(loc(p), dx, dy);
      if (a!.hold === 'bow') {
        const [bx, by] = gp(a!.grip);
        defN = { x: bx, y: by, rho: this.ga + Math.PI / 2, pose: 'grip' };
        const dl = reach * 0.82 * ch.draw;
        defF = { x: bx - Math.cos(this.ga + Math.PI / 2) * (6 + dl), y: by - Math.sin(this.ga + Math.PI / 2) * (6 + dl), rho: this.ga + Math.PI / 2, pose: 'pinch' };
      } else {
        const [gx2, gy2] = gp(a!.grip);
        defF = { x: gx2, y: gy2, rho: this.ga, pose: 'grip' };
        if (a!.fore) {
          // the support hand slides back along the fore-end until the elbow can bend
          let [fx, fy] = gp(a!.fore);
          const d = Math.hypot(fx - shX, fy - shY), maxD = reach * 0.8;
          if (d > maxD) { const back = Math.min(d - maxD, Math.abs(loc(a!.fore)[0]) * 0.6); fx -= Math.cos(this.ga) * back; fy -= Math.sin(this.ga) * back; }
          defN = { x: fx, y: fy, rho: this.ga, pose: 'support' };
        }
        else if (!this.oneHand) { const [px, py] = this.gunPt([0, 0], -1, 8); defN = { x: px, y: py, rho: this.ga + 0.35, pose: "support" }; }
      }
    } else if (ch.handIK > 0) {
      defN = { x: ch.nHx, y: ch.nHy, rho: NaN, pose: 'open' };
      defF = { x: ch.fHx, y: ch.fHy, rho: NaN, pose: 'open' };
    }
    // ---- arms: default target blended with the clip target
    const tN = this.blendTarget(defN, tgt.n, 'n');
    const tF = this.blendTarget(defF, tgt.f, 'f');
    this.solveArm(N_UA, N_FA, N_H, shX, shY, T, ch.nSh, ch.nEl, ch.nWr, tN, 'n');
    this.solveArm(F_UA, F_FA, F_H, fshX, fshY, T, ch.fSh, ch.fEl, ch.fWr, tF, 'f');
    // melee weapons ride the near hand
    if (holding && gun && a!.hold === 'melee' && this.gunState === 'held') {
      this.gunVisible = true;
      this.gk = a!.len / gun.w;
      this.ga = this.rhoN - 1.35;
      this.gx = this.palmNX; this.gy = this.palmNY;
    }
    // ---- ragdoll points
    const p = this.pts;
    const set = (i: number, x: number, y: number) => { p[i * 2] = x; p[i * 2 + 1] = y; };
    const tip = (i: number, len: number) => [J[i] + Math.cos(A[i]) * len, K[i] + Math.sin(A[i]) * len];
    set(0, pelX, pelY); set(1, neckX, neckY); set(19, neckX, neckY);
    const [hx, hy] = tip(HEAD, g.headLen); set(2, hx, hy);
    set(3, shX, shY); set(18, fshX, fshY);
    set(4, J[N_FA], K[N_FA]); set(5, J[N_H], K[N_H]);
    const hn = tip(N_H, (P[this.handN] ?? P.hand).len); set(6, hn[0], hn[1]);
    set(7, J[F_FA], K[F_FA]); set(8, J[F_H], K[F_H]);
    const hf = tip(F_H, (P[this.handF] ?? P.hand).len); set(9, hf[0], hf[1]);
    set(10, J[N_TH], K[N_TH]); set(11, J[N_SN], K[N_SN]); set(12, J[N_FT], K[N_FT]);
    const tn = tip(N_FT, g.ft); set(13, tn[0], tn[1]);
    set(14, J[F_TH], K[F_TH]); set(15, J[F_SN], K[F_SN]); set(16, J[F_FT], K[F_FT]);
    const tf = tip(F_FT, g.ft); set(17, tf[0], tf[1]);
  }

  private ikOut = { a1: 0, a2: 0, reach: 0 };
  private solveLeg(th: number, sn: number, ft: number, fx: number, fy: number, hip: number, knee: number, ank: number, tiltA: number) {
    const g = this.geo!, J = this.jx, K = this.jy, A = this.ja, ch = this.ch;
    if (ch.footIK > 0.5) {
      const ty = fy - g.ankleH;
      const o = ik2(J[th], K[th], fx, ty, g.th, g.sn, -1, this.ikOut);
      A[th] = o.a1; A[sn] = o.a2;
      J[sn] = J[th] + Math.cos(o.a1) * g.th; K[sn] = K[th] + Math.sin(o.a1) * g.th;
      J[ft] = J[sn] + Math.cos(o.a2) * g.sn; K[ft] = K[sn] + Math.sin(o.a2) * g.sn;
      // keep the sole flat on the ground (toes down when the gait says so)
      A[ft] = ank + (fy < -1 ? clamp((o.a2 - Math.PI / 2) * 0.5, -0.4, 0.6) : 0);
    } else {
      A[th] = Math.PI / 2 + ch.tilt - hip;
      J[sn] = J[th] + Math.cos(A[th]) * g.th; K[sn] = K[th] + Math.sin(A[th]) * g.th;
      A[sn] = A[th] + knee;
      J[ft] = J[sn] + Math.cos(A[sn]) * g.sn; K[ft] = K[sn] + Math.sin(A[sn]) * g.sn;
      A[ft] = A[sn] - Math.PI / 2 + ank;
    }
    void tiltA;
  }

  /** gun-local point (+ offset along/across the gun) to rig space */
  private gunPt(l: [number, number], dx = 0, dy = 0): [number, number] {
    const c = Math.cos(this.ga), s = Math.sin(this.ga);
    const x = l[0] + dx, y = l[1] + dy;
    return [this.gx + x * c - y * s, this.gy + x * s + y * c];
  }

  private resolveTarget(t: Target, side: 'n' | 'f'): HandT {
    const g = this.geo!, ch = this.ch;
    const pose = t.pose ?? (side === 'n' ? 'support' : 'grip');
    if (t.s === 'gun') {
      const a = this.anchors, gun = this.gun;
      if (!a || !gun) return null;
      const k = this.gk, fl = a.flip ? -1 : 1;
      const src = (a as unknown as Record<string, [number, number]>)[t.p ?? 'grip'] ?? (t.p === 'magwell' && a.mag ? [a.mag[0] + a.mag[2] / 2, a.mag[1]] : a.grip);
      const l: [number, number] = [(src[0] - a.grip[0]) * k * fl, (src[1] - a.grip[1]) * k];
      const [x, y] = this.gunPt(l, t.dx ?? 0, t.dy ?? 0);
      return { x, y, rho: this.ga + (t.a ?? 0), pose };
    }
    if (t.s === 'body') {
      const bp = BODY_POINTS[t.p ?? 'chest'] ?? BODY_POINTS.chest;
      const T = this.ja[TORSO];
      const ux = Math.cos(T), uy = Math.sin(T), vx = -uy, vy = ux;
      const along = bp[0] * g.torsoLen, fwd = bp[1];
      return { x: this.jx[TORSO] + ux * along + vx * fwd + (t.dx ?? 0), y: this.jy[TORSO] + uy * along + vy * fwd + (t.dy ?? 0), rho: t.a ?? 0, pose };
    }
    if (t.s === 'ground') return { x: ch.px + (t.dx ?? 0), y: -(t.dy ?? 0) - 2, rho: t.a ?? 0.5, pose };
    return { x: t.dx ?? 0, y: t.dy ?? 0, rho: t.a ?? 0, pose };
  }

  private blendTarget(def: HandT, clip: { k0: TKey | null; k1: TKey | null; u: number; w: number } | null, side: 'n' | 'f'): HandT {
    if (!clip || clip.w <= 0) return def;
    const r0 = clip.k0 && clip.k0[1] ? this.resolveTarget(clip.k0[1], side) : def;
    const r1 = clip.k1 && clip.k1[1] ? this.resolveTarget(clip.k1[1], side) : def;
    const u = ease(clip.k1?.[2], clip.u);
    let t: HandT;
    if (r0 && r1) {
      const rho0 = isNaN(r0.rho) ? (isNaN(r1.rho) ? NaN : r1.rho) : r0.rho;
      const rho1 = isNaN(r1.rho) ? rho0 : r1.rho;
      t = { x: lerp(r0.x, r1.x, u), y: lerp(r0.y, r1.y, u), rho: isNaN(rho0) ? NaN : lerpAngle(rho0, rho1, u), pose: u < 0.5 ? r0.pose : r1.pose };
    } else t = r1 ?? r0;
    if (!def || clip.w >= 1 || !t) return clip.w >= 0.5 ? t : def;
    return { x: lerp(def.x, t.x, clip.w), y: lerp(def.y, t.y, clip.w), rho: isNaN(def.rho) || isNaN(t.rho) ? t.rho : lerpAngle(def.rho, t.rho, clip.w), pose: clip.w > 0.5 ? t.pose : def.pose };
  }

  private solveArm(ua: number, fa: number, h: number, sx: number, sy: number, T: number, sh: number, el: number, wr: number, t: HandT, side: 'n' | 'f') {
    const g = this.geo!, J = this.jx, K = this.jy, A = this.ja, P = this.asset!.meta.parts;
    let partName = 'hand';
    J[ua] = sx; K[ua] = sy;
    if (t) {
      partName = P['hand_' + t.pose] ? 'hand_' + t.pose : 'hand';
      const pm = P[partName];
      const gx = pm.gx ?? pm.len * 0.55, gy = pm.gy ?? 0;
      const hb = isNaN(t.rho) ? Math.atan2(t.y - sy, t.x - sx) + 0.4 : t.rho + pm.rest;
      const c = Math.cos(hb), s = Math.sin(hb);
      const wx = t.x - (gx * c - gy * s), wy = t.y - (gx * s + gy * c);
      // elbow down: pick the solution whose elbow sits lower
      const o1 = ik2(sx, sy, wx, wy, g.ua, g.fa, 1, this.ikOut);
      const a1 = o1.a1, a2 = o1.a2;
      const e1y = sy + Math.sin(a1) * g.ua;
      const o2 = ik2(sx, sy, wx, wy, g.ua, g.fa, -1, this.ikOut);
      const e2y = sy + Math.sin(o2.a1) * g.ua;
      const crawl = this.crawling && !this.weaponId;
      const pick1 = crawl ? e1y < e2y : e1y >= e2y;
      A[ua] = pick1 ? a1 : o2.a1; A[fa] = pick1 ? a2 : o2.a2;
      A[h] = hb;
    } else {
      A[ua] = T + Math.PI - sh;
      A[fa] = A[ua] - el;
      A[h] = A[fa] - wr;
    }
    J[fa] = sx + Math.cos(A[ua]) * g.ua; K[fa] = sy + Math.sin(A[ua]) * g.ua;
    J[h] = J[fa] + Math.cos(A[fa]) * g.fa; K[h] = K[fa] + Math.sin(A[fa]) * g.fa;
    const pm = P[partName];
    const rho = A[h] - pm.rest;
    const gx = pm.gx ?? pm.len * 0.55, gy = pm.gy ?? 0;
    const c = Math.cos(A[h]), s = Math.sin(A[h]);
    if (side === 'n') { this.handN = partName; this.rhoN = rho; this.palmNX = J[h] + gx * c - gy * s; this.palmNY = K[h] + gx * s + gy * c; }
    else { this.handF = partName; this.rhoF = rho; this.palmFX = J[h] + gx * c - gy * s; this.palmFY = K[h] + gx * s + gy * c; }
  }

  // ------------------------------------------------------------------ death
  private startRagdoll(o: DieOpts) {
    const g = this.geo;
    if (!g || this.ragdoll) return;
    const st = this.style;
    const rd = new Ragdoll(st.mass, st.stiff, st.friction);
    // add the body's own ground speed (a sprinting Deer tumbles on)
    const speedRig = (this.speedPx / Math.max(0.05, this.ds)) * this.moving;
    const prev = new Float32Array(this.prevPts);
    for (let i = 0; i < RAGDOLL_POINTS; i++) prev[i * 2] -= (speedRig / 60);
    rd.init(this.pts, prev, 1 / 60, g.restHeadRel);
    if (o.wallX !== undefined) rd.wallX = o.wallX;
    rd.hit(o);
    this.ragdoll = rd;
    this.actions = [];
    // the gun falls free
    if (this.gun && this.gunVisible) {
      this.props.push({ kind: 'gun', x: this.gx, y: this.gy, vx: (o.impulse?.x ?? 0) * 0.2 + 20, vy: -60, a: this.ga, va: 4, life: 3, k: this.gk, src: this.gun.full, flip: this.anchors?.flip });
      this.gunVisible = false;
    }
    void P_HEADBASE;
  }

  // ------------------------------------------------------------------ props
  private spawnMag() {
    const g = this.gun, a = this.anchors;
    if (!g?.mag || !a?.mag) return;
    const atHand = this.magState === 'hand' || this.magState === 'none';
    const x = atHand ? this.palmNX : this.gx, y = atHand ? this.palmNY : this.gy;
    this.props.push({ kind: 'mag', x, y, vx: -20 + this.r() * 30, vy: 10, a: this.rhoN, va: (this.r() - 0.5) * 6, life: 4, k: this.gk, src: g.mag, flip: a.flip });
  }
  private spawnCasing(shell = false) {
    const a = this.anchors;
    if (!a) return;
    const [x, y] = this.gunPt([((a.rack?.[0] ?? a.grip[0]) - a.grip[0]) * this.gk * (a.flip ? -1 : 1), ((a.rack?.[1] ?? a.grip[1]) - a.grip[1]) * this.gk]);
    this.props.push({ kind: shell ? 'shell' : 'casing', x, y, vx: -40 - this.r() * 50, vy: -120 - this.r() * 60, a: this.r() * 6, va: 18 * (this.r() - 0.5), life: 1.6, k: 1 });
  }
  private spawnLoader() {
    this.props.push({ kind: 'loader', x: this.palmNX, y: this.palmNY, vx: 10, vy: 20, a: 0, va: 3, life: 3, k: 1 });
  }
  private updateProps(dt: number) {
    for (const p of this.props) {
      p.life -= dt;
      if (p.rest) continue;
      p.vy += 1100 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      if (p.y > -2) { p.y = -2; p.vy *= -0.25; p.vx *= 0.5; p.va *= 0.5; if (Math.abs(p.vy) < 20) { p.rest = true; p.a = Math.round(p.a / Math.PI) * Math.PI; } }
    }
    if (this.props.length) this.props = this.props.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------ draw
  /**
   * Draw at (x, y) = ground point under the body, scale = display px per rig unit
   * (display height / 240), facing +1 right / -1 left. Falls back to the single
   * full-body sprite (procedural bob) when the part atlas is missing.
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: 1 | -1, fallback?: CanvasImageSource) {
    this.dx = x; this.dy = y; this.ds = scale; this.df = facing;
    const as = this.asset;
    if (!as || !this.geo) { this.drawFallback(ctx, x, y, scale, facing, fallback); return; }
    if (this.ragdoll) this.poseFromRagdoll();
    const flash = this.flashT > 0;
    const atlas = as.atlas;
    // far side
    this.part(ctx, as.dark, F_TH, 'thigh');
    this.part(ctx, as.dark, F_SN, 'shin');
    this.part(ctx, as.dark, F_FT, 'foot');
    this.part(ctx, as.dark, F_UA, 'upperArm');
    this.part(ctx, as.dark, F_FA, 'forearm');
    if (this.gunState === 'slung' && this.gun && this.weaponId && this.anchors?.hold !== 'melee') this.drawSlung(ctx);
    if (this.anchors?.hold === 'bow' && this.gunVisible) this.drawGun(ctx);
    // trunk
    this.part(ctx, atlas, TORSO, 'torso');
    this.part(ctx, atlas, HEAD, 'head', this.headFlip > 0.5);
    this.part(ctx, atlas, N_TH, 'thigh');
    this.part(ctx, atlas, N_SN, 'shin');
    this.part(ctx, atlas, N_FT, 'foot');
    if (this.gunVisible && this.anchors?.hold !== 'bow' && this.anchors?.hold !== 'melee') this.drawGun(ctx);
    // far (trigger) hand wraps the grip: in front of the gun
    this.part(ctx, this.weaponId && this.kind === 'survivor' && this.gunState === 'held' ? atlas : as.dark, F_H, this.handF);
    if (this.fprop) this.drawProp(ctx, this.fprop, this.palmFX, this.palmFY, this.rhoF);
    if (this.anchors?.hold === 'bow' && this.gunVisible) this.drawString(ctx);
    // contact shadow of the near arm, then the arm
    ctx.globalAlpha = 0.28;
    this.part(ctx, as.shadow, N_UA, 'upperArm', false, 2.5, 3);
    this.part(ctx, as.shadow, N_FA, 'forearm', false, 2.5, 3);
    ctx.globalAlpha = 1;
    this.part(ctx, atlas, N_UA, 'upperArm');
    this.part(ctx, atlas, N_FA, 'forearm');
    if (this.magState === 'hand' && this.gun?.mag) this.drawMagInHand(ctx);
    if (this.prop) this.drawProp(ctx, this.prop, this.palmNX, this.palmNY, this.rhoN);
    this.part(ctx, atlas, N_H, this.handN);
    if (this.gunVisible && this.anchors?.hold === 'melee') this.drawGun(ctx);
    if (flash) {
      ctx.globalAlpha = 0.65;
      for (let i = 0; i < PART_COUNT; i++) this.part(ctx, as.flash, i, i === N_H ? this.handN : i === F_H ? this.handF : PART_NAMES[i]);
      ctx.globalAlpha = 1;
    }
    this.drawProps(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Debug overlay: bones as lines, joints as dots, the gun grip as a cross. */
  drawSkeleton(ctx: CanvasRenderingContext2D) {
    const p = this.pts, S = this.ds, F = this.df;
    ctx.setTransform(S * F, 0, 0, S, this.dx, this.dy);
    ctx.lineWidth = 1.5 / S;
    ctx.strokeStyle = '#0ff';
    ctx.beginPath();
    for (const [a, b] of PART_POINTS) { ctx.moveTo(p[a * 2], p[a * 2 + 1]); ctx.lineTo(p[b * 2], p[b * 2 + 1]); }
    ctx.stroke();
    ctx.fillStyle = '#ff0';
    for (let i = 0; i < RAGDOLL_POINTS; i++) { ctx.beginPath(); ctx.arc(p[i * 2], p[i * 2 + 1], 2 / S, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#f0f';
    ctx.beginPath(); ctx.moveTo(this.gx - 4, this.gy); ctx.lineTo(this.gx + 4, this.gy); ctx.moveTo(this.gx, this.gy - 4); ctx.lineTo(this.gx, this.gy + 4); ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Draw the settled body darkened, e.g. into a ground-decal canvas, then free the sim. */
  bakeCorpse(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: 1 | -1) {
    const f = ctx.filter;
    ctx.filter = 'brightness(0.55) saturate(0.7)';
    const props = this.props;
    this.props = [];
    this.draw(ctx, x, y, scale, facing);
    this.props = props;
    ctx.filter = f;
    this.ragdoll = null;
  }

  private poseFromRagdoll() {
    const r = this.ragdoll!, J = this.jx, K = this.jy, A = this.ja;
    for (let i = 0; i < PART_COUNT; i++) {
      const [a, b] = PART_POINTS[i];
      J[i] = r.x[a]; K[i] = r.y[a];
      A[i] = Math.atan2(r.y[b] - r.y[a], r.x[b] - r.x[a]);
    }
    const P = this.asset!.meta.parts;
    // hands keep their pose art: bone angle (wrist→tip) already accounts for the art's rest
    void P;
    this.rhoN = A[N_H] - (P[this.handN]?.rest ?? 0);
    this.rhoF = A[F_H] - (P[this.handF]?.rest ?? 0);
    this.magState = this.magState === 'hand' ? 'none' : this.magState;
    this.prop = null; this.fprop = null;
  }

  private part(ctx: CanvasRenderingContext2D, src: CanvasImageSource, i: number, name: string, mirror = false, ox = 0, oy = 0) {
    const m: PartMeta | undefined = this.asset!.meta.parts[name];
    if (!m) return;
    const S = this.ds, F = this.df;
    const r = this.ja[i] - m.rest;
    const c = Math.cos(r), s = Math.sin(r);
    const mx = mirror ? -1 : 1;
    ctx.setTransform(S * F * c * mx, S * s, -S * F * s * mx, S * c, this.dx + S * F * (this.jx[i] + ox), this.dy + S * (this.jy[i] + oy));
    ctx.drawImage(src, m.x, m.y, m.w, m.h, -m.px, -m.py, m.w, m.h);
  }

  private setGunXf(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, flip?: boolean) {
    const S = this.ds, F = this.df, c = Math.cos(a), s = Math.sin(a), fl = flip ? -1 : 1;
    ctx.setTransform(S * F * c * k * fl, S * s * k * fl, -S * F * s * k, S * c * k, this.dx + S * F * x, this.dy + S * y);
  }

  private drawGun(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    const img = this.magState === 'gun' ? g.full : g.img;
    if (a.reload === 'break' && this.ch.cyl > 0.01 && a.rack) {
      // break action: barrels hinge down about the hinge pin (the rack anchor)
      const hx = a.rack[0];
      this.setGunXf(ctx, this.gx, this.gy, this.ga, this.gk, a.flip);
      ctx.drawImage(img, 0, 0, hx, g.h, -a.grip[0], -a.grip[1], hx, g.h);
      const [px, py] = this.gunPt([(a.rack[0] - a.grip[0]) * this.gk, (a.rack[1] - a.grip[1]) * this.gk]);
      this.setGunXf(ctx, px, py, this.ga + 0.42 * this.ch.cyl, this.gk, a.flip);
      ctx.drawImage(img, hx, 0, g.w - hx, g.h, 0, -a.rack[1], g.w - hx, g.h);
    } else {
      this.setGunXf(ctx, this.gx, this.gy, this.ga, this.gk, a.flip);
      ctx.drawImage(img, -a.grip[0], -a.grip[1]);
    }
    if (a.reload === 'revolver' && this.ch.cyl > 0.01 && a.port) {
      // swung-out cylinder
      const [cx, cy] = this.gunPt([(a.port[0] - a.grip[0]) * this.gk, (a.port[1] - a.grip[1]) * this.gk], 0, 6 * this.ch.cyl);
      this.setGunXf(ctx, cx, cy, this.ga, 1);
      ctx.fillStyle = '#2b2a2c'; ctx.strokeStyle = '#0c0b0c'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.rect(-5, -3.2, 10, 6.4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b08a3e';
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(5, i * 2, 0.9, 0, Math.PI * 2); ctx.fill(); }
    }
    if (this.flashMuzzle > 0) {
      const [mx, my] = this.gunPt([(a.muzzle[0] - a.grip[0]) * this.gk * (a.flip ? -1 : 1), (a.muzzle[1] - a.grip[1]) * this.gk]);
      this.setGunXf(ctx, mx, my, this.ga, 1);
      ctx.fillStyle = 'rgba(255,214,120,0.95)';
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(16, 0); ctx.lineTo(0, 3); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,220,0.9)'; ctx.beginPath(); ctx.arc(2, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  private drawSlung(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    const T = this.ja[TORSO];
    const k = a.len / g.w;
    const x = this.jx[TORSO] + Math.cos(T) * this.geo!.torsoLen * 0.55 - Math.sin(T) * -10;
    const y = this.jy[TORSO] + Math.sin(T) * this.geo!.torsoLen * 0.55 + Math.cos(T) * -10;
    this.setGunXf(ctx, x, y, T + Math.PI * 0.62, k, a.flip);
    ctx.drawImage(g.full, -g.w / 2, -a.grip[1]);
  }
  private drawString(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    const top = this.gunPt([(4 - a.grip[0]) * this.gk, (20 - a.grip[1]) * this.gk]);
    const bot = this.gunPt([(g.w - 4 - a.grip[0]) * this.gk, (20 - a.grip[1]) * this.gk]);
    ctx.setTransform(this.ds * this.df, 0, 0, this.ds, this.dx, this.dy);
    ctx.strokeStyle = 'rgba(225,215,190,0.85)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(this.palmFX, this.palmFY); ctx.lineTo(bot[0], bot[1]); ctx.stroke();
    if (this.ch.draw > 0.3) {
      // the nocked arrow
      const [bx, by] = this.gunPt([0, 0]);
      ctx.strokeStyle = '#6b5236'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(this.palmFX, this.palmFY); ctx.lineTo(bx + Math.cos(this.aimAngle) * 14, by + Math.sin(this.aimAngle) * 14); ctx.stroke();
    }
  }
  private drawMagInHand(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    this.setGunXf(ctx, this.palmNX, this.palmNY, this.rhoN, this.gk, a.flip);
    ctx.drawImage(g.mag!, -a.mag![2] / 2, -4);
  }
  private drawProp(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, rho: number) {
    this.setGunXf(ctx, x, y, rho - Math.PI / 2, 1);
    if (kind === 'shell') { ctx.fillStyle = '#8f2a22'; ctx.fillRect(-1.6, -6, 3.2, 7); ctx.fillStyle = '#c8a050'; ctx.fillRect(-1.7, 1, 3.4, 1.8); }
    else if (kind === 'round') { ctx.fillStyle = '#c8a050'; ctx.fillRect(-1, -5, 2, 5); ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-0.8, -6.3, 1.6, 1.4); }
    else if (kind === 'speedloader') { ctx.fillStyle = '#1d1c1e'; ctx.fillRect(-3.5, -2, 7, 3); ctx.fillStyle = '#c8a050'; ctx.fillRect(-3, 1, 6, 3); }
    else if (kind === 'arrow') { ctx.strokeStyle = '#6b5236'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -40); ctx.stroke(); }
  }
  private drawProps(ctx: CanvasRenderingContext2D) {
    for (const p of this.props) {
      ctx.globalAlpha = clamp(p.life / 0.5, 0, 1);
      if (p.src && (p.kind === 'mag' || p.kind === 'gun')) {
        this.setGunXf(ctx, p.x, p.y, p.a, p.k, p.flip);
        const im = p.src as HTMLCanvasElement;
        ctx.drawImage(im, -im.width / 2, -im.height / 2);
      } else {
        this.setGunXf(ctx, p.x, p.y, p.a, 1);
        if (p.kind === 'casing') { ctx.fillStyle = '#c9a34e'; ctx.fillRect(-1.6, -0.7, 3.2, 1.4); }
        else if (p.kind === 'shell') { ctx.fillStyle = '#8f2a22'; ctx.fillRect(-3, -1.2, 6, 2.4); ctx.fillStyle = '#c8a050'; ctx.fillRect(2, -1.3, 1.5, 2.6); }
        else { ctx.fillStyle = '#1d1c1e'; ctx.fillRect(-3.5, -1.5, 7, 3); }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFallback(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: 1 | -1, im?: CanvasImageSource) {
    if (!im) return;
    const w = (im as HTMLImageElement).width, h = (im as HTMLImageElement).height;
    const hh = 240 * scale, ww = (w / h) * hh;
    const bob = Math.abs(Math.sin(this.phase * Math.PI * 2)) * 2 * this.moving;
    // single sprites face right for survivors and left for the Turned
    const native = this.kind === 'turned' ? -1 : 1;
    ctx.setTransform(facing * native, 0, 0, 1, x, y - bob);
    ctx.drawImage(im, -ww / 2, -hh, ww, hh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// ---- keyframe sampling
function sampleKeys(keys: Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t <= k1[0]) {
      const k0 = keys[i - 1];
      const u = (t - k0[0]) / Math.max(1e-6, k1[0] - k0[0]);
      return lerp(k0[1], k1[1], ease(k1[2], u));
    }
  }
  return keys[keys.length - 1][1];
}
function bracket(keys: TKey[], t: number): { k0: TKey | null; k1: TKey | null; u: number } {
  if (t <= keys[0][0]) return { k0: keys[0], k1: keys[0], u: 0 };
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return { k0: keys[i - 1], k1: keys[i], u: (t - keys[i - 1][0]) / Math.max(1e-6, keys[i][0] - keys[i - 1][0]) };
  }
  const l = keys[keys.length - 1];
  return { k0: l, k1: l, u: 1 };
}
export { wrapAngle };
