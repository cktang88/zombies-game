# 05 — Combat depth: turning the night from a spray into a sequence of decisions

Purpose: the night is currently "hold the trigger and spray". This document diagnoses why, surveys what creates tactical depth in about twenty reference games, and ends with a **prioritized implementation spec**: ten mechanics with numbers, controls, UI feedback and ties to the survivor sim, sized for one developer-agent (about 1,500 lines of TypeScript).

As in research 01, we take mechanics only. No names, art, story or text from the games below.

Confidence tags: **[dev]** = developer's own words (interview, blog, GDC), **[wiki]** = community wiki, **[guide]** = guide or review, **[recall]** = widely remembered but not confirmed this session.

---

## 1. Diagnosis: why spraying works today

Reading `src/night/battle.ts`, `src/data/zombies.ts`, `src/data/weapons.ts` and `src/sim/director.ts`:

| Observation | Code | Effect |
|---|---|---|
| Bloom is capped at **0.12 rad** and decays at only 0.12 rad/s. It grows by `spread×0.35 + 0.004` per auto shot. | `tryFire`, `update` | After about 4 shots an SMG sits at the cap. Tapping and spraying converge to the same cone, because recovery takes about 1 s either way. Without a reward for pausing, nobody pauses. |
| Shotgun pellets ignore the player's aim and bloom (`def.pellets > 1 ? def.spread : spreadA`). | `tryFire` | The shotgun is skill-neutral. |
| Hitboxes are only **head** and **body**. Legs and arms do not exist. | `hitbox`, `damage` | A hit anywhere but the head is just HP. There is no cripple or disarm choice, and no reason to aim low at a Deputy. |
| Every enemy's "answer" is more DPS. The Pulper is the only one that cares *where* it dies; the Crier only cares *how fast*. | `kill`, `updateZombie` | Composition changes the HP pool, not the play. |
| HP inflation: `hpMul = 1 + 0.03×(day−8)`. | `spawn` | Late nights are longer, not harder in kind. |
| Reload refills the magazine **without losing the partial mag** and auto-reloads on empty. | `finishReload` | Reloading is never a decision. You reload whenever, at no cost. |
| Guards pick targets with a fixed priority (over the wall > Crier > nearest), and their headshot chance is `0.2 + 0.25×aim`. | `updateGuard` | The player has no say over what four to six other guns do. The most strategic lever in the game sits idle. |
| One trap at a fixed `trapX = 720`. Wire is a fixed band in front of the wall. Lights are a number. | constructor, `updateZombie` | Nothing about the battlefield is *placed*, so there is no plan to execute. |
| Corpses are stamped onto the ground as decals only. | `stampCorpse` | Killing at the wall costs nothing. |
| The night plan (`plan.spawns`) is fully known in advance but never shown. | `planNight` | There is nothing to read and nothing to anticipate. |

Holding the trigger is the dominant strategy because **the game never asks a question that holding the trigger answers badly.** Depth comes from questions: *which* target, *where* on it, *when* to fire, *when not* to fire, *where* to fight, *what* to spend. The reference games show many ways to ask those questions.

---

## 2. What creates depth in the reference games

### 2.1 Precision shooters: where on the body, and when

**Resident Evil 4.** Headshots and knee shots reliably **stagger**, and a stagger opens a context melee (a kick) that pushes back everyone nearby [guide: backloggd review; progametalk]. A leg shot is not a weak headshot. It is a different verb that converts one enemy's vulnerability into crowd control. Critics of the remake say the depth fell when crowd control became "out-kill the onslaught" rather than "manipulate enemies into openings" [guide: backloggd/Durandal]. That is our current problem in one sentence. The remake marks staggered enemies with a white prompt [guide], which is cheap feedback that says "an opening exists now".

**Killing Floor 2.** Big specialists (Scrake, Fleshpound) are built around **rage states and the head**. Popping a Scrake's head before it rages reportedly drops it to a quarter HP and prevents the rage [guide: gameskinny]. Crossbows **stun** large zeds [guide], and grenades are weak against Scrakes [guide]. Every specialist has a named answer, and the wrong tool is visibly wrong. **Zed Time** is a short global slow-motion triggered by kills and headshots (sharpshooter perks raise the chance and the damage inside it) [guide: keengamer]. It rewards precision with *more* time to be precise. That positive loop feels great because it is earned and short.

**Sniper Elite.** "Empty lung" steadies the scope and shows the impact point, but it is gated by **heart rate**: running raises it, holding your breath raises it too, and at the red line aim gets worse and needs a cooldown [guide: digitaltrends, attackofthefanboy, gamespot]. The lesson for us: perfect accuracy should be a **spendable resource**, not a default. A resource is a decision.

**Receiver / Receiver 2 / Intravenous.** Every function of the gun is its own input. You load rounds into the magazine, seat it, rack the slide, check the chamber, and a careless rack ejects a live round on the floor [guide: Wikipedia; imfdb; gameplay.tips]. Intravenous loads magazines round by round and starts you with a partial magazine on purpose, so you learn to reload *before* a fight [guide: GOG reviews; dev comment on itch.io]. We will not go that granular with a mouse-and-wall game. The idea that transfers is that **the state of the gun is information the player manages**: what is in the tube, whether a round is chambered, what a partial mag is worth.

**The Last Stand series** (research 01). Headshots are the skill ceiling. Armoured zombies make headshots mandatory. Shotguns reload shell by shell. The revolver's six rounds "leave the barricade vulnerable to swarming" [wiki]. We already copy these rules. What Last Stand lacks, and what makes it a spray game in its own late nights, is any reason not to spray.

