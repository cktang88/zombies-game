import type { Survivor, Res, WeaponItem } from '../types';
import { G, R, log, add, newWeapon, findDoc } from '../state';
import { ZOMBIES, type ZombieDef } from '../data/zombies';
import { WEAPONS } from '../data/weapons';
import { SITES, RES_LABEL, type Site } from '../data/world';
import { img, flashImg, shadeImg } from '../assets';
import { sfx, wind } from '../audio';
import { aimFactor, first, displayName, wound, pain, killSurvivor, tale, addThought, skillOf, makeSurvivor } from '../sim/survivors';

// A daylight scavenging run you play yourself: walk right through the street,
// search doorways, and get back to the left edge before dark.
const W = 1280, H = 720;
const GROUND = 664;
const SH = 158;
const ZS = 1.3;

interface EZ {
  def: ZombieDef; sprite: string; x: number; y: number; hp: number; state: 'sleep' | 'walk' | 'grab' | 'dying' | 'kin';
  phase: number; flash: number; dieT: number; grabT: number; dir: number; headless?: boolean; lungeT: number;
}
interface Spot { x: number; searched: boolean; kind: 'door' | 'car' | 'shed' | 'body' | 'kin'; label: string; loot: number; survivor?: boolean }
interface P { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; g: number }

export interface ExpeditionResult { loot: Partial<Record<Res, number>>; weapons: string[]; died: boolean; found?: Survivor; lines: string[] }

