// Faction consequences: what standing with the four powers of Vessey actually does.
// County hostile -> they come at night. County friendly -> ammo, and the Register.
// Local 41 -> steel for shooters, and the mill after the ice (an ending).
// The Parish -> refugees and medicine; they watch the smoke when we burn bodies.
// The Ferry families -> better trades, and a last crossing before the ice (an ending).
import type { Survivor } from '../types';
import { G, R, log, add, has, pay, rep, ICE_DAY, docsFound } from '../state';
import {
  living, first, displayName, makeSurvivor, addThought, changeOpinion, wound, killSurvivor, isBitten, byId, tale,
  hasTrait, they, them, their, pain, leader,
} from './survivors';
import { type Incident, popIntent, lowestSpotlight, shiftRep, flagN, admit, ids } from './incident';

const visiblyBitten = (s: Survivor) => isBitten(s) && !s.wounds.some((w) => w.kind === 'bite' && w.hidden);
const bestBy = (k: keyof Survivor['skills'], list = living().filter((s) => !s.child && !s.breakState)) =>
  [...list].sort((a, b) => b.skills[k] - a.skills[k])[0] as Survivor | undefined;

function sendAway(s: Survivor, days: number, why: string) {
  s.breakState = { kind: 'away', days };
  G.flags[`awayWhy_${s.id}`] = why;
}

