// Rigged actors for the night battle and the daylight run (docs/research/09-animation.md §7–8).
//
// Battle and Expedition keep their simulation and their Classic single-image drawing; this
// module owns one cutout bone rig (src/anim) per body and drives it from what the simulation
// does: the equipped gun, the real aim point, fireProfile reload timing (tactical / empty /
// shell by shell), melee swings, duck / downed / haul / crew poses; Turned gaits from their
// actual ground speed, attacks at the wall, the Crier's keen, the Biler's retch, the Buck's
// vault, climbing the ramp, crawling on a crippled leg, staggers and knockdowns; ragdoll
// deaths from the killing hit, baked into the ground canvas once they settle and fed to the
// corpse pile at the place they came to rest.
//
// Look: the per-lane grade (brightness, saturation, fog), variant tint and unlit shade are baked
// into atlas copies (anim/assets gradedAtlas); the ink outline and the rim light are silhouette
// passes under the body. Crowd LOD: the nearest ~40 Turned (and anything acting) draw the
// full rig; the rest are one blit from shared flipbook frames with the same look baked in.
//
// Setting: ui/settings animationSetting() 'rigged' | 'classic'. rigsOn() also honours the
// automatic fallback to Classic (parts that fail to load, or frames consistently > 25 ms for
// 3 s while the rigs carry a real share of the frame) — logged once.
import { createRig, CLIPS, SPRITE_RIGS, STYLES, gradedAtlas, silAtlas, getRig, loadRig, flipbookStats, type Clip, type Rig } from '../anim';
import type { DeathKind } from '../anim';
import { animationSetting, reduceGore } from '../ui/settings';
import { sfx, gunSoundFor, type ReloadStage } from '../audio';
import { WEAPONS, MELEE, type FireProfile } from '../data/weapons';
import { ZOMBIES } from '../data/zombies';
import { VARIANT_TINT, FOG_TINT, depthScale, type Look } from './render';
import { panOf } from './gunfx';
import type { BattleHook, SortedDraw } from './hook';
import type { Battle, Zombie, Guard } from './battle';
import { LANES, DEF_LANES, LOOK, wallX, nearestLane } from './battle';

const WARM = '#f0c98a', COOL = '#8fa6c8', DARK = '#0a0b10', BURN = '#ff7a2a';
const ZS = 1.3; // battle.ts actor scale for the Turned
const SH = 158; // survivor display height
const FULL_RIGS = 40; // Turned drawn with the full rig; the rest use the flipbook unless acting
const MIN_FULL_RIGS = 8; // the adaptive budget's floor before falling back to Classic
/** Full-rig budget: shrinks while frames run long, grows back slowly when there's headroom. */
let fullRigs = FULL_RIGS;
const MAX_RAGDOLLS = 24;

// ------------------------------------------------------------------ on / off, fallback
let fallback: string | null = null;
let loadOk = 0, loadBad = 0;
const badSprites = new Set<string>();
/** Rigged animation is on (the setting, unless we fell back to Classic). */
export function rigsOn(): boolean { return animationSetting() === 'rigged' && !fallback; }
/** Switch to Classic for the rest of the session (logged once). */
export function animFallback(reason: string) {
  if (fallback) return;
  fallback = reason;
  console.warn(`[anim] rigged animation off, using Classic: ${reason}`);
}
type Dbg = { budget?: number; upd: number; drawFull: number; drawLod: number; noFallback?: boolean; frameMs: number; rigMs: number; fullRigs: number; lodRigs: number; ragdolls: number; acc: { n: number; frame: number; rig: number; max: number } };
const dbg: Dbg = { upd: 0, drawFull: 0, drawLod: 0, frameMs: 0, rigMs: 0, fullRigs: 0, lodRigs: 0, ragdolls: 0, acc: { n: 0, frame: 0, rig: 0, max: 0 } };
/** debug handle for tests: globalThis.__anim */
(globalThis as unknown as { __anim: unknown }).__anim = {
  dbg,
  state: () => ({ setting: animationSetting(), on: rigsOn(), fallback, loadOk, loadBad, ...flipbookStats(), ...dbg }),
  reset: () => { fallback = null; fullRigs = FULL_RIGS; },
  resetAcc: () => { dbg.acc = { n: 0, frame: 0, rig: 0, max: 0 }; dbg.upd = 0; dbg.drawFull = 0; dbg.drawLod = 0; },
};
function noteLoad(sprite: string, ok: boolean) {
  if (ok) loadOk++;
  else if (!badSprites.has(sprite)) {
    badSprites.add(sprite);
    loadBad++;
    console.warn(`[anim] no part atlas for ${sprite}: it stays a Classic image`);
    if (loadBad >= 3 && loadOk === 0) animFallback('part atlases failed to load');
  }
}
/** Frame-time watch: consistently > 25 ms for 3 s while the rigs carry a real share of it. */
class FrameWatch {
  last = 0; slowFor = 0; rigAcc = 0; adapt = 0;
  tick(rigMs: number) {
    const now = performance.now();
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    dbg.frameMs = dbg.frameMs * 0.9 + dt * 0.1;
    if (dt > 0 && dt < 250) { dbg.acc.n++; dbg.acc.frame += dt; dbg.acc.rig += rigMs; dbg.acc.max = Math.max(dbg.acc.max, dt); }
    dbg.rigMs = dbg.rigMs * 0.9 + rigMs * 0.1;
    if (dt <= 0 || dt > 250) { this.slowFor = 0; return; } // a hitch or a background tab: not "consistently"
    const slow = dt > 25 && rigMs > dt * 0.25;
    // first trade full rigs for flipbook walkers (every 0.4 s of slow frames: -25%); only once the
    // budget is at its floor do slow frames count toward falling back to Classic
    this.adapt += dt;
    if (this.adapt > 400) {
      this.adapt = 0;
      if (dbg.frameMs > 22 && dbg.rigMs > dbg.frameMs * 0.2 && fullRigs > MIN_FULL_RIGS) fullRigs = Math.max(MIN_FULL_RIGS, Math.floor(fullRigs * 0.75));
      else if (dbg.frameMs < 15 && fullRigs < FULL_RIGS) fullRigs = Math.min(FULL_RIGS, fullRigs + 2);
    }
    dbg.budget = fullRigs;
    if (slow && fullRigs <= MIN_FULL_RIGS) this.slowFor += dt; else this.slowFor = 0;
    if (this.slowFor > 3000 && !dbg.noFallback) animFallback(`frames over 25 ms for 3 s with ${fullRigs} full rigs (avg ${dbg.frameMs.toFixed(1)} ms, rigs ${dbg.rigMs.toFixed(1)} ms)`);
  }
}

