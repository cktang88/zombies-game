# 01 — The Last Stand series and the zombie-defense genre: mechanics reference

Purpose: a mechanics reference for an ORIGINAL 2D side-view barricade-defense game (player behind a barricade on the left, zombies come from the right, mouse aim and fire, day/night loop with daytime hours spent by survivors). We take mechanics only. No names, art, story or text from these games.

Confidence tags: **[wiki]** = taken from the community wiki's source text (fandom API), **[review]** = from a contemporary review, **[recall]** = widely remembered by players but not confirmed by a primary source this session; treat as approximate.

---

## 1. Series overview

| Game | Year | Core structure | What it added |
|---|---|---|---|
| **The Last Stand (TLS1)** | 2007, Flash (Newgrounds/Armor Games) | One fixed barricade, survive **20 nights** until rescue [wiki] | The day-hours/night-defense loop itself |
| **The Last Stand 2 (TLS2)** | 2008, Flash | Travel across a state map with a **40-day deadline**; a new barricade in each town [wiki] | Searchable building map, supplies-as-travel-fuel, traps, arming survivors, two endings |
| **Union City (TLS:UC)** | 2011, Flash | Side-scrolling exploration RPG, rooms/streets, horde events, quests [wiki] | Stat/skill tree, weapon attachments/conditions, container looting, weight, noise |
| **Dead Zone (TLS:DZ)** | 2012–2020, Facebook/web F2P | Online compound builder + squad missions, PvP raids [wiki] | Classes, crafting, timers, monetization; shut down 1 Jan 2021 |
| **Aftermath** (2021, not requested) | Steam/console | Roguelite, permadeath runs [review] | Covered only for lessons on repetition |

The part to study is **TLS1 + TLS2**. They are the barricade games. UC and DZ supply the numbers (weapon stat tables, attachment multipliers) and the RPG and progression ideas.

---

## 2. The night defense loop (TLS1/TLS2)

### 2.1 Screen layout and flow
- The player stands **behind a barricade on the left third of the screen**. Zombies walk in from the right edge across a pseudo-3D strip of ground (several depth lanes). The player can move up and down behind the barricade [wiki: glitch notes on moving Jack and getting stuck behind a box].
- Survivors stand behind the barricade next to the player and fire on their own [wiki].
- The night ends when the last zombie of the wave dies. The screen fades, then the day screen opens [wiki: glitch "guns don't fire after last zombie killed / screen fades"].
- When the barricade breaks, zombies walk through and kill the player in melee. A barricade at 0 is effectively game over [wiki].
- **Survivors flee when barricade HP is very low** and come back if the player wins anyway [wiki]. This feedback rule is cheap to build and very readable.
- TLS1 has **no music** at night, only ambience and gunfire. The background sky darkens as the night goes on. Reviewers praised both [review: 30minutegamer].

### 2.2 Barricade
- It is a single HP pool. Known value: TLS2's first town barricade has **80 durability** [wiki: Glendale]. Later towns have their own values, and a bug sometimes carried 80 forward.
- Zombies stop at the barricade and hit it. Fast attackers such as dogs drain it fastest [wiki].
- In TLS2, **weapon-carrying zombies standing directly in front of the barricade can instantly kill a survivor** behind it [wiki]. This is a strong "kill this one first" priority signal.
- Repairs happen during the day, by assigning hours (see §3). **Survivors increase repair effectiveness** [wiki].
- Supplies let you travel in TLS2, and every new town comes with a fresh barricade [review: plujan]. Moving to a new town is a way to reset the barricade.

### 2.3 Zombie roster (barricade-relevant types)
| Type | Behavior | Design role |
|---|---|---|
| Walker | Slow, the bulk of every wave; some walk a little faster [wiki] | Fodder that soaks your attention |
| Runner | Same look as a walker but sprints [wiki] | Priority target, punishes tunnel vision |
| Fat | More HP, bigger hitbox, a bit slower; running fat variant exists [wiki] | Damage sponge, easy to hit |
| Dog | Very fast, low to the ground (hard to hit), **attacks faster**, low HP [wiki] | Fast barricade drain, tests aim |
| Armored (police/soldier) | Vest blocks body shots. **Head (and legs) unprotected**; some have helmets [wiki]. Without headshots one takes "nearly a full clip" [review] | Forces headshots |
| Weapon-carrier | Carries a melee weapon; in TLS2 can one-shot survivors behind the barricade [wiki] | Threat to survivors |
| Rotter (TLS2) | Slowest walk, HP equal to or above fat [wiki] | Slow tank |
| Crawler (TLS2) | **Made when explosives blow the legs off**; faster, hard to see among corpses [wiki] | Side effect of explosives |
| Riot (UC) | Riot shield makes it almost bullet-immune; cannot run [wiki] | Needs explosives, melee or a flank |
| Backpack (UC) | Drops loot on death [wiki] | Reward target inside a wave |

