# 19b. Simplify the survivors

Brief (approved): **depth but not complexity; easy to learn, hard to master.** Every stat has a one-line
identity and visibly changes a decision. Numbers that were only small % modifiers are cut.

## Before and after

| | Before | After |
|---|---|---|
| Skills | 8: Shooting, Building, Crafting, Medicine, Scavenging, Farming, Social, Counsel (psych) | **5**: Shooting, Building, Medicine, Scavenging, Social |
| Gun skill | Shooting **plus** 11 per-class proficiencies (pistol, SMG, shotgun, rifle, assault, scoped, MG, launcher, bow, shop gun, melee), each 0–10 with its own XP | **Shooting** alone, plus one **favourite kind of gun** (+3 handling with it) |
| Crew-served guns | a separate Heavy-weapons training track (0–10), raised only by Drill with a nest built | **Shooting** (an MG favourite gets +3) |
| Attributes | Courage, Grit | **Courage** only; Grit is the **Tough** trait |
| Traits | 24 | **14** |
| Perks | 32 (8 skills × 2 tiers × 2) | **20** (5 × 2 × 2) |

What the player reads on a survivor: five skill rows, Courage, one ★ gun, two or three trait tags. That
is the whole character.

## The decision each stat drives

### Skills (sheet: pips and one line each, `SKILL_LINES` in `src/data/names.ts`)

| Skill | What it does | The decision |
|---|---|---|
| **Shooting** | aim on the wall; reload, jam and spread with any gun; the gun nests; the hatchet | who stands the wall, who drills, who crews the MG |
| **Building** | wall repairs (+9 wall per level) and bench work (+0.9 work per level) | who repairs, who works the queue |
| **Medicine** | wounds dressed a day (2 + level) | who tends the hurt |
| **Scavenging** | haul and trouble on a search; search speed on a run | who goes out |
| **Social** | radio work (a clear signal at dusk) and counselling | who works the radio, who counsels |

**Why these merges.**
- *Crafting → Building.* Both were "the person who makes things"; the wall and the bench compete for the
  same hands every morning, so one skill makes that trade-off honest instead of hiding it behind two numbers.
- *Counsel → Social.* The radio and counselling are both talking. One talker now has a real choice to make:
  the radio (intel tonight) or the frayed (no break at dawn).
- *Farming → a plain job.* Farming output was mostly the cold frames (+2.2 a level) and the skill only added
  0.45 a level: a number that never changed who you sent. Food is now **2.4 + 2.2 per cold-frame level**,
  times workMult (the tired and hurt bring in less), ×0.6 in frost. Anyone free can do it, which is the
  point: it is the job for whoever is left over. The one person who *should* be on the garden is the
  **Green thumb** (×1.5), a trait the hobby farmer backstory gives.
- *Proficiencies → Shooting.* Eleven 0–10 numbers per person changed reload by 3.5% a point; nobody
  could hold them in their head. Handling is now `Shooting + 3 if it is their favourite` (`handling()` in
  `src/sim/survivors.ts`), and it feeds every place proficiency used to (reload, jams, a guard's spread,
  jam clearing, gun-nest crew handling, melee).
