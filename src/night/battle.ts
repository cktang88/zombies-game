import type { Survivor, WeaponItem, Res, NightPlan } from '../types';
import { G, R, log, add } from '../state';
import { ZOMBIES, type ZombieDef } from '../data/zombies';
import { WEAPONS, fireProfile, armorDamage, roundsInStores, ammoLabel, ammoTypesFor, shotSound, wearMods, blastDamage, AMMO_RES, AMMO_TYPES, BURN, FLARE_LIGHT, type FireProfile } from '../data/weapons';
import { img, flashImg, shadeImg } from '../assets';
import { sfx, wind } from '../audio';
import { reduceGore, shakeScale } from '../ui/settings';
import {
  living, canFight, aimFactor, first, displayName, wound, pain, killSurvivor, tale, addThought, hasTrait, changeOpinion, byId, isBitten, breakThresholds,
  moodBreakdown, their, them, grantTitle,
} from '../sim/survivors';
import { depthScale, bakeSprite, bakeComposite, bakeEdge, bakeLayer, bakeGround, fgStrip, shadowEllipse, type Look } from './render';

export const W = 1280, H = 720;
const WALL_X = 372; // front face of the barricade (near lane)
const ZS = 1.3; // global actor scale for the Turned
const SH = 158; // survivor display height
const DRAIN_X = 74; // storm drain grate behind the line
const SAFE_X = 70; // where the downed are dragged to
const DOWN_PAIN = 1.45; // pain at which a mauled guard goes down

// ---- depth (docs/research/04 §3) ----
/** Four walking lanes, feet y far → near; the gaps widen with nearness. */
export const LANES = [604, 628, 655, 685];
/** Two rows of defenders behind the wall. */
const DEF_LANES = [662, 688];
const GROUND_TOP = 596, GROUND_BOT = 704;
const LANE_TOL = 16; // a shot only finds bodies within this many px of its lane's feet
const WALL_KEY = 700; // the barricade's sort key: in front of every walking lane
/** 0 far … 1 near. */
const depthT = (y: number) => Math.max(0, Math.min(1, (y - LANES[0]) / (LANES[3] - LANES[0])));
const nearestLane = (y: number) => {
  let li = 0;
  for (let i = 1; i < LANES.length; i++) if (Math.abs(LANES[i] - y) < Math.abs(LANES[li] - y)) li = i;
  return li;
};
/** The wall seen slightly from the side: the far lane's face sits ~10px further right. */
const wallX = (lane: number) => WALL_X + (LANES[3] - LANES[lane]) * 0.12;
/** Per-lane atmosphere: far zombies dimmer, cooler, flatter and thinner-edged. */
const LOOK: Look[] = [
  { b: 0.7, s: 0.65, fog: 0.22, outline: 1, rim: 0.25 },
  { b: 0.8, s: 0.75, fog: 0.14, outline: 1, rim: 0.35 },
  { b: 0.9, s: 0.88, fog: 0.06, outline: 1.5, rim: 0.5 },
  { b: 1, s: 1, fog: 0, outline: 2, rim: 0.65 },
];
const CORPSE: Look = { b: 0.45, s: 0.6, fog: 0, outline: 0 };
const PAD = 3; // transparent margin of every battle bake, so the layers line up
const WARM = '#f0c98a', COOL = '#8fa6c8', DARK = '#0a0b10';

interface Zombie {
  id: number;
  def: ZombieDef;
  sprite: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: 'walk' | 'wall' | 'over' | 'maul' | 'dying' | 'cover' | 'flee';
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
}

