# 08 — Traps: niches, deployment, and the battle contract

> Request: *"a wide variety of traps each with its own niche, craftable ahead of time and placeable."*
> Data: `src/data/traps.ts` (17 traps). Planner: `src/ui/deploy.ts`. Builds on research 05 §8 (pre-night deployment).

## 1. What other games teach

**Orcs Must Die!** is the reference for traps as the *primary* verb. Its tar pit does no damage at all; it only slows, and it exists to make every other trap better. Players lay floor traps in checkerboards because tar lingers for a few seconds after an orc steps off. The spring trap's job is to fling survivors back to the start of the gauntlet. The developers noticed that three floor traps (tar, brimstone, spikes) became everyone's default, and they designed modes and new traps to push against that [Steam/PlayStation Blog; TV Tropes]. **Lesson:** a trap with *no damage* is fine if it multiplies something else. Watch for dominant defaults and give each slot a reason to exist.

**They Are Billions.** Wooden stakes are cheap, slow, and chip damage, and many players call them the best trap in the game. Wire fences are judged "not worth it". Shocking towers eat 30 power but delete dozens of infected in one hit, and they want *open ground*, not chokepoints [gameplay.tips; gamepressure]. **Lesson:** cheap attrition earns its place through cost, not power. Power-hungry traps need an upkeep that is felt.

**7 Days to Die.** Electric fence posts lose one point of durability per zombie shocked, and blade traps draw power and wear out. A whole mod scene exists just to remove trap degradation [7daystodie.wiki.gg; Nexus]. **Lesson:** durability is a cost players resent when it is *bookkeeping*. Under our realism rule it must be visible ("thirty shocks and the charger trips"), cheap to restore (dawn retrieval), and never a repair screen.

**Days Gone.** Hordes are beaten by funnelling: an attractor beside a fuel barrel, then fire. Bear traps, proximity bombs and remote bombs are *installed* on a route beforehand [Bend Studio tips via research 05; samurai-gamers]. **Lesson:** the lure is the missing partner of every area weapon.

**Project Zomboid.** The noise maker is a thrown lure that runs for about 30 in-game minutes and covers a 17-tile radius. Upgrades add a timer, a motion sensor or a remote trigger. The community's favourite use is luring a horde through campfires, and the common complaint is that it is too quiet [pzwiki; Steam]. **Lesson:** a lure's *trigger* is a design axis (manual, proximity, timer), and its radius has to be generous enough to read.

**Kingdom (New Lands / Two Crowns)** [recall]. Builders lay wolf-jaw traps beyond the wall. Each one kills or injures one Greedling and is then spent, so it must be paid for and rebuilt. Traps hold the outer edge while the walls hold the core. **Lesson:** single-use traps belong *far out*, where they thin a wave before it arrives.

**Dead Rising 2** [recall + gamesradar/segmentnext]. Combo cards turn ordinary hardware into something more than the sum of its parts. **Lesson for the setting:** every trap here is *a thing from Vessey* (a Buick door, a Newhouse trap, a Legion-hall bottle sack), and its name says what it does.

### Design rules taken from this

