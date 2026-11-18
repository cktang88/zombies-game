// More incidents from the research list (§2.8): the house turning on itself, small
// mercies, the radio thread, the Quiet, and the bell before the ice.
import type { Survivor } from '../types';
import { G, R, log, add, pay, findDoc, ICE_DAY } from '../state';
import { WEAPONS } from '../data/weapons';
import {
  living, first, displayName, makeSurvivor, addThought, changeOpinion, wound, killSurvivor, isBitten, byId, tale,
  hasTrait, they, them, their, rel, setBond, leader, pain, PART_NAMES,
} from './survivors';
import { buildingLevel } from './day';
import { type Incident, cap, pop, popIntent, lowestSpotlight, flagN, admit } from './incident';
import { bondLine, breakLine } from './chronicle';

const adults = () => living().filter((s) => !s.child);
const partnerOf = (s: Survivor) => {
  const e = Object.entries(s.rel).find(([id, r]) => (r.bond === 'lover' || r.bond === 'spouse') && byId(id) && !byId(id)!.dead);
  return e ? byId(e[0]) : undefined;
};
const hiddenBite = (s: Survivor) => s.wounds.some((w) => w.kind === 'bite' && w.hidden);

export const MORE_INCIDENTS: Incident[] = [
  {
    id: 'deserter',
    weight: () => {
      const low = adults().filter((s) => s.mood < 30 && !s.breakState && !s.isLeader);
      return pop() >= 3 && G.day > 3 && low.length ? 0.4 + low.length * 0.7 : 0;
    },
    make: () => {
      const low = adults().filter((s) => s.mood < 30 && !s.breakState && !s.isLeader);
      if (!low.length) return null;
      const s = lowestSpotlight(low);
      const by = lowestSpotlight(living().filter((x) => x !== s && !x.child));
      if (!by) return null;
      return {
        id: 'deserter', title: 'At the back fence',
        text: `${first(by)} was on the night watch and heard the back fence creak. ${first(s)}, with a pack: food, a box of shells, the good flashlight. ${cap(they(s))} froze in the beam.\n\n"${R.pick(['I can\'t do another night. I can\'t.', 'The ferry still runs at two. I could make the ferry.', 'Don\'t. Just turn the light off and go back inside.', 'You\'d all be better off. One less mouth.'])}"`,
        data: { s: s.id, by: by.id },
        choices: [
          { label: 'Let them go, with the pack', hint: 'Lose a survivor and some supplies.', effect: 'go' },
          { label: `${first(by)} talks ${them(s)} down`, hint: 'Might work. Might not.', effect: 'talk' },
          { label: 'Take the pack and lock them in the cellar', hint: 'They stay. They will not forgive it soon.', effect: 'lock' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!, by = byId(d.by as string)!;
      if (s.dead) return '';
      const leave = () => {
        const took = { food: Math.min(G.stores.food, 5), shell: Math.min(G.stores.shell, 6), meds: Math.min(G.stores.meds, 1) };
        pay(took);
        log('break', breakLine(s, 'desert'));
        s.dead = { day: G.day, cause: 'deserted', epitaph: 'Went over the back fence one night. Nobody knows.' };
        G.graves.push(s);
        G.survivors = G.survivors.filter((x) => x !== s);
        for (const o of living()) addThought(o, { id: 'deserted', label: `${first(s)} left us`, mood: -5, days: 4 }, 1);
      };
      if (c === 0) {
        leave();
        addThought(by, { id: 'let_go', label: `I let ${first(s)} go`, mood: -4, days: 4 }, 1);
        return `${first(by)} turned the flashlight off. When it came back on, the fence was empty.`;
      }
      if (c === 1) {
        if (R.chance(0.3 + by.skills.social * 0.06 + ((s.rel[by.id]?.opinion ?? 0) > 30 ? 0.2 : 0))) {
          addThought(s, { id: 'talked_down', label: `${first(by)} talked me down at the fence`, mood: 12, days: 4, about: by.id }, 1);
          changeOpinion(s, by, 25);
          tale(by, `Talked ${first(s)} down at the back fence in the middle of the night.`);
          log('tale', `${displayName(by)} talked ${displayName(s)} down at the back fence, at three in the morning, in the cold.`);
          return `They sat in the snow by the fence until the sky went grey. ${first(s)} carried the pack back inside ${them(s)}self.`;
        }
        leave();
        return `${first(by)} talked for an hour. ${first(s)} listened to all of it, nodded, and went over the fence anyway.`;
      }
      s.breakState = { kind: 'sulk', days: 1 };
      changeOpinion(s, by, -30);
      for (const o of living()) if (o !== s) changeOpinion(s, o, -8);
      addThought(s, { id: 'locked', label: 'Locked in the root cellar like a dog', mood: -12, days: 6 }, 1);
      log('event', `We caught ${displayName(s)} going over the back fence and locked ${them(s)} in the root cellar for a day.`);
      return `${first(s)} spent the day in the root cellar with the potatoes. When we opened the door ${they(s)} walked past all of us without a word.`;
    },
  },
  {
    id: 'quarrel',
    weight: () => (adults().some((s) => partnerOf(s)) && G.day > 5 ? 0.5 : 0),
    make: () => {
      const a = lowestSpotlight(adults().filter((s) => partnerOf(s)));
      const b = a && partnerOf(a);
      if (!a || !b) return null;
      const about = R.pick(['the last of the coffee', 'whether to take the ferry', `${first(a)}'s drinking`, `the way ${first(b)} looks at the river`, 'a dead husband in Corliss', 'nothing, and everything', 'who should go on the next run']);
      return {
        id: 'quarrel', title: 'Raised voices',
        text: `${first(a)} and ${first(b)}, in the cold room, at two in the morning. Everybody heard. It was about ${about}, and then it wasn't.\n\nBy breakfast neither of them would sit down.`,
        data: { a: a.id, b: b.id },
        choices: [
          { label: 'Let them work it out', hint: 'It could go either way.', effect: 'let' },
          { label: 'Somebody sits them down', hint: 'The leader steps in. Not everyone likes that.', effect: 'step' },
        ],
      };
    },
    resolve: (c, d) => {
      const a = byId(d.a as string)!, b = byId(d.b as string)!;
      const l = leader();
      const ok = c === 0 ? R.chance(0.55) : R.chance(0.4 + (l ? l.skills.social * 0.05 : 0));
      if (ok) {
        changeOpinion(a, b, 12); changeOpinion(b, a, 12);
        log('social', bondLine(a, b, 'makeup'));
        return c === 1 && l ? `${first(l)} sat them down at the kitchen table and left. An hour later they came out holding hands.` : 'By supper it had blown over, the way storms do.';
      }
      const spouse = rel(a, b).bond === 'spouse';
      rel(a, b).bond = undefined; rel(b, a).bond = undefined;
      changeOpinion(a, b, -35); changeOpinion(b, a, -35);
      addThought(a, { id: 'breakup', label: `${first(b)} and I are finished`, mood: -14, days: 8, about: b.id }, 1);
      addThought(b, { id: 'breakup', label: `${first(a)} and I are finished`, mood: -14, days: 8, about: a.id }, 1);
      if (c === 1 && l && l !== a && l !== b) { changeOpinion(a, l, -10); changeOpinion(b, l, -10); }
      log('social', bondLine(a, b, 'breakup'));
      tale(a, `${spouse ? 'Was married to' : 'Loved'} ${first(b)} for a while, at the end of the world.`);
      return `It did not blow over. ${first(a)} took ${their(a)} blanket to the cold room.`;
    },
  },
  {
    id: 'inspiration',
    weight: () => (adults().some((s) => s.mood > 70 && !s.breakState) ? 0.6 : 0),
    make: () => {
      const s = lowestSpotlight(adults().filter((x) => x.mood > 70 && !x.breakState));
      if (!s) return null;
      const gun = G.weapons.find((w) => w.uid === s.weapon && !w.name);
      return {
        id: 'inspiration', title: `${first(s)}, this morning`,
        text: `${first(s)} woke before everyone and lit the stove and was singing, actually singing, ${R.pick(['an old Lutheran hymn', 'the Papermakers fight song', 'something by Patsy Cline', 'a song nobody knew'])}. There is something in ${them(s)} today, a kind of clear cold fire. The rest of us can feel it.\n\nWhat do we do with it?`,
        data: { s: s.id, gun: gun?.uid },
        choices: [
          ...(gun ? [{ label: `${first(s)} rebuilds ${their(s)} ${WEAPONS[gun.def].name.toLowerCase()}`, hint: 'A named masterwork, good as new.', effect: 'craft' }] : []),
          { label: `${first(s)} talks to everyone`, hint: 'A rallying speech. Everyone\'s mood lifts.', effect: 'rally' },
          { label: `${first(s)} takes the wall tonight`, hint: 'Deadly aim, tonight only.', effect: 'aim' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!;
      const gun = d.gun ? G.weapons.find((w) => w.uid === d.gun) : undefined;
      const opts = gun ? ['craft', 'rally', 'aim'] : ['rally', 'aim'];
      const pick = opts[c];
      if (pick === 'craft' && gun) {
        gun.cond = 1;
        gun.name = `${first(s)}'s ${R.pick(['Hymnal', 'Good Morning', 'Sunday Best', 'Clear Cold', 'Last Word'])}`;
        tale(s, `Rebuilt ${their(s)} ${WEAPONS[gun.def].name.toLowerCase()} in one inspired morning and named it "${gun.name}".`);
        log('craft', `${displayName(s)} stripped and rebuilt ${their(s)} ${WEAPONS[gun.def].name.toLowerCase()} in a single morning. "${gun.name}," it says on the stock now.`);
        return `"${gun.name}." ${first(s)} burned it into the stock with a hot nail.`;
      }
      if (pick === 'rally') {
        for (const o of living()) addThought(o, { id: 'rallied', label: `${first(s)}'s speech at breakfast`, mood: 10, days: 3, about: s.id }, 1);
        for (const o of living()) if (o !== s) changeOpinion(o, s, 6);
        tale(s, `Gave a speech at breakfast on day ${G.day} that people still quote.`);
        log('tale', `${displayName(s)} stood up at breakfast and said something about the town, and the mill, and the people in it. Nobody remembers the words. Everybody remembers it.`);
        return 'Nobody remembers the words. Everybody remembers how it felt.';
      }
      G.flags[`inspired_${s.id}`] = true;
      return `${first(s)} spent the afternoon cleaning ${their(s)} gun and watching the road. (Inspired: deadly aim tonight.)`;
    },
  },
  {
    id: 'mercy',
    weight: () => (living().some((s) => isBitten(s) && !hiddenBite(s) && s.infection >= 0.45 && !G.flags[`mercy_${s.id}`]) ? 9 : 0),
    make: () => {
      const s = living().find((x) => isBitten(x) && !hiddenBite(x) && x.infection >= 0.45 && !G.flags[`mercy_${x.id}`]);
      if (!s) return null;
      G.flags[`mercy_${s.id}`] = true;
      const who = living().filter((o) => o !== s && !o.child).sort((a, b) => (s.rel[b.id]?.opinion ?? 0) - (s.rel[a.id]?.opinion ?? 0))[0];
      if (!who) return null;
      return {
        id: 'mercy', title: `${first(s)} asks`,
        text: `The fever has ${first(s)} now. ${cap(their(s))} eyes have that ochre at the edges and ${they(s)} keeps asking what day it is. In a clear moment ${they(s)} called ${first(who)} over.\n\n"While I'm still me. Please. I want it to be you. Not out there. Not one of them."`,
        data: { s: s.id, who: who.id },
        choices: [
          { label: `${first(who)} does it`, hint: `${first(who)} will carry this.`, effect: 'yes' },
          { label: `${first(who)} can't. Someone else does.`, hint: `${first(s)} asked for ${first(who)}.`, effect: 'other' },
          { label: '"Not yet. Hold on."', hint: 'If it comes, it comes on the wall at night.', effect: 'wait' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!, who = byId(d.who as string)!;
      if (s.dead) return '';
      if (c === 0) {
        killSurvivor(s, `by ${first(who)}'s hand, as asked`, `Asked ${first(who)} to be the one. ${cap(they(who))} was.`);
        addThought(who, { id: 'mercy', label: `I did it for ${first(s)}`, mood: -20, days: 10 }, 1);
        tale(who, `Was the one ${first(s)} asked for, at the end.`);
        for (const o of living()) if (o !== who) changeOpinion(o, who, 12);
        return `They walked out past the woodpile together, ${first(s)} leaning on ${first(who)}. One shot. ${first(who)} came back alone and sat by the stove until dark.`;
      }
      if (c === 1) {
        const other = living().filter((o) => o !== s && o !== who && !o.child).sort((a, b) => b.skills.shooting - a.skills.shooting)[0];
        if (!other) return `There was nobody else. ${first(who)} could not. So we waited.`;
        killSurvivor(s, `by ${first(other)}'s hand, at the end`, `Asked for ${first(who)}. Got ${first(other)}. It was done kindly.`);
        addThought(other, { id: 'mercy', label: `I did it for ${first(s)}`, mood: -14, days: 8 }, 1);
        addThought(who, { id: 'failed_mercy', label: `${first(s)} asked me and I couldn't`, mood: -12, days: 8 }, 1);
        tale(other, `Did what ${first(who)} couldn't, for ${first(s)}.`);
        return `${first(other)} did it. ${first(who)} stood at the window with ${their(who)} hands over ${their(who)} ears.`;
      }
      addThought(s, { id: 'refused', label: 'They won\'t let me go', mood: -10, days: 3 }, 1);
      return `"Okay," ${first(s)} said. "Okay." ${cap(they(s))} did not ask again.`;
    },
  },
  {
    id: 'supply_drop',
    cooldown: 6,
    weight: () => (G.day > 5 ? 0.45 : 0),
    make: () => {
      const runners = adults().filter((s) => !s.breakState && pain(s) < 0.8);
      if (runners.length < 1) return null;
      const fast = [...runners].sort((a, b) => b.skills.scavenging - a.skills.scavenging)[0];
      const spot = lowestSpotlight(runners);
      const opts = spot && spot !== fast ? [fast, spot] : [fast];
      return {
        id: 'supply_drop', title: 'A crate in the treeline',
        text: `A helicopter came over at dawn, low, too fast to wave at, and something on a little white parachute came down past the wall and caught in the birches by the ditch. A green crate. Stenciled letters.\n\nThere are six Sleepers standing in the ditch between us and it, swaying, facing the river.`,
        data: { opts: opts.map((s) => s.id) },
        choices: [
          ...opts.map((s) => ({ label: `Send ${first(s)}`, hint: `Scavenging ${s.skills.scavenging}. Don't wake a Sleeper.`, effect: 'go' })),
          { label: 'Leave it', hint: 'Watch it hang there all day.', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      const opts = d.opts as string[];
      if (c >= opts.length) { log('event', 'A Guard supply crate hung in the birches below the wall all day. We left it.'); return 'By evening the Sleepers had pulled it down and it was gone into the ditch.'; }
      const s = byId(opts[c])!;
      if (s.dead) return '';
      const p = Math.min(0.85, 0.4 + s.skills.scavenging * 0.06);
      const loot = R.pick([{ rifle: 24, meds: 2 }, { meds: 5, food: 6 }, { light: 60, food: 4 }, { food: 14, cloth: 4 }] as const);
      const got = Object.entries(loot).map(([k, v]) => `${v} ${k}`).join(', ');
      if (R.chance(p)) {
        for (const [k, v] of Object.entries(loot)) add(k as 'food', v);
        tale(s, 'Walked through six Sleepers to fetch a Guard crate out of the birches.');
        log('tale', `${displayName(s)} walked between the Sleepers in the ditch and cut down a Guard supply crate. ${got}.`);
        return `${first(s)} went down the ditch one slow step at a time. None of them turned. The crate held ${got}, and a printed card: STAY INDOORS. HELP IS COMING.`;
      }
      if (R.chance(0.5)) {
        const w = wound(s, R.chance(0.35) ? 'bite' : 'laceration', R.range(0.3, 0.55), R.pick(['larm', 'rarm', 'lleg']));
        for (const [k, v] of Object.entries(loot)) add(k as 'food', Math.round(v / 2));
        log('event', `${displayName(s)} woke the Sleepers in the ditch getting the Guard crate. ${w.kind === 'bite' ? 'Bitten.' : 'Hurt.'}`);
        return `A Sleeper woke. Then all of them. ${first(s)} came back over the wall with half the crate and a ${w.kind === 'bite' ? 'bite' : 'gash'} on the ${PART_NAMES[w.part]}.`;
      }
      addThought(s, { id: 'close_call', label: 'The ditch. The crate.', mood: -6, days: 2 }, 1);
      return `${first(s)} got halfway and one of them turned its head. ${cap(they(s))} came back empty-handed and shaking.`;
    },
  },
  {
    id: 'child_family',
    weight: () => (G.day > 4 && flagN('children') < 2 ? 0.25 + popIntent() * 0.3 : 0),
    make: () => {
      const a = makeSurvivor({ age: R.int(26, 48) });
      const k = makeSurvivor({ age: R.int(6, 11), traits: [R.pick(['optimist', 'kind', 'nightowl', 'secretive'])] });
      k.name = `${k.name.split(' ')[0]} ${a.name.split(' ').slice(1).join(' ')}`;
      k.child = true;
      k.before = R.pick(['Third grade at Vessey Elementary. Wants to drive the ferry when grown.', 'Second grade. Collects river stones. Knows every dog in town by name.', 'Fifth grade. Was in the Christmas pageant. Was going to be a shepherd.']);
      k.outbreak = 'Was at the school when they sent everyone to the gym.';
      for (const s of Object.keys(k.skills)) k.skills[s as 'social'] = Math.min(k.skills[s as 'social'], 1);
      return {
        id: 'child_family', title: 'A mother and a child',
        text: `${a.name} at the gate with a ${k.sex === 'm' ? 'boy' : 'girl'} of ${k.age} asleep on ${their(a)} back, wrapped in a Papermakers stadium blanket. They walked from the school gym after it fell.\n\n"${first(k)} doesn't eat much. ${cap(they(k))} won't be any trouble. I can work. Please, I can work."\n\n${a.name}, ${a.age}. ${a.before}`,
        data: { a, k },
        choices: [
          { label: 'Take them both', hint: `${first(k)} will not fight. Another mouth. Everyone will feel it.`, effect: 'yes' },
          { label: 'We cannot feed a child', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      const a = d.a as Survivor, k = d.k as Survivor;
      if (c === 1) {
        for (const s of living()) addThought(s, { id: 'turned_kid', label: 'We turned away a child', mood: hasTrait(s, 'grim') ? -4 : -10, days: 6 }, 1);
        log('event', `We turned away ${a.name} and a child of ${k.age} at the gate.`);
        return `${first(k)} woke up as they walked away and looked back at us over ${first(a)}'s shoulder the whole way down Ferry Road.`;
      }
      G.flags.children = flagN('children') + 1;
      admit(a); admit(k);
      setBond(a, k, 'parent', 'child');
      rel(a, k).opinion = 90; rel(k, a).opinion = 80;
      k.job = 'rest';
      for (const s of living()) if (s !== k) addThought(s, { id: 'kid', label: 'A kid in the house', mood: hasTrait(s, 'kind') || hasTrait(s, 'gentle') ? 8 : 4, days: 20 }, 1);
      tale(k, `Came to the house on Ferry Road asleep on ${first(a)}'s back.`);
      return `${first(k)} slept for a day and then asked if we had any crayons. Somebody found crayons.`;
    },
  },
  {
    id: 'sick_wave',
    cooldown: 7,
    weight: () => (pop() >= 4 && G.day > 6 ? (G.weather === 'cold' || G.weather === 'snow' || G.weather === 'rain' ? 0.5 : 0.15) : 0),
    make: () => {
      const sick = R.shuffle(living().filter((s) => !s.dead)).slice(0, Math.max(2, Math.ceil(pop() / 3)));
      for (const s of sick) { const w = wound(s, 'bruise', 0.35, 'torso'); w.bleeding = false; s.rest = Math.max(0, s.rest - 0.3); }
      log('event', `Something went through the house: ${sick.map(first).join(', ')} down with fever and the shakes.`);
      return {
        id: 'sick_wave', title: 'Something going around',
        text: `${sick.map(first).join(', ')}: coughing, fevers, the shakes. Not the Turn. Everyone checks for the sweet smell anyway and nobody says why they're leaning in close.\n\nIt will go through the whole house if we let it.`,
        data: { sick: sick.map((s) => s.id) },
        choices: [
          { label: `Medicine for all of them (${sick.length})`, hint: G.stores.meds >= sick.length ? 'Uses medicine.' : 'We do not have enough.', effect: 'meds' },
          { label: 'Quarantine them in the cold room', hint: 'They rest, alone and miserable. It stops spreading.', effect: 'quar' },
          { label: 'Carry on', hint: 'It might spread.', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      const sick = (d.sick as string[]).map((id) => byId(id)!).filter((s) => s && !s.dead);
      if (c === 0 && G.stores.meds >= sick.length) {
        add('meds', -sick.length);
        for (const s of sick) for (const w of s.wounds) w.tended = true;
        return 'The pills help. By the weekend everyone is just tired.';
      }
      if (c === 1) {
        for (const s of sick) { s.job = 'rest'; addThought(s, { id: 'quarantined', label: 'Quarantined in the cold room', mood: -5, days: 2 }, 1); }
        return 'They spent two days in the cold room under every blanket we own. It did not spread.';
      }
      const more = living().filter((s) => !sick.includes(s) && R.chance(0.35));
      for (const s of more) { const w = wound(s, 'bruise', 0.3, 'torso'); w.bleeding = false; }
      return more.length ? `By evening ${more.map(first).join(' and ')} had it too.` : 'Somehow it stopped there.';
    },
  },
  {
    id: 'wall_rot',
    cooldown: 8,
    weight: () => (G.day > 7 && (G.weather === 'rain' || G.weather === 'fog' || G.weather === 'snow') ? 0.5 : G.day > 7 ? 0.15 : 0),
    make: () => ({
      id: 'wall_rot', title: 'The north section',
      text: `The north section of the wall, where the rain sheets off the garage roof, has gone soft. You can push a thumb into the posts. The bottom rail is black with rot and something orange-grey that might just be fungus.\n\nIt will hold a while. Not a long while.`,
      choices: [
        { label: 'Tear it out and rebuild (15 wood)', hint: G.stores.wood >= 15 ? 'A morning of work.' : 'We do not have the wood.', effect: 'fix' },
        { label: 'Shore it up and hope', hint: 'The wall loses 50 max strength until reinforced.', effect: 'hope' },
      ],
    }),
    resolve: (c) => {
      if (c === 0 && G.stores.wood >= 15) {
        add('wood', -15);
        for (const s of living()) s.rest = Math.max(0, s.rest - 0.08);
        log('event', 'We tore out the rotten north section of the wall and rebuilt it.');
        return 'New posts, still smelling of sap. It holds.';
      }
      G.fort.maxHp = Math.max(150, G.fort.maxHp - 50);
      G.fort.hp = Math.min(G.fort.hp, G.fort.maxHp);
      log('event', 'The north section of the wall is rotting. We shored it up with a car door.');
      return 'A car door and some baling wire. The wall is weaker for it.';
    },
  },
  {
    id: 'generator',
    cooldown: 7,
    weight: () => (buildingLevel('generator') && (G.fort.lights > 0 || (G.fort.turrets ?? 0) > 0) && !G.flags.lightsOff ? 0.5 : 0),
    make: () => {
      const tech = [...adults()].sort((a, b) => b.skills.building - a.skills.building)[0];
      return {
        id: 'generator', title: 'The generator',
        text: `The diesel coughed at four in the morning, ran rough, and died. ${tech ? `${first(tech)} has it half apart on a tarp: "Injector pump. I can fix it if we have parts. Otherwise we're dark tonight."` : 'Nobody in the house knows engines.'}\n\nWithout it: no floodlights, no turrets.`,
        data: { tech: tech?.id },
        choices: [
          { label: 'Fix it (3 parts)', hint: G.stores.parts >= 3 ? 'Back by dusk.' : 'We do not have the parts.', effect: 'fix' },
          { label: 'Go dark tonight', hint: 'Lights and turrets off for one night. Fixed tomorrow, for free.', effect: 'dark' },
        ],
      };
    },
    resolve: (c, d) => {
      const tech = d.tech ? byId(d.tech as string) : undefined;
      if (c === 0 && G.stores.parts >= 3) {
        add('parts', -3);
        if (tech) tale(tech, 'Rebuilt the generator\'s injector pump on a tarp in the snow.');
        return `${tech ? first(tech) : 'Somebody'} got it running by three. It sounds worse than before, but it runs.`;
      }
      G.flags.lightsOff = JSON.stringify({ lights: G.fort.lights, turrets: G.fort.turrets ?? 0, day: G.day });
      G.fort.lights = 0; G.fort.turrets = 0;
      log('event', 'The generator died. We stood the wall in the dark.');
      return 'Tonight the road will be black from the wall to the river.';
    },
  },
  {
    id: 'quiet_return',
    weight: () => (G.flags.quietJar && !G.flags.quietReturn && G.day > 10 ? 0.9 : 0),
    make: () => {
      const cand = adults().filter((s) => !s.breakState);
      const s = R.weighted(cand, (x) => (hasTrait(x, 'gentle') || hasTrait(x, 'faithful') || x.mood < 35 ? 3 : 1) / (1 + x.tales.length));
      if (!s) return null;
      G.flags.quietReturn = true;
      return {
        id: 'quiet_return', title: 'The jar on the gatepost',
        text: `The jar of pond sludge the Quiet man left is still on the gatepost. It has not frozen. It should have frozen.\n\n${first(s)} has been looking at it. This morning ${they(s)} said, very calmly: "I want to try. Just to the end of the road and back. If he's right, we could walk to the Rexall in daylight. We could walk anywhere."`,
        data: { s: s.id },
        choices: [
          { label: `Let ${first(s)} try`, hint: 'Nobody knows what happens.', effect: 'try' },
          { label: 'Smash the jar', hint: `${first(s)} will not forgive it soon.`, effect: 'smash' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!;
      if (c === 1) {
        changeOpinion(s, living().find((x) => x.isLeader) ?? s, -15);
        addThought(s, { id: 'jar', label: 'They smashed the jar', mood: -6, days: 4 }, 1);
        log('lore', 'We smashed the Quiet\'s jar on the road. The sludge steamed in the snow.');
        return 'It steamed in the snow. The Sleepers at the bottom of the road all turned their heads at once, toward the sound, and then away.';
      }
      const r = R.next();
      if (r < 0.55) {
        add('meds', 3); add('food', 5);
        tale(s, 'Walked among the Turned in daylight, smeared with pond sludge, and came back.');
        addThought(s, { id: 'walked_among', label: 'I walked among them. They let me.', mood: 4, days: 10 }, 1);
        for (const o of living()) if (o !== s) addThought(o, { id: 'uneasy', label: `Something is different about ${first(s)}`, mood: -3, days: 5 }, 1);
        log('lore', `${displayName(s)} smeared on the Quiet's sludge and walked down the road among the Turned, all the way to the Rexall, and back. They did not touch ${them(s)}.`);
        return `${first(s)} walked through them like a man crossing a church. Came back with a sack from the Rexall and a look we did not like. "They hum," ${they(s)} said. "Did you know that? Up close. They hum."`;
      }
      if (r < 0.8) {
        wound(s, 'bite', R.range(0.3, 0.5), R.pick(['larm', 'rarm']));
        log('lore', `${displayName(s)} tried the Quiet's sludge. Halfway down the road one of them noticed.`);
        return `Halfway down the road, one of them noticed. ${first(s)} ran. ${cap(they(s))} made it back over the wall with a bite on ${their(s)} arm.`;
      }
      killSurvivor(s, 'walked down the road wearing the Quiet\'s sludge and kept walking, toward the ponds', 'Went to be quiet with them. We watched until we couldn\'t see.');
      return `${first(s)} reached the end of the road. Then ${they(s)} kept going, toward the mill ponds, and did not look back, and none of them touched ${them(s)}.`;
    },
  },
  {
    id: 'radio_signal',
    cooldown: 1,
    weight: () => {
      const st = G.flags.radioThread as string | undefined;
      if (!st) return G.day > 6 && G.day < 30 ? (buildingLevel('radio') ? 0.8 : 0.2) : 0;
      if ((st === 'answered' || st === 'paid') && G.day >= flagN('radioNext')) return 10;
      return 0;
    },
    make: () => {
      const st = G.flags.radioThread as string | undefined;
      if (!st) {
        // the truth of the voice is decided now, and never shown
        G.flags.radioTrue = R.chance(0.5);
        return {
          id: 'radio_signal', title: 'A voice on channel 9',
          text: `Clear as a bell at four in the morning, not the loop, a real man: "This is Corliss relief, call sign Harbor Two. We have a boat on the east channel. We can take people off the west bank before the ice. Anyone receiving, give your location and your numbers. Over."\n\nThe voice is calm. Calm is the scariest thing anyone has heard in weeks.`,
          choices: [
            { label: 'Answer. Give our location.', hint: 'Whoever they are will know where we are.', effect: 'answer' },
            { label: 'Listen, but do not answer', effect: 'no' },
          ],
        };
      }
      if (st === 'answered') {
        return {
          id: 'radio_signal', title: 'Harbor Two',
          text: `Harbor Two again: "We copy your numbers. Boat is a go for the twenty-second, weather allowing. We need fuel staged at the Legion hall steps to make the run. Six cans of fuel and any medicine you can spare, as a show of good faith. Over."\n\nThe Legion hall is a long way from the landing.`,
          choices: [
            { label: 'Leave 6 fuel and 2 medicine at the Legion steps', hint: 'Faith is expensive.', effect: 'pay' },
            { label: '"Come and get it yourselves."', effect: 'no' },
          ],
        };
      }
      return {
        id: 'radio_signal', title: 'The Legion steps',
        text: 'Someone went to look at the Legion hall steps at first light.',
        choices: [{ label: 'And?', effect: 'x' }],
      };
    },
    resolve: (c) => {
      const st = G.flags.radioThread as string | undefined;
      const truth = !!G.flags.radioTrue;
      if (!st) {
        if (c === 1) { G.flags.radioThread = 'ignored'; log('lore', 'A voice calling itself Harbor Two offered a boat. We did not answer.'); return 'It called for an hour, then stopped. We will never know.'; }
        G.flags.radioThread = 'answered';
        G.flags.radioNext = G.day + 2;
        for (const s of living()) addThought(s, { id: 'harbor', label: 'Harbor Two. A boat.', mood: hasTrait(s, 'grim') ? 0 : 6, days: 4 }, 1);
        log('lore', 'We answered the voice calling itself Harbor Two, and told it where we are.');
        return '"Copy, Ferry Road. Stand by." Static.';
      }
      if (st === 'answered') {
        if (c === 1) { G.flags.radioThread = 'done'; return '"Copy," the voice said, and the channel went dead, and stayed dead.'; }
        if (G.stores.fuel < 6) { G.flags.radioThread = 'done'; return 'We did not have six cans. When we told them, the channel went dead.'; }
        pay({ fuel: 6, meds: Math.min(2, G.stores.meds) });
        G.flags.radioThread = 'paid';
        G.flags.radioNext = G.day + 2;
        log('event', 'We left fuel and medicine on the Legion hall steps for Harbor Two.');
        return 'We left it on the steps under a tarp. Somebody wrote FERRY ROAD on the tarp in marker.';
      }
      G.flags.radioThread = 'done';
      if (truth) {
        add('rifle', 20); add('meds', 4); add('food', 10);
        G.flags.radioPayoff = true;
        for (const s of living()) addThought(s, { id: 'harbor_true', label: 'Somebody out there kept their word', mood: 10, days: 5 }, 1);
        log('lore', 'Harbor Two kept faith, in a way. The fuel was gone. In its place: a Guard crate and a note. "No boat. They won\'t let us. Line stays shut. This is what I could do. I\'m sorry. — Cpl. R. Strand."');
        return 'The fuel was gone. In its place, a Guard crate of rifle rounds, medicine and rations, and a note in pencil: "No boat. They won\'t let us. Line stays shut. This is what I could do. I\'m sorry. — Cpl. R. Strand." (Kyle Strand\'s mother is at the Parish. Somebody should tell her.)';
      }
      G.flags.forceSpecial = 'raiders';
      for (const s of living()) addThought(s, { id: 'harbor_lie', label: 'Harbor Two was a lie', mood: -8, days: 5 }, 1);
      log('event', 'Harbor Two was a lie. The Legion steps were bare, and there were tire tracks, and the radio said: "Thanks, Ferry Road. See you tonight."');
      return 'Bare steps. Tire tracks in the frost. Then the radio, the same calm voice: "Thanks, Ferry Road. Appreciate the fuel. See you tonight." (Raiders tonight.)';
    },
  },
  {
    id: 'hidden_bite',
    cooldown: 2,
    weight: () => (living().some((s) => hiddenBite(s) && !G.flags[`hb_${s.id}`]) && living().length >= 2 ? 4 : 0),
    make: () => {
      const s = living().find((x) => hiddenBite(x) && !G.flags[`hb_${x.id}`]);
      if (!s) return null;
      const by = lowestSpotlight(living().filter((x) => x !== s && !x.child)) ?? living().find((x) => x !== s);
      if (!by) return null;
      G.flags[`hb_${s.id}`] = true;
      const w = s.wounds.find((x) => x.kind === 'bite' && x.hidden)!;
      return {
        id: 'hidden_bite', title: 'A rolled-down sleeve',
        text: `${first(by)} was handing ${first(s)} a cup of coffee and saw it, just for a second: under the cuff, on the ${PART_NAMES[w.part]}, a dressing gone the colour of weak tea. ${first(s)} pulled the sleeve down. Their eyes met.\n\nNobody else saw.`,
        data: { s: s.id, by: by.id },
        choices: [
          { label: `${first(by)} calls it out at breakfast`, hint: 'Everyone knows now. It will be ugly.', effect: 'loud' },
          { label: `${first(by)} takes ${them(s)} aside`, hint: 'Quietly. Give them a chance to say it.', effect: 'quiet' },
          { label: `${first(by)} says nothing`, hint: 'And watches.', effect: 'none' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!, by = byId(d.by as string)!;
      if (s.dead) return '';
      if (c === 2) {
        addThought(by, { id: 'knows', label: `I know about ${first(s)}'s arm`, mood: -8, days: 4 }, 1);
        tale(by, `Kept ${first(s)}'s secret, for a while.`);
        return `${first(by)} drank ${their(by)} coffee and said nothing, and slept that night with a hatchet under the cot.`;
      }
      for (const w of s.wounds) w.hidden = false;
      if (c === 0) {
        for (const o of living()) if (o !== s) changeOpinion(o, s, -15);
        changeOpinion(s, by, -30);
        addThought(s, { id: 'exposed', label: 'Exposed at breakfast like a thief', mood: -12, days: 5 }, 1);
        log('event', `${displayName(by)} exposed ${displayName(s)}'s hidden bite at breakfast. Somebody knocked over a chair.`);
        return `Chairs scraped back. Somebody picked up a rifle and put it down again. ${first(s)} rolled up the sleeve and held the arm out across the table like evidence.`;
      }
      changeOpinion(s, by, 15);
      for (const o of living()) if (o !== s) changeOpinion(o, s, -5);
      tale(by, `Got ${first(s)} to show the bite, quietly, before it was too late.`);
      log('event', `${displayName(s)} showed the others the bite ${they(s)} had hidden, with ${displayName(by)} standing next to ${them(s)}.`);
      return `They talked on the porch. Then ${first(s)} came in and rolled up the sleeve in front of everyone, with ${first(by)} standing beside ${them(s)}.`;
    },
  },
  {
    id: 'bellwether',
    weight: () => (G.day >= 12 && G.day < ICE_DAY && !G.flags.bellHeard ? (G.day >= 19 ? 9 : 0.6) : 0),
    make: () => {
      G.flags.bellHeard = true;
      const s = lowestSpotlight(adults());
      return {
        id: 'bellwether', title: 'The bell',
        text: `At 3:10 in the morning the bell at Trinity Lutheran began to ring. Nobody has been in that tower since All Saints'. Nobody living.\n\nIt rang for forty minutes. ${s ? `${first(s)} counted.` : 'We counted.'} All down the road the Turned stopped and turned their faces toward the church, every one of them, like a congregation. When it stopped, they stood a while longer. Then they went back to walking east, toward the river, toward the ice.`,
        data: { s: s?.id },
        choices: [
          ...(s ? [{ label: `${first(s)} goes to look at the church at first light`, hint: 'Daylight. Probably safe.', effect: 'go' }] : []),
          { label: 'Bar the door and do not talk about it', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      log('lore', 'The All Saints\' bell rang again for forty minutes before dawn. The Turned all faced the church while it rang.');
      for (const o of living()) addThought(o, { id: 'bell', label: 'The bell at Trinity', mood: hasTrait(o, 'faithful') ? -8 : -4, days: 3 }, 1);
      const s = d.s ? byId(d.s as string) : undefined;
      if (c !== 0 || !s || s.dead) return 'Nobody slept. Nobody said why.';
      const doc = R.chance(0.6) ? findDoc() : null;
      tale(s, 'Climbed the Trinity bell tower after the bell rang and found no one there.');
      if (R.chance(0.2)) {
        wound(s, 'laceration', R.range(0.2, 0.4));
        return `${first(s)} climbed the tower. The bell rope was cut, years ago by the look of it. There was nobody. There was a smell of bread. On the way down the rotten stair gave way.${doc ? ` ${cap(they(s))} brought back: ${doc.title}.` : ''}`;
      }
      return `${first(s)} climbed the tower. The bell rope was cut, years ago by the look of it. There was nobody, and no footprints in the dust but ${their(s)} own. Only the smell of bread.${doc ? ` ${cap(they(s))} brought back: ${doc.title}.` : ''}`;
    },
  },
  {
    id: 'masterwork_gift',
    cooldown: 10,
    weight: () => (G.day > 10 && G.weapons.some((w) => w.name) ? 0.15 : 0),
    make: () => {
      const w = G.weapons.find((x) => x.name);
      if (!w) return null;
      return {
        id: 'masterwork_gift', title: 'Carvings',
        text: `Somebody has been carving on the long nights. On the stock of "${w.name}": ${w.kills} small notches in rows of ten, and under them, a list of names. Not the Turned. Ours. The people we have lost${G.graves.length ? `: ${G.graves.slice(-4).map(first).join(', ')}` : ', which is no one yet, and so the space is left blank'}.`,
        choices: [{ label: 'Leave it be', effect: 'x' }],
      };
    },
    resolve: () => {
      log('tale', 'Somebody carved the names of our dead into a gun stock.');
      return 'Nobody owns up to it. Everybody runs a thumb over it before the wall.';
    },
  },
];

/** Dawn bookkeeping for story threads. */
export function storyTick(): string[] {
  const out: string[] = [];
  if (G.flags.lightsOff) {
    try {
      const l = JSON.parse(G.flags.lightsOff as string) as { lights: number; turrets: number; day: number };
      if (G.day > l.day) {
        G.fort.lights += l.lights;
        G.fort.turrets = (G.fort.turrets ?? 0) + l.turrets;
        delete G.flags.lightsOff;
        out.push('The generator runs again; the floodlights are back.');
      }
    } catch { delete G.flags.lightsOff; }
  }
  return out;
}

