# Balance pass: guns, Turned and ammunition

Goal: shooting should feel great and powerful, and stay balanced. This doc comes from a Monte-Carlo harness, `tools/balance.ts`. It measures every gun × ammo type × Turned × distance × survivor skill × firing style against the targets in research 05 (combat depth) and 06 (scarcity). It then proposes a **concrete patch of 63 numeric changes** and re-runs the harness with the patch applied in memory to show that the targets are met. **All 10 checks pass with the patch; 4 of 10 pass today.**

```
npx tsx tools/balance.ts                 # BASE then PATCH, ~10 s, prints every table below
npx tsx tools/balance.ts --quick         # 1/3 the samples
npx tsx tools/balance.ts --only base     # or --only patch
npx tsx tools/balance.ts --md out.md     # also write the tables to a file
npx tsx tools/balance.ts --cell smg patch --z deputy   # debug one gun: every distance/style
```

The harness reads `WEAPON_ORDER`, `ammoTypesFor()` and `fireProfile()`, so guns and ammo the arsenal agent adds are picked up automatically. Area weapons (launchers, grenades) are **not** modelled: the harness has only `castShot()` rays. A blast radius would need its own hit routine in `tools/balance.ts`.

---

## 1. Method

**Geometry: a copy of `src/night/battle.ts`.** The player is at slot 0. The muzzle is at (333, 556): `x + SH·0.45`, `y − SH·0.68`. Each Turned spawns at a random lane y in [616, 690], with scale `0.92 + 0.16·lane` and `ZS = 1.3`. `hitbox()` is copied exactly: a head circle (radius `headH × 0.62`; the crawl head for Drags) and a body slab box. `castShot()` is a ray test that sorts hits, applies pierce, and multiplies damage by 0.7 per extra body. `damage()` gives head ×3 (pellet ×2), armour via `armorDamage(dmg, armor, armorPen)`, and knockback `knock × (pellet ? 0.25 : 1) × (head ? 1.4 : 1) × (at wall ? 0.5 : 1)`. Ferrymen are immune to knockback. Distances are 150, 400 and 700 px from the muzzle (150 px is at the wire, just past the wall).

**Contract.** Every number comes from `fireProfile(weaponItem)` at cond 1 (the economy uses cond 0.85): dmg, pellets, spread, pierce, armorPen, knock, noise, incendiary (BURN 16 dps × 3.5 s), range (half damage beyond it), reload (whole magazine or per round), mag, rof, burst/burstGap, jam/jamClear, recoverable, perShot, bloomMul, switchTime.

**Shooters.** Survivor `aim = 0.45 + 0.05 × shooting`. Skills 2, 5 and 8 give 0.55, 0.70 and 0.85.
- **spray**: the player holds or clicks at max rof at the body centre (mouse error σ = 12 px) and needs 0.15 s to swing to the next body. With an auto gun the trigger stays down through that swing, so those rounds are wasted and bloom keeps climbing.
- **tap** (disciplined): the player aims at the head, or at the upper chest with pellet guns (mouse error σ = 8 px + 0.04 × target speed). It takes 0.3 s to swing to a new head, and the player waits for bloom to settle before each shot.
- **guard**: `updateGuard()` copied exactly. Head chance is `0.2 + 0.25·aim`. Gaussian error is `(spread·1.2 + (1.15 − aim)·0.07)·(1 + d/900)`. Cooldown is `(1/rof)·(auto ? 1.3 : 1.6)·U(0.9, 1.25)`, and reload is ×1.15.
- **competent player** = spray at 150 px (40% of kills), tap at 400 px (40%), tap at 700 px (20%).

The player's spread is `spread × (1.75 − aim) + bloom`, applied as triangular noise. Bloom per shot is `spread × 0.35 + (auto ? 0.004 : 0.012)`, capped at 0.12 and decaying linearly at 0.12/s. Pellets use the bare cone. These are the formulas in `battle.ts` today. The patch replaces them (§4).

**Measurements per cell** (120 sequential kills at a fixed distance, so reload is amortised):
- rounds per kill (RPK)
- sustained time-to-kill (TTK)
- headshot share of kills
- wall-time bought (knockback px ÷ walking speed)
- noise per kill
- ammo cost per kill
- **first kill**: time to drop one target with a loaded, cool gun, the "answer" to a Ferryman or Deputy

**Wave.** 60 Sleepers walk in at 4/s. The result is the gun's throughput in kills/min and wall pressure (zombie-seconds at the wall per Sleeper). Shotgunners hold fire until 450 px.

**Ammo cost** is in scrap-equivalent: scrap 1, wood 0.5, cloth 1, fuel 2, parts 3, taken from the cheapest recipe (hollow-points include the FMJ they are drilled from). Recovered bolts are netted out.

**Power-fantasy check.** There are 47 metrics:
- TTK for each of 7 Turned × 3 distances
- first kill on Pulper, Deputy, Ferryman and Crier
- cost per kill per Turned
- wall-time bought per Turned
- "night value" per Turned: TTK + 1 s per scrap-eq + noise ÷ 28
- the gun in a guard's hands (shooting 2 and 5, at 150 and 400 px)
- guard ammo per kill
- wave cost per kill, wave kills/min, wave wall pressure
- noise per kill

A gun has a **niche** on a metric if it is top 3 or within 5% of the best there. A metric where more than half the guns tie counts for nobody. **Dominated** means another gun is at least as good on every metric (2% tolerance). **Dominant** means within 10% of the best TTK in ≥ 60% of the TTK cells. Each gun is scored with its best ammo type per metric.

**Economy, days 1–23.** The real `newGame()`, `threatPoints()` and `planNight()` run over 12 seeds across the three personas. The loadout grows: service9 / revolver / pump, then + lever, then + r22 / lever leader, then AR-15 leader + SMG + hunting rifle from day 12. The leader takes 1.6 shares of the kills and guards are shooting 3. RPK is credited ×0.85 in a crowd, because misses hit the next body. Stragglers come from noise (28 noise → 1 Turned, which recurses). Crafters: 1, then 2 from day 8, then 3 from day 15, at 5.7 work/day each. Scavengers: 1, then 2 from day 8, at the best ammo sites (scrap and fuel weighted up when low), with site stock depleting. The still gives +2 fuel/day from day 6. Half of all materials are reserved for the wall. The crafter stops at 3 nights of stock (6 from day 19, when the ice is forecast). Verdict per day = stock after the night ÷ that night's spend, worst calibre: **BROKE < 0.5 ≤ tight < 1.5 ≤ hover < 4 ≤ HOARD**.

**Not modelled:**
- Limb zones and `limbMul` (battle.ts has no limbs yet).
- Crier summons and Pulper bursts.
- Molotovs, traps, turrets and melee.
- Light and fog (the flare gun is scored as utility).
- Guard target priority.

The mouse-error σ is an assumption. 8 px for a careful click on a moving head is a decent mid-skill human.

---

## 2. Findings in the current data (BASE)

1. **Spraying is not punished.** Bloom caps at 0.12 rad, and kills take 2–3 hits, so bloom never climbs far before the next target. At 700 px, tapping saves only **1.5–2.4×** rounds on the autos (SMG 1.6, carbine 2.4, LMG 1.9, nailer 1.5; target ≥ 3). The SMG and the burst pistol cannot one-shot a Sleeper's head (20×3 = 60 and 22×3 = 66, both below 70), so even perfect taps need two hits.
2. **The 5.56 trio dominates.** The AR-15, carbine and LMG are within 10% of the best TTK in ≥ 60% of all zombie × distance cells. They hold 20–24 niches each. The AR-15 one-shots every head below a Ferryman at 5 rof with a 30-round magazine, which makes it the best gun at almost everything.
3. **Five guns have no niche:** revolver, 1911, burst pistol, .410 and lever. The **pipe gun is strictly dominated by the pump** on every metric.
4. **Shotguns have no crowd identity.** Pellets have pierce 0, so in a single lane the whole cone stops in the first body: one kill per shell. Buckshot at 700 px also does full damage, because nothing falls off with distance, so the pump is as good at the far end of the road as at the wire. The pellet cone also ignores aim, so shotguns are skill-neutral.
5. **Flechettes, the "plate-cracker" shell, are worse than buckshot against Deputies:** 4.2 vs 3.6 rounds per kill. Flat armour 16 eats an 8.8-damage pellet whole, even with armorPen 0.5.
6. **Rifle AP is a trap on the scoped .308** (it shows in some seeds). The gun already has armorPen 0.5, AP's ×0.92 damage cuts the pierce chain, and the round costs 2.0 scrap-eq versus 0.94.
7. **Bullet sponges per threat point:** the **Drag** costs 0.6 threat but takes as long to kill as a Sleeper (1.40 s per threat point vs 0.99 for a Sleeper). The Ferryman is **not** a sponge (0.55 s/pt). Two broadheads to the head kill it (compound bow 3.8 s sustained), which fits doc 05's "bolts and slugs" answer.
8. **TTK spikes:**
   - .410: 14 s per Ferryman, 44 wall-seconds per Sleeper in a wave.
   - Muzzleloader: 5.8 s per kill, because of the 5.5 s reload.
   - Pipe gun: 2.7 s per kill.
   - Flare gun: 19 s per Ferryman. This is utility, which is fine.
9. **First trigger pull.** The service pistol does 37% of a Sleeper and the .22 24%. Every other non-auto gun is ≥ 50%.
10. **Survivor skill barely matters to the player.** `(1.75 − aim)` only spans 1.2 → 0.9 between shooting 2 and 8. Tapped RPK is within about 5% across skills.
11. **Economy: the house goes broke from day 12 on every seed and is out of ammunition by day 16.** Income is flat: one scavenging run gives about 15–25 rounds and sites deplete. Demand grows about 8× (20 → 160 rounds a night, 18 → 94 Turned). **Scrap** binds while fuel piles up (52 by day 23). Early on (days 1–2) the house hoards, because it starts with 130 pistol rounds.

---

## 3. Targets and checks

| check | BASE | PATCH |
|---|---|---|
| tap ≥3× fewer rounds than spray @700 (autos) | FAIL: smg 1.6, carbine 2.4, lmg 1.9, nailer 1.5 | PASS: smg 3.2, carbine 3.0, lmg 3.6, nailer 3.5 |
| median headshot share of the player's own kills (competent) 35-65% | PASS: median 63%, range 40%..66% | PASS: median 62%, range 41%..66% |
| headshot share of all kills on the wall (leader + guards) 35-55% | PASS: median 38%, range 29%..52% | PASS: median 35%, range 26%..58% |
| guard (skill 5) headshot share 20-45% | PASS: median 35% | PASS: median 34% |
| first trigger pull ≥50% of a Sleeper (non-auto guns except .22 and flare) | FAIL: below: service9 | PASS: all |
| one-shot Sleeper headshot for calibres ≥ pistol | FAIL: fail: mp93, smg | PASS: all |
| every gun has a niche | FAIL: no niche: revolver, m1911, mp93, snake410, lever | PASS: min 1 niches |
| no gun dominated everywhere | FAIL: pipe < pump | PASS: none |
| no gun dominant everywhere | FAIL: ar15, carbine, lmg | PASS: none |
| no trap ammo (alt ammo better than default somewhere) | PASS: none | PASS: none |

The player's own headshot share sits around 60%. In a side view, only *vertical* aim error matters, because horizontal error slides along the ray. A careful tap therefore lands about 90% heads, and a competent player's share is set by how often they are forced to spray at the wall. Doc 05's 35–55% is met for the **whole wall** (leader plus guards, 35–38%). Getting the player alone under 55% would mean shrinking heads to about `headR` 0.45. I recommend against that: it trades away the power fantasy for a statistic.

