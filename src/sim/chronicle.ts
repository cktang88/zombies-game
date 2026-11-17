// Chronicle prose: tiny per-kind template grammars with trait-flavoured adverbs.
// Every pick is seeded from (kind, survivor id, day, salt) so the same event
// always reads the same way, across reloads and re-renders.
import type { Survivor } from '../types';
import { G } from '../state';
import { Rng } from '../rng';

function hash(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A small seeded picker, stable for a given key. */
export function seeded(key: string) {
  return new Rng(hash(`${G?.seed ?? 0}:${key}`));
}

const nm = (s: Survivor) => s.nick ?? s.name.split(' ')[0];
const full = (s: Survivor) => (s.nick ? `${s.name.split(' ')[0]} "${s.nick}" ${s.name.split(' ').slice(1).join(' ')}` : s.name);
const he = (s: Survivor) => (s.sex === 'm' ? 'he' : 'she');
const his = (s: Survivor) => (s.sex === 'm' ? 'his' : 'her');
const him = (s: Survivor) => (s.sex === 'm' ? 'him' : 'her');
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

// Trait-flavoured manner. First matching trait wins (stable order).
const ADVERBS: Record<string, string[]> = {
  kind: ['quietly', 'gently', 'with a hand on someone\'s shoulder'],
  abrasive: ['cursing', 'swearing the whole time', 'loud about it'],
  steady: ['without hurry', 'steady as a plumb line', 'not wasting a round'],
  jittery: ['shaking', 'with both hands', 'teeth chattering'],
  grim: ['without a word', 'like it was owed', 'jaw set'],
  optimist: ['humming', 'still joking', 'somehow smiling'],
  faithful: ['praying under their breath', 'murmuring the Lord\'s Prayer', 'crossing themselves after'],
  bloodlust: ['grinning', 'too eager', 'counting out loud'],
  gentle: ['apologizing to each one', 'eyes wet', 'flinching every time'],
  coward: ['white-faced', 'half-hidden behind the boards', 'shaking but there'],
  ironwill: ['like a fence post', 'not giving an inch', 'jaw set'],
  drinker: ['half-drunk', 'smelling of the still', 'loose and reckless'],
  nightowl: ['wide awake', 'seeing better than any of us', 'sharp in the dark'],
  hardworker: ['like it was a shift', 'without a break', 'like punching a clock'],
  lazy: ['once somebody made them', 'complaining', 'in their own time'],
  tough: ['bleeding and not minding', 'like an ox', 'shrugging it off'],
  secretive: ['saying nothing', 'keeping it to themself', 'without explaining'],
};
const PLAIN = ['without fuss', 'in the cold', 'as best they could', 'hands numb'];

export function manner(s: Survivor, salt = '') {
  const r = seeded(`adv:${s.id}:${salt}`);
  for (const t of s.traits) if (ADVERBS[t]) return fix(r.pick(ADVERBS[t]), s);
  return r.pick(PLAIN);
}
// fix generic "themself/their" to the survivor's pronouns
function fix(x: string, s: Survivor) {
  return x.replace(/themself/g, `${him(s)}self`).replace(/their breath/g, `${his(s)} breath`).replace(/crossing themselves/g, `crossing ${him(s)}self`).replace(/once somebody made them/g, `once somebody made ${him(s)}`);
}

type Tpl = (s: Survivor, x: Record<string, string>) => string;
function pick(kind: string, s: Survivor, salt: string, tpls: Tpl[], x: Record<string, string> = {}) {
  const r = seeded(`${kind}:${s.id}:${G?.day ?? 0}:${salt}`);
  return r.pick(tpls)(s, x);
}

// ---------- arrival ----------
export function arrivalLine(s: Survivor, how = 'gate', by?: Survivor) {
  const tpls: Tpl[] = how === 'found' ? [
    (a) => `${full(a)} came home with ${by ? nm(by) : 'the scavengers'}, ${manner(a, 'arr')}, carrying everything ${he(a)} owned in a pillowcase.`,
    (a) => `${by ? nm(by) : 'The scavengers'} brought ${full(a)} home. ${cap(he(a))} had not spoken to anyone in nine days and did not stop talking until midnight.`,
    (a) => `${full(a)} was found alive and came back with us. ${a.before}`,
  ] : how === 'run' ? [
    (a) => `${full(a)} walked home behind the run, ${manner(a, 'arr')}. ${a.before}`,
    (a) => `${full(a)} followed the run home through the dusk. ${a.before}`,
  ] : how === 'parish' ? [
    (a) => `Pastor Engvall sent ${full(a)} to us with a note pinned to ${his(a)} coat: "Feed this one. R.E."`,
    (a) => `${full(a)} came from the Parish gym with a sack of bread and a blessing ${he(a)} did not ask for.`,
  ] : [
    (a) => `${full(a)} joined us. ${a.before}`,
    (a) => `${full(a)} came through the gate ${manner(a, 'arr')} and took a place by the stove. ${a.before}`,
    (a) => `We let ${full(a)} in. ${cap(he(a))} slept fourteen hours on the kitchen floor. ${a.before}`,
    (a) => `${full(a)}, ${a.age}, is one of us now. ${a.before}`,
  ];
  return pick('arrival', s, how, tpls);
}

// ---------- death ----------
export function deathLine(s: Survivor, cause: string) {
  const tpls: Tpl[] = [
    (a) => `${full(a)} died ${cause}.`,
    (a) => `We lost ${full(a)}, ${cause}. ${a.daysSurvived} days after the Turn.`,
    (a) => `${full(a)} is gone: ${cause}. ${a.tales.length ? `We will remember that ${nm(a)} ${lowerFirst(a.tales[a.tales.length - 1])}` : 'Nobody had time to learn much about ' + him(a) + '.'}`,
  ];
  return pick('death', s, cause, tpls);
}

// ---------- battle ----------
export function battleLine(s: Survivor, kills: number, salt = '') {
  const tpls: Tpl[] = kills >= 12 ? [
    (a, x) => `${nm(a)} carried the night, ${manner(a, 'bat')}: ${x.k} of them in the road by ${his(a)} hand.`,
    (a, x) => `If the wall held, it was ${nm(a)}. ${x.k} put down, ${manner(a, 'bat')}.`,
    (a, x) => `${nm(a)} did not leave the wall until dawn. ${x.k} put down.`,
  ] : [
    (a, x) => `${nm(a)} did the most shooting, ${manner(a, 'bat')}. ${x.k} put down.`,
    (a, x) => `${nm(a)} put down ${x.k}, ${manner(a, 'bat')}.`,
  ];
  return pick('battle', s, salt, tpls, { k: String(kills) });
}

// ---------- bond ----------
export function bondLine(a: Survivor, b: Survivor, kind: 'lover' | 'friend' | 'rival' | 'breakup' | 'makeup') {
  const T: Record<string, Tpl[]> = {
    lover: [
      (x) => `${full(x)} and ${full(b)} have been sharing a cot by the stove. Nobody says anything about it.`,
      (x) => `${nm(x)} and ${nm(b)} were seen holding hands on the night watch. Nobody teased them.`,
    ],
    friend: [
      (x) => `${nm(x)} and ${nm(b)} have become friends, the way people do on a wall.`,
      (x) => `${nm(x)} saves the second cup of coffee for ${nm(b)} now.`,
    ],
    rival: [
      (x) => `${full(x)} and ${full(b)} can no longer stand to be in the same room.`,
      (x) => `${nm(x)} and ${nm(b)} have stopped speaking. They eat at opposite ends of the table.`,
    ],
    breakup: [
      (x) => `${nm(x)} and ${nm(b)} are not together anymore. ${nm(x)} moved ${his(x)} blanket to the cold room.`,
      (x) => `Whatever ${nm(x)} and ${nm(b)} had, it broke in the night, loudly, and everyone heard.`,
    ],
    makeup: [
      (x) => `${nm(x)} and ${nm(b)} fought, and then talked until the stove went out, and in the morning it was all right.`,
      (x) => `${nm(x)} said sorry first. ${nm(b)} said it back.`,
    ],
  };
  return pick(`bond_${kind}`, a, b.id, T[kind]);
}

// ---------- break ----------
export function breakLine(s: Survivor, kind: string) {
  const T: Record<string, Tpl[]> = {
    desert: [
      (a) => `${full(a)} took a pack of food and medicine and left in the night. Gone east, maybe to the ferry.`,
      (a) => `${full(a)} went over the back fence before dawn with a pack. ${cap(he(a))} did not look back.`,
    ],
    panic: [
      (a) => `${nm(a)} came apart on the wall, firing at shadows.`,
      (a) => `${nm(a)} broke on the wall and burned through ${his(a)} ammunition at nothing.`,
    ],
    catatonic: [
      (a) => `${full(a)} went somewhere inside and did not come out for two days.`,
      (a) => `${full(a)} sat in the cold room facing the wall. Nobody could reach ${him(a)}.`,
    ],
    wander: [
      (a) => `${full(a)} walked out past the wall, toward the river.`,
      (a) => `${full(a)} opened the gate before dawn and walked down Ferry Road like it was a Sunday.`,
    ],
    resolve: [
      (a) => `${full(a)} pulled ${him(a)}self back from the edge, ${manner(a, 'res')}.`,
      (a) => `${full(a)} was coming apart, and then wasn't.`,
    ],
  };
  return pick(`break_${kind}`, s, kind, T[kind] ?? T.resolve);
}

function lowerFirst(x: string) {
  return x[0].toLowerCase() + x.slice(1);
}

// ---------- morning report ----------
/** One or two lines summarising who carried the night and who broke. */
export function morningSummary(killsBy: Record<string, number>, people: Survivor[], panicked: Survivor[], dead: string[]) {
  const out: string[] = [];
  const ranked = Object.entries(killsBy).map(([id, k]) => ({ s: people.find((p) => p.id === id), k })).filter((x) => x.s).sort((a, b) => b.k - a.k);
  if (ranked.length && ranked[0].k > 0) out.push(battleLine(ranked[0].s!, ranked[0].k, 'morning'));
  if (ranked.length > 1 && ranked[1].k >= 6) out.push(`${nm(ranked[1].s!)} was beside ${him(ranked[0].s!)}, ${manner(ranked[1].s!, 'm2')}.`);
  for (const p of panicked) out.push(breakLine(p, 'panic'));
  if (!ranked.length && !dead.length) out.push('Nobody on the wall fired a shot worth remembering. A quiet night, which is its own kind of gift.');
  return out;
}

// ---------- epilogue fates ----------
export type Fate = 'went' | 'stayed' | 'held' | 'dead' | 'left';
export function fateLine(s: Survivor, fate: Fate, ending: string) {
  const r = seeded(`fate:${s.id}:${ending}:${fate}`);
  const t = s.tales.length ? lowerFirst(s.tales[s.tales.length - 1]).replace(/\.$/, '') : '';
  const older = s.tales.length > 1 ? lowerFirst(r.pick(s.tales.slice(0, -1))).replace(/\.$/, '') : '';
  const where = ending === 'ferry' ? 'across the river' : ending === 'mill' ? 'at the mill' : 'on Ferry Road';
  if (fate === 'dead') {
    return r.pick([
      `${full(s)} did not see the end of it. ${s.dead?.cause ? `Died ${s.dead.cause}.` : ''} ${t ? `They still tell how ${he(s)} ${t}.` : ''}`,
      `${full(s)} is buried behind the house, or burned on the road. ${t ? `What people remember: ${he(s)} ${t}.` : `${s.daysSurvived} days.`}`,
    ]).trim();
  }
  if (fate === 'left') return `${full(s)} left in the night, and nobody knows. Some say ${he(s)} made the ferry. Some say otherwise.`;
  if (fate === 'stayed') {
    return r.pick([
      `${full(s)} stayed on Ferry Road when the boat pushed off, ${manner(s, 'fate')}. The light was on in the house for three more nights. Then it wasn't.`,
      `${full(s)} stood at the landing and waved until the boat was gone in the dark. ${t ? `This was the one who ${t}.` : ''} Nobody on the boat talks about it.`,
      `${full(s)} gave up ${his(s)} seat. "Somebody has to keep the stove lit." The ice came four days later.`,
    ]).trim();
  }
  // survived: went / held
  const base = r.pick([
    `${full(s)} lived. ${t ? `For years ${he(s)} would not talk about the time ${he(s)} ${t}, and then one winter ${he(s)} did.` : `${cap(he(s))} never spoke much about November.`}`,
    `${full(s)} lived, ${where}. ${older ? `${cap(he(s))} kept one story for the grandkids: how ${he(s)} ${older}.` : t ? `${cap(he(s))} kept one story: how ${he(s)} ${t}.` : ''}`,
    `${full(s)} made it. ${s.scars.length ? `${cap(his(s))} ${s.scars[0].label} ached every November after.` : `${cap(he(s))} kept a jar of river stones on the windowsill.`} ${t ? `${cap(he(s))} ${t}.` : ''}`,
  ]);
  const tail = s.child ? ` ${cap(he(s))} grew up and, the story goes, drove a ferry.` : '';
  return (base + tail).replace(/\s+/g, ' ').trim();
}
