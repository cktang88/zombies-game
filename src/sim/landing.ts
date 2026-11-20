import type { Res } from '../types';
import { G, add, has, pay, log, newWeapon, uid, rep, addRep, dateLabel } from '../state';
import { Rng } from '../rng';
import { WEAPONS, MODS, RARES, RARE_ORDER, gunModel } from '../data/weapons';
import { SITES } from '../data/world';

/* =====================================================================================
 * THE LANDING — Peltier's boat below the house: a store that is open every day.
 *   Prices are in salvage (the house's one currency). Ammunition, medicine, food and fuel are always
 *   stocked (a few lots a day); two plain guns and one attachment rotate daily (seeded by the run seed
 *   and the date, so a reload shows the same shelf). Surplus food, fuel and medicine sell back for salvage.
 *   The Ferry families' standing sets the price (friendly ×0.8 … cold ×1.2); hostile, he will not tie up.
 * THE MERCHANT — Vic Mercier, a peddler working the river towns, ties up beside Peltier every third
 *   day (Nov 8, 11, 14 …). He carries what you cannot make: two rare variants (data/weapons.ts RARES),
 *   one of the wilder guns, and a good attachment, priced above any craft. His prices ignore the Ferry
 *   families. docs/balance.md §Gun catalogue has the numbers.
 * ===================================================================================== */

export type OfferKind = 'ammo' | 'supply' | 'gun' | 'mod' | 'rare' | 'sell';
export interface Offer {
  key: string;
  kind: OfferKind;
  name: string;
  icon: string;
  desc: string;
  /** what the house pays (salvage to buy; the goods to sell) */
  cost: Partial<Record<Res, number>>;
  /** what the house gets in stores (ammo, supplies, salvage for a sale) */
  gives?: Partial<Record<Res, number>>;
  def?: string; rare?: string; mod?: string;
  /** lots on the shelf today, and how many are left */
  stock: number; left: number;
  merchant?: boolean;
}

/** Base prices in salvage before the Ferry standing. */
export const LANDING_AMMO: { res: Res; n: number; price: number; stock: number; minDay?: number }[] = [
  { res: 'pistol', n: 24, price: 6, stock: 4 },
  { res: 'shell', n: 10, price: 6, stock: 3 },
  { res: 'rifle', n: 10, price: 9, stock: 3 },
  { res: 'explosive', n: 2, price: 8, stock: 1, minDay: 5 },
];
export const LANDING_SUPPLY: { res: Res; n: number; price: number; stock: number }[] = [
  { res: 'meds', n: 1, price: 6, stock: 2 },
  { res: 'food', n: 8, price: 5, stock: 2 },
  { res: 'fuel', n: 3, price: 5, stock: 2 },
];
/** What Peltier gives back for a lot of surplus (no standing applied: he is not haggling over potatoes). */
export const LANDING_SELL: { res: Res; n: number; salvage: number; stock: number }[] = [
  { res: 'food', n: 8, salvage: 3, stock: 3 },
  { res: 'fuel', n: 3, salvage: 2, stock: 3 },
  { res: 'meds', n: 1, salvage: 3, stock: 2 },
];
/** Plain guns Peltier may have on the boat (two a day), with the price. */
export const LANDING_GUNS: Record<string, number> = {
  pipe: 16, flaregun: 20, r22: 22, snake410: 24, service9: 30, crossbow: 32, revolver: 34, m1911: 34, compound: 34, coach: 36, pump: 40, lever: 44, hunting: 48,
};
/** Attachments: Peltier's daily one is a plain one; the merchant brings optics and magazines. */
export const LANDING_MODS: Record<string, number> = { flashlight: 10, sling: 10, suppressor: 14 };
export const MERCHANT_MODS: Record<string, number> = { scope: 22, reddot: 20, extmag: 18, suppressor: 14 };
/** The merchant's wilder guns (never on Peltier's boat, never made), with the price and the first day he has it. */
export const MERCHANT_GUNS: Record<string, { price: number; minDay: number }> = {
  mp93: { price: 50, minDay: 3 }, muzzle: { price: 44, minDay: 3 }, nailer: { price: 44, minDay: 3 }, rivet: { price: 50, minDay: 6 },
  scoped: { price: 70, minDay: 6 }, autoshot: { price: 72, minDay: 6 }, smg: { price: 60, minDay: 6 }, ar15: { price: 80, minDay: 9 },
  m79: { price: 75, minDay: 9 }, law: { price: 70, minDay: 12 }, carbine: { price: 90, minDay: 12 }, lmg: { price: 110, minDay: 15 },
};
/** Rare variants: always dearer than any way of making the base gun. */
export const RARE_PRICE: Record<string, number> = {
  deputy357: 62, match9: 56, duckpump: 72, magcoach: 66, matchrifle: 84, saddle3030: 78, swatsmg: 92, guardar: 118,
};
/** The first day the merchant carries a rare: the earliest day one of its sites opens. */
export const rareMinDay = (id: string) => Math.min(...RARES[id].sites.map((s) => SITES.find((x) => x.id === s)?.minDay ?? 1));

