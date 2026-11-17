# 02 — Emergent Story: RimWorld and Systems-Driven Story Games

Research reference for an original 2D side-scrolling zombie barricade-defense shooter that has a light RimWorld-style sim layer underneath it: survivors, needs, moods, traits, relationships, injuries, deaths, and the crafting and fortification production that feeds the defense. The core loop is still shooting zombies. This document covers how RimWorld and its relatives turn simulation into stories that players remember, then proposes a scoped-down spec for our game.

**Confidence notes.** Numbers marked **[wiki]** come from the community RimWorld wiki, which mostly reads them from the game's XML/C# defs (version 1.4/1.5 era). Numbers marked **[approx]** are from memory or secondary sources and should be checked before anyone treats them as canon. We are using these numbers as a feel reference, not copying them.

---

## 1. The core theory

### 1.1 "A story generator, not a game"

Tynan Sylvester's GDC 2017 talk *RimWorld: Contrarian, Ridiculous, and Impossible Game Design Methods* frames RimWorld as "a story generator: the player interacts with it, and stories emerge from that interaction." The framing works as a **decision razor**. When "good game" and "good story generator" pull in different directions, the story generator wins. Consequences he describes:

- **The skill-test assumption is rejected.** In a skill game, outcomes should track skill. Good stories need reversals, so RimWorld uses *disproportionate pushback*: a well-played colony can still be knocked flat sometimes.
- **Tension comes from risk to what characters care about, not from a game-over threat.** Failure is *elastic*: it slides into deeper and deeper trouble (losing a leg, a lover, the freezer) instead of ending the run. Every survivable setback is a story beat.
- **The feature filter is "Does this enrich the emotional journeys of the characters?"** Sylvester cites interesting systems (deep production chains, weapon customisation, fluid simulation) that were cut because they did not connect to characters' feelings. Systems tied to basic human needs (relationships, family arriving and leaving, health, food) were prioritised.
- **Long-lasting consequences.** Events should persist: diseases, toxic fallout, sieges, and memories like "Botched my surgery" that explain a grudge weeks later.

Source: GDC Vault talk page; transcript summary (secondary) — see References.

### 1.2 Apophenia: the player writes most of the story

Sylvester's central idea, from the talk and from his book *Designing Games* (O'Reilly, 2013): players "extract more story meaning from a game event than is really represented in the mechanics." The mind is "an overactive system for matching patterns." So the designer's job is to give it **good raw material and leave gaps**:

- **Low-fidelity presentation helps.** RimWorld pawns have no facial animation. A screenshot of one man standing beside another on a hospital bed reads as grief, guilt, or vigilance depending on what the player remembers. Detailed animation would pin the emotion down and often get it wrong.
- **Ellipsis.** Caravans become dots on the world map. Mood and opinion shift off-screen and come to the surface during a crisis. Hidden processes build tension.
- **Labels do the heavy lifting.** A thought called "My wife died" with −20 on it does more narrative work than any cutscene. The *named cause* on every number matters most.

In *Designing Games*, Sylvester sorts narrative tools into **scripted story, world narrative (environmental), and emergent story**. He argues for systems that are **story-rich rather than complex**: complexity is only useful when the player can model it and read meaning into it.

### 1.3 The recipe: characters + systems + pressure

Reduced to its parts, RimWorld's story machine is:

1. **Characters with identity hooks.** A name, a face, a backstory line ("Mathematician — bad at actual shooting"), 1–3 traits, relationships. Each hook makes some future event mean more to the player.
2. **Systems that touch characters personally.** Needs, mood, health by body part, opinion. Every system writes into a character's state with a *named* reason.
3. **External pressure from a director.** The storyteller drops incidents that force the systems to interact. It cares about pacing, not fairness.
4. **Memory.** Thoughts, opinions, scars, missing limbs, tales engraved on sculptures. Past events stay visible, so the player reads cause and effect over time.

### 1.4 The mood/thought buffer

Mood is the key buffer between events and behaviour:

- Mood (0–100%) **moves toward a target** at a capped rate: up to +12/hour rising and −8/hour falling **[wiki]**. It does not jump. The player sees trouble coming and has hours to react.
- The target is **base mood + sum of active thoughts**. Base mood is 32 on Strive to Survive, ranging from 42 (easy) to 22 (Losing is Fun) **[wiki]**.
- **Thoughts are labelled, timed modifiers that stack with diminishing returns.** Examples **[wiki]**:

| Thought | Mood | Duration | Stacking |
|---|---|---|---|
| Ate without table | −3 | 1 d | none |
| Ate raw food | −7 | 1 d | none |
| Observed corpse | −4 | 0.5 d | 3 stacks |
| Observed rotting corpse | −6 | 0.5 d | 5 stacks |
| Colonist died | −3 | 6 d | 5 stacks ×0.75 |
| My friend died | −10 | 20 d | 5 stacks ×0.75 |
| My lover died | −16 | 30 d | 10 stacks ×0.75 |
| Slept outside / in cold | −4 each | 1 d | none |
| Ate fine meal | +5 | 1 d | none |
| Catharsis (after a break) | +40 | 3 d | 5 stacks |
| Pain minor/serious/intense/mind-shattering | −5/−10/−15/−20 | while in pain | — |
| Recreation unfulfilled/deprived/starved | −5/−10/−20 | while unmet | — |
| Bedroom impressiveness | −2 to +8 | 1 d | — |

