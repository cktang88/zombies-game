import type { Survivor, Res, WeaponItem } from '../types';
import { G, R, log, add, newWeapon, findDoc, uid } from '../state';
import { ZOMBIES, type ZombieDef } from '../data/zombies';
import { WEAPONS, fireProfile, ammoTypesFor, ammoLabel, AMMO_TYPES, armorDamage, roundsInStores, shotSound, BURN, FLARE_LIGHT, MODS, wearMods, blastDamage, type FireProfile } from '../data/weapons';
import { SITES, RES_LABEL, type Site } from '../data/world';
import { img, flashImg, shadeImg } from '../assets';
import { depthScale, canvas, bakeSprite, bakeLayer, bakeGround, fgStrip, type Look, type Baked } from './render';
import { sfx, wind } from '../audio';
import { aimFactor, first, displayName, wound, pain, killSurvivor, tale, addThought, skillOf, makeSurvivor } from '../sim/survivors';

// A daylight scavenging run you play yourself: walk right through the street,
// search doorways, and get back to the left edge before dark.
const W = 1280, H = 720;
const GROUND = 664;
const SH = 158;
const ZS = 1.3;
// Depth (docs/research/04 §3.8): three walking lanes, perspective scale, y-sort by feet.
const LANES = [640, 664, 688]; // feet y, far → near; the player walks the middle lane
const LANE_TOL = 16;
// per-lane bake look (by day: a lighter version of the night table)
const LANE_LOOK: Look[] = [
  { b: 0.86, s: 0.78, fog: 0.12, outline: 1 },
  { b: 0.95, s: 0.9, fog: 0.05, outline: 1.5 },
  { b: 1, s: 1, fog: 0, outline: 2 },
];

// Baked zombie: outline stamps + lane grade + fog + variant tint, at the lane's display size.
function bakeZ(sprite: string, h: number, lane: number, variant: number, kin: boolean): Baked | null {
  return bakeSprite(sprite, h, LANE_LOOK[lane], variant, kin ? { b: 0.8, s: 0.4 } : {});
}

// Searched spots: a baked darker copy drawn opaque (no translucent box, no per-frame filter).
const spotCache = new Map<string, HTMLCanvasElement>();
function bakeSpot(id: string, h: number, dark: boolean): HTMLCanvasElement | null {
  const key = `${id}|${h}|${dark ? 1 : 0}`;
  const hit = spotCache.get(key);
  if (hit) return hit;
  const im = img(id);
  if (!im) return null;
  const w = (im.width / im.height) * h;
  const [cv, x] = canvas(w, h);
  if (dark) x.filter = 'brightness(0.5) saturate(0.6)';
  x.drawImage(im, 0, 0, cv.width, cv.height);
  spotCache.set(key, cv);
  return cv;
}

// Backgrounds: far & mid baked once each for day and dusk; dusk is a crossfade.
interface BgBake { far: HTMLCanvasElement; mid: HTMLCanvasElement }
let bgBakes: { day: BgBake; dusk: BgBake } | null = null;
let groundC: HTMLCanvasElement | null = null;
let fgC: HTMLCanvasElement | null = null;
function bakeBackgrounds() {
  if (bgBakes || !img('bg_far') || !img('bg_mid')) return;
  bgBakes = {
    day: {
      far: bakeLayer('bg_far', 1600, 720, 'brightness(0.72) saturate(0.5) blur(2px)', '#9aa3ae', 0.28, false),
      mid: bakeLayer('bg_mid', 1600, 720, 'brightness(0.8) saturate(0.6) contrast(0.85) blur(1.2px)', '#9aa3ae', 0.16, true),
    },
    dusk: {
      far: bakeLayer('bg_far', 1600, 720, 'brightness(0.4) saturate(0.4) blur(2px)', '#1b2333', 0.4, false),
      mid: bakeLayer('bg_mid', 1600, 720, 'brightness(0.45) saturate(0.45) contrast(0.85) blur(1.2px)', '#1b2333', 0.35, true),
    },
  };
  // ground plane: dark asphalt, speckle, faint ruts along the lanes (tiles every 256px)
  groundC = bakeGround(W + 256, H - 596, 596, LANES);
  // foreground strip: near-black weeds, kerb rubble, a tyre (tiles every 2560px)
  fgC = fgStrip();
}