export class Expedition {
  c: CanvasRenderingContext2D;
  s: Survivor;
  w: WeaponItem | null;
  site: Site;
  len: number;
  px = 120;
  face = 1;
  cam = 0;
  t = 0;
  daylight: number;
  zs: EZ[] = [];
  spots: Spot[] = [];
  parts: P[] = [];
  tracers: { x1: number; y1: number; x2: number; y2: number; life: number }[] = [];
  keys = new Set<string>();
  mouse = { x: 900, y: 500, down: false };
  mag: number;
  reload = 0;
  cd = 0;
  bloom = 0;
  shake = 0;
  searching: Spot | null = null;
  searchT = 0;
  loot: Partial<Record<Res, number>> = {};
  weapons: string[] = [];
  lines: string[] = [];
  msgs: { text: string; life: number }[] = [];
  found?: Survivor;
  ended = false;
  raf = 0;
  last = 0;
  shoveCd = 0;
  noise = 0;
  onEnd: (r: ExpeditionResult) => void;
  kh: (e: KeyboardEvent) => void;
  ku: (e: KeyboardEvent) => void;
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, s: Survivor, siteId: string, onEnd: (r: ExpeditionResult) => void) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d')!;
    this.s = s;
    this.w = G.weapons.find((x) => x.uid === s.weapon) ?? null;
    this.site = SITES.find((x) => x.id === siteId)!;
    this.onEnd = onEnd;
    this.len = 3600 + Math.round(this.site.risk * 2400);
    this.daylight = 150;
    this.mag = this.w ? WEAPONS[this.w.def].mag : 0;
    this.build();
    this.kh = (e) => this.key(e, true);
    this.ku = (e) => this.key(e, false);
    this.bind();
    wind(true);
    this.say(`${this.site.name}. ${this.site.desc}`, 6);
    this.say('[A/D] walk · [E] search · [Space] shove · back to the left edge before dark.', 8);
  }

  build() {
    const stockKey = `stock_${this.site.id}`;
    const stock = (G.flags[stockKey] as number) ?? this.site.stock;
    const fullness = Math.max(0.2, stock / this.site.stock);
    const kinds: Spot['kind'][] = ['door', 'door', 'car', 'shed', 'body'];
    const labels: Record<Spot['kind'], string[]> = {
      door: ['a kitchen door', 'a mudroom', 'a back porch', 'a storefront', 'a basement hatch', 'a garage'],
      car: ['a station wagon', 'a pickup bed', 'a county cruiser', 'a minivan'],
      shed: ['a tool shed', 'an ice-fishing shanty', 'a woodpile'],
      body: ['a body in a hunting jacket', 'a body in scrubs', 'a body by the mailbox'],
      kin: ['a kitchen window'],
    };
    for (let x = 520; x < this.len - 200; x += R.range(300, 520)) {
      const kind: Spot['kind'] = R.chance(G.day > 3 ? 0.12 : 0) ? 'kin' : R.pick(kinds);
      this.spots.push({ x, searched: false, kind, label: R.pick(labels[kind]), loot: fullness * R.range(0.5, 1.3) });
    }
    const doors = this.spots.filter((s) => s.kind === 'door');
    if (doors.length && R.chance(this.site.survivorChance * 1.6)) R.pick(doors).survivor = true;
    const n = Math.round(6 + this.site.risk * 22 + G.day * 0.5);
    for (let i = 0; i < n; i++) {
      const pool = Object.values(ZOMBIES).filter((z) => z.minDay <= G.day && z.id !== 'ferryman' && z.id !== 'crier');
      const def = R.weighted(pool, (z) => (z.id === 'sleeper' ? 6 : z.id === 'drag' ? 1.5 : z.id === 'deer' ? 1.2 : 0.6))!;
      this.zs.push(this.mk(def, R.range(700, this.len - 60), R.chance(0.7) ? 'sleep' : 'walk'));
    }
  }

  mk(def: ZombieDef, x: number, state: EZ['state']): EZ {
    return { def, sprite: R.pick(def.sprites), x, y: GROUND + R.range(-6, 8), hp: def.hp, state, phase: R.range(0, 9), flash: 0, dieT: 0, grabT: 0, dir: -1, lungeT: R.range(1, 3) };
  }

  bind() {
    const c = this.canvas;
    const pos = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * W;
      this.mouse.y = ((e.clientY - r.top) / r.height) * H;
    };
    c.onmousemove = pos;
    c.onmousedown = (e) => { pos(e); if (e.button === 0) { this.mouse.down = true; this.fire(true); } };
    c.onmouseup = () => (this.mouse.down = false);
    c.oncontextmenu = (e) => e.preventDefault();
    window.addEventListener('keydown', this.kh);
    window.addEventListener('keyup', this.ku);
  }

  key(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (k === 'r') this.startReload();
    if (k === ' ') { this.shove(); e.preventDefault(); }
  }

  say(text: string, life = 4) {
    this.msgs.push({ text, life });
    if (this.msgs.length > 3) this.msgs.shift();
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      if (!this.ended) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.kh);
    window.removeEventListener('keyup', this.ku);
    const c = this.canvas;
    c.onmousemove = c.onmousedown = c.onmouseup = null;
    wind(false);
  }

  // ---------- update ----------
  update(dt: number) {
    if (this.ended) return;
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 18);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.cd -= dt;
    this.shoveCd -= dt;
    const legHurt = this.s.wounds.filter((w) => w.part === 'lleg' || w.part === 'rleg').reduce((a, w) => a + w.severity, 0) + (this.s.scars.some((x) => x.label.includes('leg')) ? 0.6 : 0);
    const speed = 150 * Math.max(0.35, 1 - legHurt * 0.5);
    const grabbed = this.zs.some((z) => z.state === 'grab');
    if (!grabbed && !this.searching) {
      if (this.keys.has('a') || this.keys.has('arrowleft')) { this.px -= speed * dt; this.face = -1; }
      if (this.keys.has('d') || this.keys.has('arrowright')) { this.px += speed * dt; this.face = 1; }
    }
    if (this.mouse.x + this.cam < this.px) this.face = -1; else this.face = 1;
    this.px = Math.max(20, Math.min(this.len - 40, this.px));
    this.cam += (this.px - W * 0.35 - this.cam) * Math.min(1, dt * 5);
    this.cam = Math.max(0, Math.min(this.len - W, this.cam));
    // search
    const near = this.spots.find((s) => !s.searched && Math.abs(s.x - this.px) < 60);
    if (this.keys.has('e') && near && !this.searching) { this.searching = near; this.searchT = 0; }
    if (this.searching) {
      if (!this.keys.has('e') || Math.abs(this.searching.x - this.px) > 70 || grabbed) this.searching = null;
      else {
        this.searchT += dt * (0.7 + skillOf(this.s, 'scavenging') * 0.06);
        if (this.searchT >= 2.5) this.finishSearch(this.searching);
      }
    }
    // reload / fire
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.doReload();
    }
    if (this.mouse.down && this.w && WEAPONS[this.w.def].auto) this.fire(false);
    // daylight
    this.daylight -= dt;
    if (this.daylight < 0 && R.chance(dt * 0.6)) {
      const x = this.cam + (R.chance(0.5) ? -60 : W + 60);
      if (x > 0 && x < this.len) this.zs.push(this.mk(R.chance(0.6) ? ZOMBIES.sleeper : ZOMBIES.deer, x, 'walk'));
    }
    if (Math.floor(this.daylight) === 30 && Math.floor(this.daylight + dt) === 31) this.say('The light is going. Get back.', 4);
    if (Math.floor(this.daylight) === 0 && Math.floor(this.daylight + dt) === 1) this.say('Dusk. They are waking up everywhere.', 5);
    // zombies
    for (const z of this.zs) this.updZ(z, dt);
    this.zs = this.zs.filter((z) => !(z.state === 'dying' && z.dieT > 0.6));
    // noise wakes sleepers
    if (this.noise > 0) {
      for (const z of this.zs) if (z.state === 'sleep' && Math.abs(z.x - this.px) < this.noise * 260) z.state = 'walk';
      this.noise = Math.max(0, this.noise - dt * 3);
    }
    for (const p of this.parts) { p.life -= dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > p.g) p.life = 0; }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const m of this.msgs) m.life -= dt;
    this.msgs = this.msgs.filter((m) => m.life > 0);
    if (this.px <= 22 && this.t > 2 && (this.keys.has('a') || this.keys.has('arrowleft'))) this.finish(false);
  }

  updZ(z: EZ, dt: number) {
    z.flash = Math.max(0, z.flash - dt);
    if (z.state === 'dying') { z.dieT += dt; return; }
    z.phase += dt;
    if (z.state === 'kin') return;
    const d = this.px - z.x;
    if (z.state === 'sleep') {
      if (Math.abs(d) < 110 || (this.daylight < 0 && R.chance(dt * 0.3))) { z.state = 'walk'; if (R.chance(0.5)) sfx.groan(); }
      return;
    }
    if (z.state === 'walk') {
      z.dir = Math.sign(d);
      let sp = z.def.speed * 0.9;
      if (z.def.lunge) { z.lungeT -= dt; if (z.lungeT < 0) { sp *= 0.15; if (z.lungeT < -0.8) z.lungeT = R.range(1.2, 2.6); } }
      z.x += z.dir * sp * dt;
      if (Math.abs(d) < 34) { z.state = 'grab'; z.grabT = 0.8; this.say('Grabbed!', 1.5); }
    } else if (z.state === 'grab') {
      if (Math.abs(d) > 60) { z.state = 'walk'; return; }
      z.grabT -= dt;
      if (z.grabT <= 0) {
        z.grabT = R.range(1.1, 1.7);
        const bite = R.chance(0.3);
        const wd = wound(this.s, bite ? 'bite' : R.pick(['laceration', 'scratch', 'bruise']), R.range(0.18, 0.4));
        sfx.hurt();
        this.shake = 6;
        for (let i = 0; i < 6; i++) this.parts.push({ x: this.px, y: GROUND - 90, vx: R.range(-120, 120), vy: R.range(-160, 0), life: 1, color: '#5e1410', size: 3, g: GROUND });
        this.say(bite ? `${first(this.s)} is BITTEN.` : `${wd.kind}.`, 2.5);
        if (bite) tale(this.s, `Bitten at ${this.site.name}, out on a run.`);
        if (pain(this.s) > 1.45) this.finish(true, `torn apart at ${this.site.name} by ${z.def.name === 'Sleeper' ? 'Sleepers' : `a ${z.def.name}`}`);
      }
    }
  }

  shove() {
    if (this.shoveCd > 0) return;
    this.shoveCd = 0.8;
    sfx.thud();
    for (const z of this.zs) {
      if (z.state === 'dying' || z.state === 'kin') continue;
      const d = z.x - this.px;
      if (Math.abs(d) < 70 && Math.sign(d) === this.face) {
        z.x += this.face * (z.def.id === 'ferryman' ? 10 : 80);
        z.state = z.state === 'sleep' ? 'walk' : z.state === 'grab' ? 'walk' : z.state;
        z.hp -= 8;
        z.flash = 0.1;
        if (z.hp <= 0) this.kill(z);
      }
    }
  }

  startReload() {
    if (!this.w || this.reload > 0) return;
    const def = WEAPONS[this.w.def];
    if (this.mag >= def.mag) return;
    const per = def.ammo === 'scrap' ? 0.05 : 1;
    if (def.ammo && G.stores[def.ammo] < per) { this.say('No ammunition. Shove [Space] and run.', 2); sfx.click(); return; }
    this.reload = def.reload;
    sfx.reload();
  }

  doReload() {
    if (!this.w) return;
    const def = WEAPONS[this.w.def];
    const per = def.ammo === 'scrap' ? 0.05 : 1;
    const need = def.mag - this.mag;
    const got = def.ammo ? Math.min(need, Math.floor(G.stores[def.ammo] / per + 1e-6)) : need;
    if (def.ammo) add(def.ammo, -got * per);
    this.mag += got;
  }

  muzzle() {
    return { x: this.px - this.cam + this.face * SH * 0.45, y: GROUND - SH * 0.68 };
  }

  fire(click: boolean) {
    if (!this.w || this.cd > 0 || this.reload > 0 || this.searching) return;
    const def = WEAPONS[this.w.def];
    if (!click && !def.auto) return;
    if (this.mag <= 0) { sfx.click(); this.startReload(); this.cd = 0.25; return; }
    this.mag--;
    this.cd = 1 / def.rof;
    const mz = this.muzzle();
    const base = Math.atan2(this.mouse.y - mz.y, this.mouse.x - mz.x);
    const spreadA = def.spread * (1.75 - aimFactor(this.s)) + this.bloom;
    for (let i = 0; i < def.pellets; i++) this.ray(mz.x + this.cam, mz.y, base + (R.next() + R.next() - 1) * (def.pellets > 1 ? def.spread : spreadA), def.dmg, def.pierce, def.knock, def.pellets > 1);
    this.bloom = Math.min(0.12, this.bloom + def.spread * 0.35 + 0.01);
    this.shake = Math.max(this.shake, def.knock / 7);
    this.noise = Math.min(4, this.noise + def.noise);
    sfx.shot(def.id);
    if (this.mag === 0) this.startReload();
  }

  ray(ox: number, oy: number, a: number, dmg: number, pierce: number, knock: number, pellet: boolean) {
    const dx = Math.cos(a), dy = Math.sin(a);
    const hits: { z: EZ; t: number; head: boolean }[] = [];
    for (const z of this.zs) {
      if (z.state === 'dying') continue;
      const h = z.def.height * ZS, w = z.def.width * ZS;
      const crawl = z.def.id === 'drag';
      const hx = (crawl ? z.x + z.dir * w * 0.36 : z.x + z.dir * w * 0.12) - ox;
      const hy = (crawl ? z.y - h * 0.62 : z.y - h + h * z.def.head * 0.5) - oy;
      const hr = z.headless ? 0 : crawl ? h * 0.3 : h * z.def.head * 0.62;
      const tc = hx * dx + hy * dy, d2 = hx * hx + hy * hy - tc * tc;
      if (tc > 0 && d2 < hr * hr) { hits.push({ z, t: tc, head: true }); continue; }
      const x1 = z.x - w / 2, x2 = z.x + w / 2, y1 = z.y - h + h * z.def.head * 0.8, y2 = z.y;
      const t1 = (x1 - ox) / dx, t2 = (x2 - ox) / dx, t3 = (y1 - oy) / dy, t4 = (y2 - oy) / dy;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4)), tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
      if (tmax >= 0 && tmin <= tmax) hits.push({ z, t: Math.max(0, tmin), head: false });
    }
    hits.sort((p, q) => p.t - q.t);
    let end = 1500, n = 0, d = dmg;
    for (const h of hits) {
      const z = h.z;
      let dd = h.head ? d * (pellet ? 2 : 3) : z.def.armor ? Math.max(d * 0.15, d - z.def.armor) : d;
      if (z.state === 'kin') {
        dd *= 1;
        this.lines.push(`${first(this.s)} shot the Kin at ${this.site.name}.`);
        addThought(this.s, { id: 'shot_kin', label: 'Shot one sitting at its own table', mood: -5, days: 3 }, 1);
      }
      z.hp -= dd;
      z.flash = 0.08;
      if (z.state === 'sleep' || z.state === 'kin') z.state = 'walk';
      z.x += Math.sign(dx) * knock * (pellet ? 0.25 : 1);
      if (z.state === 'grab' && knock > 15) z.state = 'walk';
      const px = ox + dx * h.t, py = oy + dy * h.t;
      for (let i = 0; i < (h.head ? 9 : 4); i++) this.parts.push({ x: px, y: py, vx: Math.sign(dx) * R.range(20, 200), vy: R.range(-200, 30), life: 1.4, color: R.pick(['#4a0d0b', '#5e1410', '#3a0a08']), size: R.range(1.5, 4), g: z.y });
      if (z.hp <= 0) {
        if (h.head && !z.headless && z.def.id !== 'drag') { z.headless = true; sfx.headpop(); }
        this.kill(z);
      } else sfx.hit();
      n++; end = h.t;
      if (n > pierce) break;
      d *= 0.7;
    }
    this.tracers.push({ x1: ox + dx * 20, y1: oy + dy * 20, x2: ox + dx * end, y2: oy + dy * end, life: 0.07 });
  }

  kill(z: EZ) {
    if (z.state === 'dying') return;
    z.state = 'dying';
    z.dieT = 0;
    this.s.kills++;
    G.stats.kills++;
    if (this.w) this.w.kills++;
  }

  finishSearch(sp: Spot) {
    sp.searched = true;
    this.searching = null;
    sfx.ui();
    this.noise = Math.min(4, this.noise + 0.5);
    if (sp.kind === 'kin') {
      add('food', 6);
      this.loot.food = (this.loot.food ?? 0) + 6;
      this.say('One of them sits at the table with its hands folded. You take the pantry and do not look at it.', 5);
      addThought(this.s, { id: 'kin_pantry', label: 'Robbed a house with one of them still sitting at the table', mood: -4, days: 3 }, 1);
      return;
    }
    if (sp.survivor) {
      const n = makeSurvivor();
      this.found = n;
      this.say(`Someone is alive in ${sp.label}: ${displayName(n)}. ${n.sex === 'm' ? 'He' : 'She'} follows you.`, 6);
      return;
    }
    const got: string[] = [];
    const mult = sp.loot * (0.6 + skillOf(this.s, 'scavenging') * 0.08) * (sp.kind === 'car' ? 0.6 : sp.kind === 'body' ? 0.5 : 1) * 0.55;
    for (const [k, v] of Object.entries(this.site.loot)) {
      if (!R.chance(0.65)) continue;
      const n = Math.round((v ?? 0) * mult * R.range(0.5, 1.5));
      if (n > 0) { add(k as Res, n); this.loot[k as Res] = (this.loot[k as Res] ?? 0) + n; got.push(`${n} ${RES_LABEL[k as Res].toLowerCase()}`); }
    }
    if (sp.kind !== 'car' && R.chance(0.22)) {
      const d = findDoc();
      if (d) { got.push(`papers: "${d.title}"`); this.lines.push(`Found papers: ${d.title}. (Town tab)`); }
    }
    if (R.chance(this.site.weaponChance * 0.5 * sp.loot)) {
      const wd = R.pick(this.site.weapons);
      newWeapon(wd, R.range(0.5, 1));
      this.weapons.push(wd);
      got.push(`a ${WEAPONS[wd].name.toLowerCase()}`);
    }
    this.say(got.length ? `${sp.label[0].toUpperCase() + sp.label.slice(1)}: ${got.join(', ')}.` : `${sp.label[0].toUpperCase() + sp.label.slice(1)}: nothing. Somebody got here first.`, 3.5);
  }

  finish(died: boolean, cause?: string) {
    if (this.ended) return;
    this.ended = true;
    this.destroy();
    const stockKey = `stock_${this.site.id}`;
    G.flags[stockKey] = ((G.flags[stockKey] as number) ?? this.site.stock) - 1;
    if (died) {
      killSurvivor(this.s, cause ?? `on a run to ${this.site.name}`);
      log('death', `${displayName(this.s)} went to ${this.site.name} and did not come back. Whatever they carried is out there still.`);
      for (const [k, v] of Object.entries(this.loot)) add(k as Res, -(v ?? 0));
    } else {
      const total = Object.values(this.loot).reduce((a, b) => a + (b ?? 0), 0);
      if (total > 40) tale(this.s, `Came back from ${this.site.name} loaded down.`);
      log('event', `${displayName(this.s)} led a run to ${this.site.name} and came back.`);
    }
    this.onEnd({ loot: this.loot, weapons: this.weapons, died, found: died ? undefined : this.found, lines: this.lines });
  }

  // ---------- draw ----------
  draw() {
    const c = this.c;
    c.save();
    if (this.shake) c.translate(R.range(-this.shake, this.shake), R.range(-this.shake, this.shake));
    const far = img('bg_far'), mid = img('bg_mid');
    // far layer: slow parallax, tiled
    if (far) for (let x = -((this.cam * 0.25) % 1600); x < W; x += 1600) c.drawImage(far, x, -60, 1600, 720);
    // mid layer tiled (flipped alternately to hide the seam)
    if (mid) {
      const off = (this.cam * 0.7) % 3200;
      for (let i = -1; i < 3; i++) {
        const x = i * 1600 - off;
        if (x > W || x + 1600 < 0) continue;
        c.save();
        if (i % 2 !== 0) { c.translate(x + 1600, 0); c.scale(-1, 1); c.drawImage(mid, 0, 20, 1600, 720); }
        else c.drawImage(mid, x, 20, 1600, 720);
        c.restore();
      }
    }
    // dusk grade by daylight left
    const dusk = Math.max(0, 1 - this.daylight / 150);
    c.fillStyle = `rgba(30,24,40,${0.05 + dusk * 0.5})`;
    c.fillRect(0, 0, W, H);
    // ground strip
    const g = c.createLinearGradient(0, 620, 0, H);
    g.addColorStop(0, 'rgba(20,20,22,0)');
    g.addColorStop(0.3, 'rgba(20,20,22,0.7)');
    g.addColorStop(1, 'rgba(10,10,12,0.95)');
    c.fillStyle = g;
    c.fillRect(0, 620, W, H - 620);
    // home marker
    if (this.cam < 200) {
      c.fillStyle = 'rgba(232,200,120,0.15)';
      c.fillRect(-this.cam, 400, 40, 270);
      c.font = '13px "Special Elite", monospace';
      c.fillStyle = '#d8c89a';
      c.fillText('← home', 30 - this.cam, 420);
    }
    // spots
    const SPR: Record<Spot['kind'], [string, number]> = { door: ['obj_door', 200], car: ['obj_car', 120], shed: ['obj_shed', 190], body: ['obj_body', 44], kin: ['obj_kin', 175] };
    for (const sp of this.spots) {
      const x = sp.x - this.cam;
      if (x < -250 || x > W + 250) continue;
      const [id, h] = SPR[sp.kind];
      const im = img(id);
      if (im) {
        const w = (im.width / im.height) * h;
        c.globalAlpha = sp.searched ? 0.55 : 1;
        c.filter = sp.searched ? 'brightness(0.6)' : 'none';
        c.drawImage(im, x - w / 2, GROUND - h + (sp.kind === 'body' ? 6 : 4), w, h);
        c.filter = 'none';
        c.globalAlpha = 1;
      }
      if (!sp.searched && Math.abs(sp.x - this.px) < 60) {
        c.font = '13px "Special Elite", monospace';
        c.fillStyle = '#efe2c2';
        c.textAlign = 'center';
        c.fillText(`[E] search ${sp.label}`, x, GROUND - h - 14);
        c.textAlign = 'left';
      } else if (!sp.searched) {
        c.fillStyle = 'rgba(232,200,120,0.7)';
        c.beginPath(); c.arc(x, GROUND - h - 10, 3, 0, 7); c.fill();
      }
    }
    // actors by y
    const list: { y: number; f: () => void }[] = [];
    for (const z of this.zs) list.push({ y: z.y, f: () => this.drawZ(z) });
    list.push({ y: GROUND, f: () => this.drawP() });
    if (this.found) list.push({ y: GROUND - 2, f: () => this.drawFollower() });
    list.sort((a, b) => a.y - b.y);
    for (const l of list) l.f();
    for (const p of this.parts) { c.fillStyle = p.color; c.fillRect(p.x - this.cam, p.y, p.size, p.size); }
    for (const t of this.tracers) {
      c.strokeStyle = `rgba(255,226,170,${t.life * 12})`;
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(t.x1 - this.cam, t.y1); c.lineTo(t.x2 - this.cam, t.y2); c.stroke();
    }
    c.restore();
    this.hud();
  }

  drawP() {
    const c = this.c;
    const im = img(this.s.sprite);
    if (!im) return;
    const h = SH, w = (im.width / im.height) * h;
    const x = this.px - this.cam;
    const moving = this.keys.has('a') || this.keys.has('d') || this.keys.has('arrowleft') || this.keys.has('arrowright');
    const bob = moving ? -Math.abs(Math.sin(this.t * 9)) * 4 : 0;
    c.save();
    c.translate(x, GROUND + bob);
    c.scale(this.face, 1);
    c.drawImage(im, -w / 2, -h, w, h);
    c.restore();
    if (this.searching) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(x - 30, GROUND - h - 22, 60, 6);
      c.fillStyle = '#d9c9a0';
      c.fillRect(x - 30, GROUND - h - 22, 60 * Math.min(1, this.searchT / 2.5), 6);
    }
  }

  fx = 0;
  drawFollower() {
    const c = this.c;
    const f = this.found!;
    const im = img(f.sprite);
    if (!im) return;
    const target = this.px - this.face * 70;
    this.fx = this.fx ? this.fx + (target - this.fx) * 0.05 : target;
    const h = SH * 0.97, w = (im.width / im.height) * h;
    c.save();
    c.translate(this.fx - this.cam, GROUND - 2);
    c.scale(this.face, 1);
    c.filter = 'brightness(0.85)';
    c.drawImage(im, -w / 2, -h, w, h);
    c.restore();
  }

  drawZ(z: EZ) {
    const c = this.c;
    const im = img(z.sprite);
    if (!im) return;
    const h = z.def.height * ZS, w = (im.width / im.height) * h;
    const x = z.x - this.cam;
    if (x < -200 || x > W + 200) return;
    c.save();
    let rot = 0, dy = 0;
    if (z.state === 'walk') { rot = Math.sin(z.phase * 3.2) * 0.04; dy = -Math.abs(Math.sin(z.phase * 3.2)) * 2.5; }
    if (z.state === 'sleep' || z.state === 'kin') rot = 0.06 + Math.sin(z.phase * 0.7) * 0.01;
    if (z.state === 'grab') rot = -0.1 + Math.sin(z.phase * 7) * 0.06;
    if (z.state === 'dying') { const k = Math.min(1, z.dieT / 0.45); rot = k * 1.2; dy = k * h * 0.15; c.globalAlpha = 1 - Math.max(0, z.dieT - 0.4) * 5; }
    c.translate(x, z.y + dy);
    c.scale(-z.dir, 1); // sprites face left by default
    c.rotate(rot);
    if (z.headless) { c.beginPath(); c.rect(-w / 2 - 10, -h + h * z.def.head * 0.95, w + 20, h); c.clip(); }
    if (z.state === 'kin') c.filter = 'saturate(0.4) brightness(0.8)';
    c.drawImage(im, -w / 2, -h, w, h);
    c.filter = 'none';
    if (z.flash > 0) { const f = flashImg(z.sprite); if (f) { c.globalAlpha = 0.6; c.drawImage(f, -w / 2, -h, w, h); } }
    c.restore();
    if (z.state === 'sleep') {
      c.font = '11px "Special Elite", monospace';
      c.fillStyle = 'rgba(200,190,170,0.6)';
      c.textAlign = 'center';
      c.fillText('standing still', x, z.y - h - 8);
      c.textAlign = 'left';
    }
    void shadeImg;
  }

  hud() {
    const c = this.c;
    c.font = '15px "Special Elite", monospace';
    c.fillStyle = '#e8dcc0';
    c.textAlign = 'left';
    c.fillText(`${this.site.name} · ${first(this.s)}`, 20, 30);
    const dl = Math.max(0, this.daylight);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(20, 40, 200, 8);
    c.fillStyle = dl > 40 ? '#c9b27a' : '#b0502c';
    c.fillRect(20, 40, 200 * (dl / 150), 8);
    c.font = '11px "Special Elite", monospace';
    c.fillStyle = '#a89c84';
    c.fillText(this.daylight > 0 ? 'daylight left' : 'DUSK — get home', 228, 48);
    const hp = Math.max(0, 1 - pain(this.s) / 1.45);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(20, 56, 200, 6);
    c.fillStyle = hp > 0.5 ? '#9db070' : '#c04030';
    c.fillRect(20, 56, 200 * hp, 6);
    // progress along the street
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(W / 2 - 150, 24, 300, 4);
    c.fillStyle = '#d9c9a0';
    c.fillRect(W / 2 - 150 + 300 * (this.px / this.len) - 2, 20, 4, 12);
    for (const sp of this.spots) { c.fillStyle = sp.searched ? '#555' : '#c9b27a'; c.fillRect(W / 2 - 150 + 300 * (sp.x / this.len), 25, 2, 2); }
    const loot = Object.entries(this.loot).map(([k, v]) => `${v} ${RES_LABEL[k as Res].toLowerCase()}`).join(', ');
    c.fillStyle = '#c9b27a';
    c.fillText(loot ? `carrying: ${loot}` : 'carrying nothing yet', 20, H - 20);
    if (this.w) {
      const def = WEAPONS[this.w.def];
      c.textAlign = 'right';
      c.font = '20px "Special Elite", monospace';
      c.fillStyle = this.mag ? '#efe2c2' : '#c04030';
      c.fillText(`${this.mag} / ${def.ammo ? Math.floor(G.stores[def.ammo] / (def.ammo === 'scrap' ? 0.05 : 1)) : '∞'}`, W - 20, H - 20);
      c.font = '12px "Special Elite", monospace';
      c.fillStyle = '#a89c84';
      c.fillText(this.reload > 0 ? 'reloading…' : def.name, W - 20, H - 46);
    }
    c.textAlign = 'center';
    this.msgs.forEach((m, i) => {
      c.font = '16px "Special Elite", monospace';
      c.fillStyle = `rgba(232,220,192,${Math.min(1, m.life)})`;
      c.fillText(m.text, W / 2, 80 + i * 24);
    });
    // crosshair
    if (this.w) {
      const def = WEAPONS[this.w.def];
      const mz = this.muzzle();
      const dist = Math.hypot(this.mouse.x - mz.x, this.mouse.y - mz.y);
      const r = Math.max(5, Math.tan((def.pellets > 1 ? def.spread : def.spread * (1.75 - aimFactor(this.s))) + this.bloom) * dist);
      c.strokeStyle = 'rgba(235,225,200,0.85)';
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(this.mouse.x, this.mouse.y, r, 0, 7); c.stroke();
    }
    c.textAlign = 'left';
  }
}