export const MERCHANT_EVERY = 3;
export const MERCHANT_NAME = 'Vic Mercier';
/** Is the merchant at the landing on this day? */
export const merchantOn = (day = G.day) => day >= MERCHANT_EVERY && day % MERCHANT_EVERY === 0;
/** The next day he ties up, today included. */
export function merchantNext(day = G.day): number {
  let d = day;
  while (!merchantOn(d)) d++;
  return d;
}

/** The Ferry families' price: friendly 0.8, warm 0.9, unknown 1, cold 1.2; null = hostile, the boat stays away. */
export function landingMul(): number | null {
  const r = rep('ferry');
  if (r <= -40) return null;
  return r >= 40 ? 0.8 : r >= 10 ? 0.9 : r > -10 ? 1 : 1.2;
}
export function standingWord(): string {
  const r = rep('ferry');
  return r >= 40 ? 'friendly' : r >= 10 ? 'warm' : r > -10 ? 'unknown' : r > -40 ? 'cold' : 'hostile';
}
/** Is Peltier's store open today? (the merchant comes on his own days whatever the Ferry families think) */
export const landingOpen = () => landingMul() !== null;

// today's purchases: { day, n: { key: lots bought } }
function bought(): Record<string, number> {
  try {
    const b = JSON.parse((G.flags.landingBuys as string) ?? '{}') as { day?: number; n?: Record<string, number> };
    return b.day === G.day ? b.n ?? {} : {};
  } catch { return {}; }
}
function markBought(key: string) {
  const n = bought();
  n[key] = (n[key] ?? 0) + 1;
  G.flags.landingBuys = JSON.stringify({ day: G.day, n });
}

const resName: Partial<Record<Res, string>> = { pistol: 'Pistol rounds', shell: 'Shotgun shells', rifle: 'Rifle rounds', explosive: 'Explosives', meds: 'Medicine', food: 'Food', fuel: 'Fuel', salvage: 'Salvage' };
const resIcon: Partial<Record<Res, string>> = { pistol: 'icon_ammo', shell: 'icon_shells', rifle: 'icon_r556', explosive: 'icon_molotov', meds: 'icon_meds', food: 'icon_food', fuel: 'icon_fuel', salvage: 'icon_scrap' };
const price = (base: number, mul: number) => Math.max(1, Math.round(base * mul));

