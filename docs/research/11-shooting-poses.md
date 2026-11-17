# 11 — Shooting poses, depth layering and reusable arm/hand art

Status: implemented in `src/anim/stances.ts` (data), `src/anim/rig.ts` (aim layer, cheek weld, layer
drawing), the shared hand library `tools/rigs/src/hands_*.png` (cut by `tools/segment.ts`), and checked
in the anim lab (`animlab.html?closeup&w=service9,ar15,pump,smg,lmg`, `&act=low|walk|fire|reload|tactical`,
`&at=0..1`, `&only=<ids>`, `&debug`). Follows [09-animation.md](09-animation.md).

## 1. What was wrong

Player feedback: "sprite segmentation and posing is so bad for the humans". Looking at the close-ups and
`night.jpg` side by side with photos of people shooting:

| Problem | Cause |
|---|---|
| The support hand was on the near side reaching over the gun; the trigger hand sat on the far side | The rig drew the character's **left** side (`09` §2 said "the viewer sees the character's left side"). A right-facing body seen by our camera shows its **right** side, so a right-handed shooter's trigger arm is the near one. |
| Legs pinched together, knees bent the same way | No stance: the idle foot spread was ±6 rig units, near foot forward. |
| Upright torso, head upright and level | Aim layer leaned 0.2·aim and turned the head by the aim only. |
| Stock floating near the armpit, face behind the gun or the hand | Butt pocket placed 5 units above the shoulder *joint*; no cheek weld. |
| Odd fist-like hands, mismatched per survivor; raiders had no hand poses | 13 per-survivor hand sheets of varying quality; raiders reused the open riga hand. |
| Bolt worked by the support hand | Clip roles. |

## 2. Real-world reference (side profile, right-handed shooter)

