# 19c. Simplify items: hand weapons, attachments, trap kits

Brief: depth but not complexity; easy to learn, hard to master. Each item keeps a one-line identity and
one real decision; mastery comes from how items interact (with each other, with the Turned, with the
stores), not from a long list. Follows 19 (resources) and 19b (survivors).

## Before and after

| | Before | After |
|---|---|---|
| Hand weapons | 13 (hatchet, felling axe, crowbar, bat, machete, fire axe, sledge, boat hook, knife, chainsaw, rebar spear, nail bat, saw-blade machete) | **5**: knife, hatchet, bat, crowbar, fire axe |
| Attachments | 14 in 6 slots (scope, red dot, suppressor, brake, choke, sawed-off, flashlight, hatchet bayonet, bipod, extended mag, drum, taped mags, speedloader, sling) | **6** in 5 slots: scope, red dot, suppressor, flashlight, extended mag, sling |
| Trap kits | 17 (nail bomb, bear trap, roofing nails, tripwire flare, oil, propane, barrels, tin cans, radio, snare, punji pit, electric fence, deadfall, net, sludge, pipe mine, glass) | **6**: snare wire, nail strip, bear trap, oil slick, tin-can lure, nail bomb |
| Melee recipes | spear, nail bat, saw-blade machete, hatchet (forge 2) | bat (workbench, 4 salvage), hatchet (forge, 6 salvage) |
| Attachment recipes | 11 | 4: suppressor, flashlight, sling, extended mag (bench 2). Optics are found or traded, never made. |
| Trap recipes | 17, across workbench, forge, still, generator | 6: workbench (snare, nails, lure, bomb), forge (bear trap), still (oil). Salvage and fuel only. |
| Night keys | [L] lure (cans / radio), [G] deadfall or pipe mine, shoot the propane | [L] pull the lure, [G] light the oil, shoot the nail bomb |

## Hand weapons: speed vs damage vs shove vs wear vs noise

| | Identity | The decision | Folded in |
|---|---|---|---|
| **Knife** | Fast and silent: sleeping, downed or crawling ones die without a sound. | Quiet and quick, but weak with no shove: a crowd at the wall walks through it. Take it on runs. | — |
| **Hatchet** | The all-rounder: quick chops that leave them bleeding, and it splits a door on a run (pry ×1.4). | Good at everything, best at nothing, and it dulls fastest (the bench sharpens it). | machete, saw-blade machete |
| **Bat** | Shove and stagger: knocks them off the wall and buys room more than it kills. | Holds a lane while others reload, but kills slowly. | nail bat, boat hook |
| **Crowbar** | Never breaks, and pries doors, cars and caches open twice as fast. | No bench time ever and the fastest runs, but it hits one at a time. | rebar spear |
| **Fire axe** | A slow, heavy cleave through three at once. | Kills packs at the wall, but winds up, tires the swinger, and the road hears it. | felling axe, sledge, chainsaw |

Numbers (`src/data/weapons.ts` MELEE): dmg 18 / 34 / 26 / 28 / 66; swings a second 3.3 / 2.4 / 1.8 / 1.7 / 1.1;
shove 2 / 10 / 55 / 30 / 45; wear 0.003 / 0.004 / 0.002 / 0.0008 / 0.002; noise 0 / 0.15 / 0.3 / 0.25 / 0.35.
The chainsaw's fuel-per-swing support stays in meleeProfile (`fuel`) but no weapon uses it.

Mastery: the knife on the leader's run and the crowbar on whoever opens the caches; the bat on the guard
beside the loophole; the fire axe on the strongest back (stamina). Hand weapons are also what a guard
falls back on when a pool runs dry, so the pool plan (19) decides who needs the good one.

## Attachments: one job each, one per slot

| | Slot | Identity | The decision | Folded in |
|---|---|---|---|---|
| **Scope** | optic | Long-range aim: pinpoint at the back of the road. | Slow onto a new target; and it takes the optic slot from a red dot. | — |
| **Red dot** | optic | Fast aim: snaps onto the next one, and tightens a shotgun's cone (×0.75). | Not as tight as a scope. | full choke, sawed-off |
| **Suppressor** | muzzle | Less noise: a shot becomes a cough, so fewer stragglers come. | A little weaker, and it burns out (240 rounds). | — |
| **Flashlight** | under | See in the dark: a cone of light down the barrel, for the whole wall. | Only down that barrel. | hatchet bayonet |
| **Extended mag** | mag | Capacity: half again as many rounds. | A slower reload. | drum, taped mags, speedloader |
| **Sling** | stock | Carry: quicker swaps (−0.1 s) and steadier strings (kick ×0.75, bloom ×0.8). | Long guns, the SMG and the crossbow only. | muzzle brake, bipod |

