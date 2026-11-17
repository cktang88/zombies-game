# 06 — Design principles, loops and a fun audit

Scope: what lifts the best survival, defense and roguelite games above "run and gun", the design principles behind that, a candid audit of VESSEY's current loops **outside** moment-to-moment combat, and a prioritized backlog. Night-combat tactics (anatomy, enemy roles, guard orders, deployment, scouting intel, rally) are covered in [05 — Combat depth](05-combat-depth.md) and are only referenced here. Earlier docs: [01](01-last-stand-and-genre.md) (Last Stand/genre), [02](02-rimworld-emergent-story.md) (emergent story), [04](04-depth-and-readability.md) (readability).

Code read for this audit: `src/main.ts` (title → day → dusk overlay → night → dawn overlay → day), `src/ui/day.ts`, `src/sim/day.ts`, `src/sim/director.ts`, `src/sim/newgame.ts`, `src/data/world.ts`, `src/night/expedition.ts`, `src/night/battle.ts`.

---

## 1. Lessons per game (mechanism → why it is fun)

**Project Zomboid.** *"This is how you died"* is on screen at the start of every run, so death is certain and the only question is how long you last. Noise is the central resource: every action has an audio radius that pulls the dead. Moodles are small, stacked, glanceable status icons. → The player plays to **delay** the end rather than avoid it, which makes every small win (a quiet hammer, a found can) feel earned. Noise turns any action into a risk calculation. VESSEY already has noise at night and on runs. What it lacks is noise **on the day screen** (building, crafting and a generator should be loud).

**State of Decay 2.** You have a community, not a hero. When your character is tired or hurt you switch to someone else, and each survivor has one "hero" ability. **Legacy**: completing a leader's goal unlocks **boons** that carry into the next community (you pick up to two). → Because your avatar is replaceable, losing one hurts without ending the game. Boons give a lost or finished campaign a reason to exist. VESSEY has the replaceable leader; it does not carry anything forward.

**This War of Mine.** Day and night are inverted: snipers keep you in by day, so you craft and manage; at night you scavenge with one person and a small backpack. Moral content lives *in the scavenging*: the elderly couple's house, the hospital. → The **backpack limit** is the whole push-your-luck game, because every slot is a choice between medicine and food. Moral weight comes from systems (hunger, guilt) rather than from cutscenes. VESSEY's runs have no carry limit, and its "Kin at the table" is a lone mood penalty.

**Dying Light.** Daylight is for exploring and night is for terror. Night gives **double XP** and removes the death penalty, and Volatiles see in the dark. → Risk inversion: the same map is worth more when it is more dangerous. Critics note a weakness: little *content* is night-only, so many players simply sleep through it. A risk is only interesting if its reward is worth it.

**Days Gone.** Hordes are environmental puzzles that you scout and then prepare for with traps, chokepoints and fuel. Fuel and bike repairs are the tax on your mobility. → Preparation plus a set-piece pays off planning. (Covered in 05 §8 as deployment.)

**The Last of Us.** Shared ingredients (rag + alcohol → medkit *or* molotov) and crafting **in real time** under threat. → Scarcity makes every craft an *or*, never an *and*. In VESSEY, scrap and fuel already pay for almost everything (ammo, traps, fortifications). That only matters if the stock is actually short.

**Left 4 Dead (AI Director).** Booth's GDC 2009 slides list "dramatic anticipation, structured unpredictability, adaptive dramatic pacing". The Director tracks each player's *emotional intensity* and enforces relax periods after peaks. → The pacing reacts to how the players are actually doing, not to a fixed curve. Peaks feel earned because there are valleys. VESSEY's director adapts across nights. Inside a night it has three fixed surges and does not respond to the player's state.

**Dead Rising.** A 72-hour clock in which every rescue and case file has its own timer, and you cannot do everything. → **Opportunity cost** is the fun. Players either love it or hate it (DR4 dropped it). The lesson is to make time scarce, but make it legible and forgiving, and let players see the cost before they pay it.

**Zombie Night Terror / Undead Horde.** You play the horde, and the tools are verbs (mutate, sacrifice) applied to crowds. → Inverting the fantasy produces puzzles. For VESSEY the useful lesson is limited to crowd readability (doc 04).

**7 Days to Die.** A **blood moon every 7th day**, a known date with a red sky in the build-up. → The single most effective structural hook in the genre. Days 1–6 *mean something* because day 7 is coming. Everything you do is preparation, and you can count down to it. A fixed and known schedule beats a hidden spike.

**They Are Billions.** Fixed, announced waves on a clock ("the horde arrives in 3 days") plus a single breach = loss. → The clock turns the economy into a race. Being too greedy (expanding) and too timid (not enough economy) both lose.