// ------------------------------------------------------------------ shared helpers
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** A copy of a clip without its root motion (the game already moves the body). */
function inPlace(id: string, o: Partial<Clip> = {}): Clip {
  const c = CLIPS[id];
  const num = { ...c.num };
  delete num.px; delete num.py;
  return { ...c, ...o, id: id + 'InPlace', num };
}
// poses the clip library doesn't have
const DUCK: Clip = { id: 'duck', dur: 1, loop: true, add: true, fadeIn: 0.12, fadeOut: 0.15, num: { crouch: [[0, 0.5], [1, 0.5]], lean: [[0, 0.22], [1, 0.22]], ready: [[0, 0.55], [1, 0.55]] } };
const DOWNED: Clip = {
  id: 'downed', dur: 0.6, hold: true, fadeIn: 0.25,
  num: {
    lean: [[0, -0.6], [1, -1.52, 'in']], crouch: [[0, 0.5], [1, 0.97, 'in']], px: [[0, 0], [1, -24]],
    nSh: [[0, 2.2], [1, 2.0]], fSh: [[0, 2.4], [1, 1.8]], nEl: [[0, 0.4], [1, 0.9]], head: [[0, 0.2], [1, 0.45]],
    nFx: [[0, 30], [1, 40]], fFx: [[0, 20], [1, 30]], nFy: [[0, -6], [1, -8]],
  },
  set: [[0, 'gun', 'hidden']],
};
const HAUL: Clip = {
  id: 'haul', dur: 0.8, loop: true, fadeIn: 0.2, fadeOut: 0.2,
  num: { crouch: [[0, 0.32], [0.5, 0.38], [1, 0.32]], lean: [[0, -0.18], [0.5, -0.26], [1, -0.18]], head: [[0, 0.25], [1, 0.25]] },
  n: [[0, { s: 'ground', dx: 52, dy: 26, pose: 'fist' }], [1, { s: 'ground', dx: 52, dy: 26, pose: 'fist' }]],
  f: [[0, { s: 'ground', dx: 46, dy: 30, pose: 'fist' }], [1, { s: 'ground', dx: 46, dy: 30, pose: 'fist' }]],
  set: [[0, 'gun', 'slung']],
};
const CREW: Clip = {
  id: 'crew', dur: 1, loop: true, fadeIn: 0.2, fadeOut: 0.2,
  num: { crouch: [[0, 0.18], [1, 0.18]], lean: [[0, 0.18], [1, 0.18]], head: [[0, 0.1], [1, 0.1]] },
  n: [[0, { s: 'body', p: 'chest', dx: 0, dy: 0, pose: 'fist' }], [1, { s: 'body', p: 'chest', dx: 0, dy: 0, pose: 'fist' }]],
  f: [[0, { s: 'body', p: 'chest', dx: -6, dy: 4, pose: 'fist' }], [1, { s: 'body', p: 'chest', dx: -6, dy: 4, pose: 'fist' }]],
  set: [[0, 'gun', 'slung']],
};
let extra: Record<string, Clip> | null = null;
function clips(): Record<string, Clip> {
  if (extra) return extra;
  // hands forward onto the handles of the gun nest, a little in front of the chest
  for (const k of [CREW.n!, CREW.f!]) for (const key of k) if (key[1]) key[1].dx = (key[1].dx ?? 0) + 30;
  extra = {
    duck: DUCK, downed: DOWNED, haul: HAUL, crew: CREW,
    climb: { ...inPlace('climb'), loop: true }, vault: inPlace('vault'), stagger: inPlace('stagger'), knockdown: inPlace('knockdown'),
  };
  return extra;
}
const clip = (id: string): Clip | string => clips()[id] ?? id;

// reload / action events → the per-stage foley (audio/foley reloadPlan stages)
const STAGE: Record<string, ReloadStage> = {
  magOut: 'out', magIn: 'in', rack: 'rack', slide: 'rack', shellIn: 'shell', pumpBack: 'rack', boltUp: 'bolt', boltFwd: 'bolt', roundIn: 'in',
  leverDown: 'rack', cylOut: 'out', speedIn: 'shell', cylIn: 'close', breakOpen: 'out', breakClose: 'close', nock: 'arrow', boltIn: 'arrow',
  cock: 'rack', powder: 'in', ram: 'close', tubeDrop: 'out', extend: 'close',
  tap: 'in', rackFwd: 'close', lock: 'bolt',
};
export function reloadEventSfx(defId: string, o?: { volume?: number; pan?: number; far?: boolean }): (name: string) => void {
  const kind = gunSoundFor(defId).reload;
  return (name) => { const st = STAGE[name]; if (st) sfx.reload(kind, st, 0, o); };
}
/** A guard's reload heard from the leader's place: quieter with distance, panned to where they stand. */
function guardEar(g: Guard, leader: Guard | undefined) {
  const d = leader ? Math.abs(g.x - leader.x) : 300;
  return { volume: clamp(0.5 - d / 900, 0.12, 0.45), pan: panOf(g.x), far: d > 260 };
}

/** The anim id for a weapon item def (guns by WEAPONS id, hand weapons by MELEE id). */
function weaponAnim(def: string | null | undefined): string | null {
  if (!def) return null;
  return WEAPONS[def] || MELEE[def] ? def : null;
}

// ---- looks: graded atlases per (lane look, variant, lit), ink outline, rim
interface LookSpec { look: Look; variant: number; lit: boolean; rimColor: string; rimA: number; rimDx: number; rimDy: number; shade?: boolean }
function applyLook(rig: Rig, L: LookSpec, scale: number, facing: number) {
  const a = rig.asset;
  if (!a) return;
  const [tint, ta, vb] = VARIANT_TINT[L.variant] ?? VARIANT_TINT[0];
  const shade = L.shade ?? !L.lit;
  const key = `${L.look.b}|${L.look.s}|${L.look.fog}|${L.variant}|${shade ? 1 : 0}`;
  const filter = `brightness(${(L.look.b * vb).toFixed(3)}) saturate(${L.look.s.toFixed(3)})`;
  const tints: [string, number][] = [[FOG_TINT, L.look.fog], [tint, ta]];
  if (shade) tints.push([DARK, 0.35]);
  // the ink outline lives in the atlas copy (a dilated silhouette under every part): no extra pass
  const grow = L.look.outline > 0 ? Math.min(6, Math.max(1, Math.round(L.look.outline / Math.max(0.2, scale)))) : 0;
  rig.skin = { atlas: gradedAtlas(a, key, filter, tints, false, grow), dark: gradedAtlas(a, key, filter, tints, true, grow), grow };
  // the held gun gets the same grade and ink (baked once per look and size: anim/assets bakedIcon)
  if (rig.weaponId) rig.gunLook = { key, filter, tints, ink: L.look.outline > 0 ? L.look.outline : 1 };
  rig.outline = null;
  // rim: world-space offset (the rig flips its own offsets by facing); the faint cool moon rim of
  // the far, unlit lanes is left out on full rigs (a whole extra pass for a 15% band)
  rig.rim = L.rimA > 0.3 ? { src: silAtlas(a, L.rimColor), dx: L.rimDx * facing, dy: L.rimDy, alpha: L.rimA } : null;
  rig.lookKey = `${key}|${grow}|${rig.rim ? `${L.rimColor}|${L.rimA}|${L.rimDx * facing}|${L.rimDy}` : ''}`;
}

// ------------------------------------------------------------------ battle
interface Hit { zone: 'head' | 'torso' | 'arm' | 'leg'; dx: number; dy: number; mag: number; kind: DeathKind; t: number; n: number }
interface ZR {
  rig: Rig; px: number; v: number; stun: number; down: number; wind: number; crip: boolean; state: string;
  attack: string | null; gap: number; tolled: boolean; pant: boolean; seen: number; hit?: Hit; react?: Hit; ready: boolean; flash: number;
}
interface GR { rig: Rig; weapon: string | null; px: number; v: number; aimX: number; aimY: number; reload: number; wounds: number; perRound?: { empty: boolean; finish: boolean }; swingT: number }
interface Corpse { rig: Rig; x: number; y: number; scale: number; facing: 1 | -1; lane: number; t: number; snap?: Zombie; pileM: number; id: number }

export class BattleActors implements BattleHook {
  b: Battle;
  zs = new Map<number, ZR>();
  gs = new Map<string, GR>();
  corpses: Corpse[] = [];
  dead = new Set<number>(); // zombie ids whose corpse is a ragdoll here (no Classic stamp)
  pendingPile = new Map<number, { snap: Zombie; m: number }>();
  cam: DOMMatrix | null = null;
  watch = new FrameWatch();
  rigMs = 0;
  t = 0;
  playerReloadSeq = 0;

