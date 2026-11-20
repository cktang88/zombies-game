import type { GameState, ChronicleEntry, Res, WeaponItem } from './types';
import { Rng } from './rng';
import { RECIPES } from './data/world';
import { MELEE, MELEE_FOLD, MODS, MOD_FOLD, RARES } from './data/weapons';
import { TRAPS, TRAP_FOLD } from './data/traps';
import { ZOMBIES } from './data/zombies';

const KEY = 'vessey-save-v1';

export let G: GameState;
export let R: Rng;

export function setState(s: GameState) {
  G = s;
  R = new Rng(s.seed + s.day * 7919 + s.uid);
  (globalThis as unknown as { __G: GameState }).__G = s; // debug handle
}

export function uid(prefix = 'x') {
  G.uid++;
  return `${prefix}${G.uid}`;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(G));
  } catch {
    /* storage may be unavailable */
  }
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return migrateSave(s);
  } catch {
    return null;
  }
}

/**
 * Version 2: nine materials became four (food, salvage, fuel, medicine) and nineteen kinds of ammunition
 * became three pools; see docs/research/19-simplify-resources.md. Loading folds any old store key into
 * its new one, so a save from any step of that change comes up clean.
 */
export const SAVE_VERSION = 2;
/** Old store key -> [new key, units of the new per unit of the old]. */
export const STORE_FOLD: Record<string, [Res, number]> = {
  // one salvage pile (parts were rarer, so they count double); a bottle of liquor back to the food it was
  scrap: ['salvage', 1], wood: ['salvage', 1], cloth: ['salvage', 1], parts: ['salvage', 2], liquor: ['food', 1.5],
  // special loads fold into their pool; .22 and 5.56 at the half-round a shot those guns now draw
  light: ['pistol', 1], light_hp: ['pistol', 1], r22: ['pistol', 0.5],
  shell_slug: ['shell', 1], shell_flech: ['shell', 1], shell_fire: ['shell', 1], flare: ['shell', 1],
  rifle_sp: ['rifle', 1], rifle_ap: ['rifle', 1], r556: ['rifle', 0.5], ball: ['rifle', 1],
  // bows draw on no store now (arrows are walked back in at dawn): old broadheads go back to the salvage pile
  bolt: ['salvage', 0.4], bolt_fire: ['salvage', 0.4],
  // firebombs, pipe bombs, rockets and 40mm: one count of explosives (a rocket tube fires two)
  molotov: ['explosive', 1], pipebomb: ['explosive', 1], g40: ['explosive', 1], g40_buck: ['explosive', 1], rocket: ['explosive', 2],
};
/** Old recipe ids still sitting in a craft queue -> the recipe that replaced them. */
const RECIPE_FOLD: Record<string, string> = {
  liquor: 'drink', ammo_light_hp: 'ammo_light', ammo_r22: 'ammo_light',
  ammo_slug: 'ammo_shell', ammo_flech: 'ammo_shell', ammo_dragon: 'ammo_shell', ammo_flare: 'ammo_shell',
  ammo_rifle_sp: 'ammo_rifle', ammo_rifle_ap: 'ammo_rifle', ammo_r556: 'ammo_rifle', ammo_ball: 'ammo_rifle',
  ammo_pipebomb: 'molotov',
  // hand weapons folded by role (docs/research/19c-simplify-items.md)
  m_nailbat: 'm_bat', m_spear: 'm_hatchet', m_sawblade: 'm_hatchet',
  mod_taped: 'mod_extmag', mod_speedloader: 'mod_extmag', mod_brake: 'mod_sling', mod_bipod: 'mod_sling',
  mod_choke: 'mod_flashlight', mod_sawedoff: 'mod_flashlight', mod_hatchet: 'mod_flashlight',
};
// trap kits folded by job: a queued kit makes the kit it became
for (const [from, to] of Object.entries(TRAP_FOLD)) RECIPE_FOLD[`trap_${from}`] = `trap_${to}`;