**Weapon drops tied to specific nights (TLS1):** a fat police zombie carries a revolver on night 3, a fat biker a shotgun on night 6, a soldier an assault rifle on night 17 [wiki]. Killing it gives you the gun. These scripted "boss with loot" beats break up the run.

### 2.4 Aim, headshots and accuracy
- Mouse aim. The bullet lands **at a random point inside the crosshair circle**, and the circle size comes from the weapon's accuracy stat. Melee is always accurate [wiki: UC Accuracy]. Skills, the Precision stat and attachments shrink the circle [wiki].
- **Headshots are the core skill expression.** They are "very effective" and **required to beat the final wave** in TLS1 [review]. Bows in TLS2/UC one-shot on a headshot [wiki/tropedia].
- Armored zombies turn this into a rule: body shots do almost nothing, head shots do full damage.
- TLS2 sets a **primary and a secondary weapon before each night** and swaps with a key (spacebar) [wiki: glitch notes]. [recall] Reloading is manual (R) or automatic when the magazine runs dry.

### 2.5 Reload as a design lever
- The **shotgun reloads one shell at a time** for the player (8 loads to refill), but a survivor refills it in one action [wiki: TLS2 Shotgun]. Slow, interruptible reloads add tension.
- The LMG has the **largest magazine (200) and the slowest reload of all weapons** [wiki: TLS2 M249].
- The revolver has high damage, accuracy and one-shots dogs, but a 6-round cylinder, low fire rate and slow reload. "Can leave the barricade vulnerable to swarming" [wiki].
- [recall] TLS2 tracks per-weapon-class skill, so reload speed and accuracy improve with use. No primary source confirmed this. Union City does it with explicit skill points (Pistols, Automatics, Long Guns, etc. raise damage and accuracy) [wiki].

### 2.6 Weapon lists and tiers

**TLS1, in unlock order** [wiki]: Glock 17 (start, low damage, low accuracy, 17 rounds) → .357 (night 3 drop) → UMP45 → Shotgun (8, pump; night 6 drop) → Chainsaw (melee, continuous, "99" fuel) → Sawn-off → Hunting Rifle (bolt, 1 round, high damage) → Uzi (auto, 50, low damage) → M4A1 (night 17 drop) → AK47 (auto, 30, medium damage) → Barrett (semi, 10, very high damage, high accuracy).

Unlocks come from a **search-for-weapons progress bar** that fills with hours spent. Order is fixed, so it is a predictable ladder [wiki].

**TLS2, by town** [wiki]: each weapon lives in **one specific town** (pistols/chainsaw → bow/shotgun → SMGs → sawn-off/rifle → assault rifles/grenades → optional military base: LMG and rocket launcher). Survivors can use any gun except bow, rocket launcher, chainsaw and grenades. Traps: gas cylinder, land mine, bear trap. They are **single-use** and placed before the night [wiki, review].

**Union City base stats** (best available real numbers; accuracy is the crosshair-tightness rating, higher is tighter) [wiki]:

