// Write a believable mid-game save for screenshots and manual testing: a house that has held
// for N days (the simtest's crude nights), with machinery, guns with attachments, trap kits,
// a gun nest, papers found in town, and a few survivors with some history.
//   npx tsx tools/stage-save.ts [day=12] [out=/tmp/vessey-save.json] [seed=1001]
// Load it in the browser: localStorage.setItem('vessey-save-v1', <file contents>), then Continue (older saves migrate on load: state.ts migrateSave).
import { writeFileSync } from 'node:fs';
import { G, addRep } from '../src/state';
import { newGame } from '../src/sim/newgame';
import { resolveDayWork, dawnTick, nextWeather, queueRecipe } from '../src/sim/day';
import { Rng } from '../src/rng';
import { planNight, afterNight } from '../src/sim/director';
import { rollIncident, resolveEvent, returnsTick } from '../src/sim/events';
import { living, wound, makeSurvivor, gainXp, gainProf } from '../src/sim/survivors';
import { WEAPONS } from '../src/data/weapons';
import type { WeaponItem } from '../src/types';
import { DOCS } from '../src/data/lore';

const days = +(process.argv[2] ?? 12);
const out = process.argv[3] ?? '/tmp/vessey-save.json';
const rnd = new Rng(+(process.argv[4] ?? 1001));
newGame('siege', +(process.argv[4] ?? 1001));
// a fuller house than the opening three
for (let i = 0; i < 2; i++) { const s = makeSurvivor(); s.arrivedDay = 2 + i * 3; G.survivors.push(s); }
for (let d = 1; d < days && living().length; d++) {
  if (G.pendingEvent) { const ev = G.pendingEvent; G.pendingEvent = null; resolveEvent(ev, 0); }
  const jobs = ['repair', 'scavenge', 'craft', 'farm', 'doctor', 'rest'] as const;
  living().forEach((s, i) => (s.job = jobs[i % jobs.length]));
  if (G.craftQueue.length < 2) queueRecipe('ammo_light');
  resolveDayWork();
  const plan = planNight();
  G.fort.hp = Math.max(1, G.fort.hp - plan.points * (0.4 + rnd.next() * 0.5));
  afterNight(0, true);
  G.day++;
  nextWeather();
  returnsTick();
  dawnTick();
  G.pendingEvent = rollIncident();
  if (G.day === 6) for (const f of ['county', 'union', 'parish', 'ferry']) addRep(f, [20, 35, 15, 30][['county', 'union', 'parish', 'ferry'].indexOf(f)]);
}
G.pendingEvent = null;
G.phase = 'day';
G.nextNight = null;
// machinery and a stocked house
const build = (id: string, level: number) => { const b = G.buildings.find((x) => x.id === id); if (b) b.level = Math.max(b.level, level); else G.buildings.push({ id, level }); };
build('workbench', 2); build('forge', 1); build('generator', 1); build('radio', 1); build('infirmary', 1); build('garden', 1);
Object.assign(G.stores, { food: Math.max(G.stores.food, 14), salvage: 48, fuel: 9, meds: 3, molotov: 4 });
G.fort.hp = Math.round(G.fort.maxHp * 0.82);
G.fort.lights = 2;
G.fort.spikes = Math.max(G.fort.spikes, 1);
G.trapStock = { ...(G.trapStock ?? {}), tincan: 2, deadfall: 1, propane: 1, pipemine: 1, beartrap: 2, spikepit: 1 };
// papers picked up on runs
G.flags.docs = JSON.stringify(DOCS.slice(0, 6).map((d) => d.id));
// a gun nest on the roof
G.flags.emplacements = JSON.stringify([{ id: 'mgnest', post: 'roof', cond: 0.9 }]);
// guns: one with attachments, a few more on the rack
const mod = (def: string) => { G.uid++; return { uid: `m${G.uid}`, def, cond: 1 }; };
const add = (def: string, extra: Partial<WeaponItem> = {}) => { if (!WEAPONS[def]) return; G.uid++; G.weapons.push({ uid: `w${G.uid}`, def, cond: 0.6 + rnd.next() * 0.35, kills: Math.floor(rnd.next() * 40), ...extra }); };
add('ar15', { name: 'Haugen\'s Carbine', mods: { optic: mod('reddot'), under: mod('flashlight'), mag: mod('extmag'), stock: mod('sling') } });
add('scoped', { mods: { optic: mod('scope'), under: mod('bipod') } });
add('pump', { mods: { muzzle: mod('choke'), under: mod('flashlight') } });
add('lever');
G.modStock = [...(G.modStock ?? []), mod('suppressor'), mod('drum'), mod('brake')];
// some skill and history on the leader and the others
for (const s of living()) {
  gainXp(s, 'shooting', 300 + rnd.next() * 600);
  gainXp(s, 'scavenging', 200 + rnd.next() * 400);
  gainProf(s, 'rifle', 120 + rnd.next() * 300);
}
if (living()[2]) wound(living()[2], 'laceration', 0.35, 'larm');
writeFileSync(out, JSON.stringify(G));
console.log(`day ${G.day}, ${living().length} living, ${G.weapons.length} guns, buildings ${G.buildings.map((b) => `${b.id}${b.level}`).join(' ')} → ${out}`);
