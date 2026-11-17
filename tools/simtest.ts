// Headless soak test of the sim layer: runs N days with a crude night model.
import { G } from '../src/state';
import { newGame } from '../src/sim/newgame';
import { resolveDayWork, dawnTick, nextWeather, queueRecipe } from '../src/sim/day';
import { planNight, afterNight } from '../src/sim/director';
import { rollIncident, resolveEvent, returnsTick } from '../src/sim/events';
import { living, wound, killSurvivor } from '../src/sim/survivors';

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
    lastDay = G.day;
    moods.push(Math.round(living().reduce((a, x) => a + x.mood, 0) / Math.max(1, living().length)));
  }
  console.log(`run ${r} (${G.director.mode}): reached day ${lastDay}, living ${living().length}, graves ${G.graves.length}, chronicle ${G.chronicle.length}, food ${G.stores.food}, threat ${pts.join(',')}\n    mood ${moods.join(',')}`);
  console.log('   ', G.chronicle.slice(-4).map((c) => c.text).join(' | '));
}
