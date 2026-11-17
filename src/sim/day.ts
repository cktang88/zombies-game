import type { Survivor, Res } from '../types';
import { G, R, log, add, pay, has, newWeapon, uid, findDoc } from '../state';
import { SITES, RECIPES, RES_LABEL } from '../data/world';
import { WEAPONS } from '../data/weapons';
import {
  living, first, displayName, workMult, skillOf, addThought, wound, canWork, rel, changeOpinion, setBond, hasTrait,
  computeMood, breakThresholds, killSurvivor, pain, they, their, tale, isBitten, PART_NAMES, closeTo, them, checkTitles,
} from './survivors';

export interface DayReport { lines: string[] }

export function buildingLevel(id: string) {
  return G.buildings.find((b) => b.id === id)?.level ?? 0;
}

// ---------- day work: runs when the player calls dusk ----------
export function resolveDayWork(): string[] {
  const out: string[] = [];
  const workers = living();
  const siteRuns: Record<string, Survivor[]> = {};
  for (const s of workers) {
    if (!canWork(s)) {
      if (s.job !== 'rest') out.push(`${first(s)} could not work today.`);
      s.rest = Math.min(1, s.rest + 0.3);
      continue;
    }
    const m = workMult(s);
    switch (s.job) {
      case 'repair': {
        const amt = Math.round((40 + skillOf(s, 'building') * 9) * m);
        const before = G.fort.hp;
        G.fort.hp = Math.min(G.fort.maxHp, G.fort.hp + amt);
        const wood = Math.min(G.stores.wood, Math.ceil((G.fort.hp - before) / 25));
        add('wood', -wood);
        out.push(`${first(s)} patched the wall (+${G.fort.hp - before}).`);
        s.rest -= 0.15;
        break;
      }
      case 'craft': {
        if (!G.craftQueue.length) {
          out.push(`${first(s)} sat at an idle bench. Nothing was queued.`);
          break;
        }
        let pts = (3 + skillOf(s, 'crafting') * 0.9) * m;
        while (pts > 0 && G.craftQueue.length) {
          const job = G.craftQueue[0];
          const r = RECIPES.find((x) => x.id === job.recipe)!;
          const need = r.work - job.progress;
          const used = Math.min(need, pts);
          job.progress += used;
          pts -= used;
          if (job.progress >= r.work - 0.01) {
            G.craftQueue.shift();
            out.push(finishRecipe(r.id, s));
          }
        }
        s.rest -= 0.12;
        break;
      }
      case 'farm': {
        const g = buildingLevel('garden');
        const amt = Math.round((1.5 + skillOf(s, 'farming') * 0.45 + g * 2.2) * m * (G.weather === 'cold' || G.weather === 'snow' ? 0.6 : 1));
        add('food', amt);
        out.push(`${first(s)} brought in ${amt} food${g ? ' from the cold frames' : ' snaring rabbits and picking frost-bit kale'}.`);
        s.rest -= 0.1;
        break;
      }
      case 'doctor': {
        const patients = living().filter((p) => p.wounds.length);
        let care = Math.round((2 + skillOf(s, 'medicine')) * m);
        for (const p of patients) {
          for (const w of p.wounds) {
            if (care <= 0) break;
            if (!w.tended) {
              w.tended = true;
              w.bleeding = false;
              care--;
              if (G.stores.meds > 0 && w.severity > 0.3) {
                add('meds', -1);
                w.severity *= 0.8;
              }
            }
          }
        }
        out.push(patients.length ? `${first(s)} tended the wounded.` : `${first(s)} sorted the medicine shelf. Nobody needed stitching. A good day.`);
        s.rest -= 0.08;
        break;
      }
      case 'scavenge': {
        const site = (G.flags[`site_${s.id}`] as string) ?? 'route9';
        (siteRuns[site] ??= []).push(s);
        s.rest -= 0.25;
        break;
      }
      case 'radio': {
        if (buildingLevel('radio') === 0) {
          out.push(`${first(s)} turned the dial of a dead transistor radio.`);
          break;
        }
        G.flags.radioWork = ((G.flags.radioWork as number) ?? 0) + (1 + skillOf(s, 'social') * 0.2) * m;
        out.push(`${first(s)} worked the CB all day.`);
        break;
      }
      case 'rest':
      default:
        s.rest = Math.min(1, s.rest + 0.35);
        addThought(s, { id: 'rested', label: 'Got a day off', mood: 3, days: 1 }, 1);
        break;
    }
    // passions
    if (s.job !== 'rest') {
      const skill = jobSkill(s.job);
      if (skill && s.passions.includes(skill)) addThought(s, { id: 'passion', label: 'Did work I care about', mood: 4, days: 1 }, 1);
      if (skill && R.chance(0.12 * (s.passions.includes(skill) ? 2 : 1)) && s.skills[skill] < 10) s.skills[skill]++;
    }
  }
  for (const [siteId, team] of Object.entries(siteRuns)) out.push(...scavenge(siteId, team));
  return out;
}