- **Expectations** add a bonus that shrinks as the colony gets richer: "Extremely low expectations" is about +30 and "Low" +18 **[wiki/approx]**, falling toward 0 at high wealth. It is a hidden rubber band. A starving new colony is not miserable, but a rich one has to keep providing comfort.

The buffer does three things for the story: a death plays out over days instead of one tick; the UI can list *why* someone is sad; and small comforts (a fine meal, a nice room) become meaningful levers.

### 1.5 Mental breaks: cascading failure

**[wiki]**: The thresholds are minor 35%, major 20% (4/7 of minor), and extreme 5% (1/7 of minor). Traits shift the minor threshold (Iron-willed −18%, Steadfast −9%, Nervous +8%, Volatile +15%), clamped to 1–50%. The **mean time between breaks** while below a threshold is 4 days (minor), 0.8 days (major), and 0.5 days (extreme). Breaks are random rolls, not certain at the threshold, so the player gets a window to act.

- Minor breaks are annoying: food binge, sad wander, hiding in a room, insulting spree.
- Major breaks hurt: tantrum (smashing furniture), daze, drug binge, corpse obsession.
- Extreme breaks are catastrophic: berserk, fire-starting spree (pyromaniac), catatonic breakdown, slaughterer, running wild, giving up and leaving, murderous rage.

**The cascade.** A raid kills a colonist. Her husband gets "My wife died" (−16 for 30 days) on top of pain from his own wound and "Observed rotting corpse" because nobody had time to bury her. He goes berserk and injures the cook. The cook's pain plus "harmed me" pushes her to a tantrum that smashes the freezer, and the food spoils. Each step is a named, legible cause, so the player experiences the spiral as a *story* rather than as noise.

**The recovery arc.** Most breaks grant **Catharsis +40 for 3 days [wiki]**, which pulls the pawn back above the threshold. Combined with the mood rate cap and the expectations bonus at low wealth, collapse tends to bottom out and rebound. The arc is *fall, crisis, release, rebuild*, not a death spiral to game over. That is the elastic failure Sylvester described.

### 1.6 Social layer

**[wiki]**: Opinion runs −100 to +100. Rival is ≤ −20, acquaintance −20 to 20, friend ≥ 20. It is built from timed, stacking interaction memories:

| Interaction | Opinion | Duration | Notes |
|---|---|---|---|
| Chitchat | +0.66 | — | caps at +10, weight 1 |
| Deep talk | +15 | 20 d | weight 0.075 × compatibility |
| Kind words | +15 | 20 d | Kind trait only |
| Slighted | −5 | 20 d | weight 0.02 |
| Insulted | −15 | 20 d | weight 0.007; Abrasive ×2.3 |
| Social fight outcome | +38 or −22 | 20 d | 4% per insult, 0.5% per slight |
| "Harmed me" | −15 | 10 d | |
| Lover / spouse | +35 / +30 | permanent | |
| Rebuffed me / broke up with me / divorced me | −10 / −50 / −70 | | |
| Parent-child / sibling | +30 / +20 | permanent | |

Two design lessons. First, **compatibility** is a hidden per-pair constant, so some pairs drift together and others drift apart with no intervention. Players narrate this as chemistry. Second, **family and lovers are the main amplifiers**: they turn "colonist died" (−3) into "my lover died" (−16 for a month).

### 1.7 Traits and backstories: identity hooks

Adults get 1–3 traits **[wiki]**. Good traits are **verbs, not stats**. Each should generate events or change how the player reacts:

- Mood bias: Sanguine +12, Optimist +6, Pessimist −6, Depressive −12.
- Break resistance: Iron-willed, Steadfast, Nervous, Volatile (see above).
- Behaviour: Pyromaniac (fire sprees, MTB 50 days), Abrasive (insults ×2.3), Kind (kind words), Bloodlust (+12 for killing, social fights ×4), Psychopath (ignores death and butchery penalties).
- Combat: Tough (×0.5 incoming damage), Wimp (pain shock at lower pain), Brawler (+melee, −10 mood with a gun), Trigger-happy (−50% aim time, −accuracy), Careful shooter (the reverse).
- Work: Industrious +35%, Lazy −20%, Neurotic +20% work but +8% break threshold.
- Envy and taste: Greedy, Jealous, Ascetic.
- Schedule: Night owl (+16 at night, −10 by day).

Backstories are *childhood + adulthood* pairs. Each adjusts skills, can **disable work types** (the Novelist cannot do dumb labour or social work), and can force or forbid traits. About 25% of pawns get a hand-written "solid" bio **[wiki]**. Disabled work is a strong story hook: "the one who won't fight" is instantly memorable.

### 1.8 Health: injuries as story

**[wiki]**: Health is tracked per body part. Systems map to parts (legs → Moving, arms/hands → Manipulation, brain → Consciousness, eyes → Sight). Losing an eye costs 50% Sight; losing a finger costs about 8% Manipulation. Injuries have severity, pain, bleeding, infection risk, tending quality, and can scar into chronic pain. A pawn is downed at Moving < 15% or at pain shock. Base healing is 8 HP/day.

Why it matters for story: a **permanent, visible change** (peg leg, missing eye, "old gunshot scar (aches)") is a scar the player remembers. Being **downed instead of dead** creates rescue moments and capture stories. Death is never the only outcome of a lost fight.

### 1.9 The storytellers: pacing as a character

