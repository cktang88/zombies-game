// Crew-served emplacements: heavy guns on fixed mounts at a post on the line. Built at the
// forge / workbench (recipes in data/world.ts), stored in G.flags.emplacements as a JSON array
// of { id, post, cond }, crewed at night by a survivor (handling(s, 'heavy'): Shooting, +3 if the MG is their favourite)
// or by the leader ([H] at the battle). The nail turret is the odd one out: automatic, no crew,
// counted by G.fort.turrets. Runtime: src/night/emplacements.ts. Pure data + pure helpers.
import type { Res } from '../types';

export type Post = 'roof' | 'firestep';

export interface EmplacementDef {
  id: string;
  name: string;
  short: string;
  desc: string;
  niche: string;
  /** what it eats: a stores key (rifle, fuel, salvage) and how much per round (or per second for flame) */
  ammo: Res;
  perShot: number;
  /** rounds in a belt / box / magazine before a reload (flame: seconds of fuel in the tank) */
  mag: number;
  reload: number; // seconds to change belt / box (untrained ×1.6)
  rof: number; // rounds per second while the trigger is held
  auto: boolean;
  dmg: number; // per round (flame: per second)
  pierce: number;
  knock: number;
  spread: number; // radians for a trained crew; untrained ×2
  armorPen: number;
  noise: number; // per round (flame: per second)
  /** heat per round; 1 = overheated. Cools at `cool` per second. Undefined = never overheats. */
  heat?: number;
  cool?: number;
  swap?: number; // barrel swap seconds when it overheats (trained crew); untrained ×2.2
  /** flame: cone half-angle (rad) and reach in px; sets burning */
  cone?: { half: number; reach: number; burn: number };
  crew: boolean; // false = automatic (the nail turret)
  posts: Post[]; // where it can be mounted; the first is the default
  wear: number; // condition lost per round (per second for flame)
  sound: string; // sfx.shoot id
}

export const EMPLACEMENTS: Record<string, EmplacementDef> = {
  mgnest: {
    id: 'mgnest', name: 'MG nest', short: 'MG', ammo: 'rifle', perShot: 0.5, mag: 100, reload: 5, rof: 12, auto: true,
    dmg: 38, pierce: 1, knock: 10, spread: 0.035, armorPen: 0.3, noise: 3.2, heat: 0.03, cool: 0.2, swap: 3,
    crew: true, posts: ['firestep', 'roof'], wear: 0.0004, sound: 'lmg',
    niche: 'Belt-fed 5.56 from the Line, half a rifle round a shot: the most fire on the road, if the crew can keep it cool.',
    desc: 'The Corliss gun on a sandbagged tripod, a spare barrel in an asbestos glove. Short bursts, or it cooks.',
  },
  swivel: {
    id: 'swivel', name: 'Swivel deer rifle', short: 'swivel', ammo: 'rifle', perShot: 1, mag: 5, reload: 3.2, rof: 1.1, auto: false,
    dmg: 150, pierce: 4, knock: 22, spread: 0.004, armorPen: 0.6, noise: 2.4,
    crew: true, posts: ['roof', 'firestep'], wear: 0.0006, sound: 'hunting',
    niche: 'A braced .30-06 on a boat-seat swivel: slow, and through four in a line.',
    desc: 'Nils\'s deer rifle bolted to a pontoon-boat seat on a fence post, sandbag cheek rest, a tin can for brass.',
  },
  flamer: {
    id: 'flamer', name: 'Propane flame projector', short: 'flame', ammo: 'fuel', perShot: 0.12, mag: 12, reload: 4, rof: 1, auto: true,
    dmg: 34, pierce: 99, knock: 0, spread: 0, armorPen: 1, noise: 1.5, heat: 0.05, cool: 0.25, swap: 2.5,
    cone: { half: 0.2, reach: 230, burn: 3.5 }, crew: true, posts: ['firestep'], wear: 0.002, sound: 'flare',
    niche: 'A short roaring cone at the wall: everything in it burns. Drinks fuel.',
    desc: 'A weed burner, two grill tanks and a still-fuel drip, on a pipe stand over the barricade. Lights the oil, too.',
  },
  nailturret: {
    id: 'nailturret', name: 'Nail turret', short: 'turret', ammo: 'salvage', perShot: 0.05, mag: 9999, reload: 0, rof: 3.3, auto: true,
    dmg: 18, pierce: 1, knock: 2, spread: 0.04, armorPen: 0, noise: 0.15,
    crew: false, posts: ['firestep'], wear: 0, sound: 'nailer',
    niche: 'Fires at anything on the road by itself. Eats salvage; needs the generator.',
    desc: 'A framing nailer on a tractor-seat swivel, triggered by a doorbell relay.',
  },
};

export interface EmplacementItem { id: string; post: Post; cond: number }

/** G.flags.emplacements, parsed and validated (unknown ids dropped). */
export function parseEmplacements(raw: unknown): EmplacementItem[] {
  try {
    const v = JSON.parse(typeof raw === 'string' ? raw : '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((e) => e && EMPLACEMENTS[e.id]).map((e) => ({
      id: e.id, post: e.post === 'roof' || e.post === 'firestep' ? e.post : EMPLACEMENTS[e.id].posts[0], cond: Math.max(0.05, Math.min(1, +e.cond || 1)),
    }));
  } catch {
    return [];
  }
}
export function stringifyEmplacements(list: EmplacementItem[]): string {
  return JSON.stringify(list.map((e) => ({ id: e.id, post: e.post, cond: +e.cond.toFixed(3) })));
}

/**
 * Crew handling from handling(s, 'heavy') (0..10). Untrained crews hold the trigger down
 * (long bursts, they cook the barrel and jam), aim wide and swap barrels slowly; a trained
 * crew fires short bursts, lets it cool, and clears a jam in a moment.
 */
export function crewHandling(heavy: number) {
  const t = Math.max(0, Math.min(10, heavy)) / 10;
  return {
    spreadMul: 2.1 - 1.3 * t, // 2.1 untrained … 0.8 at 10
    heatMul: 1.35 - 0.55 * t, // barrel heat per round
    burst: Math.round(26 - 18 * t), // rounds before they ease off (MG)
    pause: 0.25 + 0.45 * t, // seconds between bursts (a trained crew lets it breathe)
    jam: 0.03 * (1 - t) + 0.004, // per burst
    jamClear: 2.4 - 1.6 * t,
    swapMul: 2.2 - 1.3 * t,
    reloadMul: 1.6 - 0.7 * t,
    react: 0.9 - 0.6 * t, // seconds to pick a new target
  };
}

/** A finished emplacement recipe: the new gun, at its default post. Returns the new flags string. */
export function addEmplacement(raw: unknown, id: string): string {
  const list = parseEmplacements(raw);
  if (EMPLACEMENTS[id]) list.push({ id, post: EMPLACEMENTS[id].posts[0], cond: 1 });
  return stringifyEmplacements(list);
}
/** The forge overhaul: +50% condition on the most worn one. */
export function repairEmplacement(raw: unknown): string {
  const list = parseEmplacements(raw);
  const w = [...list].sort((a, b) => a.cond - b.cond)[0];
  if (w) w.cond = Math.min(1, w.cond + 0.5);
  return stringifyEmplacements(list);
}
