import type { Survivor, WeaponItem, Res, NightPlan } from '../types';
import { G, R, log, add } from '../state';
import { ZOMBIES, type ZombieDef } from '../data/zombies';
import { WEAPONS } from '../data/weapons';
import { img, flashImg, shadeImg } from '../assets';
import { sfx, wind } from '../audio';
import {
  living, canFight, aimFactor, first, displayName, wound, pain, killSurvivor, tale, addThought, hasTrait, changeOpinion, leader, byId, isBitten, breakThresholds,
} from '../sim/survivors';

export const W = 1280, H = 720;
const WALL_X = 372; // front face of the barricade
const LANE_TOP = 616, LANE_BOT = 690;
const SURV_Y = 664;
const ZS = 1.3; // global actor scale for the Turned
const SH = 158; // survivor display height

interface Zombie {
  id: number;
  def: ZombieDef;
  sprite: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: 'walk' | 'wall' | 'over' | 'maul' | 'dying';
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
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'blood' | 'spark' | 'smoke' | 'fire' | 'spore' | 'shell' | 'chunk'; ground: number }
interface Tracer { x1: number; y1: number; x2: number; y2: number; life: number; w: number }
interface Fire { x: number; life: number; w: number }
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
    this.ammoStart = { light: G.stores.light, shell: G.stores.shell, rifle: G.stores.rifle, scrap: G.stores.scrap, molotov: G.stores.molotov };
    this.res = { kills: 0, deaths: [], wallHeld: true, wallLost: 0, ammoUsed: {}, killsBy: {}, headshots: 0, lines: [], fell: false };
    this.setupGuards();
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
    const slots = [262, 192, 124, 58, 0, 160];
    fighters.slice(0, 6).forEach((s, i) => {
      const w = G.weapons.find((x) => x.uid === s.weapon) ?? null;
      this.guards.push({ s, w, x: slots[i], y: SURV_Y + (i % 2) * 8 - (i >= 4 ? 30 : 0), cd: R.range(0, 1), mag: w ? WEAPONS[w.def].mag : 0, reload: 0, kills: 0, flash: 0, fled: false, recoil: 0 });
    });
    // magazines are loaded from the stores, not conjured
    for (const g of this.guards) {
      if (!g.w) continue;
      const def = WEAPONS[g.w.def];
      const per = this.ammoPer(def);
      const got = def.ammo ? Math.min(def.mag, Math.floor(G.stores[def.ammo] / per + 1e-6)) : def.mag;
      if (def.ammo) add(def.ammo, -got * per);
      g.mag = got;
      this.playerMag.set(g.w.uid, got);
    }
    // the frayed may come apart on the wall tonight
    for (const g of this.guards) {
      const th = breakThresholds(g.s);
      if (!g.s.isLeader && g.s.mood < th.minor && R.chance(g.s.mood < th.major ? 0.6 : 0.3)) g.panicAt = R.range(15, 60);
    }
    this.guards.sort((a, b) => a.y - b.y);
  }

  get player(): Guard | undefined {
    return this.guards.find((g) => g.s.isLeader && !g.s.dead && !g.fled) ?? this.guards.find((g) => !g.s.dead && !g.fled);
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
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'r' || e.key === 'R') this.startReload();
    else if (e.key === 'f' || e.key === 'F') this.throwMolotov();
    else if (e.key === 'Escape' || e.key === 'p') this.paused = !this.paused;
    else if (/^[1-9]$/.test(e.key)) this.switchWeapon(+e.key - 1);
    else if (e.key === 'q' || e.key === 'Q') this.cycleWeapon();
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
      if (!this.paused) this.update(this.slowmo > 0 ? dt * 0.35 : dt);
      this.draw();
      if (!this.ended) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    (window as unknown as { __battle: Battle }).__battle = this;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
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
    for (const z of this.zombies) this.updateZombie(z, dt);
    this.zombies = this.zombies.filter((z) => !(z.state === 'dying' && z.dieT > 0.6));
    this.updateParticles(dt);
    for (const f of this.fires) {
      f.life -= dt;
      if (R.chance(dt * 30)) this.particles.push({ x: f.x + R.range(-f.w / 2, f.w / 2), y: R.range(LANE_TOP, LANE_BOT), vx: R.range(-10, 10), vy: R.range(-90, -40), life: 0.8, max: 0.8, size: R.range(6, 14), color: '#ffb347', kind: 'fire', ground: 0 });
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
    const anyone = this.guards.some((g) => !g.s.dead && !g.fled);
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
    const y = R.range(LANE_TOP, LANE_BOT);
    const scale = 0.92 + ((y - LANE_TOP) / (LANE_BOT - LANE_TOP)) * 0.16;
    const hpMul = 1 + Math.max(0, G.day - 8) * 0.03;
    this.zombies.push({
      id: this.nextId++, def, sprite: R.pick(def.sprites), x: W + R.range(30, 120), y, hp: def.hp * hpMul, maxHp: def.hp * hpMul, state: 'walk',
      phase: R.range(0, 10), flash: 0, slow: 0, burn: 0, dieT: 0, maulT: 0, lungeT: R.range(1, 3), screamT: R.range(3, 6), scale, wallHit: 0, name,
    });
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
    if (g) g.fled = true;
    killSurvivor(s, 'turned, behind our own wall');
    this.res.deaths.push(`${first(s)} turned`);
    this.zombies.push({
      id: this.nextId++, def: ZOMBIES.sleeper, sprite: s.sex === 'm' ? 'z_shambler' : 'z_shambler2', x, y: SURV_Y, hp: 90, maxHp: 90, state: 'over',
      phase: 0, flash: 0, slow: 0, burn: 0, dieT: 0, maulT: 0, lungeT: 0, screamT: 99, scale: 1, name: first(s), wallHit: 0,
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
    if (!p || !p.w) return;
    this.playerCd -= dt;
    const def = WEAPONS[p.w.def];
    if (this.playerReload > 0) {
      this.playerReload -= dt;
      if (this.playerReload <= 0) this.finishReload(p);
    }
    if (this.mouse.down && def.auto) this.tryFire(false);
    p.recoil = Math.max(0, p.recoil - dt * 8);
    p.flash = Math.max(0, p.flash - dt);
  }

  ammoPer(def: { ammo: Res | null }) {
    return def.ammo === 'scrap' ? 0.05 : 1;
  }

  startReload() {
    const p = this.player;
    if (!p || !p.w || this.playerReload > 0) return;
    const def = WEAPONS[p.w.def];
    const mag = this.playerMag.get(p.w.uid) ?? 0;
    if (mag >= def.mag) return;
    if (def.ammo && G.stores[def.ammo] < this.ammoPer(def)) {
      this.say(`No ${def.ammo === 'light' ? 'pistol rounds' : def.ammo === 'shell' ? 'shells' : def.ammo === 'rifle' ? 'rifle rounds' : 'scrap'} left. Switch weapons [Q].`, 2);
      sfx.click();
      return;
    }
    const armHurt = p.s.wounds.some((w) => w.part === 'larm' || w.part === 'rarm') ? 1.35 : 1;
    const lost = p.s.scars.some((s) => s.label.includes('arm')) ? 1.6 : 1;
    this.playerReload = def.reload * armHurt * lost * (p.w.cond < 0.4 ? 1.3 : 1);
    if (def.id === 'pump') this.playerReload = (def.reload / def.mag) * armHurt * lost; // one shell at a time
    sfx.reload();
  }

  finishReload(g: Guard) {
    if (!g.w) return;
    const def = WEAPONS[g.w.def];
    const mag = this.playerMag.get(g.w.uid) ?? 0;
    const need = def.id === 'pump' && g === this.player ? 1 : def.mag - mag;
    let got = need;
    if (def.ammo) {
      const per = this.ammoPer(def);
      got = Math.min(need, Math.floor(G.stores[def.ammo] / per + 1e-6));
      add(def.ammo, -got * per);
    }
    this.playerMag.set(g.w.uid, mag + got);
    if (def.id === 'pump' && g === this.player) {
      sfx.shell();
      if (mag + got < def.mag && got > 0) this.startReload();
    } else sfx.reload();
  }

  tryFire(click: boolean) {
    const p = this.player;
    if (!p || !p.w || this.done || this.intro > 3.2) return;
    const def = WEAPONS[p.w.def];
    if (!click && !def.auto) return;
    if (this.playerCd > 0) return;
    if (this.playerReload > 0) {
      // firing interrupts a shell-by-shell reload
      if (def.id === 'pump' && (this.playerMag.get(p.w.uid) ?? 0) > 0) this.playerReload = 0;
      else return;
    }
    const mag = this.playerMag.get(p.w.uid) ?? 0;
    if (mag <= 0) {
      sfx.click();
      this.startReload();
      this.playerCd = 0.25;
      return;
    }
    // jam chance on worn guns
    if (p.w.cond < 0.5 && R.chance((0.5 - p.w.cond) * 0.08)) {
      this.say(`${p.w.name ?? def.name} jammed.`, 1.5);
      sfx.click();
      this.playerCd = 0.9;
      return;
    }
    this.playerMag.set(p.w.uid, mag - 1);
    this.playerCd = 1 / def.rof;
    const aim = aimFactor(p.s);
    const mz = this.muzzle(p);
    const base = Math.atan2(this.mouse.y - mz.y, this.mouse.x - mz.x);
    const spreadA = def.spread * (1.75 - aim) + this.bloom;
    for (let i = 0; i < def.pellets; i++) {
      const a = base + (R.next() + R.next() - 1) * (def.pellets > 1 ? def.spread : spreadA);
      this.castShot(p, mz.x, mz.y, a, def.dmg * (0.85 + p.w.cond * 0.15), def.pierce, def.knock, def.pellets > 1, true);
    }
    this.bloom = Math.min(0.12, this.bloom + def.spread * 0.35 + (def.auto ? 0.004 : 0.012));
    p.recoil = 1;
    p.flash = 0.06;
    this.shake = Math.max(this.shake, def.knock / 6);
    this.noise += def.noise;
    G.stats.shots++;
    p.w.cond = Math.max(0.05, p.w.cond - 0.0008);
    this.lights.push({ x: mz.x + 10, y: mz.y, r: 220, life: 0.06, max: 0.06, color: '255,200,120' });
    sfx.shot(def.id);
    this.particles.push({ x: mz.x - 30, y: mz.y + 4, vx: R.range(-60, -20), vy: R.range(-160, -90), life: 1.2, max: 1.2, size: 2.4, color: '#c9a24a', kind: 'shell', ground: SURV_Y - 4 });
    if ((this.playerMag.get(p.w.uid) ?? 0) === 0) this.startReload();
  }

  muzzle(g: Guard) {
    return { x: g.x + SH * 0.45 - g.recoil * 4, y: g.y - SH * 0.68 };
  }

  // Ray against all zombies; returns whether anything was hit.
  castShot(g: Guard, ox: number, oy: number, ang: number, dmg: number, pierce: number, knock: number, pellet: boolean, isPlayer: boolean) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hits: { z: Zombie; t: number; head: boolean }[] = [];
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
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
      this.damage(h.z, d, h.head, knock, g, pellet, ox + dx * h.t, oy + dy * h.t, isPlayer);
      if (isPlayer) G.stats.hits++;
      n++;
      endT = h.t;
      if (n > pierce) break;
      d *= 0.7;
    }
    // stop tracer at ground
    if (n === 0 && dy > 0) {
      const tg = (LANE_BOT - oy) / dy;
      if (tg > 0 && tg < endT) {
        endT = tg;
        for (let i = 0; i < 3; i++) this.particles.push({ x: ox + dx * tg, y: oy + dy * tg, vx: R.range(-40, 40), vy: R.range(-80, -20), life: 0.4, max: 0.4, size: 2, color: '#6b5d4a', kind: 'spark', ground: 0 });
      }
    }
    this.tracers.push({ x1: ox + dx * 20, y1: oy + dy * 20, x2: ox + dx * endT, y2: oy + dy * endT, life: pellet ? 0.05 : 0.07, w: pellet ? 1 : 1.6 });
    return n > 0;
  }

  hitbox(z: Zombie) {
    const h = z.def.height * z.scale * ZS;
    const w = z.def.width * z.scale * ZS;
    const lift = z.state === 'over' || z.state === 'maul' ? 0 : 0;
    const top = z.y - h - lift;
    const headH = h * z.def.head;
    const crawl = z.def.id === 'drag';
    return {
      x1: z.x - w / 2, x2: z.x + w / 2, y1: top + (z.headless ? 0 : headH * 0.8), y2: z.y,
      hx: crawl ? z.x - w * 0.36 : z.x - w * 0.12, hy: crawl ? z.y - h * 0.62 : top + headH * 0.5, hr: z.headless ? 0 : (crawl ? h * 0.3 : headH * 0.62),
    };
  }

  damage(z: Zombie, dmg: number, head: boolean, knock: number, g: Guard | null, pellet: boolean, px: number, py: number, isPlayer: boolean) {
    let d = dmg;
    if (head) d *= pellet ? 2 : 3;
    else if (z.def.armor) d = Math.max(d * 0.15, d - z.def.armor);
    z.hp -= d;
    z.flash = 0.08;
    if (z.def.id !== 'ferryman') z.x += knock * (pellet ? 0.25 : 1) * (head ? 1.4 : 1) * (z.state === 'wall' ? 0.5 : 1);
    z.x = Math.min(z.x, W + 150);
    if (z.state === 'wall' && knock > 15 && z.def.id !== 'ferryman') z.state = 'walk';
    // blood
    const nb = head ? 10 : 4;
    for (let i = 0; i < nb; i++) {
      this.particles.push({ x: px, y: py, vx: R.range(20, 220) * (R.chance(0.8) ? 1 : -0.5), vy: R.range(-200, 40), life: 1.6, max: 1.6, size: R.range(1.5, head ? 4.5 : 3), color: R.pick(['#4a0d0b', '#5e1410', '#3a0a08', '#6b2a12']), kind: 'blood', ground: z.y + R.range(-6, 6) });
    }
    if (z.hp <= 0) {
      if (head && !z.headless && R.chance(isPlayer ? 0.8 : 0.5) && z.def.id !== 'drag') {
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

  kill(z: Zombie, g: Guard | null) {
    if (z.state === 'dying') return;
    z.state = 'dying';
    z.dieT = 0;
    this.res.kills++;
    G.stats.kills++;
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

  updateGuard(g: Guard, dt: number) {
    g.flash = Math.max(0, g.flash - dt);
    g.recoil = Math.max(0, g.recoil - dt * 8);
    if (g.s.dead || g.fled || g === this.player || !g.w) return;
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
    const def = WEAPONS[g.w.def];
    if (g.reload > 0) {
      g.reload -= dt;
      if (g.reload <= 0) {
        const per = this.ammoPer(def);
        const got = def.ammo ? Math.min(def.mag, Math.floor(G.stores[def.ammo] / per + 1e-6)) : def.mag;
        if (def.ammo) add(def.ammo, -got * per);
        g.mag = got;
      }
      return;
    }
    g.cd -= dt;
    if (g.cd > 0) return;
    const fog = this.plan.special === 'fog';
    // guards only engage what they can make out in the dark
    const range = (fog ? 640 : 820) + Math.min(3, G.fort.lights) * 130 + (hasTrait(g.s, 'nightowl') ? 120 : 0);
    const targets = this.zombies.filter((z) => z.state !== 'dying' && z.x < range && z.x > g.x + 30);
    if (!targets.length) return;
    const tgt = targets.reduce((best, z) => {
      const pri = (z.def.scream ? -400 : 0) + (z.state === 'over' || z.state === 'maul' ? -800 : 0) + z.x + (z.def.burst && z.x < WALL_X + 140 ? 300 : 0);
      const bp = (best.def.scream ? -400 : 0) + (best.state === 'over' || best.state === 'maul' ? -800 : 0) + best.x + (best.def.burst && best.x < WALL_X + 140 ? 300 : 0);
      return pri < bp ? z : best;
    });
    if (g.mag <= 0) {
      if (def.ammo && G.stores[def.ammo] < this.ammoPer(def)) {
        g.cd = 2;
        if (R.chance(0.3)) this.text(g.x + 20, g.y - 150, 'out of ammo', '#c88', 10);
        return;
      }
      g.reload = def.reload * 1.15;
      return;
    }
    g.mag--;
    let aim = aimFactor(g.s);
    if (g.mode === 'panic') aim *= 0.4;
    if (g.mode === 'rage') aim = Math.min(1.3, aim + 0.3);
    const lightBonus = Math.min(0.2, G.fort.lights * 0.07);
    const mz = this.muzzle(g);
    const hb = this.hitbox(tgt);
    const dist = Math.hypot(hb.hx - mz.x, hb.hy - mz.y);
    // aim for the head with probability scaled by skill
    const goHead = R.chance(0.2 + aim * 0.25);
    const ty = goHead ? hb.hy : (hb.y1 + hb.y2) / 2;
    const tx = goHead ? hb.hx : tgt.x;
    const err = (def.spread * 1.2 + (1.15 - aim - lightBonus) * 0.07 + (fog ? 0.04 : 0)) * (1 + dist / 900);
    const base = Math.atan2(ty - mz.y, tx - mz.x);
    for (let i = 0; i < def.pellets; i++) {
      const a = base + R.gauss(0, def.pellets > 1 ? def.spread * 0.7 : err * 0.6);
      this.castShot(g, mz.x, mz.y, a, def.dmg * (0.85 + g.w.cond * 0.15), def.pierce, def.knock, def.pellets > 1, false);
    }
    g.cd = (1 / def.rof) * (def.auto ? 1.3 : 1.6) * R.range(0.9, 1.25) * (g.mode === 'panic' ? 0.55 : g.mode === 'rage' ? 0.7 : 1);
    g.recoil = 1;
    g.flash = 0.06;
    this.noise += def.noise * 0.7;
    g.w.cond = Math.max(0.05, g.w.cond - 0.0006);
    this.lights.push({ x: mz.x + 10, y: mz.y, r: 180, life: 0.06, max: 0.06, color: '255,200,120' });
    sfx.shot(def.id, true);
  }

  updateZombie(z: Zombie, dt: number) {
    z.flash = Math.max(0, z.flash - dt);
    if (z.state === 'dying') {
      if (z.dieT === 0) this.stampCorpse(z);
      z.dieT += dt;
      return;
    }
    z.phase += dt;
    const cold = G.weather === 'cold' || G.weather === 'snow' ? 0.85 : 1;
    // burning
    for (const f of this.fires) if (Math.abs(z.x - f.x) < f.w / 2) z.burn = 1.5;
    if (z.burn > 0) {
      z.burn -= dt;
      z.hp -= 22 * dt;
      if (R.chance(dt * 20)) this.particles.push({ x: z.x + R.range(-15, 15), y: z.y - R.range(10, z.def.height * 0.8), vx: 0, vy: -60, life: 0.6, max: 0.6, size: R.range(5, 10), color: '#ffb347', kind: 'fire', ground: 0 });
      if (z.hp <= 0) return this.kill(z, null);
    }
    // traps
    if (this.traps > 0 && z.state === 'walk' && z.x < this.trapX && z.x > this.trapX - 40) {
      this.traps--;
      G.fort.traps = Math.max(0, G.fort.traps - 1);
      this.explode(this.trapX, 130, 160);
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
    const wire = z.x > WALL_X + 60 && z.x < WALL_X + 60 + 90 * Math.min(3, G.fort.wire) ? 0.55 : 1;
    let speed = z.def.speed * cold * wire;
    if (z.def.lunge) {
      z.lungeT -= dt;
      if (z.lungeT < 0) {
        speed *= 0.15;
        if (z.lungeT < -0.8) z.lungeT = R.range(1.2, 2.6);
      }
    }
    if (z.state === 'walk') {
      z.x -= speed * dt;
      if (z.x - (z.def.width * z.scale * ZS) / 2 <= WALL_X) {
        z.x = WALL_X + (z.def.width * z.scale * ZS) / 2;
        z.state = G.fort.hp > 0 ? 'wall' : 'over';
      }
    } else if (z.state === 'wall') {
      if (G.fort.hp <= 0) {
        z.state = 'over';
        return;
      }
      const dmg = z.def.dps * dt * cold;
      G.fort.hp = Math.max(0, G.fort.hp - dmg);
      z.wallHit -= dt;
      if (z.wallHit <= 0) {
        z.wallHit = R.range(0.8, 1.4);
        sfx.wallHit();
        for (let i = 0; i < 2; i++) this.particles.push({ x: WALL_X - 5, y: z.y - R.range(30, 100), vx: R.range(-80, -10), vy: R.range(-100, 0), life: 0.6, max: 0.6, size: 2, color: '#7a6448', kind: 'spark', ground: 0 });
      }
      if (G.fort.spikes > 0) {
        z.hp -= G.fort.spikes * 3.5 * dt;
        if (z.hp <= 0) this.kill(z, null);
      }
    } else if (z.state === 'over') {
      // over the rubble toward the nearest defender
      const live = this.guards.filter((g) => !g.s.dead && !g.fled);
      if (!live.length) { z.x -= speed * dt; if (z.x < -80) z.hp = 0; return; }
      const tgt = live.reduce((a, b) => (Math.abs(b.x - z.x) < Math.abs(a.x - z.x) ? b : a));
      if (z.x > tgt.x + 34) z.x -= speed * 0.8 * dt;
      else {
        z.state = 'maul';
        z.target = tgt.s.id;
        z.maulT = 0.6;
      }
    } else if (z.state === 'maul') {
      const g = this.guards.find((x) => x.s.id === z.target);
      if (!g || g.s.dead || g.fled) { z.state = 'over'; return; }
      z.maulT -= dt;
      if (z.maulT <= 0) {
        z.maulT = R.range(0.9, 1.6) * (z.def.id === 'ferryman' ? 0.7 : 1);
        this.maul(g, z);
      }
    }
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
    for (let i = 0; i < 8; i++) this.particles.push({ x: g.x + 20, y: g.y - 80, vx: R.range(-120, 120), vy: R.range(-160, 0), life: 1.4, max: 1.4, size: R.range(2, 4), color: '#5e1410', kind: 'blood', ground: g.y });
    if (pain(s) > 1.45) {
      const by = z.name ? `by what had been ${z.name}` : `by a ${z.def.name}`;
      killSurvivor(s, `pulled down behind the wall ${by}, night ${G.day}`);
      this.res.deaths.push(first(s));
      this.say(`${first(s).toUpperCase()} IS DOWN.`, 6);
      for (const o of this.guards) {
        if (o.s.dead || o.fled || o === g) continue;
        const r = o.s.rel[s.id];
        if (r && (r.bond === 'lover' || r.bond === 'spouse' || r.bond === 'parent' || r.bond === 'child' || r.bond === 'sibling' || r.opinion > 50)) {
          o.mode = 'rage';
          this.say(`${first(o.s)} screams ${first(s)}'s name and keeps firing.`, 5);
          tale(o.s, `Kept firing after ${first(s)} fell, night ${G.day}.`);
        }
      }
      this.slowmo = 1.5;
      G.flags.lastDeathDay = G.day;
      if (s.isLeader === false && this.player?.s === s) { /* control passes */ }
      const nl = leader();
      if (nl && this.player?.s !== nl) this.say(`${first(nl)} takes up the line.`, 4);
    }
  }

  explode(x: number, r: number, dmg: number) {
    sfx.boom();
    this.shake = 16;
    this.lights.push({ x, y: 600, r: 420, life: 0.4, max: 0.4, color: '255,170,80' });
    for (let i = 0; i < 40; i++) this.particles.push({ x, y: 620, vx: R.range(-300, 300), vy: R.range(-420, -60), life: 1.2, max: 1.2, size: R.range(2, 6), color: R.pick(['#ffcf6b', '#ff8a3d', '#444']), kind: R.chance(0.6) ? 'spark' : 'smoke', ground: 640 });
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
      const d = Math.abs(z.x - x);
      if (d < r) {
        z.hp -= dmg * (1 - d / r / 1.5);
        z.x += 40;
        z.flash = 0.1;
        if (z.hp <= 0) this.kill(z, null);
      }
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
    setTimeout(() => {
      sfx.fire();
      this.fires.push({ x, life: 7, w: 150 });
      this.lights.push({ x, y: 620, r: 300, life: 7, max: 7, color: '255,150,60' });
    }, 350);
    this.tracers.push({ x1: p.x + 40, y1: p.y - 100, x2: x, y2: 630, life: 0.35, w: 2 });
  }

  stampCorpse(z: Zombie) {
    // a body left in the road, darkened and laid flat
    const im = img(z.sprite);
    if (!im) return;
    const h = z.def.height * z.scale * ZS;
    const w = (im.width / im.height) * h;
    const c = this.gctx;
    c.save();
    c.globalAlpha = 0.85;
    c.filter = 'brightness(0.45) saturate(0.6)';
    if (z.def.id === 'drag') {
      c.drawImage(im, z.x - w / 2, z.y - h, w, h);
    } else {
      c.translate(z.x + h * 0.35, z.y - 6);
      c.rotate(Math.PI / 2 * (R.chance(0.5) ? 1 : 0.92));
      c.scale(1, 0.55);
      c.drawImage(im, -w / 2, -h * 0.1, w, h);
    }
    c.restore();
    c.filter = 'none';
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
        c.globalAlpha = 0.75;
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
  draw() {
    const c = this.ctx;
    c.save();
    if (this.shake > 0) c.translate(R.range(-this.shake, this.shake), R.range(-this.shake, this.shake) * 0.6);
    // background with slight parallax from aim
    const bg = img('bg_mid');
    const px = (this.mouse.x / W - 0.5) * -24;
    if (bg) c.drawImage(bg, -160 + px, -20, 1600, 740);
    else { c.fillStyle = '#2a2d33'; c.fillRect(0, 0, W, H); }
    // night grade: push the painted dusk toward night
    const nightT = Math.min(1, this.t / 40);
    c.fillStyle = `rgba(14,18,30,${0.22 + nightT * 0.14})`;
    c.fillRect(0, 0, W, H);
    // road
    const g = c.createLinearGradient(0, 590, 0, H);
    g.addColorStop(0, 'rgba(24,24,26,0.0)');
    g.addColorStop(0.15, 'rgba(24,24,26,0.75)');
    g.addColorStop(1, 'rgba(12,12,14,0.95)');
    c.fillStyle = g;
    c.fillRect(0, 590, W, H - 590);
    c.drawImage(this.ground, 0, 0);
    // wire belt
    if (G.fort.wire > 0) this.drawWire(c);
    // trap marker
    if (this.traps > 0) {
      c.fillStyle = '#3b3a33';
      c.fillRect(this.trapX - 14, 650, 28, 8);
      c.fillStyle = '#a33';
      c.fillRect(this.trapX - 2, 646, 4, 4);
    }
    // fires (ground)
    for (const f of this.fires) {
      const a = Math.min(1, f.life);
      const fg = c.createRadialGradient(f.x, 640, 5, f.x, 640, f.w * 0.7);
      fg.addColorStop(0, `rgba(255,180,80,${0.5 * a})`);
      fg.addColorStop(1, 'rgba(255,90,30,0)');
      c.fillStyle = fg;
      c.fillRect(f.x - f.w, 560, f.w * 2, 120);
    }
    // entities sorted by depth
    type D = { y: number; f: () => void };
    const list: D[] = [];
    for (const z of this.zombies) list.push({ y: z.y, f: () => this.drawZombie(c, z) });
    for (const gd of this.guards) if (!gd.s.dead && !gd.fled) list.push({ y: gd.y - 40, f: () => this.drawGuard(c, gd) });
    list.push({ y: 668, f: () => this.drawWall(c) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    // particles
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'smoke') { c.fillStyle = `rgba(60,58,55,${a * 0.4})`; c.beginPath(); c.arc(p.x, p.y, p.size * (2 - a), 0, 7); c.fill(); }
      else if (p.kind === 'spore') { c.fillStyle = `rgba(168,134,47,${a * 0.35})`; c.beginPath(); c.arc(p.x, p.y, p.size * (2.2 - a), 0, 7); c.fill(); }
      else if (p.kind === 'fire') { c.fillStyle = `rgba(255,${120 + 100 * a | 0},50,${a})`; c.beginPath(); c.arc(p.x, p.y, p.size * a, 0, 7); c.fill(); }
      else { c.fillStyle = p.color; c.globalAlpha = Math.min(1, a * 2); c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); c.globalAlpha = 1; }
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
    // fog
    if (this.plan.special === 'fog') {
      const fg = c.createLinearGradient(500, 0, W, 0);
      fg.addColorStop(0, 'rgba(120,128,135,0)');
      fg.addColorStop(0.4, 'rgba(120,128,135,0.55)');
      fg.addColorStop(1, 'rgba(120,128,135,0.85)');
      c.fillStyle = fg;
      c.fillRect(0, 0, W, H);
    }
    // snow
    if (G.weather === 'snow' || this.plan.special === 'crossing') this.drawSnow(c);
    this.drawLighting(c);
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

  drawWire(c: CanvasRenderingContext2D) {
    c.strokeStyle = 'rgba(90,85,80,0.9)';
    c.lineWidth = 1;
    const n = Math.min(3, G.fort.wire);
    for (let k = 0; k < n; k++) {
      const x0 = WALL_X + 60 + k * 90;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        for (let x = 0; x <= 80; x += 4) {
          const y = 610 + i * 18 + Math.sin(x * 0.4 + i + k) * 5;
          if (x === 0) c.moveTo(x0 + x, y); else c.lineTo(x0 + x, y);
        }
        c.stroke();
      }
      c.fillStyle = '#2b2622';
      c.fillRect(x0, 600, 3, 60);
      c.fillRect(x0 + 78, 600, 3, 60);
    }
  }

  drawWall(c: CanvasRenderingContext2D) {
    const frac = G.fort.hp / G.fort.maxHp;
    const im = img(frac > 0.45 ? 'barricade' : 'barricade_broken');
    const h = 118 + Math.min(50, (G.fort.maxHp - 300) * 0.1);
    if (im) {
      const w = (im.width / im.height) * h;
      if (frac <= 0) {
        c.globalAlpha = 0.85;
        c.drawImage(im, WALL_X - w + 10, 694 - h * 0.45, w, h * 0.45);
        c.globalAlpha = 1;
      } else {
        c.drawImage(im, WALL_X - w + 10, 694 - h, w, h);
      }
      // spikes
      for (let i = 0; i < Math.min(5, G.fort.spikes) * 3; i++) {
        c.strokeStyle = '#4a3f35';
        c.lineWidth = 3;
        const sx = WALL_X + 4 + (i % 3) * 6, sy = 600 + Math.floor(i / 3) * 12;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(sx + 26, sy - 8);
        c.stroke();
      }
    }
    // floodlights on poles
    for (let i = 0; i < Math.min(3, G.fort.lights); i++) {
      const x = 260 - i * 90;
      c.fillStyle = '#1a1a1a';
      c.fillRect(x, 380, 4, 280);
      c.fillStyle = '#e8e2c0';
      c.fillRect(x - 6, 376, 18, 10);
    }
  }

  drawGuard(c: CanvasRenderingContext2D, g: Guard) {
    const im = img(g.s.sprite);
    const h = SH;
    const isP = g === this.player;
    const bob = Math.sin(this.t * 1.6 + g.x) * 1.2;
    if (im) {
      const w = (im.width / im.height) * h;
      const x = g.x - w / 2 - g.recoil * 3;
      const y = g.y - h + bob;
      // survivors are read as silhouettes against the dark, lit by their own fire
      const lit = g.flash > 0 || isP || G.fort.lights > 0;
      if (lit) c.drawImage(im, x, y, w, h);
      else {
        c.drawImage(im, x, y, w, h);
        c.globalAlpha = 0.45;
        const sh = shadeImg(g.s.sprite, '#0a0b10');
        if (sh) c.drawImage(sh, x, y, w, h);
        c.globalAlpha = 1;
      }
    }
    // muzzle flash
    if (g.flash > 0) {
      const mz = this.muzzle(g);
      c.fillStyle = 'rgba(255,230,160,0.95)';
      c.beginPath();
      c.moveTo(mz.x, mz.y - 5);
      c.lineTo(mz.x + 34, mz.y);
      c.lineTo(mz.x, mz.y + 5);
      c.fill();
    }
    // label
    c.font = '11px "Special Elite", monospace';
    c.textAlign = 'center';
    c.fillStyle = isP ? '#f0d890' : '#cfc6b0';
    c.fillText(first(g.s) + (isP ? ' ◆' : ''), g.x, g.y - h - 14);
    const hp = Math.max(0, 1 - pain(g.s) / 1.45);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(g.x - 20, g.y - h - 9, 40, 4);
    c.fillStyle = hp > 0.5 ? '#9db070' : hp > 0.25 ? '#d0a040' : '#c04030';
    c.fillRect(g.x - 20, g.y - h - 9, 40 * hp, 4);
    if (g.reload > 0 || (isP && this.playerReload > 0)) {
      c.fillStyle = '#d9c9a0';
      c.fillText('reloading', g.x, g.y - h - 26);
    }
    if (g.mode) {
      c.fillStyle = g.mode === 'panic' ? '#d0a040' : '#e05040';
      c.fillText(g.mode === 'panic' ? 'panicking' : 'enraged', g.x, g.y - h - 26);
    }
    if (isBitten(g.s) && !g.s.wounds.some((w) => w.hidden)) {
      c.fillStyle = '#b8862f';
      c.fillText('bitten', g.x, g.y - h - (g.reload > 0 ? 38 : 26));
    }
  }

  drawZombie(c: CanvasRenderingContext2D, z: Zombie) {
    const im = img(z.sprite);
    const h = z.def.height * z.scale * ZS;
    if (!im) return;
    const w = (im.width / im.height) * h;
    c.save();
    let rot = 0, dy = 0;
    const gait = z.def.speed > 60 ? 9 : 3.2;
    if (z.state === 'walk' || z.state === 'over') {
      rot = Math.sin(z.phase * gait) * (z.def.speed > 60 ? 0.05 : 0.04);
      dy = -Math.abs(Math.sin(z.phase * gait)) * (z.def.speed > 60 ? 5 : 2.5);
    } else if (z.state === 'wall' || z.state === 'maul') {
      rot = -0.08 + Math.sin(z.phase * 7) * 0.06;
    } else if (z.state === 'dying') {
      const k = Math.min(1, z.dieT / 0.45);
      rot = k * 1.2;
      dy = k * h * 0.15;
      c.globalAlpha = 1 - Math.max(0, z.dieT - 0.4) * 5;
    }
    c.translate(z.x, z.y + dy);
    c.rotate(rot);
    // the far ones fade into the dark
    const farFade = this.plan.special === 'fog' ? Math.max(0.15, 1 - Math.max(0, z.x - 620) / 400) : 1;
    c.globalAlpha *= farFade;
    if (z.headless) {
      c.beginPath();
      c.rect(-w / 2 - 10, -h + h * z.def.head * 0.95, w + 20, h);
      c.clip();
    }
    const rim = shadeImg(z.sprite, '#a9b8c9');
    if (rim && z.state !== 'dying') {
      const a = c.globalAlpha;
      c.globalAlpha = a * 0.55;
      c.drawImage(rim, -w / 2 + 1.5, -h - 1.5, w, h);
      c.globalAlpha = a;
    }
    c.drawImage(im, -w / 2, -h, w, h);
    if (z.flash > 0) {
      const fl = flashImg(z.sprite);
      if (fl) { c.globalAlpha = 0.6 * farFade; c.drawImage(fl, -w / 2, -h, w, h); }
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

  drawLighting(c: CanvasRenderingContext2D) {
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
    // the house: a lantern behind the line
    hole(120, 560, 260, 0.6);
    for (let i = 0; i < Math.min(3, G.fort.lights); i++) {
      // floodlight cone toward the road
      d.save();
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
      d.restore();
    }
    for (const l of this.lights) hole(l.x, l.y, l.r * (0.7 + 0.3 * (l.life / l.max)), Math.min(1, l.life / l.max + 0.3));
    for (const f of this.fires) hole(f.x, 620, 260, 0.9 * Math.min(1, f.life));
    c.drawImage(this.dark, 0, 0, W, H);
    // warm additive glow for flashes
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const a = (l.life / l.max) * 0.25;
      const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.6);
      g.addColorStop(0, `rgba(${l.color},${a})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
      c.fillStyle = g;
      c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    c.restore();
    // vignette
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);
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
    // weapon
    const p = this.player;
    if (p && p.w) {
      const def = WEAPONS[p.w.def];
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
      const reserve = def.ammo ? (def.ammo === 'scrap' ? Math.floor(G.stores.scrap * 20) : G.stores[def.ammo]) : '∞';
      c.fillText(`${mag}`, W - 110, H - 30);
      c.font = '14px "Special Elite", monospace';
      c.fillStyle = '#a89c84';
      c.fillText(`/ ${reserve}`, W - 30, H - 30);
      if (p.w.cond < 0.4) { c.fillStyle = '#c08040'; c.fillText('worn', W - 200, H - 30); }
      // reload bar
      if (this.playerReload > 0) {
        c.fillStyle = '#d9c9a0';
        c.fillRect(W - 320, H - 24, 290 * (1 - this.playerReload / Math.max(0.01, def.reload)), 3);
      }
    }
    c.textAlign = 'left';
    c.font = '12px "Special Elite", monospace';
    c.fillStyle = '#a89c84';
    c.fillText(`firebombs ${G.stores.molotov} [F]   ·   [R] reload   [Q]/[1-9] weapon   [P] pause`, 20, H - 22);
    // messages
    c.textAlign = 'center';
    this.messages.forEach((m, i) => {
      c.font = '17px "Special Elite", monospace';
      c.fillStyle = `rgba(232,220,192,${Math.min(1, m.life)})`;
      c.fillText(m.text, W / 2, 110 + i * 26);
    });
    // crosshair: circle sized by real spread
    if (p && p.w && !this.done) {
      const def = WEAPONS[p.w.def];
      const mz = this.muzzle(p);
      const dist = Math.hypot(this.mouse.x - mz.x, this.mouse.y - mz.y);
      const spreadA = (def.pellets > 1 ? def.spread : def.spread * (1.75 - aimFactor(p.s))) + this.bloom;
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
    for (const g of this.guards) {
      if (!g.w) continue;
      const def = WEAPONS[g.w.def];
      const m = g === this.player ? this.playerMag.get(g.w.uid) ?? 0 : g.mag;
      if (def.ammo) add(def.ammo, m * this.ammoPer(def));
    }
    for (const k of ['light', 'shell', 'rifle', 'scrap', 'molotov'] as Res[]) {
      const used = (this.ammoStart[k] ?? 0) - G.stores[k];
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
    const alone = fighters.filter((g) => !g.fled);
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