The storyteller is presented as a character with a portrait and personality. Cassandra builds tension, Phoebe is chill, Randy is random. That framing lets the player *forgive* bad luck as authorial intent ("Randy did this to me").

**Threat points [wiki]**

```
RaidPoints = (WealthPoints + PawnPoints) × ThreatScale × StartingFactor × AdaptationFactor
             clamped to [35, 10000]
```

- **Storyteller wealth** = items + creatures + 0.5 × buildings. *Defences are discounted* so building walls is not punished at full value.
- **WealthPoints**: 0 at ≤14k wealth, rising linearly to 2,400 at 400k, 3,600 at 700k, 4,200 at 1M (flat after).
- **PawnPoints** per colonist: 15 at ≤10k wealth, rising to 140 at 400k and 200 at 1M. The value is scaled down for injured pawns, slaves (75%), and children.
- **ThreatScale** by difficulty: 0.10 / 0.30 / 0.60 / 1.00 / 1.55 / 2.20.
- **StartingFactor**: 0.7 up to day 10, ramping to 1.0 by day 40. This protects the opening.
- **AdaptationFactor**: AdaptDays rise by about 1 per day (after a 30-day grace period) within [−60, 100]. They map to a factor: −30 → 0.4, 0 → 0.8, 30 → 1.0, 60 → 1.2, 100 → ~1.47. **A colonist death removes 20–30 AdaptDays and a downed colonist removes 3.5–8** (more for small colonies). This is the core mercy mechanic: losses automatically soften the next few raids.
- **Randy** multiplies each event's points by ×0.5–1.5.

**Cadence [wiki]**

| | Start of threats | On / Off phase | Threats per On phase | Min spacing |
|---|---|---|---|---|
| Cassandra | day 11 | 4.6 d on / 6.0 d off | 1–2 | 1.9 d |
| Phoebe | day 13 | 8 d on / 8 d off | 1 | 8–24 d apart |
| Randy | any time | no cycle; can cluster | random | none |

Misc (non-threat) events fire with an MTB of about 4.8 days on top of the threat cycle. Cassandra averages about 8.5 major threats per in-game year.

**Population intent [wiki]**: a curve from colonist count to how much the storyteller wants to add people: 0 → 8.0, 1 → 2.0, 5 → 1.0, 9 → 0.4, 12 → 0.0, 20 → −1.0. It is multiplied by a days-on-map ramp (0 at day 0, 1.0 at day 10). "Wanderer joins", refugee, and escape-pod incidents are weighted by it. **Small colonies get recruits and large colonies stop getting them.** This keeps the cast at a size the player can know personally.

### 1.10 Tales and art: recorded memory

RimWorld logs notable events as **Tales**: deaths, kills, raids, surgeries, marriages, breakdowns, animal attacks. Each has participants, date, and place. When a colonist creates an artwork (sculpture, or engraved furniture in some versions), it picks an existing tale and generates a description from a grammar plus a seed, for example: *"This sculpture depicts Ingrid killing a Centipede with a knife. Ingrid is shown screaming. The image commemorates the Battle of Day 14, Aprimay 5502."* Community save inspection shows that art stores only a **tale ID + seed** and regenerates the text **[community]**. Tales have importance and expire unless referenced, so art keeps old events alive.

Dwarf Fortress does the same at much larger scale: engravings and artifacts depict real historical events from the world's **Legends** (generated history of figures, wars, deaths). That is why players cite them years later.

### 1.11 How they keep complexity legible

- **Every number has a named cause** (thought list, opinion breakdown, health tab per body part).
- **Mood bar with break-threshold tick marks** puts the danger zones on one line.
- **Rate caps and MTBs** turn instant failure into visible, slow trends the player can address.
- **Alerts** ("Colonist in minor break risk", "Need rescue", "Starvation").
- **Letters** (red/yellow/blue/green) narrate each incident in one sentence with a named subject.
- **Simple, iconic art** with outlines that make pawns and threats pop against the background.
- **A short list of pawn verbs.** The player can predict behaviour from a few traits.

### 1.12 Related games: one lesson each

