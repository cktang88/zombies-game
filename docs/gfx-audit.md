# Graphics audit (round 1: the non-night screens; round 2: everything in play)

**Method.** I staged a day-12 save and a day-24 save with `tools/stage-save.ts`, plus a fresh game. I drove each screen with Playwright using the debug handles (`__G`, `__story`, `window.__battle`). Every screen was captured at 1280×720, 1920×1080 and 390×844 at deviceScaleFactor 2, then inspected, fixed and captured again.

**Screens covered.** Title (with its Ledger, seed row and the Daily), settings (all five tabs), the help ledger (all five pages), and day one with the onboarding hints. The day ledger: every tab, the calendar, threads, the hours strips, the warnings and the run planner. Also the survivor sheet, five incident modals, dusk, the deploy step, the pause menu, both dawn stages, the four endings, the crossing choice and the game-over memorial.

**Out of scope for round 1.** The night and the run canvases, world sprites and rigs belong to two other agents. `deploy.ts` is theirs too: only its page wrapper and its CSS were touched here.

Severity: **H** = looks broken or unfinished, **M** = clearly below the bar, **L** = polish.

| Screen | Sev | Issue | Fix |
|---|---|---|---|
| Survivor cards, sheet, graves, dawn, end cards | H | The "portraits" were full-body side-view sprites squeezed into 56×84. The faces were about 8 px and guns stuck out of the frame. | Bust portraits are now cut from the 1408×768 original generations: keyed, cropped to head and shoulders, set on a lit, grained ground with a vignette (`tools/make-portraits.py` → `public/art/port_*.jpg`, 13 files). They show as pinned photographs on cards (64×80), the sheet (128×160), graves, dawn and the end screens. The dead are drawn in sepia-grey. `src/ui/portrait.ts` falls back to the sprite if a portrait is missing. |
| Every select | H | Native OS dropdowns with a white system chevron that clashed with the ledger. | `appearance:none` ink field, inset shadow, brass caret, hover and disabled states, ellipsis. |
| Settings › audio | M | Native range sliders. | Ten-tick ledger track, brass fill (`--p` driven from `settings.ts`) and a brass slug thumb. Checkboxes are ink boxes with a pencil tick. |
| Incident modals | H | Plain dark box, the same as every other modal. The research doc asks for found documents. | Rendered as light ruled paper: red margin line, paper clip, water stains, grain, ink text. Choices read as tick-box lines (☐ → ☒ on hover). |
| Title | M | Flat purple cloud sky with no subject. | Generated key art: the brick house on Ferry Road at dusk, the mill, the river and the dead on the road. It has a slow Ken Burns drift, falls back to `bg_far` (the town), uses a lighter vignette, and the persona cards are lifted with backdrop blur and a hover rise. |
| Epilogue / crossing / game over | H | Left-aligned text on black, inline styles, nothing to look at. | A painted plate for each ending (ferry, mill, spring, ice; fell for the memorial), each falling back to a graded `bg_far` or `bg_mid`. The title sits on the plate, the opening paragraph has a drop cap, the score card is a ledger with a double-ruled total and a brass score, and the fate cards carry portraits. The buttons are classes now, not inline styles. |
| Day: workshop | H | The recipe column made the page about 8000 CSS px tall at 1280 (16000 at DPR 2). | Tighter recipe rows (grid with costs inline). On desktop the recipe column scrolls inside the panel with a fade mask. The page is now about 950 px. |
| Day: survivor cards | M | The "same as yesterday?" tag broke across two lines. Names were underlined links. | Tags use nowrap and the name row is a flex wrap. Names have a dotted underline that goes brass on hover. |
| Day: tabs (centre, help, settings) | M | Loose buttons with no sense of a selected page. | Joined tab strip on a rule line. The active tab has a brass top edge. Labels are capitalised. |
| Day: panels | L | Flat translucent boxes. | Paper grain, an inner highlight, a drop shadow and double-ruled panel headers. |
| Day: wall tab | L | Default disc bullets. | Ledger rows with an em-dash marker and type-face figures. |
| Day: armory | M | Zero-stock ammo shown in alarm red: the list read as a wall of red. The stats line was 11 px. | Zero stock is now dim. Stats are 12 px. Gun icons sit on a faint light pool. |
| Icons (stores, costs, armory) | M | Dark gunmetal icons vanished on dark paper at 20 px. | A hairline light halo plus a contact shadow. Store icons are 22 px. The icon set itself is consistent: no icons drawn as people. |
| Onboarding hint | L | The paper clip covered the hint title. | More top padding. The note now uses the same grained ruled paper as the documents. |
| Help › The Turned | L | "from day 999" shown for the special-night Turned. | Reads "special nights". |
| Title › Ledger | L | A 🔒 emoji (colour glyph) in a monochrome ledger. | A plain ☐ in the disabled state. |
| Pause | L | Off-centre (the margin padding was on one side only). | Symmetric padding and a spaced-caps header. |
| Dawn | L | The tally wrapped to two rows on phones, leaving a hole. | Always three columns, with smaller labels on phones. Numbers are 34 px and centred. |
| Dusk deploy page | M | Three cards on flat black. The post selects were misaligned because each sat after a different gun name. The "guns" card used inline flex styles. | The town backdrop sits behind, cards stack in one column with shadows, post rows use a grid, crew labels use the type face, and headers wrap on phones. |
| Settings / help on phones | M | The five tabs wrapped, leaving "Data" alone on a second row. | The tab strip scrolls horizontally on phones. |
| End screens | L | The body grain stopped after the first viewport, leaving a seam. | The grain moved to `html`. |
| Modals | L | Popped in. | A 0.2 s rise and fade. The backdrop blurs and desaturates the page. Reduced-motion users get no animation. |

