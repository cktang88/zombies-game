// The Turned. Folk names from the people of Vessey.
export interface ZombieDef {
  id: string;
  name: string;
  sprites: string[];
  hp: number;
  speed: number; // px/s
  dps: number; // damage per second to barricade
  cost: number; // threat points
  minDay: number;
  head: number; // fraction of height that is the head hitbox
  width: number; // hitbox width px (display scale)
  height: number; // display height
  armor?: number; // flat damage reduction on body hits
  lore: string;
  burst?: boolean; // bursts on death (pulper)
  scream?: boolean; // summons others
  lunge?: boolean; // sprint bursts
  crawl?: boolean; // low crawler hitbox (Drags)
  special?: boolean; // never drawn by the random budget; only placed by a night special
  ranged?: boolean; // the living: stops short and shoots back
  tunnel?: boolean; // comes up behind the wall
  boss?: boolean; // knockback immune, big HP bar
  toll?: boolean; // the bell: periodically drives the others on
}

export const ZOMBIES: Record<string, ZombieDef> = {
  sleeper: {
    id: 'sleeper', name: 'Sleeper', sprites: ['z_shambler', 'z_shambler2', 'z_mill', 'z_hunter', 'z_manor', 'z_church'], hp: 70, speed: 32, dps: 6, cost: 1, minDay: 1,
    head: 0.17, width: 46, height: 120,
    lore: 'They stand for hours like they\'re waiting on a shift whistle. Don\'t wake a Sleeper.',
  },
  deer: {
    id: 'deer', name: 'Deer', sprites: ['z_runner', 'z_runner2'], hp: 45, speed: 95, dps: 5, cost: 1.6, minDay: 2,
    head: 0.17, width: 48, height: 118, lunge: true,
    lore: 'The young ones, the recent ones. They spook like deer, and they come back like deer.',
  },
  drag: {
    id: 'drag', name: 'Drag', sprites: ['z_crawler'], hp: 40, speed: 20, dps: 4, cost: 0.6, minDay: 2,
    head: 0.45, width: 90, height: 42, crawl: true,
    lore: 'What\'s left after the river or the train. Watch your ankles at the wall.',
  },
  pulper: {
    id: 'pulper', name: 'Pulper', sprites: ['z_bloater'], hp: 120, speed: 22, dps: 8, cost: 3, minDay: 4,
    head: 0.15, width: 66, height: 132, burst: true,
    lore: 'Waterlogged from the settling ponds. Shoot them far, or not at all.',
  },
  crier: {
    id: 'crier', name: 'Crier', sprites: ['z_shrieker'], hp: 60, speed: 30, dps: 3, cost: 4, minDay: 5,
    head: 0.17, width: 40, height: 124, scream: true,
    lore: 'It keens almost in words, and others come. It\'s calling them by name.',
  },
  deputy: {
    id: 'deputy', name: 'Deputy', sprites: ['z_riot'], hp: 120, speed: 28, dps: 7, cost: 3.5, minDay: 7,
    head: 0.16, width: 50, height: 122, armor: 16,
    lore: 'County issue armor, and nobody left to sign for it. Aim for the broken visor.',
  },
  ferryman: {
    id: 'ferryman', name: 'Ferryman', sprites: ['z_brute'], hp: 520, speed: 20, dps: 24, cost: 9, minDay: 9,
    head: 0.13, width: 92, height: 160, armor: 6,
    lore: 'The big ones from the docks and the kill floor. Slow. They do not stop.',
  },
  // ---- night specials: never in the random pool ----
  tunneler: {
    id: 'tunneler', name: 'Drag', sprites: ['z_crawler'], hp: 40, speed: 26, dps: 0, cost: 0.8, minDay: 999,
    head: 0.45, width: 90, height: 42, crawl: true, tunnel: true, special: true,
    lore: 'The storm drains run under Ferry Road to the river. Some of them came up the pipe.',
  },
  raider: {
    id: 'raider', name: 'County man', sprites: ['z_raider', 'z_raider2'], hp: 75, speed: 70, dps: 0, cost: 3, minDay: 999,
    head: 0.16, width: 46, height: 122, ranged: true, special: true,
    lore: 'Deputy jackets off the dead, and the habit of taking. The County wants what you have.',
  },
  bellwether: {
    id: 'bellwether', name: 'The Bellwether', sprites: ['z_bellwether'], hp: 1500, speed: 12, dps: 30, cost: 0, minDay: 999,
    head: 0.11, width: 84, height: 200, armor: 5, boss: true, toll: true, special: true,
    lore: 'Somebody rang the All Saints\' bell for forty minutes the night it began. Nobody would say who. Now you know.',
  },
};
