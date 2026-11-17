# 03 — Art Style & Lore Research

Working title for the setting: **"The Long Turn" — Vessey, on the St. Aubin River**

This doc covers two things:
1. **Art direction.** A "toon / cel-shaded but mature" style bible with concrete rules and a reusable AI-image prompt prefix.
2. **Lore.** Techniques that make post-apocalyptic worlds feel lived-in, plus an original setting draft.

Everything below is original. The listed works are touchstones for *technique*. Do not copy names, characters, or designs from them.

---

## Part 1 — Visual References & What to Steal From Each

| Reference | What it does | Rule we take |
|---|---|---|
| **Borderlands** (Gearbox) | Gearbox calls the look "inked" rather than cel-shaded: black ink outlines over 3D, hand-painted textures with "ink splatter, softly traced lines, and imperfect ink strokes". | Outlines should be **imperfect and variable**, never uniform vector strokes. Hatch marks go *in the texture*, not in lighting. |
| **The Walking Dead (Telltale)** | Comic-book cel shading. Gravity comes from muted earth tones, heavy black shadow, and faces that are *tired*, not exaggerated. | Mature = **realistic proportions + stylized rendering**. Never exaggerate anatomy (no big heads, no big hands). |
| **XIII** | Comic-panel framing and onomatopoeia. | Use sparingly. At most, a single ink "panel" inset for big moments (a kill-cam freeze). No "BLAM!" text, which reads goofy. |
| **Darkwood** | Top-down, desaturated, with a vision cone that hides the world. Horror comes from what you *can't* see. | Darkness is a mechanic. Unlit areas go to near-black, and enemies there are drawn as silhouettes only. |
| **Mark of the Ninja** (Klei) | Each character has a full-color sprite in light and a **flat monochrome silhouette** in darkness. Classic animation style paired with bloody violence. | Two render states per actor: **lit** (full palette) and **shadowed** (single dark value plus rim light). It reads instantly. |
| **This War of Mine** (11 bit) | Animated charcoal and sketch look with near-monochrome greys and sepia photography. The art director chose it deliberately because "super realistic" was not an option for the theme. | Grain and paper texture are what make the world feel *grieving*. Use a **paper/charcoal overlay** on backgrounds and UI. |
| **Blasphemous** | Very dark grounds, crimson and gold accents, devotional iconography. Gore is ritual, not slapstick. | Gore carries **meaning and restraint**. It should look like a painting of a wound, not a cartoon splat. |
| **Dead Cells** (Motion Twin) | 3D models and animation rendered to low-res sprites with normal maps, which allows fast iteration and dynamic light. | If we ever outgrow AI stills: model in 3D, render with toon ramp, downscale, export normals. |
| **Katana Zero** | Neon accents on dark ground, VHS grain, very legible one-hit combat. | One **hot accent** per scene does more than ten colors. |
| **Children of Morta** | Hand-painted pixel art with rich lighting, and a family/grief narrative. | Light sources (lamps, fire) are what carry *warmth*. Use them emotionally. |
| **Graveyard Keeper** | Soft pixel art with morbid humor. | **Counter-example.** Its warm saturated palette reads cosy. Avoid it. |
| **Mike Mignola (Hellboy)** | Chiaroscuro. Black is treated as a *solid design shape*, not as missing light. Shadows are often larger than physics allows, and he uses one figure's shadow to define the next figure's silhouette. | **Spot blacks as graphic shapes.** Faces are half-swallowed by black. Detail is *implied* by where the black stops. |
| **Frank Miller (Sin City)** | Pure black and white with a single spot colour. | A **spot-colour rule**: one accent hue per scene (blood, flare, or sodium lamp). |
| **Moebius** | Clean, confident contour lines, huge skies, and calm. | Backgrounds can be quiet and wide, with sparse linework on far layers. |
| **Ashley Wood** | Loose, scratchy, painterly line with gritty grey-brown washes and drips. | Allow **ink drips and dry-brush edges** on large shapes (barricades, wrecks). |
| **Sergio Toppi** | Dense hatching, textures built from line, dramatic negative space. | Use **hatching in mid-tones** rather than gradients. Hatch direction follows form. |

### Concrete Art Direction Rules

**1. Palette (limited, desaturated, accented)**
- Base ramp is 6 to 8 values of **cold grey-brown** (wet asphalt, birch bark, river mud). Saturation stays under about 20%.
- Starting palette (hex):
  - Ink `#14110F`, Shadow `#2A2622`, Deep `#3D3832`, Mid `#5E574D`, Light `#8C8273`, Paper `#C9BFA8`, Highlight `#E8E0CC`.
  - Cold sky/river: `#4A5560`, `#6F7C86`.
