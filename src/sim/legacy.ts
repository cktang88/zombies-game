// The Legacy (design 06, #11): a Ledger that outlives the save. At any ending or
// game over the player may inscribe up to two survivors; later runs may meet their
// kin at the gate, carrying an heirloom. Milestones unlock starting boons.
// Persisted in localStorage under its own key; every access is guarded.
import type { Survivor } from '../types';
import { G, R, log, newWeapon, rep, docsFound, ICE_DAY } from '../state';
import { WEAPONS } from '../data/weapons';
import { TRAITS } from '../data/traits';
import { FACTIONS } from '../data/lore';
import { living, first, displayName, makeSurvivor, addThought, hasTrait, their, them, changeOpinion } from './survivors';
import { type Incident, cap, pop, admit, standingWord } from './incident';
import { threadsWon, evacuees } from './threads';

const KEY = 'vessey-legacy-v1';

export interface LedgerEntry {
  id: string;
  name: string;
  sex: 'm' | 'f';
  age: number;
  traits: string[];
  before: string;
  tale: string;
  fate: string;
  days: number;
  kills: number;
  heirloom?: { def: string; name: string; kills: number };
  inscribed: string; // calendar date of inscription, for the Ledger view
}
export interface Legacy {
  entries: LedgerEntry[];
  runs: number;
  unlocked: string[];
  chosen: string[];
  best: { days: number; score: number };
}

export const BOONS = [
  { id: 'wall', name: 'Ferry Road wall', desc: 'Start with +60 wall.', how: 'Live through the night of the Crossing.' },
  { id: 'press', name: 'Haugen\'s press', desc: 'Start with the workbench at level 2.', how: 'Reach an ending: the ferry, the mill, Spring, or close the ledger after the ice.' },
  { id: 'dog', name: 'Old dog', desc: 'Start with a dog asleep by the stove.', how: 'Complete two radio threads in one run.' },
];

function blank(): Legacy {
  return { entries: [], runs: 0, unlocked: [], chosen: [], best: { days: 0, score: 0 } };
}
export function loadLegacy(): Legacy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    return { ...blank(), ...(JSON.parse(raw) as Partial<Legacy>) };
  } catch {
    return blank();
  }
}
export function saveLegacy(l: Legacy) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage unavailable: the Ledger is only for this session */ }
}

// ---------- score ----------
export function savedCount(): number {
  const ending = G.flags.ending as string | undefined;
  let n = evacuees().length;
  if (ending === 'ferry' || ending === 'mill') { try { n += (JSON.parse(String(G.flags.endWent ?? '[]')) as string[]).length; } catch { /* */ } }
  else if (ending) n += living().length;
  else if (G.phase !== 'over') n += living().length;
  return n;
}
export function scoreCard() {
  const dead = G.graves.filter((g) => g.dead?.cause !== 'deserted').length;
  const saved = savedCount();
  const docs = docsFound().length;
  const threads = threadsWon();
  const score = Math.max(0, G.day * 10 + saved * 60 + G.stats.kills + G.stats.headshots * 2 + docs * 15 + threads * 40 - dead * 20);
  const rows: [string, string][] = [
    ['Days held', String(G.day)],
    ['People saved', String(saved)],
    ['The dead', String(dead)],
    ['Turned put down', String(G.stats.kills)],
    ['Through the head', String(G.stats.headshots)],
    ['Papers found', String(docs)],
    ['Threads completed', String(threads)],
    ['Standing', FACTIONS.map((f) => `${f.name} ${standingWord(rep(f.id))}`).join(' · ')],
  ];
  const grade = score >= 1300 ? 'They will tell this one at the Legion hall for fifty years.'
    : score >= 850 ? 'Pastor Engvall wrote every name in the registry, and most of them under "living".'
      : score >= 500 ? 'Dolores Wick would call it a fair shift.'
        : score >= 220 ? 'Old Peltier would say you did all right. Old Peltier says that at funerals.'
          : 'The Exposure Register has a page for the house on Ferry Road. It is a short page.';
  return { rows, score, grade };
}

