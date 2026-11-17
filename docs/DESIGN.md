# VESSEY: Before the Ice — Design Document

> A 2D side-view barricade shooter (in the lineage of *The Last Stand*) wrapped in a light RimWorld-style survivor sim and storyteller. Research lives in [`docs/research/`](research/):
> [01 Last Stand & genre](research/01-last-stand-and-genre.md) · [02 RimWorld & emergent story](research/02-rimworld-emergent-story.md) · [03 Art style & lore](research/03-art-style-and-lore.md)

## 1. Pitch

Vessey is a dying paper-mill town on the St. Aubin River in the American upper Midwest, November. The Guard has sealed the only bridge at Corliss. The river freezes on **Nov 28**, and when it does, the Turned on the east bank can walk across.

You hold a brick house on Ferry Road with whoever you can find. **By day** you run a small household: assign people to jobs, scavenge the town, build machinery, and craft ammunition, traps, armour and fortifications. **At night** you stand behind the wall and shoot.

The aim is not a perfect run. It is a run you remember: the nurse who took off a friend's arm on the kitchen table; the deputy who hid a bite for two days; the night Marla held the wall alone.

## 2. Pillars

1. **The shooting has to feel good.** Mouse aim, a crosshair circle that grows with your real spread, headshots ×3, reload tension, knockback, gore that reads as heavy rather than goofy. (Research 01, rules 1–7.)
2. **Every survivor is a person.** They have a name, an age, a life before, what they did when it began, traits, passions, a mood made of named reasons, wounds by body part, relationships, and tales. Test every feature with Sylvester's question: *does it change how I feel about a specific survivor?* (Research 02 §1.)
3. **Pressure plus systems makes stories.** The storyteller sets tension; the needs/mood/break systems make survivors fail in interesting, attributable ways; the chronicle remembers.
4. **Grief, not gore.** Every one of the Turned was somebody's coworker. Kin at kitchen tables. Burials. Mercy. (Research 03, tone pillars.)
5. **Cold is the clock.** The calendar runs toward the ice. Days get colder, fuel matters more, and the Crossing is coming.

### Realism rule: "real, not annoying"
Gun realism exists only where it creates a *decision* or a *feeling*, never a chore:
- **Smart defaults.** [R] does the right thing automatically: a tactical reload when a round is chambered, fullest magazine first, and a retention reload when nothing threatens the wall. Advanced players can choose deliberately: hold [R] for a speed reload, which drops the mag.
- **Malfunctions are rare and quick.** Most clear with a single tap-rack press, and they are telegraphed by cause (worn gun, cold, handloads). A double-feed is the rare punishing one. A jam never happens on the first shot of a night.
- **Guards self-manage.** Survivors handle their own reloads, jams and heat according to skill. The player gives orders, not maintenance.
- **Maintenance is one click.** "Oil all guns" is a single day task. No per-gun upkeep screens.
- **Feedback over bookkeeping.** Audio cues (last round, heat hiss, stovepipe clunk) carry information, so the HUD stays light.
- **Short effects.** Tinnitus muffles the sound for seconds, not minutes. Barrel heat recovers quickly once you stop firing.
- **One setting.** A Realism setting: *Standard* is the default; *Hardcore* hides exact ammo counts, makes double-feeds more common, and makes speed reloads lose the mag. Every realism mechanic is checked against "is this fun the 50th time?"

## 3. Core loop

```
 DAWN ─► morning report + incident (choice) ─► DAY: assign jobs / craft / build / equip
   ▲                                                    │
   │                                                    ▼
 night results, deaths, tales ◄─ NIGHT: defend the wall ◄─ DUSK: day work resolves, night planned
```

* **Day.** Each survivor gets one job: Repair, Scavenge (choose a site), Workshop, Food, Tend wounded, Radio, or Rest. This is the per-survivor token version of Last Stand's 12-hour split (research 01, rule 8).
* **Dusk.** Work resolves. Scavenging uses the site's loot table × survivor skill × how much stock the site has left, with a **weapon pity counter**. The director plans the night.
* **Night.** Real-time defense. The player controls the leader; everyone else who can fight stands the wall and fires automatically using their own skill, traits, wounds and mood.
* **Dawn.** Eating, healing, infection, social life, mental breaks, weather, then the storyteller draws an incident.

