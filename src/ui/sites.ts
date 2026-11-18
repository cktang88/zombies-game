// What each scavenging site is good for, from its loot table (src/data/world.ts SITES), so the player
// picks a place by what it gives, not by luck: "Ferry Diner: food" / "Aubin mill yard: salvage".
import type { Site } from '../data/world';
import type { Res } from '../types';

export type Find = 'food' | 'salvage' | 'meds' | 'fuel' | 'ammo' | 'guns';
export const FIND_LABEL: Record<Find, string> = {
  food: 'food', salvage: 'salvage', meds: 'medicine', fuel: 'fuel', ammo: 'ammo', guns: 'guns',
};
export const FIND_ICON: Record<Find, string> = {
  food: 'food', salvage: 'scrap', meds: 'meds', fuel: 'fuel', ammo: 'ammo', guns: 'rifle',
};
// a "normal" haul of each per trip: a site's amount against this says whether it is a good place for it
const TYPICAL: Record<Exclude<Find, 'guns'>, number> = { food: 5, salvage: 10, meds: 3, fuel: 3, ammo: 20 };
const AMMO: Res[] = ['pistol', 'shell', 'rifle', 'bolt'];
// shells and bolts count for more than pistol rounds
const AMMO_W: Partial<Record<Res, number>> = { shell: 1.5, bolt: 1.5 };

export interface SiteFind { k: Find; score: number; level: 'lots' | 'some' | 'a little' }

/** The site's finds, best first: score = expected haul against a normal one. */
export function siteFinds(site: Site): SiteFind[] {
  const l = site.loot;
  const amt: Partial<Record<Find, number>> = {};
  for (const k of ['food', 'salvage', 'meds', 'fuel'] as const) if (l[k]) amt[k] = l[k]!;
  let ammo = 0;
  for (const r of AMMO) ammo += (l[r] ?? 0) * (AMMO_W[r] ?? 1);
  ammo += ((l.rocket ?? 0) + (l.g40 ?? 0)) * 15;
  if (ammo) amt.ammo = ammo;
  const out: SiteFind[] = [];
  for (const [k, v] of Object.entries(amt) as [Exclude<Find, 'guns'>, number][]) {
    const score = v / TYPICAL[k];
    out.push({ k, score, level: score >= 1.6 ? 'lots' : score >= 0.8 ? 'some' : 'a little' });
  }
  if (site.weaponChance >= 0.1) out.push({ k: 'guns', score: site.weaponChance * 6, level: site.weaponChance >= 0.25 ? 'lots' : 'some' });
  return out.sort((a, b) => b.score - a.score);
}

/** "food, salvage, ammo": the top finds in words, for a <select> option. */
export function siteFindsText(site: Site, n = 3): string {
  return siteFinds(site).filter((f) => f.level !== 'a little').slice(0, n).map((f) => FIND_LABEL[f.k]).join(', ') || 'odds and ends';
}