  constructor(b: Battle) {
    this.b = b;
    // start fetching tonight's atlases during the intro
    if (rigsOn()) {
      const sprites = new Set<string>();
      for (const s of b.plan.spawns) for (const sp of ZOMBIES[s.type]?.sprites ?? []) sprites.add(sp);
      for (const sp of [...ZOMBIES.sleeper.sprites, ...ZOMBIES.deer.sprites]) sprites.add(sp);
      for (const g of b.guards) sprites.add(g.s.sprite);
      for (const sp of sprites) if (SPRITE_RIGS[sp]) loadRig(sp).then((a) => noteLoad(sp, !!a));
    }
  }

  // ---- rigs
  private zr(z: Zombie): ZR | null {
    let r = this.zs.get(z.id);
    if (r) return r;
    const sr = SPRITE_RIGS[z.sprite];
    if (!sr || badSprites.has(z.sprite)) return null;
    const style = STYLES[z.def.id] ? z.def.id : sr.style;
    const rig = createRig(sr.kind, z.sprite, { seed: z.id * 7919 + 17, style });
    if (sr.kind === 'turned') rig.autoIdle = true;
    if (sr.weapon) rig.setWeapon(sr.weapon);
    if (getRig(z.sprite) === undefined) loadRig(z.sprite).then((a) => noteLoad(z.sprite, !!a));
    r = { rig, px: z.x, v: 0, stun: 0, down: 0, wind: 0, crip: false, state: z.state, attack: null, gap: 0, tolled: false, pant: false, seen: 0, ready: false, flash: 0 };
    this.zs.set(z.id, r);
    return r;
  }
  private gr(g: Guard): GR | null {
    let r = this.gs.get(g.s.id);
    if (r) return r;
    if (!SPRITE_RIGS[g.s.sprite] || badSprites.has(g.s.sprite)) return null;
    const rig = createRig('survivor', g.s.sprite, { seed: g.homeX * 31 + 5 });
    if (getRig(g.s.sprite) === undefined) loadRig(g.s.sprite).then((a) => noteLoad(g.s.sprite, !!a));
    r = { rig, weapon: null, px: g.x, v: 0, aimX: g.x + 400, aimY: g.y - 100, reload: 0, wounds: g.s.wounds.length, swingT: 0 };
    this.gs.set(g.s.id, r);
    return r;
  }
  /** Display height of a Turned's rig (a Drag is a prone rig cut at standing-body scale). */
  zH(z: Zombie) { return (z.def.crawl ? ZOMBIES.sleeper.height : z.def.height) * z.scale * ZS; }
  private zScale(z: Zombie, rig: Rig) { return this.zH(z) / (rig.asset?.meta.height ?? 240); }

  // ---- simulation → animation (a hook: runs every step after the Turned moved)
  update(dt: number) {
    if (!rigsOn()) { if (this.corpses.length) this.onEnd(); return; } // fell back: the dead go into the road now
    if (dt <= 0) return;
    const t0 = performance.now();
    this.t += dt;
    const b = this.b;
    const live = new Set<number>();
    for (const z of b.zombies) {
      if (z.state === 'dying') continue;
      const r = this.zr(z);
      if (!r) continue;
      live.add(z.id);
      this.driveTurned(z, r, dt);
      r.rig.update(dt);
    }
    for (const id of this.zs.keys()) if (!live.has(id)) this.zs.delete(id);
    // crowd LOD: full rigs for the nearest; the rest walk from the flipbook
    const order = [...this.zs.entries()].filter(([, r]) => r.rig.kind === 'turned');
    const byId = new Map(b.zombies.map((z) => [z.id, z]));
    order.sort((p, q) => (byId.get(p[0])?.x ?? 0) - (byId.get(q[0])?.x ?? 0));
    order.forEach(([id, r], i) => {
      const z = byId.get(id);
      r.rig.lod = i >= fullRigs && !(z && z.def.boss);
      r.rig.autoIdle = !r.rig.lod; // idles and twitches only where they can be seen (they'd force the full rig)
    });
    for (const g of b.guards) {
      if (g.s.dead || g.fled) { this.gs.delete(g.s.id); continue; }
      const r = this.gr(g);
      if (!r) continue;
      this.driveSurvivor(g, r, dt);
      r.rig.update(dt);
    }
    // the dead: ragdolls until they settle, then into the ground
    for (const cp of this.corpses) { cp.t += dt; cp.rig.update(dt); }
    const done = this.corpses.filter((cp) => cp.rig.settled || cp.t > 3.2 || !cp.rig.ready);
    for (const cp of done) this.bake(cp);
    if (done.length) this.corpses = this.corpses.filter((cp) => !done.includes(cp));
    while (this.corpses.length > MAX_RAGDOLLS) { const cp = this.corpses.shift()!; this.bake(cp); }
    dbg.ragdolls = this.corpses.length;
    this.rigMs += performance.now() - t0;
    dbg.upd += performance.now() - t0;
  }

  private driveTurned(z: Zombie, r: ZR, dt: number) {
    const rig = r.rig;
    const def = z.def;
    const ready = rig.ready;
    // ground speed from the simulation (feet stay planted at any speed)
    const moved = Math.abs(z.x - r.px) / dt;
    r.px = z.x;
    const still = !!z.leap || (z.down ?? 0) > 0 || z.stun > 0 || z.state === 'climb' || z.state === 'maul' || (z.state === 'wall');
    r.v += ((still ? 0 : Math.min(moved, 400)) - r.v) * Math.min(1, dt * 10);
    rig.setSpeed(r.v);
    if (!ready) return;
    if (!r.ready) {
      r.ready = true;
      // seeded start: a crowd never begins in step
      rig.phase = ((z.id * 0.6180339) % 1);
    }
    const st = z.state;
    // ---- hit reactions (non-lethal: lethal ones go to die())
    if (r.react) {
      const h = r.react;
      r.react = undefined;
      rig.hit(h.zone, { cripple: false });
    }
    // a new hit (the sim's flash timer jumped up), not every frame of it: under steady fire a big
    // body would otherwise stay white
    if (z.flash > r.flash + 0.02) rig.flashT = Math.max(rig.flashT, 0.06);
    r.flash = z.flash;
    // ---- legs gone: buckle into a crawl (a Ferryman limps on)
    if (z.crippled && !r.crip) {
      r.crip = true;
      if (def.id === 'ferryman') rig.setGait('limpDrag');
      else if (!def.crawl) rig.hit('leg', { cripple: true });
    }
    // ---- knocked flat (Ferryman), staggered
    const down = z.down ?? 0;
    if (down > r.down + 0.2) rig.play(clip('knockdown'), { duration: Math.max(1.2, down / 0.72) });
    r.down = down;
    if (z.stun > r.stun + 0.05 && down <= 0 && !rig.isPlaying('buckle')) rig.play(clip('stagger'), { duration: clamp(z.stun * 1.8, 0.35, 0.9) });
    r.stun = z.stun;
    // ---- wind-ups synced to the simulation's timers
    const wind = z.windup ?? 0;
    if (wind > 0 && r.wind <= 0) {
      if (def.scream) rig.play('keen', { duration: Math.max(0.9, wind / 0.3) }); // the scream lands as the keen does
      else if (def.spit) rig.play('retch', { duration: Math.max(0.5, wind / 0.6) }); // 'spit' = the glob leaving
      else if (def.leap) rig.play(clip('vault'), { duration: Math.max(0.6, wind / 0.45) }); // 'leap' = take-off
    } else if (wind <= 0 && r.wind > 0 && def.scream && !z.leap) rig.stop('keen'); // choked off
    r.wind = wind;
    if (z.leap && !rig.isPlaying('vaultInPlace')) rig.play(clip('vault'), { duration: 1.4 });
    // ---- the bell: the toll lands with the sim's toll()
    if (def.toll) {
      if (z.screamT <= 1.8 && !r.tolled) { r.tolled = true; rig.play('toll', { duration: 3 }); }
      if (z.screamT > 2) r.tolled = false;
    }
    // ---- a Deer's pant-stop, then the lunge out of it
    if (def.lunge && !z.crippled && st === 'walk') {
      const pant = z.lungeT < 0;
      if (pant && !r.pant) rig.play('pantStop');
      if (!pant && r.pant) { rig.stop('pantStop'); rig.play('lunge', { duration: 0.8 }); }
      r.pant = pant;
    } else if (r.pant) { r.pant = false; rig.stop('pantStop'); }
    // ---- a raider's shot (raiderFire sets seen = 2.5)
    if (def.ranged) {
      if ((z.seen ?? 0) > r.seen + 1) { rig.fire(1.4); rig.flashMuzzle = 0; }
      r.seen = z.seen ?? 0;
      const tgt = this.b.guards.find((g) => this.b.standing(g));
      if (tgt) rig.aimAt(tgt.x, tgt.y - SH * tgt.sc * 0.6);
      const duck = st === 'cover' && !!z.ducked;
      if (duck && !has(rig, 'duck')) rig.play(clip('duck'));
      if (!duck) stopAdd(rig, 'duck');
    }
    // ---- attacks: at the barricade face, mauling over the wall, climbing the ramp
    const atFace = st === 'wall' && z.x <= wallX(z.lane) + this.b.zw(z) / 2 + 2;
    if (st === 'climb') {
      if (!rig.isPlaying('climbInPlace')) rig.play(clip('climb'), { duration: 1.4 });
    } else if (rig.isPlaying('climbInPlace')) rig.stop('climbInPlace');
    const attacking = atFace || st === 'maul';
    if (attacking && !def.ranged && down <= 0 && z.stun <= 0) {
      if (!r.attack || !rig.isPlaying(r.attack)) {
        r.gap -= dt;
        if (r.gap <= 0) {
          const pool = this.attackPool(z, rig, st === 'maul');
          const id = pool[Math.floor(Math.abs(Math.sin(z.id * 12.9898 + this.t * 3.1)) * pool.length) % pool.length];
          const ok = rig.play(id, id === 'pound' ? {} : { duration: CLIPS[id].dur * (z.disarmed ? 1.35 : 1) });
          r.attack = ok ? id : null;
          r.gap = id === 'pound' ? 0 : 0.05 + ((z.id * 37) % 7) * 0.05;
        }
      }
    } else if (r.attack) {
      if (rig.isPlaying(r.attack) && CLIPS[r.attack]?.loop) rig.stop(r.attack);
      r.attack = null;
    }
    r.state = st;
    rig.hideHead = !!z.headless;
  }