## 4. The patch: 63 exact changes

The harness's `PATCH` objects (`WEAPON_PATCH`, `AMMO_PATCH`, `ZOMBIE_PATCH`, `RECIPE_PATCH`, `SITE_PATCH`, `START_PATCH`, `PATCH_SWITCH`, `PATCH_MODEL`) in `tools/balance.ts` are the source of truth. If you change a number, change it there and re-run.

### 4a. Battle model (`src/night/battle.ts`, player fire)
Bloom and aim, from research 05 §3, tuned:
- **Bloom kick per shot replaces `spread·0.35 + (auto ? .004 : .012)`.** Look up the weapon id first, then the `weaponClass()`, and multiply by `fireProfile().bloomMul`. Values: pistol 0.022, smg 0.065, shotgun 0.05, rifle 0.03, lmg 0.045, bow 0.02, tool (nailer/rivet) 0.04, and **carbine 0.085** (by id).
- **Bloom cap 0.12 → 0.30.** **Decay:** hold for 0.12 s after a shot, then exponential with a 0.15 s half-life, replacing the linear 0.12/s. A 0.35 s pause nearly resets bloom; a held trigger never recovers.
- **Aimed shot:** if ≥ 0.35 s since the last shot (≥ 0.6 s for guns with rof ≤ 1.2) and bloom < 0.01, multiply spread by 0.6. Show a tight, solid crosshair ring.
- **Sway:** the aim point drifts by `(1 − aim) × 16` px. Use slow noise at about 0.7 Hz: about 7 px at shooting 2, 2.4 px at shooting 8. This is how survivor skill reaches the player's hand.
- **Pellet cone follows the shooter:** `cone = spread × (0.75 + bloom/0.08) × (1.3 − 0.3·aim)`, ×0.85 on an aimed shot.
- **Pellet falloff:** pellet damage × `clamp(1 − (t − 250)/400 × 0.65, 0.35, 1)`, where t is the ray distance in px. Full damage to 250 px, ×0.35 from 650 px. Buckshot is for the wire.
- **Head circle radius** `headH × 0.62 → × 0.56`: the skull, not the hair.
- **Stagger:** each body hit rolls `fireProfile().stagger`. For pellets, only 1 in 4 pellets rolls. On success the target freezes for 0.3 s: no walking, no wall damage.
- **HP inflation** `1 + 0.03·(day − 8)` → `1 + 0.02·(day − 8)`.
- **Dawn salvage:** if the wall held, add `0.12 × kills` scrap ("brass, nails and buckles picked off the road"). This makes income scale with the threat.

Guards (`updateGuard`) are unchanged.

### 4b–c. Data changes (weapons.ts for the arsenal agent; zombies.ts, world.ts, newgame.ts)

- weapons.ts `service9.dmg`: 26 → **32**
- weapons.ts `service9.rof`: 4 → **3.3**
- weapons.ts `m1911.dmg`: 38 → **42**
- weapons.ts `m1911.knock`: 16 → **18**
- weapons.ts `smg.dmg`: 20 → **22**
- weapons.ts `r22.dmg`: 17 → **22**
- weapons.ts `pipe.dmg`: 16 → **18**
- weapons.ts `pipe.knock`: 26 → **34**
- weapons.ts `pipe.pierce`: 0 → **1**
- weapons.ts `pump.pierce`: 0 → **1**
- weapons.ts `coach.pierce`: 0 → **1**
- weapons.ts `autoshot.pierce`: 0 → **1**
- weapons.ts `hunting.dmg`: 110 → **130**
- weapons.ts `hunting.rof`: 0.9 → **1**
- weapons.ts `hunting.armorPen`: 0.2 → **0.4**
- weapons.ts `snake410.dmg`: 11 → **13**
- weapons.ts `snake410.pellets`: 5 → **6**
- weapons.ts `snake410.knock`: 10 → **14**
- weapons.ts `snake410.reload`: 0.9 → **0.7**
- weapons.ts `muzzle.reload`: 5.5 → **3.6**
- weapons.ts `muzzle.spread`: 0.01 → **0.006**
- weapons.ts `muzzle.dmg`: 250 → **280**
- weapons.ts `ar15.dmg`: 44 → **40**
- weapons.ts `ar15.rof`: 5 → **4**
- weapons.ts `carbine.dmg`: 48 → **32**
- weapons.ts `carbine.spread`: 0.03 → **0.045**
- weapons.ts `carbine.rof`: 7 → **8**
- weapons.ts `lmg.dmg`: 42 → **36**
- weapons.ts `lmg.spread`: 0.06 → **0.075**
- weapons.ts `lmg.rof`: 12 → **10**
- weapons.ts `crossbow.reload`: 2.2 → **1.7**
- weapons.ts `nailer.perShot`: 0.05 → **0.08**
- weapons.ts `nailer.rof`: 6 → **8**
- weapons.ts AMMO_TYPES `rifle_ap.dmgMul`: 0.92 → **1**
- weapons.ts AMMO_TYPES `rifle_ap.pierceAdd`: 1 → **2**
- weapons.ts AMMO_TYPES `shell_flech.dmgMul`: 0.55 → **0.7**
- weapons.ts AMMO_TYPES `shell_flech.armorPen`: 0.5 → **0.9**
- zombies.ts `sleeper.hp`: 70 → **64**
- zombies.ts `drag.cost`: 0.6 → **0.8**
- world.ts recipe `ammo_light`: {"cost":{"scrap":3,"fuel":1},"gives":{"light":30},"work":3} → **{"cost":{"scrap":2,"fuel":1},"gives":{"light":40},"work":2}**
- world.ts recipe `ammo_shell`: {"cost":{"scrap":3,"fuel":1,"cloth":1},"gives":{"shell":12},"work":3} → **{"cost":{"scrap":2,"fuel":1,"cloth":1},"gives":{"shell":16},"work":2}**
- world.ts recipe `ammo_rifle`: {"cost":{"scrap":4,"fuel":2,"parts":1},"gives":{"rifle":12},"work":4} → **{"cost":{"scrap":3,"fuel":1,"parts":1},"gives":{"rifle":15},"work":2}**
- world.ts recipe `ammo_r556`: {"cost":{"scrap":4,"fuel":2,"parts":2},"gives":{"r556":30},"work":5} → **{"cost":{"scrap":3,"fuel":1,"parts":1},"gives":{"r556":40},"work":3}**
- newgame.ts starting stores `light`: 130 → **80**
- weapons.ts `lmg.switchTime` (new optional WeaponDef field, added in baseProfile): 0 → **0.15**
- weapons.ts `muzzle.switchTime` (new optional WeaponDef field, added in baseProfile): 0 → **0.1**
- world.ts site `route9.loot.scrap`: 3 → **5**
- world.ts site `millyard.loot.scrap`: 10 → **14**
- battle.ts model `bloomCap`: 0.12 → **0.3**
- battle.ts model `bloomDecay`: "linear" → **"exp"**
- battle.ts model `bloomHalfLife`: 0 → **0.15**
- battle.ts model `bloomHold`: 0 → **0.12**
- battle.ts model `kick`: null → **{"pistol":0.022,"smg":0.065,"shotgun":0.05,"rifle":0.03,"lmg":0.045,"bow":0.02,"tool":0.04,"carbine":0.085}**
- battle.ts model `sway`: 0 → **16**
- battle.ts model `headR`: 0.62 → **0.56**
- battle.ts model `salvage`: 0 → **0.12**
- battle.ts model `aimedMul`: 1 → **0.6**
- battle.ts model `aimedDelay`: 0 → **0.35**
- battle.ts model `aimedBloomMax`: 0 → **0.01**
- battle.ts model `pelletAim`: false → **true**
- battle.ts model `pelletFall`: null → **[250,650,0.35]**
- battle.ts model `staggerS`: 0 → **0.3**
- battle.ts model `hpMul`: 1+0.03×(day−8) → **1+0.02×(day−8)**

`switchTime` is a new optional `WeaponDef` field. `baseProfile()` should start `switchTime` from `d.switchTime ?? 0` instead of 0.

### Why each change
- **Service pistol 26 → 32, rof 4 → 3.3:** the first pull does 50% of a Sleeper, every head is a one-shot, and it is no longer the fastest gun at everything.
- **1911 42 / knock 18:** two body hits kill a Deer, and it shoves hardest of the handguns.
- **SMG 22, .22 at 22:** a one-shot head on a 64-hp Sleeper, so taps pay off. The .22 becomes the cheap, quiet head-popper its niche text promises.
- **Shotguns pierce 1:** buckshot reaches the second rank, giving shotguns crowd throughput (pump wave 72 → 88 kills/min, coach 76 → 103) and zero wall pressure. The falloff keeps them off the far road.
- **Pipe gun 18 × 8, knock 34, pierce 1:** no longer dominated. It is the hardest single-barrel shove (68 px per pull).
- **.410 13 × 6, knock 14, reload 0.7:** first pull is 102% of a Sleeper and wave wall pressure drops from 44 to 9. It is the frugal guard gun.
- **Hunting rifle 130 / rof 1.0 / armorPen 0.4:** one body shot drops a Pulper (and a Deputy at full condition).
- **Muzzleloader 280 / 3.6 s / spread 0.006:** the reliable one-shot Ferryman headshot through four bodies. TTK drops from 5.8 to 4.1 s and wave pressure from 13 to 0.4.
- **AR-15 40 / rof 4; carbine 32 / 0.045 / rof 8; LMG 36 / 0.075 / rof 10 / swing 0.15 s:** this breaks the 5.56 dominance. The carbine and LMG become hoses whose rounds are wasted when sprayed far (tap ÷ spray 3.0 and 3.6). The AR-15 stays the accurate all-rounder.
- **Crossbow reload 1.7:** first kill on Pulpers and Deputies.
- **Nailer rof 8, perShot 0.08:** still the cheapest gun to feed, now a real hose.
- **Flechettes ×0.7 dmg, armorPen 0.9:** the anti-Deputy shell (12 nails through plate).
- **AP ×1.0 dmg, +2 pierce:** through plate *and* through lines. It is no longer a trap.
- **Sleeper 70 → 64 hp:** every pistol calibre one-shots the head, two service-pistol body hits kill, and the knock-on shortens nights by about 6%.
- **Drag cost 0.6 → 0.8:** it is not a bullet sponge per threat point any more (1.40 → 1.18 s/pt).
- **Recipes:** larger batches, less work and fuel. Late-game demand is *labour*-bound, and three crafters must be able to keep up. Soft-point and AP recipes are unchanged (premium rounds).
- **Start with 80 pistol rounds (was 130)**, as doc 06 #9 proposes. This removes the opening hoard.
- **Route 9 / mill yard scrap +2 / +4:** early scrap was the binding resource.

---

## 5. Feel numbers for the battle integrator

The power fantasy lives in feel, not in bigger numbers. Every pull of a non-auto gun already does ≥ 50% of a Sleeper and every calibre ≥ pistol pops a head in one shot. Sell that with hitstop, shake and kick scaled to **trigger-pull damage relative to a Sleeper**, and let autos feel like a hose, not a hammer.

