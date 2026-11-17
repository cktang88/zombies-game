# 09 — Animation: cutout bone rig, IK weapon handling, ragdoll deaths

Status: prototype in `src/anim/` + dev page `animlab.html` (`npm run dev`, then `/animlab.html`;
`?debug` draws the skeleton, `?bench=1`, `?bench=ragdoll`, `&lod`, `&sync`, `&flat` run benchmarks).
Nothing in the game (`src/night`, `src/main.ts`, `src/ui`) uses it yet; the integration API is at the end.

## 1. Decision

**A small custom cutout rig in TypeScript** (~2,200 lines across `src/anim/*.ts`, no runtime dependency; the whole anim lab bundle incl. the clip library is 70 KB min / 25 KB gzip),
not a third-party skeletal runtime.

| Option | License / cost | Fit for us |
|---|---|---|
| **Spine** (Esoteric) + spine-ts / pixi-spine | Runtimes are source-available but shipping them in a product needs a paid **Spine Editor license** held at integration time; the trial license grants no runtime rights ([runtime license](https://raw.github.com/EsotericSoftware/spine-runtimes/master/LICENSE), [editor license agreement](https://ar.esotericsoftware.com/files/license.txt), [forum](https://en.esotericsoftware.com/forum/d/17246-license-for-runtimes)). | Best tool for hand-keyed cutout work (Darkest Dungeon was drawn in Photoshop and animated in Spine — [80.lv interview](https://80.lv/articles/red-hook-studios-talks-about-the-creation-of-darkest-dungeon/?amp=1)). But our motion is mostly *procedural* (aim, IK to 26 different guns, gait parameters, ragdoll), which Spine would only host, and every animator would need a seat. Rejected on license + workflow. |
| **DragonBones** (DragonBonesJS) | MIT runtime ([ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2FDragonBones%2FDragonBonesJS)); editor effectively abandoned, last push 2024, community forks for Pixi 8 / Three. | Usable license, but we'd adopt a dead editor + a Pixi/Egret-oriented runtime for a Canvas2D game, and still write all IK/procedural layers ourselves. |
| **Spriter Pro** (BrashMonkey) | Paid editor; SCML runtimes are open reference implementations ([Construct store](https://www.construct.net/game-assets/tools/spriter-344)). | Same as DragonBones: format + editor we'd barely use. |
| **Rive** | MIT runtimes, but the runtime is a WASM renderer: `@rive-app/canvas` ≈ 147 KB min / 43 KB gz + WASM ([depscope](https://depscope.dev/pkg/npm/@rive-app/canvas), [Rive sizes](https://rive.app/docs/runtimes/runtime-sizes.md)). | State machines are great for UI; for 150 characters drawn into our own Canvas2D scene with our own lighting/shadow passes it's the wrong shape (separate render surface, WASM per instance). |
| **Mesh deformation of the single image** (ARAP / puppet warp: [Igarashi et al. 2005](https://www-ui.is.s.u-tokyo.ac.jp/~takeo/research/rigid), [Deform2D](https://www.dgp.toronto.edu/~rms/software/Deform2D/index.html)) | Free (algorithm). | Looks lovely for small bends, but the arms are drawn *holding a gun* in every survivor sprite; warping can't take the gun out of the hands or swap it. Needs WebGL for per-vertex textured triangles to be fast. Kept as a possible later layer (e.g. breathing torsos), not the base. |
| **Custom cutout rig** (chosen) | Ours. 0 deps, < 25 KB gzip with the clip library. | Exactly the features we need: analytic 2-bone IK to per-weapon anchors, gait synthesis, data clips stretched to `fireProfile` reload times, sfx events, Verlet ragdoll on the same skeleton, flipbook LOD for crowds. Canvas2D `setTransform` + `drawImage` only. |

What we borrow from games:
- **Rain World** — procedural, physics-driven bodies with IK forcing the stance ([GDC 2016 talk](https://gamedeveloper.com/art/video-animating-i-rain-world-i-and-its-many-squishy-stretchy-creatures), [Zucconi](https://www.alanzucconi.com/2017/04/17/procedural-animations/)): our gaits are parameters, feet are IK targets, deaths are physics.
- **Overgrowth / Receiver** (David Rosen, [GDC 2014 "An Indie Approach to Procedural Animation"](https://gdcvault.com/play/1020049/Animation-Bootcamp-An-Indie-Approach)) — very few keyframes + procedural blending; reload actions as short keyed poses interpolated with springs.
- **Darkest Dungeon** — cutout parts with generous overlaps and a dark ink line at every joint so rotation never shows a seam; reuse of the same parts across idle/walk.
- Reload choreography from FPS practice: an *empty* reload has an extra step (charging handle / slide release / bolt) the tactical reload skips; events are timed to the magazine seating ([BI feedback](https://feedback.bistudio.com/T67336)). Our clips exist in both flavours (`reloadMag` / `reloadMagEmpty`, `reloadPistol` / `reloadPistolEmpty`).

## 2. Architecture (`src/anim/`)

```
assets.ts        part atlas + weapon icon loading; pre-baked dark (far limbs), shadow, flash
                 variants; magazine cut out of each gun icon (gun-without-mag + mag sprites)
skeleton.ts      fixed humanoid skeleton (14 parts), angle conventions, Channels (the per-frame
                 pose all layers write), rest geometry derived from the atlas JSON
math.ts          analytic two-bone IK, easing, seeded RNG
gait.ts          procedural locomotion presets (stride, lift, duty, limp, drag, stiff, lurch,
                 arm hang/swing/lag, crawl) + seeded per-instance jitter
clips.ts         keyframed action clips as data (normalised time), RELOADS table
styles.ts        per-archetype sets: walk variants, attacks, idles, deaths, mass, stiffness...
weaponAnchors.ts grip / fore / butt / muzzle / mag rect / magwell / rack / port / len / hold /
                 reload kind for all 26 guns + hatchet (hand-placed from the icons)
rig.ts           Rig: layers -> channels -> IK solve -> draw; play(), reload(), fire(), hit(), die()
ragdoll.ts       Verlet ragdoll on the same joints (20 points)
flipbook.ts      crowd LOD: walking Turned drawn from shared runtime-baked frames
```

Per frame, `Rig.update(dt)`:
1. **Locomotion** — the gait writes foot targets (stance foot moves back at exactly ground speed,
   so `phase += v·duty/stride` keeps feet planted), pelvis bob/dip, torso lean/sway, head tilt/sway,
   FK arm hang/swing. Crawl gaits plant the *hands* instead.
2. **Aim** (survivors) — torso lean and head follow the aim angle; the gun is placed: long guns
   butt-in-shoulder-pocket with the muzzle line on the target, pistols at ~80% reach, tubes on the
   shoulder, bows at full reach and rotated upright. `ready` blends to a low carry in front of the
   belly (reloads, rummaging). Default hand targets are the gun's `grip` (far/trigger hand, drawn
   *over* the gun so fingers wrap it) and `fore` (near/support hand). The support hand slides back
   along the fore-end when the arm can't reach with a bent elbow.
3. **Action clips** — keyframed channel tracks and hand-target tracks (in gun space, so a hand on
   the magwell stays on it while the gun cants), discrete prop switches and events. Fade in/out,
   stretched by `play(…, {duration})`, repeated by `{repeat}`.
4. **Additive** — hit reactions, twitches, recoil spring, breathing.
5. **Solve** — legs: 2-bone IK, knee forward. Arms: 2-bone IK to the hand target (elbow-down
   solution; elbow-up for crawling), hand art rotation from the target; else FK.

Draw order (facing right; the viewer sees the character's left side): far leg, far arm (dark), slung
gun, torso, head, near leg, gun, far (trigger) hand + its prop, contact shadow of the near arm,
near arm, magazine/shell/speedloader in the near hand, near hand, melee weapon, hit flash, props
(dropped mags, casings, shells). Far limbs reuse the near limb art pre-darkened.

## 3. Data formats

**Rig source** `tools/rigs/<id>.json` (hand-authored, ~15 joints in source-image pixels):
`{ id, source, height, joints: {headTop, neck, shoulder, elbow, wrist, handTip, pelvis, hip, knee,
ankle, toe, bHip, bKnee, bAnkle, bToe}, radius?: {part: fraction}, force?: [{part, poly}],
fillMaxX?, hands?: {source, refPose, scale?, poses: {grip|support|open|fist|pinch: {index, wrist, tip, grip}}} }`.

**Part atlas** `public/sprites/parts/<id>.png` + `.json` (written by `tools/segment.ts`):
`{ id, height: 240, ground, joints (rig units, relative to pelvis), parts: { name: {x,y,w,h, px,py
(pivot), tx,ty (distal joint), rest (source bone angle), len, gx?,gy? (hand palm point)} } }`.
Survivor atlas: 13 parts (8 body + 5 hand poses), 512×153 px, ~60 KB.

**Weapon anchors** `src/anim/weaponAnchors.ts` — icon-pixel points + `len` (rig units), `hold`,
`reload`, `flip` (icon_pistol and icon_smg point left).

**Clip** (`src/anim/clips.ts`):
```ts
{ id, dur, loop?, add?, hold?, fadeIn?, fadeOut?,
  num: { channel: [[t, value, ease?], ...] },          // t in 0..1
  n|f: [[t, {s:'gun'|'body'|'ground'|'world', p, dx, dy, pose, a} | null, ease?], ...],
  set: [[t, 'mag'|'prop'|'fprop'|'gun'|'headFlip', value]],
  ev:  [[t, 'magOut']] }
```
Channels: `px py tilt lean head crouch nSh nEl nWr fSh fEl fWr nHip nKnee nAnk fHip fKnee fAnk
nFx nFy fFx fFy footIK nHx nHy fHx fHy handIK ready gunTilt gunDX gunDY aimW nIK fIK cyl draw flash`.

**Style** (`src/anim/styles.ts`): `{ walks[], run?, attacks[], idles[], deaths[] ('ragdoll' or
authored clip ids), special[], wall, climb?, mass, stiff (active-ragdoll seconds), friction, scale?,
legShotCrawl? }` for survivor, sleeper, deer, drag, tunneler, pulper, crier, deputy, ferryman,
raider, bellwether (+ planned leaper, spitter).

### Clip library (prototype)
- Reloads (events in brackets): `reloadMag`/`reloadMagEmpty` [magOut, magDrop, magGrab, magIn,
  slap, rack], `reloadPistol`/`reloadPistolEmpty` [… slide], `shellIn` per round [shellGrab, shellIn]
  + `pump` [pumpBack, pumpFwd], `reloadBolt` [boltUp, boltBack, roundGrab, roundIn×2, boltFwd,
  boltDown], `boltCycle`, `leverCycle`, `reloadRevolver` [cylOut, eject, loaderGrab, speedIn,
  loaderDrop, cylIn], `reloadBreak` (barrels hinge visibly) [breakOpen, eject, shellGrab, shellIn,
  breakClose], `nockBow` [arrowGrab, nock, drawn], `reloadCrossbow` [cock, arrowGrab, boltIn],
  `reloadMuzzle` [powder, ball, ram×2], `reloadTube` [tubeDrop, tubeGrab, extend].
- Survivor actions: `chop`, `sweep` (hatchet) [whoosh, hit], `rummage` loop (crouch, hands on the
  ground, gun slung on the back) [rustle, clink], hit reactions `hitHead|hitTorso|hitArm|hitLeg`.
- Turned: `claw`, `grabBite`, `pound` (wall, loop), `lunge` (Deer), `pantStop` (Deer, loop),
  `smash` + `grabDrag` (Ferryman), `stagger`, `knockdown` (+ get-up), `buckle` (leg shot → crawl),
  `climb` (corpse ramp / barricade lip), idles `idleSniff`, `idleSway`, `idleTurn` (head turns to a
  noise), `twitch`; specials `keen` (Crier), `retch` (Spitter/Biler), `vault` (Leaper/Buck),
  `toll` (Bellwether), `burstWindup` (Pulper); authored deaths `deathChoke`, `deathCollapse`.
- Gaits: survivor `walk`, `run`, `aimWalk`; Sleeper `limpDrag`, `stiffLurch`, `headLoll`, `dangle`;
  Deer `sprint`, `sprintRagged`; Drag `crawl`, `crawlOneArm`; Pulper `waddle`; Crier `stalk`;
  Deputy `trudge`; Ferryman `stomp`; Raider `raider`.

Variety rules: each instance picks one of its archetype's walk variants by seed, then `jitterGait`
varies stride/lift/duty/bob/lean/sway/head tilt/arm hang/arm lag/cadence (±8–25%); phase starts
random; with `autoIdle` a standing Turned plays a seeded idle every 2.5–7.5 s (walking ones only
twitch). Hit reactions are zone-specific; a crippling leg hit plays `buckle` then switches to a crawl
gait. The lab shows the four Sleeper walks side by side, the Ferryman smash and the Deer pant-stop.

## 4. Art pipeline — verdict and cost

Tried on surv_rifle and z_shambler (then z_brute, z_runner) with `google/gemini-3.1-flash-lite-image`
via OpenRouter, the original raw generation passed as an `image_url` reference
(`tools/gen-parts.ts`, manifest `tools/sprites-parts.json`, $0.034/image; **total spent $0.51**, 15 images):

| Variant | Result |
|---|---|
| (a) cut the existing sprite | Not viable for survivors: every sprite has a gun fused into both hands; Turned arms overlap the chest. Would need heavy inpainting. |
| (b) paper-doll parts sheet | Surprisingly good for the survivor (head, armless torso, sleeves, hands, legs drawn separately with rounded ends), poor for the Turned (odd torso). Parts come at inconsistent scales/angles; asking for "puppet" ends added pin holes. |
| (c) arms only ("arms extended, holding nothing") | Clean, but mismatched scale/lighting with the body. |
| **(d) "rig pose": same character, unarmed, arms straight forward at shoulder height, wide stride** | **Chosen.** Identity, palette and ink match the original; arms don't cover the torso, legs are separated, the far arm hides behind the near one. One coherent drawing → consistent scale and lighting across parts. |
| hands sheet (6 poses) | Excellent: pistol grip, fore-end support, relaxed, fist, pinch (shells/rounds), open palm. Used as swappable hand poses. |

Segmentation (`tools/segment.ts`): place ~15 joints per image (2–5 minutes with a grid overlay);
each opaque pixel goes to the nearest bone capsule (thickness-scaled, end-overshoot penalised; the
near arm always wins inside its capsule because it's in front), each child keeps a round **joint cap**
shared with its parent (overlap, no seams), the chest hidden behind the arm is refilled by diffusion
inpainting, parts are scaled to 240-unit height and shelf-packed into one atlas. Raw sources are
committed in `tools/rigs/src/` so cuts are reproducible (`npx tsx tools/segment.ts`).

## 5. Ragdoll deaths (`ragdoll.ts`)

20 Verlet points on the rig's joints; distance constraints per bone; the torso is a rigid 6-point
cluster (pelvis, neck, both shoulders, both hips); joint angle limits (knees and elbows bend one
way, ankles, wrists, hips, neck) applied as kinematic projections that bleed the child's velocity
(otherwise limits fighting the ground pump energy in — found and fixed in the lab); ground plane
with friction and a little bounce; optional barricade face (`wallX`). Death hands over the current
animated pose with its velocity (plus the body's ground speed: a sprinting Deer tumbles on) and the
killing hit's impulse at the hit zone (`head` snaps back, `legN/legF` buckle, `shotgun` lifts and
throws, `explosion` adds spin, `melee` drops it where it stood). **Active ragdoll**: for `style.stiff`
seconds (0.05 Drag … 0.5 Ferryman) the joints are pulled toward the death pose with decaying
stiffness, so it reads as a body falling, not a sack. Mass per archetype scales the impulse
(Ferryman 3.2, Pulper 1.8, Deer 0.8, Drag 0.7). Authored deaths win where they matter
(`deathChoke` Crier, `burstWindup` Pulper, `deathCollapse` Ferryman/Bellwether) and hand over to
the ragdoll on their `ragdoll`/`burst` event. Settled (0.3 s still) or 2.6 s → `rig.settled`;
`rig.bakeCorpse(ctx…)` draws it darkened into the ground-decal canvas and frees it (the caller then
adds its final position to the corpse pile/ramp mass). Cap: the lab keeps ≤ 24 live ragdolls,
baking the oldest first. Reduce-gore: `die({calm:true})` halves impulses and disables
`dismember`; `dismember: 'head' | 'armN'` detaches a limb (it stays its own ragdoll piece).

## 6. Performance

Measured in headless Chromium (Playwright) on a 4-vCPU 2.1 GHz Xeon, 600 frames, 1280×640 canvas,
150 Turned (shambler/runner/brute rigs, auto-idles) + 6 survivors aiming, firing every 20 frames and
reloading. "JS" = update + draw submission; "sync" forces the raster to finish inside the timing
(`getImageData`), with GPU acceleration **off** (pure CPU raster — the worst case; a real GPU makes
the raster part nearly free):

| Scene | update | JS frame (avg / p95) | full CPU raster, sync (avg / p95) |
|---|---|---|---|
| old single images (`&flat`), same 156 actors | – | – | 10.9 / 15.2 ms |
| 156 full rigs | 0.85 ms | 5.4 / 9.1 ms | 57.8 / 73.8 ms |
| 156 rigs, crowd LOD (`&lod`) | 0.75 ms | **1.8 / 3.8 ms** | 23.5 / 31.6 ms |
| + 24 live ragdolls, LOD | 1.44 ms | – | 40.6 / 59.8 ms |

Takeaways: the rig's CPU cost (IK, clips, ragdolls) is ~1 ms/frame for the whole crowd; the cost is
fill rate of ~16 rotated part draws per body. With the flipbook LOD (walking Turned are one
axis-aligned blit from shared frames, baked at runtime per sprite × gait × 16 phases × scale bucket;
anything playing a clip, flashing or dying uses the full rig) we're at 1.8 ms JS per frame, i.e. 60 fps
with GPU canvas. In the pure-software worst case it is ~2× the old single-image cost. Further levers
if needed: skip the near-arm contact shadow and flash pass below ~80 px height, cap full-rig Turned
to the nearest ~40, merge far-limb parts into the torso for distant bodies.

## 7. Integration API

```ts
import { createRig, rigScale, loadRig, loadGun } from './anim';
const rig = createRig('survivor', 'surv_rifle', { seed, onEvent: (name, r) => sfx(name) });
rig.setWeapon('ar15');                 // WEAPONS id; { oneHand: true } for pistols
rig.aimAt(worldX, worldY);             // uses the last draw() transform
rig.setSpeed(pxPerSec);                // drives the gait; feet stay planted
rig.play('chop', { duration, repeat, onEvent, onEnd });
rig.reload(fireProfile(w).reload, { empty: w.ammo === 0, rounds, onEvent }); // picks + stretches the right clip
rig.fire(strength);                    // recoil spring, muzzle flash, casing
rig.hit('head' | 'torso' | 'arm' | 'leg', { cripple });
rig.die({ worldImpulse: {x, y}, at: 'head', kind: 'shotgun', wallWorldX, calm, dismember });
rig.update(dt);
rig.draw(ctx, x, groundY, rigScale(displayHeight), facing, fallbackImage);  // falls back to the single sprite if no parts
if (rig.settled) { rig.bakeCorpse(decalCtx, x, groundY, scale, facing); /* add to corpse pile */ }
rig.lod = true;                        // crowd Turned: flipbook while only walking
const t = createRig('turned', 'z_shambler', { style: 'sleeper', seed: z.id });  // gait variant + jitter from seed
t.autoIdle = true; t.play('pound'); t.play('climb'); t.hit('leg', { cripple: true });
```
`draw` sets `ctx.setTransform` itself and resets it to identity at the end; callers that rely on a
camera transform should pass already-transformed coordinates (or we add a `base` matrix parameter
when integrating). Events are plain strings; audio maps them (e.g. `magIn` → `foley.magIn`).

## 8. Rollout plan

| Work | Count | Cost |
|---|---|---|
| Rig pose for every sprite with a body (`surv_*` 13, `z_*` 18 incl. bellwether/raiders, `dog` needs a quadruped skeleton — later) | 31 | 2 tries × $0.034 ≈ **$2.1** |
| Hands sheet per survivor (5 poses) | 13 | ≈ **$0.45** (+ retries ≈ $0.9) |
| Variant rig poses for Sleepers so the 6 Sleeper sprites aren't one body (already separate sprites) | – | included above |
| New archetype art (leaper, spitter, extra Raider) | 3–5 | ≈ $0.5 |
| Joint placement (`tools/rigs/*.json`) | 31 | ~5 min each by hand with the grid script (or an agent with a grid overlay, as done here) |
| **Total image spend** | | **≈ $3–4** |

Code steps: (1) wire `createRig` into night battle + day expedition behind a setting, keeping the
single-image draw as fallback; (2) map `onEvent` names to the existing foley/gun audio; (3) drive
`reload()` from `fireProfile(w).reload` / `reloadPerRound`; (4) ragdoll death impulses from
`knock × pellets` and the hit zone the battle already computes; corpses into the decal + pile mass;
(5) Turned: style from `ZombieDef.id`, `autoIdle`, `lod` for all but the nearest ~40; climbing /
pounding at the barricade; leg cripple → crawl; (6) tune per-weapon anchors in the lab.

Known issues / next polish: the Ferryman torso keeps a slight inpaint edge where the arm crossed the
chest (visible with arms overhead); support-hand art is a little lighter than the body art (tint the
hands sheet toward the body palette); revolver cylinder and pump fore-end are drawn procedurally /
not moved; the bow icon is drawn lying along its length so it reads small when upright; no far-side
hand pose for the trigger hand in reload close-ups.
