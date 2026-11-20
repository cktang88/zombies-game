// What to do today, a few things at a time (the player: "too much on the screen, I don't know what
// to do"). Three pieces, all computed from the game state on every render of the day screen:
//   REVEAL     — the unlock schedule: which tabs and systems show on which day (one table, tune here)
//   todos()    — the short "Today" checklist, most urgent first; each item jumps to where to act
//   dots       — a yellow dot on the corner of a tab / card / panel with an open item or something new
// Seen-state lives in G.flags (seen_<id>), so it travels with the save. A save already past a day
// in the table shows that system without a "new" dot.
import type { Survivor, Res, SkillId, WeaponItem } from '../types';
import { G } from '../state';
import { living, first, canWork, isBitten, computeMood } from '../sim/survivors';
import { RECIPES, RES_LABEL, SITES } from '../data/world';
import { buildingLevel, survivorSite, onRunToday, scavengersReady, sentToday, ranToday, heatNeed, planConfirmed, dailyFood, halfRations, breakChance, counselPlan, COUNSEL_BREAK } from '../sim/day';
import { calendar } from '../sim/calendar';
import { fireProfile, ammoLabel, AMMO_TYPES, gunModel } from '../data/weapons';
import { canFight } from '../sim/survivors';
import { wallLine, rackGuns, newOnRack, canArmAnyone, armPreview, SHOTS_PER_GUN_NIGHT } from '../sim/readiness';
import { WEAPONS } from '../data/weapons';
import { tip, ico } from './kit';
import './today.css';
import { nextUnlock } from '../sim/catalogue';
import { merchantOn, landingStock, MERCHANT_NAME, MERCHANT_EVERY } from '../sim/landing';

export type RevealId = 'workshop' | 'chronicle' | 'calendar' | 'chores' | 'armory' | 'stores' | 'jobs' | 'run' | 'town' | 'graves';

/** The unlock schedule. day: the first day it shows. what: the one line shown when it appears. */
export const REVEAL: { id: RevealId; day: number; label: string; icon: string; what: string; tab?: string; sel?: string }[] = [
  { id: 'workshop', day: 2, label: 'Workshop', icon: 'job_craft', tab: 'workshop', what: 'Queue ammo, traps and machinery. Someone must be on the Workshop job.' },
  { id: 'calendar', day: 2, label: 'Calendar', icon: 'st_danger', sel: '.calendar', what: 'The week ahead. A red dot is a bad night: get ready for it.' },
  { id: 'chores', day: 2, label: 'Chores', icon: 'st_time', tab: 'wall', sel: '.chores', what: 'Oil the guns, clear the bodies: an hour of someone\'s day.' },
  { id: 'chronicle', day: 2, label: 'Chronicle', icon: 'st_xp', tab: 'chronicle', what: 'What happened, day by day.' },
  { id: 'armory', day: 3, label: 'Armory', icon: 'pistol', tab: 'armory', what: 'Every gun there is, by kind: yours in colour, the rest greyed with how to get one (make, buy at the landing, find). Hover a gun for its numbers.' },
  { id: 'stores', day: 3, label: 'All the stores', icon: 'meds', what: 'Medicine joins the stores along the top.' },
  { id: 'jobs', day: 3, label: 'More jobs', icon: 'job_drill', what: 'Drill, Counsel and the Radio join the job list.' },
  { id: 'run', day: 4, label: 'Lead a run', icon: 'job_scavenge', sel: '.run', what: 'Your leader walks one street in daylight for loot. Back before dark.' },
  { id: 'town', day: 4, label: 'Town', icon: 'st_faction', tab: 'town', what: 'Vessey: the factions, and the papers you find on runs.' },
  { id: 'graves', day: 1, label: 'Graves', icon: 'st_dead', tab: 'graves', what: 'The ones behind the house.' },
];
/** Jobs that wait for a reveal (the rest are there from day 1). */
export const JOB_REVEAL: Partial<Record<string, RevealId>> = { craft: 'workshop', drill: 'jobs', counsel: 'jobs', radio: 'jobs' };

