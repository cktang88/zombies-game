import type { Survivor, SkillId, Thought, Wound, BodyPart, Scar } from '../types';
import { G, R, uid, log } from '../state';
import { TRAITS, TRAIT_IDS } from '../data/traits';
import { weaponClass, type WeaponClass } from '../data/weapons';
import { FIRST_M, FIRST_F, LAST, BEFORE, OUTBREAK, NICKS } from '../data/names';

export const SKILLS: SkillId[] = ['shooting', 'building', 'crafting', 'medicine', 'scavenging', 'farming', 'social', 'psych'];
// sprites by sex and age bracket (young <30, mid <55, old)
const SPRITES: Record<string, string[]> = {
  m0: ['surv_smg', 'surv_m_young'], m1: ['surv_rifle', 'surv_m_mid', 'surv_m_big'], m2: ['surv_shotgun', 'surv_m_old'],
  f0: ['surv_idle', 'surv_f_young', 'surv_pistol'], f1: ['surv_f_mid', 'surv_f_native', 'surv_pistol'], f2: ['surv_f_old'],
};
// Sprites made by makeSurvivor() but not yet in G.survivors (a pair of arrivals built together); cleared on use.
const pendingSprites: string[] = [];
/**
 * A sprite for a new survivor, unique among the living household where possible: a free one for their sex and
 * age first, then a free one of their sex at any age, and only then a repeat.
 */
export function pickSprite(sex: 'm' | 'f', age: number, exclude: Iterable<string> = []) {
  const bracket = SPRITES[sex + (age < 30 ? 0 : age < 55 ? 1 : 2)];
  const used = new Set([...G.survivors.filter((x) => !x.dead).map((x) => x.sprite), ...pendingSprites.filter((x) => !G.survivors.some((y) => y.sprite === x)), ...exclude]);
  const anyAge = [0, 1, 2].flatMap((b) => SPRITES[sex + b]);
  const fresh = bracket.filter((x) => !used.has(x));
  const freshAny = anyAge.filter((x) => !used.has(x));
  const pick = R.pick(fresh.length ? fresh : freshAny.length ? freshAny : bracket);
  pendingSprites.push(pick);
  if (pendingSprites.length > 2) pendingSprites.shift();
  return pick;
}
/** Give any living survivor who shares a sprite with an earlier one a fresh sprite, where one is free. */
export function dedupeSprites() {
  const seen = new Set<string>();
  for (const s of living()) {
    if (seen.has(s.sprite)) {
      const others = living().filter((o) => o !== s).map((o) => o.sprite);
      const anyAge = [0, 1, 2].flatMap((b) => SPRITES[s.sex + b]);
      if (anyAge.some((x) => !others.includes(x))) s.sprite = pickSprite(s.sex, s.age, others);
    }
    seen.add(s.sprite);
  }
}

export const PART_NAMES: Record<BodyPart, string> = {
  head: 'head', torso: 'torso', larm: 'left arm', rarm: 'right arm', lleg: 'left leg', rleg: 'right leg',
};

export function displayName(s: Survivor) {
  if (s.titles?.length && s.titles.length > 0 && !s.nick) return `${s.name}, ${s.titles[s.titles.length - 1]}`;
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
  if (!opts.attrs) {
    s.attrs = baseAttrs(s);
    for (const [k, v] of Object.entries(before.attrs ?? {})) s.attrs[k as AttrId] = Math.min(10, s.attrs[k as AttrId] + (v ?? 0));
  }
  s.xp ??= {};
  s.prof ??= baseProf(s, before.prof);
  s.base ??= { ...s.skills, ...s.attrs };
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
  const parts: MoodPart[] = [{ label: 'Baseline: the end of the world', v: 46 }];
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
  const shift = s.traits.reduce((a, t) => a + (TRAITS[t].breakAt ?? 0), 0) - (attr(s, 'courage') - 4) * 0.8;
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
  m -= Math.min(0.7, pain(s) * 0.4 * (1.16 - attr(s, 'grit') * 0.04));
  for (const sc of s.scars) m += sc.work ?? 0;
  if (s.rest < 0.25) m -= 0.2;
  if (s.hunger < 0.15) m -= 0.25;
  if (s.mood < 25) m -= 0.15;
  return Math.max(0.1, m);
}

