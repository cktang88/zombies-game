// Traps at night: the runtime for every kit in data/traps.ts (spec: docs/research/08-traps.md §4).
// Built from G.deploy when the battle starts; works on the battle through the hook contract
// (night/hook.ts) and reports which placements were used up for dawnRetrieve().
//
// How it moves the Turned without reaching into battle.ts's walk code: it runs after they have
// moved each step and corrects the step it saw (slow = scale it; hold = undo it; lure = steer it).
//
// Keys: [L] pull a lure (tin cans / radio), [G] drop the deadfall or fire the pipe mine.
// Propane is shot: onShot tests the leader's rays against the tank before the crowd.
import { is, keyCap } from '../ui/keys';
import type { Battle } from './battle';
import { LANES, W } from './battle';
import type { BattleHook, Zed, Guardian, SortedDraw } from './hook';
import { TRAPS, type TrapDef, type Placement } from '../data/traps';
import { G, R } from '../state';
import { sfx } from '../audio';
import { spriteUrl, spriteExists } from '../assets';
import { depthScale } from './render';
import { drawProp, has } from './props';
import { LOOK } from './battle';
import { blastDamage } from '../data/weapons';

const WALL_X = 372;
// all-lane effects (fires, blasts) centre between the far and near lanes: ±41px reaches every lane.
// (a function: battle.ts imports this module, so its exports are not ready at load time)
const midY = () => (LANES[0] + LANES[3]) / 2;
const laneWallX = (lane: number) => WALL_X + (LANES[3] - LANES[lane]) * 0.12;

// ---- sprites, loaded on first use (they are not in the core asset list) ----
const SPR = new Map<string, HTMLImageElement>();
export function sprite(id: string): HTMLImageElement | undefined {
  let im = SPR.get(id);
  if (!im) { im = new Image(); im.src = spriteUrl(id); SPR.set(id, im); }
  return im.complete && im.naturalWidth > 0 ? im : undefined;
}

/** Last night's used-up placements (indices into G.deploy), for dawnRetrieve. Read once at dawn. */
let lastSpent: number[] = [];
export function takeSpent(): number[] { const s = lastSpent; lastSpent = []; return s; }

export interface TrapRT {
  def: TrapDef;
  idx: number; // index into G.deploy
  x: number;
  lane: number;
  y: number;
  uses: number;
  armed: boolean;
  spent: boolean; // used up or destroyed: does not come back at dawn
  t: number; // general timer (lure/sludge/fire time left, net time held)
  on: boolean; // active (lure playing, net loaded, oil lit, barrels burning, sludge started)
  seen: Set<number>; // Turned that already crossed (step damage once each)
  cd: Map<number, number>; // per-Turned cooldown (fence shocks)
  hold?: number; // bear trap: who is in the jaws
  rearm: number;
  hp: number; // net
  hits: number; // propane: pellets that found the tank
  bodies: number; // pit
  short: number; // fence: shorted for this long
  flash: number; // draw: a spark, a shock, a snap
  drop: number; // deadfall: 0 hanging … 1 down
  kills: number;
  tick: number;
}

interface Hold { t: number; x: number; why: string; then?: () => void }

export class Traps implements BattleHook {
  b: Battle;
  list: TrapRT[] = [];
  holds = new Map<number, Hold>();
  lastX = new Map<number, number>();
  lureFlip = new Set<number>();
  lastScream = new Map<number, number>();
  maxId = 0;
  hint = 4; // seconds the key hint stays bright

  constructor(b: Battle, deploy: Placement[] = G.deploy ?? []) {
    this.b = b;
    deploy.forEach((p, idx) => {
      const def = TRAPS[p.trap];
      if (!def) return;
      const lane = Math.max(0, Math.min(3, p.lane | 0));
      const tr: TrapRT = {
        def, idx, x: p.x, lane, y: LANES[lane], uses: def.uses, armed: true, spent: false, t: 0, on: false,
        seen: new Set(), cd: new Map(), rearm: 0, hp: def.fx.hp ?? 0, hits: 0, bodies: 0, short: 0, flash: 0, drop: 0, kills: 0, tick: R.range(0, 1),
      };
      // the barrels are lit at dusk; the fence needs the generator running
      if (def.id === 'barrels') { tr.on = true; tr.t = def.uses; }
      if (def.id === 'electric' && !G.buildings.some((x) => x.id === 'generator')) tr.armed = false;
      this.list.push(tr);
      if (def.world && spriteExists(def.world)) sprite(def.world);
    });
    if (this.list.some((t) => t.def.id === 'radio')) sprite('icon_trap_radio');
    for (const z of b.zombies) this.maxId = Math.max(this.maxId, z.id);
    if (this.list.length) b.say(`${this.list.length} trap${this.list.length > 1 ? 's' : ''} on the road tonight.`, 3);
  }

  get leader(): Guardian | null { return this.b.player ?? null; }

  // ---------------- status: holds, slows, lures ----------------
  /** Stop a Turned where it stands for `t` seconds (bear trap, net, pit, snare, stun, melee stagger). */
  hold(z: Zed, t: number, why: string, then?: () => void) {
    const h = this.holds.get(z.id);
    if (h) { h.t = Math.max(h.t, t); return; }
    this.holds.set(z.id, { t, x: z.x, why, then });
    if (z.state === 'wall' && why !== 'stagger') z.state = 'walk';
  }
  held(z: Zed) { return (this.holds.get(z.id)?.t ?? 0) > 0; }

  /** Hurt a Turned directly (traps ignore plate unless noted); credit the leader. Returns true if it died. */
  hurt(z: Zed, dmg: number, tr?: TrapRT, armor = false): boolean {
    if (z.state === 'dying') return false;
    const d = armor && z.def.armor ? Math.max(dmg * 0.25, dmg - z.def.armor) : dmg;
    z.hp -= d;
    z.flash = 0.1;
    this.b.blood(z.x, z.y - this.b.zh(z) * 0.4, 4, 3, z.y);
    if (z.hp <= 0) {
      this.b.kill(z, this.leader);
      if (tr) tr.kills++;
      return true;
    }
    return false;
  }

  /** Walkers lose their legs and become Drags. */
  cripple(z: Zed, chance: number) {
    const d = z.def;
    if (z.state === 'dying' || d.crawl || d.boss || d.ranged || d.id === 'ferryman' || !R.chance(chance)) return;
    z.def = { ...d, crawl: true, lunge: false, speed: Math.min(d.speed, 20), width: 90, height: 42, head: 0.45 };
    z.sprite = 'z_crawler';
    z.headless = false;
    this.b.text(z.x, z.y - 70, 'legs gone', '#c9a07a', 11);
    sfx.hit();
  }

