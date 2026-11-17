// Crew-served guns at night (data/emplacements.ts): an MG nest, a swivel deer rifle, a propane
// flame projector at posts on the line, plus the automatic nail turrets. Each crewed mount is
// worked by a survivor picked at dusk (or the best heavy-trained guard), or by the leader:
// [H] mans / leaves the nearest one; then the mouse aims it, click / hold fires, [R] swaps the
// barrel or the belt. Handling follows heavy-weapons training (crewHandling): untrained crews
// spray, cook the barrel and jam; trained crews fire short bursts and keep it cool. Heavy XP
// goes to whoever worked it.
import { is, keyCap } from '../ui/keys';
import { caps, dot, type Hint } from './hud';
import type { Battle } from './battle';
import type { BattleHook, Zed, Guardian, SortedDraw } from './hook';
import type { Traps } from './traps';
import { G, R, add } from '../state';
import { sfx } from '../audio';
import { fireProfile, type FireProfile } from '../data/weapons';
import { EMPLACEMENTS, parseEmplacements, stringifyEmplacements, crewHandling, type EmplacementDef, type EmplacementItem, type Post } from '../data/emplacements';
import { first, level, gainXp, byId } from '../sim/survivors';
import { depthScale } from './render';
import { drawProp, drawGunPart, drawGunBase, gunReach, has, propW } from './props';

const WALL_X = 372;
const ROOF_Y = 506; // the scaffold's deck
const FIRESTEP_Y = 688; // the near defenders' row, behind the barricade
const SCAFFOLD_DECK = 0.15; // emp_scaffold: the deck's height as a fraction from the sprite's top
/** "the MG nest", "the swivel deer rifle" */
const lc = (name: string) => name.replace(/^[A-Z](?=[a-z])/, (m) => m.toLowerCase());
const PROFILE_GUN: Record<string, string> = { mgnest: 'lmg', swivel: 'hunting', flamer: 'flaregun', nailturret: 'nailer' };

export interface Mount {
  def: EmplacementDef;
  item: EmplacementItem | null; // null: a nail turret (G.fort.turrets)
  post: Post;
  x: number; // where the crew stands
  y: number; // their feet
  px: number; // the gun's pivot
  py: number;
  ang: number;
  crew: Guardian | null;
  byPlayer: boolean;
  orig?: { x: number; y: number; sc: number; homeX: number };
  mag: number;
  reload: number;
  heat: number;
  swap: number; // barrel swap time left (overheated)
  jam: number; // clearing a jam
  cd: number;
  burstLeft: number;
  pause: number;
  tgt?: number;
  flash: number;
  firing: number; // flame: seconds the cone has been burning (draw)
  rounds: number;
  kills: number;
  fx: FireProfile;
  prevDown: boolean;
}

