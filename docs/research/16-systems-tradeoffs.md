# 16 · Every system's tradeoff

Player feedback: *"im not rly sure what the tradeoffs of each game system is tbh its all confusing make it really obvious."*

Answer: a **How it works** page, now the first tab of the help ledger (`?` on the day screen, the pause menu, the title). It shows a picture card per system; a card opens a two-column ledger (**You spend → You get**), **the catch** in one stamped sentence, **use it when**, and one thing to remember. A second view, **Trade-offs at a glance**, puts the big choices side by side. Hovering the Workshop / Wall / Armory / Town tabs or a survivor's job picker shows the same spend → get strip and tradeoff.

Data: `src/data/systems.ts` (built lazily; numbers read from `RECIPES`, `BUILDINGS`, `SITE_TRAVEL`, `DRILL_ROUNDS`, `DAY_HOURS`, `SALLY`, `AMMO_TYPES`, `EMPLACEMENTS`, `TRAPS`, `placementsAllowed`). UI: `src/ui/guide.ts`, `src/ui/guide.css`.

## The table (derived from code, per 8-hour worker-day unless noted)

| System | You spend | You get | The catch |
|---|---|---|---|
| Repair the wall | 8h, 1 timber per 25 wall, tiredness | +40 … +130 wall (40 + 9 × Building) | A whole worker-day and timber, but every point holds them back. |
| Scavenge | 8h, of which 1–6h walking; bite/wound chance (site risk) | Site loot table × skill × stock left; rare gun/mod/papers | Loot without playing, but walking eats hours and bites happen. |
| Workshop (job) | 8h, the queued recipes' stores | 3 … 12 work points (3 + 0.9 × Crafting) | Turns stores into ammo and traps, but only if something is queued. |
| Food | 8h | 1.5 … 6 food (+2.2 per cold-frame level), ×0.6 in frost | Safe, steady food, but small, and ×0.6 in frost. |
| Tend wounded | 8h, 1 meds per bad wound | 2 … 12 wounds tended; tended heal 0.14/day vs 0.05 | Stops wounds turning to fever, but wasted on a healthy house. |
| Drill | 8h, 10 rounds of the carried gun's ammo | Shooting XP ×2 live (×1 dry); lookout intel at Shooting 3+ | Burns 10 rounds today for a better shot every night after. |
| Counsel | 8h | 1 person per 4h; their dawn break chance ×0.35 | Produces nothing you can hold, but the frayed do not break. |
| Work the radio | 8h; the mast once (6 parts, 8 scrap, 4 timber) | Intel tier on tonight (counts, timing; with a lookout, more) | A worker sits at a dial, but you know what comes tonight. |
| Rest | 10h of output | +0.4 rest, +3 mood for a day | You lose a worker for a day so they do not break. |
| Work hours | tiredness per hour; "worked to the bone" when ragged | Yield scales with hours; grit XP past 8h | Long days yield more, but tired people break and work worse. |
| Lead a run | The leader's day (or leave at 09/11/13), rounds fired, the leader's life | You choose the loot: parts, guns, mods, papers, survivors | The best loot, but you play it and the leader can die. |
| Food & heat | 1 food per person per day; ⌈n/3⌉ fuel on frost nights | No hunger, no freezing | Every new face is a gun on the wall and a mouth to feed. |
| Chores | Oil: 1h + rag or 1 fuel. Bodies: haul 3h (mood) or burn 1h + 2 fuel | Cold jams ÷1.7; no ramp at the wall | A few hours off someone's job to save a bad night. |
| Reinforce | 20 scrap, 20 timber, 10 work (forge) | +60 max wall for good | Costly once, then every repair day fills a deeper wall. |
| Spike rows | 8 timber, 4 scrap, 4 work | 3.5 dmg/s per row to each body at the wall | Cheap and permanent, but only works once they reach the wall. |
| Wire belts | 8 scrap, 3 work | ×0.55 speed in a 90 px band (up to 3) | More time to shoot them, but nothing dies to it alone. |
| Floodlights | 3 parts, 3 scrap, 3 work; 0.5 fuel/night each | +0.07 guard aim, +130 px sight each (max 3) | Guards see farther and aim better, but they drink fuel nightly. |
| Nail turret | 10 parts, 20 scrap, 2 fuel, 14 work; 0.05 scrap/nail | 3.3 shots/s, no crew (needs generator) | Fires with nobody on it, but eats scrap all night. |
| Traps | Stores + 1–6 work per kit | Damage, holds, slows on the road; 2 + Building/3 placements | They work while you shoot, but each kit is bench time. |
| Gun nests (MG) | 16 scrap, 6 timber, 8 parts, 4 cloth, 10 work; 12 rounds/s of 5.56 | 38 dmg/round belt-fed; trained crews overheat less | Huge fire from one post, but eats ammo and wants a trained crew. |
| Roof nest | 10 timber, 4 scrap, 2 cloth, 5 work | +260 px sight for one guard | One guard sees far and safe, but is not at the wall. |
| Armory / ammo types / mods | Parts and bench work; condition | The right round or attachment for the enemy | Special rounds solve one enemy but cost parts and bench time; every mod helps one stat and usually costs another. |
| Skills & perks | Days on one job | Perks at 4 and 7; passion ×1.5 XP | Specialists get perks; swapping jobs keeps everyone middling. |
| The town | Event choices | Rep ≥ 40: deals, help. ≤ −40: they come for you | Pleasing one faction often angers another. |
| Nerve & focus | 20 nerve/s (needs 10+) | Time ×0.6, spread ×0.4 | Perfect shots for a few seconds, but empty nerve shakes the line. |
| Rally [E] | A rally banked by five headshots in a row | +20 nerve, +0.25 guard aim for 4 s + 0.4 × Social; calms panic | Saves a breaking line, but you earn it with headshots. |
| Sally [O] | 12 nerve, 22 s cooldown, bites | 7 s out: re-sets bear traps/snares/deadfalls, 55 % of kills drop 2–6 rounds, landing shoves the pile | Re-arms traps and grabs rounds, but 7 s out there can mean a bite. |
| Firebombs [F] | 2 fuel, 1 cloth, 2 work → 3 bombs | 7 s of fire, 150 px wide | Burns a whole crowd, but fuel you also need for heat. |
| The dog | An event choice | Bark: guard aim +0.15 for 5 s; +4 mood for 30 days; bites climbers | Pure upside in code: say yes. |