  /** A blast on the road (nail bomb, propane): the battle's blast, plus cripple / burn / oil. */
  explode(tr: TrapRT, x: number, y: number) {
    const fx = tr.def.fx, r = tr.def.area.radius ?? 130;
    const ex = { radius: r, dmg: fx.dmg ?? 100 };
    // strung across the road: the blast reaches every lane, falling off with distance along it
    const span = tr.def.area.allLanes;
    const hit = this.b.zombies.filter((z) => z.state !== 'dying' && (z.emerge ?? 0) <= 0.25 && blastDamage(ex, z.x - x, span ? 0 : z.y - y) > 0);
    this.b.blast(x, y, { radius: r, dmg: 0 }, 0, null); // the flash, the scorch, the noise
    const knock = fx.knock ?? 40;
    for (const z of hit) {
      const dmg = blastDamage(ex, z.x - x, span ? 0 : z.y - y);
      z.flash = 0.1;
      if (!(z.def.id === 'ferryman' || z.def.boss || z.state === 'cover')) {
        z.x = Math.min(W + 150, z.x + Math.sign(z.x - x || 1) * knock * (dmg / ex.dmg));
        if (z.state === 'wall') z.state = 'walk';
      }
      if (this.hurt(z, dmg, tr)) continue;
      if (fx.cripple) this.cripple(z, fx.cripple);
      if (fx.burn) z.burn = Math.max(z.burn, fx.burn);
      this.holds.delete(z.id);
    }
    if (fx.light) this.b.lights.push({ x, y: y - 40, r: fx.light.r, life: fx.light.time, max: fx.light.time, color: '255,170,80' });
    this.b.noise += tr.def.noise;
    if (fx.ignites) this.igniteNear(x - r * 0.8, x + r * 0.8);
    // a net in the blast is shredded with the heap on it
    for (const n of this.list) if (n.def.id === 'net' && n.on && Math.abs(n.x - x) < r) this.tearNet(n, 'The blast takes the net with it.');
  }

  // ---------------- oil ----------------
  igniteNear(x0: number, x1: number) {
    for (const o of this.list) {
      if (o.def.id !== 'oil' || !o.armed || o.on) continue;
      const hw = (o.def.area.length ?? 120) / 2;
      if (o.x + hw >= x0 && o.x - hw <= x1) this.ignite(o);
    }
  }
  ignite(o: TrapRT) {
    if (o.on || !o.armed) return;
    o.on = true;
    o.t = o.def.uses; // 12 s of fire
    const w = o.def.area.length ?? 120;
    this.b.fires.push({ x: o.x, y: midY(), life: o.t, w });
    this.b.lights.push({ x: o.x, y: midY() - 30, r: o.def.fx.light?.r ?? 140, life: o.t, max: o.t, color: '255,150,60' });
    sfx.fire();
    this.b.text(o.x, midY() - 90, 'the oil goes up', '#ffb347', 14);
    this.b.shake = Math.max(this.b.shake, 4);
  }

  /** Every way fire reaches a slick: firebombs and flame on the road, burning bodies, flare light, blasts, lit barrels. */
  checkIgnition() {
    const oils = this.list.filter((o) => o.def.id === 'oil' && o.armed && !o.on);
    if (!oils.length) return;
    for (const o of oils) {
      const hw = (o.def.area.length ?? 120) / 2;
      const inBand = (x: number, pad = 0) => x >= o.x - hw - pad && x <= o.x + hw + pad;
      let go = this.b.fires.some((f) => f.life > 0.2 && inBand(f.x, f.w / 2));
      if (!go) go = this.b.zombies.some((z) => z.state !== 'dying' && z.burn > 0 && inBand(z.x));
      // a flare round or a tripwire flare (red), or any blast (orange, fresh)
      if (!go) go = this.b.lights.some((l) => l.life > l.max - 0.12 && (l.color === '255,90,70' || l.color === '255,170,80') && inBand(l.x, 40) && l.y > LANES[0] - 140);
      // a lit barrel beside it catches it as soon as anything stirs the slick
      if (!go) go = this.list.some((b) => b.def.id === 'barrels' && b.on && Math.abs(b.x - o.x) <= hw + 90) && this.b.zombies.some((z) => z.state === 'walk' && inBand(z.x));
      if (go) this.ignite(o);
    }
  }

  // ---------------- lures ----------------
  lures() { return this.list.filter((t) => t.on && t.def.fx.lure && !t.spent); }
  pull(tr: TrapRT, auto: boolean) {
    const lure = tr.def.fx.lure!;
    if (tr.on || tr.uses <= 0 || tr.spent) return false;
    tr.on = true;
    tr.t = lure.time;
    tr.uses--;
    this.b.noise += tr.def.noise;
    if (tr.def.id === 'radio') {
      this.b.say(auto ? 'A Crier winds up. The radio on the road comes on: the hog report, then polka.' : 'The radio comes on down the road. Polka, loud.', 4);
      sfx.ui(); setTimeout(() => sfx.ui(), 160); setTimeout(() => sfx.ui(), 420);
    } else {
      this.b.say(auto ? 'Something brushes the cans. They turn toward the noise.' : 'You yank the cord. The cans clatter down the road.', 3);
      sfx.click(); setTimeout(() => sfx.click(), 90); setTimeout(() => sfx.click(), 200);
    }
    return true;
  }
  /** [L]: the ready lure with the most Turned inside its reach. */
  pullBest() {
    let best: TrapRT | undefined, bn = -1;
    for (const t of this.list) {
      if (!t.def.fx.lure || t.on || t.uses <= 0 || t.spent) continue;
      const r = t.def.fx.lure.r;
      const n = this.b.zombies.filter((z) => z.state !== 'dying' && Math.abs(z.x - t.x) <= r).length;
      if (n > bn) { bn = n; best = t; }
    }
    if (best) this.pull(best, false);
    else this.b.say('No lure left on the road.', 2);
  }
  lureImmune(z: Zed) { return !!(z.def.boss || z.def.ranged || z.def.id === 'ferryman' || z.def.tunnel); }

