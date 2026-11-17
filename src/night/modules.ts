// The night modules, wired into a Battle as hooks (night/hook.ts): traps from G.deploy,
// melee at the wall, crewed emplacements, the sally over the wall. Order matters only in that traps run first, so the
// holds and slows they apply are in place before melee and the guns look at the road.
import type { Battle } from './battle';
import type { BattleHook } from './hook';
import { Traps } from './traps';
import { Melee } from './melee';
import { Emplacements } from './emplacements';
import { Sally } from './sally';

export function installModules(b: Battle): BattleHook[] {
  const traps = new Traps(b);
  const melee = new Melee(b, traps);
  const emp = new Emplacements(b, traps);
  // the sally first among the keys: [V] on the road is its swing, not the wall's
  const sally = new Sally(b, traps);
  return [traps, sally, melee, emp];
}