- **Dwarf Fortress**: *Legends mode* and engravings show that history which is recorded and re-displayed becomes lore. "Losing is fun": collapse is content. Strange moods create artifacts tied to one dwarf. The weakness is UI that hides the story; RimWorld's lesson was to keep DF's depth with legible presentation.
- **Crusader Kings (II/III)**: opinion breakdowns with named modifiers, *rivals/friends/lovers* as explicit slots, secrets and schemes. CK3 **stress**: acting against your traits (a Compassionate ruler executing someone) adds stress, and crossing stress levels triggers a mental-break event with a coping-mechanism choice. Lesson: **traits should create dilemmas, not only modifiers.**
- **Kenshi**: "You are not great and powerful. You don't have more hit points than everyone else." You are a nobody; the world does not care; defeat (captured, enslaved, limbs lost) continues the run instead of ending it. Lesson: **non-terminal defeat states** and skills earned by use ("the one who got good at first aid by being shot a lot").
- **This War of Mine**: civilians with one-line bios and a single strong trait (good cook, good scavenger), depression states (sad → depressed → broken, which can lead to suicide or leaving), and **moral choices on night scavenging** (rob the elderly couple?) whose guilt shows up later in other characters' moods. Each character's bio page fills with a diary of what happened. Lesson: **guilt and moral memory hit harder than danger.**
- **Darkest Dungeon**: a second health bar for **Stress (0–200)**. At 100 a hero rolls **Affliction or Virtue (about 25% Virtue)**; at 200, a heart attack. Afflicted heroes act on their own and spread stress to the party. There is also a narrator, quirks gained from events, and a graveyard memorial. Lesson: **the 100 breakpoint with a chance of heroism** is a dramatic moment; a narrator voice makes the systems feel authored.
- **Frostpunk**: two societal meters (**Hope** and **Discontent**) that move separately; laws that buy survival at a moral cost; a final-warning ultimatum before game over. Lesson: **population-level morale** as a fast-reading second channel next to individual moods, and dilemmas presented as laws.
- **Wildermyth**: procedural characters run through hand-written, slot-filled comic vignettes. Heroes gain **permanent transformations** (maimed, crystal arm, wolf-touched), age, retire, and return as **Legacy** heroes in later campaigns. Lesson: **short authored templates filled with sim facts** are the cheapest high-impact story tool, and cross-run legacy makes characters outlive a run.
- **Banished**: a counter-example. Citizens are nearly anonymous population counts, so nobody remembers them. Deaths are statistics. Lesson: **names, faces, and one hook per person are required.**
- **Project Zomboid**: "This is how you died": death is guaranteed, and the story is how long you lasted. *Moodles* (hungry, panic, bored, depressed, injured, queasy) show state as compact icons with 1–4 levels. Panic rises from seeing zombies and falls with experience. Wounds are tracked per body part and a **bite means infection (and likely death)**, while lacerations and scratches carry a smaller infection risk **[approx: ~25% laceration, ~7% scratch]**. Lesson: **the bite clock** is the defining zombie story beat, and moodles are a good legibility model for a small screen.

### 1.13 What to strip for a lighter game

| RimWorld feature | Keep / Cut / Simplify |
|---|---|
| ~12 needs incl. beauty, comfort, outdoors, indoors, chemicals | **Simplify** to 5 core needs |
| Hundreds of thoughts | **Simplify** to ~35 thoughts in ~8 families |
| Full body-part tree with fingers and organs | **Simplify** to 6 hit zones + 4 wound types |
| Work priorities grid for every job | **Cut**; use assignment slots (wall, workbench, infirmary, kitchen, lookout) |
| Romance, pregnancy, children, ideology | **Simplify**: pair bonds yes, kids no (or a rare event only) |
| Room impressiveness / beauty | **Cut**; replace with "Shelter quality" as one tier stat |
| Art bench & tales | **Keep the idea**, cheaper: Chronicle + memorial wall + "carved into the barricade" |
| Threat points & adaptation | **Keep** the core formula (it is cheap and good) |
| Population intent | **Keep** (small cast is the point) |
| Storyteller personas | **Keep** 3 personas |
| Mental break catalogue (~30) | **Simplify** to 9 breaks (3 per tier) plus a Resolve/Virtue chance |
| Trading, caravans, world map | **Cut** (expeditions can become a scavenging-run abstraction) |

---

## 2. Takeaways for our game: a proposed lightweight sim spec

### 2.0 Design pillars

1. **Every survivor is a named person with one hook the player can say out loud** ("Dot, the ex-nurse who won't shoot").
2. **The shooting loop is the pressure; the sim is the consequence.** Night waves are fought live; days are for triage, building, and grieving.
3. **Every number shows its cause.** Mood, opinion, and wound panels list named reasons.
4. **Failure is elastic.** Downed > dead; bitten = countdown and a choice; losses soften the next wave.
5. **The game remembers.** The Chronicle and barricade carvings preserve what happened.

Time model assumed: **day/night cycle**. A night wave lasts about 3–6 real minutes; a day phase is a management screen or short side-scrolling base walk. One in-game day = one wave cycle. Durations below are in days (= cycles).

### 2.1 Survivor state

Each survivor has: name, portrait, age, one **Background** (childhood merged into a single line), 1–2 **Traits** (3 is rare, 5%), 4 **Skills** (Shooting, Melee, Crafting, Medicine; 0–10, improved by use as in Kenshi), **Mood** 0–100, **Needs**, **Wounds**, **Relationships**, **Memories** (timed thoughts), and **Tale tags**.

### 2.2 Needs and mood factors (10 max)

Five needs (0–100, drain per day) plus five situational factors:

| # | Factor | Source | Mood effect |
|---|---|---|---|
| 1 | **Food** | rations | Fed +0 / Hungry −6 / Starving −15 (and HP loss) |
| 2 | **Rest** | sleep slots, night watch duty | Rested +0 / Tired −5 / Exhausted −12 (and accuracy −20%) |
| 3 | **Safety** | barricade HP %, breaches last night, lookout coverage | Secure +5 / Uneasy −4 / Terrified −12 |
| 4 | **Shelter** | bunk quality tier (floor/cot/bed/room) | −4 / 0 / +3 / +6 |
| 5 | **Downtime** | one leisure slot (cards, radio, guitar) | met +4 / unmet −5 / starved −10 |
| 6 | **Pain** | sum of wound pain | −4 / −8 / −14 / −20 (downed at "Agony") |
| 7 | **Grief & loss** | memories of deaths | see thoughts table |
| 8 | **Combat stress** | events in the last wave (bites, near-misses, kills) | temporary memories |
| 9 | **Social** | sum of top 3 relationships present (alive & in camp) | −6 … +6 |
| 10 | **Hope** (colony-wide) | Frostpunk-style shared meter, 0–100 | maps to −10 … +10 for everyone |