1. **One niche per trap**, written as one line, and a **named counter** that some Turned exploits (PvZ's "each enemy breaks a default", research 05 §2).
2. **Multipliers beat damage.** Slows, holds, lures and light make the guns better. Damage traps should be cheap or single-use.
3. **Combos are named and shown.** The planner lists them ("Lure on the oil: pull them in, then light it.").
4. **Durability is visible and forgiving.** Spent traps never break your economy. Multi-use kits come back at dawn, and there are no repair screens.
5. **Placement is a decision in space.** Every trap has a min/max distance, a lane span and a layer. Oil, nails, pits and sludge sit on the *ground* layer and can lie under a lure.
6. **Noise is a cost.** Loud traps feed the existing straggler meter (28 noise = one straggler).

## 2. The niche matrix

Legend for "vs": **++** a hard counter, **+** good, **–** poor, **×** the Turned beats it. Buck = Leaper, Biler = Spitter (upcoming).

| Trap | Niche | Machine | Trigger | Span | Distance | Noise | Comes back | Sleeper | Deer | Drag | Pulper | Crier | Deputy | Ferryman | Buck | Biler |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Nail bomb | Burst AoE on a pack. Loud. | workbench | step | r130, all | 150–860 | 12 | if unspent | + | + | + | + | + | – | – | | |
| Bear trap | Holds one big target | forge | step | 1 lane | 40–700 | 1 | yes (3 uses) | | × | × | + | | + | ++ | ++ | |
| Roofing nails | Slows; cripples walkers into Drags | workbench | always | 140, 1 lane | 60–860 | 0 | 60% | + | + | × | | | × | × | + | |
| Tripwire flare | Lights the road, burns off fog | still | step | r300 light | 200–860 | 2 | if unspent | | | + | | + | + | | | + |
| Oil slick | Slows; ignitable fire band | still | always | 120, all | 120–860 | 0 | no | + | | + | × | + | | | | |
| Propane tank | Bomb *you* set off with a bullet | workbench | shot | r160, all | 180–860 | 14 | if unshot | + | | – | + | + | + | | | |
| Burning barrels | Persistent fire; closes a lane | still | timer 150 s | 60, 1 lane | 120–760 | 0 | 70% | + | + | – | | + | | × | | |
| Tin-can lure | Pulls a crowd on your key | workbench | manual L | r260 | 250–860 | 6 | yes (2 uses) | ++ | + | | + | + | | × | | |
| Radio lure | Long lure that drowns out a Crier | generator | manual L / auto on keen | r380 | 300–860 | 10 | 50% | + | + | | + | ++ | | × | | |
| Clothesline snare | Trips runners | workbench | always | 16, all | 80–860 | 0 | yes (6 trips) | × | ++ | × | | | | × | ++ | |
| Punji pit | Kills Drags and slow walkers until full | workbench | step | 70, 1 lane | 160–760 | 1 | 50% | + | × | ++ | + | | | × | × | |
| Electric fence | All-night stuns; needs fuel | generator | always | 24, all | 50–260 | 2 | yes (30 shocks) | + | + | | × | + | ++ | × | | |
| Car-door deadfall | One crushing hit at the wall | forge | manual G / auto on climb | wall | 0–40 | 4 | 80% | | | – | + | | + | + | ++ | × |
| Chain-link net | Holds a lane while you reload | forge | step | 30, 1 lane | 100–600 | 1 | 50% | + | + | | + | + | | × | × | |
| Pond-sludge decoy | The Quiet's jar: they lose interest | still (*quietJar*) | always 40 s | 160, all | 80–860 | 0 | no | + | + | | | ++ | | × | | + |
| Pipe mine | Directional nail cone | workbench L2 | manual G / auto at 3+ in cone | cone 30°×240 | 30–220 | 12 | if unfired | + | + | × | + | + | | – | | |
| Glass-shard strip | Cheap, quiet attrition; wears out | workbench | always | 100, 1 lane | 60–860 | 0 | no | + | | ++ | | | × | × | | |

**Coverage check.** Every Turned has at least two good answers and one trap it beats. Ferryman: bear trap, deadfall. Buck: bear trap, snare, deadfall. Drag: pit, glass. Crier: radio, sludge. Deputy: electric fence, propane. Pulper: anything that kills it *far out* (lure, propane), and it **shorts** the fence and **wets** the oil. Biler (ranged spitter) is mostly a *light/position* problem: flare and sludge.

**Placements per night:** `2 + floor(best Building skill / 3)` (`placementsAllowed()`), so the builder matters in combat (research 05 §8).

## 3. Placement contract

```ts
// src/data/traps.ts
interface Placement { trap: string; x: number; lane: number }
```
* `x` is the **battle's screen x** (the same space as `WALL_X = 372`, `trapX = 720`). Distance out = `x − WALL_X`.
* `lane`: 0 = far (top) … 3 = near (bottom), matching research 04's 4 lanes. For `area.allLanes` traps the lane is where it was dropped; the battle **ignores it** for effects (it may use it for the draw y).
* Validated by `placementProblem(p, others, wallX, roadMaxX)`: min/max distance, road end, and no overlap on the same **layer** (`ground` | `object` | `wall`) in the same lane (all-lane traps clash with everything on their layer).

**Flow (main.ts / day UI must wire this):**
1. Load: `G.trapStock = migrateTrapStock(G.trapStock, G.fort.traps); G.fort.traps = 0;` (once). Hide the legacy `trap` recipe from the craft list (`trap_nailbomb` replaces it).
2. Dusk (before `new Battle`): `renderDeploy(root, { stock: G.trapStock ?? {}, laneCount: 4, roadMinX: 372, roadMaxX: 1240, wallX: 372, placementsAllowed: placementsAllowed(bestBuilding), initial: lastNightPlanStillInStock, onDone })`.
3. `onDone(ps)`: `G.deploy = ps; G.trapStock = spendStock(G.trapStock ?? {}, ps);` and pay `upkeep` (electric fence: 1 fuel each; if short, drop that placement). Then start the night.
4. Dawn: the battle reports which placements were **used up** (by index). `add` the result of `dawnRetrieve(G.deploy, spent, () => R.next())` back into `G.trapStock`, log it ("Ray took up the bear trap; the nails were trodden flat"), and set `G.deploy = []`.

## 4. Battle integration spec (for `src/night/battle.ts`)

Build `this.traps: TrapRT[]` from `G.deploy` in the constructor: `{ def, x, lane, y: laneY(lane), uses: def.uses, armed: true, t: 0, held: [] }`. Replace the single `trapX` check. Draw these after the road and wire, before the corpses. Each frame, for each Turned in `walk` state, check every armed trap whose band contains `z.x` (and whose lane matches unless `allLanes`).

| Trap | Runtime | Render | SFX |
|---|---|---|---|
| Nail bomb | On step: `explode(x, 130, 160)`. Each Turned hit rolls `cripple` 0.5 → crawler. Lights oil within reach. | Existing dark box + red pip | `boom` |
| Bear trap | On step: the first non-crawler gets `hold = 6 s` (Ferryman/boss 4 s), 45 dmg, cripple 0.6. `uses−−`. Re-arms 3 s after release. | `trap_bear` sprite; snaps shut (scaleY) while holding | `click` on arm, `thud` on bite |
| Roofing nails | Band: speed ×0.7; 8 dmg once per Turned; 0.18 cripple roll per Turned. Armoured and boss Turned and crawlers are immune. A step costs 1 use. | Procedural: grey glints scattered in the band | none (`hit` on cripple) |
| Tripwire flare | On step: a light hole r300 for 30 s; clears fog inside; `burn 1` on the stepper. | Red flare sprite: `lights.push({ r: 300, color: '255,90,70' })` plus spark particles | `fire` |
| Oil slick | Band: speed ×0.75. **Ignites** when a firebomb, dragon's breath, fire bolt, flare round, nail bomb, propane or pipe mine lands in it, or a barrel is within 90 px: becomes a fire band (`fires.push({ x, w: 120, life: 12 })`) at 22 DPS with burn. A Pulper burst on it removes it. | A dark glossy ellipse per lane band (procedural) with a moon-sheen highlight | `fire` on ignition |
| Propane tank | Hit-testable object (a 26×40 box). A ray from the player (or a guard on a FIRE order) that hits it → `explode(x, 160, 220)`, burn 3, ignites oil. Ferrymen in contact shove it +80 px. | `trap_propane` sprite, white rim-lit so it reads in the dark; a hiss particle once it is hit by a pellet but not detonated (2 pellets = boom) | `boom` |
| Burning barrels | Lit at night start, burns 150 s: a light source r220. A Turned whose lane band is entered **re-lanes** to the nearest free lane (y lerp over 0.6 s). If it cannot, it walks through at 18 DPS with burn. A Ferryman knocks it over (it ends, and leaves a 6 s fire band). | `trap_barrel` sprite plus the existing fire particles and smoke | `fire` loop every 3 s |
| Tin-can lure | Key **L** (or auto when a Turned is within 120 px): for 8 s every Turned within r260 targets `x` (speed toward it, then 0 when within 20 px). Bosses, ranged men and Ferrymen ignore it. Noise +6. 2 uses. | Post with cans; ring pulses while active | `click` ×3 rapid (tin), `ui` |
| Radio lure | Key **L**, or auto on the first Crier wind-up: 20 s, r380. While it plays, **a Crier's summons spawn at the radio's x and mill there**, and Criers inside it keen at half rate. When it ends, or a Turned reaches it, it is destroyed (50% retrieve). Noise +10. | Boombox sprite (icon scaled); musical note particles | `ui` bleeps; a low music duck |
| Snare | Band 16 px: any Turned with `lunge` (Deer), a Buck, or a running raider gets knocked down for 2.5 s (prone sprite rotated 90°, fully crawler-hittable). Others are slowed ×0.85. Ferryman: the snare breaks. 6 trips. | Two posts and a thin line (procedural) | `thud` |
| Punji pit | Band 70 px in one lane: a crawler or walker entering it takes 140 dmg and is held for 3 s (it falls in). After 4 bodies the pit is **full**: they walk over. Deer/Buck jump it; a Ferryman climbs out after 1 s. | `trap_pit` sprite; bodies drawn inside, darker as it fills | `thud`, `scream` (rare) |
| Electric fence | Band 24 px across the road: a contact shocks for 28 dmg and a 0.6 s stun every 1 s per Turned. Deputies ×2 (the plate conducts). Ferryman: damage only. A Pulper burst within 60 px **shorts** it for 15 s. 30 shocks. Needs the generator. | Fence posts with a blue arc flash on a shock; a small light pulse | `click` + `burst` (short) |
| Car-door deadfall | Key **G** (or auto when a Turned starts to climb or a Buck lands on the wall): 260 dmg to the nearest Turned at the wall in its lane, knockdown 2 s, staggers a Ferryman. Single use. | Door hanging over the wall top; drops (tween) | `thud` + `wallHit` |
| Chain-link net | On first contact: every Turned in the lane stops behind it until it tears. HP 240, torn by the sum of their wall DPS. Max 6 s. Bucks jump it. The heap is a natural target for a nail bomb or propane. | `trap_net` sprite, bulging (skew) with load | `wallHit` on strain |
| Pond-sludge decoy | Band 160 px, 40 s from the first contact: the Turned inside move ×0.35, cannot keen or attack the wall, and guards deprioritise them. The Bellwether's toll overrides it, and the living ignore it. | A dark ochre smear; Turned inside tilt their heads (sprite bob) | none: silence is the feedback |
| Pipe mine | Key **G** (or auto at 3+ Turned in the cone): a cone of 30° half-angle and 240 px reach toward +x. 150 dmg (falls off with distance), cripple 0.4, knock 60. Crawlers below the cone take ×0.3. Lights oil in the cone. | Small plate on wire legs; on firing, a cone of spark particles | `boom` |
| Glass-shard strip | Band: 6 dmg per crossing (×3 to crawlers), speed ×0.9; armoured and boss Turned are immune. 25 steps. | Procedural glints (green/brown) | none |

**Interactions, in priority order.** (1) Fire sources ignite oil: firebomb, dragon's breath, fire bolt, flare round, nail bomb, propane, pipe mine, a toppled barrel. A Pulper burst only *extinguishes*. (2) A lure that is active overrides normal targeting, but not the Crier priority of guards. (3) Holds (bear trap, net, pit) put a Turned into a `held` state with a timer; knockback does not move held Turned. (4) Propane is an `Obstacle` in the hit-scan, tested *before* the Turned so it can be shot through a crowd. Pellets roll 50% each. (5) Noise from traps goes through the existing noise meter.

**Credit (sim tie).** A trap kill is credited to whoever crafted the kit if known (store `by` in a later extension), otherwise to the leader. Tale at 6+ kills from one trap: "Ray's bear trap held a Ferryman for the line, night 12."

**At dawn**, the battle returns `spent: number[]`: the indices whose `uses` reached 0 or that were destroyed (radio smashed, net torn, barrels burned out). Everything else counts as not spent, and `dawnRetrieve` applies the per-trap retrieval odds.

## References
- Orcs Must Die! 3 Scramble mode (dev note on default floor traps): https://blog.playstation.com/?p=351128 ; OMD traps wiki: https://orcsmustdie.fandom.com/wiki/Traps ; OMD2 tropes (spring trap): https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/OrcsMustDie2 ; Deathtrap tar discussion: https://steamcommunity.com/app/2273980/discussions/0/599643705297657139 ; PCGamesN OMD3: https://www.pcgamesn.com/orcs-must-die-3/gameplay-traps-war-machines
- They Are Billions defenses: https://gameplay.tips/guides/they-are-billions-building-and-upgrading-defenses.html ; https://gamepressure.com/they-are-billions/defending-the-colony/zdaaef
- 7 Days to Die electric fence: https://7daystodie.wiki.gg/wiki/Electric_Fence_Post ; trap power data: https://pindrop.gg/7-days-to-die/traps ; trap guide: https://www.corrosionhour.com/7-days-to-die-traps-guide/
- Project Zomboid noise maker: https://pzwiki.net/wiki/Noise_Maker ; player discussion: https://steamcommunity.com/app/108600/discussions/0/3803904556902778230
- Days Gone traps list: https://samurai-gamers.com/?p=141219 ; horde tactics: https://www.pushsquare.com/news/2020/11/pro_days_gone_player_is_beating_entire_hordes_without_firing_a_bullet ; research 05 (Bend Studio horde tips)
- Dead Rising 2 combo weapons: https://gamesradar.com/dead-rising-2-combo-card-weapon-guide
- Kingdom: recall (wolf-jaw traps, builders, outer defence).
