// Hand-to-hand at the wall. [V] swings the leader's melee weapon (Survivor.melee → G.melee,
// folded by meleeProfile) at whatever is pressed against the barricade, climbing it, coming
// over it, or landing behind it. Guards who run dry use theirs too (meleeGuard, called by the
// battle in place of the old fists/building-skill blow).
//
//   swing: wind-up (swingTime) → the blow lands on up to `arc` bodies, nearest the crosshair
//          first, across adjacent lanes → recovery. Each swing costs stamina (regen 18/s);
//          swinging tired does half damage, slower.
//   crit:  an overhead blow (crosshair above the head line, or on a climber) × crit.
//   knock / stagger (a stagger stops it, and breaks a grab) / bleed (BLEED_TIME s) /
//   finisher (crawlers die outright) / wear (breaks at 0) / chainsaw: fuel per swing, noise.
import type { Battle } from './battle';
import { LANES } from './battle';
import type { BattleHook, Zed, Guardian, SortedDraw } from './hook';
import type { Traps } from './traps';
import type { WeaponItem } from '../types';
import { G, R, add } from '../state';
import { sfx } from '../audio';
import { MELEE, meleeProfile, FISTS, BLEED_TIME, type MeleeProfile } from '../data/weapons';
import { first, level, gainProf } from '../sim/survivors';
import { depthScale } from './render';

const WALL_X = 372;
const laneWallX = (lane: number) => WALL_X + (LANES[3] - LANES[lane]) * 0.12;
const STAMINA_REGEN = 18;

const byBattle = new WeakMap<Battle, Melee>();

interface Swing { t: number; wind: number; prof: MeleeProfile; item?: WeaponItem; tired: boolean; done: boolean; g: Guardian }
interface Slash { x: number; y: number; t: number; r: number; crit: boolean }

function itemOf(g: Guardian): WeaponItem | undefined {
  return g.s.melee ? (G.melee ?? []).find((m) => m.uid === g.s.melee && MELEE[m.def]) : undefined;
}
function profOf(g: Guardian): { prof: MeleeProfile; item?: WeaponItem } {
  const item = itemOf(g);
  const lv = level(g.s, 'prof_melee');
  const mods = { dmgMul: 1 + lv * 0.03, speedMul: 1 - lv * 0.02, staminaMul: 1 - lv * 0.03 };
  if (item) return { prof: meleeProfile(item, mods), item };
  return { prof: { ...FISTS, dmg: Math.round(FISTS.dmg * mods.dmgMul) } };
}

export class Melee implements BattleHook {
  b: Battle;
  traps?: Traps;
  stamina = new Map<string, number>(); // by survivor id, 0..100
  swing?: Swing;
  cd = 0;
  bleed = new Map<number, { dps: number; t: number; g: Guardian | null }>();
  slashes: Slash[] = [];
  meleeKills = new Map<string, number>();
  swings = 0;

  constructor(b: Battle, traps?: Traps) {
    this.b = b;
    this.traps = traps;
    byBattle.set(b, this);
  }

  sta(g: Guardian) { return this.stamina.get(g.s.id) ?? 100; }