interface EZ {
  def: ZombieDef; sprite: string; x: number; y: number; hp: number; state: 'sleep' | 'walk' | 'grab' | 'dying' | 'kin';
  phase: number; flash: number; dieT: number; grabT: number; dir: number; headless?: boolean; lungeT: number; burn?: number;
  id: number; lane: number; sc: number; variant: number;
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
  magRes: Res | null = null; // bullet type currently in the magazine
  burstLeft = 0;
  burstT = 0;
  spent: Partial<Record<Res, number>> = {};
  roundsFired = 0;
  lobs: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; p: FireProfile }[] = [];
  glows: { x: number; y: number; life: number; max: number }[] = [];
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
    this.mag = this.w ? this.prof()!.mag : 0;
    this.magRes = this.w ? this.prof()!.ammoRes : null;
    this.build();
    this.kh = (e) => this.key(e, true);
    this.ku = (e) => this.key(e, false);
    this.bind();
    wind(true);
    this.say(`${this.site.name}. ${this.site.desc}`, 6);
    this.say(`[A/D] walk · [E] search · [Space] shove${this.w && ammoTypesFor(this.w.def).length > 1 ? ' · [T] switch ammo' : ''} · back to the left edge before dark.`, 8);
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

  zid = 0;
  mk(def: ZombieDef, x: number, state: EZ['state']): EZ {
    const lane = R.int(0, 2);
    const y = LANES[lane] + R.range(-2, 2);
    const sprite = R.pick(def.sprites);
    // never the same (sprite, variant) as a neighbour within 120px in this or an adjacent lane
    let variant = R.int(0, 2);
    for (let k = 0; k < 3 && this.zs.some((o) => o.sprite === sprite && o.variant === variant && Math.abs(o.x - x) < 120 && Math.abs(o.lane - lane) <= 1); k++) variant = (variant + 1) % 3;
    return { def, sprite, x, y, hp: def.hp, state, phase: R.range(0, 9), flash: 0, dieT: 0, grabT: 0, dir: -1, lungeT: R.range(1, 3), id: ++this.zid, lane, sc: depthScale(y) * R.range(0.96, 1.04), variant };
  }
  zh(z: EZ) { return z.def.height * ZS * z.sc; }
  zw(z: EZ) { return z.def.width * ZS * z.sc; }

  // Last-Stand style lane lock: the shot goes into the lane under the crosshair.
  targetLane(): number {
    const mx = this.mouse.x + this.cam, my = this.mouse.y;
    let best: EZ | null = null;
    for (const z of this.zs) {
      if (z.state === 'dying') continue;
      const h = this.zh(z), w = this.zw(z);
      if (mx > z.x - w / 2 - 4 && mx < z.x + w / 2 + 4 && my > z.y - h && my < z.y && (!best || z.y > best.y)) best = z;
    }
    if (best) return best.y;
    let li = 0, bd = Infinity;
    LANES.forEach((L, i) => { const d = Math.abs(my - (L - 0.55 * 156 * depthScale(L))); if (d < bd) { bd = d; li = i; } });
    return LANES[li];
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
    if (k === 't') this.cycleAmmo();
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
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.shootRound();
    }
    if (this.mouse.down && this.w && this.prof()!.auto) this.fire(false);
    for (const l of this.lobs) { l.t += dt; if (l.t >= l.dur) this.explode(l.x1, l.y1, l.p); }
    this.lobs = this.lobs.filter((l) => l.t < l.dur);
    for (const g of this.glows) g.life -= dt;
    this.glows = this.glows.filter((g) => g.life > 0);
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
    if (z.burn && z.burn > 0) {
      z.burn -= dt;
      z.hp -= BURN.dps * dt;
      if (z.state === 'sleep' || z.state === 'kin') z.state = 'walk';
      if (R.chance(dt * 18)) this.parts.push({ x: z.x + R.range(-12, 12), y: z.y - R.range(20, this.zh(z)), vx: R.range(-20, 20), vy: R.range(-260, -120), life: 0.5, color: R.pick(['#ff9a3a', '#ffcf6a', '#d8501c']), size: R.range(2, 4), g: GROUND + 40 });
      if (z.hp <= 0) { this.kill(z); return; }
    }
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
        z.hp -= this.prof()?.melee || 8; // a lashed hatchet beats a bare shove
        z.flash = 0.1;
        if (z.hp <= 0) this.kill(z);
      }
    }
  }

  prof(): FireProfile | null {
    return this.w ? fireProfile(this.w) : null;
  }

  // [T]: next bullet type for this caliber; unloads the magazine back into stores
  cycleAmmo() {
    if (!this.w) return;
    const types = ammoTypesFor(this.w.def);
    if (types.length < 2) return;
    const cur = this.prof()!.ammoRes;
    const have = types.filter((t) => t === cur || (G.stores[t] ?? 0) > 0);
    const next = have[(have.indexOf(cur!) + 1) % have.length];
    if (!next || next === cur) { this.say(`No other ammunition for the ${WEAPONS[this.w.def].name.toLowerCase()}.`, 2); return; }
    this.unload();
    this.w.ammoType = next;
    this.say(`Loading ${ammoLabel(next).toLowerCase()}.`, 2);
    this.reload = 0;
    this.startReload();
  }

  unload() {
    if (!this.w || !this.magRes || this.mag <= 0) { this.mag = 0; return; }
    add(this.magRes, this.mag * this.prof()!.perShot);
    this.mag = 0;
  }

  startReload() {
    if (!this.w || this.reload > 0) return;
    const p = this.prof()!;
    if (this.magRes !== p.ammoRes) this.unload();
    if (this.mag >= p.mag) return;
    if (roundsInStores(p, G.stores) < 1) { this.say(`No ${ammoLabel(p.ammoRes).toLowerCase()}. ${ammoTypesFor(this.w.def).length > 1 ? '[T] switch ammo, or shove' : 'Shove [Space]'} and run.`, 2); sfx.click(); return; }
    const armHurt = this.s.wounds.some((w) => w.part === 'larm' || w.part === 'rarm') ? 1.35 : 1;
    this.reload = p.reload * armHurt;
    sfx.reload();
  }

  doReload() {
    if (!this.w) return;
    const p = this.prof()!;
    const need = p.reloadPerRound ? 1 : p.mag - this.mag;
    const got = Math.min(need, roundsInStores(p, G.stores));
    if (p.ammoRes) add(p.ammoRes, -got * p.perShot);
    this.mag += got;
    this.magRes = p.ammoRes;
    if (p.reloadPerRound) {
      sfx.shell();
      if (got > 0 && this.mag < p.mag) this.startReload();
    }
  }

  muzzle() {
    return { x: this.px - this.cam + this.face * SH * 0.45, y: GROUND - SH * 0.68 };
  }

  fire(click: boolean) {
    if (!this.w || this.cd > 0 || this.searching || this.burstLeft > 0) return;
    const p = this.prof()!;
    if (!click && !p.auto) return;
    if (this.reload > 0) {
      // a one-at-a-time reload can be interrupted by firing
      if (p.reloadPerRound && this.mag > 0) this.reload = 0;
      else return;
    }
    if (this.mag <= 0) { sfx.click(); this.startReload(); this.cd = 0.25; return; }
    this.cd = 1 / p.rof;
    if (R.chance(p.jam)) {
      this.say(`${this.w.name ?? WEAPONS[this.w.def].name} jammed.`, 1.5);
      sfx.click();
      this.cd = p.jamClear;
      return;
    }
    this.burstLeft = p.burst;
    this.shootRound();
  }

  // one round of a trigger pull (bursts call this again after burstGap; gap 0 = all at once)
  shootRound() {
    if (!this.w) { this.burstLeft = 0; return; }
    const p = this.prof()!;
    do {
      if (this.mag <= 0 || this.burstLeft <= 0) { this.burstLeft = 0; break; }
      this.burstLeft--;
      this.mag--;
      if (p.ammoRes) this.spent[p.ammoRes] = (this.spent[p.ammoRes] ?? 0) + p.perShot;
      const mz = this.muzzle();
      const base = Math.atan2(this.mouse.y - mz.y, this.mouse.x - mz.x);
      const spreadA = p.spread * (1.75 - aimFactor(this.s)) + this.bloom;
      const laneY = this.targetLane();
      const li = LANES.indexOf(laneY);
      if (p.explosive && p.arc) {
        // lobbed: lands where you aim, on the target lane, after a short flight
        const tx = this.mouse.x + this.cam + (R.next() + R.next() - 1) * spreadA * Math.abs(this.mouse.x - mz.x) * 1.5;
        this.lobs.push({ x0: mz.x + this.cam, y0: mz.y, x1: tx, y1: laneY, t: 0, dur: 0.35 + Math.abs(tx - mz.x - this.cam) / 1400, p });
      } else if (p.explosive) {
        const hit = this.ray(mz.x + this.cam, mz.y, base + (R.next() + R.next() - 1) * spreadA, p, false, laneY);
        this.explode(hit.x, laneY, p);
      } else for (let i = 0; i < p.pellets; i++) {
        // buckshot sprays a little through depth: 25% per pellet into an adjacent lane
        let ly = laneY;
        if (p.pellets > 1 && R.chance(0.25)) { const adj = LANES[li + (R.chance(0.5) ? 1 : -1)]; if (adj !== undefined) ly = adj; }
        this.ray(mz.x + this.cam, mz.y, base + (R.next() + R.next() - 1) * (p.pellets > 1 ? p.spread : spreadA), p, p.pellets > 1, ly);
      }
      this.bloom = Math.min(0.12, this.bloom + (p.spread * 0.35 / Math.max(1, p.burst) + 0.01) * p.bloomMul);
      this.shake = Math.max(this.shake, p.knock * (p.pellets > 1 ? p.pellets * 0.25 : 1) / 7 * p.recoilMul);
      this.roundsFired++;
      this.noise = Math.min(4, this.noise + p.noise);
      G.stats.shots++;
      this.w.cond = Math.max(0.05, this.w.cond - 0.0008);
      if (p.smoke) for (let i = 0; i < 14; i++) this.parts.push({ x: mz.x + this.cam + this.face * R.range(0, 60), y: mz.y + R.range(-14, 14), vx: this.face * R.range(20, 110), vy: R.range(-240, -120), life: R.range(0.5, 0.9), color: R.pick(['rgba(200,196,186,0.35)', 'rgba(160,156,150,0.3)']), size: R.range(8, 18), g: mz.y + 40 });
      sfx.shot(shotSound(this.w.def));
    } while (this.burstLeft > 0 && p.burstGap <= 0);
    if (this.burstLeft > 0) this.burstT = p.burstGap;
    if (this.mag === 0 && this.burstLeft === 0) this.startReload();
  }

  // Ground-space blast (contract: blastDamage ellipse); armour ignored, knocks outward.
  explode(x: number, y: number, p: FireProfile) {
    const ex = p.explosive!;
    sfx.boom();
    this.shake = Math.max(this.shake, 16);
    this.noise = 4;
    this.glows.push({ x, y: y - 20, life: 0.6, max: 0.6 });
    for (let i = 0; i < 40; i++) this.parts.push({ x: x + R.range(-20, 20), y: y - R.range(0, 40), vx: R.range(-380, 380), vy: R.range(-520, -80), life: R.range(0.4, 1.1), color: R.pick(['#ffb347', '#ff7a2a', '#3a3530', '#5a524a', '#e8d090']), size: R.range(2, 6), g: y + 6 });
    for (const z of this.zs) {
      if (z.state === 'dying') continue;
      const dmg = blastDamage(ex, z.x - x, z.y - y);
      if (dmg <= 0) continue;
      z.hp -= dmg;
      z.flash = 0.12;
      if (z.state === 'sleep' || z.state === 'kin' || z.state === 'grab') z.state = 'walk';
      z.x += Math.sign(z.x - x || 1) * p.knock * (dmg / ex.dmg) * (z.def.id === 'ferryman' ? 0.2 : 1);
      if (z.hp <= 0) this.kill(z);
    }
    // too close: it gets you too
    const d = Math.abs(this.px - x);
    if (d < ex.radius * 0.45 && Math.abs(GROUND - y) <= 30) {
      wound(this.s, 'burn', 0.25 + 0.3 * (1 - d / (ex.radius * 0.45)));
      sfx.hurt();
      this.say('Too close!', 2);
      if (pain(this.s) > 1.45) this.finish(true, `caught in a blast of their own at ${this.site.name}`);
    }
  }

  ray(ox: number, oy: number, a: number, p: FireProfile, pellet: boolean, laneY: number): { x: number; y: number } {
    const { pierce, knock, armorPen } = p;
    const dmg = p.dmg;
    const dx = Math.cos(a), dy = Math.sin(a);
    const hits: { z: EZ; t: number; head: boolean }[] = [];
    for (const z of this.zs) {
      if (z.state === 'dying' || Math.abs(z.y - laneY) > LANE_TOL) continue;
      const h = this.zh(z), w = this.zw(z);
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
    // a miss lands on this lane's ground row
    let end = dy > 0.01 ? Math.min(1500, (laneY - 2 - oy) / dy) : 1500, n = 0, d = dmg;
    for (const h of hits) {
      const z = h.z;
      const dr = h.t > p.range ? d * 0.5 : d; // sawed-off: weak past its range
      let dd = h.head ? dr * (pellet ? 2 : 3) : armorDamage(dr, z.def.armor, armorPen);
      if (z.state === 'kin') {
        dd *= 1;
        this.lines.push(`${first(this.s)} shot the Kin at ${this.site.name}.`);
        addThought(this.s, { id: 'shot_kin', label: 'Shot one sitting at its own table', mood: -5, days: 3 }, 1);
      }
      z.hp -= dd;
      z.flash = 0.08;
      if (p.incendiary) z.burn = BURN.time;
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
    if (p.flare && (!pellet || R.chance(0.2))) this.glows.push({ x: ox + dx * Math.min(end, 1100), y: Math.min(GROUND, oy + dy * Math.min(end, 1100)), life: pellet ? 1.5 : FLARE_LIGHT.time, max: pellet ? 1.5 : FLARE_LIGHT.time });
    return { x: ox + dx * end, y: oy + dy * end };
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
    if (this.site.mods?.length && R.chance(0.14 * sp.loot)) {
      const md = R.pick(this.site.mods);
      (G.modStock ??= []).push({ uid: uid('m'), def: md, cond: R.range(0.6, 1) });
      got.push(`a ${MODS[md].name.toLowerCase()}`);
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
      if (this.w) for (const l of wearMods(this.w, this.roundsFired)) this.lines.push(l);
      const rec = this.prof()?.recoverable ?? 0;
      for (const [k, v] of Object.entries(this.spent)) {
        const back = Math.floor((v ?? 0) * (AMMO_TYPES[k as Res]?.recoverable ?? rec));
        if (back > 0) { add(k as Res, back); this.lines.push(`${first(this.s)} pulled ${back} ${ammoLabel(k as Res).toLowerCase()} back out of the dead.`); }
      }
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
    bakeBackgrounds();
    const dusk = Math.max(0, Math.min(1, 1 - this.daylight / 150));
    if (bgBakes) {
      // far: slow parallax; mid: baked with its mirrored copy (3200 wide), tiled
      for (const [bk, al] of [[bgBakes.day, 1], [bgBakes.dusk, dusk]] as [BgBake, number][]) {
        if (al <= 0.01) continue;
        c.globalAlpha = al;
        for (let x = -Math.round((this.cam * 0.25) % 1600); x < W; x += 1600) c.drawImage(bk.far, x, -60);
        const off = Math.round((this.cam * 0.7) % 3200);
        for (let x = -off; x < W; x += 3200) c.drawImage(bk.mid, x, 20);
        c.globalAlpha = 1;
      }
    }
    // ground plane
    if (groundC) c.drawImage(groundC, -Math.round(this.cam % 256), 596);
    if (dusk > 0) { c.fillStyle = `rgba(8,10,16,${dusk * 0.35})`; c.fillRect(0, 596, W, H - 596); }
    // home marker
    if (this.cam < 200) {
      c.fillStyle = 'rgba(232,200,120,0.15)';
      c.fillRect(-this.cam, 400, 40, 270);
      c.font = '13px "Special Elite", monospace';
      c.fillStyle = '#d8c89a';
      c.fillText('← home', 30 - this.cam, 420);
    }
    // contact shadows: one path, one fill (spots, zombies, player, follower)
    const SPR: Record<Spot['kind'], [string, number]> = { door: ['obj_door', 200], car: ['obj_car', 120], shed: ['obj_shed', 190], body: ['obj_body', 44], kin: ['obj_kin', 175] };
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath();
    for (const sp of this.spots) {
      const x = sp.x - this.cam;
      if (x < -250 || x > W + 250) continue;
      const im = img(SPR[sp.kind][0]);
      const w = im ? (im.width / im.height) * SPR[sp.kind][1] : 80;
      c.moveTo(x + w * 0.45, GROUND + 3); c.ellipse(x, GROUND + 3, w * 0.45, 7, 0, 0, 7);
    }
    for (const z of this.zs) {
      const x = z.x - this.cam;
      if (x < -200 || x > W + 200) continue;
      const rx = this.zw(z) * (z.def.id === 'drag' ? 0.5 : 0.38) * (z.state === 'dying' ? Math.max(0, 1 - z.dieT * 1.6) : 1);
      if (rx <= 0.5) continue;
      c.moveTo(x + rx, z.y + 1); c.ellipse(x, z.y + 1, rx, rx * 0.22, 0, 0, 7);
    }
    c.moveTo(this.px - this.cam + 26, GROUND + 1); c.ellipse(this.px - this.cam, GROUND + 1, 26, 6, 0, 0, 7);
    if (this.found && this.fx) { const fy = LANES[0], r = 24 * depthScale(fy); c.moveTo(this.fx - this.cam + r, fy + 1); c.ellipse(this.fx - this.cam, fy + 1, r, r * 0.22, 0, 0, 7); }
    c.fill();
    // spots
    for (const sp of this.spots) {
      const x = sp.x - this.cam;
      if (x < -250 || x > W + 250) continue;
      const [id, h] = SPR[sp.kind];
      const cv = bakeSpot(id, h, sp.searched);
      if (cv) c.drawImage(cv, Math.round(x - cv.width / 2), GROUND - h + (sp.kind === 'body' ? 6 : 4));
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
    // actors, y-sorted by feet (id epsilon breaks ties)
    const list: { y: number; f: () => void }[] = [];
    for (const z of this.zs) list.push({ y: z.y + z.id * 1e-4, f: () => this.drawZ(z) });
    list.push({ y: GROUND + 0.5, f: () => this.drawP() });
    if (this.found) list.push({ y: LANES[0] + 0.5, f: () => this.drawFollower() });
    list.sort((a, b) => a.y - b.y);
    for (const l of list) l.f();
    // foreground strip at 1.3x camera speed
    if (fgC) {
      const off = Math.round((this.cam * 1.3) % 2560);
      for (let x = -off; x < W; x += 2560) c.drawImage(fgC, x, H - 38);
    }
    for (const p of this.parts) { c.fillStyle = p.color; c.fillRect(p.x - this.cam, p.y, p.size, p.size); }
    for (const l of this.lobs) {
      const k = l.t / l.dur;
      const x = l.x0 + (l.x1 - l.x0) * k - this.cam;
      const y = l.y0 + (l.y1 - 20 - l.y0) * k - Math.sin(k * Math.PI) * (120 + Math.abs(l.x1 - l.x0) * 0.25);
      c.fillStyle = '#1a1814';
      c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
    }
    const pf = this.prof();
    if (pf && pf.light > 0 && dusk > 0.15) {
      const mz = this.muzzle();
      const a = Math.atan2(this.mouse.y - mz.y, this.mouse.x - mz.x);
      const g = c.createRadialGradient(mz.x, mz.y, 10, mz.x, mz.y, pf.light);
      g.addColorStop(0, `rgba(255,240,200,${0.35 * dusk})`);
      g.addColorStop(1, 'rgba(255,240,200,0)');
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = g;
      c.beginPath(); c.moveTo(mz.x, mz.y); c.arc(mz.x, mz.y, pf.light, a - 0.22, a + 0.22); c.closePath(); c.fill();
      c.restore();
    }
    for (const t of this.tracers) {
      c.strokeStyle = `rgba(255,226,170,${t.life * 12})`;
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(t.x1 - this.cam, t.y1); c.lineTo(t.x2 - this.cam, t.y2); c.stroke();
    }
    for (const gl of this.glows) {
      const k = Math.min(1, gl.life / gl.max * 3) * (0.85 + Math.sin(this.t * 31 + gl.x) * 0.15);
      const r = FLARE_LIGHT.r * (gl.max > 2 ? 1 : 0.4);
      const rg = c.createRadialGradient(gl.x - this.cam, gl.y, 2, gl.x - this.cam, gl.y, r);
      rg.addColorStop(0, `rgba(255,120,60,${0.55 * k})`);
      rg.addColorStop(1, 'rgba(255,90,40,0)');
      c.fillStyle = rg;
      c.fillRect(gl.x - this.cam - r, gl.y - r, r * 2, r * 2);
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
    const h = SH, w = (im.width / im.height) * h;
    const k = depthScale(LANES[0]);
    c.save();
    c.translate(Math.round(this.fx - this.cam), LANES[0]);
    c.scale(this.face * k, k);
    c.drawImage(im, -w / 2, -h, w, h);
    c.restore();
  }

  drawZ(z: EZ) {
    const c = this.c;
    const lane = Math.max(0, Math.min(2, z.lane));
    const bh = Math.round(z.def.height * ZS * depthScale(LANES[lane]));
    const bk = bakeZ(z.sprite, bh, lane, z.variant, z.state === 'kin');
    if (!bk) return;
    const h = this.zh(z), k = h / bk.h;
    const w = (bk.cv.width - bk.pad * 2) * k;
    const x = Math.round(z.x - this.cam);
    if (x < -200 || x > W + 200) return;
    c.save();
    let rot = 0, dy = 0;
    if (z.state === 'walk') { rot = Math.sin(z.phase * 3.2) * 0.04; dy = -Math.abs(Math.sin(z.phase * 3.2)) * 2.5 * z.sc; }
    if (z.state === 'sleep' || z.state === 'kin') rot = 0.06 + Math.sin(z.phase * 0.7) * 0.01;
    if (z.state === 'grab') rot = -0.1 + Math.sin(z.phase * 7) * 0.06;
    if (z.state === 'dying') { const t = Math.min(1, z.dieT / 0.45); rot = t * 1.2; dy = t * h * 0.15; c.globalAlpha = 1 - Math.max(0, z.dieT - 0.4) * 5; }
    c.translate(x, z.y + dy);
    c.scale(-z.dir, 1); // sprites face left by default
    c.rotate(rot);
    if (z.headless) { c.beginPath(); c.rect(-w / 2 - 10, -h + h * z.def.head * 0.95, w + 20, h); c.clip(); }
    c.drawImage(bk.cv, -w / 2 - bk.pad * k, -h - bk.pad * k, bk.cv.width * k, bk.cv.height * k);
    if (z.flash > 0) { const f = flashImg(z.sprite); if (f) { c.globalAlpha = 0.6; c.drawImage(f, -w / 2, -h, w, h); } }
    if (z.burn && z.burn > 0) { const f = shadeImg(z.sprite, '#ff7a2a'); if (f) { c.globalAlpha = 0.25 + Math.sin(this.t * 24 + z.id) * 0.1; c.drawImage(f, -w / 2, -h, w, h); } }
    c.restore();
    if (z.state === 'sleep') {
      c.font = '11px "Special Elite", monospace';
      c.fillStyle = 'rgba(200,190,170,0.6)';
      c.textAlign = 'center';
      c.fillText('standing still', x, z.y - h - 8);
      c.textAlign = 'left';
    }
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
      const p = this.prof()!;
      const left = roundsInStores(p, G.stores);
      c.textAlign = 'right';
      c.font = '20px "Special Elite", monospace';
      c.fillStyle = this.mag ? '#efe2c2' : '#c04030';
      c.fillText(`${this.mag} / ${Number.isFinite(left) ? left : '∞'}`, W - 20, H - 20);
      c.font = '12px "Special Elite", monospace';
      c.fillStyle = '#a89c84';
      const multi = ammoTypesFor(this.w.def).length > 1;
      c.fillText(this.reload > 0 ? 'reloading…' : `${def.name} · ${ammoLabel(p.ammoRes).toLowerCase()}${multi ? ' [T]' : ''}`, W - 20, H - 46);
    }
    c.textAlign = 'center';
    this.msgs.forEach((m, i) => {
      c.font = '16px "Special Elite", monospace';
      c.fillStyle = `rgba(232,220,192,${Math.min(1, m.life)})`;
      c.fillText(m.text, W / 2, 80 + i * 24);
    });
    // crosshair
    if (this.w) {
      const p = this.prof()!;
      const mz = this.muzzle();
      const dist = Math.hypot(this.mouse.x - mz.x, this.mouse.y - mz.y);
      const r = Math.max(5, Math.tan((p.pellets > 1 ? p.spread : p.spread * (1.75 - aimFactor(this.s))) + this.bloom) * dist);
      c.strokeStyle = 'rgba(235,225,200,0.85)';
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(this.mouse.x, this.mouse.y, r, 0, 7); c.stroke();
    }
    c.textAlign = 'left';
  }
}