const RA_KEY = 'vessey-reveal-all';
let revealAllMem: boolean | null = null;
/** The player chose to see everything at once (or a test did). */
export function revealAll(): boolean {
  if (revealAllMem === null) { try { revealAllMem = localStorage.getItem(RA_KEY) === '1'; } catch { revealAllMem = false; } }
  return revealAllMem;
}
export function setRevealAll(on: boolean) {
  revealAllMem = on;
  try { localStorage.setItem(RA_KEY, on ? '1' : '0'); } catch { /* private window */ }
}

const rev = (id: RevealId) => REVEAL.find((r) => r.id === id)!;
export function isOpen(id: RevealId): boolean {
  if (id === 'graves') return G.graves.length > 0;
  return revealAll() || G.day >= rev(id).day;
}
/** Open, not yet looked at, and it opened today or yesterday (an old save does not light up). */
export function isNew(id: RevealId): boolean {
  if (!isOpen(id) || G.flags[`seen_${id}`] || revealAll()) return false;
  if (id === 'graves') return G.graves.some((g) => (g.dead?.day ?? 0) >= G.day - 1);
  return G.day - rev(id).day <= 1;
}
export function markSeen(id: string) {
  // the day it was first looked at: its one-line note stays up for the rest of that day (only while it
  // was new: a save already past its day records -1, so the "New." note does not appear on first look)
  if (REVEAL.some((r) => r.id === id) && !G.flags[`seen_${id}`]) G.flags[`seen_${id}`] = isNew(id as RevealId) ? G.day : -1;
}

// ---------------------------------------------------------------- the list
export interface Todo {
  id: string;
  icon: string;
  text: string;
  tip?: string;
  /** where to act: a tab to open, then an element to scroll to and flash */
  tab?: string;
  sel?: string;
  /** a one-click fix instead of a jump: the day screen runs it (data-act value, e.g. 'armall') */
  act?: string;
  /** what gets the yellow dot while this is open: 'tab:wall', 'surv:<id>', 'run', 'calendar' */
  dot?: string;
  prio: number;
  isNew?: boolean;
  done?: boolean;
}

const BEST: Record<string, SkillId> = { repair: 'building', craft: 'building', doctor: 'medicine', scavenge: 'scavenging' };
/** Who to suggest for a job: free hands first (resting or idle), then the most skilled. */
function bestFor(job: string): Survivor | undefined {
  const sk = BEST[job];
  const able = living().filter((s) => canWork(s) && !onRunToday(s) && !isBitten(s));
  const idle = (s: Survivor) => (s.job === 'rest' && s.rest > 0.6 ? 2 : 0);
  const thumb = (s: Survivor) => (job === 'farm' && s.traits.includes('greenthumb') ? 1 : 0); // farming is a plain job: a Green thumb is the pick
  return able.sort((a, b) => idle(b) - idle(a) || thumb(b) - thumb(a) || (sk ? b.skills[sk] - a.skills[sk] : 0))[0];
}
/** Who to put on Counsel for this person: a free hand who is not them, the best talker first. */
function counselFor(r: Survivor): Survivor | undefined {
  const able = living().filter((s) => s !== r && canWork(s) && !onRunToday(s) && !isBitten(s) && s.job !== 'counsel');
  const idle = (s: Survivor) => (s.job === 'rest' && s.rest > 0.6 ? 2 : 0);
  return able.sort((a, b) => idle(b) - idle(a) || b.skills.social - a.skills.social)[0];
}
const jobSel = (s: Survivor | undefined) => (s ? `.sv-card[data-id="${s.id}"] select[data-act=job]` : '.people');
const on = (job: string) => living().some((s) => s.job === job && canWork(s));

function ammoRuns(): { res: Res; have: number; guns: number }[] {
  const need = new Map<Res, { guns: number; perShot: number }>();
  for (const s of living().filter(canFight)) {
    const it = G.weapons.find((x) => x.uid === s.weapon);
    if (!it) continue;
    const p = fireProfile(it);
    if (!p.ammoRes) continue;
    const e = need.get(p.ammoRes) ?? { guns: 0, perShot: p.perShot };
    e.guns++;
    need.set(p.ammoRes, e);
  }
  const out: { res: Res; have: number; guns: number }[] = [];
  // about SHOTS_PER_GUN_NIGHT shots a gun is one ordinary night on the wall
  for (const [res, { guns, perShot }] of need) {
    const have = Math.floor((G.stores[res] ?? 0) / (perShot || 1));
    if (have < SHOTS_PER_GUN_NIGHT * guns) out.push({ res, have, guns });
  }
  return out;
}