- **Accents** are reserved for gameplay meaning:
  - **Sodium/fire orange** `#E07A2E`: warmth, safety, light sources, muzzle flash.
  - **Arterial red** `#8E1B1B`: blood and damage. Darker and browner than "game red".
  - **Signal teal** `#3FA7A0`: interactables and pickups. Used sparingly.
  - **Sick ochre** `#B59A3A`: the infection (eyes, sores, Bloater bile).
- Never more than **two accents** visible in a resting frame.

**2. Line weight**
- Outer silhouette: **3 px at 1x sprite scale** (heavy contour). Inner detail: 1 px. Far parallax layers get **no outline**, only shape.
- Lines are *ink black-brown* (`#14110F`), never pure #000.
- Lines are slightly broken and tapered (dry-brush). Leave gaps where light hits the edge ("lost edges").

**3. Shadow shapes (2-tone hard)**
- Use exactly **two tones per material** (lit and shadow), plus optional spot black. No soft gradients on characters.
- The shadow edge is a **designed shape** (Mignola), not a computed terminator. Use big, simple, angular shapes.
- Light comes from **top-left as the key**. Rim light is a thin warm or cold line on the side away from the key, used to separate characters from dark backgrounds.

**4. Silhouette readability (gameplay first)**
- Every enemy type must be identifiable **as a solid black shape at 48 px tall**. Test by filling sprites black.
- Differentiate by **mass and posture**: Shamblers are vertical and slumped, Runners are diagonal and leaning forward, Bloaters are wide ovals, Ferrymen are tall rectangles with hooks.
- The player has a unique silhouette element (a long coat and a hooded headlamp) and a warm rim light, so they are always findable.
- Value contrast: actors live in the **mid to light** range against **darker** foreground and background layers. The gameplay plane is the most contrasty plane.

**5. Parallax layering (side-scroller)**
- Use 5 planes. Speeds are relative to the camera.
  1. **Sky** (0.0 to 0.05): flat gradient and paper grain, low contrast, cold.
  2. **Far** (0.15): hill/treeline/mill-stack silhouettes, one flat value, slight blue shift.
  3. **Mid** (0.4): buildings, power lines, water tower. Two values, minimal line.
  4. **Gameplay** (1.0): full rendering, outlines, collision.
  5. **Foreground occluders** (1.2 to 1.4): near-black shapes (fence posts, reeds, rail car), used sparingly so they never hide threats.
- Atmospheric perspective: each step back is **lighter, lower contrast, cooler, and less detailed**. Sources agree that you need several cues together (value, detail, occlusion, speed) to sell depth. Parallax alone won't do it.
- Loop seams: make far layers tile horizontally, and keep pixel movement integer-aligned at native resolution.

**6. Lighting**
- The world is underlit by default. Light is a **resource and a beat**.
- **Muzzle flash:** a 1 to 2 frame full-screen additive orange pulse at about 8% plus a hard radial light (about 2 tiles) that flips nearby actors from "silhouette" state to "lit" state for those frames. This is the Mark of the Ninja trick, used for horror.
- **Flares:** red-orange, flickering, with long hard cast shadows. Zombies are drawn toward them.
- **Fire:** warm pool plus rising embers. Barricade fires are the only "safe" warmth.
- **Headlamp/flashlight:** a narrow cone with a hard edge and dust motes. Enemies outside it render as silhouettes only.
- Use multiply-blend dark overlays and additive light sprites. In Phaser/Canvas, a simple lightmap RenderTexture is enough.

**7. Gore that reads mature, not goofy**
- **Color:** dark, brownish arterial red, never bright cherry. Desaturate blood as it dries (decals fade to `#3D2420`).
- **Quantity:** less is more. Short, directional spray in 2 to 3 frames, then *it stays* as a decal. No fountains, no bouncing eyeballs, no comedic gib piles.
- **Shape language:** ink splatter with dry-brush edges (Ashley Wood), consistent with the line style.
- **Aftermath over spectacle:** bodies stay, blood trails lead somewhere, and corpses in the world have clothes, name tags, and wedding rings.
- **Sound and camera** do the work: a brief hit-stop (40 to 60 ms) and a muffled thud beat anything visual.
- Avoid: exaggerated limb pops, cartoon X-eyes, and slapstick ragdoll.

**8. UI style (diegetic, ledger and journal)**
- HUD elements are **objects**:
  - Ammo is cartridges drawn on the coat.
  - Health is a handwritten tally or pulse line in pencil.
  - The map is a folded county road map with grease-pencil marks.
