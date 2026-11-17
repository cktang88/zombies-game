import type { Survivor, SkillId, Thought, Wound, BodyPart, Scar } from '../types';
import { G, R, uid, log } from '../state';
import { TRAITS, TRAIT_IDS } from '../data/traits';
import { FIRST_M, FIRST_F, LAST, BEFORE, OUTBREAK, NICKS } from '../data/names';

export const SKILLS: SkillId[] = ['shooting', 'building', 'crafting', 'medicine', 'scavenging', 'farming', 'social'];
// sprites by sex and age bracket (young <30, mid <55, old)
const SPRITES: Record<string, string[]> = {
  m0: ['surv_smg', 'surv_m_young'], m1: ['surv_rifle', 'surv_m_mid', 'surv_m_big'], m2: ['surv_shotgun', 'surv_m_old'],
  f0: ['surv_idle', 'surv_f_young', 'surv_pistol'], f1: ['surv_f_mid', 'surv_f_native', 'surv_pistol'], f2: ['surv_f_old'],
};
export function pickSprite(sex: 'm' | 'f', age: number) {
  const list = SPRITES[sex + (age < 30 ? 0 : age < 55 ? 1 : 2)];
  const used = new Set(G.survivors.map((x) => x.sprite));
  const fresh = list.filter((x) => !used.has(x));
  return R.pick(fresh.length ? fresh : list);
}

export const PART_NAMES: Record<BodyPart, string> = {
  head: 'head', torso: 'torso', larm: 'left arm', rarm: 'right arm', lleg: 'left leg', rleg: 'right leg',
};

export function displayName(s: Survivor) {
  return s.nick ? `${s.name.split(' ')[0]} "${s.nick}" ${s.name.split(' ').slice(1).join(' ')}` : s.name;
}
export function first(s: Survivor) {
  return s.nick ?? s.name.split(' ')[0];
}
export function they(s: Survivor) {
  return s.sex === 'm' ? 'he' : 'she';
}
export function their(s: Survivor) {
  return s.sex === 'm' ? 'his' : 'her';
}
export function them(s: Survivor) {
  return s.sex === 'm' ? 'him' : 'her';
}

export function makeSurvivor(opts: Partial<Survivor> = {}): Survivor {
  const sex = opts.sex ?? (R.chance(0.5) ? 'm' : 'f');
  const firstName = R.pick(sex === 'm' ? FIRST_M : FIRST_F);
  const lastName = opts.name ? '' : R.pick(LAST);
  let age = R.int(19, 66);
  let before = R.pick(BEFORE);
  for (let i = 0; i < 10 && ((before.minAge && age < before.minAge) || (before.maxAge && age > before.maxAge)); i++) before = R.pick(BEFORE);
  if (before.minAge && age < before.minAge) age = before.minAge + R.int(0, 8);
  const skills = {} as Record<SkillId, number>;
  for (const k of SKILLS) skills[k] = Math.max(0, Math.min(10, Math.round(R.gauss(2, 1.4))));
  for (const [k, v] of Object.entries(before.skills)) skills[k as SkillId] = Math.min(10, skills[k as SkillId] + (v ?? 0));
  const traits: string[] = [];
  const nTraits = R.chance(0.3) ? 3 : 2;
  while (traits.length < nTraits) {
    const t = R.pick(TRAIT_IDS);
    if (traits.includes(t) || traits.some((x) => TRAITS[x].conflicts?.includes(t))) continue;
    traits.push(t);
  }
  for (const t of traits) for (const [k, v] of Object.entries(TRAITS[t].skill ?? {})) skills[k as SkillId] = Math.min(10, skills[k as SkillId] + (v ?? 0));
  const passions = R.shuffle([...SKILLS]).slice(0, R.int(1, 2));
  const s: Survivor = {
    id: uid('s'),
    name: `${firstName} ${lastName}`.trim(),
    nick: R.chance(0.15) ? R.pick(NICKS) : undefined,
    age,
    sex,
    sprite: '',
    before: before.text,
    outbreak: R.pick(OUTBREAK),
    traits,
    skills,
    passions,
    hunger: 0.8,
    rest: 0.8,
    mood: 50,
    thoughts: [],
    wounds: [],
    scars: [],
    rel: {},
    job: 'rest',
    weapon: null,
    armor: null,
    kills: 0,
    daysSurvived: 0,
    arrivedDay: G.day,
    breakState: null,
    infection: 0,
    isLeader: false,
    tales: [],
    ...opts,
  };
  if (!s.sprite) s.sprite = pickSprite(s.sex, s.age);
  return s;
}

export function living() {
  return G.survivors.filter((s) => !s.dead);
}
export function byId(id: string) {
  return G.survivors.find((s) => s.id === id) ?? G.graves.find((s) => s.id === id);
}
export function leader() {
  return living().find((s) => s.isLeader);
}

