# 13 — Character technique: getting from "cut painting" to rig-ready cutout art

Status: research + recommendation (no game code changed). Builds on [09-animation.md](09-animation.md)
(custom Canvas2D cutout rig, IK, ragdoll, crowd flipbook LOD) and [11-shooting-poses.md](11-shooting-poses.md)
(stances as data, shared hand library, far limbs = near limbs darkened).

## 1. Why the current art looks wrong (diagnosis)

The rig and the motion are fine; the **art was never designed to be posed**. One AI painting per
character ("rig pose": arms straight forward, wide stride) is cut into parts by nearest bone capsule
(`tools/segment.ts`). Every defect traces back to that:

| Symptom | Root cause | Fix category |
|---|---|---|
| Arms read wrong | The sleeve is painted *once*, straight, with folds, foreshortening and light that only make sense in that one pose. Rotating it to 110° elbow bend shows a straight tube with a hinge. | Art designed per bend range (swap drawings), or mesh bend |
| Seams at joints | The cut is a Voronoi split of a continuous painting; the "joint cap" is borrowed pixels, not drawn material. Ink outlines get cut through. | Parts drawn separately with round caps + outline above and below the overlap ([Spine guide](https://en.esotericsoftware.com/blog/How-to-cut-your-assets-for-animation)) |
| Far limbs look fake | Far arm/leg = near art darkened (`#14110f` @ 42%). Same sleeve patch, same thumb side, wrong silhouette. | Draw real far-side variants (other side of the garment, slightly narrower, back-lit) |
| Hands doubled | The painted hand stays attached to the forearm cut, and the library hand is drawn on top. | Forearm art that *ends at a cuff* (no hand painted), hands only from the kit |
| Feet tilt | The foot is a rigid child of the shin, cut at the source pose's ankle angle; the sole correction (`rig.ts` ~l.686) fights a foot that was never drawn flat. | Foot drawn flat, sole-on-ground, as its own part; planted foot locked to ground angle |

So the question is "how do we get *rig-ready* parts cheaply", not "which runtime". Everything below keeps
the existing rig (09 §1 explains why Spine/DragonBones/Rive were rejected) unless stated.

## 2. How professionals author cutout characters

**Spine / DragonBones / Moho practice** (Esoteric's own guide, [How to cut your assets](https://en.esotericsoftware.com/blog/How-to-cut-your-assets-for-animation), [Spine Tips #9](https://hr.esotericsoftware.com/blog/Cutting-your-assets-Spine-Tips-9)):
- Each moving part is drawn **separately, on its own layer**, and **complete** — including the parts that
  are normally covered (hair behind the head, chest behind the arm).
- Joints: leave "an area as close to a circle as possible where the joints overlap"; for outlined styles,
  draw the outline **both above and below** the overlap so rotation never cuts a line.
- Draw limbs **straight**, axis-aligned, in their most relaxed state (they bend both ways; meshes work
  better on straight art).
- Anything that is sometimes in front and sometimes behind the body gets **separate front/back layers**.
- Elbows/knees: either two pieces with a round cap (cheap, robust) or a **weighted mesh** with an extra
  bone at the joint and smoothed weights; linear-blend skinning loses volume near 180° ([Spine forum: rigging mesh joints](https://ja.esotericsoftware.com/forum/d/7673-best-practices-for-rigging-mesh-joints), [knee bend tips](https://ru.esotericsoftware.com/forum/d/14715-tips-for-making-a-knee-bend-convincingly), [Mesh weight workflows](https://esotericsoftware.com/blog/Mesh-weight-workflows)).
- **Swap drawings per angle**: Spine supports skin placeholders with one attachment per angle in a slot
  ("you'll need a slot for each angle you want to show" — [forum](https://ko.esotericsoftware.com/forum/d/1741-managing-hundreds-of-slotsattachments-on-one-skeleton)), and since 4.1 *sequence attachments* for
  frame-by-frame inside a skeleton ([Spine 4.1](https://ar.esotericsoftware.com/blog/Spine-4-1-released)). Hands, forearms and faces are the
  classic swap parts: 3–6 drawings cover the range, the bone does the rest.
- Costume variety via **skins**: the template skeleton has placeholders; each costume fills them
  ([Runtime skins](https://en.esotericsoftware.com/spine-runtime-skins), [mix and match](https://en.esotericsoftware.com/spine-unity-mix-and-match)). This is exactly the anti-explosion trick:
  parts × skins, not characters × poses.

**Flash-era games** (Last Stand series, SAS, Strike Force Heroes): limbs were library symbols whose
timelines held a handful of drawings (e.g. a hand open/closed/grip, an arm at a few angles); the
animator tweened the symbol and picked the frame. No public post-mortem documents Union City's rigs
(searched; [TCRF](https://tcrf.net/The_Last_Stand:_Union_City) and fan wikis have nothing on it), but Chris Condon describes
Union City as "a furious six months of photoshop" on a 2-person team, i.e. **painted bitmap parts
animated in Flash**, and **Dead Zone as real-time 3D** in Flash via Alternativa3D with "lower fidelity
assets" and "lots of tiny pixel painting" on small textures ([Dread Central interview](https://www.dreadcentral.com/interviews/484494/the-last-stand-creator-chris-condon-talks-about-killing-zombies-in-flash-for-over-a-decade/)).
So the two quality bars are literally (a) hand-painted cutout parts and (b) low-poly 3D with painted
textures. Visible gear on Union City characters implies layered clothing parts (inference, not
documented).

**Others worth stealing from:** Darkest Dungeon (Photoshop parts + Spine, heavy ink at joints;
[80.lv](https://80.lv/articles/red-hook-studios-talks-about-the-creation-of-darkest-dungeon/?amp=1)); Rayman Origins/UbiArt (hand-drawn
art, animator poses a skeleton and the system deforms the bitmap — [Wikipedia](https://en.wikipedia.org/wiki/UbiArt_Framework)); Dead Cells (3D models in 3ds Max
rendered to 2D by an in-house tool, no paint-over, armour added to an existing model in minutes —
[80.lv interview](https://80.lv/articles/interview-with-the-developers-of-dead-cells), [case study](https://80.lv/articles/case-study-dead-cells-character-art-pipeline)).

## 3. Options for this pipeline

Costs assume `google/gemini-3.1-flash-lite-image` at ~$0.034/image (measured in 09 §4). The non-lite
`gemini-3.1-flash-image` ("Nano Banana 2", accepts many reference images — [OpenRouter](https://openrouter.ai/models/google/gemini-3.1-flash-image-20260528)) is
token-priced and roughly 2–4× more per image; worth using for *kit* sheets that are generated once.

### A. Rig-ready part sheet per character ("paper doll done right")
Generate, with the existing rig pose as reference image, a **parts sheet laid out on a grid**: head
(+ back-of-hair piece), torso *without arms* (shoulder sockets painted, chest complete), pelvis, near
thigh/shin/foot, **far** thigh/shin/foot (inner side of the trouser, shadowed), near upper arm,
near forearm **ending at an open cuff (no hand)**, far upper arm and forearm (inside of the sleeve),
all straight, horizontal, each end a round cap with ink outline, wide magenta gutters. Cut by
**connected components** (each blob = one part; label by grid cell) instead of nearest-bone; pivots
from a cap-circle fit at each end, so joint placement becomes mostly automatic.
- 09 §4 tried a paper-doll sheet once: "surprisingly good for the survivor ... parts at inconsistent
  scales/angles". The fixes: per-cell layout with a **drawn template** (send a second reference image:
  a grey silhouette grid with the exact cell sizes/limb lengths of our skeleton, so the model fills
  cells instead of inventing scale), and normalise each part's length to the skeleton bone after the cut.
- The same idea, productised: Scenario "2D Animation Rigging Sheet" ([scenario.com](https://scenario.com/apps/2d-animation-rigging-sheet)), Layer.ai
  "Create Spine Components" ([layer.ai](https://layer.ai/tools/layer--create-spine-components)), and the open
  Genielabs `spine-animation-ai` (Gemini makes a "deconstructed sprite atlas", OpenCV connected components
  cut it, SIFT+RANSAC aligns each part back onto the reference to recover placement and draw order —
  [GitHub](https://github.com/GenielabsOpenSource/spine-animation-ai), PolyForm *Noncommercial*: borrow the idea, not the code).
- Fixes: seams, doubled hands, far limbs, feet. Does not fix "a straight sleeve bent 120°".
- Cost: 1–3 images/character ≈ $0.05–0.10; 31 characters ≈ **$3**. Effort: ~1–2 days (new cut mode in
  `segment.ts`, template image, length normalisation).

### B. Shared arm kit with angle-swap forearms (+ recolour)
Arms are the problem part and the most reused: survivors are visually distinguished by head, torso
and silhouette, not by sleeves. Make a **kit per sleeve archetype** (bare arm, t-shirt, rolled
flannel, jacket, hoodie, coat; Turned: torn sleeve, bare rotted arm) — each sheet holds:
upper arm (near + far), and the **forearm-with-elbow drawn at 4–5 bends** (0°, 40°, 80°, 115°, 145°),
each ending in a cuff. At runtime `rig.ts` picks the drawing whose bend is nearest the IK elbow angle
(and rotates it the last ±20°) — the Flash "symbol with frames per angle" / Spine angle-slot trick.
Folds bunch on the inside of the bend because they were *drawn* bent.
- **Recolour, don't regenerate:** generate the kit in neutral grey with flat value bands, store it as
  a luminance map, and tint per character with 2–3 colours sampled from the character's torso (the
  same mechanism already used for hand tints, `hands: {lib, tint}`). Keeps ink and shading identical.
- Hands stay the shared 4-sheet library (11 §6); forearms no longer contain a hand, so no doubling.
- Count: ~8 archetypes × 1 sheet (+1 retry) ≈ 16 images ≈ **$0.6** (lite) or ~$2 (flash). No per-
  character cost. Effort: ~1 day (swap selection by elbow angle, luminance tint, wrist anchor per drawing).
- Optional same trick for knees (2–3 shin drawings per bend) for crouch/kneel; skip until needed.

### C. Mesh deformation at elbows/knees
Weighted 2-bone meshes (Spine-style) would let a single straight sleeve bend smoothly. In Canvas2D,
textured triangles need one `clip()`+`setTransform` per triangle — too slow for 150 bodies; doing it
properly means a WebGL renderer for characters. High effort, and linear blend still pinches at the
inside of the elbow. **Not recommended**; B gets the same read with zero renderer change.

### D. AI layer decomposition of the existing painting
Models that split one illustration into complete, depth-ordered layers with occluded regions inpainted:
**See-through** (anime characters → 19 body-part layers as a PSD, SDXL-based, Apache-2.0 since Mar 2026;
[arXiv 2602.03749](https://arxiv.org/pdf/2602.03749), [CGWorld](https://cgworld.jp/flashnews/01-202604-See-through.html)) and
**Qwen-Image-Layered** (image → up to ~20 RGBA layers, CVPR 2026; [arXiv 2512.15603](https://arxiv.org/abs/2512.15603), [GitHub](https://github.com/QwenLM/Qwen-Image-Layered)).
Also Meta's Animated Drawings (auto-rig of a figure drawing; requires limbs not overlapping the body —
[Meta](https://developers.facebook.com/blog/post/2023/04/13/meta-os-animated-drawings/)).
- Pros: completes the hidden torso/far limbs properly. Cons: needs a GPU or a hosted endpoint, trained
  on anime front views (ours are side-view graphic-novel), and still yields parts painted in *one* pose,
  so the "arms read wrong" problem remains. **Useful as a cleanup step, not as the technique.**

### E. Pre-rendered 3D (image → 3D → auto-rig → toon render)
Image-to-3D (Meshy, Tripo, Hunyuan3D, TRELLIS 2; Meshy/Tripo include auto-rigging; [pricing roundup, verify on vendor pages](https://www.3daistudio.com/3d-generator-ai-comparison-alternatives-guide/ai-3d-generator-pricing-compared)),
or rig in Mixamo (free, commercial use OK, humanoid bipeds only; [Adobe FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)) or
UniRig (open, SIGGRAPH 2025; [GitHub](https://github.com/VAST-AI-Research/UniRig)). Render in Blender side view with a
toon shader + inverted-hull/Freestyle ink, via sprite-sheet add-ons ([Sprite Sheet Generator](https://extensions.blender.org/add-ons/sprite-sheet-generator/),
[mixamo-to-2d](https://awesome.ecosyste.ms/projects/github.com%2Falexferl%2Fmixamo-to-2d)). This is the Dead Cells route.
- Full-pose sprite sheets **are** the sprite explosion (survivors × stances × 26 guns × aim angles ×
  reload states) and throw away our IK. **Use 3D only as a part painter:** render each limb segment of a
  toon model, isolated, at the 5 bend angles of option B, front and far side — a perfectly consistent
  arm kit with correct foreshortening for free. Same rig, same atlas format.
- Look risk: AI-generated meshes have mushy textures; the ink/graphic-novel style must come from the
  shader and may not match the painted heads/torsos. Effort: 2–4 days to set up Blender scripting;
  ~$0–20 in 3D credits.
- **Real-time three.js** (orthographic, `MeshToonMaterial` + outline): solves posing, far limbs and IK
  natively — it is how Dead Zone did it. But it replaces the art style and the renderer, 150 skinned
  meshes + outline passes need instancing/baked animation, and the ragdoll/flipbook/lighting work in
  09 would be redone. **Highest effort; only if A+B fail.**

### F. Frame-by-frame strips from the image model
Gemini can draw short strips (4–8 frames) of one character; drift grows per frame, so generate the
whole strip in one call with the character as reference ([community notes](https://rosebud.ai/blog/how-to-create-a-sprite-sheet-with-ai-using-google-gemini-and-nano-banana-easy-guide),
[ComfyUI template](https://comfy.org/hub/workflows/single-image-to-animated-sprite-sheet-5cef286d4c51/)); pose-conditioned tools (PixelLab skeleton
animation, 3–15 frames from one reference — [docs](https://www.pixellab.ai/docs/tools/skeleton-animation)) are pixel-art only.
Fine for **weapon-less, one-off key actions**: Turned specials (Crier keen, Pulper burst, Ferryman
smash), authored deaths, a survivor portrait idle. Not for gun handling (pose × weapon explosion).
~$0.03–0.07 per strip; handful per archetype.

### G. Rig render → image-model paint-over (pose-conditioned key poses)
Render the current rig in a pose (it already composes the silhouette correctly), send it with the
character reference: "redraw this exact pose as a clean painting". The model fixes sleeves, seams and
hands *for that pose*. Good as an **authoring aid to produce option-B kit drawings** (paint-over the
5 bend angles once per archetype) or a few F-style key frames; as a runtime approach it is again one
image per pose per character. ~$0.03/pose.

## 4. Comparison

| Option | Fixes arms | Seams | Far limbs | Hands | Feet | Sprite growth | $ (31 chars) | Effort |
|---|---|---|---|---|---|---|---|---|
| A rig-ready part sheet | partly | yes | yes | yes | yes | 1–3 img/char | ~$3 | 1–2 d |
| B arm kit, angle swap + tint | **yes** | yes | yes | yes | – | ~16 images total | ~$1–2 | 1 d |
| C mesh deform (WebGL) | partly | yes | no | no | no | none | 0 | 1–2 wk |
| D layer decomposition | no | yes | partly | yes | no | 0 | GPU/host | 2–3 d |
| E 3D as part painter | yes | yes | yes | yes | yes | kits only | $0–20 | 2–4 d |
| E' real-time three.js | yes | yes | yes | yes | yes | none | $20+ | weeks |
| F image-model strips | n/a | n/a | n/a | n/a | n/a | per action | small | per clip |
| G paint-over of rig poses | yes (per pose) | yes | yes | yes | yes | per pose | small | authoring aid |

## 5. Recommendation (ranked by quality per effort)

1. **B — shared angle-swap arm kit, recoloured per character.** Biggest visible win (arms are on screen
   in every shooting pose), no per-character cost, kills doubled hands. Author the 5 bend drawings with
   the image model directly; if the bends come out inconsistent, author them via G (paint-over of our
   own rig renders) or E (3D part painter).
2. **A — rig-ready part sheet per character** (armless torso, cuff-less legs with flat feet, true far
   leg), cut by connected components into a grid template. Fixes seams/far limbs/feet; replaces the
   "rig pose" + nearest-bone cut for new characters. Keep the old path as fallback.
3. **Code-only fixes alongside:** planted foot drawn at ground angle (sole locked flat during stance,
   toe-roll only at lift-off); far-limb tint replaced by the real far parts from A/B; joint caps drawn
   *under* the parent with the outline ring kept.
4. **F for Turned specials/deaths only**, when the rest looks right.
5. **Hold:** D (cleanup aid only), C and real-time 3D (E') unless A+B fail the quality bar.

## 6. First experiment (~1 hour, < $1)

Goal: prove that an **angle-swap arm kit** + a **grid part sheet** look better in `animlab` than today.

1. Add a manifest `tools/sprites-parts-kit.json` (same format as the hands manifest; `ref: surv_rifle`,
   reuse its `style` and `key`). Two prompts:
   - `arm_jacket_kit`: "A rigging reference sheet of the SAME jacket sleeve from the reference, NO hands:
     every forearm ends in an open cuff showing the dark inside of the sleeve. Strict side view, upper arm
     always horizontal with the shoulder end on the LEFT drawn as a full round cap with ink outline.
     Row 1: the near arm (outer side of the sleeve, lit) bent at the elbow 0°, 40°, 80°, 115°, 145°
     (forearm rotating upward), fabric folds bunching on the inside of the bend. Row 2: the same five,
     drawn as the character's other arm seen from the inner side, slightly narrower, in shadow. All ten
     at identical scale, wide magenta gaps, nothing touching."
   - `surv_rifle_dollsheet`: "Paper-doll rigging parts of the character in the reference, each part
     straight and horizontal, ends are round caps with the ink outline drawn all round, laid out in a
     3×4 grid with wide gaps: head; torso with NO arms (shoulder sockets painted, complete chest);
     pelvis; near thigh; near shin; near boot flat on its sole; far thigh; far shin; far boot (inner side,
     shadowed); nothing else, no hands."
2. Run 3× each on flash-lite and 1× each on `google/gemini-3.1-flash-image` via `SPRITE_MODEL=…`:
   8 images ≈ $0.27 + ~$0.25 ≈ **$0.5**.
3. Cut with a 30-line connected-components script (sharp + flood fill on the keyed PNG, emit each blob's
   bbox); fit cap circles at each blob's ends for pivots. Hand-place pivots if the script is late — the
   goal is the visual check.
4. Hack a lab-only atlas: replace `surv_rifle`'s `upperArm/forearm` with the kit, choose the forearm
   drawing by nearest elbow angle (one `if` ladder in the part draw), tint grey→jacket colour if the kit
   came out grey. Screenshot `animlab.html?closeup&still&h=150&w=service9,ar15,pump,smg,lmg` before/after
   (`node tools/e2e/shots.cjs` flow).

**Pass criteria:** ≥1 of the kit runs has all 10 arms at one scale with cuffs (no hands) and visibly
bent folds; at 115–145° the arm reads as a bent sleeve, not a hinge; no seam visible at the elbow at
150 px; far arm is distinguishable from the near arm without the dark tint. If the image model fails
consistency, the next 1-hour test is G: render the rig's arm at the 5 angles and ask the model to
paint over it.

## Sources
- Esoteric Software: [How to cut your assets for animation](https://en.esotericsoftware.com/blog/How-to-cut-your-assets-for-animation), [Spine Tips #9](https://hr.esotericsoftware.com/blog/Cutting-your-assets-Spine-Tips-9), [Mesh weight workflows](https://esotericsoftware.com/blog/Mesh-weight-workflows), [Spine 4.1 sequences](https://ar.esotericsoftware.com/blog/Spine-4-1-released), [Runtime skins](https://en.esotericsoftware.com/spine-runtime-skins), [mix and match](https://en.esotericsoftware.com/spine-unity-mix-and-match), forum: [mesh joints](https://ja.esotericsoftware.com/forum/d/7673-best-practices-for-rigging-mesh-joints), [knee bend](https://ru.esotericsoftware.com/forum/d/14715-tips-for-making-a-knee-bend-convincingly), [slots per angle](https://ko.esotericsoftware.com/forum/d/1741-managing-hundreds-of-slotsattachments-on-one-skeleton)
- Last Stand: [Dread Central interview with Chris Condon](https://www.dreadcentral.com/interviews/484494/the-last-stand-creator-chris-condon-talks-about-killing-zombies-in-flash-for-over-a-decade/)
- Dead Cells: [80.lv interview](https://80.lv/articles/interview-with-the-developers-of-dead-cells), [80.lv case study](https://80.lv/articles/case-study-dead-cells-character-art-pipeline); Darkest Dungeon: [80.lv](https://80.lv/articles/red-hook-studios-talks-about-the-creation-of-darkest-dungeon/?amp=1); [UbiArt](https://en.wikipedia.org/wiki/UbiArt_Framework)
- AI parts / layers: [Scenario rigging sheet](https://scenario.com/apps/2d-animation-rigging-sheet), [Layer.ai Spine components](https://layer.ai/tools/layer--create-spine-components), [Genielabs spine-animation-ai](https://github.com/GenielabsOpenSource/spine-animation-ai), [See-through](https://arxiv.org/pdf/2602.03749), [Qwen-Image-Layered](https://arxiv.org/abs/2512.15603), [Meta Animated Drawings](https://developers.facebook.com/blog/post/2023/04/13/meta-os-animated-drawings/)
- Sprite strips: [Rosebud guide](https://rosebud.ai/blog/how-to-create-a-sprite-sheet-with-ai-using-google-gemini-and-nano-banana-easy-guide), [ComfyUI template](https://comfy.org/hub/workflows/single-image-to-animated-sprite-sheet-5cef286d4c51/), [PixelLab skeleton animation](https://www.pixellab.ai/docs/tools/skeleton-animation)
- 3D: [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html), [UniRig](https://github.com/VAST-AI-Research/UniRig), [AI 3D pricing roundup](https://www.3daistudio.com/3d-generator-ai-comparison-alternatives-guide/ai-3d-generator-pricing-compared), [Blender Sprite Sheet Generator](https://extensions.blender.org/add-ons/sprite-sheet-generator/), [mixamo-to-2d](https://awesome.ecosyste.ms/projects/github.com%2Falexferl%2Fmixamo-to-2d), [three.js OutlineEffect](https://threejs.org/docs/pages/OutlineEffect.html)
- Model: [OpenRouter gemini-3.1-flash-image](https://openrouter.ai/models/google/gemini-3.1-flash-image-20260528)