/** Everything open right now, unsorted. */
function openTodos(): Todo[] {
  const t: Todo[] = [];
  const people = living();
  const eat = dailyFood(people);
  const frac = G.fort.hp / G.fort.maxHp;
  const ws = isOpen('workshop');

  // day 1: open until the player has set (or re-set) anyone's job; the defaults are sensible
  if (G.day === 1 && !people.some((s) => planConfirmed(s)))
    t.push({ id: 'jobs1', icon: 'job_guard', text: 'Pick a job for each person', tip: 'The line in each job list says what it will yield today. Hover the picture for more.', sel: '.sv-card select[data-act=job]', prio: 5 });

  if (frac < 0.7 && !on('repair')) {
    const s = bestFor('repair');
    t.push({ id: 'wall', icon: 'job_repair', text: `Repair the wall · ${Math.round(frac * 100)}%`, tip: `Nobody is on Repair the wall.${s ? ` ${first(s)} builds best of the free hands.` : ''} Uses salvage.`, tab: 'wall', sel: jobSel(s), dot: s ? `surv:${s.id}` : 'tab:wall', prio: frac < 0.4 ? 10 : 25 });
  }
  if (eat) {
    const days = Math.floor(G.stores.food / eat);
    if (days < 3 && !on('farm')) {
      const s = bestFor('farm');
      t.push({ id: 'food', icon: 'food', text: days < 1 ? 'Find food · none left' : `Find food · ${days}d left`, tip: `The house eats ${+eat.toFixed(1)} a day.${s ? ` Put ${first(s)} on Food, or send a scavenger.` : ''}`, sel: jobSel(s), dot: s ? `surv:${s.id}` : undefined, prio: days < 2 ? 12 : 30 });
    }
  }
  if (halfRations() && people.length) {
    const full = dailyFood(people) * 2;
    t.push({ id: 'rations', icon: 'st_hungry', text: 'Half rations · hunger falls', tip: `Everyone eats half (${+eat.toFixed(1)} a day, not ${+full.toFixed(1)}), so hunger falls a little every day: people starve slowly, and mood is −5. Click: back to full rations (${Math.floor(G.stores.food / full)} days of food at full).`, act: 'fullrations', prio: G.stores.food >= full * 4 ? 24 : 33 });
  }
  const tonight = calendar(3);
  const red = (k: string) => k === 'tide' || k === 'crossing' || k === 'band' || k === 'horde' || k === 'raiders';
  const bigIn = tonight.findIndex((c) => red(c.kind));
  const prepping = G.craftQueue.some((q) => { const r = RECIPES.find((x) => x.id === q.recipe); return !!r && (!!r.trap || Object.keys(r.gives ?? {}).length > 0); }) && on('craft');
  if (bigIn >= 0 && ws && !prepping) {
    t.push({ id: 'prep', icon: 'trap_bear', text: bigIn === 0 ? 'Bad night tonight · traps and ammo' : `Bad night in ${bigIn}d · stock up`, tip: `${tonight[bigIn].label} Queue trap kits and rounds, and put someone at the bench.`, tab: 'workshop', sel: '[data-fold="ws-make-traps"], .wsq', dot: 'tab:workshop', prio: bigIn === 0 ? 15 : 48 });
  }
  // a red night with nobody listening or watching (director.ts intelSources: Radio with the mast, or
  // a Shooting 3+ lookout on Drill): the dusk report will say nothing about what is coming
  if (bigIn === 0 && isOpen('jobs')) {
    const mast = buildingLevel('radio') > 0;
    const watching = people.some((s) => canWork(s) && !onRunToday(s) && ((s.job === 'radio' && mast) || (s.job === 'drill' && s.skills.shooting >= 3)));
    if (!watching) {
      const able = people.filter((s) => canWork(s) && !onRunToday(s) && !isBitten(s));
      const radio = mast ? [...able].sort((a, b) => b.skills.social - a.skills.social)[0] : undefined;
      const look = able.filter((s) => s.skills.shooting >= 3).sort((a, b) => b.skills.shooting - a.skills.shooting)[0];
      const s = radio ?? look;
      t.push({ id: 'intel', icon: 'job_radio', text: `Nobody watching the road before the ${({ crossing: 'Crossing', band: 'tide' } as Record<string, string>)[tonight[0].kind] ?? tonight[0].kind}`, tip: `Tonight is a bad one, and nobody is on the Radio${mast ? '' : ' (needs the mast)'} or on Drill with Shooting 3+ as a lookout. With one, dusk tells you what is coming, wave by wave.${s ? ` ${first(s)} could: ${s === radio ? 'Work the radio' : 'Drill'}.` : ''}`, sel: jobSel(s), dot: s ? `surv:${s.id}` : undefined, prio: 16 });
    }
  }
  if (ws) {
    for (const a of ammoRuns()) {
      const r = RECIPES.find((x) => x.gives?.[a.res] && buildingLevel(x.needs) >= (x.level ?? 1));
      const queued = !!r && G.craftQueue.some((q) => q.recipe === r.id) && on('craft');
      if (queued) continue;
      const name = ammoLabel(a.res).toLowerCase();
      t.push(r
        ? { id: `ammo_${a.res}`, icon: (AMMO_TYPES[a.res]?.icon ?? 'icon_ammo').replace(/^icon_/, ''), text: `Make ${name} · ${a.have} left`, tip: `${a.have ? `Only ${a.have}` : 'No'} ${name} for ${a.guns === 1 ? 'one gun' : `${a.guns} guns`} on the wall: about one night's shooting is ${SHOTS_PER_GUN_NIGHT * a.guns}. Queue ${r.name} and put someone at the bench.`, tab: 'workshop', sel: `[data-act=queue][data-id="${r.id}"]`, dot: 'tab:workshop', prio: a.have < 10 * a.guns ? 18 : 22 }
        : { id: `ammo_${a.res}`, icon: (AMMO_TYPES[a.res]?.icon ?? 'icon_ammo').replace(/^icon_/, ''), text: `Find ${name} · ${a.have} left`, tip: `Nothing in the workshop makes ${name} yet. Scavengers and runs bring it home.`, sel: '.people', prio: 26 });
    }
  }
  // who may break at dawn (sim/day.ts breaksTick: 20 / 45 / 80 % under the lines, counsel ×0.35)
  const plan = counselPlan();
  const risky = people.filter((s) => { computeMood(s); return breakChance(s) > 0 && !plan.has(s); }).sort((a, b) => breakChance(b) - breakChance(a));
  if (risky.length) {
    const r = risky[0], p = breakChance(r), pc = (x: number) => `${Math.round(x * 100)}%`;
    const by = counselFor(r);
    t.push({ id: 'break', icon: 'st_break', text: `${first(r)} may break · ${pc(p)} → ${pc(p * COUNSEL_BREAK)} with counsel`, tip: `Mood ${Math.round(r.mood)}, under the break line. At dawn: ${pc(p)} to break (a lost day, smashed tools, walking out, or worse).${risky.length > 1 ? ` Also: ${risky.slice(1).map((o) => `${first(o)} ${pc(breakChance(o))}`).join(', ')}.` : ''} A counsellor talks the worst-off down first, one per 4 hours.${by ? ` Click: put ${first(by)} on Counsel.` : ''}`, act: by ? `counsel:${by.id}` : undefined, sel: by ? `.sv-card[data-id="${by.id}"] select[data-act=job]` : `.sv-card[data-id="${r.id}"]`, dot: `surv:${r.id}`, prio: p >= 0.45 ? 11 : 20 });
  }
  // guards who cannot shoot: a wall place wasted (battle.ts updateGuard returns without a gun)
  const line = wallLine();
  if (line.idle.length) {
    const n = line.idle.length, rack = rackGuns();
    const can = canArmAnyone();
    const plan = can ? armPreview() : [];
    const who = line.idle.map((s) => {
      const w = plan.find((p) => p.s === s)?.w;
      return `${first(s)}${s.weapon ? ' (no rounds)' : ''}${w ? ` → ${WEAPONS[w.def].name.toLowerCase()}${WEAPONS[w.def].cls === s.fav ? ' ★' : ''}` : ''}`;
    }).join(', ');
    t.push({ id: 'arm', icon: 'pistol', text: `${n} can't shoot tonight${can ? ' · arm ›' : ''}`, tip: `${who}. A guard without a gun or rounds holds a place on the wall and does nothing.${can ? ` Click: hand out the best free gun for each (rounds on hand, their favourite ★ first). ${rack.length} on the rack.` : ' No free gun with rounds on the rack: make or find rounds.'}`, act: can ? 'armall' : undefined, sel: can ? undefined : `.sv-card[data-id="${line.idle[0].id}"] select[data-act=weapon]`, dot: `surv:${line.idle[0].id}`, prio: 14 });
  }
  const heat = heatNeed();
  if (heat > G.stores.fuel && !on('scavenge')) {
    const s = bestFor('scavenge');
    t.push({ id: 'fuel', icon: 'fuel', text: `Find fuel · stove needs ${heat}`, tip: `The stove burns ${heat} tonight and there is ${Math.floor(G.stores.fuel)}. Scavengers bring ${RES_LABEL.fuel.toLowerCase()} home.`, sel: jobSel(s), dot: s ? `surv:${s.id}` : undefined, prio: 28 });
  }
  // a gun that came in today and sits on the rack: say what it is and where (a traded one used to vanish into the rack)
  const fresh = newOnRack();
  if (fresh.length) {
    const nm = (w: WeaponItem) => gunModel(w);
    t.push({ id: 'newgun', icon: 'pistol', text: fresh.length === 1 ? `New on the rack: the ${nm(fresh[0])} · give it to someone` : `${fresh.length} new guns on the rack · give them out`, tip: `${fresh.map(nm).join(', ')}: nobody carries ${fresh.length === 1 ? 'it' : 'them'} yet. Gun rack: pick who gets ${fresh.length === 1 ? 'it' : 'them'}.`, tab: 'armory', dot: 'tab:armory', prio: 18 });
  }
  // scavengers on the gate wait to be sent: the gate's "Send them out" (sim/day.ts sendScavengers)
  const ready = scavengersReady();
  if (ready.length) {
    const sites = [...new Set(ready.map((s) => SITES.find((x) => x.id === survivorSite(s))?.name ?? 'town'))];
    t.push({ id: 'sendscav', icon: 'job_scavenge', text: `Send ${ready.length === 1 ? first(ready[0]) : `${ready.length} scavengers`} out ›`, tip: `Ready at the gate for ${sites.join(', ')}. Click: they leave now and are back before dusk; the haul goes in the stores today. (Not sent, they still go when the day ends.)`, act: 'sendscav', dot: 'run', prio: 22 });
  }
  // a scavenger sent to a place already picked clean brings home scraps (sim/day.ts scavenge: 15%)
  for (const s of people.filter((x) => x.job === 'scavenge' && canWork(x) && !onRunToday(x) && !sentToday(x))) {
    const site = SITES.find((x) => x.id === survivorSite(s));
    if (!site || ((G.flags[`stock_${site.id}`] as number | undefined) ?? site.stock) > 0) continue;
    t.push({ id: `clean_${s.id}`, icon: 'job_scavenge', text: `${first(s)}'s place is picked clean`, tip: `${site.name} has nothing left worth the walk: ${first(s)} will bring home scraps. Pick another place.`, sel: `.sitebtn[data-id="${s.id}"]`, dot: `surv:${s.id}`, prio: 27 });
  }
  if (G.craftQueue.length && !on('craft') && ws) {
    const s = bestFor('craft');
    t.push({ id: 'bench', icon: 'job_craft', text: `Put ${s ? first(s) : 'someone'} at the bench`, tip: 'Work is queued, but nothing moves unless someone is on the Workshop job.', sel: jobSel(s), dot: s ? `surv:${s.id}` : undefined, prio: 30 });
  }
  const hurt = people.reduce((a, p) => a + p.wounds.filter((w) => !w.tended && !w.hidden).length, 0);
  if (hurt && !on('doctor')) {
    const s = bestFor('doctor');
    t.push({ id: 'tend', icon: 'job_doctor', text: `Tend the wounded · ${hurt}`, tip: 'Untended wounds bleed, fester and slow people down.', sel: jobSel(s), dot: s ? `surv:${s.id}` : undefined, prio: 32 });
  }
  const stale = people.filter((s) => canWork(s) && G.day > 1 && !planConfirmed(s) && !onRunToday(s));
  if (stale.length) t.push({ id: 'stale', icon: 'job_guard', text: stale.length === 1 ? `Check ${first(stale[0])}'s job` : `Check ${stale.length} jobs from yesterday`, tip: 'Yesterday\'s jobs carried over. Change them, or press Keep.', sel: '[data-act=keepplans]', prio: 35 });
  for (const s of people) {
    if (s.perkOffers?.length && !s.dead) t.push({ id: `perk_${s.id}`, icon: 'st_perk', text: `Pick ${first(s)}'s perk`, tip: 'A skill grew. Choose one perk on their sheet (or they choose at the second dawn).', sel: `.sv-card[data-id="${s.id}"] [data-act=detail]`, dot: `surv:${s.id}`, prio: 70 });
    if (!canWork(s) || onRunToday(s) || stale.includes(s)) continue;
    const whole = s.job === 'repair' && G.fort.hp >= G.fort.maxHp;
    const idle = (s.job === 'rest' && s.rest > 0.6) || (s.job === 'craft' && !G.craftQueue.length && ws) || whole;
    if (idle) t.push({ id: `idle_${s.id}`, icon: 'job_rest', text: `Give ${first(s)} a job`, tip: s.job === 'craft' ? 'The bench is empty: queue something, or give them other work.' : whole ? `The wall is whole: ${first(s)} has nothing to patch today.` : `${first(s)} is rested and doing nothing today.`, sel: jobSel(s), dot: `surv:${s.id}`, prio: 40 });
    if (s.rest < 0.25 && s.job !== 'rest') t.push({ id: `worn_${s.id}`, icon: 'st_tired', text: `Rest ${first(s)} · worn out`, tip: 'Give them the Rest job, or short hours.', sel: jobSel(s), dot: `surv:${s.id}`, prio: 45 });
  }
  // the next gun unlock, once the house can pay for it (sim/catalogue.ts nextUnlock)
  const nu = ws ? nextUnlock() : null;
  if (nu?.afford) {
    const n = nu.guns.length;
    t.push({ id: 'unlock', icon: 'job_craft', text: `You can build the ${nu.where} · unlocks ${n} gun${n === 1 ? '' : 's'}`, tip: `${nu.guns.map((g) => WEAPONS[g].name).join(', ')}: the bench can make ${n === 1 ? 'it' : 'them'} once the ${nu.where.toLowerCase()} is up. Workshop › Machinery.`, tab: 'workshop', sel: `[data-act=build][data-id=${nu.building}]`, dot: 'tab:workshop', prio: 50 });
  }
  // the merchant ties up every third day (sim/landing.ts)
  if (merchantOn() && G.flags.landingSeen !== G.day) {
    const rares = landingStock().filter((o) => o.merchant && o.rare && o.left > 0);
    t.push({ id: 'merchant', icon: 'scrap', text: `${MERCHANT_NAME} at the landing today${rares.length ? ` · ${rares.length} rare gun${rares.length === 1 ? '' : 's'}` : ''}`, tip: `Today only: ${landingStock().filter((o) => o.merchant && o.left > 0).map((o) => `${o.name} (${o.cost.salvage} salvage)`).join(', ') || 'sold out'}. Back in ${MERCHANT_EVERY} days.`, tab: 'landing', dot: 'tab:landing', prio: 55 });
  }
  for (const r of REVEAL) {
    if (!isNew(r.id)) continue;
    t.push({ id: `new_${r.id}`, icon: r.icon, text: `New: ${r.label}`, tip: r.what, tab: r.tab, sel: r.sel, dot: r.tab ? `tab:${r.tab}` : r.id === 'run' ? 'run' : r.id === 'calendar' ? 'calendar' : undefined, prio: 60, isNew: true });
  }
  return t;
}

