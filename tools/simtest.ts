// Headless soak test of the sim layer: runs N days with a crude night model.
import { G, setState, addRep } from '../src/state';
import { newGame } from '../src/sim/newgame';
import { resolveDayWork, dawnTick, nextWeather, queueRecipe } from '../src/sim/day';
import { planNight, afterNight } from '../src/sim/director';
import { rollIncident, resolveEvent, returnsTick, INCIDENTS } from '../src/sim/events';
import { living, wound, killSurvivor, makeSurvivor, setBond } from '../src/sim/survivors';
import { fateLine, morningSummary } from '../src/sim/chronicle';
import type { GameState } from '../src/types';

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

const ids = INCIDENTS.map((i) => i.id);
console.log(`\nincidents: ${ids.length} total; exercised ${fired.size}: ${[...fired.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`);
console.log('never fired:', ids.filter((i) => !fired.has(i)).join(', ') || '(none)');
if (errors.length) { console.log('ERRORS:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ', e); failed = true; }
if (failed) process.exit(1);
