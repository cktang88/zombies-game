import type { NightPlan } from '../types';
import { G, R, ICE_DAY } from '../state';
import { ZOMBIES } from '../data/zombies';
import { living, canFight } from './survivors';
import { WEAPONS } from '../data/weapons';

// The storyteller. Named "the Weather" by the people of Vessey, because it is.
export interface Persona { id: string; name: string; desc: string; cycle: number[]; jitter: [number, number]; diff: number }
export const PERSONAS: Record<string, Persona> = {
  siege: { id: 'siege', name: 'The Long Siege', desc: 'Rising pressure in weekly tides, a hard night, then a breath.', cycle: [0.7, 0.85, 1.0, 1.1, 1.25, 1.55, 0.55], jitter: [0.9, 1.1], diff: 1 },
  quiet: { id: 'quiet', name: 'The Quiet', desc: 'Long breathers. Room to build, room to grieve. Still, the ice comes.', cycle: [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.3, 0.5, 0.5, 0.6], jitter: [0.9, 1.05], diff: 0.75 },
  coin: { id: 'coin', name: 'The Coin', desc: 'No pattern. No mercy. No malice either. Anything can happen.', cycle: [1], jitter: [0.5, 1.7], diff: 1.05 },
};

export function persona() {
  return PERSONAS[G.director.mode] ?? PERSONAS.siege;
}

export function cyclePos(day = G.day) {
  const c = persona().cycle;
  return { phase: c[(day - 1) % c.length], peak: (day - 1) % c.length === c.indexOf(Math.max(...c)) };
}

// Camp "wealth" invites the dead: noise, light, smell of cooking.
export function campWealth() {
  const s = G.stores;
  const goods = s.food * 1 + s.scrap * 0.6 + s.wood * 0.4 + s.parts * 2 + s.meds * 3 + s.fuel * 1.5 + s.cloth * 0.5 + (s.light + s.shell * 2 + s.rifle * 2) * 0.15;
  const guns = G.weapons.reduce((a, w) => a + 25 + WEAPONS[w.def].dmg * 0.4, 0);
  const builds = G.buildings.reduce((a, b) => a + 30 * b.level, 0);
  const fort = (G.fort.maxHp - 300) * 0.2 + G.fort.lights * 15;
  return goods + guns + builds + fort;
}

export function threatPoints(day = G.day) {
  const p = persona();
  const ramp = 0.55 + 0.45 * Math.min(1, Math.max(0, (day - 2) / 12));
  const base = 10 + 6 * Math.pow(day, 1.02);
  const wealth = Math.min(35, Math.sqrt(campWealth()) * 0.7);
  const pawns = living().filter(canFight).length * 3;
  const adapt = G.director.tension; // -20..40
  const adaptF = adapt < 0 ? 0.6 + 0.4 * ((adapt + 20) / 20) : 1 + 0.22 * (adapt / 40);
  const { phase } = cyclePos(day);
  const jitter = R.range(p.jitter[0], p.jitter[1]);
  let pts = (base + wealth + pawns) * ramp * adaptF * phase * jitter * p.diff;
  // mercy: right after a death the Weather eases off
  if (G.flags.lastDeathDay !== undefined && day - (G.flags.lastDeathDay as number) <= 1) pts *= 0.8;
  if (day === ICE_DAY) pts *= 2.2;
  if (day > ICE_DAY) pts *= 1.35;
  return Math.max(8, Math.round(pts));
}