### 2.2 Enemy design: threats that demand specific answers

**Left 4 Dead.** Each special infected attacks a **different behaviour** of the team. The Smoker punishes straying, the Boomer's bile calls the horde, the Hunter pins the isolated, and the Witch punishes carelessness and noise [guide: dreadxp; Wikipedia]. The AI Director ("adaptive dramatic pacing", "structured unpredictability" [dev: Booth, GDC 2009]) watches health, ammo and stress, and it places specials to exploit your formation. Lesson: an enemy is interesting when it is **a question about your positioning or priorities**, not about your DPS. Each special also has a **sound cue** before it is seen. That telegraph is half the design.

**Plants vs Zombies.** George Fan wanted enemies to walk in slowly "to give time to strategize against them", and he made sure each character **visually represented its function** [dev: GDC 2012 via Game Developer; GamesBeat]. Lane threats (the pole-vaulter that skips the first plant, the newspaper zombie that speeds up when its paper is shot off, the bucket helmet [recall]) each **invalidate a specific default** and must be answered by a specific counter. Difficulty comes from *combinations*: a bucket in front of a pole-vaulter is harder than either alone.

**Into the Breach.** Every enemy attack is **telegraphed a turn ahead**, and the game removes randomness from the player's actions, so losses "feel like the player's fault" and each turn becomes a puzzle [dev: Justin Ma, Game Developer "Road to the IGF"]. Real-time games cannot telegraph everything, but they can telegraph *intent*: what is coming up the road, which enemy is about to keen, where a Pulper must not die.

**Killing Floor, again.** The specialists arrive *inside* trash waves. The question is never "can I kill a Fleshpound" but "can I kill it while the clots grab me". Composition beats HP.

**Dead Rising.** Crowd combat with improvised weapons was praised as spectacle, but critics called the core combat "pressing X until things are dead". When the series removed its timer, reviewers said the zombies "were never meant to hold our attention on their own" [guide: Digital Trends, Guardian via search]. Lesson: **a horde with no decisions is wallpaper.** The timer (an outside pressure) gave the combat its meaning. Our "outside pressures" are the wall, the ammo stores and the survivors' lives.

### 2.3 Position, preparation and the battlefield

**Days Gone.** Hordes are beaten by **preparation and funnelling**, not marksmanship. Throw an attractor next to a fuel barrel, wait for the horde to bunch, then napalm it [dev: Bend Studio "Horde Assault tips"]. Players lay traps along a chokepoint, then lead the horde through it [guide: PowerPyx, CyberPost, Steam]. Fire works best **early, while the pack is still tight** [guide]. This is exactly our firebomb's missing partner: **a lure that creates the clump the firebomb wants.**

**Tower defense.** The genre's core combo is **slow plus damage at a chokepoint**. A 50% slow doubles the effective DPS of everything covering that zone [guide: GoblinWars]. Freeze-then-shatter style bonuses reward ordering effects [guide: DEV, kody-w demo]. Lars Doucet's write-up on status stacking in a TD/RPG hybrid is the canonical design read [dev: Game Developer]. For us: wire (slow) + a nail bomb (damage) + a floodlight (accuracy) placed **at the same road distance** should be worth more than the three spread out.

**They Are Billions.** The defence is a **chosen chokepoint** with layered walls and long-range units behind [guide: gameranx, magicgameworld]. Noise from your own colony attracts the infected. Waves are announced hours ahead (research 01). A single breach snowballs. Lesson: **visible schedules plus permanent consequences of a leak.**

**Kingdom Two Crowns.** Waves come at night from a known direction. **Blood moons** do not retreat at dawn [wiki]. The defence is built entirely before the night: walls, archers, towers. During the night the monarch can only reposition and pay. Kingdom's depth is **all in the preparation**. That is the other half of our game, so the pre-night screen must have real choices.

**State of Decay 2.** Outposts and a watchtower give passive defence, but a watchtower **needs ammo and an armed survivor** to work [guide: Windows Central]. Clearing nearby buildings reduces sieges, because noise draws them [guide: gosunoob]. Lesson: defensive posts cost a person, and that person is not doing something else.

**Mount & Blade sieges.** Commanders split troops into groups and issue **hold position / hold fire / fire at will** with hotkeys [guide: StrategyWiki controls; Bannerlord F-key orders]. Experienced players pull archers back from the wall so the attackers bunch at the ladder, and they warn that guarding one ladder gets you flanked from another [guide: StrategyWiki; Reddit]. Lesson: **a few coarse, hotkeyed orders to AI allies** are enough to make an ally a tool rather than scenery.

**XCOM overwatch.** You trade your shot now for a reaction shot later, at an aim penalty of about ×0.7 (doubled against dashing targets), with no crits unless a perk removes the penalty [wiki: xcom.fandom; ufopaedia]. Players use it as **area denial** rather than damage [guide: trueachievements]. Lesson: "hold fire until they enter this zone" is a real order with a real cost (less damage, better ammo and noise), and it shapes enemy movement.

### 2.4 Resources that make you choose

**Dead Ahead: Zombie Warfare.** Two meters: **Courage** refills over time and buys units; **Rage** comes *only from kills* and buys support items and special units. An empty barrel costs 6 rage [guide: Kotaku, TVTropes, TalkAndroid]. A passive meter paces the fight. A kill-earned meter rewards playing well and gives a comeback lever. Unit deployment (when to send the cheap melee unit to stall vs saving for the shooter) is a constant small decision.

