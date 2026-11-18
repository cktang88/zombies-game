import type { Survivor, Res, WeaponItem } from '../types';
import { keyOf, normKey, keyCap, keyLabel } from '../ui/keys';
import { openPause } from '../ui/pause';
import { G, R, log, add, newWeapon, findDoc, uid } from '../state';
import { ZOMBIES, type ZombieDef } from '../data/zombies';
import { WEAPONS, fireProfile, ammoTypesFor, ammoLabel, AMMO_TYPES, armorDamage, roundsInStores, shotSound, BURN, FLARE_LIGHT, MODS, wearMods, blastDamage, MELEE, meleeProfile, FISTS, BLEED_TIME, type FireProfile, type MeleeProfile } from '../data/weapons';
import { SITES, RES_LABEL, RES_ICON, type Site } from '../data/world';
import { Ticker, caps, hintRow, keycap, capOf, dot, panel, worldLabel, keySheet, keyHintsOn, FONT, type Hint } from './hud';
import { img, flashImg, shadeImg } from '../assets';
import { depthScale, canvas, bakeSprite, bakeLayer, bakeGround, fgStrip, type Look, type Baked } from './render';
import { sfx, wind, gunSoundFor, type Surface } from '../audio';
import { reduceGore, shakeScale, autoReload, hitMarkers, screenFx, fxQuality } from '../ui/settings';
import { flashKind, gunFeel, voiceOf, panOf, isSuppressed, type FlashKind } from './gunfx';
import { Vfx } from './vfx'; // gunfire & effects (docs/research/10-vfx.md)
import { RunActors } from './actors'; // rigged bodies (src/anim)
import { react, slideStep, classicPose, IMPACT, type Reaction, type HitIn } from './impact'; // hit reactions, as at night
import type { Zombie } from './battle';

/** What underfoot sounds like at each site (footsteps). */
const SURFACE: Record<string, Surface> = {
  route9: 'asphalt', diner: 'asphalt', rexall: 'asphalt', millyard: 'gravel', legion: 'asphalt', boathouse: 'wood', deercamp: 'leaves',
  hardware: 'gravel', firehouse: 'asphalt', manor: 'grass', school: 'asphalt', gunshop: 'asphalt', courthouse: 'asphalt', corliss: 'mud',
};
import { aimFactor, first, displayName, wound, pain, killSurvivor, tale, addThought, skillOf, makeSurvivor, byId, canWork, changeOpinion } from '../sim/survivors';

// A daylight scavenging run you play yourself: walk right through the street,
// search doorways, and get back to the left edge before dark.
// Push-your-luck (docs/research/06 #3): a 12-slot pack, three depth zones that pay
// more and hold more of them, noise heat that sends stragglers between you and home,
// a pickup you can hotwire deep in, and drop/leave items. Companion runs (#8): one
// survivor can come along, shoot, carry, be downed, and drag the leader home.
const W = 1280, H = 720;
const PACK_CAP = 12, DUFFEL = 4, MATE_CAP = 6;
const ZONE_LOOT = [1, 1.5, 2.2];
const ZONE_DENS = [1, 1.6, 2.4];
const ZONE_NAMES = ['the near houses', 'past the rail crossing', 'beyond the four-way stop'];
const RUN_YIELD = 0.22; // per-search loot scale: clearing the whole street ≈ 2–2.4× a scavenging job (before the pack cap)
// how many of a resource fit in one pack slot (bulky things take more room)
const STACK: Partial<Record<Res, number>> = {
  food: 6, wood: 4, scrap: 8, parts: 4, meds: 3, fuel: 3, cloth: 6, liquor: 2, molotov: 2,
  light: 20, light_hp: 20, r22: 50, shell: 8, shell_slug: 8, shell_flech: 8, shell_fire: 8, rifle: 12, rifle_sp: 12, rifle_ap: 12,
  r556: 30, ball: 15, bolt: 12, bolt_fire: 8, flare: 4, rocket: 1, g40: 3, g40_buck: 3, pipebomb: 2,
};
type PackItem = { kind: 'res'; res: Res; n: number } | { kind: 'gun'; def: string; cond: number } | { kind: 'mod'; def: string; cond: number } | { kind: 'melee'; def: string; cond: number };
const itemSlots = (it: PackItem) => (it.kind === 'gun' ? 3 : it.kind === 'melee' ? 2 : it.kind === 'mod' ? 1 : Math.ceil(it.n / (STACK[it.res] ?? 5)));
const itemLabel = (it: PackItem) => (it.kind === 'gun' ? WEAPONS[it.def].name.toLowerCase() : it.kind === 'melee' ? MELEE[it.def].name.toLowerCase() : it.kind === 'mod' ? MODS[it.def].name.toLowerCase() : `${it.n} ${RES_LABEL[it.res].toLowerCase()}`);
const GROUND = 664;
const DECAL_TOP = 560, DECAL_H = 200; // the run's decal band (world y)
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

/** The lane looks as the light goes (stepped, so the graded atlases bake a handful of times, not
 * every frame): darker, greyer and toward the dusk fog, to match the props' and backdrop's dusk copies. */
const duskLooks = new Map<number, Look[]>();
function looksAt(dusk: number): Look[] {
  const q = Math.round(Math.max(0, Math.min(1, dusk)) * 6);
  if (!q) return LANE_LOOK;
  let ls = duskLooks.get(q);
  if (!ls) {
    const d = q / 6, r3 = (v: number) => Math.round(v * 1000) / 1000;
    ls = LANE_LOOK.map((l) => ({ ...l, b: r3(l.b * (1 - 0.42 * d)), s: r3(l.s * (1 - 0.4 * d)), fog: r3(l.fog + 0.22 * d) }));
    duskLooks.set(q, ls);
  }
  return ls;
}

// Scale (docs/gfx-audit.md round 3): a survivor (SH = 158 px) is 1.75 m, so 90 px/m on the walking
// lane. Street props stand at the kerb, just behind the far lane, so everyone walks in front of them
// and they take that depth's perspective scale. Heights are the whole sprite's, in metres
// (a car's roof is ~80% of its sprite, which has the open tailgate above it).
const PX_M = SH / 1.75;
const KERB = LANES[0] - 12;
const KERB_K = depthScale(KERB);
const PROP_M: Record<string, number> = {
  obj_door: 2.55, obj_car: 1.8, obj_shed: 2.6, obj_kin: 1.35, obj_cache: 1.85, obj_truck: 1.95,
  obj_sign_rail: 4.0, obj_sign_stop: 2.85, obj_body: 0.62, obj_duffel: 0.36,
};
/** Spots lie in the road (the bodies, a dropped pack) or stand at the kerb (everything else). */
const inRoad = (kind: string) => kind === 'body' || kind === 'drop';
const propH = (id: string, road: boolean) => Math.round(PROP_M[id] * PX_M * (road ? 1 : KERB_K));
/** each spot's footprint along the street, px (sprite aspect × its height; placement spacing) */
const SPOT_W: Record<string, number> = { door: 175, car: 410, shed: 220, body: 175, kin: 110, cache: 120, truck: 390, drop: 60 };

// Baked zombie: outline stamps + lane grade + fog + variant tint, at the lane's display size.
function bakeZ(sprite: string, h: number, lane: number, variant: number, kin: boolean, looks: Look[] = LANE_LOOK): Baked | null {
  return bakeSprite(sprite, h, looks[lane], variant, kin ? { b: 0.8, s: 0.4 } : {});
}