| Weapon (archetype) | Mode | Dmg | Knockback | Acc | Noise | Mag | Wt (lb) |
|---|---|---|---|---|---|---|---|
| Compact 9mm pistol | Semi | 8 | 1 | 6 | 10 | 7 | 1.5 |
| Service 9mm pistol (G17) | Semi | 9 | 2 | 6 | 10 | 17 | 2 |
| M9 pistol | Semi | 10 | 5 | 6 | 10 | 15 | 2.5 |
| .45 pistol (M1911) | Semi | 12 | 10 | 6 | 10 | 7 | 2.5 |
| .45 revolver | DA | 17 | 15 | 7 | 10 | 6 | 1 |
| Burst machine pistol | 3-burst | 9 | 10 | 6 | 15 | 20 | 2.5 |
| Uzi | Auto | 9 | 3 | 2.5 | 15 | 32 | 7.5 |
| MP5 | Auto | 9 | 3 | 3.5 | 15 | 30 | 5.5 |
| UMP45 | Auto | 13 | 5 | 3.5 | 15 | 25 | 5 |
| Pump shotgun | Pump | 12/pellet | 20 | 2 | 40 | 8 | 7 |
| Sawn-off | 2×single | 12/pellet | 16 | 0.5 | 40 | 2 | 4 |
| Auto shotgun | Auto | 5/pellet | 25 | 2 | 20 | 10 | 8 |
| M4A1 | Auto | 10 | 5 | 4.5 | 20 | 30 | 7 |
| AK47 | Auto | 15 | 8 | 5.5 | 25 | 30 | 7 |
| FAL | Auto | 18 | 10 | 5 | 25 | 20 | 10 |
| Bolt hunting rifle | Bolt | 30 | 6 | 5.5 | 20 | 5 | 7 |
| M24 sniper | Bolt | 50 | 8 | 7 | 25 | 10 | 12 |
| .50 anti-materiel | Semi | 60 | 15 | 7 | 20 | 10 | 28 |
| M249 LMG | Auto | 15 | 8 | 5 | 25 | 100 | 22 |
| Hunting bow | Single | 20 | 5 | 6 | **1** | 1 | 4 |
| Grenade (thrown) | Throw | 90 | 30 | 10 | 20 | 1 | 2 |
| 40mm launcher | Single | 120 | 30 | 10 | 25 | 1 | 5 |
| Rocket launcher | Single | 200 | 30 | 10 | 25 | 1 | 15 |
| Chainsaw | Continuous | 10 | 15 | – | 50 | 200 fuel | 15 |
| Kitchen knife / machete / fire axe / katana | Melee | 5 / 20 / 35 / 40 | 2 / 6 / 6 / 6 | – | 0 | – | 1 / 2.5 / 8 / 5 |
| Bat / police baton / sledge | Melee | 10 / 15 / 30 | 40 / 30 / 50 | – | 0 | – | 2 / 2 / 10 |

Patterns worth copying:
- **Damage × fire-rate × accuracy trade-off.** SMGs have low damage and a wide spread, rifles medium damage and tight spread, snipers high damage with a slow cycle.
- **Knockback is its own axis.** Blunt weapons and shotguns push enemies back, which buys barricade time. Blades have high damage and low knockback.
- **Noise** (UC) draws extra zombies. Bows and suppressors are quiet.
- **Attachment/condition multipliers** (UC; one per weapon, fixed when found) [wiki]: Custom Stock acc ×1.25; Scoped acc ×1.45; Extended Mag ×1.5; Military dmg ×1.3 and mag ×1.3; Suppressed noise ×0.3 and dmg ×0.9; Lightened weight ×0.5; Sharpened (blade) dmg ×1.25; Heavy (blunt) dmg ×1.33 and weight ×1.4; Damaged dmg ×0.5 and acc ×0.75; Dull dmg ×0.7. A good model for "found weapon variants".

---

## 3. The day phase

### 3.1 TLS1: a three-slider budget
- **12 hours of daylight** between nights [review: 30minutegamer].
- Three uses: **repair barricade / search for weapons / search for survivors** [wiki, review]. Survivors present make repairs more effective [wiki].
- **Weapon search is deterministic**: a progress bar fills with hours and unlocks the next weapon in a fixed order [wiki].
- **Survivor search is random**, and **survivors can be lost (killed) while searching** for weapons or survivors [wiki]. Spending hours on searching carries real risk.
- Max **6 survivors**. Each comes with a fixed gun by recruitment order (pistol, pistol, pistol, revolver, pistol, hunting rifle) [wiki]. Survivors are pure DPS: you cannot assign them or change their gear.
- One review noted that **several survivors outgun a single stronger weapon** [review]. More bodies beats a better gun, so the survivor search is the dominant strategy.
- A player-guide heuristic of unverified origin: "spend ~7 h/day finding survivors (usually yields ~2), repair as required" [Newgrounds review page]. This points to survivor search being over-tuned.
- Risk: a bad split ends the run. A reviewer died on night 3 "four or five times" [review].