// ---------- end of run ----------
/** Record the run once; returns the names of boons newly unlocked. */
export function recordRun(outcome: 'ending' | 'dead'): string[] {
  if (G.flags.legacyRecorded) return [];
  G.flags.legacyRecorded = true;
  const l = loadLegacy();
  l.runs++;
  const { score } = scoreCard();
  l.best = { days: Math.max(l.best.days, G.day), score: Math.max(l.best.score, score) };
  const fresh: string[] = [];
  const unlock = (id: string) => { if (!l.unlocked.includes(id)) { l.unlocked.push(id); fresh.push(BOONS.find((b) => b.id === id)!.name); } };
  if (G.day > ICE_DAY) unlock('wall');
  if (outcome === 'ending') unlock('press');
  if (threadsWon() >= 2) unlock('dog');
  saveLegacy(l);
  return fresh;
}

const inscribedIds = (): string[] => { try { return JSON.parse((G.flags.inscribed as string) ?? '[]') as string[]; } catch { return []; } };
export const canInscribe = (s: Survivor) => inscribedIds().length < 2 && !inscribedIds().includes(s.id);
export const isInscribed = (s: Survivor) => inscribedIds().includes(s.id);

export function inscribe(s: Survivor, fate: string): boolean {
  if (!canInscribe(s)) return false;
  const l = loadLegacy();
  const gun = G.weapons.find((w) => w.uid === s.weapon && w.name) ?? G.weapons.find((w) => w.name && w.name.startsWith(first(s)));
  const tales = s.tales.filter((x) => !/^(Crossed the St\. Aubin|Stayed on Ferry Road|Stayed behind|Took Old Peltier)/.test(x));
  l.entries.push({
    id: `${G.seed}-${s.id}`,
    name: s.name, sex: s.sex, age: s.age, traits: [...s.traits], before: s.before,
    tale: tales[tales.length - 1] ?? s.tales[s.tales.length - 1] ?? `Held on ${s.daysSurvived} days on Ferry Road.`,
    fate, days: s.daysSurvived, kills: s.kills,
    heirloom: gun ? { def: gun.def, name: gun.name!, kills: gun.kills } : undefined,
    inscribed: new Date().toISOString().slice(0, 10),
  });
  if (l.entries.length > 30) l.entries.shift();
  saveLegacy(l);
  G.flags.inscribed = JSON.stringify([...inscribedIds(), s.id]);
  return true;
}

// ---------- new game ----------
export function setBoon(id: string, on: boolean) {
  const l = loadLegacy();
  if (!l.unlocked.includes(id)) return;
  l.chosen = on ? [...new Set([...l.chosen, id])] : l.chosen.filter((x) => x !== id);
  saveLegacy(l);
}
/** Apply chosen, unlocked boons to a freshly made game. Returns report lines. */
export function applyBoons(): string[] {
  const l = loadLegacy();
  const out: string[] = [];
  for (const id of l.chosen.filter((x) => l.unlocked.includes(x))) {
    if (id === 'wall') { G.fort.maxHp += 60; G.fort.hp += 60; out.push('The wall on Ferry Road is already half built. Somebody started it before us.'); }
    if (id === 'press') {
      const wb = G.buildings.find((b) => b.id === 'workbench');
      if (wb) wb.level = Math.max(wb.level, 2); else G.buildings.push({ id: 'workbench', level: 2 });
      out.push('There is a good reloading press in the Haugen basement. The workbench is ready for rifle rounds.');
    }
    if (id === 'dog') {
      G.flags.dog = R.pick(['Boone', 'Sadie', 'Old Gus', 'Maple']);
      for (const s of living()) addThought(s, { id: 'dog', label: `${G.flags.dog} sleeps by the stove`, mood: 4, days: 30 }, 1);
      out.push(`An old dog named ${G.flags.dog} was waiting on the porch. It knew the house.`);
    }
  }
  return out;
}

// ---------- the heir at the gate ----------
const met = (): string[] => { try { return JSON.parse((G.flags.heirsMet as string) ?? '[]') as string[]; } catch { return []; } };
function kinWord(e: LedgerEntry, heir: Survivor) {
  const f = heir.sex === 'f';
  if (e.age >= 55) return f ? 'grandmother' : 'grandfather';
  if (e.age >= 40) return e.sex === 'f' ? 'mother' : 'father';
  return e.sex === 'f' ? 'aunt' : 'uncle';
}