// What the list showed earlier today: an item that was open and is now resolved stays, ticked.
let memDay = -1;
const mem = new Map<string, Todo>();
let current: Todo[] = [];

/** The list as shown: open items (most urgent first), then today's ticked ones; five at most. */
export function todos(): Todo[] {
  if (memDay !== G.day) { memDay = G.day; mem.clear(); }
  const open = openTodos().sort((a, b) => a.prio - b.prio);
  for (const o of open) mem.set(o.id, o);
  const ids = new Set(open.map((o) => o.id));
  // a "new" item that was looked at is not a task done; it simply goes
  const done = [...mem.values()].filter((m) => !ids.has(m.id) && !m.isNew).map((m) => ({ ...m, done: true }));
  const shown = open.slice(0, 4);
  current = [...shown, ...done.slice(0, Math.max(0, 5 - shown.length))];
  return current;
}
export const openCount = () => current.filter((t) => !t.done).length;

/** Keys that carry a yellow dot right now. */
export function dotKeys(list = current): Set<string> {
  const d = new Set<string>();
  for (const t of list) if (!t.done && t.dot) d.add(t.dot);
  return d;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The strip under the header. Clicks: data-act="todo" data-i, "dusk", "revealall". */
export function todayHtml(duskKey: string): string {
  const list = todos();
  const left = list.filter((t) => !t.done).length;
  const items = list.map((t, i) => `<button class="td ${t.done ? 'done' : ''} ${t.isNew ? 'new' : ''}" data-act="todo" data-i="${i}"${tip(t.tip ? `<b>${esc(t.text)}</b><br>${esc(t.tip)}` : '')}>
      <span class="td-box">${t.done ? '✓' : ''}</span>${ico(t.icon, '', 'sm')}<span class="td-t">${esc(t.text)}</span></button>`).join('');
  const ready = left === 0 ? `<button class="td ready" data-act="dusk"${tip(`Everything on the list is done. ${esc(duskKey)} also goes.`)}>Ready for dusk ›</button>` : '';
  const early = !revealAll() && REVEAL.some((r) => r.id !== 'graves' && !isOpen(r.id));
  return `<div class="today" role="list" aria-label="Today">
    <span class="td-h t-l"${tip('What needs doing before dusk, most urgent first. Click one to go there.')}>Today${left ? ` <b>${left}</b>` : ''}</span>
    ${items}${ready}
    ${early ? `<button class="mini link td-all" data-act="revealall"${tip('New screens open over the first days. Show them all now.')}>show everything</button>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- jump and flash
let pendingFlash: string | null = null;
/** Remember a todo's target; the day screen flashes it after its next render. Returns the tab to open, if any. */
export function pickTodo(i: number): { tab?: string; act?: string; id?: string; sel?: string; dot?: string } {
  const t = current[i];
  if (!t) return {};
  if (t.isNew) markSeen(t.id.replace(/^new_/, ''));
  pendingFlash = t.sel ?? null;
  return { tab: t.tab, act: t.done ? undefined : t.act, id: t.id, sel: t.sel, dot: t.dot };
}
/** After a render: scroll the pending target into view (opening its folds) and pulse it. */
export function applyFlash(root: HTMLElement) {
  if (!pendingFlash) return;
  const sel = pendingFlash;
  pendingFlash = null;
  const el = root.querySelector(sel) as HTMLElement | null;
  if (!el) return;
  for (let p: HTMLElement | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
  const all = root.querySelectorAll(sel);
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { el.scrollIntoView(); }
  all.forEach((x) => { x.classList.remove('td-flash'); void (x as HTMLElement).offsetWidth; x.classList.add('td-flash'); });
  window.setTimeout(() => all.forEach((x) => x.classList.remove('td-flash')), 2600);
  if (el.tagName === 'SELECT' || el.tagName === 'BUTTON') el.focus({ preventScroll: true });
}

/** The one-line "what this is for" while a system is new (or was first opened today). */
export function revealNote(id: RevealId): string {
  const r = REVEAL.find((x) => x.id === id);
  if (!r || revealAll() || !isOpen(id)) return '';
  if (!isNew(id) && G.flags[`seen_${id}`] !== G.day) return '';
  return `<div class="reveal-note">${ico(r.icon, '', 'sm')}<span><b>New.</b> ${esc(r.what)}</span></div>`;
}

/** Whether the leader's run panel shows (it unlocks on its day, or once a run happened). */
export const runOpen = () => isOpen('run') || ranToday();