- Menus are a **mill ledger / survivor's journal**: ruled paper `#C9BFA8`, faded blue rules, coffee rings, ballpoint and pencil text. Type pairing: a condensed typewriter face for headers (e.g. *Special Elite*) and a handwriting face for notes (e.g. *Caveat* or *Reenie Beanie*). Both are on Google Fonts.
- Notifications are stamped or clipped: rubber-stamp red for warnings, a paperclip for new documents.
- Keep combat HUD minimal: ammo, health, and the selected item in corners, with paper texture at 70% opacity.

---

## Part 2 — AI Sprite Generation Practicals (Gemini Image / "nano-banana"-class models)

### What we know
- Gemini 2.5 Flash Image ("nano-banana", model id `gemini-2.5-flash-image`) generates at about **1024 px** and is strongest at **editing from a reference image**. Character consistency is best achieved by feeding back an approved "hero" image rather than re-prompting from scratch.
- These models generally **do not output real alpha**. The reliable approach is a **flat key colour background** removed locally. Default to magenta `#FF00FF`. Switch to pure green `#00FF00` for subjects with pink/red content, which matters a lot for us: gore and flesh near magenta will key badly, so **zombies should use green**.

### Prompt rules
1. **A fixed style prefix on every call** (below). Do not paraphrase it between calls, because consistency comes from identical tokens.
2. **Camera words:** "strict side view, facing right, full body, orthographic, no perspective, centered, feet on the bottom edge, small margin". Always face right; flip in-engine.
3. **Background words:** "on a perfectly flat solid #00FF00 background, no gradient, no shadow on the ground, no floor, no vignette, no text". Models love adding drop shadows and floors, so explicitly forbid them.
4. **One subject per image.** Sprite sheets in a single generation drift: limbs change, scale varies, frames misalign. Generate **one pose per image** using the approved hero as a reference ("same character as the reference image, now in pose: ..."), then assemble the sheet in code.
5. **Specify proportion and scale:** "adult, realistic 7.5-head proportions, figure fills 85% of image height". This keeps every character at consistent scale before downscaling.
6. **Negative cues in plain language:** "not cute, not chibi, no big head, no anime eyes, no cartoon exaggeration, no text, no watermark, no border".
7. **Aspect ratio:** request square or 2:3 portrait for characters, wide (16:9 or 21:9) for background layers, square for icons.
8. **Animation:** AI stills are fine for idle, hurt, and death keyframes. For walk cycles, prefer **cut-out rigging** (separate limbs, then animate in-engine) or generate 4 key poses and accept a choppy, stylized 6 to 8 fps cadence. That actually suits the comic look.

### Post-processing pipeline (scriptable: Python + Pillow/numpy, or sharp in Node)
1. **Key out:** compute distance to the key colour in RGB (or chroma in YCbCr). Alpha = 0 when distance < t1, ramp to 1 by t2.
2. **Despill:** clamp the green channel to max(R, B) on edge pixels (for magenta, clamp R and B). This removes the coloured fringe.
3. **Trim** to the alpha bounding box, then **pad to a common canvas** anchored at bottom-centre (feet).
4. **Downscale** to the target height (e.g. 96 px for player/zombies at a 480x270 internal resolution, or 192 px for a 1080p HD-2D look). Use area/box filtering, then optionally threshold alpha to 0/255 for crisp edges.
5. **Palette quantize** to the master palette in Part 1 (Pillow `quantize(palette=...)` with dither off, or an ordered/Bayer dither at low strength for the charcoal feel). Doing this to *every* asset is what makes AI output look like one game.
6. **Outline pass (optional):** dilate alpha by 1 to 2 px and fill with ink `#14110F`. This unifies contour weight across generations.
7. **Export:** PNG with an atlas JSON (TexturePacker-style, or `free-tex-packer`). Keep the raw 1024 px source for re-processing.

### THE PROMPT PREFIX (reuse verbatim)

```
Mature graphic-novel game art, 2D side-scrolling game sprite. Hand-inked cel-shaded style: heavy imperfect black-brown ink contour lines, exactly two flat tones per material plus solid spot blacks shaped like Mike Mignola shadows, sparse cross-hatching in mid-tones, dry-brush edges. Realistic adult proportions, grim and weary, not cartoony, not cute, not chibi, no anime. Desaturated cold grey-brown palette (wet asphalt, birch bark, river mud) with at most one warm accent colour. Late-autumn northern mill town mood. Strict side view facing right, full body, orthographic, no perspective, centered, feet near the bottom edge with a small margin. Isolated on a perfectly flat solid {KEY} background, no gradient, no floor, no cast shadow, no vignette, no text, no watermark, no border.
```

