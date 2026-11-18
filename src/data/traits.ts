import type { SkillId } from '../types';

export interface TraitDef {
  id: string;
  name: string;
  desc: string;
  mood?: number; // permanent mood offset
  accuracy?: number; // additive to hit chance modifier
  work?: number; // work speed multiplier delta
  breakAt?: number; // shifts mental break threshold
  conflicts?: string[];
  skill?: Partial<Record<SkillId, number>>;
  hungerMul?: number;
  healMul?: number;
}

// Kept to ~24 so each one is legible and actually changes stories.
export const TRAITS: Record<string, TraitDef> = {
  steady: { id: 'steady', name: 'Steady hands', desc: 'Does not shake. Better aim, especially when it is bad.', accuracy: 0.12, conflicts: ['jittery'] },
  jittery: { id: 'jittery', name: 'Jittery', desc: 'Hands shake since the Turn. Worse aim, worse when the wall is breaking.', accuracy: -0.1, conflicts: ['steady'] },
  ironwill: { id: 'ironwill', name: 'Iron will', desc: 'Will not break. Mental breaks are much rarer.', breakAt: -12, conflicts: ['fragile'] },
  fragile: { id: 'fragile', name: 'Fragile', desc: 'Holding together with tape. Breaks sooner.', breakAt: 10, conflicts: ['ironwill'] },
  optimist: { id: 'optimist', name: 'Stubborn hope', desc: 'Somehow still believes. +8 mood.', mood: 8, conflicts: ['grim'] },
  grim: { id: 'grim', name: 'Grim', desc: 'Expects the worst and finds it. -8 mood.', mood: -8, conflicts: ['optimist'] },
  drinker: { id: 'drinker', name: 'Drinker', desc: 'Needs a drink. Mood suffers without liquor; may binge.', conflicts: ['teetotal'] },
  teetotal: { id: 'teetotal', name: 'Dry', desc: 'Twelve years sober and counting. Hates being around drunks.', conflicts: ['drinker'] },
  hardworker: { id: 'hardworker', name: 'Shift worker', desc: 'Everybody works a shift. +20% work.', work: 0.2, conflicts: ['lazy'] },
  lazy: { id: 'lazy', name: 'Idle', desc: 'Finds reasons to sit. -20% work.', work: -0.2, conflicts: ['hardworker'] },
  kind: { id: 'kind', name: 'Kind', desc: 'Lifts others. Friendships grow faster; never insults.', conflicts: ['abrasive'] },
  abrasive: { id: 'abrasive', name: 'Abrasive', desc: 'Says what he thinks. Starts fights.', conflicts: ['kind'] },
  bloodlust: { id: 'bloodlust', name: 'Bloodthirsty', desc: 'Feels better after a kill-heavy night. Unsettles others.', conflicts: ['gentle'] },
  gentle: { id: 'gentle', name: 'Gentle', desc: 'Every one of them was somebody. Killing weighs on them.', conflicts: ['bloodlust'] },
  tough: { id: 'tough', name: 'Tough', desc: 'Wounds land lighter and heal faster; pain and long shifts slow them less. Send them where it hurts.', healMul: 1.2 },
  slowhealer: { id: 'slowhealer', name: 'Slow healer', desc: 'Old or sickly. Wounds heal slowly.', healMul: 0.6 },
  bigeater: { id: 'bigeater', name: 'Big eater', desc: 'Eats for two.', hungerMul: 1.6 },
  ascetic: { id: 'ascetic', name: 'Lean', desc: 'Gets by on little.', hungerMul: 0.7 },
  faithful: { id: 'faithful', name: 'Faithful', desc: 'Prays. Takes comfort in burials and in the Parish.', mood: 2 },
  secretive: { id: 'secretive', name: 'Secretive', desc: 'Keeps things to themself. Might hide a bite.' },
  nightowl: { id: 'nightowl', name: 'Night owl', desc: 'Sharper after dark. Better aim on the wall at night.', accuracy: 0.06 },
  greenthumb: { id: 'greenthumb', name: 'Green thumb', desc: 'The garden grows half again for them.' },
  tinkerer: { id: 'tinkerer', name: 'Tinkerer', desc: 'Can fix anything with wire and spite.', skill: { building: 2 } },
  coward: { id: 'coward', name: 'Coward', desc: 'Flinches when they reach the wall. May flee the line.', accuracy: -0.04, breakAt: 6 },
};

export const TRAIT_IDS = Object.keys(TRAITS);