- *Favourite gun.* Kept because it makes a real choice: with four guns and five people, the shotgun goes to
  the one who loves a shotgun. It shows as ★ in the give menu, the gun-nest crew list, the Today "arm" item
  and the survivor sheet; "arm everyone" lets a person whose favourite is on the rack pick first. It never
  changes after arrival (it comes from the backstory's guns, else a roll weighted to the guns the house finds).

### Courage (the one attribute)

Night nerve: holds the wall when it breaks, panics and flees less, shifts the break threshold. Grows with
every night held; a death close to them or a fallen wall shakes it. Decision: **who stands the wall when it
goes bad.**

### Traits (14; tags on the sheet, the decision line on hover)

| Trait | Line (what it does; what to do) |
|---|---|
| Steady hands | Aims true, recoil barely moves them, sees further into the dark. Give them the best gun and the loophole that matters. |
| Coward | Breaks sooner and may flee the loophole when the wall goes. Keep them on the firestep. |
| Bloodthirsty | Lifts after a kill-heavy night but may fire on a Hold order. The wall suits them; a quiet post does not. |
| Gentle | Kills and cruel choices weigh on them. Keep them off the wall when you can and counsel them after. |
| Iron will | Hardly ever breaks; holds when the wall buckles. Leave them on the worst post; the last to need counsel. |
| Fragile | Breaks sooner and worse. Counsel them first after a bad night. |
| Drinker | Mood falls without a round from the still; may binge when they break. Pour one, or counsel them. |
| Kind | Friendships grow fast, never starts a fight. Put them beside the fragile; cruel choices weigh on them. |
| Abrasive | Starts fights, lashes out when they break. Keep them apart from rivals; counsel them before they snap. |
| Secretive | Might hide a bite after a search. Look them over when they come home. |
| Tough | Wounds land lighter and heal faster; pain and long shifts slow them less. Send them where it hurts. |
| Big eater | Eats 1.6 rations. The mouth to weigh when the larder is short. |
| Lean | Gets by on 0.7 rations. Cheap to keep through a hungry week. |
| Green thumb | The garden grows half again for them. The one to put on Food. |

Grouped by the decision: the wall (Steady, Coward, Bloodthirsty, Gentle), counselling (Iron will, Fragile,
Drinker, Abrasive), the house (Kind, Abrasive, Secretive), the body and the larder (Tough, Big eater, Lean,
Green thumb). Conflicting pairs never roll together (Steady/Coward, Coward/Iron will, Iron will/Fragile,
Kind/Abrasive, Bloodthirsty/Gentle, Big eater/Lean).

**Cut** (only a ±% or a ±mood number, no decision): Stubborn hope (+8 mood), Grim (−8 mood, folded into
Fragile), Shift worker / Idle (±20% work; Shift worker folded into Tough), Slow healer, Dry (only existed
to oppose Drinker), Tinkerer (+2 crafting), Night owl (folded into Steady hands), Jittery (folded into
Coward), Faithful (folded into Gentle: every event that moved the faithful now moves the gentle).

### Perks (the mastery layer)

Two per skill and tier (4 and 7), and every pair is a fork you can see:

| Skill | 4 | 7 |
|---|---|---|
| Shooting | Tap-rack (jams clear 40% faster) / Quick hands (reload 25% faster) | Bead (weakspots) / Dead eye (aim +8) |
| Building | Mason (repairs +25%) / Thrifty (40% less timber) | Master hand (bench +50%) / Tireless (40% less tired) |
| Medicine | Field medic (+50% wounds a day) / Clean hands (dressed wounds 15% better) | Surgeon (30% better) / Triage (twice the wounds) |
| Scavenging | Light step (30% less trouble) / Deep pockets (+15% haul) | Ghost (half the trouble) / Packrat (+30% haul) |
| Social | Easy talker (radio +30%: a clear signal) / Good listener (counsel half again: clears the worst thought from Social 4) | The voice (radio +60%) / Anchor (house mood +4) |

Cut: Iron back (a bigger Mason), Tinker (a smaller Master hand), Steady pace (a smaller Tireless),
Armorer (−25% jams), Warmth (+2 mood), Thick skin / Unshakable (break thresholds: Iron will's job),
Confessor (a bigger Good listener), and the four farming perks.

## Easy to learn, hard to master

- **Learn:** five skills you can name from the job menu; one attribute; a ★ gun; trait lines that tell you
  what to do. A new player reads "Coward: keep them on the firestep" and does it.
- **Master:** the forks are in the combinations. A Tough Scavenger with Light step is the run you can send
  every day; a Steady hand with a ★ shotgun and Tap-rack holds the loophole; a Social 4 Good listener can
  carry a Fragile and an Abrasive through a bad week, but then nobody is on the radio. Passions (×1.5 XP)
  decide who specialises; perks at 4 and 7 reward keeping people on one job, and the house pays for it in
  flexibility.

## Save migration (`migrateSurvivor`, `migrateTraits` in `src/sim/survivors.ts`)

On load, every survivor (living and buried):
- **Skills:** building = max(building, crafting); social = max(social, psych); farming dropped. XP and
  arrival values move with the larger one. Passions map the same way (farming passions drop).
- **Guns:** shooting = max(shooting, best proficiency, heavy training). The favourite is the class with the
  highest proficiency (heavy if training beat every class); a survivor with none rolls one. `prof`,
  `training` and their XP are deleted.
- **Grit:** grit 7+ becomes Tough; the attribute and its XP go.
- **Traits:** Night owl → Steady hands, Jittery → Coward, Grim → Fragile, Faithful → Gentle, Shift worker →
  Tough; Stubborn hope, Dry, Idle, Slow healer, Tinkerer drop. Duplicates and conflicting pairs keep the first.
- **Perks:** cut perks drop; an offer for a cut skill goes; any tier a skill has reached with no perk is
  offered again, so nobody loses a pick.
- Idempotent: migrating twice changes nothing (`tools/simtest.ts`).

The hall of remembered names (legacy) keeps old trait ids; an heir inherits through the same map.

## Left for later

- Runs (`src/night/expedition.ts`) read only Scavenging. Coward and Tough could matter on a run (a coward
  bolting at the first Sleeper, the tough one walking off a bite) to make "who goes out" sharper.
- The day card still shows the top two skills; it could show the trait tags too, if the card has room.