function jobSkill(j: string) {
  return ({ repair: 'building', craft: 'crafting', farm: 'farming', doctor: 'medicine', scavenge: 'scavenging', radio: 'social', guard: 'shooting' } as const)[j as 'repair'];
}

function scavenge(siteId: string, team: Survivor[]): string[] {
  const site = SITES.find((x) => x.id === siteId)!;
  const out: string[] = [];
  const stockKey = `stock_${site.id}`;
  const stock = (G.flags[stockKey] as number) ?? site.stock;
  const fullness = Math.max(0.15, stock / site.stock);
  const skill = team.reduce((a, s) => a + skillOf(s, 'scavenging') * workMult(s), 0);
  const mult = (0.55 + skill * 0.12) * fullness * (team.length > 1 ? 1 + (team.length - 1) * 0.5 : 1);
  const names = team.map(first).join(' and ');
  const got: string[] = [];
  for (const [k, v] of Object.entries(site.loot)) {
    const n = Math.round((v ?? 0) * mult * R.range(0.5, 1.4));
    if (n > 0) {
      add(k as Res, n);
      got.push(`${n} ${RES_LABEL[k as Res].toLowerCase()}`);
    }
  }
  G.flags[stockKey] = stock - 1;
  if (R.chance(0.1)) {
    const d = findDoc();
    if (d) got.push(`some papers (${d.title})`);
  }
  // weapon find with pity counter
  const pity = ((G.flags.weaponPity as number) ?? 0) + 1;
  if (R.chance(site.weaponChance * fullness + pity * 0.015)) {
    const w = newWeapon(R.pick(site.weapons), R.range(0.45, 1));
    got.push(`a ${WEAPONS[w.def].name.toLowerCase()}`);
    G.flags.weaponPity = 0;
    log('event', `${names} came back from ${site.name} with a ${WEAPONS[w.def].name.toLowerCase()}.`);
  } else G.flags.weaponPity = pity;
  out.push(`${names} searched ${site.name}: ${got.length ? got.join(', ') : 'nothing worth carrying'}.${stock <= 1 ? ' The place is picked clean.' : ''}`);
  // danger
  for (const s of team) {
    const danger = site.risk * (1.2 - Math.min(0.6, skillOf(s, 'scavenging') * 0.06)) * (team.length > 1 ? 0.75 : 1);
    if (R.chance(danger * 0.45)) {
      const roll = R.next();
      if (roll < 0.12 + site.risk * 0.1) {
        const w = wound(s, 'bite', R.range(0.3, 0.6), R.pick(['larm', 'rarm', 'lleg', 'rleg', 'torso']));
        if (hasTrait(s, 'secretive') && R.chance(0.6)) {
          w.hidden = true;
          out.push(`${first(s)} came back quiet, sleeves rolled down.`);
          log('event', `${displayName(s)} came back from ${site.name} and did not say much.`);
        } else {
          out.push(`${first(s)} was BITTEN on the ${PART_NAMES[w.part]} at ${site.name}.`);
          log('event', `${displayName(s)} was bitten at ${site.name}.`);
          tale(s, `Bitten at ${site.name} on day ${G.day}.`);
        }
      } else if (roll < 0.55) {
        const w = wound(s, R.pick(['laceration', 'scratch', 'bruise']), R.range(0.15, 0.45));
        out.push(`${first(s)} got hurt at ${site.name} (${w.kind}).`);
      } else {
        out.push(`${first(s)} ran into the Turned at ${site.name} and got clear, barely.`);
        addThought(s, { id: 'close_call', label: 'Close call out there', mood: -6, days: 2 }, 2);
        if (team.length > 1) {
          const o = team.find((x) => x !== s)!;
          changeOpinion(s, o, 15);
          addThought(s, { id: 'saved', label: `${first(o)} pulled me out`, mood: 5, days: 4, about: o.id }, 1);
          tale(o, `Pulled ${first(s)} out of ${site.name}.`);
        }
      }
    }
  }
  // found survivor
  if (R.chance(site.survivorChance * (living().length < 4 ? 1.6 : living().length > 8 ? 0.3 : 1))) {
    G.flags.foundSurvivorAt = site.name;
    G.flags.foundSurvivorBy = team[0].id;
  }
  if (team.length > 1) for (const a of team) for (const b of team) if (a !== b) changeOpinion(a, b, 3);
  return out;
}