export function skillOf(s: Survivor, k: SkillId) {
  return s.skills[k] * (s.passions.includes(k) ? 1.15 : 1);
}

// ---------- progression: skills, attributes and training grow with use ----------
// API for other systems (night/combat, events, runs):
//   gainXp(s, key, amount)  award XP. key = any SkillId, 'courage', 'grit' or 'heavy' (crew-served weapons).
//                           Passions give x1.5, Grim/Idle x0.8. Level-up at xp >= 100 * (level + 1), max 10.
//                           Negative amounts shake it (a trauma can drop courage a level).
//                           Level-ups queue a line for the report; drainLevelUps() collects them.
//   level(s, key)           the current 0..10 value of a skill, attribute or training track.
//   attr(s, 'courage'|'grit')  attribute 0..10 (defaults derived from traits for old saves).
//   xpProgress(s, key)      0..1 toward the next level (for UI bars).
// Rough XP scale: a working hour ~ 6 XP, a kill ~ 3 shooting XP, a held hard night ~ 15-30 courage XP.
// Effects here: grit cuts fatigue drain (sim/day.ts) and the pain penalty in workMult; courage shifts break
// thresholds. Combat may read attr(s, 'courage') for panic/flee and level(s, 'heavy') for emplacement handling.
export type AttrId = 'courage' | 'grit';
export type ProgressKey = SkillId | AttrId | 'heavy' | `prof_${WeaponClass}`;
export const WEAPON_CLASSES: WeaponClass[] = ['handgun', 'smg', 'shotgun', 'rifle', 'assault', 'marksman', 'heavy', 'launcher', 'bow', 'improvised', 'melee'];
// short labels for cards and sheets (data/weapons.ts CLASS_NAMES has the long ones)
export const CLASS_SHORT: Record<WeaponClass, string> = { handgun: 'pistol', smg: 'SMG', shotgun: 'shotgun', rifle: 'rifle', assault: 'assault', marksman: 'scoped', heavy: 'MG', launcher: 'launcher', bow: 'bow', improvised: 'shop gun', melee: 'melee' };
// Weapon-class proficiency (0..10), separate from shooting. Combat: read prof(s, weaponClass(w.def)) for handling
// (reload/spread/jam). Award with gainProf(s, cls, xp) (same XP curve as skills; a kill ~ 3 XP).
export function prof(s: Survivor, cls: WeaponClass) {
  return s.prof?.[cls] ?? 0;
}
export function gainProf(s: Survivor, cls: WeaponClass, xp: number) {
  return gainXp(s, `prof_${cls}`, xp);
}
/** Proficiency with the gun this survivor carries (null if unarmed). */
export function heldProf(s: Survivor): { cls: WeaponClass; v: number } | null {
  const w = G.weapons.find((x) => x.uid === s.weapon);
  if (!w) return null;
  const cls = weaponClass(w.def);
  return { cls, v: prof(s, cls) };
}
function baseProf(s: Survivor, grants: Partial<Record<WeaponClass, number>> = {}) {
  const out: Partial<Record<string, number>> = {};
  for (const c of WEAPON_CLASSES) {
    const v = Math.round(s.skills.shooting * 0.35 + R.gauss(0, 0.8) + (grants[c] ?? 0));
    out[c] = Math.max(0, Math.min(10, v));
  }
  return out;
}
export const ATTRS: AttrId[] = ['courage', 'grit'];
export const ATTR_NAMES: Record<AttrId, string> = { courage: 'Courage', grit: 'Grit' };
const levelUps: string[] = [];