/** Everything on the landing today: Peltier's shelf (if open), the merchant's (on his days), and what sells back. */
export function landingStock(day = G.day): Offer[] {
  const out: Offer[] = [];
  const got = day === G.day ? bought() : {};
  const lot = (o: Omit<Offer, 'left'>): Offer => ({ ...o, left: Math.max(0, o.stock - (got[o.key] ?? 0)) });
  const mul = landingMul();
  const rng = new Rng((G.seed * 31 + day * 977) >>> 0);
  if (mul !== null) {
    for (const a of LANDING_AMMO) {
      if ((a.minDay ?? 1) > day) continue;
      out.push(lot({ key: `ammo_${a.res}`, kind: 'ammo', name: `${resName[a.res]} ×${a.n}`, icon: resIcon[a.res]!, desc: 'Factory boxes, Ferry-family stores.', cost: { salvage: price(a.price, mul) }, gives: { [a.res]: a.n }, stock: a.stock }));
    }
    for (const a of LANDING_SUPPLY) {
      out.push(lot({ key: `sup_${a.res}`, kind: 'supply', name: `${resName[a.res]} ×${a.n}`, icon: resIcon[a.res]!, desc: a.res === 'meds' ? 'A sealed kit from the Corliss aid station.' : a.res === 'food' ? 'Smoked fish and potatoes.' : 'A jerry can of outboard mix.', cost: { salvage: price(a.price, mul) }, gives: { [a.res]: a.n }, stock: a.stock }));
    }
    const guns = rng.shuffle(Object.keys(LANDING_GUNS)).slice(0, 2);
    for (const g of guns) out.push(lot({ key: `gun_${g}`, kind: 'gun', def: g, name: WEAPONS[g].name, icon: WEAPONS[g].icon, desc: WEAPONS[g].niche ?? WEAPONS[g].desc, cost: { salvage: price(LANDING_GUNS[g], mul) }, stock: 1 }));
    const m = rng.pick(Object.keys(LANDING_MODS));
    out.push(lot({ key: `mod_${m}`, kind: 'mod', mod: m, name: MODS[m].name, icon: MODS[m].icon, desc: MODS[m].niche, cost: { salvage: price(LANDING_MODS[m], mul) }, stock: 1 }));
    for (const s of LANDING_SELL) {
      out.push(lot({ key: `sell_${s.res}`, kind: 'sell', name: `Sell ${resName[s.res]!.toLowerCase()} ×${s.n}`, icon: resIcon[s.res]!, desc: `${s.salvage} salvage for ${s.n} ${resName[s.res]!.toLowerCase()}.`, cost: { [s.res]: s.n }, gives: { salvage: s.salvage }, stock: s.stock }));
    }
  }
  if (merchantOn(day)) {
    const mr = new Rng((G.seed * 131 + day * 7919) >>> 0);
    const rares = mr.shuffle(RARE_ORDER.filter((r) => rareMinDay(r) <= day + 3)).slice(0, 2);
    for (const r of rares) {
      const d = RARES[r];
      out.push(lot({ key: `rare_${r}`, kind: 'rare', merchant: true, def: d.base, rare: r, name: d.name, icon: WEAPONS[d.base].icon, desc: d.line, cost: { salvage: RARE_PRICE[r] ?? 80 }, stock: 1 }));
    }
    const wild = mr.pick(Object.keys(MERCHANT_GUNS).filter((g) => MERCHANT_GUNS[g].minDay <= day));
    if (wild) out.push(lot({ key: `mgun_${wild}`, kind: 'gun', merchant: true, def: wild, name: WEAPONS[wild].name, icon: WEAPONS[wild].icon, desc: WEAPONS[wild].niche ?? WEAPONS[wild].desc, cost: { salvage: MERCHANT_GUNS[wild].price }, stock: 1 }));
    const mm = mr.pick(Object.keys(MERCHANT_MODS));
    out.push(lot({ key: `mmod_${mm}`, kind: 'mod', merchant: true, mod: mm, name: MODS[mm].name, icon: MODS[mm].icon, desc: MODS[mm].niche, cost: { salvage: MERCHANT_MODS[mm] }, stock: 1 }));
  }
  return out;
}

/** Buy (or sell) one lot. Returns the line for the report, or null when it cannot be done. */
export function buyOffer(key: string): string | null {
  const o = landingStock().find((x) => x.key === key);
  if (!o || o.left <= 0 || !has(o.cost)) return null;
  pay(o.cost);
  markBought(key);
  for (const [k, v] of Object.entries(o.gives ?? {})) add(k as Res, v ?? 0);
  let line: string;
  if (o.def) {
    const w = newWeapon(o.def, o.merchant ? 0.9 : 0.85);
    if (o.rare) w.rare = o.rare;
    line = `Bought the ${gunModel(w)} at the landing.`;
    log('event', `Bought a ${gunModel(w).toLowerCase()} off ${o.merchant ? MERCHANT_NAME : 'Peltier'} at the landing.`);
  } else if (o.mod) {
    (G.modStock ??= []).push({ uid: uid('m'), def: o.mod, cond: 1 });
    line = `Bought a ${MODS[o.mod].name.toLowerCase()} at the landing. It is on the bench.`;
  } else line = o.kind === 'sell' ? `Sold ${o.name.slice(5).toLowerCase()} to Peltier.` : `Bought ${o.name.toLowerCase()} at the landing.`;
  if (!o.merchant) addRep('ferry', 1);
  return line;
}

/** One line for the landing's plaque and hover. */
export function landingSummary(): string {
  const open = landingOpen();
  const m = merchantOn() ? `${MERCHANT_NAME} is here` : `merchant ${merchantNext() - G.day === 1 ? 'tomorrow' : `on ${dateLabel(merchantNext())}`}`;
  return `${open ? 'open' : 'Peltier won\'t tie up'} · ${m}`;
}
