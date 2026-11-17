import type { Survivor, WeaponItem, Res, NightPlan } from '../types';
import { G, R, log, add } from '../state';
import { ZOMBIES, WEAKSPOTS, EYES, type ZombieDef, type WeakKind } from '../data/zombies';
import { WEAPONS, fireProfile, armorDamage, roundsInStores, ammoLabel, ammoTypesFor, selectedAmmo, shotSound, wearMods, blastDamage, AMMO_RES, AMMO_TYPES, BURN, FLARE_LIGHT, type FireProfile } from '../data/weapons';
import { img, flashImg, shadeImg } from '../assets';
import { sfx, wind, gunSoundFor, muffle, ambienceLayer } from '../audio';
import { flashKind, gunFeel, drawFlash, casingLook, voiceOf, panOf, isSuppressed, type FlashKind } from './gunfx';
import { reduceGore, shakeScale, realism, screenFx, hitMarkers, zoneMarkers, autoReload, focusToggle, threatRibbon } from '../ui/settings';
import { keyOf, normKey, keyCap } from '../ui/keys';
import { openPause } from '../ui/pause';
import {
  living, canFight, aimFactor, first, displayName, wound, pain, killSurvivor, tale, addThought, hasTrait, changeOpinion, byId, isBitten, breakThresholds,
  moodBreakdown, their, them, grantTitle, prof, attr,
} from '../sim/survivors';
import {
  kickFor, bloomAfter, aimedDelay, climbFor, heatLimit, heatCool, usesHeat, swapsBarrel, fireModes, hasChamber, manualAction, drawTime, shooterMods, clearTime,
  BLOOM_CAP, type FireMode, type Malfunction,
} from './gunplay';
import { intelTier } from '../sim/director';
// ---- night modules (traps / melee / emplacements): hook plumbing, see night/hook.ts ----
import type { BattleHook } from './hook';
import { installModules } from './modules';
import { meleeGuard } from './melee';
// ---- end night modules ----
import { depthScale, bakeSprite, bakeComposite, bakeEdge, bakeLayer, bakeGround, fgStrip, shadowEllipse, type Look } from './render';
import { drawProp, drawGunBase, drawGunPart, has, propW } from './props';
import { BattleActors } from './actors'; // rigged bodies (src/anim): drawing, deaths, corpses
import { react, slideStep, classicPose, IMPACT, type Reaction } from './impact'; // flinch / stagger / stumble / knockdown

export const W = 1280, H = 720;
export const WALL_X = 372; // front face of the barricade (near lane)
const ZS = 1.3; // global actor scale for the Turned
const SH = 158; // survivor display height
const DRAIN_X = 74; // storm drain grate behind the line
const SAFE_X = 70; // where the downed are dragged to
const DOWN_PAIN = 1.45; // pain at which a mauled guard goes down

// ---- depth (docs/research/04 §3) ----
/** Four walking lanes, feet y far → near; the gaps widen with nearness. */
export const LANES = [604, 628, 655, 685];
/** Two rows of defenders behind the wall. */
export const DEF_LANES = [662, 688];
export const GROUND_TOP = 596, GROUND_BOT = 704;
const LANE_TOL = 16; // a shot only finds bodies within this many px of its lane's feet
const WALL_KEY = 700; // the barricade's sort key: in front of every walking lane
/** 0 far … 1 near. */
export const depthT = (y: number) => Math.max(0, Math.min(1, (y - LANES[0]) / (LANES[3] - LANES[0])));
export const nearestLane = (y: number) => {
  let li = 0;
  for (let i = 1; i < LANES.length; i++) if (Math.abs(LANES[i] - y) < Math.abs(LANES[li] - y)) li = i;
  return li;
};
/** The wall seen slightly from the side: the far lane's face sits ~10px further right. */
export const wallX = (lane: number) => WALL_X + (LANES[3] - LANES[lane]) * 0.12;
/** Per-lane atmosphere: far zombies dimmer, cooler, flatter and thinner-edged. */
export const LOOK: Look[] = [
  { b: 0.7, s: 0.65, fog: 0.22, outline: 1, rim: 0.25 },
  { b: 0.8, s: 0.75, fog: 0.14, outline: 1, rim: 0.35 },
  { b: 0.9, s: 0.88, fog: 0.06, outline: 1.5, rim: 0.5 },
  { b: 1, s: 1, fog: 0, outline: 2, rim: 0.65 },
];
const CORPSE: Look = { b: 0.45, s: 0.6, fog: 0, outline: 0 };
const PAD = 3; // transparent margin of every battle bake, so the layers line up
const WARM = '#f0c98a', COOL = '#8fa6c8', DARK = '#0a0b10';

export interface Zombie {
  id: number;
  def: ZombieDef;
  sprite: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: 'walk' | 'wall' | 'over' | 'maul' | 'dying' | 'cover' | 'flee' | 'climb' | 'leap'; // climb: up the corpse pile; leap: a Buck in the air
  phase: number;
  flash: number;
  slow: number;
  burn: number;
  dieT: number;
  target?: string;
  maulT: number;
  lungeT: number;
  screamT: number;
  scale: number;
  name?: string;
  headless?: boolean;
  wallHit: number;
  flip?: boolean; // faces right (came up behind the line)
  stopX?: number; // raiders: where they take cover
  coverT?: number; // raiders: time left in the current up/down phase
  ducked?: boolean;
  seen?: number; // raiders: lit by their own muzzle flash
  emerge?: number; // tunnelers: climbing out of the drain
  lane: number; // depth lane (index into LANES)
  ty: number; // the y it is easing toward (its lane's feet + a little jitter)
  jit: number; // per-body size variety
  variant: number; // crowd variant (0 neutral, 1 cold, 2 sickly)
  laneCd: number; // seconds before it may hop lanes again
  blocked: number; // seconds spent held up behind the one ahead
  pass?: number; // squeezing past a slower body ahead in its lane: seconds left
  rise?: number; // formed up out of the dark close in: seconds of fade-in left
  // ---- combat depth (research 05) ----
  stun: number; // staggered: no walking, no wall damage
  legDmg: number; // accumulated leg damage (×limbMul); ≥35% max HP → crippled
  armDmg: number; // accumulated arm damage; ≥25% max HP → disarmed (wall dps ×0.4)
  crippled?: boolean; // legs gone: a crawler (the Ferryman limps instead)
  disarmed?: boolean;
  staggers?: number[]; // Ferryman: times of recent stagger hits (two within 1.2 s = knockdown)
  down?: number; // knocked down for this many seconds
  windup?: number; // Crier keen wind-up, Buck crouch, Biler spit wind-up
  leap?: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number };
  leapt?: boolean;
  spitT?: number; // Biler: seconds to the next glob
  climb?: number; // coming up the corpse pile: seconds left
  pant?: number; // deer: breath-puff timer
  slide?: number; // knockback still easing out, px/s (impact.ts)
  react?: Reaction; // the last stagger / stumble / knockdown (impact.ts): drawing reads it
}

export interface Guard {
  s: Survivor;
  w: WeaponItem | null;
  x: number;
  y: number;
  cd: number;
  mag: number;
  reload: number;
  kills: number;
  flash: number;
  fled: boolean;
  aimAt?: { x: number; y: number };
  recoil: number;
  mode?: 'panic' | 'rage';
  panicAt?: number;
  homeX: number;
  face: 1 | -1;
  downCause?: string;
  downed?: boolean; // lying in the road, out of the fight
  wasDowned?: boolean;
  safe?: boolean; // dragged back behind the line
  mauledT: number; // seconds mauled while down
  burstLeft: number; // rounds still to come from this trigger pull
  burstT: number;
  burstAng: number; // guards: where the burst is pointed
  burstErr: number;
  lastTgt: number; // id of the last thing they fired at (scopes are slow to re-acquire)
  dragging?: Guard; // the downed guard this one is hauling back
  dragT: number;
  moodle?: string;
  moodleC: string;
  moodleT: number;
  sc: number; // depth scale of their row
  burstLane: number; // guards: the lane their burst is locked to
  burstX: number;
  crew?: boolean; // night modules: manning an emplacement (night/emplacements.ts)
  post: Post;
  order: Order;
  blind: number; // bile in the eyes: aim worse for a few seconds
  duck: number; // ducking a bile glob: no firing
  holdT: number; // Hold fire: seconds a bloodlust guard has been itching
  // ---- feel (night/gunfx.ts) ----
  flashKind?: FlashKind;
  flashAng?: number;
  flashSize?: number;
  kick?: number; // px the sprite is shoved back at full recoil
}
/** Where a guard stands (research 05 §5). */
export type Post = 'step' | 'roof' | 'loop' | 'runner';
/** What a guard shoots at: Free fire, Hold fire, Heads only, Protect the wall. */
export type Order = 'free' | 'hold' | 'heads' | 'wall';
export const POST_NAMES: Record<Post, string> = { step: 'Firestep', roof: 'Roof nest', loop: 'Loophole', runner: 'Runner' };
export const ORDER_NAMES: Record<Order, string> = { free: 'Free fire', hold: 'Hold fire', heads: 'Heads only', wall: 'Protect wall' };
/** A bile glob in the air (Biler). */
interface Glob { x0: number; y0: number; x1: number; y1: number; gy0: number; gy1: number; t: number; dur: number; g: Guard | null; lane: number; ducked?: boolean; rolled?: boolean }
type Zone = 'head' | 'torso' | 'arm' | 'leg';

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'blood' | 'spark' | 'smoke' | 'fire' | 'spore' | 'shell' | 'chunk' | 'dust' | 'puff'; ground: number; w?: number; h?: number; rot?: number; bounces?: number }
interface Tracer { x1: number; y1: number; x2: number; y2: number; life: number; w: number }
export interface Fire { x: number; y: number; life: number; w: number }
interface Lob { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; p: FireProfile; g: Guard | null }

// The painted background, baked once per look (never filtered per frame): an early-night
// and a late-night variant that the battle crossfades by the clock.
const bgCache = new Map<string, { early: HTMLCanvasElement; late: HTMLCanvasElement }>();
function bakeBattleBg(special: string | undefined) {
  const key = special === 'fog' ? 'fog' : special === 'crossing' ? 'crossing' : 'night';
  const hit = bgCache.get(key);
  if (hit) return hit;
  if (!img('bg_mid')) return null;
  const fog = key === 'fog', ice = key === 'crossing';
  const one = (b: number, lift: number, sky: number) => {
    // the far plane is lifted toward a cool grey: lighter than the actors' darks, lower in contrast
    const cv = bakeLayer('bg_mid', 1600, 740, `brightness(${b}) saturate(${ice ? 0.45 : 0.55}) contrast(0.8) blur(${fog ? 2.2 : 1.2}px)`, fog ? '#6a7380' : '#4b5568', lift, false);
    const x = cv.getContext('2d')!;
    // deepen the sky so the street band is the brightest part of the backdrop
    x.globalCompositeOperation = 'multiply';
    const g = x.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, `rgba(14,18,32,${sky})`);
    g.addColorStop(1, 'rgba(14,18,32,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 1600, 300);
    return cv;
  };
  const r = {
    early: one(ice ? 1.08 : 1.05, fog ? 0.5 : 0.4, 0.4),
    late: one(ice ? 0.98 : 0.94, fog ? 0.55 : 0.4, 0.55),
  };
  bgCache.set(key, r);
  return r;
}
let groundBand: HTMLCanvasElement | null = null;
export interface Light { x: number; y: number; r: number; life: number; max: number; color: string }
interface FloatText { x: number; y: number; text: string; life: number; color: string; size: number }

export interface NightResult {
  kills: number;
  deaths: string[];
  wallHeld: boolean;
  wallLost: number;
  ammoUsed: Partial<Record<Res, number>>;
  killsBy: Record<string, number>;
  headshots: number;
  lines: string[];
  fell: boolean;
}

export class Battle {
  /** Balance knobs (docs/balance.md §9): guard rate of fire, aim error and head-aim share, the Turned at the wall. */
  static tune = { guardCd: 2.2, guardErr: 1.15, guardHead: 0.85, wallDps: 1.3, guardRange: 0.55, guardShove: 0.35, guardPierce: 0, passSpeed: 0.75 }; // guardPierce: bodies past the first a guard's round goes on through (0 = it stops in the first; the player keeps full pierce)
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ground: HTMLCanvasElement;
  gctx: CanvasRenderingContext2D;
  dark: HTMLCanvasElement;
  dctx: CanvasRenderingContext2D;
  plan: NightPlan;
  t = 0;
  zombies: Zombie[] = [];
  guards: Guard[] = [];
  particles: Particle[] = [];
  tracers: Tracer[] = [];
  fires: Fire[] = [];
  lights: Light[] = [];
  texts: FloatText[] = [];
  spawnIdx = 0;
  nextId = 1;
  mouse = { x: 800, y: 500, down: false };
  bloom = 0;
  shake = 0;
  noise = 0;
  traps: number;
  trapX = 720;
  duration: number;
  done = false;
  paused = false;
  ended = false;
  endT = 0;
  res: NightResult;
  ammoStart: Record<string, number>;
  wallStart: number;
  onEnd: (r: NightResult) => void;
  raf = 0;
  last = 0;
  playerCd = 0;
  playerReload = 0;
  playerMag = new Map<string, number>();
  turnAt = -1;
  cryT = 0;
  messages: { text: string; life: number }[] = [];
  keyHandler: (e: KeyboardEvent) => void;
  slowmo = 0;
  intro = 4;
  oldFaceBy?: string;
  fast = false;
  turrets: { x: number; y: number; cd: number; flash: number; ang: number }[] = [];
  surge = 0; // the bell: the Turned move faster while it rings
  boss?: Zombie;
  dog?: { x: number; y: number; barkT: number; cd: number; name: string };
  sharp = 0; // the dog's warning: guards aim better for a moment
  drainOpen = 0;
  covers: { x: number; y: number; w: number; h: number; seed: number }[] = [];
  raidersDown = 0;
  recover: Partial<Record<Res, number>> = {}; // arrows and bolts to pick up off the road at dawn
  fired = new Map<string, number>(); // rounds per gun tonight, for wear on suppressors and mods
  lobs: Lob[] = []; // grenades and mortar bombs in the air
  laneLast: (Zombie | undefined)[] = [undefined, undefined, undefined, undefined]; // update pass: the last walker seen per lane
  laneQ = [0, 0, 0, 0]; // update pass: how many are pressed against the wall per lane
  lanes: Zombie[][] = [[], [], [], []]; // walkers per lane at the start of this update, by x
  prebake: (() => void)[] = []; // sprite bakes worked off during the intro
  hover?: Zombie; // the body under the crosshair
  keyUp = (e: KeyboardEvent) => {
    const k = normKey(e);
    if (k === keyOf('night.hurry')) this.fast = false;
    if (k === keyOf('night.reload')) {
      // a tap is the smart reload (or tap-rack); a hold already did a speed reload
      if (this.rDown >= 0 && !this.rDone && !this.paused) this.startReload('smart');
      this.rDown = -1;
    }
    if (k === keyOf('night.duck') || k === 'Control') this.ducking = false;
  };
  hooks: BattleHook[] = []; // night modules (traps, melee, emplacements): night/hook.ts
  actors!: BattleActors; // rigged bodies (night/actors.ts), the last hook
  // ---- the leader's gun ----
  bloomShot = 0; // bloom at the last shot (decays from there: bloomNow())
  lastShotT = -9;
  climbN = 0; // rounds in the current string of fire
  climbY = 0; // px the muzzle has climbed
  heat = new Map<string, number>(); // per gun uid
  modes = new Map<string, FireMode>(); // fire selector per gun uid
  pouch = new Map<string, number[]>(); // partial magazines kept on tactical reloads, by `${uid}|${ammo}`
  tube = new Map<string, Res[]>(); // shell order in tube guns
  jam: { kind: Malfunction | 'barrel'; clearing: number } | null = null;
  reloadKind: 'tac' | 'empty' | 'speed' = 'tac';
  reloadTotal = 1;
  reloadSfx?: { cancel(): void };
  rDown = -1; // performance.now() when [R] went down (a hold = speed reload)
  rDone = false;
  dropped: Partial<Record<Res, number>> = {}; // rounds in magazines dropped over the wall
  droppedMags = 0;
  settle = 0; // optic settle time after swinging onto a new body
  settleId = -1;
  shotsTonight = 0;
  firedHard = 0; // rounds fired recently (tinnitus/ringing proxy)
  shotHit = false;
  ducking = false; // [S]/[Ctrl] held: under the parapet
  // ---- nerve, focus, rally (research 05 §4, §10) ----
  nerve = 50;
  nerveMax = 70;
  focusing = false;
  shakeT = 0; // nerve hit zero: the hands shake
  zeroes = 0;
  streak = 0; // headshot kills in a row
  misses = 0;
  rally = 0; // charges
  rallyT = 0;
  hitMark: { kind: string; t: number; kill?: boolean } | null = null;
  // ---- feel and sound bookkeeping (night/gunfx.ts, audio.ts) ----
  earLoad = 0; // loudness of recent fire near the leader (ringing ears past ~16)
  earCd = 0;
  idleT = 2; // the next ambient groan from the road
  alertT = -9;
  killFlash = 0; // the screen edge warms for a beat on a kill
  ammoPunch = 0; // the ammo count jumps on each round
  wallShown = -1; // the wall bar eases down; the lost part flashes
  wallFlash = 0;
  nerveShown = -1;
  nerveFlash = 0;
  slowCd = 0; // slow-mo is rare: at most once per 8 s (bosses excepted)
  pullKills = 0; // kills by the leader's current trigger pull (multi-kill feel)
  fireLevel = -1;
  timeScale = 1;
  hitstop = 0;
  lastHitstop = -1;
  // ---- orders and posts ----
  sel = -1; // index into guards of the selected guard (-1 none)
  mark: { id: number; t: number } | null = null;
  // ---- corpse piles per lane (research 05 §7) ----
  piles = [0, 0, 0, 0];
  pileRot = 0; // a Pulper burst at the wall: ramps form sooner tonight
  pileWarned = false;
  globs: Glob[] = [];
  wallMark = 1; // the last tenth of wall integrity the leader's nerve took a hit at
  hints = new Set<string>();
  /** Feet y of walking lane i (0 far … 3 near). */
  laneY(i: number) { return LANES[Math.max(0, Math.min(LANES.length - 1, i))]; }

  constructor(canvas: HTMLCanvasElement, plan: NightPlan, onEnd: (r: NightResult) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.plan = plan;
    this.onEnd = onEnd;
    this.ground = document.createElement('canvas');
    this.ground.width = W;
    this.ground.height = H;
    this.gctx = this.ground.getContext('2d')!;
    this.dark = document.createElement('canvas');
    this.dark.width = W / 2;
    this.dark.height = H / 2;
    this.dctx = this.dark.getContext('2d')!;
    this.traps = G.fort.traps;
    this.duration = (plan.spawns[plan.spawns.length - 1]?.t ?? 30) + 5;
    this.wallStart = G.fort.hp;
    this.ammoStart = {};
    for (const k of [...AMMO_RES, 'scrap', 'molotov'] as Res[]) this.ammoStart[k] = G.stores[k] ?? 0;
    this.res = { kills: 0, deaths: [], wallHeld: true, wallLost: 0, ammoUsed: {}, killsBy: {}, headshots: 0, lines: [], fell: false };
    this.setupGuards();
    // last night's bodies, if nobody cleared them (G.flags.pileCarry: JSON number[4])
    try { const pc = G.flags.pileCarry ? JSON.parse(G.flags.pileCarry as string) as number[] : null; if (Array.isArray(pc)) this.piles = [0, 1, 2, 3].map((i) => Math.max(0, +pc[i] || 0)); } catch { /* none */ }
    if (G.flags.dog) this.dog = { x: 172, y: 699, barkT: 0, cd: 0, name: typeof G.flags.dog === 'string' ? G.flags.dog : 'The dog' };
    this.hooks = installModules(this); // night modules (the nail turrets moved to night/emplacements.ts)
    this.actors = new BattleActors(this);
    this.hooks.push(this.actors);
    this.queueBakes();
    const turning = G.flags.turningTonight as string | undefined;
    if (turning && byId(turning) && !byId(turning)!.dead) this.turnAt = this.duration * R.range(0.25, 0.6);
    this.keyHandler = (e) => this.onKey(e);
    this.bindInput();
    wind(true);
    if (G.buildings.some((b) => b.id === 'generator') && (G.fort.lights > 0 || (G.fort.turrets ?? 0) > 0)) ambienceLayer('generator', 0.22);
    if (plan.special === 'crossing') setTimeout(() => sfx.bell(), 1500);
    this.say(plan.label);
  }

  setupGuards() {
    const fighters = living().filter(canFight);
    fighters.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
    // two rows behind the wall; the leader on the near row at the slot closest to the wall,
    // the rest alternating rows, x slots at least 62px apart (a little less with six)
    const n = Math.min(6, fighters.length);
    const gap = n > 5 ? 50 : 62;
    fighters.slice(0, 6).forEach((s, i) => {
      const w = G.weapons.find((x) => x.uid === s.weapon) ?? null;
      const x = 262 - i * gap;
      const y = DEF_LANES[i % 2 === 0 ? 1 : 0];
      this.guards.push({
        s, w, x, y, sc: depthScale(y), cd: R.range(0, 1), mag: 0, reload: 0, kills: 0, flash: 0, fled: false, recoil: 0, homeX: x, face: 1, mauledT: 0, burstLeft: 0, burstT: 0, burstAng: 0, burstErr: 0, burstLane: LANES[2], burstX: 0, lastTgt: 0, dragT: 0, moodleC: '', moodleT: R.range(0, 1),
        post: 'step', order: 'free', blind: 0, duck: 0, holdT: 0,
      });
    });
    // magazines are loaded from the stores, not conjured
    for (const g of this.guards) {
      if (!g.w) continue;
      const prof = this.prof(g.w, g.s);
      g.mag = this.loadFromStores(prof, prof.mag);
      this.playerMag.set(g.w.uid, g.mag);
    }
    // posts: set at dusk (G.flags.posts = JSON { survivorId: post }) or sensible defaults
    let posts: Record<string, Post> = {};
    try { posts = G.flags.posts ? JSON.parse(G.flags.posts as string) as Record<string, Post> : {}; } catch { posts = {}; }
    let orders: Record<string, Order> = {};
    try { orders = G.flags.orders ? JSON.parse(G.flags.orders as string) as Record<string, Order> : {}; } catch { orders = {}; }
    const others = this.guards.filter((g) => !g.s.isLeader);
    for (const g of others) { if (posts[g.s.id]) g.post = posts[g.s.id]; if (orders[g.s.id]) g.order = orders[g.s.id]; }
    if (!Object.keys(posts).length) {
      // a shotgun at the loophole, the best long gun on the roof (if there is a nest), a runner when the line is long
      const loop = others.find((g) => g.w && WEAPONS[g.w.def].caliber === 'shot' && !hasTrait(g.s, 'coward'));
      if (loop && others.length >= 2) loop.post = 'loop';
      if (this.roofNest()) {
        const roof = others.filter((g) => g.post === 'step' && g.w && ['rifle', 'marksman'].includes(WEAPONS[g.w.def].cls)).sort((a, b) => b.s.skills.shooting - a.s.skills.shooting)[0];
        if (roof) roof.post = 'roof';
      }
      if (others.length >= 4) {
        const run = others.filter((g) => g.post === 'step').sort((a, b) => (a.w ? WEAPONS[a.w.def].dmg : 0) - (b.w ? WEAPONS[b.w.def].dmg : 0))[0];
        if (run && (!run.w || WEAPONS[run.w.def].cls === 'handgun')) run.post = 'runner';
      }
    }
    for (const g of others) this.placePost(g, g.post);
    // the frayed may come apart on the wall tonight
    for (const g of this.guards) {
      const th = breakThresholds(g.s);
      if (!g.s.isLeader && g.s.mood < th.minor && R.chance(g.s.mood < th.major ? 0.6 : 0.3)) g.panicAt = R.range(15, 60);
    }
    this.guards.sort((a, b) => a.y - b.y);
    // the leader's nerve (research 05 §4)
    const L = this.guards.find((g) => g.s.isLeader) ?? this.guards[0];
    if (L) {
      const s = L.s;
      let max = 55 + 4 * s.skills.shooting + (attr(s, 'courage') - 4) * 2;
      if (hasTrait(s, 'ironwill')) max += 15;
      if (hasTrait(s, 'steady')) max += 10;
      if (hasTrait(s, 'jittery')) max -= 15;
      if (hasTrait(s, 'fragile')) max -= 10;
      if (hasTrait(s, 'coward')) max -= 20;
      if (s.mood < 25) max -= 10;
      this.nerveMax = Math.max(30, Math.round(max));
      this.nerve = this.nerveMax * 0.8;
    }
  }

  /** A roof nest exists if the camp built one (a day project sets G.flags.roofNest). */
  roofNest() { return !!G.flags.roofNest || G.buildings.some((b) => b.id === 'roofnest'); }

  /** Move a guard to a post's slot. */
  placePost(g: Guard, post: Post) {
    if (post === 'loop' && hasTrait(g.s, 'coward')) {
      this.say(`${first(g.s)} won't take the loophole. "Not with my face in their teeth."`, 3);
      post = 'step';
    }
    g.post = post;
    if (post === 'roof') { g.homeX = 150; g.y = 548; }
    else if (post === 'loop') { g.homeX = WALL_X - 28; g.y = DEF_LANES[1]; }
    else {
      // back to a free slot on the step
      const used = new Set(this.guards.filter((o) => o !== g && o.post !== 'roof' && o.post !== 'loop').map((o) => Math.round(o.homeX)));
      let x = 262;
      while (used.has(x) && x > 60) x -= 50;
      g.homeX = x;
      g.y = DEF_LANES[this.guards.indexOf(g) % 2 === 0 ? 1 : 0];
    }
    g.x = g.homeX;
    g.sc = depthScale(post === 'roof' ? DEF_LANES[0] : g.y) * (post === 'roof' ? 0.92 : 1);
  }

  lastPlayer?: Guard;
  get player(): Guard | undefined {
    return this.guards.find((g) => g.s.isLeader && this.standing(g)) ?? this.guards.find((g) => this.standing(g));
  }

  standing(g: Guard) {
    return !g.s.dead && !g.fled && !g.downed;
  }