## 4. Night combat (implemented in `src/night/battle.ts`)

| System | Rule |
|---|---|
| Aim | Hitscan ray from the muzzle. Spread = `weapon.spread × (1.75 − aim) + bloom`; bloom grows with sustained fire and decays. The crosshair circle is drawn at the true spread. |
| Hitboxes | Head circle (≈13–17% of height) plus body box. Head ×3 (×2 per shotgun pellet). Armoured Deputies take `dmg − 16` on body hits. |
| Pierce | Rifles pierce up to 3 bodies at 70% falloff. |
| Reload | [R] or automatic when empty. The shotgun loads one shell at a time and firing interrupts it. Arm wounds and amputations slow reloads. |
| Weapon condition | Worn guns (<50%) can jam. Condition falls with use; the workbench repairs it. |
| Noise | Every shot adds noise. Every 28 noise pulls an extra straggler up the road. The nail driver is nearly silent. |
| Wall | The barricade is the health bar. Spikes damage the dead at the wall; wire belts slow them on the road. When the wall falls they climb over and **maul defenders**: wounds and bites, then "pulled down behind the wall". |
| Guards | Auto-fire. Engagement range depends on the dark (floodlights extend it). Priority: anything over the wall, then Criers, then the nearest. Cowards and low-mood survivors may flee once the wall is down. |
| Lighting | A darkness layer with holes cut for muzzle flashes, floodlight cones, fires and the house lantern. The Turned get a pale moonlit rim so silhouettes read. |
| Specials | Fog, tide nights (the cycle peak), crier nights, and **the Crossing** (night 23, ×2.2 threat, Ferrymen, the bell). |
| Turning | A survivor whose infection reaches 100% turns *during the night, behind the wall*. Whoever puts them down carries it. |

### The Turned

| Name | Role | Notes |
|---|---|---|
| Sleeper | basic | slow, the bulk of every night |
| Deer | runner | sprints in bursts, then stops, panting |
| Drag | crawler | low head, hard to hit |
| Pulper | bloater | bursts in spore-bile; rots the wall if it dies close |
| Crier | summoner | keens, and two more come; guards prioritise it |
| Deputy | armoured | body shots barely land; aim for the broken visor |
| Ferryman | brute | 520 HP, 24 wall DPS, immune to knockback |

## 5. Survivor sim (implemented in `src/sim/`)

* **Identity:** name (upper-Midwest mill-town pool), age, a backstory before (22 entries, each granting skills), what they did when it began (15 entries), 2–3 traits from 24, 1–2 passions, and a sprite chosen by age and sex.
* **Skills (0–10):** shooting, building, crafting, medicine, scavenging, farming, social. Doing passion work can raise them.
* **Mood** = baseline 40 + traits + needs (hunger, rest, pain, fever, cold) + lover nearby + drink + **timed thoughts**. Thoughts are named and stack, e.g. "Friend Marla died −14 for 7 days" or "We held the wall +5". Every component is visible in the survivor sheet.
* **Breaks** at three thresholds (28/15/6, shifted by traits):
  - minor: sulk, binge, bender, lash out
  - major: catatonic, wander off, smash the workbench, hide a bite
  - extreme: wander, desert with supplies, suicide

  Each break roll has a **resolve** chance (Darkest Dungeon) instead: "Not today." After a break comes a +20 *catharsis*.