| class | hitstop on hit / kill / head-kill (ms) | screen shake px (per pull) | recoil kick px (sprite) | muzzle light r | notes |
|---|---|---|---|---|---|
| pistol (service, 1911, flare) | 0 / 35 / 60 | 4.5–5 | 8–9 | 200 | the 1911 adds a 120 ms target flinch (knock 18) |
| magnum (revolver, burst pistol) | 20 / 50 / 75 | 5.5–5.7 | 9–10 | 230 | revolver: brief muzzle-rise pose, 80 ms |
| SMG / carbine / LMG / nailer | 0 / 25 / 40, **at most one hitstop per 0.15 s** | 3–3.6 per shot, **not stacking**: `shake = max(shake, x)` | 4 | 160 flicker | climb tick on the crosshair; LMG adds 1.5 px ground rumble while firing |
| shotgun (pump, autoshot, .410, pipe) | 45 / 70 / 90 per **pull** (not per pellet); multi-kill 90 | 6–7.3 | 11–14 | 260 | knock ≥ 40 px per pull → stagger anim + dust puff |
| coach gun, muzzleloader | 80 / 110 / 110 | 9–9.5 | 18 | 300 (+ smoke for the muzzleloader) | 120 ms slow-mo on a 2+ kill |
| bolt / lever / scoped rifle | 40 / 70 / 90, +20 per extra pierced body (cap 120) | 6–7 | 11–13 | 240 | show the tracer through each pierced body |
| bows (compound, crossbow) | 30 / 60 / 80 | 2 (no muzzle shake: it is silent) | 6 | 0 | thunk SFX; arrow sticks in the corpse |

Knockback feel (gameplay `knock` is unchanged; this is the visual read):
- total px per pull ≥ 40 → stagger animation + dust
- 15–40 → 120 ms flinch
- < 15 → 60 ms flinch
- Ferrymen never flinch. Shake 2 px on their footfalls instead.

Per-gun derived values (patched; computed by `feel()` in the harness):

| gun | class | pull dmg (body) | hitstop ms | shake px | recoil kick px | knock px/hit | knock feel |
|---|---|---|---|---|---|---|---|
| service9 | pistol | 32.0 | 18 | 4.8 | 8 | 4.00 | light: 60 ms flinch |
| revolver | pistol | 55.0 | 30 | 5.5 | 9 | 10.0 | light: 60 ms flinch |
| m1911 | pistol | 42.0 | 18 | 5.1 | 9 | 18.0 | medium: 120 ms flinch |
| mp93 | pistol | 66.0 | 42 | 5.7 | 10 | 3.00 | light: 60 ms flinch |
| smg | smg | 22.0 | 0 | 3.1 | 4 | 3.00 | light: 60 ms flinch |
| r22 | rifle | 22.0 | 18 | 4.4 | 7 | 1.00 | light: 60 ms flinch |
| pump | shotgun | 128 | 85 | 7 | 13 | 60.0 | heavy: stagger anim + dust |
| coach | shotgun | 306 | 110 | 9.5 | 18 | 90.0 | heavy: stagger anim + dust |
| snake410 | shotgun | 78.0 | 53 | 6 | 11 | 21.0 | medium: 120 ms flinch |
| pipe | shotgun | 144 | 93 | 7.3 | 14 | 68.0 | heavy: stagger anim + dust |
| autoshot | shotgun | 104 | 72 | 6.6 | 12 | 44.0 | heavy: stagger anim + dust |
| hunting | rifle | 130 | 86 | 7.1 | 13 | 18.0 | medium: 120 ms flinch |
| lever | rifle | 78.0 | 53 | 6 | 11 | 14.0 | light: 60 ms flinch |
| scoped | rifle | 135 | 88 | 7.1 | 13 | 20.0 | medium: 120 ms flinch |
| muzzle | rifle | 280 | 110 | 9.2 | 18 | 45.0 | heavy: stagger anim + dust |
| ar15 | rifle | 40.0 | 18 | 5 | 9 | 6.00 | light: 60 ms flinch |
| carbine | rifle | 32.0 | 0 | 3.5 | 4 | 8.00 | light: 60 ms flinch |
| lmg | lmg | 36.0 | 0 | 3.6 | 4 | 9.00 | light: 60 ms flinch |
| compound | bow | 90.0 | 62 | 6.3 | 11 | 6.00 | light: 60 ms flinch |
| crossbow | bow | 140 | 91 | 7.2 | 13 | 12.0 | light: 60 ms flinch |
| flaregun | pistol | 30.0 | 18 | 4.7 | 8 | 4.00 | light: 60 ms flinch |
| nailer | tool | 22.0 | 0 | 3.1 | 4 | 2.00 | light: 60 ms flinch |
| rivet | tool | 62.0 | 38 | 5.6 | 10 | 7.00 | light: 60 ms flinch |

Rules of thumb:
- Hitstop scales with `log2(pull ÷ Sleeper HP)` (40 + 45·log2, clamped 18–110 ms).
- Shake is `2.5 + 3.2·√(pull ÷ Sleeper HP) × recoilMul` px.
- Autos never hitstop per shot.
- `recoilMul` (brake, sling) scales shake and kick. `bloomMul` scales bloom.

---

## 6. Tables

### 6a. BASE → PATCH per gun (default ammo, shooting 5)
"tap÷spray" here uses 120 kills per cell. The check in §3 uses 600.

| gun | 1st pull %Slp | tap÷spray@700 | TTK s (comp.) | HS% (comp.) | Deputy RPK (comp.) | Ferry TTK | wave k/min | wall-s/Slp | cost/kill | noise/kill |
|---|---|---|---|---|---|---|---|---|---|---|
| service9 | 37% → 50% | 2.29 → 1.66 | 0.65 → 0.65 | 60% → 60% | 6.33 → 4.72 | 4.95 → 5.05 | 131 → 96.2 | 0.00 → 0.00 | 0.32 → 0.15 | 1.91 → 1.52 |
| revolver | 79% → 86% | 1.67 → 1.63 | 1.19 → 1.25 | 59% → 60% | 1.92 → 1.96 | 5.43 → 5.63 | 131 → 109 | 0.00 → 0.00 | 0.25 → 0.15 | 2.09 → 2.13 |
| m1911 | 54% → 66% | 1.64 → 1.67 | 0.76 → 0.84 | 59% → 58% | 3.68 → 2.80 | 4.96 → 4.89 | 102 → 82.9 | 0.00 → 0.03 | 0.25 → 0.15 | 1.81 → 1.84 |
| mp93 | 94% → 103% | 1.40 → 1.78 | 0.93 → 0.63 | 49% → 58% | 10.0 → 10.0 | 5.18 → 5.24 | 93.0 → 90.3 | 0.00 → 0.00 | 0.52 → 0.21 | 4.99 → 3.34 |
| smg | 29% → 34% | 1.67 → 2.95 | 0.76 → 0.80 | 49% → 61% | 14.1 → 9.92 | 4.97 → 6.26 | 85.7 → 99.5 | 0.00 → 0.00 | 0.59 → 0.25 | 8.49 → 6.04 |
| r22 | 24% → 34% | 2.28 → 2.41 | 0.94 → 0.84 | 60% → 60% | 21.2 → 9.51 | 6.95 → 7.25 | 78.8 → 73.8 | 0.55 → 1.05 | 0.33 → 0.20 | 1.16 → 0.68 |
| pump | 114% → 100% | 0.96 → 1.05 | 1.25 → 1.46 | 31% → 34% | 3.96 → 4.68 | 6.98 → 11.6 | 72.0 → 87.9 | 2.71 → 0.00 | 0.50 → 0.37 | 2.02 → 2.36 |
| coach | 121% → 106% | 0.98 → 1.11 | 1.47 → 1.61 | 34% → 28% | 3.46 → 4.19 | 5.24 → 9.15 | 76.1 → 103 | 0.94 → 0.00 | 0.50 → 0.36 | 2.82 → 3.21 |
| snake410 | 79% → 102% | 1.16 → 1.22 | 1.77 → 1.22 | 34% → 35% | 8.22 → 7.28 | 14.1 → 11.7 | 35.8 → 63.2 | 44.34 → 9.35 | 0.21 → 0.11 | 1.88 → 1.55 |
| pipe | 114% → 113% | 0.96 → 1.07 | 2.74 → 3.25 | 30% → 30% | 4.09 → 4.24 | 14.9 → 21.1 | 40.0 → 69.0 | 23.78 → 4.67 | 0.51 → 0.37 | 2.22 → 2.58 |
| autoshot | 111% → 102% | 0.98 → 1.07 | 0.79 → 1.02 | 35% → 28% | 4.49 → 5.42 | 5.81 → 10.3 | 80.2 → 100 | 0.50 → 0.00 | 0.50 → 0.38 | 2.52 → 3.03 |
| hunting | 157% → 203% | 0.94 → 0.92 | 1.55 → 1.51 | 58% → 55% | 1.44 → 1.07 | 4.95 → 4.93 | 109 → 113 | 0.00 → 0.00 | 0.94 → 0.56 | 2.26 → 2.32 |
| lever | 111% → 122% | 0.96 → 0.88 | 0.92 → 1.05 | 58% → 57% | 1.46 → 1.52 | 4.46 → 4.71 | 127 → 130 | 0.00 → 0.00 | 0.94 → 0.57 | 2.04 → 2.14 |
| scoped | 193% → 211% | 0.98 → 0.97 | 1.65 → 1.69 | 59% → 55% | 1.02 → 1.05 | 4.49 → 4.56 | 102 → 120 | 0.00 → 0.00 | 0.94 → 0.56 | 2.46 → 2.50 |
| muzzle | 357% → 438% | 0.98 → 0.94 | 5.80 → 4.05 | 58% → 55% | 1.01 → 1.06 | 10.2 → 5.49 | 44.8 → 77.0 | 12.99 → 0.41 | 0.41 → 0.42 | 3.06 → 3.12 |
| ar15 | 63% → 63% | 1.83 → 1.62 | 0.45 → 0.74 | 60% → 60% | 2.26 → 2.73 | 2.21 → 4.28 | 188 → 165 | 0.00 → 0.00 | 0.68 → 0.30 | 3.21 → 3.34 |
| carbine | 69% → 50% | 2.46 → 3.01 | 0.49 → 0.77 | 60% → 60% | 2.72 → 4.31 | 1.82 → 4.62 | 205 → 160 | 0.00 → 0.00 | 0.88 → 0.40 | 4.88 → 5.17 |
| lmg | 60% → 56% | 1.94 → 3.57 | 0.41 → 0.73 | 57% → 57% | 2.93 → 4.54 | 1.83 → 3.53 | 238 → 160 | 0.00 → 0.00 | 0.94 → 0.51 | 6.87 → 8.75 |
| compound | 129% → 141% | 0.94 → 0.92 | 0.99 → 1.01 | 58% → 53% | 1.48 → 1.54 | 3.75 → 3.83 | 104 → 89.6 | 0.00 → 0.00 | 0.05 → 0.05 | 0.10 → 0.11 |
| crossbow | 200% → 219% | 0.95 → 0.95 | 2.46 → 2.01 | 59% → 55% | 1.03 → 1.02 | 6.44 → 5.08 | 63.7 → 95.8 | 3.25 → 0.00 | 0.07 → 0.08 | 0.15 → 0.16 |
| flaregun | 43% → 47% | 0.90 → 0.94 | 1.90 → 1.92 | 55% → 55% | 2.72 → 2.73 | 19.2 → 19.3 | 32.2 → 32.1 | 28.51 → 27.63 | 2.09 → 2.12 | 1.04 → 1.06 |
| nailer | 31% → 34% | 1.51 → 3.83 | 0.76 → 0.69 | 51% → 61% | 9.66 → 9.85 | 4.57 → 5.90 | 120 → 138 | 0.00 → 0.00 | 0.01 → 0.02 | 1.52 → 1.17 |
| rivet | 89% → 97% | 1.70 → 1.70 | 1.18 → 1.19 | 60% → 60% | 1.88 → 1.90 | 4.35 → 4.48 | 110 → 106 | 0.00 → 0.00 | 0.09 → 0.09 | 0.89 → 0.90 |