**Darkest Dungeon.** **Stress** is a second health bar. At 100, a hero rolls an affliction (common) or a **virtue** (rare), and a virtue buffs the whole party [dev: Red Hook / GDC postmortem via PC Gamer; Giant Bomb]. The mechanic draws on how people respond to stress [dev]. Our survivor sim already has mood and breaks. The night needs a **moment-to-moment** version: **nerve**, which the leader spends to shoot well and loses when bad things happen nearby, with consequences that carry into the morning.

**Killing Floor's Zed Time / Sniper Elite's heart rate** (above) are two answers to the same design: precision as a resource that is earned (KF) or spent (SE).

---

## 3. Principles we derive

1. **Every shot has a better and a worse place to land.** Head = kill, legs = slow and crawl, arms = weaker against the wall, armour plates = soak. The "best" zone depends on the enemy and the moment (RE4, Last Stand, KF).
2. **Accuracy belongs to the patient.** First shot accurate, follow-ups climb, pause to recover. Bloom must recover fast after a short pause and punish long holds (Last Stand circle + modern recoil).
3. **Precision is a spendable resource.** Focus costs nerve. Nerve is lost to fear and earned by clean kills (Sniper Elite, KF, Darkest Dungeon).
4. **Each special enemy invalidates one default.** Pulper → "kill them at the wall". Crier → "kill the nearest". Deputy → "body shots are fine". Ferryman → "knockback holds them". Deer → "slow guns are fine". Drag → "aim at head height" (PvZ, L4D).
5. **Telegraph intent.** Show what is coming up the road, wind-up before keens, the line a Pulper must not cross. Hidden information should be earned by scouting (Into the Breach, L4D audio, They Are Billions calendar).
6. **The battlefield is prepared.** Traps, wire, lights and lures are placed at chosen distances, and they combine (Days Gone, tower defense, Kingdom).
7. **Allies take orders.** Four coarse orders and a mark-target key turn guards into tools (Mount & Blade, XCOM overwatch).
8. **Fighting at the wall has a cost.** Corpses pile up into ramps. Clearing them costs fire, wall HP or a risky sally.
9. **Difficulty comes from combinations, not HP.** Deputies screening a Crier, a Pulper inside a sleeper pack, a deer herd timed for your reload (PvZ, KF, L4D Director).
10. **Every decision leaves a story.** Who held the roof, who went over the wall, who lost their nerve. The night feeds the chronicle (research 02).

---

## 4. A night under the new rules (a narrative test)

*Night 11, The Long Siege. At dusk, Dale on the radio (intel tier 2) reports "two Deputies walking point for something that's keening, second wave; a Ferryman late with company." The player puts Marla (shooting 7, Steady hands) in the roof nest on **Heads only**, gives Ray the pump with two slugs loaded at the bottom of the tube and sets him to **Protect wall** at the loophole, and makes young Tess the runner. Two pegs on the road: wire at 260–350 px and an oil slick at 300 px, with the tin-can lure staked at 330 px.*

*Wave 1 is sleepers and a Pulper. The threat ribbon shows the Pulper's ochre icon 9 s out. The player waits until it walks into the middle of six sleepers at about 500 px, then taps one Focus headshot. The burst takes four of them. Wave 2: the Deputies lead and the Crier walks behind them, inhaling. The player marks the Crier (G). Marla's heads-only shots crack the Deputies' visors while the leader puts two shots into the Crier's chest during its 1.2 s wind-up and interrupts the keen. Bodies are piling: the pile meter at the wall reads 7/10. Before wave 3, the leader pulls the lure (L) at 330 px. Twelve sleepers mill on the oil. One firebomb. The fire also burns the near pile down to 3. Then the Ferryman. Ray's slugs stagger it twice at the wall. The leader spends the Rally charge banked from a five-headshot streak, and the line drops it. Ray earns a tale: "Stopped a Ferryman at the loophole with two slugs, night 11."*

Every beat above is a decision the current build cannot ask.

---

## 5. PRIORITIZED IMPLEMENTATION SPEC (top 10)

Ordering is by **depth gained per line of code**, and by dependency (1–3 change every shot and must come first). Line counts are estimates for `src/night/battle.ts` plus small data edits. They total about **1,500**. All numbers are starting values to tune.

Shared notation: `WALL_X = 372`, the road runs to `W = 1280`, "distance" `d = z.x − WALL_X`. Head radius today ≈ 16 px on a sleeper.

### 1. Anatomy zones and cripple states (~200 lines)

**Rule.** Split the body hitbox into four zones. Each zone does something different:

| Zone | Hitbox (fraction of the body box below the head) | HP damage | Side effect |
|---|---|---|---|
| Head | existing circle | ×3 (pellet ×2) | Death if lethal. Headshots ≥ 60 dmg **stagger** for 0.6 s (no walking, no wall damage). |
| Torso | top 0–55% | ×1 | Armour plates live here (see Deputy). |
| Arms | the leading 22% of the width, within torso height | ×0.7 | `armDmg` accumulates; at **25% of maxHp** → **disarmed**: wall DPS ×0.4, maul wound severity ×0.6. Text "ARM". |
| Legs | bottom 45% | ×0.6 | `legDmg` accumulates; at **35% of maxHp** → **crippled**: becomes a crawler (speed ×0.35, lunge disabled, head drops to Drag-style low position, wall DPS ×0.6). Text "LEGS". Explosions cripple instead of kill if hp > 0 (the Last Stand rule). |

* Crawling heads are **harder to hit** (low, near the pile), so crippling is a trade: time now for a harder target later.
* Ferryman cannot crawl. At its leg threshold it **limps** (speed ×0.5). Deer crippled lose their lunge, which is the cleanest answer to a herd.
* Guards' zone choice depends on **order** (#5) and skill: by default `pHead = 0.2 + 0.25×aim`, `pLegs = 0.15` if the target is a Deer or a Pulper beyond 300 px, else torso.

