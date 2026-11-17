// The night modules, wired into a Battle as hooks (night/hook.ts): traps from G.deploy,
// melee at the wall, crewed emplacements. Order matters only in that traps run first, so the
// holds and slows they apply are in place before melee and the guns look at the road.
import type { Battle } from './battle';
import type { BattleHook } from './hook';
import { Traps } from './traps';
import { Melee } from './melee';
import { Emplacements } from './emplacements';

export function installModules(b: Battle): BattleHook[] {
  const traps = new Traps(b);
  const melee = new Melee(b, traps);
  const emp = new Emplacements(b, traps);
  return [traps, melee, emp];
}