### 6b. PATCH, every gun × ammo (shooting 5, Sleeper unless noted)
| gun/ammo | dmg×pel | 1st pull %Slp | RPK spray@400 | RPK tap@400 | tap÷spray@700 | TTK s (comp.) | HS% (comp.) | Deer TTK | Deputy RPK (comp.) | Ferry TTK | wave k/min | wall-s/Slp | cost/kill | noise/kill |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| service9 | 32.0×1 | 50% | 2.00 | 1.18 | 1.66 | 0.65 | 60% | 0.72 | 4.72 | 5.05 | 96.2 | 0.00 | 0.15 | 1.52 |
| service9/HP | 41.6×1 | 65% | 2.00 | 1.19 | 1.55 | 0.66 | 59% | 0.72 | 4.01 | 4.11 | 93.2 | 0.00 | 0.35 | 1.54 |
| revolver | 55.0×1 | 86% | 2.00 | 1.19 | 1.63 | 1.25 | 60% | 0.92 | 1.96 | 5.63 | 109 | 0.00 | 0.15 | 2.13 |
| revolver/HP | 71.5×1 | 112% | 1.00 | 1.09 | 0.90 | 0.88 | 55% | 0.92 | 1.92 | 4.58 | 78.0 | 0.42 | 0.24 | 1.48 |
| m1911 | 42.0×1 | 66% | 2.00 | 1.23 | 1.67 | 0.84 | 58% | 0.90 | 2.80 | 4.89 | 82.9 | 0.03 | 0.15 | 1.84 |
| m1911/HP | 54.6×1 | 85% | 2.00 | 1.19 | 1.58 | 0.84 | 59% | 0.61 | 2.79 | 3.85 | 73.6 | 0.90 | 0.34 | 1.84 |
| mp93 | 22.0×1×3b | 103% | 3.00 | 1.36 | 1.78 | 0.63 | 58% | 0.63 | 10.0 | 5.24 | 90.3 | 0.00 | 0.21 | 3.34 |
| mp93/HP | 28.6×1×3b | 134% | 3.00 | 1.27 | 1.78 | 0.62 | 60% | 0.59 | 13.1 | 4.37 | 89.1 | 0.00 | 0.46 | 3.26 |
| smg | 22.0×1 | 34% | 4.13 | 1.39 | 2.95 | 0.80 | 61% | 0.80 | 9.92 | 6.26 | 99.5 | 0.00 | 0.25 | 6.04 |
| smg/HP | 28.6×1 | 45% | 4.13 | 1.43 | 3.34 | 0.79 | 60% | 0.75 | 13.0 | 4.88 | 93.1 | 0.00 | 0.56 | 5.98 |
| r22 | 22.0×1 | 34% | 3.00 | 1.27 | 2.41 | 0.84 | 60% | 0.85 | 9.51 | 7.25 | 73.8 | 1.05 | 0.20 | 0.68 |
| pump | 16.0×8 | 100% | 1.00 | 1.00 | 1.05 | 1.46 | 34% | 1.34 | 4.68 | 11.6 | 87.9 | 0.00 | 0.37 | 2.36 |
| pump/slug | 89.6×1 | 140% | 1.00 | 1.07 | 0.89 | 1.31 | 55% | 1.38 | 1.51 | 5.10 | 90.7 | 0.00 | 0.74 | 2.10 |
| pump/flech | 11.2×12 | 105% | 1.00 | 1.01 | 1.11 | 1.45 | 33% | 1.25 | 2.05 | 7.34 | 105 | 0.00 | 1.05 | 2.33 |
| pump/fire | 8.80×8 | 110% | 1.00 | 1.00 | 1.00 | 1.24 | 16% | 1.24 | 4.67 | 25.9 | 83.7 | 0.00 | 0.88 | 2.40 |
| coach | 17.0×9×2b | 106% | 1.00 | 1.00 | 1.11 | 1.61 | 28% | 1.49 | 4.19 | 9.15 | 103 | 0.00 | 0.36 | 3.21 |
| coach/slug | 107×1×2b | 167% | 1.00 | 1.13 | 0.86 | 1.55 | 55% | 1.56 | 1.56 | 4.34 | 118 | 0.00 | 0.76 | 3.03 |
| coach/flech | 11.9×14×2b | 112% | 1.00 | 1.00 | 1.45 | 1.52 | 30% | 1.47 | 1.44 | 5.33 | 117 | 0.00 | 0.95 | 2.97 |
| coach/fire | 9.40×9×2b | 103% | 1.01 | 1.02 | 1.00 | 1.63 | 20% | 1.62 | 4.67 | 19.0 | 98.7 | 0.00 | 1.06 | 4.07 |
| snake410 | 13.0×6 | 102% | 2.00 | 1.29 | 1.22 | 1.22 | 35% | 1.06 | 7.28 | 11.7 | 63.2 | 9.35 | 0.11 | 1.55 |
| snake410/slug | 54.6×1 | 85% | 2.00 | 1.17 | 1.71 | 1.29 | 60% | 1.02 | 1.94 | 5.20 | 91.9 | 0.00 | 0.26 | 1.65 |
| snake410/flech | 9.10×9 | 114% | 1.00 | 1.00 | 1.36 | 1.10 | 25% | 1.07 | 2.71 | 6.69 | 85.7 | 0.00 | 0.28 | 1.36 |
| snake410/fire | 7.20×6 | 68% | 1.00 | 1.00 | 0.97 | 0.94 | 1% | 0.93 | 6.87 | 33.2 | 80.0 | 2.15 | 0.22 | 1.33 |
| pipe | 18.0×8 | 113% | 1.00 | 1.00 | 1.07 | 3.25 | 30% | 2.87 | 4.24 | 21.1 | 69.0 | 4.67 | 0.37 | 2.58 |
| pipe/slug | 101×1 | 158% | 1.00 | 1.14 | 0.92 | 2.86 | 55% | 2.83 | 1.51 | 9.86 | 53.9 | 5.62 | 0.75 | 2.36 |
| pipe/flech | 12.6×12 | 118% | 1.00 | 1.00 | 1.20 | 3.13 | 30% | 2.80 | 1.54 | 13.2 | 78.1 | 0.53 | 1.02 | 2.49 |
| pipe/fire | 9.90×8 | 108% | 1.00 | 1.00 | 0.99 | 2.69 | 15% | 2.73 | 4.35 | 44.2 | 77.2 | 2.44 | 0.88 | 2.64 |
| autoshot | 13.0×8 | 102% | 1.00 | 1.00 | 1.07 | 1.02 | 28% | 0.93 | 5.42 | 10.3 | 100 | 0.00 | 0.38 | 3.03 |
| autoshot/slug | 72.8×1 | 114% | 1.00 | 1.07 | 0.92 | 1.01 | 55% | 1.09 | 1.52 | 4.54 | 145 | 0.00 | 0.73 | 2.62 |
| autoshot/flech | 9.10×12 | 114% | 1.00 | 1.00 | 1.03 | 1.00 | 27% | 0.91 | 2.35 | 6.07 | 114 | 0.00 | 1.08 | 3.00 |
| autoshot/fire | 7.20×8 | 90% | 1.00 | 1.00 | 1.01 | 0.83 | 3% | 0.83 | 5.48 | 28.2 | 91.8 | 0.00 | 0.88 | 3.00 |
| hunting | 130×1 | 203% | 1.00 | 1.09 | 0.92 | 1.51 | 55% | 1.55 | 1.07 | 4.93 | 113 | 0.00 | 0.56 | 2.32 |
| hunting/SP | 169×1 | 264% | 1.00 | 1.09 | 0.92 | 1.50 | 54% | 1.54 | 1.07 | 4.05 | 43.7 | 12.62 | 0.97 | 2.32 |
| hunting/AP | 130×1 | 203% | 1.00 | 1.09 | 0.93 | 1.50 | 54% | 1.54 | 1.05 | 3.98 | 145 | 0.00 | 2.10 | 2.31 |
| lever | 78.0×1 | 122% | 1.00 | 1.11 | 0.88 | 1.05 | 57% | 1.06 | 1.52 | 4.71 | 130 | 0.00 | 0.57 | 2.14 |
| lever/SP | 101×1 | 158% | 1.00 | 1.10 | 0.94 | 1.03 | 55% | 1.07 | 1.54 | 3.60 | 68.3 | 1.63 | 0.97 | 2.11 |
| lever/AP | 78.0×1 | 122% | 1.00 | 1.08 | 0.88 | 1.04 | 56% | 1.08 | 1.52 | 4.47 | 160 | 0.00 | 2.12 | 2.12 |
| scoped | 135×1 | 211% | 1.00 | 1.09 | 0.97 | 1.69 | 55% | 1.76 | 1.05 | 4.56 | 120 | 0.00 | 0.56 | 2.50 |
| scoped/SP | 176×1 | 274% | 1.00 | 1.07 | 0.92 | 1.69 | 56% | 1.78 | 1.07 | 3.58 | 38.3 | 17.49 | 0.96 | 2.51 |
| scoped/AP | 135×1 | 211% | 1.00 | 1.10 | 0.96 | 1.69 | 56% | 1.77 | 1.05 | 4.57 | 139 | 0.00 | 2.10 | 2.52 |
| muzzle | 280×1 | 438% | 1.00 | 1.07 | 0.94 | 4.05 | 55% | 4.32 | 1.06 | 5.49 | 77.0 | 0.41 | 0.42 | 3.12 |
| ar15 | 40.0×1 | 63% | 2.00 | 1.18 | 1.62 | 0.74 | 60% | 0.82 | 2.73 | 4.28 | 165 | 0.00 | 0.30 | 3.34 |
| carbine | 32.0×1 | 50% | 3.19 | 1.29 | 3.01 | 0.77 | 60% | 0.82 | 4.31 | 4.62 | 160 | 0.00 | 0.40 | 5.17 |
| lmg | 36.0×1 | 56% | 4.63 | 1.34 | 3.57 | 0.73 | 57% | 0.75 | 4.54 | 3.53 | 160 | 0.00 | 0.51 | 8.75 |
| compound | 90.0×1 | 141% | 1.00 | 1.09 | 0.92 | 1.01 | 53% | 1.03 | 1.54 | 3.83 | 89.6 | 0.00 | 0.05 | 0.11 |
| compound/fire | 72.0×1 | 113% | 1.00 | 1.07 | 0.88 | 1.01 | 55% | 1.03 | 1.55 | 4.70 | 131 | 0.00 | 0.53 | 0.11 |
| crossbow | 140×1 | 219% | 1.00 | 1.09 | 0.95 | 2.01 | 55% | 2.11 | 1.02 | 5.08 | 95.8 | 0.00 | 0.08 | 0.16 |
| crossbow/fire | 112×1 | 175% | 1.00 | 1.09 | 0.90 | 2.02 | 56% | 2.02 | 1.06 | 6.01 | 95.8 | 0.00 | 0.53 | 0.16 |
| flaregun | 30.0×1 | 47% | 1.00 | 1.12 | 0.94 | 1.92 | 55% | 1.97 | 2.73 | 19.3 | 32.1 | 27.63 | 2.12 | 1.06 |
| nailer | 22.0×1 | 34% | 4.48 | 1.23 | 3.83 | 0.69 | 61% | 0.75 | 9.85 | 5.90 | 138 | 0.00 | 0.02 | 1.17 |
| rivet | 62.0×1 | 97% | 2.00 | 1.16 | 1.70 | 1.19 | 60% | 0.88 | 1.90 | 4.48 | 106 | 0.00 | 0.09 | 0.90 |

