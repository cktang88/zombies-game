# 19. Simplify resources and ammunition

Brief: depth but not complexity; easy to learn, hard to master. Every store keeps a one-line identity,
one real decision, and a mastery layer that comes from how it interacts with the others. Counters that
force no choice are cut.

## Before and after

| Before (28 store keys) | After (8) | Why |
|---|---|---|
| Food, Liquor | **Food** | Liquor was food with a delay. The still now pours food straight into courage (a round from the still). |
| Timber, Scrap, Parts, Cloth | **Salvage** | Four piles meant four bottlenecks and dead surplus (cloth and scrap piled up while timber ran out). One pile makes the real choice visible. |
| Fuel | **Fuel** | Unchanged: heat, lights, powder, firebombs. |
| Medicine | **Medicine** | Unchanged. |
| FMJ, hollow-point, .22 | **Pistol rounds** | A load switch nobody used in the dark. |
| Buck, slug, flechette, dragon's breath, flare | **Shotgun shells** | The tube-of-mixed-shells mechanic is gone; the flare pistol fires two shells a shot. |
| Rifle FMJ, soft-point, AP, 5.56, .50 ball | **Rifle rounds** | 5.56 guns draw half a round a shot and keep their plate bonus in their own stats. |
| Broadheads, fire bolts | (none) | Bows are slow, quiet and free; arrows are pulled out of the dead at dawn. |
| Firebombs, pipe bombs, rockets, 40 mm HE / buck | **Explosives** | One count: thrown with [F], or fired from any launcher (a rocket takes two). |
| Scrap (as nails) | Salvage | Nail guns and the nail turret eat the salvage pile. |

Gone with them: the per-gun ammo dropdown, [T] ammo swap (night and runs), the slug-swap tube, the
"special rounds" table, eleven ammo recipes, the liquor and pipe-bomb recipes. Each gun keeps its feel
through its own numbers: damage, pellets, pierce, spread, armour penetration, perShot.

## The decision each one forces

- **Food**: eat it, or pour it. Three food is one round from the still: +mood for two days, anyone sulking
  comes back to work, a Drinker is settled for two dawns. Half rations stretch it.
- **Salvage**: patch the wall, make bullets, or build traps. Every builder draws on the same pile, so each
  morning asks which will hurt more tonight: a thin wall or a dry gun. Rare recipes are gated by machinery
  (workbench level, forge, still, generator), not by a rarer material.
- **Fuel**: warm, lit, or armed. The stove on frost nights, the floodlights, the powder in every batch of
  rounds, and firebombs all draw from it.
- **Medicine**: today's cut or tomorrow's bite.
- **Pistol rounds**: cheap and everywhere, weakest on the wall. The pool you can always keep full.
- **Shotgun shells**: the shove that clears the wall, a handful of shots at a time.
- **Rifle rounds**: through three in a line, but only made once the bench is raised; the MG nest and the
  automatic rifles drink them.
- **Explosives**: throw it now for fire on the road, or keep it for the launcher and the big one.
- **Bows**: never dry, but slow. The gun for whoever would otherwise have nothing.

## The mastery layer

- Spread the guns across pools. A house whose wall all draws on one pool goes silent when it empties;
  the dusk screen shows one chip per pool the wall draws on, the header one chip per pool in use.
- Salvage is the exchange rate between the wall, the rounds and the traps: a builder repairs 25 wall per
  salvage, a pistol batch costs 2. Thrifty builders, the forge's spikes and wire, and a turret that eats
  salvage all move that rate.
- Fuel couples the night to the day: lights and firebombs win nights, but the frost after day 20 wants it.
- The still converts: food → courage, food + salvage → fuel, fuel + salvage → explosives.
- Guns differ in what a round is worth: the .22 and 5.56 guns draw half a round; the flare pistol two
  shells; the rocket two explosives.

## Save migration (src/state.ts `migrateSave`)

Saves stay version 2 (version 1 still loads). On load every old store key folds into its new one
(`STORE_FOLD`): salvage = scrap + timber + cloth + 2 × parts; liquor → 1.5 food; FMJ/HP → pistol,
.22 → ½ pistol; slug/flechette/dragon/flare → shells; SP/AP/ball → rifle, 5.56 → ½ rifle; firebombs,
pipe bombs, 40 mm → explosives, a rocket → 2; broadheads → 0.4 salvage. Unknown keys are dropped and
every current key is set. `ammoType` comes off every gun. Queued recipes map to their replacement
(liquor → a round from the still; special loads → their pool's batch; pipe bombs → firebombs), and
recipes that no longer exist leave the queue. An open event card has its trade keys and cost/gain chips
folded too. Exported files (settings import) accept version 1 or 2.

## Numbers

See docs/balance.md §12: ammo reserve at day 10 back to 0.8 nights (0.7 before), 78% of late nights
end with under a night of ammo (82% before).
