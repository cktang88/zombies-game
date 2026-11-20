import type { Res, WeaponItem } from '../types';
import { G, has, dateLabel } from '../state';
import { WEAPONS, RARES, raresOf, MELEE, MODS } from '../data/weapons';
import { SITES, BUILDINGS, RECIPES, type Recipe } from '../data/world';
import { TRAPS } from '../data/traps';
import { ZOMBIES } from '../data/zombies';
import { buildingLevel } from './day';
import { landingStock, merchantOn, merchantNext, MERCHANT_GUNS, LANDING_GUNS, MERCHANT_NAME, rareMinDay, type Offer } from './landing';

/* =====================================================================================
 * THE GUN CATALOGUE — one data function for the gun rack (ui/day.ts armoryHtml), the workshop's
 * Weapons list and the Compendium (ui/compendium.ts), so all three say the same thing about every gun:
 * do we have it, who carries it, and exactly how to get one (make it, buy it, find it).
 * ===================================================================================== */

/** The six kinds on the rack, each led by the gun you can make (cheapest first), then finds and purchases. */
export const GUN_GROUPS: { id: string; name: string; guns: string[] }[] = [
  { id: 'hand', name: 'Handguns', guns: ['service9', 'flaregun', 'revolver', 'm1911', 'mp93'] },
  { id: 'shot', name: 'Shotguns', guns: ['pipe', 'pump', 'coach', 'snake410', 'autoshot'] },
  { id: 'rifle', name: 'Rifles', guns: ['hunting', 'muzzle', 'r22', 'lever', 'scoped'] },
  { id: 'auto', name: 'Automatics', guns: ['smg', 'ar15', 'carbine', 'lmg'] },
  { id: 'bow', name: 'Bows', guns: ['crossbow', 'compound'] },
  { id: 'heavy', name: 'Heavy', guns: ['pipemortar', 'nailer', 'rivet', 'm79', 'law'] },
];

export const placeName = (needs: string, level = 1) => `${BUILDINGS[needs]?.name ?? needs}${level > 1 ? ` Lv${level}` : ''}`;
const costLine = (c: Partial<Record<Res, number>>) => Object.entries(c).map(([k, v]) => `${v} ${k === 'meds' ? 'medicine' : k}`).join(' + ');

export interface Craft { recipe: Recipe; where: string; unlocked: boolean; afford: boolean }
export interface GunEntry {
  key: string; def: string; rare?: string;
  name: string; icon: string; line: string;
  /** the guns of this model in the house now, and whether one was ever owned */
  have: WeaponItem[]; ever: boolean;
  craft?: Craft;
  /** on a shelf at the landing today */
  store?: Offer; merchant?: Offer;
  /** could Peltier / the merchant ever stock it */
  storeEver: boolean; merchantEver: boolean;
  sites: string[];
  /** every way of getting one, in plain words, most direct first */
  how: string[];
}
export interface GunGroup { id: string; name: string; entries: GunEntry[]; owned: number; total: number }
export interface Catalogue { groups: GunGroup[]; owned: number; total: number; rareOwned: number; rareTotal: number }

export function ensureCodex() {
  G.codex ??= { guns: [], rares: [], z: [], seen: 0 };
  for (const w of G.weapons) {
    if (!G.codex.guns.includes(w.def)) G.codex.guns.push(w.def);
    if (w.rare && !G.codex.rares.includes(w.rare)) G.codex.rares.push(w.rare);
  }
  return G.codex;
}
/** The battle met one of this kind. */
export function noteTurned(type: string) {
  const c = ensureCodex();
  if (!c.z.includes(type)) c.z.push(type);
}

export function gunRecipe(def: string): Recipe | undefined {
  return RECIPES.find((r) => r.weapon === def && !r.hidden);
}
function craftOf(def: string): Craft | undefined {
  const r = gunRecipe(def);
  if (!r) return undefined;
  const unlocked = buildingLevel(r.needs) >= (r.level ?? 1);
  return { recipe: r, where: placeName(r.needs, r.level ?? 1), unlocked, afford: unlocked && has(r.cost) };
}
const siteNames = (ids: string[]) => ids.map((id) => SITES.find((s) => s.id === id)?.name ?? id);