The barrel slot is gone. The two optics share a slot, which is the one real fork: a rifle is either the
long gun or the fast one. Profile fields nothing sets any more (melee, braceBloomMul, range) stay at their
neutral values in FireProfile.

## Trap kits: trip, cut, hold, burn, pull, blow

| | Identity | The decision / the counter | Folded in |
|---|---|---|---|
| **Snare wire** | Trips the fast ones (Deer, Bucks go down 2.5 s); everything wades through it at ×0.6. | Eight trips; a Ferryman snaps it, Drags go under. | net |
| **Nail strip** | Hurts every one that crosses (10, ×3 for a crawler) and cripples legs. | Boots ignore it (Deputies, Ferrymen); thirty footfalls press it flat. | glass strip, punji pit |
| **Bear trap** | Holds one big target 6 s (a Ferryman 4 s), re-sets three times. | One jaw, one leg: useless against a crowd of Drags. | deadfall, electric fence |
| **Oil slick** | Slows a band of road; [G] lights it (15 s of fire and light), or it goes up on its own when four stand in it. | When to strike the match; a bursting Pulper wets it. | burning barrels, tripwire flare |
| **Tin-can lure** | [L] pulls a crowd to the post for 10 s; a Crier inside it keens half as often and its summons walk to the cans. | Ten seconds, then they remember you; Ferrymen ignore it. | radio lure, sludge decoy |
| **Nail bomb** | A burst on a pack: the first one through sets it off, or shoot it when they bunch. | A lone Deer spends it; pair it with the lure. | propane tank, pipe mine |

The pairs the dusk planner names (`combos()` in `src/data/traps.ts`): lure on the oil; lure beside the bomb;
the bomb lights the oil; snare in front of the nails (tripped Deer crawl over them); snare beside the oil
(held in the fire); bear trap under the bomb. The planner's "good vs tonight's" marks are unchanged: each
kit's `good` / `bad` lists, matched against the radio forecast.

Night balance with one of each kit on the road (`TRAPS=1 node tools/e2e/night-balance.cjs 3,13,23 1 decent`
against no traps, same seed): day 13 wall loss 375 → 292, day 23 the wall held 217 s instead of 189 s
before it fell. The nail bomb and the bear trap take the direct kills; oil kills burn and are not credited
to the kit.

## Save migration (`src/state.ts` migrateSave)

Still save version 2; every step is idempotent, so a save from any point loads clean.

- Hand weapons: `MELEE_FOLD` (machete, saw-blade → hatchet; nail bat, boat hook → bat; spear → crowbar;
  felling axe, sledge, chainsaw → fire axe). Each item keeps its uid, condition and kills, so whoever carried
  it still does. Unknown ids are dropped and their carriers go empty-handed.
- Attachments: `MOD_FOLD` (choke, sawed-off → red dot; brake, bipod → sling; drum, taped, speedloader →
  extended mag; hatchet bayonet → flashlight). Spares are renamed. A fitted one is re-seated by its new slot;
  if it no longer fits the gun, or its slot is taken (two folded into the same slot), it goes back on the bench.
  An open trader card offering an old attachment offers its replacement.
- Trap kits: `TRAP_FOLD` (glass, punji pit → nail strip; net, deadfall, electric → bear trap; barrels, flare →
  oil; radio, sludge → lure; propane, pipe mine → nail bomb). Stocks are summed; tonight's plan (`G.deploy`)
  and last night's (`flags.lastPlan`) keep their spots with the new kit.
- Craft queue: `m_nailbat → m_bat`, `m_spear / m_sawblade → m_hatchet`, mod recipes to the nearest kept one,
  `trap_<old> → trap_<new>`. Nothing queued is lost.

## Left as is

- Art: the folded items' sprites (icons, rig anchors in `src/anim/weaponAnchors.ts`, trap world sprites)
  stay in `public/sprites` and the generators; nothing loads them now.
- `TrapDef` keeps `area.cone`, `requires` and `upkeep` (the planner and dusk still honour them); no kit uses them.
- docs/research/08-traps.md describes the seventeen-kit design as it was.