  private attackPool(z: Zombie, rig: Rig, maul: boolean): string[] {
    const s = rig.style;
    if (s.id === 'ferryman') return maul ? ['grabDrag', 'smash'] : ['smash'];
    if (s.id === 'bellwether') return ['smash'];
    if (s.id === 'deer') return maul ? ['lunge', 'claw'] : ['claw', 'pound', 'lunge'];
    if (s.id === 'drag' || s.id === 'tunneler' || rig.crawling) return ['grabBite'];
    if (maul) return s.attacks;
    // the wall: a seeded mix of pounding, clawing and grabbing at the planks
    return (z.id % 3 === 0) ? ['pound'] : ['pound', ...s.attacks];
  }

  private driveSurvivor(g: Guard, r: GR, dt: number) {
    const b = this.b, rig = r.rig;
    const isP = g === b.player;
    // the gun in their hands (a hand weapon while a swing plays)
    r.swingT = Math.max(0, r.swingT - dt);
    const want = r.swingT > 0 ? (r.weapon ?? null) : weaponAnim(g.w?.def);
    if (r.swingT <= 0 && want !== r.weapon) {
      const had = r.weapon;
      rig.setWeapon(want);
      r.weapon = want;
      // the leader changes guns: the new one comes up over the draw time (not after a melee swing)
      if (isP && had && want && WEAPONS[want] && WEAPONS[had] && rig.ready) rig.play('drawGun', { duration: clamp(b.playerCd, 0.3, 1.2) });
    }
    const moved = Math.abs(g.x - r.px) / dt;
    r.px = g.x;
    r.v += (Math.min(moved, 300) - r.v) * Math.min(1, dt * 10);
    rig.setSpeed(r.v);
    if (!rig.ready) return;
    // aim: the leader at the crosshair (with the climb), a guard at what they shoot
    let ax: number, ay: number;
    if (isP) { ax = b.mouse.x; ay = b.mouse.y - b.climbY; }
    else if (g.flash > 0 && g.flashAng !== undefined) { const m = b.muzzle(g); ax = m.x + Math.cos(g.flashAng) * 400; ay = m.y + Math.sin(g.flashAng) * 400; }
    else {
      const t = this.guardTarget(g);
      ax = t ? t.x : g.x + g.face * 500; ay = t ? t.y : g.y - SH * g.sc * 0.62;
    }
    const k = Math.min(1, dt * (isP ? 30 : 8));
    r.aimX += (ax - r.aimX) * k; r.aimY += (ay - r.aimY) * k;
    rig.aimAt(r.aimX, r.aimY);
    // poses
    const ducking = (isP && b.ducking) || g.duck > 0;
    if (ducking && !has(rig, 'duck') && !g.downed) rig.play(clip('duck'));
    else if (!ducking) stopAdd(rig, 'duck');
    if (g.downed) { if (!rig.isPlaying('downed')) rig.play(clip('downed')); }
    else if (rig.isPlaying('downed')) rig.stop('downed');
    const hauling = !!g.dragging && Math.abs(g.x - (g.dragging.x + 26)) <= 4;
    if (hauling && !rig.isPlaying('haul')) rig.play(clip('haul'));
    else if (!hauling && rig.isPlaying('haul')) rig.stop('haul');
    if (g.crew && !rig.isPlaying('crew')) rig.play(clip('crew'));
    else if (!g.crew && rig.isPlaying('crew')) rig.stop('crew');
    // guards' reloads: the clip is stretched over the simulation's reload time
    if (!isP && g.w) {
      if (g.reload > 0 && r.reload <= 0) {
        const prof = b.prof(g.w, g.s);
        const rounds = Math.max(1, prof.mag - g.mag);
        const ev = reloadEventSfx(g.w.def, guardEar(g, b.player));
        if (prof.reloadPerRound) rig.reload(Math.max(0.15, (g.reload - 0.5) / rounds), { rounds, empty: g.mag <= 0, onEvent: (n) => ev(n) });
        else rig.reload(g.reload, { empty: g.mag <= 0, onEvent: (n) => ev(n) });
      }
      r.reload = g.reload;
    }
    // the leader's shell-by-shell sequence ends: chamber one if the gun ran dry
    if (isP && r.perRound && !rig.isPlaying() && b.playerReload <= 0) {
      if (r.perRound.finish && g.w) {
        const fin = rig.anchors?.reload === 'lever' ? 'leverCycle' : rig.anchors?.reload === 'shells' ? 'pump' : null;
        if (fin) rig.play(fin, { onEvent: reloadEventSfx(g.w.def) });
      }
      r.perRound = undefined;
    }
    // mauled / shot: a flinch for every new wound
    if (g.s.wounds.length > r.wounds) rig.hit(Math.random() < 0.3 ? 'arm' : 'torso');
    r.wounds = g.s.wounds.length;
  }

  private guardTarget(g: Guard): { x: number; y: number } | null {
    let best: Zombie | undefined, bd = 1e9;
    for (const z of this.b.zombies) {
      if (z.state === 'dying') continue;
      const d = (z.x - g.x) * g.face;
      if (d < 20 || d > 900) continue;
      if (d < bd) { bd = d; best = z; }
    }
    if (!best) return null;
    const hb = this.b.hitbox(best);
    return { x: best.x, y: (hb.y1 + hb.hy) / 2 };
  }