### 6c. PATCH time-to-kill grid (default ammo, shooting 5, best of spray/tap, s)
| gun | slee150 | slee400 | slee700 | deer150 | deer400 | deer700 | drag150 | drag400 | drag700 | pulp150 | pulp400 | pulp700 | crie150 | crie400 | crie700 | depu150 | depu400 | depu700 | ferr150 | ferr400 | ferr700 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| service9 | 0.60 | 0.58 | 0.59 | 0.67 | 0.70 | 0.72 | 0.44 | 0.53 | 0.58 | 1.03 | 1.06 | 1.09 | 0.54 | 0.60 | 0.62 | 1.17 | 1.18 | 1.32 | 3.16 | 3.38 | 3.62 |
| revolver | 1.01 | 1.02 | 1.05 | 0.78 | 0.78 | 0.78 | 0.81 | 0.81 | 0.85 | 1.02 | 1.02 | 1.10 | 0.97 | 0.98 | 1.06 | 0.97 | 1.07 | 1.13 | 3.48 | 3.71 | 3.59 |
| m1911 | 0.73 | 0.76 | 0.73 | 0.72 | 0.86 | 0.82 | 0.50 | 0.52 | 0.56 | 0.72 | 0.76 | 0.79 | 0.72 | 0.72 | 0.76 | 0.72 | 0.80 | 0.81 | 3.02 | 3.19 | 3.50 |
| mp93 | 0.53 | 0.55 | 0.64 | 0.54 | 0.58 | 0.60 | 0.49 | 0.51 | 0.58 | 0.81 | 0.87 | 1.15 | 0.51 | 0.54 | 0.59 | 0.78 | 0.97 | 1.22 | 2.78 | 3.29 | 4.55 |
| smg | 0.61 | 0.64 | 0.84 | 0.60 | 0.68 | 0.84 | 0.37 | 0.61 | 0.97 | 1.07 | 1.13 | 1.45 | 0.60 | 0.67 | 0.79 | 1.45 | 1.79 | 2.05 | 5.24 | 4.69 | 5.69 |
| r22 | 0.79 | 0.79 | 0.78 | 0.79 | 0.79 | 0.79 | 0.30 | 0.37 | 0.46 | 1.58 | 1.58 | 1.54 | 0.75 | 0.77 | 0.79 | 1.64 | 1.69 | 1.78 | 6.39 | 6.27 | 6.35 |
| pump | 1.23 | 1.23 | 2.37 | 1.23 | 1.23 | 1.74 | 1.23 | 1.25 | 1.71 | 1.23 | 1.77 | 3.58 | 1.23 | 1.23 | 2.09 | 2.47 | 2.94 | 5.75 | 6.94 | 8.05 | 24.8 |
| coach | 1.42 | 1.42 | 2.18 | 1.42 | 1.42 | 1.44 | 1.43 | 1.42 | 1.80 | 1.42 | 1.62 | 3.32 | 1.42 | 1.42 | 2.08 | 2.08 | 2.74 | 5.82 | 4.95 | 5.93 | 21.7 |
| snake410 | 0.84 | 1.20 | 2.01 | 0.84 | 0.84 | 1.54 | 0.84 | 0.90 | 1.46 | 1.54 | 1.54 | 3.16 | 0.84 | 0.84 | 1.82 | 2.72 | 2.94 | 5.08 | 6.91 | 8.59 | 22.7 |
| pipe | 2.78 | 2.64 | 4.86 | 2.57 | 2.69 | 3.21 | 2.62 | 2.52 | 4.34 | 2.66 | 3.15 | 7.51 | 2.57 | 2.62 | 4.49 | 4.69 | 5.83 | 12.5 | 12.1 | 12.7 | 50.2 |
| autoshot | 0.71 | 0.71 | 1.62 | 0.71 | 0.71 | 1.39 | 0.74 | 0.75 | 1.43 | 1.36 | 1.45 | 2.83 | 0.71 | 0.71 | 1.48 | 2.14 | 2.50 | 5.05 | 6.37 | 7.61 | 21.9 |
| hunting | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 1.43 | 1.45 | 1.46 | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 1.41 | 3.06 | 3.46 | 3.58 |
| lever | 0.90 | 0.90 | 0.90 | 0.90 | 0.90 | 0.90 | 0.91 | 0.91 | 0.91 | 1.17 | 1.19 | 1.24 | 0.90 | 0.90 | 0.90 | 1.23 | 1.25 | 1.18 | 3.09 | 3.09 | 3.27 |
| scoped | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 1.62 | 1.63 | 1.66 | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 1.60 | 3.17 | 3.44 | 3.27 |
| muzzle | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.88 | 3.97 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 3.82 | 4.18 | 4.09 | 4.54 |
| ar15 | 0.62 | 0.62 | 0.62 | 0.62 | 0.62 | 0.62 | 0.30 | 0.33 | 0.36 | 0.79 | 0.84 | 0.88 | 0.62 | 0.62 | 0.62 | 0.81 | 0.81 | 0.90 | 3.92 | 4.02 | 3.88 |
| carbine | 0.58 | 0.63 | 0.83 | 0.58 | 0.66 | 0.78 | 0.51 | 0.81 | 0.87 | 0.99 | 1.02 | 1.27 | 0.58 | 0.63 | 0.82 | 1.39 | 1.37 | 1.69 | 3.98 | 3.79 | 4.30 |
| lmg | 0.64 | 0.71 | 0.86 | 0.70 | 0.73 | 0.84 | 0.59 | 0.66 | 0.80 | 1.03 | 1.04 | 1.40 | 0.65 | 0.68 | 0.82 | 1.23 | 1.29 | 1.51 | 3.07 | 2.98 | 3.87 |
| compound | 0.90 | 0.90 | 0.90 | 0.90 | 0.90 | 0.90 | 0.91 | 0.91 | 0.93 | 1.13 | 1.24 | 1.15 | 0.90 | 0.90 | 0.90 | 1.21 | 1.19 | 1.22 | 2.19 | 2.21 | 2.03 |
| crossbow | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 1.85 | 1.86 | 1.95 | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 1.84 | 3.74 | 3.79 | 4.04 |
| flaregun | 1.74 | 1.74 | 1.74 | 1.74 | 1.74 | 1.74 | 1.75 | 1.76 | 1.79 | 2.14 | 2.17 | 2.19 | 1.74 | 1.74 | 1.74 | 2.23 | 2.23 | 2.22 | 10.1 | 10.7 | 11.1 |
| nailer | 0.58 | 0.64 | 0.71 | 0.68 | 0.74 | 0.83 | 0.46 | 0.63 | 0.63 | 1.26 | 1.26 | 1.66 | 0.61 | 0.66 | 0.78 | 1.30 | 1.31 | 1.65 | 4.96 | 5.38 | 6.18 |
| rivet | 0.93 | 0.93 | 0.96 | 0.78 | 0.78 | 0.78 | 0.80 | 0.81 | 0.82 | 0.97 | 0.98 | 0.95 | 0.78 | 0.78 | 0.78 | 1.06 | 0.92 | 0.97 | 2.74 | 2.74 | 2.93 |

### 6d. PATCH skill sensitivity and guard efficiency (Sleeper at 400 px)
| gun | RPK sk2 | RPK sk5 | RPK sk8 | TTK sk2 | TTK sk8 | guard RPK sk2 | guard RPK sk5 | guard HS% sk5 |
|---|---|---|---|---|---|---|---|---|
| service9 | 1.31 | 1.18 | 1.16 | 0.62 | 0.60 | 2.16 | 2.01 | 34% |
| revolver | 1.27 | 1.19 | 1.09 | 1.06 | 0.96 | 1.97 | 1.84 | 42% |
| m1911 | 1.36 | 1.23 | 1.13 | 0.79 | 0.72 | 2.14 | 1.93 | 43% |
| mp93 | 1.39 | 1.36 | 1.30 | 0.56 | 0.55 | 2.97 | 2.99 | 38% |
| smg | 1.47 | 1.39 | 1.23 | 0.89 | 0.74 | 2.95 | 3.14 | 38% |
| r22 | 1.18 | 1.27 | 1.13 | 0.81 | 0.78 | 2.43 | 2.33 | 61% |
| pump | 1.00 | 1.00 | 1.00 | 1.25 | 1.25 | 1.08 | 1.06 | 29% |
| coach | 1.00 | 1.00 | 1.00 | 1.49 | 1.49 | 1.02 | 1.04 | 38% |
| snake410 | 1.30 | 1.29 | 1.22 | 1.20 | 1.15 | 1.73 | 1.68 | 35% |
| pipe | 1.00 | 1.00 | 1.00 | 2.86 | 2.84 | 1.07 | 1.11 | 25% |
| autoshot | 1.01 | 1.00 | 1.01 | 0.93 | 0.93 | 1.11 | 1.07 | 28% |
| hunting | 1.17 | 1.09 | 1.05 | 1.67 | 1.52 | 1.04 | 1.07 | 25% |
| lever | 1.12 | 1.11 | 1.16 | 1.16 | 1.18 | 1.07 | 1.11 | 33% |
| scoped | 1.11 | 1.09 | 1.07 | 1.80 | 1.74 | 1.07 | 1.04 | 28% |
| muzzle | 1.17 | 1.07 | 1.10 | 4.57 | 4.33 | 1.04 | 1.06 | 30% |
| ar15 | 1.23 | 1.18 | 1.13 | 0.82 | 0.78 | 1.97 | 1.86 | 43% |
| carbine | 1.31 | 1.29 | 1.14 | 0.88 | 0.81 | 2.03 | 2.03 | 36% |
| lmg | 1.45 | 1.34 | 1.25 | 0.76 | 0.67 | 2.24 | 2.24 | 32% |
| compound | 1.13 | 1.09 | 1.11 | 1.12 | 1.09 | 1.12 | 1.09 | 33% |
| crossbow | 1.13 | 1.09 | 1.03 | 2.20 | 2.04 | 1.06 | 1.07 | 26% |
| flaregun | 1.11 | 1.12 | 1.07 | 2.06 | 2.01 | 1.08 | 1.10 | 14% |
| nailer | 1.38 | 1.23 | 1.27 | 0.72 | 0.68 | 2.99 | 2.85 | 43% |
| rivet | 1.26 | 1.16 | 1.11 | 1.00 | 0.93 | 2.07 | 1.93 | 42% |