export function baseAttrs(s: Pick<Survivor, 'traits'>, roll = true): { courage: number; grit: number } {
  let courage = roll ? R.gauss(4, 1.4) : 4, grit = roll ? R.gauss(4, 1.4) : 4;
  const t = (id: string) => s.traits.includes(id);
  if (t('ironwill')) courage += 2;
  if (t('coward')) courage -= 3;
  if (t('fragile')) courage -= 1;
  if (t('jittery')) courage -= 1;
  if (t('bloodlust')) courage += 1;
  if (t('tough')) grit += 2;
  if (t('slowhealer')) grit -= 1;
  if (t('hardworker')) grit += 1;
  if (t('lazy')) grit -= 1;
  const c = (v: number) => Math.max(0, Math.min(10, Math.round(v)));
  return { courage: c(courage), grit: c(grit) };
}
export function attr(s: Survivor, a: AttrId): number {
  if (!s.attrs) s.attrs = baseAttrs(s, false);
  return s.attrs[a] ?? 4;
}
export function level(s: Survivor, k: ProgressKey): number {
  if (k === 'courage' || k === 'grit') return attr(s, k);
  if (k === 'heavy') return s.training?.heavy ?? 0;
  if (k.startsWith('prof_')) return s.prof?.[k.slice(5)] ?? 0;
  return s.skills[k as SkillId] ?? 0;
}
function setLevel(s: Survivor, k: ProgressKey, v: number) {
  v = Math.max(0, Math.min(10, v));
  if (k === 'courage' || k === 'grit') {
    attr(s, k);
    s.attrs![k] = v;
  } else if (k === 'heavy') (s.training ??= {}).heavy = v;
  else if (k.startsWith('prof_')) (s.prof ??= {})[k.slice(5)] = v;
  else s.skills[k as SkillId] = v;
}
export function xpNeeded(lvl: number) {
  return 100 * (lvl + 1);
}
export function xpProgress(s: Survivor, k: ProgressKey) {
  const lvl = level(s, k);
  return lvl >= 10 ? 1 : Math.max(0, Math.min(1, (s.xp?.[k] ?? 0) / xpNeeded(lvl)));
}
const LEVEL_WORDS: Partial<Record<ProgressKey, string>> = {
  shooting: 'shooting straight', building: 'building', crafting: 'the bench work', medicine: 'stitching', scavenging: 'finding things',
  farming: 'growing things', social: 'talking to people', psych: 'talking people down', courage: 'standing the wall', grit: 'going without', heavy: 'working the gun nest',
};
const KEY_NAMES: Record<string, string> = { courage: 'Courage', grit: 'Grit', heavy: 'Heavy weapons', psych: 'Counsel' };
export function progressName(k: ProgressKey) {
  if (k.startsWith('prof_')) return CLASS_SHORT[k.slice(5) as WeaponClass] ?? k.slice(5);
  return KEY_NAMES[k] ?? k[0].toUpperCase() + k.slice(1);
}
export function gainXp(s: Survivor, k: ProgressKey, amount: number): boolean {
  if (s.dead || !amount) return false;
  s.xp ??= {};
  let lvl = level(s, k);
  if (amount < 0) {
    // a shake: lose progress, and a level if there is none left to lose
    const cur = (s.xp[k] ?? 0) + amount;
    if (cur < 0 && lvl > 0) {
      setLevel(s, k, lvl - 1);
      s.xp[k] = Math.max(0, xpNeeded(lvl - 1) + cur);
      levelUps.push(`${first(s)} came out of it shaken. ${progressName(k)} ${lvl - 1}.`);
    } else s.xp[k] = Math.max(0, cur);
    return false;
  }
  if (lvl >= 10) return false;
  let mult = 1;
  if ((s.passions as string[]).includes(k)) mult *= 1.5;
  if (s.traits.includes('grim') || s.traits.includes('lazy')) mult *= 0.8;
  s.xp[k] = (s.xp[k] ?? 0) + amount * mult;
  let up = false;
  while (lvl < 10 && (s.xp[k] ?? 0) >= xpNeeded(lvl)) {
    s.xp[k] = (s.xp[k] ?? 0) - xpNeeded(lvl);
    lvl++;
    setLevel(s, k, lvl);
    up = true;
  }
  if (up) levelUps.push(`${first(s)} got better at ${LEVEL_WORDS[k] ?? `the ${progressName(k)}`}: ${progressName(k)} ${lvl}.`);
  return up;
}
/** Level-up lines queued since the last call (shown in the dusk and dawn reports). */
export function drainLevelUps(): string[] {
  return levelUps.splice(0);
}
/** Old saves: fill in psych, attributes, xp and base values. Safe to call repeatedly. */
export function migrateSurvivor(s: Survivor) {
  if (s.skills.psych == null) s.skills.psych = Math.max(0, Math.min(10, Math.round(s.skills.social * 0.6)));
  s.attrs ??= baseAttrs(s, false);
  s.xp ??= {};
  s.prof ??= baseProf(s);
  s.base ??= { ...s.skills, ...s.attrs };
}
/** The survivor's best skills, highest first. */
export function topSkills(s: Survivor, n = 2) {
  return [...SKILLS].sort((a, b) => s.skills[b] - s.skills[a] || (s.passions.includes(b) ? 1 : 0) - (s.passions.includes(a) ? 1 : 0)).slice(0, n);
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
  if (s.dead || s.child) return false;
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
  if (s.armor && !cause.includes('turned')) G.flags.armorStock = ((G.flags.armorStock as number) ?? 0) + 1;
  s.armor = null;
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

export function grantTitle(s: Survivor, t: string) {
  s.titles ??= [];
  if (s.titles.includes(t)) return false;
  s.titles.push(t);
  log('tale', `${s.name} has earned a name around the house: "${t}".`);
  return true;
}

// Kill-count and deed titles, checked at dawn
export function checkTitles(s: Survivor) {
  if (s.kills >= 50) grantTitle(s, 'the Butcher of Ferry Road');
  else if (s.kills >= 20) grantTitle(s, 'Steady on the Wall');
  if (s.scars.some((x) => x.label.startsWith('lost'))) grantTitle(s, s.scars.find((x) => x.label.includes('arm')) ? 'One-Arm' : 'Peg');
  if (s.tales.filter((t) => t.startsWith('Bitten')).length >= 2) grantTitle(s, 'Twice-Bitten');
  if (s.tales.some((t) => t.startsWith('Held the line alone'))) grantTitle(s, 'Gatekeeper');
  if (s.tales.some((t) => t.startsWith('Dropped a Ferryman'))) grantTitle(s, 'Ferryman\'s Fee');
  if (s.tales.some((t) => t.startsWith('Took') && t.includes('bone saw'))) grantTitle(s, 'Sawbones');
  if (s.daysSurvived >= 20) grantTitle(s, 'Old Hand');
}

// ---------- counselling (the Counsel job; incidents may call counsel() too) ----------
/** True if someone talked this survivor down today or yesterday (breaks at dawn are much less likely). */
export function counselled(s: Survivor) {
  const d = G.flags[`counseled_${s.id}`] as number | undefined;
  return d !== undefined && d >= G.day - 1;
}
/**
 * Talk a survivor down. `by` is the counsellor (null = an incident or stranger, psych 4 assumed).
 * Removes or halves their worst negative thought, adds a small "talked it through" lift, may lift a sulk or
 * catatonia, and marks them counselled (dawn break chance x0.35). Awards psych XP to `by`. Returns a report line.
 */
export function counsel(by: Survivor | null, t: Survivor, power = 1): string {
  const skill = by ? skillOf(by, 'psych') : 4;
  const worst = t.thoughts.filter((x) => x.mood < 0).sort((a, b) => a.mood - b.mood)[0];
  let what = '';
  if (worst) {
    if (skill * power >= 6 || worst.mood > -6) {
      t.thoughts = t.thoughts.filter((x) => x !== worst);
      what = ` and got "${worst.label.toLowerCase()}" off ${their(t)} chest`;
    } else {
      worst.mood = Math.round(worst.mood * 0.5);
      what = ` about "${worst.label.toLowerCase()}"`;
    }
  }
  addThought(t, { id: 'counselled', label: by ? `Talked it through with ${first(by)}` : 'Talked it through', mood: Math.round(3 + skill * 0.6 * power), days: 2 }, 1);
  G.flags[`counseled_${t.id}`] = G.day;
  let lifted = '';
  if (t.breakState && (t.breakState.kind === 'sulk' || t.breakState.kind === 'catatonic') && R.chance(0.15 + skill * 0.06 * power)) {
    t.breakState = null;
    lifted = ` ${first(t)} got up afterwards.`;
  }
  if (by) {
    changeOpinion(t, by, 4);
    gainXp(by, 'psych', 12);
  }
  computeMood(t);
  return `${by ? first(by) : 'Someone'} sat with ${first(t)}${what}.${lifted}`;
}
