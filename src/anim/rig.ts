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
import { bakedIcon, getGun, getRig, loadGun, loadRig, type BakedIcon, type GunAsset, type GunLook, type KitDraw, type PartMeta, type RigAsset, type UnitDraw } from './assets';
import { CLIPS, RELOADS, type Clip, type Key, type TKey } from './clips';
import { GAITS, applyGait, jitterGait, strideScale, cycleLen, type Gait } from './gait';
import { clamp, ease, ik2, lerp, lerpAngle, rng, wrapAngle } from './math';
import { DieOpts, PART_POINTS, P_HEADBASE, RAGDOLL_POINTS, Ragdoll } from './ragdoll';
import {
  BODY_POINTS, CH_DEFAULT, F_FA, F_FT, F_H, F_SN, F_TH, F_UA, HEAD, N_FA, N_FT, N_H, N_SN, N_TH, N_UA, PART_COUNT, PART_NAMES, TORSO,
  geomOf, type Channels, type NumCh, type RigGeom, type Target,
} from './skeleton';
import { STYLES, type Style } from './styles';
import { flipFrame, setTemplateFactory } from './flipbook';
import { anchorsFor, stanceOf, type WeaponAnchors } from './weaponAnchors';
import { STANCES, type Slot, type Stance, type StanceId } from './stances';

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
  /** false: use the gait preset exactly (no per-instance variation) */
  jitter?: boolean;
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
/** how far (0..1) each unit drawing leans toward the other's gun angle while aim and low ready cross-dissolve */
const UNIT_SWING = 0.4;
/** recoil: the gun slides back KICK_GUN rig px per unit of spring, the body rocks KICK_BODY times the stance's
 * recoilLean/recoilBack; each shot raises the muzzle CLIMB_SHOT rad × strength (capped at CLIMB_MAX) */