  bindInput() {
    const c = this.canvas;
    const pos = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * W;
      this.mouse.y = ((e.clientY - r.top) / r.height) * H;
    };
    c.onmousemove = pos;
    c.onmousedown = (e) => {
      pos(e);
      if (e.button === 2) this.setFocus(focusToggle() ? !this.focusing : true);
      else if (e.button === 1) { this.throwMolotov(); e.preventDefault(); }
      else {
        this.mouse.down = true;
        this.tryFire(true);
      }
    };
    c.onmouseup = (e) => { if (e.button === 2) { if (!focusToggle()) this.setFocus(false); } else if (e.button === 0) this.mouse.down = false; };
    c.onwheel = (e) => { e.preventDefault(); this.cycleWeapon(e.deltaY < 0 ? -1 : 1); };
    c.oncontextmenu = (e) => e.preventDefault();
    c.ontouchstart = (e) => {
      const t = e.touches[0];
      const r = c.getBoundingClientRect();
      this.mouse.x = ((t.clientX - r.left) / r.width) * W;
      this.mouse.y = ((t.clientY - r.top) / r.height) * H;
      this.mouse.down = true;
      this.tryFire(true);
      e.preventDefault();
    };
    c.ontouchmove = (e) => {
      const t = e.touches[0];
      const r = c.getBoundingClientRect();
      this.mouse.x = ((t.clientX - r.left) / r.width) * W;
      this.mouse.y = ((t.clientY - r.top) / r.height) * H;
      e.preventDefault();
    };
    c.ontouchend = () => (this.mouse.down = false);
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blurHandler);
  }
  blurHandler = () => { this.mouse.down = false; this.focusing = false; this.ducking = false; this.rDown = -1; };

  /** Hold RMB: Focus. Time ×0.6, spread ×0.4, kick ×0.5; drains nerve. Can't start below 10. */
  setFocus(on: boolean) {
    if (on && (this.nerve < 10 || !this.player || this.done)) { if (on && this.nerve < 10) this.text(this.mouse.x, this.mouse.y - 30, 'no nerve left', '#c88', 11); return; }
    this.focusing = on;
  }

  // Controls (the HUD's key line mirrors this):
  //   LMB fire · RMB (hold) Focus · MMB/[F] firebomb · [R] reload / clear (hold: speed reload) · [T] ammo / slug swap
  //   [B] fire selector · [Q]/wheel weapon · [S]/[Ctrl] (hold) duck · [E] rally · [M] mark target
  //   [1-9]/[Tab] select guard · [Z]/[X]/[C]/[K] order (Shift = everyone; V is melee, L lures, G deadfall/pipe mine, H gun nest) · [Y] guard's post · Space hurry · [P]/Esc pause
  onKey(e: KeyboardEvent) {
    const k = normKey(e);
    // paused: the pause menu has the keyboard (night/pause overlay); nothing reaches the wall
    if (this.paused) return;
    if (k === 'Escape' || k === keyOf('night.pause')) { e.preventDefault(); this.pause(); return; }
    for (const h of this.hooks) if (h.onKey?.(e)) return; // night modules
    if (k === keyOf('night.reload')) {
      if (e.repeat) return;
      if (this.jam || this.playerReload > 0) { this.startReload(); return; }
      this.rDown = performance.now();
      this.rDone = false;
    }
    else if (k === keyOf('night.firebomb')) this.throwMolotov();
    else if (/^[1-9]$/.test(k)) this.selectGuard(+k - 1);
    else if (k === 'Tab') { e.preventDefault(); this.selectGuard(this.sel + 1, true); }
    else if (k === keyOf('night.weapon')) this.cycleWeapon(1);
    else if (k === keyOf('night.ammo')) this.cycleAmmo();
    else if (k === keyOf('night.selector')) this.cycleMode();
    else if (k === keyOf('night.rally')) this.useRally();
    else if (k === keyOf('night.mark')) this.markTarget();
    else if (k === keyOf('night.post')) this.cyclePost();
    else if (k === keyOf('night.duck') || k === 'Control') this.ducking = true;
    else if (k === keyOf('night.free')) this.giveOrder('free', e.shiftKey);
    else if (k === keyOf('night.hold')) this.giveOrder('hold', e.shiftKey);
    else if (k === keyOf('night.heads')) this.giveOrder('heads', e.shiftKey);
    else if (k === keyOf('night.wall')) this.giveOrder('wall', e.shiftKey);
    else if (k === keyOf('night.hurry')) { this.fast = true; e.preventDefault(); }
  }

  /** P / Esc: freeze the night and open the pause menu (resume, settings, help, quit). */
  pause() {
    if (this.paused || this.ended) return;
    this.paused = true;
    this.blurHandler();
    this.fast = false;
    const host = this.canvas.parentElement ?? document.body;
    openPause(host, { where: 'night', resume: () => { this.paused = false; this.last = performance.now(); }, quit: () => { this.ended = true; this.destroy(); } });
  }

  // weapons the leader may pick up: their own and any unassigned
  available(): WeaponItem[] {
    const p = this.player;
    const held = new Set(this.guards.filter((g) => g !== p && g.w).map((g) => g.w!.uid));
    return G.weapons.filter((w) => !held.has(w.uid));
  }

  /** Change guns: a pistol comes up faster than any reload; a machine gun does not. */
  switchWeapon(i: number) {
    const p = this.player;
    const list = this.available();
    if (!p || !list[i] || list[i] === p.w) return;
    p.w = list[i];
    p.s.weapon = p.w.uid;
    this.playerReload = 0;
    this.reloadSfx?.cancel();
    this.jam = null;
    p.burstLeft = 0;
    if (!this.playerMag.has(p.w.uid)) this.playerMag.set(p.w.uid, 0);
    const prof = this.prof(p.w, p.s);
    this.playerCd = Math.max(this.playerCd, drawTime(prof));
    this.bloomShot = Math.max(this.bloomNow(), 0.05);
    this.lastShotT = this.t;
    this.climbN = 0;
    sfx.reload(gunSoundFor(p.w.def).reload, 'out');
    this.text(this.mouse.x, this.mouse.y - 26, (p.w.name ?? WEAPONS[p.w.def].name).toLowerCase(), '#d9c9a0', 11);
  }

  cycleWeapon(dir = 1) {
    const p = this.player;
    const list = this.available();
    if (!p || !list.length) return;
    const i = p.w ? list.indexOf(p.w) : -1;
    this.switchWeapon((i + dir + list.length) % list.length);
  }

  // ---------- orders ----------
  /** The guards the player can give orders to (not the leader), in their order on the line, left to right. */
  orderable() { return this.guards.filter((g) => g !== this.player && !g.s.dead && !g.fled).sort((a, b) => a.homeX - b.homeX); }
  selectGuard(i: number, wrap = false) {
    const list = this.orderable();
    if (!list.length) return;
    if (wrap) i = ((i % list.length) + list.length) % list.length;
    const g = list[i];
    if (!g) return;
    this.sel = i;
    sfx.ui();
    const mag = g.w ? `${g.mag}/${this.prof(g.w, g.s).mag}` : '';
    this.say(`${first(g.s)} — ${g.w ? (g.w.name ?? WEAPONS[g.w.def].name).toLowerCase() : 'no gun'} ${mag} — ${POST_NAMES[g.post].toLowerCase()}, ${ORDER_NAMES[g.order].toLowerCase()}`, 2.5);
  }
  selected(): Guard | undefined { return this.sel >= 0 ? this.orderable()[this.sel] : undefined; }
  giveOrder(o: Order, all: boolean) {
    const list = all ? this.orderable() : [this.selected()].filter((g): g is Guard => !!g);
    if (!list.length) { this.say('Select a guard first: [1-9] or [Tab]. Shift sets everyone.', 2.5); return; }
    for (const g of list) g.order = o;
    sfx.ui();
    this.say(`${all ? 'Everyone' : first(list[0].s)}: ${ORDER_NAMES[o].toLowerCase()}.`, 2);
  }
  cyclePost() {
    const g = this.selected();
    if (!g) { this.say('Select a guard first: [1-9] or [Tab].', 2); return; }
    const opts: Post[] = ['step', 'loop', 'runner', ...(this.roofNest() ? ['roof' as Post] : [])];
    let next = opts[(opts.indexOf(g.post) + 1) % opts.length];
    // one at the loophole, one on the roof
    for (let k = 0; k < opts.length && (next === 'loop' || next === 'roof') && this.guards.some((o) => o !== g && o.post === next && !o.s.dead); k++) next = opts[(opts.indexOf(next) + 1) % opts.length];
    this.placePost(g, next);
    this.say(`${first(g.s)} to the ${POST_NAMES[g.post].toLowerCase()}.`, 2);
  }
  markTarget() {
    const z = this.pick(this.mouse.x, this.mouse.y);
    if (!z) return;
    this.mark = { id: z.id, t: 5 };
    sfx.ui();
  }
  /** [E]: a Rally, banked from a five-headshot streak. */
  useRally() {
    const p = this.player;
    if (!p || this.rally <= 0 || this.rallyT > 0) { if (this.rally <= 0) this.text(this.mouse.x, this.mouse.y - 30, 'no rally banked', '#a89c84', 10); return; }
    this.rally--;
    this.rallyT = 4 + 0.4 * p.s.skills.social;
    this.nerve = Math.min(this.nerveMax, this.nerve + 20);
    this.say(`${first(p.s)}: "${R.pick(['Hold! Hold the line!', 'Pick your shots! Heads!', 'Steady — they die like anybody!', 'With me! Now!'])}"`, 3);
    for (const g of this.guards) if (this.standing(g) && g.mode === 'panic') { g.mode = undefined; g.panicAt = undefined; }
    const fled = this.guards.find((g) => g.fled && !g.s.dead && g.s.id !== G.flags.turningTonight);
    if (fled && R.chance(0.6)) { fled.fled = false; fled.x = fled.homeX; this.say(`${first(fled.s)} comes back to the wall.`, 3); }
    tale(p.s, `Called the line together, night ${G.day}.`);
    for (const g of this.guards) if (g !== p && this.standing(g)) changeOpinion(g.s, p.s, 3);
    sfx.bell();
  }
  say(text: string, life = 5) {
    this.messages.push({ text, life });
    if (this.messages.length > 4) this.messages.shift();
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const quiet = !this.zombies.some((z) => z.state !== 'dying' && z.x < 1000);
      if (!screenFx()) { this.hitstop = 0; this.killFlash = 0; this.wallFlash = 0; this.nerveFlash = 0; } // Settings: no flashes / hitstop
      if (!this.paused) {
        // slow-mo, the HUD tweens and the ringing ears run on real time
        this.slowmo = Math.max(0, this.slowmo - dt);
        this.slowCd = Math.max(0, this.slowCd - dt);
        this.killFlash = Math.max(0, this.killFlash - dt);
        this.ammoPunch = Math.max(0, this.ammoPunch - dt * 6);
        this.wallFlash = Math.max(0, this.wallFlash - dt);
        this.nerveFlash = Math.max(0, this.nerveFlash - dt);
        // hitstop: a heavy hit holds the world still for a few frames (never the nerve clock)
        if (this.hitstop > 0) { this.hitstop -= dt; this.tickNerve(dt * 0.5); }
        else {
          const steps = this.fast && quiet && !this.done ? 4 : 1;
          this.timeScale = (this.slowmo > 0 ? 0.35 : 1) * (this.focusing ? 0.6 : 1);
          for (let i = 0; i < steps; i++) this.update(dt * this.timeScale);
          this.tickNerve(dt);
        }
      }
      if (this.ended) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    (window as unknown as { __battle: Battle }).__battle = this;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blurHandler);
    this.reloadSfx?.cancel();
    ambienceLayer('fire', 0);
    ambienceLayer('generator', 0);
    const c = this.canvas;
    c.onmousemove = c.onmousedown = c.onmouseup = null;
    c.onwheel = null;
    c.ontouchstart = c.ontouchmove = c.ontouchend = null;
    wind(false);
  }

  // ---------------- update ----------------
  update(dt: number) {
    this.t += dt;
    this.intro = Math.max(0, this.intro - dt);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.updateEars(dt);
    this.updateVoices(dt);
    this.bloom = this.bloomNow();
    this.rallyT = Math.max(0, this.rallyT - dt);
    if (this.mark) { this.mark.t -= dt; const mz = this.zombies.find((z) => z.id === this.mark!.id); if (this.mark.t <= 0 || !mz || mz.state === 'dying') this.mark = null; }
    this.firedHard = Math.max(0, this.firedHard - dt * 1.5);
    if (this.hitMark) { this.hitMark.t -= dt; if (this.hitMark.t <= 0) this.hitMark = null; }
    for (const g of this.guards) { g.blind = Math.max(0, g.blind - dt); g.duck = Math.max(0, g.duck - dt); }
    this.updateGlobs(dt);
    this.updatePiles(dt);
    this.surge = Math.max(0, this.surge - dt);
    this.sharp = Math.max(0, this.sharp - dt);
    this.drainOpen = Math.max(0, this.drainOpen - dt);
    // spawns
    while (this.spawnIdx < this.plan.spawns.length && this.plan.spawns[this.spawnIdx].t <= this.t) {
      const sp = this.plan.spawns[this.spawnIdx];
      this.spawn(sp.type, false, sp.name, sp.dark);
      this.spawnIdx++;
    }
    // noise draws stragglers
    if (this.noise > 28) {
      this.noise -= 28;
      this.spawn(R.chance(0.7) ? 'sleeper' : 'deer', true);
    }
    // the turning
    if (this.turnAt > 0 && this.t >= this.turnAt) {
      this.turnAt = -1;
      this.turnSurvivor();
    }
    this.updatePlayer(dt);
    for (const g of this.guards) this.updateGuard(g, dt);
    this.updateDowned(dt);
    if (this.dog) this.updateDog(dt);
    for (const tu of this.turrets) this.updateTurret(tu, dt);
    for (const l of this.lobs) { l.t += dt; if (l.t >= l.dur) this.blast(l.x1, l.y1, l.p.explosive!, l.p.knock, l.g); }
    this.lobs = this.lobs.filter((l) => l.t < l.dur);
    // walk the road front to back, so each body knows where the one ahead of it in its lane
    // already stands this frame (spacing, wall queues, lane hops)
    this.zombies.sort((a, b) => a.x - b.x);
    for (const L of this.lanes) L.length = 0;
    for (const z of this.zombies) if (this.inLane(z)) this.lanes[z.lane].push(z);
    this.laneLast.fill(undefined);
    this.laneQ.fill(0);
    for (const z of this.zombies) this.updateZombie(z, dt);
    for (const h of this.hooks) h.update?.(dt); // night modules
    this.zombies = this.zombies.filter((z) => !(z.state === 'dying' && z.dieT > 0.6) && !(z.state === 'flee' && z.x > W + 140));
    this.updateParticles(dt);
    for (const f of this.fires) {
      f.life -= dt;
      if (R.chance(dt * 45)) this.particles.push({ x: f.x + R.range(-f.w / 2, f.w / 2), y: f.y + R.range(-26, 20), vx: R.range(-8, 8), vy: R.range(-110, -50), life: 0.7, max: 0.7, size: R.range(3, 7), color: '#ffb347', kind: 'fire', ground: 0 });
      if (R.chance(dt * 8)) this.particles.push({ x: f.x + R.range(-f.w / 3, f.w / 3), y: f.y - 70, vx: R.range(-6, 12), vy: R.range(-50, -25), life: 2.5, max: 2.5, size: R.range(8, 14), color: '#222', kind: 'smoke', ground: 0 });
    }
    this.fires = this.fires.filter((f) => f.life > 0);
    for (const tr of this.tracers) tr.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const l of this.lights) l.life -= dt;
    this.lights = this.lights.filter((l) => l.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= dt * 22; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const m of this.messages) m.life -= dt;
    this.messages = this.messages.filter((m) => m.life > 0);
    if (G.fort.hp <= 0 && this.res.wallHeld) {
      this.res.wallHeld = false;
      this.say('THE WALL IS DOWN. They are coming over.', 6);
      this.shake = 14;
      sfx.boom();
    }
    // end
    const alive = this.zombies.filter((z) => z.state !== 'dying').length;
    const anyone = this.guards.some((g) => this.standing(g));
    if (!anyone && !this.done) {
      this.done = true;
      this.res.fell = true;
      this.say('The line is gone.', 8);
      this.endT = 3;
    }
    if (!this.done && this.spawnIdx >= this.plan.spawns.length && alive === 0 && this.t > 8) {
      this.done = true;
      this.endT = 3.2;
      this.say('Quiet. Grey light over the river.', 6);
    }
    if (this.done) {
      this.endT -= dt;
      if (this.endT <= 0 && !this.ended) this.finish();
    }
  }

  spawn(type: string, straggler = false, name?: string, dark = false) {
    const def = ZOMBIES[type];
    if (!def) return;
    // a big wave forms up out in the dark, close in: past what the guards and the floodlights make out (balance.md §10)
    const darkX = dark && !def.boss && !def.tunnel && !def.ranged ? this.darkBand() : 0;
    // the lane with the fewest bodies in the rightmost 300px; ties at random
    const count = [0, 0, 0, 0];
    for (const o of this.zombies) if (o.x > W - 300 && this.inLane(o)) count[o.lane]++;
    const fewest = Math.min(...count);
    const lane = R.pick([0, 1, 2, 3].filter((i) => count[i] === fewest));
    const yoff = R.range(-3, 3);
    const y = LANES[lane] + yoff;
    const jit = R.range(0.96, 1.04);
    const hpMul = def.ranged || def.boss ? 1 : 1 + Math.max(0, G.day - 8) * 0.02; // balance.md §8.9
    const sprite = R.pick(def.sprites);
    const z: Zombie = {
      id: this.nextId++, def, sprite, x: darkX ? R.range(darkX, 1150) : W + R.range(30, 120), y, rise: darkX ? 1.2 : undefined, hp: def.hp * hpMul, maxHp: def.hp * hpMul, state: 'walk',
      phase: R.range(0, 10), flash: 0, slow: 0, burn: 0, dieT: 0, maulT: 0, lungeT: R.range(1, 3), screamT: R.range(3, 6), scale: depthScale(y) * jit, wallHit: 0, name,
      lane, ty: y, jit, variant: R.int(0, 2), laneCd: 1, blocked: 0, stun: 0, legDmg: 0, armDmg: 0,
    };
    const w = this.zw(z);
    // heads alternate in x as well as y: stand off from the neighbours, never on top of the one ahead
    for (let k = 0; k < 4; k++) {
      let moved = false;
      for (const o of this.zombies) {
        if (!this.inLane(o)) continue;
        const dl = Math.abs(o.lane - lane);
        const need = dl === 0 ? 0.55 * w : dl === 1 ? 0.3 * w : 0;
        if (need && Math.abs(o.x - z.x) < need) { z.x = o.x + need; moved = true; }
      }
      if (!moved) break;
    }
    // never the same sprite and variant as a neighbour within 120px in this or an adjacent lane
    for (let k = 0; k < 3 && this.zombies.some((o) => o.sprite === sprite && o.variant === z.variant && Math.abs(o.x - z.x) < 120 && Math.abs(o.lane - lane) <= 1); k++) z.variant = (z.variant + 1) % 3;
    if (def.tunnel) {
      // up out of the storm drain, behind the wall
      z.x = DRAIN_X + R.range(-8, 8);
      z.y = z.ty = DEF_LANES[1] - R.range(4, 12);
      z.lane = 3;
      z.state = 'over';
      z.flip = true;
      z.emerge = 0.9;
      this.drainOpen = 6;
      if (!this.zombies.some((o) => o.def.tunnel && o.state !== 'dying')) {
        this.say('The drain grate behind us lifts. Something is coming up the pipe.', 4);
        this.shake = Math.max(this.shake, 4);
        this.dogBark('the drain');
      }
      sfx.thud();
    } else if (def.ranged) {
      z.stopX = R.range(800, 1000);
      z.seen = 0;
      if (!this.zombies.some((o) => o.def.ranged && o.state !== 'dying')) this.say('Men on the road. Living men, with rifles.', 4);
    } else if (def.boss) {
      z.x = W + 60;
      z.lane = 2;
      z.y = z.ty = LANES[2];
      z.jit = 1;
      z.screamT = 5;
      this.boss = z;
      this.say('Out on the ice, something tall. It is carrying the bell.', 6);
      sfx.bell();
    } else if (def.lunge) {
      this.dogBark('a runner');
    } else if (def.spit) {
      z.stopX = R.range(820, 1000); // out past where the guards can make it out without floodlights
      z.spitT = R.range(0.9, 1.4);
      if (!this.hints.has('biler')) { this.hints.add('biler'); this.say(`A Biler. It spits over the wall — hold ${keyCap('night.duck')} to duck, or shoot the glob.`, 5); }
    } else if (def.leap) {
      if (!this.hints.has('buck')) { this.hints.add('buck'); this.say('A Buck. When it crouches and its eyes catch the light, it jumps. Shoot it in the crouch.', 5); }
    }
    this.zombies.push(z);
    if (name) {
      const of = G.flags.oldFace ? JSON.parse(G.flags.oldFace as string) as { name: string; by: string } : null;
      const by = of ? byId(of.by) : undefined;
      this.say(by && !by.dead ? `${first(by)}: "That's ${name}. Oh God, that's ${name}."` : `Someone says a name in the dark: ${name}.`, 6);
      delete G.flags.oldFace;
      this.oldFaceBy = of?.by;
    }
    if (straggler && R.chance(0.3)) this.say('Your shooting carries. More are coming up the road.', 3);
    const v = voiceOf(def.id);
    if (darkX) {
      // the telegraph: a chorus out in the dark, closer than it should be
      if (v && this.t - this.alertT > 0.25) { this.alertT = this.t; sfx.zombieVoice(v, 'alert', { pan: panOf(z.x), volume: 0.8 }); }
      if (this.t - this.darkSaid > 12) { this.darkSaid = this.t; this.say('Out in the dark, close: a lot of them, all at once.', 3); }
    } else if (v && (def.cost >= 3 || R.chance(0.2))) sfx.zombieVoice(v, 'alert', { far: true, pan: 0.75, volume: def.cost >= 3 ? 0.9 : 0.55 });
  }
  darkSaid = -99;
  /** Where a body can form up unseen: past the guards' sight in this light (and the floodlights' best throw), never past 1090. */
  darkBand() {
    const sight = WALL_X + ((this.plan.special === 'fog' ? 640 : 820) - WALL_X) * Battle.tune.guardRange + Math.min(3, G.fort.lights) * 130 + (this.guards.some((g) => g.post === 'roof') ? 260 : 0);
    return Math.min(1090, Math.max(this.plan.special === 'fog' ? 820 : 900, sight + 60));
  }

  /** Ringing ears: sustained loud fire near the leader without ear defenders muffles the world for a few seconds. */
  updateEars(dt: number) {
    this.earLoad = Math.max(0, this.earLoad - dt * 1.4);
    this.earCd = Math.max(0, this.earCd - dt);
    if (this.earLoad > 16 && this.earCd <= 0 && !G.flags.earDefenders && !this.done) {
      muffle(Math.min(0.65, 0.35 + (this.earLoad - 16) / 40), 3.2);
      this.earCd = 22;
      this.earLoad = 8;
      if (!this.hints.has('ears')) { this.hints.add('ears'); const p = this.player; if (p) this.text(p.x, p.y - 172, 'ears ringing', '#b8ab90', 10); }
    }
    // the fire layer follows what is burning on the road
    const lvl = Math.min(0.6, this.fires.length * 0.2 + (this.zombies.some((z) => z.burn > 0) ? 0.1 : 0));
    if (Math.abs(lvl - this.fireLevel) > 0.05) { this.fireLevel = lvl; ambienceLayer('fire', lvl); }
  }
  /** Sparse groans off the road: one body at a time, more often the more there are, never a wall of it. */
  updateVoices(dt: number) {
    this.idleT -= dt;
    if (this.idleT > 0) return;
    const out = this.zombies.filter((z) => z.state !== 'dying' && !z.def.ranged && z.x < W + 40 && z.x > WALL_X);
    this.idleT = (out.length ? Math.max(0.5, 3.2 / Math.sqrt(out.length)) : 2) * R.range(0.7, 1.4);
    if (!out.length) return;
    const z = R.pick(out);
    const v = voiceOf(z.def.id);
    if (v) sfx.zombieVoice(v, 'idle', { pan: panOf(z.x), far: z.x > 900, volume: 0.55 + 0.35 * depthT(z.y) });
  }
  /** A body reaching the wall: a snarl now and then (rate-limited across the horde). */
  alertVoice(z: Zombie) {
    if (this.t - this.alertT < 0.6 || !R.chance(0.4)) return;
    this.alertT = this.t;
    const v = voiceOf(z.def.id);
    if (v) sfx.zombieVoice(v, 'alert', { pan: panOf(z.x), volume: 0.75 });
  }

  turnSurvivor() {
    const s = byId(G.flags.turningTonight as string);
    delete G.flags.turningTonight;
    if (!s || s.dead) return;
    const g = this.guards.find((x) => x.s === s);
    const x = g ? g.x : 120;
    const y = g ? g.y : DEF_LANES[1];
    if (g) g.fled = true;
    killSurvivor(s, 'turned, behind our own wall');
    this.res.deaths.push(`${first(s)} turned`);
    this.zombies.push({
      id: this.nextId++, def: ZOMBIES.sleeper, sprite: s.sex === 'm' ? 'z_shambler' : 'z_shambler2', x, y, hp: 90, maxHp: 90, state: 'over',
      phase: 0, flash: 0, slow: 0, burn: 0, dieT: 0, maulT: 0, lungeT: 0, screamT: 99, scale: depthScale(y), name: first(s), wallHit: 0,
      lane: 3, ty: y, jit: 1, variant: 0, laneCd: 0, blocked: 0, stun: 0, legDmg: 0, armDmg: 0,
    });
    this.say(`${first(s).toUpperCase()} HAS TURNED. Behind the wall.`, 7);
    this.shake = 8;
    this.slowmo = 1.2;
    sfx.scream();
    log('death', `${displayName(s)} turned on the line in the middle of the night.`);
  }

  // ---------- shooting ----------
  // The leader's gun (docs/balance.md §8, research 05 §3, DESIGN "real, not annoying"):
  // patience is accurate (aimed shots ×0.6, bloom that recovers in a third of a second),
  // spraying is not (per-class kick to a 0.30 cap, recoil climb, heat). Skill reaches the hand
  // as sway. The gun's state (chamber, partial mags, the tube, stoppages) is the player's to manage,
  // but [R] always does the sensible thing.
  updatePlayer(dt: number) {
    const p = this.player;
    if (p !== this.lastPlayer) {
      // whoever takes the line keeps the rounds actually in their gun
      const o = this.lastPlayer;
      if (o?.w) o.mag = this.playerMag.get(o.w.uid) ?? 0;
      if (p?.w) this.playerMag.set(p.w.uid, p.mag);
      if (o) o.burstLeft = 0;
      this.playerReload = 0;
      this.jam = null;
      this.reloadKind = 'tac';
    }
    this.lastPlayer = p;
    if (!p || !p.w) return;
    this.playerCd -= dt;
    this.settle = Math.max(0, this.settle - dt);
    const prof = this.eff(p);
    // heat bleeds off quickly once the trigger is let go
    for (const [uid, h] of this.heat) this.heat.set(uid, Math.max(0, h - heatCool(prof) * dt));
    if (this.jam && this.jam.clearing > 0) {
      this.jam.clearing -= dt;
      if (this.jam.clearing <= 0) {
        if (this.jam.kind === 'barrel') { this.heat.set(p.w.uid, 0); this.say('Fresh barrel.', 1.5); }
        this.jam = null;
        sfx.reload(gunSoundFor(p.w.def).reload, 'rack');
      }
    }
    if (this.playerReload > 0) {
      this.playerReload -= dt;
      if (this.playerReload <= 0) this.finishReload(p);
    }
    // a hold on [R] is a speed reload: the magazine goes in the snow
    if (this.rDown >= 0 && !this.rDone && performance.now() - this.rDown > 350) {
      this.rDone = true;
      this.startReload('speed');
    }
    // the settle time of a slow optic: swinging onto a new body
    const hv = this.hover;
    if (hv && hv.id !== this.settleId) { this.settleId = hv.id; if (prof.switchTime > 0) this.settle = prof.switchTime; }
    p.face = this.mouse.x < p.x - 12 ? -1 : 1;
    // the recoil climb falls away when the string of fire ends
    if (this.t - this.lastShotT > Math.max(0.18, 1.6 / prof.rof)) { this.climbN = 0; this.climbY = Math.max(0, this.climbY - dt * 120); }
    if (p.burstLeft > 0) {
      p.burstT -= dt;
      if (p.burstT <= 0) this.playerRound(p, prof);
    } else if (this.mouse.down && prof.auto) this.tryFire(false);
    p.recoil = Math.max(0, p.recoil - dt * 8);
    p.flash = Math.max(0, p.flash - dt);
  }

  // fireProfile is pure; cache it per gun (and shooter, and load) until its condition changes
  profCache = new Map<string, { cond: number; p: FireProfile }>();
  prof(w: WeaponItem, s?: Survivor, ammo?: Res): FireProfile {
    const key = `${w.uid}|${s?.id ?? ''}|${ammo ?? w.ammoType ?? ''}`;
    const c = this.profCache.get(key);
    if (c && Math.abs(c.cond - w.cond) < 0.02) return c.p;
    const item = ammo ? { ...w, ammoType: ammo } : w;
    const cls = WEAPONS[w.def]?.cls ?? 'improvised';
    const p = fireProfile(item, s ? { shooter: shooterMods(s, cls, !s.isLeader || s !== this.player?.s) } : {});
    this.profCache.set(key, { cond: w.cond, p });
    return p;
  }
  /** The leader's profile as the selector and the tube make it: semi / burst / auto, and the next shell's type. */
  eff(p: Guard, ammo?: Res): FireProfile {
    const w = p.w!;
    const base = this.prof(w, p.s, ammo);
    const mode = this.modes.get(w.uid);
    if (!mode || mode === fireModes(w, base)[0]) return base;
    if (mode === 'semi') return { ...base, auto: false, burst: 1 };
    // burst on an automatic: three rounds at its cyclic rate
    return { ...base, auto: false, burst: base.burst > 1 ? base.burst : 3, burstGap: base.burst > 1 ? base.burstGap : 1 / base.rof };
  }
  /** Shell types in a tube gun's magazine, top (next to fire) last. Kept the same length as the round count. */
  tubeOf(w: WeaponItem, n: number): Res[] {
    let t = this.tube.get(w.uid);
    if (!t) { t = []; this.tube.set(w.uid, t); }
    const def = selectedAmmo(w);
    while (t.length < n && def) t.unshift(def);
    if (t.length > n) t.splice(0, t.length - n);
    return t;
  }
  usesTube(w: WeaponItem, p: FireProfile) { return p.reloadPerRound && ammoTypesFor(w.def).length > 1; }

  // take up to `want` rounds of this profile's ammunition out of the stores
  loadFromStores(prof: FireProfile, want: number) {
    if (!prof.ammoRes) return want;
    const got = Math.max(0, Math.min(want, roundsInStores(prof, G.stores)));
    add(prof.ammoRes, -got * prof.perShot);
    return got;
  }

  /** [R]: clear a stoppage first; otherwise reload — tactical (the partial mag goes in the pouch, one stays chambered), empty, or speed (hold [R]: the mag is dropped). */
  startReload(kind: 'smart' | 'speed' | 'auto' = 'smart') {
    const p = this.player;
    if (!p || !p.w) return;
    if (this.jam) {
      if (this.jam.clearing <= 0) {
        this.jam.clearing = this.jam.kind === 'barrel' ? 2.2 * (1.1 - prof(p.s, 'heavy') * 0.04) : clearTime(this.prof(p.w, p.s), p.s, this.jam.kind);
        if (this.jam.kind === 'double') this.say('Double-feed. Lock, strip, rack.', 2);
        // the rig plays the clear (tap-rack / strip) and voices each stage; Classic: one sound
        if (!this.actors.clearJam(p, this.jam.kind, this.jam.clearing)) sfx.reload(gunSoundFor(p.w.def).reload, this.jam.kind === 'barrel' ? 'out' : 'bolt');
      }
      return;
    }
    if (this.playerReload > 0) return;
    const prof0 = this.prof(p.w, p.s);
    const mag = this.playerMag.get(p.w.uid) ?? 0;
    const keep = hasChamber(p.w, prof0) && mag > 0 ? 1 : 0;
    if (mag >= prof0.mag + keep) return;
    const pouchKey = `${p.w.uid}|${prof0.ammoRes}`;
    const pouch = this.pouch.get(pouchKey) ?? [];
    if (roundsInStores(prof0, G.stores) < 1 && !pouch.length) {
      this.say(`No ${ammoLabel(prof0.ammoRes).toLowerCase()} left. Switch weapons ${keyCap('night.weapon')}.`, 2);
      sfx.dry();
      return;
    }
    const armHurt = p.s.wounds.some((w) => w.part === 'larm' || w.part === 'rarm') ? 1.35 : 1;
    const lost = p.s.scars.some((s) => s.label.includes('arm')) ? 1.6 : 1;
    const runner = this.guards.some((g) => g.post === 'runner' && this.standing(g)) ? 0.85 : 1;
    let t = prof0.reload * armHurt * lost * runner * (!prof0.reloadPerRound && p.w.cond < 0.4 ? 1.3 : 1);
    if (!prof0.reloadPerRound) {
      if (mag <= keep) { this.reloadKind = 'empty'; if (hasChamber(p.w, prof0)) t += 0.3; } // rack the slide
      else if (kind === 'speed') {
        this.reloadKind = 'speed';
        t *= 0.7;
        // the mag goes in the snow: picked up at dawn if the wall holds (never on Hardcore)
        const res = prof0.ammoRes;
        if (res) this.dropped[res] = (this.dropped[res] ?? 0) + (mag - keep) * prof0.perShot;
        this.droppedMags++;
        this.playerMag.set(p.w.uid, keep);
        this.text(p.x + 30, p.y - 110, 'mag dropped', '#a89c84', 10);
      } else {
        this.reloadKind = 'tac';
        if (mag - keep > 0) pouch.push(mag - keep);
        this.pouch.set(pouchKey, pouch);
        this.playerMag.set(p.w.uid, keep);
      }
    } else this.reloadKind = 'tac';
    this.playerReload = t;
    this.reloadTotal = t;
    this.reloadSfx?.cancel();
    // the rig plays the reload over t and its events voice each stage (Classic: scheduled sfx)
    const anim = this.actors.reload(p, t, { empty: mag <= keep, perRound: prof0.reloadPerRound, rounds: prof0.mag });
    if (anim) this.reloadSfx = anim;
    else if (prof0.reloadPerRound) sfx.reload(gunSoundFor(p.w.def).reload, 'shell');
    else this.reloadSfx = sfx.reloadFor(p.w.def, t);
    void kind;
  }

  finishReload(g: Guard) {
    if (!g.w) return;
    const prof = this.prof(g.w, g.s);
    const mag = this.playerMag.get(g.w.uid) ?? 0;
    if (prof.reloadPerRound) {
      // one shell at a time, of whatever type is selected for the next load
      const tube = this.usesTube(g.w, prof) ? this.tubeOf(g.w, mag) : null;
      const got = this.loadFromStores(prof, 1);
      this.playerMag.set(g.w.uid, mag + got);
      if (tube && got && prof.ammoRes) tube.push(prof.ammoRes);
      if (mag + got < prof.mag && got > 0) this.startReload();
      return;
    }
    // fullest first: a fresh magazine from the stores, else the fullest partial from the pouch
    const pouchKey = `${g.w.uid}|${prof.ammoRes}`;
    const pouch = this.pouch.get(pouchKey) ?? [];
    const fresh = Math.min(prof.mag, roundsInStores(prof, G.stores));
    pouch.sort((a, b) => a - b);
    let got: number;
    if (fresh < prof.mag && pouch.length && pouch[pouch.length - 1] > fresh) got = pouch.pop()!;
    else got = this.loadFromStores(prof, prof.mag);
    this.pouch.set(pouchKey, pouch);
    this.playerMag.set(g.w.uid, mag + got);
  }

  /** [T]: the next bullet type. Box mags: the next magazine. A tube: the next shell — and if the tube is full, swap the top shell for it (slug swap). */
  cycleAmmo() {
    const p = this.player;
    if (!p || !p.w) return;
    const types = ammoTypesFor(p.w.def);
    if (types.length < 2) return;
    const prof0 = this.prof(p.w, p.s);
    const cur = prof0.ammoRes;
    const have = types.filter((t) => t === cur || (G.stores[t] ?? 0) > 0);
    const next = have[(have.indexOf(cur!) + 1) % have.length];
    if (!next || next === cur) { this.say(`No other ammunition for the ${WEAPONS[p.w.def].name.toLowerCase()}.`, 2); return; }
    p.burstLeft = 0;
    if (this.usesTube(p.w, prof0)) {
      const m = this.playerMag.get(p.w.uid) ?? 0;
      const tube = this.tubeOf(p.w, m);
      p.w.ammoType = next;
      this.say(`Next shell: ${ammoLabel(next).toLowerCase()}.`, 2);
      if (m >= prof0.mag && this.playerReload <= 0 && tube.length) {
        // thumb the top shell out, feed the new one in
        const out = tube.pop()!;
        add(out, this.prof(p.w, p.s, out).perShot);
        this.playerMag.set(p.w.uid, m - 1);
        this.startReload();
      } else if (this.playerReload <= 0) this.startReload();
      return;
    }
    const m = this.playerMag.get(p.w.uid) ?? 0;
    if (cur && m > 0) add(cur, m * prof0.perShot);
    this.playerMag.set(p.w.uid, 0);
    p.w.ammoType = next;
    this.playerReload = 0;
    this.say(`Loading ${ammoLabel(next).toLowerCase()}.`, 2);
    this.startReload();
  }

  /** [B]: the fire selector, where the gun has one. */
  cycleMode() {
    const p = this.player;
    if (!p || !p.w) return;
    const modes = fireModes(p.w, this.prof(p.w, p.s));
    if (modes.length < 2) { this.say('No selector on this one.', 1.5); return; }
    const cur = this.modes.get(p.w.uid) ?? modes[0];
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    this.modes.set(p.w.uid, next);
    p.burstLeft = 0;
    sfx.reload(gunSoundFor(p.w.def).reload, 'close');
    this.text(this.mouse.x, this.mouse.y - 26, next.toUpperCase(), '#d9c9a0', 11);
  }

  /** Can the leader shoot right now? (Not ducked, not mid-reload of a box mag, not jammed.) */
  tryFire(click: boolean) {
    const p = this.player;
    if (!p || !p.w || this.done || this.intro > 3.2 || p.burstLeft > 0) return;
    if (this.hooks.some((h) => h.blockFire?.())) return; // night modules: on a gun nest
    const prof = this.eff(p);
    if (!click && !prof.auto) return;
    if (this.playerCd > 0) return;
    if (this.ducking) return;
    if (this.jam) {
      if (click && this.jam.clearing <= 0) { sfx.dry(); this.text(this.mouse.x, this.mouse.y - 24, this.jam.kind === 'barrel' ? `BARREL — ${keyCap('night.reload')}` : `JAMMED — ${keyCap('night.reload')}`, '#e0a060', 11); }
      this.playerCd = 0.2;
      return;
    }
    if (this.playerReload > 0) {
      // firing interrupts a shell-by-shell reload
      if (prof.reloadPerRound && (this.playerMag.get(p.w.uid) ?? 0) > 0) { this.playerReload = 0; this.reloadSfx?.cancel(); }
      else return;
    }
    const mag = this.playerMag.get(p.w.uid) ?? 0;
    if (mag <= 0) {
      sfx.dry();
      if (autoReload()) this.startReload('auto');
      else this.text(this.mouse.x, this.mouse.y - 24, `empty — ${keyCap('night.reload')}`, '#e0a060', 11);
      this.playerCd = 0.25;
      return;
    }
    // an LMG run too hot has to have its barrel changed
    if (swapsBarrel(p.w) && (this.heat.get(p.w.uid) ?? 0) >= heatLimit(prof) * 1.7) {
      this.jam = { kind: 'barrel', clearing: 0 };
      this.say(`The barrel is glowing. ${keyCap('night.reload')} to swap it.`, 2.5);
      sfx.overheat();
      return;
    }
    // malfunctions: never the first shot of the night; worn guns, cold without oil and heat make them likelier
    if (this.shotsTonight > 0) {
      const cold = (G.weather === 'cold' || G.weather === 'snow' || this.plan.special === 'crossing') && G.flags.oiledDay !== G.day ? 1.7 : 1;
      const hot = usesHeat(prof) && (this.heat.get(p.w.uid) ?? 0) > heatLimit(prof) ? 0.015 : 0;
      if (R.chance(prof.jam * cold + hot)) {
        const kind: Malfunction = R.chance(realism() === 'hardcore' ? 0.3 : 0.1) ? 'double' : 'tap';
        this.jam = { kind, clearing: 0 };
        p.burstLeft = 0;
        this.say(kind === 'double' ? `${p.w.name ?? WEAPONS[p.w.def].name}: double-feed. ${keyCap('night.reload')}` : `${p.w.name ?? WEAPONS[p.w.def].name} jammed. Tap ${keyCap('night.reload')}.`, 1.8);
        sfx.jam();
        this.playerCd = 0.15;
        return;
      }
    }
    const natural = this.prof(p.w, p.s);
    if (natural.auto && prof.burst > 1) this.playerCd = prof.burst / natural.rof + 0.14; // burst on an automatic
    else if (natural.auto && !prof.auto) this.playerCd = Math.max(1 / natural.rof, 0.09); // semi: as fast as the finger
    else this.playerCd = 1 / prof.rof;
    p.burstLeft = Math.min(prof.burst, mag);
    p.burstT = 0;
    this.playerRound(p, prof);
  }

  /** The leader's current bloom (rad): held for a beat after a shot, then halving every 0.15 s. */
  bloomNow() { return bloomAfter(this.bloomShot, this.t - this.lastShotT); }
  /** Is the next shot an aimed one? */
  aimedNow(prof: FireProfile) { return this.t - this.lastShotT >= aimedDelay(prof) && this.bloomNow() < 0.01 && this.settle <= 0; }
  /** Where the leader's hand actually points: the crosshair, plus sway (skill), climb (autos) and the shakes. */
  aimPoint(p: Guard) {
    const aim = this.aimOf(p);
    const sw = (1 - Math.min(1, aim)) * 16 * (this.focusing ? 0.5 : 1) * (this.shakeT > 0 ? 1.6 : 1);
    const f = 0.7 * Math.PI * 2;
    const sx = (Math.sin(this.t * f) * 0.6 + Math.sin(this.t * f * 0.61 + 1.3) * 0.4) * sw;
    const sy = (Math.sin(this.t * f * 0.83 + 2.1) * 0.6 + Math.sin(this.t * f * 0.47 + 0.4) * 0.4) * sw;
    const tremor = this.shakeT > 0 ? R.range(-3, 3) : 0;
    return { x: this.mouse.x + sx + tremor, y: this.mouse.y + sy - this.climbY + tremor };
  }
  aimOf(p: Guard) { return aimFactor(p.s) + (this.rallyT > 0 ? 0.25 : 0) - (p.blind > 0 ? 0.35 : 0); }
  /** The leader's single-projectile spread and pellet cone right now. */
  spreadNow(p: Guard, prof: FireProfile) {
    const aim = this.aimOf(p);
    const bloom = this.bloomNow();
    const aimed = this.aimedNow(prof);
    const hot = usesHeat(prof) && p.w && (this.heat.get(p.w.uid) ?? 0) > heatLimit(prof) ? 1.4 : 1;
    const k = (aimed ? 0.6 : 1) * (this.focusing ? 0.4 : 1) * hot * (this.shakeT > 0 ? 1.35 : 1) * (this.settle > 0 ? 1 + 1.5 * this.settle / Math.max(0.05, prof.switchTime) : 1) * (p.blind > 0 ? 1.6 : 1);
    const single = (prof.spread * (1.75 - aim) + bloom) * k;
    const cone = prof.spread * (0.75 + bloom / 0.08) * (1.3 - 0.3 * Math.min(1.2, aim)) * (aimed ? 0.85 : 1) * (this.focusing ? 0.7 : 1) * hot;
    return { single, cone, aimed };
  }

  // one round of the leader's trigger pull (bursts call this again, burstGap apart)
  playerRound(p: Guard, prof0: FireProfile) {
    if (!p.w) { p.burstLeft = 0; return; }
    do {
      const mag = this.playerMag.get(p.w.uid) ?? 0;
      if (mag <= 0) { p.burstLeft = 0; break; }
      // a tube gun fires whatever shell is on top
      const tube = this.usesTube(p.w, prof0) ? this.tubeOf(p.w, mag) : null;
      const top = tube?.pop();
      const prof = top && top !== prof0.ammoRes ? this.eff(p, top) : prof0;
      this.playerMag.set(p.w.uid, mag - 1);
      p.burstLeft--;
      const mz = this.muzzle(p);
      const ap = this.aimPoint(p);
      const base = Math.atan2(ap.y - mz.y, ap.x - mz.x);
      const sp = this.spreadNow(p, prof);
      // Last Stand: the crosshair is the shot. It goes into the lane under it, and a body
      // standing in front in another lane does not take it.
      const laneY = this.targetLane();
      const li = nearestLane(laneY);
      this.shotHit = false;
      this.pullKills = 0;
      if (prof.explosive && prof.arc) {
        // lobbed over the front rank: lands at the crosshair's x on the target lane
        const tx = Math.max(WALL_X + 30, ap.x + (R.next() + R.next() - 1) * sp.single * Math.abs(ap.x - mz.x) * 1.5);
        this.lobs.push({ x0: mz.x, y0: mz.y, x1: tx, y1: laneY, t: 0, dur: 0.6, p: prof, g: p });
      } else if (prof.explosive) {
        const hit = this.castShot(p, mz.x, mz.y, base + (R.next() + R.next() - 1) * sp.single, prof.dmg, 0, prof.knock, false, true, prof, laneY);
        this.blast(hit.x, laneY, prof.explosive, prof.knock, p);
      } else for (let i = 0; i < prof.pellets; i++) {
        const a = base + (R.next() + R.next() - 1) * (prof.pellets > 1 ? sp.cone : sp.single);
        // buckshot sprays a little through depth: 25% per pellet into an adjacent lane
        let ly = laneY;
        if (prof.pellets > 1 && R.chance(0.25)) { const adj = LANES[li + (R.chance(0.5) ? 1 : -1)]; if (adj !== undefined) ly = adj; }
        this.castShot(p, mz.x, mz.y, a, prof.dmg, prof.pierce, prof.knock, prof.pellets > 1, true, prof, ly);
      }
      // a headshot streak breaks on three misses running
      if (this.shotHit) this.misses = 0;
      else if (++this.misses >= 3) this.streak = 0;
      // bloom, climb, heat
      const continuous = this.t - this.lastShotT < Math.max(0.2, 1.5 / prof.rof);
      this.bloomShot = Math.min(BLOOM_CAP, this.bloomNow() + kickFor(p.w, prof) * (this.focusing ? 0.5 : 1) * (hasTrait(p.s, 'steady') ? 0.75 : 1));
      this.lastShotT = this.t;
      this.climbN = continuous ? this.climbN + 1 : 0;
      const armHurt = p.s.wounds.some((w) => w.part === 'larm' || w.part === 'rarm') ? 1.3 : 1;
      this.climbY = climbFor(p.w, prof) * Math.min(this.climbN, 10) * armHurt * (this.focusing ? 0.5 : 1) * (this.shakeT > 0 ? 1.5 : 1);
      if (usesHeat(prof)) {
        const h = (this.heat.get(p.w.uid) ?? 0) + (p.w.cond < 0.5 ? 1.2 : 1);
        if (h > heatLimit(prof) && (this.heat.get(p.w.uid) ?? 0) <= heatLimit(prof)) { sfx.overheat(); this.text(p.x + 40, p.y - 120, 'running hot', '#e08a40', 10); }
        this.heat.set(p.w.uid, h);
      }
      if (this.focusing) this.nerve = Math.max(0, this.nerve - 3);
      this.shotsTonight++;
      this.firedHard += 1;
      this.roundFired(p, prof, mz, false, base);
      // §5: shake per pull, never stacking; a multi-kill from one pull holds the world a beat longer
      this.shake = Math.max(this.shake, gunFeel(prof).shake * (prof.auto ? 0.5 : 0.6));
      this.ammoPunch = 1;
      if (this.pullKills >= 2 && !prof.explosive) {
        this.hitstop = Math.max(this.hitstop, prof.auto ? 0.04 : 0.09);
        this.text(this.mouse.x + 18, this.mouse.y - 34, this.pullKills >= 3 ? `×${this.pullKills}` : 'double', '#f0d890', 12);
        if (gunFeel(prof).kick >= 17) this.bigMoment(0.12); // coach gun, muzzleloader: §5 slow-mo on a 2+ kill
      }
      G.stats.shots++;
      p.w.cond = Math.max(0.05, p.w.cond - 0.0008);
      const left = this.playerMag.get(p.w.uid) ?? 0;
      // the last round: a cue in the hand, not a number on the screen
      if (left === 1 && prof.mag > 2) sfx.impact('metal', { volume: 0.35 });
      // a bolt short-stroked by shaking hands
      if (left > 0 && manualAction(p.w, prof) && this.nerve < this.nerveMax * 0.25 && R.chance(0.1)) {
        this.jam = { kind: 'short', clearing: 0 };
        p.burstLeft = 0;
        this.text(p.x + 40, p.y - 120, `short-stroked — ${keyCap('night.reload')}`, '#e0a060', 10);
      }
    } while (p.burstLeft > 0 && prof0.burstGap <= 0);
    p.burstT = prof0.burstGap;
    if ((this.playerMag.get(p.w.uid) ?? 0) === 0 && p.burstLeft <= 0 && autoReload()) this.startReload('auto');
  }

  // what every round does besides the bullet: flash, noise, brass, smoke, arrows to pick up later
  roundFired(g: Guard, prof: FireProfile, mz: { x: number; y: number }, far: boolean, ang = g.face > 0 ? 0 : Math.PI) {
    const fe = gunFeel(prof);
    const w = g.w!;
    const def = WEAPONS[w.def];
    this.actors.onFire(g, prof, fe.kick);
    g.recoil = 1;
    g.kick = fe.kick;
    g.flash = fe.light > 0 ? 0.06 : 0;
    g.flashKind = flashKind(w, prof);
    g.flashAng = ang;
    g.flashSize = fe.size * (far ? 0.85 : 1);
    this.noise += prof.noise * (far ? 0.7 : 1);
    this.fired.set(w.uid, (this.fired.get(w.uid) ?? 0) + 1);
    if (prof.recoverable > 0 && prof.ammoRes) this.recover[prof.ammoRes] = (this.recover[prof.ammoRes] ?? 0) + prof.recoverable * prof.perShot;
    const quiet = prof.noise < 0.5;
    const supp = isSuppressed(w);
    if (fe.light > 0) this.lights.push({ x: mz.x + 10 * g.face, y: mz.y, r: (quiet || supp ? 0.35 : 1) * fe.light * (far ? 0.8 : 1), life: 0.06, max: 0.06, color: prof.incendiary ? '255,150,70' : '255,200,120' });
    sfx.shoot(def.id, { suppressed: supp, far: far ? 0.4 : false, incendiary: prof.incendiary, pan: panOf(mz.x) * 0.6, volume: far ? 0.8 : 1 });
    if (!quiet && !supp) this.earLoad += prof.noise * (far ? 0.3 : 1) * (prof.pellets > 1 || prof.dmg > 60 ? 1.3 : 1);
    if (prof.smoke) for (let i = 0; i < 4; i++) this.particles.push({ x: mz.x + g.face * R.range(0, 30), y: mz.y + R.range(-6, 6), vx: g.face * R.range(10, 50), vy: R.range(-20, 5), life: 2.2, max: 2.2, size: R.range(8, 14), color: '#bbb', kind: 'smoke', ground: 0 });
    // a wisp off the muzzle on the heavy ones
    else if (!prof.auto && fe.kick >= 11) this.particles.push({ x: mz.x + g.face * 8, y: mz.y, vx: g.face * R.range(10, 30), vy: R.range(-25, -10), life: 0.8, max: 0.8, size: R.range(4, 7), color: '#bbb', kind: 'dust', ground: 0 });
    // brass and hulls: out of the side, bounce twice on the boards, and stay there
    const cl = casingLook(def.id);
    if (cl && (!prof.auto || R.chance(far ? 0.35 : 0.7))) {
      this.particles.push({ x: mz.x - 34 * g.face * g.sc, y: mz.y + 6, vx: -g.face * R.range(30, 90), vy: R.range(-190, -110), life: 2.5, max: 2.5, size: cl.w, w: cl.w, h: cl.h, rot: R.range(0, 6), bounces: 2, color: cl.color, kind: 'shell', ground: g.y - R.range(2, 7) });
    }
  }

  muzzle(g: Guard) {
    const rm = this.actors?.muzzle(g);
    if (rm) return rm;
    return { x: g.x + g.face * (SH * g.sc * 0.45 - g.recoil * 4), y: g.y - SH * g.sc * 0.68 };
  }

  zh(z: Zombie) { return z.def.height * z.scale * ZS; }
  zw(z: Zombie) { return z.def.width * z.scale * ZS; }
  /** Bake height for this body: its lane's display size (only the ±4% body jitter is scaled per frame). */
  laneH(z: Zombie) { return Math.round(z.def.height * ZS * depthScale(LANES[nearestLane(z.y)])); }
  /** Walking the road in a lane (as opposed to over the wall, in cover, fleeing or dead). */
  inLane(z: Zombie) { return (z.state === 'walk' || z.state === 'wall') && !z.flip; }
  /** The body drawn on top under the cursor, if any. */
  pick(mx: number, my: number): Zombie | undefined {
    let best: Zombie | undefined, bk = -1;
    for (const z of this.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0.25)) continue;
      const hb = this.hitbox(z);
      const inBody = mx > hb.x1 - 4 && mx < hb.x2 + 4 && my > hb.y1 && my < hb.y2;
      const inHead = (mx - hb.hx) ** 2 + (my - hb.hy) ** 2 < (hb.hr + 3) ** 2;
      if (!inBody && !inHead) continue;
      const k = this.sortKey(z);
      if (k > bk) { bk = k; best = z; }
    }
    return best;
  }
  /** The lane the leader's shot goes into: the clicked body's, else the lane whose body column holds the cursor. */
  targetLane(): number {
    const z = this.pick(this.mouse.x, this.mouse.y);
    if (z) return z.y;
    let li = 0, bd = Infinity;
    LANES.forEach((L, i) => { const d = Math.abs(this.mouse.y - (L - 0.55 * 156 * depthScale(L))); if (d < bd) { bd = d; li = i; } });
    return LANES[li];
  }
  sortKey(z: Zombie) {
    // over the wall (or up out of the drain) they are drawn in front of the barricade
    return (z.state === 'over' || z.state === 'maul' || z.state === 'climb' || z.state === 'leap' ? WALL_KEY + 2 : z.y) + z.id * 1e-5;
  }

  // Ray against the zombies in one lane (±LANE_TOL); returns whether anything was hit, and where it stopped.
  // Weakspots are tested first, then the head, then the body box, which is split into zones by the
  // height the ray crosses the body's centre line: torso (top 40%), arms (40–55%), legs (bottom 45%).
  castShot(g: Guard, ox: number, oy: number, ang: number, dmg: number, pierce: number, knock: number, pellet: boolean, isPlayer: boolean, fx: FireProfile | undefined, laneY: number) {
    for (const h of this.hooks) if (h.onShot?.(g, ox, oy, ang, laneY, pellet, isPlayer)) return { hit: true, x: ox, y: oy }; // night modules (propane)
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hits: { z: Zombie; t: number; head: boolean; zone: Zone; weak?: WeakKind }[] = [];
    const circle = (cx: number, cy: number, r: number) => {
      const hx = cx - ox, hy = cy - oy;
      const tc = hx * dx + hy * dy;
      const d2 = hx * hx + hy * hy - tc * tc;
      return tc > 0 && d2 < r * r ? tc - Math.sqrt(r * r - d2) : -1;
    };
    for (const z of this.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0.25) || z.state === 'leap') continue;
      if (Math.abs(z.y - laneY) > LANE_TOL) continue;
      // the guards' strays rarely find a man lying low in the dark behind the crowd
      if (!isPlayer && z.def.ranged && !((z.seen ?? 0) > 0) && R.chance(0.85)) continue;
      const hb = this.hitbox(z);
      // weakspots: small, and worth it
      let wk: { t: number; kind: WeakKind } | undefined;
      for (const w of this.weakPts(z)) {
        const t = circle(w.x, w.y, w.r * (pellet ? 1 : 1.1));
        if (t >= 0 && (!wk || t < wk.t)) wk = { t, kind: w.kind };
      }
      if (wk) { hits.push({ z, t: wk.t, head: false, zone: wk.kind === 'knee' ? 'leg' : 'torso', weak: wk.kind }); continue; }
      // head circle
      const th = hb.hr > 0 ? circle(hb.hx, hb.hy, hb.hr) : -1;
      if (th >= 0) { hits.push({ z, t: th, head: true, zone: 'head' }); continue; }
      // body AABB slab test
      const t1 = (hb.x1 - ox) / dx, t2 = (hb.x2 - ox) / dx;
      const t3 = (hb.y1 - oy) / dy, t4 = (hb.y2 - oy) / dy;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
      if (tmax >= 0 && tmin <= tmax) {
        const tc = Math.max(tmin, Math.min(tmax, (z.x - ox) / dx));
        const yc = oy + dy * tc;
        const f = (yc - hb.y1) / Math.max(1, hb.y2 - hb.y1);
        const low = this.isCrawler(z);
        const zone: Zone = low ? 'torso' : f > 0.55 ? 'leg' : f > 0.4 ? 'arm' : 'torso';
        hits.push({ z, t: Math.max(0, tmin), head: false, zone });
      }
    }
    hits.sort((a, b) => a.t - b.t);
    // a bile glob in the air, if the shot crosses it before any body
    if (isPlayer && this.globs.length) {
      for (const b of this.globs) {
        const gp = this.globPos(b);
        const t = circle(gp.x, gp.y, pellet ? 11 : 9);
        if (t >= 0 && t < (hits[0]?.t ?? 1600)) {
          b.t = b.dur + 1; // gone
          this.globs = this.globs.filter((x) => x !== b);
          this.splash(gp.x, gp.y, b.gy0 + (b.gy1 - b.gy0) * gp.k, 1);
          this.text(gp.x, gp.y - 14, 'POPPED', '#c8c050', 11);
          this.hitMark = { kind: 'glob', t: 0.2 };
          this.nerveGain(3);
          sfx.impact('burst', { volume: 0.4 });
          this.tracers.push({ x1: ox + dx * 20, y1: oy + dy * 20, x2: gp.x, y2: gp.y, life: 0.07, w: 1.6 });
          this.shotHit = true;
          return { hit: true, x: gp.x, y: gp.y };
        }
      }
    }
    let endT = 1600;
    let d = dmg;
    let n = 0;
    for (const h of hits) {
      // sawed-off barrels and the like: half damage past their range
      let far = fx && h.t > fx.range ? 0.5 : 1;
      // buckshot loses its bite past the wire (balance.md §8.6)
      if (pellet) far *= Math.max(0.35, Math.min(1, 1 - ((h.t - 250) / 400) * 0.65));
      this.damage(h.z, d * far, h.head, knock * far, g, pellet, ox + dx * h.t, oy + dy * h.t, isPlayer, fx, h.zone, h.weak);
      if (isPlayer) { G.stats.hits++; this.shotHit = true; }
      n++;
      endT = h.t;
      if (n > pierce) break;
      d *= 0.7;
    }
    // a miss lands on this lane's ground row, and sparks there
    if (n === 0 && dy > 0) {
      const tg = (laneY - 2 - oy) / dy;
      if (tg > 0 && tg < endT) {
        endT = tg;
        const gx = ox + dx * tg, gy = oy + dy * tg;
        const big = pellet ? 0.6 : 1;
        this.particles.push({ x: gx, y: gy - 2, vx: R.range(-15, 15), vy: R.range(-40, -20), life: 0.7, max: 0.7, size: R.range(4, 7) * big, color: '#8a7c66', kind: 'dust', ground: 0 });
        for (let i = 0; i < (pellet ? 1 : 3); i++) this.particles.push({ x: gx, y: gy, vx: R.range(-50, 50), vy: R.range(-120, -40), life: 0.45, max: 0.45, size: 2, color: '#6b5d4a', kind: 'spark', ground: gy + 1 });
        if (isPlayer && !pellet) sfx.impact('ground', { volume: 0.3 });
      }
    }
    this.tracers.push({ x1: ox + dx * 20, y1: oy + dy * 20, x2: ox + dx * endT, y2: oy + dy * endT, life: pellet ? 0.05 : 0.07, w: pellet ? 1 : 1.6 });
    // a flare lights the road where it comes down
    if (fx?.flare && !pellet) this.lights.push({ x: ox + dx * endT, y: Math.min(laneY, oy + dy * endT), r: FLARE_LIGHT.r, life: FLARE_LIGHT.time, max: FLARE_LIGHT.time, color: '255,90,70' });
    return { hit: n > 0, x: ox + dx * Math.min(endT, 1400), y: oy + dy * Math.min(endT, 1400) };
  }

  /** Low to the ground: a Drag, or one whose legs are gone. */
  isCrawler(z: Zombie) { return !!z.def.crawl || (!!z.crippled && z.def.id !== 'ferryman'); }
  /** How far up the corpse pile a climber has come (px). */
  climbLift(z: Zombie) { return z.state === 'climb' && z.climb !== undefined ? (1 - z.climb / 1.4) * this.zh(z) * 0.5 : 0; }

  /** The body's box; the skull (hx, hy) rides the rig's head bone where a rig is drawn. */
  hitbox(z: Zombie) {
    const hb = this.hitboxClassic(z);
    const rh = this.actors?.head(z);
    if (rh && hb.hr > 0) { hb.hx = rh.x; hb.hy = rh.y; }
    return hb;
  }
  hitboxClassic(z: Zombie) {
    const h = z.def.height * z.scale * ZS;
    const w = z.def.width * z.scale * ZS;
    const lift = this.climbLift(z);
    const f = z.flip ? -1 : 1;
    if (z.crippled && !z.def.crawl && z.def.id !== 'ferryman') {
      // dragging itself along on its arms: long, low, the head out in front
      return { x1: z.x - h * 0.42, x2: z.x + h * 0.42, y1: z.y - h * 0.3, y2: z.y, hx: z.x - f * h * 0.4, hy: z.y - h * 0.2, hr: z.headless ? 0 : h * z.def.head * 0.56 };
    }
    // raiders crouch behind a heap of junk; the lower body is behind it, and ducking drops the rest
    const cover = z.def.ranged && z.state === 'cover';
    const crouch = z.def.leap && (z.windup ?? 0) > 0 ? h * 0.18 : 0;
    const top = z.y - h - lift + crouch + (cover && z.ducked ? h * 0.32 : 0) + (z.emerge ? h * Math.min(1, z.emerge) : 0);
    const headH = h * z.def.head;
    const crawl = z.def.crawl;
    // the skull, not the hair (balance.md §8.7); a climber's head against the sky is easier
    const hr = z.headless ? 0 : (crawl ? h * 0.3 : headH * 0.56) * (lift > 0 ? 1.4 : 1);
    return {
      x1: z.x - w / 2, x2: z.x + w / 2, y1: top + (z.headless ? 0 : headH * 0.8), y2: cover ? z.y - h * 0.42 : z.y - lift,
      hx: z.x - f * w * (crawl ? 0.36 : 0.12), hy: crawl ? z.y - h * 0.62 : top + headH * 0.5, hr,
    };
  }

  /** Weakspot circles in world space (none on a crawler, none while it is over the wall). They ride the drawn pose. */
  weakPts(z: Zombie): { kind: WeakKind; x: number; y: number; r: number }[] {
    const pts = this.weakPtsClassic(z);
    if (!pts.length || !this.actors) return pts;
    // on a rig they ride its bones (neck, throat, shoulder, knees, the sac)
    const n: Record<string, number> = {};
    return pts.map((p) => {
      const q = this.actors.weak(z, p.kind, (n[p.kind] = (n[p.kind] ?? -1) + 1));
      return q ? { ...p, x: q.x, y: q.y } : p;
    });
  }
  weakPtsClassic(z: Zombie): { kind: WeakKind; x: number; y: number; r: number }[] {
    const spots = WEAKSPOTS[z.sprite];
    if (!spots || z.state === 'dying' || (z.crippled && z.def.id !== 'ferryman')) return [];
    const h = this.zh(z);
    const im = img(z.sprite);
    const dw = im ? (im.width / im.height) * h : this.zw(z);
    const lift = this.climbLift(z);
    const ps = this.pose(z);
    const cr = Math.cos(ps.rot), sr = Math.sin(ps.rot);
    const f = z.flip ? -1 : 1;
    return spots.filter((s) => !(s.kind === 'knee' && z.crippled)).map((s) => {
      // the sprite's local frame (feet at 0,0), then the same rotate/flip/translate drawZombie applies
      const lx = -dw / 2 + s.x * dw, ly = (-h - (ps.dy ? 0 : lift) + s.y * h) * ps.sy;
      const rx = lx * cr - ly * sr, ry = lx * sr + ly * cr;
      return { kind: s.kind, r: s.r * h, x: z.x + f * rx, y: z.y + ps.dy + ry };
    });
  }
  /** The tilt, lift and squash drawZombie gives a body this frame (shared with the weakspot rings). */
  pose(z: Zombie): { rot: number; dy: number; sy: number } {
    let rot = 0, dy = 0, sy = 1;
    const h = this.zh(z);
    const gait = z.def.speed > 60 ? 9 : 3.2;
    if (z.state === 'walk' || z.state === 'over' || z.state === 'flee') {
      rot = Math.sin(z.phase * gait) * (z.def.speed > 60 ? 0.05 : 0.04);
      dy = -Math.abs(Math.sin(z.phase * gait)) * (z.def.speed > 60 ? 5 : 2.5) * z.scale;
    } else if (z.state === 'wall' || z.state === 'maul') {
      rot = -0.08 + Math.sin(z.phase * 7) * 0.06;
    }
    if (z.stun > 0 && z.state !== 'dying') { rot = 0.05 + Math.sin(this.t * 40) * 0.025; dy = 0; }
    { const cp = z.state !== 'dying' ? classicPose(z, h, this.t) : null; if (cp) { rot = cp.rot; dy = cp.dy; sy = cp.sy; } }
    if (z.leap) {
      const q = Math.min(1, z.leap.t / z.leap.dur);
      dy = -Math.sin(q * Math.PI) * (130 + 40 * z.scale);
      rot = -0.5 + q * 0.7;
    } else if (z.def.leap && (z.windup ?? 0) > 0) { sy = 0.84; rot = -0.06; }
    if (z.state === 'climb') { dy = -this.climbLift(z); rot = -0.25; }
    return { rot, dy, sy };
  }

  /** Freeze a body for a moment: no walking, no wall damage. */
  stagger(z: Zombie, s: number) {
    if (z.def.boss) return;
    z.stun = Math.max(z.stun, s);
    // a Buck knocked out of its crouch has to set itself again
    if (z.def.leap && (z.windup ?? 0) > 0) z.windup = 0.8 + 0.5;
  }
  /** The Ferryman: two stagger hits within 1.2 s put it on the ground for 2.5 s, shoved back 60 px. */
  ferryStagger(z: Zombie, g: Guard | null, isPlayer: boolean) {
    z.stun = Math.max(z.stun, 0.5);
    const now = this.t;
    z.staggers = (z.staggers ?? []).filter((t) => now - t < 1.2);
    z.staggers.push(now);
    if (z.staggers.length >= 2 && !(z.down && z.down > 0)) {
      z.staggers = [];
      z.down = 2.5;
      z.x = Math.min(W + 100, z.x + 60);
      if (z.state === 'wall') z.state = 'walk';
      this.text(z.x, z.y - this.zh(z) - 12, 'KNOCKED DOWN', '#e0c070', 14);
      this.shake = Math.max(this.shake, 6);
      sfx.thud();
      if (isPlayer) this.nerveGain(8);
      if (g && !g.s.tales.some((t) => t.startsWith('Knocked a Ferryman'))) tale(g.s, `Knocked a Ferryman off its feet, night ${G.day}.`);
    }
  }

  /** Legs gone: it crawls (slower, lower, no lunge, no leap). A Ferryman limps instead. */
  cripple(z: Zombie, isPlayer: boolean) {
    if (z.crippled || z.def.crawl || z.def.boss || z.def.ranged) return;
    z.crippled = true;
    z.stun = Math.max(z.stun, 0.4);
    this.text(z.x, z.y - this.zh(z) * 0.5, z.def.id === 'ferryman' ? 'LIMPING' : 'LEGS', '#d0a050', 12);
    sfx.impact('bone');
    if (isPlayer && !this.hints.has('legs')) { this.hints.add('legs'); this.say("Legs gone. It'll crawl now — slower, and lower.", 3); }
    if (z.def.id !== 'ferryman' && z.state === 'wall') z.state = 'walk';
  }

  damage(z: Zombie, dmg: number, head: boolean, knock: number, g: Guard | null, pellet: boolean, px: number, py: number, isPlayer: boolean, fx?: FireProfile, zone: Zone = head ? 'head' : 'torso', weak?: WeakKind) {
    if (z.state === 'dying') return;
    this.actors.noteHit(z, head ? 'head' : zone, knock, dmg, pellet, px, py, g ? this.muzzle(g) : null, !fx);
    let d = dmg;
    let mark = head ? 'head' : zone === 'leg' ? 'leg' : zone === 'arm' ? 'arm' : 'body';
    const limb = fx?.limbMul ?? 1;
    let staggerHit = false;
    if (head) d *= pellet ? 2 : 3;
    else if (weak) {
      mark = 'weak';
      if (weak === 'sac') {
        // the belly goes, here and now: a burst where it stands
        d = Math.max(d, z.hp + 1);
        this.text(z.x, z.y - this.zh(z) * 0.6, 'BURST', '#c8a040', 13);
      } else if (weak === 'neck') d *= 2;
      else if (weak === 'shoulder') { d *= 2.5; staggerHit = true; this.text(z.x, z.y - this.zh(z) - 6, 'CRIT', '#e0c070', 12); }
      else if (weak === 'knee') {
        d *= limb;
        if (z.def.id === 'ferryman') staggerHit = true;
        else this.cripple(z, isPlayer);
      } else if (weak === 'throat') {
        d *= 1.5;
        if (z.def.spit) {
          // the bile in its throat goes everywhere: it chokes, and the ones beside it are burned
          d *= 1.4;
          z.spitT = Math.max(z.spitT ?? 0, 3);
          z.windup = 0;
          this.splash(px, py, z.y, 1.5);
          for (const o of this.zombies) if (o !== z && o.state !== 'dying' && Math.abs(o.x - z.x) < 70 && Math.abs(o.lane - z.lane) <= 1) { o.hp -= 18; o.flash = 0.1; if (o.hp <= 0) this.kill(o, g); }
        } else if (z.def.scream && d >= 20) this.silence(z, g, isPlayer);
      }
    } else if (zone === 'leg' || zone === 'arm') {
      d *= limb;
      // a Deputy's plate covers the chest and arms; the legs are cloth
      if (zone === 'arm' && z.def.armor) { d = armorDamage(d, z.def.armor, fx?.armorPen ?? 0); mark = 'plate'; }
      if (zone === 'leg') {
        z.legDmg += d;
        if (z.legDmg >= z.maxHp * 0.35) this.cripple(z, isPlayer);
      } else {
        z.armDmg += d;
        if (!z.disarmed && z.armDmg >= z.maxHp * 0.25 && !z.def.ranged && !z.def.boss) {
          z.disarmed = true;
          this.text(z.x, z.y - this.zh(z) * 0.7, 'ARM', '#a8a8a0', 11);
        }
      }
    } else if (z.def.armor) {
      d = armorDamage(d, z.def.armor, fx?.armorPen ?? 0);
      if (d < dmg * 0.6) mark = 'plate';
    }
    if (fx?.incendiary) z.burn = Math.max(z.burn, BURN.time);
    // a hit ≥ 20 during a Crier's wind-up chokes the keen off
    if (z.def.scream && (z.windup ?? 0) > 0 && d >= 20) this.silence(z, g, isPlayer);
    if ((z.down ?? 0) > 0) d *= IMPACT.FINISH_MUL; // down in the road: an easy finish
    z.hp -= d;
    z.flash = 0.08;
    // stagger (balance.md §8.8): a body hit rolls fireProfile().stagger; one pellet in four rolls
    if (!head && fx && (!pellet || R.chance(isPlayer ? 0.25 : 0.25 * Battle.tune.guardShove)) && R.chance(fx.stagger)) staggerHit = true;
    if (head && d >= 60) { if (z.def.id === 'ferryman') { if (d >= 100) staggerHit = true; } else this.stagger(z, 0.6); }
    if (staggerHit) { if (z.def.id === 'ferryman') this.ferryStagger(z, g, isPlayer); else this.stagger(z, 0.3); }
    const heavy = z.def.id === 'ferryman' || z.def.boss || z.state === 'cover';
    const loop = g?.post === 'loop' ? 1.3 : 1;
    if (!heavy) z.x += (z.flip ? -1 : 1) * knock * loop * (pellet ? 0.25 : 1) * (head ? 1.4 : 1) * (z.state === 'wall' ? 0.5 : 1);
    z.x = Math.min(z.x, W + 150);
    if (z.state === 'wall' && knock * loop > 15 && !heavy) z.state = 'walk';
    // the hit against the body's weight: flinch, stagger, stumble or knockdown (impact.ts)
    if (z.hp > 0) react(z, { dmg, knock: knock * loop, zone: weak === 'knee' ? 'leg' : head ? 'head' : zone, pellet, melee: !fx, dir: z.flip ? -1 : 1 }, this.t, () => R.next());
    // a climber shot in the head drops back onto the pile
    if (head && z.state === 'climb' && z.hp > 0) { z.climb = undefined; z.state = 'walk'; z.stun = 0.6; }
    if (isPlayer) this.hitMark = { kind: mark, t: 0.18 };
    if (mark === 'plate') {
      // steel on steel: bright sparks off the Deputy's plate, no blood
      for (let i = 0; i < 6; i++) this.particles.push({ x: px, y: py, vx: (z.flip ? 1 : -1) * R.range(40, 220), vy: R.range(-200, 40), life: 0.3, max: 0.3, size: R.range(1.5, 2.5), color: R.pick(['#ffe8b0', '#ffd080', '#fff4d8']), kind: 'spark', ground: z.y });
      this.lights.push({ x: px, y: py, r: 50, life: 0.05, max: 0.05, color: '255,220,160' });
    } else {
      // blood (fewer, smaller and darker with Reduce gore), scaled by the hit
      const big = Math.min(1.6, 0.6 + d / 60);
      this.blood(px, py, Math.round((head ? 8 : 3) * big + (pellet ? 0 : 1)), (head ? 4.5 : 3) * Math.min(1.3, big), z.y);
      if (!pellet || R.chance(0.3)) this.particles.push({ x: px, y: py, vx: (z.flip ? -1 : 1) * R.range(10, 40), vy: R.range(-20, 0), life: 0.35, max: 0.35, size: (reduceGore() ? 3 : 5) * big * (head ? 1.4 : 1), color: reduceGore() ? '40,10,8' : '110,18,14', kind: 'puff', ground: 0 });
    }
    const voice = voiceOf(z.def.id);
    if (z.hp <= 0) {
      if (head && !z.headless && R.chance(isPlayer ? 0.8 : 0.5) && !z.def.crawl && !z.def.ranged && !reduceGore()) {
        z.headless = true;
        sfx.headpop();
        for (let i = 0; i < 14; i++) this.particles.push({ x: px, y: py, vx: R.range(-60, 260), vy: R.range(-260, -40), life: 2, max: 2, size: R.range(2, 5), color: R.pick(['#4a0d0b', '#2a1a14', '#5e1410', '#8b7d6b']), kind: R.chance(0.3) ? 'chunk' : 'blood', ground: z.y + R.range(-6, 6) });
        if (isPlayer) this.text(z.x, z.y - z.def.height, 'HEADSHOT', '#d9c9a0', 13);
      }
      if (head) { this.res.headshots++; if (isPlayer) G.stats.headshots++; }
      if (isPlayer) {
        // a headshot streak banks a Rally
        if (head) {
          this.nerveGain(6);
          if (++this.streak >= 5) {
            this.streak = 0;
            if (this.rally < 2) { this.rally++; this.say(`Rally ready — ${keyCap('night.rally')} to call the line together.`, 3); }
          }
        } else this.nerveGain(2);
        sfx.impact(head ? 'head' : mark === 'plate' ? 'armor' : 'flesh');
        sfx.confirm(head ? Math.max(1, this.streak) : 1);
        this.feel(fx, true, head);
        this.killFlash = head ? 0.16 : 0.1;
        this.hitMark = { kind: mark, t: 0.24, kill: true };
        this.pullKills++;
      } else sfx.impact(head ? 'head' : mark === 'plate' ? 'armor' : 'flesh', { volume: 0.35 });
      this.kill(z, g);
    } else {
      const imp = head ? 'head' : mark === 'plate' ? 'armor' : mark === 'weak' && (weak === 'knee' || weak === 'shoulder') ? 'bone' : 'flesh';
      if (isPlayer) { sfx.impact(imp); this.feel(fx, false, head); }
      else sfx.impact(imp, { volume: 0.35 });
      if (voice && d >= 12 && (isPlayer || R.chance(0.3))) sfx.zombieVoice(voice, 'pain', { pan: panOf(z.x), volume: 0.7 });
      // the visual read of the shove (§5): a heavy pull rocks it back a step
      if (isPlayer && fx && !pellet && knock >= 40 && z.def.id !== 'ferryman') this.stagger(z, 0.12);
    }
  }

  /** A Crier choked off mid-keen. */
  silence(z: Zombie, g: Guard | null, isPlayer: boolean) {
    if ((z.windup ?? 0) <= 0 && z.screamT > 2) { z.screamT += 3; return; }
    z.windup = 0;
    z.screamT = R.range(6, 9);
    this.text(z.x, z.y - this.zh(z) - 14, 'SILENCED', '#e8dcc0', 14);
    if (isPlayer) this.nerveGain(10);
    if (g && !g.s.tales.some((t) => t.startsWith('Shut a Crier up'))) tale(g.s, `Shut a Crier up mid-call, night ${G.day}.`);
  }

  /** Hitstop and shake by class (balance.md §5): heavy single shots hold the world a beat; autos at most one per 0.15 s. */
  feel(fx: FireProfile | undefined, kill: boolean, head: boolean) {
    if (!fx) return;
    const pull = (fx.dmg * fx.pellets) / Math.max(1, ZOMBIES.sleeper.hp);
    const base = Math.max(18, Math.min(110, 40 + 45 * Math.log2(Math.max(0.1, pull))));
    let ms: number;
    if (fx.auto) {
      if (!kill || this.t - this.lastHitstop < 0.15) return;
      ms = head ? 40 : 25;
    } else ms = kill ? Math.min(110, head ? base + 25 : base + 10) : pull >= 0.8 ? base * 0.55 : 0;
    if (ms <= 0) return;
    this.lastHitstop = this.t;
    this.hitstop = Math.max(this.hitstop, ms / 1000);
  }
  /** A spray of blood that lands on the ground row `ground` (the actor's lane). */
  blood(x: number, y: number, n: number, size: number, ground: number, spread = 1) {
    const less = reduceGore();
    const k = less ? Math.max(1, Math.round(n * 0.35)) : n;
    for (let i = 0; i < k; i++) {
      this.particles.push({
        x, y, vx: R.range(20, 220) * spread * (R.chance(0.8) ? 1 : -0.5), vy: R.range(-200, 40), life: 1.6, max: 1.6,
        size: R.range(1.5, size) * (less ? 0.6 : 1), color: less ? R.pick(['#240807', '#2c0a08']) : R.pick(['#4a0d0b', '#5e1410', '#3a0a08', '#6b2a12']),
        kind: 'blood', ground: ground + R.range(-3, 3),
      });
    }
  }

  kill(z: Zombie, g: Guard | null) {
    if (z.state === 'dying') return;
    if (!this.actors.deferPile(z)) this.addPile(z); // rigged: added now, moved to where the body comes to rest
    z.state = 'dying';
    z.dieT = 0;
    z.climb = undefined;
    z.windup = 0;
    if (z.def.ranged) this.raidersDown++;
    else {
      this.res.kills++;
      G.stats.kills++;
    }
    if (z.def.boss) this.bossDown(z, g);
    const voice = voiceOf(z.def.id);
    if (voice && !z.def.boss && R.chance(z.def.id === 'ferryman' ? 1 : z.headless ? 0.25 : 0.5)) sfx.zombieVoice(voice, 'death', { pan: panOf(z.x), volume: 0.8 });
    if (z.def.id === 'ferryman') { this.bigMoment(0.45); this.shake = Math.max(this.shake, 7); sfx.thud(); }
    for (const h of this.hooks) h.onKill?.(z, g); // night modules
    if (g && z.def.ranged) {
      g.s.kills++;
      this.res.killsBy[g.s.id] = (this.res.killsBy[g.s.id] ?? 0) + 1;
      if (!hasTrait(g.s, 'bloodlust')) addThought(g.s, { id: 'shot_living', label: 'Shot a living man', mood: hasTrait(g.s, 'gentle') ? -8 : -4, days: 4 }, 2);
      return;
    }
    if (g) {
      g.kills++;
      g.s.kills++;
      if (g.w) g.w.kills++;
      this.res.killsBy[g.s.id] = (this.res.killsBy[g.s.id] ?? 0) + 1;
      if (z.def.id === 'ferryman') {
        tale(g.s, `Dropped a Ferryman on night ${G.day}.`);
        log('tale', `${displayName(g.s)} put down a Ferryman${g.w ? ` with ${g.w.name ? `"${g.w.name}"` : `the ${WEAPONS[g.w.def].name.toLowerCase()}`}` : ''}.`);
      }
      if (z.name && this.oldFaceBy && !this.guards.some((x) => x.s.dead && first(x.s) === z.name)) {
        const by = byId(this.oldFaceBy);
        if (by && by === g.s) {
          tale(g.s, `Put down ${z.name} with ${g.s.sex === 'm' ? 'his' : 'her'} own hands, on night ${G.day}.`);
          addThought(g.s, { id: 'oldface_self', label: `I did it myself. ${z.name}.`, mood: -10, days: 8 }, 1);
          log('tale', `${displayName(g.s)} put down ${z.name} on night ${G.day}. Wouldn't let anybody else do it.`);
        } else if (by && !by.dead) {
          addThought(by, { id: 'oldface_other', label: `${first(g.s)} shot ${z.name}`, mood: -8, days: 6 }, 1);
          changeOpinion(by, g.s, R.chance(0.5) ? 10 : -15);
          log('event', `${displayName(g.s)} shot ${z.name}, who ${first(by)} used to know.`);
        }
      } else if (z.name) {
        tale(g.s, `Was the one who put down ${z.name}, after ${z.name} turned.`);
        addThought(g.s, { id: 'shot_friend', label: `I shot what was left of ${z.name}`, mood: -14, days: 8 }, 1);
        log('tale', `${displayName(g.s)} put down what was left of ${z.name}.`);
      }
    }
    if (z.def.burst) {
      sfx.impact('burst');
      for (let i = 0; i < 30; i++) this.particles.push({ x: z.x, y: z.y - 60, vx: R.range(-120, 120), vy: R.range(-140, 20), life: 2.5, max: 2.5, size: R.range(8, 22), color: '#a8862f', kind: 'spore', ground: 0 });
      // the kill line: inside 180 px it rots the wall and the pile against it
      if (z.x - WALL_X < 180 && !z.flip) {
        G.fort.hp = Math.max(0, G.fort.hp - 45);
        this.pileRot = 3;
        this.streak = 0;
        this.nerveHit(10);
        this.say('A Pulper burst inside the line. The planks are rotting through.', 3);
        for (const o of this.guards) if (this.standing(o)) addThought(o.s, { id: 'pulper_wall', label: "The smell won't wash off", mood: -3, days: 2 }, 1);
      } else if (!this.hints.has('pulpfar')) { this.hints.add('pulpfar'); this.text(z.x, z.y - 150, 'burst — clear of the wall', '#c8a040', 11); }
      for (const o of this.zombies) if (o !== z && Math.abs(o.x - z.x) < 110 && o.state !== 'dying') { o.hp -= 30; o.flash = 0.1; if (o.hp <= 0) this.kill(o, null); }
    }
  }

  bossDown(z: Zombie, g: Guard | null) {
    sfx.zombieVoice('bellwether', 'death', { pan: panOf(z.x) });
    sfx.thud();
    this.bigMoment(1.4, true);
    this.shake = 12;
    this.surge = 0;
    G.flags.bellwetherDown = G.day;
    this.say('The bell hits the ice and splits. It does not ring again.', 7);
    this.text(z.x, z.y - 300, 'THE BELL IS SILENT', '#e0c070', 18);
    for (let i = 0; i < 20; i++) this.particles.push({ x: z.x + R.range(-30, 30), y: z.y - R.range(40, 200), vx: R.range(-160, 160), vy: R.range(-240, -40), life: 2, max: 2, size: R.range(2, 5), color: R.pick(['#8a6a2a', '#b08a3a', '#4a0d0b']), kind: 'chunk', ground: z.y + R.range(-6, 6) });
    if (g) {
      const how = g.w ? ` with ${g.w.name ? `"${g.w.name}"` : `the ${WEAPONS[g.w.def].name.toLowerCase()}`}` : '';
      tale(g.s, `Silenced the Bellwether on the night the river froze.`);
      grantTitle(g.s, 'Bell-Breaker');
      log('tale', `${displayName(g.s)} put down the Bellwether on the ice${how}. Somebody rang the All Saints' bell for forty minutes the night it began. It will not ring again.`);
      this.res.lines.push(`${first(g.s)} silenced the Bellwether.`);
    } else {
      log('tale', `The Bellwether went down on the ice on night ${G.day}. Nobody on the wall can say whose shot it was. The bell cracked in two.`);
      this.res.lines.push('The Bellwether fell. The bell cracked in two.');
    }
    for (const o of this.guards) if (!o.s.dead && !o.fled) addThought(o.s, { id: 'bell_silent', label: 'The bell stopped', mood: 8, days: 5 }, 1);
  }

  updateGuard(g: Guard, dt: number) {
    g.flash = Math.max(0, g.flash - dt);
    g.recoil = Math.max(0, g.recoil - dt * 8);
    if (g.s.dead || g.fled || g.downed || g.dragging || g.x !== g.homeX || g === this.player || !g.w || g.crew) return;
    // cowards and the fragile may leave the wall when it's breaking
    if (!this.res.wallHeld && (hasTrait(g.s, 'coward') || g.s.mood < 20) && R.chance(dt * 0.3)) {
      g.fled = true;
      this.say(`${first(g.s)} broke and ran for the house.`, 3);
      log('break', `${displayName(g.s)} fled the wall on night ${G.day}.`);
      for (const o of this.guards) if (o !== g && !o.s.dead) changeOpinion(o.s, g.s, -12);
      return;
    }
    // the leader's nerve is everyone's: shaking hands on the line spread; a steady one holds the frayed
    const lowNerve = this.nerve < 25;
    if (lowNerve && g.panicAt === undefined && !g.mode && R.chance(dt * 0.004 * (1 - attr(g.s, 'courage') / 12))) g.panicAt = this.t + R.range(2, 8);
    if (g.panicAt !== undefined && this.t > g.panicAt && !g.mode) {
      if (this.nerve > this.nerveMax * 0.6 && R.chance(0.3)) { g.panicAt = undefined; this.text(g.x, g.y - 150, 'steadies', '#9db070', 10); }
      else {
        g.mode = 'panic';
        this.say(`${first(g.s)} is panicking — firing at shadows.`, 3);
        log('break', `${displayName(g.s)} panicked on the wall on night ${G.day}, burning through ammunition.`);
      }
    }
    if (this.rallyT > 0 && g.mode === 'panic') g.mode = undefined;
    // the loophole is in their teeth: a Ferryman or a Deputy at the wall reaches through
    if (g.post === 'loop') {
      g.holdT += dt;
      if (g.holdT > 8 && this.zombies.some((z) => z.state === 'wall' && z.lane >= 2 && (z.def.id === 'ferryman' || z.def.id === 'deputy'))) {
        g.holdT = 0;
        wound(g.s, 'laceration', R.range(0.1, 0.2), R.pick(['larm', 'rarm']));
        this.text(g.x, g.y - 150, 'clawed through the loophole', '#d0a080', 10);
        sfx.hurt();
        this.checkDown(g, `clawed through the loophole, night ${G.day}`);
      }
    }
    if (g.duck > 0) return;
    const prof = this.prof(g.w, g.s);
    const runner = this.guards.some((o) => o.post === 'runner' && o !== g && this.standing(o)) ? 0.65 : 1;
    if (g.reload > 0) {
      g.reload -= dt;
      if (g.reload <= 0) g.mag += this.loadFromStores(prof, prof.mag - g.mag);
      return;
    }
    // the rest of a burst, pointed where the first round went
    if (g.burstLeft > 0) {
      g.burstT -= dt;
      if (g.burstT <= 0) this.guardRound(g, prof, g.burstAng, g.burstErr);
      return;
    }
    g.cd -= dt;
    if (g.cd > 0) return;
    // a runner carries, not shoots — unless something is over the wall
    if (g.post === 'runner' && !this.zombies.some((z) => (z.state === 'over' || z.state === 'maul') && Math.abs(z.x - g.x) < 200)) { g.cd = 0.5; return; }
    const fog = this.plan.special === 'fog';
    const roof = g.post === 'roof';
    // guards only engage what they can make out in the dark
    const range = Math.max(WALL_X + ((fog ? 640 : 820) - WALL_X) * Battle.tune.guardRange + Math.min(3, G.fort.lights) * 130 + (hasTrait(g.s, 'nightowl') ? 120 : 0) + (roof ? 260 : 0), g.x + SH * 0.45 + prof.light);
    const marked = this.mark ? this.zombies.find((z) => z.id === this.mark!.id) : undefined;
    // orders (bloodlust can't hold its fire for long)
    let order = g.order;
    if (order === 'hold' && hasTrait(g.s, 'bloodlust') && R.chance(0.25)) { order = 'free'; if (R.chance(0.2)) this.text(g.x, g.y - 150, "couldn't wait", '#d08060', 10); }
    // the road ahead, anything already behind the line, and any rifleman who just showed himself
    let tgt: Zombie | undefined;
    let bp = 1e9;
    for (const z of this.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0) || z.state === 'leap') continue;
      if (z.ducked && z.state === 'cover') continue; // nothing to aim at but junk
      const inside = z.state === 'over' || z.state === 'maul' || z.state === 'climb';
      const ahead = z.x > g.x + 30 && (z.x < range || (z.seen ?? 0) > 0);
      if (!ahead && !(inside && Math.abs(z.x - g.x) < 280)) continue;
      const dw = z.x - WALL_X;
      // the firestep can't see down to a crawler at the foot of the wall; the roof can't angle down at all
      if (!inside && g.post !== 'loop' && this.isCrawler(z) && dw < 80) continue;
      if (!inside && roof && dw < 160) continue;
      const isMarked = z === marked;
      if (order === 'hold' && !inside && !isMarked && dw > 220) continue;
      if (order === 'wall' && !inside && !(z.state === 'wall' || dw < 120)) continue;
      // never pop a Pulper inside the kill line unless it is already on the planks
      if ((order === 'wall' || order === 'heads') && z.def.burst && dw < 180 && z.state !== 'wall' && !inside) continue;
      let pri = (z.def.scream ? -400 : 0) + (inside ? -800 : 0) + (z.def.ranged ? -120 : 0) + (z.def.leap && (z.windup ?? 0) > 0 ? -300 : 0) + Math.abs(z.x - g.x) + (z.def.burst && dw < 140 ? 300 : 0);
      if (order === 'wall') pri = -z.def.dps * 40 + dw + (inside ? -800 : 0);
      if (isMarked && order !== 'wall') pri -= 2000;
      if (pri < bp) { bp = pri; tgt = z; }
    }
    if (!tgt) { g.face = 1; return; }
    const face = tgt.x < g.x + 30 ? -1 : 1;
    if (face !== g.face) {
      // turning on something behind you takes a moment
      g.face = face;
      g.cd = R.range(0.5, 0.9) + prof.switchTime;
      return;
    }
    if (tgt.id !== g.lastTgt) {
      // settling on a new target (a scope is slow, a red dot quick)
      g.lastTgt = tgt.id;
      if (prof.switchTime > 0) { g.cd = prof.switchTime; return; }
    }
    if (g.mag <= 0) {
      if (roundsInStores(prof, G.stores) < 1) {
        // out of ammunition: their hand weapon at the wall (night/melee.ts)
        meleeGuard(this, g);
        return;
      }
      g.reload = (prof.reloadPerRound ? prof.reload * prof.mag * 0.75 : prof.reload) * 1.15 * runner;
      return;
    }
    // stoppages: guards clear their own, by skill (prof folded into jam and jamClear)
    if (R.chance(prof.jam)) { g.cd = clearTime(prof, g.s, R.chance(0.1) ? 'double' : 'tap') * 1.4 + 0.3; this.text(g.x + 20, g.y - 150, 'jammed', '#c8a070', 10); return; }
    let aim = aimFactor(g.s);
    if (g.mode === 'panic') aim *= 0.4;
    if (g.mode === 'rage') aim = Math.min(1.3, aim + 0.3);
    if (this.sharp > 0) aim = Math.min(1.3, aim + 0.15);
    if (this.rallyT > 0) aim = Math.min(1.4, aim + 0.25);
    if (g.blind > 0) aim *= 0.5;
    const lightBonus = Math.min(0.2, G.fort.lights * 0.07);
    const mz = this.muzzle(g);
    const hb = this.hitbox(tgt);
    const dist = Math.hypot(hb.hx - mz.x, hb.hy - mz.y);
    // where on the body: the head by skill (always, on Heads only); the legs of a herd animal or a far Pulper; a weakspot when they know one
    const heads = order === 'heads';
    const pHead = heads ? 1 : (0.2 + aim * 0.25) * Battle.tune.guardHead * (tgt.def.ranged ? 0.5 : 1);
    const pLegs = !heads && ((tgt.def.lunge && !tgt.crippled) || (tgt.def.burst && tgt.x - WALL_X > 300)) ? 0.15 + (hasTrait(g.s, 'gentle') ? 0.15 : 0) : 0;
    const weak = this.weakPts(tgt);
    const wantWeak = !heads && weak.length && R.chance(0.08 + aim * 0.12) ? R.pick(weak) : undefined;
    const roll = R.next();
    let tx = tgt.x, ty = (hb.y1 + hb.y2) / 2;
    if (wantWeak) { tx = wantWeak.x; ty = wantWeak.y; }
    else if (roll < pHead) { tx = hb.hx; ty = hb.hy; }
    else if (roll < pHead + pLegs) ty = hb.y1 + (hb.y2 - hb.y1) * 0.78;
    const err = Battle.tune.guardErr * (prof.spread * 1.2 + (1.15 - aim - lightBonus) * 0.07 + (fog ? 0.04 : 0)) * (1 + dist / 900) * (tgt.def.ranged ? 1.8 : 1) * (0.5 + 0.5 * prof.braceBloomMul) * (roof ? 0.8 : 1) * (heads ? 0.85 : 1);
    const base = Math.atan2(ty - mz.y, tx - mz.x);
    g.cd = Battle.tune.guardCd * (1 / prof.rof) * (prof.auto ? 1.3 : 1.6) * R.range(0.9, 1.25) * (g.mode === 'panic' ? 0.55 : g.mode === 'rage' ? 0.7 : 1) * (heads ? 1.35 : 1) * (this.rallyT > 0 ? 0.75 : 1);
    g.burstLeft = Math.min(prof.burst, g.mag);
    // their shots lock to the target's lane: no rounds wasted on a nearer body in front
    g.burstLane = tgt.y;
    g.burstX = tgt.x;
    this.guardRound(g, prof, base, err);
  }
  guardRound(g: Guard, prof: FireProfile, base: number, err: number) {
    if (!g.w) { g.burstLeft = 0; return; }
    const mz = this.muzzle(g);
    const li = nearestLane(g.burstLane);
    do {
      if (g.mag <= 0) { g.burstLeft = 0; break; }
      g.mag--;
      g.burstLeft--;
      if (prof.explosive && prof.arc) {
        this.lobs.push({ x0: mz.x, y0: mz.y, x1: Math.max(WALL_X + 30, g.burstX + R.gauss(0, err * 400)), y1: g.burstLane, t: 0, dur: 0.6, p: prof, g });
      } else if (prof.explosive) {
        const hit = this.castShot(g, mz.x, mz.y, base + R.gauss(0, err * 0.6), prof.dmg, 0, prof.knock, false, false, prof, g.burstLane);
        this.blast(hit.x, g.burstLane, prof.explosive, prof.knock, g);
      } else for (let i = 0; i < prof.pellets; i++) {
        const a = base + R.gauss(0, prof.pellets > 1 ? prof.spread * 0.7 * (g.post === 'loop' ? 0.8 : 1) : err * 0.6);
        let ly = g.burstLane;
        if (prof.pellets > 1 && R.chance(0.25)) { const adj = LANES[li + (R.chance(0.5) ? 1 : -1)]; if (adj !== undefined) ly = adj; }
        this.castShot(g, mz.x, mz.y, a, prof.dmg, Math.min(Battle.tune.guardPierce, prof.pierce), prof.knock * (prof.pellets > 1 ? Battle.tune.guardShove : 1), prof.pellets > 1, false, prof, ly);
      }
      this.roundFired(g, prof, mz, true, base);
      g.w.cond = Math.max(0.05, g.w.cond - 0.0006);
    } while (g.burstLeft > 0 && prof.burstGap <= 0);
    g.burstAng = base;
    g.burstErr = err;
    g.burstT = prof.burstGap;
  }

  updateTurret(tu: { x: number; y: number; cd: number; flash: number; ang: number }, dt: number) {
    tu.flash = Math.max(0, tu.flash - dt);
    tu.cd -= dt;
    if (tu.cd > 0) return;
    if (G.stores.scrap < 0.05 || !G.buildings.some((b) => b.id === 'generator')) { tu.cd = 1; return; }
    const tgt = this.zombies.filter((z) => z.state !== 'dying' && z.x < 900).sort((a, b) => a.x - b.x)[0];
    if (!tgt) { tu.cd = 0.3; return; }
    const hb = this.hitbox(tgt);
    const ty = (hb.y1 + hb.y2) / 2 - 10;
    tu.ang = Math.atan2(ty - tu.y, tgt.x - tu.x);
    add('scrap', -0.05);
    this.castShot(null as unknown as Guard, tu.x + 20, tu.y, tu.ang + R.gauss(0, 0.04), 18, 1, 2, false, false, undefined, tgt.y);
    tu.cd = 0.3;
    tu.flash = 0.05;
    this.noise += 0.15;
    sfx.shoot('nailer', { far: 0.5, pan: panOf(tu.x) * 0.6, volume: 0.7 });
  }

  updateZombie(z: Zombie, dt: number) {
    z.flash = Math.max(0, z.flash - dt);
    if (z.state === 'dying') {
      if (z.dieT === 0) this.stampCorpse(z);
      z.dieT += dt;
      return;
    }
    z.phase += dt;
    z.laneCd -= dt;
    if (z.rise) z.rise = Math.max(0, z.rise - dt);
    // ease toward the lane's feet (lane hops, or onto a defenders' row behind the wall)
    // another module may have pulled it off the pile or out of the air
    if (z.state !== 'climb') z.climb = undefined;
    if (z.state !== 'leap') z.leap = undefined;
    if (z.y !== z.ty && !z.leap) {
      const d = z.ty - z.y;
      z.y += Math.sign(d) * Math.min(Math.abs(d), 40 * dt);
    }
    z.scale = depthScale(z.y) * z.jit;
    const cold = G.weather === 'cold' || G.weather === 'snow' ? 0.85 : 1;
    // burning
    for (const f of this.fires) if (((z.x - f.x) / (f.w / 2)) ** 2 + ((z.y - f.y) / 45) ** 2 <= 1) z.burn = 1.5;
    if (z.burn > 0) {
      z.burn -= dt;
      z.hp -= 22 * dt;
      if (R.chance(dt * 20)) this.particles.push({ x: z.x + R.range(-15, 15), y: z.y - R.range(10, this.zh(z) * 0.65), vx: 0, vy: -60, life: 0.6, max: 0.6, size: R.range(5, 10), color: '#ffb347', kind: 'fire', ground: 0 });
      if (z.hp <= 0) return this.kill(z, null);
    }
    // in the air over the wall (a Buck)
    if (z.leap) {
      const L = z.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      z.x = L.x0 + (L.x1 - L.x0) * k;
      z.y = L.y0 + (L.y1 - L.y0) * k;
      if (k >= 1) {
        z.leap = undefined;
        z.state = 'over';
        z.ty = z.y;
        z.flip = false;
        this.shake = Math.max(this.shake, 4);
        sfx.thud();
        this.dogBark('the Buck');
      }
      return;
    }
    slideStep(z, dt, W + 150);
    // staggered or knocked flat: nothing but the clock
    if (z.down !== undefined && z.down > 0) { z.down -= dt; return; }
    if (z.stun > 0) { z.stun -= dt; return; }
    // traps
    if (this.traps > 0 && z.state === 'walk' && z.x < this.trapX && z.x > this.trapX - 40) {
      this.traps--;
      G.fort.traps = Math.max(0, G.fort.traps - 1);
      this.blast(this.trapX, z.y, { radius: 150, dmg: 160 }, 40, null);
    }
    // crier: a 1.2 s wind-up (head back, a pale ring) before every keen; a solid hit chokes it off
    if (z.def.scream && z.x < W - 20) {
      z.screamT -= dt;
      if (z.screamT <= 1.2 && !(z.windup && z.windup > 0) && z.screamT > 0) {
        z.windup = z.screamT;
        if (!this.hints.has('crier')) { this.hints.add('crier'); this.say('The Crier is drawing breath — hit it now and the keen chokes off.', 3); }
      }
      if (z.windup && z.windup > 0) z.windup = Math.max(0, z.screamT);
      if (z.screamT <= 0) {
        z.screamT = R.range(6, 9);
        z.windup = 0;
        sfx.zombieVoice('crier', 'attack', { pan: panOf(z.x) });
        this.text(z.x, z.y - 140, '— keening —', '#c9a95a', 12);
        if (z.x - WALL_X < 500) this.nerveHit(8);
        for (let i = 0; i < 2; i++) this.spawn(R.chance(0.5) ? 'sleeper' : 'deer');
      }
    }
    // the bell
    if (z.def.toll && z.x < W - 40) {
      z.screamT -= dt;
      if (z.screamT <= 0) {
        z.screamT = R.range(10, 14);
        this.toll(z);
      }
    }
    const wire = z.x > WALL_X + 60 && z.x < WALL_X + 60 + 90 * Math.min(3, G.fort.wire) ? 0.55 : 1;
    let speed = z.def.speed * cold * wire;
    if (this.surge > 0 && !z.def.boss && !z.def.ranged) speed *= 1.7;
    if (z.crippled) speed *= z.def.id === 'ferryman' ? 0.5 : 0.35;
    if (z.def.lunge && !z.crippled) {
      z.lungeT -= dt;
      if (z.lungeT < 0) {
        // the pant: a stop, breath smoking in the cold — the window to shoot it
        speed *= 0.15;
        z.pant = (z.pant ?? 0) - dt;
        if (z.pant <= 0) {
          z.pant = 0.22;
          const h = this.zh(z);
          this.particles.push({ x: z.x - this.zw(z) * 0.3, y: z.y - h * 0.86, vx: R.range(-30, -10), vy: R.range(-14, -4), life: 0.9, max: 0.9, size: R.range(3, 5) * z.scale, color: '#cfd6dc', kind: 'smoke', ground: 0 });
        }
        if (z.lungeT < -0.8) z.lungeT = R.range(1.2, 2.6);
      }
    }
    if (z.state === 'cover') return this.updateRaider(z, dt);
    if (z.state === 'flee') {
      z.x += speed * 1.3 * dt;
      z.flip = true;
      return;
    }
    // a Biler stops at range and lobs bile over the wall
    if (z.def.spit && !z.crippled && (z.state === 'walk') && z.stopX !== undefined && z.x <= z.stopX && G.fort.hp > 0) {
      z.spitT = (z.spitT ?? 3) - dt;
      if (z.spitT <= 0.7 && !(z.windup && z.windup > 0)) z.windup = 0.7;
      if (z.windup && z.windup > 0) {
        z.windup -= dt;
        if (z.windup <= 0) { z.windup = 0; this.spit(z); z.spitT = R.range(4.5, 6.5); }
      }
      if (this.inLane(z)) this.laneLast[z.lane] = z;
      return;
    }
    // a Buck: short of the wall it crouches (eyes flaring) and then clears it, into the guards
    if (z.def.leap && !z.crippled && !z.leapt && z.state === 'walk' && G.fort.hp > 0 && z.x - wallX(z.lane) < 220) {
      if (!(z.windup && z.windup > 0)) z.windup = 0.8;
      z.windup -= dt;
      if (z.windup <= 0) {
        z.windup = 0;
        z.leapt = true;
        const ts = this.guards.filter((g) => this.standing(g) && !g.safe && g.post !== 'roof');
        const g = ts.length ? ts.reduce((a, b) => (Math.abs(a.x - WALL_X) < Math.abs(b.x - WALL_X) ? a : b)) : null;
        const x1 = g ? g.x + 40 : WALL_X - 80;
        const y1 = g ? g.y + 2 : DEF_LANES[1];
        z.leap = { x0: z.x, y0: z.y, x1, y1, t: 0, dur: 0.75 };
        z.state = 'leap';
        this.say('The Buck clears the wall!', 2.5);
        sfx.zombieVoice('leaper', 'attack', { pan: panOf(z.x) });
      }
      if (this.inLane(z)) this.laneLast[z.lane] = z;
      return;
    }
    if (z.state === 'walk' || z.state === 'wall') {
      this.walkLane(z, speed, cold, dt);
      if (this.inLane(z)) this.laneLast[z.lane] = z;
      return;
    }
    // up the corpse pile and over the top
    if (z.state === 'climb') {
      z.climb = (z.climb ?? 1.4) - dt;
      if (z.climb <= 0) {
        z.climb = undefined;
        z.state = 'over';
        z.x = wallX(z.lane) - 30;
        z.ty = DEF_LANES[1] + 2;
        sfx.thud();
      }
      return;
    }
    if (z.state === 'over') {
      if (z.emerge !== undefined && z.emerge > 0) { z.emerge -= dt; return; }
      // over the rubble (or up out of the drain) toward the nearest defender (the roof is out of reach until the wall has been down a while)
      let tgt: Guard | undefined;
      let best = 1e9;
      for (const g of this.guards) {
        if (g.s.dead || g.fled || g.safe) continue;
        if (g.post === 'roof' && this.res.wallHeld) continue;
        const d = Math.abs(g.x - z.x);
        if (d < best) { best = d; tgt = g; }
      }
      if (!tgt) { z.x += (z.flip ? speed : -speed) * dt; if (z.x < -80 || z.x > W + 80) z.hp = 0; return; }
      // onto the defenders' row, just in front of the one it wants
      z.ty = tgt.y + 2;
      const dx = tgt.x - z.x;
      if (Math.abs(dx) > 34) {
        z.x += Math.sign(dx) * speed * 0.8 * dt;
        z.flip = dx > 0;
      } else {
        z.state = 'maul';
        z.target = tgt.s.id;
        z.maulT = 0.6;
      }
    } else if (z.state === 'maul') {
      const g = this.guards.find((x) => x.s.id === z.target);
      if (!g || g.s.dead || g.fled || g.safe || Math.abs(g.x - z.x) > 60) { z.state = 'over'; return; }
      z.ty = g.y + 2;
      z.maulT -= dt;
      if (z.maulT <= 0) {
        z.maulT = R.range(0.9, 1.6) * (z.def.id === 'ferryman' ? 0.7 : 1) * (z.disarmed ? 1.4 : 1);
        this.maul(g, z);
      }
    }
  }

  // Walking the road in a lane. Bodies keep their spacing (a faster one is held up behind a
  // slower one and looks for room in the next lane), and queue at their lane's stop line on
  // the wall. Everyone pressed into the queue pushes on the wall, as one crowd.
  walkLane(z: Zombie, speed: number, cold: number, dt: number) {
    const w = this.zw(z);
    const ahead = this.laneLast[z.lane];
    const aw = ahead ? this.zw(ahead) : 0;
    const queued = !!ahead && ahead.state === 'wall';
    const face = wallX(z.lane) + w / 2;
    const standing = G.fort.hp > 0;
    if (z.state === 'wall') {
      if (!standing) { z.state = 'over'; return; }
      // still pressed against the wall, or against the one in front of it?
      const atFace = z.x <= face + 1;
      const inQueue = queued && z.x <= ahead!.x + 0.45 * Math.max(w, aw) + 2;
      if (!atFace && !inQueue) { z.state = 'walk'; return; }
      const k = this.laneQ[z.lane]++;
      // no arms: they can only lean on it; no legs: they claw at the bottom
      const dmg = z.def.dps * Battle.tune.wallDps * dt * cold * (z.disarmed ? 0.4 : 1) * (z.crippled && z.def.id !== 'ferryman' ? 0.6 : 1);
      G.fort.hp = Math.max(0, G.fort.hp - dmg);
      z.wallHit -= dt;
      if (z.wallHit <= 0) {
        z.wallHit = R.range(0.8, 1.4);
        if (atFace) {
          sfx.wallHit();
          const v = voiceOf(z.def.id);
          if (v && R.chance(0.12)) sfx.zombieVoice(v, 'attack', { pan: panOf(z.x), volume: 0.6 });
          for (let i = 0; i < 2; i++) this.particles.push({ x: wallX(z.lane) - 5, y: z.y - R.range(30, 100), vx: R.range(-80, -10), vy: R.range(-100, 0), life: 0.6, max: 0.6, size: 2, color: '#7a6448', kind: 'spark', ground: 0 });
        }
      }
      if (G.fort.spikes > 0 && atFace) {
        z.hp -= G.fort.spikes * 3.5 * dt;
        if (z.hp <= 0) { this.kill(z, null); return; }
      }
      // the pile is high enough to walk up: the ones at the face climb it
      if (atFace && !this.isCrawler(z) && !z.def.boss && this.piles[z.lane] >= this.pileLimit() && R.chance(dt * 0.6)) {
        z.state = 'climb';
        z.climb = 1.4;
        z.x = wallX(z.lane) + w * 0.3;
        sfx.impact('wood', { volume: 0.6 });
        if (!this.hints.has('ramp')) { this.hints.add('ramp'); this.say("They're coming up over the bodies.", 3); }
        return;
      }
      // a long queue: the back of it looks for a shorter one next door
      if (k >= 3 && z.laneCd <= 0) this.hop(z, w, true);
      return;
    }
    // walking
    let nx = z.x - speed * dt;
    if (z.def.ranged && nx <= (z.stopX ?? 900)) {
      z.x = nx;
      const h = this.zh(z);
      this.covers.push({ x: z.x - h * 0.2, y: z.y + 3, w: h * 0.55, h: h * 0.44, seed: z.id * 7.3 });
      z.state = 'cover';
      z.ducked = true;
      z.coverT = R.range(0.4, 1.2);
      return;
    }
    let held = false;
    if (ahead) {
      const gap = (queued ? 0.45 : 0.55) * Math.max(w, aw);
      const lim = ahead.x + gap;
      // overtaking: a faster body stuck behind a slow or staggered one shoulders past it, a half-step to the side
      const slow = !queued && ahead.state === 'walk' && (z.def.speed > ahead.def.speed * 1.2 || ahead.stun > 0 || (ahead.down ?? 0) > 0);
      if (slow && z.blocked > 0.35 && !z.pass) {
        z.pass = 2.5;
        const side = z.lane === 0 ? 1 : z.lane === LANES.length - 1 ? -1 : R.chance(0.5) ? 1 : -1;
        z.ty = LANES[z.lane] + side * 9;
      }
      if (z.pass && slow) nx = z.x - speed * Battle.tune.passSpeed * dt;
      // never closer than the gap; a body knocked back into the one behind just stops it
      else if (nx < lim) { nx = Math.min(z.x, lim); held = true; }
    }
    if (z.pass && (z.pass -= dt) <= 0) { z.pass = undefined; z.ty = LANES[z.lane] + R.range(-3, 3); }
    z.x = nx;
    if (z.x <= face) { z.x = face; z.state = standing ? 'wall' : 'over'; if (z.state === 'wall') { this.laneQ[z.lane]++; this.alertVoice(z); } return; }
    if (held && queued && standing) { z.state = 'wall'; this.laneQ[z.lane]++; return; }
    z.blocked = held ? z.blocked + dt : 0;
    if (held && z.blocked > 0.25 && z.laneCd <= 0) this.hop(z, w, false);
  }

  // Step into an adjacent lane with room at this x (at least 0.6 body widths to anyone there).
  hop(z: Zombie, w: number, shorterQueue: boolean) {
    z.laneCd = R.range(0.8, 1.4);
    const opts = [z.lane - 1, z.lane + 1].filter((l) => l >= 0 && l < LANES.length);
    if (R.chance(0.5)) opts.reverse();
    for (const l of opts) {
      let room = Infinity;
      for (const o of this.lanes[l]) if (o !== z) room = Math.min(room, Math.abs(o.x - z.x));
      if (room < 0.6 * w) continue;
      if (shorterQueue) {
        let q = 0;
        for (const o of this.lanes[l]) if (o.state === 'wall') q++;
        if (q >= this.laneQ[z.lane] - 1) continue;
      }
      z.lane = l;
      z.ty = LANES[l] + R.range(-3, 3);
      if (z.state === 'wall') z.state = 'walk';
      z.blocked = 0;
      return;
    }
  }
  // ---------- raiders ----------
  updateRaider(z: Zombie, dt: number) {
    if (!z.ducked && z.coverT !== undefined && z.coverT > 0 && R.chance(dt * 0.4)) z.seen = Math.max(z.seen ?? 0, 0.5);
    z.seen = Math.max(0, (z.seen ?? 0) - dt);
    z.coverT = (z.coverT ?? 0) - dt;
    if (z.coverT > 0) return;
    if (z.ducked) {
      // up over the cover, aiming
      z.ducked = false;
      z.coverT = R.range(0.9, 1.5);
    } else {
      this.raiderFire(z);
      z.ducked = true;
      z.coverT = R.range(1.8, 3.4);
      // when most of them are down, the rest lose their nerve
      const left = this.zombies.filter((o) => o.def.ranged && o.state !== 'dying' && o.state !== 'flee').length;
      if (this.raidersDown >= 2 && left <= 1 && z.hp < z.maxHp * 0.7) {
        z.state = 'flee';
        this.say('The last of the County men is running.', 3);
      }
    }
  }

  raiderMuzzle(z: Zombie) {
    const rm = this.actors?.raiderMuzzle(z);
    if (rm) return rm;
    const h = z.def.height * z.scale * ZS;
    const im = img(z.sprite);
    const w = im ? (im.width / im.height) * h : h * 0.6;
    return { x: z.x - w * 0.48, y: z.y - h * (z.sprite === 'z_raider' ? 0.6 : 0.56) };
  }

  raiderFire(z: Zombie) {
    let tgt: Guard | undefined;
    let n = 0;
    for (const g of this.guards) if (this.standing(g) && R.chance(1 / ++n)) tgt = g; // reservoir pick
    if (!tgt) return;
    const mz = this.raiderMuzzle(z);
    const hit = R.chance(0.3 - (this.plan.special === 'fog' ? 0.1 : 0) - (G.fort.hp > 0 ? 0.05 : 0));
    const tx = tgt.x + R.range(-10, 14), ty = tgt.y - SH * R.range(0.45, 0.75);
    z.seen = 2.5;
    this.noise += 1;
    sfx.shoot(z.sprite === 'z_raider2' ? 'pump' : 'hunting', { far: 0.9, pan: panOf(mz.x) });
    this.lights.push({ x: mz.x, y: mz.y, r: 200, life: 0.08, max: 0.08, color: '255,200,120' });
    if (hit) {
      this.tracers.push({ x1: mz.x, y1: mz.y, x2: tx, y2: ty, life: 0.08, w: 1.4 });
      const s = tgt.s;
      wound(s, 'gunshot', R.range(0.18, 0.38));
      sfx.hurt();
      this.text(tgt.x + 10, tgt.y - 150, 'SHOT', '#e07050', 13);
      this.blood(tx, ty, 6, 3.5, tgt.y, -0.6);
      if (!s.tales.some((t) => t.startsWith('Took a County bullet'))) tale(s, `Took a County bullet on the wall, night ${G.day}.`);
      this.checkDown(tgt, 'shot on the wall by a County man');
    } else {
      // into the barricade, or over everyone's heads
      const ex = R.chance(0.5) ? WALL_X - 6 : tx + R.range(-60, 30);
      const ey = R.chance(0.5) ? R.range(590, 660) : ty - R.range(40, 120);
      if (ex === WALL_X - 6) sfx.impact('wood', { volume: 0.45, delay: 0.05 });
      else if (R.chance(0.3)) sfx.impact('ricochet', { volume: 0.3, delay: 0.05 });
      this.tracers.push({ x1: mz.x, y1: mz.y, x2: ex, y2: ey, life: 0.08, w: 1.2 });
      for (let i = 0; i < 3; i++) this.particles.push({ x: ex, y: ey, vx: R.range(-80, 40), vy: R.range(-90, 0), life: 0.4, max: 0.4, size: 2, color: '#8a7a5a', kind: 'spark', ground: 0 });
    }
  }

  // ---------- the bell ----------
  toll(z: Zombie) {
    sfx.bell();
    this.surge = 4.5;
    this.shake = Math.max(this.shake, 5);
    this.text(z.x, z.y - z.def.height * ZS - 20, '— the bell —', '#d8b25a', 15);
    this.lights.push({ x: z.x, y: z.y - 160, r: 360, life: 0.9, max: 0.9, color: '200,160,70' });
    if (R.chance(0.5)) this.say(R.pick(['The bell. They all turn toward it, then toward us.', 'The bell again. The road surges.', 'Every one of them moves faster when it rings.']), 3);
  }

  maul(g: Guard, z: Zombie) {
    const s = g.s;
    sfx.hurt();
    const v = voiceOf(z.def.id);
    if (v) sfx.zombieVoice(v, 'attack', { pan: panOf(z.x) });
    this.shake = 5;
    const bite = R.chance(z.def.id === 'ferryman' ? 0.2 : 0.38);
    const w = wound(s, bite ? 'bite' : R.pick(['laceration', 'scratch', 'bruise', z.def.id === 'ferryman' ? 'fracture' : 'laceration']), R.range(0.2, 0.5) * (z.def.id === 'ferryman' ? 1.6 : 1) * (z.disarmed ? 0.6 : 1));
    if (bite) this.nerveHit(20);
    this.text(g.x + 10, g.y - 150, bite ? 'BITTEN' : w.kind, bite ? '#e05040' : '#d0a080', bite ? 15 : 11);
    if (bite) {
      tale(s, `Bitten on the line, night ${G.day}.`);
      this.say(`${first(s)} is bitten!`, 3);
    }
    this.blood(g.x + 20, g.y - 80, 8, 4, g.y, 0.6);
    const by = z.name ? `by what had been ${z.name}` : `by a ${z.def.name}`;
    if (g.downed) return; // the clock in updateDowned decides
    this.checkDown(g, `pulled down behind the wall ${by}, night ${G.day}`);
  }

  // ---------- down, dragged, or dead ----------
  checkDown(g: Guard, cause: string) {
    if (g.s.dead || g.downed || pain(g.s) <= DOWN_PAIN) return;
    if (g.wasDowned) return this.killGuard(g, cause);
    const s = g.s;
    g.downed = true;
    g.wasDowned = true;
    g.mauledT = 0;
    g.downCause = cause;
    g.mode = undefined;
    // whoever was hauling someone else drops them
    if (g.dragging) { g.dragging = undefined; }
    this.say(`${first(s).toUpperCase()} IS DOWN. Somebody get to ${them(s)}.`, 5);
    this.slowmo = Math.max(this.slowmo, 0.8);
    this.shake = Math.max(this.shake, 6);
    if (this.lastPlayer === g) {
      const np = this.player;
      if (np) this.say(`${first(np.s)} takes up the line.`, 4);
    }
  }

  killGuard(g: Guard, cause: string) {
    const s = g.s;
    if (s.dead) return;
    for (const o of this.guards) if (o.dragging === g) o.dragging = undefined;
    const wasPlayer = this.player === g;
    killSurvivor(s, cause);
    this.res.deaths.push(first(s));
    this.nerveHit(35);
    this.say(g.downed ? `They got to ${first(s)}. ${first(s)} is gone.` : `${first(s).toUpperCase()} IS DOWN.`, 6);
    for (const o of this.guards) {
      if (o.s.dead || o.fled || o === g || o.downed) continue;
      const r = o.s.rel[s.id];
      if (r && (r.bond === 'lover' || r.bond === 'spouse' || r.bond === 'parent' || r.bond === 'child' || r.bond === 'sibling' || r.opinion > 50)) {
        o.mode = 'rage';
        this.say(`${first(o.s)} screams ${first(s)}'s name and keeps firing.`, 5);
        tale(o.s, `Kept firing after ${first(s)} fell, night ${G.day}.`);
      }
    }
    this.slowmo = 1.5;
    G.flags.lastDeathDay = G.day;
    const np = this.player;
    if (wasPlayer && np) this.say(`${first(np.s)} takes up the line.`, 4);
  }

  updateDowned(dt: number) {
    for (const g of this.guards) {
      if (g.s.dead || g.fled) continue;
      // moodles refresh slowly; they do not change much in a night
      g.moodleT -= dt;
      if (g.moodleT <= 0) { g.moodleT = 2.5; this.moodle(g); }
      if (g.dragging) this.updateDrag(g, dt);
      else if (!g.downed && g.x !== g.homeX) {
        // back to the slot after hauling someone out
        const d = g.homeX - g.x;
        g.x += Math.sign(d) * Math.min(Math.abs(d), 110 * dt);
        g.face = d < 0 ? -1 : 1;
        if (g.x === g.homeX) g.face = 1;
      }
      if (!g.downed || g.safe) continue;
      // something is on them
      let mauled = false;
      for (const z of this.zombies) if (z.state === 'maul' && z.target === g.s.id) { mauled = true; break; }
      if (mauled) {
        g.mauledT += dt;
        if (g.mauledT >= 2.5) { this.killGuard(g, g.downCause ?? `pulled down behind the wall, night ${G.day}`); continue; }
      }
      if (this.guards.some((o) => o.dragging === g)) continue;
      // nearest standing guard who isn't holding the player's gun goes for them
      let best: Guard | undefined;
      let bd = 170;
      for (const o of this.guards) {
        if (o === g || !this.standing(o) || o.dragging || o === this.player) continue;
        if (hasTrait(o.s, 'coward') || o.mode === 'panic' || o.post === 'roof') continue;
        const d = Math.abs(o.x - g.x) * (o.post === 'runner' ? 0.25 : 1); // the runner goes first
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        best.dragging = g;
        best.dragT = 3;
        this.say(`${first(best.s)} goes for ${first(g.s)}.`, 3);
      }
    }
  }

  updateDrag(r: Guard, dt: number) {
    const d = r.dragging!;
    if (d.s.dead || !d.downed || d.safe || r.downed) { r.dragging = undefined; return; }
    // reach them first
    const reachX = d.x + 26;
    if (Math.abs(r.x - reachX) > 4) {
      const k = reachX - r.x;
      r.x += Math.sign(k) * Math.min(Math.abs(k), 160 * dt);
      r.face = k < 0 ? -1 : 1;
      return;
    }
    r.dragT -= dt;
    r.face = -1;
    const left = Math.max(0.05, r.dragT);
    const step = Math.max(0, d.x - SAFE_X) * Math.min(1, dt / left);
    d.x -= step;
    r.x = d.x + 26;
    if (R.chance(dt * 6)) {
      this.gctx.fillStyle = '#3a0a08';
      this.gctx.fillRect(d.x + R.range(-20, 20), d.y - 2, R.range(3, 8), 2);
    }
    if (r.dragT > 0) return;
    // out from under them
    d.safe = true;
    d.x = SAFE_X;
    r.dragging = undefined;
    const rs = r.s, ds = d.s;
    tale(rs, `Dragged ${first(ds)} out from under them, night ${G.day}.`);
    tale(ds, `Was dragged back behind the line by ${first(rs)}, night ${G.day}.`);
    addThought(ds, { id: 'saved_life', label: `${first(rs)} saved my life`, mood: 10, days: 10, about: rs.id }, 1);
    addThought(rs, { id: 'saved_other', label: `Got ${first(ds)} out`, mood: 5, days: 4, about: ds.id }, 1);
    changeOpinion(ds, rs, 35);
    changeOpinion(rs, ds, 8);
    this.say(`${first(rs)} drags ${first(ds)} back behind the line.`, 4);
    log('tale', `${displayName(rs)} dragged ${displayName(ds)} out from under the Turned on night ${G.day}, by ${their(ds)} collar.`);
  }

  // the most pressing thing on a guard's mind, in a word or three
  moodle(g: Guard) {
    let worst = -5, label = '';
    for (const p of moodBreakdown(g.s)) if (p.v < worst) { worst = p.v; label = p.label; }
    if (!label) { g.moodle = undefined; return; }
    const th = g.s.thoughts.find((t) => t.label === label);
    let word: string;
    if (th) {
      const id = th.id;
      word = /lost_love|lost_family|friend_died|ally_died/.test(id) ? 'grieving'
        : /mercy|shot_friend|oldface|killed_patient/.test(id) ? 'haunted'
        : /breach|close_call|saw_kin/.test(id) ? 'shaken'
        : /insulted|screamed_at|deserted/.test(id) ? 'bitter'
        : /rations/.test(id) ? 'hungry'
        : /kin_|gentle/.test(id) ? 'heartsick'
        : 'troubled';
    } else if (label === 'Starving') word = 'starving';
    else if (label === 'Hungry') word = 'hungry';
    else if (label === 'Exhausted') word = 'exhausted';
    else if (label === 'Tired') word = 'tired';
    else if (label.startsWith('Agonizing')) word = 'in agony';
    else if (label.endsWith('pain') || label === 'Pain') word = 'in pain';
    else if (label.startsWith('Fever')) word = 'feverish';
    else if (label === 'Needs a drink') word = 'needs a drink';
    else if (label.startsWith('Freezing')) word = 'freezing';
    else word = 'low';
    g.moodle = word;
    g.moodleC = worst <= -20 ? '#d65a44' : worst <= -11 ? '#d39a48' : '#a8a08a';
  }

  // ---------- the dog ----------
  dogBark(what: string) {
    const d = this.dog;
    if (!d || d.cd > 0 || this.intro > 2) return;
    d.cd = 9;
    d.barkT = 1.6;
    this.sharp = 5;
    this.text(d.x + 10, d.y - 70, 'barking', '#d9c9a0', 12);
    if (what === 'the drain') this.say(`${d.name} is going mad at the drain.`, 3);
    else if (R.chance(0.4)) this.say(`${d.name} hears ${what} before anyone sees it.`, 3);
  }

  updateDog(dt: number) {
    const d = this.dog!;
    d.cd -= dt;
    d.barkT = Math.max(0, d.barkT - dt);
    // one word at a time, not a pile of them
    if (d.barkT > 0 && d.barkT < 1.1 && !this.texts.some((t) => t.x === d.x + 18)) this.text(d.x + 18, d.y - 64, R.pick(['bark', 'growl']), '#bfb39a', 10);
  }

  // A blast on the ground plane (traps, rockets, grenades): everything inside the ground-space
  // ellipse (dx/r)² + (dy/0.3r)² ≤ 1 around the foot point takes blastDamage(), armour ignored,
  // and is thrown outward. Covers about one lane either side.
  blast(x: number, y: number, ex: { radius: number; dmg: number }, knock: number, g: Guard | null) {
    const size = Math.max(0.6, Math.min(1.6, ex.radius / 150));
    sfx.explosion(size);
    this.earLoad += 6 * size;
    this.shake = Math.max(this.shake, 9 + 6 * size);
    const k0 = this.res.kills;
    this.lights.push({ x, y: y - 30, r: 420, life: 0.4, max: 0.4, color: '255,170,80' });
    for (let i = 0; i < 40; i++) this.particles.push({ x: x + R.range(-20, 20), y: y - R.range(0, 30), vx: R.range(-300, 300), vy: R.range(-420, -60), life: 1.2, max: 1.2, size: R.range(2, 6), color: R.pick(['#ffcf6b', '#ff8a3d', '#444']), kind: R.chance(0.6) ? 'spark' : 'smoke', ground: y + 6 });
    // a scorch on the road
    const c = this.gctx;
    c.fillStyle = 'rgba(8,7,6,0.45)';
    c.beginPath();
    c.ellipse(x, y + 1, ex.radius * 0.35, ex.radius * 0.35 * 0.3, 0, 0, Math.PI * 2);
    c.fill();
    for (const z of this.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0.25)) continue;
      const dmg = blastDamage(ex, z.x - x, z.y - y);
      if (dmg <= 0) continue;
      z.hp -= dmg;
      z.flash = 0.1;
      const heavy = z.def.id === 'ferryman' || z.def.boss || z.state === 'cover';
      const push = Math.sign(z.x - x || 1) * knock * (dmg / ex.dmg) * (heavy ? 0.2 : 1);
      this.actors.noteBlast(z, x, y, knock * (dmg / ex.dmg));
      z.x = Math.min(W + 150, z.x + push);
      if (z.state === 'wall' && Math.abs(push) > 15) z.state = 'walk';
      if (z.hp > 0) react(z, { dmg, knock: 0, zone: 'torso', blast: knock * (dmg / ex.dmg), dir: Math.sign(z.x - x || 1) }, this.t, () => R.next());
      if (z.hp <= 0) this.kill(z, g);
    }
    this.noise += 10;
    // a blast that takes three or more: the world holds its breath for a moment
    const killed = this.res.kills - k0;
    if (killed >= 3) { this.bigMoment(0.35); if (g && g === this.player) { this.text(x, y - 120, `×${killed}`, '#f0d890', 15); sfx.confirm(3); } }
    else if (killed > 0 && g && g === this.player) this.hitstop = Math.max(this.hitstop, 0.05);
  }
  /** A rare slow-mo beat (a Ferryman dropping, a multi-kill blast, the Bellwether). Real seconds. */
  bigMoment(sec: number, force = false) {
    if (this.slowCd > 0 && !force) return;
    this.slowmo = Math.max(this.slowmo, sec);
    this.slowCd = 8;
  }
  throwMolotov() {
    if (this.done || G.stores.molotov <= 0) {
      if (G.stores.molotov <= 0) this.say('No firebombs. Make them at the still.', 2);
      return;
    }
    const p = this.player;
    if (!p) return;
    add('molotov', -1);
    const x = Math.max(WALL_X + 40, Math.min(W - 40, this.mouse.x));
    // it bursts on the lane under the crosshair and spreads about a lane either way
    const y = this.targetLane();
    setTimeout(() => {
      sfx.fire();
      this.fires.push({ x, y, life: 7, w: 150 });
      this.lights.push({ x, y: y - 20, r: 300, life: 7, max: 7, color: '255,150,60' });
    }, 350);
    this.tracers.push({ x1: p.x + 40, y1: p.y - 100, x2: x, y2: y - 8, life: 0.35, w: 2 });
  }

  stampCorpse(z: Zombie) {
    if (this.actors.ownsCorpse(z)) return; // its ragdoll bakes itself into the road when it settles
    // a body left in the road, darkened and laid flat (a baked dark copy; no per-kill filter)
    const h = this.zh(z);
    const bk = bakeSprite(z.sprite, this.laneH(z), CORPSE, 0, { outline: false, pad: 0 });
    if (!bk) return;
    const w = bk.cv.width * (h / bk.h);
    const c = this.gctx;
    c.save();
    c.globalAlpha = 0.85;
    if (z.def.crawl) {
      c.drawImage(bk.cv, z.x - w / 2, z.y - h, w, h);
    } else {
      c.translate(z.x + h * 0.35, z.y - 6);
      c.rotate(Math.PI / 2 * (R.chance(0.5) ? 1 : 0.92));
      c.scale(1, 0.55);
      c.drawImage(bk.cv, -w / 2, -h * 0.1, w, h);
    }
    c.restore();
  }

  updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.kind === 'dust' || p.kind === 'puff') { /* handled below */ } else if (p.kind === 'smoke' || p.kind === 'spore') {
        p.vx *= 0.96; p.vy *= 0.96; p.vy -= 10 * dt;
        if (p.kind === 'spore') p.vy += 18 * dt;
      } else if (p.kind === 'fire') {
        p.vy -= 20 * dt;
      } else {
        p.vy += 900 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'shell') p.rot = (p.rot ?? 0) + p.vx * dt * 0.25;
      if (p.kind === 'dust' || p.kind === 'puff') { p.vy += 40 * dt; p.vx *= 0.9; }
      if ((p.kind === 'blood' || p.kind === 'chunk' || p.kind === 'shell') && p.ground && p.y >= p.ground && p.vy > 0) {
        if (p.kind === 'shell') {
          // two bounces on the boards, then it settles and stays (a decal on the ground layer)
          p.y = p.ground;
          if ((p.bounces ?? 0) > 0) { p.bounces = (p.bounces ?? 0) - 1; p.vy *= -0.35; p.vx *= 0.55; continue; }
          p.life = 0;
          const c = this.gctx;
          c.save();
          c.translate(p.x, p.y);
          c.rotate(Math.round((p.rot ?? 0) / 0.5) * 0.15);
          c.globalAlpha = 0.85;
          c.fillStyle = p.color;
          c.fillRect(-(p.w ?? 3) / 2, -(p.h ?? 1.5) / 2, p.w ?? 3, p.h ?? 1.5);
          c.restore();
          continue;
        }
        const c = this.gctx;
        c.fillStyle = p.color;
        c.globalAlpha = reduceGore() ? 0.5 : 0.75;
        c.beginPath();
        c.ellipse(p.x, p.y, p.size * 1.8, p.size * 0.6, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        p.life = 0;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  text(x: number, y: number, text: string, color: string, size: number) {
    this.texts.push({ x, y, text, color, size, life: 1.2 });
  }

  // ---------- nerve (research 05 §4) ----------
  /** Real-time (not slowed by Focus): Focus drains, a quiet wall restores, the wall's damage and the keening wear it down. */
  tickNerve(dt: number) {
    if (this.done || this.intro > 0) return;
    if (this.focusing) {
      this.nerve -= 20 * dt;
      if (this.nerve <= 0) this.focusing = false;
    } else if (!this.zombies.some((z) => z.state === 'wall' || z.state === 'over' || z.state === 'maul' || z.state === 'climb')) this.nerve += dt;
    // every further tenth of the wall lost
    const f = G.fort.hp / Math.max(1, G.fort.maxHp);
    if (f < this.wallMark - 0.1) { this.wallMark -= 0.1; this.nerveHit(6); }
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.nerve = Math.max(0, Math.min(this.nerveMax, this.nerve));
  }
  /** Something rattles the leader. At 0 the hands shake for 5 s. */
  nerveHit(n: number) {
    if (this.done) return;
    const was = this.nerve;
    this.nerve = Math.max(0, this.nerve - n);
    if (was > 0 && this.nerve <= 0) {
      this.shakeT = 5;
      this.zeroes++;
      this.focusing = false;
      const p = this.player;
      if (p) this.text(p.x, p.y - 170, 'hands shaking', '#d0a040', 12);
    }
  }
  nerveGain(n: number) { this.nerve = Math.min(this.nerveMax, this.nerve + n); }

  // ---------- bile (the Biler) ----------
  /** Where a glob is now: its arc, and its shadow on the ground. */
  globPos(b: Glob) {
    const k = Math.min(1, b.t / b.dur);
    const x = b.x0 + (b.x1 - b.x0) * k;
    const y = b.y0 + (b.y1 - b.y0) * k - Math.sin(k * Math.PI) * (150 + Math.abs(b.x1 - b.x0) * 0.18);
    return { x, y, gy: b.gy0 + (b.gy1 - b.gy0) * k, k };
  }
  spit(z: Zombie) {
    const h = this.zh(z);
    const mx = z.x - this.zw(z) * 0.45, my = z.y - h * 0.74;
    const targets = this.guards.filter((g) => this.standing(g) && !g.safe && g.post !== 'roof');
    let g: Guard | null = null;
    let x1: number, y1: number, gy1: number;
    if (targets.length && R.chance(0.55)) {
      g = R.pick(targets);
      x1 = g.x + R.range(-8, 8); gy1 = g.y; y1 = g.y - SH * g.sc * 0.62;
    } else {
      const li = z.lane;
      x1 = wallX(li) - R.range(4, 20); gy1 = LANES[li]; y1 = LANES[li] - R.range(50, 90);
    }
    const dist = Math.abs(z.x - x1);
    this.globs.push({ x0: mx, y0: my, x1, y1, gy0: z.y, gy1, t: 0, dur: 1.5 + dist / 900, g, lane: z.lane });
    sfx.impact('flesh', { volume: 0.5 });
    this.text(mx, my - 10, 'hrrk', '#b8b050', 10);
  }
  updateGlobs(dt: number) {
    for (const b of this.globs) {
      b.t += dt;
      const left = b.dur - b.t;
      // a guard may see it coming and get down (by courage); the leader ducks on [S]
      if (b.g && !b.rolled && left < 0.5) {
        b.rolled = true;
        if (b.g !== this.player && R.chance(0.2 + attr(b.g.s, 'courage') * 0.05)) { b.g.duck = 0.9; this.text(b.g.x, b.g.y - SH * b.g.sc - 10, 'down!', '#cfc6b0', 10); }
      }
      if (b.t < b.dur) continue;
      const pos = this.globPos(b);
      this.splash(pos.x, pos.y, b.gy1, 1);
      const g = b.g;
      if (g) {
        const ducked = g === this.player ? this.ducking : g.duck > 0;
        if (g.s.dead || g.downed || g.fled || ducked) {
          // over their head and into the yard behind
          if (ducked) this.text(g.x, g.y - 120, 'over', '#a89c84', 10);
          continue;
        }
        if (R.chance(0.5)) {
          g.blind = 4;
          this.text(g.x, g.y - SH * g.sc - 12, 'BILE — eyes', '#c8c050', 12);
          if (g === this.player) this.nerveHit(6);
        } else {
          wound(g.s, 'burn', R.range(0.12, 0.24), R.pick(['head', 'torso', 'larm', 'rarm']));
          this.text(g.x, g.y - SH * g.sc - 12, 'BILE — burned', '#c8c050', 12);
          sfx.hurt();
          this.checkDown(g, `burned by a Biler's bile on the wall, night ${G.day}`);
        }
      } else {
        // the planks rot where it lands
        G.fort.hp = Math.max(0, G.fort.hp - 16);
        this.text(b.x1, b.y1 - 20, 'ROT', '#b8b050', 11);
        sfx.wallHit();
      }
    }
    this.globs = this.globs.filter((b) => b.t < b.dur);
  }
  splash(x: number, y: number, ground: number, n: number) {
    for (let i = 0; i < 10 * n; i++) this.particles.push({ x, y, vx: R.range(-120, 120), vy: R.range(-160, 20), life: 1.2, max: 1.2, size: R.range(2, 4), color: R.pick(['#9a9a3a', '#7c7a26', '#b5a94a']), kind: 'blood', ground: ground + R.range(-4, 4) });
  }

  // ---------- corpse piles (research 05 §7) ----------
  /** The mass at which a lane's pile becomes a ramp. */
  pileLimit() { return 10 + 2 * G.fort.level - this.pileRot; }
  updatePiles(dt: number) {
    // fire on a pile against the wall burns it down, and scorches the planks
    let burning = false;
    for (const f of this.fires) {
      if (f.x - f.w / 2 > WALL_X + 120) continue;
      for (let l = 0; l < 4; l++) {
        if (this.piles[l] <= 0 || Math.abs(LANES[l] - f.y) > 40) continue;
        this.piles[l] = Math.max(0, this.piles[l] - dt);
        burning = true;
      }
    }
    if (burning) {
      G.fort.hp = Math.max(0, G.fort.hp - 3 * dt);
      if (!this.hints.has('pileburn')) { this.hints.add('pileburn'); this.say('The pile is burning down — and the planks with it.', 3); }
    }
    if (!this.pileWarned && this.piles.some((m) => m >= this.pileLimit() * 0.8)) {
      this.pileWarned = true;
      this.say('The bodies are piling against the wall. Soon they can walk up them. (Burn it: a firebomb at the wall.)', 5);
    }
  }
  /** A death close to the wall adds to that lane's pile. */
  /** What a body lying here adds to its lane's corpse pile (0: too far out, or not a ramp body). */
  pileMass(z: Zombie): number {
    if (z.state === 'over' || z.state === 'maul' || z.state === 'leap' || z.flip || z.def.ranged || z.def.boss) return 0;
    return z.x - wallX(z.lane) > 130 ? 0 : z.def.mass ?? 1;
  }
  addPile(z: Zombie): number {
    const m = this.pileMass(z);
    this.piles[z.lane] += m;
    return m;
  }
  // ---------------- draw ----------------
  // Layering (docs/research/04 §3.4): baked background → lit asphalt → decals and ground props
  // → darkness pass A (full) → light pools → contact shadows → y-sorted actors → foreground
  // strip → particles → darkness pass B (40%) → glow, vignette, words.

  // sprite bakes for tonight's crowd, worked off during the intro instead of on first sight
  queueBakes() {
    const sprites = new Set<string>();
    for (const s of this.plan.spawns) for (const sp of ZOMBIES[s.type]?.sprites ?? []) sprites.add(sp);
    for (const sp of ZOMBIES.sleeper.sprites) sprites.add(sp);
    for (const sp of ZOMBIES.deer.sprites) sprites.add(sp);
    const heights = new Map<string, number>();
    for (const d of Object.values(ZOMBIES)) for (const sp of d.sprites) heights.set(sp, d.height);
    for (const sp of sprites) {
      const dh = heights.get(sp) ?? 120;
      LANES.forEach((L, lane) => {
        const bh = Math.round(dh * ZS * depthScale(L));
        for (let v = 0; v < 3; v++) for (const lit of [false, true]) this.prebake.push(() => { this.zLook(sp, bh, lane, v, false, lit); });
      });
    }
  }

  workBakes(ms: number) {
    const t0 = performance.now();
    while (this.prebake.length && performance.now() - t0 < ms) this.prebake.shift()!();
  }

  draw() {
    const c = this.ctx;
    if (this.prebake.length) this.workBakes(this.intro > 0 ? 10 : 2);
    c.save();
    const sk = this.shake * shakeScale();
    if (sk > 0) c.translate(R.range(-sk, sk), R.range(-sk, sk) * 0.6);
    // background, baked once; slight parallax from aim; early → late night is a crossfade
    const px = (this.mouse.x / W - 0.5) * -24;
    const bg = bakeBattleBg(this.plan.special);
    const nightT = Math.min(1, this.t / 40);
    const bx = Math.round(-160 + px);
    if (bg) {
      c.drawImage(bg.early, bx, -20);
      if (nightT > 0.01) { c.globalAlpha = nightT; c.drawImage(bg.late, bx, -20); c.globalAlpha = 1; }
    } else { c.fillStyle = '#2a2d33'; c.fillRect(0, 0, W, H); }
    // the ground plane: lit asphalt, not a black void
    if (!groundBand) {
      groundBand = bakeGround(W, H - GROUND_TOP, GROUND_TOP, LANES, { rut: 0.06, base: ['rgba(22,23,26,0.15)', 'rgba(22,23,26,0.42)', 'rgba(16,17,20,0.62)'] });
    }
    c.drawImage(groundBand, 0, GROUND_TOP);
    c.drawImage(this.ground, 0, 0);
    // ground-level props behind every lane
    if (G.fort.wire > 0) this.drawWirePosts(c, false);
    if (this.plan.special === 'tunnel') this.drawDrain(c);
    for (const h of this.hooks) h.drawGround?.(c); // night modules
    if (this.traps > 0 && drawProp(c, 'trap_nailbomb', this.trapX, LANES[2] + 3, 18 * depthScale(LANES[2]), LOOK[2])) { /* sprite */ }
    else if (this.traps > 0) {
      c.fillStyle = '#2b2a25';
      c.beginPath(); c.ellipse(this.trapX, LANES[2], 16, 4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#a33';
      c.fillRect(this.trapX - 2, LANES[2] - 5, 4, 4);
    }
    this.drawRoadMarks(c);
    // the fog lies thickest over the far road
    if (this.plan.special === 'fog') this.drawFog(c, 1);
    // darkness, pass A: the whole mask over background and ground
    this.buildDark();
    c.drawImage(this.dark, 0, 0, W, H);
    this.drawPools(c);
    // contact shadows: one batched path, before the sorted actors
    this.drawShadows(c);
    const hv = this.player && !this.done ? this.pick(this.mouse.x, this.mouse.y) : undefined;
    this.hover = hv;
    if (hv) {
      // which lane the shot will go into
      c.strokeStyle = 'rgba(240,216,144,0.35)';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(hv.x, hv.y + 1, this.zw(hv) * 0.55, this.zw(hv) * 0.14, 0, 0, Math.PI * 2);
      c.stroke();
    }
    // actors, y-sorted by feet (id epsilon breaks ties)
    const L = this.lightEnv();
    type D = { y: number; f: () => void };
    const list: D[] = [];
    for (const z of this.zombies) list.push({ y: this.sortKey(z), f: () => this.drawZombie(c, z, L) });
    for (const gd of this.guards) if (!gd.s.dead && !gd.fled) list.push({ y: gd.y + (gd.downed ? -0.5 : 0) + gd.homeX * 1e-5, f: () => this.drawGuard(c, gd) });
    list.push({ y: WALL_KEY, f: () => this.drawWall(c) });
    for (let l = 0; l < 4; l++) if (this.piles[l] >= 0.3) list.push({ y: LANES[l] + 0.5, f: () => this.drawPile(c, l) });
    list.push({ y: 650, f: () => this.drawPoles(c) });
    for (const cv of this.covers) list.push({ y: cv.y, f: () => this.drawCover(c, cv) });
    if (this.dog) list.push({ y: this.dog.y, f: () => this.drawDog(c) });
    if (G.fort.wire > 0) {
      for (let i = 0; i < LANES.length; i++) list.push({ y: LANES[i] + 0.9, f: () => this.drawWireLane(c, i) });
      list.push({ y: GROUND_BOT - 1, f: () => this.drawWirePosts(c, true) });
    }
    this.turrets.forEach((tu, i) => list.push({ y: WALL_KEY + 1 - i * 0.1, f: () => this.drawTurret(c, tu) }));
    for (const h of this.hooks) if (h.sorted) list.push(...h.sorted(c)); // night modules
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    for (const gd of this.guards) if (gd.downed && !gd.s.dead && !gd.fled) this.drawDownedLabel(c, gd);
    // the front plane: near-black weeds and kerb rubble, parallaxed faster than the backdrop
    const fg = fgStrip();
    c.drawImage(fg, Math.round(-400 + px * 1.4), H - 44);
    // particles
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'smoke') { c.fillStyle = `rgba(60,58,55,${a * 0.4})`; c.beginPath(); c.arc(p.x, p.y, p.size * (2 - a), 0, 7); c.fill(); }
      else if (p.kind === 'spore') { c.fillStyle = `rgba(168,134,47,${a * 0.35})`; c.beginPath(); c.arc(p.x, p.y, p.size * (2.2 - a), 0, 7); c.fill(); }
      else if (p.kind === 'dust') { c.fillStyle = `rgba(120,108,90,${a * 0.35})`; c.beginPath(); c.arc(p.x, p.y, p.size * (1.8 - a * 0.8), 0, 7); c.fill(); }
      else if (p.kind === 'puff') { c.fillStyle = `rgba(${p.color},${a * 0.45})`; c.beginPath(); c.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, 7); c.fill(); }
      else if (p.kind === 'shell') {
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot ?? 0);
        c.fillStyle = p.color; c.fillRect(-(p.w ?? 3) / 2, -(p.h ?? 1.5) / 2, p.w ?? 3, p.h ?? 1.5);
        c.restore();
      }
      else if (p.kind === 'fire') {
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = `rgba(255,${(90 + 150 * a) | 0},${(30 + 60 * a * a) | 0},${a * 0.55})`;
        c.beginPath();
        c.ellipse(p.x, p.y, p.size * (0.5 + a * 0.6), p.size * (1 + a * 1.4), 0, 0, 7);
        c.fill();
        c.globalCompositeOperation = 'source-over';
      }
      else { c.fillStyle = p.color; c.globalAlpha = Math.min(1, a * 2); c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); c.globalAlpha = 1; }
    }
    // grenades and mortar bombs in the air
    for (const l of this.lobs) {
      const k = l.t / l.dur;
      const x = l.x0 + (l.x1 - l.x0) * k;
      const y = l.y0 + (l.y1 - 20 - l.y0) * k - Math.sin(k * Math.PI) * (120 + Math.abs(l.x1 - l.x0) * 0.2);
      c.fillStyle = '#1a1814';
      c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
    }
    this.drawGlobs(c);
    // tracers
    for (const t of this.tracers) {
      c.strokeStyle = `rgba(255,226,170,${Math.min(1, t.life * 14)})`;
      c.lineWidth = t.w;
      c.beginPath();
      c.moveTo(t.x1, t.y1);
      c.lineTo(t.x2, t.y2);
      c.stroke();
    }
    if (this.plan.special === 'fog') this.drawFog(c, 0.45);
    if (G.weather === 'snow' || this.plan.special === 'crossing') this.drawSnow(c);
    // darkness, pass B: the same mask at 40%, so the actors sit in the scene without being flattened
    c.globalAlpha = 0.4;
    c.drawImage(this.dark, 0, 0, W, H);
    c.globalAlpha = 1;
    this.drawGlow(c);
    // texts
    for (const t of this.texts) {
      c.font = `bold ${t.size}px "Special Elite", monospace`;
      c.fillStyle = t.color;
      c.globalAlpha = Math.min(1, t.life * 2);
      c.textAlign = 'center';
      c.fillText(t.text, t.x, t.y);
      c.globalAlpha = 1;
    }
    c.restore();
    this.drawHud(c);
    for (const h of this.hooks) h.drawOver?.(c); // night modules
  }

  drawFog(c: CanvasRenderingContext2D, k: number) {
    const fg = c.createLinearGradient(500, 0, W, 0);
    fg.addColorStop(0, 'rgba(120,128,135,0)');
    fg.addColorStop(0.4, `rgba(120,128,135,${0.55 * k})`);
    fg.addColorStop(1, `rgba(120,128,135,${0.85 * k})`);
    c.fillStyle = fg;
    c.fillRect(0, 0, W, H);
  }

  // warm light lying on the asphalt under the floodlights and the fires
  drawPools(c: CanvasRenderingContext2D) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const pool = (x: number, y: number, rx: number, ry: number, rgb: string, a: number) => {
      c.save();
      c.translate(x, y);
      c.scale(1, ry / rx);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g;
      c.fillRect(-rx, -rx, rx * 2, rx * 2);
      c.restore();
    };
    pool(150, 684, 230, 34, '255,214,150', 0.07); // the lantern behind the line
    for (let i = 0; i < Math.min(3, G.fort.lights); i++) pool(520 + i * 190, 652, 300, 52, '255,226,170', 0.085);
    for (const f of this.fires) pool(f.x, f.y, f.w * 1.1, 40, '255,150,60', 0.3 * Math.min(1, f.life));
    for (const l of this.lights) if (l.max > 1) pool(l.x, Math.max(l.y, LANES[1]), l.r * 0.6, 34, l.color, 0.18 * Math.min(1, l.life / l.max + 0.3));
    c.restore();
  }

  drawShadows(c: CanvasRenderingContext2D) {
    // contact: one path, one fill. Shadows stay on the ground while bodies bob, lunge or climb.
    const cast: [number, number, number][] = [];
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.beginPath();
    for (const z of this.zombies) {
      if (z.emerge !== undefined && z.emerge > 0.45) continue;
      const fade = (z.state === 'dying' ? Math.max(0, 1 - Math.max(0, z.dieT - 0.2) * 3) : 1) * this.fogAlpha(z);
      if (z.state === 'cover' && z.ducked) continue; // the junk pile carries the shadow
      const rx = this.zw(z) * (z.def.crawl ? 0.5 : 0.38) * fade;
      shadowEllipse(c, z.x, z.y + 1, rx);
      if (fade > 0.5) cast.push([z.x + 12 * z.scale, z.y + 1, rx * 1.6]);
    }
    for (const g of this.guards) {
      if (g.s.dead || g.fled || g.downed) continue;
      const rx = 26 * g.sc;
      shadowEllipse(c, g.x, g.y + 1, rx);
      cast.push([g.x + 12 * g.sc, g.y + 1, rx * 1.6]);
    }
    const ww = this.wallW();
    shadowEllipse(c, WALL_X + 10 - ww / 2, GROUND_BOT, ww / 2 + 12, 7);
    for (const tu of this.turrets) shadowEllipse(c, tu.x, GROUND_BOT, 12, 3);
    for (const cv of this.covers) shadowEllipse(c, cv.x, cv.y, cv.w * 0.62, 6);
    if (this.dog) shadowEllipse(c, this.dog.x, this.dog.y + 1, 26, 5);
    if (G.fort.wire > 0) for (let k = 0; k < Math.min(3, G.fort.wire); k++) { const x0 = WALL_X + 60 + k * 90; shadowEllipse(c, x0 + 1, GROUND_BOT, 5, 2); shadowEllipse(c, x0 + 79, GROUND_BOT, 5, 2); }
    c.fill();
    // a second, softer shadow cast away from the floodlights and the house (toward the road)
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    for (const [x, y, rx] of cast) shadowEllipse(c, x, y, rx);
    c.fill();
  }

  // a heap of whatever was in the road: a door, tires, a shopping cart on its side
  drawCover(c: CanvasRenderingContext2D, cv: { x: number; y: number; w: number; h: number; seed: number }) {
    const r = (k: number) => (Math.sin(cv.seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
    const junk = Math.abs(r(3)) < 0.5 ? 'fort_junk1' : 'fort_junk2';
    if (has(junk)) {
      // the heap's generated sprite, stretched to the cover's footprint, graded for its lane
      const lane = nearestLane(cv.y - 3);
      if (drawProp(c, junk, cv.x, cv.y + 2, cv.h * 1.15, LOOK[lane], { w: Math.max(cv.w * 1.25, propW(junk, cv.h * 1.15) * 0.85), flip: r(5) < 0 })) return;
    }
    const x0 = cv.x - cv.w / 2, x1 = cv.x + cv.w / 2, top = cv.y - cv.h;
    c.fillStyle = '#1a1816';
    c.beginPath();
    c.moveTo(x0 - 8, cv.y);
    for (let i = 0; i <= 6; i++) {
      const x = x0 + (cv.w * i) / 6;
      c.lineTo(x, top + Math.abs(r(i)) * cv.h * 0.35 + (i === 0 || i === 6 ? cv.h * 0.4 : 0));
    }
    c.lineTo(x1 + 8, cv.y);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(150,160,175,0.35)';
    c.lineWidth = 1.5;
    c.stroke();
    // a plank across it and a tire leaning on it
    c.strokeStyle = '#3d3226';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(x0 + 4, top + cv.h * 0.45);
    c.lineTo(x1 - 2, top + cv.h * (0.2 + Math.abs(r(9)) * 0.2));
    c.stroke();
    c.fillStyle = '#121110';
    c.beginPath();
    c.ellipse(x0 + cv.w * 0.28, cv.y - cv.h * 0.3, cv.h * 0.3, cv.h * 0.32, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#26221e';
    c.beginPath();
    c.ellipse(x0 + cv.w * 0.28, cv.y - cv.h * 0.3, cv.h * 0.13, cv.h * 0.14, 0, 0, Math.PI * 2);
    c.fill();
  }

  drawDog(c: CanvasRenderingContext2D) {
    const d = this.dog!;
    const im = img('dog');
    if (!im) return;
    const h = 62 * depthScale(d.y);
    const w = (im.width / im.height) * h;
    const hop = d.barkT > 0 ? -Math.abs(Math.sin(this.t * 14)) * 4 : Math.sin(this.t * 2) * 0.6;
    const bk = bakeSprite('dog', Math.round(h), LOOK[3], 0, { pad: PAD });
    if (bk) c.drawImage(bk.cv, Math.round(d.x - w / 2 - PAD), Math.round(d.y - h + hop - PAD));
  }

  drawDrain(c: CanvasRenderingContext2D) {
    const open = this.drainOpen > 0;
    const y = 676;
    if (has('fort_drain') && has('fort_grate')) {
      // the hole in the road; its grate over it, or shoved aside when something comes up
      drawProp(c, 'fort_drain', DRAIN_X, y + 9, 22, LOOK[2], { w: 86 });
      drawProp(c, 'fort_grate', open ? DRAIN_X + 40 : DRAIN_X, y + (open ? 9 : 6), open ? 14 : 15, LOOK[2], { w: 76, rot: open ? 0.08 : 0 });
      return;
    }
    c.fillStyle = '#0b0b0c';
    c.beginPath();
    c.ellipse(DRAIN_X, y, 40, 8, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = open ? '#6a645c' : '#7a7468';
    c.lineWidth = 2;
    // the grate, shoved aside when something comes up
    const gx = open ? DRAIN_X + 34 : DRAIN_X;
    for (let i = -3; i <= 3; i++) {
      c.beginPath();
      c.moveTo(gx + i * 10, y - 6);
      c.lineTo(gx + i * 10, y + 6);
      c.stroke();
    }
  }

  // wire belt: posts at both ends of the band, a strand at knee height through each lane
  drawWirePosts(c: CanvasRenderingContext2D, near: boolean) {
    if (has('fort_wire')) return; // the generated belt carries its own pickets (drawWireLane)
    c.fillStyle = near ? '#1d1a17' : '#2b2622';
    const y = near ? GROUND_BOT : GROUND_TOP + 4, h = near ? 62 : 44;
    for (let k = 0; k < Math.min(3, G.fort.wire); k++) {
      const x0 = WALL_X + 60 + k * 90;
      c.fillRect(x0, y - h, near ? 4 : 3, h);
      c.fillRect(x0 + 78, y - h, near ? 4 : 3, h);
    }
  }

  drawWireLane(c: CanvasRenderingContext2D, lane: number) {
    const s = depthScale(LANES[lane]);
    if (has('fort_wire')) {
      // two rows of belt (the far-middle and near lanes) per section; the others are covered by them
      if (lane !== 1 && lane !== 3) return;
      for (let k = 0; k < Math.min(3, G.fort.wire); k++) {
        const x0 = WALL_X + 60 + k * 90 + (LANES[3] - LANES[lane]) * 0.12;
        drawProp(c, 'fort_wire', x0 + 40 + (lane === 1 ? 12 : 0), LANES[lane] + 2, 46 * s, LOOK[lane], { w: 86, flip: (lane + k) % 2 === 1 });
      }
      return;
    }
    c.strokeStyle = `rgba(${58 + lane * 8},${55 + lane * 8},${52 + lane * 8},0.85)`;
    c.lineWidth = lane >= 2 ? 1.4 : 1;
    for (let k = 0; k < Math.min(3, G.fort.wire); k++) {
      const x0 = WALL_X + 60 + k * 90;
      c.beginPath();
      for (let x = 0; x <= 80; x += 4) {
        const y = LANES[lane] - 34 * s + Math.sin(x * 0.4 + lane + k) * 5 * s;
        if (x === 0) c.moveTo(x0 + x, y); else c.lineTo(x0 + x, y);
      }
      c.stroke();
    }
  }

  wallW() {
    const frac = G.fort.hp / G.fort.maxHp;
    const im = img(frac > 0.45 ? 'barricade' : 'barricade_broken');
    const h = 118 + Math.min(50, (G.fort.maxHp - 300) * 0.1);
    return im ? (im.width / im.height) * h : 120;
  }

  drawWall(c: CanvasRenderingContext2D) {
    const frac = G.fort.hp / G.fort.maxHp;
    const im = img(frac > 0.45 ? 'barricade' : 'barricade_broken');
    const h = 118 + Math.min(50, (G.fort.maxHp - 300) * 0.1);
    if (im) {
      const w = (im.width / im.height) * h;
      // its base sits on the front edge of the ground plane: it spans every lane
      if (frac <= 0) {
        c.globalAlpha = 0.85;
        c.drawImage(im, WALL_X - w + 10, GROUND_BOT - h * 0.45, w, h * 0.45);
        c.globalAlpha = 1;
      } else {
        c.drawImage(im, WALL_X - w + 10, GROUND_BOT - h, w, h);
      }
      // spikes, a row per lane, on each lane's face
      if (G.fort.spikes > 0 && has('fort_spikes')) {
        // a rail per lane on its face, up to three rows as the upgrades stack
        const rows = Math.min(3, Math.ceil(G.fort.spikes / 2));
        for (let row = 0; row < rows; row++) for (let lane = 0; lane < 4; lane += row === 1 ? 2 : 1) {
          drawProp(c, 'fort_spikes', wallX(lane) + 2, LANES[lane] - 34 - row * 16, 18, LOOK[lane], { ax: 0, w: 44, rot: -0.1 });
        }
      } else for (let i = 0; i < Math.min(5, G.fort.spikes) * 3; i++) {
        c.strokeStyle = '#4a3f35';
        c.lineWidth = 3;
        const lane = i % 4;
        const sx = wallX(lane) + 2 + (Math.floor(i / 4) % 3) * 5, sy = LANES[lane] - 40 - Math.floor(i / 4) * 9;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(sx + 26, sy - 8);
        c.stroke();
      }
    }
  }

  // floodlights on poles, behind the defenders
  drawPoles(c: CanvasRenderingContext2D) {
    for (let i = 0; i < Math.min(3, G.fort.lights); i++) {
      const x = 260 - i * 90;
      if (drawProp(c, 'fort_light', x + 2, 652, 280, LOOK[2])) continue;
      c.fillStyle = '#1a1a1a';
      c.fillRect(x, 380, 4, 270);
      c.fillStyle = '#e8e2c0';
      c.fillRect(x - 6, 376, 18, 10);
    }
  }

  drawTurret(c: CanvasRenderingContext2D, tu: { x: number; y: number; cd: number; flash: number; ang: number }) {
    if (drawGunBase(c, 'nailturret', tu.x, tu.y, GROUND_BOT) && drawGunPart(c, 'nailturret', tu.x, tu.y, tu.ang)) return;
    c.save();
    c.fillStyle = '#2a2622';
    c.fillRect(tu.x - 4, tu.y, 8, GROUND_BOT - tu.y);
    c.translate(tu.x, tu.y);
    c.rotate(tu.ang);
    c.fillStyle = '#5a4a32';
    c.fillRect(-10, -7, 34, 14);
    c.fillStyle = '#8a7a5a';
    c.fillRect(20, -3, 14, 6);
    if (tu.flash > 0) { c.fillStyle = 'rgba(255,230,160,0.9)'; c.fillRect(34, -3, 12, 6); }
    c.restore();
  }

  drawGuard(c: CanvasRenderingContext2D, g: Guard) {
    const im = img(g.s.sprite);
    const h = SH * g.sc;
    const isP = g === this.player;
    if (g.downed) return this.drawDowned(c, g, im);
    const walking = g.x !== g.homeX || !!g.dragging;
    const bob = walking ? -Math.abs(Math.sin(this.t * 9)) * 3 : Math.sin(this.t * 1.6 + g.homeX) * 1.2;
    // survivors keep full brightness (near row: the near-lane look; far row: lane 2), an ink
    // outline, and a warm rim from the lantern behind them. Never darker than the backdrop.
    const look = LOOK[g.y >= DEF_LANES[1] ? 3 : 2];
    const bh = Math.round(h);
    // the lantern is at x≈120: the rim falls on the side facing it
    const side = (g.x > 120 ? -2 : 2) * (g.face < 0 ? -1 : 1);
    const body = bakeComposite(g.s.sprite, bh, look, 0, PAD, { rim: [WARM, +((look.rim ?? 0.5) * 0.8).toFixed(2), side, 0] });
    // the roof nest: a plank deck on the garage roof
    if (g.post === 'roof') {
      c.fillStyle = '#2a241c';
      c.fillRect(g.x - 46, g.y, 92, 7);
      c.fillStyle = '#1a1612';
      c.fillRect(g.x - 40, g.y + 7, 5, DEF_LANES[0] - g.y - 7);
      c.fillRect(g.x + 35, g.y + 7, 5, DEF_LANES[0] - g.y - 7);
      c.fillStyle = 'rgba(160,130,90,0.35)';
      c.fillRect(g.x - 46, g.y, 92, 1.5);
    }
    // the selected guard: a ring at the feet
    if (!isP && this.selected() === g) {
      c.strokeStyle = 'rgba(240,216,144,0.7)';
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(g.x, g.y + 1, 30 * g.sc, 7 * g.sc, 0, 0, 7); c.stroke();
    }
    const crouch = (isP && this.ducking) || g.duck > 0;
    if (this.actors.drawGuard(c, g)) { /* rigged body (night/actors.ts) */ }
    else if (im && body) {
      const k = h / bh;
      const w = (body.cv.width - PAD * 2) * k;
      const lean = g.dragging && g.dragT < 3 ? 0.18 : 0; // hauling backward
      c.save();
      const kick = g.recoil * g.recoil * (g.kick ?? 6) * (isP ? 0.7 : 0.45);
      c.translate(g.x - g.face * kick, Math.round(g.y + bob));
      if (g.face < 0) c.scale(-1, 1);
      if (lean) c.rotate(-lean);
      // muzzle rise on the heavy ones: a pivot at the feet, a few degrees back
      if ((g.kick ?? 0) >= 10 && g.recoil > 0) c.rotate(-g.recoil * g.recoil * 0.035 * ((g.kick ?? 0) / 18));
      if (crouch) c.scale(1, 0.68);
      c.drawImage(body.cv, -w / 2 - PAD * k, -h - PAD * k, body.cv.width * k, body.cv.height * k);
      c.restore();
    }
    // muzzle flash, shaped by the gun (night/gunfx.ts)
    if (g.flash > 0) {
      const mz = this.muzzle(g);
      drawFlash(c, mz.x, mz.y, g.flashAng ?? (g.face > 0 ? 0 : Math.PI), g.flashKind ?? 'long', g.flash / 0.06, (g.flashSize ?? 1) * g.sc, this.shotsTonight + g.homeX);
    }
    // label; a far-row label steps up out of the way of a near-row neighbour's
    let top = g.y - h;
    if (g.y < DEF_LANES[1] && this.guards.some((o) => o !== g && o.y >= DEF_LANES[1] && !o.s.dead && !o.fled && !o.downed && Math.abs(o.x - g.x) < 50)) top -= 14;
    c.font = '11px "Special Elite", monospace';
    c.textAlign = 'center';
    c.fillStyle = isP ? '#f0d890' : '#cfc6b0';
    c.fillText(first(g.s) + (isP ? ' ◆' : ''), g.x, top - 14);
    if (!isP) this.drawOrderGlyph(c, g, g.x + c.measureText(first(g.s)).width / 2 + 9, top - 18);
    const hp = Math.max(0, 1 - pain(g.s) / DOWN_PAIN);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(g.x - 20, top - 9, 40, 4);
    c.fillStyle = hp > 0.5 ? '#9db070' : hp > 0.25 ? '#d0a040' : '#c04030';
    c.fillRect(g.x - 20, top - 9, 40 * hp, 4);
    // one status line at most, then the moodle above it
    let line = top - 26;
    let status = '', sc = '#d9c9a0';
    if (g.dragging) { status = `hauling ${first(g.dragging.s)}`; sc = '#e0c080'; }
    else if (g.mode) { status = g.mode === 'panic' ? 'panicking' : 'enraged'; sc = g.mode === 'panic' ? '#d0a040' : '#e05040'; }
    else if (g.reload > 0 || (isP && this.playerReload > 0)) status = 'reloading';
    if (status) { c.fillStyle = sc; c.fillText(status, g.x, line); line -= 12; }
    if (isBitten(g.s) && !g.s.wounds.some((w) => w.hidden)) {
      c.fillStyle = '#b8862f';
      c.fillText('bitten', g.x, line);
      line -= 12;
    }
    if (g.moodle && !g.mode) {
      c.font = 'italic 12px "Crimson Text", Georgia, serif';
      const tw = c.measureText(g.moodle).width;
      c.fillStyle = 'rgba(8,8,10,0.55)';
      c.fillRect(g.x - tw / 2 - 4, line - 10, tw + 8, 13);
      c.fillStyle = g.moodleC;
      c.fillText(g.moodle, g.x, line);
    }
  }

  drawDowned(c: CanvasRenderingContext2D, g: Guard, im: HTMLImageElement | undefined) {
    const h = SH * g.sc;
    // blood under them
    c.fillStyle = reduceGore() ? 'rgba(40,8,6,0.4)' : 'rgba(70,10,8,0.55)';
    c.beginPath();
    c.ellipse(g.x, g.y - 2, 60, 7, 0, 0, Math.PI * 2);
    c.fill();
    if (this.actors.drawGuard(c, g)) return; // lying in the road on the rig
    if (im) {
      const w = (im.width / im.height) * h;
      c.save();
      // flat on their back, head toward the house
      c.translate(g.x, g.y - w * 0.5 + 6);
      c.rotate(-Math.PI / 2);
      c.drawImage(im, -w / 2, -h / 2, w, h);
      c.globalAlpha = 0.2;
      const sh = shadeImg(g.s.sprite, '#0a0b10');
      if (sh) c.drawImage(sh, -w / 2, -h / 2, w, h);
      c.restore();
    }
  }

  drawDownedLabel(c: CanvasRenderingContext2D, g: Guard) {
    c.font = '11px "Special Elite", monospace';
    c.textAlign = 'center';
    c.fillStyle = '#cfc6b0';
    const lh = 46;
    c.fillText(first(g.s), g.x, g.y - lh - 8);
    let st = g.safe ? 'down' : 'DOWN';
    if (!g.safe && g.mauledT > 0) st = 'DOWN · they are on ' + them(g.s);
    c.fillStyle = g.safe ? '#a8a08a' : '#e05040';
    c.fillText(st, g.x, g.y - lh - 22);
  }

  // Where the light is this frame, for the rim/silhouette treatment of each body.
  lightEnv() {
    const cones: { x: number; y: number; len: number; face: number }[] = [];
    for (const g of this.guards) {
      if (!g.w || g.s.dead || g.fled || g.downed) continue;
      const len = this.prof(g.w).light;
      if (len > 0) { const mz = this.muzzle(g); cones.push({ x: mz.x, y: mz.y, len, face: g.face }); }
    }
    return { flood: Math.min(3, G.fort.lights), cones };
  }

  /** 0 (dark) … 1 (well lit) at a body's chest, and whether a muzzle flash just lit it. */
  lightAt(x: number, y: number, env: ReturnType<Battle['lightEnv']>): [number, boolean] {
    let L = 0, flash = false;
    if (env.flood > 0) L = Math.max(L, Math.max(0, Math.min(1, 0.95 - (0.75 * (x - 260)) / 840)) * (0.7 + 0.1 * env.flood));
    const dl = Math.hypot(x - 120, y - 600);
    if (dl < 300) L = Math.max(L, 0.7 * (1 - dl / 300)); // the lantern
    for (const f of this.fires) { const d = Math.abs(x - f.x); if (d < 300) L = Math.max(L, (1 - d / 300) * Math.min(1, f.life)); }
    for (const k of env.cones) {
      const d = (x - k.x) * k.face;
      if (d > 0 && d < k.len && y > k.y - d * 0.12 - 60 && y < k.y + d * 0.2 + 120) L = Math.max(L, 0.85 * (1 - d / k.len));
    }
    for (const l of this.lights) {
      const d = Math.hypot(x - l.x, y - l.y);
      if (d > l.r) continue;
      const a = (1 - d / l.r) * Math.min(1, l.life / l.max + 0.3);
      L = Math.max(L, a);
      if (l.max < 0.1) flash = true;
    }
    return [L, flash];
  }

  // The two baked looks of a crowd body in a lane: lit (a warm key rim on the side facing
  // the line) and dark (a thin cool moon rim, and 35% toward a near-silhouette).
  zLook(sprite: string, bh: number, lane: number, variant: number, flip: boolean, lit: boolean) {
    const look = LOOK[lane];
    const rimA = look.rim ?? 0.5;
    const s = Math.round(depthScale(LANES[lane]) * 4) / 2; // 2px × scale, to the half pixel
    return lit
      ? bakeComposite(sprite, bh, look, variant, PAD, { rim: [WARM, +(rimA * 0.85).toFixed(2), flip ? s : -s, 0] })
      : bakeComposite(sprite, bh, look, variant, PAD, { shade: [DARK, 0.35], rim: [COOL, +(rimA * 0.6).toFixed(2), flip ? -1.5 : 1.5, -1.5] });
  }

  /** In fog the far ones fade into it (by x), the far lanes sooner. 1 on a clear night. */
  fogAlpha(z: Zombie) {
    const r = z.rise ? 1 - z.rise / 1.25 : 1; // forming up out of the dark
    if (this.plan.special !== 'fog') return r;
    const farFade = Math.max(0.15, 1 - Math.max(0, z.x - 620) / 400);
    return r * Math.max(0.15, 1 - (1 - farFade) * (1.4 - 0.4 * depthT(z.y)));
  }

  drawZombie(c: CanvasRenderingContext2D, z: Zombie, env: ReturnType<Battle['lightEnv']>) {
    if (this.actors.drawZombie(c, z, env)) {
      if (z.state !== 'dying') {
        this.drawTells(c, z, Math.max(0, Math.min(1, (this.lightAt(z.x, z.y - this.zh(z) * 0.6, env)[0] - 0.12) / 0.2)));
        if (z.name) { c.font = '12px "Special Elite", monospace'; c.fillStyle = '#c9a95a'; c.textAlign = 'center'; c.fillText(z.name, z.x, z.y - this.zh(z) - 8); }
      }
      return;
    }
    const lane = nearestLane(z.y);
    const bh = this.laneH(z);
    const h = this.zh(z);
    // light at the chest: walking out of the dark into a pool visibly switches a body on
    const [L, flash] = z.state === 'dying' ? [0.5, false] : this.lightAt(z.x, z.y - h * 0.6, env);
    const lit = flash ? 1 : Math.max(0, Math.min(1, (L - 0.12) / 0.2));
    const flip = !!z.flip;
    const lo = lit < 0.98 ? this.zLook(z.sprite, bh, lane, z.variant, flip, false) : null;
    const hi = lit > 0.02 ? this.zLook(z.sprite, bh, lane, z.variant, flip, true) : null;
    const body = hi ?? lo;
    if (!body) return;
    const k = h / bh;
    const w = (body.cv.width - PAD * 2) * k;
    c.save();
    let rot = 0, dy = 0, sx = 0, sy = 1;
    const gait = z.def.speed > 60 ? 9 : 3.2;
    const crawler = z.crippled && !z.def.crawl && z.def.id !== 'ferryman';
    if (z.state === 'walk' || z.state === 'over' || z.state === 'flee') {
      rot = Math.sin(z.phase * gait) * (z.def.speed > 60 ? 0.05 : 0.04);
      dy = -Math.abs(Math.sin(z.phase * gait)) * (z.def.speed > 60 ? 5 : 2.5) * z.scale;
    } else if (z.state === 'wall' || z.state === 'maul') {
      rot = -0.08 + Math.sin(z.phase * 7) * 0.06;
    } else if (z.state === 'dying') {
      const t = Math.min(1, z.dieT / 0.45);
      rot = t * 1.2;
      dy = t * h * 0.15;
      c.globalAlpha = 1 - Math.max(0, z.dieT - 0.4) * 5;
    }
    if (z.stun > 0 && z.state !== 'dying') { rot = 0.05 + Math.sin(this.t * 40) * 0.025; dy = 0; }
    { const cp = z.state !== 'dying' ? classicPose(z, h, this.t) : null; if (cp) { rot = cp.rot; dy = cp.dy; sy = cp.sy; } }
    if (z.leap) {
      const q = Math.min(1, z.leap.t / z.leap.dur);
      dy = -Math.sin(q * Math.PI) * (130 + 40 * z.scale);
      rot = -0.5 + q * 0.7;
    } else if (z.def.leap && (z.windup ?? 0) > 0) {
      sy = 0.84; // coiled
      rot = -0.06;
    }
    if (z.state === 'climb') { dy = -this.climbLift(z); rot = -0.25; }
    if (crawler && z.state !== 'dying') { rot = -1.25; sx = h * 0.42; dy = -w * 0.18; }
    c.translate(Math.round(z.x), Math.round(z.y + dy));
    if (flip) c.scale(-1, 1);
    if (sx) c.translate(sx, 0);
    c.rotate(rot);
    if (sy !== 1) c.scale(1, sy);
    // up out of the drain, or down behind cover: only what is above the line shows
    const sink = (z.emerge && z.emerge > 0 ? h * Math.min(1, z.emerge / 0.9) : 0) + (z.state === 'cover' && z.ducked ? h * 0.32 : 0);
    if (sink > 0 || z.emerge !== undefined) {
      c.beginPath();
      c.rect(-w, -h * 2, w * 2, h * 2 - dy + 2);
      c.clip();
      c.translate(0, sink);
    }
    // in fog the far ones fade into it, the far lanes sooner
    c.globalAlpha *= this.fogAlpha(z);
    if (z.headless) {
      c.beginPath();
      c.rect(-w / 2 - 10, -h + h * z.def.head * 0.95, w + 20, h);
      c.clip();
    }
    const base = c.globalAlpha;
    const dx = -w / 2 - PAD * k, dyy = -h - PAD * k, dw = body.cv.width * k, dh = body.cv.height * k;
    // one baked body (outline, grade, fog, variant, rim, shade); two while crossing a light's edge
    if (lo) c.drawImage(lo.cv, dx, dyy, dw, dh);
    if (hi) { c.globalAlpha = base * (lo ? lit : 1); c.drawImage(hi.cv, dx, dyy, dw, dh); }
    // a nearby muzzle flash, or the crosshair on it: a brighter warm edge for a moment
    const extra = (flash ? 0.3 : 0) + (this.hover === z ? 0.35 : 0);
    if (extra > 0) {
      const s = Math.round(depthScale(LANES[lane]) * 4) / 2;
      const e = bakeEdge(z.sprite, bh, WARM, flip ? s : -s, 0, PAD);
      if (e) { c.globalAlpha = base * Math.min(1, extra); c.drawImage(e, dx, dyy, dw, dh); }
    }
    c.globalAlpha = base;
    if (z.flash > 0) {
      const f = flashImg(z.sprite);
      if (f) { c.globalAlpha = base * 0.6; c.drawImage(f, -w / 2, -h, w, h); }
    }
    if (z.burn > 0) {
      c.globalAlpha = 0.35;
      const sh = shadeImg(z.sprite, '#ff7a2a');
      if (sh) c.drawImage(sh, -w / 2, -h, w, h);
    }
    // the Buck's eyes catch the light as it coils
    if (z.def.leap && (z.windup ?? 0) > 0) {
      const ey = EYES[z.sprite];
      if (ey) {
        const ex = -w / 2 + ey.x * w, eyy = -h + ey.y * h;
        const a = 0.45 + 0.55 * (1 - (z.windup ?? 0) / 0.8);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'lighter';
        const gr = c.createRadialGradient(ex, eyy, 0, ex, eyy, 16 * z.scale);
        gr.addColorStop(0, `rgba(255,200,90,${a})`);
        gr.addColorStop(1, 'rgba(255,160,40,0)');
        c.fillStyle = gr;
        c.fillRect(ex - 18, eyy - 18, 36, 36);
        c.globalCompositeOperation = 'source-over';
      }
    }
    c.restore();
    if (z.state !== 'dying') this.drawTells(c, z, lit);
    if (z.name && z.state !== 'dying') {
      c.font = '12px "Special Elite", monospace';
      c.fillStyle = '#c9a95a';
      c.textAlign = 'center';
      c.fillText(z.name, z.x, z.y - h - 8);
    }
  }

  /** Weakspots (subtle pulsing ochre/bone, brighter with Focus), the Crier's wind-up ring, the Biler's swelling throat, a marked target. */
  drawTells(c: CanvasRenderingContext2D, z: Zombie, lit: number) {
    const h = this.zh(z);
    const fog = this.fogAlpha(z);
    if (z.x < W + 10 && zoneMarkers()) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4 + z.id);
      const a = Math.min(1, (0.24 + 0.16 * pulse) * (this.focusing ? 2.4 : 1) * (0.6 + 0.4 * lit) * fog);
      for (const w of this.weakPts(z)) {
        const bone = w.kind === 'knee';
        c.strokeStyle = bone ? `rgba(232,220,192,${a})` : `rgba(222,168,70,${a * 1.2})`;
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(w.x, w.y, w.r * (0.9 + 0.15 * pulse), 0, 7); c.stroke();
        c.fillStyle = bone ? `rgba(232,220,192,${a * 0.5})` : `rgba(222,168,70,${a * 0.6})`;
        c.beginPath(); c.arc(w.x, w.y, Math.max(1.2, w.r * 0.28), 0, 7); c.fill();
      }
    }
    // Crier drawing breath: a pale ring growing over its head
    if (z.def.scream && (z.windup ?? 0) > 0) {
      const hb = this.hitbox(z);
      const q = 1 - (z.windup ?? 0) / 1.2;
      c.strokeStyle = `rgba(225,225,210,${0.25 + q * 0.55})`;
      c.lineWidth = 2;
      c.beginPath(); c.arc(hb.hx, hb.hy, 10 + q * 26, 0, 7); c.stroke();
    }
    // Biler about to spit: the throat swells yellow
    if (z.def.spit && (z.windup ?? 0) > 0) {
      const w = this.weakPts(z)[0];
      if (w) {
        const q = 1 - (z.windup ?? 0) / 0.7;
        c.fillStyle = `rgba(200,190,70,${0.25 + q * 0.4})`;
        c.beginPath(); c.arc(w.x, w.y, w.r * (1 + q * 0.8), 0, 7); c.fill();
      }
    }
    // a marked target: an ochre bracket
    if (this.mark && this.mark.id === z.id) {
      const hb = this.hitbox(z);
      const x1 = hb.x1 - 6, x2 = hb.x2 + 6, y1 = hb.hy - hb.hr - 6, y2 = hb.y2 + 2, q = 8;
      c.strokeStyle = 'rgba(222,168,70,0.9)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x1, y1 + q); c.lineTo(x1, y1); c.lineTo(x1 + q, y1);
      c.moveTo(x2 - q, y1); c.lineTo(x2, y1); c.lineTo(x2, y1 + q);
      c.moveTo(x1, y2 - q); c.lineTo(x1, y2); c.lineTo(x1 + q, y2);
      c.moveTo(x2 - q, y2); c.lineTo(x2, y2); c.lineTo(x2, y2 - q);
      c.stroke();
    }
    void h;
  }
  drawSnow(c: CanvasRenderingContext2D) {
    c.fillStyle = 'rgba(230,235,240,0.7)';
    for (let i = 0; i < 120; i++) {
      const x = (i * 97.3 + this.t * (20 + (i % 5) * 6)) % W;
      const y = (i * 53.7 + this.t * (40 + (i % 7) * 9)) % H;
      c.fillRect(x, y, 2, 2);
    }
  }

  // The darkness mask, built at half resolution into this.dark; drawn twice per frame
  // (full before the actors, 40% after).
  buildDark() {
    const d = this.dctx;
    const s = 0.5;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W * s, H * s);
    const base = Math.max(0.12, 0.4 - G.fort.lights * 0.09 + (this.plan.special === 'crossing' ? -0.06 : 0));
    d.fillStyle = `rgba(4,6,14,${base})`;
    d.fillRect(0, 0, W * s, H * s);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number, a: number) => {
      const g = d.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.fillRect((x - r) * s, (y - r) * s, r * 2 * s, r * 2 * s);
    };
    // the house: a lantern behind the line, its light on the ground
    hole(120, 640, 260, 0.6);
    // flashlights taped to barrels
    for (const g of this.guards) {
      if (!g.w || g.s.dead || g.fled || g.downed) continue;
      const len = this.prof(g.w).light;
      if (len <= 0) continue;
      const mz = this.muzzle(g);
      const ex = mz.x + g.face * len;
      const lg = d.createLinearGradient(mz.x * s, 0, ex * s, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0.8)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = lg;
      d.beginPath();
      d.moveTo(mz.x * s, mz.y * s);
      d.lineTo(ex * s, (mz.y - len * 0.12) * s);
      d.lineTo(ex * s, (mz.y + len * 0.2) * s);
      d.closePath();
      d.fill();
    }
    for (let i = 0; i < Math.min(3, G.fort.lights); i++) {
      // floodlight cone down onto the road
      const g = d.createLinearGradient(260 * s, 0, 1100 * s, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0.1)');
      d.fillStyle = g;
      d.beginPath();
      d.moveTo((260 - i * 90) * s, 380 * s);
      d.lineTo(1200 * s, (560 - i * 30) * s);
      d.lineTo(1200 * s, 720 * s);
      d.lineTo((260 - i * 90) * s, 400 * s);
      d.fill();
    }
    for (const l of this.lights) hole(l.x, l.y, l.r * (0.7 + 0.3 * (l.life / l.max)), Math.min(1, l.life / l.max + 0.3));
    for (const f of this.fires) hole(f.x, f.y - 20, 260, 0.9 * Math.min(1, f.life));
  }

  // additive warm glow for flashes and flashlights, then the vignette
  drawGlow(c: CanvasRenderingContext2D) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const g of this.guards) {
      if (!g.w || g.s.dead || g.fled || g.downed) continue;
      const len = this.prof(g.w).light;
      if (len <= 0) continue;
      const mz = this.muzzle(g);
      const ex = mz.x + g.face * len;
      const bg = c.createLinearGradient(mz.x, 0, ex, 0);
      bg.addColorStop(0, 'rgba(255,240,200,0.16)');
      bg.addColorStop(1, 'rgba(255,240,200,0)');
      c.fillStyle = bg;
      c.beginPath();
      c.moveTo(mz.x, mz.y);
      c.lineTo(ex, mz.y - len * 0.12);
      c.lineTo(ex, mz.y + len * 0.2);
      c.closePath();
      c.fill();
    }
    for (const l of this.lights) {
      const a = (l.life / l.max) * 0.25;
      const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.6);
      g.addColorStop(0, `rgba(${l.color},${a})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
      c.fillStyle = g;
      c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    c.restore();
    // vignette: an ellipse set high, so the bottom corners (HUD) darken and the lanes stay clear
    c.save();
    c.translate(W / 2, H * 0.42);
    c.scale(1.7, 1);
    const v = c.createRadialGradient(0, 0, H * 0.32, 0, 0, H * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.38)');
    c.fillStyle = v;
    c.fillRect(-W, -H, W * 2, H * 2);
    c.restore();
  }

  /** open circle = free fire, bar = hold fire, dot = heads only, square = protect wall; a post letter beside it */
  drawOrderGlyph(c: CanvasRenderingContext2D, g: Guard, x: number, y: number) {
    c.save();
    c.strokeStyle = c.fillStyle = g.order === 'hold' ? '#c9a95a' : g.order === 'heads' ? '#e8dcc0' : g.order === 'wall' ? '#b08060' : '#9a9282';
    c.lineWidth = 1.5;
    if (g.order === 'free') { c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.stroke(); }
    else if (g.order === 'hold') c.fillRect(x - 4, y - 1.2, 8, 2.6);
    else if (g.order === 'heads') { c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.stroke(); c.beginPath(); c.arc(x, y, 1.4, 0, 7); c.fill(); }
    else c.strokeRect(x - 3.5, y - 3.5, 7, 7);
    if (g.post !== 'step') {
      c.font = '9px "Special Elite", monospace';
      c.textAlign = 'left';
      c.fillStyle = '#a89c84';
      c.fillText(g.post === 'roof' ? 'roof' : g.post === 'loop' ? 'loophole' : 'runner', x + 7, y + 3);
    }
    c.restore();
  }

  /** On the ground: faint distance pegs, the Pulper kill line, and where bile is about to land. */
  drawRoadMarks(c: CanvasRenderingContext2D) {
    c.save();
    // pegs every 100 px from the wall, so distances are learned
    c.fillStyle = 'rgba(200,190,160,0.10)';
    for (let d = 100; d <= 800; d += 100) for (let l = 0; l < 4; l += 3) c.fillRect(wallX(l) + d - 1, LANES[l] + 3, 2, 3);
    // the kill line: a Pulper must die beyond it
    if (this.zombies.some((z) => z.def.burst && z.state !== 'dying' && z.x < W)) {
      c.strokeStyle = `rgba(200,150,60,${0.35 + 0.1 * Math.sin(this.t * 3)})`;
      c.lineWidth = 2;
      c.setLineDash([8, 7]);
      c.beginPath();
      c.moveTo(wallX(0) + 180, LANES[0] - 6);
      c.lineTo(wallX(3) + 180, LANES[3] + 8);
      c.stroke();
      c.setLineDash([]);
    }
    // bile: a shadow running along the ground, and the spot it will land on
    for (const b of this.globs) {
      const p = this.globPos(b);
      const up = Math.max(0, p.gy - p.y);
      const r = Math.max(4, 10 - up * 0.03);
      c.fillStyle = `rgba(8,8,6,${0.35 - Math.min(0.2, up * 0.001)})`;
      c.beginPath(); c.ellipse(p.x, p.gy, r * 1.6, r * 0.45, 0, 0, 7); c.fill();
      const q = p.k;
      c.strokeStyle = `rgba(200,190,70,${0.25 + 0.5 * q})`;
      c.lineWidth = 1.5;
      c.setLineDash([4, 4]);
      c.beginPath(); c.ellipse(b.x1, b.gy1 + 1, 22 - 8 * q, 6 - 2 * q, 0, 0, 7); c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  /** The bodies against the wall in one lane: a heap whose height is its mass. */
  drawPile(c: CanvasRenderingContext2D, l: number) {
    const m = this.piles[l];
    if (m < 0.3) return;
    const lim = this.pileLimit();
    const x0 = wallX(l) + 2, y = LANES[l] + 2;
    const sc = depthScale(LANES[l]);
    const len = (40 + Math.min(lim, m) * 4) * sc;
    const ht = Math.min(1.15, m / lim) * 70 * sc;
    const f = Math.min(1, m / lim);
    const pid = f < 0.35 ? 'fort_pile_s' : f < 0.7 ? 'fort_pile_m' : 'fort_pile_l';
    if (has(pid)) {
      // the heap's sprite, its tall end against the wall, as long and as high as the mass
      drawProp(c, pid, x0 - 4, y + 2, Math.max(16 * sc, ht * 1.1), LOOK[l], { ax: 0, w: len * 1.15 });
      this.drawPileGauge(c, m, lim, x0, y, ht);
      return;
    }
    c.save();
    c.fillStyle = '#16120f';
    c.beginPath();
    c.moveTo(x0, y);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const bump = Math.sin(i * 2.3 + l) * 4 * sc;
      c.lineTo(x0 + t * len, y - ht * Math.pow(1 - t, 0.7) - bump * (1 - t));
    }
    c.lineTo(x0 + len, y);
    c.closePath();
    c.fill();
    // limbs and cloth
    c.strokeStyle = '#2c241d';
    c.lineWidth = 3 * sc;
    for (let i = 0; i < Math.min(7, m); i++) {
      const t = ((i * 37 + l * 11) % 100) / 100;
      const px = x0 + t * len * 0.9, py = y - ht * Math.pow(1 - t, 0.7) * 0.7;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + 12 * sc * (i % 2 ? 1 : -0.6), py - 7 * sc); c.stroke();
    }
    c.restore();
    this.drawPileGauge(c, m, lim, x0, y, ht);
  }

  /** The pile's gauge (UI), once it starts to matter. */
  drawPileGauge(c: CanvasRenderingContext2D, m: number, lim: number, x0: number, y: number, ht: number) {
    if (m < lim * 0.4) return;
    const f = Math.min(1, m / lim);
    const gx = x0 + 6, gy = y - ht - 12;
    c.fillStyle = 'rgba(10,9,8,0.6)';
    c.fillRect(gx, gy, 34, 5);
    c.fillStyle = f >= 1 ? '#c04030' : f >= 0.8 ? '#c07030' : '#8f7a55';
    c.fillRect(gx + 1, gy + 1, 32 * f, 3);
  }

  drawGlobs(c: CanvasRenderingContext2D) {
    for (const b of this.globs) {
      const p = this.globPos(b);
      c.fillStyle = '#a8a040';
      c.beginPath(); c.arc(p.x, p.y, 6, 0, 7); c.fill();
      c.fillStyle = 'rgba(230,220,120,0.6)';
      c.beginPath(); c.arc(p.x - 2, p.y - 2, 2, 0, 7); c.fill();
      // a dripping tail
      c.strokeStyle = 'rgba(150,145,50,0.5)';
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 10, p.y - 4); c.stroke();
    }
  }

  /** The next ~20 s of arrivals (research 05 §2): detail by scouting, +10 s with someone on the roof. */
  drawThreatRibbon(c: CanvasRenderingContext2D) {
    const tier = intelTier();
    const look = 20 + (this.guards.some((g) => g.post === 'roof' && this.standing(g)) ? 10 : 0);
    const x0 = W - 330, x1 = W - 22, y = 22;
    const up = this.plan.spawns.slice(this.spawnIdx).filter((s) => s.t - this.t < look);
    c.save();
    c.fillStyle = 'rgba(10,9,8,0.55)';
    c.fillRect(x0 - 8, y - 12, x1 - x0 + 16, 30);
    c.font = '9px "Special Elite", monospace';
    c.textAlign = 'left';
    c.fillStyle = '#7d7462';
    c.fillText(`ROAD ${look}s`, x0 - 4, y - 2);
    c.strokeStyle = 'rgba(160,150,130,0.25)';
    c.beginPath(); c.moveTo(x0, y + 8); c.lineTo(x1, y + 8); c.stroke();
    const glyph: Record<string, [string, string]> = {
      sleeper: ['·', '#8a8272'], deer: ['D', '#c8b48a'], drag: ['_', '#9a8a6a'], pulper: ['P', '#c8a040'], crier: ['C', '#e8dcc0'],
      deputy: ['▣', '#8fa6c8'], ferryman: ['F', '#e07050'], leaper: ['B', '#e0a040'], spitter: ['b', '#b8b050'], raider: ['R', '#d06050'],
      tunneler: ['_', '#9a8a6a'], bellwether: ['☗', '#e0c070'],
    };
    let lastPack = '';
    const close = up.find((s) => s.dark);
    if (close) { c.font = '8px "Special Elite", monospace'; c.fillStyle = '#d06050'; c.textAlign = 'right'; c.fillText('CLOSE IN THE DARK', x1, y - 2); }
    for (const s of up) {
      const k = (s.t - this.t) / look;
      const x = x0 + 40 + k * (x1 - x0 - 40);
      const special = s.type !== 'sleeper' && s.type !== 'drag';
      const [g, col] = glyph[s.type] ?? ['?', '#aaa'];
      if (tier === 0 || (tier === 1 && !special)) {
        c.fillStyle = 'rgba(150,145,135,0.55)';
        c.beginPath(); c.arc(x, y + 8, 2, 0, 7); c.fill();
      } else {
        c.fillStyle = col;
        c.font = special ? 'bold 11px "Special Elite", monospace' : '10px "Special Elite", monospace';
        c.textAlign = 'center';
        c.fillText(g, x, y + 12);
      }
      if (tier >= 2 && s.pack && s.pack !== lastPack) {
        lastPack = s.pack;
        c.font = '8px "Special Elite", monospace';
        c.fillStyle = '#c9a95a';
        c.textAlign = 'center';
        c.fillText(s.pack.toUpperCase(), x, y - 2);
      }
    }
    c.restore();
  }
  drawHud(c: CanvasRenderingContext2D) {
    c.save();
    c.textAlign = 'left';
    // wall bar, segmented; what was just lost shows pale and drains away behind the live value
    const frac = Math.max(0, G.fort.hp / G.fort.maxHp);
    if (this.wallShown < 0 || frac > this.wallShown) this.wallShown = frac;
    if (frac < this.wallShown - 0.004) {
      if (this.wallFlash <= 0.05 && this.wallShown - frac > 0.02) this.wallFlash = 0.35;
      this.wallShown = Math.max(frac, this.wallShown - 0.0035);
    }
    const wj = this.wallFlash > 0 ? Math.sin(this.wallFlash * 60) * 1.5 * shakeScale() : 0;
    c.fillStyle = 'rgba(10,9,8,0.7)';
    c.fillRect(20, 18, 300, 30);
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const on = frac * segs > i;
      const ghost = !on && this.wallShown * segs > i;
      c.fillStyle = on ? (frac > 0.5 ? '#8f7a55' : frac > 0.25 ? '#b0702c' : '#a8322a') : ghost ? `rgba(240,220,190,${0.35 + 0.5 * Math.min(1, this.wallFlash * 3)})` : 'rgba(80,70,60,0.3)';
      c.fillRect(26 + i * 24 + wj, 30, 20, 12);
    }
    if (this.wallFlash > 0) { c.strokeStyle = `rgba(220,90,60,${this.wallFlash * 2})`; c.lineWidth = 2; c.strokeRect(21, 19, 298, 28); }
    c.font = '11px "Special Elite", monospace';
    c.fillStyle = '#d9cdb0';
    c.fillText(`THE WALL  ${Math.ceil(G.fort.hp)}/${G.fort.maxHp}`, 26, 27);
    // clock
    const k = Math.min(1, this.t / this.duration);
    const mins = 18 * 60 + k * 11.5 * 60;
    const hh = Math.floor(mins / 60) % 24, mm = Math.floor(mins % 60);
    c.textAlign = 'center';
    c.font = '20px "Special Elite", monospace';
    c.fillStyle = '#e8dcc0';
    c.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, W / 2, 36);
    c.font = '11px "Special Elite", monospace';
    c.fillStyle = '#a89c84';
    // the Turned and the County men are counted apart; a man running for the trees is not "out there"
    const left = this.plan.spawns.length - this.spawnIdx + this.zombies.filter((z) => z.state !== 'dying' && z.state !== 'flee').length;
    c.fillText(`night ${G.day}   ·   ${this.res.kills} down${this.raidersDown ? `   ·   ${this.raidersDown} County ${this.raidersDown === 1 ? 'man' : 'men'}` : ''}   ·   ${left} still out there`, W / 2, 54);
    // the Bellwether
    const b = this.boss;
    if (b && b.state !== 'dying' && b.x < W + 20) {
      const f = Math.max(0, b.hp / b.maxHp);
      c.fillStyle = 'rgba(10,9,8,0.75)';
      c.fillRect(W / 2 - 210, 64, 420, 22);
      c.fillStyle = this.surge > 0 ? '#c99a3a' : '#8a6a2a';
      c.fillRect(W / 2 - 205, 76, 410 * f, 6);
      c.font = '11px "Special Elite", monospace';
      c.fillStyle = '#d8c08a';
      c.fillText('THE BELLWETHER', W / 2, 74);
    }
    // the bell's pull: an ochre pressure at the edges while it rings
    if (this.surge > 0) {
      const a = Math.min(1, this.surge / 1.5) * 0.22;
      const v = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.9);
      v.addColorStop(0, 'rgba(160,120,40,0)');
      v.addColorStop(1, `rgba(160,120,40,${a})`);
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }
    // Focus: the world drains of colour; low nerve: the edges close in; bile: a yellow smear
    const p = this.player;
    if (this.focusing) { c.fillStyle = 'rgba(20,24,30,0.22)'; c.fillRect(0, 0, W, H); }
    if (this.nerve < this.nerveMax * 0.25 && !this.done) {
      const beat = 0.5 + 0.5 * Math.sin(this.t * (this.shakeT > 0 ? 9 : 6));
      const v = c.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
      v.addColorStop(0, 'rgba(60,0,0,0)');
      v.addColorStop(1, `rgba(60,0,0,${0.18 + 0.12 * beat})`);
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }
    if (this.killFlash > 0) {
      const a = this.killFlash * 0.55;
      const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
      v.addColorStop(0, 'rgba(255,230,190,0)');
      v.addColorStop(1, `rgba(255,230,190,${a})`);
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }
    if (p && p.blind > 0) { c.fillStyle = `rgba(150,140,40,${Math.min(0.3, p.blind * 0.08)})`; c.fillRect(0, 0, W, H); }
    if (!this.intro && threatRibbon()) this.drawThreatRibbon(c);
    // weapon
    if (p && p.w) {
      const def = WEAPONS[p.w.def];
      const prof = this.eff(p);
      const icon = img(def.icon);
      const hard = realism() === 'hardcore';
      c.fillStyle = 'rgba(10,9,8,0.7)';
      c.fillRect(W - 330, H - 92, 310, 74);
      if (icon) {
        const ih = 44, iw = Math.min(150, (icon.width / icon.height) * ih);
        c.drawImage(icon, W - 320, H - 84, iw, (icon.height / icon.width) * iw);
      }
      c.textAlign = 'right';
      c.font = '13px "Special Elite", monospace';
      c.fillStyle = '#d9cdb0';
      c.fillText(p.w.name ? `"${p.w.name}"` : def.name, W - 30, H - 70);
      const mag = this.playerMag.get(p.w.uid) ?? 0;
      const cap = prof.mag;
      const chamber = hasChamber(p.w, prof) && mag > cap ? 1 : 0;
      const punch = this.ammoPunch;
      c.font = `${Math.round(26 + punch * 5)}px "Special Elite", monospace`;
      c.fillStyle = mag === 0 ? '#c04030' : mag <= Math.max(1, cap * 0.3) ? '#d09040' : punch > 0.5 ? '#fff6dc' : '#efe2c2';
      const reserve = prof.ammoRes ? roundsInStores(prof, G.stores) : '∞';
      const pouch = (this.pouch.get(`${p.w.uid}|${prof.ammoRes}`) ?? []).reduce((a, b) => a + b, 0);
      if (hard) {
        // Hardcore: you feel the weight of the gun, you don't count it
        const f = mag / Math.max(1, cap);
        c.font = '17px "Special Elite", monospace';
        c.fillText(mag === 0 ? 'empty' : f >= 0.85 ? 'full' : f >= 0.5 ? 'most' : f >= 0.25 ? 'half' : mag === 1 ? 'last' : 'low', W - 110, H - 30);
      } else c.fillText(chamber ? `${mag - 1}+1` : `${mag}`, W - 110 + punch * 2, H - 30 - punch * 2);
      c.font = '14px "Special Elite", monospace';
      c.fillStyle = '#a89c84';
      c.fillText(`/ ${reserve}${pouch ? ` +${pouch}` : ''}`, W - 30, H - 30);
      // what is in the gun tonight; the selector; the tube's shells
      c.font = '11px "Special Elite", monospace';
      c.fillStyle = prof.incendiary ? '#d08040' : '#8f846e';
      const modes = fireModes(p.w, this.prof(p.w, p.s));
      const mode = modes.length > 1 ? `  ${(this.modes.get(p.w.uid) ?? modes[0]).toUpperCase()}` : '';
      c.fillText((prof.ammoRes ? (AMMO_TYPES[prof.ammoRes]?.short ?? ammoLabel(prof.ammoRes)) : '') + mode, W - 30, H - 52);
      if (this.usesTube(p.w, prof) && !hard) {
        const tube = this.tubeOf(p.w, mag);
        const col: Partial<Record<Res, string>> = { shell: '#b04030', shell_slug: '#a0a0a0', shell_fire: '#d08030', shell_flech: '#6080c0' };
        tube.forEach((r, i) => { c.fillStyle = col[r] ?? '#c9b88a'; c.fillRect(W - 190 + i * 9, H - 60, 7, 10); });
      }
      if (p.w.cond < 0.4) { c.font = '14px "Special Elite", monospace'; c.fillStyle = '#c08040'; c.fillText('worn', W - 200, H - 30); }
      // reload / clearing bar
      if (this.playerReload > 0) {
        c.fillStyle = this.reloadKind === 'speed' ? '#d0a050' : '#d9c9a0';
        c.fillRect(W - 320, H - 24, 290 * Math.max(0, 1 - this.playerReload / Math.max(0.01, prof.reloadPerRound ? prof.reload : this.reloadTotal)), 3);
      }
      if (this.jam) {
        c.font = '13px "Special Elite", monospace';
        c.fillStyle = '#e0a060';
        c.fillText(this.jam.clearing > 0 ? 'clearing…' : this.jam.kind === 'barrel' ? `BARREL HOT — ${keyCap('night.reload')} swap` : this.jam.kind === 'double' ? `DOUBLE-FEED — ${keyCap('night.reload')}` : `JAMMED — tap ${keyCap('night.reload')}`, W - 30, H - 98);
      }
    }
    // nerve and rally, bottom left above the key line
    if (p) {
      const x = 20, y = 64;
      c.fillStyle = 'rgba(10,9,8,0.6)';
      c.fillRect(x, y - 12, 210, 22);
      const f = this.nerve / Math.max(1, this.nerveMax);
      if (this.nerveShown < 0) this.nerveShown = f;
      if (f < this.nerveShown - 0.03 && this.nerveFlash <= 0) this.nerveFlash = 0.3;
      this.nerveShown += (f - this.nerveShown) * 0.12;
      if (this.nerveShown > f) { c.fillStyle = `rgba(230,200,170,${0.3 + this.nerveFlash})`; c.fillRect(x + 54, y - 4, 100 * this.nerveShown, 6); }
      c.fillStyle = f < 0.25 ? '#c04030' : f < 0.5 ? '#c09040' : '#9db0a0';
      c.fillRect(x + 54, y - 4, 100 * Math.min(f, this.nerveShown + 0.01), 6);
      c.strokeStyle = 'rgba(200,190,160,0.3)';
      c.strokeRect(x + 54, y - 4, 100, 6);
      c.font = '10px "Special Elite", monospace';
      c.textAlign = 'left';
      c.fillStyle = '#a89c84';
      c.fillText(this.focusing ? 'FOCUS' : 'nerve', x + 6, y + 3);
      // the headshot streak as tally marks, then banked rallies
      c.fillStyle = '#d9c9a0';
      for (let i = 0; i < this.streak; i++) c.fillRect(x + 160 + i * 4, y - 6, 2, 10);
      if (this.rally > 0) { c.fillStyle = '#e0c070'; c.fillText(`RALLY ×${this.rally} ${keyCap('night.rally')}`, x + 160 + this.streak * 4 + 4, y + 3); }
      if (this.rallyT > 0) { c.fillStyle = '#e0c070'; c.fillText('RALLY', x + 160, y + 3); }
    }
    c.textAlign = 'left';
    c.font = '11px "Special Elite", monospace';
    c.fillStyle = '#a89c84';
    const multiAmmo = !!(p?.w && ammoTypesFor(p.w.def).length > 1);
    // the full key list early in the night (and when paused); afterwards one short line
    if (this.t < 30 || this.paused) {
      c.fillText(`${keyCap('night.reload')} reload (hold: speed) · ${keyCap('night.weapon')}/wheel gun${multiAmmo ? ` · ${keyCap('night.ammo')} ammo` : ''} · ${keyCap('night.selector')} selector · RMB focus · ${keyCap('night.duck')} duck · ${keyCap('night.firebomb')}/MMB firebomb ${G.stores.molotov}`, 20, H - 24);
      c.fillText(`[1-9]/[Tab] guard · ${keyCap('night.free')} free ${keyCap('night.hold')} hold ${keyCap('night.heads')} heads ${keyCap('night.wall')} wall (Shift: all) · ${keyCap('night.post')} post · ${keyCap('night.mark')} mark · ${keyCap('night.rally')} rally · ${keyCap('night.hurry')} hurry · ${keyCap('night.pause')} pause`, 20, H - 10);
    } else c.fillText(`firebombs ${G.stores.molotov} ${keyCap('night.firebomb')}   ·   ${keyCap('night.reload')} reload   ${keyCap('night.duck')} duck   RMB focus   ${keyCap('night.pause')} keys`, 20, H - 12);
    // messages
    c.textAlign = 'center';
    this.messages.forEach((m, i) => {
      c.font = '17px "Special Elite", monospace';
      c.fillStyle = `rgba(232,220,192,${Math.min(1, m.life)})`;
      c.fillText(m.text, W / 2, 110 + i * 26);
    });
    // crosshair: circle sized by real spread, at where the hand points
    if (p && p.w && !this.done) {
      const prof = this.eff(p);
      const mz = this.muzzle(p);
      const ap = this.aimPoint(p);
      const dist = Math.hypot(ap.x - mz.x, ap.y - mz.y);
      const sp = this.spreadNow(p, prof);
      const spreadA = prof.pellets > 1 ? sp.cone : sp.single;
      const r = Math.max(5, Math.tan(spreadA) * dist);
      const busy = this.playerReload > 0 || !!this.jam || this.ducking;
      c.strokeStyle = busy ? 'rgba(200,120,80,0.8)' : sp.aimed ? 'rgba(245,238,215,0.95)' : 'rgba(235,225,200,0.6)';
      c.lineWidth = sp.aimed ? 2 : 1.2;
      if (!sp.aimed && !busy) c.setLineDash([3, 3]);
      c.beginPath();
      c.arc(ap.x, ap.y, r, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(this.mouse.x - 4, this.mouse.y); c.lineTo(this.mouse.x + 4, this.mouse.y);
      c.moveTo(this.mouse.x, this.mouse.y - 4); c.lineTo(this.mouse.x, this.mouse.y + 4);
      c.stroke();
      // the climb tick: how far the muzzle has walked up
      if (this.climbY > 1) {
        c.strokeStyle = 'rgba(230,180,120,0.8)';
        c.beginPath(); c.moveTo(ap.x - 6, ap.y); c.lineTo(ap.x + 6, ap.y); c.moveTo(ap.x, ap.y); c.lineTo(ap.x, this.mouse.y); c.stroke();
      }
      // heat: an arc on the right of the ring
      const heat = this.heat.get(p.w.uid) ?? 0;
      if (usesHeat(prof) && heat > 1) {
        const hf = Math.min(1, heat / (heatLimit(prof) * (swapsBarrel(p.w) ? 1.7 : 1.3)));
        c.strokeStyle = hf > 0.6 ? 'rgba(240,110,50,0.9)' : 'rgba(230,170,90,0.7)';
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(ap.x, ap.y, r + 6, -0.9, -0.9 + 1.8 * hf); c.stroke();
      }
      // nerve: a thin arc on the left half
      c.strokeStyle = this.nerve < this.nerveMax * 0.25 ? 'rgba(200,70,50,0.8)' : 'rgba(160,180,170,0.5)';
      c.lineWidth = 2;
      c.beginPath(); c.arc(ap.x, ap.y, r + 6, Math.PI * 0.6, Math.PI * 0.6 + Math.PI * 0.8 * (this.nerve / Math.max(1, this.nerveMax))); c.stroke();
      // hit marker, coloured by zone
      if (this.hitMark && this.hitMark.t > 0 && hitMarkers()) {
        const col: Record<string, string> = { head: '#f4ecd8', leg: '#d0a050', arm: '#a8a8a0', plate: '#a8c8f0', body: '#d8c8b0', weak: '#f0c060', glob: '#c8c050' };
        const kill = !!this.hitMark.kill;
        c.strokeStyle = kill ? (this.hitMark.kind === 'head' ? '#ffe6c0' : '#e8a080') : col[this.hitMark.kind] ?? '#ddd';
        c.lineWidth = kill ? 3 : this.hitMark.kind === 'head' || this.hitMark.kind === 'weak' ? 2.5 : 1.8;
        const q = (kill ? 8 : 6) + ((kill ? 0.24 : 0.18) - this.hitMark.t) * (kill ? 30 : 20);
        c.beginPath();
        c.moveTo(this.mouse.x - q, this.mouse.y - q); c.lineTo(this.mouse.x - q / 2, this.mouse.y - q / 2);
        c.moveTo(this.mouse.x + q, this.mouse.y - q); c.lineTo(this.mouse.x + q / 2, this.mouse.y - q / 2);
        c.moveTo(this.mouse.x - q, this.mouse.y + q); c.lineTo(this.mouse.x - q / 2, this.mouse.y + q / 2);
        c.moveTo(this.mouse.x + q, this.mouse.y + q); c.lineTo(this.mouse.x + q / 2, this.mouse.y + q / 2);
        c.stroke();
        if (this.hitMark.kind === 'weak') { c.beginPath(); c.arc(this.mouse.x, this.mouse.y, q + 3, 0, 7); c.stroke(); }
      }
    }
    if (this.intro > 0) {
      c.fillStyle = `rgba(0,0,0,${Math.min(1, this.intro / 1.5) * 0.85})`;
      c.fillRect(0, 0, W, H);
      c.globalAlpha = Math.min(1, this.intro);
      c.fillStyle = '#e8dcc0';
      c.font = '34px "Special Elite", monospace';
      c.fillText(`Night ${G.day}`, W / 2, H / 2 - 20);
      c.font = '16px "Special Elite", monospace';
      c.fillStyle = '#b8ab90';
      c.fillText(this.plan.label, W / 2, H / 2 + 16);
      c.globalAlpha = 1;
    }
    if (this.done) {
      const a = Math.min(1, (3.2 - this.endT) / 3);
      c.fillStyle = this.res.fell ? `rgba(20,0,0,${a * 0.8})` : `rgba(180,175,165,${a * 0.5})`;
      c.fillRect(0, 0, W, H);
    }
    if (this.paused) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#e8dcc0';
      c.font = '30px "Special Elite", monospace';
      c.fillText('— paused —', W / 2, H / 2);
    }
    c.restore();
  }

  finish() {
    this.ended = true;
    this.destroy();
    const r = this.res;
    for (const h of this.hooks) h.onEnd?.(r); // night modules (before the ammunition tally)
    r.wallLost = Math.round(this.wallStart - G.fort.hp);
    // put ammo still in magazines back in the stores
    const held = new Set<string>();
    const pl = this.lastPlayer;
    for (const g of this.guards) {
      if (!g.w) continue;
      held.add(g.w.uid);
      const prof = this.prof(g.w);
      const m = g === pl ? this.playerMag.get(g.w.uid) ?? 0 : g.mag;
      if (prof.ammoRes) add(prof.ammoRes, m * prof.perShot);
    }
    // partial magazines in the pouch, and shells in a tube, go back in the stores as rounds
    for (const [key, mags] of this.pouch) {
      const res = key.split('|')[1] as Res;
      const w = G.weapons.find((x) => x.uid === key.split('|')[0]);
      const n = mags.reduce((a, b) => a + b, 0);
      if (w && res && n > 0) add(res, n * this.prof(w, undefined, res).perShot);
    }
    // dropped magazines: picked out of the snow at first light if the wall held (never on Hardcore)
    const drop = Object.entries(this.dropped) as [Res, number][];
    if (drop.length) {
      if (r.wallHeld && realism() !== 'hardcore') {
        for (const [k, v] of drop) add(k, v);
        r.lines.push(`Picked ${this.droppedMags} dropped magazine${this.droppedMags > 1 ? 's' : ''} back out of the snow under the wall.`);
      } else r.lines.push(`${this.droppedMags} magazine${this.droppedMags > 1 ? 's' : ''} dropped over the wall ${r.wallHeld ? 'are trampled into the mud' : 'went with the wall'}.`);
    }
    // dawn salvage: brass, nails and buckles picked off the road (balance.md §8.10)
    if (r.wallHeld && r.kills > 0) {
      const sc = Math.round(r.kills * 0.12);
      if (sc > 0) { add('scrap', sc); r.lines.push(`${sc} scrap in brass, nails and buckles picked off the road.`); }
    }
    // the pile: half of it is still against the wall tomorrow night unless somebody clears it
    const carry = this.piles.map((m) => Math.round(m * 0.5 * 10) / 10);
    if (carry.some((m) => m > 0.5)) {
      G.flags.pileCarry = JSON.stringify(carry);
      const tot = carry.reduce((a, b) => a + b, 0);
      if (tot > 6) r.lines.push(`The bodies against the wall are still there. Somebody will have to burn them, or they'll be a ramp tomorrow night.`);
    } else delete G.flags.pileCarry;
    // the leader: kept their head, or came apart
    const L = this.guards.find((g) => g.s.isLeader && !g.s.dead);
    if (L) {
      if (this.nerve >= this.nerveMax * 0.6) addThought(L.s, { id: 'kept_head', label: 'Kept my head out there', mood: 4, days: 2 }, 1);
      if (this.zeroes >= 3) addThought(L.s, { id: 'shaking_hands', label: "Hands won't stop shaking", mood: -5, days: 3 }, 1);
    }
    // posts and orders are remembered for tomorrow
    const posts: Record<string, Post> = {}, orders: Record<string, Order> = {};
    for (const g of this.guards) if (!g.s.isLeader && !g.s.dead) { posts[g.s.id] = g.post; orders[g.s.id] = g.order; }
    G.flags.posts = JSON.stringify(posts);
    G.flags.orders = JSON.stringify(orders);
    // guns the leader picked up and put down again
    for (const [uid, m] of this.playerMag) {
      const w = held.has(uid) ? undefined : G.weapons.find((x) => x.uid === uid);
      if (!w || m <= 0) continue;
      const prof = fireProfile(w);
      if (prof.ammoRes) add(prof.ammoRes, m * prof.perShot);
    }
    // suppressors and lashed-on gear wear out
    for (const [uid, n] of this.fired) {
      const w = G.weapons.find((x) => x.uid === uid);
      if (w) for (const l of wearMods(w, n)) r.lines.push(l);
    }
    // arrows and bolts off the road
    for (const [k, v] of Object.entries(this.recover) as [Res, number][]) {
      const n = Math.floor(v);
      if (n > 0) { add(k, n); r.lines.push(`Picked ${n} ${ammoLabel(k).toLowerCase()} back out of the road at first light.`); }
    }
    for (const k of Object.keys(this.ammoStart) as Res[]) {
      const used = (this.ammoStart[k] ?? 0) - (G.stores[k] ?? 0);
      if (used > 0.5) r.ammoUsed[k] = Math.round(used);
    }
    // tales from the night
    const fighters = this.guards.filter((g) => !g.s.dead);
    const top = [...fighters].sort((a, b) => b.kills - a.kills)[0];
    if (top && top.kills >= 12) {
      r.lines.push(`${first(top.s)} put down ${top.kills} of them.`);
      if (top.kills >= 25) {
        tale(top.s, `Put down ${top.kills} of the Turned on night ${G.day}.`);
        log('battle', `${displayName(top.s)} put down ${top.kills} of the Turned on night ${G.day}.`);
      }
    }
    if (this.raidersDown > 0) {
      r.lines.push(`${this.raidersDown} of the County men lie in the road. Somebody will come asking after them.`);
      log('battle', `Night ${G.day}: ${this.raidersDown} County raiders shot dead in the road off Ferry Road.`);
      G.flags.raidersKilled = ((G.flags.raidersKilled as number) ?? 0) + this.raidersDown;
    }
    for (const g of fighters) {
      if (g.downed && !g.safe && !g.fled) {
        tale(g.s, `Lay where ${g.s.sex === 'm' ? 'he' : 'she'} fell until the grey light, night ${G.day}.`);
        r.lines.push(`${first(g.s)} lay in the road till dawn, and lived.`);
      }
    }
    const alone = fighters.filter((g) => !g.fled && !g.downed);
    if (alone.length === 1 && this.guards.length > 2 && !r.fell) {
      tale(alone[0].s, `Held the line alone on night ${G.day}.`);
      log('tale', `${displayName(alone[0].s)} was the last one standing on the wall on night ${G.day}, and held it.`);
    }
    for (const g of fighters) {
      if (hasTrait(g.s, 'bloodlust') && g.kills > 8) addThought(g.s, { id: 'bloodlust', label: 'Good hunting last night', mood: 8, days: 2 }, 1);
      if (hasTrait(g.s, 'gentle') && g.kills > 5) addThought(g.s, { id: 'gentle_kills', label: 'So many faces I knew', mood: -6, days: 3 }, 1);
      if (!r.deaths.length && r.wallHeld) addThought(g.s, { id: 'held', label: 'We held the wall', mood: 5, days: 2 }, 1);
      for (const o of fighters) if (o !== g) changeOpinion(g.s, o.s, 2);
    }
    if (!r.wallHeld) for (const s of living()) addThought(s, { id: 'breach', label: 'They came over the wall', mood: -8, days: 3 }, 1);
    log('battle', `Night ${G.day}: ${r.kills} of the Turned put down${r.deaths.length ? `; lost ${r.deaths.join(', ')}` : ''}${r.wallHeld ? '' : '; the wall came down'}.`);
    this.onEnd(r);
  }
}