function entry(def: string, rare: string | undefined, shelf: Offer[]): GunEntry {
  const c = ensureCodex();
  const d = WEAPONS[def];
  const rv = rare ? RARES[rare] : undefined;
  const have = G.weapons.filter((w) => w.def === def && (rare ? w.rare === rare : !w.rare));
  const craft = rare ? undefined : craftOf(def);
  const store = shelf.find((o) => o.def === def && (rare ? o.rare === rare : !o.rare) && !o.merchant);
  const merchant = shelf.find((o) => o.def === def && (rare ? o.rare === rare : !o.rare) && o.merchant);
  const storeEver = !rare && def in LANDING_GUNS;
  const merchantEver = !!rare || def in MERCHANT_GUNS;
  const sites = rv ? rv.sites : SITES.filter((s) => s.weapons.includes(def)).map((s) => s.id);
  const how: string[] = [];
  if (craft) how.push(craft.unlocked ? `Make · ${craft.where} · ${costLine(craft.recipe.cost)}` : `Make · needs ${craft.where} · ${costLine(craft.recipe.cost)}`);
  if (store) how.push(`Buy at the landing today · ${store.cost.salvage} salvage`);
  else if (storeEver) how.push(`Peltier's boat, some days · about ${LANDING_GUNS[def]} salvage`);
  if (merchant) how.push(`${MERCHANT_NAME} has one today · ${merchant.cost.salvage} salvage`);
  else if (merchantEver) {
    const from = rare ? rareMinDay(rare) : MERCHANT_GUNS[def].minDay;
    how.push(`Sold by the merchant · next visit ${dateLabel(merchantNext(Math.max(G.day + (merchantOn() ? 1 : 0), from)))}`);
  }
  if (sites.length) how.push(`Found${craft || storeEver || merchantEver ? '' : ' only'} · ${siteNames(sites).join(', ')}`);
  return {
    key: rare ?? def, def, rare,
    name: rv?.name ?? d.name, icon: d.icon, line: rv?.line ?? d.niche ?? d.desc,
    have, ever: rare ? c.rares.includes(rare) : c.guns.includes(def) || have.length > 0,
    craft, store, merchant, storeEver, merchantEver, sites, how,
  };
}

/** Every gun and rare variant, grouped, with what the house has and how to get the rest. */
export function gunCatalogue(): Catalogue {
  ensureCodex();
  const shelf = landingStock();
  let owned = 0, total = 0, rareOwned = 0, rareTotal = 0;
  const groups = GUN_GROUPS.map((g) => {
    const entries: GunEntry[] = [];
    let go = 0;
    for (const def of g.guns) {
      const e = entry(def, undefined, shelf);
      entries.push(e);
      if (e.have.length) go++;
      for (const r of raresOf(def)) {
        const re = entry(def, r, shelf);
        entries.push(re);
        rareTotal++;
        if (re.have.length) rareOwned++;
      }
    }
    owned += go;
    total += g.guns.length;
    return { id: g.id, name: g.name, entries, owned: go, total: g.guns.length };
  });
  return { groups, owned, total, rareOwned, rareTotal };
}

/** The next building step that lets the bench make a gun it cannot yet, cheapest first. */
export function nextUnlock(): { building: string; level: number; where: string; cost: Partial<Record<Res, number>>; guns: string[]; afford: boolean } | null {
  let best: ReturnType<typeof nextUnlock> = null;
  for (const b of Object.values(BUILDINGS)) {
    const lvl = buildingLevel(b.id);
    if (lvl >= b.maxLevel) continue;
    const guns = RECIPES.filter((r) => r.weapon && !r.hidden && r.needs === b.id && (r.level ?? 1) === lvl + 1).map((r) => r.weapon!);
    if (!guns.length) continue;
    const cost = b.cost[lvl] ?? {};
    const sal = cost.salvage ?? 0;
    if (!best || sal < (best.cost.salvage ?? 0)) best = { building: b.id, level: lvl + 1, where: placeName(b.id, lvl + 1), cost, guns, afford: has(cost) };
  }
  return best;
}