export function planNight(): NightPlan {
  const day = G.day;
  let pts = threatPoints(day);
  const { peak } = cyclePos(day);
  // an incident may have promised something for tonight; consume it
  // (the Crossing outranks everything; a promise made for that night keeps until the next)
  const forced = day === ICE_DAY ? undefined : (G.flags.forceSpecial as string | undefined);
  if (day !== ICE_DAY) delete G.flags.forceSpecial;
  let special: string | undefined;
  let label = 'They will come tonight, like every night.';
  if (day === ICE_DAY) {
    special = 'crossing';
    label = 'The river is white from bank to bank. Tonight they walk across. Somewhere over there, a bell.';
  } else if (forced === 'raiders') {
    special = 'raiders';
    label = 'Headlights on Route 9 at dusk, then no headlights. The County is coming for what we have.';
  } else if (forced === 'horde') {
    special = 'horde';
    label = 'The whole east bank is moving. Not a tide. A flood.';
    pts = Math.round(pts * 1.45);
  } else if (forced === 'tunnel' || (day > 10 && R.chance(0.06))) {
    special = 'tunnel';
    label = 'Scraping in the storm drain under Ferry Road. Under the wall.';
  } else if (peak && day >= 5) {
    special = 'tide';
    label = 'A tide night. The radio says the whole east bank is moving.';
  } else if (G.weather === 'fog' || (day > 3 && R.chance(0.12))) {
    special = 'fog';
    label = 'Fog off the river. You will hear them before you see them.';
  } else if (day > 6 && R.chance(0.1)) {
    special = 'criers';
    label = 'Keening from the Manor all afternoon. Something is calling them.';
  }
  const types = Object.values(ZOMBIES).filter((z) => z.minDay <= day);
  const spawns: NightPlan['spawns'] = [];
  let budget = pts;
  const duration = Math.min(210, 70 + pts * 0.55);
  const surgeAt = [0.0, 0.38, 0.7];
  const surgeShare = [0.4, 0.3, 0.3];
  for (let s = 0; s < 3; s++) {
    let sb = pts * surgeShare[s];
    const t0 = duration * surgeAt[s];
    const span = duration * 0.28;
    let guard = 0;
    while (sb > 0.5 && guard++ < 400) {
      const z = R.weighted(types, (t) => {
        let w = t.id === 'sleeper' ? 6 : t.id === 'deer' ? 2.2 : t.id === 'drag' ? 1.2 : 1;
        if (special === 'criers' && t.id === 'crier') w *= 4;
        if ((special === 'tide' || special === 'horde') && t.id === 'deer') w *= 2;
        if (special === 'horde' && t.id === 'sleeper') w *= 1.5;
        if (t.cost > sb + 1) w = 0;
        if (t.cost > pts * 0.25) w *= 0.2;
        return w;
      });
      if (!z) break;
      sb -= z.cost;
      budget -= z.cost;
      spawns.push({ type: z.id, t: t0 + R.range(0, span) });
    }
  }
  if (special === 'crossing') {
    for (let i = 0; i < 3; i++) spawns.push({ type: 'ferryman', t: duration * (0.5 + i * 0.15) });
    // the one who rang the bell, walking across the ice
    spawns.push({ type: 'bellwether', t: duration * 0.42 });
  } else if (special === 'raiders') {
    // living men come in with the second surge, while the guns are busy with the dead
    const n = Math.min(6, 2 + Math.floor(day / 6));
    for (let i = 0; i < n; i++) spawns.push({ type: 'raider', t: duration * (0.3 + (i % 3) * 0.05) + R.range(0, 6) + (i >= 3 ? duration * 0.3 : 0) });
    // drop some of the dead to pay for them
    trim(spawns, n * ZOMBIES.raider.cost * 0.7);
  } else if (special === 'tunnel') {
    const groups = day > 16 ? 3 : 2;
    let n = 0;
    for (let gi = 0; gi < groups; gi++) {
      const t0 = duration * R.range(0.2, 0.85);
      const k = R.int(2, 3 + Math.floor(day / 10));
      for (let i = 0; i < k; i++, n++) spawns.push({ type: 'tunneler', t: t0 + i * R.range(1.2, 2.4) });
    }
    trim(spawns, n * ZOMBIES.tunneler.cost);
  }
  // someone from a survivor's past walks up the road tonight
  if (G.flags.oldFace) {
    const of = JSON.parse(G.flags.oldFace as string) as { name: string; by: string };
    spawns.push({ type: 'sleeper', t: duration * R.range(0.3, 0.7), name: of.name });
  }
  spawns.sort((a, b) => a.t - b.t);
  return { points: pts, label, special, spawns };
}

// Remove ordinary Sleepers/Drags from the plan worth about `cost` points.
function trim(spawns: NightPlan['spawns'], cost: number) {
  for (let i = spawns.length - 1; i >= 0 && cost > 0; i--) {
    const z = ZOMBIES[spawns[i].type];
    if (!z.special && (z.id === 'sleeper' || z.id === 'drag') && !spawns[i].name) {
      cost -= z.cost;
      spawns.splice(i, 1);
    }
  }
}

// Called at dawn with the night's outcome to adjust the director's "adaptation".
export function afterNight(deaths: number, wallHeld: boolean) {
  const d = G.director;
  if (deaths > 0) d.tension -= 10 * deaths;
  else if (G.day > 4) d.tension += 2;
  if (!wallHeld) d.tension -= 4;
  d.tension = Math.max(-20, Math.min(40, d.tension));
  if (cyclePos().peak) d.lastBigDay = G.day;
}

export function forecast(): string {
  const next = G.day + 1;
  if (next === ICE_DAY) return 'The radio: "River\'s near froze over. Tomorrow, maybe the day after, it holds a man\'s weight."';
  if (persona().id === 'coin' || next > ICE_DAY) return '';
  // the next tide, as marked on the kitchen calendar (see sim/calendar.ts for the strip)
  let daysToPeak = 99;
  for (let i = 1; i < 8; i++) if (cyclePos(G.day + i).peak && G.day + i >= 5) { daysToPeak = i; break; }
  if (persona().id === 'quiet') return daysToPeak <= 3 ? 'Somebody penciled a soft circle on the kitchen calendar: a tide, sometime soon.' : '';
  if (daysToPeak === 1) return 'Tomorrow is circled in red on the kitchen calendar.';
  if (daysToPeak === 2) return 'Two days to the red circle on the kitchen calendar.';
  return '';
}
