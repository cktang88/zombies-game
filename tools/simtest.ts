// Headless soak test of the sim layer: runs N days with a crude night model.
import { G, setState, addRep } from '../src/state';
import { newGame } from '../src/sim/newgame';
import { resolveDayWork, dawnTick, nextWeather, queueRecipe } from '../src/sim/day';
import { planNight, afterNight } from '../src/sim/director';
import { rollIncident, resolveEvent, returnsTick, INCIDENTS } from '../src/sim/events';
import { living, wound, killSurvivor, makeSurvivor, setBond } from '../src/sim/survivors';
import { fateLine, morningSummary } from '../src/sim/chronicle';
import type { GameState } from '../src/types';
import { activeThreads, threadTick, threadsWon, evacuees } from '../src/sim/threads';
import { calendar, noiseOfHouse, omenTick } from '../src/sim/calendar';
import { ICE_DAY } from '../src/state';
import { inscribe, recordRun, setBoon, applyBoons, scoreCard } from '../src/sim/legacy';

const fired = new Map<string, number>();
const errors: string[] = [];
let failed = false;
const check = (ok: boolean, msg: string) => { if (!ok) { failed = true; console.log('  FAIL:', msg); } };

// Try every incident whose weight is live right now, each on a throwaway copy of the state.
function coverage() {
  if (!living().length) return;
  const snap = JSON.stringify(G);
  for (const inc of INCIDENTS) {
    setState(JSON.parse(snap) as GameState);
    let w = 0;
    try { w = inc.weight(); } catch (e) { errors.push(`${inc.id}.weight: ${e}`); continue; }
    if (w <= 0) continue;
    try {
      const ev = inc.make();
      if (!ev) continue;
      const c = Math.floor(Math.random() * ev.choices.length);
      const out = inc.resolve?.(c, ev.data ?? {}) ?? '';
      if (typeof out !== 'string' || /undefined|NaN|\[object/.test(out + ev.text)) errors.push(`${inc.id}: suspicious text: ${(ev.text + ' / ' + out).slice(0, 160)}`);
      fired.set(inc.id, (fired.get(inc.id) ?? 0) + 1);
    } catch (e) { errors.push(`${inc.id}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`); }
  }
  setState(JSON.parse(snap) as GameState);
}

const runs = +(process.argv[2] ?? 5);
for (let r = 0; r < runs; r++) {
  newGame(['siege', 'quiet', 'coin'][r % 3], 1000 + r);
  let lastDay = 0;
  const pts: number[] = [];
  const moods: number[] = [];
  for (let d = 0; d < 30 && living().length; d++) {
    if (G.pendingEvent) {
      const ev = G.pendingEvent; G.pendingEvent = null;
      resolveEvent(ev, Math.floor(Math.random() * ev.choices.length));
    }
    const jobs = ['repair', 'scavenge', 'craft', 'farm', 'doctor', 'rest'] as const;
    living().forEach((s, i) => (s.job = jobs[i % jobs.length]));
    if (G.craftQueue.length < 2) queueRecipe('ammo_light');
    resolveDayWork();
    const plan = planNight();
    pts.push(plan.points);
    // crude night: wall takes damage proportional to threat; a breach wounds someone
    G.fort.hp = Math.max(0, G.fort.hp - plan.points * (1 + Math.random()));
    let deaths = 0;
    if (G.fort.hp <= 0) {
      const s = living()[Math.floor(Math.random() * living().length)];
      wound(s, Math.random() < 0.35 ? 'bite' : 'laceration', 0.5);
      if (Math.random() < 0.2) { killSurvivor(s, 'test'); deaths++; }
    }
    if (G.flags.turningTonight) { const s = living().find((x) => x.id === G.flags.turningTonight); if (s) killSurvivor(s, 'turned'); delete G.flags.turningTonight; }
    afterNight(deaths, G.fort.hp > 0);
    G.day++;
    nextWeather();
    returnsTick();
    dawnTick();
    G.pendingEvent = rollIncident();
    // shake the faction standings so every faction branch gets exercised
    if (G.day === 6) for (const f of ['county', 'union', 'parish', 'ferry']) addRep(f, [-60, 45, 50, 60][(r + ['county', 'union', 'parish', 'ferry'].indexOf(f)) % 4]);
    if (G.day % 3 === 0) {
      if (G.day === 9 && living().length) { wound(living()[0], 'bite', 0.4, 'larm'); G.flags.quietJar = true; G.buildings.push({ id: 'generator', level: 1 }, { id: 'radio', level: 1 }); G.fort.lights = 2; }
      if (G.day === 12 && living().length > 1) wound(living()[1], 'bite', 0.4, 'rarm').hidden = true;
      coverage();
    }
    lastDay = G.day;
    moods.push(Math.round(living().reduce((a, x) => a + x.mood, 0) / Math.max(1, living().length)));
  }
  console.log(`run ${r} (${G.director.mode}): reached day ${lastDay}, living ${living().length}, graves ${G.graves.length}, chronicle ${G.chronicle.length}, food ${G.stores.food}, threat ${pts.join(',')}\n    mood ${moods.join(',')}`);
  console.log('   ', G.chronicle.slice(-4).map((c) => c.text).join(' | '));
}

// ---------- endings ----------
function scenario(name: string, day: number, reps: Record<string, number>, want: string, extra?: () => void) {
  newGame('siege', 4242);
  for (let i = 0; i < 4; i++) G.survivors.push(makeSurvivor());
  G.day = day;
  for (const [f, v] of Object.entries(reps)) addRep(f, v);
  extra?.();
  let ev = rollIncident();
  for (let i = 0; i < 6 && ev && ev.id !== want; i++) { resolveEvent(ev, 0); G.director.cooldowns[want] = 0; ev = rollIncident(); }
  check(ev?.id === want, `${name}: expected incident ${want}, got ${ev?.id}`);
  if (!ev) return;
  fired.set(want, (fired.get(want) ?? 0) + 1);
  const out = resolveEvent(ev, 0);
  check(!!G.flags.ending, `${name}: no ending flag after choosing; outcome: ${out}`);
  const went = JSON.parse(String(G.flags.endWent ?? '[]')) as string[];
  const stayed = JSON.parse(String(G.flags.endStayed ?? '[]')) as string[];
  console.log(`ending ${name}: ${G.flags.ending}, went ${went.length}, stayed ${stayed.length}`);
  console.log('   ', ev.choices.map((c) => `${c.label}${c.hint ? ` [${c.hint}]` : ''}`).join(' | '));
  for (const s of [...living(), ...G.graves]) {
    const f = stayed.includes(s.id) ? 'stayed' : s.dead ? 'dead' : 'went';
    const line = fateLine(s, f, String(G.flags.ending));
    check(!/undefined|NaN/.test(line), `${name}: bad fate line ${line}`);
  }
  console.log('    fate:', fateLine(living()[0], 'went', String(G.flags.ending)));
  check(rollIncident() === null, `${name}: incidents still roll after the ending`);
}
scenario('ferry', 19, { ferry: 60 }, 'ferry_last');
scenario('ferry with a bitten survivor', 20, { ferry: 80 }, 'ferry_last', () => { const s = living()[1]; wound(s, 'bite', 0.4, 'larm').infected = true; G.flags[`biteasked_${s.id}`] = true; G.flags[`mercy_${s.id}`] = true; });
scenario('mill', 24, { union: 60 }, 'union_mill');
// county hostility forces the raiders special for the combat layer
newGame('siege', 777);
G.day = 8; addRep('county', -60);
const cw = rollIncident();
check(cw?.id === 'county_warn', `county: expected county_warn, got ${cw?.id}`);
if (cw) { resolveEvent(cw, cw.choices.length - 1); check(G.flags.forceSpecial === 'raiders', 'county: forceSpecial not set'); }
console.log('county hostile -> forceSpecial =', G.flags.forceSpecial);
console.log('morning:', morningSummary({ [living()[0].id]: 14, [living()[1].id]: 7 }, living(), [living()[2]], []).join(' / '));

// the good-times incidents need a happy, armed house
newGame('quiet', 99);
G.day = 12; living()[0].mood = 90; G.weapons[0].name = 'Old Reliable'; G.weapons[0].kills = 40;
setBond(living()[0], living()[1], 'lover');
G.flags.rations = 'half'; G.stores.food = 99;
coverage();

// ---------- radio threads ----------
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: object }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
};
function runIncident(id: string, choice = 0) {
  const inc = INCIDENTS.find((i) => i.id === id)!;
  check(inc.weight() > 0, `${id} not available (weight 0)`);
  const ev = inc.make();
  check(!!ev, `${id} make() returned null`);
  if (!ev) return '';
  fired.set(id, (fired.get(id) ?? 0) + 1);
  return resolveEvent(ev, choice);
}
newGame('siege', 31337);
G.day = 6; G.flags.rep_ferry = 20; G.flags.rep_union = 10; G.flags.rep_parish = 10;
for (const id of ['earl', 'guard']) runIncident(`thread_${id}`, 0);
check(activeThreads().length === 2, `threads active: ${activeThreads().length}`);
console.log('threads:', activeThreads().map((t) => `${t.title} (day ${t.deadlineDay}): ${t.text}`).join(' | '));
G.stores.meds = 5;
console.log('  earl ->', runIncident('deliver_earl').slice(0, 90));
G.buildings.push({ id: 'radio', level: 1 }); living()[0].job = 'radio';
for (let i = 0; i < 3; i++) { G.day++; threadTick(); }
console.log('  guard ->', runIncident('deliver_guard').slice(0, 90));
for (const id of ['peltier', 'union_gen']) runIncident(`thread_${id}`, 0);
G.stores.fuel = 25; runIncident('deliver_peltier');
G.day += 9; console.log('  failed:', threadTick().join(' / ').slice(0, 140));
runIncident('thread_parish_soup', 0); G.stores.food = 80; runIncident('deliver_parish_soup'); runIncident('deliver_parish_soup');
check(threadsWon() === 4, `threads won ${threadsWon()} (want 4: earl, guard, peltier, parish)`);
G.day = 23; G.pendingEvent = null;
const seat = rollIncident();
check(seat?.id === 'peltier_seat', `seat incident: ${seat?.id}`);
if (seat) { fired.set('peltier_seat', 1); resolveEvent(seat, 0); }
check(evacuees().length === 1, 'evacuee recorded');
const sc = scoreCard();
console.log('score:', sc.score, sc.rows.map((r) => r.join(' ')).join('; '), '—', sc.grade);