### 6e. PATCH niches
| gun | # niches | examples |
|---|---|---|
| service9 | 19 | TTK sleeper@150; TTK sleeper@400; TTK sleeper@700; TTK drag@400 … |
| revolver | 2 | first kill crier; wave cost/kill |
| m1911 | 13 | TTK deer@150; TTK deer@400; TTK deer@700; TTK pulper@150 … |
| mp93 | 14 | TTK sleeper@150; TTK sleeper@400; TTK sleeper@700; TTK deer@150 … |
| smg | 7 | TTK deer@150; TTK deer@400; TTK drag@150; in a guard's hands (shooting 2, 150 px) … |
| r22 | 4 | TTK drag@150; TTK drag@400; TTK drag@700; quiet (noise/kill) |
| pump | 7 | first kill crier; wall-time bought sleeper; wall-time bought deer; wall-time bought drag … |
| coach | 10 | first kill pulper; first kill deputy; first kill ferryman; first kill crier … |
| snake410 | 1 | first kill crier |
| pipe | 6 | wall-time bought sleeper; wall-time bought deer; wall-time bought drag; wall-time bought pulper … |
| autoshot | 1 | first kill crier |
| hunting | 4 | first kill pulper; first kill deputy; first kill crier; crowd kills/min |
| lever | 3 | TTK ferryman@700; first kill crier; crowd kills/min |
| scoped | 7 | TTK ferryman@150; TTK ferryman@400; TTK ferryman@700; first kill pulper … |
| muzzle | 1 | first kill ferryman |
| ar15 | 12 | TTK sleeper@400; TTK sleeper@700; TTK deer@700; TTK drag@150 … |
| carbine | 5 | TTK crier@150; in a guard's hands (shooting 2, 150 px); in a guard's hands (shooting 2, 400 px); in a guard's hands (shooting 5, 150 px) … |
| lmg | 2 | in a guard's hands (shooting 2, 400 px); in a guard's hands (shooting 5, 400 px) |
| compound | 17 | TTK ferryman@150; TTK ferryman@400; TTK ferryman@700; first kill pulper … |
| crossbow | 11 | first kill pulper; first kill deputy; first kill crier; cost/kill sleeper … |
| nailer | 15 | TTK sleeper@150; cost/kill sleeper; cost/kill deer; cost/kill drag … |
| rivet | 9 | first kill crier; cost/kill deer; cost/kill drag; cost/kill crier … |

First-kill time (s, loaded & cool, best style, mean of 3 distances): pulper: coach 0.15, hunting 0.15, scoped 0.15, compound 0.15, crossbow 0.15 · deputy: coach 0.15, hunting 0.15, scoped 0.15, crossbow 0.15, muzzle 0.25 · ferryman: scoped 0.52, muzzle 1.04, coach 1.06, lever 1.15, hunting 1.39

Dominated pairs (loser < winner on every metric, 2% tolerance): none

Dominant (near-best TTK in ≥60% of 21 zombie×distance cells): none

(info) tap÷spray rounds-per-kill @700, semi-autos: service9 1.5, revolver 1.7, m1911 1.5, r22 2.5, ar15 1.7


### 6f. Economy, days 1–23 (mean of 12 seeds)
Calibre order in every slash list: light / shell / rifle / 5.56 / .22.

BASE:

| day | threat | Turned | HP total | stragglers | spent light/shell/rifle/5.56/.22 | gained (same) | stock (same) | scrap/fuel/parts | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 17 | 18 | 1228 | 0.3 | 21/4/0/0/0 | 0/12/0/0/0 | 109/24/10/0/0 | 10/3/3 | HOARD (5.3 nights) |
| 2 | 20 | 19 | 1146 | 0.3 | 20/5/0/0/0 | 0/12/0/0/0 | 89/31/10/0/0 | 17/5/6 | HOARD (4.5 nights) |
| 3 | 29 | 28 | 1708 | 0.9 | 30/7/0/0/0 | 10/9/0/0/0 | 70/33/10/0/0 | 17/10/9 | hover (2.3 nights) |
| 4 | 33 | 26 | 1778 | 0.8 | 24/5/6/0/0 | 30/0/0/0/0 | 75/27/4/0/0 | 16/11/9 | tight (0.8 nights) |
| 5 | 45 | 33 | 2030 | 1.2 | 28/6/7/0/0 | 14/9/17/9/52 | 62/30/14/9/52 | 13/9/8 | hover (2.1 nights) |
| 6 | 53 | 37 | 2297 | 1.3 | 31/7/8/0/0 | 18/6/13/6/39 | 48/29/20/15/91 | 11/9/7 | hover (1.5 nights) |
| 7 | 56 | 36 | 2377 | 1.6 | 34/8/8/0/0 | 22/5/6/4/26 | 36/26/18/19/117 | 9/10/7 | tight (1.0 nights) |
| 8 | 47 | 31 | 2041 | 1.0 | 22/5/8/0/18 | 57/6/12/0/17 | 70/26/22/19/116 | 6/10/8 | hover (2.7 nights) |
| 9 | 57 | 32 | 2827 | 1.6 | 28/7/10/0/25 | 10/8/5/2/28 | 52/27/19/21/119 | 7/11/8 | hover (1.8 nights) |
| 10 | 70 | 38 | 3401 | 1.8 | 33/8/12/0/29 | 31/3/5/0/13 | 49/23/17/21/103 | 8/12/9 | tight (1.4 nights) |
| 11 | 84 | 44 | 4413 | 2.7 | 45/10/16/0/38 | 30/2/3/0/15 | 40/15/10/21/80 | 8/13/10 | tight (0.6 nights) |
| 12 | 94 | 51 | 5314 | 6.4 | 84/12/11/25/0 | 20/5/17/52/0 | 21/12/17/48/80 | 8/17/13 | BROKE (0.3 nights) |
| 13 | 137 | 79 | 7865 | 10.1 | 133/18/16/37/0 | 41/4/1/35/0 | 27/8/9/47/80 | 6/21/15 | BROKE (0.2 nights) |
| 14 | 97 | 55 | 5627 | 7.0 | 94/13/11/26/0 | 35/18/2/17/0 | 34/14/6/39/80 | 6/23/18 | BROKE (0.4 nights) |
| 15 | 108 | 65 | 6516 | 7.8 | 104/14/13/29/0 | 32/8/2/8/0 | 27/9/4/24/80 | 4/28/21 | BROKE (0.3 nights) |
| 16 | 130 | 76 | 8358 | 10.4 | 131/18/16/39/0 | 14/10/11/8/0 | 4/6/3/10/80 | 4/30/23 | BROKE (0.0 nights) |
| 17 | 158 | 92 | 10045 | 12.3 | 157/22/19/46/0 | 17/0/0/8/0 | 0/0/0/1/80 | 4/34/24 | BROKE (0.0 nights) |
| 18 | 121 | 70 | 7609 | 9.3 | 118/17/14/35/0 | 5/22/1/8/0 | 0/6/0/0/80 | 4/36/26 | BROKE (0.0 nights) |
| 19 | 147 | 82 | 9697 | 12.0 | 154/21/17/44/0 | 12/6/0/8/0 | 0/3/0/0/80 | 4/42/29 | BROKE (0.0 nights) |
| 20 | 161 | 94 | 10863 | 13.2 | 169/23/19/49/0 | 7/4/1/8/0 | 0/1/0/0/80 | 4/44/30 | BROKE (0.0 nights) |
| 21 | 134 | 74 | 9451 | 11.1 | 145/20/16/41/0 | 14/1/1/9/8 | 0/0/0/0/88 | 4/47/31 | BROKE (0.0 nights) |
| 22 | 137 | 80 | 10148 | 11.8 | 151/21/17/43/0 | 14/1/1/9/8 | 0/0/0/0/96 | 4/50/32 | BROKE (0.0 nights) |
| 23 | 393 | 223 | 31599 | 37.9 | 479/64/51/131/0 | 14/1/1/9/8 | 0/0/0/0/104 | 4/52/33 | BROKE (0.0 nights) |

PATCH:

| day | threat | Turned | HP total | stragglers | spent light/shell/rifle/5.56/.22 | gained (same) | stock (same) | scrap/fuel/parts | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 17 | 18 | 1123 | 0.3 | 20/6/0/0/0 | 0/32/0/0/0 | 60/42/10/0/0 | 11/2/3 | hover (2.9 nights) |
| 2 | 20 | 19 | 1060 | 0.3 | 20/6/0/0/0 | 27/0/0/0/0 | 66/36/10/0/0 | 25/4/6 | hover (3.4 nights) |
| 3 | 29 | 28 | 1560 | 0.9 | 29/9/0/0/0 | 17/9/0/0/0 | 54/36/10/0/0 | 29/9/9 | hover (1.9 nights) |
| 4 | 33 | 26 | 1659 | 0.7 | 23/7/6/0/0 | 42/4/0/0/0 | 73/32/4/0/0 | 31/10/9 | tight (0.7 nights) |
| 5 | 45 | 32 | 1909 | 1.2 | 27/9/7/0/0 | 14/9/35/9/52 | 60/33/32/9/52 | 30/8/7 | hover (2.2 nights) |
| 6 | 53 | 37 | 2203 | 1.4 | 31/10/8/0/0 | 37/11/4/6/39 | 65/34/28/15/91 | 33/9/7 | hover (2.1 nights) |
| 7 | 57 | 37 | 2300 | 1.7 | 33/11/8/0/0 | 47/8/4/4/26 | 80/31/24/19/117 | 36/10/7 | hover (2.4 nights) |
| 8 | 47 | 30 | 1945 | 1.2 | 21/7/8/0/13 | 57/15/12/0/17 | 116/39/28/19/121 | 39/9/8 | hover (3.4 nights) |
| 9 | 58 | 32 | 2730 | 1.7 | 27/12/10/0/18 | 8/4/11/2/28 | 97/31/29/21/130 | 46/11/8 | hover (2.6 nights) |
| 10 | 71 | 39 | 3263 | 2.3 | 32/14/12/0/24 | 25/17/15/0/13 | 90/34/32/21/119 | 50/11/8 | hover (2.4 nights) |
| 11 | 84 | 45 | 4126 | 2.7 | 39/18/14/0/30 | 30/18/14/0/15 | 80/34/32/21/104 | 54/11/8 | hover (1.9 nights) |
| 12 | 95 | 52 | 4974 | 6.8 | 77/22/11/26/0 | 35/22/18/52/0 | 43/34/39/47/104 | 55/15/11 | tight (0.6 nights) |
| 13 | 138 | 79 | 7278 | 10.1 | 111/31/16/39/0 | 165/8/4/35/0 | 96/15/27/43/104 | 57/18/14 | tight (0.5 nights) |
| 14 | 97 | 55 | 5138 | 6.9 | 78/22/11/27/0 | 45/57/5/17/0 | 65/51/22/35/104 | 54/17/14 | tight (0.8 nights) |
| 15 | 109 | 63 | 5906 | 7.8 | 87/25/12/31/0 | 142/13/19/28/0 | 119/41/28/38/104 | 50/17/16 | tight (1.2 nights) |
| 16 | 131 | 74 | 7453 | 9.8 | 108/32/15/38/0 | 130/29/10/45/0 | 142/39/23/49/104 | 45/14/15 | tight (1.2 nights) |
| 17 | 159 | 91 | 8943 | 11.8 | 132/38/18/44/0 | 120/48/17/32/5 | 144/49/24/47/109 | 43/11/15 | tight (1.1 nights) |
| 18 | 121 | 69 | 6726 | 8.7 | 98/28/13/33/0 | 111/30/23/35/5 | 163/52/34/58/114 | 38/8/14 | hover (1.7 nights) |
| 19 | 146 | 80 | 8489 | 10.9 | 120/35/16/40/0 | 40/30/17/52/5 | 110/48/36/78/119 | 38/7/14 | tight (0.9 nights) |
| 20 | 160 | 92 | 9468 | 12.8 | 136/39/19/50/0 | 97/7/3/35/6 | 106/30/26/75/125 | 45/7/14 | tight (0.8 nights) |
| 21 | 133 | 72 | 8146 | 10.7 | 114/34/15/42/0 | 64/32/6/19/8 | 108/40/26/67/133 | 46/6/15 | tight (0.9 nights) |
| 22 | 136 | 78 | 8729 | 11.1 | 120/36/16/44/0 | 107/13/9/22/8 | 119/35/26/64/141 | 47/4/15 | tight (1.0 nights) |
| 23 | 391 | 217 | 26989 | 35.1 | 368/114/47/130/0 | 80/22/9/22/5 | 75/23/12/32/147 | 68/4/16 | BROKE (0.2 nights) |

