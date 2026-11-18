// Traits: fourteen, each one a decision (docs/research/19b-simplify-survivors.md). The desc says what it does
// and then what to do about it: who goes on the wall, who goes out, who you counsel, who eats more.
// Pure ±mood and ±work% traits were cut; old saves map them in migrateTraits (src/sim/survivors.ts).

export interface TraitDef {
  id: string;
  name: string;
  desc: string; // what it does; the decision it asks for
  accuracy?: number; // additive to hit chance modifier
  breakAt?: number; // shifts mental break threshold
  conflicts?: string[];
  hungerMul?: number;
  healMul?: number;
}

export const TRAITS: Record<string, TraitDef> = {
  // the wall
  steady: { id: 'steady', name: 'Steady hands', desc: 'Aims true, recoil barely moves them, and they see further into the dark. Give them the best gun and the loophole that matters.', accuracy: 0.12, conflicts: ['coward'] },
  coward: { id: 'coward', name: 'Coward', desc: 'Breaks sooner and may flee the loophole when the wall goes. Keep them on the firestep.', accuracy: -0.04, breakAt: 6, conflicts: ['steady'] },
  bloodlust: { id: 'bloodlust', name: 'Bloodthirsty', desc: 'Lifts after a kill-heavy night but may fire on a Hold order. The wall suits them; a quiet post does not.', conflicts: ['gentle'] },
  gentle: { id: 'gentle', name: 'Gentle', desc: 'Every one of them was somebody: kills and cruel choices weigh on them. Keep them off the wall when you can and counsel them after.', conflicts: ['bloodlust'] },
  // the mind
  ironwill: { id: 'ironwill', name: 'Iron will', desc: 'Hardly ever breaks and holds when the wall buckles. Leave them on the worst post; they are the last to need counsel.', breakAt: -12, conflicts: ['fragile'] },
  fragile: { id: 'fragile', name: 'Fragile', desc: 'Breaks sooner and worse. Counsel them first after a bad night.', breakAt: 10, conflicts: ['ironwill'] },
  drinker: { id: 'drinker', name: 'Drinker', desc: 'Mood falls without a round from the still, and they may binge when they break. Pour one, or counsel them.' },
  // the house
  kind: { id: 'kind', name: 'Kind', desc: 'Friendships grow fast and they never start a fight. Put them beside the fragile; cruel choices weigh on them.', conflicts: ['abrasive'] },
  abrasive: { id: 'abrasive', name: 'Abrasive', desc: 'Starts fights and lashes out when they break. Keep them apart from rivals; counsel them before they snap.', conflicts: ['kind'] },
  secretive: { id: 'secretive', name: 'Secretive', desc: 'Might hide a bite after a search. Look them over when they come home.' },
  // the body
  tough: { id: 'tough', name: 'Tough', desc: 'Wounds land lighter and heal faster; pain and long shifts slow them less. Send them where it hurts.', healMul: 1.2 },
  bigeater: { id: 'bigeater', name: 'Big eater', desc: 'Eats 1.6 rations a day. The mouth to weigh when the larder is short.', hungerMul: 1.6, conflicts: ['ascetic'] },
  ascetic: { id: 'ascetic', name: 'Lean', desc: 'Gets by on 0.7 rations. Cheap to keep through a hungry week.', hungerMul: 0.7, conflicts: ['bigeater'] },
  greenthumb: { id: 'greenthumb', name: 'Green thumb', desc: 'The garden grows half again for them. They are the one to put on Food.' },
};

export const TRAIT_IDS = Object.keys(TRAITS);

/** Old trait ids (before the cut to fourteen): merged into the trait with the same decision, or null (dropped). */
export const OLD_TRAITS: Record<string, string | null> = {
  nightowl: 'steady', jittery: 'coward', grim: 'fragile', faithful: 'gentle', hardworker: 'tough',
  optimist: null, teetotal: null, lazy: null, slowhealer: null, tinkerer: null,
};