**Frostpunk.** Hope and Discontent are two bars. The **Book of Laws** offers irreversible, double-edged laws ("child labour", "extended shifts"); the designers deliberately made the "right" choice neither too costly nor too cheap. → Policies are **persistent decisions with costs that show up later**. Critics note the optimal path drifts authoritarian, which contradicts the theme, so test laws for a dominant line. Frostpunk's "storm" deadline is VESSEY's Nov 28 ice.

**Darkest Dungeon.** Stress is a second health bar. At 100 the hero takes an affliction or virtue check. The Hamlet requires you to rotate heroes (they need stress relief), and there is a roster of disposable people you nonetheless remember. → Agency loss is acceptable when it is **telegraphed** (the stress bar fills where you can see it) and **attributable**. Weekly roster rotation makes managing people the meta-game. VESSEY already copies the resolve roll. It lacks the *reason to bench someone* (in DD a stressed hero is useless; in VESSEY a low-mood survivor still works the same job).

**FTL / Into the Breach.** FTL: a beacon map with sector choices (nebula, store, hostile), a rebel fleet that advances every jump (a **pursuer clock**), and events whose options unlock based on crew and equipment ("blue options"). Into the Breach: enemies **telegraph** exactly what they will do, so "every death felt like your own fault" (Justin Ma). → The route is a choice, the clock forces you to move, and gear and crew open new options in events. Blue options are an ideal fit for VESSEY's incidents (a nurse opens the medical choice; a Union member opens the Local 41 deal).

**Slay the Spire.** A branching map with node types (elite = risk/relic, rest = heal *or* upgrade, shop, unknown). Card rewards always offer **3 options and a skip**. Ascension levels add one modifier each. Mega Crit balanced from metrics on every run (GDC 2019). → Every node is a risk/reward choice you can read in advance. "Skip" makes deck *thinning* a decision. Ascension adds endless difficulty one step at a time.

**Kingdom Two Crowns.** You move along a single horizontal strip, with no HUD and no text. Coins buy everything. **Blood moons** are announced by music and a red moon. Greed waves escalate. → A 2D side-view can carry a whole strategy game when every investment is *visible in the world*. Players scout the moon to plan. This is the closest structural cousin to VESSEY's side-view.

**Don't Starve.** Seasons are dangers you know are coming (winter, the hound waves on a timer with an audio warning). Characters have one strong perk and one quirk. → Learning the world's rules *is* the progression. Knowledge persists across runs even when nothing else does.

**NEO Scavenger.** Tiny inventory and harsh encounter text with many skill-gated options (Melee, Botany, Eagle Eye). → Every encounter checks your build. Your character's traits matter in *text* decisions as well as in combat.

**Hades.** Death returns you to the hub, where **new dialogue** reacts to *how* you died. Persistent currencies (Darkness, Keys, Nectar) buy permanent upgrades and relationships. Kasavin: "if the player doesn't forget their deaths... so should the protagonist". → Failure moves the story forward. Each run ends with progress, which removes the sting of "I wasted an hour".

**Vampire Survivors / Brotato.** A level-up pick every ~20–40 s (choose 1 of 3–4), evolutions that combine two items, density that keeps escalating, and wave-end shops (Brotato). → Constant small rewards, plus a *build* that comes together inside a single session. The power fantasy arrives late in each run, so runs are worth finishing.

**Wildermyth.** At campaign end, survivors are promoted into a **Legacy**. They can return in new campaigns as younger versions with their scars, lost limbs and some abilities intact. → The roster becomes a cast across many playthroughs. For a game whose pillar is "every survivor is a person" (DESIGN §2), this is the meta-progression that fits.

**RimWorld.** Covered in doc 02. Tynan Sylvester describes it as a story generator, with apophenia doing most of the narrative work.

---

## 2. Principles distilled (checklist)

Sources: Meier GDC 2012; MDA (Hunicke, LeBlanc, Zubek 2004); Nijman "Art of Screenshake" (INDIGO 2013); Jonasson & Purho "Juice it or lose it" (GDC EU 2012); Swink *Game Feel*; Booth GDC 2009; Sirlin; Hodent GDC 2016; Sylvester; Csikszentmihalyi.

**Decisions**
- [ ] **Every recurring decision is interesting the 10th time, not just the first** (Meier). If one answer always wins, automate it or delete it.
- [ ] **Trade-offs, not upgrades.** A good decision trades one axis against another: short term vs long term, safety vs yield, this person vs that one (Meier: customization, trade-offs, short- vs long-term).
- [ ] **No dominant strategy** (Sirlin): many options must stay viable. Differentiate options by *kind*, not by size ("orthogonal unit differentiation"). Twenty-three ammo types that differ only in ±damage add breadth without depth.
- [ ] **Information before commitment.** Show the cost, the risk and the odds before the click (Into the Breach telegraphs; StS node icons). Hidden math such as `campWealth()` raising threat is a *fake* decision until it is shown.
- [ ] **Opportunity cost needs a budget**: time, AP, carrying capacity, people. Without a budget there are no choices, only a checklist.

