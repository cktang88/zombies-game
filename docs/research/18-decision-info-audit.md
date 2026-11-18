# 18 · Decision info audit: what the player needs to know at each choice

Player: *"the UI hides what matters."* The scavenge site menu was the example: it showed only names, though every site has a fixed loot table (`src/data/world.ts` SITES), so the player took loot for luck. The fix (`src/ui/day.ts` `sitePickerHtml`) is a picture picker. It shows each site's main finds, walk time, risk, stock left and a "you need X" tag.

The rule for this audit is the player's: **show only the most important info, based on what players need to know to act well.** For every decision the player makes, it lists:
- what the choice really changes, read from the code, with its numbers;
- what the screen shows at that moment;
- the gap;
- the smallest fix, rated value (H/M/L) × effort (S/M/L).

Method: I read the rendering and sim code at `83ef276` and staged a day-12 save (`tools/stage-save.ts 12`). I then captured the day screen, each tab, the dusk overlay and the deploy screen at 1280×720 in Playwright and checked them at full size. Doc 16 (`16-systems-tradeoffs.md`) already lists each system's costs and tradeoffs in the help ledger. This doc is about the **moment of choice**: is that number on screen where the click happens?

---

## Top 10 (best value for effort first)

| # | Decision | The gap | Minimal fix | V×E |
|---|---|---|---|---|
| 1 | **Who carries which gun** | A survivor with no gun takes one of the **6 wall slots** (`battle.ts setupGuards`: `fighters.slice(0, 6)`) and **does nothing** (`battle.ts updateGuard` returns on `!g.w` before it would shoot or call `meleeGuard`, so they don't swing a hand weapon either). In the staged save, 3 of 6 people were unarmed while 5 guns sat on the rack. The only signs are a dim "unarmed" inside each card's closed fold and "no gun" on the Posts screen, which has no way to fix it. The Today list says nothing. The dusk chip says "6 at the wall". | Add a Today item, "3 unarmed · 5 guns on the rack", that jumps to the first unarmed card. Add a one-click "arm everyone" that hands out the best free gun per person by class proficiency. Change the dusk chip to "6 at the wall · 3 can't shoot". Give the armory "rack" cards a "give to ▾" select. | **H×S** |
| 2 | **Counsel / rest: who is about to break** | At dawn, mood below a person's break line gives a **20 / 45 / 80 %** chance to break (`sim/day.ts breaksTick`). Tier 3 outcomes include desertion with supplies and suicide. Counsel cuts the chance to **×0.35**. The card shows only a coloured mood number; the line is in the tooltip; no odds anywhere; the Today list has no break item (`ui/today.ts openTodos`). The staged save had Ruth at mood 8 and Tinker at 17. | Add a Today item, "Ruth may break tonight · 80% → 28% with counsel", that jumps to the counsel candidate's job select. Add a red "breaking" chip with the % on the card. | **H×S** |
| 3 | **Reading tonight (calendar vs threat)** | The calendar calls every ordinary night "quiet" (`sim/calendar.ts WORD.night`). Right below it, "Tonight **a long one** ●●●●●" (`ui/day.ts`, `threatPoints()>60`). Both were on screen on day 12, so the two signals contradict each other. | Give ordinary nights a size word in the calendar ("light / bad / long") from `threatPoints(day)`, peeked without advancing the RNG, as `renderDay` already does. Keep "quiet" only for nights under 30 points. | **H×S** |
| 4 | **Trap placement and posts at dusk (deploy)** | The dusk overlay shows "What we know" (`director.ts nightIntel`: types per wave, packs, "close before we see them") and tonight's special ("criers"). Then "Continue" opens the deploy screen, which shows **none** of it. The trap cards' "good vs / poor vs" portraits are never matched against what is coming. | Put the intel lines in a strip at the top of the deploy screen. On the kit buttons and in the info panel, outline the "good vs" portraits of types expected tonight (`plan.spawns` types). Pass `plan` into `DeployOpts`. | **H×S** |
| 5 | **Workshop: what to make and how much is enough** | Ammo cards show cost only. Missing: rounds on hand of that type, which carried guns use it, and how many nights that lasts. The Today list's own rule is about **25 shots per gun per ordinary night**, and a tide is about 2–3×. The queue shows a progress bar but no ETA: a crafter makes `3 + 0.9×Crafting` points a day and most ammo is 2–3 points. In the staged save, "Rifle FMJ ×15" and "Soft-points" got the same space as buckshot, though no carried gun takes rifle rounds. | On each ammo card: "have 24 · Darnell's pump · ≈1 night", or "no gun carries this" dimmed. On each queue row: "done by dusk / tomorrow / in 2 days" from `craftPoints` of today's crafters. Sort ammo for carried calibres first. | **H×S** |
| 6 | **Guard posts** | Post effects (step / loophole / runner / roof) show only **after** you pick one: the hint span renders for `cur` only (`main.ts renderPosts`). Picking one post sets everyone else to Firestep, which silently drops the smart defaults (shotgun to loophole, best rifle to roof, handgun to runner; `battle.ts setupGuards`). After night 1, `finish()` saves explicit posts, so the defaults never run again. A 7th fighter sits out without a word. | Show all four post lines under the header, with a "suits: shotgun / rifle / handgun" tag per guard ("Darnell · pump → Loophole ✓"). Keep "auto" per row instead of turning every unpicked row into Firestep. List "sits out tonight: X" when there are more than 6 fighters. | **H×S** |
| 7 | **In-run: when to turn back** | Home is the left edge, at 150 px/s walking, slower when overloaded (−7 % per slot over the cap) or leg-hurt (`expedition.ts` speed). The daylight bar shows light left but not the **walk-home time** from where you stand. The one warning, "The light is going", comes at a fixed 30 s. | Draw a notch on the daylight bar at `(px / speed) / dayMax`: "the light you need to get home". Turn the bar red when daylight is less than walk time × 1.2. | **H×S** |
| 8 | **Strangers at the gate** | `newcomerEvent` (`sim/events.ts`) carries a whole `Survivor` in `data.n`, but the card shows only name, age and backstory: no skills, traits or gun. For the wanderer and ferry arrivals there is a hidden **30 %** bite chance. "Check them for bites" catches every bite at the cost of −10 opinion and −6 mood. The hint says "Strip search in the cold" and gives no odds. | In `eventcard.ts face()`, also read `data.n`: portrait, top 2 skills as pips, traits as chips, "brings: no gun". Hints: "1 in 3 off the road hide a bite. Checking finds it; they resent it." | **H×S** |
| 9 | **Radio and Drill as tonight's intel** | Intel tier comes only from someone on **Radio** (mast built) and someone on **Drill** with Shooting ≥ 3 as lookout (`director.ts intelSources`). Tier 3 needs both, with the lookout at Shooting ≥ 6. The job options read "social 5/10" and "10 rounds, live fire" (`ui/day.ts jobOutlook`). Nothing says "this tells you what's coming". At dusk, "Nobody was on the radio or watching the road" arrives after the day is spent. | In `jobOutlook`, Radio becomes "tonight's numbers" and Drill becomes "lookout: who's coming" when Shooting ≥ 3. Add a Today item on red days with no intel source: "Nobody watching the road before the tide". The dusk "nobody" line should name the fix. | **H×S** |
| 10 | **Wall builds: caps and where to build** | Floodlights work up to **3** (`Math.min(3, G.fort.lights)`), but **every** light burns 0.5 fuel a night (`dawnTick`: `0.5 * G.fort.lights`, uncapped). Wire works up to **3** belts. Nail turrets work up to **2** (`night/emplacements.ts`). A 4th light, 4th wire or 3rd turret (14 work, 10 parts, 20 scrap) is queueable and does nothing, and the extra lights still burn fuel. The Wall tab shows unlabelled counts with no effect numbers and no build buttons; the builds live in Workshop › The wall. | Recipe card: "2/3 · +130 px sight each", disabled at the cap. Wall tab tiles: the number plus one effect line ("3.5 dmg/s each at the face"), with a "+" that queues the recipe from there. | **M×S** |

Next ten, briefly: half rations shown nowhere (§13), a scavenger left on a picked-clean site (§1), hours and gun hidden inside a closed fold (§1–2), Town standings without thresholds (§10), dawn report with no next-night readiness line (§12), unexplained special-night ids like "criers" (§11), proficiency invisible in the gun picker (§2), vests not counted anywhere (§2), building unlocks not shown (§3), and unquantified incident outcomes (§8).

### Code findings for the designer (not UI, but they change what the UI should say)
- **Radio work goes nowhere.** `resolveDayWork` adds to `G.flags.radioWork`, and nothing reads it (grep: one hit). The **Easy talker** (+30 %) and **The voice** (+60 %) perks (`data/perks.ts`, fx `radio`) therefore do nothing. Either wire `radioWork` into `intelTier`, or swap those perks for something real.
- **Repairs don't need timber.** `case 'repair'` adds `repairAmount` to the wall, then takes `min(stores.wood, needed)`. With 0 timber the wall still mends in full. The job hint ("Uses timber"), the systems card and the "you need timber" picker tag all say otherwise. Decide which is right.
- **Half rations starve people slowly.** Fed hunger goes +0.35 × 0.6 − 0.25 = −0.04 a day (`dawnTick`). The event sells it as a mood cost only.
- **The food chip ignores rations and appetites.** `renderDay` shows `−${living().length}`. Real use is `1.6` for big eaters, `0.7` for ascetics and `×0.5` on half rations (`dawnTick`).
- **Scavenge `needs()` flags wood** when the wall is under 60 % and timber is under 8. Given the repair rule above, that tag pushes the player toward a resource that isn't required.

---

## Full audit, decision by decision

Legend: **Needs**: what the code says matters, with numbers. **Shows**: what the screen shows at that moment. **Gap**: hidden, buried (tooltip, fold, another screen), unreadable, or noise. **Fix**: the change, with its V×E.

### 1. Each survivor's job (day screen, every day, per person)
- **Needs** (`sim/day.ts resolveDayWork`, per 8 h × `workMult`):
  - Repair: +40 + 9×Building wall.
  - Workshop: 3 + 0.9×Crafting work points.
  - Food: 1.5 + 0.45×Farming + 2.2×cold-frame level, ×0.6 in frost.
  - Tend wounded: 2 + Medicine wounds; a tended wound heals 0.14/day against 0.05, and an untended cut has a 6 % chance a night to go septic.
  - Scavenge: site table × (0.55 + 0.12×skill) × stock fullness × search-hours factor.
  - Drill: 10 rounds for ×2 XP and the lookout intel.
  - Counsel: 1 person per 4 h, their break chance ×0.35.
  - Radio: intel.
  - Fatigue: 0.03–0.05 rest drained per hour; rest under 0.25 costs −20 % work and −0.06 aim.
  - `workMult` also drops 0.25 when starving and 0.15 when mood is under 25.
- **Shows:** the job select with a per-option outlook ("Repair the wall — +63 wall", "Food — ~5 food"). It's good for repair, food, doctor and craft. A "same?" tag marks carried-over jobs.
- **Gap:**
  - Scavenge reads "skill 5/10", not the haul. The site button now shows finds, but the outlook should say "~6 scrap, 4 timber…".
  - A scavenger left on a **picked-clean** site (fullness floor 0.15) gets no Today warning. The staged save had Tinker on Route 9 at 0/8.
  - Radio and Drill outlooks hide that they're the intel source (Top 10 #9).
  - Counsel says "2 could use it", but not who, or their break odds.
  - The rest left after today isn't shown.
- **Fix:**
  - Scavenge outlook: "~N of the top two finds" from `siteFinds` × multiplier (M×S).
  - Today item: "Tinker's site is picked clean" (M×S).
  - Counsel outlook: "talks Ruth down (80%→28%)" (H×S, with #2).
  - Add "rest tonight 18%" in red to the outlook when it would end under 0.25 (M×S).

### 2. Hours per person (day screen, per person)
- **Needs:**
  - Yield scales linearly with hours.
  - Drain is 0.03–0.05 rest an hour; each free hour gives back +0.04; sleep gives +0.22.
  - Past 8 h they earn grit XP.
  - Under 0.2 rest they get "worked to the bone" (−4 mood); under 0.25, −20 % work and −6 aim the next day.
  - For a scavenger, the walk eats hours first: Corliss is 6 h, so 8 h leaves 2 h of search.
- **Shows:** the 07:00–17:00 strip with −/+ buttons, **inside the closed fold** (`fold(gearPeek…)` in `survivorCard`). The closed line shows the gun, rounds and aim.
- **Gap:** hours are buried. You can't see or change them without opening each card, and the fold's closed line shows gear, not the day plan. The strip's meaning is in a tooltip.
- **Fix:** move the strip and its −/+ into the always-visible job row (one line, about 120 px). Leave mood, skills and gear in the fold (M×S).

### 3. Who carries which gun, melee, ammo type, attachments, armour (day screen fold; Armory tab)
- **Needs:**
  - Only 6 fight (leader plus 5), and an unarmed guard never shoots (Top 10 #1).
  - Class proficiency 0–10 sets reload ×(1.15 − 0.035p), jams ×(1.25 − 0.06p) and guard spread ×(1.1 − 0.025p) (`night/gunplay.ts shooterMods`). A 0 and a 10 differ by about 35 % in reload and about 2× in jams.
  - Rounds of that gun's ammo on hand. Ammo type: hollow-points do +30 % but are useless on Deputy plate; AP rounds ignore plate; slugs pierce and crack plate (`data/weapons.ts AMMO_TYPES`).
  - Vest: wounds ×0.7 (`survivors.ts wound`). The loophole guard and the run leader take the most hits.
- **Shows:**
  - Survivor fold: the gun select reads "Name (cond %)"; then an ammo-type select, a melee select, a proficiency chip for the **held** gun only, the aim chip, and "+ vest".
  - Armory: gun cards with holder or "rack", ammo select and mod slots shown as letters (O M U B S).
- **Gap:**
  - The gun select doesn't show the person's proficiency for each candidate gun, or rounds on hand. You can't see "Pauline: rifle 6, handgun 1".
  - Armory "rack" cards have no assign action.
  - Vests in stock (`G.flags.armorStock`) appear nowhere except as a "+ vest" button inside each fold.
  - Ammo type isn't tied to tonight. Even when intel says Deputies are coming, nothing points at AP or slugs.
  - The mod-slot letters are unreadable.
- **Fix:**
  - Gun options: "Lever .30-30 · rifle 6 · 10 rds" (H×S).
  - Armory rack card: "give to ▾" (H×S, with #1).
  - Armory header chip: "2 vests spare" (L×S).
  - When intel names Deputies, mark AP and slug options with "vs plate" (M×S).
  - Show the slot name on hover-free tap targets: "optic", "muzzle"… (L×S).

### 4. Workshop queue (Workshop tab, daily)
- **Needs:**
  - Work points per crafter-day (§1), and the recipe `work` (`data/world.ts RECIPES`; ammo 2–5, guns 4–12, MG nest 10, turret 14).
  - What is short against carried guns: about 25 shots a gun a night, 2–3× on a tide.
  - Trap kits beyond tonight's placement limit, **2 + ⌊best Building / 3⌋** (`data/traps.ts placementsAllowed`), wait in the shed.
  - Caps: lights and wire 3, turrets 2 (Top 10 #10). The roof nest is one-off.
- **Shows:** recipe cards in folds (ammo open), with an icon, name, cost chips and a "+". The tooltip holds the desc and "N work". The queue lists rows with a progress bar. There's a "ready/total" count per group.
- **Gap:**
  - No stock or need line on cards (Top 10 #5) and no ETA on the queue.
  - Trap cards don't say "you can set 3 a night; 5 in the shed".
  - Caps aren't enforced or shown.
  - Recipes for guns nobody carries sort first, which is noise.
  - Machinery cards don't say what each level unlocks: the "+N locked" tooltip lists names, not which machine opens them.
- **Fix:**
  - Top 10 #5 and #10.
  - Trap group header: "set 3/night · 5 in the shed" (M×S).
  - Machinery card: "unlocks: Flechettes, .22 re-primed, Rifle FMJ…" from `RECIPES.filter(r => r.needs===b.id && r.level===lvl+1)` (M×S).

### 5. Wall builds and defences (Workshop › The wall; Wall tab)
- **Needs** (`night/battle.ts`):
  - Spikes: 3.5 dmg/s per row to each body at the face.
  - Wire: ×0.55 speed in a 90 px belt each, up to 3.
  - Lights: +130 px guard sight and +7 % guard aim each (aim bonus capped at 20 %), up to 3; 0.5 fuel a night each; needs the generator.
  - Turrets: up to 2, eat scrap, need the generator.
  - Reinforce: +60 max wall and +2 to the pile-ramp limit (`pileLimit = 10 + 2×level`).
  - MG nest, swivel and flamer need a crew with heavy training.
- **Shows:** Wall tab has the wall bar, a repairer chip, a timber chip, and icon tiles with counts. Each tile's tooltip has one line ("Wire belts: slow them in the road"). Builds are in another tab.
- **Gap:** the effects are in tooltips without numbers, the caps are hidden, the build action is on another tab, and the tiles have no labels (just faint icons and a number).
- **Fix:** Top 10 #10. Label each tile in a word and give its effect number ("wire 2/3 · slows ×0.55") (M×S).

### 6. Trap kits and where to place them (deploy screen, each dusk)
- **Needs:**
  - What's coming and where. Tonight's spawn types are in `G.nextNight.spawns`, with their packs and "dark" close spawns.
  - Each trap's trigger, lanes, distance band, noise, reuse and good-vs/poor-vs (`data/traps.ts`). Combos.
  - The placement limit (shown).
- **Shows:**
  - A kit palette with counts and a road strip with distance pegs and the pulper line.
  - The info panel: trigger, lanes, band, noise, reuse, upkeep, good-vs and poor-vs portraits.
  - "N / 4 placed", a combo chip, and last night's plan pre-filled.
- **Gap:** what's coming tonight (Top 10 #4). Lanes are never tied to spawn lanes, if the director biases lanes. "Tonight" chips show distance numbers only.
- **Fix:** Top 10 #4. Mark the "good vs" portraits that match tonight with a ring (H×S).

### 7. Guard placement and gun-nest crews (deploy screen, each dusk)
- **Needs:**
  - Step shoots over the wall.
  - Loophole: shotgun shove, but big ones claw that guard.
  - Runner: everyone reloads faster; the runner only shoots what gets over.
  - Roof: +260 px sight, steadier aim, can't angle down at the wall.
  - Fit to gun: shotgun at the loophole, rifle on the roof, handgun as runner.
  - Frayed guards panic on the wall: mood under the break line gives a 30 % chance, under the major line 60 % (`setupGuards`).
  - Nest crew: heavy training.
- **Shows:** a row per guard: name, gun name, a select ("let them choose" + 4 posts) and the hint **for the chosen post only**. For nests: condition, post, crew select with "heavy N", and the niche line.
- **Gap:** Top 10 #6. Panic risk per guard isn't shown, though the night will panic them. An unarmed guard shows "no gun" with no fix offered.
- **Fix:** Top 10 #6. Add a "may panic" tag on guards below their break line (M×S). Add an "arm" select on "no gun" rows (H×S, with #1).

### 8. Leading a run (day screen, daily from day 4)
- **Needs:**
  - Site finds and stock (fixed by the picker).
  - Daylight: 17 s per hour on the street after the walk.
  - The leader works at home until leaving.
  - A companion: +6 pack slots, shoots, can drag you home; they lose their job after leaving.
  - Rest −0.2 for both.
  - A run yields about 2–2.4× a scavenge job before the pack cap (`RUN_YIELD`).
  - The leader can die, and if they fall the game ends.
- **Shows:** the site button (finds, walk, risk, stock), a leave-time select, a companion select ("+ Name", "(unarmed)"), chips, a timeline strip, "9h street · 153s light" and "Go".
- **Gap:**
  - The companion select doesn't show the companion's gun, rounds or wounds, or that their job stops at the leave time; it's in a tooltip.
  - The run defaults to Route 9 even when it's picked clean.
  - The leader's health and rest aren't shown in the panel.
- **Fix:**
  - Default `runSite` to the best non-clean site that has a "you need" find (M×S).
  - Companion options: "+ Darnell · pump 24 · loses Workshop from 11:00" (M×S).
  - Add a leader rest/pain chip to the run panel (L×S).

### 9. In-run choices (run screen)
- **Needs:**
  - Walk-home time against daylight (Top 10 #7).
  - Pack slots per item (`STACK`: food 6/slot, scrap 8, parts 4, a gun 3 slots).
  - Zone loot ×1 / 1.5 / 2.2 against density ×1 / 1.6 / 2.4.
  - Noise heat sends stragglers between you and home.
  - The truck needs 2 fuel and 1 part.
- **Shows:** bars for daylight, health, stamina and heat ("followed"); a street progress line with searched marks and zone borders; "loot ×1.5 · more of them" at borders; the pack row with "pack N/cap" and "overloaded".
- **Gap:**
  - No walk-home marker.
  - When choosing what to drop, the pack doesn't say what the house is short of. The "you need" set from the day screen (`needs()`) isn't carried into the run.
  - The overload slowdown is a ticker line, not a number.
- **Fix:**
  - Top 10 #7.
  - Tint pack items the house needs; show the overload as "−14 % speed" (M×S).

### 10. Event and incident choices (morning modal)
- **Needs:** the real stakes. Examples:
  - Union "Send our best shot": the top shooter is away 5 days for +40 scrap, +80 max wall and +25 Union.
  - County talk: 25 % + 7 % × Social, capped at 85 %.
  - Rations: half rations means 0.5 food each, hunger recovery ×0.6, and −5 mood a day.
  - Raiders' fee: 40 % of a resource.
  - Repair choices name a cost in wood or parts.
- **Shows** (`ui/eventcard.ts`):
  - The hook, a fold for the rest, and choice buttons with a hint line.
  - Consequence icons guessed **by regex from the hint text** (`CONSEQ`).
  - Faction rep change printed **after** the choice (`shiftRep`).
- **Gap:**
  - Consequences are mostly flavour ("It could go either way", "Might work. Might not.").
  - Who goes and for how long is unnamed: "Send our best shot" doesn't name Darnell.
  - Odds are hidden, and the rep delta appears only afterwards.
  - The regex icons misfire. "days" maps to a time icon even when that isn't the stake, and "gun" maps to ammunition.
  - Choices the house can't afford ("We do not have the wood") stay clickable.
- **Fix:**
  - Give `EventChoice` an optional `cost` / `gain` / `who` / `odds` / `rep` and render them as chips instead of the regex guess. Start with the 10 most frequent events, then do the rest (H×M).
  - Disable unaffordable choices (M×S).
  - For newcomers, Top 10 #8.

### 11. Town and faction deals (Town tab; faction incidents)
- **Needs** (`sim/factions.ts`):
  - County ≤ −40 brings warnings, then raiders at night. County ≥ 40 gives an ammo deal.
  - Union gives steel; Parish gives refugees and medicine; the Ferry gives trades and the last crossing (an ending, around days 18–22).
- **Shows:** four names with a word (friendly / warm / unknown / cold / hostile); the description in a tooltip; papers.
- **Gap:** no number, no thresholds, and no "what this standing does for or against you now". The endings tied to standing aren't visible.
- **Fix:** each faction row gets a meter showing the ±40 marks and one line, e.g. "at −40: they come up the road at night" or "+40: rifle rounds offered" (M×S).

### 12. Chores (Wall tab)
- **Needs:**
  - Oil: costs 1 h and a rag or 1 fuel. Unoiled guns jam ×1.7 **only** on cold, snow or the Crossing (`battle.ts` jam roll).
  - Pile: half of last night's bodies carry over and build a ramp; the limit is 10 + 2×wall level. Haul takes 3 h and costs −4 mood; burning takes 1 h and 2 fuel.
- **Shows:** buttons with tooltips. Oil is marked "urgent" in the cold. Pile buttons show "a low heap" or "a ramp by tonight".
- **Gap:** small. On a clear night the oil tooltip still promises "fewer stoppages in the cold" though it does nothing; the "urgent" flag also triggers on `day ≥ 20` regardless of the weather.
- **Fix:** grey Oil out with "not needed tonight" unless the weather is cold, snow or the Crossing (L×S).

### 13. Food and fuel rationing
- **Needs:** half rations come only from an event (`sim/events.ts` 'rations'). They mean 0.5 food each, hunger recovery ×0.6, and −5 mood a day; they end when food passes 5 × people. The stove burns ⌈n/3⌉ fuel on frost nights, ⌈n/5⌉ after day 10.
- **Shows:** a food chip with "−6" (headcount) and a fuel chip with "−2" (stove). The Today list has "Find food · 2d left".
- **Gap:** **no half-rations indicator anywhere.** The food chip shows headcount, not real use. Days of food left ignores appetites. Hunger recovers slowly (+0.35 from eating, −0.25 decay: +0.10 a day when fed), so a "starving" person stays starving for days even with full stores. On half rations it's worse: 0.35 × 0.6 − 0.25 = **−0.04 a day**, so half rations starve everyone slowly, which the event hint ("Mood suffers") never says. Nothing on screen explains any of this.
- **Fix:**
  - Food chip shows real use and a "½" badge while on half rations, with "back to full" as a one-click toggle (M×S).
  - The starving chip's tooltip: "recovers ~10 %/day when fed" (L×S).

### 14. Perks (survivor sheet, at skill 4 and 7)
- **Needs:** the effect in this person's job, and which perk is auto-picked at the second dawn (`autoPerk`).
- **Shows:** a "PERK" tag on the card. The sheet shows two buttons with the name and a % description.
- **Gap:**
  - Radio perks do nothing (code finding above).
  - The auto-pick and its deadline aren't shown.
  - There's no translation into today's numbers, e.g. "Mason: Ingrid's repair +63 → +79".
- **Fix:**
  - Under each option: "for Ingrid today: +16 wall" (M×S).
  - "Picked for her at dawn, day 14: Mason" (L×S).
  - Fix or replace the radio perks (code).

### 15. Counsel, rest, drill, radio (jobs, see §1)
- **Needs:**
  - Counsel picks the people closest to breaking (`resolveDayWork`), up to 1 per 4 h.
  - Drill: 10 rounds per 8 h, XP ×2 live, plus heavy XP while a nest exists.
  - Radio needs the mast and drives intel (and the Guard thread).
  - Rest: +0.4 rest and +3 mood.
- **Shows:** outlook strings ("2 could use it · counsel 3", "10 rounds, + gun nest", "social 5/10", "sleeps it off").
- **Gap:** see Top 10 #2 and #9. Drill doesn't say what it costs in **nights** of that ammo.
- **Fix:** Top 10 #2 and #9. Drill outlook: "10 of 24 buck (~half a night)" when that ammo is short (M×S).

### 16. The night itself (battle)
- **Needs:**
  - Firebomb: puts a crowd at the wall in fire; burns the pile.
  - Rally: banked from a 5-headshot streak. It lasts 4 + 0.4×Social seconds and gives +0.25 aim, +20 nerve, faster guard fire, and ends panic.
  - Sally: 7 s on the road and 12 nerve, 22 s cooldown. Bodies in reach get a 45 % bite chance every 1.1 s. It re-sets bear traps, snares and deadfalls and loots rounds.
  - Focus: time ×0.6 and spread ×0.4, at **20 nerve a second** (real time).
  - Reload: the mag is shown; dropped mags come back only if the wall holds.
  - Lane: `laneQ` per lane; the pile ramp.
  - Guard orders.
- **Shows:** the wall bar, mag and reserve, the ammo type, a nerve bar with "focus/nerve" and "rally ×N", and up to 6 context keycaps:
  - reload when the mag is under 30 %;
  - rally when banked;
  - firebomb when 4 or more are at the wall;
  - sally when ready;
  - guard orders when a guard is selected.
- **Gap** (the night is the best-covered screen):
  1. Guards don't show "dry" (out of rounds) or "no gun". A guard silently stops being useful.
  2. Pile-ramp danger is a single ticker line ("The bodies are piling…"); there's no per-lane marker.
  3. Focus cost isn't stated; the bar drains visibly, which is fine.
  4. Sally's bite odds aren't shown, but "7 s" is a clock, which is fine.
- **Fix:**
  - Guard label states "dry" (red) and "no gun" (M×S).
  - A pile meter on each lane at the wall face, filling toward `pileLimit` (M×M).

### 17. Dawn report (after each night)
- **Needs** (to do better tomorrow):
  - What did the wall damage (type and lane).
  - Who got hurt and how badly.
  - Which traps paid off.
  - Ammo left against tomorrow, especially before a tide.
  - Whether the pile carries over.
- **Shows:** the headline, deaths, the tally (killed, headshots, rounds, wall lost), the wall bar, rounds spent by type, the MVP, a **folded** night log (trap retrieval, pile, salvage, mods worn) and a teaser.
- **Gap:**
  - Everything actionable is in the fold or absent.
  - No "ready for tomorrow" line, so it doesn't tell the player what to do differently.
  - Wounds from the night aren't listed; they appear later as card chips.
  - Spent traps are only in the log.
- **Fix:** a three-line "For tomorrow" box under the tally (H×M; the wall-damage-by-type part needs a tally in `battle.ts`):
  - "Rounds: buck 24 → ~1 night; tomorrow is a TIDE";
  - "Hurt: Ruth (gash, bleeding) → Tend wounded";
  - "Pile: a ramp by tonight → burn it".

### 18. Recruiting and accepting strangers
- **Needs:** skills, traits, gun, bite chance (30 % for road arrivals), and mouths against food days. In the run, a found survivor follows you home without a choice.
- **Shows:** backstory text only.
- **Gap and fix:** Top 10 #8. Also add "food: 14 → 2 days with them" to the "Let them in" hint (M×S).

### 19. Dusk overlay (between day and deploy; no choice, but it's where the night's info appears)
- **Shows:** the plan label, a raw `plan.special` id as a chip ("criers", "the usual"), wall, guards, rounds, intel, the day's work in folds and the teaser.
- **Gap:**
  - "criers" etc. aren't explained (tooltip: "What the road is sending tonight.").
  - The guard count includes people who can't shoot or who sit out beyond 6.
  - The rounds chip sums all carried calibres, which hides a single dry gun.
- **Fix:**
  - Map each special to a one-line meaning ("Criers: keening ones that call more; kill them first") (M×S).
  - Guard chip from the real 6 armed (Top 10 #1).
  - A rounds chip per carried calibre, red when under 25 per gun (M×S).

---

## Noise worth cutting at these moments
- **"same?" tags on every card** after day 1, plus the carry-over banner, plus the "Check N jobs" Today item: three signals for one fact. Keep the banner. Make the tags appear only after the first dusk press (`duskArmed`).
- **Crafting list sorted by affordability, not need.** Unused calibres get the same prominence as the one about to run dry.
- **The armory mod-slot letters** (O/M/U/B/S) beside every gun: they look like controls, read as nothing, and the slots are rarely changed.
- **Event consequence icons from regex**: when they misfire they mislead. Better no icon than a wrong one.

## Screens captured for this audit
Day 12 save, 1280×720: day (event closed), Workshop, Wall, Armory, Town, a survivor's open fold, the dusk overlay and the deploy screen. The unarmed-guard, picked-clean scavenger, calendar-contradiction, break-risk and deploy-without-intel findings were each confirmed on screen, not only in code.