// Searched spots: a baked darker copy drawn opaque (no translucent box, no per-frame filter).
const spotCache = new Map<string, HTMLCanvasElement>();
// dusk: the props fall with the backdrop (a cool, dim copy crossfaded in), so they don't stay lit
const SPOT_LOOK = ['', 'brightness(0.5) saturate(0.6)', 'brightness(0.5) saturate(0.5) sepia(0.15) hue-rotate(180deg) saturate(0.6)', 'brightness(0.3) saturate(0.4)'];
function bakeSpot(id: string, h: number, dark: boolean | number): HTMLCanvasElement | null {
  const mode = typeof dark === 'number' ? dark : dark ? 1 : 0;
  const key = `${id}|${h}|${mode}`;
  const hit = spotCache.get(key);
  if (hit) return hit;
  const im = img(id);
  if (!im) return null;
  const w = (im.width / im.height) * h;
  const [cv, x] = canvas(w, h);
  if (mode) x.filter = SPOT_LOOK[mode];
  x.drawImage(im, 0, 0, cv.width, cv.height);
  spotCache.set(key, cv);
  return cv;
}
/** A prop at (x, y top-left by its centre x), day copy with the dusk copy over it. */
function drawSpot(c: CanvasRenderingContext2D, id: string, h: number, searched: boolean, dusk: number, x: number, y: number, flip = false): HTMLCanvasElement | null {
  const cv = bakeSpot(id, h, searched);
  if (!cv) return null;
  const X = Math.round(x - cv.width / 2);
  if (flip) { c.save(); c.translate(Math.round(x) * 2, 0); c.scale(-1, 1); }
  c.drawImage(cv, X, y);
  const a = Math.min(1, dusk) * 0.85;
  if (a > 0.02) { const dv = bakeSpot(id, h, searched ? 3 : 2); if (dv) { c.globalAlpha = a; c.drawImage(dv, X, y); c.globalAlpha = 1; } }
  if (flip) c.restore();
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
  phase: number; flash: number; dieT: number; grabT: number; dir: number; headless?: boolean; lungeT: number; burn?: number; grabWho?: 'p' | 'm'; stun?: number; bleed?: number; bleedDps?: number; wake?: number;
  /** hit reactions (night/impact.ts): knocked down, the eased slide, the last reaction; hitT/hitZone: the last non-lethal hit (a flinch on the rig) */
  down?: number; slide?: number; react?: Reaction; hitT?: number; hitZone?: HitIn['zone'];
  id: number; lane: number; sc: number; variant: number;
}
interface Spot { x: number; searched: boolean; kind: 'door' | 'car' | 'shed' | 'body' | 'kin' | 'cache' | 'truck' | 'drop'; label: string; loot: number; survivor?: boolean; zone: number; items?: PackItem[] }
interface P { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; g: number; kind?: 'shell' | 'dust' | 'puff'; w?: number; h?: number; rot?: number; bounces?: number; max?: number }

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
  dayMax = 150;
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
  /** one line of news at a time (night/hud.ts) */
  msgs = new Ticker();
  found?: Survivor;
  ended = false;
  raf = 0;
  last = 0;
  shoveCd = 0;
  noise = 0;
  heat = 0; // persistent noise: stragglers come up behind you
  strayT = 20;
  pack: PackItem[] = [];
  sel = 0;
  zoneB: [number, number] = [0, 0];
  // companion
  mate: Survivor | null = null;
  mateW: WeaponItem | null = null;
  mateX = 0;
  mateMag = 0;
  mateCd = 0;
  mateReload = 0;
  mateDown = 0; // >0: downed, bleeding-out seconds left
  reviveT = 0;
  rescued = false;
  // leader downed
  downed = 0; // >0: seconds before the mate must reach the leader
  dragging = false;
  shooter: 'p' | 'm' | 'k' = 'p'; // who gets the kill: leader's gun, companion, leader's melee
  // melee: [V] or right-click; chainsaw runs while held
  kn: WeaponItem | null = null;
  stamina = 100;
  swingT = 0;
  swingCd = 0;
  swingTired = false;
  slashT = 0;
  rdown = false;
  onEnd: (r: ExpeditionResult) => void;
  kh: (e: KeyboardEvent) => void;
  ku: (e: KeyboardEvent) => void;
  canvas: HTMLCanvasElement;
  // ---- feel (night/gunfx.ts) and sound ----
  flash = 0;
  flashK: FlashKind = 'long';
  flashAng = 0;
  flashSize = 1;
  recoil = 0;
  kick = 6;
  hitstop = 0;
  hitMark: { t: number; kill: boolean; head: boolean } | null = null;
  ammoPunch = 0;
  reloadSfx?: { cancel(): void };
  stepT = 0;
  mateStepT = 0;
  idleT = 3;
  rummageT = 0;
  surface: Surface = 'asphalt';
  decals: { x: number; y: number; w: number; h: number; rot: number; color: string }[] = [];
  /** this frame's search prompt (drawn over the actors) */
  prompt: { hints: Hint[]; x: number; y: number } | null = null;
  actors = new RunActors(); // rigged bodies: night/actors.ts

  /** the road's own decal layer, in world space (brass, blood, chips stay where they land); the
   *  band y DECAL_TOP..DECAL_TOP+DECAL_H across the whole run */
  decalCv = (() => { const cv = document.createElement('canvas'); cv.width = 6400; cv.height = DECAL_H; const g = cv.getContext('2d')!; g.translate(0, -DECAL_TOP); return cv; })();
  vfx = new Vfx({ ground: this.decalCv.getContext('2d'), light: () => {}, gore: reduceGore, flashes: screenFx }, fxQuality());
  constructor(canvas: HTMLCanvasElement, s: Survivor, siteId: string, onEnd: (r: ExpeditionResult) => void) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d')!;
    this.s = s;
    this.w = G.weapons.find((x) => x.uid === s.weapon) ?? null;
    this.site = SITES.find((x) => x.id === siteId)!;
    this.onEnd = onEnd;
    this.len = 3600 + Math.round(this.site.risk * 2400);
    this.daylight = typeof G.flags.runDaylight === 'number' ? Math.max(30, G.flags.runDaylight as number) : 150;
    this.dayMax = this.daylight;
    // a companion chosen on the day screen (G.flags.runMate = survivor id)
    const mate = typeof G.flags.runMate === 'string' ? byId(G.flags.runMate as string) : undefined;
    delete G.flags.runMate;
    if (mate && mate !== s && !mate.dead && canWork(mate)) {
      this.mate = mate;
      mate.job = 'rest';
      this.mateW = G.weapons.find((x) => x.uid === mate.weapon) ?? null;
      this.mateMag = this.mateW ? fireProfile(this.mateW).mag : 0;
      this.mateX = this.px - 60;
    }
    this.kn = G.melee?.find((x) => x.uid === s.melee) ?? null;
    this.mag = this.w ? this.prof()!.mag : 0;
    this.magRes = this.w ? this.prof()!.ammoRes : null;
    this.surface = SURFACE[this.site.id] ?? 'asphalt';
    if (G.weather === 'snow') this.surface = this.surface === 'wood' ? 'wood' : 'gravel';
    this.build();
    this.kh = (e) => this.key(e, true);
    this.ku = (e) => this.key(e, false);
    this.bind();
    (globalThis as unknown as { __EX: Expedition }).__EX = this; // debug handle (tests)
    wind(true);
    this.say(`${this.site.name}. ${this.site.desc}`, 6);
    // the opening keys in one short line; the rest on the [F1] sheet (17c: the full list ran over the status panel)
    this.say(`[${keyLabel(keyOf('run.left'))}/${keyLabel(keyOf('run.right'))}] walk · ${keyCap('run.search')} search · hold [F1] for keys · home is the left edge.`, 6);
    if (this.mate) this.say(`${first(this.mate)} comes along. ${first(this.mate)} carries ${MATE_CAP} more and watches your back.`, 6);
  }

  build() {
    const stockKey = `stock_${this.site.id}`;
    const stock = (G.flags[stockKey] as number) ?? this.site.stock;
    const fullness = Math.max(0.2, stock / this.site.stock);
    const kinds: Spot['kind'][] = ['door', 'door', 'car', 'shed', 'body'];
    const labels: Record<Spot['kind'], string[]> = {
      // what the sprites show: a house door, a station wagon with its tailgate up, a plank shed
      door: ['a kitchen door', 'a mudroom', 'a back porch', 'a front door', 'a side door'],
      car: ['a station wagon', 'an open tailgate', 'a wagon\'s back seat'],
      shed: ['a tool shed', 'an ice-fishing shanty', 'a garden shed'],
      body: ['a body in a hunting jacket', 'a body in scrubs', 'a body by the mailbox'],
      kin: ['a kitchen window'],
      cache: ['a locked cabinet'], truck: ['a pickup'], drop: ['what you left'],
    };
    this.zoneB = [Math.round(this.len * 0.38), Math.round(this.len * 0.7)];
    // props at true scale are wide (a wagon is ~400 px): keep a gap between neighbours
    const gap = (a: Spot['kind'], b: Spot['kind']) => (SPOT_W[a] + SPOT_W[b]) / 2 + 30;
    for (let x = 520; x < this.len - 200; x += R.range(300, 520)) {
      if (Math.abs(x - this.zoneB[0]) < 210 || Math.abs(x - this.zoneB[1]) < 210 || Math.abs(x - (this.zoneB[1] + 250)) < 140) continue;
      const kind: Spot['kind'] = R.chance(G.day > 3 ? 0.12 : 0) ? 'kin' : R.pick(kinds);
      const prev = this.spots[this.spots.length - 1];
      if (prev) x = Math.max(x, prev.x + gap(prev.kind, kind));
      if (x >= this.len - 200 || Math.abs(x - this.zoneB[0]) < 140 || Math.abs(x - this.zoneB[1]) < 140) continue;
      this.spots.push({ x, searched: false, kind, label: R.pick(labels[kind]), loot: fullness * R.range(0.5, 1.3), zone: this.zoneOf(x) });
    }
    // zone 3 always has a cache (slow, loud), and a pickup you can hotwire out of here
    const cx = Math.round(R.range(this.zoneB[1] + 540, Math.max(this.zoneB[1] + 560, this.len - 260)));
    // the cache and the pickup stand on their own: no shed or car in front of them
    this.spots = this.spots.filter((sp) => Math.abs(sp.x - cx) > gap(sp.kind, 'cache') && Math.abs(sp.x - (this.zoneB[1] + 250)) > gap(sp.kind, 'truck'));
    this.spots.push({ x: cx, searched: false, kind: 'cache', label: R.pick(['a locked gun cabinet', 'a pharmacy cage', 'a deer-camp footlocker']), loot: fullness, zone: 2 });
    // clear of the stop sign at the boundary (the pickup is ~4.8 m long at true scale)
    this.spots.push({ x: this.zoneB[1] + 250, searched: false, kind: 'truck', label: 'a pickup with keys gone', loot: 0, zone: 2 });
    this.spots.sort((a, b) => a.x - b.x);
    const doors = this.spots.filter((s) => s.kind === 'door');
    if (doors.length && R.chance(this.site.survivorChance * 1.6)) R.pick(doors).survivor = true;
    const n = Math.round((6 + this.site.risk * 22 + G.day * 0.5) * 1.15);
    for (let i = 0; i < n; i++) {
      const pool = Object.values(ZOMBIES).filter((z) => z.minDay <= G.day && z.id !== 'ferryman' && z.id !== 'crier');
      const def = R.weighted(pool, (z) => (z.id === 'sleeper' ? 6 : z.id === 'drag' ? 1.5 : z.id === 'deer' ? 1.2 : 0.6))!;
      // denser the deeper you go
      const zw = ZONE_DENS.map((d, i) => d * ((i === 0 ? this.zoneB[0] - 700 : i === 1 ? this.zoneB[1] - this.zoneB[0] : this.len - 60 - this.zoneB[1])));
      const zi = R.weighted([0, 1, 2], (i) => Math.max(0, zw[i]))!;
      const lo = [700, this.zoneB[0], this.zoneB[1]][zi], hi = [this.zoneB[0], this.zoneB[1], this.len - 60][zi];
      this.zs.push(this.mk(def, R.range(lo, hi), R.chance(0.7) ? 'sleep' : 'walk'));
    }
  }

  zid = 0;
  zoneOf(x: number) { return x < this.zoneB[0] ? 0 : x < this.zoneB[1] ? 1 : 2; }
  cap() { return PACK_CAP + (G.flags.duffel ? DUFFEL : 0) + (this.mate ? MATE_CAP : 0); }
  slots() { return this.pack.reduce((a, it) => a + itemSlots(it), 0); }
  toPack(it: PackItem) {
    if (it.kind === 'res') {
      const ex = this.pack.find((p) => p.kind === 'res' && p.res === it.res) as { n: number } | undefined;
      if (ex) { ex.n += it.n; return; }
    }
    this.pack.push(it);
  }
  dropSelected() {
    if (!this.pack.length || this.downed) return;
    this.sel = Math.min(this.sel, this.pack.length - 1);
    const it = this.pack.splice(this.sel, 1)[0];
    const near = this.spots.find((s) => s.kind === 'drop' && Math.abs(s.x - this.px) < 50);
    if (near) near.items!.push(it);
    else this.spots.push({ x: this.px, searched: false, kind: 'drop', label: 'what you left', loot: 0, zone: this.zoneOf(this.px), items: [it] });
    this.say(`Left ${itemLabel(it)} on the road.`, 2);
    sfx.thud();
  }
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
    c.onmousedown = (e) => { pos(e); if (e.button === 0) { this.mouse.down = true; this.fire(true); } if (e.button === 2) { this.rdown = true; this.swing(); } };
    c.onmouseup = (e) => { if (e.button === 2) this.rdown = false; else this.mouse.down = false; };
    c.oncontextmenu = (e) => e.preventDefault();
    window.addEventListener('keydown', this.kh);
    window.addEventListener('keyup', this.ku);
  }

  key(e: KeyboardEvent, down: boolean) {
    const k = normKey(e);
    if (this.paused) return; // the pause menu has the keyboard
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (k === 'F1' || k === '?') { e.preventDefault(); this.keySheetHeld = down; return; }
    if (!down) return;
    if (k === 'Escape' || k === keyOf('run.pause')) { e.preventDefault(); this.pause(); return; }
    if (k === keyOf('run.reload')) this.startReload();
    if (k === keyOf('run.ammo')) this.cycleAmmo();
    if (k === keyOf('run.pack')) { this.sel = this.pack.length ? (this.sel + 1) % this.pack.length : 0; e.preventDefault(); }
    if (k === keyOf('run.drop')) this.dropSelected();
    if (k === keyOf('run.swing')) this.swing();
    if (k === keyOf('run.shove')) { this.shove(); e.preventDefault(); }
  }
  keySheetHeld = false;
  /** The full key sheet ([F1] held), grouped like the night's. */
  keyGroups(): { title: string; rows: Hint[] }[] {
    return [
      { title: 'move', rows: [{ key: `${keyLabel(keyOf('run.left'))}/${keyLabel(keyOf('run.right'))}`, label: 'walk (left: home)' }, { key: 'run.search', label: 'search / revive' }, { key: 'run.pause', label: 'pause' }, { key: 'F1', label: 'this sheet' }] },
      { title: 'fight', rows: [{ key: 'LMB', label: 'fire' }, { key: 'run.reload', label: 'reload' }, { key: 'run.ammo', label: 'ammo' }, { key: 'run.swing', label: `${this.kn ? MELEE[this.kn.def].name.toLowerCase() : 'fists'} (RMB)` }, { key: 'run.shove', label: 'shove' }] },
      { title: 'the pack', rows: [{ key: 'run.pack', label: 'next item' }, { key: 'run.drop', label: 'drop it' }] },
    ];
  }
  /** Held: an action's key, or (for walking) the arrow keys too. */
  held(id: string) { return this.keys.has(keyOf(id)) || (id === 'run.left' && this.keys.has('ArrowLeft')) || (id === 'run.right' && this.keys.has('ArrowRight')); }
  paused = false;
  pause() {
    if (this.paused || this.ended) return;
    this.paused = true;
    this.keys.clear();
    this.mouse.down = false;
    this.rdown = false;
    openPause(this.canvas.parentElement ?? document.body, { where: 'run', resume: () => { this.paused = false; this.last = performance.now(); }, quit: () => { this.ended = true; this.destroy(); } });
  }

  say(text: string, life = 4) {
    this.msgs.push(text, life);
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.flash = Math.max(0, this.flash - dt);
      this.recoil = Math.max(0, this.recoil - dt * 8);
      this.ammoPunch = Math.max(0, this.ammoPunch - dt * 6);
      if (!screenFx()) this.hitstop = 0; // Settings: no hitstop
      if (this.paused) { /* frozen under the pause menu */ }
      else if (this.hitstop > 0) this.hitstop -= dt;
      else this.update(dt);
      if (!this.paused && this.hitMark) { this.hitMark.t -= dt; if (this.hitMark.t <= 0) this.hitMark = null; }
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
    this.reloadSfx?.cancel();
    wind(false);
  }

  // ---------- update ----------
  update(dt: number) {
    if (this.ended) return;
    this.t += dt;
    this.vfx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.cd -= dt;
    this.shoveCd -= dt;
    const legHurt = this.s.wounds.filter((w) => w.part === 'lleg' || w.part === 'rleg').reduce((a, w) => a + w.severity, 0) + (this.s.scars.some((x) => x.label.includes('leg')) ? 0.6 : 0);
    const over = Math.max(0, this.slots() - this.cap());
    const speed = 150 * Math.max(0.35, 1 - legHurt * 0.5) * Math.max(0.45, 1 - over * 0.07);
    const grabbed = this.zs.some((z) => z.state === 'grab' && z.grabWho !== 'm');
    if (this.downed > 0 || this.dragging) this.updDowned(dt);
    else if (!grabbed && !this.searching) {
      const x0 = this.px;
      if (this.held('run.left')) { this.px -= speed * dt; this.face = -1; }
      if (this.held('run.right')) { this.px += speed * dt; this.face = 1; }
      // footfalls: one per ~62 px of road (≈ 0.42 s at a walk; slower when hurt or overloaded)
      this.stepT += Math.abs(this.px - x0);
      if (this.stepT > 62) { this.stepT = 0; sfx.footstep(this.surface, { volume: over > 0 ? 0.85 : 0.7, pan: panOf(this.px - this.cam) * 0.4 }); }
    }
    if (this.mouse.x + this.cam < this.px) this.face = -1; else this.face = 1;
    this.px = Math.max(20, Math.min(this.len - 40, this.px));
    this.cam += (this.px - W * 0.35 - this.cam) * Math.min(1, dt * 5);
    this.cam = Math.max(0, Math.min(this.len - W, this.cam));
    // revive a downed companion: hold [E] beside them
    const mateNear = this.mate && this.mateDown > 0 && Math.abs(this.mateX - this.px) < 70;
    if (mateNear && this.held('run.search') && !this.downed) {
      this.reviveT += dt;
      if (this.reviveT >= 2.5) this.reviveMate();
    } else this.reviveT = 0;
    // search
    const near = mateNear ? undefined : this.spots.find((s) => !s.searched && Math.abs(s.x - this.px) < 60);
    if (this.held('run.search') && near && !this.searching && !this.downed) {
      if (near.kind === 'truck' && (G.stores.fuel < 2 || G.stores.parts < 1)) this.say('It would take 2 fuel and a part to start it. The house does not have them.', 2.5);
      else {
        this.searching = near; this.searchT = 0; this.rummageT = 0.7;
        sfx.search(near.kind === 'door' || near.kind === 'shed' || near.kind === 'cache' ? 'door' : near.kind === 'car' || near.kind === 'truck' ? 'creak' : 'rummage', { pan: panOf(near.x - this.cam) * 0.5 });
      }
    }
    if (this.searching) {
      if (!this.held('run.search') || Math.abs(this.searching.x - this.px) > 70 || grabbed || this.downed) this.searching = null;
      else {
        const helper = this.mate && !this.mateDown && Math.abs(this.mateX - this.searching.x) < 140 ? skillOf(this.mate, 'scavenging') * 0.05 : 0;
        const pry = ['door', 'car', 'shed', 'cache'].includes(this.searching.kind) ? this.mprof().pry : 1;
        this.searchT += dt * (0.7 + skillOf(this.s, 'scavenging') * 0.06 + helper) * pry;
        this.rummageT -= dt;
        if (this.rummageT <= 0 && this.searching.kind !== 'truck' && this.searching.kind !== 'drop') {
          this.rummageT = R.range(0.8, 1.3);
          sfx.search(R.chance(0.3) ? 'drawer' : 'rummage', { pan: panOf(this.searching.x - this.cam) * 0.5, volume: 0.8 });
        }
        if (this.searchT >= this.searchTime(this.searching)) this.finishSearch(this.searching);
      }
    }
    // noise heat: persists, and brings stragglers up the road behind you
    this.heat = Math.max(0, this.heat - dt * 0.015);
    if (this.heat >= 2 && this.px > 600) {
      this.strayT -= dt * (this.heat / 2);
      if (this.strayT <= 0) {
        this.strayT = 20;
        const x = Math.max(60, this.px - R.range(450, 750));
        this.zs.push(this.mk(R.chance(0.7) ? ZOMBIES.sleeper : ZOMBIES.deer, x, 'walk'));
        this.say('Something is coming up the road behind you.', 2.5);
      }
    }
    if (this.mate) this.updMate(dt);
    // reload / fire
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.doReload();
    }
    // melee timing and stamina
    this.slashT = Math.max(0, this.slashT - dt);
    this.swingCd -= dt;
    if (this.swingT > 0) { this.swingT -= dt; if (this.swingT <= 0) this.resolveSwing(); }
    else if (this.swingCd <= 0) this.stamina = Math.min(100, this.stamina + 18 * dt * Math.max(0.5, 1 - pain(this.s) * 0.3));
    if (this.kn && MELEE[this.kn.def].fuel && (this.held('run.swing') || this.rdown)) this.swing();
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.shootRound();
    }
    if (this.mouse.down && this.w && this.prof()!.auto && !this.downed) this.fire(false);
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
    // a groan now and then from something close (sleepers breathe; the awake ones moan)
    this.idleT -= dt;
    if (this.idleT <= 0) {
      const near = this.zs.filter((z) => z.state !== 'dying' && Math.abs(z.x - this.px) < 900);
      this.idleT = (near.length ? Math.max(1.2, 5 / Math.sqrt(near.length)) : 3) * R.range(0.7, 1.4);
      const z = near.length ? R.pick(near) : null;
      const v = z ? voiceOf(z.def.id) : null;
      if (z && v) sfx.zombieVoice(v, 'idle', { pan: panOf(z.x - this.cam), far: Math.abs(z.x - this.px) > 500, volume: z.state === 'sleep' || z.state === 'kin' ? 0.35 : 0.65 });
    }
    // zombies
    for (const z of this.zs) this.updZ(z, dt);
    this.zs = this.zs.filter((z) => !(z.state === 'dying' && z.dieT > 0.6));
    this.animate(dt);
    // noise wakes sleepers
    if (this.noise > 0) {
      for (const z of this.zs) if (z.state === 'sleep' && Math.abs(z.x - this.px) < this.noise * 260) z.state = 'walk';
      this.heat = Math.min(6, this.heat + this.noise * dt * 0.05);
      this.noise = Math.max(0, this.noise - dt * 3);
    }
    for (const p of this.parts) {
      p.life -= dt;
      if (p.kind === 'dust' || p.kind === 'puff') { p.vy += 40 * dt; p.vx *= 0.9; }
      else p.vy += 900 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'shell') {
        p.rot = (p.rot ?? 0) + p.vx * dt * 0.25;
        if (p.y >= p.g && p.vy > 0) {
          p.y = p.g;
          if ((p.bounces ?? 0) > 0) { p.bounces = (p.bounces ?? 0) - 1; p.vy *= -0.35; p.vx *= 0.55; }
          else { p.life = 0; this.decals.push({ x: p.x, y: p.y, w: p.w ?? 3, h: p.h ?? 1.5, rot: Math.round((p.rot ?? 0) / 0.5) * 0.15, color: p.color }); if (this.decals.length > 120) this.decals.shift(); }
        }
      } else if (p.y > p.g) p.life = 0;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.msgs.tick(dt);
    if (this.px <= 22 && this.t > 2 && !this.downed && (this.dragging || this.held('run.left'))) this.finish(false);
  }

  /** A non-lethal hit lands: flinch, stagger, stumble or knockdown by impulse against the body's
   *  mass (night/impact.ts, the same table as the wall). dir +1 = shoved toward +x. */
  impact(z: EZ, h: Omit<HitIn, 'dir'>, dir: number) {
    if (z.hp <= 0 || z.state === 'dying') return;
    z.hitT = this.t; z.hitZone = h.zone;
    z.stun ??= 0;
    if (z.state === 'sleep' || z.state === 'kin') return;
    const zz = z as unknown as Zombie;
    // react() reads the night's states: a grabbing body counts as one at the wall
    const st = z.state;
    if (st === 'grab') (zz as { state: string }).state = 'wall';
    const rx = react(zz, { ...h, dir }, this.t, () => R.next());
    if ((zz as { state: string }).state === 'wall') (zz as { state: string }).state = st === 'grab' && !(rx && rx.tier !== 'flinch') ? 'grab' : 'walk';
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
    if (z.bleed && z.bleed > 0) {
      z.bleed -= dt;
      z.hp -= (z.bleedDps ?? 0) * dt;
      if (R.chance(dt * 8)) this.parts.push({ x: z.x + R.range(-8, 8), y: z.y - this.zh(z) * R.range(0.3, 0.7), vx: R.range(-30, 30), vy: R.range(-40, 20), life: 1, color: '#4a0d0b', size: 2.5, g: z.y });
      if (z.hp <= 0) { this.shooter = 'k'; this.kill(z); this.shooter = 'p'; return; }
    }
    z.phase += dt;
    if (z.state === 'kin') return;
    // hit reactions: the knockback slide eases out; knocked flat, it lies there until it gets up
    slideStep(z as unknown as Zombie, dt, this.len + 400);
    if (z.down && z.down > 0) { z.down -= dt; if (z.state === 'grab') z.state = 'walk'; return; }
    if (z.stun && z.stun > 0) { z.stun -= dt; if (z.state === 'grab') z.state = 'walk'; return; }
    // go for whoever is nearer: the leader or the companion
    const mateUp = this.mate && this.mateX;
    const who: 'p' | 'm' = z.state === 'grab' ? z.grabWho ?? 'p' : mateUp && Math.abs(this.mateX - z.x) < Math.abs(this.px - z.x) ? 'm' : 'p';
    const tx = who === 'm' ? this.mateX : this.px;
    const d = tx - z.x;
    if (z.state === 'sleep') {
      // close by, a Sleeper stirs after a moment: long enough to put a blade in it first
      if (Math.abs(d) < 110) z.wake = (z.wake ?? 0) + dt; else z.wake = 0;
      if ((z.wake ?? 0) > 1.1 || Math.abs(d) < 26 || (this.daylight < 0 && R.chance(dt * 0.3))) { z.state = 'walk'; const v = voiceOf(z.def.id); if (v && R.chance(0.6)) sfx.zombieVoice(v, 'alert', { pan: panOf(z.x - this.cam) }); }
      return;
    }
    if (z.state === 'walk') {
      z.dir = Math.sign(d);
      let sp = z.def.speed * 0.9;
      if (z.def.lunge) { z.lungeT -= dt; if (z.lungeT < 0) { sp *= 0.15; if (z.lungeT < -0.8) z.lungeT = R.range(1.2, 2.6); } }
      z.x += z.dir * sp * dt;
      if (Math.abs(d) < 34) { z.state = 'grab'; z.grabWho = who; z.grabT = 0.8; this.say(who === 'm' ? `${first(this.mate!)} is grabbed!` : 'Grabbed!', 1.5); const v = voiceOf(z.def.id); if (v) sfx.zombieVoice(v, 'attack', { pan: panOf(z.x - this.cam) }); }
    } else if (z.state === 'grab') {
      if (Math.abs(d) > 60) { z.state = 'walk'; return; }
      z.grabT -= dt;
      if (z.grabT <= 0 && who === 'm') { z.grabT = R.range(1.1, 1.7); this.hurtMate(z); return; }
      if (z.grabT <= 0 && this.downed > 0) { z.grabT = R.range(1.1, 1.7); this.downed -= 2.5; sfx.hurt(); return; }
      if (z.grabT <= 0) {
        z.grabT = R.range(1.1, 1.7);
        const bite = R.chance(0.3);
        const wd = wound(this.s, bite ? 'bite' : R.pick(['laceration', 'scratch', 'bruise']), R.range(0.18, 0.4));
        sfx.hurt();
        const v = voiceOf(z.def.id);
        if (v) sfx.zombieVoice(v, 'attack', { pan: panOf(z.x - this.cam), volume: 0.8 });
        this.shake = 6;
        for (let i = 0; i < 6; i++) this.parts.push({ x: this.px, y: GROUND - 90, vx: R.range(-120, 120), vy: R.range(-160, 0), life: 1, color: '#5e1410', size: 3, g: GROUND });
        this.say(bite ? `${first(this.s)} is BITTEN.` : `${wd.kind}.`, 2.5);
        if (bite) tale(this.s, `Bitten at ${this.site.name}, out on a run.`);
        if (pain(this.s) > 1.45) this.leaderDown(`torn apart at ${this.site.name} by ${z.def.name === 'Sleeper' ? 'Sleepers' : `a ${z.def.name}`}`);
      }
    }
  }

  // ---------- downed & dragged / companion ----------
  downCause = '';
  leaderDown(cause: string) {
    if (this.mate && !this.mateDown && !this.downed && !this.dragging) {
      this.downed = 10;
      this.downCause = cause;
      this.searching = null;
      this.say(`${first(this.s)} is DOWN. ${first(this.mate)} is coming.`, 4);
      sfx.hurt();
      return;
    }
    if (this.downed || this.dragging) return;
    this.finish(true, cause);
  }

  updDowned(dt: number) {
    if (!this.mate) return;
    if (!this.dragging) {
      this.downed -= dt;
      if (this.mateDown) this.downed -= dt; // nobody coming
      if (Math.abs(this.mateX - this.px) < 40 && !this.mateDown) {
        this.dragging = true;
        this.downed = 0;
        this.say(`${first(this.mate)} gets ${first(this.s)} by the collar and starts pulling. The pack stays behind.`, 4);
        // drag means the leader's pack is dropped where they fell; only the mate's share comes home
        let keep = 0;
        const kept: PackItem[] = [];
        for (const it of this.pack) { if (keep + itemSlots(it) <= MATE_CAP) { kept.push(it); keep += itemSlots(it); } }
        const left = this.pack.filter((it) => !kept.includes(it));
        if (left.length) this.spots.push({ x: this.px, searched: false, kind: 'drop', label: 'the dropped pack', loot: 0, zone: this.zoneOf(this.px), items: left });
        this.pack = kept;
      } else if (this.downed <= 0) this.finish(true, this.downCause);
      return;
    }
    // dragging home
    if (this.mateDown) { this.finish(true, this.downCause); return; }
    const grabbedM = this.zs.some((z) => z.state === 'grab' && z.grabWho === 'm');
    if (!grabbedM) { this.px -= 70 * dt; this.mateX = this.px - 30; }
    this.face = -1;
  }

  hurtMate(z: EZ) {
    const m = this.mate!;
    if (this.mateDown) { this.mateDown -= 3; sfx.hurt(); return; }
    const bite = R.chance(0.3);
    wound(m, bite ? 'bite' : R.pick(['laceration', 'scratch', 'bruise']), R.range(0.18, 0.4));
    sfx.hurt();
    this.say(bite ? `${first(m)} is BITTEN.` : `${first(m)} is hurt.`, 2.5);
    if (bite) tale(m, `Bitten at ${this.site.name}, out on a run with ${first(this.s)}.`);
    if (pain(m) > 1.45) {
      this.mateDown = 15;
      z.state = 'walk';
      this.say(`${first(m)} is DOWN. Get to ${first(m)} and hold ${keyCap('run.search')}.`, 4);
    }
  }

  reviveMate() {
    const m = this.mate!;
    this.mateDown = 0;
    this.reviveT = 0;
    this.say(`${first(this.s)} hauls ${first(m)} back onto ${m.sex === 'm' ? 'his' : 'her'} feet.`, 3);
    changeOpinion(m, this.s, 15);
    addThought(m, { id: 'saved', label: `${first(this.s)} pulled me out`, mood: 5, days: 4, about: this.s.id }, 1);
    tale(this.s, `Got ${first(m)} back on ${m.sex === 'm' ? 'his' : 'her'} feet at ${this.site.name}.`);
  }

  mateProf(): FireProfile | null {
    return this.mateW ? fireProfile(this.mateW) : null;
  }

  updMate(dt: number) {
    const m = this.mate!;
    if (this.mateDown > 0) {
      this.mateDown -= dt;
      if (this.mateDown <= 0) this.mateDies(`bled out on the road at ${this.site.name}`);
      return;
    }
    if (this.dragging) return;
    const grabbed = this.zs.some((z) => z.state === 'grab' && z.grabWho === 'm');
    const target = this.downed > 0 ? this.px - 30 : this.px - this.face * 60;
    if (!grabbed) {
      const step = (this.downed > 0 ? 190 : 165) * dt;
      this.mateX += Math.max(-step, Math.min(step, target - this.mateX));
    }
    // shoot: the nearest awake one, a little slower to react than the leader
    const p = this.mateProf();
    this.mateCd -= dt;
    if (this.mateReload > 0) {
      this.mateReload -= dt;
      if (this.mateReload <= 0 && p) {
        const got = Math.min(p.mag - this.mateMag, roundsInStores(p, G.stores));
        if (p.ammoRes) add(p.ammoRes, -got * p.perShot);
        this.mateMag += got;
      }
      return;
    }
    let tz: EZ | null = null;
    for (const z of this.zs) {
      if (z.state === 'dying' || z.state === 'sleep' || z.state === 'kin') continue;
      const d = Math.abs(z.x - this.mateX);
      if (d < 620 && (!tz || d < Math.abs(tz.x - this.mateX))) tz = z;
    }
    if (!tz || this.mateCd > 0) return;
    if (!p || (this.mateMag <= 0 && roundsInStores(p, G.stores) < 1)) {
      // no gun or no ammo: shove what is close
      if (Math.abs(tz.x - this.mateX) < 55) { tz.x += Math.sign(tz.x - this.mateX) * 70; tz.hp -= this.mateMelee(); if (tz.state === 'grab') tz.state = 'walk'; this.mateCd = 1; sfx.thud(); if (tz.hp <= 0) { this.shooter = 'm'; this.kill(tz); this.shooter = 'p'; } }
      return;
    }
    if (this.mateMag <= 0) { this.mateReload = p.reloadPerRound ? p.reload * p.mag : p.reload; return; }
    if (p.explosive && (Math.abs(tz.x - this.mateX) < p.explosive.radius * 1.3 || Math.abs(tz.x - this.px) < p.explosive.radius)) return;
    this.mateCd = 1 / p.rof + R.range(0.05, 0.25);
    const k = depthScale(LANES[0]);
    const ox = this.mateX + Math.sign(tz.x - this.mateX) * SH * 0.45 * k, oy = LANES[0] - SH * 0.68 * k;
    const ty = tz.y - this.zh(tz) * (0.8 + R.range(-0.15, 0.1));
    const base = Math.atan2(ty - oy, tz.x - ox);
    const spreadA = p.spread * (1.75 - aimFactor(m));
    this.shooter = 'm';
    for (let b = 0; b < p.burst && this.mateMag > 0; b++) {
      this.mateMag--;
      if (p.explosive) this.explode(tz.x, tz.y, p);
      else for (let i = 0; i < p.pellets; i++) this.ray(ox, oy, base + (R.next() + R.next() - 1) * (p.pellets > 1 ? p.spread : spreadA), p, p.pellets > 1, tz.y);
    }
    this.shooter = 'p';
    this.noise = Math.min(4, this.noise + p.noise * 0.7);
    if (this.mateW) this.mateW.cond = Math.max(0.05, this.mateW.cond - 0.0008);
    sfx.shoot(this.mateW!.def, { far: 0.3, suppressed: isSuppressed(this.mateW), pan: panOf(this.mateX - this.cam) * 0.6, volume: 0.85 });
  }

  mateMelee() {
    const k = this.mate && G.melee?.find((x) => x.uid === this.mate!.melee);
    return k ? meleeProfile(k).dmg : 8;
  }

  mateDies(cause: string) {
    const m = this.mate!;
    killSurvivor(m, cause);
    log('death', `${displayName(m)} went out with ${displayName(this.s)} to ${this.site.name} and did not come back.`);
    this.lines.push(`${first(m)} did not make it home.`);
    this.mate = null;
    this.mateDown = 0;
  }

  shove() {
    if (this.shoveCd > 0 || this.downed > 0 || this.dragging) return;
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
    this.reloadSfx?.cancel();
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
    if (roundsInStores(p, G.stores) < 1) { this.say(`No ${ammoLabel(p.ammoRes).toLowerCase()}. ${ammoTypesFor(this.w.def).length > 1 ? `${keyCap('run.ammo')} switch ammo, or shove` : `Shove ${keyCap('run.shove')}`} and run.`, 2); sfx.dry(); return; }
    const armHurt = this.s.wounds.some((w) => w.part === 'larm' || w.part === 'rarm') ? 1.35 : 1;
    this.reload = p.reload * armHurt;
    this.reloadSfx?.cancel();
    // the rig plays it over the reload time and its events voice each stage (Classic: scheduled sfx)
    const anim = this.actors.reload('p', this.w.def, this.reload, { empty: this.mag <= 0, perRound: p.reloadPerRound, rounds: p.mag - this.mag });
    if (anim) this.reloadSfx = anim;
    else if (p.reloadPerRound) sfx.reload(gunSoundFor(this.w.def).reload, 'shell');
    else this.reloadSfx = sfx.reloadFor(this.w.def, this.reload, p.mag - this.mag);
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
      if (got > 0 && this.mag < p.mag) this.startReload();
      else sfx.reload(gunSoundFor(this.w.def).reload, 'rack');
    }
  }

  muzzle() {
    const rm = this.actors.muzzle('p');
    if (rm) return rm;
    return { x: this.px - this.cam + this.face * SH * 0.45, y: GROUND - SH * 0.68 };
  }

  fire(click: boolean) {
    if (!this.w || this.cd > 0 || this.searching || this.burstLeft > 0 || this.downed > 0 || this.dragging) return;
    const p = this.prof()!;
    if (!click && !p.auto) return;
    if (this.reload > 0) {
      // a one-at-a-time reload can be interrupted by firing
      if (p.reloadPerRound && this.mag > 0) { this.reload = 0; this.reloadSfx?.cancel(); }
      else return;
    }
    if (this.mag <= 0) { sfx.dry(); if (autoReload()) this.startReload(); this.cd = 0.25; return; }
    this.cd = 1 / p.rof;
    if (R.chance(p.jam)) {
      this.say(`${this.w.name ?? WEAPONS[this.w.def].name} jammed.`, 1.5);
      sfx.jam();
      this.cd = p.jamClear;
      this.actors.clearJam('p', this.w.def, p.jamClear); // tap-rack (rigged)
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
      const fe = gunFeel(p);
      this.shake = Math.max(this.shake, fe.shake * (p.auto ? 0.5 : 0.6));
      this.recoil = 1;
      this.kick = fe.kick;
      this.flash = fe.light > 0 ? 0.06 : 0;
      this.flashK = flashKind(this.w, p);
      this.flashAng = base;
      this.flashSize = fe.size;
      this.ammoPunch = 1;
      this.vfx.muzzle({ x: mz.x + this.cam, y: mz.y, ang: base, defId: this.w.def, prof: p, suppressed: isSuppressed(this.w), key: this,
        eject: !p.auto || Math.random() < 0.7 ? { x: mz.x + this.cam - 30 * this.face, y: mz.y + 6, ground: GROUND - 4 + Math.random() * 10, face: this.face } : undefined });
      this.roundsFired++;
      this.heat = Math.min(6, this.heat + p.noise * 0.12);
      this.noise = Math.min(4, this.noise + p.noise);
      G.stats.shots++;
      this.w.cond = Math.max(0.05, this.w.cond - 0.0008);
      sfx.shoot(this.w.def, { suppressed: isSuppressed(this.w), incendiary: p.incendiary, pan: panOf(mz.x) * 0.4 });
    } while (this.burstLeft > 0 && p.burstGap <= 0);
    if (this.burstLeft > 0) this.burstT = p.burstGap;
    if (this.mag === 0 && this.burstLeft === 0 && autoReload()) this.startReload();
  }

  // Ground-space blast (contract: blastDamage ellipse); armour ignored, knocks outward.
  explode(x: number, y: number, p: FireProfile) {
    const ex = p.explosive!;
    sfx.explosion(Math.max(0.6, Math.min(1.6, ex.radius / 150)));
    this.shake = Math.max(this.shake, 16);
    this.noise = 4;
    this.heat = Math.min(6, this.heat + 1);
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
      if (pain(this.s) > 1.45) this.leaderDown(`caught in a blast of their own at ${this.site.name}`);
    }
  }

  ray(ox: number, oy: number, a: number, p: FireProfile, pellet: boolean, laneY: number): { x: number; y: number } {
    const { pierce, knock, armorPen } = p;
    const dmg = p.dmg;
    const dx = Math.cos(a), dy = Math.sin(a);
    const wdef = this.shooter === 'p' ? this.w?.def : undefined;
    this.vfx.shotStart(ox, oy, wdef, p);
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
      if ((z.down ?? 0) > 0) { z.hp -= dd * (IMPACT.FINISH_MUL - 1); } // down in the road: an easy finish
      z.x += Math.sign(dx) * knock * (pellet ? 0.25 : 1);
      if (z.state === 'grab' && knock > 15) z.state = 'walk';
      if (z.hp > 0) this.impact(z, { dmg: dr, knock, zone: h.head ? 'head' : oy + dy * h.t > z.y - this.zh(z) * 0.42 ? 'leg' : 'torso', pellet }, Math.sign(dx) || 1);
      const px = ox + dx * h.t, py = oy + dy * h.t;
      const plate = !h.head && !!z.def.armor && dd < dr * 0.6;
      const mine = this.shooter === 'p';
      if (plate) {
        this.vfx.impact('armor', px, py, a, { ground: z.y, pellet });
      } else {
        this.vfx.impact(h.head ? 'head' : 'flesh', px, py, a, { ground: z.y, power: Math.min(1.6, 0.6 + dd / 60), pellet });
      }
      const imp = h.head ? 'head' : plate ? 'armor' : 'flesh';
      const v = voiceOf(z.def.id);
      if (z.hp <= 0) {
        if (h.head && !z.headless && z.def.id !== 'drag' && !reduceGore()) { z.headless = true; sfx.headpop(); }
        sfx.impact(imp, { volume: mine ? 1 : 0.5 });
        if (mine) {
          sfx.confirm(1);
          this.hitMark = { t: 0.24, kill: true, head: h.head };
          // §5 hitstop on a kill, scaled by the pull (autos at most a nudge)
          const pull = (p.dmg * p.pellets) / 64;
          this.hitstop = Math.max(this.hitstop, p.auto ? 0.025 : Math.min(0.11, Math.max(0.018, 0.04 + 0.045 * Math.log2(Math.max(0.1, pull))) + (h.head ? 0.025 : 0.01)));
        }
        if (v && R.chance(0.5)) sfx.zombieVoice(v, 'death', { pan: panOf(z.x - this.cam), volume: 0.8 });
        this.kill(z);
      } else {
        sfx.impact(imp, { volume: mine ? 1 : 0.5 });
        if (mine) this.hitMark = { t: 0.18, kill: false, head: h.head };
        if (v && dd >= 12) sfx.zombieVoice(v, 'pain', { pan: panOf(z.x - this.cam), volume: 0.7 });
      }
      n++; end = h.t;
      if (n > pierce) break;
      d *= 0.7;
    }
    if (n === 0 && dy > 0.01 && end < 1500) {
      // a miss kicks up the road
      if (!pellet && this.shooter === 'p') sfx.impact('ground', { volume: 0.3 });
    }
    const ve = Math.min(end, 1500);
    this.vfx.bullet({ x0: ox, y0: oy, x1: ox + dx * ve, y1: oy + dy * ve, defId: wdef, prof: p, pellet, end: n > 0 ? 'body' : dy > 0.01 && end < 1500 ? 'ground' : 'air', laneY, key: this.shooter });
    if (p.flare && (!pellet || R.chance(0.2))) this.glows.push({ x: ox + dx * Math.min(end, 1100), y: Math.min(GROUND, oy + dy * Math.min(end, 1100)), life: pellet ? 1.5 : FLARE_LIGHT.time, max: pellet ? 1.5 : FLARE_LIGHT.time });
    return { x: ox + dx * end, y: oy + dy * end };
  }

  kill(z: EZ) {
    if (z.state === 'dying') return;
    const wasOn = z.state === 'grab' ? z.grabWho : undefined;
    this.actors.onKill(z, this.shooter === 'm' ? { x: this.mateX, y: 0 } : { x: this.px, y: 0 }, this.shooter === 'k');
    z.state = 'dying';
    z.dieT = 0;
    G.stats.kills++;
    if (this.shooter === 'm' && this.mate) {
      this.mate.kills++;
      if (this.mateW) this.mateW.kills++;
      if (wasOn === 'p' && !this.rescued) {
        this.rescued = true;
        changeOpinion(this.s, this.mate, 15);
        addThought(this.s, { id: 'saved', label: `${first(this.mate)} pulled me out`, mood: 5, days: 4, about: this.mate.id }, 1);
        tale(this.mate, `Shot one off ${first(this.s)} at ${this.site.name}.`);
        this.say(`${first(this.mate)} shot it off you.`, 2.5);
      }
    } else if (this.shooter === 'k') {
      this.s.kills++;
      if (this.kn) this.kn.kills++;
    } else {
      this.s.kills++;
      if (this.w) this.w.kills++;
    }
  }

  // ---------- melee ----------
  mprof(): MeleeProfile {
    return this.kn ? meleeProfile(this.kn) : FISTS;
  }

  swing() {
    if (this.swingT > 0 || this.swingCd > 0 || this.downed > 0 || this.dragging || this.searching) return;
    const p = this.mprof();
    if (p.fuel && G.stores.fuel < p.fuel) { if (this.t - this.fuelNag > 2) { this.say('The saw coughs and dies. No fuel.', 2); this.fuelNag = this.t; } return; }
    this.swingTired = this.stamina < p.stamina;
    this.stamina = Math.max(0, this.stamina - p.stamina);
    sfx.melee('swing', this.kn?.def ?? 'fists', { volume: this.swingTired ? 0.7 : 1 });
    this.swingT = Math.max(0.01, p.swingTime * (this.swingTired ? 1.5 : 1));
    this.actors.swing('p', this.swingT, this.kn?.def);
  }
  fuelNag = -9;

  meleeSound(kind: string) {
    if (kind === 'miss') return; // the whoosh already played at the start of the swing
    sfx.melee(kind === 'crit' || kind === 'finisher' ? 'heavy' : 'hit', this.kn?.def ?? 'fists');
  }

  resolveSwing() {
    const p = this.mprof();
    if (p.fuel) add('fuel', -p.fuel);
    this.noise = Math.min(4, this.noise + p.noise);
    this.heat = Math.min(6, this.heat + p.noise * 0.08);
    this.slashT = 0.12;
    this.swingCd = p.recovery * (this.swingTired ? 1.5 : 1);
    const my = this.mouse.y;
    const targets = this.zs
      .filter((z) => z.state !== 'dying' && z.state !== 'kin')
      .map((z) => ({ z, dx: (z.x - this.px) * this.face }))
      .filter((o) => o.dx > -10 && o.dx <= p.reach + this.zw(o.z) / 2)
      .sort((a, b) => a.dx - b.dx)
      .slice(0, p.arc);
    if (!targets.length) { this.meleeSound('miss'); return; }
    let hits = 0;
    for (const { z } of targets) {
      const h = this.zh(z);
      // backstab a Sleeper, or finish a crawler with a finisher: dead, and quiet
      if (z.state === 'sleep' || (p.finisher && z.def.id === 'drag')) {
        z.hp = 0;
        this.shooter = 'k'; this.kill(z); this.shooter = 'p';
        this.meleeSound('finisher');
        hits++;
        continue;
      }
      const overhead = my <= z.y - h * (1 - z.def.head);
      let dmg = p.dmg * (this.swingTired ? 0.5 : 1);
      dmg = overhead ? dmg * p.crit : armorDamage(dmg, z.def.armor, 0);
      z.hp -= dmg;
      z.flash = 0.1;
      z.x += this.face * p.knock * (z.def.id === 'ferryman' ? 0.15 : 1);
      if (R.chance(p.stagger)) { z.stun = 0.5 + p.stagger * 0.6; if (z.state === 'grab') z.state = 'walk'; }
      if (z.hp > 0) this.impact(z, { dmg, knock: p.knock, zone: overhead ? 'head' : 'torso', melee: true }, this.face);
      if (p.bleed) { z.bleed = BLEED_TIME; z.bleedDps = p.bleed; }
      for (let i = 0; i < (overhead ? 8 : 4); i++) this.parts.push({ x: z.x - this.face * this.zw(z) * 0.3, y: z.y - h * (overhead ? 0.85 : 0.55), vx: this.face * R.range(20, 160), vy: R.range(-180, 20), life: 1.2, color: R.pick(['#4a0d0b', '#5e1410']), size: R.range(1.5, 3.5), g: z.y });
      if (z.hp <= 0) {
        if (overhead && !z.headless && z.def.id !== 'drag') z.headless = true;
        this.shooter = 'k'; this.kill(z); this.shooter = 'p';
      }
      this.meleeSound(overhead ? 'crit' : 'hit');
      hits++;
    }
    this.shake = Math.max(this.shake, Math.min(6, p.knock / 15));
    // wear: every hit costs the edge or the handle
    if (this.kn && hits) {
      this.kn.cond -= p.wear * hits;
      if (this.kn.cond <= 0) {
        const name = MELEE[this.kn.def].name.toLowerCase();
        G.melee = (G.melee ?? []).filter((x) => x !== this.kn);
        this.s.melee = null;
        this.kn = null;
        this.say(`The ${name} breaks.`, 2.5);
        this.lines.push(`${first(this.s)}'s ${name} broke on a run.`);
      }
    }
  }

  searchTime(sp: Spot) {
    return sp.kind === 'cache' ? 6 : sp.kind === 'truck' ? 4 : sp.kind === 'drop' ? 0.8 : 2.5;
  }

  finishSearch(sp: Spot) {
    sp.searched = true;
    this.searching = null;
    if (sp.kind === 'door' || sp.kind === 'shed') sfx.search('close', { volume: 0.7 });
    else if (sp.kind === 'cache') sfx.search('glass', { volume: 0.8 });
    else if (sp.kind !== 'truck') sfx.search('rummage', { volume: 0.6 });
    if (sp.kind === 'drop') {
      for (const it of sp.items ?? []) this.toPack(it);
      this.spots = this.spots.filter((x) => x !== sp);
      this.say('Picked it back up.', 1.5);
      return;
    }
    if (sp.kind === 'truck') { this.driveOut(); return; }
    this.noise = Math.min(4, this.noise + (sp.kind === 'cache' ? 3 : 0.5));
    this.heat = Math.min(6, this.heat + (sp.kind === 'cache' ? 1.5 : 0.25));
    if (sp.kind === 'kin') {
      this.toPack({ kind: 'res', res: 'food', n: 6 });
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
    const mult = sp.loot * (0.6 + skillOf(this.s, 'scavenging') * 0.08) * (sp.kind === 'car' ? 0.6 : sp.kind === 'body' ? 0.5 : sp.kind === 'cache' ? 3 : 1) * RUN_YIELD * ZONE_LOOT[sp.zone];
    for (const [k, v] of Object.entries(this.site.loot)) {
      if (!R.chance(0.65)) continue;
      const n = Math.round((v ?? 0) * mult * R.range(0.5, 1.5));
      if (n > 0) { this.toPack({ kind: 'res', res: k as Res, n }); got.push(`${n} ${RES_LABEL[k as Res].toLowerCase()}`); }
    }
    if (sp.kind !== 'car' && R.chance(0.22)) {
      const d = findDoc();
      if (d) { got.push(`papers: "${d.title}"`); this.lines.push(`Found papers: ${d.title}. (Town tab)`); sfx.search('paper', { delay: 0.25 }); }
    }
    const cache = sp.kind === 'cache';
    if (this.site.mods?.length && R.chance(cache ? 0.6 : 0.14 * sp.loot * ZONE_LOOT[sp.zone])) {
      const md = R.pick(this.site.mods);
      this.toPack({ kind: 'mod', def: md, cond: R.range(0.6, 1) });
      got.push(`a ${MODS[md].name.toLowerCase()}`);
    }
    if (this.site.melee?.length && R.chance(cache ? 0.3 : 0.1 * sp.loot * ZONE_LOOT[sp.zone])) {
      const md = R.pick(this.site.melee);
      this.toPack({ kind: 'melee', def: md, cond: R.range(0.5, 1) });
      got.push(`a ${MELEE[md].name.toLowerCase()}`);
    }
    if (R.chance(cache ? 0.7 : this.site.weaponChance * 0.5 * sp.loot * ZONE_LOOT[sp.zone])) {
      const wd = R.pick(this.site.weapons);
      this.toPack({ kind: 'gun', def: wd, cond: R.range(0.5, 1) });
      got.push(`a ${WEAPONS[wd].name.toLowerCase()}`);
    }
    if (this.slots() > this.cap()) got.push(`— the pack is overfull, you are slowed (${keyCap('run.pack')}/${keyCap('run.drop')} to leave something)`);
    this.say(got.length ? `${sp.label[0].toUpperCase() + sp.label.slice(1)}: ${got.join(', ')}.` : `${sp.label[0].toUpperCase() + sp.label.slice(1)}: nothing. Somebody got here first.`, 3.5);
  }

  // the pickup: costs fuel and a part, makes a racket, and carries everything you left on the road
  driveOut() {
    add('fuel', -2);
    add('parts', -1);
    sfx.search('door');
    sfx.impact('metal', { delay: 0.3 }); sfx.thud();
    this.noise = 4;
    for (const sp of this.spots) if (sp.kind === 'drop') for (const it of sp.items ?? []) this.toPack(it);
    this.lines.push(`${first(this.s)} hotwired a pickup at ${this.site.name} and drove it home with everything in the bed.`);
    tale(this.s, `Hotwired a pickup at ${this.site.name} and drove home loaded.`);
    if (this.mate && this.mateDown > 0) { this.mateDown = 0; this.lines.push(`${first(this.mate)} rode home in the bed.`); }
    this.finish(false);
  }

  finish(died: boolean, cause?: string) {
    if (this.ended) return;
    this.ended = true;
    this.destroy();
    const stockKey = `stock_${this.site.id}`;
    G.flags[stockKey] = ((G.flags[stockKey] as number) ?? this.site.stock) - 1;
    if (this.mate && this.mateDown > 0) this.mateDies(`left on the road at ${this.site.name}, still breathing`);
    if (died) {
      killSurvivor(this.s, cause ?? `on a run to ${this.site.name}`);
      log('death', `${displayName(this.s)} went to ${this.site.name} and did not come back. Whatever they carried is out there still.`);
      if (this.mate) {
        this.lines.push(`${first(this.mate)} came back alone.`);
        tale(this.mate, `Came back alone from ${this.site.name}.`);
      }
    } else {
      // empty the pack into the house
      for (const it of this.pack) {
        if (it.kind === 'res') { add(it.res, it.n); this.loot[it.res] = (this.loot[it.res] ?? 0) + it.n; }
        else if (it.kind === 'gun') { newWeapon(it.def, it.cond); this.weapons.push(it.def); this.lines.push(`Brought home a ${WEAPONS[it.def].name.toLowerCase()}.`); }
        else if (it.kind === 'melee') { (G.melee ??= []).push({ uid: uid('k'), def: it.def, cond: it.cond, kills: 0 }); this.lines.push(`Brought home a ${MELEE[it.def].name.toLowerCase()}.`); }
        else { (G.modStock ??= []).push({ uid: uid('m'), def: it.def, cond: it.cond }); this.lines.push(`Brought home a ${MODS[it.def].name.toLowerCase()}.`); }
      }
      if (this.dragging && this.mate) {
        changeOpinion(this.s, this.mate, 20);
        addThought(this.s, { id: 'dragged_home', label: `${first(this.mate)} dragged me home`, mood: 8, days: 6, about: this.mate.id }, 1);
        tale(this.mate, `Dragged ${first(this.s)} home from ${this.site.name}.`);
        tale(this.s, `Went down at ${this.site.name}; ${first(this.mate)} dragged ${this.s.sex === 'm' ? 'him' : 'her'} home.`);
        log('tale', `${displayName(this.mate)} dragged ${displayName(this.s)} home from ${this.site.name}.`);
        this.lines.push(`${first(this.mate)} dragged ${first(this.s)} home by the collar. Most of the pack is still out there.`);
      } else if (this.mate) {
        changeOpinion(this.s, this.mate, 4);
        changeOpinion(this.mate, this.s, 4);
      }
      if (this.w) for (const l of wearMods(this.w, this.roundsFired)) this.lines.push(l);
      const rec = this.prof()?.recoverable ?? 0;
      for (const [k, v] of Object.entries(this.spent)) {
        const back = Math.floor((v ?? 0) * (AMMO_TYPES[k as Res]?.recoverable ?? rec));
        if (back > 0) { add(k as Res, back); this.lines.push(`${first(this.s)} pulled ${back} ${ammoLabel(k as Res).toLowerCase()} back out of the dead.`); }
      }
      const total = Object.values(this.loot).reduce((a, b) => a + (b ?? 0), 0);
      if (total > 40) tale(this.s, `Came back from ${this.site.name} loaded down.`);
      log('event', `${displayName(this.s)} led a run to ${this.site.name}${this.mate ? ` with ${displayName(this.mate)}` : ''} and came back.`);
    }
    this.onEnd({ loot: this.loot, weapons: this.weapons, died, found: died ? undefined : this.found, lines: this.lines });
  }

  // ---------- draw ----------
  /** this frame's lane looks (looksAt(dusk)) */
  looks: Look[] = LANE_LOOK;
  draw() {
    const c = this.c;
    c.save();
    const sk = this.shake * shakeScale();
    if (sk > 0) c.translate(R.range(-sk, sk), R.range(-sk, sk) * 0.6);
    bakeBackgrounds();
    const dusk = Math.max(0, Math.min(1, 1 - this.daylight / Math.min(150, this.dayMax)));
    this.looks = looksAt(dusk); // people fall with the light too (not only the props and backdrop)
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
    // what the guns and the fighting left on the road (vfx stamps: brass, blood, chips)
    c.drawImage(this.decalCv, Math.max(0, this.cam), 0, W, DECAL_H, Math.max(0, -this.cam), DECAL_TOP, W, DECAL_H);
    // spent brass in the road
    for (const d of this.decals) {
      const x = d.x - this.cam;
      if (x < -10 || x > W + 10) continue;
      c.save(); c.translate(x, d.y); c.rotate(d.rot); c.globalAlpha = 0.85; c.fillStyle = d.color; c.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); c.restore();
    }
    // contact shadows: one path, one fill (spots, zombies, player, follower)
    // the cache, the pickup and a dropped pack have their own sprites (tools/sprites-world.json); older stand-ins if missing
    const SPR: Record<Spot['kind'], string> = {
      door: 'obj_door', car: 'obj_car', shed: 'obj_shed', body: 'obj_body', kin: 'obj_kin',
      cache: img('obj_cache') ? 'obj_cache' : 'obj_shed', truck: img('obj_truck') ? 'obj_truck' : 'obj_car', drop: img('obj_duffel') ? 'obj_duffel' : 'obj_body',
    };
    /** base y (feet) and display height of a spot's prop */
    const at = (sp: Spot): [number, number] => { const road = inRoad(sp.kind); return [road ? GROUND : KERB, propH(SPR[sp.kind], road)]; };
    // the same few sprites along a street: every other car, door, shed and body is mirrored
    const flipOf = (sp: Spot) => (sp.kind === 'car' || sp.kind === 'door' || sp.kind === 'shed' || sp.kind === 'body') && ((Math.round(sp.x) >> 5) & 1) === 1;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath();
    for (const sp of this.spots) {
      const x = sp.x - this.cam;
      if (x < -250 || x > W + 250) continue;
      const im = img(SPR[sp.kind]);
      const [by, ph] = at(sp);
      const w = im ? (im.width / im.height) * ph : 80;
      const ry = inRoad(sp.kind) ? 6 : 7 * KERB_K;
      c.moveTo(x + w * 0.45, by + 2); c.ellipse(x, by + 2, w * 0.45, ry, 0, 0, 7);
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
      const id = SPR[sp.kind];
      const [by, h] = at(sp);
      if (sp.kind === 'drop' && img('obj_duffel')) {
        drawSpot(c, 'obj_duffel', h, false, dusk, x, by - h + 4);
        if (Math.abs(sp.x - this.px) < 60) { c.font = '13px "Special Elite", monospace'; c.fillStyle = '#efe2c2'; c.textAlign = 'center'; c.textAlign = 'left'; this.prompt = { hints: [{ key: 'run.search', label: 'pick up', n: (sp.items ?? []).length }], x, y: GROUND - 40 }; }
        continue;
      }
      if (sp.kind === 'drop') {
        c.fillStyle = '#4a3a26';
        c.beginPath(); c.ellipse(x, GROUND - 10, 18, 12, 0, 0, 7); c.fill();
        c.fillStyle = '#2a2016'; c.fillRect(x - 3, GROUND - 26, 6, 8);
        if (Math.abs(sp.x - this.px) < 60) { c.font = '13px "Special Elite", monospace'; c.fillStyle = '#efe2c2'; c.textAlign = 'center'; c.textAlign = 'left'; this.prompt = { hints: [{ key: 'run.search', label: 'pick up', n: (sp.items ?? []).length }], x, y: GROUND - 40 }; }
        continue;
      }
      drawSpot(c, id, h, sp.searched, dusk, x, by - h + (sp.kind === 'body' ? 6 : 4), flipOf(sp));
      if (!sp.searched && Math.abs(sp.x - this.px) < 60) {
        // the prompt is drawn after the people, so nobody's head covers it
        this.prompt = { hints: [sp.kind === 'truck' ? { key: 'run.search', label: 'drive home', icon: 'icon_fuel', hot: true } : { key: 'run.search', label: `search ${sp.label}`, icon: sp.kind === 'cache' ? 'icon_st_noise' : undefined }], x, y: Math.min(by - h - 14, GROUND - SH - 30) };
      } else if (!sp.searched) {
        c.fillStyle = 'rgba(232,200,120,0.7)';
        c.beginPath(); c.arc(x, by - h - 10, 3, 0, 7); c.fill();
      }
    }
    // zone landmarks: a post and a sign at each boundary
    this.zoneB.forEach((bx, i) => {
      const x = bx - this.cam;
      if (x < -200 || x > W + 200) return;
      // the rail crossing's crossbuck, then the four-way stop; the zone's name on a plate above
      const sign = i === 0 ? 'obj_sign_rail' : 'obj_sign_stop';
      const sh = propH(sign, false), top = KERB - sh + 4;
      const sv = drawSpot(c, sign, sh, false, dusk, x, top);
      // the plate floats over the sign's top (the old 2.2 m sign had it at a fixed height)
      const py = sv ? top - 10 : GROUND - 202;
      if (sv) {
        c.fillStyle = 'rgba(14,12,10,0.78)';
        c.fillRect(x - 74, py - 34, 148, 34);
      } else {
        c.fillStyle = '#16130f';
        c.fillRect(x - 4, GROUND - 230, 8, 232);
        c.fillRect(x - 70, GROUND - 236, 140, 34);
      }
      c.font = '13px "Special Elite", monospace';
      c.fillStyle = '#d8c89a';
      c.textAlign = 'center';
      c.fillText(ZONE_NAMES[i + 1], x, py - 20);
      c.fillStyle = '#b0502c';
      c.fillText(`loot ×${ZONE_LOOT[i + 1]} · more of them`, x, py - 6);
      c.textAlign = 'left';
    });
    // actors, y-sorted by feet (id epsilon breaks ties)
    const list: { y: number; f: () => void }[] = [];
    for (const z of this.zs) list.push({ y: z.y + z.id * 1e-4, f: () => this.drawZ(z) });
    list.push(...this.actors.drawCorpses(c, this.cam, this.looks, (y) => Math.max(0, Math.min(2, Math.round((y - LANES[0]) / 24)))));
    list.push({ y: GROUND + 0.5, f: () => this.drawP() });
    if (this.found) list.push({ y: LANES[0] + 0.4, f: () => this.drawFollower() });
    if (this.mate) list.push({ y: LANES[0] + 0.6, f: () => this.drawMate() });
    list.sort((a, b) => a.y - b.y);
    for (const l of list) l.f();
    if (this.prompt) {
      const pr = this.prompt;
      c.font = `13px ${FONT}`;
      const tw = pr.hints.reduce((a, h) => a + c.measureText(h.label).width + 50, 0);
      const px = Math.min(W - 10 - tw / 2, Math.max(10 + tw / 2, pr.x));
      c.fillStyle = 'rgba(10,9,8,0.55)'; c.beginPath(); c.roundRect(px - tw / 2 - 6, pr.y - 16, tw + 12, 22, 4); c.fill();
      hintRow(c, pr.hints, px, pr.y, 'center');
      this.prompt = null;
    }
    // foreground strip at 1.3x camera speed
    if (fgC) {
      const off = Math.round((this.cam * 1.3) % 2560);
      for (let x = -off; x < W; x += 2560) c.drawImage(fgC, x, H - 38);
    }
    for (const p of this.parts) {
      const x = p.x - this.cam;
      if (p.kind === 'shell') { c.save(); c.translate(x, p.y); c.rotate(p.rot ?? 0); c.fillStyle = p.color; c.fillRect(-(p.w ?? 3) / 2, -(p.h ?? 1.5) / 2, p.w ?? 3, p.h ?? 1.5); c.restore(); }
      else if (p.kind === 'dust' || p.kind === 'puff') {
        const a = Math.max(0, p.life / (p.max ?? 0.5));
        c.fillStyle = p.kind === 'dust' ? `rgba(120,108,90,${a * 0.4})` : `rgba(${p.color},${a * 0.45})`;
        c.beginPath(); c.arc(x, p.y, p.size * (1.7 - a * 0.7), 0, 7); c.fill();
      } else { c.fillStyle = p.color; c.fillRect(x, p.y, p.size, p.size); }
    }
    // the muzzle flash, shaped by the gun
    // gunfire & effects (night/vfx), in world space
    c.save(); c.translate(-this.cam, 0); this.vfx.drawNormal(c); this.vfx.drawAdd(c); c.restore();
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

  /** Drive the rigs (night/actors.ts) from this frame of the run. */
  animate(dt: number) {
    if (dt <= 0) return;
    const A = this.actors;
    const p = A.body('p', this.s.sprite, 11);
    if (p) A.driveBody(p, dt, {
      x: this.px, weapon: this.w?.def ?? null, aimX: this.mouse.x, aimY: this.mouse.y, searching: !!this.searching,
      down: this.downed > 0 || this.dragging, reload: this.reload, mag: this.mag, wounds: this.s.wounds.length,
    });
    if (this.mate) {
      const m = A.body('m', this.mate.sprite, 23);
      const tz = this.zs.find((z) => z.state !== 'dying' && z.state !== 'sleep' && z.state !== 'kin' && Math.abs(z.x - this.mateX) < 620);
      const k = depthScale(LANES[0]);
      if (m) A.driveBody(m, dt, {
        x: this.mateX, weapon: this.mateW?.def ?? null,
        aimX: tz ? tz.x - this.cam : this.mateX - this.cam + this.face * 400, aimY: tz ? tz.y - this.zh(tz) * 0.75 : LANES[0] - SH * k * 0.65,
        searching: false, down: this.mateDown > 0, reload: this.mateReload, mag: this.mateMag, wounds: this.mate.wounds.length,
        reloadOf: () => { const pf = this.mateProf(); return pf ? { seconds: this.mateReload / (pf.reloadPerRound ? pf.mag : 1), rounds: pf.reloadPerRound ? pf.mag : 1, perRound: pf.reloadPerRound, empty: true } : null; },
      });
    }
    if (this.found && this.fx) {
      const f = A.body('f', this.found.sprite, 37);
      if (f) A.driveBody(f, dt, { x: this.fx, weapon: null, aimX: this.fx - this.cam + this.face * 300, aimY: LANES[0] - 100, searching: false, down: false, reload: 0, mag: 0, wounds: 0 });
    }
    const alive = new Set<number>();
    for (const z of this.zs) if (z.state !== 'dying') { alive.add(z.id); A.driveZed(z, dt); }
    A.update(dt, alive, this.looks, (y) => Math.max(0, Math.min(2, Math.round((y - LANES[0]) / 24))));
  }

  drawP() {
    const c = this.c;
    const im = img(this.s.sprite);
    if (!im) return;
    const h = SH, w = (im.width / im.height) * h;
    const x = this.px - this.cam;
    const moving = this.held('run.left') || this.held('run.right');
    const bob = moving ? -Math.abs(Math.sin(this.t * 9)) * 4 : 0;
    if (!this.actors.drawBody(c, 'p', x, GROUND, h, this.face < 0 ? -1 : 1, this.looks[2])) {
      c.save();
      c.translate(x - this.face * this.recoil * this.recoil * this.kick * 0.7, GROUND + bob);
      if (this.downed > 0 || this.dragging) c.rotate(1.45);
      c.scale(this.face, 1);
      if (this.kick >= 10 && this.recoil > 0) c.rotate(-this.recoil * this.recoil * 0.035 * (this.kick / 18));
      c.drawImage(im, -w / 2, -h, w, h);
      c.restore();
    }
    if (this.slashT > 0) {
      const p = this.mprof();
      c.strokeStyle = `rgba(240,230,210,${this.slashT * 6})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, GROUND - h * 0.6, Math.min(p.reach + 20, 130), this.face > 0 ? -1.1 : Math.PI - 0.6, this.face > 0 ? 0.6 : Math.PI + 1.1);
      c.stroke();
    }
    if (this.downed > 0) {
      c.font = '13px "Special Elite", monospace'; c.fillStyle = '#c04030'; c.textAlign = 'center';
      c.fillText(`DOWN — ${Math.ceil(this.downed)}s`, x, GROUND - 70); c.textAlign = 'left';
    }
    if (this.searching) {
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(x - 30, GROUND - h - 22, 60, 6);
      c.fillStyle = '#d9c9a0';
      c.fillRect(x - 30, GROUND - h - 22, 60 * Math.min(1, this.searchT / this.searchTime(this.searching)), 6);
    }
  }

  drawMate() {
    const c = this.c;
    const m = this.mate!;
    const im = img(m.sprite);
    if (!im) return;
    const h = SH, w = (im.width / im.height) * h;
    const k = depthScale(LANES[0]);
    const x = Math.round(this.mateX - this.cam);
    const tz = this.zs.find((z) => z.state !== 'dying' && z.state !== 'sleep' && Math.abs(z.x - this.mateX) < 620);
    const mf = (tz ? Math.sign(tz.x - this.mateX) || 1 : this.face) < 0 ? -1 : 1;
    if (!this.actors.drawBody(c, 'm', x, LANES[0], h * k, mf, this.looks[0])) {
      c.save();
      c.translate(x, LANES[0]);
      if (this.mateDown > 0) { c.rotate(-1.45); c.globalAlpha = 0.9; }
      c.scale(mf * k, k);
      c.drawImage(im, -w / 2, -h, w, h);
      c.restore();
    }
    c.font = '13px "Special Elite", monospace';
    c.textAlign = 'center';
    // the name is in the status panel; over the head only when they are down
    if (this.mateDown > 0) worldLabel(c, `${first(m)} — DOWN ${Math.ceil(this.mateDown)}s · hold ${keyCap('run.search')}`, x, LANES[0] - h * k - 8, '#c04030');
    if (this.reviveT > 0) { c.fillStyle = '#d9c9a0'; c.fillRect(x - 30, LANES[0] - h * k - 4, 60 * Math.min(1, this.reviveT / 2.5), 4); }
    c.textAlign = 'left';
  }

  fx = 0;
  drawFollower() {
    const c = this.c;
    const f = this.found!;
    const im = img(f.sprite);
    if (!im) return;
    const target = this.px - this.face * (this.mate ? 120 : 70);
    this.fx = this.fx ? this.fx + (target - this.fx) * 0.05 : target;
    const h = SH, w = (im.width / im.height) * h;
    const k = depthScale(LANES[0]);
    if (this.actors.drawBody(c, 'f', Math.round(this.fx - this.cam), LANES[0], h * k, this.face < 0 ? -1 : 1, this.looks[0])) return;
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
    const bk = bakeZ(z.sprite, bh, lane, z.variant, z.state === 'kin', this.looks);
    if (!bk) return;
    const h = this.zh(z), k = h / bk.h;
    const w = (bk.cv.width - bk.pad * 2) * k;
    const x = Math.round(z.x - this.cam);
    if (x < -200 || x > W + 200) return;
    if (this.actors.drawZed(c, z, this.cam, this.looks[lane], z.state === 'kin')) {
      if (z.state === 'sleep' && Math.abs(z.x - this.px) < 420) worldLabel(c, 'standing still', x, z.y - h - 8, 'rgba(200,190,170,0.7)');
      return;
    }
    c.save();
    let rot = 0, dy = 0, sy = 1;
    if (z.state === 'walk') { rot = Math.sin(z.phase * 3.2) * 0.04; dy = -Math.abs(Math.sin(z.phase * 3.2)) * 2.5 * z.sc; }
    // a hit reaction on the single image (night/impact.ts classicPose): tilt, knee, fall and rise
    const cp = z.state !== 'dying' ? classicPose(z as unknown as Zombie, h, this.t) : null;
    if (cp) { rot = cp.rot; dy = cp.dy; sy = cp.sy; }
    if (z.state === 'sleep' || z.state === 'kin') rot = 0.06 + Math.sin(z.phase * 0.7) * 0.01;
    if (z.state === 'grab') rot = -0.1 + Math.sin(z.phase * 7) * 0.06;
    if (z.state === 'dying') { const t = Math.min(1, z.dieT / 0.45); rot = t * 1.2; dy = t * h * 0.15; c.globalAlpha = 1 - Math.max(0, z.dieT - 0.4) * 5; }
    c.translate(x, z.y + dy);
    c.scale(-z.dir, 1); // sprites face left by default
    c.rotate(rot);
    if (sy !== 1) c.scale(1, sy);
    if (z.headless) { c.beginPath(); c.rect(-w / 2 - 10, -h + h * z.def.head * 0.95, w + 20, h); c.clip(); }
    c.drawImage(bk.cv, -w / 2 - bk.pad * k, -h - bk.pad * k, bk.cv.width * k, bk.cv.height * k);
    if (z.flash > 0) { const f = flashImg(z.sprite); if (f) { c.globalAlpha = 0.6; c.drawImage(f, -w / 2, -h, w, h); } }
    if (z.burn && z.burn > 0) { const f = shadeImg(z.sprite, '#ff7a2a'); if (f) { c.globalAlpha = 0.25 + Math.sin(this.t * 24 + z.id) * 0.1; c.drawImage(f, -w / 2, -h, w, h); } }
    c.restore();
    // only the near ones: a row of 'standing still' down the street was noise
    if (z.state === 'sleep' && Math.abs(z.x - this.px) < 420) worldLabel(c, 'standing still', x, z.y - h - 8, 'rgba(200,190,170,0.7)');
  }

  hud() {
    const c = this.c;
    c.textAlign = 'left';
    // top left: where and who (small caps), then the bars with their pictures, no words
    panel(c, 14, 12, 270, this.mate ? 120 : 106);
    caps(c, `${this.site.name}`, 22, 29, '#c9a95a');
    caps(c, `${first(this.s)}  ·  ${ZONE_NAMES[this.zoneOf(this.px)]}`, 22, 46, '#a89c84');
    const bar = (icon: string, y: number, f: number, col: string, word?: string, wordCol = '#c04030') => {
      const ic = img(icon);
      if (ic) c.drawImage(ic, 22, y - 7, 14, 14 * (ic.height / ic.width));
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(42, y - 2, 150, 5);
      c.fillStyle = col; c.fillRect(42, y - 2, 150 * Math.max(0, Math.min(1, f)), 5);
      if (word) caps(c, word, 198, y + 4, wordCol);
    };
    const dl = Math.max(0, this.daylight);
    bar('icon_st_time', 64, dl / this.dayMax, dl > 40 ? '#c9b27a' : '#b0502c', this.daylight > 0 ? undefined : 'dusk');
    const hp = Math.max(0, 1 - pain(this.s) / 1.45);
    bar('icon_st_wound', 78, hp, hp > 0.5 ? '#9db070' : '#c04030');
    bar('icon_st_tired', 92, this.stamina / 100, this.stamina < 25 ? '#b0502c' : '#8aa6c0');
    bar('icon_st_noise', 106, this.heat / 6, this.heat >= 2 ? '#c04030' : '#8a7a5a', this.heat >= 2 ? 'followed' : undefined);
    if (this.mate) {
      const mh = Math.max(0, 1 - pain(this.mate) / 1.45);
      dot(c, 26, 118, this.mateDown ? '#c04030' : mh > 0.5 ? '#9db070' : '#d0a040', 3);
      c.font = `13px ${FONT}`; c.fillStyle = '#cfc3a6'; c.fillText(first(this.mate), 36, 122);
      if (this.mateW) { c.textAlign = 'right'; c.fillText(`${this.mateMag}`, 192, 122); c.textAlign = 'left'; }
    }
    // progress along the street
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(W / 2 - 150, 24, 300, 4);
    c.fillStyle = '#d9c9a0';
    c.fillRect(W / 2 - 150 + 300 * (this.px / this.len) - 2, 20, 4, 12);
    for (const sp of this.spots) { c.fillStyle = sp.searched ? '#555' : '#c9b27a'; c.fillRect(W / 2 - 150 + 300 * (sp.x / this.len), 25, 2, 2); }
    for (const bx of this.zoneB) { c.fillStyle = '#b0502c'; c.fillRect(W / 2 - 150 + 300 * (bx / this.len) - 1, 18, 2, 14); }
    // the pack: a row of pictures with counts; the selected one boxed; words on the selected only
    const used = this.slots(), cap = this.cap();
    const packW = caps(c, `pack ${used}/${cap}`, 20, H - 50, used > cap ? '#e05040' : '#c9b27a');
    if (used > cap) caps(c, 'overloaded', 20 + packW + 10, H - 50, '#e05040');
    const iconOf = (it: PackItem) => (it.kind === 'res' ? RES_ICON[it.res] : it.kind === 'gun' ? WEAPONS[it.def].icon : it.kind === 'melee' ? MELEE[it.def].icon : MODS[it.def]?.icon) ?? '';
    let px = 20;
    const selI = this.sel % Math.max(1, this.pack.length);
    this.pack.forEach((it, i) => {
      const ic = img(iconOf(it));
      const ih = 24, iw = ic ? Math.min(56, (ic.width / ic.height) * ih) : 24;
      const on = i === selI;
      c.fillStyle = on ? 'rgba(80,66,40,0.75)' : 'rgba(10,9,8,0.55)';
      c.strokeStyle = on ? '#e0c070' : 'rgba(200,190,160,0.25)';
      c.beginPath(); c.roundRect(px, H - 44, iw + 10, 32, 3); c.fill(); c.stroke();
      if (ic) c.drawImage(ic, px + 5, H - 40, iw, iw * (ic.height / ic.width) > ih ? ih : iw * (ic.height / ic.width));
      else caps(c, itemLabel(it).slice(0, 4), px + 4, H - 24, '#cfc3a6');
      if (it.kind === 'res') { c.font = `13px ${FONT}`; c.textAlign = 'right'; c.fillStyle = '#efe2c2'; c.fillText(`${it.n}`, px + iw + 8, H - 15); c.textAlign = 'left'; }
      px += iw + 14;
    });
    if (keyHintsOn()) hintRow(c, [{ key: 'F1', label: 'keys' }], 20 + packW + (used > cap ? 110 : 14), H - 50, 'left', 0.45);
    if (this.pack.length) {
      const it = this.pack[selI];
      if (it) { c.font = `13px ${FONT}`; c.fillStyle = '#cfc3a6'; c.fillText(itemLabel(it), px + 6, H - 24); px += c.measureText(itemLabel(it)).width + 16; }
      hintRow(c, [{ key: 'run.pack', label: '' }, { key: 'run.drop', label: 'drop' }], px, H - 23, 'left', 0.6);
    }
    // the gun: icon, big mag, small reserve, ammo picture; melee as keycap + picture
    c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 3;
    if (this.w) {
      const def = WEAPONS[this.w.def];
      const p = this.prof()!;
      const left = roundsInStores(p, G.stores);
      const gi = img(def.icon);
      if (gi) { const ih = 36, iw = Math.min(120, (gi.width / gi.height) * ih); c.drawImage(gi, W - 290, H - 66, iw, (gi.height / gi.width) * iw); }
      const magX = W - 84;
      c.textAlign = 'right';
      c.font = `${Math.round(34 + this.ammoPunch * 5)}px ${FONT}`;
      c.fillStyle = this.mag ? (this.ammoPunch > 0.5 ? '#fff6dc' : '#efe2c2') : '#c04030';
      c.fillText(`${this.mag}`, magX, H - 20 - this.ammoPunch * 2);
      c.textAlign = 'left';
      c.font = `14px ${FONT}`; c.fillStyle = '#a89c84';
      c.fillText(`/${Number.isFinite(left) ? left : '∞'}`, magX + 6, H - 22);
      if (this.reload > 0) caps(c, 'reloading…', W - 20, H - 70, '#9a8e76', 'right'); // the picture is the gun: no name
      const at = p.ammoRes ? AMMO_TYPES[p.ammoRes] : undefined;
      const aw = caps(c, at?.short ?? ammoLabel(p.ammoRes), W - 20, H - 54, '#b8ab90', 'right');
      const aic = at ? img(at.icon) : undefined;
      if (aic) { const iw = (aic.width / aic.height) * 13; c.drawImage(aic, W - 24 - aw - iw, H - 64, iw, 13); }
      if (ammoTypesFor(this.w.def).length > 1 && this.mag === 0) hintRow(c, [{ key: 'run.ammo', label: 'ammo', hot: true }], W - 20, H - 92, 'right');
    }
    {
      const kx = W - 290, ky = H - 76;
      const kw = keycap(c, capOf('run.swing'), kx, ky);
      const mi = this.kn ? img(MELEE[this.kn.def].icon) : undefined;
      if (mi) { const iw = Math.min(44, (mi.width / mi.height) * 16); c.drawImage(mi, kx + kw + 5, ky - 13, iw, 16); if (this.kn!.cond < 0.35) caps(c, 'worn', kx + kw + iw + 10, ky - 1, '#c08040'); }
      else caps(c, this.kn ? MELEE[this.kn.def].name : 'fists', kx + kw + 5, ky - 1);
    }
    c.shadowBlur = 0; c.shadowColor = 'transparent';
    this.msgs.draw(c, W, 84, 16);
    if (this.keySheetHeld) keySheet(c, W, H, this.keyGroups());
    // crosshair
    if (this.w) {
      const p = this.prof()!;
      const mz = this.muzzle();
      const dist = Math.hypot(this.mouse.x - mz.x, this.mouse.y - mz.y);
      const r = Math.max(5, Math.tan((p.pellets > 1 ? p.spread : p.spread * (1.75 - aimFactor(this.s))) + this.bloom) * dist);
      c.strokeStyle = 'rgba(235,225,200,0.85)';
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(this.mouse.x, this.mouse.y, r, 0, 7); c.stroke();
      // hit marker: a kill reads bigger and warmer
      const hm = hitMarkers() ? this.hitMark : null;
      if (hm) {
        const q = (hm.kill ? 8 : 6) + ((hm.kill ? 0.24 : 0.18) - hm.t) * (hm.kill ? 30 : 20);
        c.strokeStyle = hm.kill ? (hm.head ? '#ffe6c0' : '#e8a080') : hm.head ? '#f4ecd8' : '#d8c8b0';
        c.lineWidth = hm.kill ? 3 : 1.8;
        const mx = this.mouse.x, my = this.mouse.y;
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(mx + sx * q, my + sy * q); c.lineTo(mx + sx * q / 2, my + sy * q / 2); }
        c.stroke();
      }
    }
    c.textAlign = 'left';
  }
}
