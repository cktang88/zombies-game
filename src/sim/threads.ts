// Radio threads: multi-day objectives with a deadline and a reward (design 06, #6).
// A thread starts from an incident (accept or decline), shows in the Threads list
// with a countdown, offers a "deliver" incident when its objective is met, and
// fails with a story consequence if the deadline passes.
import type { Survivor } from '../types';
import { G, R, log, add, pay, rep, ICE_DAY } from '../state';
import { living, first, displayName, makeSurvivor, addThought, wound, byId, tale, they } from './survivors';
import { buildingLevel } from './day';
import { tip } from './calendar';
import { type Incident, shiftRep, admit, lowestSpotlight } from './incident';

export interface ThreadState { id: string; stage: number; started: number; deadline: number; progress: number; done?: 'won' | 'failed' }

interface ThreadDef {
  id: string;
  title: string;
  /** Can this thread be offered today? */
  canStart: () => boolean;
  /** Days from acceptance to deadline (or an absolute day via deadlineAt). */
  days?: number;
  deadlineAt?: () => number;
  startTitle: string;
  startText: () => string;
  accept: string;
  acceptHint: string;
  /** What the player must do, shown in the Threads list. */
  objective: (t: ThreadState) => string;
  ready: (t: ThreadState) => boolean;
  deliverTitle: string;
  deliverText: (t: ThreadState) => string;
  deliverLabel: string;
  /** Pay the cost and grant the reward; return outcome text. May advance a stage instead of finishing. */
  deliver: (t: ThreadState) => string;
  fail: () => string;
  stages?: number;
}

export function threads(): ThreadState[] {
  try { return JSON.parse((G.flags.threads as string) ?? '[]') as ThreadState[]; } catch { return []; }
}
function saveThreads(list: ThreadState[]) {
  G.flags.threads = JSON.stringify(list);
}
function get(id: string) {
  return threads().find((t) => t.id === id);
}
function update(id: string, f: (t: ThreadState) => void) {
  const list = threads();
  const t = list.find((x) => x.id === id);
  if (t) f(t);
  saveThreads(list);
}
const active = () => threads().filter((t) => !t.done);
export const threadsWon = () => threads().filter((t) => t.done === 'won').length;