  // ---- calls from battle.ts
  /** A hit landed (battle.damage): remembered for the death impulse and the hit reaction. */
  noteHit(z: Zombie, zone: 'head' | 'torso' | 'arm' | 'leg', knock: number, dmg: number, pellet: boolean, px: number, py: number, from: { x: number; y: number } | null, melee: boolean) {
    const r = this.zs.get(z.id);
    if (!r) return;
    let dx = from ? px - from.x : -1, dy = from ? py - from.y : 0;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const add = melee ? 40 + knock * 2.5 : 6 * knock + 1.2 * dmg;
    const h = r.hit && r.hit.t === this.t ? r.hit : undefined;
    if (h) { h.mag += add; h.n++; if (zone === 'head') h.zone = 'head'; }
    else r.hit = { zone, dx, dy, mag: (melee ? 0 : 70) + add, kind: melee ? 'melee' : pellet ? 'shotgun' : zone === 'head' ? 'headshot' : 'shot', t: this.t, n: 1 };
    r.react = r.hit;
  }
  /** A blast threw this body (battle.blast). */
  noteBlast(z: Zombie, x: number, y: number, knock: number) {
    const r = this.zs.get(z.id);
    if (!r) return;
    const dx = Math.sign(z.x - x || 1);
    r.hit = { zone: 'torso', dx: dx * 0.7, dy: -0.7, mag: 320 + knock * 3, kind: 'explosion', t: this.t, n: 1 };
  }
  /** kill(): the pile mass is added at once where the body dropped (so ramps aren't delayed by
   * the fall) and moved to where the ragdoll comes to rest when it settles (true); false: the
   * battle adds it itself. */
  deferPile(z: Zombie): boolean {
    if (!rigsOn()) return false;
    const r = this.zs.get(z.id);
    if (!r || !r.rig.ready) return false;
    this.pendingPile.set(z.id, { snap: { ...z }, m: this.b.addPile(z) });
    return true;
  }
  /** stampCorpse(): a ragdoll will bake this body into the road itself. */
  ownsCorpse(z: Zombie) { return this.dead.has(z.id); }

  onKill(z: Zombie) {
    const pend = this.pendingPile.get(z.id);
    this.pendingPile.delete(z.id);
    const r = this.zs.get(z.id);
    if (!rigsOn() || !r || !r.rig.ready) return; // the pile already has it
    this.zs.delete(z.id);
    const rig = r.rig;
    const h = r.hit && this.t - r.hit.t < 0.25 ? r.hit : undefined;
    const calm = reduceGore();
    const mag = clamp(h ? h.mag : 60, 40, 650);
    const face: 1 | -1 = z.flip ? 1 : -1;
    const imp = h ? { x: h.dx * mag, y: h.dy * mag - mag * 0.15 } : { x: -face * 40, y: -20 };
    const at = h ? (h.zone === 'head' ? 'head' : h.zone === 'leg' ? 'legN' : h.zone === 'arm' ? 'armN' : 'torso') : 'torso';
    const kind: DeathKind = h ? h.kind : 'generic';
    const nearWall = !z.flip && z.state !== 'over' && z.x - wallX(z.lane) < 160;
    const big = kind === 'shotgun' || kind === 'explosion' || mag > 380;
    rig.hideHead = !!z.headless;
    const id = z.def.id;
    rig.stop();
    rig.die({
      worldImpulse: imp, at, kind, calm, dismember: null,
      wallWorldX: nearWall ? wallX(z.lane) : undefined,
      authored: id === 'pulper' ? true : big ? false : undefined,
      authoredDur: id === 'pulper' ? 0.3 : undefined,
    });
    this.dead.add(z.id);
    this.corpses.push({ rig, x: z.x, y: z.y, scale: this.zScale(z, rig), facing: face, lane: nearestLane(z.y), t: 0, snap: pend?.snap, pileM: pend?.m ?? 0, id: z.id });
  }

  /** The leader's reload, played and voiced by the rig (null: no rig, schedule the sfx). */
  reload(g: Guard, seconds: number, o: { empty: boolean; perRound: boolean; rounds: number }): { cancel(): void } | null {
    if (!rigsOn() || !g.w) return null;
    const r = this.gs.get(g.s.id);
    if (!r || !r.rig.ready || !r.rig.anchors || r.weapon !== g.w.def) return null;
    const rig = r.rig;
    const ev = reloadEventSfx(g.w.def);
    let ok: boolean;
    if (o.perRound) {
      // one shell per call (battle calls again for the next); the pump / lever closes the sequence
      if (!r.perRound) r.perRound = { empty: o.empty, finish: o.empty };
      ok = rig.play('shellIn', { duration: seconds, onEvent: (n) => ev(n) });
    } else ok = rig.reload(seconds, { empty: o.empty, rounds: o.rounds, onEvent: (n) => ev(n) });
    if (!ok) return null;
    return { cancel: () => { rig.stop(); r.perRound = undefined; } };
  }
  /** The leader clears a stoppage (true: the rig plays it and voices it). Tap-rack for a
   * failure to feed or a short stroke; lock, strip, rack for a double-feed or a barrel swap. */
  clearJam(g: Guard, kind: string, seconds: number): boolean {
    if (!rigsOn() || !g.w) return false;
    const r = this.gs.get(g.s.id);
    if (!r || !r.rig.ready || !r.rig.anchors || r.weapon !== g.w.def) return false;
    const id = kind === 'double' || kind === 'barrel' ? 'stripFeed' : 'tapRack';
    return r.rig.play(id, { duration: Math.max(0.3, seconds), onEvent: reloadEventSfx(g.w.def) });
  }
  /** Every round (battle.roundFired): recoil spring, casing. The battle draws the flash. */
  onFire(g: Guard, prof: FireProfile, kick: number) {
    const r = this.gs.get(g.s.id);
    if (!r || !r.rig.ready) return;
    if (r.rig.isPlaying('shellIn')) { r.rig.stop(); r.perRound = undefined; }
    r.rig.fire(clamp(kick / 9, 0.4, 2.2));
    r.rig.flashMuzzle = 0;
    void prof;
  }
  /** A melee swing (night/melee.ts): the hand weapon comes out for the chop. */
  onSwing(g: Guard, wind: number, meleeDef: string | undefined) {
    const r = this.gs.get(g.s.id);
    if (!r || !r.rig.ready) return;
    const wid = meleeDef && MELEE[meleeDef] ? meleeDef : 'hatchet';
    r.rig.setWeapon(wid);
    r.weapon = wid;
    const dur = Math.max(0.25, wind / 0.52) ; // the blow lands on the clip's 'hit'
    r.swingT = dur + 0.1;
    r.rig.play(Math.random() < 0.7 ? 'chop' : 'sweep', { duration: dur });
  }
  /** The rig draws this defender (melee.ts skips its stand-in weapon bar). */
  drawsGuard(g: Guard) { return rigsOn() && !!this.gs.get(g.s.id)?.rig.ready; }
  /** The gun muzzle as the rig holds it (null: Classic). */
  muzzle(g: Guard): { x: number; y: number } | null {
    if (!rigsOn()) return null;
    const r = this.gs.get(g.s.id);
    const m = r?.rig.ready ? r.rig.muzzleWorld() : null;
    return m ? { x: m[0], y: m[1] } : null;
  }
  raiderMuzzle(z: Zombie): { x: number; y: number } | null {
    if (!rigsOn()) return null;
    const r = this.zs.get(z.id);
    const m = r?.rig.ready ? r.rig.muzzleWorld() : null;
    return m ? { x: m[0], y: m[1] } : null;
  }
  /** The skull as the rig holds it this frame (hit tests, the head ring). */
  head(z: Zombie): { x: number; y: number } | null {
    if (!rigsOn()) return null;
    const r = this.zs.get(z.id);
    if (!r || !r.rig.ready || !r.rig.hasDrawn) return null;
    const [x, y] = r.rig.headWorld();
    return { x, y };
  }
  /** Weakspot centres riding the rig's bones (neck, throat, shoulder, knees, the sac). */
  weak(z: Zombie, kind: string, i: number): { x: number; y: number } | null {
    if (!rigsOn()) return null;
    const r = this.zs.get(z.id);
    if (!r || !r.rig.ready || !r.rig.hasDrawn) return null;
    const rig = r.rig;
    const p = (a: number, b: number, k: number) => { const A = rig.pointWorld(a), B = rig.pointWorld(b); return { x: A[0] + (B[0] - A[0]) * k, y: A[1] + (B[1] - A[1]) * k }; };
    switch (kind) {
      case 'neck': return p(1, 2, 0.12);
      case 'throat': { const q = p(1, 2, 0.15); return { x: q.x + rig.df * 8 * rig.ds, y: q.y }; }
      case 'shoulder': return p(3, 1, 0.1);
      case 'knee': return i % 2 ? p(15, 15, 0) : p(11, 11, 0);
      case 'sac': { const [x, y] = rig.partWorld(0, 0.38, 26); return { x, y }; }
    }
    return null;
  }