// ---------- legacy ----------
const s0 = living()[0];
s0.tales.push('Held the line alone on the north wall.');
G.weapons[0].name = `${s0.name.split(' ')[0]}'s Hymnal`; G.weapons[0].kills = 31; s0.weapon = G.weapons[0].uid;
check(inscribe(s0, 'lived'), 'inscribe');
check(inscribe(living()[1], 'lived'), 'inscribe 2');
check(!inscribe(living()[2] ?? s0, 'lived'), 'third inscription should be refused');
G.day = 30; G.flags.ending = 'spring';
const fresh = recordRun('ending');
console.log('unlocked:', fresh.join(', '));
check(fresh.length === 3, 'all three boons unlock on this run');
for (const b of ['wall', 'press', 'dog']) setBoon(b, true);
newGame('siege', 2024);
const boonLines = applyBoons();
check(G.fort.maxHp === 360 && !!G.flags.dog && G.buildings.some((b) => b.id === 'workbench' && b.level === 2), 'boons applied');
G.day = 6;
console.log('  heir ->', runIncident('heir', 0).slice(0, 100));
check(G.weapons.some((w) => w.name?.endsWith('Hymnal') && w.kills === 31), 'heirloom gun arrived');
console.log('  heir text:', living()[living().length - 1].tales.join(' '), '| boons:', boonLines.length);