* **Wounds:** six body parts and seven wound kinds, with severity, bleeding, tending and infection. Untended cuts can go septic. Fractures and some gunshots leave scars. Pain lowers work and aim.
* **Bites:** about 90% infect. Infection rises 0.32–0.55 per day, so roughly 2–3 days. The player chooses: **amputate** (the success chance is the best doctor's medicine plus the infirmary; a permanent "lost arm/leg" scar follows), **wait and pray**, or **ask them**, which may mean a mercy killing by the person they trust most. Secretive survivors may **hide** a bite until the fever gives them away.
* **Relationships:** a directed opinion from −100 to 100. Daily chats and insults (Kind, Abrasive and low mood weight these) can form bonds: friend, lover, rival (rivals come to blows), spouse, parent/child. Fighting the wall together, rescues on scavenging runs and mercy all move opinion.
* **Death** ripples through everyone's thoughts according to bond. Leadership passes to the most social or skilled survivor, and the player keeps playing.

## 6. The storyteller ("the Weather", `src/sim/director.ts`)

```
threat = (base(day) + √wealth·0.9 + 3·fighters) × ramp(day) × adapt(tension) × cycle(day) × jitter × persona
base(day)  = 10 + 7.5·day^1.12
ramp(day)  = 0.55 → 1.0 over days 2–14
adapt      = tension in [−20, 40]; −10 per death, +2 per clean night after day 4
cycle      = persona table, e.g. Long Siege [0.7, .85, 1, 1.1, 1.25, 1.55 (tide), .55]
mercy      = ×0.8 the night after a death; Crossing night ×2.2; after the ice ×1.35
```

The budget is spent in **three surges** (40/30/30) across zombie types with point costs. Personas: **The Long Siege** (Cassandra-like), **The Quiet** (Phoebe-like) and **The Coin** (Randy-like, 0.5–1.7 jitter).

**Incidents** are drawn each dawn, weighted by population intent (few survivors means more arrivals), cooldowns, and a spotlight weighting that favours survivors with few tales. Implemented so far: wanderer at the gate (may hide a bite), ferry drop-off, found survivor, a parent and child, Peltier's trading boat, Kin at the kitchen table, bite reveal/amputation, a dog, the ration dilemma, Local 41's offer, the County men's "inspection fee", radio voices (lore), the deer-camp cache, a late-night confession, fever, and the grave (bury or burn).

## 7. Production (light, not city-building)

The workshop runs a craft queue powered by survivors assigned to it. The machinery (each with levels):

| Machine | Unlocks |
|---|---|
| Workbench | pistol rounds, shells, rifle rounds (L2), repairs, nail-bomb traps, the nail driver (L2) |
| Barrel forge | reinforce the wall (+60 max), spike rows, wire belts, mill-plate vests |
| Cold frames | more food from the Food job |
| Infirmary | faster healing, better amputation odds, field dressings |
| Copper still | liquor (drinkers), firebombs, distilled fuel |
| Generator | floodlights (light the road, extend guard range, burn fuel) |
| Radio mast | lore broadcasts, contacts |

Crafted weapons can roll as **named masterworks** ("Marla's Second Shift"). They keep a kill count, and the chronicle mentions who carried them.

## 7b. Daylight runs (`src/night/expedition.ts`)

The leader can spend the day leading a run instead of working. It is a side-scrolling street of 3.6–6k px, generated from the chosen site's risk and loot table. Searchable spots are doors, cars, sheds, bodies and Kin at their tables; searching takes 2.5s, faster with scavenging skill, and makes noise. Sleepers stand still until you get close or make noise. You can shove with Space. Daylight runs out after about 150s, and then the dead wake everywhere and stragglers spawn at the screen edges. Walk back off the left edge to get home. Dying out there loses everything carried. Runs give more loot than the auto-scavenge job, plus documents, guns and sometimes a survivor who follows you home.

## 8. The chronicle

Every notable event is logged with its day and kind (death, arrival, tale, break, social, lore, battle). Survivors keep up to 8 *tales*, which are shown on their sheet, used in epitaphs, and kept on the graves tab and the end-of-run memorial. Planned: per-kind sentence grammars, earned titles ("Gatekeeper"), and carvings on the wall and gun stocks.

## 9. Art direction

See research 03. In short: graphic-novel cel shading, heavy ink, two-tone hard shadows, a desaturated cold grey-brown base, and accents of fire orange, blood, and ochre for the infection. Sprites come from `tools/gen-sprites.ts` using OpenRouter's cheapest image model (≈ $0.03/image), on a flat magenta background that is chroma-keyed, trimmed and downscaled; the manifest is in `tools/sprites.json`. The UI is a ledger in typewriter (Special Elite) and Crimson Text.

## 10. Roadmap

- [x] Night defense core, guards, wall, lighting, gore, procedural SFX
- [x] Survivor sim: needs, mood, thoughts, breaks, wounds, bites, relationships, death
- [x] Storyteller director + 16 incidents
- [x] Workshop machinery + crafting + fortifications
- [x] Chronicle, graves, end-of-run memorial
- [x] Daylight side-scrolling runs (Union City style): search doors/cars/sheds/bodies, sleepers wake on noise, Kin at tables, find survivors & papers
- [x] 22 found documents + four factions with standing (Town tab)
- [x] Night panic (low-mood guards) and rage (a loved one falls); named "old face" Turned from a survivor's past
- [x] Earned titles (Gatekeeper, Sawbones, Twice-Bitten, One-Arm...), veteran guns that get carved names
- [x] Nail turrets (generator machinery), wearable mill-plate vests, hand-to-hand when out of ammo
- [x] More incidents: fire, the Quiet, the Parish, weddings, old faces
- [x] Moodles above heads at night; downed state + drag-to-safety
- [x] County raiders that shoot back from cover, tunnelers from the storm drain, horde nights, the Bellwether on the Crossing, the dog
- [x] Faction consequences (14 faction incidents), 51 incidents total, chronicle grammars, three endings (Ferry, Mill, Spring) with epilogue
- [x] Procedural music (title/day/night), settings, help ledger, onboarding, phone layout
- [x] Arsenal: 23 guns with niches, calibers & bullet types, 14 attachments in 6 slots, fireProfile contract (research 01/05)
- [x] Daylight runs with depth lanes, baked backgrounds, contact shadows (research 04)
- [x] Night depth & readability pass (research 04): 4 lanes, baked background, shadows, crowd tint variants, lane hit tests
- [x] Combat tactics (research 05): body zones & visible weakspots, enemy roles & telegraphs, accuracy rework, Focus/nerve, guard posts & orders, reload choices (tactical / speed / smart), corpse ramps, pre-night deployment (trap planner), scouting intel, rally, crewed emplacements (MG nest, swivel rifle, flame projector, nail turret), Leapers & Spitters (duck to dodge)
- [ ] Combat tactics, still open: the sally (a sortie over the wall)
- [x] Survivor progression: XP per skill, psych/courage/grit, weapon-class proficiency, Drill job
- [x] Survivor progression: perks at skill 4/7 (`src/data/perks.ts`: two offered per skill and tier, pick on the survivor sheet or they pick at the second dawn; effects read through `perkFx` / `perkMul`)
- [x] Day loop (research 06): hour budget, dawn ledger juice, scarcity, seeds/daily, teaser
- [x] Campaign/meta: radio threads, score card + endless choice, legacy ledger across runs with boons, tide calendar, push-your-luck run zones, companion runs
- [x] Shooting feel & balance: layered procedural + recorded gun audio, balance harness (docs/balance.md, `tools/balance.ts`), hitstop/shake/recoil pass, launchers
- [x] Animation (research 09): cutout bone rigs for every survivor and Turned (aim, reloads voiced stage by stage, gaits from ground speed, melee, duck / downed / haul / crew poses, attacks, archetype specials), Verlet ragdoll deaths baked into the road, crowd LOD from flipbooks, Classic fallback; replaces "2–3 sprite frames per Turned"
- [x] Final pass: guards' reloads voiced (far, panned), tap-rack / double-feed strip / weapon-draw clips, run dead baked into the road, corpse-pile mass at once, adaptive full-rig budget before the Classic fallback, ragdolls rest on their own (`tools/ragdoll-check.ts`)
- [x] Settings page (audio / video / gameplay / controls / data) from the title, the day screen and the pause menu; rebindable keys (`src/ui/keys.ts`); pause menu at night and on runs; save export / import; Playwright check (`tools/e2e/settings-check.cjs`)
- [x] Gamepad input (`src/input/gamepad.ts`, bindings in `src/ui/keys.ts` PAD): right stick aims, triggers fire / focus, face buttons, guards on the bumpers, orders on the D-pad, left stick walks on runs, D-pad / A / B in menus
- [x] Touch controls for the wall beyond tap-to-fire (`src/input/stage.ts`): Duck / Focus / Reload / Gun / Pause buttons (walk / search / reload / swing / shove on runs); a portrait phone gets "turn your phone" with Play sideways (the playfield rotated to fill the screen) or play small
- [ ] Later: the sally