/** Crew picked at dusk: { [emplacement index]: survivor id | 'auto' | 'none' } in G.flags.empCrew. */
export function crewPlan(): Record<string, string> {
  try { const v = JSON.parse((G.flags.empCrew as string) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export class Emplacements implements BattleHook {
  b: Battle;
  traps?: Traps;
  mounts: Mount[] = [];
  xp = new Map<string, number>();
  msgT = 0;

  constructor(b: Battle, traps?: Traps) {
    this.b = b;
    this.traps = traps;
    const items = parseEmplacements(G.flags.emplacements);
    const slots: Record<Post, number> = { roof: 0, firestep: 0 };
    for (const it of items) {
      const def = EMPLACEMENTS[it.id];
      if (!def || !def.crew) continue;
      const k = slots[it.post]++;
      if (it.post === 'roof') {
        const x = 214 - k * 74;
        this.mounts.push(this.mount(def, it, 'roof', x, ROOF_Y, x + 24, ROOF_Y - 62));
      } else {
        const x = WALL_X - 52 - k * 50;
        this.mounts.push(this.mount(def, it, 'firestep', x, FIRESTEP_Y, x + 30, 580));
      }
    }
    // the nail turrets: automatic, at the wall, as before
    for (let i = 0; i < Math.min(2, G.fort.turrets ?? 0); i++) {
      const m = this.mount(EMPLACEMENTS.nailturret, null, 'firestep', WALL_X - 20 - i * 46, 700, WALL_X - 20 - i * 46, 560 - i * 14);
      m.cd = 1;
      this.mounts.push(m);
    }
    this.assignCrews();
  }

  mount(def: EmplacementDef, item: EmplacementItem | null, post: Post, x: number, y: number, px: number, py: number): Mount {
    const fx = { ...fireProfile({ uid: `emp_${def.id}`, def: PROFILE_GUN[def.id] ?? 'lmg', cond: 1, kills: 0 }), dmg: def.dmg, pierce: def.pierce, knock: def.knock, armorPen: def.armorPen, ammoRes: def.ammo, perShot: def.perShot, range: Infinity, incendiary: false, flare: false };
    const m: Mount = { def, item, post, x, y, px, py, ang: 0, crew: null, byPlayer: false, mag: 0, reload: 0, heat: 0, swap: 0, jam: 0, cd: R.range(0.5, 1.5), burstLeft: 0, pause: 0, flash: 0, firing: 0, rounds: 0, kills: 0, fx, prevDown: false };
    if (def.crew && def.id !== 'flamer') m.mag = this.load(def, def.mag);
    return m;
  }

  /** Belts and boxes come out of the stores. */
  load(def: EmplacementDef, want: number) {
    const have = Math.floor((G.stores[def.ammo] ?? 0) / def.perShot);
    const got = Math.max(0, Math.min(want, have));
    add(def.ammo, -got * def.perShot);
    return got;
  }

  heavyOf(m: Mount) { return m.crew ? level(m.crew.s, 'heavy') : 0; }

  assignCrews() {
    const plan = crewPlan();
    const b = this.b;
    const leader = b.player;
    const taken = new Set<Guardian>();
    this.mounts.forEach((m, i) => {
      if (!m.def.crew || !m.item) return;
      const want = plan[String(i)] ?? 'auto';
      if (want === 'none') return;
      let g: Guardian | undefined;
      if (want !== 'auto') g = b.guards.find((q) => q.s.id === want && b.standing(q) && !taken.has(q));
      if (!g) {
        const pool = b.guards.filter((q) => b.standing(q) && !taken.has(q) && q !== leader);
        pool.sort((a, c) => level(c.s, 'heavy') - level(a.s, 'heavy'));
        const best = pool[0];
        // auto: someone who knows the gun, or a spare hand when the line can afford one
        if (best && (level(best.s, 'heavy') >= 2 || pool.length >= 2)) g = best;
      }
      if (g === leader && want === 'auto') g = undefined;
      if (!g) return;
      taken.add(g);
      this.seat(m, g, g === leader);
    });
    const crewed = this.mounts.filter((m) => m.crew);
    if (crewed.length) b.say(crewed.map((m) => `${first(m.crew!.s)} on the ${lc(m.def.name)}`).join('; ') + '.', 4);
  }

  seat(m: Mount, g: Guardian, byPlayer: boolean) {
    m.orig = { x: g.x, y: g.y, sc: g.sc, homeX: g.homeX };
    m.crew = g;
    m.byPlayer = byPlayer;
    g.crew = true;
    g.burstLeft = 0;
    g.x = g.homeX = m.x;
    g.y = m.y;
    g.sc = m.post === 'roof' ? 0.78 : depthScale(m.y);
    g.face = 1;
    m.tgt = undefined;
  }
  unseat(m: Mount) {
    this.credit(m);
    const g = m.crew;
    if (g && m.orig) {
      g.x = m.orig.x; g.homeX = m.orig.homeX; g.y = m.orig.y; g.sc = m.orig.sc;
    }
    if (g) g.crew = false;
    m.crew = null;
    m.byPlayer = false;
    m.burstLeft = 0;
  }

  playerMount() { return this.mounts.find((m) => m.byPlayer && m.crew === this.b.player); }

  // ---------------- input ----------------
  onKey(e: KeyboardEvent) {
    const b = this.b;
    if (is(e, 'night.nest')) {
      if (e.repeat || b.done) return true;
      const p = b.player;
      if (!p) return true;
      const cur = this.playerMount();
      if (cur) { this.unseat(cur); b.say(`${first(p.s)} leaves the ${lc(cur.def.name)}.`, 2); return true; }
      const crewable = this.mounts.filter((m) => m.def.crew && m.item);
      if (!crewable.length) { b.say('No gun nest on the line. Build one at the forge.', 2); return true; }
      const m = crewable.sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x))[0];
      if (m.crew) {
        const o = m.crew;
        this.unseat(m);
        b.say(`${first(p.s)} takes the ${lc(m.def.name)} from ${first(o.s)}.`, 3);
      } else b.say(`${first(p.s)} takes the ${lc(m.def.name)}. ${keyCap('night.nest')} to leave it.`, 3);
      this.seat(m, p, true);
      sfx.reload('lmg', 'close');
      return true;
    }
    if (is(e, 'night.reload') && this.playerMount()) {
      const m = this.playerMount()!;
      if (m.def.heat && m.heat > 0.35 && m.swap <= 0) this.startSwap(m);
      else this.startReload(m);
      return true;
    }
    return false;
  }

  blockFire() { return !!this.playerMount(); }

  // ---------------- update ----------------
  update(dt: number) {
    const b = this.b;
    this.msgT = Math.max(0, this.msgT - dt);
    for (const m of this.mounts) {
      m.flash = Math.max(0, m.flash - dt);
      m.firing = Math.max(0, m.firing - dt);
      if (m.def.heat) m.heat = Math.max(0, m.heat - (m.def.cool ?? 0.2) * dt * (m.swap > 0 ? 0 : 1));
      if (!m.def.crew) { this.updateTurret(m, dt); continue; }
      // the crew went down, or died, or fled: the gun falls silent
      if (m.crew && (!b.standing(m.crew) || (m.byPlayer && m.crew !== b.player))) {
        const g = m.crew;
        this.credit(m);
        g.crew = false;
        m.crew = null; m.byPlayer = false;
        if (!g.s.dead) b.say(`The ${lc(m.def.name)} falls silent.`, 3);
      }
      if (!m.crew) continue;
      const h = crewHandling(this.heavyOf(m));
      if (m.swap > 0) { m.swap -= dt; if (m.swap <= 0) { m.heat = 0; sfx.reload('lmg', 'close'); } continue; }
      if (m.jam > 0) { m.jam -= dt; continue; }
      if (m.reload > 0) {
        m.reload -= dt;
        if (m.reload <= 0) { m.mag += this.load(m.def, m.def.mag - m.mag); sfx.reload('lmg', 'close'); }
        continue;
      }
      m.cd -= dt;
      if (m.byPlayer) this.playerFire(m, h, dt);
      else this.crewFire(m, h, dt);
      m.prevDown = b.mouse.down;
    }
  }

  startReload(m: Mount) {
    if (m.def.id === 'flamer' || m.reload > 0 || m.mag >= m.def.mag) return;
    if ((G.stores[m.def.ammo] ?? 0) < m.def.perShot) {
      if (m.byPlayer || this.msgT <= 0) { this.b.say(`No ${m.def.ammo === 'r556' ? '5.56' : m.def.ammo} for the ${lc(m.def.name)}.`, 2); this.msgT = 6; }
      m.cd = 2;
      return;
    }
    m.reload = m.def.reload * crewHandling(this.heavyOf(m)).reloadMul;
    sfx.reload('lmg', 'out');
  }
  startSwap(m: Mount) {
    const h = crewHandling(this.heavyOf(m));
    m.swap = (m.def.swap ?? 3) * h.swapMul;
    m.burstLeft = 0;
    sfx.overheat();
    this.b.text(m.px + 20, m.py - 26, m.def.id === 'flamer' ? 'venting' : 'barrel swap', '#e09060', 11);
  }

  playerFire(m: Mount, h: ReturnType<typeof crewHandling>, dt: number) {
    const b = this.b;
    const mz = this.muzzle(m);
    m.ang = Math.atan2(b.mouse.y - mz.y, b.mouse.x - mz.x);
    const down = b.mouse.down;
    if (m.def.id === 'flamer') { if (down) this.flame(m, h, dt, b.targetLane()); return; }
    const want = m.def.auto ? down : down && !m.prevDown;
    if (!want || m.cd > 0) return;
    this.shoot(m, h, m.ang, b.targetLane(), true);
  }

  crewFire(m: Mount, h: ReturnType<typeof crewHandling>, dt: number) {
    const b = this.b;
    const tgt = this.pickTarget(m);
    if (!tgt) { m.burstLeft = 0; m.ang += (0 - m.ang) * Math.min(1, dt * 2); return; }
    if (tgt.id !== m.tgt) {
      m.tgt = tgt.id;
      if (m.burstLeft <= 0) { m.cd = Math.max(m.cd, h.react); return; }
    }
    const mz = this.muzzle(m);
    const hb = b.hitbox(tgt);
    const head = R.chance(0.15 + this.heavyOf(m) * 0.04);
    const ty = head ? hb.hy : (hb.y1 + hb.y2) / 2;
    const want = Math.atan2(ty - mz.y, tgt.x - mz.x);
    m.ang += (want - m.ang) * Math.min(1, dt * 10);
    if (m.def.id === 'flamer') {
      if (tgt.x - mz.x < (m.def.cone?.reach ?? 220) - 10) this.flame(m, h, dt, tgt.y);
      return;
    }
    if (m.cd > 0) return;
    if (m.burstLeft <= 0) {
      if (m.pause > 0) { m.pause -= dt; return; }
      // a new trigger pull: trained crews short bursts, the untrained hold it down
      if (R.chance(h.jam + (m.item ? (1 - m.item.cond) * 0.03 : 0))) {
        m.jam = h.jamClear;
        sfx.jam();
        b.text(m.px + 10, m.py - 30, 'jammed', '#c8a070', 11);
        return;
      }
      m.burstLeft = m.def.auto ? Math.max(3, h.burst + R.int(-2, 2)) : 1;
    }
    this.shoot(m, h, m.ang + R.gauss(0, 0.012 * (2 - this.heavyOf(m) / 10)), tgt.y, false);
    m.burstLeft--;
    if (m.burstLeft <= 0) m.pause = h.pause * R.range(0.8, 1.3);
    // an untrained crew does not watch the barrel
    if (m.def.heat && m.heat > 0.8 && this.heavyOf(m) >= 5 && m.burstLeft > 2) m.burstLeft = 2;
  }

  pickTarget(m: Mount): Zed | undefined {
    const b = this.b;
    const mz = this.muzzle(m);
    const reach = m.def.cone ? m.def.cone.reach + 40 : m.def.id === 'mgnest' ? 1000 : 1240;
    let best: Zed | undefined, bp = 1e9;
    for (const z of b.zombies) {
      if (z.state === 'dying' || (z.emerge !== undefined && z.emerge > 0) || z.flip) continue;
      const st = z.state as string;
      if (st === 'over' || st === 'maul' || (z.state === 'cover' && z.ducked)) continue;
      if (z.x < mz.x + 30 || z.x - mz.x > reach) continue;
      let pri = z.x - mz.x;
      if (z.def.scream) pri -= 300;
      if (z.def.id === 'ferryman' || z.def.armor) pri -= m.def.id === 'swivel' ? 400 : 100;
      if (z.state === 'wall') pri -= 200;
      if (z.def.burst && z.x < WALL_X + 140) pri += 300;
      if (z.id === m.tgt) pri -= 60; // stay on target
      if (pri < bp) { bp = pri; best = z; }
    }
    return best;
  }

  muzzle(m: Mount) {
    const len = gunReach(m.def.id, 1, m.def.id === 'swivel' ? 46 : m.def.id === 'flamer' ? 38 : m.def.id === 'nailturret' ? 34 : 50);
    return { x: m.px + Math.cos(m.ang) * len, y: m.py + Math.sin(m.ang) * len };
  }

  shoot(m: Mount, h: ReturnType<typeof crewHandling>, ang: number, laneY: number, isPlayer: boolean) {
    const b = this.b;
    if (m.mag <= 0) { sfx.click(); this.startReload(m); return; }
    m.mag--;
    m.rounds++;
    m.cd = 1 / m.def.rof;
    const mz = this.muzzle(m);
    const spread = m.def.spread * h.spreadMul * (m.item ? 1 + (1 - m.item.cond) * 0.5 : 1);
    const k0 = b.res.kills;
    const shooter = (m.crew ?? null) as Guardian;
    b.castShot(shooter, mz.x, mz.y, ang + (R.next() + R.next() - 1) * spread, m.def.dmg * (m.item ? 0.85 + 0.15 * m.item.cond : 1), m.def.pierce, m.def.knock, false, isPlayer, m.fx, laneY);
    m.kills += b.res.kills - k0;
    m.flash = 0.05;
    b.noise += m.def.noise;
    b.vfx.muzzle({ x: mz.x, y: mz.y, ang, defId: PROFILE_GUN[m.def.id], prof: m.fx, key: m, eject: m.def.id === 'mgnest' ? { x: m.px - 6, y: m.py + 4, ground: m.y - 4, face: 1 } : undefined });
    sfx.shoot(m.def.sound, { far: isPlayer ? false : 0.4 });
    if (isPlayer) b.earLoad += m.def.id === 'flamer' ? 0 : 1.2;
    if (isPlayer) b.shake = Math.max(b.shake, m.def.id === 'swivel' ? 3 : 1.6);
    if (m.item) m.item.cond = Math.max(0.05, m.item.cond - m.def.wear);
    if (m.def.heat) {
      m.heat += m.def.heat * h.heatMul;
      if (m.heat >= 1) {
        m.heat = 1;
        this.startSwap(m);
        if (m.byPlayer || this.msgT <= 0) { b.say(m.crew ? `${first(m.crew.s)} cooked the barrel on the ${m.def.short}. Swapping.` : 'The barrel is cooked.', 2.5); this.msgT = 8; }
      }
    }
    if (m.mag <= 0) this.startReload(m);
  }

  /** The flame projector: a short cone down the aimed lane; everything in it burns. */
  flame(m: Mount, h: ReturnType<typeof crewHandling>, dt: number, laneY: number) {
    const b = this.b;
    const per = m.def.perShot * dt;
    if ((G.stores.fuel ?? 0) < per) {
      if (m.byPlayer || this.msgT <= 0) { b.say('The flame projector sputters out. No fuel.', 2); this.msgT = 8; }
      return;
    }
    add('fuel', -per);
    const cone = m.def.cone!;
    const mz = this.muzzle(m);
    const reach = cone.reach * (0.9 + 0.1 * Math.random());
    m.firing = 0.12;
    m.rounds += dt;
    b.noise += m.def.noise * dt;
    if (m.item) m.item.cond = Math.max(0.05, m.item.cond - m.def.wear * dt);
    if (m.def.heat) {
      m.heat += m.def.heat * h.heatMul * dt * 4;
      if (m.heat >= 1) { m.heat = 1; this.startSwap(m); return; }
    }
    const tipX = mz.x + reach;
    const k0 = b.res.kills;
    for (const z of b.zombies) {
      if (z.state === 'dying' || z.flip) continue;
      const dx = z.x - mz.x;
      if (dx < 0 || dx > reach) continue;
      if (Math.abs(z.y - laneY) > 18 + dx * Math.tan(cone.half) * 0.35) continue;
      z.hp -= m.def.dmg * dt;
      z.burn = Math.max(z.burn, cone.burn);
      z.flash = 0.04;
      if (z.hp <= 0) b.kill(z, m.crew);
    }
    m.kills += b.res.kills - k0;
    b.vfx.flame(mz.x, mz.y, mz.x + reach, laneY - 40, dt); // the burning stream (night/vfx)
    if (R.chance(dt * 8)) b.lights.push({ x: mz.x + reach * 0.5, y: laneY - 50, r: 240, life: 0.25, max: 0.25, color: '255,150,60' });
    if (R.chance(dt * 3)) sfx.fire();
    this.traps?.igniteNear(tipX - 30, tipX);
  }

  // the nail turret (moved here from battle.ts): automatic, eats scrap, needs the generator
  updateTurret(m: Mount, dt: number) {
    const b = this.b;
    m.cd -= dt;
    if (m.cd > 0) return;
    if ((G.stores.scrap ?? 0) < m.def.perShot || !G.buildings.some((x) => x.id === 'generator')) { m.cd = 1; return; }
    let tgt: Zed | undefined;
    for (const z of b.zombies) if (z.state !== 'dying' && z.x < 900 && !z.flip && (z.state as string) !== 'over' && (z.state as string) !== 'maul' && (!tgt || z.x < tgt.x)) tgt = z;
    if (!tgt) { m.cd = 0.3; return; }
    const hb = b.hitbox(tgt);
    m.ang = Math.atan2((hb.y1 + hb.y2) / 2 - 10 - m.py, tgt.x - m.px);
    add('scrap', -m.def.perShot);
    const mz = this.muzzle(m);
    b.castShot(null as unknown as Guardian, mz.x, mz.y, m.ang + R.gauss(0, m.def.spread), m.def.dmg, m.def.pierce, m.def.knock, false, false, m.fx, tgt.y);
    m.cd = 1 / m.def.rof;
    m.flash = 0.05;
    b.vfx.muzzle({ x: mz.x, y: mz.y, ang: m.ang, defId: 'nailer', prof: m.fx, key: m });
    b.noise += m.def.noise;
    sfx.shoot('nailer', { far: 0.5, volume: 0.7 });
  }

  // ---------------- drawing ----------------
  sorted(c: CanvasRenderingContext2D): SortedDraw[] {
    const out: SortedDraw[] = [];
    const roofs = this.mounts.filter((m) => m.post === 'roof');
    if (roofs.length) out.push({ y: ROOF_Y - 1, f: () => this.drawScaffold(c, roofs) });
    for (const m of this.mounts) {
      // firestep guns sit on the barricade top, in front of it; roof guns on the scaffold deck
      // the nail turret's stand stands behind the barricade (its seat and gun clear the top) when drawn from sprites
      // a roof gun sorts just after its own crew (guards sort by y + homeX·1e-5), so the left
      // crew's long barrel passes behind the next crew along instead of through them
      const y = !m.def.crew ? (has('emp_nail_base') ? 699.5 : 700 + 1) : m.post === 'roof' ? ROOF_Y + m.x * 1e-5 + 5e-6 : 701.2;
      out.push({ y, f: () => this.drawGun(c, m) });
    }
    return out;
  }

  drawScaffold(c: CanvasRenderingContext2D, roofs: Mount[]) {
    const x0 = Math.min(...roofs.map((m) => m.x)) - 40, x1 = Math.max(...roofs.map((m) => m.x)) + 50;
    // the generated scaffold: its deck (the sandbag row's foot) at ROOF_Y, its legs on the ground
    if (has('emp_scaffold')) {
      const h = (704 - ROOF_Y) / (1 - SCAFFOLD_DECK);
      const w = Math.max(x1 - x0 + 30, propW('emp_scaffold', h) * 0.8);
      drawProp(c, 'emp_scaffold', (x0 + x1) / 2 + 5, 704, h, undefined, { w: Math.min(w, propW('emp_scaffold', h) * 1.6) });
      return;
    }
    c.fillStyle = '#16130f';
    for (let x = x0; x <= x1; x += Math.max(30, (x1 - x0) / 3)) c.fillRect(x, ROOF_Y, 5, 704 - ROOF_Y);
    c.strokeStyle = '#1d1913'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x0, ROOF_Y + 20); c.lineTo(x1, 690); c.moveTo(x1, ROOF_Y + 20); c.lineTo(x0, 690); c.stroke();
    c.fillStyle = '#2a231b'; c.fillRect(x0 - 8, ROOF_Y - 4, x1 - x0 + 22, 8);
    // sandbags along the deck edge
    c.fillStyle = '#3b3427';
    for (let x = x0 + 6; x < x1 + 6; x += 16) { c.beginPath(); c.ellipse(x + 8, ROOF_Y - 10, 9, 6, 0, 0, Math.PI * 2); c.fill(); }
  }

  drawGun(c: CanvasRenderingContext2D, m: Mount) {
    if (this.drawGunSprite(c, m)) return;
    c.save();
    if (!m.def.crew) {
      // the nail turret, as it always looked
      c.fillStyle = '#2a2622';
      c.fillRect(m.px - 4, m.py, 8, 704 - m.py);
      c.translate(m.px, m.py);
      c.rotate(m.ang);
      c.fillStyle = '#5a4a32'; c.fillRect(-10, -7, 34, 14);
      c.fillStyle = '#8a7a5a'; c.fillRect(20, -3, 14, 6);
      c.restore();
      return;
    }
    // mount: tripod legs (MG), a post (swivel), a pipe stand (flame)
    c.strokeStyle = '#1c1915'; c.lineWidth = 3;
    const footY = m.post === 'roof' ? ROOF_Y - 2 : 600;
    c.beginPath();
    if (m.def.id === 'mgnest') { c.moveTo(m.px, m.py + 4); c.lineTo(m.px - 14, footY); c.moveTo(m.px, m.py + 4); c.lineTo(m.px + 12, footY); }
    else { c.moveTo(m.px, m.py + 4); c.lineTo(m.px, footY); }
    c.stroke();
    if (m.def.id === 'flamer') {
      // two white grill tanks at the foot of the stand
      c.fillStyle = '#c9c6bc';
      c.fillRect(m.px - 22, footY - 22, 10, 20); c.fillRect(m.px - 10, footY - 22, 10, 20);
    }
    if (m.post === 'firestep') {
      // sandbags stacked on the barricade top under the gun
      c.fillStyle = '#4a4232';
      c.strokeStyle = 'rgba(20,18,14,0.9)'; c.lineWidth = 1;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.ellipse(m.px - 14 + k * 15, m.py + 14, 9, 6, 0, 0, Math.PI * 2); c.fill(); c.stroke(); }
      c.beginPath(); c.ellipse(m.px - 6, m.py + 6, 9, 6, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(m.px + 9, m.py + 6, 9, 6, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    c.translate(m.px, m.py);
    c.rotate(m.ang);
    c.scale(1.2, 1.2);
    const hot = m.heat;
    const rim = (x: number, y: number, w: number, h: number) => { c.strokeStyle = 'rgba(210,205,190,0.45)'; c.lineWidth = 1; c.strokeRect(x, y, w, h); };
    if (m.def.id === 'mgnest') {
      c.fillStyle = '#4a4d55'; c.fillRect(-16, -7, 40, 13); rim(-16, -7, 40, 13);
      c.fillStyle = '#5c5a4c'; c.fillRect(-6, 6, 14, 10); rim(-6, 6, 14, 10); // belt box
      c.fillStyle = '#c9a24a'; for (let k = 0; k < 4; k++) c.fillRect(-4 + k * 3, 16, 2, 4); // the belt
      c.fillStyle = `rgb(${80 + hot * 160},${78 + hot * 20},${74})`; c.fillRect(24, -3, 30, 5); rim(24, -3, 30, 5);
      if (m.swap > 0) { c.fillStyle = 'rgba(255,120,60,0.7)'; c.fillRect(24, -3, 30, 5); }
    } else if (m.def.id === 'swivel') {
      c.fillStyle = '#7a5632'; c.fillRect(-22, -4, 30, 8); rim(-22, -4, 30, 8); // stock
      c.fillStyle = '#55575c'; c.fillRect(6, -3, 44, 4); rim(6, -3, 44, 4);
      c.fillStyle = '#222'; c.fillRect(4, -9, 18, 4); rim(4, -9, 18, 4); // scope
    } else {
      c.fillStyle = '#6a665e'; c.fillRect(-10, -5, 26, 10); rim(-10, -5, 26, 10);
      c.fillStyle = '#8a8478'; c.fillRect(14, -3, 26, 6); rim(14, -3, 26, 6);
    }
    if (m.firing > 0) {
      c.globalCompositeOperation = 'lighter';
      const g = c.createLinearGradient(38, 0, 38 + (m.def.cone?.reach ?? 200), 0);
      g.addColorStop(0, 'rgba(255,230,160,0.9)'); g.addColorStop(0.4, 'rgba(255,140,40,0.55)'); g.addColorStop(1, 'rgba(255,80,20,0)');
      c.fillStyle = g;
      const r = m.def.cone?.reach ?? 200;
      c.beginPath(); c.moveTo(38, -3); c.lineTo(38 + r, -r * 0.16); c.lineTo(38 + r, r * 0.16); c.lineTo(38, 3); c.fill();
    }
    c.restore();
  }

  /** The generated base + rotating gun; false (draw the old shapes) when either is missing. */
  drawGunSprite(c: CanvasRenderingContext2D, m: Mount): boolean {
    const key = m.def.id;
    if (!has(`emp_${key === 'mgnest' ? 'mg' : key === 'swivel' ? 'rifle' : key === 'flamer' ? 'flamer' : 'nail'}_gun`)) return false;
    const footY = !m.def.crew ? 704 : m.post === 'roof' ? ROOF_Y - 2 : 600;
    if (m.post === 'firestep' && m.def.crew && key !== 'mgnest' && has('emp_firestep')) drawProp(c, 'emp_firestep', m.px - 2, footY + 6, 22, undefined, { w: 54 });
    if (!drawGunBase(c, key, m.px, m.py, footY)) return false;
    // condition: a worn gun reads darker and flatter (baked in steps; no per-frame filter)
    const worn = Math.round((m.item ? 1 - m.item.cond : 0) * 4) / 4;
    const look = { b: 1.2 - worn * 0.35, s: 1 - worn * 0.45, fog: 0, outline: 0 }; // a touch bright: it reads against the night
    if (!drawGunPart(c, key, m.px, m.py, m.ang, 1, look)) return false;
    const reach = gunReach(key, 1, 50);
    c.save();
    c.translate(m.px, m.py);
    c.rotate(m.ang);
    c.globalCompositeOperation = 'lighter';
    // (the muzzle flash itself is the pooled vfx.muzzle burst: no second, smaller flash drawn here)
    // the barrel glows as it heats; a swap shows it cherry red
    const hot = m.swap > 0 ? 0.8 : m.heat;
    if (hot > 0.25) {
      c.fillStyle = `rgba(255,${Math.round(110 - hot * 60)},40,${(hot - 0.25) * 0.75})`;
      c.fillRect(reach * 0.45, -2.5, reach * 0.55, 5);
    }
    if (m.firing > 0) {
      const r = m.def.cone?.reach ?? 200;
      const g = c.createLinearGradient(reach, 0, reach + r, 0);
      g.addColorStop(0, 'rgba(255,230,160,0.9)'); g.addColorStop(0.4, 'rgba(255,140,40,0.55)'); g.addColorStop(1, 'rgba(255,80,20,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(reach, -3); c.lineTo(reach + r, -r * 0.16); c.lineTo(reach + r, r * 0.16); c.lineTo(reach, 3); c.fill();
    }
    c.restore();
    return true;
  }

  drawOver(c: CanvasRenderingContext2D) {
    const b = this.b;
    if (b.intro > 0) return;
    const crewable = this.mounts.filter((m) => m.def.crew);
    if (!crewable.length) return;
    c.save();
    c.font = '11px "Special Elite", monospace';
    c.textAlign = 'left';
    let y = 98; // below the nerve bar
    // one compact row per nest: the gun in small caps, who is on it, the rounds big; full words on the forge screen
    for (const m of crewable) {
      const who = m.crew ? (m.byPlayer ? 'you' : first(m.crew.s)) : '—';
      const ammo = m.def.id === 'flamer' ? `${Math.floor(G.stores.fuel ?? 0)}` : `${m.mag}`;
      c.fillStyle = 'rgba(10,9,8,0.55)';
      c.beginPath(); c.roundRect(20, y - 13, 210, 24, 3); c.fill();
      caps(c, m.def.short, 26, y + 2, m.crew ? '#c9a95a' : '#7a6e58');
      c.font = '11px "Special Elite", monospace';
      c.fillStyle = m.crew ? '#d9cdb0' : '#7a6e58';
      c.fillText(who, 62, y + 2);
      c.textAlign = 'right';
      c.font = '15px "Special Elite", monospace';
      c.fillStyle = m.reload > 0 ? '#8f846e' : m.mag === 0 && m.def.id !== 'flamer' ? '#c04030' : '#efe2c2';
      c.fillText(ammo, 222, y + 3);
      c.textAlign = 'left';
      if (m.jam > 0) dot(c, 160, y - 2, '#e05040', 3.5);
      if (m.def.heat) {
        c.fillStyle = 'rgba(80,70,60,0.5)'; c.fillRect(62, y + 6, 110, 3);
        c.fillStyle = m.swap > 0 ? '#e07040' : m.heat > 0.75 ? '#d09040' : '#8f7a55';
        c.fillRect(62, y + 6, 110 * (m.swap > 0 ? 1 : m.heat), 3);
      }
      y += 28;
    }
    c.restore();
  }

  /** [H] when a nest is within a few steps (or you are on one): leave / reload. */
  hints(): Hint[] {
    const b = this.b, p = b.player;
    if (!p || b.done || b.intro > 0) return [];
    const pm = this.playerMount();
    if (pm) return [{ key: 'night.nest', label: 'leave' }, { key: 'night.reload', label: pm.def.heat ? 'barrel' : 'reload', hot: pm.mag === 0 || pm.heat > 0.85 }];
    const near = this.mounts.some((m) => m.def.crew && m.item && Math.abs(m.x - p.x) < 240);
    return near ? [{ key: 'night.nest', label: 'nest' }] : [];
  }

  onEnd() {
    // heavy XP for whoever worked a gun; the gun's wear goes back into the save
    for (const m of this.mounts) {
      if (!m.def.crew) continue;
      this.credit(m);
      if (m.mag > 0 && m.def.id !== 'flamer') add(m.def.ammo, m.mag * m.def.perShot);
      m.mag = 0;
    }
    for (const [id, xp] of this.xp) { const s = byId(id); if (s && xp > 0) gainXp(s, 'heavy', Math.min(80, Math.round(xp))); }
    const items = this.mounts.map((m) => m.item).filter((x): x is EmplacementItem => !!x);
    if (items.length) {
      // keep emplacements that this battle did not mount (none today), in their order
      const all = parseEmplacements(G.flags.emplacements);
      let k = 0;
      for (const it of all) if (EMPLACEMENTS[it.id].crew && items[k] && items[k].id === it.id) it.cond = items[k++].cond;
      G.flags.emplacements = stringifyEmplacements(all);
    }
    for (const m of this.mounts) if (m.crew) this.unseat(m);
  }

  /** Credit a crew for time on the gun as they leave it (player swaps). */
  credit(m: Mount) {
    const s = m.crew?.s;
    if (!s) return;
    this.xp.set(s.id, (this.xp.get(s.id) ?? 0) + m.rounds / (m.def.id === 'flamer' ? 2 : 12) + m.kills * 3);
    m.rounds = 0; m.kills = 0;
  }
}
