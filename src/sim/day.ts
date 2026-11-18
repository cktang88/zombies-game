import type { Survivor, Res } from '../types';
import { G, R, log, add, pay, has, newWeapon, uid, findDoc, ICE_DAY } from '../state';
import { Rng } from '../rng';
import { cyclePos, persona } from './director';
import { SITES, RECIPES, RES_LABEL, FORT_CAP } from '../data/world';
import { addEmplacement, repairEmplacement } from '../data/emplacements';
import { WEAPONS, MODS, modFits, slotsFor, selectedAmmo } from '../data/weapons';
import {
  living, first, displayName, workMult, skillOf, addThought, wound, canWork, rel, changeOpinion, setBond, hasTrait,
  computeMood, breakThresholds, killSurvivor, pain, they, their, tale, isBitten, PART_NAMES, closeTo, them, checkTitles,
  dedupeSprites, perkMul, perkFx, settlePerkOffers, gainXp, attr, counsel, counselled, drainLevelUps, gainProf, heldProf, canFight,
} from './survivors';
import { bondLine, breakLine } from './chronicle';

export interface DayReport { lines: string[] }

export function buildingLevel(id: string) {
  return G.buildings.find((b) => b.id === id)?.level ?? 0;
}

// ---------- the day budget: 10 hours of daylight (07:00–17:00) ----------
// Every survivor spends some hours on their job; the rest of the day is rest.
// Work drains `rest`, free hours restore it, so a ten-hour day every day wears people down.
export const DAY_HOURS = 10;
export const DAY_START = 7; // 07:00
export const DEFAULT_HOURS = 8;
// Seconds of run daylight per hour left when the leader leaves (9h → 153 s, about the old run length).
export const RUN_SEC_PER_HOUR = 17;
// Round-trip travel hours from Ferry Road. Far sites leave less time to actually search.
export const SITE_TRAVEL: Record<string, number> = {
  route9: 1, diner: 1, rexall: 1, legion: 1, millyard: 2, boathouse: 2, school: 2, manor: 2, gunshop: 2, deercamp: 3, courthouse: 3, corliss: 6,
};
// rest drained per working hour, by job
const DRAIN: Record<string, number> = { scavenge: 0.05, repair: 0.045, craft: 0.035, farm: 0.035, doctor: 0.03, radio: 0.02, guard: 0.04, cook: 0.03, drill: 0.035, counsel: 0.025 };
const XP_PER_HOUR = 6; // skill XP per working hour (passions x1.5, see gainXp)
export const DRILL_ROUNDS = 10; // live rounds a full 8h drill burns; without them it is dry-fire at half XP