**Mood formula**

```
moodTarget = BASE (35) + traitBias + Σ needModifiers + Σ activeMemories + hopeModifier + expectationBonus
expectationBonus = lerp(+15, 0, clamp01(campTier / 4))      // rubber band: early camp is resilient
mood moves toward moodTarget at +10/hour up, -6/hour down; frozen while asleep or downed
```

**Core memories** (thoughts; durations in days; same-type stacks multiply ×0.75 each extra, max 5):

| Memory | Mood | Days |
|---|---|---|
| Survivor died (any) | −3 | 4 |
| My friend died | −10 | 12 |
| My partner / family died | −18 | 20 |
| Saw them turn (a friend reanimated) | −12 | 8 |
| Had to put down a friend (shooter only) | −15 | 15 |
| Bitten | −10 | until cured or turned |
| Fought in a breach | −4 | 2 |
| Survived a horde night with no deaths | +6 | 2 |
| Saved my life (rescuer → rescued opinion +25) | +8 | 6 |
| Ate a hot meal | +3 | 1 |
| Ate scraps | −4 | 1 |
| New weapon / armour I wanted (trait-matched) | +5 | 3 |
| Left behind / abandoned (when the player leaves someone outside) | −20 to the left one, −6 to their friends | 10 |
| Catharsis (after a break) | +35 | 2 |
| Resolve (after a Virtue) | +20 | 3 |
| Funeral held | +5 to mourners, and grief memories decay ×2 faster | 3 |

### 2.3 Breaks and resolve

Thresholds (modified by traits, clamped 5–50): **Shaken < 35**, **Breaking < 20**, **Broken < 8**. While under a threshold, roll with MTB **3 / 1 / 0.5 days**, and with a **×3 multiplier during night waves** so breaks hit in combat, where the stakes are highest.

**Darkest-Dungeon-style breakpoint.** When a break is rolled, there is a `resolveChance = 15% + 5% × (Brave/Stoic traits) + 5% if partner present`. If it succeeds, the survivor gains a **Virtue** instead (Rallying, Steady Aim, Stalwart) for the rest of the night and the next day, plus a "Resolve" memory. These are the moments players retell.