export function finishRecipe(id: string, by?: Survivor): string {
  const r = RECIPES.find((x) => x.id === id)!;
  const who = by ? first(by) : 'Someone';
  if (r.gives) for (const [k, v] of Object.entries(r.gives)) add(k as Res, v ?? 0);
  if (r.weapon) {
    const w = newWeapon(r.weapon, 0.9);
    if (by && R.chance(0.25 + by.skills.crafting * 0.03)) {
      w.name = `${first(by)}'s ${R.pick(['Widowmaker', 'Bad News', 'Last Word', 'Hymnal', 'Second Shift', 'Ferryman\'s Fee'])}`;
      w.cond = 1;
      log('craft', `${who} built a masterwork: "${w.name}".`);
      tale(by, `Built "${w.name}" at the workbench.`);
      return `${who} finished a masterwork ${WEAPONS[r.weapon].name}: "${w.name}".`;
    }
  }
  switch (r.special) {
    case 'fortify': G.fort.maxHp += 60; G.fort.hp += 60; G.fort.level++; break;
    case 'spikes': G.fort.spikes++; break;
    case 'wire': G.fort.wire++; break;
    case 'light': G.fort.lights++; break;
    case 'turret': G.fort.turrets = (G.fort.turrets ?? 0) + 1; break;
    case 'trap': G.fort.traps++; break;
    case 'armor': G.flags.armorStock = ((G.flags.armorStock as number) ?? 0) + 1; break;
    case 'repair': {
      const w = [...G.weapons].sort((a, b) => a.cond - b.cond)[0];
      if (w) w.cond = Math.min(1, w.cond + 0.4);
      break;
    }
  }
  return `${who} finished: ${r.name}.`;
}

export function queueRecipe(id: string) {
  const r = RECIPES.find((x) => x.id === id)!;
  if (!has(r.cost)) return false;
  pay(r.cost);
  G.craftQueue.push({ recipe: id, progress: 0 });
  return true;
}

