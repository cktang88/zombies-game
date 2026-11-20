// The sally: a short sortie over the wall (DESIGN roadmap, combat tactics).
//
// [O] the leader drops over the barricade onto the road (Shift+[O]: the selected guard comes too).
// The landing shoves back whatever is right under the wall. Out there, for SALLY.out seconds:
//   - the leader walks toward the cursor along the near lane (and can still shoot);
//   - [V] swings the hand weapon on the road (no wall in the way); a companion swings on its own;
//   - a spent or sprung bear trap or snare wire the leader stands over is re-set;
//   - what dies within reach of the party may leave rounds to pick up (loot);
//   - anything that reaches them bites: every body in arm's reach gets a go (Battle.maul), so a
//     long stay ends with someone down.
// [O] again (or the clock) and they run back and climb up (SALLY.climb s, unable to shoot).
// Costs nerve; a cooldown between sorties.
import { keyCap, keyOf, normKey } from '../ui/keys';
import type { Battle } from './battle';
import { hintRow, type Hint } from './hud';
import { LANES, wallX } from './battle';
import type { BattleHook, Zed, Guardian } from './hook';
import type { Traps } from './traps';
import { G, R } from '../state';
import { sfx } from '../audio';
import { first } from '../sim/survivors';
import { depthScale } from './render';
import { react } from './impact';
import { profOf } from './melee';
import { fireProfile } from '../data/weapons';

export const SALLY = {
  /** seconds on the road before the party has to go back */
  out: 7,
  /** seconds to vault over / climb back up */
  drop: 0.45, climb: 0.8,
  /** seconds between sorties */
  cooldown: 22,
  /** nerve it takes to go */
  nerve: 12,
  /** px: how far down the road the party may go past the wall */
  range: 330,
  /** px / s on the road */
  speed: 120,
  /** landing shove: radius px and push */
  shove: 95, shoveBlast: 26,
  /** px: a body this close (and in the lane band) can bite; seconds between its tries */
  reach: 30, biteEvery: 1.1, biteChance: 0.45,
  /** loot: chance a kill on the road leaves rounds, and how many */
  loot: 0.55, lootRounds: [2, 6] as [number, number],
};
(globalThis as unknown as { __sally: unknown }).__sally = SALLY;

const TRAP_RESET = new Set(['beartrap', 'snare']);
const LANE = 2; // the near lane, just past the wall

interface Out { g: Guardian; orig: { x: number; y: number; sc: number; homeX: number }; swing: number; off: number }

export class Sally implements BattleHook {
  b: Battle;
  traps?: Traps;
  phase: 'idle' | 'drop' | 'out' | 'back' | 'climb' = 'idle';
  t = 0;
  cd = 0;
  party: Out[] = [];
  bites = new Map<number, number>();
  loot = 0;
  kills = 0;
  constructor(b: Battle, traps?: Traps) { this.b = b; this.traps = traps; }

  get active() { return this.phase !== 'idle'; }
  get leader() { return this.party[0]?.g; }
  ready() { const p = this.b.player; return !this.active && this.cd <= 0 && !!p && !p.crew && !this.b.done && this.b.intro <= 0 && this.b.nerve >= SALLY.nerve; }

  onKey(e: KeyboardEvent) {
    const k = normKey(e);
    if (k === keyOf('night.sally')) {
      if (e.repeat) return true;
      if (this.phase === 'out') { this.recall(); return true; }
      if (!this.active) this.go(e.shiftKey);
      return true;
    }
    if (this.phase === 'out' && k === keyOf('night.melee')) { this.swing(this.party[0]); return true; }
    if (this.active && k === keyOf('night.nest')) return true; // no gun nest from the road
    return false;
  }

  go(withSel: boolean) {
    const b = this.b, p = b.player;
    if (!p) return;
    if (this.cd > 0) { b.text(p.x, p.y - 170, `not yet (${Math.ceil(this.cd)}s)`, '#bfb39a', 11); return; }
    if (b.nerve < SALLY.nerve) { b.text(p.x, p.y - 170, 'no nerve for it', '#c88', 11); return; }
    if (!this.ready()) return;
    b.nerve -= SALLY.nerve;
    const add = (g: Guardian, off: number) => this.party.push({ g, orig: { x: g.x, y: g.y, sc: g.sc, homeX: g.homeX }, swing: 0, off });
    add(p, 0);
    const sel = b.selected();
    if (withSel && sel && sel !== p && b.standing(sel) && !sel.crew && !sel.dragging) add(sel, -28);
    this.phase = 'drop'; this.t = 0; this.loot = 0; this.kills = 0; this.bites.clear();
    const names = this.party.map((o) => first(o.g.s)).join(' and ');
    b.say(`${names} ${this.party.length > 1 ? 'go' : 'goes'} over the wall. ${keyCap('night.sally')} to come back.`, 3);
    sfx.thud();
  }

  recall() {
    if (this.phase !== 'out') return;
    this.phase = 'back'; this.t = 0;
  }

