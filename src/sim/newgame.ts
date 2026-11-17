import type { GameState } from '../types';
import { setState, G, R, log, newWeapon } from '../state';
import { makeSurvivor, rel, setBond, living } from './survivors';
import { nextWeather } from './day';

export function newGame(mode = 'siege', seed = (Math.random() * 2 ** 31) >>> 0): GameState {
  const s: GameState = {
    version: 1,
    seed,
    day: 1,
    phase: 'day',
    stores: { food: 18, scrap: 12, wood: 25, parts: 3, meds: 2, fuel: 4, cloth: 4, light: 130, shell: 16, rifle: 10, liquor: 1, molotov: 0 },
    survivors: [],
    graves: [],
    weapons: [],
    buildings: [{ id: 'workbench', level: 1 }],
    fort: { hp: 300, maxHp: 300, level: 0, spikes: 0, wire: 0, lights: 0, traps: 0 },
    craftQueue: [],
    chronicle: [],
    director: { tension: 0, lastBigDay: 0, wealth: 0, mode, cooldowns: {} },
    pendingEvent: null,
    flags: {},
    stats: { kills: 0, shots: 0, hits: 0, headshots: 0 },
    nextNight: null,
    weather: 'clear',
    uid: 0,
  };
  setState(s);
  const leader = makeSurvivor({ isLeader: true });
  leader.skills.shooting = Math.max(leader.skills.shooting, 4);
  G.survivors.push(leader);
  for (let i = 0; i < 2; i++) G.survivors.push(makeSurvivor());
  const [a, b, c] = G.survivors;
  for (const x of living()) for (const y of living()) if (x !== y) rel(x, y);
  // a pre-existing bond gives the start some weight
  if (R.chance(0.5) && a.sex !== b.sex && Math.abs(a.age - b.age) < 14) {
    setBond(a, b, 'spouse');
    rel(a, b).opinion = 60; rel(b, a).opinion = 55;
    b.name = `${b.name.split(' ')[0]} ${a.name.split(' ').slice(1).join(' ')}`;
  } else {
    setBond(a, c, 'friend');
    rel(a, c).opinion = 40; rel(c, a).opinion = 35;
  }
  const w1 = newWeapon('service9', 0.9);
  const w2 = newWeapon('revolver', 0.7);
  const w3 = newWeapon('pump', 0.8);
  a.weapon = w1.uid; b.weapon = w2.uid; c.weapon = w3.uid;
  a.job = 'repair'; b.job = 'scavenge'; c.job = 'farm';
  nextWeather();
  G.weather = 'clear';
  log('lore', 'November 6th. The cell towers have been dark for four days. The radio loops the same message. We took the old Haugen place on Ferry Road: brick, one door, a long view down the road to the river. We started a wall.');
  return G;
}