// ---------- the dawn tick: needs, healing, infection, social, breaks ----------
export function dawnTick(): string[] {
  const out: string[] = [];
  const people = living();
  // eating
  for (const s of people) {
    const need = (hasTrait(s, 'bigeater') ? 1.6 : hasTrait(s, 'ascetic') ? 0.7 : 1) * (G.flags.rations === 'half' ? 0.5 : 1);
    if (G.stores.food >= need) {
      add('food', -need);
      s.hunger = Math.min(1, s.hunger + 0.35 * (G.flags.rations === 'half' ? 0.6 : 1));
    } else {
      s.hunger = Math.max(0, s.hunger - 0.35);
    }
    s.hunger = Math.max(0, s.hunger - 0.25);
    s.rest = Math.max(0, Math.min(1, s.rest + 0.3));
    if (s.hunger <= 0 && R.chance(0.25)) {
      wound(s, 'bruise', 0.2, 'torso');
      out.push(`${first(s)} is starving.`);
    }
    if (G.flags.rations === 'half') addThought(s, { id: 'rations', label: 'Half rations', mood: -5, days: 1 }, 1);
    // drink
    if (hasTrait(s, 'drinker')) {
      delete G.flags[`drank_${s.id}`];
      if (G.stores.liquor > 0) {
        add('liquor', -1);
        G.flags[`drank_${s.id}`] = true;
      }
    }
    s.daysSurvived++;
    delete G.flags[`inspired_${s.id}`];
  }
  // heat
  if ((G.weather === 'cold' || G.weather === 'snow') && G.stores.fuel > 0) add('fuel', -Math.min(G.stores.fuel, 1 + Math.floor(people.length / 4)));
  if (G.fort.lights > 0 && buildingLevel('generator')) add('fuel', -Math.min(G.stores.fuel, 0.5 * G.fort.lights));
  // wounds
  const inf = buildingLevel('infirmary');
  for (const s of people) {
    for (const w of [...s.wounds]) {
      if (w.bleeding && !w.tended) {
        w.severity = Math.min(1, w.severity + 0.08);
        if (R.chance(0.3)) w.bleeding = false;
      }
      if (w.kind === 'bite' && w.infected) continue;
      const heal = (w.tended ? 0.14 : 0.05) * (1 + inf * 0.35) * (hasTrait(s, 'slowhealer') ? 0.6 : hasTrait(s, 'tough') ? 1.2 : 1);
      w.severity -= heal;
      if (!w.tended && (w.kind === 'laceration' || w.kind === 'gunshot') && R.chance(0.06)) {
        w.infected = true;
        out.push(`${first(s)}'s ${w.kind} has gone bad. Fever.`);
      }
      if (w.infected && w.kind !== 'bite') {
        w.severity += 0.06;
        if (w.tended && G.stores.meds > 0) {
          add('meds', -1);
          w.infected = false;
        }
      }
      if (w.severity <= 0) {
        s.wounds = s.wounds.filter((x) => x !== w);
        if (w.kind === 'fracture' || (w.kind === 'gunshot' && R.chance(0.4))) {
          s.scars.push({ part: w.part, label: `old ${w.kind} (${PART_NAMES[w.part]})`, work: -0.05 });
        }
      }
    }
    if (pain(s) >= 1.7) killSurvivor(s, 'of wounds that would not close');
  }
  // the turn
  for (const s of living()) {
    if (isBitten(s)) {
      s.infection += R.range(0.32, 0.55);
      if (s.infection >= 1) {
        G.flags.turningTonight = s.id;
      }
      const hidden = s.wounds.some((w) => w.kind === 'bite' && w.hidden);
      if (hidden && R.chance(0.35 + s.infection * 0.3)) {
        for (const w of s.wounds) w.hidden = false;
        out.push(`${first(s)} has been hiding a bite. The fever gave ${them(s)} away.`);
        log('event', `${displayName(s)} had hidden a bite for ${G.day - s.wounds.find((w) => w.kind === 'bite')!.dayGot} days.`);
        for (const o of living()) if (o !== s) changeOpinion(o, s, -15);
      }
    }
  }
  // social life
  out.push(...socialTick());
  // thoughts decay
  for (const s of living()) {
    for (const t of s.thoughts) t.days -= 1;
    s.thoughts = s.thoughts.filter((t) => t.days > 0);
    computeMood(s);
    if (s.breakState) {
      s.breakState.days--;
      if (s.breakState.days <= 0) {
        if (s.breakState.kind === 'wander') {
          if (R.chance(0.8)) {
            out.push(`${first(s)} came back at first light. Muddy, silent, alive.`);
            if (R.chance(0.2)) wound(s, 'bite', 0.3, R.pick(['larm', 'rarm', 'lleg']));
          } else {
            killSurvivor(s, 'walked out into the dark and did not come back');
            continue;
          }
        }
        s.breakState = null;
        addThought(s, { id: 'catharsis', label: 'Catharsis', mood: 20, days: 3 }, 1);
      }
    }
  }
  out.push(...breaksTick());
  for (const s of living()) checkTitles(s);
  // guns that have seen enough get names
  for (const w of G.weapons) {
    if (w.name || w.kills < 60) continue;
    const holder = living().find((s) => s.weapon === w.uid);
    w.name = `${holder ? first(holder) + "'s " : ''}${R.pick(['Old Reliable', 'Gravedigger', 'Night Shift', 'Ferry Fare', 'Long Quiet', 'Homecoming', 'Last Call'])}`;
    log('tale', `The ${WEAPONS[w.def].name.toLowerCase()} with ${w.kills} notches on the stock is called "${w.name}" now.`);
    out.push(`Somebody carved a name into the stock of the ${WEAPONS[w.def].name.toLowerCase()}: "${w.name}".`);
  }
  return out;
}