  /** The party's x on the road: the lane's wall face + a step, out to the cursor. */
  roadX(o: Out) {
    const w = wallX(LANE) + 26;
    const want = this.phase === 'out' ? Math.max(w, Math.min(w + SALLY.range, this.b.mouse.x)) : w;
    return want + (o.off && this.phase === 'out' ? o.off : 0);
  }

  place(o: Out, x: number, y: number) {
    const g = o.g;
    g.x = x; g.homeX = x; g.y = y; g.sc = depthScale(y);
  }

  update(dt: number) {
    const b = this.b;
    if (this.cd > 0 && !this.active) this.cd -= dt;
    if (!this.active) return;
    this.t += dt;
    // anyone downed or gone ends it for them: hauled back over by the rest
    for (const o of [...this.party]) if (!b.standing(o.g)) this.home(o, true);
    if (!this.party.length) { this.end(); return; }
    const y = LANES[LANE] + 4;
    if (this.phase === 'drop') {
      const k = Math.min(1, this.t / SALLY.drop);
      for (const o of this.party) {
        const x0 = o.orig.x, x1 = this.roadX(o);
        this.place(o, x0 + (x1 - x0) * k, o.orig.y + (y - o.orig.y) * k - Math.sin(k * Math.PI) * 40);
        o.g.face = 1;
      }
      if (k >= 1) { this.phase = 'out'; this.t = 0; this.land(); }
      return;
    }
    if (this.phase === 'out' || this.phase === 'back') {
      for (const o of this.party) {
        const to = this.roadX(o);
        const d = to - o.g.x;
        const sp = SALLY.speed * (this.phase === 'back' ? 1.4 : 1);
        this.place(o, o.g.x + Math.sign(d) * Math.min(Math.abs(d), sp * dt), y);
        if (Math.abs(d) > 2) o.g.face = d < 0 ? -1 : 1;
        else if (this.phase === 'out') o.g.face = b.mouse.x < o.g.x ? -1 : 1;
        o.swing = Math.max(0, o.swing - dt);
        // a companion swings on its own
        if (o !== this.party[0] && this.phase === 'out' && o.swing <= 0 && this.nearest(o.g, profOf(o.g).prof.reach + 30)) this.swing(o);
        this.resetTraps(o.g);
      }
      this.bitten(dt);
      if (this.phase === 'out') {
        if (this.t >= SALLY.out) { b.say('Back over! Now!', 2); this.recall(); }
      } else if (this.party.every((o) => Math.abs(o.g.x - this.roadX(o)) < 3)) { this.phase = 'climb'; this.t = 0; sfx.thud(); }
      return;
    }
    if (this.phase === 'climb') {
      const k = Math.min(1, this.t / SALLY.climb);
      for (const o of this.party) {
        const x0 = this.roadX(o), x1 = o.orig.x;
        this.place(o, x0 + (x1 - x0) * k, y + (o.orig.y - y) * k - Math.sin(k * Math.PI) * 50);
        o.g.face = -1;
      }
      this.bitten(dt);
      if (k >= 1) { for (const o of [...this.party]) this.home(o, false); this.end(); }
    }
  }

  /** Back to the slot on the wall (downed: hauled up and over, lying behind it). */
  home(o: Out, hauled: boolean) {
    const g = o.g;
    g.x = o.orig.x; g.homeX = o.orig.homeX; g.y = o.orig.y; g.sc = o.orig.sc; g.face = 1;
    this.party = this.party.filter((q) => q !== o);
    if (hauled && !g.s.dead) this.b.say(`They haul ${first(g.s)} back over the wall.`, 3);
  }

  end() {
    const b = this.b;
    for (const o of [...this.party]) this.home(o, false);
    this.phase = 'idle'; this.t = 0; this.cd = SALLY.cooldown;
    const bits = [this.kills ? `${this.kills} down` : '', this.loot ? `${this.loot} rounds picked up` : ''].filter(Boolean);
    if (bits.length) b.say(`Back over the wall — ${bits.join(', ')}.`, 3);
  }

  /** The landing: everything under the wall is shoved back down the road. */
  land() {
    const b = this.b;
    const p = this.party[0].g;
    b.shake = Math.max(b.shake, 5);
    sfx.thud();
    for (const z of b.zombies) {
      if (z.state === 'dying' || !b.inLane(z) || z.def.boss) continue;
      if (Math.abs(z.x - p.x) > SALLY.shove || Math.abs(z.y - p.y) > 50) continue;
      react(z, { dmg: 0, knock: 0, zone: 'torso', blast: SALLY.shoveBlast * (1 - Math.abs(z.x - p.x) / SALLY.shove * 0.5), dir: 1 }, b.t, () => R.next());
    }
    b.text(p.x, p.y - 160, 'OVER THE WALL', '#e0c070', 13);
  }