/** Bring an older save up to SAVE_VERSION in place, or null when it cannot be read. */
export function migrateSave(s: GameState | null): GameState | null {
  if (!s || typeof s !== 'object' || !s.stores || (s.version !== 1 && s.version !== SAVE_VERSION)) return null;
  const st = s.stores as unknown as Record<string, number>;
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, v) : 0);
  for (const [k, [to, per]] of Object.entries(STORE_FOLD)) {
    if (!(k in st)) continue;
    st[to] = Math.round((num(st[to]) + num(st[k]) * per) * 10) / 10;
    delete st[k];
  }
  for (const k of Object.keys(STORE_FOLD)) delete st[k];
  for (const k of STORE_KEYS) st[k] = num(st[k]);
  for (const k of Object.keys(st)) if (!(STORE_KEYS as string[]).includes(k)) delete st[k];
  // the load choice is gone: each gun draws from its own pool
  for (const w of s.weapons ?? []) delete (w as { ammoType?: unknown }).ammoType;
  // a rare variant must name one that exists, for this gun
  for (const w of s.weapons ?? []) if (w.rare && RARES[w.rare]?.base !== w.def) delete w.rare;
  // the Compendium remembers what the house has owned: an older save starts it from the rack
  // (and the Turned that could have come up the road on the nights already held)
  s.codex ??= { guns: [...new Set((s.weapons ?? []).map((w) => w.def))], rares: [], z: Object.values(ZOMBIES).filter((z) => !z.special && z.minDay < (s.day ?? 1)).map((z) => z.id), seen: 0 };
  // an open event card may name old keys (Peltier's trades, costs and gains on the chips)
  const fold = (k: unknown) => (typeof k === 'string' && STORE_FOLD[k] ? STORE_FOLD[k][0] : k);
  const foldRec = (o?: Partial<Record<Res, number>>) => {
    if (!o) return o;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) out[fold(k) as string] = (out[fold(k) as string] ?? 0) + (v ?? 0);
    return out as Partial<Record<Res, number>>;
  };
  const ev = s.pendingEvent;
  if (ev) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    if (d.wants) d.wants = fold(d.wants);
    const o = d.offers as { r?: string } | undefined, sp = d.special as { kind?: string; id?: string } | undefined;
    if (o?.r) o.r = fold(o.r) as string;
    if (sp?.kind === 'ammo' && sp.id) sp.id = fold(sp.id) as string;
    if (sp?.kind === 'mod' && sp.id) sp.id = MOD_FOLD[sp.id] ?? sp.id;
    for (const c of ev.choices ?? []) if (c.fx) { c.fx.cost = foldRec(c.fx.cost); c.fx.gain = foldRec(c.fx.gain); }
  }
  // thirteen hand weapons became five: each keeps its condition and kills under the role it was folded into
  if (s.melee) {
    for (const k of s.melee) k.def = MELEE_FOLD[k.def] ?? k.def;
    s.melee = s.melee.filter((k) => MELEE[k.def]);
    const kept = new Set(s.melee.map((k) => k.uid));
    for (const p of s.survivors ?? []) if (p.melee && !kept.has(p.melee)) p.melee = null;
  }
  // fourteen attachments became six: spares change name; a fitted one that no longer fits (or whose slot
  // is gone, or taken by another folded into the same slot) goes back on the bench
  if (s.modStock) {
    for (const m of s.modStock) m.def = MOD_FOLD[m.def] ?? m.def;
    s.modStock = s.modStock.filter((m) => MODS[m.def]);
  }
  for (const w of s.weapons ?? []) {
    if (!w.mods) continue;
    const old = Object.values(w.mods);
    w.mods = {};
    for (const m of old) {
      if (!m) continue;
      m.def = MOD_FOLD[m.def] ?? m.def;
      const md = MODS[m.def];
      if (!md) continue;
      if (md.fits(w.def) && !w.mods[md.slot]) w.mods[md.slot] = m;
      else (s.modStock ??= []).push(m);
    }
  }
  // seventeen trap kits became six: kits on hand are summed into the one each became; tonight's and
  // last night's plans keep their spots with the new kit
  if (s.trapStock) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.trapStock)) { const to = TRAP_FOLD[k] ?? k; if (TRAPS[to]) out[to] = (out[to] ?? 0) + num(v); }
    s.trapStock = out;
  }
  const foldPlan = <T extends { trap: string }>(ps: T[]) => ps.map((p) => ({ ...p, trap: TRAP_FOLD[p.trap] ?? p.trap })).filter((p) => TRAPS[p.trap]);
  if (s.deploy) s.deploy = foldPlan(s.deploy);
  if (typeof s.flags?.lastPlan === 'string') {
    try { s.flags.lastPlan = JSON.stringify(foldPlan(JSON.parse(s.flags.lastPlan))); } catch { delete s.flags.lastPlan; }
  }
  s.craftQueue = (s.craftQueue ?? []).map((q) => ({ ...q, recipe: RECIPE_FOLD[q.recipe] ?? q.recipe })).filter((q) => RECIPES.some((r) => r.id === q.recipe));
  s.version = SAVE_VERSION;
  return s;
}
/** Every stores key, in header order. */
export const STORE_KEYS: Res[] = ['food', 'salvage', 'fuel', 'meds', 'pistol', 'shell', 'rifle', 'explosive'];

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function log(kind: ChronicleEntry['kind'], text: string) {
  G.chronicle.push({ day: G.day, kind, text });
}

export function add(res: Res, n: number) {
  G.stores[res] = Math.max(0, Math.round(((G.stores[res] ?? 0) + n) * 10) / 10); // ?? 0: saves from before the new ammo keys
}

export function has(cost: Partial<Record<Res, number>>) {
  return Object.entries(cost).every(([k, v]) => G.stores[k as Res] >= (v ?? 0));
}

export function pay(cost: Partial<Record<Res, number>>) {
  for (const [k, v] of Object.entries(cost)) add(k as Res, -(v ?? 0));
}

export function newWeapon(def: string, cond = 1): WeaponItem {
  const w: WeaponItem = { uid: uid('w'), def, cond, kills: 0 };
  G.weapons.push(w);
  return w;
}

// Calendar: day 1 = Nov 6. The river freezes on Nov 28 (day 23).
export const START_DATE = 6;
export const ICE_DAY = 23;
export function dateLabel(day = G.day) {
  const d = START_DATE + day - 1;
  if (d <= 30) return `Nov ${d}`;
  return `Dec ${d - 30}`;
}
export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------- lore documents & faction standing ----------
import { DOCS, type Doc } from './data/lore';
export function docsFound(): string[] {
  try { return JSON.parse((G.flags.docs as string) ?? '[]'); } catch { return []; }
}
export function findDoc(): Doc | null {
  const have = docsFound();
  const left = DOCS.filter((d) => !have.includes(d.id));
  if (!left.length) return null;
  const d = R.pick(left);
  have.push(d.id);
  G.flags.docs = JSON.stringify(have);
  log('lore', `Found: ${d.title}.`);
  return d;
}
export function rep(f: string) {
  return (G.flags[`rep_${f}`] as number) ?? 0;
}
export function addRep(f: string, d: number) {
  G.flags[`rep_${f}`] = Math.max(-100, Math.min(100, rep(f) + d));
}