// Peltier's tarp: attachments and odd ammunition
newGame('siege', 55);
G.day = 5; G.stores.food = 200; G.stores.fuel = 200; G.stores.meds = 200; G.stores.light = 999;
let specials = 0;
const trader = INCIDENTS.find((i) => i.id === 'trader')!;
for (let i = 0; i < 40; i++) {
  const ev = trader.make()!;
  const si = ev.choices.findIndex((c) => c.effect === 's');
  if (si < 0) continue;
  const before = (G.modStock ?? []).length + G.stores.shell_slug + G.stores.rifle_ap + G.stores.shell_fire + G.stores.r556;
  const out = resolveEvent(ev, si);
  const after = (G.modStock ?? []).length + G.stores.shell_slug + G.stores.rifle_ap + G.stores.shell_fire + G.stores.r556;
  check(after > before, `trader special gave nothing: ${out}`);
  if (!specials) console.log('tarp:', ev.choices[si].label, '—', out.slice(0, 60));
  specials++;
}
check(specials > 5, `trader specials offered ${specials}/40`);
console.log(`trader specials bought: ${specials}/40; bench mods ${(G.modStock ?? []).map((m) => m.def).join(',')}`);

// ---------- tide calendar, omens, smell of the house ----------
newGame('siege', 8080);
G.day = 1;
const tides = calendar(23).filter((c) => c.kind === 'tide').map((c) => c.day);
check(JSON.stringify(tides) === '[6,13,20]', `siege tides ${tides}`);
check(calendar(30).find((c) => c.day === ICE_DAY)?.kind === 'crossing', 'crossing on the calendar');
G.day = 4; const om = omenTick();
check(om.length > 0 && !!G.flags.teaser, `omen 2 days before the tide: ${om.join(' / ')} teaser=${G.flags.teaser}`);
console.log('omen day 4:', om.join(' / '), '| teaser:', G.flags.teaser);
G.day = 5; G.director.cooldowns = {}; G.pendingEvent = null;
console.log('omen incident day 5:', rollIncident()?.id, '| forecast:', JSON.stringify(G.flags.teaser));
G.flags.forceSpecial = 'raiders';
check(calendar(1)[0].kind === 'raiders', 'forced special shows tonight');
delete G.flags.forceSpecial;
const lean = noiseOfHouse(); G.stores.food = 300; G.stores.fuel = 80; G.fort.lights = 3;
const fat = noiseOfHouse();
check(fat.level > lean.level && fat.pct > lean.pct, 'hoarding raises the smell of the house');
console.log('smell:', lean.pct + '%', '->', fat.pct + '%', fat.reasons.join('; '));
G.director.mode = 'coin'; check(calendar(3).every((c) => c.kind === 'unknown'), 'coin is unknown');
G.director.mode = 'quiet'; G.day = 1; console.log('quiet:', calendar(10).map((c) => c.kind[0]).join(''));

const ids = INCIDENTS.map((i) => i.id);
console.log(`\nincidents: ${ids.length} total; exercised ${fired.size}: ${[...fired.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`);
console.log('never fired:', ids.filter((i) => !fired.has(i)).join(', ') || '(none)');
if (errors.length) { console.log('ERRORS:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ', e); failed = true; }
if (failed) process.exit(1);