Downloaded for study only (public domain US government photos, Wikimedia Commons; **not** in the repo):
- Shotgun, cheek weld, seen from the right — [Image 2 of 11](https://commons.wikimedia.org/wiki/File:200617-M-BH464-1479_-_SRT_Marines_qualify_on_multiple_weapons_(Image_2_of_11).jpg)
- Rifle while moving, aiming / low-ish ready — [Image 8 of 11](https://commons.wikimedia.org/wiki/File:200617-M-BH464-1240_-_SRT_Marines_qualify_on_multiple_weapons_(Image_8_of_11).jpg), [Image 6 of 11](https://commons.wikimedia.org/wiki/File:200617-M-BH464-1286_-_SRT_Marines_qualify_on_multiple_weapons_(Image_6_of_11).jpg)
- Pistol, two hands, arms extended — [Image 4 of 11](https://commons.wikimedia.org/wiki/File:200617-M-BH464-1413_-_SRT_Marines_qualify_on_multiple_weapons_(Image_4_of_11).jpg), [Image 3 of 11](https://commons.wikimedia.org/wiki/File:200617-M-BH464-1449_-_SRT_Marines_qualify_on_multiple_weapons_(Image_3_of_11).jpg)
- Shotgun reload, gun at the hip, shell at the port — [Image 1 of 11](https://commons.wikimedia.org/wiki/File:200617-M-BH464-1493_-_SRT_Marines_qualify_on_multiple_weapons_(Image_1_of_11).jpg)
- M16 from behind-right (support arm under the handguard, trigger elbow down) — [On the line (Image 7 of 7)](https://commons.wikimedia.org/wiki/File:200313-M-MH051-1320_-_On_the_line_(Image_7_of_7).jpg); kneeling M249 — [USMC-120505-M-RO295-006](https://commons.wikimedia.org/wiki/File:USMC-120505-M-RO295-006.jpg)

Stance texts:
- Rifle standing: feet about shoulder width, both toes toward the target, strong-side foot a few inches
  (≈15 cm) behind the weak one; lean into the rifle ([Iowa Sportsman, 5 fundamentals](https://iowasportsman.com/?p=2952871),
  [Art of Manliness, how to shoot a rifle](https://www.artofmanliness.com/skills/tactical/how-to-shoot-a-rifle/)).
  Bladed vs squared is a trade-off: bladed = precision, squared/"athletic" = recoil and tracking.
- Cheek weld: the same spot on the stock every shot; eye relief comes from the weld; the stock length is
  set so the head sits naturally ([Army study guide, 4 fundamentals](https://armystudyguide.com/content/army_board_study_guide_topics/m16a2/four-fundamentals-of-mark.shtml),
  [NRA Women, head position](https://nrawomen.com/content/fixing-fundamentals-head-position-for-any-firearm-platform)).
  Supported standing: support elbow on/above the hip ([Let's Go Shooting](https://www.letsgoshooting.org/2020/10/08/seven-tips-to-perfecting-the-rifle-standing-position/)).
- Pistol: isosceles = both arms extended, elbows straight or very slightly bent, feet shoulder width,
  knees over toes, shoulders over knees, head erect, gun brought up to the eye; Weaver = support foot
  forward, both elbows bent, support elbow down ~45°, push-pull; Chapman = straight strong arm, bent support
  ([Gun Digest, evaluating shooting stances](https://gundigest.com/more/how-to/firearm-training/shooting-stances),
  [Outdoor Empire, 7 pistol stances](https://outdoorempire.com/?p=11530)).

What the photos add (the things a side view must show):
1. From the right side the trigger hand and forearm are **in front of** the gun; the elbow points down and
   a little out, the upper arm drops ~40–60° below horizontal from the shoulder.
2. The support forearm runs **under** the gun (in front of the chest, behind the gun); the support hand
   wraps the fore-end and its fingers show **in front of** the fore-end; the upper arm is hidden by the torso.
3. The stock covers the jaw; the face is above it, the head turned down ~0.3–0.4 rad; the trigger hand sits
   under and just in front of the chin. The bore is at about collar height, not above the shoulder.
4. The torso leans forward 10–20° (nose over toes); the shotgun shooter leans most.
5. Pistol: the strong arm reaches out at eye level, the support arm is almost entirely behind it; only the
   support fingers show under the trigger guard.
6. Moving: shorter stride, knees bent, the muzzle dips (low ready) unless engaging.
7. Shotgun reload: gun lowered and canted at the hip, port up, shell hand under the receiver.

## 3. How 2D side-view games do it

- **Metal Slug** (SNK): one-handed pistol arm on the near side; the heavy machine gun is held at the hip
  with both arms in front of the body, far arm hidden; upper and lower body are separate animations so the
  legs run while the torso shoots ([wiki](https://metalslug.fandom.com/wiki/Heavy_Machine_Gun), sprite rips on
  [The Spriters Resource](https://www.spriters-resource.com/neo_geo_ngcd/ms)).
- **Side-view run'n'gun pixel art** (Slynyrd, [Pixelblog 60](https://www.slynyrd.com/blog/2026/1/26/side-view-run-n-gun)):
  legs separate from the upper body; the gun cycles reuse the walk/run with the arms removed and redrawn
  holding the gun; the long gun is carried muzzle-down ("downward from her centre") when not shooting.
- **Broforce / Soldat / Superfighters Deluxe**: limbs and gun as separate sprites rotated toward the aim;
  the gun arm is drawn over the body, the off arm behind (general approach also described in
  [html5gamedevs: arm rotating to the mouse](https://www.html5gamedevs.com/topic/21626-making-the-arms-of-a-sprite-rotate-towards-your-mouse-position/),
  [GDevelop: composite player](https://forum.gdevelop.io/t/whats-the-best-way-to-create-a-composite-player-player-made-of-multiple-sprites/71848)).
- **Darkest Dungeon** (Spine cutout): every part on its own layer, draw order = slot order; generous round
  overlaps at joints ([Spine: how to cut your assets](https://en.esotericsoftware.com/blog/How-to-cut-your-assets-for-animation)).
  Draw order can need to change per pose — we make it per stance data.
- **Layer order vs facing**: a flipped sprite can't swap which arm is in front; games either keep separate
  art per facing or accept the mirrored (left-handed) look ([UE forum](https://forums.unrealengine.com/t/sprite-layering-issue-from-camera/1379531)).
  We mirror: a left-facing raider reads as a left-hander, which nobody notices in a crowd.
- **Rain World / Overgrowth**: procedural IK and few keys (already in `09`).

## 4. Pose spec (as implemented, `src/anim/stances.ts`)

Rig units: 240 = body height (≈133 per metre); L = leg length (~104); angles in radians, aim angle a > 0 = down.

| Stance (weapons) | Feet near / far (×L from pelvis) | Pelvis height (×L) | Lean (+share of a) | Head | Gun placement | Low ready |
|---|---|---|---|---|---|---|
| `rifle` (AR, carbine, rifles, lever, crossbow) | −0.20 / +0.24 | 0.955 | 0.12 + 0.25a | cheek weld, ≤ +0.36 chin-down then the gun rises | butt 3 below the neck base, 16 ahead of the near shoulder joint (the pocket), butt→muzzle line on the target | stock stays in the shoulder (6 lower), muzzle to +0.8 |
| `shotgun` (pump, auto, coach, .410, pipe, 40 mm) | −0.22 / +0.25 | 0.945 | 0.16 + 0.25a | cheek weld | as rifle | as rifle |
| `smg` (SMG, nailer) | −0.20 / +0.24 | 0.955 | 0.14 + 0.25a | cheek weld | butt 2 below the neck, 22 ahead of the shoulder (the folded stock is short) | as rifle |
| `hip` (LMG) | −0.26 / +0.26 | 0.93 | 0.24 + 0.15a | 0.4a, no weld | butt 50 below the neck, 18 ahead of the shoulder (under the arm) | muzzle to +0.45 |
| `pistol` (2-handed) | −0.14 / +0.16 | 0.965 | 0.12 + 0.2a | 0.45a, erect | grip (palm) at 0.985 of the arm's reach + the palm offset from the near shoulder, along a lifted 9 toward the eye line: elbows ~160-175° | out and down to +0.75, reach −18% |
| `pistol1` | −0.12 / +0.14 | 0.97 | 0.08 + 0.15a | 0.45a | 0.99 reach | +0.8 |
| `bow` | −0.16 / +0.18 | 0.97 | 0.04 | 0.6a | bow hand = far arm at 0.93 reach | +0.5 |
| `tube` (LAW) | −0.20 / +0.24 | 0.955 | 0.1 + 0.2a | 0.6a | butt 2 above the neck, on the shoulder | +0.35 |

Elbows: the arms are 2-bone IK with the elbow-down solution, so the trigger elbow hangs below the grip and
the support elbow under the fore-end; the support hand slides back along the fore-end until its arm (to
the wrist) can bend (reach × 0.95). The far (support) shoulder sits `farSh` ahead of the near one: +0.05 H
in the bladed long-gun stances (the weak side leads), 0 for the isosceles pistol, −0.035 H bare-handed. Recoil: torso lean −0.009…−0.014 per recoil unit and the pelvis 0.12–0.3 back (feet
planted) plus the gun's own kick along its axis. Low ready blends in when not aiming, or when walking and
no shot was fired for 1.2 s; firing brings the gun straight up. The stance's feet and pelvis height are
weighted by `1 − moving` so walking uses the gait.

Cheek weld (`Rig.cheekWeld`): the comb line is the bore direction through the stock's top edge, measured
from each icon at load (`assets.ts combOf`: the highest top edge in the middle of butt→grip). A cheek point
on the head (0.22 up the head bone, 0.3 forward) is bisected onto it by turning the head about the neck in
[−0.2, +0.36]; what the head can't reach, the gun is lifted by.

Reloads: `ready` moves the gun to the chest workspace (half the torso up, 22 forward), muzzle canted up by
the clip's `gunTilt` (base 0.12 rad); the shotgun's shell-by-shell load brings it all the way down to the
hip (`gunDY` +16), muzzle level, trigger hand at the hip, as in the reference photo; the stance's legs stay planted. Bolt guns are worked by the trigger
hand (`reloadBolt`, `boltCycle` on role `f`, the round in the trigger hand), the lever by the trigger hand;
mags, shells and the pump stay with the support hand.

### 4b. Arms at real proportions (round 2: "arms scrunched, hands too close to the shoulder")

Measured in every human rig (13 survivors + 2 raiders, `public/sprites/parts/*.json`, H = 240): upper
arms 0.145–0.197 H, **forearms 0.12–0.16 H** (real: 0.14–0.16), whole arms 0.27–0.32 H (real ≈ 0.33).
Segmentation took the arm lengths from side-view art in which the arm is foreshortened toward the camera.
Together with a butt pocket at the neck and a far shoulder placed *behind* the near one, every long-gun
pose folded the trigger arm to a 45–60° elbow with the hand at the chin, and the support hand slid back to
the magazine well.

Fix (measured, not eyeballed; `tools/e2e/pose-check.cjs`, `src/anim/armcheck.ts`):
- **Bones** (`skeleton.ts geomOf`, `ARM`): upper arm clamped to 0.175–0.19 H, forearm to 0.148–0.158 H.
  The arm art is **stretched along its bone** to the new length (`Rig.part`: rotate(rest)·scale(k,1)·
  rotate(−rest)); nothing is shrunk.
- **Pocket** relative to the near shoulder joint (+16 forward), not the neck: the trigger hand sits about a
  forearm ahead of the pocket. Pump and hunting-rifle grips moved onto the stock wrist behind the trigger
  guard (`tools/gun-lop.ts` prints each gun's butt→grip against a real length of pull).
- **Bladed far shoulder** (`farSh`), and the support reach measured to the wrist.

| (15 rigs, aiming) | trigger elbow | trigger reach | hand ahead of shoulder | support elbow | support reach |
|---|---|---|---|---|---|
| AR-15, before | 51–74° | 0.44–0.60 | 0.14–0.17 H | 105–176° | 0.79–1.00 (clamped) |
| AR-15, after | 61–73° | 0.52–0.60 | 0.19 H | 144–150° | 0.95–0.97 |
| pump, before | 45–70° | 0.39–0.57 | 0.13–0.16 H | 105–176° | 0.8–1.0 |
| pump, after | 63–77° | 0.53–0.63 | 0.20 H | 145–149° | 0.95–0.96 |
| 9 mm, before | 122–129° | 0.88–0.90 | 0.25–0.29 H | 144–156° | 0.95–0.98 |
| 9 mm, after | 160–176° | 0.98–1.00 | 0.32 H | 142–152° | 0.95–0.98 |

Targets per stance are `ARM_TARGETS` (rifle/shotgun: trigger elbow 60–115°, support 125–178° at 0.82–0.995
reach; pistol: both ≥ 135–150°, hands ≥ 0.28 H out). `animlab.html?closeup&debug` prints each rig's
bone lengths and elbow angles under it.

## 5. Depth layering (right-facing; camera sees the right side)

Roles vs sides: clips address hands by role (`n` = support, `f` = trigger). With a firearm, `Rig.swap`
solves role `n` on the far arm and role `f` on the near arm. Bare-handed / melee keep role `n` on the near
(right) arm, so the hatchet swings in the right hand.

| Order (back → front) | long guns (`rifle`, `shotgun`, `smg`, `hip`, `tube`) | `pistol`, `pistol1` | `bow` | bare / melee |
|---|---|---|---|---|
| 1 | far leg (dark) | far leg | far leg | far leg |
| 2 | far upper arm (dark) | far upper arm | far upper arm | far upper arm, far forearm |
| 3 | slung gun | slung gun | — | slung gun |
| 4 | torso | torso | torso | torso, head |
| 5 | near leg | near leg | near leg | near leg |
| 6 | head | head | head | — |
| 7 | far forearm (under the gun) | far forearm, far (support) hand | far forearm | gun |
| 8 | **gun** | **gun** | bow | far hand (dark) |
| 9 | far hand on the fore-end (dark) | — | bow hand, string | string |
| 10 | near arm contact shadow, near upper arm, forearm | same | same | same |
| 11 | near (trigger) hand + props | same | drawing hand | near hand, melee weapon |

The far limbs reuse the near art pre-darkened (`#14110f` at 42%, the cheap per-part tint). The table is the
`layers` array of each stance — a new class is one line of data.

## 6. Reusable art scheme and counts

| Asset | Before | After |
|---|---|---|
| Body (head, torso, pelvis, legs, near arm) | 1 "rig pose" image per survivor (13) + raiders (2) | unchanged: **1 image per character**; the arm-forward rig pose already separates the near arm from the torso, the far arm reuses it darkened, the chest behind it is inpainted |
| Hands | 13 per-survivor sheets of 6 poses (raiders: none) | **4 shared library sheets** (`hands_light`, `hands_medium`, `hands_dark`, `hands_glove`), 5 poses each: trigger grip (index along the frame), support cup, open, fist, pinch |
| Per-survivor hand recolour | — | `hands: { lib, tint?, tintA?, bright? }` in `tools/rigs/<id>.json` (skin tone tint baked by `segment.ts`) |
| Weapons | shared icons | shared icons (+ comb measured at load) |
| Per-pose / per-weapon art | none | none: poses are stance data + IK |

Total sprite sources: 15 bodies + 4 hand sheets = 19 images for 15 characters × 9 stances × 26 guns
(was 28). The library sheets are drawn wrist-left so `segment.ts` finds each pose's wrist, tip and grip
point itself (`libPoses`): grip = the curled fingers of the trigger hand, the cup of the support hand, the
thumb-index point of the pinch (the art's cartridge is erased; the rig draws its own round/shell/mag).
Generation: `npx tsx tools/gen-parts.ts --manifest=tools/sprites-parts-hands.json` (style reference
`surv_rifle`), 4 × $0.034 = **$0.14**. Adding a survivor now costs one rig-pose image and a joint JSON
naming a hand library.

## 7. Verification

`node tools/e2e/pose-check.cjs <url>`: every human rig × 8 guns (rifle, shotgun, smg, hip, pistol) must
fall inside the real-arm ranges (§4b); it exits 1 otherwise.
`animlab.html?closeup&still&h=150&w=service9,ar15,pump,smg,lmg` (every survivor × 5 classes; `&debug` adds
the skeleton and the arm numbers),
`&act=reload&at=…`, `&act=walk`, `&act=low`; in-game `docs/screenshots/night.jpg`, `nest.jpg`, `run.jpg`
(`node tools/e2e/shots.cjs night nest run`). Compared side by side against the reference photos above.

Known limits: one arm art per character (the far arm is the near arm darkened, so a sleeve patch shows on
both); left-facing bodies are mirrored (read as left-handers); no kneeling stance yet (the duck clip
crouches on the stance's feet); the support hand is drawn over the fore-end even during reloads, for
readability.