  // ---- drawing
  /** Draw a Turned with its rig (true), or leave it to the Classic path (false). */
  drawZombie(c: CanvasRenderingContext2D, z: Zombie, env: ReturnType<Battle['lightEnv']>): boolean {
    if (!rigsOn()) return false;
    if (z.state === 'dying') return this.dead.has(z.id);
    const r = this.zs.get(z.id);
    if (!r || !r.rig.ready) return false;
    const t0 = performance.now();
    const b = this.b, rig = r.rig;
    const lane = nearestLane(z.y);
    const h = this.zH(z);
    const scale = this.zScale(z, rig);
    const facing: 1 | -1 = z.flip ? 1 : -1;
    const [L, flash] = b.lightAt(z.x, z.y - h * 0.6, env);
    const lit = flash || L > 0.22;
    const look = LOOK[lane];
    const rimA = look.rim ?? 0.5;
    const s = Math.round(depthScale(LANES[lane]) * 4) / 2;
    applyLook(rig, lit
      ? { look, variant: rig.lod ? 0 : z.variant, lit: true, rimColor: WARM, rimA: +(rimA * 0.85).toFixed(2), rimDx: -s, rimDy: 0 }
      : { look, variant: rig.lod ? 0 : z.variant, lit: false, rimColor: COOL, rimA: +(rimA * 0.6).toFixed(2), rimDx: 1.5, rimDy: -1.5 }, scale, facing);
    rig.lodScale = (z.def.crawl ? ZOMBIES.sleeper.height : z.def.height) * ZS * depthScale(LANES[lane]) / (rig.asset?.meta.height ?? 240);
    // a muzzle flash nearby or the crosshair on it: a warm edge; burning: an orange wash
    const edge = (flash ? 0.3 : 0) + (b.hover === z ? 0.35 : 0);
    if (z.burn > 0) rig.overlay = { src: silAtlas(rig.asset!, BURN), alpha: 0.35 };
    else if (edge > 0) rig.overlay = { src: silAtlas(rig.asset!, WARM), alpha: edge * 0.5 };
    else rig.overlay = null;
    // where the simulation puts the body: in the air over the wall, up the ramp, half out of the drain / behind cover
    let dy = 0;
    if (z.leap) dy = -Math.sin(Math.min(1, z.leap.t / z.leap.dur) * Math.PI) * (130 + 40 * z.scale);
    if (z.state === 'climb') dy = -b.climbLift(z);
    const sink = (z.emerge && z.emerge > 0 ? h * Math.min(1, z.emerge / 0.9) : 0);
    const fog = b.fogAlpha(z);
    const clip = sink > 0 || z.emerge !== undefined;
    if (clip) {
      c.save();
      c.beginPath();
      c.rect(z.x - h * 2, z.y - h * 3, h * 4, h * 3 + 2);
      c.clip();
    }
    const a0 = c.globalAlpha;
    c.globalAlpha = a0 * fog;
    rig.draw(c, z.x, z.y + dy + sink, scale, facing, undefined, this.cam);
    rig.hasDrawn = true;
    c.globalAlpha = a0;
    // the Buck's eyes catch the light as it coils
    if (z.def.leap && (z.windup ?? 0) > 0) {
      const [ex, ey] = rig.headWorld();
      const al = 0.45 + 0.55 * (1 - (z.windup ?? 0) / 0.8);
      c.globalCompositeOperation = 'lighter';
      const gr = c.createRadialGradient(ex, ey, 0, ex, ey, 16 * z.scale);
      gr.addColorStop(0, `rgba(255,200,90,${al})`);
      gr.addColorStop(1, 'rgba(255,160,40,0)');
      c.fillStyle = gr;
      c.fillRect(ex - 18, ey - 18, 36, 36);
      c.globalCompositeOperation = 'source-over';
    }
    if (clip) c.restore();
    const dt = performance.now() - t0;
    this.rigMs += dt;
    if (rig.lod && rig.actions.length === 0 && !rig.overlay) { dbg.lodRigs++; dbg.drawLod += dt; } else { dbg.fullRigs++; dbg.drawFull += dt; }
    return true;
  }

  /** Draw a defender with their rig (true), or leave it to the Classic path. */
  drawGuard(c: CanvasRenderingContext2D, g: Guard): boolean {
    if (!rigsOn()) return false;
    const r = this.gs.get(g.s.id);
    if (!r || !r.rig.ready) return false;
    const t0 = performance.now();
    const rig = r.rig;
    const look = LOOK[g.y >= DEF_LANES[1] ? 3 : 2];
    const scale = (SH * g.sc) / 240;
    applyLook(rig, { look, variant: 0, lit: true, shade: false, rimColor: WARM, rimA: +((look.rim ?? 0.5) * 0.8).toFixed(2), rimDx: g.x > 120 ? -2 : 2, rimDy: 0 }, scale, g.face);
    rig.overlay = null;
    rig.draw(c, g.x, g.y, scale, g.face, undefined, this.cam);
    rig.hasDrawn = true;
    this.rigMs += performance.now() - t0;
    return true;
  }

  /** Ragdolls in flight, sorted among the actors; the frame-time watch. */
  sorted(c: CanvasRenderingContext2D): SortedDraw[] {
    this.cam = c.getTransform();
    this.watch.tick(this.rigMs);
    this.rigMs = 0;
    dbg.fullRigs = 0; dbg.lodRigs = 0;
    if (!rigsOn()) return [];
    return this.corpses.map((cp) => ({ y: cp.y + 0.2, f: () => {
      const t0 = performance.now();
      const look = LOOK[cp.lane];
      applyLook(cp.rig, { look, variant: 0, lit: false, shade: false, rimColor: COOL, rimA: 0, rimDx: 0, rimDy: 0 }, cp.scale, cp.facing);
      cp.rig.overlay = null;
      cp.rig.draw(c, cp.x, cp.y, cp.scale, cp.facing, undefined, this.cam);
      this.rigMs += performance.now() - t0;
    } }));
  }

  private bake(cp: Corpse) {
    const rig = cp.rig;
    if (!rig.ready) return;
    const [sx] = rig.pointWorld(0);
    const look = LOOK[cp.lane];
    applyLook(rig, { look, variant: 0, lit: false, shade: true, rimColor: COOL, rimA: 0, rimDx: 0, rimDy: 0 }, cp.scale, cp.facing);
    rig.outline = null; rig.rim = null; rig.overlay = null;
    const g = this.b.gctx;
    const a = g.globalAlpha;
    g.globalAlpha = 0.92;
    rig.bakeCorpse(g, cp.x, cp.y, cp.scale, cp.facing);
    g.globalAlpha = a;
    // the corpse pile: the body was counted where it dropped; move it to where it came to rest
    if (cp.snap) {
      const m = this.b.pileMass({ ...cp.snap, x: sx });
      if (m !== cp.pileM) this.b.piles[cp.snap.lane] = Math.max(0, this.b.piles[cp.snap.lane] + m - cp.pileM);
    }
  }

