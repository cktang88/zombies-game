import type { PendingEvent, Survivor, Res } from '../types';
import { G, R, log, add, has, pay, newWeapon, addRep } from '../state';
import { WEAPONS } from '../data/weapons';
import {
  living, first, displayName, makeSurvivor, addThought, changeOpinion, setBond, wound, killSurvivor, isBitten, byId, tale,
  hasTrait, they, them, their, PART_NAMES, addScar, rel,
} from './survivors';
import { buildingLevel } from './day';

// Incidents: the director draws one (sometimes none) each morning.
interface Incident {
  id: string;
  weight: () => number;
  make: () => PendingEvent | null;
  resolve?: (choice: number, data: Record<string, unknown>) => string;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const pop = () => living().length;
// RimWorld-style population intent: few survivors -> more arrivals
const popIntent = () => [4, 3, 2.2, 1.6, 1.2, 1, 0.7, 0.45, 0.25, 0.1, 0][Math.min(10, pop())];

function lowestSpotlight(list = living()) {
  // favour survivors who have had few stories so far
  return R.weighted(list, (s) => 1 / (1 + s.tales.length))!;
}

function newcomerEvent(id: string, title: string, intro: (n: Survivor) => string, risky = false): Incident {
  return {
    id,
    weight: () => popIntent() * (id === 'family' ? 0.4 : 1),
    make: () => {
      const n = makeSurvivor();
      const bitten = risky && R.chance(0.3);
      return {
        id, title,
        text: `${intro(n)}\n\n${displayName(n)}, ${n.age}. ${n.before} ${n.outbreak}`,
        data: { n, bitten },
        choices: [
          { label: 'Let them in', hint: 'Another mouth. Another gun.', effect: 'accept' },
          { label: 'Check them for bites first', hint: 'Strip search in the cold. They will remember it.', effect: 'check' },
          { label: 'Turn them away', effect: 'refuse' },
        ],
      };
    },
    resolve: (c, d) => {
      const n = d.n as Survivor;
      if (c === 2) {
        log('event', `We turned ${displayName(n)} away at the gate.`);
        for (const s of living()) if (hasTrait(s, 'kind') || hasTrait(s, 'faithful')) addThought(s, { id: 'turned_away', label: 'We turned someone away', mood: -6, days: 4 }, 1);
        return `${first(n)} walked back toward town. Nobody watched ${them(n)} go.`;
      }
      if (c === 1 && d.bitten) {
        log('event', `${displayName(n)} had a bite under ${their(n)} sleeve. We sent ${them(n)} back out.`);
        return `There it was, on ${their(n)} forearm. ${cap(they(n))} did not argue. ${cap(they(n))} just nodded and walked back out.`;
      }
      n.arrivedDay = G.day;
      if (d.bitten) wound(n, 'bite', 0.35, 'larm').hidden = true;
      G.survivors.push(n);
      for (const s of living()) if (s !== n) { rel(s, n); rel(n, s); }
      if (c === 1) {
        changeOpinion(n, living()[0], -10);
        addThought(n, { id: 'strip', label: 'Searched like an animal at the gate', mood: -6, days: 4 }, 1);
      }
      log('arrival', `${displayName(n)} joined us. ${n.before}`);
      return `${first(n)} is one of us now.`;
    },
  };
}

export const INCIDENTS: Incident[] = [
  newcomerEvent('wanderer', 'Someone at the gate', (n) => `A figure on the road at first light, hands up, ${n.sex === 'm' ? 'his' : 'her'} breath smoking. "I'm not bit. I'm not bit. Please."`, true),
  newcomerEvent('ferrycross', 'Off the night ferry', (n) => `The Doucette boat put somebody off at the landing before dawn and went back across without a word. ${cap(n.sex === 'm' ? 'he' : 'she')} walked up to our wall soaked to the waist.`, true),
  {
    id: 'found',
    weight: () => (G.flags.foundSurvivorAt ? 50 : 0),
    make: () => {
      const n = makeSurvivor();
      const at = G.flags.foundSurvivorAt as string;
      const by = byId(G.flags.foundSurvivorBy as string);
      delete G.flags.foundSurvivorAt;
      return {
        id: 'found', title: `Found at ${at}`,
        text: `${by ? first(by) : 'The scavengers'} found someone holed up at ${at}, living on ${R.pick(['communion wafers', 'dog food', 'ketchup packets', 'nothing'])}.\n\n${displayName(n)}, ${n.age}. ${n.before}`,
        data: { n, by: by?.id },
        choices: [{ label: 'Bring them home', effect: 'accept' }, { label: 'We can\'t feed another', effect: 'refuse' }],
      };
    },
    resolve: (c, d) => {
      const n = d.n as Survivor;
      if (c === 1) return `${first(n)} stayed behind. We left ${them(n)} what food we could spare.`;
      G.survivors.push(n);
      const by = byId(d.by as string);
      if (by) {
        changeOpinion(n, by, 30);
        tale(by, `Found ${first(n)} alive in the ruins.`);
      }
      log('arrival', `${displayName(n)} came home with ${by ? first(by) : 'the scavengers'}.`);
      return `${first(n)} is one of us now.`;
    },
  },
  {
    id: 'family',
    weight: () => (pop() < 7 && G.day > 4 ? popIntent() * 0.5 : 0),
    make: () => {
      const a = makeSurvivor({ age: R.int(30, 55) });
      const b = makeSurvivor({ age: R.int(17, 24) });
      b.name = `${b.name.split(' ')[0]} ${a.name.split(' ').slice(1).join(' ')}`;
      return {
        id: 'family', title: 'A parent and a child',
        text: `${displayName(a)} and ${a.sex === 'm' ? 'his' : 'her'} ${b.sex === 'm' ? 'son' : 'daughter'} ${first(b)}, walked in from the Corliss road. They saw the Line. "Nobody's crossing. Nobody's ever crossing."\n\nTwo more mouths, and the kid is ${b.age}.`,
        data: { a, b },
        choices: [{ label: 'Take them both', effect: 'accept' }, { label: 'We can only take one', hint: 'They will not split up.', effect: 'refuse' }],
      };
    },
    resolve: (c, d) => {
      const a = d.a as Survivor, b = d.b as Survivor;
      if (c === 1) { log('event', `A family came to the gate. We had no room.`); return 'They would not split up. They walked on together.'; }
      G.survivors.push(a, b);
      setBond(a, b, 'parent', 'child');
      rel(a, b).opinion = 70; rel(b, a).opinion = 55;
      log('arrival', `${displayName(a)} and ${first(b)} joined us. Family.`);
      return 'They came in together.';
    },
  },
  {
    id: 'trader',
    weight: () => (G.day > 2 ? 1.2 : 0),
    make: () => {
      const wants: Res = R.pick(['fuel', 'food', 'meds', 'light'] as Res[]);
      const offers = R.pick([{ r: 'rifle', n: 18 }, { r: 'shell', n: 20 }, { r: 'parts', n: 6 }, { r: 'meds', n: 3 }, { r: 'food', n: 12 }, { r: 'scrap', n: 20 }].filter((o) => o.r !== wants)) as { r: Res; n: number };
      const price = { fuel: 6, food: 10, meds: 3, light: 40 }[wants as 'fuel'];
      const gun = R.chance(0.3) ? R.pick(['revolver', 'pump', 'hunting', 'smg']) : null;
      return {
        id: 'trader', title: 'Peltier\'s boat',
        text: `Old Peltier tied up at the landing below the house. Ferry families trade with whoever is still breathing. "${R.pick(['Ice is coming. After that I\'m nobody.', 'County boys pay in promises. You pay in goods.', 'Don\'t tell the Union I was here.'])}"\n\nHe wants ${price} ${wants}. He offers ${offers.n} ${offers.r}${gun ? `, or a ${WEAPONS[gun].name.toLowerCase()} for twice the price` : ''}.`,
        data: { wants, price, offers, gun },
        choices: [
          { label: `Trade ${price} ${wants} for ${offers.n} ${offers.r}`, effect: 'a' },
          ...(gun ? [{ label: `Trade ${price * 2} ${wants} for the ${WEAPONS[gun].name.toLowerCase()}`, effect: 'b' }] : []),
          { label: 'Send him on his way', effect: 'c' },
        ],
      };
    },
    resolve: (c, d) => {
      const wants = d.wants as Res, price = d.price as number, offers = d.offers as { r: Res; n: number }, gun = d.gun as string | null;
      const opts = gun ? ['a', 'b', 'c'] : ['a', 'c'];
      const pick = opts[c];
      if (pick === 'a') {
        if (G.stores[wants] < price) return 'We did not have enough. Peltier spat in the river and pushed off.';
        add(wants, -price); add(offers.r, offers.n); addRep('ferry', 8);
        return 'Done. He did not count it twice.';
      }
      if (pick === 'b' && gun) {
        if (G.stores[wants] < price * 2) return 'We did not have enough. Peltier laughed at us.';
        add(wants, -price * 2); newWeapon(gun, R.range(0.6, 0.95)); addRep('ferry', 12);
        log('event', `Bought a ${WEAPONS[gun].name.toLowerCase()} off the Peltier boat.`);
        return 'He handed it over wrapped in a feed sack.';
      }
      return 'He pushed off into the brown water.';
    },
  },
  {
    id: 'kin',
    weight: () => (G.day > 3 ? 0.8 : 0),
    make: () => {
      const s = lowestSpotlight();
      return {
        id: 'kin', title: 'Kin',
        text: `${first(s)} found a house on Birch Street where one of the Turned sits at the kitchen table, hands folded, facing a cold plate. A porch light is on, somehow. There is a full pantry behind it.\n\nIt has not moved. It might be somebody's mother.`,
        data: { s: s.id },
        choices: [
          { label: 'Put it down, take the pantry', hint: '+food. It was somebody.', effect: 'kill' },
          { label: 'Leave it be', hint: 'Walk out, close the door.', effect: 'leave' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!;
      if (c === 0) {
        add('food', 14);
        if (hasTrait(s, 'gentle') || hasTrait(s, 'faithful')) addThought(s, { id: 'kin_killed', label: 'Killed one at its own kitchen table', mood: -12, days: 6 }, 1);
        else addThought(s, { id: 'kin_killed', label: 'The kitchen on Birch Street', mood: -4, days: 3 }, 1);
        log('event', `${displayName(s)} put down the Turned woman on Birch Street and emptied her pantry. +14 food.`);
        return `It didn't fight. It just looked at the door, like it was expecting someone else.`;
      }
      addThought(s, { id: 'kin_spared', label: 'Left the old woman at her table', mood: 3, days: 3 }, 1);
      log('event', `${displayName(s)} left a Turned woman sitting at her table on Birch Street, and switched off the porch light on the way out.`);
      return `${first(s)} switched off the porch light on the way out.`;
    },
  },
  {
    id: 'bite_reveal',
    weight: () => (living().some(isBitten) ? 30 : 0),
    make: () => {
      const s = living().find((x) => isBitten(x) && !G.flags[`biteasked_${x.id}`] && !x.wounds.some((w) => w.hidden));
      if (!s) return null;
      G.flags[`biteasked_${s.id}`] = true;
      const w = s.wounds.find((x) => x.kind === 'bite')!;
      const limb = ['larm', 'rarm', 'lleg', 'rleg'].includes(w.part);
      const docs = living().filter((x) => x !== s).sort((a, b) => b.skills.medicine - a.skills.medicine);
      const doc = docs[0];
      const chance = doc ? Math.min(0.9, 0.35 + doc.skills.medicine * 0.06 + buildingLevel('infirmary') * 0.12) : 0;
      return {
        id: 'bite_reveal', title: `${first(s)} is bitten`,
        text: `The bite is on ${their(s)} ${PART_NAMES[w.part]}. Already the edges are going the color of weak tea, and there's that smell, sweet like bread.\n\nEveryone knows how this goes. ${limb && doc ? `${first(doc)} says if we take the ${PART_NAMES[w.part]} off today, now, there's a chance. Maybe ${Math.round(chance * 100)}%.` : 'There is nothing to cut off.'}`,
        data: { s: s.id, part: w.part, doc: doc?.id, chance, limb },
        choices: [
          ...(limb && doc ? [{ label: `Amputate (${Math.round(chance * 100)}%)`, hint: 'Uses medicine if we have it.', effect: 'amp' }] : []),
          { label: 'Wait and pray', hint: 'Some people don\'t turn. Some.', effect: 'wait' },
          { label: `Ask ${them(s)} what ${they(s)} want${s.sex === 'm' ? 's' : 's'}`, effect: 'ask' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!;
      const opts = d.limb && d.doc ? ['amp', 'wait', 'ask'] : ['wait', 'ask'];
      const pick = opts[c];
      if (pick === 'amp') {
        const doc = byId(d.doc as string)!;
        let chance = d.chance as number;
        if (G.stores.meds > 0) { add('meds', -1); chance += 0.08; }
        const part = d.part as keyof typeof PART_NAMES;
        if (R.chance(chance)) {
          s.wounds = s.wounds.filter((w) => w.kind !== 'bite');
          s.infection = 0;
          wound(s, 'laceration', 0.6, part).tended = true;
          addScar(s, { part, label: `lost ${PART_NAMES[part]}`, accuracy: part.endsWith('arm') ? -0.18 : -0.03, work: part.endsWith('arm') ? -0.25 : -0.3 });
          tale(s, `Lost ${their(s)} ${PART_NAMES[part]} to a bite, and lived.`);
          tale(doc, `Took ${first(s)}'s ${PART_NAMES[part]} off with a bone saw on the kitchen table.`);
          changeOpinion(s, doc, 30);
          log('tale', `${displayName(doc)} took off ${displayName(s)}'s ${PART_NAMES[part]} on the kitchen table. ${first(s)} lived.`);
          return `It took four of us to hold ${them(s)}. ${first(doc)} did not stop until it was done. The fever broke by night.`;
        }
        killSurvivor(s, `under ${first(doc)}'s saw, on the kitchen table`);
        addThought(doc, { id: 'killed_patient', label: `${first(s)} died under my hands`, mood: -18, days: 8 }, 1);
        return `${first(s)} did not wake up. ${first(doc)} washed ${their(doc)} hands for a long time.`;
      }
      if (pick === 'ask') {
        const closest = living().filter((o) => o !== s).sort((a, b) => (s.rel[b.id]?.opinion ?? 0) - (s.rel[a.id]?.opinion ?? 0))[0];
        if (closest && R.chance(0.6)) {
          killSurvivor(s, `by ${first(closest)}'s hand, as asked`, `Asked ${first(closest)} to be the one. ${cap(they(closest))} was.`);
          addThought(closest, { id: 'mercy', label: `I did it for ${first(s)}`, mood: -20, days: 10 }, 1);
          tale(closest, `Was the one ${first(s)} asked for, at the end.`);
          for (const o of living()) if (o !== closest) changeOpinion(o, closest, 10);
          return `${first(s)} asked for ${first(closest)}. They walked out past the woodpile together. One shot.`;
        }
        G.flags[`refusedmercy_${s.id}`] = true;
        return `"Not yet," ${first(s)} said. "Not while I'm still me."`;
      }
      return `We watch ${them(s)}. ${first(s)} pretends not to notice.`;
    },
  },
  {
    id: 'dog',
    weight: () => (!G.flags.dog && G.day > 2 ? 0.6 : 0),
    make: () => {
      const name = R.pick(['Bear', 'Duke', 'Sadie', 'Rusty', 'Maple', 'Gus', 'Lady', 'Boone']);
      return {
        id: 'dog', title: 'A dog',
        text: `A shepherd mix has been sitting outside the wall since dawn. Collar tag says ${name.toUpperCase()}, and a phone number in Corliss nobody will ever call again. Ribs showing. It doesn't bark at us. It barks at the treeline.`,
        data: { name },
        choices: [{ label: `Let ${name} in`, hint: 'Eats a little. Hears them before we do.', effect: 'yes' }, { label: 'Drive it off', effect: 'no' }],
      };
    },
    resolve: (c, d) => {
      if (c === 1) return 'It went back to the treeline. We heard it barking there that night, then not.';
      G.flags.dog = d.name as string;
      for (const s of living()) addThought(s, { id: 'dog', label: `${d.name} sleeps by the stove`, mood: 4, days: 30 }, 1);
      log('arrival', `A dog named ${d.name} adopted us.`);
      return `${d.name} chose a spot by the stove and has not left it since.`;
    },
  },
  {
    id: 'rations',
    weight: () => (G.stores.food < living().length * 2.5 && G.flags.rations !== 'half' ? 6 : 0),
    make: () => ({
      id: 'rations', title: 'The pantry',
      text: `${G.stores.food} portions in the pantry and ${pop()} people in the house. Somebody has to say it.`,
      choices: [{ label: 'Half rations', hint: 'Everyone eats half. Mood suffers.', effect: 'half' }, { label: 'Full rations, scavenge harder', effect: 'full' }],
    }),
    resolve: (c) => {
      G.flags.rations = c === 0 ? 'half' : 'full';
      log('event', c === 0 ? 'We went to half rations.' : 'We kept full rations, and hoped.');
      return c === 0 ? 'Thin soup, then.' : 'We eat while there is food.';
    },
  },
  {
    id: 'endrations',
    weight: () => (G.flags.rations === 'half' && G.stores.food > living().length * 5 ? 10 : 0),
    make: () => ({ id: 'endrations', title: 'Full plates', text: 'The pantry is holding. People are asking.', choices: [{ label: 'Back to full rations', effect: 'x' }] }),
    resolve: () => { G.flags.rations = 'full'; return 'Somebody made pancakes from God knows what.'; },
  },
  {
    id: 'union',
    weight: () => (G.day > 5 && !G.flags.unionDone ? 0.6 : 0),
    make: () => ({
      id: 'union', title: 'Local 41',
      text: `A Union runner in a hard hat with LOCAL 41 stenciled on it comes under a white flag. "Steward Wick says: we've got steam, we've got steel. We need hands that can shoot. Send us one of yours for the week and we'll send back plate for your wall."`,
      choices: [{ label: 'Send our best shot', hint: 'Lose a survivor for 5 days. Get steel.', effect: 'send' }, { label: 'Send 15 rifle rounds instead', effect: 'ammo' }, { label: '"Everybody works their own shift."', effect: 'no' }],
    }),
    resolve: (c) => {
      G.flags.unionDone = true;
      if (c === 0) {
        const s = [...living()].sort((a, b) => b.skills.shooting - a.skills.shooting)[0];
        if (!s || pop() < 3) return 'We cannot spare anyone. The runner shrugs.';
        s.breakState = { kind: 'away', days: 5 };
        G.flags.unionReturn = G.day + 5;
        G.flags.unionGuy = s.id;
        add('scrap', 40);
        G.fort.maxHp += 80; G.fort.hp += 80;
        addRep('union', 25);
        log('event', `${displayName(s)} went to stand the Union's wall at the mill for a week. They sent steel plate in trade.`);
        return `${first(s)} went with the runner. The steel arrived by sled that afternoon.`;
      }
      if (c === 1) {
        if (G.stores.rifle < 15) return 'We do not have it. The runner looks at our wall and does not say anything.';
        add('rifle', -15); add('scrap', 25); addRep('union', 10);
        return 'They sent back scrap. Fair trade.';
      }
      return 'The runner walks back to the mill.';
    },
  },
  {
    id: 'raiders',
    weight: () => (G.day > 6 && G.stores.food + G.stores.light / 5 > 40 ? 0.8 : 0),
    make: () => {
      const want: Res = R.pick(['food', 'fuel', 'meds'] as Res[]);
      const n = Math.max(2, Math.round(G.stores[want] * 0.4));
      return {
        id: 'raiders', title: 'Men from the courthouse',
        text: `Three men in county jackets, one with a deputy's star on a lanyard. "Exposure Register says this house hasn't been inspected. Inspection fee is ${n} ${want}. Or we inspect."\n\nThey have a carbine and they look like they've used it.`,
        data: { want, n },
        choices: [{ label: `Pay ${n} ${want}`, effect: 'pay' }, { label: 'Tell them to get off our road', hint: 'Someone could get shot.', effect: 'fight' }],
      };
    },
    resolve: (c, d) => {
      const want = d.want as Res, n = d.n as number;
      if (c === 0) { add(want, -n); addRep('county', 10); log('event', `We paid the County men ${n} ${want} to go away.`); for (const s of living()) addThought(s, { id: 'extorted', label: 'Paid off the County men', mood: -4, days: 3 }, 1); return 'They took it and wrote something in a ledger.'; }
      addRep('county', -25);
      const shooters = living().reduce((a, s) => a + s.skills.shooting, 0) + G.weapons.length * 2;
      if (R.chance(Math.min(0.85, 0.3 + shooters * 0.02))) {
        const s = lowestSpotlight();
        tale(s, 'Faced down the County men on the road.');
        if (R.chance(0.4)) { newWeapon('carbine', 0.7); log('tale', `${displayName(s)} faced down the County men on the road. One didn't walk away; we took his carbine.`); return `${first(s)} fired first. One stayed on the road. We have his carbine.`; }
        log('tale', `${displayName(s)} faced down the County men on the road.`);
        return `${first(s)} put a round over their heads and they decided we were inspected.`;
      }
      const s = R.pick(living());
      wound(s, 'gunshot', R.range(0.3, 0.7));
      add(want, -n);
      log('event', `${displayName(s)} was shot by the County men. They took the ${want} anyway.`);
      return `${first(s)} was shot. They took what they came for.`;
    },
  },
  {
    id: 'radio_voice',
    weight: () => (buildingLevel('radio') ? 1 : 0.2),
    make: () => {
      const lines = [
        '"...this is an emergency message for Aubin County. Remain indoors. Do not approach individuals displaying confusion or fever. Await instruc—"',
        '"—Halvorsen boat, you copy? Lights on the island. Somebody\'s on the island. Bring the Peltier kid back—"',
        '"...and I won\'t tell you it\'s judgment. I\'ll tell you there\'s soup at the gym at six and Gene Halvorsen needs insulin and if you have any, God bless you, bring it." — Pastor Engvall, AM 880',
        '"—Line holds. Vessey is a write-off, repeat, write-off. ...the roster says eighteenth, why does it say eighteenth—"',
        '"Local 41 to anybody. Pond two is boiling over orange. Do not drink the river. Do not drink the well water on Mill Road. Everybody works a shift."',
        '"This is Dot at the Exchange. If anybody hears this, my son is Kyle Strand, he\'s nineteen, he was at the Corliss Line. Tell him his mom is at the Parish."',
        '"They\'re listening. Haven\'t you noticed? When you go quiet, they go quiet. We just walk among them now. Come to the ponds." [static]',
        '"Ice report: river froze at the Corliss bend this morning. Vessey reach in maybe a week. Ferry runs till it doesn\'t."',
      ];
      const idx = ((G.flags.radioIdx as number) ?? 0) % lines.length;
      G.flags.radioIdx = idx + 1;
      return { id: 'radio_voice', title: 'On the radio', text: lines[idx], choices: [{ label: 'Keep listening', effect: 'ok' }] };
    },
    resolve: () => { log('lore', 'Heard something on the radio.'); return 'Static after that.'; },
  },
  {
    id: 'cache',
    weight: () => (G.day > 2 ? 0.9 : 0),
    make: () => {
      const s = lowestSpotlight();
      return {
        id: 'cache', title: 'A deer camp',
        text: `${first(s)} remembers a deer camp up the Route 9 logging road. "Old Nils kept a gun safe up there and a chest freezer of venison. If the freezer's dead the meat's bad, but the safe..." It's a long walk, and alone.`,
        data: { s: s.id },
        choices: [{ label: `Send ${first(s)}`, hint: 'Gone all day. Could be anything.', effect: 'go' }, { label: 'Too far', effect: 'no' }],
      };
    },
    resolve: (c, d) => {
      if (c === 1) return 'Maybe another time.';
      const s = byId(d.s as string)!;
      s.job = 'rest';
      s.breakState = { kind: 'away', days: 1 };
      const r = R.next();
      if (r < 0.45) {
        const w = newWeapon(R.pick(['hunting', 'pump', 'revolver']), R.range(0.7, 1));
        add('rifle', 10); add('food', 6);
        tale(s, 'Walked to the deer camp alone and came back armed.');
        log('tale', `${displayName(s)} walked to Nils's deer camp and came back with a ${WEAPONS[w.def].name.toLowerCase()}.`);
        return `${first(s)} will be back by dark with a ${WEAPONS[w.def].name.toLowerCase()} and venison jerky.`;
      }
      if (r < 0.8) { add('food', 8); return `The safe was open and empty. ${first(s)} will bring back jerky, at least.`; }
      wound(s, R.chance(0.35) ? 'bite' : 'laceration', R.range(0.3, 0.6));
      log('event', `${displayName(s)} found Nils at the deer camp. Nils had turned.`);
      return `${first(s)} found Nils. Nils had turned. ${first(s)} will be back hurt.`;
    },
  },
  {
    id: 'confession',
    weight: () => (pop() >= 3 ? 0.6 : 0),
    make: () => {
      const s = lowestSpotlight();
      const o = R.pick(living().filter((x) => x !== s));
      if (!o) return null;
      return {
        id: 'confession', title: 'Late, by the stove',
        text: `${first(s)} talked to ${first(o)} late, after the others were asleep. About ${R.pick(['the night of homecoming', 'a daughter in Duluth', 'what they did at the Rexall', 'the swing set in the backyard', 'Pond 2, and who signed off on it', 'the forty minutes the bell rang'])}.\n\nIn the morning they were different with each other.`,
        data: { s: s.id, o: o.id },
        choices: [{ label: 'Let them be', effect: 'ok' }],
      };
    },
    resolve: (_c, d) => {
      const s = byId(d.s as string)!, o = byId(d.o as string)!;
      const good = R.chance(0.75);
      changeOpinion(s, o, good ? 20 : -15); changeOpinion(o, s, good ? 18 : -20);
      if (good) addThought(s, { id: 'deep_talk', label: `Talked all night with ${first(o)}`, mood: 6, days: 4, about: o.id }, 1);
      return good ? 'Something heavy got set down.' : 'Some things should stay unsaid.';
    },
  },
  {
    id: 'sickness',
    weight: () => (G.weather === 'rain' || G.weather === 'cold' ? 0.5 : 0.15),
    make: () => {
      const s = lowestSpotlight();
      wound(s, 'bruise', 0.45, 'torso');
      s.wounds[s.wounds.length - 1].bleeding = false;
      log('event', `${displayName(s)} came down with a chest fever. Not the Turn. Probably not the Turn.`);
      return { id: 'sickness', title: 'Fever', text: `${first(s)} is coughing and burning up. Everyone is watching for the sweet smell. It isn't there. Just the flu, the old-fashioned way, in an unheated house in November.`, choices: [{ label: G.stores.meds > 0 ? 'Give medicine' : 'Nothing to give', effect: 'x' }] };
    },
    resolve: () => {
      const s = [...living()].reverse().find((x) => x.wounds.some((w) => w.part === 'torso'));
      if (G.stores.meds > 0 && s) { add('meds', -1); s.wounds.forEach((w) => (w.tended = true)); return 'The pills help.'; }
      return 'We wait it out.';
    },
  },
  {
    id: 'grave',
    weight: () => (G.graves.some((g) => g.dead && g.dead.day >= G.day - 1 && g.dead.cause !== 'deserted') ? 8 : 0),
    make: () => {
      const g = G.graves.filter((x) => x.dead && x.dead.day >= G.day - 1 && x.dead.cause !== 'deserted').pop();
      if (!g || G.flags[`buried_${g.id}`]) return null;
      G.flags[`buried_${g.id}`] = true;
      return {
        id: 'grave', title: `${first(g)}`,
        text: `The ground is half frozen. ${displayName(g)}, ${g.age}. ${g.before}\n\nHow do we lay ${them(g)} to rest?`,
        data: { g: g.id },
        choices: [
          { label: 'Dig a proper grave', hint: 'A morning of work for everyone. A real goodbye.', effect: 'bury' },
          { label: 'Burn the body', hint: 'Fast. Safe. Hard to watch.', effect: 'burn' },
        ],
      };
    },
    resolve: (c, d) => {
      const g = byId(d.g as string)!;
      if (c === 0) {
        for (const s of living()) {
          s.rest -= 0.1;
          addThought(s, { id: 'buried', label: `We buried ${first(g)} properly`, mood: hasTrait(s, 'faithful') ? 8 : 4, days: 4 }, 1);
        }
        log('event', `We buried ${displayName(g)} behind the house. ${R.pick(['Someone said a few words.', 'Nobody knew what to say.', 'The dog would not leave the grave.', 'It started to snow while we filled it in.'])}`);
        return 'We marked it with a ' + R.pick(['ferry oar', 'hockey stick', 'mill sign', 'cross of lath', 'stack of river stones']) + '.';
      }
      for (const s of living()) if (hasTrait(s, 'faithful') || hasTrait(s, 'gentle')) addThought(s, { id: 'burned', label: `We burned ${first(g)} like trash`, mood: -6, days: 4 }, 1);
      log('event', `We burned ${displayName(g)} on the road. The smoke went east, toward the river.`);
      return 'The smoke went east.';
    },
  },
  {
    id: 'oldface',
    weight: () => (G.day > 4 && !G.flags.oldFace ? 0.7 : 0),
    make: () => {
      const s = lowestSpotlight();
      const rel = R.pick(['brother', 'sister', 'ex-husband', 'ex-wife', 'old foreman', 'son', 'daughter', 'best friend from the mill', 'neighbor', 'AA sponsor']);
      const female = /sister|wife|daughter/.test(rel);
      const nm = R.pick(female ? ['Jen', 'Annika', 'Kay', 'Lorna', 'Mae', 'Tess', 'Ivy'] : ['Ray', 'Duane', 'Kyle', 'Lyle', 'Arne', 'Tom', 'Wes']);
      G.flags.oldFace = JSON.stringify({ name: nm, by: s.id });
      tale(s, `Saw ${their(s)} ${rel} ${nm} among the Turned.`);
      return {
        id: 'oldface', title: 'A face on the road',
        text: `${first(s)} came in white as paper. Down by the river road, in the crowd of them shuffling toward town: ${their(s)} ${rel}, ${nm}. Same coat. Same walk.\n\n"${R.pick(['He\'ll come here. He always came here.', 'If she comes up the road tonight, I\'ll do it. Nobody else.', 'Don\'t you dare make me watch.', 'I owed them money. Isn\'t that stupid. That\'s what I thought of.'])}"`,
        data: { s: s.id },
        choices: [{ label: 'Tonight, then', effect: 'ok' }],
      };
    },
    resolve: (_c, d) => {
      const s = byId(d.s as string)!;
      addThought(s, { id: 'saw_kin', label: 'Saw someone I loved among them', mood: -10, days: 5 }, 1);
      return 'The road is very long from here to the river.';
    },
  },
  {
    id: 'fire',
    weight: () => (G.day > 3 && (G.weather === 'cold' || G.weather === 'snow' || G.weather === 'clear') ? 0.45 : 0.1),
    make: () => {
      const s = lowestSpotlight();
      return {
        id: 'fire', title: 'Fire in the woodshed',
        text: `A stovepipe cracked in the night and the woodshed went up. ${first(s)} is already running at it with a wet blanket. Half the timber is in there.`,
        data: { s: s.id },
        choices: [{ label: 'Everyone fights it', hint: 'Save the wood. Someone may get burned.', effect: 'fight' }, { label: 'Let it burn', hint: 'Lose the timber. Nobody gets hurt.', effect: 'let' }],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!;
      if (c === 1) { add('wood', -Math.round(G.stores.wood * 0.6)); log('event', 'The woodshed burned. We watched it go.'); return 'It burned down to the stone footing.'; }
      add('wood', -Math.round(G.stores.wood * 0.2));
      if (R.chance(0.45)) {
        wound(s, 'burn', R.range(0.2, 0.45), R.pick(['larm', 'rarm', 'torso']));
        tale(s, 'Went into the burning woodshed with a wet blanket.');
        log('tale', `${displayName(s)} went into the burning woodshed and came out with the timber, and burns.`);
        return `${first(s)} got burned dragging planks out. We saved most of it.`;
      }
      return 'Bucket line from the rain barrel. We saved most of it.';
    },
  },
  {
    id: 'quiet',
    weight: () => (G.day > 7 && !G.flags.quietMet ? 0.5 : 0),
    make: () => ({
      id: 'quiet', title: 'One of the Quiet',
      text: 'A man walks up the road in broad daylight, right through a knot of Sleepers, and none of them turn. He is smeared head to foot in grey-orange sludge from the mill ponds. He stops at our wall and speaks very softly.\n\n"They\'re listening. When you go quiet, they go quiet. We could teach you. You don\'t have to shoot them. You don\'t have to shoot anyone ever again."',
      choices: [
        { label: 'Listen to him', hint: 'He might know something. He might be mad.', effect: 'listen' },
        { label: 'Put a round over his head', effect: 'scare' },
      ],
    }),
    resolve: (c) => {
      G.flags.quietMet = true;
      if (c === 0) {
        for (const s of living()) if (hasTrait(s, 'faithful') || hasTrait(s, 'gentle')) addThought(s, { id: 'quiet_hope', label: 'Maybe there is another way', mood: 6, days: 4 }, 1);
        log('lore', 'A man of the Quiet came to the wall and talked for an hour about listening. He left a jar of pond sludge on the gatepost. Nobody touched it.');
        G.flags.quietJar = true;
        return 'He left a jar of the sludge on the gatepost. "For when you\'re ready."';
      }
      log('lore', 'We ran off one of the Quiet. He walked back through the Sleepers like a man crossing a church.');
      return 'He did not flinch. He walked back the way he came, through them, untouched.';
    },
  },
  {
    id: 'parish',
    weight: () => (G.day > 3 && G.stores.meds >= 2 ? 0.6 : 0),
    make: () => ({
      id: 'parish', title: 'A note from the Parish',
      text: 'Pinned to the gate under a rock, in Pastor Engvall\'s careful hand:\n\n"To whoever holds the Haugen place. Gene Halvorsen needs insulin and we have nine children with the croup. If you have any medicine at all, leave it at the Legion hall steps. God sees it. So do I. — R.E."',
      choices: [
        { label: 'Leave 2 medicine at the Legion steps', effect: 'give' },
        { label: 'We need it ourselves', effect: 'keep' },
      ],
    }),
    resolve: (c) => {
      if (c === 0) {
        add('meds', -2);
        addRep('parish', 20);
        G.flags.parish = ((G.flags.parish as number) ?? 0) + 1;
        for (const s of living()) addThought(s, { id: 'charity', label: 'We helped the Parish', mood: hasTrait(s, 'faithful') || hasTrait(s, 'kind') ? 8 : 3, days: 5 }, 1);
        log('event', 'We left medicine on the Legion hall steps for the Parish.');
        return 'The next morning there is a loaf of bread on our gatepost, wrapped in a dish towel.';
      }
      for (const s of living()) if (hasTrait(s, 'kind') || hasTrait(s, 'faithful')) addThought(s, { id: 'refused_parish', label: 'We let the Parish children cough', mood: -6, days: 4 }, 1);
      return 'Nobody mentions the note again.';
    },
  },
  {
    id: 'wedding',
    weight: () => (living().some((a) => Object.values(a.rel).some((r) => r.bond === 'lover')) && G.day > 6 ? 1.2 : 0),
    make: () => {
      const a = living().find((x) => Object.entries(x.rel).some(([id, r]) => r.bond === 'lover' && byId(id) && !byId(id)!.dead));
      if (!a) return null;
      const bId = Object.entries(a.rel).find(([id, r]) => r.bond === 'lover' && byId(id) && !byId(id)!.dead)![0];
      const b = byId(bId)!;
      return {
        id: 'wedding', title: 'A wedding, of sorts',
        text: `${first(a)} and ${first(b)} want to make it official. No license, no church that's still standing. ${R.pick(['A ring made from a ferry cable shackle.', 'Rings cut from a brass shell casing.', 'A ring of copper wire, twisted three times.'])}\n\nSomeone would need to say the words.`,
        data: { a: a.id, b: b.id },
        choices: [{ label: 'Hold the wedding tonight before dusk', hint: 'Uses 4 food and the liquor. Everyone\'s spirits rise.', effect: 'yes' }, { label: 'Not now. Not like this.', effect: 'no' }],
      };
    },
    resolve: (c, d) => {
      const a = byId(d.a as string)!, b = byId(d.b as string)!;
      if (c === 1) { addThought(a, { id: 'nowedding', label: 'They said not now', mood: -6, days: 4 }, 1); addThought(b, { id: 'nowedding', label: 'They said not now', mood: -6, days: 4 }, 1); return 'Maybe after the ice.'; }
      add('food', -Math.min(4, G.stores.food)); add('liquor', -Math.min(2, G.stores.liquor));
      setBond(a, b, 'spouse');
      for (const s of living()) addThought(s, { id: 'wedding', label: `${first(a)} and ${first(b)} got married`, mood: s === a || s === b ? 20 : 8, days: 6 }, 1);
      tale(a, `Married ${first(b)} in the front room on ${G.day < 23 ? 'a November afternoon' : 'a December afternoon'}, in the middle of the end of the world.`);
      tale(b, `Married ${first(a)} in the front room with the boards still on the windows.`);
      log('tale', `${displayName(a)} and ${displayName(b)} were married in the front room of the house on Ferry Road. ${R.pick(['Someone played a harmonica badly.', 'The dog wore a bow made of a dish towel.', 'Everybody cried, even the ones who said they wouldn\'t.', 'For an hour nobody looked at the windows.'])}`);
      return 'For an hour nobody looked at the windows.';
    },
  },
];

export function rollIncident(): PendingEvent | null {
  if (G.day <= 1 || !living().length) return null;
  const pool = INCIDENTS.filter((i) => (G.director.cooldowns[i.id] ?? 0) <= G.day);
  const forced = pool.find((i) => i.weight() >= 8);
  const pick = forced ?? (R.chance(0.7) ? R.weighted(pool, (i) => i.weight()) : undefined);
  if (!pick) return null;
  const ev = pick.make();
  if (!ev) return null;
  G.director.cooldowns[pick.id] = G.day + (pick.id === 'radio_voice' ? 2 : 3);
  return ev;
}

export function resolveEvent(ev: PendingEvent, choice: number): string {
  const inc = INCIDENTS.find((i) => i.id === ev.id);
  if (!inc?.resolve) return '';
  return inc.resolve(choice, ev.data ?? {});
}

export function returnsTick(): string[] {
  const out: string[] = [];
  for (const s of living()) {
    if (s.breakState?.kind === 'away') {
      s.breakState.days--;
      if (s.breakState.days <= 0) {
        s.breakState = null;
        if (G.flags.unionGuy === s.id) {
          out.push(`${first(s)} came back from the Union wall at the mill, ${R.chance(0.5) ? 'thinner and quieter' : 'with stories about Dolores Wick'}.`);
          addThought(s, { id: 'home', label: 'Home from the mill', mood: 6, days: 3 }, 1);
        }
      }
    }
  }
  return out;
}

export { has, pay };