Replace `{KEY}` with `#00FF00 pure green` for anything with flesh or blood, or `#FF00FF pure magenta` for green-heavy subjects. For **background layers**, use the variant below. It drops the side-view and key-colour clauses, because layers are opaque or keyed on the sky:

```
Mature graphic-novel game background art, hand-inked cel-shaded, two flat tones plus spot blacks, charcoal paper grain, desaturated cold grey-brown palette, late-autumn northern river mill town, wide horizontal panorama, flat orthographic side-on view with no vanishing-point perspective, seamlessly tileable left-to-right edges, no characters, no text.
```

### 10 example prompts (append after the prefix)

1. **Survivor (player hero):** "Subject: a woman in her late 30s, a former ferry deckhand. Long waxed canvas work coat with patched elbows, knit watch cap under a headlamp, fingerless wool gloves, rubber boots, a canvas satchel, holding a pump-action shotgun low at the hip. Tired, alert face half in solid black shadow. Thin warm orange rim light along her back edge. Idle stance, weight on back leg."
2. **Zombie — Sleeper (basic shambler):** "Subject: an infected man in a torn mill-worker union jacket and stained thermal shirt. Vertical slumped posture, head lolling forward, arms hanging. Grey-ochre waxy skin, dull ochre eyes, dark brown dried blood at the mouth and collar. Slow shuffling step. Restrained, unsettling, not comedic."
3. **Zombie — Deer (runner):** "Subject: a thin infected teenager in a high-school cross-country windbreaker, leaning hard forward at a 30-degree angle mid-sprint. Arms back, mouth open, ribs showing through a torn shirt, bare muddy feet. Ochre eyes. Strong diagonal silhouette."
4. **Zombie — Bloater ('Pulper'):** "Subject: a heavily swollen infected body in split chest waders and a paper-mill apron, waterlogged and grey-green. Bulging wide oval silhouette, skin stretched and veined with ochre, dripping river water and dark bile. Short heavy legs, slow."
5. **Zombie — Ferryman (brute):** "Subject: a very tall, broad infected dockworker in a heavy rubber rain slicker and a rusted welding mask fused to the face. Carrying a long iron boat hook. Tall rectangular silhouette, shoulders hunched, chains and rope wrapped around the forearms. Spot-black shadows hide most of the body."
6. **Barricade:** "Subject: a defensive barricade built from a toppled church pew, corrugated tin sheets, mill pallets, and a car door, lashed with rope and chain. Hand-painted warning 'NO ENTRY — TURNED INSIDE' in dripping white paint. Two-tone weathered wood and rusted metal. Side view, ground line at the bottom edge." *(Use `#FF00FF` key.)*
7. **Background — Far layer:** *(background variant prefix)* "Far layer: a low ridge of black spruce and bare birch against an overcast pale grey sky. The single silhouette of a paper-mill smokestack and water tower on the right. One flat cool value, no outlines, very low contrast, faint paper grain."
8. **Background — Mid layer:** *(background variant prefix)* "Mid layer: a riverside main street. Clapboard storefronts, a closed diner with a hand-lettered 'FERRY SUSPENDED' sign, sagging power lines, a Lutheran church steeple. Two values only with minimal linework, slightly lighter and cooler than gameplay. Transparent-ready flat sky colour #FF00FF above the rooftops."
9. **Background — Gameplay ground tiles:** *(background variant prefix)* "Gameplay ground strip: wet cracked asphalt and gravel shoulder, drifts of brown oak leaves, a rusted culvert, frozen puddles. Full ink linework and hatching, 2:1 panoramic strip, top edge clean against flat #FF00FF."
10. **Weapon icons (sheet of 1):** "Subject: a single inventory icon of a {weapon}, e.g. 'worn double-barrel shotgun with tape-wrapped stock' / 'bolt-action deer rifle with scuffed scope' / 'mill fire axe with chipped red head' / 'road flare'. Displayed flat in a perfect side profile, horizontal, centered, filling 80% of a square frame. Heavy ink contour, two tones, one warm accent. On flat #FF00FF background." *(Generate one per call. Swap the 'side-scrolling sprite' clause in the prefix for 'inventory icon'.)*

**Consistency workflow:** generate prompt 1 about 8 times, pick the hero, then pass it as a reference image on every subsequent call ("Match the exact rendering style, line weight and palette of the reference image."). Do the same with one approved zombie as the style anchor for all enemies.

---

## Part 3 — Lore Techniques From the Canon