**Verdict.** With the patch, the house **hovers** (2–3.5 nights of stock) through day 11 (except day 4, which is tight on rifle rounds the night the lever arrives) and runs **tight** (0.5–1.5 nights) from day 12 to day 22. That matches doc 06's target that a competent player should often end a night with less than one night in reserve after day 10. **Fuel** becomes the binding resource late (4–7 in store; scrap now runs a surplus), which is also doc 06's target. The crossing (day 23, threat × 2.2, about 217 Turned) still empties the stores. It must be stockpiled for, or fought with the near-free guns: nailer (0.02/kill), bows (0.05–0.08), rivet (0.09).

Median competent TTK per Turned (s, and s per threat point):
- BASE: sleeper 0.99s (0.99 s/threat-pt) · deer 0.87s (0.54 s/threat-pt) · drag 0.84s (1.40 s/threat-pt) · pulper 1.37s (0.46 s/threat-pt) · crier 0.93s (0.23 s/threat-pt) · deputy 2.30s (0.66 s/threat-pt) · ferryman 4.97s (0.55 s/threat-pt)
- PATCH: sleeper 1.05s (1.05 s/threat-pt) · deer 0.93s (0.58 s/threat-pt) · drag 0.94s (1.18 s/threat-pt) · pulper 1.52s (0.51 s/threat-pt) · crier 1.01s (0.25 s/threat-pt) · deputy 1.97s (0.56 s/threat-pt) · ferryman 5.24s (0.58 s/threat-pt)

Unit cost per round after the patch (scrap-eq; scrap 1, wood .5, cloth 1, fuel 2, parts 3): light 0.10 · light_hp 0.23 · shell 0.31 · shell_slug 0.70 · shell_flech 0.90 · shell_fire 0.88 · r22 0.10 · rifle 0.53 · rifle_sp 0.92 · rifle_ap 2.00 · r556 0.20 · ball 0.40 · bolt 0.29 · bolt_fire 0.50 · flare 2.00

---

## 7. Status: data half applied (arsenal agent)

The data half of §4 (weapons, ammo types, Turned, recipes, sites, `switchTime`) is now in `src/`, and `tools/balance.ts` reads it directly. Its data patch layers are empty and only `PATCH_MODEL` (the battle.ts firing model) is still applied in memory. With `npx tsx tools/balance.ts --only patch`, **all 10 checks pass**. `--only base` is now the patched data under the *old* battle model: 7/10 checks pass. The 3 fails (tap vs spray on autos, a niche for the burst pistol, AR-15 dominance) are fixed by the model items below.

Three deviations from the §4 list:
- **Starting pistol rounds stay at 70.** The day-loop agent's scarcity pass had already cut 130 → 70, which is lower than the proposed 80. `npm run simtest` still meets its ammo target with the bigger recipe batches: 63% of nights from day 10 end with less than 1 night of ammo, against a target of ≥ 40%.
- **Muzzleloader spread 0.006 → 0.004.** The "first kill on a Ferryman" niche was a coin-flip with the coach gun (1.04 vs 1.06 s) and was lost to sampling noise once the Bellwether joined the roster. At 0.004 it holds at 0.88 s.
- **Launchers (`law`, `m79`, `pipemortar`) are skipped by the harness** (`def.explosive`), because it has no blast model.

## 8. battle.ts TODO from balance.md (combat/feel pass)

These are still **not** in `src/night/battle.ts`. The harness models them as `PATCH_MODEL`:
1. **Bloom kick per shot** by weapon id, then by `weaponClass()`, × `fireProfile().bloomMul`: pistol 0.022, smg 0.065, shotgun 0.05, rifle 0.03, lmg 0.045, bow 0.02, tool 0.04, carbine 0.085. The class keys predate the new `WeaponClass` names, so map them: handgun → pistol, heavy → lmg, improvised → tool, assault/marksman → rifle.
2. **Bloom cap** 0.12 → 0.30. **Decay:** hold for 0.12 s after a shot, then exponential with a 0.15 s half-life, replacing the linear 0.12/s.
3. **Aimed shot:** at least 0.35 s since the last shot (at least 0.6 s if rof ≤ 1.2) and bloom < 0.01 → spread × 0.6. Show a tight, solid ring.
4. **Sway:** the aim point drifts by `(1 − aim) × 16` px as slow noise at about 0.7 Hz.
5. **Pellet cone follows the shooter:** `spread × (0.75 + bloom/0.08) × (1.3 − 0.3·aim)`, × 0.85 on an aimed shot.
6. **Pellet falloff:** × `clamp(1 − (t − 250)/400 × 0.65, 0.35, 1)` by ray distance t.
7. **Head circle radius** `headH × 0.62 → 0.56`.
8. **Stagger:** each body hit rolls `fireProfile().stagger` (1 pellet in 4 rolls) and freezes the target for 0.3 s.
9. **HP growth** `1 + 0.03·(day − 8)` → `1 + 0.02·(day − 8)`.
10. **Dawn salvage:** if the wall held, add `0.12 × kills` scrap.
11. **`fireProfile().switchTime`** is now non-zero by default for the LMG (0.15 s) and the muzzleloader (0.1 s). Apply it as the retarget delay for guards and as the player's settle time.
12. **Feel numbers:** hitstop, shake and kick per class, as in §5.

## 9. Night sanity: real nights, auto-played (feel & wiring pass)

**Method.** The real `Battle` is stepped headless in the browser (Playwright, 30 Hz, no drawing) from the real dusk flow, with a mid-game house per day: survivors, guns and stores from the §6f PATCH means (day 3: 4 people, pistol/revolver/pump/.22; day 8: 5, + lever and hunting rifle, wall 360, a light; day 13: 6, + M1911 and AR-15, wall 420, 2 lights; day 18–23: autoshot, scoped, carbine, wall 480). Forced specials are cleared, so tide and tunnel nights come from the calendar and the 6% roll. Two leaders:
- **passive**: never fires. The guards hold alone.
- **decent**: a bot that aims at heads via `window.__battle` hitboxes, with a human hand: a 0.28–0.43 s reaction on each new target, a 1600 px/s flick, a few px of error, aimed shots when it can and snap shots when something is close. It clears jams, reloads in lulls, rallies under pressure and throws firebombs at queues. It still sees and engages at the spawn edge (x ≈ 1260), which a person in the dark does not. Treat it as an upper bound.

The harness is `tools`-free (a scratch script). The knobs it moves are in code: `Battle.tune` (night/battle.ts) and `DIRECTOR_TUNE` (sim/director.ts).

**Findings before the change.** No wall damage at all through day 11 for either leader, with 1.1–1.6 guard rounds per kill. Three things made the guards untouchable:
1. **The loophole pump is crowd control.** Every pellet shoves (`knock × 0.25`, × 1.3 at the loophole) and rolls a stagger. A wave of 30 Sleepers stalled at x ≈ 650–780 for 20 s on hp 1–27, being shoved back faster than it walked.
2. **Rifle pierce through lane columns.** A dense wave in four lanes is four files. One hunting or lever round takes 2–3 bodies, so 30 Sleepers died to 16–20 rounds. Denser waves made it *easier*.
3. **Sight range.** Guards engaged from 820 px plus 130 per light, which is two-thirds of the road, and kill zones of about 30 s.

The decent bot alone killed ~1 body per shot at any range, so early nights never reached the wall.

**Change (the values now in code).**
- Guards (`Battle.tune`): fire at 1/2.2 of the old cadence (`guardCd 2.2`: frightened people on a wall at night, not soldiers). Aim error ×1.15, head-aim share ×0.85. They make out the road only to 55% of the old distance in the dark (`guardRange 0.55`), so each floodlight (+130 px) and the roof (+260) matter more. Their pellets shove and stagger at 35% (`guardShove 0.35`). The player's own gun is untouched.
- The Turned at the wall do ×1.3 damage (`wallDps 1.3`).
- Director (`DIRECTOR_TUNE`): the early ramp reaches full strength by day 11 instead of 14 (`rampDays 9`). Early and mid nights run heavier, +50% at day ≤ 8, tapering to +0% at day 18 (`early 0.5`), where ammunition is already the squeeze. Each night is three tight waves (25% / 40% / 35% of the budget at 0 / 42% / 78% of the night, each arriving over 8% of it) instead of three 28%-long trickles.

**Results** (2 seeds each; wall lost / max; "fell" = the wall went down):

| day | night | passive leader | decent leader | notes |
|---|---|---|---|---|
| 3 | ordinary (50 pts, ~43 bodies) | 0/300, 0/300 | 0, 0 | guards kill everything; the leader takes ~80% when shooting |
| 6 | **tide** (140 pts, ~100) | 0/360, 0/360 | 0, 0 | 4 guards hold a tide alone. **Not scary yet.** |
| 8 | ordinary (86 pts, ~47) | 0/360, 16/360 | 0, 0 | passive holds: **target missed** |
| 11 | tunnel / ordinary (~170 pts) | **fell**, 0/420 | 0, 0 | |
| 13 | tunnel / **tide** (~245 pts) | **fell**, **fell** | **fell**, **fell** | the §6f day-13 house is out of pistol rounds mid-night: the leader fires all 89 light and the line falls after (ammunition, not tempo) |
| 18 | tunnel / ordinary (~175 pts) | 49/480, 0/480 | 0, 0 | bigger stocks (§6f day 18) |
| 20 | tunnel / **tide** (~265 pts) | **fell**, **fell** | 16/480, 0/480 | |
| 23 | **the Crossing** (~360 pts, ~150) | **fell** in ~2 min | **fell** at ~3 min, 1–2 dead | a desperate last stand, as intended |

Before the change, on the same seeds (1 seed): passive held 3/8 at 0 and fell from 13; decent held everything to 18 at 0 (−322 once at 13) and fell at the Crossing.

**Verdict.**
- Better: guards no longer carry a passive leader past day 11 (before: day 13). Tides at 13 and 20 now break a passive house. The leader's gun is what holds from mid-game. The Crossing is lost by both, the decent leader after a long fight.
- **Not met:**
  - *Passive loses badly by ~day 8.* Days 3–8 are still safe without the leader.
  - *Decent holds but loses wall chunks.* The bot rarely loses planks before ammunition runs out.
  - *Tide nights are scary.* The day-6 tide is not.

  Heavier nerfs did not change this (guard cadence ×3.5 with sight ×0.45 still held day 8 at 0). The remaining reason is crowd tempo, not guard numbers. Lanes are single files: a fast Deer waits behind a Sleeper, and Drags and Pulpers (20–22 px/s) set the pace. A wave arrives over 30–40 s even when it spawns in 8, which a few guards always out-shoot.
- **Next levers** (not done; each is a design call):
  - Let a blocked body overtake inside its lane (a shoulder-barge) so the crowd moves at the Sleepers' pace.
  - Spawn the big waves closer, inside the dark (x ≈ 1000–1100), so the kill zone is shorter for everyone.
  - Cap guards' pierce at 1.
  - Make the tide special double its middle wave rather than only adding points.