const KICK_GUN = 9, KICK_BODY = 6, CLIMB_SHOT = 0.045, CLIMB_MAX = 0.2;
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
  runGait: Gait | null = null;
  crawling = false;
  onEvent?: (name: string, rig: Rig) => void;
  /** set by the game each frame: ground speed in px/s (display space) */
  speedPx = 0;
  phase = 0;
  moving = 0;
  /** stride scale for the current ground speed (gait.ts strideScale); the crowd flipbook bakes it in */
  strideK = 1;
  /** the stride scale as the crowd flipbook buckets it (frames are keyed by it) */
  get strideKey() { return Math.round(this.strideK * 20) / 20; }
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
  /** shooting stance of the held weapon (stances.ts): feet, lean, pocket, low ready, draw order */
  stance: Stance = STANCES.free;
  /** a firearm in the hands: the support role (clip hand `n`) is solved on the FAR arm and the
   * trigger role (`f`) on the NEAR arm (the camera sees the right side of a right-handed shooter) */
  swap = false;
  /** 0..1 low ready (muzzle down, stock still in the shoulder): not aiming, or walking without firing */
  lowW = 0;
  private lastFire = -9;
  aimWX = 0; aimWY = 0; hasAim = false;
  aimAngle = 0;
  /** closed-loop aim trim: keeps the barrel itself on the aim point (the solve aims from the shoulder) */
  aimCorr = 0;
  /** the unit drawing that leads this frame (assets.ts UnitDraw: torso + head + arms + gun drawn as one piece:
   * aim, low ready or reload), its rotation from the drawing's own angle and where its pelvis is drawn (rig space);
   * null = the rigged head, arms, hands and gun icon lead. The gun frame (muzzleWorld, flashes, casings, mags)
   * follows the leading drawing. */
  unit: UnitDraw | null = null;
  unitRot = 0; unitX = 0; unitY = 0;
  /** every unit drawing on screen this frame, back to front, with its opacity: two while one dissolves into the
   * other (aim ↔ low ready ↔ reload). cutA = opacity of the rigged head / arms / hands / gun under them. */
  unitDraws: { u: UnitDraw; x: number; y: number; rot: number; a: number }[] = [];
  cutA = 1;
  /** closed-loop hip height: px the pelvis is raised so the straighter knee sits at a natural soft bend */
  legTrim = 0;
  recoil = 0; recoilV = 0;
  /** muzzle climb (radians, the barrel rises): each shot adds to it, it settles back in ~0.3 s; under
   * sustained fire it recovers slower, so an automatic walks up a little */
  climb = 0;
  flashT = 0;
  private lastFlashT = -9;
  /** The hit flash, at most every 0.22 s: under sustained fire (an MG on a big body) it would
   *  otherwise stay on and the body would read as a pale blob. */
  flashHit(dur = 0.07) { if (this.t - this.lastFlashT < 0.22) return; this.lastFlashT = this.t; this.flashT = Math.max(this.flashT, dur); }
  // last draw transform (so aimAt can take world coords)
  dx = 0; dy = 0; ds = 0.5; df = 1;
  // layers
  actions: Active[] = [];
  // solved pose (rig space)
  jx = new Float32Array(PART_COUNT);
  jy = new Float32Array(PART_COUNT);
  ja = new Float32Array(PART_COUNT);
  /** hand art per ROLE (n = support, f = trigger); see nearHand / farHand for the physical sides */
  handN = 'hand'; handF = 'hand';
  get nearHand() { return this.swap ? this.handF : this.handN; }
  get farHand() { return this.swap ? this.handN : this.handF; }
  gx = 0; gy = 0; ga = 0; gk = 1; gunVisible = false;
  rhoN = 0; rhoF = 0; palmNX = 0; palmNY = 0; palmFX = 0; palmFY = 0;
  pts = new Float32Array(RAGDOLL_POINTS * 2);
  prevPts = new Float32Array(RAGDOLL_POINTS * 2);
  hasPts = false;
  // death
  ragdoll: Ragdoll | null = null;
  dead = false;
  props: Prop[] = [];
  /** crowd LOD: draw from the shared flipbook while only walking (see flipbook.ts) */
  lod = false;
  /** idle behaviours scheduled automatically when standing still (Turned) */
  autoIdle = false;
  /** the head is gone (blown off): never drawn */
  hideHead = false;
  /** per-look atlases set by the game each frame (lane grade, variant tint, light): null = plain */
  /** atlas/dark carry a per-part ink line (used for the near arm, which must read over the body);
   * plain/plainDark have none: everything else is inked once, round the whole silhouette (`outline`),
   * so knees, neck and elbows show no seam lines */
  skin: { atlas: CanvasImageSource; dark: CanvasImageSource; grow?: number; plain?: CanvasImageSource; plainDark?: CanvasImageSource } | null = null;
  /** lane grade + ink width for the held weapon (set with skin): the gun is baked to match the body */
  gunLook: GunLook | null = null;
  /** ink outline stamped under the body: a dilated silhouette atlas grown by `grow` atlas px */
  outline: { src: CanvasImageSource; grow: number } | null = null;
  /** rim band: a silhouette atlas offset by (dx, dy) display px, drawn between outline and body */
  rim: { src: CanvasImageSource; dx: number; dy: number; alpha: number } | null = null;
  /** extra flat overlays after the body (burning, a crosshair edge…): atlas + alpha */
  overlay: { src: CanvasImageSource; alpha: number } | null = null;
  /** key of the look above, for the shared crowd flipbook frames */
  lookKey = '';
  /** set by the game once the rig has been drawn (bone positions are in world space) */
  hasDrawn = false;
  /** flipbook frames are baked at this scale (the lane's), then drawn at the body's own */
  lodScale = 0;
  /** camera transform of the last draw (shake / hitstop offsets) */
  private cam: DOMMatrix2DInit | null = null;
  private baseAlpha = 1;
  private idleIn = 3;
  private r: () => number;

  constructor(kind: RigKind, spriteId: string, o: CreateOpts) {
    this.kind = kind;
    this.spriteId = spriteId;
    this.seed = o.seed ?? nextSeed++ * 7919;
    this.r = rng(this.seed);
    this.style = STYLES[o.style ?? (kind === 'survivor' ? 'survivor' : 'sleeper')] ?? STYLES.sleeper;
    const walk = o.gait ?? this.style.walks[Math.floor(this.r() * this.style.walks.length)];
    this.baseGait = kind === 'turned' && o.jitter !== false ? jitterGait(GAITS[walk] ?? GAITS.walk, this.r) : GAITS[walk] ?? GAITS.walk;
    this.gait = this.baseGait;
    // a Turned style with a run (Deer): breaks into it when the walk would have to overstride
    if (kind === 'turned' && this.style.run && GAITS[this.style.run]) this.runGait = jitterGait(GAITS[this.style.run], this.r);
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
  /** Put a weapon in the hands. stance: override the weapon's stance (stances.ts), e.g. 'hip' for an SMG fired from the hip. */
  setWeapon(defId: string | null, opts: { oneHand?: boolean; stance?: StanceId } = {}) {
    this.weaponId = defId;
    this.oneHand = !!opts.oneHand;
    this.magState = 'gun';
    this.prop = null;
    this.gunState = 'held';
    if (!defId) { this.anchors = null; this.gun = null; this.stance = STANCES.free; this.swap = false; return; }
    this.anchors = anchorsFor(defId);
    this.stance = this.kind === 'survivor' ? STANCES[opts.stance ?? stanceOf(this.anchors, this.oneHand)] : STANCES.free;
    this.swap = this.kind === 'survivor' && this.anchors.hold !== 'melee';
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
    const hold = this.anchors?.hold;
    // handguns flip at the wrist; a stock in the shoulder climbs less
    const flip = this.stance.id === 'pistol' || this.stance.id === 'pistol1' ? 1.35 : this.stance.id === 'hip' ? 1.1 : hold === 'bow' ? 0 : 0.8;
    this.climb = Math.min(CLIMB_MAX, this.climb + CLIMB_SHOT * strength * flip * (0.85 + this.r() * 0.3));
    this.lastFire = this.t;
    this.ch.flash = 1;
    this.flashMuzzle = 0.06;
    const a = this.anchors;
    if (a && (a.reload === 'mag' || a.reload === 'pistolMag') && this.gun) this.spawnCasing();
  }
  flashMuzzle = 0;

  /** Hit reaction by zone. Turned: a crippling leg hit may drop them to a crawl. */
  hit(zone: 'head' | 'torso' | 'arm' | 'leg', o: { cripple?: boolean; flash?: boolean } = {}) {
    if (this.dead) return;
    if (o.flash === false) this.flashT = 0; else this.flashHit(0.09);
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
  die(o: DieOpts & { authored?: boolean; authoredDur?: number; worldImpulse?: { x: number; y: number }; wallWorldX?: number } = {}) {
    if (this.dead) return;
    const opts: DieOpts = { ...o };
    if (o.worldImpulse) opts.impulse = { x: (o.worldImpulse.x * this.df) / this.ds, y: o.worldImpulse.y / this.ds };
    if (o.wallWorldX !== undefined) opts.wallX = ((o.wallWorldX - this.dx) * this.df) / this.ds;
    const authored = this.style.deaths.filter((d) => d !== 'ragdoll' && CLIPS[d]);
    if (o.authored !== false && authored.length && (o.authored || this.r() < authored.length / this.style.deaths.length)) {
      const id = authored[Math.floor(this.r() * authored.length)];
      this.actions = this.actions.filter((a) => a.clip.add);
      this.play(id, { duration: o.authoredDur, onEvent: (n) => { if (n === 'ragdoll' || n === 'burst') this.startRagdoll(opts); } });
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
    if (this.baked) return;
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
    if (this.runGait && (this.gait === this.baseGait || this.gait === this.runGait)) {
      const kw = strideScale(this.baseGait, g.legLen, speedRig);
      if (this.gait === this.baseGait && kw >= 1.12) this.gait = this.runGait;
      else if (this.gait === this.runGait && kw < 0.98) this.gait = this.baseGait;
    }
    const gait = this.gait;
    // cadence = ground speed / body travel per cycle, so a planted foot (a crawler's planted hand)
    // moves back at exactly ground speed. A Turned shortens its stride below its gait's natural
    // pace (strideScale). In the crowd LOD the flipbook draws the un-jittered preset at a bucketed
    // stride scale, so the cadence follows that preset there (no skating in the flipbook either).
    const lg = this.lod ? GAITS[gait.id] ?? gait : gait;
    if (this.kind === 'turned' && speedRig > 1) this.strideK += (strideScale(lg, g.legLen, speedRig) - this.strideK) * Math.min(1, dt * 3);
    const k = this.lod ? this.strideKey : this.strideK;
    this.phase = (this.phase + (dt * speedRig) / Math.max(1, cycleLen(lg, g, k, this.moving))) % 1;
    const ch = this.ch;
    Object.assign(ch, CH_DEFAULT);
    applyGait(ch, gait, this.phase, g, this.moving, k);
    if (this.swap && !gait.crawl) this.stanceLayer(dt, g);
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
    // climb recovers fast between aimed shots, slowly while the trigger stays down
    this.climb *= Math.exp(-dt * (this.t - this.lastFire < 0.16 ? 2.2 : 7));
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

  /**
   * Firearm stance (before the clips, so a reload or a duck still bends it): the weak (far) foot
   * leads, the strong (near) foot is back, soft knees; and the low-ready weight (muzzle down with
   * the stock still in the shoulder while not aiming, or walking without having fired lately).
   */
  private stanceLayer(dt: number, g: RigGeom) {
    const st = this.stance, ch = this.ch, L = g.legLen;
    const w = 1 - this.moving;
    ch.nFx += (st.feet[0] * L - ch.nFx) * w;
    ch.fFx += (st.feet[1] * L - ch.fFx) * w;
    ch.py += (-L * st.height - ch.py) * w;
    const low = !this.hasAim || (this.moving > 0.5 && this.t - this.lastFire > 1.2) ? 1 : 0;
    this.lowW += (low - this.lowW) * Math.min(1, dt * 6);
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
      aim = clamp(Math.atan2(ly - sy, Math.max(8, lx - sx)) + this.aimCorr, -1.2, 1.0);
    }
    this.aimAngle = aim;
    const st = this.stance, lr = this.swap ? this.lowW : 0;
    // aimW: the gun is up in the aim pose (not in the reload workspace); raise: and not at low ready
    const aimW = holding && this.gunState === 'held' && a!.hold !== 'melee' ? 1 - ch.ready : 0;
    const raise = aimW * (1 - lr);
    if (holding && a!.hold !== 'melee') {
      // nose over the toes: the stance's lean, more of it when the gun is up; the head follows the sights
      ch.lean += st.lean * aimW * (1 - 0.45 * lr) + aim * st.leanAim * raise;
      ch.head += aim * st.headAim * raise + 0.12 * lr * aimW;
      // recoil rocks the shoulder back (the feet stay planted)
      ch.lean -= this.recoil * st.recoilLean * KICK_BODY;
      ch.px -= this.recoil * st.recoilBack * KICK_BODY;
    }
    // ---- trunk
    const crouchDrop = ch.crouch * g.legLen * 0.5;
    const pelX = ch.px, pelY = ch.py + crouchDrop - this.legTrim;
    const tiltA = -Math.PI / 2 + ch.tilt;
    let T = tiltA + ch.lean;
    if (this.placeUnits(holding, aim, lr, pelX, pelY)) {
      const u = this.unit!;
      T = Math.atan2(u.neck[1] - u.pelvis[1], u.neck[0] - u.pelvis[0]) + this.unitRot;
    }
    const ux = Math.cos(T), uy = Math.sin(T), vx = -uy, vy = ux;
    const pux = Math.cos(tiltA), puy = Math.sin(tiltA), pvx = -puy, pvy = pux;
    const J = this.jx, K = this.jy, A = this.ja;
    J[TORSO] = pelX; K[TORSO] = pelY; A[TORSO] = T;
    const neckX = pelX + ux * g.torsoLen, neckY = pelY + uy * g.torsoLen;
    J[HEAD] = neckX; K[HEAD] = neckY; A[HEAD] = T + g.restHeadRel + ch.head;
    const shX = pelX + ux * g.sh[0] + vx * g.sh[1], shY = pelY + uy * g.sh[0] + vy * g.sh[1];
    // the far shoulder: behind the near one bare-handed, ahead of it in a bladed long-gun stance
    const fOff = holding && a!.hold !== 'melee' && this.swap ? st.farSh * g.height : g.fShOff;
    const fshX = shX + vx * fOff, fshY = shY + vy * fOff;
    J[N_UA] = shX; K[N_UA] = shY; J[F_UA] = fshX; K[F_UA] = fshY;
    J[N_TH] = pelX + pux * g.nHip[0] + pvx * g.nHip[1]; K[N_TH] = pelY + puy * g.nHip[0] + pvy * g.nHip[1];
    J[F_TH] = pelX + pux * g.fHip[0] + pvx * g.fHip[1]; K[F_TH] = pelY + puy * g.fHip[0] + pvy * g.fHip[1];
    // ---- legs
    this.solveLeg(N_TH, N_SN, N_FT, ch.nFx, ch.nFy, ch.nHip, ch.nKnee, ch.nAnk, tiltA);
    this.solveLeg(F_TH, F_SN, F_FT, ch.fFx, ch.fFy, ch.fHip, ch.fKnee, ch.fAnk, tiltA);
    // standing and walking people stand on nearly straight legs (knee ~7° soft standing, ~10° at
    // mid-stance walking): the stance/gait heights are guesses against each rig's own bone lengths,
    // so measure the straighter knee and trim the hips toward it (not while a clip crouches on purpose)
    // The Turned do the same toward their gait's own bend (gait.knee: loose for a shambler, deep
    // for a stalker), so one preset reads the same on every body's bone lengths.
    if (ch.footIK > 0.5 && ch.crouch < 0.05 && !this.gait.crawl) {
      const bend = (t: number, s2: number) => Math.abs(Math.atan2(Math.sin(A[s2] - A[t]), Math.cos(A[s2] - A[t])));
      const b = Math.min(bend(N_TH, N_SN), bend(F_TH, F_SN));
      const want = this.kind === 'survivor' ? 0.12 + 0.06 * this.moving : (this.lod ? GAITS[this.gait.id] ?? this.gait : this.gait).knee;
      this.legTrim = clamp(this.legTrim + (b - want) * g.legLen * 0.12, (this.kind === 'survivor' ? -0.04 : -0.12) * g.legLen, 0.16 * g.legLen);
    }
    // ---- weapon placement
    this.gunVisible = false;
    let defN: HandT = null, defF: HandT = null;
    const gun = this.gun;
    if (holding && gun && this.gunState === 'held' && a!.hold !== 'melee') {
      this.gunVisible = true;
      const k = (a!.len / gun.w) * this.unitGunScale();
      const fl = a!.flip ? -1 : 1;
      this.gk = k;
      const loc = (p: [number, number]): [number, number] => [(p[0] - a!.grip[0]) * k * fl, (p[1] - a!.grip[1]) * k];
      const muz = loc(a!.muzzle);
      let gAimA = 0, gX = 0, gY = 0;
      const reach = (g.ua + g.fa);
      // the support (role n) and trigger (role f) shoulders: far / near with a firearm
      const nsX = this.swap ? fshX : shX, nsY = this.swap ? fshY : shY;
      const lowA = st.lowAngle;
      if (a!.hold === 'long' || a!.hold === 'tube') {
        // butt in the near shoulder pocket, butt-to-muzzle line on the target; at low ready the
        // muzzle dips about the stock, which stays in (a touch lower in) the shoulder
        const butt = loc(a!.butt ?? a!.grip);
        const up = st.pocket[0] - st.lowDrop * lr, fw = g.sh[1] + st.pocket[1];
        const pocketX = neckX + vx * fw + ux * up, pocketY = neckY + vy * fw + uy * up;
        const d = Math.atan2(muz[1] - butt[1], muz[0] - butt[0]);
        gAimA = lerpAngle(aim, Math.max(aim, lowA), lr) - d;
        const c = Math.cos(gAimA), s = Math.sin(gAimA);
        gX = pocketX - (butt[0] * c - butt[1] * s); gY = pocketY - (butt[0] * s + butt[1] * c);
      } else if (a!.hold === 'pistol') {
        // arms out from the near shoulder (isosceles from the side); low ready: out and down
        // the grip (palm) goes out along the line of the arms to the wrist's reach plus the palm's
        // offset from the wrist: elbows nearly locked (~160°), the gun ~0.4 H out from the chest
        const ext = (st.ext ?? 0.85) * (1 - 0.18 * lr);
        const ae = lerp(aim, Math.max(aim, lowA), lr);
        gAimA = ae - Math.atan2(muz[1], muz[0]) * 0.5;
        const D = reach * ext + 8, la = ae - Math.asin(clamp(st.pocket[0] / D, -0.5, 0.5));
        gX = shX + Math.cos(la) * D; gY = shY + Math.sin(la) * D;
      } else if (a!.hold === 'bow') {
        const ae = lerp(aim, Math.max(aim, lowA), lr);
        gAimA = ae - Math.PI / 2;
        gX = nsX + Math.cos(ae) * reach * 0.93; gY = nsY + Math.sin(ae) * reach * 0.93;
      }
      // reload workspace: the gun comes down and in to the chest, canted by gunTilt (clips' `ready`)
      const rX = pelX + ux * g.torsoLen * 0.5 + vx * 22 + ch.gunDX, rY = pelY + uy * g.torsoLen * 0.5 + vy * 22 + ch.gunDY;
      const rA = (a!.hold === 'bow' ? -Math.PI / 2 + 0.3 : 0.12) + ch.gunTilt;
      const rw = ch.ready;
      this.ga = lerpAngle(gAimA + ch.gunTilt * 0.3, rA, rw) - this.recoil * 0.03 - this.climb * (1 - rw);
      this.gx = lerp(gX, rX, rw) - Math.cos(this.ga) * this.recoil * KICK_GUN;
      this.gy = lerp(gY, rY, rw) - Math.sin(this.ga) * this.recoil * KICK_GUN;
      if (this.unit) {
        // the drawn gun: the muzzle from the leading unit, the gun frame along its barrel (muzzleWorld, flashes,
        // casings, the mag in the reload clip)
        const u = this.unit, c = Math.cos(this.unitRot), s = Math.sin(this.unitRot);
        const mx = u.muzzle[0] - u.pelvis[0], my = u.muzzle[1] - u.pelvis[1];
        const kick = this.recoil * KICK_GUN;
        this.ga = this.unitRot + u.bore;
        const wx = this.unitX + mx * c - my * s - Math.cos(this.ga) * kick, wy = this.unitY + mx * s + my * c - Math.sin(this.ga) * kick;
        this.gx = wx - (muz[0] * Math.cos(this.ga) - muz[1] * Math.sin(this.ga));
        this.gy = wy - (muz[0] * Math.sin(this.ga) + muz[1] * Math.cos(this.ga));
      }
      // the barrel, not the shoulder, onto the aim point: measure the bore line's miss and trim next frame
      if (this.hasAim && rw < 0.05 && aimW > 0.95 && a!.hold !== 'bow') {
        const lx = ((this.aimWX - this.dx) * this.df) / this.ds, ly = (this.aimWY - this.dy) / this.ds;
        const [mx, my] = this.gunPt(muz);
        // the climb is the shot's kick, not an aiming error: leave it out or the trim fights it
        const bore = this.ga + this.recoil * 0.03 + this.climb + (muz[0] < 0 ? Math.PI : 0);
        const d = Math.hypot(lx - mx, ly - my);
        const ahead = (lx - mx) * Math.cos(bore) + (ly - my) * Math.sin(bore);
        if (d > 20 && ahead > 12) {
          let err = Math.atan2(ly - my, lx - mx) - bore;
          err = Math.atan2(Math.sin(err), Math.cos(err));
          // turning the gun about the shoulder also swings the muzzle, which moves the target's
          // bearing from it by about r/d as much again: scale the gain so a near target can't ring
          const r = this.unit ? Math.hypot(mx - pelX, my - pelY) : Math.hypot(mx - shX, my - shY);
          this.aimCorr = clamp(this.aimCorr + (err * 0.8) / (1 + r / d), -0.45, 0.45);
        } else this.aimCorr *= 0.9;
      } else this.aimCorr *= 0.9;
      // cheek weld: the head drops onto the comb of the stock; what it can't reach, the gun comes up to
      if (st.cheek && raise > 0.01 && a!.butt && !this.unit) this.cheekWeld(loc(a!.butt), muz, gun.combY !== undefined ? loc([a!.butt[0], gun.combY]) : null, raise);
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
          // the support hand slides back along the fore-end until its elbow can bend
          let [fx, fy] = gp(a!.fore);
          // (the palm is gx ahead of the wrist: measure the arm to the wrist, not the palm)
          const sgx = P.hand_support?.gx ?? 10;
          const d = Math.hypot(fx - nsX, fy - nsY), maxD = reach * 0.95 + sgx; // a slight bend at the elbow, under the gun
          if (d > maxD) { const back = Math.min(d - maxD, Math.abs(loc(a!.fore)[0]) * 0.85); fx -= Math.cos(this.ga) * back; fy -= Math.sin(this.ga) * back; }
          // seen from the right, the support hand cups the fore-end from below: palm and fingers show
          // under the handguard rather than hiding behind it
          const dn = 4;
          fx -= Math.sin(this.ga) * dn; fy += Math.cos(this.ga) * dn;
          defN = { x: fx, y: fy, rho: this.ga, pose: 'support' };
        }
        // pistol: the support hand cups the trigger hand from below / in front of the grip
        else if (!this.oneHand) { const [px, py] = this.gunPt([0, 0], -1, 3); defN = { x: px, y: py, rho: this.ga + 0.15, pose: 'support' }; }
      }
    } else if (ch.handIK > 0) {
      defN = { x: ch.nHx, y: ch.nHy, rho: NaN, pose: 'open' };
      defF = { x: ch.fHx, y: ch.fHy, rho: NaN, pose: 'open' };
    }
    // ---- arms: default target blended with the clip target
    const tN = this.blendTarget(defN, tgt.n, 'n');
    const tF = this.blendTarget(defF, tgt.f, 'f');
    // role n (support) on the far arm and role f (trigger) on the near arm with a firearm
    if (this.swap) {
      this.solveArm(F_UA, F_FA, F_H, fshX, fshY, T, ch.nSh, ch.nEl, ch.nWr, tN, 'n');
      this.solveArm(N_UA, N_FA, N_H, shX, shY, T, ch.fSh, ch.fEl, ch.fWr, tF, 'f');
    } else {
      this.solveArm(N_UA, N_FA, N_H, shX, shY, T, ch.nSh, ch.nEl, ch.nWr, tN, 'n');
      this.solveArm(F_UA, F_FA, F_H, fshX, fshY, T, ch.fSh, ch.fEl, ch.fWr, tF, 'f');
    }

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
    const hn = tip(N_H, (P[this.nearHand] ?? P.hand).len); set(6, hn[0], hn[1]);
    set(7, J[F_FA], K[F_FA]); set(8, J[F_H], K[F_H]);
    const hf = tip(F_H, (P[this.farHand] ?? P.hand).len); set(9, hf[0], hf[1]);
    set(10, J[N_TH], K[N_TH]); set(11, J[N_SN], K[N_SN]); set(12, J[N_FT], K[N_FT]);
    const tn = tip(N_FT, g.ft); set(13, tn[0], tn[1]);
    set(14, J[F_TH], K[F_TH]); set(15, J[F_SN], K[F_SN]); set(16, J[F_FT], K[F_FT]);
    const tf = tip(F_FT, g.ft); set(17, tf[0], tf[1]);
  }

  /**
   * Unit drawings (docs/research/14 §3): one drawing of the torso, head, arms, hands and gun per state (aim, low
   * ready, reload; assets.ts units / unitsReady / unitsReload), in place of the rigged parts. Weights per state:
   * low ready by the stance's low-ready weight `lr`, reload by the clip's `ready` channel; a state with no drawing
   * falls back to the rigged parts ("cut"). Between aim and low ready both drawings turn about their shoulder
   * pocket (one shared butt point) and each leans part of the way (UNIT_SWING) toward the other's gun angle while
   * they cross-dissolve, so the guns meet part-way without the whole body tipping 40° (lr's own ease: ~0.15 s for the 0.3..0.7 window). The aim drawing turns to the aim
   * (±35° of its drawn angle) and the low-ready one to the stance's low angle (±17°), each pivoting on the
   * hips like the trunk, so the rig's own hips, legs and gait carry on underneath.
   * Fills unitDraws / cutA / unit / unitRot / unitX / unitY; returns true when a unit leads.
   */
  private placeUnits(holding: boolean, aim: number, lr: number, pelX: number, pelY: number): boolean {
    const M = this.asset!.meta, w = this.weaponId ?? '', ch = this.ch, st = this.stance;
    const UA = M.units?.[w], UR = M.unitsReady?.[w], UX = M.unitsReload?.[w];
    this.unitDraws.length = 0; this.cutA = 1; this.unit = null;
    if (!(UA || UR || UX) || !holding || !this.gun || this.gunState !== 'held' || this.anchors!.hold === 'melee') return false;
    const sm = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
    const wLow = sm(0.3, 0.7, lr), wX = sm(0.28, 0.5, ch.ready);
    const kick = this.recoil * st.recoilLean * 2 * KICK_BODY + this.climb;
    // the guns' angles where each drawing would rest on its own, and the shared one while they swing
    const rotA = UA ? clamp(wrapAngle(aim - UA.bore), -0.61, 0.61) - kick : 0;
    const lowTo = Math.max(aim, st.lowAngle);
    const rotR = UR ? clamp(wrapAngle(lowTo - UR.bore), -0.3, 0.3) : 0;
    const gA = UA ? UA.bore + rotA : aim, gR = UR ? UR.bore + rotR : lowTo;
    const dG = wrapAngle(gR - gA) * UNIT_SWING;
    const turn = (u: UnitDraw, r: number, p: [number, number]): [number, number] => {
      const c = Math.cos(r), s = Math.sin(r), dx = p[0] - u.pelvis[0], dy = p[1] - u.pelvis[1];
      return [dx * c - dy * s, dx * s + dy * c];
    };
    // the shared pivot: each drawing's own pocket where it would rest, blended
    const pa = UA ? turn(UA, rotA, this.pocketOf(UA)) : null, pr = UR ? turn(UR, rotR, this.pocketOf(UR)) : null;
    const p0 = pa ?? pr, p1 = pr ?? pa;
    const pvX = p0 ? pelX + lerp(p0[0], p1![0], wLow) : pelX, pvY = p0 ? pelY + lerp(p0[1], p1![1], wLow) : pelY;
    const place = (u: UnitDraw, r: number, wt: number) => {
      if (wt <= 0.001) return;
      const o = turn(u, r, this.pocketOf(u));
      this.unitDraws.push({ u, x: pvX - o[0], y: pvY - o[1], rot: r, a: wt });
    };
    // back to front: (the rigged parts) < low ready < aim < reload; each layer at min(1, 2 w) so the one on top
    // fades in over a solid layer below it and the one below fades out under a solid one (no see-through mid-way)
    const wAim = (1 - wLow) * (1 - wX), wReady = wLow * (1 - wX);
    let cut = 0;
    if (UR) place(UR, rotR - dG * (1 - wLow), wReady); else cut += wReady;
    if (UA) place(UA, rotA + dG * wLow, wAim); else cut += wAim;
    if (UX) { if (wX > 0.001) this.unitDraws.push({ u: UX, x: pelX, y: pelY, rot: 0, a: wX }); } else cut += wX;
    if (!this.unitDraws.length) return false;
    let lead = this.unitDraws[0];
    for (const d of this.unitDraws) if (d.a > lead.a) lead = d;
    const leadW = lead.a;
    for (const d of this.unitDraws) d.a = Math.min(1, d.a * 2);
    this.cutA = cut > 0.001 ? Math.min(1, cut * 2) : 0;
    if (cut > leadW) return false; // the rigged parts lead
    this.unit = lead.u; this.unitRot = lead.rot; this.unitX = lead.x; this.unitY = lead.y;
    return true;
  }
  /** The gun icon's size against the unit drawings' gun (assets.ts gunScale: the model draws pistols ~1.3x and
   * long guns a touch larger than the icon): the held icon and the gun frame (muzzle, grip, mag, port) are scaled to
   * it, so the rigged arms and gun in a reload with no reload drawing match the drawings either side, and mags /
   * casings come off the drawn gun's own well and port. 1 for a rig with no unit for this gun. */
  private unitGunScale(): number {
    return this.asset?.meta.gunScale?.[this.weaponId ?? ''] ?? 1;
  }
  /** A unit's pivot between drawings (drawing px): the cut's own `pocket`, else the butt along the drawn bore
   * (long guns: the icon's muzzle-to-butt length back from the muzzle), else the shoulder (pistols). */
  private pocketOf(u: UnitDraw): [number, number] {
    if (u.pocket) return u.pocket;
    const a = this.anchors!, g = this.geo!;
    if (a.hold !== 'pistol' && a.butt && this.gun) {
      const L = Math.abs(a.muzzle[0] - a.butt[0]) * (a.len / this.gun.w) * this.unitGunScale();
      return [u.muzzle[0] - Math.cos(u.bore) * L, u.muzzle[1] - Math.sin(u.bore) * L];
    }
    const t = Math.atan2(u.neck[1] - u.pelvis[1], u.neck[0] - u.pelvis[0]), ux = Math.cos(t), uy = Math.sin(t);
    return [u.pelvis[0] + ux * g.sh[0] - uy * g.sh[1], u.pelvis[1] + uy * g.sh[0] + ux * g.sh[1]];
  }

  /**
   * Turn the head (about the neck) until a cheek point sits on the stock's comb line (butt to muzzle,
   * raised by the comb height); if the chin can't drop that far, lift the gun the rest of the way.
   * butt / muz: gun-local points. w: blend (aim pose weight).
   */
  private cheekWeld(butt: [number, number], muz: [number, number], combPt: [number, number] | null, w: number) {
    const g = this.geo!, A = this.ja;
    const nx = this.jx[HEAD], ny = this.jy[HEAD];
    const [bx, by] = this.gunPt(butt), [mx, my] = this.gunPt(muz);
    let dx = mx - bx, dy = my - by;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const upx = dy, upy = -dx; // the up-normal of the gun line (facing right)
    // the comb line: parallel to the bore through the stock's top edge (else a guess above the butt)
    const [lx, ly] = combPt ? this.gunPt(combPt) : [bx + upx * 3.5, by + upy * 3.5];
    // cheek: a third up the head bone, forward of it (the face side)
    const ca = g.headLen * 0.22, cf = g.headLen * 0.3;
    const f = (th: number) => {
      const c = Math.cos(th), s = Math.sin(th);
      const px = nx + c * ca - s * cf, py = ny + s * ca + c * cf;
      return (px - lx) * upx + (py - ly) * upy; // > 0: cheek above the comb
    };
    const a0 = A[HEAD];
    let lo = a0 - 0.2, hi = a0 + 0.36;
    if (f(lo) < 0) { A[HEAD] = lerpAngle(a0, lo, w); return; }
    const resid = f(hi);
    if (resid > 0) {
      // chin all the way down and still above it: bring the gun up to the face
      const k = resid * w * 0.85;
      this.gx += upx * k; this.gy += upy * k;
      A[HEAD] = lerpAngle(a0, hi, w);
      return;
    }
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
    A[HEAD] = lerpAngle(a0, (lo + hi) / 2, w);
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
      // the art's own ankle→toe angle is what a flat sole looks like (ankle above the toe): 0 here
      // tipped every foot toes-up by that much (5-7° on survivors, ~30° on a shambler)
      const sole = this.asset?.meta.parts.foot?.rest ?? 0;
      A[ft] = sole + ank + (fy < -1 ? clamp((o.a2 - Math.PI / 2) * 0.5, -0.4, 0.6) : 0);
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
    // a low-impulse death would otherwise settle kneeling or sitting upright (the muscles
    // hold the standing pose while the legs fold): tip the trunk past the feet
    if (!o.noCollapse) rd.collapse(o.impulse?.x ?? 0, o.impulse?.y ?? 0, this.crawling);
    this.ragdoll = rd;
    this.actions = [];
    // the unit drawings (an upright torso + arms + gun painted as one) can't follow a falling body:
    // from here on the rigged head and arms are drawn
    this.unitDraws.length = 0; this.unit = null; this.cutA = 1;
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
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: 1 | -1, fallback?: CanvasImageSource, cam?: DOMMatrix2DInit | null) {
    if (this.baked) return;
    this.dx = x; this.dy = y; this.ds = scale; this.df = facing;
    this.cam = cam && !(cam.a === 1 && cam.b === 0 && cam.c === 0 && cam.d === 1 && cam.e === 0 && cam.f === 0) ? cam : null;
    this.baseAlpha = ctx.globalAlpha;
    const as = this.asset;
    if (!as || !this.geo) { this.drawFallback(ctx, x, y, scale, facing, fallback); return; }
    if (this.lod && !this.ragdoll && !this.weaponId && this.flashT <= 0 && this.actions.length === 0 && !this.overlay && !this.hideHead) {
      const fr = flipFrame(this, scale);
      if (fr) {
        const k = scale / fr.s;
        this.xf(ctx, facing * k, 0, 0, k, x, y);
        ctx.drawImage(fr.c, -fr.ox, -fr.oy);
        this.resetXf(ctx);
        return;
      }
    }
    if (this.ragdoll) this.poseFromRagdoll();
    // under the body: the ink outline, then the rim band peeking out past it
    if (this.outline) this.drawSil(ctx, this.outline.src, 0, 0, this.outline.grow);
    if (this.rim && this.rim.alpha > 0) {
      ctx.globalAlpha = this.baseAlpha * this.rim.alpha;
      this.drawSil(ctx, this.rim.src, this.rim.dx * this.df / this.ds, this.rim.dy / this.ds, 0);
      ctx.globalAlpha = this.baseAlpha;
    }
    this.drawBody(ctx, as);
    if (this.overlay && this.overlay.alpha > 0) {
      ctx.globalAlpha = this.baseAlpha * Math.min(1, this.overlay.alpha);
      this.drawSil(ctx, this.overlay.src, 0, 0, 0);
      ctx.globalAlpha = this.baseAlpha;
    }
    if (this.flashT > 0) {
      // per-part silhouettes overlap at the joints: keep it light so the seams don't read as blobs
      ctx.globalAlpha = this.baseAlpha * 0.3 * Math.min(1, this.flashT / 0.04);
      this.drawSil(ctx, as.flash, 0, 0, 0);
      ctx.globalAlpha = this.baseAlpha;
    }
    this.drawProps(ctx);
    this.resetXf(ctx);
  }

  /** Back-to-front draw order: the stance's (stances.ts) with a firearm, the classic one otherwise. */
  get layers(): Slot[] { return this.swap ? this.stance.layers : STANCES.free.layers; }

  private drawBody(ctx: CanvasRenderingContext2D, as: RigAsset) {
    const inked = this.skin?.atlas ?? as.atlas, gw = this.skin?.grow ?? 0;
    const atlas = this.skin?.plain ?? inked, dark = this.skin?.plainDark ?? this.skin?.dark ?? as.dark;
    const pg = this.skin?.plain ? 0 : gw; // un-inked parts need no source padding
    const melee = this.anchors?.hold === 'melee';
    // the support role's props (mag, shell, round, speedloader) ride the hand on its physical side
    const supFar = this.swap;
    // unit drawings (placeUnits) replace the head, both arms, both hands and the gun: those slots are drawn at
    // cutA (skipped at 0), the drawings over them after the last slot (every slot after the head is one of them)
    const draws = this.unitDraws, base = this.baseAlpha;
    for (const slot of this.layers) {
    const cut = draws.length > 0 && (slot === 'head' || slot === 'gun' || slot === 'fUA' || slot === 'fFA' || slot === 'fH' || slot === 'nShadow' || slot === 'nUA' || slot === 'nFA' || slot === 'nH');
    if (cut) {
      if (this.cutA <= 0) continue;
      this.baseAlpha = base * this.cutA; ctx.globalAlpha = this.baseAlpha;
    }
    switch (slot) {
      case 'fLeg':
        this.part(ctx, dark, F_TH, 'thigh', false, 0, 0, pg); this.part(ctx, dark, F_SN, 'shin', false, 0, 0, pg); this.part(ctx, dark, F_FT, 'foot', false, 0, 0, pg);
        break;
      case 'nLeg':
        this.part(ctx, atlas, N_TH, 'thigh', false, 0, 0, pg); this.part(ctx, atlas, N_SN, 'shin', false, 0, 0, pg); this.part(ctx, atlas, N_FT, 'foot', false, 0, 0, pg);
        break;
      case 'torso': this.part(ctx, atlas, TORSO, 'torso', false, 0, 0, pg); break;
      case 'head': if (!this.hideHead) this.part(ctx, atlas, HEAD, 'head', this.headFlip > 0.5, 0, 0, pg); break;
      case 'fUA': this.part(ctx, dark, F_UA, 'upperArm', false, 0, 0, pg); break;
      case 'fFA': this.part(ctx, dark, F_FA, 'forearm', false, 0, 0, pg); break;
      case 'fH':
        this.handProps(ctx, supFar);
        // bare-handed the far hand is in shade; holding a gun without the swap (Turned never do) it wraps the grip
        this.part(ctx, dark, F_H, this.farHand, false, 0, 0, pg);
        break;
      case 'nShadow':
        // contact shadow of the near arm (skipped on small bodies: invisible there)
        if (this.ds > 0.42 && this.kind === 'survivor') {
          ctx.globalAlpha = this.baseAlpha * 0.28;
          this.part(ctx, as.shadow, N_UA, 'upperArm', false, 2.5, 3);
          this.part(ctx, as.shadow, N_FA, 'forearm', false, 2.5, 3);
          ctx.globalAlpha = this.baseAlpha;
        }
        break;
      case 'nUA': this.part(ctx, inked, N_UA, 'upperArm', false, 0, 0, gw); break;
      case 'nFA': this.part(ctx, inked, N_FA, 'forearm', false, 0, 0, gw); break;
      case 'nH':
        this.handProps(ctx, !supFar);
        this.part(ctx, inked, N_H, this.nearHand, false, 0, 0, gw);
        break;
      case 'gun': if (this.gunVisible && !melee) this.drawGun(ctx); break;
      case 'melee': if (this.gunVisible && melee) this.drawGun(ctx); break;
      case 'slung': if (this.gunState === 'slung' && this.gun && this.weaponId && !melee) this.drawSlung(ctx); break;
      case 'string': if (this.anchors?.hold === 'bow' && this.gunVisible) this.drawString(ctx); break;
    }
    if (cut) { this.baseAlpha = base; ctx.globalAlpha = base; }
    }
    if (draws.length) {
      for (const d of draws) { ctx.globalAlpha = base * d.a; this.unitPart(ctx, atlas, d, 0, 0, pg); }
      ctx.globalAlpha = base;
      if (this.unit && this.flashMuzzle > 0) this.drawFlash(ctx);
    }
  }
  /** One unit drawing (placeUnits): its pelvis at (d.x, d.y) rig space, turned by d.rot from the drawing. */
  private unitPart(ctx: CanvasRenderingContext2D, src: CanvasImageSource, d: { u: UnitDraw; x: number; y: number; rot: number }, ox: number, oy: number, grow: number) {
    const m = this.asset!.meta.parts[d.u.part];
    if (!m) return;
    const S = this.ds, F = this.df, c = Math.cos(d.rot), s = Math.sin(d.rot);
    this.xf(ctx, S * F * c, S * s, -S * F * s, S * c, this.dx + S * F * (d.x + ox), this.dy + S * (d.y + oy));
    if (grow) ctx.drawImage(src, m.x - grow, m.y - grow, m.w + grow * 2, m.h + grow * 2, -m.px - grow, -m.py - grow, m.w + grow * 2, m.h + grow * 2);
    else ctx.drawImage(src, m.x, m.y, m.w, m.h, -m.px, -m.py, m.w, m.h);
  }
  /** What the hand on this physical side carries, drawn under its fingers: the support role's mag /
   * prop when `support`, else the trigger role's prop (an arrow from the quiver). */
  private handProps(ctx: CanvasRenderingContext2D, support: boolean) {
    if (support) {
      if (this.magState === 'hand' && this.gun?.mag) this.drawMagInHand(ctx);
      if (this.prop) this.drawProp(ctx, this.prop, this.palmNX, this.palmNY, this.rhoN);
    } else if (this.fprop) this.drawProp(ctx, this.fprop, this.palmFX, this.palmFY, this.rhoF);
  }

  /** Every body part from one flat atlas (outline, rim, flash), offset by (ox, oy) rig units. */
  private drawSil(ctx: CanvasRenderingContext2D, src: CanvasImageSource, ox: number, oy: number, grow: number) {
    const draws = this.unitDraws, ga = ctx.globalAlpha;
    for (let i = 0; i < PART_COUNT; i++) {
      if (i === HEAD && this.hideHead) continue;
      const cut = draws.length > 0 && (i === HEAD || i === N_UA || i === N_FA || i === N_H || i === F_UA || i === F_FA || i === F_H);
      if (cut && this.cutA <= 0) continue;
      ctx.globalAlpha = cut ? ga * this.cutA : ga;
      this.part(ctx, src, i, i === N_H ? this.nearHand : i === F_H ? this.farHand : PART_NAMES[i], i === HEAD && this.headFlip > 0.5, ox, oy, grow);
    }
    for (const d of draws) { ctx.globalAlpha = ga * d.a; this.unitPart(ctx, src, d, ox, oy, grow); }
    ctx.globalAlpha = ga;
  }

  /** setTransform composed with the camera transform of this draw. */
  private xf(ctx: CanvasRenderingContext2D, a: number, b: number, c: number, d: number, e: number, f: number) {
    const m = this.cam;
    if (!m) { ctx.setTransform(a, b, c, d, e, f); return; }
    const ma = m.a ?? 1, mb = m.b ?? 0, mc = m.c ?? 0, md = m.d ?? 1, me = m.e ?? 0, mf = m.f ?? 0;
    ctx.setTransform(ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d, ma * e + mc * f + me, mb * e + md * f + mf);
  }
  private resetXf(ctx: CanvasRenderingContext2D) {
    const m = this.cam;
    if (m) ctx.setTransform(m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0);
    else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = this.baseAlpha;
  }

  // ---- bone positions in world (display) space, for hit tests and weakspot rings
  /** A ragdoll/skeleton point (ragdoll.ts P_* index) in world coordinates. */
  pointWorld(i: number): [number, number] {
    let x: number, y: number;
    if (this.ragdoll) { x = this.ragdoll.x[i]; y = this.ragdoll.y[i]; } else { x = this.pts[i * 2]; y = this.pts[i * 2 + 1]; }
    return [this.dx + this.ds * this.df * x, this.dy + this.ds * y];
  }
  /** Centre of the skull in world coordinates (between the head base and the crown). */
  headWorld(): [number, number] {
    const [ax, ay] = this.pointWorld(19), [bx, by] = this.pointWorld(2);
    return [ax + (bx - ax) * 0.55, ay + (by - ay) * 0.55];
  }
  /** A point `along` (0..1) a body part (skeleton.ts index), plus `perp` rig units across it. */
  partWorld(i: number, along: number, perp = 0): [number, number] {
    const m = this.asset?.meta.parts[PART_NAMES[i]];
    const len = m?.len ?? 0;
    const a = this.ja[i];
    const x = this.jx[i] + Math.cos(a) * len * along - Math.sin(a) * perp, y = this.jy[i] + Math.sin(a) * len * along + Math.cos(a) * perp;
    return [this.dx + this.ds * this.df * x, this.dy + this.ds * y];
  }
  /** The held gun's muzzle in world coordinates (null when no gun is in the hands). */
  muzzleWorld(): [number, number] | null {
    const a = this.anchors;
    if (!a || !this.gunVisible || a.hold === 'melee') return null;
    const [x, y] = this.gunPt([(a.muzzle[0] - a.grip[0]) * this.gk * (a.flip ? -1 : 1), (a.muzzle[1] - a.grip[1]) * this.gk]);
    return [this.dx + this.ds * this.df * x, this.dy + this.ds * y];
  }
  /** World angle of the gun barrel (for muzzle flashes). */
  gunAngleWorld(): number { return this.df > 0 ? this.ga : Math.PI - this.ga; }

  /** Debug overlay: bones as lines, joints as dots, the gun grip as a cross. */
  drawSkeleton(ctx: CanvasRenderingContext2D) {
    const p = this.pts, S = this.ds, F = this.df;
    this.xf(ctx, S * F, 0, 0, S, this.dx, this.dy);
    ctx.lineWidth = 1.5 / S;
    ctx.strokeStyle = '#0ff';
    ctx.beginPath();
    for (const [a, b] of PART_POINTS) { ctx.moveTo(p[a * 2], p[a * 2 + 1]); ctx.lineTo(p[b * 2], p[b * 2 + 1]); }
    ctx.stroke();
    ctx.fillStyle = '#ff0';
    for (let i = 0; i < RAGDOLL_POINTS; i++) { ctx.beginPath(); ctx.arc(p[i * 2], p[i * 2 + 1], 2 / S, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#f0f';
    ctx.beginPath(); ctx.moveTo(this.gx - 4, this.gy); ctx.lineTo(this.gx + 4, this.gy); ctx.moveTo(this.gx, this.gy - 4); ctx.lineTo(this.gx, this.gy + 4); ctx.stroke();
    this.resetXf(ctx);
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
    this.baked = true;
  }
  /** true once bakeCorpse() ran: the rig no longer draws or updates (drop it) */
  baked = false;

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
    const hn = this.swap ? F_H : N_H, hf = this.swap ? N_H : F_H;
    this.rhoN = A[hn] - (P[this.handN]?.rest ?? 0);
    this.rhoF = A[hf] - (P[this.handF]?.rest ?? 0);
    this.magState = this.magState === 'hand' ? 'none' : this.magState;
    this.prop = null; this.fprop = null;
  }

  private part(ctx: CanvasRenderingContext2D, src: CanvasImageSource, i: number, name: string, mirror = false, ox = 0, oy = 0, grow = 0) {
    const kit = this.asset!.meta.kitArms;
    if (kit && this.geo && (i === N_UA || i === N_FA || i === F_UA || i === F_FA)) { this.kitPart(ctx, src, i, kit, ox, oy, grow); return; }
    const m: PartMeta | undefined = this.asset!.meta.parts[name];
    if (!m) return;
    const S = this.ds, F = this.df;
    const r = this.ja[i] - m.rest;
    const c = Math.cos(r), s = Math.sin(r);
    const mx = mirror ? -1 : 1;
    this.xf(ctx, S * F * c * mx, S * s, -S * F * s * mx, S * c, this.dx + S * F * (this.jx[i] + ox), this.dy + S * (this.jy[i] + oy));
    // arm art stretched along its bone to the bone's real length (skeleton.ts geomOf, ARM)
    const g = this.geo, k = !g ? 1 : i === N_UA || i === F_UA ? g.uaK : i === N_FA || i === F_FA ? g.faK : 1;
    // the far forearm under a long gun is farther from the camera and mostly behind the gun: slimmer
    const thin = i === F_FA && this.swap && this.anchors?.hold !== 'pistol' && this.anchors?.hold !== 'melee' && this.gunVisible ? 0.72 : 1;
    if (k !== 1 || thin !== 1) { ctx.rotate(m.rest); ctx.scale(k, thin); ctx.rotate(-m.rest); }
    // forearms end at the wrist: the source painting's own hand (a glove, a fist) was cut into the
    // forearm part, and the hand library draws the real one, so cut the art off just past the wrist
    // upper arms likewise end at the elbow: the sleeve block cut past it jutted out as a square corner
    const fa = i === N_FA || i === F_FA || i === N_UA || i === F_UA;
    if (fa) {
      const ua = i === N_UA || i === F_UA;
      const L = Math.hypot(m.tx - m.px, m.ty - m.py) + (ua ? 7 : 3) + grow;
      ctx.save();
      ctx.rotate(m.rest);
      ctx.beginPath(); ctx.rect(-4000, -4000, 4000 + L, 8000);
      ctx.rotate(-m.rest);
      ctx.clip();
    }
    if (grow) ctx.drawImage(src, m.x - grow, m.y - grow, m.w + grow * 2, m.h + grow * 2, -m.px - grow, -m.py - grow, m.w + grow * 2, m.h + grow * 2);
    else ctx.drawImage(src, m.x, m.y, m.w, m.h, -m.px, -m.py, m.w, m.h);
    if (fa) ctx.restore();
  }

  /**
   * Arm kit (assets.ts KitDraw): the whole-sleeve drawing whose elbow bend is nearest this arm's,
   * drawn twice: in the upper arm's frame clipped to the shoulder side of the elbow's bisector, and
   * in the forearm's frame clipped to the wrist side (the residual bend, at most half the gap between
   * two drawings, turns about the elbow). Each half is stretched along its bone to the bone's length.
   */
  private kitPart(ctx: CanvasRenderingContext2D, src: CanvasImageSource, i: number, kit: { near: KitDraw[]; far: KitDraw[] }, ox: number, oy: number, grow: number) {
    const far = i === F_UA || i === F_FA, upper = i === N_UA || i === F_UA;
    const ua = far ? F_UA : N_UA, fa = far ? F_FA : N_FA;
    const bend = (-wrapAngle(this.ja[fa] - this.ja[ua]) * 180) / Math.PI;
    const list = far ? kit.far : kit.near;
    let d = list[0];
    for (const k of list) if (Math.abs(k.bend - bend) < Math.abs(d.bend - bend)) d = k;
    const m = this.asset!.meta.parts[d.part];
    if (!m) return;
    const [sx, sy] = d.s, [ex, ey] = d.e, [wx, wy] = d.wr;
    const a = upper ? Math.atan2(ey - sy, ex - sx) : Math.atan2(wy - ey, wx - ex);
    const L = upper ? Math.hypot(ex - sx, ey - sy) : Math.hypot(wx - ex, wy - ey);
    const bone = upper ? this.geo!.ua : this.geo!.fa;
    const S = this.ds, F = this.df, r = this.ja[i], c = Math.cos(r), s = Math.sin(r);
    this.xf(ctx, S * F * c, S * s, -S * F * s, S * c, this.dx + S * F * (this.jx[i] + ox), this.dy + S * (this.jy[i] + oy));
    ctx.save();
    ctx.scale(bone / L, 1);
    ctx.rotate(-a);
    ctx.translate(-(upper ? sx : ex), -(upper ? sy : ey));
    // the split line through the elbow: the bisector of the bend (perpendicular to a straight arm)
    const ux = sx - ex, uy = sy - ey, ul = Math.hypot(ux, uy) || 1, vx = wx - ex, vy = wy - ey, vl = Math.hypot(vx, vy) || 1;
    let bx = ux / ul + vx / vl, by = uy / ul + vy / vl;
    const bl = Math.hypot(bx, by);
    if (bl < 0.2) { bx = -vy / vl; by = vx / vl; } else { bx /= bl; by /= bl; }
    // normal toward this half's side, pushed 1.5 units past the line so the halves overlap
    let nx = -by, ny = bx;
    const side = upper ? nx * ux + ny * uy : nx * vx + ny * vy;
    if (side < 0) { nx = -nx; ny = -ny; }
    const o = -1.5, B = 400;
    const px = ex + nx * o, py = ey + ny * o;
    ctx.beginPath();
    ctx.moveTo(px + bx * B, py + by * B); ctx.lineTo(px - bx * B, py - by * B);
    ctx.lineTo(px - bx * B + nx * B, py - by * B + ny * B); ctx.lineTo(px + bx * B + nx * B, py + by * B + ny * B);
    ctx.closePath();
    ctx.clip();
    if (grow) ctx.drawImage(src, m.x - grow, m.y - grow, m.w + grow * 2, m.h + grow * 2, -grow, -grow, m.w + grow * 2, m.h + grow * 2);
    else ctx.drawImage(src, m.x, m.y, m.w, m.h, 0, 0, m.w, m.h);
    ctx.restore();
  }

  private setGunXf(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, flip?: boolean) {
    const S = this.ds, F = this.df, c = Math.cos(a), s = Math.sin(a), fl = flip ? -1 : 1;
    this.xf(ctx, S * F * c * k * fl, S * s * k * fl, -S * F * s * k, S * c * k, this.dx + S * F * x, this.dy + S * y);
  }

  private drawGun(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    const bk = this.bakeGun(this.magState === 'gun' ? 'full' : 'img', g.w, g.h, this.gk);
    if (a.reload === 'break' && this.ch.cyl > 0.01 && a.rack) {
      // break action: barrels hinge down about the hinge pin (the rack anchor)
      const hx = a.rack[0];
      this.setGunXf(ctx, this.gx, this.gy, this.ga, this.gk, a.flip);
      blitIcon(ctx, bk, g.w, 0, hx, -a.grip[0], -a.grip[1]);
      const [px, py] = this.gunPt([(a.rack[0] - a.grip[0]) * this.gk, (a.rack[1] - a.grip[1]) * this.gk]);
      this.setGunXf(ctx, px, py, this.ga + 0.42 * this.ch.cyl, this.gk, a.flip);
      blitIcon(ctx, bk, g.w, hx, g.w, -hx, -a.rack[1]);
    } else {
      this.setGunXf(ctx, this.gx, this.gy, this.ga, this.gk, a.flip);
      blitIcon(ctx, bk, g.w, 0, g.w, -a.grip[0], -a.grip[1]);
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
    if (this.flashMuzzle > 0) this.drawFlash(ctx);
  }
  private drawFlash(ctx: CanvasRenderingContext2D) {
    const a = this.anchors!;
    {
      const [mx, my] = this.gunPt([(a.muzzle[0] - a.grip[0]) * this.gk * (a.flip ? -1 : 1), (a.muzzle[1] - a.grip[1]) * this.gk]);
      this.setGunXf(ctx, mx, my, this.ga, 1);
      ctx.fillStyle = 'rgba(255,214,120,0.95)';
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(16, 0); ctx.lineTo(0, 3); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,220,0.9)'; ctx.beginPath(); ctx.arc(2, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  /**
   * The held weapon's icon baked at the size it is drawn (device px per icon px), graded with
   * the body's lane look and ringed with the body's ink line (assets.ts bakedIcon).
   */
  private bakeGun(which: 'full' | 'img' | 'mag', w: number, h: number, k: number): BakedIcon {
    const g = this.gun!, m = this.cam;
    const cs = m ? Math.hypot(m.a ?? 1, m.b ?? 0) : 1;
    const src = which === 'full' ? g.full : which === 'img' ? g.img : g.mag!;
    // the body's ink: look.ink display px (the rig's atlas outline is grow atlas px = ~that)
    const inkD = this.gunLook ? this.gunLook.ink : this.skin?.grow ? this.skin.grow * this.ds : 1;
    return bakedIcon(`${this.weaponId}|${which}`, src, w, h, this.gunLook, this.ds * k * cs, Math.max(0.75, inkD * cs * 0.85));
  }

  private drawSlung(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    const T = this.ja[TORSO];
    const k = a.len / g.w;
    const x = this.jx[TORSO] + Math.cos(T) * this.geo!.torsoLen * 0.55 - Math.sin(T) * -10;
    const y = this.jy[TORSO] + Math.sin(T) * this.geo!.torsoLen * 0.55 + Math.cos(T) * -10;
    this.setGunXf(ctx, x, y, T + Math.PI * 0.62, k, a.flip);
    blitIcon(ctx, this.bakeGun('full', g.w, g.h, k), g.w, 0, g.w, -g.w / 2, -a.grip[1]);
  }
  private drawString(ctx: CanvasRenderingContext2D) {
    const g = this.gun!, a = this.anchors!;
    const top = this.gunPt([(4 - a.grip[0]) * this.gk, (20 - a.grip[1]) * this.gk]);
    const bot = this.gunPt([(g.w - 4 - a.grip[0]) * this.gk, (20 - a.grip[1]) * this.gk]);
    this.xf(ctx, this.ds * this.df, 0, 0, this.ds, this.dx, this.dy);
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
    blitIcon(ctx, this.bakeGun('mag', g.mag!.width, g.mag!.height, this.gk), g.mag!.width, 0, g.mag!.width, -a.mag![2] / 2, -4);
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
      ctx.globalAlpha = this.baseAlpha * clamp(p.life / 0.5, 0, 1);
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
    ctx.globalAlpha = this.baseAlpha;
  }

  private drawFallback(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: 1 | -1, im?: CanvasImageSource) {
    if (!im) return;
    const w = (im as HTMLImageElement).width, h = (im as HTMLImageElement).height;
    const hh = 240 * scale, ww = (w / h) * hh;
    const bob = Math.abs(Math.sin(this.phase * Math.PI * 2)) * 2 * this.moving;
    // single sprites face right for survivors and left for the Turned
    const native = this.kind === 'turned' ? -1 : 1;
    this.xf(ctx, facing * native, 0, 0, 1, x, y - bob);
    ctx.drawImage(im, -ww / 2, -hh, ww, hh);
    this.resetXf(ctx);
  }
}

/**
 * Draw icon columns [x0, x1) of a baked icon in icon space (the current transform maps icon px),
 * with icon point (0, 0) at (ox, oy). The ink ring past the icon's edges comes along.
 */
function blitIcon(ctx: CanvasRenderingContext2D, b: BakedIcon, iconW: number, x0: number, x1: number, ox: number, oy: number) {
  const { c, k, pad } = b;
  const s0 = x0 <= 0 ? 0 : Math.round(x0 * k + pad), s1 = x1 >= iconW ? c.width : Math.round(x1 * k + pad);
  if (s1 <= s0) return;
  ctx.drawImage(c, s0, 0, s1 - s0, c.height, (s0 - pad) / k + ox, -pad / k + oy, (s1 - s0) / k, c.height / k);
}

setTemplateFactory((spriteId, style, gait) => new Rig('turned', spriteId, { style, gait, jitter: false, seed: 1 }));

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