// ---------- thoughts & mood ----------
export function addThought(s: Survivor, t: Omit<Thought, 'stack'>, maxStack = 3) {
  const same = s.thoughts.filter((x) => x.id === t.id && x.about === t.about);
  if (same.length >= maxStack) {
    same[0].days = Math.max(same[0].days, t.days);
    return;
  }
  s.thoughts.push({ ...t });
}

export function hasTrait(s: Survivor, t: string) {
  return s.traits.includes(t);
}

export function pain(s: Survivor) {
  return s.wounds.reduce((a, w) => a + w.severity * (w.kind === 'fracture' ? 1.4 : 1), 0);
}

export interface MoodPart { label: string; v: number }
export function moodBreakdown(s: Survivor): MoodPart[] {
  const parts: MoodPart[] = [{ label: 'Baseline: the end of the world', v: 40 }];
  for (const t of s.traits) if (TRAITS[t].mood) parts.push({ label: TRAITS[t].name, v: TRAITS[t].mood! });
  if (s.hunger < 0.1) parts.push({ label: 'Starving', v: -25 });
  else if (s.hunger < 0.35) parts.push({ label: 'Hungry', v: -10 });
  else if (s.hunger > 0.85) parts.push({ label: 'Well fed', v: 4 });
  if (s.rest < 0.2) parts.push({ label: 'Exhausted', v: -14 });
  else if (s.rest < 0.45) parts.push({ label: 'Tired', v: -6 });
  const p = pain(s);
  if (p > 0.05) parts.push({ label: p > 1 ? 'Agonizing pain' : p > 0.5 ? 'Serious pain' : 'Pain', v: -Math.round(Math.min(30, p * 22)) });
  if (s.infection > 0.3) parts.push({ label: 'Fever. Sweet smell on the breath.', v: -12 });
  const lover = Object.entries(s.rel).find(([id, r]) => (r.bond === 'lover' || r.bond === 'spouse') && byId(id) && !byId(id)!.dead);
  if (lover) parts.push({ label: `Together with ${first(byId(lover[0])!)}`, v: 8 });
  if (hasTrait(s, 'drinker') && !G.flags[`drank_${s.id}`]) parts.push({ label: 'Needs a drink', v: -6 });
  if (G.weather === 'cold' && G.stores.fuel <= 0) parts.push({ label: 'Freezing in the dark', v: -10 });
  if (G.weather === 'snow') parts.push({ label: 'First snow', v: hasTrait(s, 'optimist') ? 3 : -3 });
  for (const t of s.thoughts) parts.push({ label: t.label, v: Math.round(t.mood) });
  return parts;
}

export function computeMood(s: Survivor) {
  s.mood = Math.max(0, Math.min(100, moodBreakdown(s).reduce((a, p) => a + p.v, 0)));
  return s.mood;
}

export function breakThresholds(s: Survivor) {
  const shift = s.traits.reduce((a, t) => a + (TRAITS[t].breakAt ?? 0), 0);
  return { minor: 28 + shift, major: 15 + shift, extreme: 6 + shift };
}

export function moodWord(m: number) {
  if (m >= 80) return 'Steady';
  if (m >= 60) return 'Holding on';
  if (m >= 40) return 'Frayed';
  if (m >= 25) return 'Breaking';
  if (m >= 12) return 'Near the edge';
  return 'Gone hollow';
}

// ---------- capability ----------
export function workMult(s: Survivor) {
  let m = 1;
  for (const t of s.traits) m += TRAITS[t].work ?? 0;
  m -= Math.min(0.7, pain(s) * 0.4);
  for (const sc of s.scars) m += sc.work ?? 0;
  if (s.rest < 0.25) m -= 0.2;
  if (s.hunger < 0.15) m -= 0.25;
  if (s.mood < 25) m -= 0.15;
  return Math.max(0.1, m);
}

export function skillOf(s: Survivor, k: SkillId) {
  return s.skills[k] * (s.passions.includes(k) ? 1.15 : 1);
}

// 0..1 rough accuracy factor used for both the player's spread and the guards' hit chance
export function aimFactor(s: Survivor) {
  let a = 0.45 + s.skills.shooting * 0.05;
  for (const t of s.traits) a += TRAITS[t].accuracy ?? 0;
  for (const sc of s.scars) a += sc.accuracy ?? 0;
  const armHurt = s.wounds.filter((w) => w.part === 'larm' || w.part === 'rarm').reduce((x, w) => x + w.severity, 0);
  a -= armHurt * 0.25;
  if (s.wounds.some((w) => w.part === 'head')) a -= 0.06;
  if (s.mood < 20) a -= 0.08;
  if (s.rest < 0.25) a -= 0.06;
  if (G.flags[`inspired_${s.id}`]) a += 0.2;
  return Math.max(0.1, Math.min(1.2, a));
}

export function canFight(s: Survivor) {
  if (s.dead) return false;
  if (s.breakState && ['catatonic', 'wander', 'sulk', 'away'].includes(s.breakState.kind)) return false;
  return pain(s) < 1.25;
}