**Loops and pacing**
- [ ] **Name the loops**: moment (seconds), encounter (a night or a run), session (a day cycle), campaign (to the ice), meta (across campaigns). Each loop needs its own goal, feedback and reward.
- [ ] **A known clock beats a hidden spike** (7DtD, They Are Billions, Kingdom). Scheduled peaks give everything in between a purpose.
- [ ] **Tension curve with valleys** (Booth): build-up → peak → enforced relief. The relief must be *usable* for building, grieving and planning.
- [ ] **Flow**: challenge should track skill. Ramp complexity as well as numbers. New threat types should arrive with one-line explanations.
- [ ] **Push-your-luck needs three things**: a growing pot, a growing risk, and a *voluntary* cash-out (FTL jumps, TWoM backpack, StS elites).
- [ ] **End sessions on a hook** ("one more day"): tomorrow's teaser should be shown *before* the save point.

**Feedback and feel**
- [ ] **Juice is maximum output for minimum input** (Jonasson). Layer screenshake, hitstop, camera kick, particles, sound pitch variation and permanence (corpses and casings stay) (Nijman). Juice the **UI** too: tween numbers, stamp results, play a sound on every gain and loss.
- [ ] **Game feel = real-time control + simulated space + polish** (Swink). The polish layer is perceptual, and it is what makes the same rules feel convincing.
- [ ] **Readability first**: if a cause cannot be seen, the player cannot learn from it (doc 04; Hodent's perception and attention limits).
- [ ] **Attribution**: every loss should be traceable to a decision ("Jo died because nobody tended her leg on day 9").

**Meaning and replay**
- [ ] **MDA**: design from the target aesthetics backwards. For VESSEY these are *Narrative*, *Challenge*, *Fellowship-with-NPCs* and *Submission to grief* (DESIGN pillars).
- [ ] **Emergent story = characters + systems + pressure + memory** (Sylvester). Memory has to outlive the run.
- [ ] **Replay value comes from variance plus mastery plus persistence**: seeds and modifiers (variance), learnable rules (mastery), and legacy (persistence).
- [ ] **Onboarding**: teach one verb at a time, in context; reduce cognitive load; make first success fast (Hodent).
- [ ] **Failure should move something forward** (Hades). A loss that teaches nothing and carries nothing forward is wasted time.

---

## 3. Fun audit of VESSEY's current loops

Combat feel and night tactics are out of scope here (see 05). Everything below is the layer around the night.

### 3.1 Moment-to-moment outside combat (day screen, runs)

**The day screen is a spreadsheet with a dusk button.**
- Jobs persist between days (`s.job` is never reset), and dawn does not prompt for a re-plan. After day 2 the optimal input is usually **Enter** (`installKeys` binds it to dusk). The day screen literally lets the player skip the day.
- The `jobOutlook()` previews are good feedback, but they turn each job into a visible number with no cost. The dominant assignment is obvious: best builder on Repair until the wall is full, best crafter on Workshop if the queue is non-empty, best farmer on Food, everyone else on Scavenge. No job competes for a *shared* resource except people.
- **Repair is a dead decision most days.** `repair` heals `40 + 9·building` HP for ~1 timber per 25 HP. At 300 max HP that refills most of a typical night's damage, and timber is plentiful (25 at start, 6 per Route 9 trip).
- **Rest** has almost no reason to exist. Low rest only reduces the work multiplier slowly, and mood is not tied to rotation the way Darkest Dungeon stress is.
- **Radio** produces `radioWork` with no visible payoff on the day screen (05 §9 gives it a purpose through scouting intel; this doc relies on that).
- There is **no spatial or temporal representation of the day.** The six tabs (workshop, wall, armory, town, chronicle, graves) are lists. Nothing happens in the world while you choose, and nothing animates when the work resolves; it collapses into a dusk text overlay.

**Scavenge job vs lead a run: the run dominates.**
- A run has roughly 8–12 spots (`x += 300–520` over 3.6–5.3k px). Each spot yields `0.55 × 0.65 × (0.6 + 0.08·skill) × spotLoot` of the site table. Summed, that is ~3–4× the site table at average skill, against ~0.9× for the auto-scavenge job (`0.55 + 0.12·skill`). Runs also roll for papers at 22% per spot and can find weapons and survivors.
- The leader therefore runs **every** day once the player is confident. The only cost is the leader's job slot, plus the risk of the leader dying. That risk is mitigated by control: the player can always walk left.
- **The run's push-your-luck is incomplete.** The pot grows (more spots) and the risk grows (daylight). But there is **no carry limit**, no escalation as you go deeper (risk is flat per site), and no reward for going deeper beyond "more spots". The cash-out is implicit (walk left). Every searched spot is +EV until the timer runs low, so the optimal play is "search everything, leave at 30 s". That is a solved routine.
- The 150 s daylight is unrelated to the strategic calendar. A run does not take time *from the house*. It costs one job slot, which Rest or Radio could have used for free anyway.

**Crafting: breadth without scarcity.**
- Ammo is cheap: 30 pistol rounds for 3 scrap + 1 fuel, and the player starts with 130. With 23 ammo variants, most recipes are a ±damage variant of another (hollow-points vs FMJ). This is quantitative, not orthogonal, differentiation.
- The queue is FIFO and completes in dusk text. Crafting is a *one-time unlock* decision (build the forge, then wire, then spikes), not a recurring one. After machinery is built, "queue the same three things" is the dominant routine.
- **Wealth raising threat** (`campWealth()` → `threatPoints`) is a genuinely good tension: hoarding draws the dead. It is **invisible**, though. The UI only says "Tonight feels like a long one", so the player cannot trade on it. As things stand it is a fake decision.

**Incidents are the best decisions in the game.** About 22 incidents in `events.ts` (`INCIDENTS`) have choices, people and consequences, and the spotlight weighting is good. Two weaknesses: choices rarely check **who** is in the house or **what** you own (no FTL "blue options"), and outcomes are told rather than shown.

### 3.2 Daily loop (dawn → day → dusk → night)

- The **pacing between screens is front-loaded with reading**. The dawn overlay is a text wall of 6–15 lines; then the day screen shows the same report again in the right column; then a dusk overlay; then the night. There is no celebration of a good night (kills, headshots and wall HP are a single sentence) and no ceremony of loss beyond a line.
- **Forecasting is thin.** `forecast()` only warns ≤2 days before a tide peak, with the flavour line about barking dogs. The real night label comes at **dusk**, after all decisions are locked. The player prepares blind every day except tide-eve. Compare 7DtD, where the date is always known and the sky turns red.
- **The weekly tide rhythm exists in the director (Long Siege cycle peak ×1.55) but not in the UI.** No calendar shows "tide in 3 days", so the most powerful structural hook is hidden.
- **There is no daily objective.** Survival is the only goal. Without a small "today" goal (find insulin for Earl; get the generator running before the tide), days blur together.

### 3.3 Run/campaign loop (to Nov 28)

- The **ice deadline is great framing**, with a countdown in the header. The Crossing (night 23, ×2.2) is a real climax.
- But **the campaign has no defined win**. After the ice, "the game continues as long as you can hold" at ×1.35 threat forever. There is no end-of-run score and no "you made it to December" resolution that rewards the player and closes the story. The memorial only exists on game over. Kingdom and They Are Billions end on the big wave; Frostpunk ends on the storm and then judges you ("The city survived. But was it worth it?").
- **There is no mid-campaign arc**: no factions with quests (the roadmap lists them as unimplemented), no escalating sites that open as goals (Corliss unlocks on day 12 with no reason to go except loot), and no long-term project such as "build a boat", "radio the Guard" or "get the generator to the mast".
- **Difficulty ramps only in numbers** (threat formula). Complexity comes only from new Turned types by `minDay`, so mid-game nights feel like bigger early nights (05 addresses this inside the night).

### 3.4 Meta across runs

- **Nothing persists.** `clearSave()` on new game; no unlocks; no legacy roster; no achievements; the seed is random and hidden; no daily challenge; persona choice is the only variance setting. The graves and chronicle, the game's emotional payload, are discarded on "Begin again".
- Replay therefore relies on procedural variance alone (names, traits, incidents). That gives roughly 2–3 interesting campaigns before the structure feels known.

### 3.5 Missing feedback and juice (non-combat)

- Day UI: no number tweening, no resource gain/loss floaters, no stamp or sound when a craft completes, no visible wall state in the world, no portraits reacting to mood.
- Dawn: no count-up of the night's kills, no "best shot" or MVP, no named moment ("Marla held the left side alone"), even though the data exists in `NightResult` and tales.
- Runs: loot pickup is a text toast. There is no inventory visual, no "heavy" feel, and the walk home does not escalate.
- Night (only items not covered by 05): `battle.ts` has `shake` and `slowmo` (used on special events) but **no per-hit hitstop**. Headshots get `headpop` audio and particles but no frame freeze or kick.

---

## 4. Prioritized backlog

Effort: **S** ≈ <150 lines/1 day, **M** ≈ 150–400 lines, **L** ≈ 400+ lines or new screen. Ordered by fun gained per effort; dependencies noted. "05-#n" refers to the combat-depth spec items.

### 1. The Day Budget: hours, not just job slots — **M**
Give each day **10 hours** of daylight (07:00–17:00), shown as a clock strip under the header.
- Every survivor still has a job, but jobs now cost **hours** and some are split: Repair 4h blocks (max 2), Workshop by recipe work (1 work = 1h at skill 5), Scavenge site = travel (Route 9 1h, Mill 2h, Corliss 6h round trip) + 3h search.
- **A run costs the house time.** The leader leaving at 09:00 with 6h of daylight means the run's daylight is `hours×25 s` (6h → 150 s, the current value). Leave later and the run is shorter. Runs to far sites eat most of the day.
- Hours not spent turn into **Rest** automatically, so rest becomes a consequence rather than an option.
- UI: `src/ui/day.ts`, with a Gantt-like strip per survivor card (drag ends to allocate) and a default auto-fill so it is never mandatory micromanagement. Sim: `src/sim/day.ts::resolveDayWork` scales yields by hours. `src/night/expedition.ts` constructor takes `daylight`.
- Why: it creates the opportunity cost that §3.1 shows is missing (Dead Rising, TLS1's 12-hour split from doc 01 rule 8). It also connects runs to the house.

### 2. Tide calendar and blood-moon telegraphing — **S**
- A **7-day calendar strip** in the day header (days until ice, plus the persona cycle) with icons: tide (red moon), fog odds, crier risk, Crossing. For The Long Siege, tides are fixed on days 6, 13, 20 (`cycle` index 5); show them from day 1. The Quiet shows a soft band ("sometime days 6–8"). The Coin shows "?" (that is its identity).
- Escalating omens: 3 days out, a radio line; 2 days out, the sky tint on the day background goes red-brown (`bg_far` overlay); tide eve, music stinger and a "dogs barking" SFX on dawn.
- Show the **wealth→threat** link: a "noise/smell" meter beside the stores ("The house smells of woodsmoke and cooking: +12% tonight"), computed from `campWealth()`.
- Files: `src/sim/director.ts` (`forecast()` → return structured `{day, kind, certainty}[]`), `src/ui/day.ts` header, `src/audio.ts` stinger.
- Overlap: **05-#9** sets *what* the night contains via intel tiers. This item covers *when* the big nights are. Do this first, since 05-#9 reads better on top of it.

### 3. Runs as real push-your-luck — **M**
- **Pack capacity**: 12 slots, plus 4 with a duffel (craftable: cloth 6). Loot is in stacks (10 pistol rounds = 1 slot, 1 meds = 1 slot, 1 gun = 3 slots). When the pack is full, you choose what to drop (TWoM).
- **Depth bands**: the street has 3 zones split by landmarks (a bridge, an intersection). Each zone increases loot ×1.0/1.5/2.2 and sleeper density ×1/1.6/2.4; the last zone has a guaranteed "cache" spot (a locked gun cabinet or pharmacy cage) that takes 6 s to search and is loud.
- **Noise heat**: the existing `noise` meter now *persists*. At 2+ noise, a straggler spawns behind you (between you and home) every 20 s.
- **Cash-out points**: a car you can hotwire (parts 1) at the zone 2 boundary gives an instant exit with the pack intact.
- Death = pack lost (as now), but **the leader can be "downed and dragged home"** if a companion came (see #8). Otherwise the outcome is the current death.
- Files: `src/night/expedition.ts` (build zones, pack UI at the bottom HUD, drop dialogue), `src/data/world.ts` (cache tables per site).
- Re-tune the run multiplier from ~3.5× job to ~2× (to fix the dominance in §3.1). The upside lives in zone 3.

### 4. Juice pass: night hits and the dawn ceremony — **S/M**
- Night (no overlap with 05's mechanics, only feel): **hitstop** of 40 ms on headshot kills and 70 ms on Ferryman or Deputy kills (skip `update` for N ms but keep drawing); **camera kick** 3–6 px opposite the shot direction on heavy guns; screenshake capped at 10 px with exponential decay, and an option in `src/ui/settings.ts` to reduce it; a **kill-confirm tick** (pitch +5% per kill within 1.5 s, reset after); gib chunks that stay on the road (permanence, Nijman); a white 1-frame flash on headshot sprites. Files: `src/night/battle.ts`, `src/audio.ts`.
- Dawn: replace the text overlay with a **ledger card** that animates: kills count up (0.8 s), headshots stamp, wall HP bar drains to its final value, ammo spent ticks down, and **"The night belonged to…"** names the survivor with the most kills or a saved-the-wall tale, with portrait. Deaths get a black-bordered card first, with a 1.2 s pause and a bell. Files: `src/main.ts::dawn`, new `src/ui/ledger.ts`, `src/style.css`.
- Day UI: resource deltas float from the store icons (+12 timber, green; −3 scrap, red) when a craft or build happens; a craft-complete stamp; CSS transitions on mood bars. Files: `src/ui/day.ts`, `src/style.css`.

### 5. Daily "one more day" hook — **S**
- After dawn resolution, before saving, show **tomorrow's teaser**: the next incident's title only ("Someone is signalling from the Legion hall roof"), or a promise from a radio thread (#6). It is drawn at dawn (`rollIncident` already runs at dawn); add `G.teaser` and roll one day ahead.
- Make **dusk** the session break, not dawn: autosave at dusk with "Tonight: tide. 4 at the wall. 212 rounds." That puts the cliffhanger on the save screen.
- Files: `src/main.ts` (`dawn`, `dusk`), `src/sim/events.ts` (pre-roll).

### 6. Radio threads: multi-day objectives — **M**
- 4–6 **threads**, each a chain of 3–4 incidents over ~5–8 days with a clear goal, deadline and reward:
  - *Earl's insulin*: a voice on the CB, a diabetic at the Manor; fetch 2 meds by day N+4 via a run to Rexall → a doctor survivor joins.
  - *The Guard's frequency*: get the radio mast to L2 and work Radio for 3 days → Corliss intel, and an airdrop of 5.56 on day 18.
  - *Peltier's last trip*: deliver 20 fuel to the boathouse before the ice → an evacuation seat for one survivor (an *epilogue* choice: who leaves).
  - *Local 41*: rebuild their generator (parts 10) → steel trades.
  - *The Parish*: give food weekly → standing → they take in your wounded.
- Active threads show in a "Radio" panel on the right column with a countdown, so the day has a goal (Dead Rising scoops, but forgiving: missing a deadline fails the thread with a story consequence rather than a game over).
- Files: `src/sim/events.ts` (thread state machine `G.threads`), `src/ui/day.ts` panel, `src/data/lore.ts` (text), plus faction standing (existing `rep()`).
- This gives Radio jobs, factions and Corliss a *why*. It implements the roadmap's "faction quests".

### 7. Survivor specializations on level-up (build variety) — **M**
- When a skill crosses 4 and 7, the survivor gets **one pick out of 3 perks** (Vampire Survivors cadence, StS "skip" allowed). Perks are orthogonal verbs, not +%:
  - Shooting 4: *Spotter* (marks a target; guards focus it) / *Steady* (no bloom on the first shot after 1 s) / *Brawler* (shoves knock down at the wall).
  - Building 4: *Jury-rig* (repairs during the night, 1×) / *Salvager* (repairs refund scrap) / *Sapper* (+1 deployment slot, ties to 05-#8).
  - Medicine 4: *Field surgeon* (amputation on runs) / *Triage* (tending also stops infection progress for 1 day) / *Bedside* (patients gain +6 mood).
  - Scavenging 4: *Light step* (search noise −50%) / *Pack mule* (+4 slots, needs #3) / *Nose for it* (reveals cache spots).
  - Social 4: *Steady voice* (nearby break chance −25% at night) / *Trader* (Peltier/faction prices −25%) / *Storyteller* (+1 tale-driven mood buff to the house when they rest).
- Picks show as a modal at dawn with the survivor's portrait. Perks appear on the card as small chips.
- Files: `src/sim/survivors.ts` (skill-up hook currently in `resolveDayWork`), new `src/data/perks.ts`, `src/types.ts` (`perks: string[]`), `src/ui/day.ts`. Night effects: `src/night/battle.ts`.
- Overlap: Spotter and Steady touch **05-#4/#5** (focus, guard orders). Implement them through 05's hooks rather than separately.

### 8. Companion runs and "downed, not dead" — **M**
- A run can take **one companion** (costs their day hours, #1). The companion auto-fights (reuse guard AI), carries +6 slots, and can **drag the leader home** if downed (as the roadmap's downed state at night).
- Shared runs build relationships (already modelled in `scavenge()`: "pulled me out", +15 opinion) and produce **tales** with two names.
- Files: `src/night/expedition.ts`, `src/sim/survivors.ts` (downed state shared with night, roadmap item).

### 9. Scarcity tuning pass and the shared-ingredient "or" — **S**
- Start ammo 130 → **70** pistol rounds. Pistol rounds recipe 3 scrap + 1 fuel → **4 scrap + 2 fuel** for 24. Make **fuel** the contested currency: ammo, firebombs, floodlights, generator and heat (see next bullet) all burn it.
- Add **heating**: each day below "cold" costs 1 fuel per 3 survivors, or everyone gets a "Freezing" thought (−8) and −0.1 rest. This makes the ice clock felt daily (Pillar 5).
- **Site depletion is visible**: show stock pips per site. Picked-clean sites push runs further out (with #1 travel time).
- Target metrics for a `simtest` script: by day 10, a competent player should end ≥40% of nights with <1 night's ammo in reserve; fuel should be the binding constraint in ≥50% of days 12–22.
- Files: `src/sim/newgame.ts`, `src/data/world.ts`, `src/sim/day.ts::dawnTick`, `tools/` simtest.
- Overlap: 05-#6 (ammo-type loading) assumes ammo matters. This makes it so.

### 10. A real ending and an end-of-run score — **S/M**
- Nov 28 is the **finale**. If anyone survives the Crossing, show a Frostpunk-style **epilogue**: one paragraph per living survivor (from traits, tales and bonds), the graves, the "evacuation seat" outcome (#6), and a **score card**: days, people saved, the dead, kills, papers found, and threads completed.
- After the epilogue, offer **"Endure the winter"** (current endless mode, flagged as such) or **"Close the ledger"** (go to the legacy screen, #11).
- Files: `src/main.ts::iceEpilogue` and `gameOver`, new `src/ui/epilogue.ts`.

### 11. The Legacy: names that return — **L**
- On run end (win or loss), the player may **inscribe** up to 2 survivors (living or dead) into a persistent **Ledger** (localStorage key `vessey-legacy-v1`, separate from the save).
- In future campaigns, Ledger survivors can appear as **wanderers** ("A woman at the gate. She says her name is Marla Haugen. She has her grandmother's rifle.") with a **descendant/relative** of the original: same surname, one inherited trait, one heirloom item (their named masterwork gun, with its kill count), and a tale referencing the original ("Says her aunt held the wall on Ferry Road alone").
- **Legacy boons** (State of Decay 2): finishing a campaign with specific outcomes unlocks starting options, 2 picks per new game: *Ferry Road wall* (start +60 max wall), *Haugen's press* (start with workbench L2), *The Parish remembers* (start Parish warm), *Old dog* (start with the dog), *Deer-camp map* (deer camp open on day 1).
- **Persona unlocks / ascension**: beating The Long Siege unlocks a "Hard Freeze" modifier ladder (ice on day 20; −25% loot; Criers from day 3; no mercy), one step at a time, like StS Ascension.
- Files: new `src/legacy.ts`, `src/main.ts` (title screen: Ledger button; new-game boon picker), `src/sim/events.ts` (heir incident), `src/sim/newgame.ts`.
- Why: it fits Pillar 2 (persons) and turns the graves into the meta-progression. This is Wildermyth + SoD2 + Hades: failure carries something forward.

### 12. Seeds, daily challenge and run modifiers — **S**
- Show the seed on the title and game-over screens; "New game from seed" input. `newGame()` already takes `seed`, but `setState` reseeds per day from `seed + day*7919 + uid`, so deterministic seeds already mostly work. Audit `Math.random()` calls (e.g. `main.ts::dawn` overrun deaths, `newGame` default) and route them through `R`.
- **Daily Vessey**: seed = hash(date). Same town, same three founders, same persona, and one random modifier ("No generator parts exist", "Fog every third night", "The Quiet but the ice comes on day 18"). Local best score stored (no server needed).
- Files: `src/main.ts` (title buttons), `src/sim/newgame.ts`, `src/rng.ts`.

### 13 (stretch). House policies: a small Book of Laws — **M**
- 6–8 **house rules** adopted at dawn, at most one per 3 days, persistent and double-edged: *Rationing* (food −25%, mood −4 "Hungry by rule"); *Nobody goes out alone* (run requires a companion, bites −40%); *Mercy rule* (bitten survivors are put down at 50% infection: no turning inside, but bond mood −15); *Shifts at the wall* (one guard stays up: night prep +, rest −); *Burn the dead* (no graves, no grief thoughts, but loses kin-burial catharsis); *Drink allowed*. The rules show on survivor mood breakdowns, so the cost is attributable.
- Test against a Frostpunk-style dominant drift: every rule needs a scenario where revoking it is right.
- Files: `src/sim/day.ts`, `src/sim/survivors.ts` (mood components), `src/ui/day.ts` (a "House rules" tab).

### Suggested build order

1. **#2 Tide calendar** (S) and **#4 Juice pass** (S/M): quick, high-visibility wins.
2. **#9 Scarcity** (S) and **#1 Day Budget** (M): fix the dominant strategies.
3. **#3 Push-your-luck runs** (M) and **#5 One-more-day hook** (S).
4. **#6 Radio threads** (M) and **#10 Ending** (S/M): give the campaign an arc and a close.
5. **#7 Perks** (M) and **#8 Companion runs** (M): build variety. Coordinate with 05-#4/#5/#8.
6. **#11 Legacy** (L) and **#12 Seeds/daily** (S): replay. #13 if time allows.

**Interaction with 05:** 05 makes each **night** a sequence of decisions; this doc makes each **day** and each **campaign** one. The shared seams are the dusk screen (05-#8 deployment and 05-#9 intel sit between #1's day budget and the night) and perks (#7 → 05-#4/#5). The ammo economy (#9) is what makes 05-#6's ammo choices bite. Neither doc should add a second dusk modal: merge 05-#8's road strip, 05-#9's intel and #2's calendar into a single **Dusk planning screen** replacing the current dusk text overlay in `main.ts::dusk`.

---

## References

**Talks, papers, books**
- Sid Meier, "Interesting Decisions", GDC 2012 — https://gdcvault.com/play/1015756/Interesting · coverage: https://gamedeveloper.com/design/gdc-2012-sid-meier-on-how-to-see-games-as-sets-of-interesting-decisions
- Hunicke, LeBlanc, Zubek, "MDA: A Formal Approach to Game Design and Game Research" (2004) — https://users.cs.northwestern.edu/~hunicke/MDA.pdf
- Jan Willem Nijman, "The Art of Screenshake" (INDIGO 2013) — summary: https://gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games · listed at https://kenney.nl/learn/must-see-videos-for-indie-developers
- Martin Jonasson & Petri Purho, "Juice It or Lose It", GDC Europe 2012 — https://gdcvault.com/play/1016487/Juice-It-or-Lose
- Steve Swink, *Game Feel: A Game Designer's Guide to Virtual Sensation* (2008/2009) — overview: https://arxiv.org/pdf/2011.09201
- Michael Booth, "Replayable Cooperative Game Design: Left 4 Dead", GDC 2009 — https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ReplayableCooperativeGameDesign_Left4Dead.pdf · "The AI Systems of Left 4 Dead" — https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf
- Celia Hodent, "The Gamer's Brain, Part 2: UX of Onboarding and Player Engagement", GDC 2016 — https://gdcvault.com/play/1022951/contactUs · Part 3 — https://gdcvault.com/play/1024055/contactUs
- David Sirlin, "Balancing Multiplayer Games" Part 1 — https://sirlin.net/articles/balancing-multiplayer-games-part-1-definitions · Part 3 — https://sirlin.net/articles/balancing-multiplayer-games-part-3-fairness · "Orthogonal unit differentiation" pattern — https://math.vu.nl/~eliens/demo/pattern-orthogonalunitdifferentiation.html
- Tynan Sylvester on apophenia — https://gdt.stanford.edu/how-do-you-create-apophenia/ · "The Simulation Dream" — https://gamedeveloper.com/design/the-simulation-dream

**Games**
- Tyler Sigman, "Darkest Dungeon: A Design Postmortem", GDC — https://gdcvault.com/play/1023089/Darkest-Dungeon-A-Design · PC Gamer on stress — https://www.pcgamer.com/how-darkest-dungeon-got-inspiration-from-band-of-brothers-and-aliens
- Subset Games: "Designing Without a Pitch — FTL Postmortem" — https://gdcvault.com/play/1018034/contactUs · "Into the Breach Design Postmortem", GDC 2019 — https://www.gdcvault.com/play/1026333/contactUs · Road to the IGF (telegraphs, "every death your own fault") — https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-
- Anthony Giovannetti, "Slay the Spire: Metrics Driven Design and Balance", GDC 2019 — https://gdcvault.com/play/1025731/contactUs · https://gamedeveloper.com/design/how-i-slay-the-spire-i-s-devs-use-data-to-balance-their-roguelike-deck-builder
- 11 bit studios, "Why Make Games? Lessons from Frostpunk and This War of Mine", GDC 2019 — https://gdcvault.com/play/1025741/contactUs · "This War of Mine: Raising Emotions From Unique Narrative" — https://gdcvault.com/play/1022335/contactUs
- Frostpunk hope/discontent/laws — https://www.pcgamer.com/frostpunk-developers-on-hope-misery-and-the-ultimately-terrifying-book-of-laws · https://gamedeveloper.com/design/ethically-designing-unethical-worlds
- Hades narrative across runs — https://gamedeveloper.com/design/how-supergiant-weaves-narrative-rewards-into-i-hades-i-cycle-of-perpetual-death · https://www.screenhub.com.au/news-article/features/digital/jini-maxwell/hades-greg-kasavin-breaks-down-supergiants-unique-approach-to-narrative-262459
- Wildermyth Legacy — https://wildermyth.com/wiki/Legacy · https://wildermyth.com/wiki/Hero
- State of Decay 2 leaders & legacy boons — https://www.stateofdecay.com/?p=43403 · https://gamepur.com/guides/best-legacy-boons-in-state-of-decay-2
- 7 Days to Die Blood Moon — https://7daystodie.wiki.gg/wiki/Blood_Moon_Horde
- Kingdom Two Crowns waves/blood moons — https://kingdomthegame.fandom.com/wiki/Waves
- Dying Light night risk/reward — https://www.pcgamer.com/how-dying-light-2s-daynight-system-completely-transforms-the-city/ · https://gamesradar.com/games/horror/ten-years-later-dying-lights-night-time-psychological-warfare-is-still-one-of-the-strongest-hooks-in-horror-gaming-history
- Dead Rising timer — https://popmatters.com/post/136002-time-for-consequences-moral-dilemmas-in-dead-rising · Capcom on dropping it — https://gamespot.com/articles/why-dead-rising-4s-campaign-ditches-the-series-mos/1100-6442760/
- Project Zomboid — https://pzwiki.net/wiki/Project_Zomboid · https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/ProjectZomboid
- Vampire Survivors reward cadence — https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors · https://store.epicgames.com/news/vampire-survivors-built-genre-autoshooter-bullet-heaven
- Mark of the Ninja / Darkest Dungeon readability: see doc 04 references.

*Unsourced claims (from general knowledge, not fetched): Left 4 Dead's "relax" phase details, NEO Scavenger skill-gated options, Don't Starve hound timers, The Last of Us shared ingredients, They Are Billions wave clock, Brotato shops, Days Gone horde prep. Verify before quoting.*