/** Crew-served emplacements built by the combat pass (G.flags.emplacements, a JSON array). */
export function emplacements(): unknown[] {
  try {
    const v = JSON.parse((G.flags.emplacements as string) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/** What a drill would burn and teach today. */
export function drillPlan(s: Survivor) {
  const it = G.weapons.find((w) => w.uid === s.weapon);
  const ammo = it ? selectedAmmo(it) : null;
  const rounds = Math.ceil(DRILL_ROUNDS * jobHours(s) / DEFAULT_HOURS);
  const live = !!ammo && ammo !== 'scrap' && (G.stores[ammo] ?? 0) >= rounds && rounds > 0;
  return { ammo, rounds, live, heavy: emplacements().length > 0 };
}
const FREE_HOUR_REST = 0.04; // rest regained per unworked daylight hour
const NIGHT_SLEEP = 0.22; // rest regained overnight (dawnTick)
const SEARCH_NORM = 6; // search hours that give the site table ×1 (8h at a 2h site)
// Scarcity tuning for the scavenge JOB (runs are tuned in expedition.ts): food and fuel come home thinner.
const SCAV_TUNE: Partial<Record<string, number>> = { food: 0.7, fuel: 0.8 };

export function travelHours(siteId: string) {
  return SITE_TRAVEL[siteId] ?? 2;
}
export function clockLabel(h: number) {
  const t = DAY_START + h;
  return `${String(Math.floor(t)).padStart(2, '0')}:${t % 1 ? '30' : '00'}`;
}
export function ranToday() {
  return G.flags.ranToday === G.day;
}
/** True for the leader and the companion (G.flags.ranMate) once today's run is booked. */
export function onRunToday(s: Survivor) {
  return ranToday() && (s.isLeader || G.flags.ranMate === s.id);
}
/** Daylight hours this survivor has for house work today (the run party loses the hours after leaving). */
export function hoursAvailable(s: Survivor) {
  if (onRunToday(s)) return Math.max(0, Math.min(DAY_HOURS, ((G.flags.runLeave as number) ?? 0) - choreHours(s)));
  return Math.max(0, DAY_HOURS - choreHours(s));
}
/** Hours of today already spent on one-click chores (oiling the guns, clearing the pile). */
export function choreHours(s: Survivor) {
  const v = G.flags[`chore_${s.id}`];
  return typeof v === 'number' && Math.floor(v / 100) === G.day ? v % 100 : 0;
}
/** Who does a chore of `h` hours: the leader if they have the time, else whoever has the most to spare. */
export function choreHand(h: number): Survivor | undefined {
  const free = (s: Survivor) => hoursAvailable(s);
  const able = living().filter((s) => canWork(s) && free(s) >= h);
  return able.find((s) => s.isLeader) ?? able.sort((a, b) => free(b) - free(a))[0];
}
function spendChore(s: Survivor, h: number) {
  G.flags[`chore_${s.id}`] = G.day * 100 + choreHours(s) + h;
}
/** Oil the guns: one hour, a rag (cloth) or a splash of fuel. The cold won't seize them tonight. */
export function oilGuns(): string | null {
  if (G.flags.oiledDay === G.day) return null;
  const s = choreHand(1);
  if (!s) return 'Nobody has an hour free to oil the guns.';
  const res = (G.stores.cloth ?? 0) >= 1 ? 'cloth' : (G.stores.fuel ?? 0) >= 1 ? 'fuel' : null;
  if (!res) return 'No rag and no fuel to oil them with.';
  add(res, -1);
  spendChore(s, 1);
  G.flags.oiledDay = G.day;
  for (const w of G.weapons) w.cond = Math.min(1, w.cond + 0.01);
  return `${first(s)} stripped and oiled the guns at the kitchen table (${res === 'cloth' ? 'a rag' : 'a splash of fuel'}, an hour).`;
}
/** The bodies against the wall (G.flags.pileCarry): haul them off (3 h, a grim job) or burn them (2 fuel, 1 h). */
export function clearPile(how: 'haul' | 'burn'): string | null {
  if (!G.flags.pileCarry) return null;
  const h = how === 'haul' ? 3 : 1;
  if (how === 'burn' && (G.stores.fuel ?? 0) < 2) return 'Not enough fuel to burn them (2).';
  const s = choreHand(h);
  if (!s) return `Nobody has ${h} hour${h > 1 ? 's' : ''} free for the bodies.`;
  if (how === 'burn') add('fuel', -2);
  spendChore(s, h);
  delete G.flags.pileCarry;
  if (how === 'haul') {
    addThought(s, { id: 'hauled_dead', label: 'Hauled the dead off the wall by their ankles', mood: hasTrait(s, 'bloodlust') ? 0 : -4, days: 2 }, 1);
    return `${first(s)} dragged the bodies off the wall and down to the ditch. ${first(s)} has not said a word since.`;
  }
  G.flags.pileBurnt = G.day;
  return `${first(s)} burned the pile against the wall. The smoke hung over Ferry Road all morning.`;
}
/** Hours booked on the survivor's job (Rest books none: the whole day is rest). */
export function jobHours(s: Survivor) {
  if (s.job === 'rest') return 0;
  const h = (G.flags[`hours_${s.id}`] as number) ?? DEFAULT_HOURS;
  return Math.max(0, Math.min(hoursAvailable(s), h));
}
export function setJobHours(s: Survivor, h: number) {
  G.flags[`hours_${s.id}`] = Math.max(1, Math.min(DAY_HOURS, Math.round(h)));
}
export function survivorSite(s: Survivor) {
  return (G.flags[`site_${s.id}`] as string) ?? 'route9';
}
/** Hours spent searching at a site after the walk there and back. */
export function searchHours(s: Survivor) {
  return Math.max(0, jobHours(s) - travelHours(survivorSite(s)));
}
export function searchFactor(h: number) {
  return h <= 0 ? 0 : Math.pow(h / SEARCH_NORM, 0.85);
}
/** Plans carry over from yesterday, but the day screen flags them until the player touches them. */
export function planConfirmed(s: Survivor) {
  return G.flags[`plan_${s.id}`] === G.day;
}
export function confirmPlan(s: Survivor) {
  G.flags[`plan_${s.id}`] = G.day;
}
/** Daylight (seconds) the leader would have on a run leaving after `leave` hours of house work. */
export function runDaylightFor(siteId: string, leave: number) {
  return Math.max(0, Math.round((DAY_HOURS - leave - travelHours(siteId)) * RUN_SEC_PER_HOUR));
}
/**
 * Book the leader's run. Sets G.flags.runDaylight (seconds of street daylight; the run code reads it),
 * G.flags.runLeave (house hours worked before leaving) and G.flags.ranToday. The leader's job keeps
 * running for the `leave` hours before departure; with leave 0 the job becomes Rest.
 */
export function prepareRun(siteId: string, leave: number) {
  G.flags.ranToday = G.day;
  G.flags.runLeave = leave;
  G.flags.runSite = siteId;
  G.flags.runDaylight = runDaylightFor(siteId, leave);
  const l = living().find((s) => s.isLeader);
  if (l) {
    if (leave <= 0) l.job = 'rest';
    l.rest = Math.max(0, l.rest - 0.2); // a run is a hard day's walking
  }
  // the companion (G.flags.runMate, read and cleared by the run code) keeps the same hours as the leader;
  // the run code sets their job to Rest, so remember the morning job to restore at dusk
  delete G.flags.ranMate;
  delete G.flags.ranMateJob;
  const mate = living().find((s) => s.id === G.flags.runMate && !s.isLeader && canWork(s));
  if (mate) {
    G.flags.ranMate = mate.id;
    if (leave > 0 && mate.job !== 'rest') G.flags.ranMateJob = mate.job;
    else mate.job = 'rest';
    mate.rest = Math.max(0, mate.rest - 0.2);
  }
  return G.flags.runDaylight as number;
}

/** Give the run companion back the job they worked before leaving (the run code set it to Rest). Idempotent. */
export function restoreRunMate() {
  const job = G.flags.ranMateJob;
  const mate = ranToday() && typeof job === 'string' ? living().find((s) => s.id === G.flags.ranMate) : undefined;
  if (mate) mate.job = job as Survivor['job'];
  delete G.flags.ranMateJob;
}

/** Fuel the stove burns tonight: frost and snow cost 1 per 3 people; late in the year every night costs a little. */
export function heatNeed(weather = G.weather, day = G.day, people = living().length) {
  if (!people) return 0;
  if (weather === 'cold' || weather === 'snow') return Math.ceil(people / 3);
  if (day >= 10) return Math.ceil(people / 5);
  return 0;
}

// ---------- day work: runs when the player calls dusk ----------
export function resolveDayWork(): string[] {
  const out: string[] = [];
  const workers = living();
  const siteRuns: Record<string, Survivor[]> = {};
  restoreRunMate(); // the run companion worked the morning before leaving
  for (const s of workers) {
    const away = onRunToday(s);
    const hours = jobHours(s);
    const free = Math.max(0, hoursAvailable(s) - hours);
    if (!canWork(s)) {
      if (s.job !== 'rest' && !away) out.push(`${first(s)} could not work today.`);
      s.rest = Math.min(1, s.rest + 0.3);
      continue;
    }
    const m = workMult(s);
    const f = hours / DEFAULT_HOURS; // yields are tuned for an 8-hour day
    const gritF = 1.16 - attr(s, 'grit') * 0.04; // grit 4 = x1, grit 10 = x0.76
    if (s.job !== 'rest') s.rest = Math.max(0, Math.min(1, s.rest - (DRAIN[s.job] ?? 0.03) * gritF * perkMul(s, 'drain') * hours + FREE_HOUR_REST * free));
    if (hours > 8) gainXp(s, 'grit', (hours - 8) * 8);
    if (hours > 0 && s.rest < 0.3) gainXp(s, 'grit', 10);
    if (s.job !== 'rest' && hours <= 0) continue;
    switch (s.job) {
      case 'repair': {
        const p = repairPlan(s, m * f);
        G.fort.hp = Math.min(G.fort.maxHp, G.fort.hp + p.gain);
        add('wood', -p.wood);
        out.push(p.gain > 0
          ? `${first(s)} patched the wall for ${hours}h (+${p.gain}${p.short ? ', out of timber: pulled boards off the shed' : ''}).`
          : `${first(s)} walked the wall for ${hours}h and found nothing to patch.`);
        break;
      }
      case 'craft': {
        if (!G.craftQueue.length) {
          out.push(`${first(s)} sat at an idle bench. Nothing was queued.`);
          break;
        }
        let pts = craftPoints(s, m * f);
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
        break;
      }
      case 'farm': {
        const g = buildingLevel('garden');
        const amt = farmAmount(s, m * f, g);
        add('food', amt);
        out.push(`${first(s)} brought in ${amt} food${g ? ' from the cold frames' : ' snaring rabbits and picking frost-bit kale'}.`);
        break;
      }
      case 'doctor': {
        const patients = living().filter((p) => p.wounds.length);
        let care = careCount(s, m * f);
        for (const p of patients) {
          for (const w of p.wounds) {
            if (care <= 0) break;
            if (!w.tended) {
              w.tended = true;
              w.bleeding = false;
              care--;
              gainXp(s, 'medicine', 10);
              w.severity *= 1 - Math.min(0.5, perkFx(s, 'tendHeal'));
              if (G.stores.meds > 0 && w.severity > 0.3) {
                add('meds', -1);
                w.severity *= 0.8;
              }
            }
          }
        }
        out.push(patients.length ? `${first(s)} tended the wounded.` : `${first(s)} sorted the medicine shelf. Nobody needed stitching. A good day.`);
        break;
      }
      case 'scavenge': {
        const site = survivorSite(s);
        if (searchHours(s) <= 0) {
          out.push(`${first(s)} set out for ${SITES.find((x) => x.id === site)?.name ?? 'town'} and had to turn back to beat the dark.`);
          break;
        }
        (siteRuns[site] ??= []).push(s);
        break;
      }
      case 'radio': {
        if (buildingLevel('radio') === 0) {
          out.push(`${first(s)} turned the dial of a dead transistor radio.`);
          break;
        }
        G.flags.radioWork = ((G.flags.radioWork as number) ?? 0) + (1 + skillOf(s, 'social') * 0.2) * m * f * perkMul(s, 'radio');
        out.push(`${first(s)} worked the CB for ${hours}h.`);
        break;
      }
      case 'drill': {
        const d = drillPlan(s);
        if (d.live && d.ammo) add(d.ammo, -d.rounds);
        gainXp(s, 'shooting', (d.live ? 2 : 1) * XP_PER_HOUR * hours);
        if (d.heavy) gainXp(s, 'heavy', (d.live ? 2 : 1) * 5 * hours);
        const held = heldProf(s);
        if (held) gainProf(s, held.cls, (d.live ? 2 : 1) * 5 * hours);
        out.push(d.live
          ? `${first(s)} drilled ${hours}h${d.heavy ? ' on the gun nest' : ''} and burned ${d.rounds} ${(RES_LABEL[d.ammo!] ?? 'rounds').toLowerCase()}.`
          : `${first(s)} dry-fired for ${hours}h${d.heavy ? ' behind the gun nest' : ''}. Without live rounds it only half takes.`);
        break;
      }
      case 'counsel': {
        const targets = counselTargets(s, hours);
        if (!targets.length) out.push(`${first(s)} made coffee and listened. Nobody needed talking down today.`);
        for (const t of targets) out.push(counsel(s, t, Math.min(1.2, f)));
        gainXp(s, 'psych', XP_PER_HOUR * hours * 0.5);
        break;
      }
      case 'rest':
      default:
        if (away) break;
        s.rest = Math.min(1, s.rest + 0.4);
        addThought(s, { id: 'rested', label: 'Got a day off', mood: 3, days: 1 }, 1);
        break;
    }
    if (s.rest < 0.2 && s.job !== 'rest') addThought(s, { id: 'worked_ragged', label: 'Worked to the bone', mood: -4, days: 1 }, 1);
    // passions
    if (s.job !== 'rest') {
      const skill = jobSkill(s.job);
      if (skill && s.passions.includes(skill)) addThought(s, { id: 'passion', label: 'Did work I care about', mood: 4, days: 1 }, 1);
      if (skill && s.job !== 'drill' && s.job !== 'counsel') gainXp(s, skill, XP_PER_HOUR * hours);
    }
  }
  for (const [siteId, team] of Object.entries(siteRuns)) out.push(...scavenge(siteId, team));
  out.push(...drainLevelUps());
  // the stove
  const heat = heatNeed();
  if (heat > 0) {
    if (G.stores.fuel >= heat) {
      add('fuel', -heat);
      out.push(`The stove will burn ${heat} fuel tonight.`);
    } else {
      add('fuel', -G.stores.fuel);
      out.push('Not enough fuel for the stove. Everyone sleeps in their coats.');
      for (const s of living()) {
        addThought(s, { id: 'freezing', label: 'Freezing in the house', mood: -8, days: 1 }, 1);
        s.rest = Math.max(0, s.rest - 0.1);
      }
    }
  }
  return out;
}

// Day yields per worker (m = workMult x hours/8). Perks scale them (src/data/perks.ts).
export function repairAmount(s: Survivor, m: number) {
  return Math.round((40 + skillOf(s, 'building') * 9) * m * perkMul(s, 'repair'));
}
/** Wall per timber: 1 timber patches this much (a Thrifty builder uses less). */
export const REPAIR_WOOD_PER = 25;
/** Without timber a repairer only manages this fraction: boards pulled off the shed, the car door re-hung. */
export const REPAIR_NO_WOOD = 0.25;
/** What a repairer will do today: wall gained and timber used, from the timber in the stores. */
export function repairPlan(s: Survivor, m: number, wood = G.stores.wood ?? 0, room = G.fort.maxHp - G.fort.hp) {
  const full = Math.max(0, Math.min(room, repairAmount(s, m)));
  const per = REPAIR_WOOD_PER / perkMul(s, 'repairWood'); // wall per timber for this builder
  const need = Math.ceil(full / per);
  if (wood >= need) return { gain: full, wood: need, short: false };
  const timbered = Math.floor(wood) * per;
  return { gain: Math.min(full, Math.round(timbered + (full - timbered) * REPAIR_NO_WOOD)), wood: Math.floor(wood), short: true };
}
export function craftPoints(s: Survivor, m: number) {
  return (3 + skillOf(s, 'crafting') * 0.9) * m * perkMul(s, 'craft');
}
export function farmAmount(s: Survivor, m: number, garden = buildingLevel('garden'), weather = G.weather) {
  const cold = weather === 'cold' || weather === 'snow' ? Math.min(1, 0.6 + perkFx(s, 'farmCold')) : 1;
  return Math.round((1.5 + skillOf(s, 'farming') * 0.45 + garden * 2.2) * m * cold * perkMul(s, 'farm'));
}
export function careCount(s: Survivor, m: number) {
  return Math.max(1, Math.round((2 + skillOf(s, 'medicine')) * m * perkMul(s, 'care')));
}
function jobSkill(j: string) {
  return ({ repair: 'building', craft: 'crafting', farm: 'farming', doctor: 'medicine', scavenge: 'scavenging', radio: 'social', guard: 'shooting', drill: 'shooting', counsel: 'psych' } as const)[j as 'repair'];
}

function scavenge(siteId: string, team: Survivor[]): string[] {
  const site = SITES.find((x) => x.id === siteId)!;
  const out: string[] = [];
  const stockKey = `stock_${site.id}`;
  const stock = (G.flags[stockKey] as number) ?? site.stock;
  const fullness = Math.max(0.15, stock / site.stock);
  const skill = team.reduce((a, s) => a + skillOf(s, 'scavenging') * workMult(s) * perkMul(s, 'scav'), 0);
  const search = team.reduce((a, s) => a + searchFactor(searchHours(s)), 0) / team.length;
  const mult = (0.55 + skill * 0.12) * fullness * search * (team.length > 1 ? 1 + (team.length - 1) * 0.5 : 1);
  const names = team.map(first).join(' and ');
  const got: string[] = [];
  for (const [k, v] of Object.entries(site.loot)) {
    const n = Math.round((v ?? 0) * mult * (SCAV_TUNE[k] ?? 1) * R.range(0.5, 1.4));
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
  // attachments turn up now and then (daylight runs find them more often)
  if (site.mods?.length && R.chance(0.07 * fullness * Math.min(1.3, search))) {
    const md = R.pick(site.mods);
    (G.modStock ??= []).push({ uid: uid('m'), def: md, cond: R.range(0.55, 1) });
    got.push(`a ${MODS[md].name.toLowerCase()}`);
  }
  out.push(`${names} searched ${site.name}: ${got.length ? got.join(', ') : 'nothing worth carrying'}.${stock <= 1 ? ' The place is picked clean.' : ''}`);
  // danger
  for (const s of team) {
    const danger = site.risk * perkMul(s, 'scavDanger') * (1.2 - Math.min(0.6, skillOf(s, 'scavenging') * 0.06)) * (team.length > 1 ? 0.75 : 1) * Math.min(1.3, searchFactor(searchHours(s)));
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
  if (r.trap) { const st = (G.trapStock ??= {}); st[r.trap] = (st[r.trap] ?? 0) + (r.trapCount ?? 1); }
  if (r.mod) (G.modStock ??= []).push({ uid: uid('m'), def: r.mod, cond: 1 });
  if (r.melee) (G.melee ??= []).push({ uid: uid('k'), def: r.melee, cond: 1, kills: 0 });
  if (r.emplacement) G.flags.emplacements = addEmplacement(G.flags.emplacements, r.emplacement);
  if (r.empRepair) G.flags.emplacements = repairEmplacement(G.flags.emplacements);
  if (r.weapon) {
    const w = newWeapon(r.weapon, 0.9);
    if (by && R.chance(0.25 + by.skills.crafting * 0.03)) {
      w.name = `${first(by)}'s ${R.pick(['Widowmaker', 'Bad News', 'Last Word', 'Hymnal', 'Second Shift', 'Ferryman\'s Fee'])}`;
      w.cond = 1;
      // a masterwork comes with something extra built in
      const fit = Object.keys(MODS).filter((m) => modFits(m, w.def) && slotsFor(w.def).includes(MODS[m].slot));
      if (fit.length) { const m = R.pick(fit); w.mods = { [MODS[m].slot]: { uid: uid('m'), def: m, cond: 1 } }; }
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
    case 'duffel': G.flags.duffel = true; break;
    case 'roofnest': G.flags.roofNest = 1; break;
    case 'repairMelee': {
      const k = [...(G.melee ?? [])].sort((a, b) => a.cond - b.cond)[0];
      if (k) k.cond = Math.min(1, k.cond + 0.5);
      break;
    }
    case 'armor': G.flags.armorStock = ((G.flags.armorStock as number) ?? 0) + 1; break;
    case 'repair': {
      const w = [...G.weapons].sort((a, b) => a.cond - b.cond)[0];
      if (w) w.cond = Math.min(1, w.cond + 0.4);
      break;
    }
  }
  return `${who} finished: ${r.name}.`;
}

/** How many of a wall build stand or are queued (spikes, wire, light, turret, fortify). */
export function fortCount(special: string | undefined): number {
  const built = special === 'light' ? G.fort.lights : special === 'wire' ? G.fort.wire : special === 'turret' ? G.fort.turrets ?? 0 : special === 'spikes' ? G.fort.spikes : special === 'fortify' ? G.fort.level : 0;
  return built + G.craftQueue.filter((q) => RECIPES.find((x) => x.id === q.recipe)?.special === special).length;
}
/** How many more of this build still do something (Infinity when it has no cap). */
export function fortRoom(special: string | undefined): number {
  const cap = special ? FORT_CAP[special] : undefined;
  return cap === undefined ? Infinity : cap - fortCount(special);
}
export function queueRecipe(id: string) {
  const r = RECIPES.find((x) => x.id === id)!;
  if (!has(r.cost) || fortRoom(r.special) <= 0) return false;
  pay(r.cost);
  G.craftQueue.push({ recipe: id, progress: 0 });
  return true;
}

// ---------- the dawn tick: needs, healing, infection, social, breaks ----------
export function dawnTick(): string[] {
  const out: string[] = [];
  dedupeSprites();
  out.push(...settlePerkOffers());
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
    s.rest = Math.max(0, Math.min(1, s.rest + NIGHT_SLEEP));
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
  // heat: the stove is paid at dusk (resolveDayWork → heatNeed)
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
        log('social', bondLine(a, b, 'lover'));
        out.push(`${first(a)} and ${first(b)} are together now.`);
        tale(a, `Fell for ${first(b)} in the ${G.day < 15 ? 'last warm days' : 'cold'} of the Turn.`);
        tale(b, `Fell for ${first(a)} when the world was ending.`);
      } else if (!ab.bond && ab.opinion > 45 && ba.opinion > 45 && R.chance(0.1)) {
        setBond(a, b, 'friend');
        log('social', bondLine(a, b, 'friend'));
        out.push(`${first(a)} and ${first(b)} have become friends.`);
      } else if ((!ab.bond || ab.bond === 'friend') && ab.opinion < -40 && ba.opinion < -30 && R.chance(0.15)) {
        setBond(a, b, 'rival');
        log('social', bondLine(a, b, 'rival'));
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

/** Who a counsellor talks down today: the ones nearest their break line, one per 4 hours. */
function counselTargets(s: Survivor, hours: number, done: (o: Survivor) => boolean = counselled) {
  return living()
    .filter((o) => o !== s && !done(o) && (o.mood < 60 || o.breakState || o.thoughts.some((t) => t.mood <= -6)))
    .sort((a, b) => (a.mood - breakThresholds(a).minor) - (b.mood - breakThresholds(b).minor))
    .slice(0, Math.max(1, Math.floor(hours / 4)));
}
/** Who today's counsellors will reach at dusk (target → counsellor), as resolveDayWork will do it. */
export function counselPlan(): Map<Survivor, Survivor> {
  const out = new Map<Survivor, Survivor>();
  for (const s of living()) {
    if (s.job !== 'counsel' || !canWork(s) || onRunToday(s) || jobHours(s) <= 0) continue;
    for (const t of counselTargets(s, jobHours(s), (o) => counselled(o) || out.has(o))) out.set(t, s);
  }
  return out;
}

/** Dawn break chance per tier (minor / major / extreme line), and the cut counsel makes. */
export const BREAK_P = [0, 0.2, 0.45, 0.8];
export const COUNSEL_BREAK = 0.35;
/** How far below their break lines a survivor's mood is: 0 none, 1 minor, 2 major, 3 extreme. */
export function breakTier(s: Survivor, mood = s.mood): number {
  const th = breakThresholds(s);
  return mood < th.extreme ? 3 : mood < th.major ? 2 : mood < th.minor ? 1 : 0;
}
/** The chance they break at dawn at this mood (breaksTick rolls exactly this). */
export function breakChance(s: Survivor, counsel = counselled(s)): number {
  if (s.breakState || s.dead) return 0;
  return BREAK_P[breakTier(s)] * (counsel ? COUNSEL_BREAK : 1);
}

function breaksTick(): string[] {
  const out: string[] = [];
  for (const s of living()) {
    if (s.breakState) continue;
    const m = s.mood;
    const tier = breakTier(s);
    if (!tier) {
      if (m > 82 && R.chance(0.12)) {
        G.flags[`inspired_${s.id}`] = true;
        out.push(`${first(s)} woke up with something like a fire in ${their(s)} chest. (Inspired: deadly aim tonight.)`);
      }
      continue;
    }
    if (!R.chance(breakChance(s))) continue;
    // resolve: Darkest-Dungeon-style turn from breaking to standing
    const partner = closeTo(s).length > 0;
    if (R.chance(0.12 + (hasTrait(s, 'ironwill') ? 0.1 : 0) + (partner ? 0.06 : 0))) {
      addThought(s, { id: 'resolve', label: 'Found something to stand on', mood: 25, days: 4 }, 1);
      out.push(`${first(s)} was coming apart, and then wasn't. Said "${R.pick(['Not today.', 'Somebody has to.', 'I promised her.', 'Shift\'s not over.', 'Not like this.'])}" and went to work.`);
      log('tale', breakLine(s, 'resolve'));
      tale(s, `Pulled back from the edge on day ${G.day}.`);
      continue;
    }
    const options: { k: string; w: number }[] = tier === 1
      ? [{ k: 'sulk', w: 3 }, { k: 'binge', w: 2 }, { k: 'lash', w: hasTrait(s, 'abrasive') ? 4 : 1.5 }, { k: 'drink', w: hasTrait(s, 'drinker') ? 5 : G.stores.liquor > 0 ? 1 : 0 }]
      : tier === 2
        ? [{ k: 'catatonic', w: 2 }, { k: 'wander', w: 2 }, { k: 'smash', w: 1.2 }, { k: 'hidebite', w: isBitten(s) ? 5 : 0 }]
        : [{ k: 'wander', w: 2 }, { k: 'desert', w: living().length >= 3 ? 2 : 0 }, { k: 'catatonic', w: 1.5 }, { k: 'endit', w: hasTrait(s, 'fragile') || hasTrait(s, 'grim') ? 1 : 0.3 }];
    if (s.child) { if (tier >= 2) { s.breakState = { kind: 'sulk', days: 1 }; out.push(`${first(s)} cried all day and would not come out from under the table.`); } continue; }
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
      case 'catatonic': s.breakState = { kind: 'catatonic', days: 2 }; out.push(`${name} has stopped speaking. Will not get up.`); log('break', breakLine(s, 'catatonic')); break;
      case 'wander': s.breakState = { kind: 'wander', days: 1 }; out.push(`${name} walked out of the gate before dawn without a word.`); log('break', breakLine(s, 'wander')); break;
      case 'smash': G.craftQueue = []; out.push(`${name} smashed up the workbench. The queue is lost.`); log('break', `${displayName(s)} took a hammer to the workbench.`); break;
      case 'hidebite': for (const w of s.wounds) if (w.kind === 'bite') w.hidden = true; break;
      case 'desert': {
        const took: Partial<Record<Res, number>> = { food: Math.min(G.stores.food, 6), meds: Math.min(G.stores.meds, 2), light: Math.min(G.stores.light, 20) };
        pay(took);
        log('break', breakLine(s, 'desert'));
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

// ---------- "one more day": a title-only teaser of tomorrow ----------
// G.flags.teaser (string), if set by an incident or radio thread, wins; otherwise an omen is drawn from the
// house's state. The pick is stored per day (G.flags.teaserDay/teaserText) so it stays put across re-renders.
const OMENS = [
  'A light blinking on the Legion hall roof. Three short, three long.',
  'Smoke over the east bank where nobody should be cooking.',
  'An outboard motor on the river after dark, then nothing.',
  'Somebody has been at the woodpile. The tracks are boots, not bare feet.',
  'A new voice on the radio, reading names.',
  'Crows over Route 9, hundreds of them, circling one house.',
  'Hoofprints in the frost by the gate. Too many for deer.',
  'The church bell at All Saints rang once at noon. Nobody rings it anymore.',
  'A car horn from the direction of the mill, long and steady, until it stopped.',
];
export function tomorrowTeaser(): string {
  if (typeof G.flags.teaser === 'string' && G.flags.teaser) return G.flags.teaser;
  if (G.flags.teaserDay === G.day && typeof G.flags.teaserText === 'string') return G.flags.teaserText;
  const rng = new Rng(G.seed * 31 + G.day * 977);
  const next = G.day + 1;
  const c: { t: string; w: number }[] = OMENS.map((t) => ({ t, w: 1 }));
  if (next === ICE_DAY) c.push({ t: 'The river is white almost bank to bank. Tomorrow it holds a man\'s weight.', w: 50 });
  if (cyclePos(next).peak && next >= 5 && persona().id !== 'coin') c.push({ t: 'The dogs out on Route 9 have not stopped barking since noon.', w: 12 });
  const bitten = living().find((s) => isBitten(s) && !s.wounds.some((w) => w.hidden));
  if (bitten) c.push({ t: `${first(bitten)} will not stop scratching at the bandage.`, w: 6 });
  if (living().length && G.stores.food < living().length * 2) c.push({ t: 'The pantry shelf, nearly bare. Somebody has been counting the cans.', w: 6 });
  if (G.stores.fuel < heatNeed('cold', next)) c.push({ t: 'Frost on the inside of the windows tomorrow, and not enough fuel for the stove.', w: 5 });
  if (G.flags.foundSurvivorAt) c.push({ t: `Somebody followed the scavengers home from ${G.flags.foundSurvivorAt}.`, w: 10 });
  const pick = rng.weighted(c, (x) => x.w)!.t;
  G.flags.teaserDay = G.day;
  G.flags.teaserText = pick;
  return pick;
}