  /** Everything a blow from the wall (or from behind it, at x) can reach. */
  reachable(gx: number, reach: number): Zed[] {
    const out: Zed[] = [];
    for (const z of this.b.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0.3)) continue;
      const st = z.state as string;
      if (st === 'over' || st === 'maul') { if (Math.abs(z.x - gx) <= reach + 40) out.push(z); continue; }
      if (st === 'wall' || st === 'walk' || st === 'climb' || st === 'leap') {
        // from the top of the barricade: distance from the wall's face to the body's near edge
        const edge = z.x - this.b.zw(z) * 0.5 - laneWallX(z.lane);
        if (edge <= reach + 18 && !z.flip) out.push(z);
      }
    }
    return out;
  }

  /** The bodies one swing finds: the one nearest the crosshair, then its neighbours (adjacent lanes). */
  pickTargets(cands: Zed[], arc: number, aim?: { x: number; y: number }): Zed[] {
    if (!cands.length) return [];
    const inside = (z: Zed) => (z.state as string) === 'over' || (z.state as string) === 'maul';
    // the ones already over the wall come first: they are on top of us
    const over = cands.filter(inside);
    let primary: Zed;
    if (over.length) primary = over.sort((a, b) => Math.abs(a.x - (aim?.x ?? a.x)) - Math.abs(b.x - (aim?.x ?? b.x)))[0];
    else if (aim) {
      const hv = this.b.hover && cands.includes(this.b.hover) ? this.b.hover : undefined;
      primary = hv ?? cands.slice().sort((a, b) => Math.hypot(a.x - aim.x, (a.y - this.b.zh(a) * 0.6 - aim.y) * 0.6) - Math.hypot(b.x - aim.x, (b.y - this.b.zh(b) * 0.6 - aim.y) * 0.6))[0];
    } else primary = cands.slice().sort((a, b) => a.x - b.x)[0];
    const rest = cands
      .filter((z) => z !== primary && (inside(primary) ? inside(z) : Math.abs(z.lane - primary.lane) <= 1 && !inside(z)))
      .sort((a, b) => Math.abs(a.x - primary.x) + Math.abs(a.lane - primary.lane) * 20 - (Math.abs(b.x - primary.x) + Math.abs(b.lane - primary.lane) * 20));
    return [primary, ...rest].slice(0, Math.max(1, arc));
  }

  /** Start a swing for guard g. Returns false if it cannot (stamina is spent anyway when tired). */
  startSwing(g: Guardian, isPlayer: boolean): Swing | null {
    const { prof, item } = profOf(g);
    if (prof.fuel > 0) {
      if ((G.stores.fuel ?? 0) < prof.fuel) {
        if (isPlayer) { this.b.say('The chainsaw coughs and will not start. No fuel.', 2); sfx.click(); }
        return null;
      }
      add('fuel', -prof.fuel);
    }
    const st = this.sta(g);
    const tired = st < prof.stamina;
    this.stamina.set(g.s.id, Math.max(0, st - prof.stamina));
    const k = tired ? 1.4 : 1;
    this.b.noise += prof.noise;
    sfx.melee('swing', item?.def ?? 'fists', { volume: isPlayer ? 1 : 0.5 });
    return { t: 0, wind: prof.swingTime * k, prof, item, tired, done: false, g };
  }

  /** The blow lands. */
  land(sw: Swing, isPlayer: boolean) {
    sw.done = true;
    const g = sw.g, prof = sw.prof;
    const aim = isPlayer ? this.b.mouse : undefined;
    const targets = this.pickTargets(this.reachable(g.x, prof.reach), prof.arc, aim);
    // the leader steps up to the wall to swing (the battle walks them back to their slot)
    if (isPlayer) {
      const to = targets[0] && ((targets[0].state as string) === 'over' || (targets[0].state as string) === 'maul') ? targets[0].x - 36 : WALL_X - 38;
      if (Math.abs(to - g.x) < 140) g.x += (to - g.x) * 0.6;
      g.face = to < g.x ? -1 : 1;
    }
    if (!targets.length) {
      if (isPlayer) { this.slashes.push({ x: WALL_X + 20, y: LANES[2] - 70, t: 0.15, r: prof.reach * 0.6, crit: false }); }
      return;
    }
    const wname = sw.item?.def ?? 'fists';
    for (const z of targets) {
      const h = this.b.zh(z);
      const headY = z.y - h * (1 - z.def.head);
      const st = z.state as string;
      const overhead = st === 'climb' || st === 'leap' || (aim !== undefined && aim.y < headY && Math.abs(aim.x - z.x) < 60);
      const crit = overhead ? prof.crit : 1;
      let dmg = prof.dmg * crit * (sw.tired ? 0.5 : 1);
      if (prof.finisher && z.def.crawl) dmg = Math.max(dmg, z.hp + 1);
      const px = z.x - this.b.zw(z) * 0.3, py = overhead ? headY : z.y - h * 0.55;
      const before = z.state;
      this.b.damage(z, dmg, false, prof.knock * (sw.tired ? 0.6 : 1), g, false, px, py, isPlayer);
      sfx.melee(crit > 1 || dmg >= 60 ? 'heavy' : 'hit', wname, { volume: isPlayer ? 1 : 0.6 });
      if (crit > 1) this.b.text(z.x, headY - 14, 'OVERHEAD', '#e8d0a0', 12);
      this.slashes.push({ x: px, y: py, t: 0.16, r: 26 + prof.reach * 0.25, crit: crit > 1 });
      if (sw.item) {
        sw.item.cond = Math.max(0, sw.item.cond - prof.wear);
      }
      if ((z.state as string) === 'dying') {
        this.meleeKills.set(g.s.id, (this.meleeKills.get(g.s.id) ?? 0) + 1);
        if (sw.item) sw.item.kills++;
        continue;
      }
      // stagger: stops it in place for a moment, and tears a grab loose
      if (R.chance(prof.stagger)) {
        if (before === 'maul') { z.state = 'over'; z.maulT = 0.9; z.x += (z.flip ? -1 : 1) * 30; }
        else if (this.traps && (before === 'wall' || before === 'walk')) this.traps.hold(z, 0.35 + prof.stagger * 0.5, 'stagger');
        this.b.text(z.x, z.y - h - 4, 'staggered', '#bfb39a', 10);
      }
      if (prof.bleed > 0) this.bleed.set(z.id, { dps: prof.bleed, t: BLEED_TIME, g });
    }
    if (sw.item && sw.item.cond <= 0) this.breakItem(g, sw.item);
  }

  breakItem(g: Guardian, item: WeaponItem) {
    G.melee = (G.melee ?? []).filter((m) => m !== item);
    if (g.s.melee === item.uid) g.s.melee = null;
    this.b.say(`${first(g.s)}'s ${MELEE[item.def].name.toLowerCase()} breaks.`, 3);
    sfx.impact('wood');
  }

  // ---------------- the leader: [V] ----------------
  onKey(e: KeyboardEvent) {
    if (e.key !== 'v' && e.key !== 'V') return false;
    if (this.b.done || this.b.paused || this.b.intro > 3.2) return true;
    const p = this.b.player;
    if (!p || this.swing || this.cd > 0) return true;
    const sw = this.startSwing(p, true);
    if (sw) { this.swing = sw; this.swings++; }
    return true;
  }

  update(dt: number) {
    const b = this.b;
    // stamina comes back
    for (const g of b.guards) {
      const s = this.stamina.get(g.s.id);
      if (s !== undefined && s < 100) this.stamina.set(g.s.id, Math.min(100, s + STAMINA_REGEN * dt));
    }
    this.cd = Math.max(0, this.cd - dt);
    const sw = this.swing;
    if (sw) {
      if (sw.g !== b.player || sw.g.downed || sw.g.s.dead) this.swing = undefined;
      else {
        sw.t += dt;
        if (!sw.done && sw.t >= sw.wind) this.land(sw, true);
        if (sw.done) { this.swing = undefined; this.cd = sw.prof.recovery * (sw.tired ? 1.5 : 1); }
      }
    }
    // bleeding
    for (const [id, bl] of this.bleed) {
      const z = b.zombies.find((q) => q.id === id);
      if (!z || z.state === 'dying') { this.bleed.delete(id); continue; }
      bl.t -= dt;
      z.hp -= bl.dps * dt;
      if (R.chance(dt * 6)) b.blood(z.x, z.y - b.zh(z) * R.range(0.3, 0.7), 1, 2.5, z.y);
      if (z.hp <= 0) {
        b.kill(z, bl.g);
        if (bl.g) this.meleeKills.set(bl.g.s.id, (this.meleeKills.get(bl.g.s.id) ?? 0) + 1);
        this.bleed.delete(id);
      } else if (bl.t <= 0) this.bleed.delete(id);
    }
    for (const s of this.slashes) s.t -= dt;
    this.slashes = this.slashes.filter((s) => s.t > 0);
  }

  // ---------------- guards out of ammunition ----------------
  /** A guard with nothing left to shoot swings their hand weapon at whatever is on the wall. Sets g.cd. */
  guard(g: Guardian) {
    const { prof } = profOf(g);
    // guards near the wall reach the barricade; anything inside the line comes to them
    const cands = this.reachable(g.x > 200 ? WALL_X - 30 : g.x, prof.reach).filter((z) => {
      const st = z.state as string;
      return st === 'over' || st === 'maul' ? Math.abs(z.x - g.x) < prof.reach + 40 : g.x > 200;
    });
    if (!cands.length) {
      g.cd = 1.2;
      if (R.chance(0.25)) this.b.text(g.x + 20, g.y - 150, 'out of ammo', '#c88', 10);
      return;
    }
    const sw = this.startSwing(g, false);
    if (!sw) { g.cd = 2; return; }
    g.recoil = 1;
    this.land(sw, false);
    g.cd = sw.wind + prof.recovery * (sw.tired ? 1.5 : 1) + 0.15;
  }

  // ---------------- drawing ----------------
  sorted(c: CanvasRenderingContext2D): SortedDraw[] {
    const out: SortedDraw[] = [];
    const p = this.b.player;
    if (this.swing && p) {
      const sw = this.swing;
      out.push({ y: 701.5, f: () => {
        // the weapon raised over the wall top: a dark bar swinging down through the wind-up
        const k = Math.min(1, sw.t / Math.max(0.01, sw.wind));
        const ox = p.x + 18 * p.face, oy = p.y - 128 * p.sc;
        const a = -2.2 + k * 1.9;
        const len = 30 + sw.prof.reach * 0.35;
        c.strokeStyle = '#1a1714'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + Math.cos(a) * len * p.face, oy + Math.sin(a) * len); c.stroke();
      } });
    }
    if (this.slashes.length) out.push({ y: 702, f: () => {
      for (const s of this.slashes) {
        const a = s.t / 0.16;
        c.strokeStyle = s.crit ? `rgba(255,220,160,${a})` : `rgba(230,225,210,${a * 0.8})`;
        c.lineWidth = s.crit ? 3 : 2;
        c.beginPath(); c.arc(s.x - s.r * 0.4, s.y + s.r * 0.2, s.r, -1.3, 0.2); c.stroke();
      }
    } });
    return out;
  }

  drawOver(c: CanvasRenderingContext2D) {
    const p = this.b.player;
    if (!p || this.b.intro > 0) return;
    const { prof, item } = profOf(p);
    const st = this.sta(p);
    const x = 1280 - 330, y = 720 - 104;
    c.save();
    c.fillStyle = 'rgba(10,9,8,0.7)';
    c.fillRect(x, y, 310, 12);
    c.fillStyle = st < prof.stamina ? '#a8322a' : '#7d8a5a';
    c.fillRect(x + 2, y + 2, 306 * (st / 100), 8);
    c.font = '11px "Special Elite", monospace';
    c.textAlign = 'left';
    c.fillStyle = '#d9cdb0';
    const name = item ? MELEE[item.def].name.toLowerCase() : 'fists';
    c.fillText(`[V] ${name}${item && item.cond < 0.35 ? ' (worn)' : ''}${prof.fuel ? ` · fuel ${Math.floor(G.stores.fuel ?? 0)}` : ''}`, x, y - 4);
    c.restore();
    void depthScale;
  }

  onEnd() {
    for (const [id, n] of this.meleeKills) {
      const g = this.b.guards.find((q) => q.s.id === id);
      if (g && !g.s.dead) gainProf(g.s, 'melee', n * 3);
    }
  }
}

/** Battle glue: a guard out of ammunition uses their melee weapon (or fists). */
export function meleeGuard(b: Battle, g: Guardian) {
  const m = byBattle.get(b);
  if (m) m.guard(g);
  else g.cd = 1.5;
}