const DEFS: ThreadDef[] = [
  {
    id: 'earl',
    title: 'Earl\'s insulin',
    canStart: () => G.day >= 3 && G.day <= 20,
    days: 5,
    startTitle: 'A voice from the Manor',
    startText: () => `Channel 9, late, an old man's voice, very precise: "This is Dr. Earl Haugland. I was the doctor in this town for thirty-one years. I am in the attic of St. Aubin Manor with four residents and the Bergquist girl, who is nine and diabetic, and I am out of insulin, and I am out of almost everything. If anyone can get three units of anything useful to the Manor fire door, I will owe you more than I can say. Over."\n\nHe repeats it every hour, word for word.`,
    accept: '"We hear you, Doc. Hold on."',
    acceptHint: 'Gather 3 medicine within 5 days, then send it.',
    objective: () => `Get 3 medicine to the Manor fire door (have ${Math.floor(G.stores.meds)}/3).`,
    ready: () => G.stores.meds >= 3,
    deliverTitle: 'The Manor fire door',
    deliverText: () => 'We have the medicine. The Manor is a bad place: the residents are still in residence. Someone has to carry it to the fire door and knock.',
    deliverLabel: 'Carry 3 medicine to the Manor',
    deliver: () => {
      pay({ meds: 3 });
      const runner = lowestSpotlight(living().filter((s) => !s.child));
      if (runner && R.chance(0.25)) wound(runner, 'scratch', R.range(0.15, 0.3));
      const earl = makeSurvivor({ name: 'Earl Haugland', sex: 'm', age: 71, traits: ['kind', 'slowhealer'], before: 'The town doctor for thirty-one years. Delivered half of Vessey, and buried a fair share of it.', outbreak: 'Held the Manor attic with four residents and a diabetic girl.' });
      earl.skills.medicine = 8; earl.skills.social = Math.max(earl.skills.social, 5); earl.skills.shooting = 1;
      admit(earl, 'gate');
      tale(earl, 'Kept five people alive in the Manor attic on a radio and a prayer.');
      if (runner) tale(runner, 'Carried medicine through the Manor to Dr. Haugland\'s fire door.');
      log('tale', `${runner ? displayName(runner) : 'We'} carried medicine to the Manor fire door. Two days later Dr. Earl Haugland walked up Ferry Road with the Bergquist girl on his back and asked if we needed a doctor.`);
      return `Two days later Dr. Earl Haugland walked up Ferry Road with the Bergquist girl on his back. "She's with the Parish now. I'm with you, if you'll have me. I'm told you need a doctor."${runner && runner.wounds.some((w) => w.dayGot === G.day) ? ` ${first(runner)} came back scratched.` : ''}`;
    },
    fail: () => {
      for (const s of living()) addThought(s, { id: 'earl_quiet', label: 'The Manor radio went quiet', mood: -4, days: 4 }, 1);
      log('event', 'Dr. Haugland stopped calling from the Manor attic. The last thing he said was the date.');
      return 'Channel 9 has been quiet since yesterday. Nobody wants to be the one to say it.';
    },
  },
  {
    id: 'guard',
    title: 'The Guard\'s frequency',
    canStart: () => G.day >= 5 && G.day <= 18,
    days: 8,
    startTitle: 'A burst of static',
    startText: () => `${first(lowestSpotlight())} was scanning the dial and caught it: a clipped voice, military, gone in four seconds. "...Corliss Two, rotating to schedule Bravo, net open oh-two-hundred..." Then nothing.\n\nThe Guard is still out there, on a frequency that changes. To hear them again we would need a real mast on the chimney and somebody on the set, night after night.`,
    accept: 'Raise the mast and listen',
    acceptHint: 'Build the radio mast and keep someone on the Radio job for 3 days (8 days).',
    objective: (t) => `${buildingLevel('radio') ? 'Mast up.' : 'Build the radio mast.'} Someone on the Radio job: ${Math.min(3, t.progress)}/3 days.`,
    ready: (t) => buildingLevel('radio') > 0 && t.progress >= 3,
    deliverTitle: 'Corliss Two',
    deliverText: () => '"Ferry Road, this is Corliss Two. We read you. Authenticate: what\'s the name of the bowling alley on Main?"\n\nSomebody knows: the Pin Palace. A pause. Then a younger voice, off-book.',
    deliverLabel: '"Pin Palace. Who is this?"',
    deliver: () => {
      add('rifle', 30); add('meds', 4);
      log('lore', 'Cpl. Kyle Strand of the Guard spoke to us on the Corliss net. "The Line isn\'t opening. Not for containment, not for anything. I\'m sorry." He dropped a bundle off the bridge stub that afternoon.');
      return `"Corporal Strand. Kyle. My mom's at the Parish, if you see her..." He told us the truth: the Line isn't opening. Not for containment, not for anything. That afternoon a bundle came down off the bridge stub on a rope: rifle rounds and medicine.` + shiftRep('county', 10);
    },
    fail: () => {
      log('lore', 'The Guard\'s frequency rotated away from us. We never found it again.');
      return 'The Guard changed schedule. Whatever was on schedule Bravo, we will never hear it.';
    },
  },
  {
    id: 'peltier',
    title: 'Peltier\'s last seat',
    canStart: () => G.day >= 6 && G.day <= ICE_DAY - 7 && rep('ferry') > -20,
    deadlineAt: () => ICE_DAY - 1,
    startTitle: 'Old Peltier\'s offer',
    startText: () => `Peltier, at the landing, not trading. "My boat makes one more trip after the Doucettes quit. Down the east channel, past the Line, to my sister's in Ashby. I got room for one more body. One." He holds up a finger as if we might not understand. "Twenty cans of fuel to the boathouse before the ice, and that seat's yours. You decide who."`,
    accept: '"Hold the seat."',
    acceptHint: `Deliver 20 fuel before the ice (by day ${ICE_DAY - 1}). One of us leaves on the morning of the Crossing.`,
    objective: () => `Stage 20 fuel at the Halvorsen boathouse (have ${Math.floor(G.stores.fuel)}/20).`,
    ready: () => G.stores.fuel >= 20,
    deliverTitle: 'The boathouse',
    deliverText: () => 'Twenty jerry cans on the sled. The boathouse is down by the landing, past the Doucette dock.',
    deliverLabel: 'Haul 20 fuel to the boathouse',
    deliver: () => {
      pay({ fuel: 20 });
      G.flags.evacSeat = true;
      log('event', 'We hauled twenty cans of fuel to the Halvorsen boathouse. Old Peltier is holding one seat for us.');
      return 'Peltier counted the cans and spat in the river for luck. "One seat. Morning of the ice. Don\'t be late and don\'t bring two."' + shiftRep('ferry', 10);
    },
    fail: () => `Peltier's boat went down the east channel without us. Somebody else's somebody got the seat.` + shiftRep('ferry', -10),
  },
  {
    id: 'union_gen',
    title: 'The Local 41 boiler house',
    canStart: () => G.day >= 5 && rep('union') > -40 && G.day <= 30,
    days: 6,
    startTitle: 'A runner from the mill',
    startText: () => `A Local 41 runner, out of breath: "Boiler house generator threw a rod. We've got the steam but not the pumps, and if the pumps stop the pipes freeze and then we all freeze. Wick says: twenty-five salvage. Bearings, gaskets, sheet steel, anything off an engine. She says she'll remember who came through. She remembers everything."`,
    accept: '"Tell Wick we\'re on it."',
    acceptHint: 'Gather 25 salvage within 6 days.',
    objective: () => `Send 25 salvage to the mill (have ${Math.floor(G.stores.salvage)}/25).`,
    ready: () => G.stores.salvage >= 25,
    deliverTitle: 'Parts for the mill',
    deliverText: () => 'Twenty-five salvage in feed sacks, oily and heavy. The Union sled can take them up Mill Road.',
    deliverLabel: 'Send 25 salvage on the sled',
    deliver: () => {
      pay({ salvage: 25 });
      G.fort.maxHp += 60; G.fort.hp += 60;
      log('event', 'We sent a sled of engine salvage to the Local 41 boiler house. The pumps run. Wick sent steel plate back on the same sled.');
      return 'The sled came back that afternoon loaded with steel plate. A note in grease pencil: "PUMPS RUNNING. WE OWE YOU. — D.W." (+60 wall)' + shiftRep('union', 25);
    },
    fail: () => {
      log('event', 'The Local 41 boiler house pipes froze. Somebody at the mill will remember that we did not come.');
      return 'Word came down Mill Road: the pipes in the boiler house froze. They are burning pallets in the canteen now.' + shiftRep('union', -15);
    },
  },
  {
    id: 'parish_soup',
    title: 'Soup at six',
    canStart: () => G.day >= 4 && rep('parish') > -40 && G.day <= 30,
    days: 7,
    stages: 2,
    startTitle: 'Pastor Engvall asks',
    startText: () => `Ruth Engvall on AM 880, then in person, rubbing her hands over our stove: "Soup at six, every night. A hundred and thirty mouths, and it's mostly water now. If you could send eight portions, twice before Sunday, we'd make it to Advent. I'm not above begging. I gave that up in October."`,
    accept: '"Twice before Sunday."',
    acceptHint: 'Send 8 food, two times, within 7 days.',
    objective: (t) => `Send 8 food to the Parish kitchen (${t.stage}/2 sent; have ${Math.floor(G.stores.food)}).`,
    ready: () => G.stores.food >= 8 + living().length * 2,
    deliverTitle: 'The Parish kitchen',
    deliverText: (t) => `Eight portions for the Parish pot${t.stage ? ', the second time' : ''}. Our own pantry will feel it.`,
    deliverLabel: 'Send 8 food to the Parish',
    deliver: (t) => {
      pay({ food: 8 });
      update('parish_soup', (x) => { x.stage++; });
      if (t.stage + 1 < 2) {
        return 'Ruth sent the empty pot back with a dish towel over it, washed.' + shiftRep('parish', 5);
      }
      add('meds', 4);
      for (const s of living()) for (const w of s.wounds) if (w.kind !== 'bite') w.tended = true;
      for (const s of living()) addThought(s, { id: 'soup', label: 'We fed the Parish', mood: 5, days: 4 }, 1);
      log('event', 'We fed the Parish kitchen twice before Sunday. Ruth Engvall sent a nurse and a box of medicine back up Ferry Road.');
      return 'They made it to Advent. Ruth sent one of her nurses up Ferry Road with a box of medicine; she changed every dressing in the house before she left.' + shiftRep('parish', 25);
    },
    fail: () => `The Parish ran short before Sunday. Ruth did not ask again.` + shiftRep('parish', -10),
  },
];