**Ammo hooks** (read from the weapon agent's `fireProfile()` if present; otherwise derive from the ammo id): `limbMul` (soft-point and hollow-point ×1.3 to limb thresholds), `armorPierce` 0–1 (AP and FMJ), `stagger` (slug, bolt), `incendiary` (dragon's breath ignites oil and piles, sets `burn = 1.5`).

**UI.** A hit marker on the crosshair is coloured by zone (head bone-white, legs ochre, arm grey, plate spark blue-white). On a cripple: a snap SFX, the sprite rotates about 75° and squashes to 0.45 height. The first time each state happens in a run, a one-line hint appears: "Legs gone. It'll crawl now — slower, and lower."

**Sim tie.** Each guard tracks `crippled` counts. A survivor with 10+ cripples in a night earns the tale "Took their legs out from under them, night N". The background `hunter` (if it exists in the backstory table) gives guards `pLegs +0.1`. Gentle trait: prefers legs (+0.15), and gets a −2 "had to finish them" thought only when finishing crawlers.

### 2. Enemy roles with hard counters and telegraphs (~220 lines)

Every Turned gets a **role**, a **default it breaks**, a **telegraph**, and an **answer**. Remove `hpMul` from `spawn` (difficulty moves to #9).

| Turned | Breaks the default | Telegraph | Answer | Changes |
|---|---|---|---|---|
| Sleeper | — | — | anything | none |
| Deer | "slow guns are fine" | Breath puffs and a panting SFX during the 0.8 s stop. Arrives as **herds of 3–4 spaced 0.6–1.0 s**. | Shoot in the pant window; legs remove lunge; pistols and shotguns over bolt guns | Herd spawning via #9 templates |
| Drag | "aim at head height" | A low silhouette; guards on the firestep can't target it inside **80 px** of the wall | Loophole guard or WALL order; player aims down | `minDist` rule in `updateGuard` |
| Pulper | "kill it at the wall" | Sickly ochre rim light and a gurgle loop under 400 px. **A dashed ochre "kill line" painted on the road at d = 180.** | Kill it beyond 180 px, ideally *inside* a pack (burst: 110 px, 30 dmg, now 45 dmg) | Inside 180 px: wall −45 and the **pile becomes rot** (#7: ramp threshold −3 for the night). Leg cripple keeps it out longer. |
| Crier | "kill the nearest" | **1.2 s wind-up** before each keen: head tilts back, a rising whine, and a pale ring grows over it | Any hit ≥ 20 dmg during wind-up **interrupts** (timer reset to 6–9 s, text "SILENCED"); a headshot kill is instant | Keen interval 6–9 s; summons 2. Each keen within 500 px costs the leader 8 nerve (#3). |
| Deputy | "body shots are fine" | Plate glint in floodlights; "PLATE" spark text on body hits | Headshots (visor), AP rounds, or **legs** (unarmoured) | Torso plate has **60 plate HP**: body hits deal `max(15%, dmg − 16×(1−armorPierce))` to HP and the full hit to plate HP. At 0 the plate falls off (visual) and armour is 0. |
| Ferryman | "knockback holds them" | Footfall thump plus a 2 px screen shake per step under 600 px; arrives with 4–6 sleepers | Slugs or bolts: each `stagger` body hit freezes it 0.5 s; **two stagger hits within 1.2 s = knockdown** (2.5 s, shoved back 60 px). Headshot ≥ 100 dmg also staggers. | Immune to ordinary knockback (as now). Disarmed → wall DPS 24 → 10. |

**Threat ribbon (Into the Breach-style telegraph).** A strip along the top-right shows icons for spawns arriving in the next **20 s** (read from `plan.spawns`), sliding toward the screen edge, with templates bracketed ("HERD", "SCREEN"). Detail depends on scouting (#9): tier 0 shows only grey dots, tier 1 shows role icons for specials, tier 2 shows everything plus a countdown. A roof-nest guard (#5) adds +10 s of lookahead.

**Sim tie.** A guard who silences a Crier gets the tale "Shut a Crier up mid-call, night N". Pulper bursts at the wall add the thought "The smell won't wash off" (−3, 2 days) to everyone on the wall.

### 3. Bloom, recoil climb and weapon heat (~90 lines)

Make **patience accurate and spraying inaccurate**.

* **Aimed shot.** If ≥ 0.35 s since the last shot (≥ 0.6 s for bolt guns) and bloom < 0.01: spread ×0.5, and the crosshair shows a tight, solid ring. Pellet cones also scale: `pelletSpread = def.spread × (0.75 + bloom/0.08) × (1.3 − 0.3×aim)` (fixes the skill-neutral shotgun).
* **Bloom kick per shot** (`def.kick`, rad): pistol 0.018, revolver 0.035, SMG 0.012, carbine 0.016, bolt 0.05, pump 0.06, nailer 0.008. Cap **0.18**. Recovery: hold for 0.12 s after a shot, then decay exponentially with a half-life of **0.15 s**. A 0.3 s pause nearly resets bloom; a held trigger never recovers.
* **Recoil climb** on autos: shot *n* of a continuous burst shifts the aim point up by `climb × min(n, 10)` px (SMG 2.5, carbine 4, nailer 1). The player can pull the mouse down to compensate. That is a skill, and it reads.
* **Heat** (autos and nailer): +1 per shot, dissipates 5/s. Above `0.6 × mag` heat: spread ×1.4 and a 1.5% jam chance per shot. The barrel glows (an orange gradient on the gun sprite) and the hiss SFX rises.
* **Worked example** (sleeper head ≈ 16 px radius at 600 px): a sprayed SMG at bloom cap gives ±0.18 rad ≈ ±108 px → a head hit about 15% of the time. An aimed service-pistol shot at aim 0.7 gives `0.035×1.05×0.5 ≈ 0.018` rad ≈ ±11 px → a head hit about 80% of the time. Tapping now wins, by about 5× rounds-per-kill.

**UI.** The crosshair circle grows with real spread (already true). Add a small "climb" tick above it during bursts and a heat arc on its right side. Keep it all on the cursor, where the eyes already are.

**Sim tie.** `steady` trait: kick ×0.75. `jittery`: aimed-shot delay +0.15 s. An arm wound adds +30% climb. The weapon's `cond < 0.5` adds +20% heat gain.

### 4. Focus and Nerve (~140 lines)

**Nerve** is the leader's per-night composure meter, 0–100. **Focus** spends it.

* **Max nerve** = `55 + 4×shooting + traits` (ironwill +15, steady +10, jittery −15, fragile −10, coward −20), and −10 if mood < 25. Start at 80% of max.
* **Focus = hold right mouse button** (molotov moves to F and middle-click; the "aim down sights" convention). While held: world time ×0.6, spread ×0.4, kick ×0.5, the crosshair snaps a faint head reticle to the nearest head within 30 px (assist, not aimbot). Drain **20 nerve/s + 3 per shot**. It can't start below 10.
* **Gain:** headshot kill +6, any kill +2, a silenced Crier +10, a Ferryman knockdown +8, and +1/s when nothing is at the wall.
* **Loss:** −8 per Crier keen within 500 px, −6 every time the wall drops another 10%, −20 when a guard is bitten, −35 when a guard dies, −10 when a Pulper bursts at the wall.
* **At 0: shaking.** For 5 s spread ×1.35 and climb ×1.5. The hands visibly tremble (crosshair jitter ±3 px) and the heartbeat is audible.
* **Leadership coupling:** if the leader's nerve is below 25, every guard's panic chance this night is ×1.5. If it is above 60, guards with `panicAt` get one resolve roll (Darkest Dungeon's virtue) to cancel it, at 30%.

**UI.** Nerve is a thin arc wrapped around the left half of the crosshair (no HUD trip needed), plus a vignette and heartbeat when below 25. A "FOCUS" desaturation filter is applied while held.

**Sim tie (the morning after).** End-of-night nerve ≥ 60% → thought "Kept my head out there" +4 for 2 days. Hitting 0 three or more times → "Hands won't stop shaking" −5 for 3 days and +5% next-night panic. The chronicle records "held steady" or "came apart" lines for the leader.

### 5. Guard posts and orders (~230 lines)

Guards stop being scenery. **Posts** are chosen at dusk. **Orders** are chosen at dusk and switched mid-night.

**Posts** (dusk screen: drag a survivor card onto a slot):

| Post | Slots | Effect | Cost |
|---|---|---|---|
| Roof nest | 1 (needs a "roof nest" build: 10 wood, 2 scrap) | Range +260, err ×0.8, ribbon lookahead +10 s | Can't target inside d = 160 (can't angle down). Safe from mauls until the wall has been down 20 s. |
| Firestep | 3–4 | Today's behaviour | — |
| Loophole | 1 (by the gate) | Can hit Drags and anything at the wall; shotgun pellet cone ×0.8; knockback ×1.3 | Exposed: a Ferryman or Deputy at the wall wounds the loophole guard (light laceration) every 8 s |
| Runner | 1 | Every guard reloads ×0.65 faster; the leader gets +1 firebomb pickup per 60 s if stores have them; drags downed guards (see #10) | Has no gun, or a pistol only |

**Orders** (per guard):

| Order | Key | Behaviour |
|---|---|---|
| Free fire | Z | Current priority logic, plus marked targets |
| Hold fire | X | Fire only at targets with d < 220, over the wall, or marked. Saves ammo and noise (overwatch-style area denial). |
| Heads only | C | `pHead = 1`, cooldown ×1.35, err ×0.85. Great for skilled guards vs Deputies; wasteful for shooting ≤ 3 |
| Protect wall | V | Targets only things at the wall or with d < 120, highest wall DPS first. Never shoots a Pulper inside d = 180 unless it is already hitting the wall (better to knock it back than burst it). |

* **Controls:** Tab cycles the selected guard (a highlight ring under their feet). Z/X/C/V set the selected guard's order. **Shift + Z/X/C/V** sets all guards. **G or middle-click** marks the zombie under the cursor: Free and Heads guards switch to it for 5 s (an ochre bracket on the target). Weapon switching stays on Q and the mouse wheel. Number keys 1–9 become guard select (weapons move off them; one less thing to remember).
* **UI:** A small order glyph floats over each guard (open circle = free, bar = hold, dot = heads, square = wall). An ammo pip row shows under each guard. Selecting a guard shows their name, weapon, mag and mood word ("Marla — hunting rifle 3/5 — steady").
* **Sim ties.** Posts and orders feed the chronicle and titles: 3 nights on the roof → title "Up Top"; a loophole guard on a night with no breach → +opinion with everyone (+4). Traits push back: `bloodlust` ignores Hold fire 25% of the time ("couldn't wait"); `coward` refuses the loophole (morning thought −3 if forced); a survivor in a lover/parent bond with a downed guard ignores orders and goes rage (existing `rage` mode). Assigning a poor shot to Heads only and losing the wall → thought "They put me where I couldn't help" −4.

### 6. Reload management and ammo-type loading (~120 lines)

* **Tactical vs empty reload** (box magazines): reload with rounds left = **0.75× time, but the partial magazine is dropped** (its rounds go to a `dropped` tally). Reload from empty = 1.0× time + 0.35 s to chamber. The leader keeps one in the chamber on tactical reloads (mag + 1). At dawn, if the wall held, **50% of dropped rounds are recovered** ("Tess picked brass and mags out of the snow"). If the wall fell, they are lost.
* **Auto-reload on empty is kept**, but a **manual reload during a lull is the skill**: the HUD counts rounds (pips) and goes amber at 30% and red at 2 rounds.
* **Active reload window** (Gears of War-style, optional): a bright 18% segment in the cursor's reload bar. R pressed inside it completes the reload at that instant (+5% damage for the mag); pressed outside it, +0.4 s fumble. The window position varies per weapon. Arm wounds shrink it to 10%.
* **Shell by shell** for every tube or cylinder gun the weapon agent adds (pump, lever, revolver with no speedloader). Firing interrupts. **The tube is a queue**: T cycles which shell type the *next* load inserts (buckshot → slug → dragon's breath → flechette, skipping types not in stores). The loaded order shows as coloured pips under the crosshair (red buck, grey slug, orange DB, blue flechette). Loading two slugs last for the Ferryman is a pre-planned play.
* **Box-magazine ammo types** (FMJ / soft-point / AP / hollow-point) switch only on a reload: T sets the type of the *next* magazine.

**Sim tie.** `tinkerer` trait: +20% recovered brass. A survivor who "dropped a full mag over the wall" (a tactical reload with ≥ 80% left, 3+ times) gets a ribbing social event next day (opinion −2 from the Runner, +2 from Abrasive survivors who enjoyed it).

### 7. Corpse piles that become ramps (~130 lines)

* **Pile mass** accumulates in three 40 px bins in front of the wall (d = 0–120). A death adds mass: sleeper 1, deer 0.8, drag 0.5, deputy 1.3, ferryman 3, crier 1, pulper 0 (it bursts). Corpses beyond d = 120 are only decals.
* **Ramp threshold** = 10 + 2 × wall level (−3 for the night if a Pulper rotted the wall). When a bin reaches it, Turned arriving at that bin **climb**: a 1.4 s climb animation on the parapet (head silhouetted against the sky: head hitbox ×1.4, any headshot drops it back as a corpse), then they land in `over` state *without the wall being breached*.
* **Clearing:**
  * **Burn:** a firebomb or dragon's breath on a pile burns 1 mass/s for 7 s, but the fire against the planks costs the wall 3 HP/s (unless the forge builds "tin sheathing", 4 scrap 2 parts, which cancels this). This is a real trade.
  * **Shove:** the Loophole guard on Protect wall pushes 0.3 mass/s off the closest bin.
  * **Sally** (#10): the leader drags 1 mass per 1.5 s.
* **Persistence:** at dawn the remaining mass carries into the next night at 50%, unless a day job ("Clear the road", Repair job variant, 2 survivor-hours) or fuel (2) burns it. Burning or burying the dead is a grief beat: if an "old face" died in the pile, their kin gets the existing grave event (bury or burn).
* **UI.** Corpses within d = 120 are drawn as stacked silhouettes. A small tick gauge above each bin reads "▮▮▮▮▮▯▯ 7/10" and goes red at 80%. A climbing Turned triggers a sharp scrape SFX and the message "They're coming up over the bodies."

**Sim tie.** Wall fighters see the pile: −2 "The pile against the wall" (1 day) once mass > 15 on a night. The tale "Burned the pile with the wall still standing, night N".

### 8. Pre-night deployment on the road (~200 lines incl. dusk UI)

At dusk, a **road strip** (a horizontal 0–900 px bar, with pegs every 100 px) lets the player place what was crafted, at chosen distances. The number of placements = `2 + floor(best building skill / 3)` (this ties the Building skill to combat).

| Item | Craft / cost | Placement | Effect |
|---|---|---|---|
| Nail bomb (existing trap) | existing | any x ≥ 150 | As now (130 px radius, 160 dmg), and cripples the survivors in 130–200 px |
| Wire belt | existing | start x, 90 px band | Speed ×0.55 in band; Deer lunge disabled in band |
| Floodlight aim | needs lights ≥ 1 | the cone centre x (260 px wide) | Inside the cone: guard err ×0.7, plates glint, crawlers visible; outside: darker than now (contrast becomes a decision) |
| Lure (tin-can bell post / wind-up siren) | still or workbench: 1 parts + 1 scrap | x ≥ 250 | **Pull with L** (or auto when the first Turned is within 120 px): for 8 s, Turned within 260 px walk to it and mill (speed 0). Single use. Noise +6. |
| Oil slick | 2 fuel | 120 px band | Ignited by a firebomb, dragon's breath or a nail bomb (not by a Pulper burst: the bile is wet) → 12 s fire band, 22 DPS, light source |

**The designed combos:** lure on oil, then a firebomb (Days Gone). Wire in front of a floodlit band (slow + accuracy, the TD multiplier). A nail bomb inside the Pulper kill line, so a Pulper crippled there can't crawl closer. The **road pegs remain drawn faintly at night** so players learn distances (and the Pulper line at 180 px reads).

**Sim tie.** A deployment placed by a named builder gets credit: kills in the zone count toward their tales ("Ray's wire caught nine of them, night 12"). Lures cost noise, which feeds the existing noise and straggler system.

### 9. Scouting intel and combination-based difficulty (~140 lines, director + dusk text)

**Templates replace HP inflation.** Delete `hpMul`. The director spends part of each surge's budget on **templates** (cost = sum of members × 0.9, so templates are "cheaper" per body but harder in play):

| Template | Members | From day | Why it's hard |
|---|---|---|---|
| Herd | 3–4 Deer, 0.6–1 s apart | 3 | Punishes slow guns and bad reload timing |
| Poison pack | Pulper inside 5–6 Sleepers | 5 | Kill early = free AoE; kill late = wall rot |
| Screen | 2 Deputies 60 px ahead of a Crier | 8 | Plates soak shots meant for the Crier |
| Low and fast | 3 Drags + a Herd at once | 7 | Two aim heights at once |
| Siege | Ferryman + 6 Sleepers | 10 | Builds the pile while you deal with the brute |
| Reload trap | a Herd scheduled 3–5 s after the largest pack of the surge | 9 | Arrives as magazines run dry |

At most 2 templates per surge before day 15, 3 after. The Long Siege favours Siege and Screen. The Coin draws uniformly. The Quiet uses only Herd and Poison pack.

**Intel tiers** (computed at dusk):
* Tier 0: the current flavour label.
* Tier 1: Radio job worked today (`G.flags.radioWork > 0`) **or** a survivor on the `guard` job with shooting ≥ 3 → special counts by surge ("first wave: sleepers and a Pulper; second: a herd"). Counts are ±30% (the `jittery` trait exaggerates up; `grim` reports worst case).
* Tier 2: both, or radio mast level 2 → template names and timing ("late: a Ferryman with company"), and the ribbon (#2) shows full icons.
* Tier 3 (radio mast 3 + lookout shooting ≥ 6): also reveals the old face's name and a turning survivor's risk ("Dale says the road's quiet, but watch June tonight").

**Sim tie.** The lookout or radio operator is named in the dusk text, and if their report was right (no un-forecast template appeared), they get +1 social skill progress and +2 opinion from the leader. If it was badly wrong, "Should have seen it coming" −3 for them.

### 10. Momentum (Rally) and the sally (~150 lines)

**Rally (a Dead Ahead "rage" / Killing Floor "zed time" analogue, earned by precision):**
* A **headshot streak**: +1 per headshot kill by the leader. It resets on three consecutive misses or a Pulper burst at the wall. Five → **one Rally charge** (max 2). Streak count shows as tally marks next to the nerve arc.
* **E = Rally:** the leader shouts. For `4 + 0.4 × social` s: all guards aim +0.25, cooldown ×0.75, panicking guards recover, one fled guard returns if alive, and the leader's nerve +20.
* **Sim tie:** the tale "Called the line together, night N". Survivors present gain +3 opinion of the leader. A Rally fired while someone is being mauled who then lives gives that survivor the thought "They didn't leave me" +6.

**The sally (risk/reward), the stretch goal in this item:**
* **S** (while no Turned is within d < 80 of the gate, or while the wall stands): the leader vaults the wall and becomes controllable with A/D on the road up to d = 260. Melee shove (Space, the expedition shove) and the current weapon at ×1.3 spread (no rest).
* **What you can do outside:** drag pile mass (hold E: 1 mass per 1.5 s), re-arm a spent nail bomb (if one is in stores, 3 s), recover dropped mags (instantly gets back that night's `dropped` rounds), retrieve a **downed** guard pulled over the rubble (see below).
* **Danger:** guards fire around you (friendly fire 0; but Hold fire guards won't shoot within 60 px of you). Any Turned that touches you mauls you as a guard (existing `maul`). Nerve drains 4/s while outside.
* **Downed state (enables the retrieval):** replace "pain > 1.45 → dead" with **downed for 20 s** (bleeding, can't fire). A Runner or the leader reaching them within 20 s → they live with a severe wound. Otherwise → dead as now. This is on the existing roadmap ("downed state + drag-to-safety") and is the strongest story generator in the list.
* **Sim tie:** "Went over the wall for June, night N" (tale + +15 opinion from June, +6 from everyone). Being left down → the existing death ripple plus the thought "We could have reached her" −6 for the guard set to Hold fire nearest to them.

---

### Build order and line budget

| # | Mechanic | Lines | Depends on |
|---|---|---|---|
| 1 | Anatomy zones and cripple states | 200 | — |
| 2 | Roles, counters, telegraphs, threat ribbon | 220 | 1 |
| 3 | Bloom, recoil climb, heat | 90 | — |
| 4 | Focus and Nerve | 140 | 3 |
| 5 | Guard posts and orders | 230 | 1, 2 |
| 6 | Reload management and ammo queueing | 120 | weapon agent's `fireProfile()` |
| 7 | Corpse piles | 130 | 1 |
| 8 | Pre-night deployment | 200 | 7 (oil burns piles) |
| 9 | Templates and intel | 140 | 2 |
| 10 | Rally and sally (+ downed state) | 150 | 4, 5, 7 |
| | **Total** | **≈1,620** (≈1,470 without the sally) | |

If scope must be cut, ship **1–5 and 9** first (≈1,020 lines). That alone ends "hold the trigger": aimed shots are worth 5× sprayed ones, every special needs a named answer, the guards take orders, and the director builds combinations instead of sponges.

**Tuning checks** (add them to `npm run simtest` or a debug overlay): rounds per kill for sprayed vs tapped fire at d = 600 (target ≥ 3:1); the share of kills by headshot for a competent player (target 35–55%); the share of nights where the pile reaches a ramp without the player acting (target 20–40% after day 8, so piles are a regular but not constant decision); and the share of Pulpers that burst inside 180 px with no player input (target ≥ 50%, so guards alone don't solve it).

---

## 6. References

Developer sources
- Subset Games (Justin Ma), "Road to the IGF: Into the Breach", Game Developer: https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-
- Michael Booth, "Replayable Cooperative Game Design: Left 4 Dead", GDC 2009: https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ReplayableCooperativeGameDesign_Left4Dead.pdf
- George Fan, GDC 2012 tutorial tips (Plants vs Zombies), Game Developer: https://gamedeveloper.com/design/gdc-2012-10-tutorial-tips-from-i-plants-vs-zombies-i-creator-george-fan ; GamesBeat retrospective: https://gamesbeat.com/how-george-fan-created-the-wacky-plants-vs-zombies-a-decade-ago/2
- Red Hook, Darkest Dungeon affliction system, Game Developer deep dive: https://gamedeveloper.com/design/game-design-deep-dive-i-darkest-dungeon-s-i-affliction-system ; PC Gamer on the GDC postmortem: https://www.pcgamer.com/how-darkest-dungeon-got-inspiration-from-band-of-brothers-and-aliens ; GDC Vault: https://gdcvault.com/play/1023089/
- Bend Studio, "Horde Assault tips & tricks" (Days Gone): https://bendstudio.com/blog/horde-assault-tips-tricks
- Lars Doucet, "A status effect stacking algorithm", Game Developer: https://gamedeveloper.com/design/a-status-effect-stacking-algorithm

Wikis and guides
- Killing Floor 2: https://www.gameskinny.com/tips/the-dos-and-donts-of-killing-floor-2/ ; https://www.keengamer.com/articles/guides/killing-floor-2-perk-guide-sharpshooter/ ; https://pcgamer.com/killing-floor-2-guide-10-tips-for-being-a-better-zed-killer
- Resident Evil 4: https://backloggd.com/u/RexZakel/review/733154 ; https://www.backloggd.com/u/Durandal/review/812239 ; https://progametalk.com/resident-evil-4-remake/how-to-melee-attacks/
- Left 4 Dead: https://en.wikipedia.org/wiki/Left_4_Dead ; https://www.dreadxp.com/?p=33851
- Dead Ahead: Zombie Warfare: https://kotaku.com/games/dead-ahead-zombie-warfare ; https://www.tvtropes.org/pmwiki/pmwiki.php/VideoGame/DeadAheadZombieWarfare ; https://www.talkandroid.com/dead-ahead-zombie-warfare-walkthrough-tips-strategies/ ; https://deadahead.wiki.gg/wiki/Classes
- Into the Breach reviews: https://www.destructoid.com/reviews/review-into-the-breach/ ; https://thinkygames.com/games/into-the-breach/
- Days Gone: https://www.powerpyx.com/days-gone-how-to-kill-hordes/ ; https://cyberpost.co/what-is-the-best-strategy-for-hordes-days-gone/ ; https://gamesradar.com/days-gone-how-to-take-down-kill-a-horde
- Darkest Dungeon: https://en.wikipedia.org/wiki/Darkest_Dungeon ; https://giantbomb.com/user-reviews/id/65194/swords-to-rust-hearts-to-dust
- XCOM overwatch: https://xcom.fandom.com/wiki/Overwatch_(XCOM_2) ; https://xcom.fandom.com/wiki/Reaction_Shot ; https://temp.ufopaedia.org/Overwatch_(EU2012) ; https://www.trueachievements.com/game/XCOM-Enemy-Unknown/walkthrough/6
- Receiver: https://en.wikipedia.org/wiki/Receiver_(video_game) ; https://imfdb.org/wiki/Receiver_2 ; https://gameplay.tips/guides/7456-receiver-2.html
- Intravenous: https://www.gog.com/en/game/intravenous ; https://store.steampowered.com/app/1486630/Intravenous/
- Sniper Elite: https://digitaltrends.com/gaming/sniper-elite-3-guide ; https://attackofthefanboy.com/guides/sniper-elite-5-what-is-empty-lung/ ; https://www.gamespot.com/articles/sniper-elite-5-best-skills-to-unlock-early/1100-6503677/
- They Are Billions: https://gameranx.com/?p=135698 ; https://www.magicgameworld.com/they-are-billions-how-to-survive-the-final-wave/ ; https://www.fandom.com/articles/they-are-billions-guide-tips-tricks
- Kingdom Two Crowns: https://kingdomthegame.fandom.com/wiki/Waves ; https://kingdomthegame.fandom.com/wiki/Breeder ; https://www.magicgameworld.com/kingdom-two-crowns-enemies/
- Tower defense combos: https://goblinwars-com.pages.dev/tower-defense-strategy-guide/ ; https://dev.to/jim_l_efc70c3a738e9f4baa7/universal-tower-defense-x-8-tower-combos-i-tested-across-25-early-25f6 ; https://kody-w.github.io/learnwithkody/examples/tower-defense/
- State of Decay 2: https://www.windowscentral.com/state-of-decay-2-base-building-guide ; https://gosunoob.com/?p=115713
- Mount & Blade: https://strategywiki.org/wiki/Mount%26Blade/Siege ; https://strategywiki.org/wiki/Mount&Blade/Controls ; https://mountandblade.fandom.com/wiki/Sieges
- Dead Rising: https://www.digitaltrends.com/gaming/dead-rising-4-review/ ; https://pcgamer.com/dead-rising-2-review
- The Last Stand series: see research 01 references.