### 3.2 TLS2: a building map plus travel
- **12 daylight hours per day** [review: plujan]. Each town has a map of **buildings with fixed search costs (3–5 h)**. The building type biases the loot: storage gives bear traps, the sheriff's office gives weapons [wiki: Glendale]. Example town: 13 searchable buildings, **46 hours (≈4 days) to clear them all** [wiki].
- Loot types: weapons, traps, survivors, **supplies** (travel fuel). One day of supplies is gathered automatically on every odd-numbered day [wiki].
- **Travel costs days** (first leg: 4 days on foot) and needs supplies. A **40-day global clock** drives everything. Arrive late and you get the bad ending [wiki].
- Max **4 survivors**. They can no longer die while searching, but they can be killed at the barricade by weapon zombies. You **hand them your spare guns** [wiki].
- The critique: the real challenge is the clock, not the shooting, and random search results frustrate [review: plujan].

### 3.3 Genre comparisons for the day phase
- **This War of Mine:** day is spent inside (snipers outside) crafting, cooking, upgrading the shelter and trading. Night is for **one scavenger out** while others **sleep or guard**, and raiders may hit the shelter [search summaries]. Lesson: a survivor's assignment has a cost (fatigue/sleep), and leaving the base undefended has consequences.
- **Sheltered / 60 Seconds!:** 60 Seconds opens with a frantic **timed grab phase** (one minute to collect family and supplies), then a text-driven daily survival loop of ration decisions and expedition events. Sheltered puts family members in stat-driven jobs in a side-view cutaway bunker [recall]. Lesson: a short twitch phase that feeds a longer management phase. Cutaway side-view rooms are readable.
- **Kingdom (series):** a side-scroller where gold buys walls, archers and builders. Enemies come at night from portals, timed to arrive around midnight. **Blood moons** are larger waves that **do not retreat at dawn** [Kingdom wiki/tropes]. Walls are tiered. Lesson: telegraph big nights in advance, and keep upgrading walls as the main sink.
- **They Are Billions:** waves are **announced hours ahead (8 h; 24 h for the final wave)** on a calendar, **noise attracts the infected**, a single breach snowballs, and the **final wave comes from all sides** [TAB wiki/guides]. Lesson: a visible schedule of escalation and loud actions with a cost.
- **Dead Ahead: Zombie Warfare:** a side-view lane defender. **Courage** refills on its own and spends on units. **Rage** comes from kills and spends on specials; at 99 it unlocks a screen-clearing gun. Barrels can be dropped. **Each barricade has more HP than the last**, and a mission is scored in stars by remaining vehicle HP [search summaries]. Lesson: two meters (one passive, one earned by kills) make a satisfying combat economy.
- **Darkwood / Project Zomboid / NEO Scavenger / State of Decay / Mini DayZ** [recall]:
  - Darkwood: day to scavenge, night to **barricade and hide** while an unseen threat probes the house.
  - Zomboid: noise and moodles (hunger, panic, fatigue), and barricading windows with planks and nails.
  - NEO Scavenger: hex-map scavenging with item condition and hard choices under scarcity.
  - State of Decay: survivors with traits and morale, base facilities, and **influence** as currency. Survivors you neglect can leave or die.
  - Mini DayZ: short top-down sessions with tense permadeath loot runs.

  Lessons: survivor **traits and morale**, **item condition**, and **noise** all fit our day phase.

---

## 4. Progression and difficulty curve

- **TLS1:** fixed length (20 nights). Difficulty rises through wave size and type mix: armored soldiers late, a final wave that needs headshots. Weapons come from a fixed ladder plus scripted drops on nights 3/6/17. No meta-progression; reviewers rated longevity 2/5 [review].
- **TLS2:** difficulty grows **per location**. The first town has a **chokepoint, no armored and no weapon zombies** [wiki]. The second-largest city has "the largest hordes in the game" [wiki]. An **optional detour** to a military base costs days but gives the best guns [wiki]. The run ends in a **binary deadline outcome**.
- **UC:** XP, levels, stats and skills; skill books; danger levels per district (up to 25); random horde events whose size scales with district danger [wiki].
- **DZ:** class-based squad (Fighter/Scavenger/Engineer/Recon/Medic), up to 10 survivors, morale, compound structures and crafting. Remembered fondly but **monetized and timer-gated**. The creator called its collapse "the worst 4 years of my life" [wiki quote].
- **Aftermath:** OpenCritic 78. Praised: roguelite freshness. Criticized: "repetitive like a Flash game", few zombie types that behave alike, RNG runs that feel unwinnable, bugs [reviews].