/** A visible list of the threads in play, for the day screen and the epilogue. */
export function activeThreads(): { title: string; text: string; deadlineDay: number }[] {
  return active().map((t) => {
    const d = DEFS.find((x) => x.id === t.id)!;
    return { title: d.title, text: d.objective(t), deadlineDay: t.deadline };
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Tiny HTML block for the day screen's report column. */
export function threadsHtml(): string {
  const list = activeThreads();
  if (!list.length) return '';
  return `<div class="threads">${list.map((t) => {
    const left = t.deadlineDay - G.day;
    return `<div class="thread ${left <= 1 ? 'urgent' : ''}"${tip(`<b>${esc(t.title)}</b><br>${esc(t.text)}`)}><span class="tico">◆</span><span class="tt">${esc(t.title)}</span><b class="tl">${left > 0 ? `${left}d` : 'today'}</b></div>`;
  }).join('')}</div>`;
}

function startIncident(d: ThreadDef): Incident {
  return {
    id: `thread_${d.id}`,
    cooldown: 4,
    weight: () => (!get(d.id) && active().length < 2 && d.canStart() ? 0.5 : 0),
    make: () => ({
      id: `thread_${d.id}`, title: d.startTitle, text: d.startText(),
      choices: [
        { label: d.accept, hint: d.acceptHint, effect: 'yes' },
        { label: 'Not our fight', effect: 'no' },
      ],
    }),
    resolve: (c) => {
      const list = threads();
      if (c === 1) {
        list.push({ id: d.id, stage: 0, started: G.day, deadline: G.day, progress: 0, done: 'failed' });
        saveThreads(list);
        return 'We let it go. It is a long winter and a short list of things we can carry.';
      }
      const deadline = d.deadlineAt ? d.deadlineAt() : G.day + (d.days ?? 5);
      list.push({ id: d.id, stage: 0, started: G.day, deadline, progress: 0 });
      saveThreads(list);
      log('event', `New thread: ${d.title}.`);
      return `(Thread: ${d.title}. ${d.objective(list[list.length - 1])} By ${deadline - G.day} days from now.)`;
    },
  };
}

function deliverIncident(d: ThreadDef): Incident {
  return {
    id: `deliver_${d.id}`,
    cooldown: 1,
    weight: () => {
      const t = get(d.id);
      return t && !t.done && d.ready(t) && G.day <= t.deadline ? 9 : 0;
    },
    make: () => {
      const t = get(d.id)!;
      return {
        id: `deliver_${d.id}`, title: d.deliverTitle, text: d.deliverText(t),
        choices: [{ label: d.deliverLabel, effect: 'yes' }, { label: 'Not today', hint: `${t.deadline - G.day} days left.`, effect: 'no' }],
      };
    },
    resolve: (c) => {
      const t = get(d.id);
      if (!t || c === 1) return 'Tomorrow, then.';
      if (!d.ready(t)) return 'When we went to load it, we did not have enough after all.';
      const out = d.deliver(t);
      const after = get(d.id)!;
      if (!d.stages || after.stage >= d.stages) update(d.id, (x) => { x.done = 'won'; });
      return out;
    },
  };
}

/** Ending-adjacent: on the morning of the Crossing, Peltier's seat. */
const seatIncident: Incident = {
  id: 'peltier_seat',
  weight: () => (G.flags.evacSeat && !G.flags.seatUsed && G.day === ICE_DAY && living().length >= 2 ? 20 : 0),
  make: () => {
    const cand = living().slice(0, 6);
    return {
      id: 'peltier_seat', title: 'One seat',
      text: `Morning of the ice. Old Peltier's boat is at the landing with the engine running, low in the water, his sister's name painted on the bow. "One," he says. "Like I said. Decide."\n\nTonight the river freezes and they walk across. Whoever gets in this boat will not be here for it.`,
      data: { cand: cand.map((s) => s.id) },
      choices: [
        ...cand.map((s) => ({ label: `${first(s)} goes`, hint: `${s.age}${s.child ? ', a child' : ''}. ${s.tales.length ? s.tales[s.tales.length - 1] : s.before}`, effect: 'go' })),
        { label: 'Nobody. Give it to someone at the landing.', hint: 'A stranger lives instead.', effect: 'none' },
      ],
    };
  },
  resolve: (c, d) => {
    G.flags.seatUsed = true;
    const ids = d.cand as string[];
    if (c >= ids.length) {
      for (const s of living()) addThought(s, { id: 'gave_seat', label: 'We gave the seat away', mood: 4, days: 4 }, 1);
      log('event', 'We gave Peltier\'s last seat to a Halvorsen grandmother at the landing.');
      return 'A Halvorsen grandmother got in, with a cat in a carrier. She waved all the way down the channel.';
    }
    const s = byId(ids[c]);
    if (!s || s.dead) return '';
    evacuate(s);
    for (const o of living()) addThought(o, { id: 'seat', label: `${first(s)} got out`, mood: (o.rel[s.id]?.opinion ?? 0) > 30 ? 6 : 2, days: 5 }, 1);
    log('event', `${displayName(s)} took Old Peltier's last seat down the east channel, the morning the river froze.`);
    return `${first(s)} got in the boat. ${cap(they(s))} did not look back until the bend, and then ${they(s)} did, and held up one hand.`;
  },
};
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

/** Remove a survivor from the house alive: they left on a boat and live on in the epilogue. */
export function evacuate(s: Survivor) {
  tale(s, `Took Old Peltier's last seat down the east channel, the morning the river froze.`);
  G.survivors = G.survivors.filter((x) => x !== s);
  const list = evacuees();
  list.push(s);
  G.flags.evacuees = JSON.stringify(list);
  if (s.isLeader) {
    s.isLeader = false;
    const next = living().sort((a, b) => b.skills.social - a.skills.social)[0];
    if (next) next.isLeader = true;
  }
}
export function evacuees(): Survivor[] {
  try { return JSON.parse((G.flags.evacuees as string) ?? '[]') as Survivor[]; } catch { return []; }
}

export const THREAD_INCIDENTS: Incident[] = [...DEFS.map(startIncident), ...DEFS.map(deliverIncident), seatIncident];

/** Dawn: advance progress, fail expired threads. */
export function threadTick(): string[] {
  const out: string[] = [];
  const list = threads();
  for (const t of list) {
    if (t.done) continue;
    const d = DEFS.find((x) => x.id === t.id);
    if (!d) continue;
    if (t.id === 'guard' && buildingLevel('radio') && living().some((s) => s.job === 'radio')) t.progress++;
    if (G.day > t.deadline) {
      t.done = 'failed';
      saveThreads(list);
      out.push(`${d.title}: ${d.fail()}`);
    }
  }
  saveThreads(list);
  return out;
}
