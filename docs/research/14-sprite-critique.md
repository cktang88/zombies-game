# Character art and animation critique: zombies-game vs. The Last Stand

All paths below are in `/tmp/claude-0/-home-user/8bd06cb1-c6ac-5391-b55a-fe2040c590af/scratchpad/critique/`.
Captures: animlab close-ups at h=900 (`cu_*.png`, still frames `pist_still.png`, `cu_mmid_aim.png`, `rl_*.png`, `dbg_rifle.png`),
gallery (`gallery.png`), crowd lineup (`crowd.png`), night 6 in game at 1280x720 with DPR 2 (`night*_screen.png`,
`nz*_screen.png`; zombies were spawned through `__battle.spawn`), the parts atlas (`atlas_surv_rifle.png`,
`atlas_z_shambler.png`) and a six-frame walk strip (`strip_walk_rifle.png`).

## The one-paragraph diagnosis

Every character is one AI painting of a person walking with an arm held out. A nearest-bone segmenter cuts it into
**exactly one** thigh, shin, foot, upper arm, forearm, torso and head (`crop_09_atlas_one_limb_set.png`). Everything the
rig shows that the painting did not contain is invented at draw time:
- the far arm and far leg are the near ones, tinted dark;
- bent elbows are two straight sleeve tubes overlapping;
- a longer arm is the same tube scaled along its bone (`uaK/faK`, skeleton.ts:101);
- hands come from a shared library painted in another style;
- guns are separate, much sharper renders;
- hems and sleeve ends are cut off with rectangle clips (rig.ts ~1050).

The result reads as a paper doll made from a photo cut-out. The Last Stand games, and every 2D game that rigs well,
work the other way round: **the art is drawn for the rig**. Each part has a closed, round-ended shape inside its own
outline, both sides of the body exist, and any pose a rotation can't reach (aiming arms, reload hands, the gun) is a
drawn swap piece, not a bend of the walking arm.

At gameplay scale the survivors are passable (`critique/crop_11_night_survivor_pile.jpg`). In close-up they fall apart, and at
night the zombies, the thing the player is meant to look at, barely read.

---

## Ranked faults

### 1. The Turned are unreadable at night: dark on dark, under the HUD, merged into one mass
Crops: `critique/crop_10_night_zombie_soup.jpg`, `nz2_screen.png`
- At night the zombies are near-black figures with a dark outline, set against a dark blue-grey road and a burnt-out
  car. Up close they are a brown-olive smear, and the ammo/weapon HUD sits right on top of the spawn edge.
- The survivors, who matter least to the player's eye, are the warmest and brightest things on screen. The value
  hierarchy is upside down.
- **Reference:** Last Stand 2 and Union City keep zombies a light-to-mid grey-green with dark outlines against a
  darker, desaturated ground, and blood is saturated red. Each target is a light shape with a dark border on a dark
  field, so you can count them and pick the head. Dead Ahead does the same with flat bright cartoon fills.
- **Fix:**
  - Make the night grade apply less to actors than to the background (at least +25% value) and add a cool rim light
    from the barricade lamps on the side facing the player (the `rim` band already exists, so drive it per light).
  - Give each Turned a ground contact shadow and draw the HUD clear of the bottom-right spawn lane.
  - Test rule: at 50% zoom in greyscale you must be able to count the zombies.

### 2. One painted pose, one limb set: the far limbs are tinted clones and nothing can turn or foreshorten
Crops: `crop_09_atlas_one_limb_set.png`, `crop_07_rifle_identical_legs.png`, `crop_06_smg_sleeve_block_farstump.png`
- The atlas holds one thigh, one shin, one foot, one upper arm and one forearm. The far leg is the near leg drawn
  darker (rig.ts:893), so in every stride you see two copies of the same trouser leg, same creases and same patch.