  // ---------------- [G]: deadfall, pipe mine ----------------
  deadfallTarget(tr: TrapRT): Zed | undefined {
    let best: Zed | undefined, bd = 1e9;
    const wx = laneWallX(tr.lane);
    for (const z of this.b.zombies) {
      if (z.state === 'dying') continue;
      const st = z.state as string;
      const atWall = (st === 'wall' || st === 'climb' || st === 'walk') && Math.abs(z.lane - tr.lane) === 0 && z.x - wx < 70 + this.b.zw(z) / 2;
      const landed = (st === 'over' || st === 'leap') && Math.abs(z.x - WALL_X) < 70;
      if (!atWall && !landed) continue;
      const d = Math.abs(z.x - wx);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
  dropDeadfall(tr: TrapRT) {
    if (!tr.armed || tr.spent) return false;
    const z = this.deadfallTarget(tr);
    tr.armed = false;
    tr.spent = true;
    tr.drop = 0.01;
    this.b.noise += tr.def.noise;
    sfx.thud(); sfx.wallHit();
    this.b.shake = Math.max(this.b.shake, 7);
    if (!z) { this.b.say('The door comes down on nothing.', 2); return true; }
    const heavy = z.def.id === 'ferryman' || z.def.boss;
    this.b.text(z.x, z.y - this.b.zh(z) - 10, 'CRUSHED', '#e0c090', 14);
    if (!this.hurt(z, tr.def.fx.dmg ?? 260, tr)) {
      this.hold(z, heavy ? 1.2 : tr.def.fx.knockdown ?? 2, 'down');
      if (!heavy) z.x += tr.def.fx.knock ?? 30;
    }
    return true;
  }
  inCone(tr: TrapRT, z: Zed) {
    const c = tr.def.area.cone!;
    const dx = z.x - tr.x;
    if (dx <= 0 || dx > c.reach) return 0;
    // the cone opens along the road; lanes are close together in screen space, so the depth
    // spread is measured in lane gaps (≈27 px) against the cone's width at that distance
    const half = Math.tan((c.half * Math.PI) / 180) * dx * 0.55;
    return Math.abs(z.y - tr.y) <= half + 8 ? 1 - 0.6 * (dx / c.reach) : 0;
  }
  firePipeMine(tr: TrapRT) {
    if (!tr.armed || tr.spent) return false;
    tr.armed = false;
    tr.spent = true;
    const fx = tr.def.fx, c = tr.def.area.cone!;
    sfx.explosion(0.8); this.b.earLoad += 4;
    this.b.shake = Math.max(this.b.shake, 12);
    this.b.noise += tr.def.noise;
    this.b.lights.push({ x: tr.x + 60, y: tr.y - 30, r: 300, life: 0.4, max: 0.4, color: '255,170,80' });
    for (let i = 0; i < 50; i++) {
      const a = (R.next() * 2 - 1) * (c.half * Math.PI / 180) * 0.5;
      const v = R.range(500, 1100);
      this.b.particles.push({ x: tr.x + 8, y: tr.y - 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.4 - R.range(0, 60), life: 0.35, max: 0.35, size: R.range(1.5, 3), color: R.pick(['#ffe0a0', '#c8c0b0', '#ff9a40']), kind: 'spark', ground: 0 });
    }
    for (let i = 0; i < 8; i++) this.b.particles.push({ x: tr.x + R.range(0, 60), y: tr.y - R.range(10, 40), vx: R.range(20, 90), vy: R.range(-40, -10), life: 2, max: 2, size: R.range(8, 14), color: '#999', kind: 'smoke', ground: 0 });
    for (const z of this.b.zombies) {
      if (z.state === 'dying') continue;
      const k = this.inCone(tr, z);
      if (k <= 0) continue;
      const dmg = (fx.dmg ?? 150) * k * (z.def.crawl ? 0.3 : 1);
      this.holds.delete(z.id);
      if (this.hurt(z, dmg, tr, true)) continue;
      if (!(z.def.id === 'ferryman' || z.def.boss)) { z.x += (fx.knock ?? 60) * k; if (z.state === 'wall') z.state = 'walk'; }
      if (fx.cripple) this.cripple(z, fx.cripple);
    }
    this.igniteNear(tr.x, tr.x + c.reach);
    return true;
  }
  pressG() {
    // the deadfall if something is on the wall under one, else the pipe mine, else any deadfall
    const dfs = this.list.filter((t) => t.def.id === 'deadfall' && t.armed);
    const withT = dfs.find((t) => this.deadfallTarget(t));
    if (withT) return this.dropDeadfall(withT);
    const mine = this.list.find((t) => t.def.id === 'pipemine' && t.armed);
    if (mine) return this.firePipeMine(mine);
    if (dfs[0]) return this.dropDeadfall(dfs[0]);
    this.b.say('Nothing left to drop or fire.', 2);
    return false;
  }

  tearNet(n: TrapRT, msg?: string) {
    if (!n.on && n.spent) return;
    n.on = false;
    n.armed = false;
    n.spent = true;
    for (const [id, h] of this.holds) if (h.why === `net${n.idx}`) this.holds.delete(id);
    sfx.wallHit();
    this.b.text(n.x, n.y - 70, 'torn', '#c0b090', 12);
    if (msg) this.b.say(msg, 2.5);
  }

  // ---------------- hook: input ----------------
  onKey(e: KeyboardEvent) {
    if (this.b.done || this.b.paused) return false;
    if (is(e, 'night.lure') && this.list.some((t) => t.def.fx.lure)) { if (!e.repeat) this.pullBest(); return true; }
    if (is(e, 'night.trap') && this.list.some((t) => t.def.id === 'deadfall' || t.def.id === 'pipemine')) { if (!e.repeat) this.pressG(); return true; }
    return false;
  }

  // ---------------- hook: shots (propane) ----------------
  onShot(g: Guardian | null, ox: number, oy: number, ang: number, laneY: number, pellet: boolean, isPlayer: boolean) {
    if (!isPlayer) return false;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (const tr of this.list) {
      if (tr.def.id !== 'propane' || !tr.armed) continue;
      const s = depthScale(tr.y);
      const w = 30 * s, h = 46 * s;
      const x1 = tr.x - w / 2, x2 = tr.x + w / 2, y1 = tr.y - h, y2 = tr.y;
      // the shot's lane, or the crosshair right on the tank
      const m = this.b.mouse;
      const onIt = m.x > x1 - 6 && m.x < x2 + 6 && m.y > y1 - 6 && m.y < y2 + 4;
      if (!onIt && Math.abs(laneY - tr.y) > 14) continue;
      const t1 = (x1 - ox) / dx, t2 = (x2 - ox) / dx, t3 = (y1 - oy) / dy, t4 = (y2 - oy) / dy;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
      if (!(tmax >= 0 && tmin <= tmax)) continue;
      // nothing standing between the muzzle and the tank in its lane
      const t = Math.max(0, tmin);
      this.b.tracers.push({ x1: ox + dx * 20, y1: oy + dy * 20, x2: ox + dx * t, y2: oy + dy * t, life: 0.07, w: 1.6 });
      if (pellet && R.chance(0.5)) {
        tr.hits++;
        tr.flash = 0.3;
        sfx.impact('metal');
        if (tr.hits < 2) {
          for (let i = 0; i < 6; i++) this.b.particles.push({ x: tr.x + R.range(-4, 4), y: tr.y - h * 0.6, vx: R.range(20, 80), vy: R.range(-60, -10), life: 1.2, max: 1.2, size: R.range(4, 8), color: '#ddd', kind: 'smoke', ground: 0 });
          this.b.text(tr.x, tr.y - h - 12, 'hiss', '#e8e8e8', 11);
          return true;
        }
      } else if (pellet) return false;
      this.detonate(tr);
      return true;
    }
    return false;
  }
  detonate(tr: TrapRT) {
    if (!tr.armed) return;
    tr.armed = false;
    tr.spent = true;
    this.b.text(tr.x, tr.y - 80, 'PROPANE', '#ffd080', 16);
    this.explode(tr, tr.x, Math.max(LANES[0], Math.min(LANES[3], tr.y)));
    for (const z of this.b.zombies) if (z.state !== 'dying' && Math.abs(z.x - tr.x) < 160 && Math.abs(z.y - tr.y) < 50) z.burn = Math.max(z.burn, tr.def.fx.burn ?? 3);
    this.b.fires.push({ x: tr.x, y: tr.y, life: 3, w: 90 });
  }

  // ---------------- hook: kills (Pulper bursts douse oil and short the fence) ----------------
  onKill(z: Zed) {
    this.holds.delete(z.id);
    if (!z.def.burst) return;
    for (const t of this.list) {
      if (t.def.id === 'oil' && t.armed && Math.abs(t.x - z.x) < (t.def.area.length ?? 120) / 2 + 40) {
        t.armed = false;
        t.spent = true;
        if (t.on) { t.on = false; for (const f of this.b.fires) if (Math.abs(f.x - t.x) < 4) f.life = Math.min(f.life, 0.4); }
        this.b.text(t.x, midY() - 70, 'the bile wets the oil', '#a8862f', 12);
      }
      if (t.def.id === 'electric' && t.armed && Math.abs(t.x - z.x) < 60) {
        t.short = 15;
        this.b.text(t.x, LANES[0] - 80, 'SHORTED', '#7fb0ff', 13);
        this.b.say('The Pulper\'s bile shorts the fence. The charger clicks, and clicks.', 3);
        sfx.burst();
      }
    }
  }

  // ---------------- hook: update ----------------
  update(dt: number) {
    const b = this.b;
    this.hint = Math.max(0, this.hint - dt);
    this.timers(dt);
    this.checkIgnition();
    this.criers(dt);
    for (const z of b.zombies) {
      if (z.state === 'dying') { this.lastX.delete(z.id); continue; }
      const st = z.state as string;
      if (st !== 'walk' && st !== 'wall') { this.lastX.set(z.id, z.x); this.lureFlip.delete(z.id); continue; }
      const prev = this.lastX.get(z.id) ?? z.x;
      this.affect(z, prev, dt);
      this.lastX.set(z.id, z.x);
    }
  }

  timers(dt: number) {
    const b = this.b;
    for (const tr of this.list) {
      tr.flash = Math.max(0, tr.flash - dt);
      tr.short = Math.max(0, tr.short - dt);
      tr.rearm = Math.max(0, tr.rearm - dt);
      tr.tick += dt;
      if (tr.drop > 0 && tr.drop < 1) tr.drop = Math.min(1, tr.drop + dt * 5);
      const id = tr.def.id;
      if (id === 'barrels' && tr.on) {
        tr.t -= dt;
        if (tr.t <= 0) { tr.on = false; tr.armed = false; tr.spent = true; this.b.text(tr.x, tr.y - 70, 'burnt out', '#a08060', 11); continue; }
        if (tr.tick > 0.5) {
          tr.tick = 0;
          b.lights.push({ x: tr.x, y: tr.y - 70, r: 220, life: 0.9, max: 0.9, color: '255,150,60' });
        }
        if (R.chance(dt * 18)) b.particles.push({ x: tr.x + R.range(-10, 10), y: tr.y - 78 * depthScale(tr.y) - R.range(0, 10), vx: R.range(-6, 6), vy: R.range(-110, -50), life: 0.6, max: 0.6, size: R.range(3, 6), color: '#ffb347', kind: 'fire', ground: 0 });
        if (R.chance(dt * 3)) b.particles.push({ x: tr.x, y: tr.y - 115, vx: R.range(-4, 14), vy: R.range(-40, -20), life: 2.5, max: 2.5, size: R.range(8, 14), color: '#111', kind: 'smoke', ground: 0 });
        if (R.chance(dt / 6)) sfx.fire();
      }
      if (id === 'flare' && tr.on) { tr.t -= dt; if (tr.t <= 0) tr.on = false; }
      if (id === 'oil' && tr.on) {
        tr.t -= dt;
        if (tr.t <= 0) { tr.on = false; tr.armed = false; tr.spent = true; }
      }
      if (tr.def.fx.lure && tr.on) {
        tr.t -= dt;
        if (R.chance(dt * (id === 'radio' ? 3 : 2))) b.particles.push({ x: tr.x + R.range(-6, 6), y: tr.y - 50, vx: R.range(-15, 15), vy: R.range(-40, -20), life: 1.4, max: 1.4, size: 3, color: id === 'radio' ? '#e8d9a0' : '#c8c0b0', kind: 'spore', ground: 0 });
        if (id === 'tincan' && R.chance(dt * 2.5)) sfx.click();
        if (tr.t <= 0) {
          tr.on = false;
          if (id === 'radio') { tr.armed = false; b.text(tr.x, tr.y - 70, 'the tape runs out', '#bfb39a', 11); }
          if (tr.uses <= 0) { tr.armed = false; if (id !== 'radio') tr.spent = true; }
          for (const zid of this.lureFlip) { const z = b.zombies.find((q) => q.id === zid); if (z) z.flip = false; }
          this.lureFlip.clear();
        }
      }
      if (id === 'sludge' && tr.on) {
        tr.t -= dt;
        if (tr.t <= 0) { tr.on = false; tr.armed = false; tr.spent = true; b.text(tr.x, midY() - 60, 'trodden thin', '#8a7a4a', 11); }
      }
      if (id === 'net' && tr.on) {
        tr.t += dt;
        // torn by the sum of their wall strength; a Ferryman goes through it like paper
        let dps = 0;
        for (const z of b.zombies) if (z.state !== 'dying' && z.lane === tr.lane && z.x >= tr.x && z.x < tr.x + 140) dps += z.def.dps * (z.def.id === 'ferryman' || z.def.boss ? 10 : 1);
        tr.hp -= dps * dt;
        if (dps > 0 && R.chance(dt * 1.2)) sfx.wallHit();
        if (tr.hp <= 0 || tr.t >= (tr.def.fx.hold ?? 6)) this.tearNet(tr);
      }
      if (id === 'beartrap' && tr.hold !== undefined) {
        const z = b.zombies.find((q) => q.id === tr.hold);
        if (!z || z.state === 'dying' || !this.held(z)) {
          tr.hold = undefined;
          if (tr.uses <= 0) { tr.armed = false; tr.spent = true; } else { tr.rearm = 3; tr.armed = true; sfx.click(); }
        }
      }
      // auto rules for the manual traps
      if (id === 'tincan' && !tr.on && tr.uses > 0 && tr.uses === tr.def.uses && b.zombies.some((z) => z.state === 'walk' && !this.lureImmune(z) && Math.abs(z.x - tr.x) < 120)) this.pull(tr, true);
      if (id === 'pipemine' && tr.armed && b.zombies.filter((z) => z.state !== 'dying' && this.inCone(tr, z) > 0).length >= 3) this.firePipeMine(tr);
      if (id === 'deadfall' && tr.armed) {
        const z = this.deadfallTarget(tr);
        const st = z?.state as string | undefined;
        if (z && (st === 'climb' || st === 'leap' || st === 'over' || z.def.id === 'leaper' || (z.def.id === 'ferryman' && st === 'wall'))) this.dropDeadfall(tr);
      }
    }
  }

  // Criers: a radio drowns them out (auto on the first wind-up), and their summons go to it.
  criers(dt: number) {
    const b = this.b;
    let keened = false;
    for (const z of b.zombies) {
      if (!z.def.scream || z.state === 'dying') continue;
      const last = this.lastScream.get(z.id) ?? z.screamT;
      if (z.screamT > last + 1) {
        keened = true;
        // inside the radio's reach: half the rate
        const r = this.lures().find((t) => t.def.id === 'radio' && Math.abs(z.x - t.x) <= (t.def.fx.lure?.r ?? 380));
        if (r) z.screamT += R.range(6, 9);
      }
      this.lastScream.set(z.id, z.screamT);
      // the wind-up: the radio comes on by itself
      if (z.screamT < 0.7 && z.x < W - 20) {
        const radio = this.list.find((t) => t.def.id === 'radio' && !t.on && t.uses > 0);
        if (radio) this.pull(radio, true);
      }
    }
    const radio = this.lures().find((t) => t.def.id === 'radio');
    for (const z of b.zombies) {
      if (z.id <= this.maxId) continue;
      this.maxId = z.id;
      // summons walk to the radio and stand there listening
      if (keened && radio && !z.def.special && z.state === 'walk') {
        z.x = radio.x + R.range(30, 120);
        this.lastX.set(z.id, z.x);
      }
    }
    void dt;
  }

  // One Turned, one step: every trap it stands in, then the step it took is corrected.
  affect(z: Zed, prev: number, dt: number) {
    const b = this.b;
    let slow = 1;
    const d = z.def;
    const heavy = d.id === 'ferryman' || !!d.boss;
    const runner = !!d.lunge || d.id === 'leaper' || (d.ranged && z.state === 'walk');
    for (const tr of this.list) {
      if (!tr.armed && !(tr.on && tr.def.id === 'oil')) continue;
      const a = tr.def.area;
      const laneOk = a.allLanes || z.lane === tr.lane;
      if (!laneOk) continue;
      const hw = a.length ? a.length / 2 : Math.min(22, a.radius ?? 20);
      const inside = Math.abs(z.x - tr.x) <= hw;
      const was = Math.abs(prev - tr.x) <= hw || (prev > tr.x + hw && z.x < tr.x - hw); // crossed in one step
      const enter = (inside || was) && !tr.seen.has(z.id);
      const id = tr.def.id;
      switch (id) {
        case 'nailbomb':
          if ((inside || was) && !d.ranged) { tr.armed = false; tr.spent = true; this.explode(tr, tr.x, midY()); }
          break;
        case 'beartrap':
          if (enter && tr.hold === undefined && tr.rearm <= 0 && !d.crawl && !this.held(z)) {
            tr.seen.add(z.id);
            tr.uses--;
            tr.hold = z.id;
            tr.flash = 0.3;
            sfx.thud();
            b.text(z.x, z.y - b.zh(z) - 6, 'SNAP', '#e0c090', 13);
            const crip = tr.def.fx.cripple ?? 0;
            const dead = this.hurt(z, tr.def.fx.dmg ?? 45, tr);
            if (!dead) {
              z.x = tr.x;
              this.hold(z, heavy ? 4 : tr.def.fx.hold ?? 6, 'jaws', () => this.cripple(z, crip));
              if (d.id === 'ferryman') b.say('The bear trap has a Ferryman by the leg.', 3);
            }
          }
          break;
        case 'roofnails':
        case 'glass': {
          const immune = !!d.armor || !!d.boss || (id === 'roofnails' && !!d.crawl);
          if (!inside || immune) break;
          slow *= tr.def.fx.slow ?? 1;
          if (enter) {
            tr.seen.add(z.id);
            tr.uses--;
            const dmg = (tr.def.fx.stepDmg ?? 6) * (id === 'glass' && d.crawl ? 3 : 1);
            if (!this.hurt(z, dmg, tr) && tr.def.fx.cripple) this.cripple(z, tr.def.fx.cripple);
            if (tr.uses <= 0) { tr.armed = false; tr.spent = true; b.text(tr.x, tr.y - 20, id === 'glass' ? 'ground to sand' : 'pressed flat', '#8a8a80', 10); }
          }
          break;
        }
        case 'flare':
          if (inside || was) {
            tr.armed = false;
            tr.spent = true;
            tr.on = true;
            const L = tr.def.fx.light!;
            b.lights.push({ x: tr.x, y: tr.y - 20, r: L.r, life: L.time, max: L.time, color: '255,90,70' });
            z.burn = Math.max(z.burn, tr.def.fx.burn ?? 1);
            b.noise += tr.def.noise;
            sfx.fire();
            b.text(tr.x, tr.y - 60, 'flare', '#ff7060', 12);
            tr.t = L.time;
          }
          break;
        case 'oil':
          if (inside && !tr.on) slow *= tr.def.fx.slow ?? 0.75;
          break;
        case 'propane':
          if (d.id === 'ferryman' && Math.abs(z.x - tr.x) < 26 && tr.rearm <= 0) {
            tr.x += 80;
            tr.rearm = 2;
            sfx.impact('metal');
            b.text(tr.x, tr.y - 50, 'kicked', '#c0c0c0', 11);
          }
          break;
        case 'barrels':
          if (!tr.on || !inside) break;
          if (d.id === 'ferryman' || d.boss) {
            tr.on = false; tr.armed = false; tr.spent = true;
            b.fires.push({ x: tr.x, y: tr.y, life: 6, w: 60 });
            b.text(tr.x, tr.y - 80, 'knocked over', '#ffb347', 12);
            sfx.thud();
            this.igniteNear(tr.x - 90, tr.x + 90);
            break;
          }
          if (enter) {
            tr.seen.add(z.id);
            if (!this.reLane(z)) z.burn = Math.max(z.burn, 1.2);
          } else if (z.lane === tr.lane) z.burn = Math.max(z.burn, 0.5);
          break;
        case 'snare':
          if (!enter) { if (inside) slow *= tr.def.fx.slow ?? 0.85; break; }
          tr.seen.add(z.id);
          if (d.id === 'ferryman') {
            tr.armed = false; tr.spent = true;
            sfx.thud();
            b.text(tr.x, tr.y - 60, 'the line snaps', '#bfb39a', 11);
          } else if (runner && !d.crawl) {
            tr.uses--;
            this.hold(z, tr.def.fx.knockdown ?? 2.5, 'prone');
            sfx.thud();
            b.text(z.x, z.y - b.zh(z) * 0.6, 'tripped', '#d9c9a0', 12);
            for (let i = 0; i < 6; i++) b.particles.push({ x: z.x + R.range(-20, 20), y: z.y - 4, vx: R.range(-40, 40), vy: R.range(-40, -10), life: 0.8, max: 0.8, size: R.range(5, 9), color: '#555', kind: 'smoke', ground: 0 });
            if (tr.uses <= 0) { tr.armed = false; tr.spent = true; }
          }
          break;
        case 'spikepit':
          if (!enter) break;
          tr.seen.add(z.id);
          if (d.lunge || d.id === 'leaper' || tr.bodies >= (tr.def.fx.holdCount ?? 4)) break; // jumped, or walked across the full pit
          tr.bodies++;
          tr.uses--;
          tr.flash = 0.3;
          sfx.thud();
          if (R.chance(0.15)) sfx.scream();
          b.text(z.x, z.y - 40, 'into the pit', '#c9a07a', 12);
          if (!this.hurt(z, tr.def.fx.dmg ?? 140, tr)) { z.x = tr.x; this.hold(z, d.id === 'ferryman' ? 1 : tr.def.fx.hold ?? 3, 'pit'); }
          if (tr.bodies >= (tr.def.fx.holdCount ?? 4)) { tr.armed = false; tr.spent = true; b.text(tr.x, tr.y - 60, 'the pit is full', '#a08060', 12); }
          break;
        case 'electric': {
          if (!inside || tr.short > 0) break;
          const cd = tr.cd.get(z.id) ?? 0;
          if (b.t < cd) break;
          tr.cd.set(z.id, b.t + 1);
          tr.uses--;
          tr.flash = 0.18;
          sfx.click();
          b.lights.push({ x: tr.x, y: z.y - 40, r: 120, life: 0.12, max: 0.12, color: '140,180,255' });
          for (let i = 0; i < 5; i++) b.particles.push({ x: tr.x + R.range(-4, 4), y: z.y - R.range(10, 60), vx: R.range(-90, 90), vy: R.range(-90, 30), life: 0.25, max: 0.25, size: 2, color: '#a8c8ff', kind: 'spark', ground: 0 });
          const dmg = (tr.def.fx.dmg ?? 28) * (d.id === 'deputy' ? 2 : 1);
          if (!this.hurt(z, dmg, tr) && d.id !== 'ferryman' && !d.boss) this.hold(z, tr.def.fx.stun ?? 0.6, 'stun');
          if (tr.uses <= 0) { tr.armed = false; tr.spent = true; b.text(tr.x, LANES[0] - 70, 'the charger trips', '#7fb0ff', 12); }
          break;
        }
        case 'net':
          if (d.id === 'leaper') break; // Bucks jump it
          if (!tr.on && inside && !tr.spent) {
            tr.on = true;
            tr.t = 0;
            sfx.wallHit();
            b.text(tr.x, tr.y - 70, 'the net holds', '#c0b090', 12);
          }
          if (tr.on && z.x < tr.x + 14 + b.zw(z) * 0.3 && prev >= tr.x - 6) {
            // pressed into the chain-link: they heap up behind it
            z.x = Math.max(z.x, tr.x + 14 + b.zw(z) * 0.3);
            if (z.state === 'wall') z.state = 'walk';
          }
          break;
        case 'sludge':
          if (!inside || d.ranged || b.surge > 0) break;
          if (!tr.on) { tr.on = true; tr.t = tr.def.uses; b.text(tr.x, midY() - 60, 'they stop, and listen', '#a89a6a', 12); }
          slow *= tr.def.fx.calm ?? 0.35;
          if (d.scream) z.screamT = Math.max(z.screamT, 0.8);
          break;
      }
    }
    // the step it took, corrected
    const h = this.holds.get(z.id);
    if (h) {
      h.t -= dt;
      z.x = h.x;
      if (z.state === 'wall' && h.why !== 'stagger') z.state = 'walk';
      if (h.t <= 0) { this.holds.delete(z.id); h.then?.(); }
      return;
    }
    if (z.x < prev && slow < 1) z.x = prev + (z.x - prev) * slow;
    this.steer(z, prev, dt);
  }

  /** Lures: everything inside the reach walks to the post and mills there. */
  steer(z: Zed, prev: number, dt: number) {
    if (this.lureImmune(z)) return;
    let L: TrapRT | undefined;
    for (const t of this.lures()) if (Math.abs(z.x - t.x) <= t.def.fx.lure!.r && (!L || Math.abs(z.x - t.x) < Math.abs(z.x - L.x))) L = t;
    if (!L) {
      if (this.lureFlip.delete(z.id)) z.flip = false;
      return;
    }
    // each one picks a spot around the post (the radio's listeners stand back a little)
    const off = ((z.id * 37) % 41) - 20 + (L.def.id === 'radio' ? 34 : 6);
    const spot = L.x + off;
    if (z.x > spot + 6) {
      // walking in (its own step already took it toward the wall); stop at the spot
      if (z.x < spot) z.x = spot;
      if (this.lureFlip.delete(z.id)) z.flip = false;
    } else if (z.x < spot - 6) {
      // between the post and the wall: turned around, walked back out to the noise
      if (z.state === 'wall') z.state = 'walk';
      z.x = prev + z.def.speed * 0.8 * dt;
      if (!z.flip) { z.flip = true; this.lureFlip.add(z.id); }
    } else {
      z.x = Math.max(prev, spot - 6);
      if (z.state === 'wall') z.state = 'walk';
      if (this.lureFlip.delete(z.id)) z.flip = false;
    }
  }

  /** Burning barrels: balk into the nearest lane with room; false if boxed in. */
  reLane(z: Zed): boolean {
    const w = this.b.zw(z);
    const opts = [z.lane - 1, z.lane + 1].filter((l) => l >= 0 && l < LANES.length);
    if (R.chance(0.5)) opts.reverse();
    for (const l of opts) {
      if (this.list.some((t) => t.def.id === 'barrels' && t.on && t.lane === l && Math.abs(t.x - z.x) < 60)) continue;
      const room = this.b.zombies.every((o) => o === z || o.state === 'dying' || o.lane !== l || Math.abs(o.x - z.x) > 0.6 * w);
      if (!room) continue;
      z.lane = l;
      z.ty = LANES[l] + R.range(-3, 3);
      z.laneCd = 1.2;
      return true;
    }
    return false;
  }

  // ---------------- hook: end of night ----------------
  onEnd(r: { lines: string[] }) {
    lastSpent = this.list.filter((t) => t.spent).map((t) => t.idx);
    for (const t of this.list) {
      if (t.kills >= 6) r.lines.push(`The ${t.def.name.toLowerCase()} on Ferry Road accounted for ${t.kills} of them.`);
    }
    for (const id of this.lureFlip) { const z = this.b.zombies.find((q) => q.id === id); if (z) z.flip = false; }
  }

  // ---------------- drawing ----------------
  drawGround(c: CanvasRenderingContext2D) {
    void c; // decals go in the sorted pass (after the darkness, behind every lane): see decals()
  }

  decals(c: CanvasRenderingContext2D) {
    for (const tr of this.list) {
      const id = tr.def.id;
      const hw = (tr.def.area.length ?? 40) / 2;
      if (id === 'oil' && (tr.armed || tr.on) && has('trap_oil')) {
        // the generated puddle across every lane; burning, it reads scorched; a moon sheen on top
        for (let l = 0; l < 4; l++) {
          const y = LANES[l] + 2, s = depthScale(y);
          drawProp(c, 'trap_oil', tr.x + (l - 1.5) * 4, y + 4 * s, 9 * s, LOOK[l], { w: hw * 2 * (0.92 + l * 0.03), b: tr.on ? 0.6 : 1, flip: l % 2 === 1, alpha: 0.85 });
          c.strokeStyle = `rgba(160,180,215,${0.2 + 0.1 * Math.sin(tr.tick * 1.3 + l)})`;
          c.lineWidth = 1.2;
          c.beginPath(); c.ellipse(tr.x - hw * 0.25, y - 1, hw * 0.4, 3 * s, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
        }
      } else if (id === 'oil' && (tr.armed || tr.on)) {
        c.save();
        // a dark glossy smear across every lane, with a moon sheen
        for (let l = 0; l < 4; l++) {
          const y = LANES[l] + 2, s = depthScale(y);
          c.fillStyle = tr.on ? 'rgba(40,20,8,0.75)' : 'rgba(4,4,6,0.55)';
          c.beginPath(); c.ellipse(tr.x + (l - 1.5) * 4, y, hw * (0.92 + l * 0.03), 9 * s, 0, 0, Math.PI * 2); c.fill();
          c.strokeStyle = `rgba(160,180,215,${0.3 + 0.12 * Math.sin(tr.tick * 1.3 + l)})`;
          c.lineWidth = 1.5;
          c.beginPath(); c.ellipse(tr.x - hw * 0.25, y - 2, hw * 0.4, 3 * s, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
        }
        c.restore();
      } else if (id === 'sludge' && (tr.armed || tr.on)) {
        c.fillStyle = 'rgba(44,38,16,0.5)'; // dark rot smear (the old olive read as paint over the night road)
        for (let l = 0; l < 4; l++) { const y = LANES[l] + 2; c.beginPath(); c.ellipse(tr.x + Math.sin(l * 2.1) * 10, y, hw * 0.9, 8 * depthScale(y), 0.04 * l, 0, Math.PI * 2); c.fill(); }
      } else if ((id === 'roofnails' || id === 'glass') && tr.armed) {
        const spr = id === 'glass' ? 'trap_glass' : 'trap_roofnails';
        // the strip itself (generated), thinned as it is used up; the glints stay procedural
        const left = tr.uses / tr.def.uses;
        if (has(spr)) {
          const s = depthScale(tr.y);
          drawProp(c, spr, tr.x, tr.y + 4 * s, 12 * s, LOOK[tr.lane], { w: hw * 2, alpha: 0.45 + 0.55 * left });
        }
        // glints scattered in the band
        const y0 = tr.y;
        const n = Math.round(10 + 22 * (tr.uses / tr.def.uses));
        for (let i = 0; i < n; i++) {
          const fx = Math.sin(i * 91.7 + tr.idx) * 0.5 + 0.5, fy = Math.sin(i * 37.3 + tr.idx * 3) * 0.5 + 0.5;
          const x = tr.x - hw + fx * hw * 2, y = y0 - 6 + fy * 10;
          const tw = 0.5 + 0.5 * Math.sin(tr.tick * 3 + i);
          c.fillStyle = id === 'glass' ? (i % 2 ? `rgba(110,170,110,${0.35 + 0.4 * tw})` : `rgba(160,120,70,${0.35 + 0.4 * tw})`) : `rgba(170,175,185,${0.3 + 0.45 * tw})`;
          c.fillRect(x, y, 2, 1.5);
        }
      } else if (id === 'spikepit' && !tr.spent || id === 'spikepit' && tr.bodies > 0) {
        const im = sprite('trap_pit');
        const s = depthScale(tr.y), w = 84 * s, h = (w * 50) / 90;
        // lane-graded like the other kits (the raw sprite read brighter than the road around it)
        if (drawProp(c, 'trap_pit', tr.x, tr.y - h * 0.62 + h, h, LOOK[tr.lane], { w })) { /* sprite */ }
        else if (im) c.drawImage(im, tr.x - w / 2, tr.y - h * 0.62, w, h);
        else { c.fillStyle = '#0c0b0a'; c.beginPath(); c.ellipse(tr.x, tr.y, w / 2, 8 * s, 0, 0, Math.PI * 2); c.fill(); }
        if (tr.bodies) { c.fillStyle = `rgba(30,14,10,${0.25 * tr.bodies})`; c.beginPath(); c.ellipse(tr.x, tr.y - 2, w * 0.4, 6 * s, 0, 0, Math.PI * 2); c.fill(); }
      }
    }
  }

  sorted(c: CanvasRenderingContext2D): SortedDraw[] {
    const out: SortedDraw[] = [{ y: LANES[0] - 8, f: () => this.decals(c) }];
    for (const tr of this.list) {
      const id = tr.def.id;
      const s = depthScale(tr.y);
      const look = LOOK[tr.lane];
      if (id === 'nailbomb' && tr.armed && has('trap_nailbomb')) out.push({ y: tr.y - 0.3, f: () => { drawProp(c, 'trap_nailbomb', tr.x, tr.y + 2, 16 * s, look); } });
      else if (id === 'sludge' && (tr.armed || tr.on) && has('trap_sludge')) out.push({ y: tr.y - 0.2, f: () => {
        // the jar, tipped over once it has been opened
        drawProp(c, 'trap_sludge', tr.x, tr.y + 1, 22 * s, look, tr.on ? { rot: 1.35, ay: 0.85 } : {});
      } });
      else if (id === 'beartrap' && !tr.spent) out.push({ y: tr.y - 0.5, f: () => {
        const im = sprite('trap_bear');
        const w = 54 * s, shut = tr.hold !== undefined;
        const h = (w * 40) / 92 * (shut ? 0.55 : 1);
        // graded by lane like every other prop (a raw sprite read brighter than the road around it)
        if (!drawProp(c, 'trap_bear', tr.x, tr.y + 2, h, look, { w })) { if (im) c.drawImage(im, tr.x - w / 2, tr.y - h + 2, w, h); }
        if (tr.rearm > 0) { c.fillStyle = 'rgba(200,190,160,0.5)'; c.fillRect(tr.x - 2, tr.y - h - 6, 4, 4); }
      } });
      else if (id === 'propane' && tr.armed) out.push({ y: tr.y - 0.4, f: () => {
        const im = sprite('trap_propane');
        const h = 46 * s, w = (h * 42) / 64;
        // lane-graded and a touch brighter than the road so it still reads as the thing to shoot;
        // no per-frame shadowBlur halo (it read as a white blob and cost a blur pass every frame)
        if (!drawProp(c, 'trap_propane', tr.x, tr.y, h, look, { w, b: 1.1 })) {
          if (im) c.drawImage(im, tr.x - w / 2, tr.y - h, w, h);
          else { c.fillStyle = '#ddd'; c.fillRect(tr.x - w / 2, tr.y - h, w, h); }
        }
        if (this.b.hover === undefined && this.onTank(tr)) {
          c.strokeStyle = 'rgba(255,220,150,0.7)'; c.lineWidth = 1.5;
          c.strokeRect(tr.x - w / 2 - 3, tr.y - h - 3, w + 6, h + 6);
        }
      } });
      else if (id === 'barrels' && (tr.on || !tr.spent)) out.push({ y: tr.y - 0.3, f: () => {
        const im = sprite('trap_barrel');
        const h = 80 * s, w = (h * 56) / 110; // a 55-gal drum: 0.88 m × 0.57 m at 90 px/m (was 0.64 m, smaller than it reads next to the 0.5 m propane tank)
        for (let k = -1; k <= 1; k++) if (!drawProp(c, 'trap_barrel', tr.x + k * w * 0.8, tr.y + Math.abs(k) * 2 * s, h, look, { w, b: tr.on ? 1.15 : 1 }) && im) c.drawImage(im, tr.x + k * w * 0.8 - w / 2, tr.y - h + Math.abs(k) * 2 * s, w, h);
        if (tr.on) {
          c.save(); c.globalCompositeOperation = 'lighter';
          const g = c.createRadialGradient(tr.x, tr.y - h, 0, tr.x, tr.y - h, 40 * s);
          g.addColorStop(0, `rgba(255,160,60,${0.5 + 0.15 * Math.sin(tr.tick * 11)})`); g.addColorStop(1, 'rgba(255,120,40,0)');
          c.fillStyle = g; c.fillRect(tr.x - 50, tr.y - h - 50, 100, 100); c.restore();
        }
      } });
      else if (id === 'net' && !tr.spent) out.push({ y: tr.y - 0.2, f: () => {
        const im = sprite('trap_net');
        const load = tr.on ? Math.max(0, Math.min(1, (1 - tr.hp / (tr.def.fx.hp ?? 240)) + 0.3)) : 0;
        const h = 46 * s, w = 84 * s;
        c.save();
        c.translate(tr.x, tr.y);
        c.transform(1, 0, -0.18 * load, 1, 0, 0);
        if (!drawProp(c, 'trap_net', load * 6, 0, h, look, { w }) && im) c.drawImage(im, -w / 2 + load * 6, -h, w, h);
        c.restore();
      } });
      else if (id === 'tincan' && !tr.spent && has('trap_tincan')) out.push({ y: tr.y - 0.2, f: () => {
        // the post shakes when the cord is pulled
        const sw = tr.on ? Math.sin(tr.tick * 18) * 0.07 : 0;
        drawProp(c, 'trap_tincan', tr.x, tr.y + 1, 52 * s, look, { rot: sw });
        if (tr.on) this.ring(c, tr);
      } });
      else if (id === 'tincan' && !tr.spent) out.push({ y: tr.y - 0.2, f: () => {
        c.fillStyle = '#2a241e'; c.fillRect(tr.x - 2, tr.y - 48 * s, 4 * s, 48 * s);
        for (let k = 0; k < 4; k++) {
          const sw = tr.on ? Math.sin(tr.tick * 18 + k) * 4 : Math.sin(tr.tick + k) * 0.6;
          c.fillStyle = k % 2 ? '#8a8a84' : '#a09a88';
          c.fillRect(tr.x - 9 + k * 5 + sw, tr.y - 40 * s + (k % 2) * 6, 4 * s, 6 * s);
        }
        if (tr.on) this.ring(c, tr);
      } });
      else if (id === 'radio' && (tr.armed || tr.on)) out.push({ y: tr.y - 0.2, f: () => {
        if (drawProp(c, 'trap_radio', tr.x, tr.y + 1, 34 * s, look)) { if (tr.on) this.ring(c, tr); return; }
        const im = sprite('icon_trap_radio');
        const w = 34 * s, h = (w * 96) / 112;
        if (im) c.drawImage(im, tr.x - w / 2, tr.y - h, w, h);
        else { c.fillStyle = '#333'; c.fillRect(tr.x - w / 2, tr.y - h, w, h); }
        if (tr.on) this.ring(c, tr);
      } });
      else if (id === 'pipemine' && tr.armed) out.push({ y: tr.y - 0.2, f: () => {
        if (drawProp(c, 'trap_pipemine', tr.x, tr.y + 1, 22 * s, look)) return;
        c.strokeStyle = '#2a2622'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(tr.x - 6, tr.y); c.lineTo(tr.x - 2, tr.y - 12 * s); c.lineTo(tr.x + 4, tr.y); c.stroke();
        c.fillStyle = '#4a463e'; c.fillRect(tr.x - 2, tr.y - 22 * s, 7 * s, 14 * s);
        c.fillStyle = 'rgba(200,190,150,0.6)'; c.fillRect(tr.x + 4 * s, tr.y - 20 * s, 1.5, 10 * s);
      } });
      else if (id === 'flare' && (tr.armed || tr.t > 0)) out.push({ y: tr.y - 0.2, f: () => {
        if (!drawProp(c, 'trap_flare', tr.x, tr.y + 1, 24 * s, look, { b: tr.on || !tr.armed ? 0.7 : 1 })) { c.fillStyle = '#3a342c'; c.fillRect(tr.x - 4 * s, tr.y - 10 * s, 8 * s, 10 * s); }
        if (tr.on && tr.t > 0) {
          c.save(); c.globalCompositeOperation = 'lighter';
          c.fillStyle = `rgba(255,80,60,${0.6 + 0.3 * Math.sin(tr.tick * 30)})`;
          c.beginPath(); c.arc(tr.x, tr.y - 12 * s, 5 * s, 0, 7); c.fill(); c.restore();
          if (R.chance(0.4)) this.b.particles.push({ x: tr.x, y: tr.y - 14 * s, vx: R.range(-30, 30), vy: R.range(-90, -30), life: 0.4, max: 0.4, size: 2, color: '#ff8060', kind: 'spark', ground: tr.y });
        }
      } });
      else if (id === 'deadfall') out.push({ y: 700.6, f: () => this.drawDeadfall(c, tr) });
      else if ((id === 'electric' || id === 'snare') && !tr.spent) {
        // posts at each lane, a strand per lane (shin height for the snare)
        for (let l = 0; l < 4; l++) out.push({ y: LANES[l] + 0.8, f: () => {
          const y = LANES[l], sl = depthScale(y), x = tr.x + (l - 1.5) * 3;
          const post = id === 'snare' ? 'trap_snarepost' : 'trap_fencepost';
          if (!drawProp(c, post, x, y + 1, (id === 'snare' ? 26 : 56) * sl, LOOK[l])) {
            c.fillStyle = '#1e1b18';
            c.fillRect(x - 1.5, y - (id === 'snare' ? 22 : 52) * sl, 3 * sl, (id === 'snare' ? 22 : 52) * sl);
          }
          // the fence's charger, on the near post, with its lead to the generator
          if (id === 'electric' && l === 3) drawProp(c, 'trap_fencegen', x - 16 * sl, y + 3, 26 * sl, LOOK[3], { b: tr.armed && tr.short <= 0 ? 1 : 0.6 });
          if (l === 3) return;
          const y2 = LANES[l + 1], x2 = tr.x + (l - 0.5) * 3, s2 = depthScale(y2);
          const strands = id === 'snare' ? [14] : [16, 30, 44];
          for (const hgt of strands) {
            const shock = id === 'electric' && tr.flash > 0;
            c.strokeStyle = shock ? 'rgba(170,200,255,0.95)' : id === 'snare' ? 'rgba(170,165,150,0.55)' : tr.short > 0 || !tr.armed ? 'rgba(60,58,55,0.8)' : 'rgba(95,98,104,0.85)';
            c.lineWidth = shock ? 2 : 1;
            c.beginPath(); c.moveTo(x, y - hgt * sl); c.lineTo(x2, y2 - hgt * s2); c.stroke();
          }
        } });
      }
    }
    return out;
  }

  onTank(tr: TrapRT) {
    const s = depthScale(tr.y), w = 30 * s, h = 46 * s, m = this.b.mouse;
    return m.x > tr.x - w / 2 - 6 && m.x < tr.x + w / 2 + 6 && m.y > tr.y - h - 6 && m.y < tr.y + 4;
  }

  ring(c: CanvasRenderingContext2D, tr: TrapRT) {
    const r = tr.def.fx.lure!.r;
    const k = (tr.tick * 0.8) % 1;
    c.strokeStyle = `rgba(230,210,150,${0.35 * (1 - k)})`;
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(tr.x, midY(), r * k, r * k * 0.12, 0, 0, Math.PI * 2); c.stroke();
  }

  drawDeadfall(c: CanvasRenderingContext2D, tr: TrapRT) {
    if (tr.drop >= 1 && tr.spent && tr.tick > 30) return;
    const wx = laneWallX(tr.lane), y = LANES[tr.lane];
    const s = depthScale(y);
    const top = y - 150 * s;
    const fall = tr.drop * 100 * s;
    if (has('trap_gallows') && has('trap_door')) {
      // the gallows arm reaches over the lane; the door hangs off its pulley, then drops and tips
      // trap_gallows: post at 0.15 of its width, pulley at (0.55, 0.19); sized so the pulley hangs over the lane
      const pulleyX = wx + 16, pulleyY = top - 30 * s;
      const gh = (y + 2 - pulleyY) / (1 - 0.19);
      const gw = (gh * 176) / 380;
      drawProp(c, 'trap_gallows', pulleyX - (0.55 - 0.15) * gw, y + 2, gh, LOOK[tr.lane], { ax: 0.15 });
      if (tr.drop <= 0) { c.strokeStyle = '#2a241d'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(pulleyX, pulleyY + 4 * s); c.lineTo(pulleyX, top + 2); c.stroke(); }
      drawProp(c, 'trap_door', pulleyX, top + fall, 40 * s, LOOK[tr.lane], { ay: 0, rot: tr.drop * 0.5 });
      return;
    }
    // a rope over a pole, a Buick door on the end of it
    c.strokeStyle = '#3a3128'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(wx - 30, top - 30 * s); c.lineTo(wx + 18, top - 30 * s); c.stroke();
    if (tr.drop <= 0) { c.lineWidth = 1; c.beginPath(); c.moveTo(wx + 16, top - 30 * s); c.lineTo(wx + 16, top); c.stroke(); }
    c.save();
    c.translate(wx + 16, top + fall);
    c.rotate(tr.drop * 0.5);
    c.fillStyle = '#3c4048';
    c.fillRect(-14 * s, 0, 28 * s, 34 * s);
    c.fillStyle = '#5a6068';
    c.fillRect(-11 * s, 3 * s, 22 * s, 11 * s);
    c.fillStyle = '#6e6a62';
    c.fillRect(-6 * s, 26 * s, 12 * s, 10 * s);
    c.restore();
  }

  drawOver(c: CanvasRenderingContext2D) {
    if (!this.list.length || this.b.intro > 0) return;
    const parts: string[] = [];
    const lures = this.list.filter((t) => t.def.fx.lure && t.uses > 0 && !t.spent && !t.on).length;
    if (this.list.some((t) => t.def.fx.lure)) parts.push(`${keyCap('night.lure')} lure${lures ? ` ×${lures}` : ' —'}`);
    const g = this.list.filter((t) => (t.def.id === 'deadfall' || t.def.id === 'pipemine') && t.armed);
    if (this.list.some((t) => t.def.id === 'deadfall' || t.def.id === 'pipemine')) parts.push(`${keyCap('night.trap')} ${g.map((t) => (t.def.id === 'deadfall' ? 'deadfall' : 'pipe mine')).join(', ') || '—'}`);
    if (this.list.some((t) => t.def.id === 'propane' && t.armed)) parts.push('shoot the propane');
    if (!parts.length) return;
    c.save();
    c.font = '12px "Special Elite", monospace';
    c.textAlign = 'left';
    c.fillStyle = `rgba(216,196,140,${0.6 + 0.4 * Math.min(1, this.hint)})`;
    c.fillText(`traps: ${parts.join('   ·   ')}`, 20, 720 - 40);
    c.restore();
  }
}