  /** Bake every ragdoll still in flight (the night is over). */
  onEnd() { for (const cp of this.corpses) this.bake(cp); this.corpses = []; }
}

/** Any clip (additive ones too) by id, still running. */
function has(rig: Rig, id: string) { return rig.actions.some((a) => a.clip.id === id && !a.ended); }
/** Stop an additive (or any) clip by id. */
function stopAdd(rig: Rig, id: string) { if (has(rig, id)) rig.stop(id); }




// ------------------------------------------------------------------ daylight run (expedition.ts)
/** The run's view of a Turned (expedition.ts EZ). Coordinates: world x, screen y. */
export interface RunZed { id: number; def: { id: string; height: number; crawl?: boolean; lunge?: boolean }; sprite: string; x: number; y: number; state: string; dir: number; sc: number; lane: number; variant: number; flash: number; headless?: boolean; stun?: number; burn?: number; lungeT: number }
interface RunBody { rig: Rig; px: number; v: number; weapon: string | null; swingT: number; reload: number; mag: number; wounds: number }
interface RunCorpse { rig: Rig; x: number; y: number; scale: number; facing: 1 | -1; t: number; img?: HTMLCanvasElement; ox?: number; oy?: number }
const MAX_RUN_DEAD = 60; // baked bodies kept along the road
type RunZR = ZR & { lastState: string };
const W_RUN = 1280;

export class RunActors {
  bodies = new Map<string, RunBody>(); // 'p' leader, 'm' companion, 'f' the one found
  zs = new Map<number, RunZR>();
  corpses: RunCorpse[] = [];
  dead = new Set<number>();
  watch = new FrameWatch();
  rigMs = 0;

  body(key: string, sprite: string, seed: number): RunBody | null {
    if (!rigsOn()) return null;
    let b = this.bodies.get(key);
    if (b && b.rig.spriteId === sprite) return b;
    if (!SPRITE_RIGS[sprite] || badSprites.has(sprite)) return null;
    const rig = createRig('survivor', sprite, { seed });
    if (getRig(sprite) === undefined) loadRig(sprite).then((a) => noteLoad(sprite, !!a));
    b = { rig, px: 0, v: 0, weapon: null, swingT: 0, reload: 0, mag: 0, wounds: 0 };
    this.bodies.set(key, b);
    return b;
  }
  private zr(z: RunZed): RunZR | null {
    let r = this.zs.get(z.id);
    if (r) return r;
    const sr = SPRITE_RIGS[z.sprite];
    if (!sr || badSprites.has(z.sprite) || sr.kind !== 'turned') return null;
    const rig = createRig('turned', z.sprite, { seed: z.id * 7919 + 3, style: STYLES[z.def.id] ? z.def.id : sr.style });
    rig.autoIdle = true;
    if (getRig(z.sprite) === undefined) loadRig(z.sprite).then((a) => noteLoad(z.sprite, !!a));
    r = { rig, px: z.x, v: 0, stun: 0, down: 0, wind: 0, crip: false, state: z.state, attack: null, gap: 0, tolled: false, pant: false, seen: 0, ready: false, flash: 0, lastState: '' };
    this.zs.set(z.id, r);
    return r;
  }
  zH(z: RunZed) { return (z.def.crawl ? ZOMBIES.sleeper.height : z.def.height) * ZS * z.sc; }

  /**
   * One survivor's frame: weapon (a hand weapon while swinging), ground speed, aim, poses
   * (rummage while searching, down / dragged), reloads (rising edge of `reload`), shots
   * (a falling `mag`), a flinch per new wound.
   */
  driveBody(b: RunBody, dt: number, o: { x: number; weapon: string | null; aimX: number; aimY: number; searching: boolean; down: boolean; reload: number; reloadOf?: () => { seconds: number; rounds: number; perRound: boolean; empty: boolean } | null; mag: number; wounds: number }) {
    const rig = b.rig;
    b.swingT = Math.max(0, b.swingT - dt);
    if (b.swingT <= 0 && o.weapon !== b.weapon) { rig.setWeapon(o.weapon); b.weapon = o.weapon; }
    const moved = Math.abs(o.x - b.px) / dt;
    b.px = o.x;
    b.v += (Math.min(moved, 300) - b.v) * Math.min(1, dt * 10);
    rig.setSpeed(b.v);
    if (!rig.ready) { rig.update(dt); return; }
    rig.aimAt(o.aimX, o.aimY);
    if (o.searching && !rig.isPlaying('rummage')) rig.play('rummage');
    else if (!o.searching && rig.isPlaying('rummage')) rig.stop('rummage');
    if (o.down) { if (!rig.isPlaying('downed')) rig.play(clip('downed')); }
    else if (rig.isPlaying('downed')) rig.stop('downed');
    if (o.reload > 0 && b.reload <= 0 && o.weapon && o.reloadOf) {
      const r = o.reloadOf();
      if (r) {
        if (r.perRound) rig.play('shellIn', { duration: r.seconds, repeat: r.rounds });
        else rig.reload(r.seconds, { empty: r.empty, rounds: r.rounds });
      }
    }
    b.reload = o.reload;
    if (o.mag < b.mag && b.swingT <= 0) { rig.fire(1); rig.flashMuzzle = 0; }
    b.mag = o.mag;
    if (o.wounds > b.wounds) rig.hit('torso');
    b.wounds = o.wounds;
    rig.update(dt);
  }
  swing(key: string, wind: number, meleeDef: string | undefined) {
    const b = this.bodies.get(key);
    if (!b || !b.rig.ready) return;
    const wid = meleeDef && MELEE[meleeDef] ? meleeDef : 'hatchet';
    b.rig.setWeapon(wid);
    b.weapon = wid;
    const dur = Math.max(0.25, wind / 0.52);
    b.swingT = dur + 0.1;
    b.rig.play(Math.random() < 0.7 ? 'chop' : 'sweep', { duration: dur });
  }
  /** The leader's reload, voiced by the rig's events (null: no rig: schedule the sfx). */
  reload(key: string, weapon: string, seconds: number, o: { empty: boolean; perRound: boolean; rounds: number }): { cancel(): void } | null {
    if (!rigsOn()) return null;
    const b = this.bodies.get(key);
    if (!b || !b.rig.ready || b.weapon !== weapon || !b.rig.anchors) return null;
    const ev = reloadEventSfx(weapon);
    const ok = o.perRound ? b.rig.play('shellIn', { duration: seconds, onEvent: (n) => ev(n) }) : b.rig.reload(seconds, { empty: o.empty, rounds: o.rounds, onEvent: (n) => ev(n) });
    if (!ok) return null;
    b.reload = seconds; // the rising edge is handled here, not in driveBody
    return { cancel: () => b.rig.stop() };
  }

  /** The leader clears a jam on the run: a tap-rack, voiced by the rig (false: Classic). */
  clearJam(key: string, weapon: string, seconds: number): boolean {
    if (!rigsOn()) return false;
    const b = this.bodies.get(key);
    if (!b || !b.rig.ready || b.weapon !== weapon || !b.rig.anchors) return false;
    return b.rig.play('tapRack', { duration: Math.max(0.3, seconds), onEvent: reloadEventSfx(weapon) });
  }

