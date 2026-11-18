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
const AMMO: Res[] = ['light', 'shell', 'rifle', 'r22', 'light_hp', 'shell_slug', 'shell_flech', 'shell_fire', 'rifle_sp', 'rifle_ap', 'r556', 'ball', 'bolt', 'bolt_fire', 'flare'];
// heavy rounds count for more than .22s
const AMMO_W: Partial<Record<Res, number>> = { r22: 0.4, shell: 1.5, shell_slug: 1.8, shell_flech: 1.8, flare: 2, bolt: 1.5, ball: 1.2 };

export interface SiteFind { k: Find; score: number; level: 'lots' | 'some' | 'a little' }

/** The site's finds, best first: score = expected haul against a normal one. */
export function siteFinds(site: Site): SiteFind[] {
  const l = site.loot;
  const amt: Partial<Record<Find, number>> = {};
  for (const k of ['food', 'salvage', 'meds', 'fuel'] as const) if (l[k]) amt[k] = l[k]!;
  let ammo = 0;
  for (const r of AMMO) ammo += (l[r] ?? 0) * (AMMO_W[r] ?? 1);
  ammo += ((l.rocket ?? 0) + (l.g40 ?? 0) + (l.g40_buck ?? 0)) * 15;
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
