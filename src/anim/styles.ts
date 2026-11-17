// Per-archetype animation sets. Every Turned instance picks one gait variant and its own
// jitter from its seed, so a crowd of the same archetype never moves in lockstep.
// ids match src/data/zombies.ts (sleeper, deer, drag, pulper, crier, deputy, ferryman,
// tunneler, raider, bellwether) plus 'survivor'.
export interface Style {
  id: string;
  walks: string[]; // GAITS ids, one chosen per instance
  run?: string; // used above runAt speed (px/s at display scale 1)
  attacks: string[]; // CLIPS ids
  idles: string[]; // occasional idle behaviours
  deaths: string[]; // 'ragdoll' or authored CLIPS ids (which end in ragdoll)
  special?: string[]; // archetype tells (keen, retch, vault, toll, burstWindup, smash...)
  wall: string; // barricade attack
  climb?: string;
  mass: number; // ragdoll mass (impulse / mass), 1 = a person
  stiff: number; // active-ragdoll seconds: how long the body fights the fall
  friction: number; // ground friction for the ragdoll (0..1)
  scale?: number; // rig scale relative to the shared 240px rig
  legShotCrawl?: number; // chance a crippling leg hit drops it to a crawl
}

export const STYLES: Record<string, Style> = {
  survivor: { id: 'survivor', walks: ['walk'], run: 'run', attacks: ['chop', 'sweep'], idles: [], deaths: ['ragdoll'], wall: 'chop', mass: 1, stiff: 0.22, friction: 0.7 },
  sleeper: {
    id: 'sleeper', walks: ['limpDrag', 'stiffLurch', 'headLoll', 'dangle'], attacks: ['claw', 'grabBite'], idles: ['idleSniff', 'idleSway', 'idleTurn', 'twitch'],
    deaths: ['ragdoll', 'ragdoll', 'deathCollapse'], wall: 'pound', climb: 'climb', mass: 1, stiff: 0.2, friction: 0.75, legShotCrawl: 0.5,
  },
  deer: {
    id: 'deer', walks: ['sprint', 'sprintRagged', 'sprint'], attacks: ['lunge', 'claw'], idles: ['pantStop', 'idleSniff', 'idleTurn'],
    deaths: ['ragdoll'], special: ['pantStop', 'lunge'], wall: 'pound', climb: 'climb', mass: 0.8, stiff: 0.12, friction: 0.45, legShotCrawl: 0.3,
  },
  drag: { id: 'drag', walks: ['crawl', 'crawlOneArm', 'crawl'], attacks: ['grabBite'], idles: ['twitch'], deaths: ['ragdoll'], wall: 'pound', mass: 0.7, stiff: 0.05, friction: 0.95 },
  tunneler: { id: 'tunneler', walks: ['crawl', 'crawlOneArm'], attacks: ['grabBite'], idles: ['twitch'], deaths: ['ragdoll'], wall: 'pound', mass: 0.8, stiff: 0.05, friction: 0.95 },
  pulper: { id: 'pulper', walks: ['waddle', 'waddle', 'stiffLurch'], attacks: ['grabBite', 'claw'], idles: ['idleSway', 'retch'], deaths: ['burstWindup'], special: ['burstWindup', 'retch'], wall: 'pound', mass: 1.8, stiff: 0.3, friction: 0.85 },
  crier: { id: 'crier', walks: ['stalk', 'headLoll'], attacks: ['claw'], idles: ['keen', 'idleTurn', 'idleSniff'], deaths: ['deathChoke', 'ragdoll'], special: ['keen'], wall: 'pound', mass: 0.85, stiff: 0.15, friction: 0.7 },
  deputy: { id: 'deputy', walks: ['trudge', 'stiffLurch', 'trudge'], attacks: ['claw', 'grabBite'], idles: ['idleSway', 'twitch'], deaths: ['ragdoll', 'deathCollapse'], wall: 'pound', climb: 'climb', mass: 1.35, stiff: 0.25, friction: 0.8 },
  ferryman: {
    id: 'ferryman', walks: ['stomp', 'stomp'], attacks: ['smash', 'grabDrag'], idles: ['idleSway', 'idleTurn'], deaths: ['deathCollapse', 'ragdoll'],
    special: ['smash', 'grabDrag'], wall: 'smash', mass: 3.2, stiff: 0.5, friction: 0.9, scale: 1.25,
  },
  raider: { id: 'raider', walks: ['raider'], run: 'run', attacks: ['chop'], idles: ['idleTurn'], deaths: ['ragdoll'], wall: 'chop', mass: 1, stiff: 0.22, friction: 0.7 },
  bellwether: { id: 'bellwether', walks: ['stomp'], attacks: ['toll', 'smash'], idles: ['toll'], deaths: ['deathCollapse'], special: ['toll'], wall: 'smash', mass: 6, stiff: 0.8, friction: 0.95, scale: 1.6 },
  // planned archetypes from the design doc (no zombies.ts entry yet)
  leaper: { id: 'leaper', walks: ['stalk', 'sprintRagged'], attacks: ['vault', 'claw'], idles: ['idleSniff'], deaths: ['ragdoll'], special: ['vault'], wall: 'vault', mass: 0.9, stiff: 0.12, friction: 0.5 },
  spitter: { id: 'spitter', walks: ['headLoll', 'waddle'], attacks: ['retch'], idles: ['retch', 'idleSway'], deaths: ['ragdoll'], special: ['retch'], wall: 'pound', mass: 1.1, stiff: 0.2, friction: 0.8 },
};