function socialTick(): string[] {
  const out: string[] = [];
  const ppl = living();
  for (const a of ppl) {
    for (const b of ppl) {
      if (a === b) continue;
      const r = rel(a, b);
      // chats drift opinion toward liking, insults toward the reverse
      const kind = hasTrait(a, 'kind') ? 1.6 : 1;
      const abrasive = hasTrait(a, 'abrasive') ? 2.5 : 1;
      if (R.chance(0.18 * abrasive * (a.mood < 30 ? 1.8 : 1) / kind)) {
        changeOpinion(b, a, -R.int(4, 10));
        if (R.chance(0.15) && r.opinion < -10) {
          out.push(`${first(a)} said something about ${first(b)}'s ${R.pick(['family', 'cooking', 'aim', 'nerve', 'snoring', 'God'])}.`);
          addThought(b, { id: 'insulted', label: `Insulted by ${first(a)}`, mood: -6, days: 3, about: a.id }, 1);
        }
      } else if (R.chance(0.35 * kind)) {
        changeOpinion(b, a, R.int(1, 3) + Math.floor(a.skills.social / 4));
      }
    }
  }
  // bonds
  for (const a of ppl) {
    for (const b of ppl) {
      if (a.id >= b.id) continue;
      const ab = rel(a, b), ba = rel(b, a);
      if (!ab.bond && ab.opinion > 55 && ba.opinion > 55 && a.sex !== b.sex && Math.abs(a.age - b.age) < 15 && R.chance(0.12)) {
        setBond(a, b, 'lover');
        log('social', `${displayName(a)} and ${displayName(b)} have been sharing a cot by the stove. Nobody says anything about it.`);
        out.push(`${first(a)} and ${first(b)} are together now.`);
        tale(a, `Fell for ${first(b)} in the ${G.day < 15 ? 'last warm days' : 'cold'} of the Turn.`);
        tale(b, `Fell for ${first(a)} when the world was ending.`);
      } else if (!ab.bond && ab.opinion > 45 && ba.opinion > 45 && R.chance(0.1)) {
        setBond(a, b, 'friend');
        out.push(`${first(a)} and ${first(b)} have become friends.`);
      } else if ((!ab.bond || ab.bond === 'friend') && ab.opinion < -40 && ba.opinion < -30 && R.chance(0.15)) {
        setBond(a, b, 'rival');
        log('social', `${displayName(a)} and ${displayName(b)} can no longer stand to be in the same room.`);
        out.push(`${first(a)} and ${first(b)} are at each other's throats.`);
      } else if (ab.bond === 'rival' && R.chance(0.12)) {
        const loser = R.chance(0.5) ? a : b;
        const winner = loser === a ? b : a;
        wound(loser, 'bruise', R.range(0.15, 0.4), R.pick(['head', 'torso']));
        if (R.chance(0.3)) wound(winner, 'bruise', 0.15, R.pick(['larm', 'rarm']));
        out.push(`${first(a)} and ${first(b)} came to blows by the woodstove. ${first(loser)} got the worst of it.`);
        log('social', `${displayName(winner)} beat ${displayName(loser)} bloody over ${R.pick(['a can of peaches', 'the last cigarettes', 'whose turn it was on the wall', 'something said about the dead', 'nothing anyone could name'])}.`);
        for (const o of ppl) if (o !== a && o !== b) addThought(o, { id: 'saw_fight', label: 'Saw a fistfight in the house', mood: -3, days: 2 }, 1);
      }
    }
  }
  return out;
}

