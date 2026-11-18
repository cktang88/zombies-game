// Perks: earned when a skill reaches 4 and 7 (two offered, one kept). Effects are plain numbers read through
// perkFx(s, fx) in src/sim/survivors.ts; each fx key is consumed in exactly one place (listed below).
import type { SkillId } from '../types';

export type PerkFx =
  | 'jamClear' // night/gunplay clearTime: x(1 + v)
  | 'reload' // night/gunplay shooterMods.reloadMul: x(1 + v)
  | 'weakspot' // night/battle guard weakspot aim chance: + v
  | 'aim' // sim/survivors aimFactor: + v
  | 'repair' // sim/day repairAmount: x(1 + v)
  | 'repairWood' // sim/day salvage per wall point: x(1 + v)
  | 'craft' // sim/day craftPoints: x(1 + v)
  | 'drain' // sim/day job fatigue: x(1 + v)
  | 'care' // sim/day doctor: wounds tended per day x(1 + v)
  | 'tendHeal' // sim/day doctor: a dressed wound loses this much more severity
  | 'scav' // sim/day scavenge haul: x(1 + v) (summed over the team)
  | 'scavDanger' // sim/day scavenge danger: x(1 + v)
  | 'radio' // sim/day radio work: x(1 + v)
  | 'aura' // sim/survivors moodBreakdown: + v mood to everyone else in the house
  | 'counsel'; // sim/survivors counsel power: x(1 + v)

export interface PerkDef {
  id: string;
  skill: SkillId;
  tier: 4 | 7;
  name: string;
  desc: string;
  fx: Partial<Record<PerkFx, number>>;
}

const P = (skill: SkillId, tier: 4 | 7, id: string, name: string, desc: string, fx: PerkDef['fx']): PerkDef => ({ id, skill, tier, name, desc, fx });

// Two per skill and tier, and each pair is a fork you can see: faster or surer, more or safer, wider or deeper.
// Old perks that were cut (iron_back, tinker, steady_pace, armorer, warmth, thick_skin, unshakable, confessor and the
// farming four) drop on load; migrateSurvivor re-offers the tier so nobody loses a pick.
export const PERK_LIST: PerkDef[] = [
  P('shooting', 4, 'tap_rack', 'Tap-rack', 'Clears a jam 40% faster.', { jamClear: -0.4 }),
  P('shooting', 4, 'quick_hands', 'Quick hands', 'Reloads 25% faster.', { reload: -0.25 }),
  P('shooting', 7, 'bead', 'Bead', 'Weakspots are easier: 15% wider under your own sights, sought far more often on guard.', { weakspot: 0.15 }),
  P('shooting', 7, 'dead_eye', 'Dead eye', 'Aim +8.', { aim: 0.08 }),
  P('building', 4, 'mason', 'Mason', 'Wall repairs go 25% further.', { repair: 0.25 }),
  P('building', 4, 'thrifty', 'Thrifty', 'Patches the wall with 40% less salvage.', { repairWood: -0.4 }),
  P('building', 7, 'master_hand', 'Master hand', '50% more bench work done.', { craft: 0.5 }),
  P('building', 7, 'tireless', 'Tireless', 'Work tires them 40% less.', { drain: -0.4 }),
  P('medicine', 4, 'field_medic', 'Field medic', 'Tends 50% more wounds a day.', { care: 0.5 }),
  P('medicine', 4, 'clean_hands', 'Clean hands', 'A dressed wound starts 15% better off.', { tendHeal: 0.15 }),
  P('medicine', 7, 'surgeon', 'Surgeon', 'A dressed wound starts 30% better off.', { tendHeal: 0.3 }),
  P('medicine', 7, 'triage', 'Triage', 'Tends twice as many wounds a day.', { care: 1 }),
  P('scavenging', 4, 'light_step', 'Light step', '30% less trouble on a search.', { scavDanger: -0.3 }),
  P('scavenging', 4, 'deep_pockets', 'Deep pockets', 'Brings home 15% more.', { scav: 0.15 }),
  P('scavenging', 7, 'ghost', 'Ghost', 'Half the trouble on a search.', { scavDanger: -0.5 }),
  P('scavenging', 7, 'packrat', 'Packrat', 'Brings home 30% more.', { scav: 0.3 }),
  P('social', 4, 'easy_talker', 'Easy talker', 'Radio work goes 30% further: a clear signal at dusk (pack names, tighter counts) without a lookout.', { radio: 0.3 }),
  P('social', 4, 'good_listener', 'Good listener', 'Counselling goes half again as deep: from Social 4 it clears the worst thought outright.', { counsel: 0.5 }),
  P('social', 7, 'the_voice', 'The voice', 'Radio work goes 60% further: a clear signal at dusk even on a bad day.', { radio: 0.6 }),
  P('social', 7, 'anchor', 'Anchor', 'Everyone else in the house: mood +4.', { aura: 4 }),
];

export const PERKS: Record<string, PerkDef> = Object.fromEntries(PERK_LIST.map((p) => [p.id, p]));
export const PERK_TIERS = [4, 7] as const;
export function perksFor(skill: SkillId, tier: 4 | 7) {
  return PERK_LIST.filter((p) => p.skill === skill && p.tier === tier);
}