export const HEIR_INCIDENT: Incident = {
  id: 'heir',
  cooldown: 6,
  weight: () => {
    if (G.day < 4 || pop() >= 9 || met().length >= 2) return 0;
    const l = loadLegacy();
    return l.entries.some((e) => !met().includes(e.id)) ? 0.6 : 0;
  },
  make: () => {
    const l = loadLegacy();
    const left = l.entries.filter((e) => !met().includes(e.id));
    if (!left.length) return null;
    const e = R.pick(left);
    G.flags.heirsMet = JSON.stringify([...met(), e.id]);
    const surname = e.name.split(' ').slice(1).join(' ') || e.name;
    const heir = makeSurvivor({ age: R.int(19, 38) });
    heir.name = `${heir.name.split(' ')[0]} ${surname}`;
    const kin = kinWord(e, heir);
    // one trait carries down the line
    const inherit = e.traits.find((t) => TRAITS[t] && !heir.traits.includes(t) && !heir.traits.some((x) => TRAITS[x].conflicts?.includes(t)));
    if (inherit) heir.traits[heir.traits.length - 1] = inherit;
    const eFirst = e.name.split(' ')[0];
    const deed = e.tale[0].toLowerCase() + e.tale.slice(1).replace(/\.$/, '');
    tale(heir, `Says ${their(heir)} ${kin} ${eFirst} ${deed}.`);
    const loom = e.heirloom && WEAPONS[e.heirloom.def] ? e.heirloom : undefined;
    return {
      id: 'heir', title: 'A name from the Ledger',
      text: `${heir.sex === 'f' ? 'A woman' : 'A man'} at the gate, ${heir.age}, with a face somebody in this house almost recognizes. "${heir.name}. My ${kin} was ${e.name}. ${cap(e.sex === 'f' ? 'she' : 'he')} ${deed}. Everybody in Vessey knew it."${loom ? `\n\nSlung on ${their(heir)} back: a ${WEAPONS[loom.def].name.toLowerCase()} with "${loom.name}" burned into the stock, and ${loom.kills} notches.` : inherit ? `\n\nThere is something of ${eFirst} in ${them(heir)}: ${TRAITS[inherit].name.toLowerCase()}.` : ''}\n\n${heir.before}`,
      data: { heir, loom: loom ?? null, entry: e.name },
      choices: [
        { label: `Let ${heir.name.split(' ')[0]} in`, hint: loom ? 'They bring the heirloom.' : 'Another mouth. Another gun.', effect: 'yes' },
        { label: 'Turn them away', effect: 'no' },
      ],
    };
  },
  resolve: (c, d) => {
    const heir = d.heir as Survivor;
    if (c === 1) {
      log('event', `We turned away ${heir.name}, who said ${their(heir)} people were ${d.entry as string}'s.`);
      return `${heir.name.split(' ')[0]} looked at the house for a long moment, like ${heir.sex === 'f' ? 'she' : 'he'} was memorizing it, and went back down the road.`;
    }
    admit(heir);
    const loom = d.loom as LedgerEntry['heirloom'] | null;
    if (loom) {
      const w = newWeapon(loom.def, 0.9);
      w.name = loom.name; w.kills = loom.kills;
      heir.weapon = w.uid;
      log('tale', `${displayName(heir)} came home to Ferry Road carrying "${loom.name}", ${loom.kills} notches on the stock.`);
    }
    for (const s of living()) if (s !== heir && hasTrait(s, 'faithful')) addThought(s, { id: 'heir', label: 'The names come back', mood: 4, days: 4 }, 1);
    if (living()[0] && living()[0] !== heir) changeOpinion(heir, living()[0], 10);
    return `${heir.name.split(' ')[0]} walked through the house touching the door frames. "${R.pick(['It\'s smaller than in the stories.', 'This is the wall? This is it?', 'They said there was a dog.', 'I always wanted to see it.'])}"`;
  },
};

function tale(s: Survivor, t: string) {
  s.tales.push(t);
}