| Tier | Breaks (pick by trait weights) |
|---|---|
| Shaken | Hides in the bunker (won't take a wall slot), Binge eats (−1 day of food), Lashes out (insult: −10 opinion to a target) |
| Breaking | Panics on the wall (fires wildly: −50% accuracy, wastes ammo), Smashes the workbench (bench offline 1 day), Deserts the post (opens a gap on one wall section) |
| Broken | Flees into the night (may return, injured or bitten, or never), Berserk (melee attacks zombies past the barricade *or* a rival), Gives up (catatonic for 2 days, can't be assigned) |

### 2.4 Traits (20)

Each survivor has 1–2. Pairs that conflict are mutually exclusive.

| Trait | Effect |
|---|---|
| **Steady** | Break thresholds −10; resolve chance +5% |
| **Jittery** | Break thresholds +8; +10% fire rate |
| **Optimist** / **Pessimist** | Mood +8 / −8 |
| **Crack Shot** | +2 Shooting; +4 mood with a rifle |
| **Brawler** | +2 Melee, −2 Shooting; −6 mood if forced to the gun line |
| **Trigger-Happy** | +30% fire rate, −15% accuracy, ammo use +20% |
| **Pacifist** | Won't shoot (disabled work); +25% medicine & crafting; others' "saved my life" more likely to involve them |
| **Tough** | Wound severity ×0.6 |
| **Squeamish** | Pain thresholds lower; corpse/turning memories ×1.5 |
| **Medic** (background-linked) | Bite-amputation success +30%; tending quality +1 tier |
| **Tinkerer** | Workbench speed +35%; small chance of a "prototype" weapon with a name |
| **Lazy** | Work speed −25%; Rest drains 20% slower |
| **Night Owl** | +8 mood at night, −6 by day; +10% accuracy at night |
| **Hothead** | Insults ×2; social fights ×3; Berserk weight ×2 |
| **Kind** | Gives "kind words" (+12 opinion, +4 mood to target); never insults |
| **Loner** | Social factor capped at 0; ignores "my friend died" penalty ×0.5 |
| **Glutton** | Food drains 50% faster; Binge break weighted |
| **Survivalist** | Scavenge yield +30%; immune to "ate scraps" |
| **Haunted** (backstory-linked) | Starts with a permanent −4 "memory of before"; resolve chance +10% (has nothing left to lose) |

### 2.5 Relationships

- **Opinion** −100…+100 per directed pair; **Rival ≤ −25**, **Friend ≥ 25**, **Partner** (romance event, requires mutual ≥ 50), and **Family** (set at generation or arrival: sibling, parent/child) with a permanent +25 bias.
- Hidden **compatibility** per pair, −1…+1, multiplies positive interaction gains (× (1 + c)) and negative weights (× (1 − c)).
- **Interactions** happen during the day phase, one roll per survivor pair sharing an assignment: Chat +0.5 (cap +10), Deep talk +12 (12 d), Kind words +12, Slight −5, Insult −12 (12 d), Fight outcome +25 / −20.
- **Combat ties.** "Saved my life" (+25, permanent until dead), "Left me outside" (−40, 30 d), "Fought beside" (+2 per shared wave, cap +20). **Combat is the main relationship engine in our game**, not chitchat.
- **Effects.** Friends on adjacent wall sections get +5% accuracy. Rivals adjacent cause slight/insult rolls mid-wave. A partner present raises resolve chance and makes the partner's death the heaviest memory in the game.
- Only show **top 3 relationships** per survivor in the UI.

### 2.6 Injury model (6 zones × 4 wound types)

Zones: **Head, Torso, Left Arm, Right Arm, Left Leg, Right Leg**. Each has a severity 0–100 bucketed into *Bruised / Wounded / Mangled / Lost* (arms/legs) or *Critical* (head/torso).

| Wound | Bleed | Pain | Infection | Notes |
|---|---|---|---|---|
| Bruise (blunt) | none | low | 0% | heals 2 days |
| Cut / laceration | medium | medium | 10% untreated | |
| Gunshot (friendly fire, raiders) | high | high | 15% untreated | can leave a permanent "old wound" |
| **Bite** | medium | medium | **Zombification**, see below | the signature beat |

- **Capacities:** Arms → aim/reload/craft; Legs → move speed/climb; Head → accuracy, consciousness; Torso → bleeding multiplier.
- **Downed** at pain ≥ 80 or blood < 40%. A downed survivor on the wall must be dragged to the infirmary (a mini rescue task). If zombies reach them, they are bitten or killed.
- **Bite clock.** A bite starts **Infection 0→100 over ~1.5–3 days** (randomised and hidden in ±20% buckets so it's uncertain). Options: **amputate** the bitten limb within N hours (Medicine roll; success stops infection, adds permanent "Lost arm"), a rare **antiviral** item, or **quarantine and wait** (a small natural-immunity chance, ~5%, so hope is possible). At 100 they turn, ideally at the worst moment, inside the camp. That gives the player three things to remember: the choice, the countdown, and whoever had to pull the trigger.
- **Scars and prosthetics.** Mangled/Lost parts become permanent traits visible on the sprite (eyepatch, crutch, hook). They are crafted at the workbench: peg leg (−30% speed), hook (melee +1, shooting −1), and so on.
- Healing: about 10 severity/day tended, 4 untreated; untreated cuts and gunshots roll infection.

### 2.7 Storyteller director

Three personas, shown as portrait plus voice line on the night briefing:
- **"The Siege"** (Cassandra-like): rising tension waves, guaranteed lulls.
- **"The Quiet"** (Phoebe-like): long breathers, kinder adaptation.
- **"The Coinflip"** (Randy-like): no cycle, ×0.5–1.6 variance, can double up.

**Threat budget per night**

```
// all values tunable
campWealth   = Σ item value + Σ crafted weapons/armour + 0.4 × Σ fortification value   // walls discounted
wealthPts    = curve(campWealth):  0 → 0, 2k → 40, 10k → 220, 40k → 650, 100k → 1200 (flat after)
pawnPts      = Σ survivors (combatValue_i × healthFactor_i)            // 20 base, +3 per Shooting level, ×0.5 if Pacifist
dayRamp      = lerp(0.6, 1.0, clamp01((day - 3) / 12))                 // gentle first two weeks
adaptDays    ∈ [-20, 60];  +1 per night survived with no deaths (after day 5)
               -10 per survivor death, -3 per survivor downed, -6 per survivor turned
adaptFactor  = curve(adaptDays): -20 → 0.55, 0 → 0.8, 20 → 1.0, 40 → 1.2, 60 → 1.35
cyclePhase   = persona curve (below)
difficulty   ∈ {0.5, 0.8, 1.0, 1.4, 2.0}

threatPts = clamp( (wealthPts + pawnPts) × dayRamp × adaptFactor × difficulty × cyclePhase × personaJitter, 30, 4000 )
```

**Pacing curve (The Siege).** A 7-night *cycle* with sawtooth tension plus a slow overall climb:

```
cyclePhase(n) = [0.7, 0.85, 1.0, 1.15, 1.35, 1.6 (BLOOD MOON), 0.5 (lull)] [n mod 7]
```

The Quiet uses a 10-night cycle with a lower peak (1.3) and two lull nights. The Coinflip uses `cyclePhase = 1.0` and `personaJitter = rand(0.5, 1.6)`, with a 15% chance of a second spike the next night.

**Spending the budget.** Zombie archetypes have point costs (Shambler 5, Runner 12, Crawler 6, Bloater 25, Brute 60, Screamer 30 (summons), Armored 40). The director fills the wave in **3 surges** with a 40/30/30 split, picks the archetype mix from a persona table, and places a **"spike"** unit where the barricade is weakest only when `adaptDays > 10`. That is a feeling of intent the player can read and respond to.

**Mercy & drama rules** (cheap, high-value):
- **Post-loss lull.** After a death, the next night's `cyclePhase` is ×0.8 and no Blood Moon for 2 nights. The adaptation drop already handles most of this.
- **Population intent** for *recruit* incidents: survivors → weight: 1 → 4.0, 3 → 2.0, 5 → 1.0, 8 → 0.3, 10 → 0.0, 12 → −0.5. Negative values *raise* the weight of departure/split incidents. Target cast 5–9.
- **Grief window.** Within 2 days after a death, the director prefers *social* incidents (funeral, argument, a letter found) over new threats, so the player has room to feel it.
- **Spotlight.** Each incident picks its subject to favour survivors with few Chronicle entries, so everyone gets a moment.
- **Minimum spacing** of 1 day between major *day* incidents; night waves always happen.

### 2.8 Incident list (30)

Weights per persona and population intent; **(T)** threat, **(G)** good, **(S)** social/dilemma, **(N)** neutral.

1. **Horde Night (T)**: standard wave from budget.
2. **Blood Moon (T)**: ×1.6 budget, more runners; scheduled by the Siege cycle.
3. **Screamer Pack (T)**: screamers summon extra mid-wave; teaches target priority.
4. **Bloater Front (T)**: explosive acid; damages barricade sections.
5. **Brute Breach (T)**: a single heavy that targets the weakest wall.
6. **Tunnelers (T)**: crawlers emerge *behind* the line from the sewer grate.
7. **Fog Night (T)**: visibility −50%; lookout trait/skill matters.
8. **Day Raid (T)**: a smaller daylight wave that interrupts crafting.
9. **Raiders (T)**: hostile humans who shoot back and steal stock; can take a survivor hostage (rescue thread).
10. **Bite in the Night (T/S)**: a hidden bite reveals itself during the day ("they hid it").
11. **Infection Spreads (T)**: a turned survivor inside the camp.
12. **Sick Wave (T)**: illness (not zombie), −Rest, needs medicine.
13. **Fire! (T)**: a workbench or fuel store catches fire; fight it or lose it.
14. **Wall Rot (N)**: one barricade section degrades without repair.
15. **Power Failure (N)**: the generator dies; lights and turrets go offline until fixed.
16. **Supply Drop (G)**: a crate lands outside the wall; someone has to go and get it.
17. **Wanderer at the Gate (G/S)**: recruit? They might be bitten (an unknown).
18. **Refugee Family (G/S)**: 2–3 people at once, one child (a non-combatant). Population intent.
19. **Lone Dog (G)**: animal companion that barks at tunnelers; becomes a beloved character.
20. **Trader's Truck (G)**: barter ammo, meds, parts.
21. **Radio Signal (N/S)**: a voice promising rescue; a multi-day thread with a payoff or betrayal.
22. **Cache Rumor (G)**: a scavenging-run opportunity; choose who goes (they may not return).
23. **Deserter (S)**: a low-mood survivor tries to leave with supplies at night.
24. **Lovers' Quarrel / Breakup (S)**: relationship event; opinion swing.
25. **Proposal / Bonding (S)**: high-opinion pair becomes partners, +Hope.
26. **Funeral Choice (S)**: bury (time, +Hope) or burn (fast, −mood for squeamish).
27. **Ration Dilemma (S)**: cut rations (−mood) or keep (−food days); Frostpunk-style.
28. **Mercy Request (S)**: a bitten survivor asks someone specific to be the one; that person gets a heavy memory and +opinion from others.
29. **Inspiration (G)**: a high-mood survivor gets "Inspired Craft" (next item is a named masterwork), "Rallying Speech" (+Hope), or "Eagle Eye" (+accuracy next wave).
30. **Old Face (S)**: someone from a survivor's background turns up, as a zombie or alive, keyed to the background text.

### 2.9 The Chronicle (tale system)

**Data model**

```ts
interface Tale {
  id: number; day: number; kind: TaleKind;     // "Kill", "Death", "Rescue", "Bite", "Amputation", "Breakdown", "Resolve", "Bond", "Masterwork", "LastStand", ...
  actors: SurvivorId[]; target?: string;       // e.g. "Brute", "Raider 'Mags'"
  place?: string;                              // wall section / building name
  importance: number;                          // 1..10 (death=10, first kill=4, resolve=7)
  facts: Record<string, string|number>;        // weapon, kill count, wound, last words key
}
```

**Recording rules.** Auto-log on: deaths (with cause and killer), turnings, bites and the bite decision, amputations, rescues while downed, resolve/virtue moments, breaks during waves, milestone kills (1st, 100th, a Brute), last-survivor-standing on a wall section, bonds and breakups, newcomers arriving, named masterwork items, scavenging runs that didn't come back. Most tales cost one line of code at the event site.

**Surfacing** (cheap to rich):
1. **Morning Report**: 2–4 grammar-generated lines after each night, highest importance first. *"Night 23. Ruth held the east gate alone after Marco went down. She did not stop firing until dawn."*
2. **Survivor bio page**: their tales in order. This is the This War of Mine diary. It also shows **titles earned** from tale counts ("Gatekeeper", "Butcher of Night 12", "Twice-bitten").
3. **Carvings**: a survivor with Crafting ≥ 4 in a downtime slot (or the Tinkerer trait) can **carve a tale into a barricade plank, a gun stock, or the memorial wall**. The object carries a generated line (*"Notched into the stock: eleven marks, and the name 'Bea'."*). If that wall section is later destroyed, the carving is lost, which adds stakes to defending it.
4. **Memorial Wall** in camp: every dead survivor's name, days survived, kill count, cause of death, and the line from their most important tale. Optional "Legacy" (Wildermyth): on a new run, one remembered name may return as a stranger at the gate with their old trait.
5. **End-of-run Chronicle**: a scrolling recap or shareable card per survivor. This is the "story generator" output the player sends to friends.

**Grammar.** Use per-kind templates with slot variants and trait-flavoured adverbs (Hothead → "cursing", Kind → "quietly"), seeded by tale ID so text stays stable (as RimWorld does). Store ID + seed, not text.

### 2.10 Legibility on a 2D side-scroller

- **Moodles** above each survivor (Project Zomboid): up to 3 icons for the strongest factors, with colour by severity.
- **Mood bar with threshold ticks** in the roster, and a hover list of named memories with +/− values.
- **Wound silhouette** (6 zones) with colour per state; a pulsing bite icon with an uncertain timer ("hours… maybe a day").
- **Relationship lines** shown only on hover; top 3 only.
- **Director voice**: one line at dusk ("They're restless tonight.") hints at the cycle without numbers.
- Keep art **iconic and readable**. Survivors need silhouettes that differ (hat, coat colour, prosthetic) so the player can track who is on which wall mid-fight. Low facial detail is fine (apophenia).

### 2.11 Scope guardrails

- Hard caps: 10 mood factors, ~35 memory types, 20 traits, 9 breaks, 6 body zones, 30 incidents, 12 survivors max.
- Apply Sylvester's razor to every new system: **does it change how the player feels about a specific survivor?** If not, it belongs to the shooter balance team, not the sim.
- Production (weapons, armour, fortifications) should create story through **named masterworks, who made them, and who died holding them**, not through deep resource chains.

---

## References

**RimWorld (primary / near-primary)**
- Tynan Sylvester, *RimWorld: Contrarian, Ridiculous, and Impossible Game Design Methods*, GDC 2017 — https://gdcvault.com/play/1024686/-RimWorld-Contrarian-Ridiculous-and
- Transcript summary of the talk (secondary, AI-generated) — https://readray.ai/notes/1141351
- Tynan Sylvester, *Designing Games: A Guide to Engineering Experiences*, O'Reilly, 2013 — https://www.oreilly.com/library/view/designing-games/9781449338015/
- Game Developer, "RimWorld, Dwarf Fortress, and procedurally generated storytelling" — https://www.gamedeveloper.com/design/rimworld-dwarf-fortress-and-procedurally-generated-story-telling
- Game Developer, "Video: How RimWorld found success through ridiculous, contrarian design" — https://gamedeveloper.com/design/video-how-i-rimworld-i-found-success-through-ridiculous-contrarian-design
- Rock Paper Shotgun, "How RimWorld Generates Great Stories" (2016) — https://www.rockpapershotgun.com/2016/08/12/how-rimworld-generates-great-stories
- Stanford GDT, "How Do You Create Apophenia?" — https://gdt.stanford.edu/how-do-you-create-apophenia/
- AIAS Game Maker's Notebook, "Generating Human Stories with RimWorld Creator, Tynan Sylvester" — https://chartable.com/podcasts/the-aias-game-makers-notebook/episodes/177171417-generating-human-stories-with-rimworld-creator-tynan-sylvester

**RimWorld wiki (mechanics & numbers)**
- AI Storytellers — https://rimworldwiki.com/wiki/AI_Storytellers
- Cassandra Classic — https://rimworldwiki.com/wiki/Cassandra_Classic
- Phoebe Chillax — https://rimworldwiki.com/wiki/Phoebe_Chillax
- Raid points — https://rimworldwiki.com/wiki/Raid_points
- Mood — https://rimworldwiki.com/wiki/Mood
- Mental break — https://rimworldwiki.com/wiki/Mental_break
- Thoughts — https://rimworldwiki.com/wiki/Thoughts
- Needs — https://rimworldwiki.com/wiki/Needs
- Social — https://rimworldwiki.com/wiki/Social
- Traits — https://rimworldwiki.com/wiki/Traits
- Backstories — https://rimworldwiki.com/wiki/Backstories
- Health — https://rimworldwiki.com/wiki/Health
- Events — https://rimworldwiki.com/wiki/Events
- Art — https://rimworldwiki.com/wiki/Art
- Steam discussion on art descriptions / tale IDs in saves (community) — https://steamcommunity.com/app/294100/discussions/0/1643170903484501774

**Related games**
- Darkest Dungeon Wiki, Virtue / Stress — https://darkestdungeon.wiki.gg/wiki/Virtue and https://darkestdungeon.gamepedia.com/Stress_Bar
- Frostpunk hope/discontent — https://www.gamepressure.com/frostpunk/what-happens-when-discontent-or-hope-reach-critical-values/zfad7c ; PC Gamer interview — https://www.pcgamer.com/au/frostpunk-developers-on-hope-misery-and-the-ultimately-terrifying-book-of-laws
- Kenshi ("You are not great and powerful") — https://www.siliconera.com/kenshis-eight-year-development-journey-from-one-man-rpg-to-a-teams-success/ ; essay — https://mechanicsofmagic.com/2024/06/14/rwp-essay-emergent-narrative-in-kenshi/
- Wildermyth Legacy — https://wildermyth.com/wiki/Legacy ; PC Gamer preview — https://www.pcgamer.com/fantasy-rpg-wildermyth-has-all-the-adventure-and-humour-of-a-dandd-homebrew
- Project Zomboid Moodles — https://pzwiki.net/wiki/Moodles
- Dwarf Fortress Legends — https://dwarffortresswiki.org/index.php/Legends
- Crusader Kings III Stress — https://ck3.paradoxwikis.com/Stress
- This War of Mine — https://thiswarofmine.fandom.com/wiki/Emotional_state