| Work | Technique | Take-away for us |
|---|---|---|
| **The Road** (McCarthy) | No explanation of the cataclysm. Unnamed characters. Tiny mundane rituals (a can of peaches, a cart). Moral weight carried by a single child's question ("are we still the good guys?"). | **Refuse to explain.** Make survival rituals concrete and repetitive. Give the protagonist a person to stay good *for*. |
| **The Last of Us** | Notes and graffiti left by people who are now dead, with mini-arcs across rooms. Infected bodies that still wear their jobs. Grief over spectacle. | **Micro-arcs in 3 notes**: setup, hope, aftermath found in the same building. |
| **Station Eleven** (Mandel) | The *before* matters as much as the after. Art, memory, and nostalgia (the Museum of Civilization). Non-linear time. | Objects from before (a bowling trophy, a phone with photos) are treated as **relics**. Some factions curate them. |
| **World War Z** (Brooks) | Oral-history framing modelled on Studs Terkel's *The Good War*. Many voices, each with a unique tone and personal tragedy. | **Many small voices** across documents, radio, and tape, each with a distinct register (bureaucrat, kid, preacher, shift supervisor). |
| **Metro 2033** | Stations as micro-nations with their own ideologies. A hidden moral system that judges the player quietly. | Factions should be **small, local, and ideological**. Keep a hidden mercy ledger that affects the ending. |
| **Fallout** | Environmental storytelling ("What happened here?", Smith & Worch, GDC 2010). Skeleton vignettes in staged poses. | A **vignette per screen**: arrangements of props that tell a story without text. |
| **S.T.A.L.K.E.R.** | Folklore and rumor about anomalies. Campfire anecdotes. Contradictory explanations. | Infected types have **folk names and folk rules** that may be wrong. |
| **Pathologic** | A town as an organism. Plague with rival interpretations (science, tradition, faith). Scarcity forces brutal moral choices on a timer. | A **day/night clock** with too many needs. Faction theories of the illness are **all partly right**. |
| **Disco Elysium** | Specific, textured, politically-lived-in prose. The town has labor history (a union, a strike). Failure is interesting. | Use **labor and union history** as backbone, with dry, humane, specific writing. Avoid generic "survivor" voice. |
| **Kentucky Route Zero** | Magical realism layered on economic decline (debt, a closed mine). Quiet melancholy and ghostly bureaucracy. | The apocalypse arrives **after** a long economic collapse. The town was already dying. |