---

## 5. What players loved and hated

**Loved**
1. **A tense, simple core:** a wall, a gun, a crowd. Easy to read in one second.
2. **The day decision:** "do I fix the wall or look for a gun?" is a real trade-off every day.
3. **Headshots matter.** Precise aim pays off visibly, and heads pop.
4. **Atmosphere on a budget:** diary entries that grow more desperate, a darkening night sky, silence instead of music (TLS1); per-location music (TLS2) [reviews].
5. **Weapon ladder dopamine:** every few nights a new tool with a different feel (shotgun knockback, chainsaw, sniper).
6. **Survivors as a visible army:** each recruit is one more muzzle flash on the wall.
7. **Stakes:** a deadline (TLS2's 40 days) and a "made it / didn't" ending.

**Hated**
1. **Random search outcomes** with no mitigation: nothing found after 7 hours [review].
2. **Low replay value:** fixed ladder, fixed length, no variance [reviews].
3. **Unfair early spikes:** a bad hours split on day 1–2 ends the run on night 3, with no forewarning [review].
4. **Bullet-sponge armored enemies** that are tedious without headshots [review].
5. **Losing survivors to an invisible roll** during searching (TLS1). TLS2 removed it.
6. **Bugs:** nights that never end, lost inventory [wiki glitches].
7. **F2P timers and paywalls** in the online sequel (community memory, creator's own remarks).

**Nostalgia hooks** (what makes a player think "oh, this is like that game" without copying it): side view with the barricade on the left; the "Day N" title card into a quiet morning summary; a handwritten-journal day recap; hour-allocation sliders; the clack of an empty magazine; heads popping; a desaturated palette with red as the only saturated color; the armory wall that fills with silhouettes as you unlock guns; a "rescue in N days" countdown.

---

## 6. Pacing numbers (observed or inferred)

| Parameter | Source value | Notes |
|---|---|---|
| Run length | 20 nights (TLS1); 40-day cap (TLS2) | A good target: 15–25 nights, about 60–90 min total |
| Day budget | 12 hours | Allocation unit = 1 hour |
| Search cost per site | 3–5 h (TLS2) | 2–4 searches per day |
| Clear a whole town | ~46 h ≈ 4 days | Pushes the "stay or move" decision |
| Travel leg | 4 days (first leg, TLS2) | |
| Barricade HP (early) | 80 (TLS2 town 1) | Scale per night/location |
| Survivor cap | 6 (TLS1), 4 (TLS2) | Each adds DPS and repair speed |
| Scripted weapon drops | nights 3, 6, 17 | About one "event night" every 3–5 nights |
| Magazine sizes | pistol 7–17, SMG 25–32, rifle 20–30, shotgun 8, LMG 100–200 | |
| Damage ratio | pistol 8–12 : rifle 10–18 : sniper 30–60 : explosive 90–200 | About 1 : 1.5 : 5 : 15 |
| Night length | [recall] about 1.5–4 min, until the wave is cleared | Keep nights short so the day/night rhythm stays brisk |
| First failure | Night 3 is the common wall [review] | Tune so night 3 is the first real test, not a coin flip |

---

## 7. Takeaways for our game

1. **One screen, one wall, one rule.** Barricade on the left, spawns on the right, 2–3 depth lanes. The player moves only along the wall's depth axis. Never let the camera move during the night.
2. **The barricade is the health bar.** Zombies hit the wall, not the player. When the wall hits 0 the night is lost (or becomes a desperate last few seconds). Show wall HP big and segmented (e.g. 100 HP, 4 visible plank tiers that break off).
3. **Crosshair-circle accuracy.** Each shot lands uniformly inside a circle whose radius = base spread × modifiers (stance, skill, attachment). The circle **blooms** with sustained fire and recovers when you stop. Melee is always accurate.
4. **Headshots are the skill ceiling.** Head hitbox ≈ 20% of body height, ×3 damage (×2 for shotguns per pellet). A lethal headshot pops the head. Armored enemies take ×0.2 to the body and full damage to the head.
5. **Every weapon has three or more differentiating axes:** damage, fire rate, spread, magazine, reload time, knockback, noise. Use the UC table as the starting ratio (pistol 10 / SMG 9 at 3× fire rate / rifle 15 / sniper 50 / explosive 120+).
6. **Reload is tension.** A manual reload key plus auto-reload on empty. Shotguns reload per shell and can be interrupted by firing. LMGs have big magazines and painfully long reloads. Show a reload bar on the cursor.
7. **Two weapon slots per night, chosen during the day.** Swap with a key or the wheel. Loadout choice becomes part of planning.
8. **Day = 12 hour-tokens per survivor-day, not a shared slider.** Each survivor is a token placed on a task (Repair, Scavenge, Craft, Search Weapons, Search Survivors, Rest). This puts TLS1's sliders together with TWoM-style per-person assignment.
9. **Make scavenging legible, not pure dice.** Each site shows its hours cost, its loot bias icons (weapon / parts / food / survivor) and a risk tier. Use **pity timers**: every N empty hours guarantees a find. TLS1's progress bar is the model for weapon searches.
10. **Risk is visible and attributable.** Survivors can be **injured**, not silently killed, on risky runs. Death only happens on high-risk sites with a shown percentage. Always say who, where and why.
11. **Survivors are visible DPS on the wall.** Each recruit stands on the wall at night with their own gun and stats (Aim, Repair, Scavenge, Grit), and you can hand them your spare weapons. They **flee below 15% wall HP** and come back if the night is won.
12. **Survivors scale linearly, guns scale in steps.** Cap survivors at about 5. Tune so "one more survivor" ≈ "one weapon tier" and neither strategy dominates (TLS1's flaw).
13. **Wave composition is a budget.** Each night has a threat-point budget (e.g. 20 + 12×night^1.15) spent on types with costs (walker 1, runner 2, dog 2, fat 4, armored 6, brute 10). Specials enter on a schedule: runners from night 2, dogs from 4, armored from 8.
14. **Telegraph big nights.** Show a calendar or radio forecast: "Large horde in 2 nights". Every 5th night is a blood-moon-style surge with a mini-boss carrying a loot drop (the TLS1 night-3/6/17 pattern).
15. **Day 1–3 is a tutorial in disguise.** No specials, a chokepoint, generous wall HP. Night 3 is the first real check, and it must be beatable with any reasonable split.
16. **Knockback buys time.** Shotguns and blunt melee push zombies off the wall. Rifles pierce. Explosives do area damage and **turn walkers into crawlers** (legs gone), which creates a low-profile follow-up threat.
17. **Kill-priority threats.** At least one enemy type each night that punishes ignoring it: runners (fast arrival), dogs (fast wall drain), weapon-carriers (kill survivors on the wall), spitters (damage over the wall).
18. **Noise has a cost.** Loud weapons add a small number of extra stragglers to the current night's queue. Quiet weapons (bow, suppressed) are the efficient choice. This rewards loadout planning.
19. **Repair is the default hour sink, with diminishing returns.** Repair per hour = base × (1 + 0.25 × helpers), and the max HP of the wall rises only through crafted upgrades (planks → sheet metal → spikes), Kingdom-style.
20. **Weapon variants instead of a long gun list.** About 10–12 base weapons, each found with a random condition or attachment (Scoped, Extended, Damaged, etc.) using UC-style multipliers. Crafting can repair a Damaged gun.
21. **Two economies in combat** (Dead Ahead): one ammo pool per caliber that refills from scavenging, plus a kill-earned "Adrenaline" meter that powers one emergency ability (e.g. slow-mo, molotov, survivor rally).
22. **A visible endgame clock.** "Rescue in 20 days", with a seeded run of 20 nights and an optional risky detour that costs days and pays in top-tier weapons (TLS2's military base).
23. **Atmosphere through restraint.** A journal line every morning, the sky gradient darkening as the night goes on, sparse music, satisfying punchy SFX (empty-mag click, head pop). Red is the only saturated color.
24. **Replayability comes from seeds, not length.** Randomize the site list, survivor rolls, weapon variants and night modifiers per run. Add light meta-unlocks (starting perks) to fix TLS1's "no replay" complaint without F2P timers.
25. **Never gate on real time or payment.** Every timer is in-game hours. The online sequel's timers are the series' biggest regret.

---

## 8. References

The Last Stand wiki (Fandom; wikitext pulled via MediaWiki API):
- https://thelaststand.fandom.com/wiki/The_Last_Stand
- https://thelaststand.fandom.com/wiki/The_Last_Stand_2
- https://thelaststand.fandom.com/wiki/The_Last_Stand:_Union_City
- https://thelaststand.fandom.com/wiki/The_Last_Stand:_Dead_Zone
- https://thelaststand.fandom.com/wiki/Scavenging
- https://thelaststand.fandom.com/wiki/Survivor_Companion_(NPC)
- https://thelaststand.fandom.com/wiki/Zombie
- https://thelaststand.fandom.com/wiki/Glendale
- https://thelaststand.fandom.com/wiki/Jonestown
- https://thelaststand.fandom.com/wiki/Supplies
- https://thelaststand.fandom.com/wiki/Traps
- https://thelaststand.fandom.com/wiki/Accuracy
- https://thelaststand.fandom.com/wiki/Weapon_Attachments_and_Conditions
- https://thelaststand.fandom.com/wiki/Glitches
- https://thelaststand.fandom.com/wiki/Shotgun_(TLS2) , https://thelaststand.fandom.com/wiki/M249_SAW_(TLS2) , https://thelaststand.fandom.com/wiki/.357_Magnum_(TLS2) , https://thelaststand.fandom.com/wiki/Compound_Bow_(TLS2)
- TLS1 weapon pages, e.g. https://thelaststand.fandom.com/wiki/Glock_17_(TLS1) , https://thelaststand.fandom.com/wiki/Barrett_(TLS1)
- Union City weapon category (stat table source): https://thelaststand.fandom.com/wiki/Category:UC_Weapons

Reviews and other sources:
- 30 Minute Gamer, TLS1 review: https://30minutegamer.blogspot.com/2010/06/flash-game-review-last-stand.html
- Plujan blog, TLS2 review: https://plujan.blogspot.com/2008/08/last-stand-2-last-stand-2-is-as-you.html
- Softpedia TLS2: https://games.softpedia.com/get/Freeware-Games/The-Last-Stand-2.shtml
- Newgrounds TLS user reviews: https://www-newgrounds-com.newgrounds.com/reviews/portal/375622/2/date/24
- MobyGames: https://mobygames.com/game/34876/the-last-stand , https://www.mobygames.com/game/34877/the-last-stand-2/
- Substack retrospective: https://alfenwylm.substack.com/p/5-zombie-flash-games-i-was-addicted
- Aftermath reviews: https://opencritic.com/game/12337/the-last-stand-aftermath/reviews , https://checkpointgaming.net/reviews/2021/11/the-last-stand-aftermath-review-if-at-first-you-dont-succeed-die-die-again , https://techraptor.net/gaming/reviews/last-stand-aftermath-review , https://www.well-played.com.au/the-last-stand-aftermath-review/
- Kingdom waves / blood moon: https://kingdomthegame.fandom.com/wiki/Waves , https://tvtropes.org/VideoGame/Kingdom
- They Are Billions: https://www.fandom.com/articles/they-are-billions-guide-tips-tricks , https://gamepressure.com/they-are-billions/difficulty-level/zaaaf2
- Dead Ahead: Zombie Warfare: https://www.tvtropes.org/pmwiki/pmwiki.php/VideoGame/DeadAheadZombieWarfare , https://www.touchtapplay.com/dead-ahead-zombie-warfare-cheats-tips-strategy-guide/
- This War of Mine: https://en.wikipedia.org/wiki/This_War_of_Mine , https://www.cheatbook.de/files/this-war-of-mine.htm
- State of Decay shooting skill (trait/skill model): https://stateofdecay.fandom.com/wiki/Shooting
- Project Zomboid reloading: https://pzwiki.net/wiki/Reloading