### Ammo (craft batch → effect, from `AMMO_TYPES` and the recipes)

| Round | Batch cost | Effect vs the plain round |
|---|---|---|
| Buckshot | 2 scrap, 1 fuel, 1 cloth, 2 work → 16 | baseline, 9 pellets |
| Slugs | 4 scrap, 1 fuel, 1 cloth, 3 work (forge) → 10 | +1 pierce, +0.4 vs plate, ×1.6 shove |
| Flechettes | 4 scrap, 1 parts, 1 fuel, 3 work → 10 | ×0.7 dmg, +1 pierce, +0.9 vs plate, ×0.5 shove |
| Dragon's breath | 2 fuel, 2 scrap, 1 cloth, 3 work (still) → 8 | ×0.55 dmg, ×0.6 shove, sets them burning |
| Pistol FMJ | 2 scrap, 1 fuel, 2 work → 40 | baseline |
| Hollow-points | 24 pistol FMJ, 1 parts, 2 work → 24 | ×1.3 dmg, −1 pierce, −0.6 vs plate, ×1.15 shove |
| Rifle FMJ | 3 scrap, 1 fuel, 1 parts, 2 work → 15 | baseline |
| Soft-points | 4 scrap, 2 fuel, 1 parts, 4 work → 12 | ×1.3 dmg, 0 pierce, −0.3 vs plate, ×1.25 shove |
| AP | 6 scrap, 2 fuel, 2 parts, 5 work (forge) → 8 | +2 pierce, +0.9 vs plate |

## What could not be read from an exported constant

Mirrored as literals in `systems.ts` (marked "mirrors"); a balance pass that changes them must update both:
- Job yield coefficients (`repairAmount`, `craftPoints`, `farmAmount`, `careCount` in `sim/day.ts`): the UI's `jobOutlook` already duplicates them too.
- Night numbers inside `battle.ts`: focus drain 20/s and the 10-nerve floor, rally +20 nerve and 4 s, floodlight +0.07 aim / +130 px, spikes 3.5 dmg/s, wire ×0.55 over 90 px, firebomb 7 s × 150 px, dog bark +0.15 aim for 5 s, cold jams ×1.7 without oil.
- Counsel's ×0.35 dawn break chance (`sim/survivors.ts`).

Not verified / open questions:
- **Radio's own yield** (`G.flags.radioWork`) is accumulated but never read. What the Radio job actually buys is the dusk intel tier (`director.ts intelTier`) and the Guard thread's progress; the card says that.
- **The dog**: the event's choice hint says "Eats a little", but no code charges it food. The card calls it pure upside; either the hint or the code should change.
- "Leader can die" on a run: from `expedition.ts leaderDown` (a companion can drag them home); exact odds depend on play, so the card gives no number.
- Scavenge loot per day depends on the site table, skill and stock left, so the card shows icons, not a number.