## Art spend
These went through OpenRouter (`google/gemini-3.1-flash-lite-image`) with `tools/gen-art.ts` and `tools/art.json`: six images at about $0.034 each, **about $0.20** in total. They are `key_title` and `end_ferry`, `end_mill`, `end_spring`, `end_ice` and `end_fell`. The 13 portraits cost nothing: they are cut from existing generations.

## Left for round 2
- **Night and run HUD over the dawn report.** Behind the dawn modal, the staged capture shows "−999999914 still out there". That comes from forcing `spawnIdx = 1e9` in the capture script, not from the game. Even so, the HUD counter should clamp at 0.
- **Deploy planner internals** (`deploy.ts`, owned by the world-objects agent). On phones the kit buttons lose their labels and show only an icon and a count. The road strip is a flat gradient.
- **Turned thumbnails in the help ledger** are tiny full-body sprites. Once the rigs settle, they could use bust crops the way the survivors now do.
- **Survivor sprite reuse.** Two founders can share a sprite, and therefore a portrait: Renee and Colette in the day-24 save. More survivor generations would fix it. That needs new world sprites, so it belongs to the other agents.
- **Survivor sheet.** The middle and right columns are short while the left column (skills) runs long. A two-column layout at 1280+ would balance it.
- **Score card.** At desktop width there is empty space to the right of the score card. It could sit beside the fates, or the chronicle could move up.


---

# Round 2: everything in play (night, runs, rigs, VFX, deploy)

**Method.** I staged a day-12 save (`tools/stage-save.ts`) and drove each scene with Playwright and the debug handles (`__G`, `__story`, `window.__battle`, `__EX`, `__impact`). Each scene was captured as a sequence of frames at deviceScaleFactor 2. Night and run scenes were taken at 1280×720, the HUD also at 1920×1080 and 390×844, and the deploy page and help at 390×844. I looked at every frame, fixed what I found, and captured again.

Scenes covered:
- **Nights:** unlit night 1, floodlit, fog, snow, rain, tide peak, raiders, tunnel, horde, the Crossing with the Bellwether's toll, and every trap kit laid and triggered.
- **The wall:** the manned MG nest, crews on the roof scaffold and the firestep, the corpse pile and climbing, the wall at 60% with its gouges, melee at the wall, and ducking under bile.
- **The Turned:** the Buck's vault, Biler globs, the Crier's keen, the Pulper's burst, the Ferryman knocked down and getting up, ragdoll deaths and hit reactions.
- **The defenders:** reloads per weapon class, guard poses with a full six-person line, downed / drag / haul, and the dawn transition.
- **Daylight run:** walk, search, zones, the cache and pickup, the companion, gunfire and melee hits.
- **Screens:** the survivor sheet, the help ledger's Turned, the epilogue, and the deploy planner on desktop and phone.

