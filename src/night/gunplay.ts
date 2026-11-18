// Gun handling for the night (docs/balance.md §8, docs/research/05 §3, DESIGN "real, not annoying").
// Pure helpers: no game state here. Battle owns the per-gun state (bloom, heat, chamber, pouch).
import type { WeaponItem, Survivor } from '../types';
import { WEAPONS, type FireProfile, type ShooterMods } from '../data/weapons';
import { handling, hasTrait, attr, perkMul } from '../sim/survivors';

/** Bloom (rad) added per shot, by weapon id first, then by class (balance.md §8.1). */
const KICK_ID: Record<string, number> = { carbine: 0.085 };
const KICK_CLS: Record<string, number> = {
  handgun: 0.022, smg: 0.065, shotgun: 0.05, rifle: 0.03, assault: 0.03, marksman: 0.03, heavy: 0.045, bow: 0.02, improvised: 0.04, launcher: 0.05,
};
export function kickFor(w: WeaponItem, p: FireProfile): number {
  return (KICK_ID[w.def] ?? KICK_CLS[p.cls] ?? 0.03) * p.bloomMul * p.braceBloomMul;
}
export const BLOOM_CAP = 0.3;
export const BLOOM_HOLD = 0.12;
export const BLOOM_HALF = 0.15;
/** Bloom after `since` seconds without a shot, from `b` at the last shot. */
export function bloomAfter(b: number, since: number) {
  const free = Math.max(0, since - BLOOM_HOLD);
  return b * Math.pow(0.5, free / BLOOM_HALF);
}
/** A patient shot: long enough since the last one and the bloom settled (balance.md §8.3). */
export function aimedDelay(p: FireProfile) {
  return p.rof <= 1.2 ? 0.6 : 0.35;
}

/** px the aim point climbs per round of a continuous string of fire (autos), before the cap of 10. */
export function climbFor(w: WeaponItem, p: FireProfile): number {
  if (!p.auto && p.burst <= 1) return 0;
  const id = w.def;
  const base = id === 'carbine' || p.cls === 'assault' ? 4 : p.cls === 'heavy' ? 3 : p.cls === 'improvised' ? 1 : p.cls === 'smg' ? 2.5 : 2;
  return base * p.recoilMul * (p.braceBloomMul < 1 ? 0.55 : 1);
}

/** Heat (rounds) at which an auto runs hot: spread ×1.4, +1.5% jams. LMG at the hard cap needs a barrel swap. */
export function heatLimit(p: FireProfile) { return Math.max(10, Math.round(p.mag * 0.6)); }
export function heatCool(p: FireProfile) { return p.cls === 'heavy' ? 4 : 5; }
export const usesHeat = (p: FireProfile) => p.auto;
export const swapsBarrel = (w: WeaponItem) => w.def === 'lmg';

export type FireMode = 'semi' | 'burst' | 'auto';
/** The modes a gun's selector offers (first = its natural mode). */
export function fireModes(w: WeaponItem, p: FireProfile): FireMode[] {
  if (p.auto) return ['auto', 'burst', 'semi'];
  if (p.burst > 1 && p.burstGap > 0) return ['burst', 'semi'];
  return ['semi'];
}

/** A box-magazine gun with a closed breech: a tactical reload keeps one in the chamber (+1). */
export function hasChamber(w: WeaponItem, p: FireProfile): boolean {
  const d = WEAPONS[w.def];
  if (!d || p.reloadPerRound || p.mag <= 1 || p.cls === 'launcher' || p.cls === 'bow') return false;
  if (['revolver', 'coach', 'snake410', 'pipe', 'flaregun'].includes(w.def)) return false;
  return d.caliber !== 'ball' && d.caliber !== 'bolt' && d.caliber !== 'flare' && d.caliber !== 'nails';
}
/** Bolt and lever guns: the hand works the action (short-stroke risk under low nerve). */
export const manualAction = (w: WeaponItem, p: FireProfile) => !p.auto && p.rof <= 1.3 && ['rifle', 'marksman'].includes(p.cls) && w.def !== 'muzzle';

/** Seconds to get a different gun up: a pistol transition is faster than any reload. */
export function drawTime(p: FireProfile): number {
  const t: Record<string, number> = { handgun: 0.35, smg: 0.55, bow: 0.6, improvised: 0.6, shotgun: 0.75, rifle: 0.75, assault: 0.7, marksman: 0.85, launcher: 1, heavy: 1.2 };
  return t[p.cls] ?? 0.7;
}

/** Shooter mods from the survivor: handling (Shooting + favourite) sets reload, spread, jams (fireProfile's 2nd arg). */
export function shooterMods(s: Survivor, cls: FireProfile['cls'], forGuard: boolean): ShooterMods {
  const pv = handling(s, cls); // 0..10: Shooting, +3 with their favourite
  const steady = hasTrait(s, 'steady') ? 0.75 : 1;
  return {
    reloadMul: (1.15 - pv * 0.035) * perkMul(s, 'reload'), // handling 0: 15% slower, 10: 20% faster; perks
    jamMul: 1.25 - pv * 0.06, // handling 10: about half the jams
    spreadMul: forGuard ? 1.1 - pv * 0.025 : 1, // the player's own hand is the player's spread
    bloomMul: steady,
  };
}
/** Seconds to clear a stoppage: tap-rack is quick; a double-feed is the punishing one. */
export function clearTime(p: FireProfile, s: Survivor, kind: Malfunction) {
  const pv = handling(s, p.cls);
  const k = (1.1 - pv * 0.04) * perkMul(s, 'jamClear'); // Tap-rack perk
  if (kind === 'double') return p.jamClear * 1.8 * k;
  if (kind === 'short') return 0.3;
  return Math.min(0.55, p.jamClear * 0.45) * k;
}
export type Malfunction = 'tap' | 'double' | 'short';
/** Courage 0..10 as a 0..1 steadiness under fire. */
export const nerveOf = (s: Survivor) => attr(s, 'courage') / 10;