  driveZed(z: RunZed, dt: number) {
    if (!rigsOn()) return;
    const r = this.zr(z);
    if (!r) return;
    const rig = r.rig;
    const moved = Math.abs(z.x - r.px) / dt;
    r.px = z.x;
    const still = z.state !== 'walk' || (z.stun ?? 0) > 0;
    r.v += ((still ? 0 : Math.min(moved, 400)) - r.v) * Math.min(1, dt * 10);
    rig.setSpeed(r.v);
    if (rig.ready) {
      if (!r.ready) { r.ready = true; rig.phase = (z.id * 0.6180339) % 1; }
      if (z.flash > r.flash + 0.02) rig.flashT = Math.max(rig.flashT, 0.06);
      r.flash = z.flash;
      if ((z.stun ?? 0) > r.stun + 0.05) rig.play(clip('stagger'), { duration: 0.6 });
      r.stun = z.stun ?? 0;
      if (z.state === 'grab') { if (!rig.isPlaying('grabBite')) rig.play('grabBite'); }
      else if (rig.isPlaying('grabBite')) rig.stop('grabBite');
      if (z.def.lunge && z.state === 'walk') {
        const pant = z.lungeT < 0;
        if (pant && !r.pant) rig.play('pantStop');
        if (!pant && r.pant) { rig.stop('pantStop'); rig.play('lunge', { duration: 0.8 }); }
        r.pant = pant;
      }
      rig.autoIdle = z.state !== 'grab';
      rig.hideHead = !!z.headless;
    }
    r.lastState = z.state;
    rig.update(dt);
  }

  /** After the Turned moved: drop rigs of the gone, step the dead, bake the settled into the road. */
  update(dt: number, alive: Set<number>, looks?: Look[], laneOf?: (y: number) => number) {
    for (const id of this.zs.keys()) if (!alive.has(id)) this.zs.delete(id);
    let live = 0;
    for (const cp of this.corpses) {
      if (cp.img) continue;
      cp.t += dt;
      cp.rig.update(dt);
      // like the battle: once it settles (or 3.2 s) it becomes one darkened image in the road
      if ((cp.rig.settled || cp.t > 3.2 || !cp.rig.ready) && looks && laneOf) this.bakeRun(cp, looks[laneOf(cp.y)]);
      else live++;
    }
    // the oldest ragdoll still in flight is baked early; the oldest baked bodies go first
    if (live > MAX_RAGDOLLS && looks && laneOf) { const cp = this.corpses.find((c) => !c.img); if (cp) this.bakeRun(cp, looks[laneOf(cp.y)]); }
    while (this.corpses.length > MAX_RUN_DEAD) this.corpses.shift();
  }
  private bakeRun(cp: RunCorpse, look: Look) {
    const rig = cp.rig;
    const R = Math.ceil(cp.scale * 300), up = Math.ceil(cp.scale * 140) + 12, down = 12;
    const cv = document.createElement('canvas');
    cv.width = R * 2; cv.height = up + down;
    const g = cv.getContext('2d');
    if (!g || !rig.ready) { cp.img = cv; cp.ox = R; cp.oy = up; return; }
    applyLook(rig, { look: { ...look, b: 0.6, s: 0.6 }, variant: 0, lit: false, shade: true, rimColor: COOL, rimA: 0, rimDx: 0, rimDy: 0 }, cp.scale, cp.facing);
    rig.outline = null; rig.rim = null; rig.overlay = null;
    g.globalAlpha = 0.92;
    rig.bakeCorpse(g, R, up, cp.scale, cp.facing);
    cp.img = cv; cp.ox = R; cp.oy = up;
  }

  onKill(z: RunZed, from: { x: number; y: number } | null, melee: boolean) {
    const r = this.zs.get(z.id);
    if (!rigsOn() || !r || !r.rig.ready) return;
    this.zs.delete(z.id);
    const rig = r.rig;
    const dx = from ? Math.sign(z.x - from.x) || 1 : -z.dir || 1;
    const mag = melee ? 90 : 220;
    rig.stop();
    rig.die({ worldImpulse: { x: dx * mag, y: -mag * 0.25 }, at: 'torso', kind: melee ? 'melee' : 'shot', calm: reduceGore(), authored: z.def.id === 'pulper' ? true : undefined, authoredDur: z.def.id === 'pulper' ? 0.3 : undefined });
    this.dead.add(z.id);
    this.corpses.push({ rig, x: z.x, y: z.y, scale: this.zH(z) / (rig.asset?.meta.height ?? 240), facing: z.dir >= 0 ? 1 : -1, t: 0 });
  }

  /** Draw a survivor rig at screen x (true), or leave it to the Classic image. */
  drawBody(c: CanvasRenderingContext2D, key: string, x: number, y: number, h: number, facing: 1 | -1, look: Look): boolean {
    if (!rigsOn()) return false;
    const b = this.bodies.get(key);
    if (!b || !b.rig.ready) return false;
    const t0 = performance.now();
    const scale = h / 240;
    applyLook(b.rig, { look, variant: 0, lit: true, shade: false, rimColor: WARM, rimA: 0, rimDx: 0, rimDy: 0 }, scale, facing);
    b.rig.overlay = null;
    b.rig.draw(c, x, y, scale, facing, undefined, c.getTransform());
    b.rig.hasDrawn = true;
    this.rigMs += performance.now() - t0;
    return true;
  }
  drawZed(c: CanvasRenderingContext2D, z: RunZed, cam: number, look: Look, kin: boolean): boolean {
    if (!rigsOn()) return false;
    if (z.state === 'dying') return this.dead.has(z.id);
    const r = this.zs.get(z.id);
    if (!r || !r.rig.ready) return false;
    const t0 = performance.now();
    const rig = r.rig;
    const scale = this.zH(z) / (rig.asset?.meta.height ?? 240);
    const facing: 1 | -1 = z.dir >= 0 ? 1 : -1;
    applyLook(rig, { look: kin ? { ...look, b: look.b * 0.8, s: look.s * 0.4 } : look, variant: z.variant, lit: true, shade: false, rimColor: WARM, rimA: 0, rimDx: 0, rimDy: 0 }, scale, facing);
    rig.overlay = z.burn && z.burn > 0 ? { src: silAtlas(rig.asset!, BURN), alpha: 0.3 } : null;
    rig.draw(c, z.x - cam, z.y, scale, facing, undefined, c.getTransform());
    rig.hasDrawn = true;
    this.rigMs += performance.now() - t0;
    return true;
  }
  /** The dead in the road, to sort among the actors. Also ticks the frame-time watch. */
  drawCorpses(c: CanvasRenderingContext2D, cam: number, looks: Look[], laneOf: (y: number) => number): { y: number; f: () => void }[] {
    this.watch.tick(this.rigMs);
    this.rigMs = 0;
    if (!rigsOn()) return [];
    return this.corpses.filter((cp) => cp.x - cam > -300 && cp.x - cam < W_RUN + 300).map((cp) => cp.img ? { y: cp.y - 40, f: () => {
      c.drawImage(cp.img!, Math.round(cp.x - cam - cp.ox!), Math.round(cp.y - cp.oy!));
    } } : { y: cp.y - 0.3, f: () => {
      applyLook(cp.rig, { look: { ...looks[laneOf(cp.y)], b: 0.6, s: 0.6 }, variant: 0, lit: false, shade: false, rimColor: COOL, rimA: 0, rimDx: 0, rimDy: 0 }, cp.scale, cp.facing);
      cp.rig.overlay = null;
      cp.rig.draw(c, cp.x - cam, cp.y, cp.scale, cp.facing, undefined, c.getTransform());
    } });
  }
  /** Where the rig holds the muzzle (screen space), null for Classic. */
  muzzle(key: string): { x: number; y: number } | null {
    if (!rigsOn()) return null;
    const b = this.bodies.get(key);
    const m = b?.rig.ready && b.rig.hasDrawn ? b.rig.muzzleWorld() : null;
    return m ? { x: m[0], y: m[1] } : null;
  }
}