interface Guard {
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
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'blood' | 'spark' | 'smoke' | 'fire' | 'spore' | 'shell' | 'chunk'; ground: number }
interface Tracer { x1: number; y1: number; x2: number; y2: number; life: number; w: number }
interface Fire { x: number; y: number; life: number; w: number }
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
    early: one(ice ? 0.86 : 0.8, fog ? 0.5 : 0.34, 0.5),
    late: one(ice ? 0.74 : 0.68, fog ? 0.55 : 0.36, 0.7),
  };
  bgCache.set(key, r);
  return r;
}
let groundBand: HTMLCanvasElement | null = null;
interface Light { x: number; y: number; r: number; life: number; max: number; color: string }
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
  keyUp = (e: KeyboardEvent) => { if (e.key === ' ') this.fast = false; };

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
    if (G.flags.dog) this.dog = { x: 172, y: 699, barkT: 0, cd: 0, name: typeof G.flags.dog === 'string' ? G.flags.dog : 'The dog' };
    for (let i = 0; i < Math.min(2, G.fort.turrets ?? 0); i++) this.turrets.push({ x: WALL_X - 20 - i * 46, y: 560 - i * 14, cd: 1, flash: 0, ang: 0 });
    this.queueBakes();
    const turning = G.flags.turningTonight as string | undefined;
    if (turning && byId(turning) && !byId(turning)!.dead) this.turnAt = this.duration * R.range(0.25, 0.6);
    this.keyHandler = (e) => this.onKey(e);
    this.bindInput();
    wind(true);
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
      this.guards.push({ s, w, x, y, sc: depthScale(y), cd: R.range(0, 1), mag: 0, reload: 0, kills: 0, flash: 0, fled: false, recoil: 0, homeX: x, face: 1, mauledT: 0, burstLeft: 0, burstT: 0, burstAng: 0, burstErr: 0, burstLane: LANES[2], burstX: 0, lastTgt: 0, dragT: 0, moodleC: '', moodleT: R.range(0, 1) });
    });
    // magazines are loaded from the stores, not conjured
    for (const g of this.guards) {
      if (!g.w) continue;
      const prof = this.prof(g.w);
      g.mag = this.loadFromStores(prof, prof.mag);
      this.playerMag.set(g.w.uid, g.mag);
    }
    // the frayed may come apart on the wall tonight
    for (const g of this.guards) {
      const th = breakThresholds(g.s);
      if (!g.s.isLeader && g.s.mood < th.minor && R.chance(g.s.mood < th.major ? 0.6 : 0.3)) g.panicAt = R.range(15, 60);
    }
    this.guards.sort((a, b) => a.y - b.y);
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
      if (e.button === 2) this.throwMolotov();
      else {
        this.mouse.down = true;
        this.tryFire(true);
      }
    };
    c.onmouseup = () => (this.mouse.down = false);
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
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'r' || e.key === 'R') this.startReload();
    else if (e.key === 'f' || e.key === 'F') this.throwMolotov();
    else if (e.key === 'Escape' || e.key === 'p') this.paused = !this.paused;
    else if (/^[1-9]$/.test(e.key)) this.switchWeapon(+e.key - 1);
    else if (e.key === 'q' || e.key === 'Q') this.cycleWeapon();
    else if (e.key === 't' || e.key === 'T') this.cycleAmmo();
    else if (e.key === ' ') { this.fast = true; e.preventDefault(); }
  }

  // weapons the leader may pick up: their own and any unassigned
  available(): WeaponItem[] {
    const p = this.player;
    const held = new Set(this.guards.filter((g) => g !== p && g.w).map((g) => g.w!.uid));
    return G.weapons.filter((w) => !held.has(w.uid));
  }

  switchWeapon(i: number) {
    const p = this.player;
    const list = this.available();
    if (!p || !list[i] || list[i] === p.w) return;
    p.w = list[i];
    p.s.weapon = p.w.uid;
    this.playerReload = 0;
    if (!this.playerMag.has(p.w.uid)) this.playerMag.set(p.w.uid, 0);
    sfx.reload();
  }

  // [T]: the next bullet type for the leader's gun; what's in the magazine goes back to the stores
  cycleAmmo() {
    const p = this.player;
    if (!p || !p.w) return;
    const types = ammoTypesFor(p.w.def);
    if (types.length < 2) return;
    const prof = this.prof(p.w);
    const cur = prof.ammoRes;
    const have = types.filter((t) => t === cur || (G.stores[t] ?? 0) > 0);
    const next = have[(have.indexOf(cur!) + 1) % have.length];
    if (!next || next === cur) { this.say(`No other ammunition for the ${WEAPONS[p.w.def].name.toLowerCase()}.`, 2); return; }
    const m = this.playerMag.get(p.w.uid) ?? 0;
    if (cur && m > 0) add(cur, m * prof.perShot);
    this.playerMag.set(p.w.uid, 0);
    p.burstLeft = 0;
    p.w.ammoType = next;
    this.playerReload = 0;
    this.say(`Loading ${ammoLabel(next).toLowerCase()}.`, 2);
    this.startReload();
  }

  cycleWeapon() {
    const p = this.player;
    const list = this.available();
    if (!p || !list.length) return;
    const i = p.w ? list.indexOf(p.w) : -1;
    this.switchWeapon((i + 1) % list.length);
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
      if (!this.paused) {
        const steps = this.fast && quiet && !this.done ? 4 : 1;
        for (let i = 0; i < steps; i++) this.update(this.slowmo > 0 ? dt * 0.35 : dt);
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
    const c = this.canvas;
    c.onmousemove = c.onmousedown = c.onmouseup = null;
    c.ontouchstart = c.ontouchmove = c.ontouchend = null;
    wind(false);
  }

  // ---------------- update ----------------
  update(dt: number) {
    this.t += dt;
    this.intro = Math.max(0, this.intro - dt);
    this.slowmo = Math.max(0, this.slowmo - dt);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.surge = Math.max(0, this.surge - dt);
    this.sharp = Math.max(0, this.sharp - dt);
    this.drainOpen = Math.max(0, this.drainOpen - dt);
    // spawns
    while (this.spawnIdx < this.plan.spawns.length && this.plan.spawns[this.spawnIdx].t <= this.t) {
      this.spawn(this.plan.spawns[this.spawnIdx].type, false, this.plan.spawns[this.spawnIdx].name);
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

  spawn(type: string, straggler = false, name?: string) {
    const def = ZOMBIES[type];
    if (!def) return;
    // the lane with the fewest bodies in the rightmost 300px; ties at random
    const count = [0, 0, 0, 0];
    for (const o of this.zombies) if (o.x > W - 300 && this.inLane(o)) count[o.lane]++;
    const fewest = Math.min(...count);
    const lane = R.pick([0, 1, 2, 3].filter((i) => count[i] === fewest));
    const yoff = R.range(-3, 3);
    const y = LANES[lane] + yoff;
    const jit = R.range(0.96, 1.04);
    const hpMul = def.ranged || def.boss ? 1 : 1 + Math.max(0, G.day - 8) * 0.03;
    const sprite = R.pick(def.sprites);
    const z: Zombie = {
      id: this.nextId++, def, sprite, x: W + R.range(30, 120), y, hp: def.hp * hpMul, maxHp: def.hp * hpMul, state: 'walk',
      phase: R.range(0, 10), flash: 0, slow: 0, burn: 0, dieT: 0, maulT: 0, lungeT: R.range(1, 3), screamT: R.range(3, 6), scale: depthScale(y) * jit, wallHit: 0, name,
      lane, ty: y, jit, variant: R.int(0, 2), laneCd: 1, blocked: 0,
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
    if (R.chance(0.15)) sfx.groan();
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
      lane: 3, ty: y, jit: 1, variant: 0, laneCd: 0, blocked: 0,
    });
    this.say(`${first(s).toUpperCase()} HAS TURNED. Behind the wall.`, 7);
    this.shake = 8;
    this.slowmo = 1.2;
    sfx.scream();
    log('death', `${displayName(s)} turned on the line in the middle of the night.`);
  }

  // ---------- shooting ----------
  updatePlayer(dt: number) {
    const p = this.player;
    if (p !== this.lastPlayer) {
      // whoever takes the line keeps the rounds actually in their gun
      const o = this.lastPlayer;
      if (o?.w) o.mag = this.playerMag.get(o.w.uid) ?? 0;
      if (p?.w) this.playerMag.set(p.w.uid, p.mag);
      if (o) o.burstLeft = 0;
      this.playerReload = 0;
    }
    this.lastPlayer = p;
    if (!p || !p.w) return;
    this.playerCd -= dt;
    const prof = this.prof(p.w);
    if (this.playerReload > 0) {
      this.playerReload -= dt;
      if (this.playerReload <= 0) this.finishReload(p);
    }
    p.face = this.mouse.x < p.x - 12 ? -1 : 1;
    if (p.burstLeft > 0) {
      p.burstT -= dt;
      if (p.burstT <= 0) this.playerRound(p, prof);
    } else if (this.mouse.down && prof.auto) this.tryFire(false);
    p.recoil = Math.max(0, p.recoil - dt * 8);
    p.flash = Math.max(0, p.flash - dt);
  }

  // fireProfile is pure; cache it per gun until its condition or load changes
  profCache = new Map<string, { cond: number; ammo: Res | undefined; p: FireProfile }>();
  prof(w: WeaponItem): FireProfile {
    const c = this.profCache.get(w.uid);
    if (c && Math.abs(c.cond - w.cond) < 0.02 && c.ammo === w.ammoType) return c.p;
    const p = fireProfile(w);
    this.profCache.set(w.uid, { cond: w.cond, ammo: w.ammoType, p });
    return p;
  }

  // take up to `want` rounds of this profile's ammunition out of the stores
  loadFromStores(prof: FireProfile, want: number) {
    if (!prof.ammoRes) return want;
    const got = Math.max(0, Math.min(want, roundsInStores(prof, G.stores)));
    add(prof.ammoRes, -got * prof.perShot);
    return got;
  }

  startReload() {
    const p = this.player;
    if (!p || !p.w || this.playerReload > 0) return;
    const prof = this.prof(p.w);
    const mag = this.playerMag.get(p.w.uid) ?? 0;
    if (mag >= prof.mag) return;
    if (roundsInStores(prof, G.stores) < 1) {
      this.say(`No ${ammoLabel(prof.ammoRes).toLowerCase()} left. Switch weapons [Q].`, 2);
      sfx.click();
      return;
    }
    const armHurt = p.s.wounds.some((w) => w.part === 'larm' || w.part === 'rarm') ? 1.35 : 1;
    const lost = p.s.scars.some((s) => s.label.includes('arm')) ? 1.6 : 1;
    // shell-by-shell guns reload one round at a time, and firing interrupts it
    this.playerReload = prof.reload * armHurt * lost * (!prof.reloadPerRound && p.w.cond < 0.4 ? 1.3 : 1);
    sfx.reload();
  }

  finishReload(g: Guard) {
    if (!g.w) return;
    const prof = this.prof(g.w);
    const mag = this.playerMag.get(g.w.uid) ?? 0;
    const got = this.loadFromStores(prof, prof.reloadPerRound ? 1 : prof.mag - mag);
    this.playerMag.set(g.w.uid, mag + got);
    if (prof.reloadPerRound) {
      sfx.shell();
      if (mag + got < prof.mag && got > 0) this.startReload();
    } else sfx.reload();
  }

  tryFire(click: boolean) {
    const p = this.player;
    if (!p || !p.w || this.done || this.intro > 3.2 || p.burstLeft > 0) return;
    const prof = this.prof(p.w);
    if (!click && !prof.auto) return;
    if (this.playerCd > 0) return;
    if (this.playerReload > 0) {
      // firing interrupts a shell-by-shell reload
      if (prof.reloadPerRound && (this.playerMag.get(p.w.uid) ?? 0) > 0) this.playerReload = 0;
      else return;
    }
    const mag = this.playerMag.get(p.w.uid) ?? 0;
    if (mag <= 0) {
      sfx.click();
      this.startReload();
      this.playerCd = 0.25;
      return;
    }
    // worn and improvised guns jam
    if (R.chance(prof.jam)) {
      this.say(`${p.w.name ?? WEAPONS[p.w.def].name} jammed.`, 1.5);
      sfx.click();
      this.playerCd = prof.jamClear;
      return;
    }
    this.playerCd = 1 / prof.rof;
    p.burstLeft = Math.min(prof.burst, mag);
    p.burstT = 0;
    this.playerRound(p, prof);
  }

  // one round of the leader's trigger pull (bursts call this again, burstGap apart)
  playerRound(p: Guard, prof: FireProfile) {
    if (!p.w) { p.burstLeft = 0; return; }
    do {
      const mag = this.playerMag.get(p.w.uid) ?? 0;
      if (mag <= 0) { p.burstLeft = 0; break; }
      this.playerMag.set(p.w.uid, mag - 1);
      p.burstLeft--;
      const aim = aimFactor(p.s);
      const mz = this.muzzle(p);
      const base = Math.atan2(this.mouse.y - mz.y, this.mouse.x - mz.x);
      const spreadA = prof.spread * (1.75 - aim) + this.bloom;
      // Last Stand: the crosshair is the shot. It goes into the lane under it, and a body
      // standing in front in another lane does not take it.
      const laneY = this.targetLane();
      const li = nearestLane(laneY);
      if (prof.explosive && prof.arc) {
        // lobbed over the front rank: lands at the crosshair's x on the target lane
        const tx = Math.max(WALL_X + 30, this.mouse.x + (R.next() + R.next() - 1) * spreadA * Math.abs(this.mouse.x - mz.x) * 1.5);
        this.lobs.push({ x0: mz.x, y0: mz.y, x1: tx, y1: laneY, t: 0, dur: 0.6, p: prof, g: p });
      } else if (prof.explosive) {
        const hit = this.castShot(p, mz.x, mz.y, base + (R.next() + R.next() - 1) * spreadA, prof.dmg, 0, prof.knock, false, true, prof, laneY);
        this.blast(hit.x, laneY, prof.explosive, prof.knock, p);
      } else for (let i = 0; i < prof.pellets; i++) {
        const a = base + (R.next() + R.next() - 1) * (prof.pellets > 1 ? prof.spread : spreadA);
        // buckshot sprays a little through depth: 25% per pellet into an adjacent lane
        let ly = laneY;
        if (prof.pellets > 1 && R.chance(0.25)) { const adj = LANES[li + (R.chance(0.5) ? 1 : -1)]; if (adj !== undefined) ly = adj; }
        this.castShot(p, mz.x, mz.y, a, prof.dmg, prof.pierce, prof.knock, prof.pellets > 1, true, prof, ly);
      }
      // the leader fires from the wall: a bipod braces
      this.bloom = Math.min(0.12, this.bloom + (prof.spread * 0.35 + (prof.auto ? 0.004 : 0.012)) * prof.bloomMul * prof.braceBloomMul);
      this.roundFired(p, prof, mz, false);
      this.shake = Math.max(this.shake, (prof.knock / 6) * prof.recoilMul);
      G.stats.shots++;
      p.w.cond = Math.max(0.05, p.w.cond - 0.0008);
    } while (p.burstLeft > 0 && prof.burstGap <= 0);
    p.burstT = prof.burstGap;
    if ((this.playerMag.get(p.w.uid) ?? 0) === 0 && p.burstLeft <= 0) this.startReload();
  }

  // what every round does besides the bullet: flash, noise, brass, smoke, arrows to pick up later
  roundFired(g: Guard, prof: FireProfile, mz: { x: number; y: number }, far: boolean) {
    g.recoil = Math.min(1, prof.recoilMul);
    g.flash = 0.06;
    this.noise += prof.noise * (far ? 0.7 : 1);
    this.fired.set(g.w!.uid, (this.fired.get(g.w!.uid) ?? 0) + 1);
    if (prof.recoverable > 0 && prof.ammoRes) this.recover[prof.ammoRes] = (this.recover[prof.ammoRes] ?? 0) + prof.recoverable * prof.perShot;
    const quiet = prof.noise < 0.5;
    if (!quiet) this.lights.push({ x: mz.x + 10 * g.face, y: mz.y, r: far ? 180 : 220, life: 0.06, max: 0.06, color: '255,200,120' });
    const def = WEAPONS[g.w!.def];
    sfx.shot(quiet ? 'nailer' : shotSound(def.id), far);
    if (prof.smoke) for (let i = 0; i < 4; i++) this.particles.push({ x: mz.x + g.face * R.range(0, 30), y: mz.y + R.range(-6, 6), vx: g.face * R.range(10, 50), vy: R.range(-20, 5), life: 2.2, max: 2.2, size: R.range(8, 14), color: '#bbb', kind: 'smoke', ground: 0 });
    const brass = !quiet && prof.recoverable <= 0 && def.caliber !== 'bolt';
    if (!far && brass) this.particles.push({ x: mz.x - 30 * g.face, y: mz.y + 4, vx: -g.face * R.range(20, 60), vy: R.range(-160, -90), life: 1.2, max: 1.2, size: 2.4, color: '#c9a24a', kind: 'shell', ground: g.y - 4 });
  }

  muzzle(g: Guard) {
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
    return (z.state === 'over' || z.state === 'maul' ? WALL_KEY + 2 : z.y) + z.id * 1e-5;
  }

  // Ray against the zombies in one lane (±LANE_TOL); returns whether anything was hit, and where it stopped.
  castShot(g: Guard, ox: number, oy: number, ang: number, dmg: number, pierce: number, knock: number, pellet: boolean, isPlayer: boolean, fx: FireProfile | undefined, laneY: number) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hits: { z: Zombie; t: number; head: boolean }[] = [];
    for (const z of this.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0.25)) continue;
      if (Math.abs(z.y - laneY) > LANE_TOL) continue;
      // the guards' strays rarely find a man lying low in the dark behind the crowd
      if (!isPlayer && z.def.ranged && !((z.seen ?? 0) > 0) && R.chance(0.85)) continue;
      const hb = this.hitbox(z);
      // head circle
      const hx = hb.hx - ox, hy = hb.hy - oy;
      const tc = hx * dx + hy * dy;
      const d2 = hx * hx + hy * hy - tc * tc;
      if (tc > 0 && d2 < hb.hr * hb.hr) {
        hits.push({ z, t: tc - Math.sqrt(hb.hr * hb.hr - d2), head: true });
        continue;
      }
      // body AABB slab test
      const t1 = (hb.x1 - ox) / dx, t2 = (hb.x2 - ox) / dx;
      const t3 = (hb.y1 - oy) / dy, t4 = (hb.y2 - oy) / dy;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
      if (tmax >= 0 && tmin <= tmax) hits.push({ z, t: Math.max(0, tmin), head: false });
    }
    hits.sort((a, b) => a.t - b.t);
    let endT = 1600;
    let d = dmg;
    let n = 0;
    for (const h of hits) {
      // sawed-off barrels and the like: half damage past their range
      const far = fx && h.t > fx.range ? 0.5 : 1;
      this.damage(h.z, d * far, h.head, knock * far, g, pellet, ox + dx * h.t, oy + dy * h.t, isPlayer, fx);
      if (isPlayer) G.stats.hits++;
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
        for (let i = 0; i < 3; i++) this.particles.push({ x: ox + dx * tg, y: oy + dy * tg, vx: R.range(-40, 40), vy: R.range(-80, -20), life: 0.4, max: 0.4, size: 2, color: '#6b5d4a', kind: 'spark', ground: 0 });
      }
    }
    this.tracers.push({ x1: ox + dx * 20, y1: oy + dy * 20, x2: ox + dx * endT, y2: oy + dy * endT, life: pellet ? 0.05 : 0.07, w: pellet ? 1 : 1.6 });
    // a flare lights the road where it comes down
    if (fx?.flare && !pellet) this.lights.push({ x: ox + dx * endT, y: Math.min(laneY, oy + dy * endT), r: FLARE_LIGHT.r, life: FLARE_LIGHT.time, max: FLARE_LIGHT.time, color: '255,90,70' });
    return { hit: n > 0, x: ox + dx * Math.min(endT, 1400), y: oy + dy * Math.min(endT, 1400) };
  }

  hitbox(z: Zombie) {
    const h = z.def.height * z.scale * ZS;
    const w = z.def.width * z.scale * ZS;
    // raiders crouch behind a heap of junk; the lower body is behind it, and ducking drops the rest
    const cover = z.def.ranged && z.state === 'cover';
    const top = z.y - h + (cover && z.ducked ? h * 0.32 : 0) + (z.emerge ? h * Math.min(1, z.emerge) : 0);
    const headH = h * z.def.head;
    const crawl = z.def.crawl;
    const f = z.flip ? -1 : 1;
    return {
      x1: z.x - w / 2, x2: z.x + w / 2, y1: top + (z.headless ? 0 : headH * 0.8), y2: cover ? z.y - h * 0.42 : z.y,
      hx: z.x - f * w * (crawl ? 0.36 : 0.12), hy: crawl ? z.y - h * 0.62 : top + headH * 0.5, hr: z.headless ? 0 : (crawl ? h * 0.3 : headH * 0.62),
    };
  }

  damage(z: Zombie, dmg: number, head: boolean, knock: number, g: Guard | null, pellet: boolean, px: number, py: number, isPlayer: boolean, fx?: FireProfile) {
    let d = dmg;
    if (head) d *= pellet ? 2 : 3;
    else if (z.def.armor) d = armorDamage(d, z.def.armor, fx?.armorPen ?? 0);
    if (fx?.incendiary) z.burn = Math.max(z.burn, BURN.time);
    z.hp -= d;
    z.flash = 0.08;
    const heavy = z.def.id === 'ferryman' || z.def.boss || z.state === 'cover';
    if (!heavy) z.x += (z.flip ? -1 : 1) * knock * (pellet ? 0.25 : 1) * (head ? 1.4 : 1) * (z.state === 'wall' ? 0.5 : 1);
    z.x = Math.min(z.x, W + 150);
    if (z.state === 'wall' && knock > 15 && !heavy) z.state = 'walk';
    // blood (fewer, smaller and darker with Reduce gore)
    this.blood(px, py, head ? 10 : 4, head ? 4.5 : 3, z.y);
    if (z.hp <= 0) {
      if (head && !z.headless && R.chance(isPlayer ? 0.8 : 0.5) && !z.def.crawl && !z.def.ranged && !reduceGore()) {
        z.headless = true;
        sfx.headpop();
        for (let i = 0; i < 14; i++) this.particles.push({ x: px, y: py, vx: R.range(-60, 260), vy: R.range(-260, -40), life: 2, max: 2, size: R.range(2, 5), color: R.pick(['#4a0d0b', '#2a1a14', '#5e1410', '#8b7d6b']), kind: R.chance(0.3) ? 'chunk' : 'blood', ground: z.y + R.range(-6, 6) });
        if (isPlayer) this.text(z.x, z.y - z.def.height, 'HEADSHOT', '#d9c9a0', 13);
      }
      if (head) { this.res.headshots++; if (isPlayer) G.stats.headshots++; }
      this.kill(z, g);
    } else {
      sfx.hit();
    }
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
    z.state = 'dying';
    z.dieT = 0;
    if (z.def.ranged) this.raidersDown++;
    else {
      this.res.kills++;
      G.stats.kills++;
    }
    if (z.def.boss) this.bossDown(z, g);
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
      sfx.burst();
      for (let i = 0; i < 30; i++) this.particles.push({ x: z.x, y: z.y - 60, vx: R.range(-120, 120), vy: R.range(-140, 20), life: 2.5, max: 2.5, size: R.range(8, 22), color: '#a8862f', kind: 'spore', ground: 0 });
      if (z.x - WALL_X < 120) {
        G.fort.hp = Math.max(0, G.fort.hp - 45);
        this.say('A Pulper burst against the wall. The planks are rotting through.', 3);
      }
      for (const o of this.zombies) if (o !== z && Math.abs(o.x - z.x) < 110 && o.state !== 'dying') { o.hp -= 30; o.flash = 0.1; if (o.hp <= 0) this.kill(o, null); }
    }
  }

  bossDown(z: Zombie, g: Guard | null) {
    sfx.boom();
    this.slowmo = 2;
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
    if (g.s.dead || g.fled || g.downed || g.dragging || g.x !== g.homeX || g === this.player || !g.w) return;
    // cowards and the fragile may leave the wall when it's breaking
    if (!this.res.wallHeld && (hasTrait(g.s, 'coward') || g.s.mood < 20) && R.chance(dt * 0.3)) {
      g.fled = true;
      this.say(`${first(g.s)} broke and ran for the house.`, 3);
      log('break', `${displayName(g.s)} fled the wall on night ${G.day}.`);
      for (const o of this.guards) if (o !== g && !o.s.dead) changeOpinion(o.s, g.s, -12);
      return;
    }
    if (g.panicAt !== undefined && this.t > g.panicAt && !g.mode) {
      g.mode = 'panic';
      this.say(`${first(g.s)} is panicking — firing at shadows.`, 3);
      log('break', `${displayName(g.s)} panicked on the wall on night ${G.day}, burning through ammunition.`);
    }
    const prof = this.prof(g.w);
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
    const fog = this.plan.special === 'fog';
    // guards only engage what they can make out in the dark
    const range = Math.max((fog ? 640 : 820) + Math.min(3, G.fort.lights) * 130 + (hasTrait(g.s, 'nightowl') ? 120 : 0), g.x + SH * 0.45 + prof.light);
    // the road ahead, anything already behind the line, and any rifleman who just showed himself
    let tgt: Zombie | undefined;
    let bp = 1e9;
    for (const z of this.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0)) continue;
      if (z.ducked && z.state === 'cover') continue; // nothing to aim at but junk
      const inside = z.state === 'over' || z.state === 'maul';
      const ahead = z.x > g.x + 30 && (z.x < range || (z.seen ?? 0) > 0);
      if (!ahead && !(inside && Math.abs(z.x - g.x) < 280)) continue;
      const pri = (z.def.scream ? -400 : 0) + (inside ? -800 : 0) + (z.def.ranged ? -120 : 0) + Math.abs(z.x - g.x) + (z.def.burst && z.x < WALL_X + 140 ? 300 : 0);
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
        // out of ammunition: hatchets and fence pickets at the wall
        const reach = this.zombies.find((z) => z.state !== 'dying' && (z.state === 'wall' && g.x > 200 || ((z.state === 'over' || z.state === 'maul') && Math.abs(z.x - g.x) < 70)));
        if (reach) {
          reach.hp -= prof.melee > 0 ? prof.melee : 14 + g.s.skills.building;
          reach.flash = 0.1;
          sfx.thud();
          g.recoil = 1;
          if (reach.hp <= 0) this.kill(reach, g);
          g.cd = 1.1;
        } else {
          g.cd = 2;
          if (R.chance(0.3)) this.text(g.x + 20, g.y - 150, 'out of ammo', '#c88', 10);
        }
        return;
      }
      g.reload = (prof.reloadPerRound ? prof.reload * prof.mag * 0.75 : prof.reload) * 1.15;
      return;
    }
    if (R.chance(prof.jam)) { g.cd = prof.jamClear * 1.3; this.text(g.x + 20, g.y - 150, 'jammed', '#c8a070', 10); return; }
    let aim = aimFactor(g.s);
    if (g.mode === 'panic') aim *= 0.4;
    if (g.mode === 'rage') aim = Math.min(1.3, aim + 0.3);
    if (this.sharp > 0) aim = Math.min(1.3, aim + 0.15);
    const lightBonus = Math.min(0.2, G.fort.lights * 0.07);
    const mz = this.muzzle(g);
    const hb = this.hitbox(tgt);
    const dist = Math.hypot(hb.hx - mz.x, hb.hy - mz.y);
    // aim for the head with probability scaled by skill
    const goHead = R.chance((0.2 + aim * 0.25) * (tgt.def.ranged ? 0.5 : 1));
    const ty = goHead ? hb.hy : (hb.y1 + hb.y2) / 2;
    const tx = goHead ? hb.hx : tgt.x;
    const err = (prof.spread * 1.2 + (1.15 - aim - lightBonus) * 0.07 + (fog ? 0.04 : 0)) * (1 + dist / 900) * (tgt.def.ranged ? 1.8 : 1) * (0.5 + 0.5 * prof.braceBloomMul);
    const base = Math.atan2(ty - mz.y, tx - mz.x);
    g.cd = (1 / prof.rof) * (prof.auto ? 1.3 : 1.6) * R.range(0.9, 1.25) * (g.mode === 'panic' ? 0.55 : g.mode === 'rage' ? 0.7 : 1);
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
        const a = base + R.gauss(0, prof.pellets > 1 ? prof.spread * 0.7 : err * 0.6);
        let ly = g.burstLane;
        if (prof.pellets > 1 && R.chance(0.25)) { const adj = LANES[li + (R.chance(0.5) ? 1 : -1)]; if (adj !== undefined) ly = adj; }
        this.castShot(g, mz.x, mz.y, a, prof.dmg, prof.pierce, prof.knock, prof.pellets > 1, false, prof, ly);
      }
      this.roundFired(g, prof, mz, true);
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
    sfx.shot('nailer', true);
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
    // ease toward the lane's feet (lane hops, or onto a defenders' row behind the wall)
    if (z.y !== z.ty) {
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
    // traps
    if (this.traps > 0 && z.state === 'walk' && z.x < this.trapX && z.x > this.trapX - 40) {
      this.traps--;
      G.fort.traps = Math.max(0, G.fort.traps - 1);
      this.blast(this.trapX, z.y, { radius: 150, dmg: 160 }, 40, null);
    }
    // crier
    if (z.def.scream && z.x < W - 20) {
      z.screamT -= dt;
      if (z.screamT <= 0) {
        z.screamT = R.range(6, 9);
        sfx.scream();
        this.text(z.x, z.y - 140, '— keening —', '#c9a95a', 12);
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
    if (z.def.lunge) {
      z.lungeT -= dt;
      if (z.lungeT < 0) {
        speed *= 0.15;
        if (z.lungeT < -0.8) z.lungeT = R.range(1.2, 2.6);
      }
    }
    if (z.state === 'cover') return this.updateRaider(z, dt);
    if (z.state === 'flee') {
      z.x += speed * 1.3 * dt;
      z.flip = true;
      return;
    }
    if (z.state === 'walk' || z.state === 'wall') {
      this.walkLane(z, speed, cold, dt);
      if (this.inLane(z)) this.laneLast[z.lane] = z;
      return;
    }
    if (z.state === 'over') {
      if (z.emerge !== undefined && z.emerge > 0) { z.emerge -= dt; return; }
      // over the rubble (or up out of the drain) toward the nearest defender
      let tgt: Guard | undefined;
      let best = 1e9;
      for (const g of this.guards) {
        if (g.s.dead || g.fled || g.safe) continue;
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
        z.maulT = R.range(0.9, 1.6) * (z.def.id === 'ferryman' ? 0.7 : 1);
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
      const dmg = z.def.dps * dt * cold;
      G.fort.hp = Math.max(0, G.fort.hp - dmg);
      z.wallHit -= dt;
      if (z.wallHit <= 0) {
        z.wallHit = R.range(0.8, 1.4);
        if (atFace) {
          sfx.wallHit();
          for (let i = 0; i < 2; i++) this.particles.push({ x: wallX(z.lane) - 5, y: z.y - R.range(30, 100), vx: R.range(-80, -10), vy: R.range(-100, 0), life: 0.6, max: 0.6, size: 2, color: '#7a6448', kind: 'spark', ground: 0 });
        }
      }
      if (G.fort.spikes > 0 && atFace) {
        z.hp -= G.fort.spikes * 3.5 * dt;
        if (z.hp <= 0) { this.kill(z, null); return; }
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
      // never closer than the gap; a body knocked back into the one behind just stops it
      if (nx < lim) { nx = Math.min(z.x, lim); held = true; }
    }
    z.x = nx;
    if (z.x <= face) { z.x = face; z.state = standing ? 'wall' : 'over'; if (z.state === 'wall') this.laneQ[z.lane]++; return; }
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
    sfx.shot(z.sprite === 'z_raider2' ? 'pump' : 'hunting', true);
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
    this.shake = 5;
    const bite = R.chance(z.def.id === 'ferryman' ? 0.2 : 0.38);
    const w = wound(s, bite ? 'bite' : R.pick(['laceration', 'scratch', 'bruise', z.def.id === 'ferryman' ? 'fracture' : 'laceration']), R.range(0.2, 0.5) * (z.def.id === 'ferryman' ? 1.6 : 1));
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
        if (hasTrait(o.s, 'coward') || o.mode === 'panic') continue;
        const d = Math.abs(o.x - g.x);
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
    sfx.boom();
    this.shake = Math.max(this.shake, 16);
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
      z.x = Math.min(W + 150, z.x + push);
      if (z.state === 'wall' && Math.abs(push) > 15) z.state = 'walk';
      if (z.hp <= 0) this.kill(z, g);
    }
    this.noise += 10;
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
      if (p.kind === 'smoke' || p.kind === 'spore') {
        p.vx *= 0.96; p.vy *= 0.96; p.vy -= 10 * dt;
        if (p.kind === 'spore') p.vy += 18 * dt;
      } else if (p.kind === 'fire') {
        p.vy -= 20 * dt;
      } else {
        p.vy += 900 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if ((p.kind === 'blood' || p.kind === 'chunk' || p.kind === 'shell') && p.ground && p.y >= p.ground && p.vy > 0) {
        if (p.kind === 'shell') {
          p.vy *= -0.3; p.vx *= 0.5; p.y = p.ground;
          if (Math.abs(p.vy) < 20) { p.life = 0; this.gctx.fillStyle = '#8a7340'; this.gctx.fillRect(p.x, p.y, 3, 1.5); }
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
    if (this.traps > 0) {
      c.fillStyle = '#2b2a25';
      c.beginPath(); c.ellipse(this.trapX, LANES[2], 16, 4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#a33';
      c.fillRect(this.trapX - 2, LANES[2] - 5, 4, 4);
    }
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
    list.push({ y: 650, f: () => this.drawPoles(c) });
    for (const cv of this.covers) list.push({ y: cv.y, f: () => this.drawCover(c, cv) });
    if (this.dog) list.push({ y: this.dog.y, f: () => this.drawDog(c) });
    if (G.fort.wire > 0) {
      for (let i = 0; i < LANES.length; i++) list.push({ y: LANES[i] + 0.9, f: () => this.drawWireLane(c, i) });
      list.push({ y: GROUND_BOT - 1, f: () => this.drawWirePosts(c, true) });
    }
    this.turrets.forEach((tu, i) => list.push({ y: WALL_KEY + 1 - i * 0.1, f: () => this.drawTurret(c, tu) }));
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
    c.strokeStyle = `rgba(${90 + lane * 12},${85 + lane * 12},${80 + lane * 12},0.9)`;
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
      for (let i = 0; i < Math.min(5, G.fort.spikes) * 3; i++) {
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
      c.fillStyle = '#1a1a1a';
      c.fillRect(x, 380, 4, 270);
      c.fillStyle = '#e8e2c0';
      c.fillRect(x - 6, 376, 18, 10);
    }
  }

  drawTurret(c: CanvasRenderingContext2D, tu: { x: number; y: number; cd: number; flash: number; ang: number }) {
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
    if (im && body) {
      const k = h / bh;
      const w = (body.cv.width - PAD * 2) * k;
      const lean = g.dragging && g.dragT < 3 ? 0.18 : 0; // hauling backward
      c.save();
      c.translate(Math.round(g.x - g.face * g.recoil * 3), Math.round(g.y + bob));
      if (g.face < 0) c.scale(-1, 1);
      if (lean) c.rotate(-lean);
      c.drawImage(body.cv, -w / 2 - PAD * k, -h - PAD * k, body.cv.width * k, body.cv.height * k);
      c.restore();
    }
    // muzzle flash
    if (g.flash > 0) {
      const mz = this.muzzle(g);
      c.fillStyle = 'rgba(255,230,160,0.95)';
      c.beginPath();
      c.moveTo(mz.x, mz.y - 5);
      c.lineTo(mz.x + 34 * g.face, mz.y);
      c.lineTo(mz.x, mz.y + 5);
      c.fill();
    }
    // label; a far-row label steps up out of the way of a near-row neighbour's
    let top = g.y - h;
    if (g.y < DEF_LANES[1] && this.guards.some((o) => o !== g && o.y >= DEF_LANES[1] && !o.s.dead && !o.fled && !o.downed && Math.abs(o.x - g.x) < 50)) top -= 14;
    c.font = '11px "Special Elite", monospace';
    c.textAlign = 'center';
    c.fillStyle = isP ? '#f0d890' : '#cfc6b0';
    c.fillText(first(g.s) + (isP ? ' ◆' : ''), g.x, top - 14);
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
    if (this.plan.special !== 'fog') return 1;
    const farFade = Math.max(0.15, 1 - Math.max(0, z.x - 620) / 400);
    return Math.max(0.15, 1 - (1 - farFade) * (1.4 - 0.4 * depthT(z.y)));
  }

  drawZombie(c: CanvasRenderingContext2D, z: Zombie, env: ReturnType<Battle['lightEnv']>) {
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
    let rot = 0, dy = 0;
    const gait = z.def.speed > 60 ? 9 : 3.2;
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
    c.translate(Math.round(z.x), Math.round(z.y + dy));
    if (flip) c.scale(-1, 1);
    c.rotate(rot);
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
    c.restore();
    if (z.name && z.state !== 'dying') {
      c.font = '12px "Special Elite", monospace';
      c.fillStyle = '#c9a95a';
      c.textAlign = 'center';
      c.fillText(z.name, z.x, z.y - h - 8);
    }
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
    const base = Math.max(0.12, 0.46 - G.fort.lights * 0.1 + (this.plan.special === 'crossing' ? -0.08 : 0));
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
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = v;
    c.fillRect(-W, -H, W * 2, H * 2);
    c.restore();
  }

  drawHud(c: CanvasRenderingContext2D) {
    c.save();
    c.textAlign = 'left';
    // wall bar, segmented
    const frac = Math.max(0, G.fort.hp / G.fort.maxHp);
    c.fillStyle = 'rgba(10,9,8,0.7)';
    c.fillRect(20, 18, 300, 30);
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const on = frac * segs > i;
      c.fillStyle = on ? (frac > 0.5 ? '#8f7a55' : frac > 0.25 ? '#b0702c' : '#a8322a') : 'rgba(80,70,60,0.3)';
      c.fillRect(26 + i * 24, 30, 20, 12);
    }
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
    const left = this.plan.spawns.length - this.spawnIdx + this.zombies.filter((z) => z.state !== 'dying').length;
    c.fillText(`night ${G.day}   ·   ${this.res.kills} down   ·   ${left} still out there`, W / 2, 54);
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
    // weapon
    const p = this.player;
    if (p && p.w) {
      const def = WEAPONS[p.w.def];
      const prof = this.prof(p.w);
      const icon = img(def.icon);
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
      c.font = '26px "Special Elite", monospace';
      c.fillStyle = mag === 0 ? '#c04030' : '#efe2c2';
      const reserve = prof.ammoRes ? roundsInStores(prof, G.stores) : '∞';
      c.fillText(`${mag}`, W - 110, H - 30);
      c.font = '14px "Special Elite", monospace';
      c.fillStyle = '#a89c84';
      c.fillText(`/ ${reserve}`, W - 30, H - 30);
      // what is in the gun tonight
      c.font = '11px "Special Elite", monospace';
      c.fillStyle = prof.incendiary ? '#d08040' : '#8f846e';
      c.fillText(prof.ammoRes ? (AMMO_TYPES[prof.ammoRes]?.short ?? ammoLabel(prof.ammoRes)) : '', W - 30, H - 52);
      if (p.w.cond < 0.4) { c.font = '14px "Special Elite", monospace'; c.fillStyle = '#c08040'; c.fillText('worn', W - 200, H - 30); }
      // reload bar
      if (this.playerReload > 0) {
        c.fillStyle = '#d9c9a0';
        c.fillRect(W - 320, H - 24, 290 * Math.max(0, 1 - this.playerReload / Math.max(0.01, prof.reload)), 3);
      }
    }
    c.textAlign = 'left';
    c.font = '12px "Special Elite", monospace';
    c.fillStyle = '#a89c84';
    const multiAmmo = !!(p?.w && ammoTypesFor(p.w.def).length > 1);
    c.fillText(`firebombs ${G.stores.molotov} [F]   ·   [R] reload   [Q]/[1-9] weapon${multiAmmo ? '   [T] ammo' : ''}   [hold Space] hurry   [P] pause`, 20, H - 22);
    // messages
    c.textAlign = 'center';
    this.messages.forEach((m, i) => {
      c.font = '17px "Special Elite", monospace';
      c.fillStyle = `rgba(232,220,192,${Math.min(1, m.life)})`;
      c.fillText(m.text, W / 2, 110 + i * 26);
    });
    // crosshair: circle sized by real spread
    if (p && p.w && !this.done) {
      const prof = this.prof(p.w);
      const mz = this.muzzle(p);
      const dist = Math.hypot(this.mouse.x - mz.x, this.mouse.y - mz.y);
      const spreadA = (prof.pellets > 1 ? prof.spread : prof.spread * (1.75 - aimFactor(p.s))) + this.bloom;
      const r = Math.max(5, Math.tan(spreadA) * dist);
      c.strokeStyle = this.playerReload > 0 ? 'rgba(200,120,80,0.8)' : 'rgba(235,225,200,0.85)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(this.mouse.x, this.mouse.y, r, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(this.mouse.x - 4, this.mouse.y); c.lineTo(this.mouse.x + 4, this.mouse.y);
      c.moveTo(this.mouse.x, this.mouse.y - 4); c.lineTo(this.mouse.x, this.mouse.y + 4);
      c.stroke();
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
