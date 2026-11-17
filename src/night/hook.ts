// The battle's module contract. Night modules (traps.ts, melee.ts, emplacements.ts) plug into
// Battle through these callbacks instead of growing battle.ts. All optional.
//
// This is the single hook interface (battle.ts imports it). Zombie states the modules can rely on:
// 'climb' (coming up the corpse pile at the wall) and 'leap' (a Buck, def id 'leaper', in the air).
// Battle helpers for modules: laneY(i), LANES, wallX(), nearestLane(), damage(z, dmg, head, knock, g,
// pellet, px, py, isPlayer, fx?, zone?, weak?), kill(), stagger(z, s), cripple(z, isPlayer), piles[lane].
import type { Battle, NightResult } from './battle';

export type Zed = Battle['zombies'][number];
export type Guardian = Battle['guards'][number];

/** One drawable at a y-sort key among the actors (feet y; the wall is 700). */
export interface SortedDraw { y: number; f: () => void }

export interface BattleHook {
  /** every simulation step, after the Turned have moved */
  update?(dt: number): void;
  /** flat things on the road, before the darkness pass and the actors */
  drawGround?(c: CanvasRenderingContext2D): void;
  /** standing things (barrels, nets, gun nests) sorted in among the actors */
  sorted?(c: CanvasRenderingContext2D): SortedDraw[];
  /** over everything, after the HUD (prompts, stamina, heat bars) */
  drawOver?(c: CanvasRenderingContext2D): void;
  /** a key; return true to swallow it */
  onKey?(e: KeyboardEvent): boolean | void;
  /** a projectile leaving a muzzle; return true if this module consumed it (a propane tank was hit) */
  onShot?(g: Guardian | null, ox: number, oy: number, ang: number, laneY: number, pellet: boolean, isPlayer: boolean): boolean;
  /** a body just died (state is already 'dying') */
  onKill?(z: Zed, g: Guardian | null): void;
  /** the night is over; write into the result */
  onEnd?(r: NightResult): void;
  /** true while the leader's mouse drives something else (a gun nest), so their own gun stays quiet */
  blockFire?(): boolean;
}