**Extracted techniques**
1. **Environmental storytelling.** Each screen gets one staged vignette (a barricaded nursery, a church pew of name tags, a sheriff's car with 3 days of tally marks).
2. **Fragmentary documents.** Under 120 words each, with a voice-distinct author. They connect across locations (the same name in a ledger and a radio call).
3. **Radio broadcasts.** A slowly decaying official signal (Emergency Alert loops) alongside amateur voices (CB, ham, a church on AM). Signals go silent over the campaign.
4. **Factional politics.** Factions want **legitimate, conflicting** things: medicine vs. quarantine vs. faith vs. property vs. family.
5. **Ambiguity about the outbreak.** At least three plausible theories, none confirmed.
6. **Mundane details.** Shift schedules, casserole sign-up sheets, ferry timetables, hunting licences, Halloween decorations still up.
7. **Grief and moral weight.** The infected are recognizable people. Some still wear name tags. Killing one is never a joke, and sometimes you *choose* not to.

---

## Part 4 — Original Setting Draft

### Region
**Vessey**, pop. 4,100 (2010 census, falling). A paper-mill and ferry town on the **St. Aubin River**, in the forested north of a Great Lakes border state. The town sits on the west bank. The **Vessey Ferry** (a cable ferry, two cars and forty passengers) crosses 600 m of brown, tannin-dark water to **Grace Island** and the county road east. The only bridge is 30 km downstream at **Corliss**.

The **Northern Aubin Paper Co.** mill (founded 1911, "the Aubin") cut two of its three shifts in 2019. Main Street has a Lutheran church, a Catholic church, the Legion hall, a closed Ben Franklin store, the Ferry Diner, and the bowling alley. Water tower lettering reads "VESSEY — HOME OF THE PAPERMAKERS".

**Season:** late October into November. Leaves are down, the first hard frost has come, deer season opens, and the river is about to ice. Ice is a ticking clock: when the river freezes, the Turned can **walk across**.

### Timeline (in-world calendar)
- **Sept, Year 0.** The mill reports "a bloom" in the effluent settling ponds: rust-orange foam and a sweet smell. The DNR is notified, and a sampling team comes and goes. Two rapid-response workers are hospitalised with "fever and confusion".
- **Early Oct.** Deer hunters report "drunk" deer that don't flee. A doe walks into the Legion hall during bingo. Local news treats it as chronic wasting disease.
- **Oct 19, "Homecoming".** At the Papermakers homecoming game, a groundskeeper attacks two people in the parking lot. The county sheriff calls it an overdose.
- **Oct 20–24, "The Turn".** Cases multiply in the clinic and the nursing home (St. Aubin Manor). The state issues a *precautionary* travel advisory. Phone service is intermittent.
- **Oct 25.** The National Guard establishes the **Line** at Corliss Bridge. *No one crosses east.* The ferry is ordered suspended. The ferry families run it anyway at night.
- **Oct 28.** The Emergency Alert System begins a looped message: "Shelter in place. Await instructions." It never changes.
- **Nov 1, All Saints'.** The Lutheran church shelter is overrun during a vigil. The bell rings for 40 minutes, and nobody knows who rang it.
- **Nov 2–present (game start ~Nov 6).** The town fractures into factions. The cell network is down. Corliss Bridge was reportedly "dropped" by the Guard (an explosion was heard), but nobody has confirmed it.
- **Forecast:** the river freezes around the **end of November**. That is the campaign's hard deadline.

### The Infection — "The Turn" (deliberately ambiguous)
What people agree on:
- It spreads through **bites and fluids**. It is maybe linked to the river: people who drank well water near the ponds turned faster.
- Victims run a **fever** with a sweet, mushroom-and-pulp smell, then lose speech, then wake ochre-eyed.
- The Turned are **drawn to warmth, light, and noise**, and *to places they knew*.
- The cold slows them. Freezing nights make them sluggish but not dead.

Competing theories, all partly supported in documents:
1. **Industrial.** A fungal/microbial organism cultivated in the mill's settling ponds fed on new chemistry. (Mill memos about a "process change" in 2018. A DNR sample sheet with a redacted line.)
2. **Natural/ecological.** It came from the deer: a prion- or fungus-like wasting disease that jumped species. (Hunter testimony, the Department of Natural Resources poster.)
3. **Spiritual.** Judgement, or "a turning of the season in men". (Parish sermons. The All Saints' bell.)
4. **Government.** A test, or a cover-up. The Line went up *too fast*. (A Guard roster dated Oct 18, before the attacks.)

The game never confirms any of these. Late-game fragments make the industrial and ecological theories *both* true and the government one *ambiguous*.

### Factions
1. **Local 41 (United Papermakers).** Union members holding the fortified mill compound. They have generators, the pulp-water boilers (heat), and steel. They are egalitarian and armed, with strong solidarity but hard rules: "Everybody works a shift." Their leader is the shift steward **Dolores Wick**. Their secret: the mill knew about the ponds, and some union officers signed off on it to save jobs.
2. **The Parish (Our Lady & Trinity Lutheran together).** Running a relief kitchen in the school gym. They shelter the old and the young, keep a registry of the dead and missing, and **refuse to kill the Turned who still come home**. Led by **Pastor Ruth Engvall**, who has a crisis of faith. Source of medicine and moral authority. Their fault line: they hide infected family members in the basement.
3. **The Ferry Families (Halvorsen, Doucette, Peltier).** River clans that run the cable ferry at night. They control *crossings*, and so everything that comes in and out. Pragmatic smugglers who trade passage for fuel and ammo. Grace Island is their fallback. Their dilemma: the ice is coming, and their power ends with it.
4. **The County (the Deputies and the Line).** The remnant of the sheriff's office plus three Guardsmen cut off from their unit. They hold the courthouse with law, lists, and quarantine. They're well-armed and increasingly authoritarian, and they shoot the "exposed". They believe the Line will reopen if Vessey shows "containment". Their record book, the **"Exposure Register"**, mirrors the Parish's registry of the dead.
5. **The Quiet (optional/emergent).** A handful of people who walk among the Turned unharmed, smeared with mill-pond sludge. They believe the Turned are "listening". Are they cultists, or people who've found something real? Used sparingly and never explained.

### Turned Taxonomy (folk names)
| In-world name | Gameplay role | Description / folk rule |
|---|---|---|
| **Sleepers** | Basic shambler | Slow and vertical. They stand still for hours "like they're waiting for a shift whistle". *Folk rule: "Don't wake a Sleeper."* (Noise aggro radius.) |
| **Deer** | Fast runner | Young, thin, recently turned. They leap and sprint in bursts, then stop, panting. *"They spook like deer, and they come back like deer."* |
| **Pulpers** | Bloater / area hazard | Waterlogged bodies from the river and the ponds. They burst into ochre spore-bile that slows and blinds. *"Shoot them far or not at all."* |
| **Criers** | Summoner | Make a high, broken keening that sounds almost like words, and others come. Often found in houses. *"It's calling them by name."* |
| **Ferrymen** | Brute / armoured | Big men in rubber slickers and welding masks, near the docks. They carry hooks and drag. Slow and very durable. Shotgun to the legs. |
| **Kin** | Non-hostile → hostile | Turned who returned *home*. They sit at kitchen tables and stand at windows. Harmless unless the house is entered or the lights go on. The moral-choice enemy. |
| **The Bellwether** *(rare/boss)* | Unique | Something in the church tower. Whoever rang the All Saints' bell. Never fully seen. |

### Tone Pillars
1. **Grief, not gore.** Every Turned was somebody's coworker. Violence costs something.
2. **The town was already dying.** Economic decline is the backdrop, and the outbreak only finished the job.
3. **Cold is the clock.** Autumn turns to ice, light shortens, and everything is running out.
4. **Nobody has the full story.** Ambiguity is a design rule, not a gap.
5. **Small kindnesses are radical.** Warmth, food, and a hand-lettered sign are what hope looks like.

---

## Part 5 — 15 Sample Found Documents & Radio Snippets

1. **EAS broadcast (loop, AM 1340 / every TV channel):** "This is an emergency message for Aubin County. Remain indoors. Do not approach individuals displaying confusion or fever. Await instructions. This is an emergency message for Aubin County. Remain—"
2. **Mill shift log, Oct 3 (pencil):** "Pond 2 foaming again, orange, smells like bread gone off. Told Kessler. Kessler says don't log it. Logging it."
3. **Hunting licence, back side (ballpoint):** "Doe at 40 yds, didn't run. Looked right at me. Didn't shoot. Something wrong with her eyes. Went home. Told Jen I got nothing."
4. **Parish registry card:** "NAME: Arnold P. Haugen. AGE: 81. STATUS: ~~Missing~~ ~~Turned~~ *Came home Thursday. Sitting in his chair. Leave him be.* — R.E."
5. **CB radio, channel 19, night:** "—Halvorsen boat, you copy? Lights on the island. Somebody's on the island. Bring the Peltier kid back, she's not supposed to be on the island—"
6. **Ferry Diner whiteboard:** "SPECIAL: SOUP (whatever's left). FERRY: CLOSED BY ORDER. Ferry anyway 2am ask Doucette. PIE: no. Pray for Marla."
7. **County "Exposure Register," p. 14:** "Wick, Thomas — bite, L forearm — 10/27 — remanded to holding. 10/28 — remanded. 10/29 — [entry struck through] — disposition: per Sgt. Hale."
8. **Local 41 notice, stapled to the gate:** "EVERYBODY WORKS A SHIFT. Kids work the laundry. Old timers watch the boiler. Nobody eats who don't. Nobody gets left who does. — D. Wick, Steward"
9. **Answering machine tape, 2-story on Birch St.:** "Hi, it's Mom. The school's sending everyone to the gym. I'll leave the porch light on for you. I'll leave it on, honey."
10. **DNR field sample sheet (photocopy):** "Site: NAP Pond 2. Visual: orange flocculent mats. Odor: sweet/fermented. Organism ID: [REDACTED — forward to state lab]. Recommend: ███████. Sampler hospitalized 9/24."
11. **AM 880, church broadcast (Pastor Engvall):** "...and I won't tell you it's judgment. I won't tell you that. I'll tell you there's soup at the gym at six and that Gene Halvorsen needs insulin and if you have any, God bless you, bring it."
12. **Child's school worksheet, "My Town" (crayon):** "My dad works at the mill. My mom drives the ferry. When I grow up I want to drive the ferry. The river is brown because of trees not because of dirt."
13. **Guard radio, encrypted tail (half-decoded on a scanner):** "—Line holds. Vessey is a write-off, repeat, write-off. Do not— ...the roster says eighteenth, why does it say eighteenth—"
14. **Note pinned to a Turned's coat:** "This is Danny Peltier. He was a good dog-sled racer and he owes me twenty bucks. Please do it quick. — his brother."
15. **Graffiti on the water tower, red spray paint, below "HOME OF THE PAPERMAKERS":** "IT'S IN THE WATER / IT'S IN THE DEER / IT'S IN US / RIVER FREEZES NOV 28 — GET ACROSS OR GET READY"

---

## References & URLs

**Art & pipeline**
- Borderlands "inked" style and cel shading: https://en.wikipedia.org/wiki/Cel_shading ; Cook & Becker, "Bucking the brown shooter trend": https://cookandbecker.com/en/article/212/bucking-the-brown-shooter-trend.html ; UE forum on edge-detection post-process: https://forums.unrealengine.com/t/post-process-shader-similar-to-borderlands-2-orcs-must-die-2-fortnite/34603
- Dead Cells 3D-to-2D pipeline: https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i- ; 80.lv case study: https://80.lv/articles/case-study-dead-cells-character-art-pipeline
- Mark of the Ninja: https://en.wikipedia.org/wiki/Mark_of_the_Ninja ; GDC 2013, "How We Created Mark of the Ninja Without (Totally) Losing Our Minds": https://gdcvault.com/play/1017964 ; Game Informer "Afterwords": https://gameinformer.com/b/features/archive/2012/10/15/afterwords-mark-of-the-ninja
- This War of Mine art interview (TechRaptor): https://techraptor.net/content/art-war-mine-interview-11-bit-studios ; 80.lv: https://80.lv/articles/this-war-of-mine-a-game-about-civilians-in-war ; Steam: https://store.steampowered.com/app/282070/
- Mignola shadow-as-form: https://mycomicscollection.com/en/blog/shadow-mignola-not-shadow-form/ ; Spotting blacks: https://bigtimeattic.blogspot.com/2007/02/tips-and-tricks-spotting-black-areas.html ; Horror inking: https://www.retrosupply.co/blogs/tutorials/how-to-ink-like-a-horror-comic-artist
- Parallax & atmospheric perspective: Slynyrd Pixelblog 23: https://www.slynyrd.com/blog/2019/11/12/pixelblog-23-parallax-scrolling ; Pixelblog 62: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds ; Return devlog: https://jesseeisenbart.itch.io/return-alpha/devlog/384936/return-devlog-02-creating-visual-depth-in-a-2d-pixel-world
- Also look at (from memory, not re-verified): Blasphemous https://store.steampowered.com/app/774361/ ; Darkwood https://store.steampowered.com/app/274520/ ; Katana Zero https://store.steampowered.com/app/460950/ ; Children of Morta https://store.steampowered.com/app/330020/ ; Telltale's The Walking Dead https://en.wikipedia.org/wiki/The_Walking_Dead_(video_game) ; XIII https://en.wikipedia.org/wiki/XIII_(2003_video_game) ; Sergio Toppi https://en.wikipedia.org/wiki/Sergio_Toppi ; Ashley Wood https://en.wikipedia.org/wiki/Ashley_Wood ; Moebius https://en.wikipedia.org/wiki/Jean_Giraud

**AI image generation**
- Google, "Introducing Gemini 2.5 Flash Image": https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/
- Gemini API image generation docs: https://ai.google.dev/gemini-api/docs/image-generation
- Google, "How to prompt Gemini 2.5 Flash Image": https://developers.googleblog.com/ja/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
- Generating consistent imagery with Gemini (TDS): https://towardsdatascience.com/generating-consistent-imagery-with-gemini/
- Max Woolf, Nano Banana prompts: https://minimaxir.com/2025/11/nano-banana-prompts/
- Chroma-key (magenta default, green for pink subjects) is from a third-party tool doc (nanogen skill). Verify on your own outputs: https://skillsmp.com/skills/zeveck-nanogen-build-nanogen-skill-md

**Lore & narrative**
- Environmental storytelling, Smith & Worch, "What Happened Here?" (GDC 2010): https://www.gamedeveloper.com/design/environmental-storytelling ; Fallout 4 modular level design (GDC 2016): https://gdcvault.com/play/1023202/-Fallout-4-s-Modular ; Haywire on Fallout vignettes: https://haywiremag.com/columns/opened-world-the-remains-of-the-day/
- World War Z and Terkel's oral-history form: https://www.avclub.com/max-brooks-world-war-z-an-oral-history-of-the-zombie-1798202083 ; https://www.supersummary.com/world-war-z/book-brief/
- The Road: https://en.wikipedia.org/wiki/The_Road ; Station Eleven: https://en.wikipedia.org/wiki/Station_Eleven ; Metro 2033: https://en.wikipedia.org/wiki/Metro_2033 ; S.T.A.L.K.E.R.: https://en.wikipedia.org/wiki/S.T.A.L.K.E.R.:_Shadow_of_Chernobyl ; Pathologic: https://en.wikipedia.org/wiki/Pathologic ; Disco Elysium: https://en.wikipedia.org/wiki/Disco_Elysium ; Kentucky Route Zero: https://en.wikipedia.org/wiki/Kentucky_Route_Zero ; The Last of Us: https://en.wikipedia.org/wiki/The_Last_of_Us