Economy after the change: `npm run simtest` passes. Day-10 ammunition is 1.4 nights in reserve, day 15 is 0.9, and 68% of nights from day 10 end with less than one night left (target ≥ 40%). `tools/balance.ts --quick` reports 8/10. Its two fails (tap vs spray on autos, a niche for the muzzleloader) are in the gun data and are unchanged by this pass.

## 10. Crowd tempo: overtaking, waves in the dark, one body per guard round, double tides

**Why.** §9 left three targets unmet (passive holds days 3–8, the decent bot rarely loses planks, the day-6 tide is not scary). The cause was crowd tempo: single-file lanes paced by Drags and Pulpers, and waves spawned at the screen edge arriving over 30–40 s.

**Changes (in code).**
- **Overtaking** (`walkLane`, night/battle.ts). A body held more than 0.35 s behind a slower one in its lane (speed × 1.2 or more), or behind a staggered or knocked-down one, squeezes past. It moves at 75% of its speed (`Battle.tune.passSpeed`), a 9 px half-step to the side, for up to 2.5 s. It stays inside its lane's shot tolerance. A wall queue is never overtaken. On a tide night, 15–20 bodies are mid-pass at the peak, and the front of the crowd now reaches the planks.
- **Waves form up in the dark** (`spawn` / `darkBand`). Plan spawns marked `dark` appear at x from `darkBand()` to 1150. `darkBand()` = the guards' sight in tonight's light + 60 (floodlights and a roof push it out; fog lets them form at 820), never less than 900 and capped at 1090. They fade in over 1.2 s. They are telegraphed by an alert chorus from where they stand, a line ("Out in the dark, close…", at most once per 12 s), CLOSE IN THE DARK on the threat ribbon, and a line in the dusk intel. Which spawns are dark is set by the director: 60% of the 2nd and 3rd surges on tide, horde and Crossing nights (`darkBig`), and 25% from day 6 on ordinary nights (`dark`, `darkDay`).
- **Guards: one body per round** (`Battle.tune.guardPierce 0`). In the gun data, pierce *n* means the round carries on through *n* more bodies. A guard's round now stops in the first body. The leader keeps the gun's full pierce. With `guardPierce 1` (two bodies), every night through day 8 was still held at 0 by the guards alone. This one lever turns the early game.
- **Tides double their middle wave** (`DIRECTOR_TUNE.tideMid 2`). The dusk label says so ("…the middle of the night comes twice as thick"). The intel line for that wave reads "Second wave, the tide itself (twice the first)".
- **Director re-tune.** `early 0.6` (was 0.5). New `late 0.7`, eased in from day 9 to day 13; tide nights use `lateTide 0.85` so they stay the big nights. `crossing 2.2` (the ×, now a knob). With the weaker guards and the denser crowd, ordinary mid- and late-game nights would otherwise end the moment the §6f stores run dry.

**Results** (same harness as §9: 2 seeds × leader; wall lost / max; "fell" = the wall went down; † = deaths). *prep* is the decent bot with a house that stockpiled for the night: on days 13, 20 and 23, about 1.5× the ammunition, a firebomb stock, and wall +60–120. On other days *prep* is the same house as *decent*.

| day | night (pts, bodies) | passive | decent | decent + prep | read |
|---|---|---|---|---|---|
| 3 | ordinary (53, ~45) | −12, 0 | 0, 0 | 0, 0 | safe; the guards nearly hold it alone |
| 6 | **tide** (150, ~140) | **fell**†, **fell** | −45, −279 | −91, −90 | passive breaks; the decent leader loses planks, once nearly all |
| 8 | ordinary, breather (90, ~55) | **fell**, **fell** | 0, 0 | 0, 0 | passive breaks; the leader alone clears a breather night |
| 11 | tunnel / ordinary (~150) | **fell**†††, **fell**† | 0, **fell** (out of ammo, slow chew) | −48, −48 | |
| 13 | tunnel / **tide** (~220, 107–155) | **fell**††, **fell**† | **fell**†, **fell**†† | 0, 0 | the §6f day-13 stock is out of pistol rounds mid-night (as in §9); stockpiled, it holds |
| 18 | tunnel / ordinary (~120) | **fell**†, **fell** | 0, 0 | 0, 0 | big stocks, a light night |
| 20 | tunnel / **tide** (~230, 102–151) | **fell**††, **fell**†† | 0, **fell**†† (tide) | 0, 0 | the tide breaks an unprepared house |
| 23 | **the Crossing** (~250, ~115) | **fell**†, **fell**†† | **fell**†, **fell**† | **fell**††, **held** | a coin flip with full prep |

**Verdict against the targets.**
- *Passive loses badly by day 6–8:* **met.** The wall goes on the day-6 tide and on day 8 (with deaths from day 11). Before: passive held through day 8.
- *Decent holds early, loses wall chunks from ~day 6:* **met on day 6** (−45 to −279). The day-8 breather is still clean. Its points are 0.7× the cycle, and the bot alone kills everything at range.
- *Tide nights are scary:* **met.** Day 6 costs planks. Days 13 and 20 break a house on its normal stores, with 1–2 dead. A stockpiled house holds them.
- *The Crossing is desperate, just survivable with decent + prep:* **met, narrowly.** Without prep it always falls. With prep, 1 of 2 held.
- **Caveat: outcomes are binary.** The wall either loses ≤ 50 or falls. The fall comes when the leader's magazine stock runs dry (every fall above has the leader's stock at 0). From there the guards' rounds and then their melee cannot stop the crowd. This is the §6f ammunition squeeze and not tempo: the same seed can land on either side between runs. Partial-loss nights ("chunks") show up mainly on tides. Making losses more gradual would need the leader's options after ammo (melee, firebombs, falling back), and that is out of scope here.

Economy: `npm run simtest -- 3` passes (nights from day 10 ending with < 1 night of ammo: 72%, target ≥ 40%). `tools/balance.ts --quick` reports 8/10, unchanged.

## 11. Hit reactions (impact.ts) against the §10 targets

**Question.** Mass-vs-impulse hit reactions (`src/night/impact.ts`: flinch / stagger / stumble / knockdown, stun and down time, a slide, ×1.3 damage while down) arrived after §10. Did they make nights easier, and do rifles or shotguns pin the crowd?

**Method.** The §9/§10 harness, now committed as `tools/e2e/night-balance.cjs` (`npx vite build && npx vite preview --port 4198`, then `PORT=4198 node tools/e2e/night-balance.cjs 3,6,8 1 passive,decent,prep`). It takes `IMP` (JSON merged into `IMPACT`) next to `TUNE` and `DTUNE`, and adds two columns: **stun%** (share of on-screen body-seconds spent staggered or down, from any cause) and **rx/k** (staggers / stumbles / knockdowns per kill). One seed per cell (a quick check; outcomes are binary, see §10's caveat), current `IMPACT` with `at.stagger 85` (was 62). The control is the same build with every reaction tier above flinch switched off (`at.stagger/stumble/knockdown 1e9`, `FINISH_MUL 1`).

| day | night | passive (impact / off) | decent (impact / off) | decent + prep (impact / off) | stun% impact (P/D/prep) | rx/k passive |
|---|---|---|---|---|---|---|
| 3 | ordinary | −18 / 0 | 0 / −118 | 0 / 0 | 0.5 / 0.6 / 0 | .07/.02/0 |
| 6 | **tide** | **fell**†† / −45 | **fell**†† / −233 | **fell**† / −93 | 1.1 / 1.2 / 1.0 | .19/.23/0 |
| 8 | ordinary | −184 / **fell** | 0 / 0 | 0 / 0 | 1.4 / 1.2 / 1.1 | .41/.13/0 |
| 11 | tunnel | **fell**†† / **fell**† | 0 / **fell** | −16 / **fell**† | 2.0 / 1.8 / 2.2 | .54/.43/0 |
| 13 | tunnel | **fell**† / **fell**†† | **fell**†† / −223† | 0 / 0 | 2.1 / 1.9 / 1.4 | .51/.68/.01 |
| 18 | tunnel | −143†† / −80† | 0 / 0 | 0 / 0 | 3.1 / 5.9 / 6.6 | .31/.36/0 |
| 20 | tunnel / **tide** | **fell**† / **fell**† | −141††† / 0 | 0 / 0 | 1.5 / 3.3 / 6.1 | .42/.45/0 |
| 23 | **the Crossing** | **fell**† / **fell**†† | **fell**††† / **fell**†† | −240 / **fell**††† | 1.5 / 2.8 / 3.9 | .36/.08/0 |

Falls: passive 5/8 with reactions, 5/8 without; decent 3/8 vs 2/8; prep 1/8 vs 2/8. A second look at days 6 and 8 (2 seeds, passive + decent): day-6 tide fell 4/4 with reactions; day-8 passive held once at −289 and fell once.

**Read.**
- **Not easier.** At `at.stagger 85` the reactions do not soften nights: the fall count is the same within one-seed noise, and the day-6 tide is, if anything, harder (the staggered front is overtaken by the bodies behind it (§10 `walkLane`) and the crowd reaches the planks bunched, as the `stagger 62 → 85` note in `impact.ts` says). Day 8 passive is the one cell that held (−184), and a second seed fell, so the §10 target "passive breaks by day 6–8" still stands. The decent leader losing the day-6 tide outright is harsher than §10 (−45 / −279). Watch it, but its cause is crowd bunching and the guards, not stun-lock.
- **No perma-stun.** On-screen bodies spend 0.5–3% of their time staggered or down on early and mid nights, and ≤ 6.6% on the day-18/20 stocks (autoshot, AR-15, scoped). Of that, 2–3 points were already there without reactions (the old `fx.stagger` roll, blasts, the Ferryman's knee). The `REPEAT 0.62` diminishing return and the head-hit cap keep rifles and shotguns from pinning a body.
- **Visible where it should be.** The guards' rifles and pumps (the passive rows) give 0.3–0.5 staggers and 0.1–0.7 stumbles per kill, so a fall shows up every few bodies. Knockdowns stay rare outside blasts (≤ 0.01 per kill). The leader's pistols almost never stagger before the kill (rx/k ≈ 0.0–0.1), so heavy rounds stand out.
- Trying `at.stumble 170` (fewer falls from the guards' rifles) changed nothing on days 6 and 8 (2 seeds): the day-8 passive night fell both times, and the day-6 decent night held once at −316.

**Change.** None to `IMPACT` beyond `at.stagger 85` (already in code). No `DIRECTOR_TUNE` or `Battle.tune` change is proposed. If the day-6 tide should again cost the decent leader planks rather than the wall, the lever to try is §10's `tideMid` (director, e.g. 2 → 1.7; untested), not the reactions.

### §11b tideMid sweep (day-6 tide, 2 seeds, passive / decent)
| tideMid | passive | decent |
|---|---|---|
| 2.0 | fell, fell | fell, fell |
| 1.7 | fell, fell | fell, fell |
| 1.45 | held, fell | fell, held |
| 1.35 | 0, 0 | −224, 0 |
| 1.2 | – | 0, 0 |

The outcome is a cliff, not a slope: once the bunched middle wave reaches the planks, the wall goes. 1.45 sits on the edge, a coin-flip for both, and is the new default. Follow-up: soften the cliff (stagger the middle wave's arrival) so a decent leader's skill buys planks, not a whole night.