export function canWork(s: Survivor) {
  if (s.dead) return false;
  if (s.breakState) return false;
  return pain(s) < 1.0;
}

// ---------- wounds ----------
const WOUND_LABEL: Record<Wound['kind'], string> = {
  bite: 'bite', scratch: 'scratches', laceration: 'gash', fracture: 'fracture', burn: 'burn', gunshot: 'gunshot wound', bruise: 'bruising',
};
export function woundLabel(w: Wound) {
  return `${WOUND_LABEL[w.kind]} (${PART_NAMES[w.part]})`;
}

export function randomPart(): BodyPart {
  return R.weighted(['head', 'torso', 'larm', 'rarm', 'lleg', 'rleg'] as BodyPart[], (p) => (p === 'torso' ? 3 : p === 'head' ? 0.8 : 1.5))!;
}

export function wound(s: Survivor, kind: Wound['kind'], severity: number, part = randomPart()) {
  const tough = hasTrait(s, 'tough') ? 0.75 : 1;
  const armor = s.armor ? 0.7 : 1;
  const sev = Math.min(1, severity * tough * (kind === 'bite' ? 1 : armor));
  const w: Wound = {
    part, kind, severity: sev,
    bleeding: kind !== 'bruise' && kind !== 'burn' && kind !== 'fracture' && sev > 0.2,
    infected: kind === 'bite' ? R.chance(0.9) : false,
    tended: false,
    dayGot: G.day,
  };
  s.wounds.push(w);
  return w;
}

export function isBitten(s: Survivor) {
  return s.wounds.some((w) => w.kind === 'bite' && w.infected);
}

export function addScar(s: Survivor, sc: Scar) {
  s.scars.push(sc);
}

// ---------- relationships ----------
export function rel(a: Survivor, b: Survivor) {
  if (!a.rel[b.id]) a.rel[b.id] = { opinion: Math.round(R.gauss(5, 15)) };
  return a.rel[b.id];
}

export function bondBetween(a: Survivor, b: Survivor) {
  return a.rel[b.id]?.bond;
}

export function changeOpinion(a: Survivor, b: Survivor, d: number) {
  const r = rel(a, b);
  r.opinion = Math.max(-100, Math.min(100, r.opinion + d));
}

export function setBond(a: Survivor, b: Survivor, bond: NonNullable<ReturnType<typeof bondBetween>>, reverse = bond) {
  rel(a, b).bond = bond;
  rel(b, a).bond = reverse;
}

export function closeTo(s: Survivor) {
  return living().filter((o) => o.id !== s.id && ((s.rel[o.id]?.opinion ?? 0) > 40 || !!s.rel[o.id]?.bond && s.rel[o.id]?.bond !== 'rival'));
}

// ---------- death ----------
export function killSurvivor(s: Survivor, cause: string, epitaph?: string) {
  if (s.dead) return;
  s.dead = { day: G.day, cause, epitaph: epitaph ?? defaultEpitaph(s) };
  s.job = 'rest';
  if (s.weapon) s.weapon = null;
  G.graves.push(s);
  G.survivors = G.survivors.filter((x) => x.id !== s.id);
  log('death', `${displayName(s)} died: ${cause}.`);
  for (const o of living()) {
    const r = o.rel[s.id];
    const bond = r?.bond;
    if (bond === 'lover' || bond === 'spouse') addThought(o, { id: 'lost_love', label: `${first(s)} is gone`, mood: -30, days: 12, about: s.id }, 1);
    else if (bond === 'sibling' || bond === 'parent' || bond === 'child') addThought(o, { id: 'lost_family', label: `My ${bond} ${first(s)} died`, mood: -26, days: 10, about: s.id }, 1);
    else if (bond === 'rival') addThought(o, { id: 'rival_died', label: `${first(s)} is dead. Good.`, mood: 4, days: 3, about: s.id }, 1);
    else if ((r?.opinion ?? 0) > 30) addThought(o, { id: 'friend_died', label: `Friend ${first(s)} died`, mood: -14, days: 7, about: s.id }, 1);
    else addThought(o, { id: 'ally_died', label: `${first(s)} died`, mood: -5, days: 4, about: s.id }, 1);
  }
  if (s.isLeader) {
    s.isLeader = false;
    const next = living().sort((a, b) => b.skills.social + b.skills.shooting - (a.skills.social + a.skills.shooting))[0];
    if (next) {
      next.isLeader = true;
      log('event', `${displayName(next)} took up the leadership of the house. Nobody voted.`);
    }
  }
}

function defaultEpitaph(s: Survivor) {
  const bits = [];
  if (s.tales.length) bits.push(s.tales[s.tales.length - 1]);
  if (s.kills > 30) bits.push(`Put down ${s.kills} of the Turned.`);
  bits.push(`Held on ${s.daysSurvived} days after the Turn.`);
  return bits.join(' ');
}

export function tale(s: Survivor, text: string) {
  s.tales.push(text);
  if (s.tales.length > 8) s.tales.shift();
}