Checks:
- Value bands were sampled per doc 04: background 16–31% luminance, actors' darks 2–10%, actors' highlights 44–52%. All are inside the targets.
- No sprite in `public/sprites` has magenta pixels, neither opaque nor on the alpha edge (scripted scan).
- The arm and pose numbers are in `tools/e2e/pose-check.cjs`.

Severity: **H** = looks broken or unfinished, **M** = clearly below the bar, **L** = polish.

| Scene | Sev | Issue | Fix |
|---|---|---|---|
| Every rig with a gun (user report) | H | Arms scrunched: hand at the chin, elbow folded to 45–60°, support hand slid back to the magwell. I measured every human rig. Forearms were 0.12–0.14 H and whole arms 0.27–0.32 H, because segmentation took lengths from foreshortened side-view arms. The butt sat at the neck and the far shoulder *behind* the near one. | Bones are set to real proportions (upper arm 0.175–0.19 H, forearm 0.148–0.158 H) and the arm art is **stretched along the bone** (`Rig.part`). The butt pocket is set relative to the near shoulder, the far shoulder sits forward in bladed stances (`farSh`), support reach is measured to the wrist, and pistols are held at near-locked elbows. Pump and hunting grips moved onto the stock wrist, and the LMG support hand is on the handguard. New `src/anim/armcheck.ts`, an `animlab ?closeup&debug` overlay, and `tools/e2e/pose-check.cjs` (15 rigs × 8 guns, all in range). Numbers in research 11 §4b. |
| Shotgun reload | M | Shells were fed with the gun at the chest. | Per the reference, the gun now comes down to the hip, muzzle level, trigger hand at the hip (`shellIn`: ready 1, gunDY +16). |
| Far arm | M | One arm art serves both sides, so a near-sleeve patch showed mirrored on the far arm. | The far-limb copy is desaturated (0.3), lower in contrast, softened 0.6 px and darkened 46% (`assets.ts farCopy`). Patches no longer read. |
| Wall: guard labels | H | Names, bars, moodles and status lines of a crowded line overlapped ("Pauline ○ runTinker"). They were drawn inside each body's draw, so later bodies covered them. | One label pass after the actors (`drawGuardLabels`). Boxes use real extents (including the post word). Each label tries a sideways step, then lifts, with a hairline back to its owner. When crowded a label shrinks to name + bar. The leader, the selected guard and the one under the mouse always get the full label, and panic / bitten / hauling are always shown. |
| Wall: scaffold & poles | H | Floodlight poles (sort key 650) cut through the roof crews. The left roof gun's long barrel went through the next crew's body. | Poles sort behind the scaffold. Each roof gun sorts just after its own crew. |
| Wall: firestep crowding | M | Slots 50 px apart on whatever row the guard's index gave, so neighbours stood on the same line and merged. | Slots are handed out afresh from the wall back: 58 px apart (50 with five or more), alternating near/far rows. |
| HUD: nests | M | The emplacement panel (y 63) covered the nerve bar. | Panel starts at y 98. |
| Nests | M | Double muzzle flash: the pooled `vfx.muzzle` burst plus an old small flash shape. | Old shapes removed (sprite and fallback paths). |
| HUD | L | "−999999914 still out there". The cause was the round-1 capture forcing `spawnIdx = 1e9`, not the game. | Counter clamped at 0. |
| HUD: weapon panel | M | The 0.7 black panel at bottom right sits over the near lanes and hid Turned walking in under it. | A light scrim fading in from the left (0.32–0.45), with shadowed text. |
| Rain nights | M | Rain weather had no visual at night at all. | Slanted streaks (near ones faster and longer) plus splash ticks on the lanes. |
| Snow | M | Flakes were flat, faint, and drawn *under* the darkness pass, so flashes never lit them. | Rain and snow are drawn over the darkness. Each flake or streak takes the light it is in (muzzle flashes, flares, fires, the bell's glow, the floodlight throw). |
| Barricade | M | Holes came only from raider fire. Nothing showed the Turned's work, and the wall looked whole until the 45% swap. | Claw rakes (furrow + torn lip) and pound dents (dark pit, splinter rim, split) land where a body at the face strikes. Bile and Pulper bursts leave rot stains. As wall HP drops, splinters stand out of the face and planks split (0–16 and 0–7 by HP). The 45% broken-image swap stays. |
| Pulper burst, smoke, dust | M | Spore and smoke particles were flat discs with hard edges, which read as yellow coins. | Soft radial puffs (cached sprite per colour). |
| Bellwether under MG fire | H | Under sustained fire the rig hit flash stayed on, and the body read as a pale white blob (README crossing shot). | The flash fires at most every 0.22 s and is lighter (0.30). |
| Named Turned / texts | L | Names and floating texts ran off the right edge ("LEOS"). "hands shaking" landed on the name labels. | Clamped inside the screen. The status text sits over the body. |
| Runs: hit reactions | H | Turned on runs had no flinch, stagger or fall. Only a fixed 0.6 s stagger on a melee roll. | Runs use `impact.ts`: shots and swings call `react()` with zone and direction, the slide eases out, knocked-down bodies lie and get up, and hits on the down take ×1.3. Rigs play the same reaction clips as the wall plus a flinch on every hit. Classic sprites tilt, kneel and fall (`classicPose`). |
| Runs: casings | M | Brass and blood vanished on landing (the run's `Vfx` had no ground layer). | A world-space decal band (6400×200) under everything. Brass, blood and chips stay where they land. |
| Runs: props at dusk | M | Doors, cars, sheds, the duffel and the zone signs stayed in full daylight colour while the backdrop and road went dark, so at dusk they looked pasted on. | A cool, dim baked copy of each prop (bake-time filter, no per-frame `ctx.filter`) is crossfaded in with the dusk. Searched spots get a darker dusk copy. |
| Runs: zone signs | L | A car or shed could spawn on the rail crossing or stop sign and hide the post. | No spot within 210 px of a zone boundary (the old limit was 90 px, less than half a car). |
| Runs: cache | M | The cache could spawn on top of a shed or car and hide behind it. | No other spot within 240 px of the cache or 220 px of the pickup. |
| Runs: prompts | L | The "[E] search …" prompt was drawn before the actors, so the leader's head covered it. | Drawn after the actors on a dark backing, kept on screen. |
| Deploy (phone) | M | Kit buttons were icon + count only. The road was a flat gradient. | Phone kits are a 4-up grid of icon over a short name, with the count in the corner. The road is the night backdrop's asphalt, tiled and mirrored (both widths). |
| Help › The Turned | M | Tiny full-body sprites. | Bust photographs cut by `make-portraits.py turned` (11 sprites; crawlers framed head-first), pinned like the survivors'. |
| Survivor sheet | L | Left column long, middle and right short. | Two columns at ≥ 900 px: the long column left, mood/body over people/memories right. |
| End screen | L | Empty space beside the score card. | The story and the score card sit side by side at ≥ 1100 px. |

**Checked and left as is.**
- Lane depth grade: rigs, props and fx use the same `LOOK[lane]`.
- Contact shadows: every actor, spot and trap sits on one.
- Ragdoll deaths and the get-up after a knockdown read correctly.
- Prop and character scale: the scaffold deck, the nest guns and the firestep sandbags are consistent with the 240-unit bodies.
- Frame time: no hitches seen in the sequences. The runs' new decal band costs one `drawImage` a frame.

## Round 2 art spend
None. The Turned busts are cut from the existing sprites, so the image model was not needed. **Total this round: $0.00.**

## Left after round 2
- **Hit reactions on a downed body**: the hitbox stays the standing one while a Turned lies in the road, so an aimed head shot at a fallen body hits where its head *was*. This needs `hitbox()` to follow the rig's fall.
- **Foreshortening**: the trigger arm can't foreshorten in 2D, so its elbow sits low and slightly behind the grip (71–83° at the elbow). That reads naturally. A drawn near-arm foreshortening (a shorter upper-arm sprite when the elbow points at the camera) would match the photos more closely.
- **Survivor sprite reuse** (from round 1) still needs new generations.

## Round 2 — Battle (follow-up pass)

**Method.** `tools/e2e/battle-audit.cjs` stages each night scene from a day-12 save (weather, special, lights, emplacements and crews, every trap kit laid after the battle starts, corpse-pile carry, wall HP steps) and writes multi-frame 2× PNG sequences plus 1280 px JPEGs. Scenes: unlit, floodlit, fog, snow, rain, tide, raiders, tunnel, horde, crossing, nests, traps, pile, buck, biler, crier, pulper, ferryman, melee, wallhp, dawn; `AUDIT_SIZE=390x844` or `1920x1080` for the HUD. Labels, scaffold layering, the counter clamp, the nest double flash, barricade damage and lit snow/rain had already landed on main (table above), so this pass rechecked them and took what was left.

| Scene | Sev | Issue | Fix |
|---|---|---|---|
| Traps | M | Bear trap, propane tank, burning barrels and the net were drawn as raw sprites, so they skipped the lane grade and read brighter than everything else on their lane. The tank also had a per-frame `shadowBlur` white halo: a white blob in the dark, and a blur pass every frame. | Drawn with `drawProp` and `LOOK[lane]` like the other kits (tank +10%, lit barrels +15% so they still read). The four sprites were added to `PROP_IDS` so they are preloaded and baked. Raw-sprite fallback kept. |
| Traps / long shots | L | Hits on Turned still off the right edge (traps under the spawn point, long guard shots) clamped their "LEGS" / "ARM" texts to the edge, where they stacked into a column pointing at nothing. | `text()` drops labels whose source is off screen. Near-edge ones are still clamped. |
| HUD at 390×844 | M | In portrait the 1280 canvas shows at about 0.3×. The two-line key list became 3 px noise over the near lane, and the messages were about 5 px. | When the canvas shows under 700 CSS px wide (measured with `getBoundingClientRect`, because the stage is CSS-scaled), the key list is dropped (there is no keyboard anyway) and messages are 30 px, fitted to the width. |

**Checked, fine:** the scaffold legs sit behind the firestep crews; labels de-collide in the crowded six-guard line; the counter stays at or above 0; the horde (44 bodies) and the pile/climb frames show no z-fighting or popping; no new page errors in any scene.

**Left:** a real portrait layout for the night (a second canvas framing, or a rotate-device prompt) belongs with the stage/UI owner (`src/main.ts`, `src/ui/*`). The moodle word over every guard ("starving", "exhausted") is accurate but busy on a hungry house. A one-glyph form when three or more guards share it would help. **Art spend:** none.

## Round 3 — runs scale & style

**Method.** A capture script stages a day-12 run on Route 9 with a companion and teleports the leader through it via `__EX`. Shots: noon (home, cars, a door and a kin scene), late afternoon (shed, rail crossing, a body, a dropped pack), dusk (stop sign, pickup, cache), plus a sleeper and walkers in a fight, a shot, and a search. Each frame was captured before and after the fix. The scale check takes a survivor (`SH` = 158 px) as 1.75 m, which is **90 px/m** on the walking lane. Lane depth scale is `depthScale(y)` (640 → 0.93, 664 → 1, 688 → 1.07).

| Thing | Before (px → m) | Real | After |
|---|---|---|---|
| Survivor / Shambler | 158 / 156 → 1.75 / 1.73 | 1.75 | unchanged |
| Station wagon (sprite incl. raised tailgate) | 120 tall, 336 long → roof 1.07 m, 3.7 m | roof 1.45 m, ~4.5 m | 145 px at the kerb (roof 1.45 m, 4.5 m with its spill) |
| Pickup (`obj_truck`) | 135 → 1.5 m tall, 3.7 m long | 1.85 m, 4.8–5.3 m | 157 px (1.95 m, 4.8 m) |
| Door unit (frame + stoop) | 200 → door slab ~1.8 m | 2.0 m | 204 px (slab 2.03 m) |
| Shed | 190 → door ~1.5 m | ~1.9 m door | 209 px |
| Kin scene (seated woman at a table) | 175 → **1.94 m seated**, taller than a standing survivor | ~1.3 m | 108 px |
| Gun cabinet / cache | 150 → 1.67 m | 1.8–1.9 m | 148 px |
| Railroad crossbuck | 200 → **2.2 m**, sign at shoulder height | ~4 m | 321 px |
| Stop sign | 200 → plate at head height | 2.1 m to the plate bottom | 229 px |
| Body / duffel (in the road) | 44 / 30 | 0.6 m deep, 1.7 m long / a 0.6 m bag | 56 / 32 px |
| Backdrop (`bg_mid`) | painted pickup ~180 px at the road edge; house doors ~70 px at depth 0.39 | — | consistent with 90 px/m. It was the foreground props that were small. |

| Scene | Sev | Issue | Fix |
|---|---|---|---|
| Every prop | H | Street props were 15–45% undersized: a toy wagon next to the painted full-size pickup behind it, a crossbuck shoulder high, a seated woman taller than the leader. | Heights are in metres (`PROP_M`) × 90 px/m. |
| Companion / far lane | H | Props stood on the middle lane (base 668) but were drawn under every actor, so the companion on the far lane (640) appeared *in front of* a car with her feet above its wheels, as if standing on it. | Props stand on a kerb line (`KERB` = far lane − 12) with that depth's scale (0.89), so all three lanes walk in front of them. Bodies and dropped packs stay in the road. Shadows and prompts follow the base. |
| Dusk | H | Props and backdrop fell to dusk, but survivors and Turned stayed fully lit: bright cut-outs on a dark street. | `looksAt(dusk)`: the lane looks step (6 steps) darker, greyer and toward the dusk fog, matching the props' dusk copy (about 0.57 brightness at full dusk). The stepping keeps the graded atlases at a handful of bakes. |
| Placement | M | With true-size props, the 300–520 px spot spacing overlapped neighbours (two wagons fused). The zone-3 pickup sat on the stop sign. | Spacing by footprint (`SPOT_W`). The pickup moved to boundary + 250, and the cache to at least +540. |
| Repetition | L | The same wagon or shed sprite repeated identically along the street. | Alternate cars, doors, sheds and bodies are mirrored (by x). |
| Zone plate | L | Fixed at y 426, it covered the taller sign. | Rides 10 px above the sign's top. |
| Labels | L | "Search a county cruiser / minivan / storefront / garage / woodpile" on a station wagon, a house door and a plank shed. | Labels match the sprites. |

**Checked and fine:** contact shadows under every prop and actor; no magenta fringes on the `obj_*` sprites; the ground tile and `bg_mid` mirror seam (its mirrored copy repeats the poles and pickup, but at 0.7× parallax it reads as more of the street); muzzle light at dusk; no page errors.

**Left / hooks for other owners:**
- **Run corpses** bake at a fixed `b: 0.6` in `actors.ts` (`bakeRun`, `drawCorpses`), so at full dusk they read slightly brighter than the living. A `look.b * 0.6` in place of the constant would make them follow the dusk look this file now passes in.
- The search progress bar and the companion's name can overlap when the leader crouches beside her (both near y 484).
- The door sprite has its own stoop, so it stands alone at the kerb with no house wall. A facade/porch sprite, or drawing doors only where the backdrop's houses are, would read better (art).

**Art spend:** none ($0.00). The existing sprites only needed true scale.

## Round 3 — night scale & style

**Method.** `battle-audit.cjs` (unlit, floodlit, fog, nests, traps, pile, wallhp, dawn) from the day-12 staged save, before and after, 2× PNGs. Scale is taken from the survivor: `SH` 158 px = 1.75 m, so **90 px/m at depthScale 1** (`HORIZON` 330, `REF_Y` 664; camera height ≈ (664 − 330) / 90 = 3.7 m, which matches where the horizon cuts the backdrop houses, at the porch-roof line).

**Scale table** (px at scale 1 → metres; ✓ = within ~15% of the real thing)

| Object | Drawn | Real | |
|---|---|---|---|
| Survivor (`SH`) | 158 px | 1.75 m | reference |
| Barricade (`drawWall`, h 118 + up to 50) | 1.1 m above the firestep row's feet | 1.1–1.4 m to fire over | ✓ (low end) |
| Scaffold deck (`ROOF_Y`) | ≈ 2.1 m | 2–2.5 m | ✓ |
| Floodlight pole (`fort_light` 280 px) | 3.2 m | 3–4 m | ✓ |
| Nest MG (`emp_mg_gun` len 88) | 0.98 m | 1.1 m (M60/M240) | ✓, reads the same as the guards' long guns |
| Swivel rifle (len 80) | 0.9 m | 1.0–1.1 m | ✓ |
| Dog (62 px to the head) | ≈ 0.55 m at the shoulder | 0.6 m | ✓ |
| Bear trap (54 × 23 px) | 0.6 m across with springs | 0.5–0.7 m | ✓ |
| Propane tank (46 px) | 0.51 m | 0.45 m | ✓ |
| **Burning drums (58 px)** | **0.64 m** | **0.88 m** | **✗ → 80 px** |
| Pipe mine 22, flare 24, radio 34, tin-can post 52, fence post 56 | 0.24–0.62 m | — | ✓ |
| Deadfall gallows | ≈ 2.5 m | — | ✓ |
| Corpses (lying) | the standing body's length | — | ✓ |
| Backdrop pickup | length ✓ at its ground line (y ≈ 560, scale 0.69); height ≈ 1.3× | — | painted; left |
| Brass (3 × 1.5 px) | 3 cm | 4.5–7 cm | slightly small; left (it reads) |

| Scene | Sev | Issue | Fix |
|---|---|---|---|
| Corpses, blood, brass (every night with kills) | H | The road's decal canvas (`this.ground`: baked ragdolls, classic corpse stamps, blood, settled brass) was drawn **before** darkness pass A. A corpse took its own corpse darkening, then the full night mask, while the living took only 40%. Piles read as flat black cut-outs beside lit bodies. | The decal layer is drawn right after pass A, before the light pools. The dead now get the same 40% the actors and the trap decals get. Bodies read as bodies in a pile, darker than the living. |
| Spike rails | M | Rails were anchored at `wallX(lane)`, the gameplay face that moves 10 px right per far lane. The barricade is one flat image, so the far rails hung 10–20 px off the face in mid-air. | Every rail's butt sits at `WALL_X − 8`, nailed into the face. |
| Burning drums | M | 0.64 m tall: smaller than they read next to the 0.5 m propane tank. | 80 px (0.88 m × 0.57 m). The fire, smoke and light emitters were raised with it. |
| Punji pit | M | Raw `drawImage`. It skipped the lane grade and read brighter than the road (the same bug round 2 fixed for four other kits). | `drawProp(…, LOOK[lane])`. `trap_pit` was added to `PROP_IDS` (preload and bake). |
| Rot sludge | L | `rgba(78,64,26,.42)` drawn after the darkness read as mustard paint on the night road. | Dark rot smear `rgba(44,38,16,.5)`. |
| Parallax | L | The backdrop moved `+px` and the near weed strip `+1.4·px` with the aim, while the playfield stood still. Both planes slid the same way, so the playfield seemed to slide against them. | The view pivots on the playfield: the backdrop goes `+px` and the near strip `−0.5·px`. (Research 04 §6 said 1.4× in the same direction. That is superseded here.) |

**Checked and left as is.** The firestep, scaffold and roof crew heights against a person. The floodlights against the scaffold. The nest guns against hand-held guns. The dog. Trap kits other than the drums. The lane grade on wire, junk heaps, the drain and spikes. Contact shadows under every actor, the wall, the turrets and the cover. The backdrop horizon against `HORIZON`.

**Left (other owners or no time).**
- Ragdoll corpses bake with `shade: true` (actors.ts `bake`). After the layer move they read right. A corpse still in flight (drawn in the sorted pass, before it bakes) can be a little darker than the baked ones beside it, so give it one look in actors.ts (anim owner).
- The nest gun is drawn at b 1.2 while its base is NEAR (1.0). A slight value step; harmless.
- Nothing ties the barricade's height to the climb or pile heights in code, so I left it at the low end of realistic (≈ 1.1 m at the firestep).

**Art spend:** none ($0.00).