  nearest(g: Guardian, reach: number): Zed | undefined {
    let best: Zed | undefined, bd = Infinity;
    for (const z of this.b.zombies) {
      if (z.state === 'dying' || !this.b.inLane(z) || Math.abs(z.y - g.y) > 45) continue;
      const d = Math.abs(z.x - g.x) - this.b.zw(z) * 0.5;
      if (d < reach && d < bd) { bd = d; best = z; }
    }
    return best;
  }

  /** A swing on the road: the nearest body in reach, in front. */
  swing(o: Out | undefined) {
    if (!o || o.swing > 0 || this.phase !== 'out') return;
    const b = this.b, g = o.g;
    const { prof } = profOf(g);
    o.swing = Math.max(0.35, prof.swingTime + prof.recovery);
    const z = this.nearest(g, prof.reach + 34);
    g.face = z ? (z.x < g.x ? -1 : 1) : g.face;
    if (!z) return;
    const h = b.zh(z);
    const isP = g === this.party[0].g;
    b.damage(z, prof.dmg * 1.15, false, prof.knock + 40, g, false, z.x - g.face * b.zw(z) * 0.3, z.y - h * 0.55, isP);
    sfx.melee(prof.dmg >= 60 ? 'heavy' : 'hit', 'fists', { volume: isP ? 1 : 0.6 });
  }

  /** Re-set the mechanical traps underfoot. */
  resetTraps(g: Guardian) {
    if (!this.traps || this.phase !== 'out') return;
    for (const tr of this.traps.list) {
      if (!TRAP_RESET.has(tr.def.id) || tr.armed || tr.hold !== undefined || Math.abs(tr.x - g.x) > 26) continue;
      tr.armed = true; tr.spent = false; tr.rearm = 0; tr.uses = Math.max(1, tr.uses); tr.flash = 0.3;
      this.b.text(tr.x, tr.y - 40, 'RESET', '#c8d0a0', 12);
      sfx.click();
    }
  }

  /** Whatever reaches the party gets its teeth in. */
  bitten(dt: number) {
    const b = this.b;
    for (const z of b.zombies) {
      if (z.state === 'dying' || !b.inLane(z) || z.stun > 0 || (z.down ?? 0) > 0 || z.def.ranged) { this.bites.delete(z.id); continue; }
      const o = this.party.find((q) => Math.abs(z.x - q.g.x) < SALLY.reach + b.zw(z) * 0.5 && Math.abs(z.y - q.g.y) < 40);
      if (!o) { this.bites.delete(z.id); continue; }
      const t = (this.bites.get(z.id) ?? SALLY.biteEvery * 0.6) - dt;
      if (t > 0) { this.bites.set(z.id, t); continue; }
      this.bites.set(z.id, SALLY.biteEvery);
      if (R.chance(SALLY.biteChance)) b.maul(o.g, z);
      else b.text(o.g.x, o.g.y - 150, 'grabbed at', '#bfb39a', 10);
    }
  }

  onKill(z: Zed) {
    if (this.phase !== 'out' && this.phase !== 'back') return;
    const near = this.party.some((o) => Math.abs(z.x - o.g.x) < 120);
    if (!near) return;
    this.kills++;
    const p = this.party[0]?.g;
    if (!p?.w || !R.chance(SALLY.loot)) return;
    const prof = fireProfile(p.w);
    if (prof.ammoRes !== 'pistol' && prof.ammoRes !== 'shell' && prof.ammoRes !== 'rifle') return; // cartridges off the dead, not rockets or nails
    const n = Math.round(R.range(SALLY.lootRounds[0], SALLY.lootRounds[1]));
    G.stores[prof.ammoRes] = (G.stores[prof.ammoRes] ?? 0) + n * prof.perShot;
    this.loot += n;
    this.b.text(z.x, z.y - 60, `+${n} rounds`, '#d8c890', 11);
  }

  /** Climbing, vaulting: no shooting. */
  blockFire() { return this.phase === 'drop' || this.phase === 'climb'; }

  drawOver(c: CanvasRenderingContext2D) {
    if (this.phase !== 'out' && this.phase !== 'back') return;
    const p = this.party[0]?.g;
    if (!p) return;
    const left = Math.max(0, SALLY.out - this.t);
    const x = p.x, y = p.y - 190;
    c.save();
    c.fillStyle = 'rgba(8,8,10,0.6)';
    c.fillRect(x - 32, y, 64, 5);
    c.fillStyle = left < 2 ? '#d06040' : '#d8b860';
    c.fillRect(x - 32, y, 64 * (this.phase === 'out' ? left / SALLY.out : 0), 5);
    if (this.phase === 'out') hintRow(c, [{ key: 'night.melee', label: 'swing' }, { key: 'night.sally', label: 'back' }], x, y - 6, 'center');
    c.restore();
  }
  /** The bottom-left keycap: [O] sally when it is ready. */
  hints(): Hint[] {
    return this.ready() ? [{ key: 'night.sally', label: 'sally', hot: true }] : [];
  }
}