// ---------- the Compendium's other pages ----------
export interface CodexEntry { key: string; name: string; icon: string; line: string; stats: string; how: string; known: boolean; extra?: string }

export function meleeEntries(): CodexEntry[] {
  return Object.values(MELEE).map((m) => {
    const r = RECIPES.find((x) => x.melee === m.id && !x.hidden);
    const sites = SITES.filter((s) => s.melee?.includes(m.id)).map((s) => s.name);
    const n = (G.melee ?? []).filter((k) => k.def === m.id).length;
    return {
      key: m.id, name: m.name, icon: m.icon, line: m.niche, known: n > 0,
      stats: `dmg ${m.dmg} · reach ${m.reach}px · hits ${m.arc} · stamina ${m.stamina}`,
      how: [r ? `Make · ${placeName(r.needs, r.level ?? 1)} · ${costLine(r.cost)}` : '', sites.length ? `Found · ${sites.slice(0, 3).join(', ')}` : ''].filter(Boolean).join(' · '),
      extra: n ? `${n} in the house` : '',
    };
  });
}
export function modEntries(): CodexEntry[] {
  const shelf = landingStock();
  return Object.values(MODS).map((m) => {
    const r = RECIPES.find((x) => x.mod === m.id && !x.hidden);
    const sites = SITES.filter((s) => s.mods?.includes(m.id)).map((s) => s.name);
    const n = (G.modStock ?? []).filter((x) => x.def === m.id).length + G.weapons.filter((w) => Object.values(w.mods ?? {}).some((x) => x?.def === m.id)).length;
    const o = shelf.find((x) => x.mod === m.id);
    return {
      key: m.id, name: m.name, icon: m.icon, line: m.niche, known: n > 0,
      stats: `${m.slot} slot`,
      how: [r ? `Make · ${placeName(r.needs, r.level ?? 1)} · ${costLine(r.cost)}` : '', o ? `At the landing today · ${o.cost.salvage} salvage` : '', sites.length ? `Found · ${sites.slice(0, 3).join(', ')}` : ''].filter(Boolean).join(' · '),
      extra: n ? `${n} in the house` : '',
    };
  });
}
export function trapEntries(): CodexEntry[] {
  return Object.values(TRAPS).map((t) => {
    const n = G.trapStock?.[t.id] ?? 0;
    const unlocked = buildingLevel(t.recipe.needs) >= (t.recipe.level ?? 1);
    return {
      key: t.id, name: t.name, icon: t.icon, line: t.niche, known: unlocked,
      stats: `${t.uses} ${t.usesUnit}${t.uses === 1 ? '' : 's'}`,
      how: `Make · ${unlocked ? '' : 'needs '}${placeName(t.recipe.needs, t.recipe.level ?? 1)} · ${costLine(t.recipe.cost)}`,
      extra: n ? `${n} kit${n === 1 ? '' : 's'} on hand` : '',
    };
  });
}
export function turnedEntries(): CodexEntry[] {
  const c = ensureCodex();
  const seenNames = new Set<string>();
  return Object.values(ZOMBIES).filter((z) => { if (seenNames.has(z.name)) return false; seenNames.add(z.name); return true; }).map((z) => ({
    key: z.id, name: z.name, icon: z.sprites[0], line: z.role ?? 'Comes once, on its own night.', known: c.z.includes(z.id),
    stats: `${z.hp} hp · ${z.speed} px/s${z.armor ? ` · armour ${z.armor}` : ''}`,
    how: z.special ? 'Only on a special night' : `From day ${z.minDay}`,
    extra: z.lore,
  }));
}

/** How many things the house knows of: what the Compendium's "new" dot counts. */
export function codexKnown(): number {
  const c = ensureCodex();
  const makeable = RECIPES.filter((r) => r.weapon && !r.hidden && buildingLevel(r.needs) >= (r.level ?? 1)).length;
  return c.guns.length + c.rares.length + c.z.length + makeable + (merchantOn() ? 1 : 0);
}
export const codexNew = () => codexKnown() > (G.codex?.seen ?? 0);
export function markCodexSeen() { ensureCodex().seen = codexKnown(); }
