// Who stands the wall tonight and whether they can shoot: the numbers the day screen shows at the
// moment the player hands out guns (docs/research/18-decision-info-audit.md #1). Mirrors
// night/battle.ts setupGuards: the leader first, then the others who can fight, six at most; a guard
// without a gun (or with a dry one) never shoots and does not swing a hand weapon either.
import type { Survivor, WeaponItem, Res } from '../types';
import { G } from '../state';
import { living, canFight, handling } from './survivors';
import { fireProfile, roundsInStores, weaponClass, ammoTypesFor } from '../data/weapons';

/** About this many shots per gun is one ordinary night on the wall (a tide is 2–3×). */
export const SHOTS_PER_GUN_NIGHT = 25;
/** Places on the wall (battle.ts setupGuards: fighters.slice(0, 6)). */
export const WALL_SLOTS = 6;

const gunOf = (s: Survivor) => G.weapons.find((x) => x.uid === s.weapon);

/** Rounds the stores hold for this gun as it is loaded (Infinity for guns that need none). */
export function gunRounds(w: WeaponItem) {
  return roundsInStores(fireProfile(w), G.stores);
}

/** Why a survivor at the wall cannot shoot: no gun, or no rounds for it. Null when they can. */
export function cantShoot(s: Survivor): 'unarmed' | 'dry' | null {
  const w = gunOf(s);
  if (!w) return 'unarmed';
  return gunRounds(w) < 1 ? 'dry' : null;
}

/** Tonight's line: who is at the wall (in battle order), who of them cannot shoot, who sits out. */
export function wallLine() {
  const fighters = living().filter(canFight).sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
  const at = fighters.slice(0, WALL_SLOTS);
  return { at, idle: at.filter((s) => cantShoot(s)), sitOut: fighters.slice(WALL_SLOTS) };
}

/** Guns nobody carries. */
export function rackGuns(): WeaponItem[] {
  const held = new Set(living().map((s) => s.weapon).filter(Boolean));
  return G.weapons.filter((w) => !held.has(w.uid));
}

/**
 * The best rack gun for this person: one with rounds on hand first (shared out among everyone who
 * already carries that ammo), then their handling of it (a favourite counts), then rounds, then condition.
 */
export function bestGunFor(s: Survivor, rack = rackGuns(), carriers = ammoCarriers()): WeaponItem | undefined {
  let best: WeaponItem | undefined, bestScore = -Infinity;
  for (const w of rack) {
    const p = fireProfile(w);
    const rounds = roundsInStores(p, G.stores);
    const share = p.ammoRes ? rounds / (1 + (carriers.get(p.ammoRes) ?? 0)) : SHOTS_PER_GUN_NIGHT;
    const score = (share >= 1 ? 1000 : 0) + handling(s, weaponClass(w.def)) * 20 + Math.min(share, SHOTS_PER_GUN_NIGHT) + w.cond * 5;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

function ammoCarriers() {
  const m = new Map<string, number>();
  for (const s of living()) {
    const w = gunOf(s);
    const res = w ? fireProfile(w).ammoRes : null;
    if (res) m.set(res, (m.get(res) ?? 0) + 1);
  }
  return m;
}

/**
 * Hand every guard who cannot shoot the best rack gun for them (a dry gun goes back on the rack only
 * when a gun with rounds replaces it). A favourite (★) counts: those whose favourite is on the rack pick first. Returns who got what, for the report.
 */
export function armEveryone(): { s: Survivor; w: WeaponItem }[] {
  const out: { s: Survivor; w: WeaponItem }[] = [];
  const carriers = ammoCarriers();
  // whoever has their favourite kind of gun on the rack picks first, so the shotgun goes to the shotgun hand
  const favOnRack = (s: Survivor) => rackGuns().some((w) => weaponClass(w.def) === s.fav && gunRounds(w) >= 1);
  const idle = wallLine().idle.sort((a, b) => +favOnRack(b) - +favOnRack(a));
  for (const s of idle) {
    const rack = rackGuns().filter((w) => gunRounds(w) >= 1 || !gunOf(s));
    const w = bestGunFor(s, rack, carriers);
    if (!w) continue;
    const old = gunOf(s);
    const oldRes = old ? fireProfile(old).ammoRes : null;
    if (oldRes) carriers.set(oldRes, (carriers.get(oldRes) ?? 1) - 1);
    s.weapon = w.uid;
    const res = fireProfile(w).ammoRes;
    if (res) carriers.set(res, (carriers.get(res) ?? 0) + 1);
    out.push({ s, w });
  }
  return out;
}

/** What armEveryone would hand out, without changing anything. */
export function armPreview(): { s: Survivor; w: WeaponItem }[] {
  const keep = new Map(living().map((s) => [s, s.weapon] as const));
  const out = armEveryone();
  for (const [s, w] of keep) s.weapon = w;
  return out;
}

/** Whether armEveryone would change anything right now. */
export function canArmAnyone(): boolean {
  const rack = rackGuns();
  return wallLine().idle.some((s) => rack.some((w) => gunRounds(w) >= 1 || !gunOf(s)));
}

/**
 * One ammo type against the guns people carry: rounds on hand, who has it loaded, who could load it,
 * and about how many ordinary nights it lasts at SHOTS_PER_GUN_NIGHT a gun (loaded guns, else the ones
 * that fit). nights is null when no carried gun takes it.
 */
export function ammoUse(res: Res) {
  const have = Math.floor(G.stores[res] ?? 0);
  const loaded: Survivor[] = [], fits: Survivor[] = [];
  for (const s of living()) {
    const w = gunOf(s);
    if (!w) continue;
    if (fireProfile(w).ammoRes === res) loaded.push(s);
    else if (ammoTypesFor(w.def).includes(res)) fits.push(s);
  }
  const guns = loaded.length || fits.length;
  return { have, loaded, fits, nights: guns ? have / (SHOTS_PER_GUN_NIGHT * guns) : null };
}