- The far arm is a flat grey copy of the near sleeve that sticks out from behind the chest (the grey slab under the
  SMG and under Pauline's rifle).
- Nothing was ever drawn at a different angle, so a forearm pointing at the camera, a hand turned palm-up, or a
  shoulder rolling forward simply can't be shown.
- **Reference:** cutout rigs that look good (Darkest Dungeon in Spine, Flash-era symbol rigs) are drawn as a layered
  file. Near and far limbs are separate drawings with their own value and colour (the far side is cooler and simpler,
  not just darker), and there are swap images for the angles a rotation can't produce.
- **Fix:**
  - Stop deriving parts from a walking illustration. Generate or paint a **part sheet** per character: near and far
    arm in 2–3 states (straight, bent 90°, foreshortened toward the camera), near and far leg, two hands per side,
    torso without arms, and head.
  - Each part should be on its own with its full silhouette, including the part hidden under the overlap.
  - Have `segment.ts` read named layers or regions from that sheet instead of assigning pixels to the nearest bone.

### 3. Arms are straight sleeve tubes, stretched to length, growing out of mid-chest
Crops: `critique/crop_03_pistol_noodle_arms.jpg`, `crop_04_mmid_tube_arms_apron_cut.png`, `crop_01_rifle_stock_face_farstump.png`
- With a pistol held out, the arms are about 1.3x natural length. The texture is visibly stretched along the bone,
  there is no elbow mass and no wrist taper, and both arms are identical.
- The arm attaches inside the torso art, which still carries the painted shoulder and sleeve, so the arm reads as a
  second shoulder bolted onto the chest (Darnell's sleeve starts at the apron bib, the rifleman's at his lapel).
- **Reference:** Flash-era shooters (LS2/UC, Strike Force Heroes, Boxhead) draw the aiming arm, hand and gun as
  **one piece per weapon class** and rotate it at the shoulder. The elbow bend, the grip and the cheek weld are
  drawn once, correctly, and never solved. Where arms are rigged (Spine), the elbow gets a round cap drawn into both
  segments, and segment length never changes. Proportions are kept by IK, not by scaling the art.
- **Fix:**
  - Remove `uaK/faK` stretching. Solve to the art's real lengths and move the gun or hand instead.
  - Cut the painted shoulder and sleeve out of the torso (force-assign it to `none` and paint the hole over), and
    give the upper arm a full round shoulder cap.
  - Better still, replace rigged arms in firearm stances with per-weapon-class "arms+gun" drawings (pistol
    two-hand, rifle shouldered, SMG, shotgun pump-forward, plus a low-ready and a reload variant) that rotate as a
    unit about the shoulder.

### 4. Hands are a different art style, the wrong skin or glove, and float free during reloads
Crops: `crop_02_fold_libhand_farslab.png`, `critique/crop_15_reload.jpg`
- The rifleman is painted wearing gloves, but his gun hands are bare, pale, clean library hands
  (`hand_grip`/`hand_support` in the atlas). They have no grime, a different light direction and no ink line, so
  they look pasted on.
- In the reload, Ingrid's support hand floats beside the shotgun with no arm visibly attached. The rifleman's free
  hand pokes out of his coat at the belt while the magazine hangs in mid-air a hand's width away.
- **Reference:** in every reference the hands belong to the character's drawing: same line, same palette, gloves
  if the character wears gloves. In LS/UC the hands are part of the arms+gun piece, so they can never come loose.
  Reload animations show the magazine attached to the hand.
- **Fix:**
  - Generate hands per character from the same painting session, matching gloves or skin, and run them through the
    same ink pass.
  - Parent the magazine to the hand bone for the whole carry.
  - Block reload keyframes where the forearm visibly connects (pose check: no hand further than one forearm length
    from its elbow joint).

### 5. Long guns are not shouldered: the stock sits in front of the face and the rifle hovers
Crops: `crop_01_rifle_stock_face_farstump.png`, `cu_fold_aim.png`
- The AR-15 butt hangs in front of the nose and mouth, above the shoulder pocket, with the shoulder art far behind
  it. Pauline's scoped rifle has the same problem, and the pump gun in reload rides at hip height with nothing
  holding it.
- It reads as someone holding a gun up to look at it, not someone firing it.
- **Reference:** a real side-view firing pose puts the butt in the pocket inside the shoulder, the cheek on the comb,
  the head tilted down to the sights, the trigger elbow up and out, and the support elbow under the fore-end.
  Last Stand's player sprite and Dead Ahead's shooters all show this one silhouette. It is the most recognisable
  shape in the genre.
- **Fix:**
  - Anchor the gun by its stock pocket at a shoulder point placed on the front edge of the torso art. Rotate the
    gun about that point, not about a hand.
  - Bring the head to the gun (head tilt and forward neck), not the gun to the head.
  - Add a pose test that fails if the stock butt is more than about 0.1 head-heights from the shoulder anchor.

### 6. Firing stances are walking poses with the torso upright or leaning back
Crops: `crop_14_fold_upright_no_lean.png`, `cu_rifle_aim.png`, `cu_mmid_aim.png`
- Every "aim" still keeps the source painting's walking stride: back heel planted, front foot forward, weight
  centred or behind, spine vertical. Pauline actually leans back from her rifle, and Darnell stands straight like a
  shop-window dummy pointing.
- Nobody braces against recoil.
- **Reference:** shooters in LS/UC and in Broforce lean the torso about 10–15° into the gun, bend the front knee,
  straighten the back leg and widen the stance. This "aggressive forward" silhouette is what makes the defenders
  look capable.
- **Fix:**
  - Add a stance layer per weapon class: hip forward, spine pitch 8–15° toward the target, front knee 15–25°,
    feet set wider than the walking stride and toes turned out.
  - Paint the source pose as an aiming stance rather than a walk, if a single source pose survives at all.

### 7. Three art styles in one figure: soft painted body, crisp vector-sharp guns, clean library hands
Crops: `crop_01_rifle_stock_face_farstump.png`, `crop_06_smg_sleeve_block_farstump.png`
- The guns are much sharper and higher-contrast than the bodies, with their own lighting and no matching ink.
  The bodies are soft, upscaled paintings. The hands are a third look.
- At close-up and at game scale the weapon is the sharpest object on the character, so the eye goes to the gun
  instead of the person.
- **Reference:** in a coherent sprite set the line weight, light direction and texture frequency match across body,
  hands and gear. LS guns are drawn with the same outline and flat shading as the bodies.
- **Fix:**
  - Run guns, hands and body parts through one stylisation pass: same downsample-then-upsample softness, the same
    posterise or palette clamp, and the same ink outline width.
  - Or render everything at one target resolution, so nothing is sharper than the body.

### 8. Rectangle clips and nearest-bone cuts leave square ends, seams and stray shards
Crops: `crop_05_mbig_apron_cut_shard.png`, `crop_04_mmid_tube_arms_apron_cut.png`, `crop_08_pistol_knee_seam.png`,
`crop_gallery_z1.png` (church's skirt)
- Aprons and coat skirts end in dead-straight horizontal edges with square corners (Tinker's and Darnell's aprons,
  the church Turned's skirt).
- A dark coat-tail shard sticks out at Tinker's knee.
- The pistol survivor shows a lighter rectangular patch at the knee where the thigh and shin capsules meet.
- Sleeve ends are cut flat by the `rect` clip, which is what produces the square sleeve block on the SMG arm.
- **Reference:** cutout parts are drawn with closed, rounded silhouettes. A long coat or apron is a separate
  "skirt" part with its own bones, or is drawn into the torso so the leg is never seen through it.
- **Fix:**
  - Replace the rectangle clips with per-part hand-authored (or generated) alpha masks that end in a round cap.
  - Give coats, aprons and skirts a skirt bone pair driven by the thighs, as cloth attachments.
  - Run a lint in `segment.ts` that flags any part edge that is a straight line longer than 6 px at the part
    boundary.

### 9. Outline treatment: a thin brown halo, not ink
Crops: `critique/crop_11_night_survivor_pile.jpg`, `cu_pistol_aim.png` (the maroon fringe round the legs)
- The stamped silhouette outline is a thin warm brown or maroon line with a soft offset "rim" band. It reads as a
  sticker border, and it is the same weight as the painting's interior lines, so silhouettes don't separate from
  each other when bodies overlap (the five survivors at the barricade merge into one mass).
- **Reference:** Last Stand and Union City use a uniform heavy black outline round every symbol (about 1.5–2 px at
  native size) with flat or two-tone fills. Silhouettes hold up at 60 px tall and overlapping figures stay
  separate. Dead Ahead uses the same rule.
- **Fix:**
  - Use a near-black outline, 2–3 display px at the target scale, on the full silhouette **and** on every
    occluding near limb.
  - Reduce the painting's interior linework so the outer line dominates.
  - Drop the warm rim halo, or tint it toward the scene's light.

### 10. Resolution and texture frequency are wrong for the gameplay scale
Crops: `cu_fold_aim.png` (blur), `crop_gallery_z2.png`, `crop_gallery_z3.png`
- Rigs are cut to a 240 px character height (atlas 512x~130), so they are upscaled even in game at 1440p, and the
  close-ups are mush.
- Meanwhile the paintings carry high-frequency detail (quilting, patches, grime, stubble) that turns into noise at
  the 150–300 px on-screen size, while the large shapes that read at that size (a clear head, a hand, a lit gun
  side, light against dark clothing) are weak.
- **Reference:** LS characters are low-detail, high-shape art: big flat masses, a few shadow shapes, strong
  separation of head, hands and weapon. Darkest Dungeon is detailed but designed around big black shadow masses
  and a dominant silhouette.
- **Fix:**
  - Cut at 2x the largest on-screen size (about 600 px tall) and mip down.
  - Before cutting, simplify the paintings: posterise to 4–6 values per material, push clothing darker and skin and
    gun highlights lighter, and paint out texture smaller than about 1/40 of the body height.

### 11. Walk cycle: the upper body is a rigid block and nothing overlaps or follows through
Crop: `crop_16_walk_rigid_torso.png`
- Across six frames the torso, head, rifle and both arms move as one locked unit while only the legs scissor. The
  knee of the bent leg bulges where two capsules overlap (frame 1).
- There is no shoulder counter-rotation, head bob, gun sway, coat-tail lag or bounce of the gear.
- **Reference:** even 8-frame Flash walks have a 2-frame-offset gun bob, a counter-swing of the shoulder line, and
  hair or coat lag.
- **Fix:**
  - Add a phase-offset spring for the head and gun (lag 2–3 frames behind the pelvis), shoulder counter-rotation of
    ±4° and pelvis drop on the passing pose.
  - Give cloth bones (from #8) a damped follow.
  - Fix the knee by drawing a knee cap into the shin art.

### 12. The Turned are all one realistic, olive-grey body type in different shirts
Crops: `crop_gallery_z1.png`, `crop_gallery_z2.png`, `crop_gallery_z3.png`, `gallery.png`
- Shambler, mill, hunter, manor, church, runner, spitter and leaper share the same proportions, the same
  forward-leaning arms-out pose and the same desaturated palette. Type is carried by a shirt colour or a hat.
- At night, where colour dies (#1), nearly every type is the same shape. Only the bloater, brute and bellwether
  differ in silhouette.
- **Reference:** Last Stand and Dead Ahead push silhouette per type: hunched crawler, tall thin runner, wide fat
  one, armoured one with a distinct head shape. Each type is readable as a black fill.
- **Fix:**
  - Set a silhouette spec per type before painting (posture angle, width-to-height ratio, arm pose, head shape).
  - Check that every type is distinguishable as a flat black shape at 80 px tall.
  - Vary posture per type in the gait (runner pitched 30° forward, shambler sagging to one side, crier with head
    thrown back).

### 13. Crowds are clones marching in step
Crop: `crop_12_crowd_clones.png`
- The lineup shows identical copies at identical scale, in the identical frame and pose. In the night captures the
  same shirt repeats side by side.
- **Reference:** the classic answer is per-instance variation: scale ±8%, a hue shift on the clothing, a phase
  offset on the walk, a random head or arm swap and mirrored damage decals.
- **Fix:**
  - Add per-spawn random scale (0.92–1.08), clothing hue jitter on a mask channel, a walk phase offset, and 2–3 head
    and arm swap variants per type.

### 14. The barricade composition is a pile of people, not a defended position
Crop: `critique/crop_11_night_survivor_pile.jpg`
- Five survivors stand overlapped in the same stride in front of (not behind) the barricade and tower legs. Ingrid
  stands in front of the scaffold, and Tinker holds an SMG next to an unmanned tripod machine gun.
- There's no depth staggering and no cover, and every gun is level at the same height.
- **Reference:** LS2 and UC place the shooter behind the barricade with only the torso and gun above it, and the
  defenders are spread out so each silhouette has its own space.
- **Fix:**
  - Put the defenders behind the barricade (draw its front layer over their legs), spaced at least 0.6 body widths
    apart, with alternating depth (scale 0.94/1.0, value -10% for the back row).
  - Put the MG gunner's hands on the MG.

### 15. Low-ready and reload poses are not believable gun handling
Crops: `crop_13_mbig_low_ready.png`, `cu_myoung_walk.png`, `critique/crop_15_reload.jpg`
- Tinker's "low" holds the MP5 tilted up at 45° with the stock pointing at the sky and both forearms stacked like
  bars.
- The lever-gun walk pose has the rifle angled down across the thigh with a hand pinching the barrel.
- In the reloads the gun hovers unsupported, magazines drift and hands detach (#4).
- **Reference:** low ready means the muzzle down about 30–45°, the stock still in or under the shoulder, and both
  hands on the gun. Reloads in LS-era games are a few drawn keys (tilt the gun, mag out, mag in, slap) where the gun
  stays held.
- **Fix:**
  - Author low-ready and reload as keyed poses per weapon class. Better still, make them drawn arms+gun frames
    (#3) and keep the procedural layer only for aim angle and recoil.

---

## Verdict: can cutout-from-a-painting ever look good?

**No, not the way it is done here: one finished illustration, sliced by nearest bone, with the missing information
synthesised by tinting, stretching and clipping.** A single painted pose has no far limbs, no bent elbows, no hidden
overlap regions and no alternative hand or gun states. Every pose away from that painting exposes the gap, and the
recent commit history (far arm hidden behind the torso, forearm art cut at the wrist, sleeve block removed) shows
the team fighting symptoms one by one. The ceiling is "passable at 150 px in daylight", and the game already sits
just under it.

**What would work, in order of fit for an AI-art pipeline:**

1. **Hybrid, the Last Stand approach (recommended).**
   - Body: a drawn lower body or legs with a short frame-by-frame walk (6–8 frames, generated as a consistent
     sheet, cleaned by hand) and a few stance frames.
   - Torso and head: one rotatable piece.
   - Arms: **drawn "arms + hands + gun" units per weapon class**, plus a separate low-ready unit and 3–4 reload key
     units. Each unit rotates about the shoulder for aim, with a small recoil kick.
   - This is how Flash-era side-view shooters looked solid with very little animation: the parts that must look
     right (the grip and the shouldered stock) are drawn, never solved.
2. **Design-for-rig cutouts (Spine or Darkest Dungeon style).**
   - Keep rigging, but replace the source: a layered part sheet per character, with near and far limbs drawn
     separately, round joint caps drawn into both segments, full hidden overlaps, 2–3 swap images per forearm and
     hand, cloth as separate skirt parts, and one consistent bold outline.
   - AI can produce such sheets only with strict templates and manual cleanup; treat each part as its own
     generation with its own mask.
3. **Full frame-by-frame** (Broforce, Mark of the Ninja).
   - This looks best, but it is the most expensive, and the AI consistency across frames is the hard part.
   - Use it only for the few hero survivors, if at all.

Whatever the approach, the first fix that pays off on its own is #1, the night value hierarchy and readable
zombies. It needs no new art.

## Sources consulted
- Chris Condon interview (Dread Central): Union City was built side-scrolling in Flash and Dead Zone used
  Alternativa's 3D Flash engine, so its characters are 3D models, not 2D rigs:
  https://www.dreadcentral.com/interviews/484494/the-last-stand-creator-chris-condon-talks-about-killing-zombies-in-flash-for-over-a-decade/
- Darkest Dungeon pipeline, painted in Photoshop and animated in Spine from per-part PNGs (Game Developer, "Road to
  the IGF: Red Hook Studios"): https://www.gamedeveloper.com/audio/road-to-the-igf-red-hook-studios-i-darkest-dungeon-i-
  and the DD Workshop modding notes: https://steamcommunity.com/groups/dd-workshop/discussions/0/135511757698227150
- Part-swapping frame-by-frame inside a cutout rig (Blightbound toolchain):
  https://www.gamedeveloper.com/programming/finding-a-suitable-toolchain-for-animating-blightbound-s-2d-characters
- The descriptions of the LS2 and Union City look (bold black outlines, flat fills, light zombies on dark ground,
  shooter behind the barricade) come from memory of the games. No sprite rip was found online, so verify them
  against gameplay footage before quoting them as fact.