export const FACTION_INCIDENTS: Incident[] = [
  // ============ THE COUNTY (Sgt. Hale) ============
  {
    id: 'county_warn',
    cooldown: 5,
    weight: () => (rep('county') <= -40 && G.day > 4 && G.day >= flagN('countyNext') ? 12 : 0),
    make: () => {
      const talker = bestBy('social');
      const fine = { food: 15, rifle: 15 };
      G.flags.countyNext = G.day + 6;
      return {
        id: 'county_warn', title: 'Sergeant Hale',
        text: `A County cruiser idles at the bottom of Ferry Road with its lightbar dark. Sergeant Hale gets out alone, in his Guard parka with the unit patch cut off, and does not come closer than rifle range.\n\n"This house fired on deputies of Aubin County. I've got it in the book. Tonight we come up this road and we settle it. Anybody who wants to walk to the courthouse before dark gets a cot and a number. That's more than you gave us."\n\nHe waits. He is a patient man.`,
        data: { talker: talker?.id, fine },
        choices: [
          { label: 'Pay the fine: 15 food, 15 rifle rounds', hint: has(fine) ? 'It hurts. It ends it.' : 'We do not have it.', effect: 'pay' },
          ...(talker ? [{ label: `Send ${first(talker)} down to talk`, hint: `${first(talker)}'s social skill against a man with a list.`, effect: 'talk' }] : []),
          { label: '"Then come up the road."', hint: 'Raiders tonight. They shoot back.', effect: 'fight' },
        ],
      };
    },
    resolve: (c, d) => {
      const talker = d.talker ? byId(d.talker as string) : undefined;
      const opts = talker ? ['pay', 'talk', 'fight'] : ['pay', 'fight'];
      const pick = opts[c];
      const fine = d.fine as { food: number; rifle: number };
      if (pick === 'pay' && has(fine)) {
        pay(fine);
        log('event', 'We paid Sergeant Hale\'s fine. He wrote PAID in the Exposure Register and drove away.');
        for (const s of living()) addThought(s, { id: 'extorted', label: 'Paid off the County', mood: -5, days: 3 }, 1);
        return `Hale counted it on the hood of the cruiser. "Paid." He wrote it in the book.` + shiftRep('county', 45);
      }
      if (pick === 'talk' && talker) {
        const p = Math.min(0.85, 0.25 + talker.skills.social * 0.07);
        if (R.chance(p)) {
          tale(talker, 'Walked down Ferry Road alone and talked Sergeant Hale out of a war.');
          log('tale', `${displayName(talker)} walked down to the County cruiser alone and talked Sergeant Hale out of coming up the road.`);
          for (const s of living()) if (s !== talker) changeOpinion(s, talker, 10);
          return `They talked for an hour, leaning on the cruiser. ${first(talker)} came back up the road ${R.pick(['with a cigarette Hale gave ' + them(talker), 'white and silent', 'laughing, of all things'])}. "He's tired. He's just tired. He's not coming."` + shiftRep('county', 30);
        }
        wound(talker, 'bruise', R.range(0.3, 0.5), 'head');
        G.flags.forceSpecial = 'raiders';
        G.flags.countyRaidDay = G.day;
        log('event', `${displayName(talker)} went down to talk to Sergeant Hale and came back with a split lip. They are coming tonight.`);
        return `It went wrong. A deputy put a rifle butt into ${first(talker)}'s face and Hale did not stop him. "Tonight," he said.` + shiftRep('county', -5);
      }
      G.flags.forceSpecial = 'raiders';
      G.flags.countyRaidDay = G.day;
      for (const s of living()) addThought(s, { id: 'ready', label: 'They\'re coming for us tonight', mood: hasTrait(s, 'bloodlust') ? 4 : -4, days: 1 }, 1);
      log('event', 'Sergeant Hale told us the County would come up Ferry Road tonight. We told him to come.');
      return pick === 'pay' ? 'We could not pay. Hale nodded like he expected that. "Tonight, then."' : 'Hale got back in the cruiser. "Tonight, then." Raiders are coming. They will shoot back.';
    },
  },
  {
    id: 'county_ammo',
    weight: () => (rep('county') >= 40 && !G.flags.countyAmmoDone && G.day > 4 ? 2 : 0),
    make: () => ({
      id: 'county_ammo', title: 'A County courtesy',
      text: `Sergeant Hale comes up the road on foot, alone, with a .30-06 ammo can under each arm. He sets them down at the gate.\n\n"You folks have been square with us. That matters. Here's the deal: you get bit in that house, you call it in. Exposure Register. We hold them at the courthouse until it's clear one way or the other. That's how we keep the Line open. That's how we all go home."`,
      choices: [
        { label: 'Take the ammunition. Shake on the deal.', hint: '+30 rifle rounds. The County will come for anyone bitten.', effect: 'deal' },
        { label: '"We look after our own."', hint: 'No ammunition. He will not like it.', effect: 'no' },
      ],
    }),
    resolve: (c) => {
      G.flags.countyAmmoDone = true;
      if (c === 0) {
        add('rifle', 30);
        G.flags.registerDeal = true;
        log('event', 'Sergeant Hale gave us two cans of rifle rounds. We agreed to report bites to the Exposure Register.');
        return 'He shook hands with everybody, one at a time, and wrote all our names down.' + shiftRep('county', 5);
      }
      return 'He picked the cans back up. "Nobody looks after their own forever, ma\'am. Sir. Whoever\'s in charge."' + shiftRep('county', -15);
    },
  },
  {
    id: 'county_register',
    cooldown: 2,
    weight: () => {
      if (!(rep('county') >= 40 || G.flags.registerDeal)) return 0;
      return living().some((s) => visiblyBitten(s) && !G.flags[`registered_${s.id}`]) ? (G.flags.registerDeal ? 12 : 3) : 0;
    },
    make: () => {
      const s = living().find((x) => visiblyBitten(x) && !G.flags[`registered_${x.id}`]);
      if (!s) return null;
      G.flags[`registered_${s.id}`] = true;
      const l = leader();
      return {
        id: 'county_register', title: 'The Exposure Register',
        text: `Two deputies at the gate before breakfast, with a clipboard and a set of zip ties. Somebody talked, or the County just knows things.\n\n"${s.name}. Exposure, ${G.day - (s.wounds.find((w) => w.kind === 'bite')?.dayGot ?? G.day)} days. ${s.sex === 'm' ? 'He' : 'She'} comes with us to holding. If it clears, ${they(s)} comes home. Sergeant's orders."\n\nEveryone in the house has seen page 14 of that register, or heard about it. Thomas Wick. Remanded. Remanded. Struck through.`,
        data: { s: s.id, l: l?.id },
        choices: [
          { label: `Hand ${first(s)} over`, hint: 'They keep the Line. They keep their word, maybe.', effect: 'give' },
          { label: 'Hide them in the root cellar and lie', hint: l ? `${first(l)} does the talking.` : 'Someone has to do the talking.', effect: 'hide' },
          { label: '"Get off our road."', hint: 'The County will remember.', effect: 'refuse' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = byId(d.s as string)!;
      if (s.dead) return 'It no longer matters.';
      if (c === 0) {
        const close = living().filter((o) => o !== s && (o.rel[s.id]?.opinion ?? 0) > 30);
        killSurvivor(s, 'remanded to County holding at the courthouse. Disposition: per Sgt. Hale', `Walked down Ferry Road with ${their(s)} hands zip-tied, and did not look back so we would not have to.`);
        for (const o of living()) addThought(o, { id: 'gave_up', label: `We gave ${first(s)} to the County`, mood: close.includes(o) ? -18 : -8, days: 7, about: s.id }, 1);
        log('event', `We handed ${displayName(s)} to the County deputies. The Exposure Register has a new line.`);
        return `${first(s)} went quietly. At the bottom of the road ${they(s)} turned and waved once. On page 15 of the Register there will be a line with ${their(s)} name in it.` + shiftRep('county', 15);
      }
      if (c === 1) {
        const l = d.l ? byId(d.l as string) : undefined;
        const p = 0.3 + (l ? l.skills.social * 0.06 : 0);
        if (R.chance(p)) {
          tale(s, 'Hid in the root cellar while the County deputies searched the house.');
          log('event', `We hid ${displayName(s)} in the root cellar and lied to the County's face.`);
          changeOpinion(s, l ?? s, 20);
          return `They looked in every room but the one under the potato bins. "If we find out," the older one said. They did not find out.`;
        }
        log('event', `The County deputies found ${displayName(s)} in the root cellar. They did not take ${them(s)}. They wrote down that we lied.`);
        return `The younger deputy heard ${first(s)} cough under the floor. They did not take ${them(s)}; there were more of us than of them. They wrote it down.` + shiftRep('county', G.flags.registerDeal ? -70 : -45);
      }
      log('event', `We refused to give ${displayName(s)} to the Exposure Register.`);
      changeOpinion(s, living()[0], 15);
      return `The deputies looked at each other and at our guns, and left. "This goes in the book."` + shiftRep('county', G.flags.registerDeal ? -60 : -35);
    },
  },
  {
    id: 'county_census',
    weight: () => (G.day > 3 && !G.flags.censusDone && rep('county') > -40 ? 0.7 : 0),
    make: () => ({
      id: 'county_census', title: 'A man with a clipboard',
      text: `A young deputy, maybe twenty, his sheriff's star pinned to a hunting jacket. He reads from a clipboard in a voice he is trying to make deep.\n\n"Aubin County census for the Exposure Register. Names, ages, any wounds. It's for the Line. When they reopen it, they go by the list. If you're not on the list..." He trails off. He doesn't know either.`,
      choices: [
        { label: 'Give him our names', hint: 'The County will know us. That cuts both ways.', effect: 'give' },
        { label: 'Give him false names', hint: 'He might know some of us.', effect: 'lie' },
        { label: 'Send him away', effect: 'no' },
      ],
    }),
    resolve: (c) => {
      G.flags.censusDone = true;
      if (c === 0) {
        for (const s of living()) if (hasTrait(s, 'secretive')) addThought(s, { id: 'listed', label: 'My name is in their book now', mood: -6, days: 5 }, 1);
        log('event', 'We gave our names to the County census.');
        return 'He wrote them all down carefully, and thanked us, and asked if we had any coffee.' + shiftRep('county', 12);
      }
      if (c === 1) {
        if (R.chance(0.5)) { log('event', 'We gave the County census a list of made-up names. Somebody put down "Elvis Halvorsen".'); return 'He wrote down "Elvis Halvorsen" without blinking.' + shiftRep('county', 4); }
        return `"My aunt is ${living()[0].name.split(' ')[1] ?? 'your neighbor'}," he said quietly, and tore out the page.` + shiftRep('county', -15);
      }
      return 'He walked back down the road reading his own list.' + shiftRep('county', -8);
    },
  },

  // ============ LOCAL 41 (Dolores Wick) ============
  {
    id: 'union_steel',
    cooldown: 4,
    weight: () => (rep('union') >= 25 && G.day > 6 && G.day < 40 ? 1.4 : 0),
    make: () => {
      const s = bestBy('shooting');
      return {
        id: 'union_steel', title: 'Steel for shooters',
        text: `The Union sled comes up Mill Road dragging sheet steel and railroad spikes. The runner has a note from Steward Wick in grease pencil:\n\n"SAME DEAL AS ALWAYS. Lend us a shooter two nights, take the steel. Or rifle rounds. We're short on both. — D.W."`,
        data: { s: s?.id },
        choices: [
          ...(s && living().length > 2 ? [{ label: `Lend ${first(s)} for two nights`, hint: '+50 wall, 15 salvage. One fewer gun on our wall.', effect: 'lend' }] : []),
          { label: 'Trade 12 rifle rounds', hint: '26 salvage.', effect: 'ammo' },
          { label: 'Not this time', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      const s = d.s ? byId(d.s as string) : undefined;
      const opts = s && living().length > 2 ? ['lend', 'ammo', 'no'] : ['ammo', 'no'];
      const pick = opts[c];
      if (pick === 'lend' && s && !s.dead) {
        sendAway(s, 2, 'union');
        G.fort.maxHp += 50; G.fort.hp += 50; add('salvage', 15);
        tale(s, 'Stood the Union\'s wall at the mill for two nights.');
        log('event', `${displayName(s)} went to stand the Local 41 wall for two nights. The sled left steel.`);
        return `${first(s)} rode back on the empty sled. The steel went up on our wall by noon.` + shiftRep('union', 6);
      }
      if (pick === 'ammo') {
        if (G.stores.rifle < 12) return 'We did not have twelve rounds to spare. The runner shrugged and took the steel home.';
        add('rifle', -12); add('salvage', 26);
        return 'The runner counted the rounds twice. "Wick says thanks. She doesn\'t say that."' + shiftRep('union', 4);
      }
      return 'The sled went back down Mill Road, still loaded.' + shiftRep('union', -3);
    },
  },
  {
    id: 'union_pond',
    weight: () => (G.day > 8 && !G.flags.pondDone && rep('union') > -40 ? 0.6 : 0),
    make: () => {
      const s = lowestSpotlight();
      return {
        id: 'union_pond', title: 'What the Union signed',
        text: `A Local 41 man named Kessler turned up drunk at the gate last night, wanting to trade a bottle for a place by the fire. ${first(s)} sat up with him. Near dawn he said it:\n\n"Pond 2. The process change. Management wanted it, and the Local signed off, because it was that or the third shift. We knew it smelled wrong. Dolores knew. We all knew. Jobs, you understand. Jobs."\n\nHe left at first light. He did not seem to remember saying it.`,
        data: { s: s.id },
        choices: [
          { label: 'Keep it to ourselves', hint: 'Local 41 never needs to know we know.', effect: 'keep' },
          { label: 'Tell Pastor Engvall', hint: 'The Parish keeps the registry of the dead.', effect: 'parish' },
          ...(G.buildings.some((b) => b.id === 'radio') ? [{ label: 'Put it out on the radio', hint: 'Everyone in Vessey will know.', effect: 'radio' }] : []),
        ],
      };
    },
    resolve: (c) => {
      G.flags.pondDone = true;
      log('lore', 'A drunk Union man said Local 41 signed off on the Pond 2 process change to save the third shift.');
      if (c === 0) return 'Some things you carry so nobody else has to. Or so you can use them later.';
      if (c === 1) {
        log('event', 'We told Pastor Engvall what Kessler said about Pond 2.');
        return 'Ruth Engvall read it twice, folded it, and put it in her Bible. "It was always going to be somebody\'s signature."' + shiftRep('parish', 10) + shiftRep('union', -25);
      }
      log('event', 'We broadcast what the Union signed about Pond 2. The CB was quiet for a long time after.');
      return 'For a long time nobody on channel 19 said anything. Then somebody keyed the mic and just breathed.' + shiftRep('union', -40) + shiftRep('county', 10);
    },
  },
  {
    id: 'union_thomas',
    weight: () => (G.day > 10 && !G.flags.thomasDone && rep('union') >= 10 ? (docsFound().includes('exposure') ? 2 : 0.5) : 0),
    make: () => ({
      id: 'union_thomas', title: 'Dolores Wick',
      text: `The Steward comes herself: sixty, in a Carhartt with LOCAL 41 sewn on in red, a deer rifle slung like a purse. She will not come inside.\n\n"My boy Thomas got bit on the twenty-seventh. The County took him to holding. They told me he was being looked after. I've been sending soup up to that courthouse for two weeks." She looks at our wall. "You folks get around. You hear things. Have you heard anything?"${docsFound().includes('exposure') ? '\n\nWe have page 14 of the Exposure Register. Wick, Thomas. Struck through. Disposition: per Sgt. Hale.' : ''}`,
      choices: [
        { label: docsFound().includes('exposure') ? 'Show her page 14' : 'Tell her what people say about the Register', hint: 'Local 41 and the County will be at war.', effect: 'truth' },
        { label: '"We haven\'t heard anything."', effect: 'none' },
        { label: '"We heard he got across to Grace Island."', hint: 'A kind lie. Lies keep.', effect: 'lie' },
      ],
    }),
    resolve: (c) => {
      G.flags.thomasDone = true;
      if (c === 0) {
        log('event', 'We told Dolores Wick what the Exposure Register says about her son.');
        return `She read it standing up. She read it again. Then she folded it into her breast pocket and said, "Hale," just that, and walked back to the mill.` + shiftRep('union', 25) + shiftRep('county', -20);
      }
      if (c === 1) return 'She nodded like she\'d expected it. "Everybody works a shift," she said, to nobody, and left.';
      G.flags.thomasLie = true;
      for (const s of living()) if (hasTrait(s, 'kind') || hasTrait(s, 'faithful')) addThought(s, { id: 'lied_wick', label: 'We lied to a mother', mood: -4, days: 4 }, 1);
      return 'Something in her face came undone. "Grace Island," she said. "He always liked the island." She left us a box of shotgun shells.' + (add('shell', 12), shiftRep('union', 10));
    },
  },
  {
    id: 'union_mill',
    cooldown: 4,
    weight: () => (G.day > ICE_DAY && rep('union') >= 40 && flagN('millOffers') < 3 ? (flagN('millOffers') === 0 ? 14 : 1.5) : 0),
    make: () => {
      G.flags.millOffers = flagN('millOffers') + 1;
      const bitten = living().filter(visiblyBitten);
      return {
        id: 'union_mill', title: 'The mill',
        text: `Dolores Wick on the radio, or her runner at the gate; it is the same voice.\n\n"River's ice. They're walking across every night now and your little house is on the wrong side of it. We've got a fence, steam heat off the boilers until April, and steel. Everybody works a shift. Bring your people. Bring your guns. Not your bitten. Never the bitten."\n\nIt is two miles up Mill Road in the snow.${bitten.length ? `\n\n${bitten.map(first).join(' and ')} would have to stay behind.` : ''}`,
        data: { bitten: ids(bitten) },
        choices: [
          { label: 'Walk everyone to the mill', hint: 'This ends the story of the house on Ferry Road.', effect: 'go' },
          { label: '"Not yet. The house is ours."', hint: 'She may ask again.', effect: 'stay' },
        ],
      };
    },
    resolve: (c) => {
      if (c === 1) return 'Wick: "Offer stands. Until it doesn\'t."';
      const bitten = living().filter(visiblyBitten);
      const walkers = living().filter((s) => !bitten.includes(s));
      let lost: Survivor | undefined;
      // two miles in the snow: the worst hurt might not make it
      const weak = walkers.filter((s) => pain(s) > 0.7);
      if (weak.length && R.chance(0.3)) {
        lost = R.pick(weak);
        killSurvivor(lost, 'on the walk up Mill Road, in the snow, a quarter mile from the mill gate', 'Almost made it. Almost is the cruelest word in Vessey.');
      }
      for (const b of bitten) tale(b, 'Stayed behind in the house on Ferry Road when the others walked to the mill.');
      G.flags.ending = 'mill';
      G.flags.endWent = ids(walkers.filter((s) => s !== lost));
      G.flags.endStayed = ids(bitten);
      log('event', `We walked to the mill compound up Mill Road${bitten.length ? `, and left ${bitten.map(first).join(' and ')} behind with a lamp and a gun` : ''}.${lost ? ` ${first(lost)} did not make it to the gate.` : ''}`);
      return 'We closed the door of the house on Ferry Road behind us.';
    },
  },

  // ============ THE PARISH (Pastor Ruth Engvall) ============
  {
    id: 'parish_refugees',
    cooldown: 5,
    weight: () => (rep('parish') >= 30 && G.day > 4 ? 0.5 + popIntent() * 0.4 : 0),
    make: () => {
      const n = makeSurvivor();
      return {
        id: 'parish_refugees', title: 'From the Parish gym',
        text: `Pastor Engvall walks up Ferry Road herself, in a man's parka and a clerical collar gone grey, leading ${n.name} by the elbow and pulling a sled with a cooler on it.\n\n"We're over a hundred in the gym and the boiler's going. ${first(n)} can work. And there's medicine in the cooler, what we can spare, because you've been good to us. I won't pretend I'm not asking."\n\n${n.name}, ${n.age}. ${n.before}`,
        data: { n },
        choices: [
          { label: `Take ${first(n)} and the medicine`, fx: { people: 1, gain: { meds: 3 }, rep: { parish: 5 } }, effect: 'both' },
          { label: 'Take only the medicine', hint: 'Ruth will remember.', fx: { gain: { meds: 3 }, rep: { parish: -12 } }, effect: 'meds' },
          { label: 'Send them both back', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      const n = d.n as Survivor;
      if (c === 0) {
        add('meds', 3);
        admit(n, 'parish');
        addThought(n, { id: 'parish_sent', label: 'Pastor Ruth sent me somewhere safer', mood: 5, days: 4 }, 1);
        return `${first(n)} is one of us now. Ruth prayed over the cooler, briefly, and pulled the empty sled home.` + shiftRep('parish', 5);
      }
      if (c === 1) {
        add('meds', 3);
        for (const s of living()) if (hasTrait(s, 'kind') || hasTrait(s, 'faithful')) addThought(s, { id: 'took_meds', label: 'We took the medicine and not the person', mood: -6, days: 4 }, 1);
        return `Ruth left the cooler. She did not say anything. ${first(n)} walked back with her.` + shiftRep('parish', -12);
      }
      return `"God keep you," Ruth said, and meant it, which was worse.` + shiftRep('parish', -4);
    },
  },
  {
    id: 'parish_burn',
    weight: () => (flagN('burned') > flagN('parishSawBurn') && rep('parish') > -60 && G.day > 2 ? 9 : 0),
    make: () => {
      G.flags.parishSawBurn = flagN('burned');
      return {
        id: 'parish_burn', title: 'The smoke',
        text: `Pastor Engvall is at the gate. She saw the smoke from the gym roof; everyone did.\n\n"We keep a registry. Every soul in Vessey, living, missing, turned, dead. When somebody's burned on the road like a brush pile, I have to write 'burned' in the registry, and I have to tell their people that's how it ended." She is not shouting. "They were somebody. Every one of them was somebody."`,
        choices: [
          { label: 'Promise to bury our dead from now on', hint: 'Break the promise and the Parish will know.', effect: 'promise' },
          { label: 'Let her bless the ashes', hint: 'Faithful survivors will be grateful.', effect: 'bless' },
          { label: '"The dead don\'t care how."', effect: 'cold' },
        ],
      };
    },
    resolve: (c) => {
      if (c === 0) {
        G.flags.promisedBury = true;
        log('event', 'We promised Pastor Engvall we would bury our dead.');
        return '"Thank you," she said. "I\'ll hold you to that. God will too, but I\'m closer."' + shiftRep('parish', -5);
      }
      if (c === 1) {
        for (const s of living()) if (hasTrait(s, 'faithful') || hasTrait(s, 'gentle')) addThought(s, { id: 'blessed', label: 'Pastor Ruth blessed the ashes', mood: 6, days: 4 }, 1);
        log('event', 'Pastor Engvall knelt on the road where we burned our dead and prayed over the ashes.');
        return 'She knelt in the wet ash in the road and prayed for a long time. Some of us knelt with her.' + shiftRep('parish', -10);
      }
      return '"No," Ruth said. "But I do." She walked home.' + shiftRep('parish', -25);
    },
  },
  {
    id: 'parish_basement',
    weight: () => (G.day > 9 && rep('parish') >= 10 && !G.flags.basementDone ? 0.7 : 0),
    make: () => {
      const s = bestBy('shooting');
      if (!s) return null;
      return {
        id: 'parish_basement', title: 'The gym basement',
        text: `A note in Ruth Engvall's careful hand, delivered by a boy who ran the whole way:\n\n"I need someone who can do what I can't. We have been keeping some of our people in the gym basement. Turned, but home. The Haugens. Mrs. Lindqvist. Families asked and I said yes. Last night one of them got loose and a little girl was bitten. I can't keep saying yes. Please. Quietly. — R.E."\n\n${first(s)} is the best shot in the house.`,
        data: { s: s.id },
        choices: [
          { label: `Send ${first(s)}`, hint: 'Ruth will owe us. It will cost ' + first(s) + '.', effect: 'go' },
          { label: '"We can\'t do this for you."', effect: 'no' },
          { label: 'Tell the County what is in that basement', hint: 'Sgt. Hale will clear it his own way.', effect: 'county' },
        ],
      };
    },
    resolve: (c, d) => {
      G.flags.basementDone = true;
      const s = byId(d.s as string)!;
      if (c === 0 && !s.dead) {
        addThought(s, { id: 'basement', label: 'The gym basement', mood: hasTrait(s, 'gentle') || hasTrait(s, 'faithful') ? -16 : -9, days: 7 }, 1);
        tale(s, 'Went down into the Parish basement for Pastor Ruth, and did what she could not.');
        log('tale', `${displayName(s)} went down into the Parish gym basement with a flashlight and a rifle. Pastor Engvall held the light.`);
        return `Ruth held the flashlight. She said each of their names before ${first(s)} fired. Eleven names. ${first(s)} has not talked about it.` + shiftRep('parish', 30);
      }
      if (c === 1) return 'The boy ran back. We did not hear what happened.' + shiftRep('parish', -3);
      log('event', 'We told the County what the Parish kept in the gym basement.');
      for (const o of living()) if (hasTrait(o, 'faithful') || hasTrait(o, 'kind')) addThought(o, { id: 'betrayed_parish', label: 'We sold out the Parish', mood: -8, days: 5 }, 1);
      return 'Hale went in with six men and gasoline. Afterwards Ruth Engvall stood in the gym doorway for a whole day and did not speak.' + shiftRep('county', 25) + shiftRep('parish', -45);
    },
  },

  // ============ THE FERRY FAMILIES (Peltier, Doucette, Halvorsen) ============
  {
    id: 'ferry_fuel',
    cooldown: 5,
    weight: () => (G.day > 4 && G.day < ICE_DAY && rep('ferry') > -40 ? 0.8 : 0),
    make: () => ({
      id: 'ferry_fuel', title: 'Gene Halvorsen',
      text: `Gene Halvorsen, seventy, diabetic, the ferry's captain since 1979, at the gate with an empty jerry can in each hand.\n\n"Cable ferry runs on a diesel winch, and the winch runs on what people bring. Every crossing we make, somebody gets off this bank. Ice in a couple weeks. Whatever you can spare."`,
      choices: [
        { label: 'Fill both cans (6 fuel)', hint: 'The Ferry families do not forget.', effect: 'six' },
        { label: 'Half a can (3 fuel)', effect: 'three' },
        { label: '"We\'re burning the furniture already."', effect: 'no' },
      ],
    }),
    resolve: (c) => {
      if (c === 0) {
        if (G.stores.fuel < 6) return 'We did not have six to give. Gene thanked us for meaning it.';
        add('fuel', -6);
        log('event', 'We filled Gene Halvorsen\'s jerry cans for the night crossings.');
        return 'Gene shook every hand in the house, slowly. "Remember the landing," he said. "When it\'s time."' + shiftRep('ferry', 18);
      }
      if (c === 1) {
        if (G.stores.fuel < 3) return 'We did not have even that.';
        add('fuel', -3);
        return '"Every bit," Gene said.' + shiftRep('ferry', 8);
      }
      return 'Gene nodded. He has heard that a lot this month.' + shiftRep('ferry', -4);
    },
  },
  {
    id: 'ferry_kid',
    weight: () => (G.day > 8 && G.day < ICE_DAY && !G.flags.kidDone && rep('ferry') >= 10 ? 1 : 0),
    make: () => {
      const s = bestBy('shooting');
      if (!s) return null;
      return {
        id: 'ferry_kid', title: 'The Peltier girl',
        text: `Marie Doucette comes up from the landing in hip waders. "Lights on Grace Island, and they're not ours. Annie Peltier's out there, fifteen, she went across for her dad's insulin and she hasn't come back. I need a shooter in the bow tonight. Somebody who doesn't miss."\n\nShe looks at ${first(s)}.`,
        data: { s: s.id },
        choices: [
          { label: `Send ${first(s)} in the bow`, hint: 'Gone a night and a day. The Ferry families will owe us.', effect: 'go' },
          { label: '"We need every gun on the wall."', effect: 'no' },
        ],
      };
    },
    resolve: (c, d) => {
      G.flags.kidDone = true;
      const s = byId(d.s as string)!;
      if (c === 1 || s.dead) return 'Marie went back to the landing alone. The boat went out anyway.' + shiftRep('ferry', -6);
      sendAway(s, 1, 'ferry');
      const r = R.next();
      if (r < 0.6) {
        tale(s, 'Rode in the bow of the Doucette boat to Grace Island and brought Annie Peltier home.');
        log('tale', `${displayName(s)} rode the bow of the Doucette boat to Grace Island in the dark and brought Annie Peltier home.`);
        G.flags.annieSaved = true;
        return `${first(s)} will be back tomorrow. Word came up from the landing at dawn: they found Annie in the boathouse on the island, alive, hungry, furious. Old Peltier cried.` + shiftRep('ferry', 30);
      }
      if (r < 0.85) {
        wound(s, R.pick(['laceration', 'gunshot'] as const), R.range(0.25, 0.5));
        tale(s, 'Went to Grace Island in the Doucette boat. Whatever was on the island shot back.');
        log('event', `${displayName(s)} went to Grace Island for the Ferry families. The lights on the island were not friendly.`);
        return `The lights on the island were men, not the Turned, and they shot at the boat. ${first(s)} is hurt. They came back without Annie.` + shiftRep('ferry', 15);
      }
      wound(s, 'bite', R.range(0.3, 0.5), R.pick(['larm', 'rarm']));
      log('event', `${displayName(s)} went to Grace Island and found Annie Peltier, turned, in the boathouse.`);
      return `They found Annie. ${first(s)} did what had to be done, and got bitten doing it. Old Peltier says he owes us anyway.` + shiftRep('ferry', 20);
    },
  },
  {
    id: 'ferry_word',
    weight: () => (G.day >= 12 && G.day <= 18 && rep('ferry') >= 25 && !G.flags.ferryWord ? 2 : 0),
    make: () => ({
      id: 'ferry_word', title: 'A word at the landing',
      text: `Old Peltier, not trading today. He sits on our woodpile and rolls a cigarette with his hands shaking.\n\n"There'll be a last crossing. Before the ice. Doucette boat, the big one, to the island and down the east channel past the Line. Friends only, and I mean friends. Not enough seats for everybody, never is." He licks the paper. "Thought you should know. Thought you should start thinking about who."`,
      choices: [
        { label: '"We\'ll be at the landing."', hint: 'Keep the Ferry families friendly (around day 18–22).', effect: 'yes' },
        { label: '"We\'re staying. The house is ours."', hint: 'No crossing will be offered.', effect: 'no' },
      ],
    }),
    resolve: (c) => {
      G.flags.ferryWord = true;
      if (c === 1) { G.flags.ferryNo = true; return 'Peltier shrugged. "Most do." He finished the cigarette and went back down to the water.'; }
      for (const s of living()) addThought(s, { id: 'ferry_hope', label: 'There might be a way across', mood: hasTrait(s, 'optimist') ? 8 : 4, days: 6 }, 1);
      log('event', 'Old Peltier told us about a last crossing, before the ice.');
      return '"Keep your powder dry and your fuel cans full," Peltier said. "And stay on the right side of Marie Doucette."';
    },
  },
  {
    id: 'ferry_last',
    cooldown: 2,
    weight: () => (G.day >= 18 && G.day < ICE_DAY && rep('ferry') >= 40 && !G.flags.ferryNo && flagN('ferryOffers') < 2 ? 14 : 0),
    make: () => {
      G.flags.ferryOffers = flagN('ferryOffers') + 1;
      const seats = 4 + (rep('ferry') >= 70 ? 1 : 0);
      const all = living();
      const bitten = all.filter(visiblyBitten);
      const able = all.filter((s) => !bitten.includes(s));
      const plans: { label: string; hint: string; go: Survivor[] }[] = [];
      const fmt = (go: Survivor[]) => {
        const stay = all.filter((s) => !go.includes(s));
        return `Goes: ${go.map(first).join(', ')}.${stay.length ? ` Stays: ${stay.map(first).join(', ')}.` : ''}`;
      };
      if (able.length <= seats) {
        plans.push({ label: able.length === all.length ? 'Everyone goes' : 'Everyone who can goes', hint: '', go: able });
      } else {
        const strong = [...able].sort((a, b) => (b.skills.shooting + b.skills.building - pain(b) * 4) - (a.skills.shooting + a.skills.building - pain(a) * 4)).slice(0, seats);
        const young = [...able].sort((a, b) => (a.child ? -100 : a.age) - (b.child ? -100 : b.age) - (pain(a) - pain(b)) * 20).slice(0, seats);
        const lots = R.shuffle([...able]).slice(0, seats);
        plans.push({ label: 'The ones who can fight on the other side', hint: '', go: strong });
        plans.push({ label: 'The young and the hurt first', hint: '', go: young });
        plans.push({ label: 'Draw lots from a hat', hint: '', go: lots });
      }
      for (const p of plans) p.hint = fmt(p.go);
      return {
        id: 'ferry_last', title: 'The last crossing',
        text: `Marie Doucette at the gate at dusk, breath smoking. "Tonight. Two a.m. at the landing. Big boat, to the island and down the east channel past the Line. There's ice at the edges already; after tonight nobody crosses the St. Aubin until April."\n\n"${seats} seats for your house. ${seats} and not one more, I've got the Halvorsens and half the Parish kids." She does not look away. "${bitten.length ? `And not ${bitten.map(first).join(', not ')}. I'm sorry. Not the bitten.` : 'Nobody bit. I\'ll check.'}"\n\nThere are ${all.length} of us.`,
        data: { plans: plans.map((p) => p.go.map((s) => s.id)), seats },
        choices: [
          ...plans.map((p) => ({ label: p.label, hint: p.hint, effect: 'go' })),
          { label: '"We stay. All of us."', hint: flagN('ferryOffers') < 2 ? 'Marie might ask once more.' : 'This was the last boat.', effect: 'stay' },
        ],
      };
    },
    resolve: (c, d) => {
      const plans = d.plans as string[][];
      if (c >= plans.length) {
        for (const s of living()) addThought(s, { id: 'stayed', label: 'We chose the house over the boat', mood: hasTrait(s, 'ironwill') ? 4 : -3, days: 5 }, 1);
        log('event', 'Marie Doucette offered us the last crossing. We stayed.');
        return '"Your funeral," Marie said, not unkindly. "Or not. I hope not."';
      }
      const go = plans[c].map((id) => byId(id)!).filter((s) => s && !s.dead);
      const stay = living().filter((s) => !go.includes(s));
      for (const s of stay) tale(s, 'Stayed on Ferry Road the night the last boat crossed.');
      for (const g of go) tale(g, 'Crossed the St. Aubin on the last boat before the ice.');
      G.flags.ending = 'ferry';
      G.flags.endWent = ids(go);
      G.flags.endStayed = ids(stay);
      log('event', `The last crossing. ${go.map(first).join(', ')} went down to the landing at two in the morning.${stay.length ? ` ${stay.map(first).join(', ')} stayed in the house on Ferry Road.` : ''}`);
      return 'We went down to the landing in the dark.';
    },
  },
];

/** Dawn bookkeeping for faction threads. */
export function factionTick(): string[] {
  const out: string[] = [];
  if (G.flags.countyRaidDay !== undefined && G.day - (G.flags.countyRaidDay as number) >= 1) {
    delete G.flags.countyRaidDay;
    if (living().length) {
      out.push('The County came up Ferry Road in the night and went back down it. Some of them did not walk.');
      log('event', 'The County men came up Ferry Road with rifles in the night. We are still here.');
      // fear is a kind of respect
      G.flags[`rep_county`] = Math.min(-10, rep('county') + 20);
    }
  }
  if (G.day === ICE_DAY + 1 && !G.flags.ferryDone) {
    G.flags.ferryDone = true;
    log('lore', 'The ferry cable sang in the cold all night and then went slack. The Ferry families are just families now.');
  }
  for (const s of living()) {
    const why = G.flags[`awayWhy_${s.id}`];
    if (why && !s.breakState) {
      delete G.flags[`awayWhy_${s.id}`];
      out.push(why === 'union' ? `${first(s)} came back from the Union wall with steel-dust in ${their(s)} hair.` : `${first(s)} came back up from the landing, soaked to the knees.`);
    }
  }
  return out;
}