function breaksTick(): string[] {
  const out: string[] = [];
  for (const s of living()) {
    if (s.breakState) continue;
    const m = s.mood;
    const th = breakThresholds(s);
    let tier = 0;
    if (m < th.extreme) tier = 3;
    else if (m < th.major) tier = 2;
    else if (m < th.minor) tier = 1;
    if (!tier) {
      if (m > 82 && R.chance(0.12)) {
        G.flags[`inspired_${s.id}`] = true;
        out.push(`${first(s)} woke up with something like a fire in ${their(s)} chest. (Inspired: deadly aim tonight.)`);
      }
      continue;
    }
    const p = [0, 0.2, 0.45, 0.8][tier];
    if (!R.chance(p)) continue;
    // resolve: Darkest-Dungeon-style turn from breaking to standing
    const partner = closeTo(s).length > 0;
    if (R.chance(0.12 + (hasTrait(s, 'ironwill') ? 0.1 : 0) + (partner ? 0.06 : 0))) {
      addThought(s, { id: 'resolve', label: 'Found something to stand on', mood: 25, days: 4 }, 1);
      out.push(`${first(s)} was coming apart, and then wasn't. Said "${R.pick(['Not today.', 'Somebody has to.', 'I promised her.', 'Shift\'s not over.', 'Not like this.'])}" and went to work.`);
      log('tale', `${displayName(s)} pulled ${them(s)}self back from the edge.`);
      tale(s, `Pulled back from the edge on day ${G.day}.`);
      continue;
    }
    const options: { k: string; w: number }[] = tier === 1
      ? [{ k: 'sulk', w: 3 }, { k: 'binge', w: 2 }, { k: 'lash', w: hasTrait(s, 'abrasive') ? 4 : 1.5 }, { k: 'drink', w: hasTrait(s, 'drinker') ? 5 : G.stores.liquor > 0 ? 1 : 0 }]
      : tier === 2
        ? [{ k: 'catatonic', w: 2 }, { k: 'wander', w: 2 }, { k: 'smash', w: 1.2 }, { k: 'hidebite', w: isBitten(s) ? 5 : 0 }]
        : [{ k: 'wander', w: 2 }, { k: 'desert', w: living().length >= 3 ? 2 : 0 }, { k: 'catatonic', w: 1.5 }, { k: 'endit', w: hasTrait(s, 'fragile') || hasTrait(s, 'grim') ? 1 : 0.3 }];
    const k = R.weighted(options, (o) => o.w)!.k;
    const name = first(s);
    switch (k) {
      case 'sulk': s.breakState = { kind: 'sulk', days: 1 }; out.push(`${name} refused to work. Sat on the porch all day staring at the river.`); break;
      case 'binge': add('food', -3); out.push(`${name} ate three days of food in one sitting and then cried.`); addThought(s, { id: 'binged', label: 'Binged', mood: 10, days: 1 }, 1); break;
      case 'drink': add('liquor', -Math.min(2, G.stores.liquor)); s.breakState = { kind: 'sulk', days: 1 }; out.push(`${name} drank until ${they(s)} could not stand.`); log('break', `${displayName(s)} went on a bender.`); break;
      case 'lash': {
        const t = R.pick(living().filter((x) => x !== s));
        if (t) {
          changeOpinion(t, s, -20);
          addThought(t, { id: 'screamed_at', label: `${first(s)} screamed at me`, mood: -8, days: 4, about: s.id }, 1);
          out.push(`${name} screamed at ${first(t)} until ${they(s)} lost ${their(s)} voice.`);
        }
        break;
      }
      case 'catatonic': s.breakState = { kind: 'catatonic', days: 2 }; out.push(`${name} has stopped speaking. Will not get up.`); log('break', `${displayName(s)} went somewhere inside and did not come out for two days.`); break;
      case 'wander': s.breakState = { kind: 'wander', days: 1 }; out.push(`${name} walked out of the gate before dawn without a word.`); log('break', `${displayName(s)} walked out past the wall, toward the river.`); break;
      case 'smash': G.craftQueue = []; out.push(`${name} smashed up the workbench. The queue is lost.`); log('break', `${displayName(s)} took a hammer to the workbench.`); break;
      case 'hidebite': for (const w of s.wounds) if (w.kind === 'bite') w.hidden = true; break;
      case 'desert': {
        const took: Partial<Record<Res, number>> = { food: Math.min(G.stores.food, 6), meds: Math.min(G.stores.meds, 2), light: Math.min(G.stores.light, 20) };
        pay(took);
        log('break', `${displayName(s)} took a pack of food and medicine and left in the night. Gone east, maybe to the ferry.`);
        out.push(`${name} deserted with supplies.`);
        s.dead = { day: G.day, cause: 'deserted', epitaph: 'Left in the night. Nobody knows.' };
        G.graves.push(s);
        G.survivors = G.survivors.filter((x) => x !== s);
        for (const o of living()) {
          addThought(o, { id: 'deserted', label: `${first(s)} abandoned us`, mood: -6, days: 4 }, 1);
          changeOpinion(o, s, -40);
        }
        break;
      }
      case 'endit': {
        killSurvivor(s, 'by their own hand, in the boiler room', 'Couldn\'t carry it anymore. We should have seen.');
        out.push(`${name} is dead. ${they(s)[0].toUpperCase() + they(s).slice(1)} did it ${them(s)}self, quietly, in the boiler room.`);
        break;
      }
    }
  }
  return out;
}

export function nextWeather() {
  const d = G.day;
  if (d >= 20) G.weather = R.chance(0.4) ? 'snow' : 'cold';
  else if (d >= 13) G.weather = R.weighted(['cold', 'clear', 'fog', 'rain', 'snow'], (w) => ({ cold: 4, clear: 2, fog: 1.5, rain: 1.5, snow: 1 } as Record<string, number>)[w])!;
  else G.weather = R.weighted(['clear', 'rain', 'fog', 'cold'], (w) => ({ clear: 4, rain: 2, fog: 1.5, cold: 0.6 } as Record<string, number>)[w])!;
}

export const WEATHER_LABEL: Record<string, string> = {
  clear: 'Clear, cold sun', rain: 'Rain off the lake', fog: 'River fog', cold: 'Hard frost', snow: 'Snow',
};

export { uid };
