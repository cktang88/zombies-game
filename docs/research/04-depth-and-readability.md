# 04 — Depth, Separation & Crowd Readability

Scope: how to make a dark, cel-shaded, side-view barricade shooter read clearly at night. That means three things: (a) foreground actors pop off a painted background, (b) individual zombies stay distinct inside a crowd, and (c) the scene has a "2.5D" ground plane with depth lanes, perspective scale and y-sorting, as in the later Last Stand games. The doc covers findings, a diagnosis of our current screenshots, and an implementation spec for `src/night/battle.ts` and `src/night/expedition.ts`.

Everything here is about *technique*. No assets, names or layouts are taken from the games below.

---

## 1. Findings

### 1.1 Separation is a value problem first, colour second

- **Atmospheric (aerial) perspective.** As distance grows, contrast, value range and saturation all fall and everything shifts toward the air colour. The standard rule for layered 2D: *"foreground will always appear darker and in focus. Backgrounds get lighter and less detailed as you are looking through more atmosphere."* Painting guides add warm-near / cool-far and say to keep the background in a narrower value band than the playable plane ([21-draw](https://www.21-draw.com/?p=26211); [Slynyrd Pixelblog 62](https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds); [ben304 on atmospheric perspective in adventure games](https://ben304.blogspot.com/2017/02/atmospheric-perspective-in-adventure.html)). That last post makes the point that matters most for us: the effect *"only works as long as we can tell what's a foreground image and what's a background image."*
- **Hollow Knight.** Commentators describe it as three bands: blocking foreground, a high-contrast playable midground, and parallaxed background layers that are muted and simplified so they *"stay out of the way."* Hazards and hit areas keep crisp, high-contrast edges ([Medium: The Art of Hollow Knight](https://medium.com/3d-environmental-art/the-art-of-hollow-knight-f4c05dda3882); [PC Gamer](https://www.pcgamer.com/uk/hollow-knights-charming-art-sets-the-bar-for-hand-drawn-games); [Godot forum study](https://forum.godotengine.org/t/currently-prototyping-hollow-knights-visual-style-feedback-needed/54925)). These are secondary sources, but the observation is consistent across them.
- **Limbo / Inside.** These are the extreme case of value separation. The play plane is solid near-black silhouette and the background recedes into grey fog. Objects blur as they leave the interactive plane, *"naturally communicating their depth and relevance"* ([Digital Chumps review](https://digitalchumps.com/2010/07/19/limbo); [Giant Bomb: Silhouetted 2D](https://giantbomb.com/wiki/Concepts/Silhouetted_2D); [Art Examination: Limbo](https://girlsongames.ca/2017/04/27/art-examination-playdead-limbo)). Lesson for a *dark* scene: the fog behind the actors should be **lighter** than the actors' darks, not darker. The far plane is *lifted*, and the play plane holds the deepest blacks and the brightest highlights.
- **Mark of the Ninja.** Light and dark are binary, and the actor's sprite palette changes when it steps into light, so visibility can be read straight off the character ([Game Developer: five stealth rules](https://gamedeveloper.com/design/-i-mark-of-the-ninja-i-s-five-stealth-design-rules); [GamesBeat preview](https://gamesbeat.com/mark-of-the-ninja-preview/); [GDC Vault: Designing Mark of the Ninja](https://www.gdcvault.com/play/1017791/contactUs)). For us: zombies inside a floodlight cone or a fire pool get a warm rim and full colour, and zombies in the dark get a cool silhouette treatment. That beats darkening everything uniformly.
- **Darkest Dungeon.** *"Pooling blacks are a nod to the light mechanic."* Black is a graphic shape, and the art has to communicate *"at a glance"* ([80.lv interview](https://80.lv/articles/red-hook-studios-talks-about-the-creation-of-darkest-dungeon); [GameSpot](https://www.gamespot.com:443/articles/the-gothic-sensibilities-of-darkest-dungeon/1100-6424880/); [Game Developer: Road to the IGF](https://www.gamedeveloper.com/audio/road-to-the-igf-red-hook-studios-i-darkest-dungeon-i-)). Darkest Dungeon gets readability by placing blacks deliberately: characters keep a lit side, and the dark falls *around* them rather than over them.
- **Dead Cells.** Characters are rendered from 3D with normal maps and lit dynamically. Backgrounds are kept colourful, but the actors carry the rim and specular light ([Dead Cells art deep dive: colours](https://gonintendo.com/archives/280488-dead-cells-dev-blog-art-design-deep-dive-giving-back-colors-to-cryptic-worlds); [80.lv pipeline case study](https://80.lv/articles/case-study-dead-cells-character-art-pipeline)). For us, a cheap stand-in for normal-mapped rim light is an offset silhouette in a light colour, which we already have via `shadeImg`.
- **Kingdom / This War of Mine.** Kingdom keeps its night playable with a near-black foreground strip, mid-value parallax layers and warm torch pools, so the threats show up *against the lit pools* ([Kingdom](https://kingdomthegame.com/kingdom-classic)). This War of Mine (see doc 03) uses near-monochrome charcoal backgrounds with figures drawn in heavier, darker line weight.

### 1.2 Depth lanes, y-sorting, shadows, hit planes (beat-'em-up practice)

- **Feet are the depth key.** Sort by the y of each actor's feet. The shadow, not the sprite, is the actor's real position on the ground plane: *"offsetting the vertical position of an object is not sufficient to achieve depth… you need shadows."* Two actors with the same sort key flicker, so break ties deterministically, for example by id ([r/godot brawler thread](https://cal1.lr.ggtyler.dev/r/godot/comments/1krwxqe/king_of_monsters_style_game); [Construct forum: emulating depth](https://www.construct.net/en/forum/construct-2/how-do-i-18/emulating-depth-amp-z-fighting-51093); [Construct: Double Dragon/Final Fight best practices](https://www.construct.net/en/forum/game-development/game-development-design-ideas-25/double-dragon-final-fight-149695); [GameMaker Z-tilting](https://gamemaker.io/en/blog/z-tilting-shader-based-2-dot-5d-depth-sorting)).
- **Hit-plane tolerance.** Beat-'em-ups resolve hits in *ground space*: a hit has to land within a z-band of the target's feet, not just overlap on screen. Wulverblade tunes *"how far in the Z plane up and down your attack could hit things"*, and boxes sit near the feet or shadow. Discrete lanes are the common simplification, so actors *"would not have to line up exactly on the Y axis to hit"* ([Game Developer: Wulverblade hitboxes](https://www.gamedeveloper.com/design/designing-great-hitboxes-for-a-2d-beat--em-up-with-swords-and-shields); [Unity: 2D beat-em-up](https://discussions.unity.com/t/2d-beat-em-up/658033.md)).
- **Last Stand series.** The Last Stand 1/2 barricade screens are one side-view plane. Zombies walk in at small vertical offsets on a road band and are y-sorted. Shooting is point-and-click: the crosshair *is* the shot, accuracy is a spread roll around it, and a zombie in front does not shield the one you clicked. Union City and Dead Zone move to a walkable ground band (Union City) and a 3/4 view (Dead Zone). In Union City zombies *"climb over barricades and obstacles"* ([Last Stand Wiki](https://thelaststand.fandom.com/wiki/Glitches); [TV Tropes: The Last Stand](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/TheLastStand); [MobyGames: Union City](https://www.mobygames.com/game/143472/the-last-stand-union-city/)). The point-and-click and depth descriptions come from play experience, not from a written source. Treat them as observation.

### 1.3 Crowd readability

- **They Are Billions** renders up to ~20k infected, and readability is its known weak spot. Reviewers say that zoomed out *"it can be hard to distinguish friendly units from zombies,"* and new players lose *"because they can't see the zombies rushing their base."* The community workaround is always-on health bars ([Numantian](https://numantiangames.com/TheyAreBillions/); [Gamereactor](https://www.gamereactor.eu/they-are-billions-early-access-impressions/); [Steam thread](https://steamcommunity.com/app/644930/discussions/0/1746765743928985472)). The lesson: a horde built from sprites with similar values merges into one texture, so individuality has to be *designed in*, through value, edge and spacing.
- **Left 4 Dead and Days Gone** (general knowledge, no source fetched) separate horde members in three ways: per-instance variation in skin tone and clothing; strong back and rim light from a key light behind the horde; and staggered gaits and positions so heads never form a clean line. Our 2D equivalents are per-instance brightness and hue jitter, a directional rim, and lane and x stagger.

### 1.4 Canvas performance facts

- `ctx.filter` can take a software path. Firefox's accelerated canvas did not support filters and fell back to slow software Skia ([Mozilla bug 1602299](https://bugzilla.mozilla.org/show_bug.cgi?id=1602299)). Use filters at **bake time only**, never per sprite per frame ([MDN `filter`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter); [web.dev canvas performance](https://web.dev/articles/canvas-performance)).
- Pre-render to offscreen canvases and stamp them with `drawImage`, ideally at 1:1 scale and integer coordinates ([web.dev](https://web.dev/articles/canvas-performance); [AG Grid canvas optimisation](https://blog.ag-grid.com/optimising-html5-canvas-rendering-best-practices-and-techniques); [spriteFX tint caching](https://github.com/jaames/spriteFX)). Batch many shapes of one colour, such as all the contact shadows, into a single path and a single `fill()`.

---

## 2. Diagnosis of the current screenshots

**`10-fort.png` (night 9, fire, five zombies at right)**

1. **No value hierarchy.** The background painting (houses, diner, wrecked truck) uses the same ink weight, saturation and value range as the sprites, because both come from the same AI style. The zombies at x≈1050–1280 sit directly over the wrecked truck, which has the same dark olive-grey values, and they dissolve into it. Only the pale faces read.
2. **The darkness overlay hits actors and background equally.** `draw()` applies a night grade (`rgba(14,18,30,0.22–0.36)`) before the actors, then `drawLighting()` draws `this.dark` (alpha 0.12–0.46) plus a vignette **after** the actors. Every pixel, actor or background, is darkened by the same amount, so the darkening cannot create separation. It only crushes everything together.
3. **The ground is a black void.** The road gradient runs from 0.75 to 0.95 black between y 600 and 720, and actors' feet are at y 616–690, so legs and feet fall into near-black. Nothing anchors the actors to the ground: there are no contact shadows, and they look pasted on.
4. **The depth band is too thin for the actor size.** `LANE_TOP 616 → LANE_BOT 690` is 74px, while zombies are about 156px tall (`120 × ZS 1.3`). Scale only spans 0.92–1.08 and y is continuous random, so zombies overlap at almost the same height and their heads line up. The crowd at right reads as one lump with five faces.
5. **The rim light is uniform and weak.** `shadeImg('#a9b8c9')` is offset by (+1.5, −1.5) at 0.55 on every zombie, whatever the lighting. It is a cool edge on a cool background, so it gives almost no contrast. It is also not tied to the floodlights and fires, which sit behind the defenders on the left.
6. **The survivors get the same treatment.** Survivors at x 60–300 are dark-on-dark against the house porch, and their name labels collide. Their y values are 664/672, which is nearly the same depth.

**`11-crossing.png` (night 6, intro)**: everything sits at about 10–20% luminance. With crossing −0.08 plus the night grade, the lighting base, the vignette and the intro overlay all stacked, the scene has no midtones left. The survivors are only findable by their labels.

**`6-run.png` (expedition, day)**: this one reads better because the player's coat is lighter than the busy ground. It still shows the same problems: the actor stands on a flat line with no shadow, and the background is full-contrast, full-detail and in focus. One extra problem: the searched door draws at `globalAlpha 0.55` and `brightness(0.6)`, so its rectangular frame shows as a translucent box behind Dot and reads like a UI glitch. Fade searched spots by **darkening** them (a baked dark variant), not by transparency. Expedition zombies use `GROUND + (−6..8)`, which is effectively a single lane.

---

## 3. Implementation spec

### 3.1 Ground plane, lanes and scale (`battle.ts`)

Replace the `LANE_TOP/LANE_BOT` continuous band with **4 discrete depth lanes** and a perspective-correct scale.

```ts
const HORIZON = 330;          // vanishing line of the painted bg (approx.)
const REF_Y   = 664;          // y where scale == 1 (survivor feet, current SURV_Y)
export const LANES = [604, 628, 655, 685]; // feet y, far → near (gaps 24/27/30 widen with nearness)
const depthScale = (y: number) => (y - HORIZON) / (REF_Y - HORIZON);
// → 0.82, 0.89, 0.97, 1.06 ; ground plane spans y≈596..704
const depthT = (y: number) => (y - LANES[0]) / (LANES[3] - LANES[0]); // 0 far … 1 near
```

- **Spawn.** Pick the lane with the fewest zombies in the rightmost 300px, ties broken at random. Set `y = LANES[i] + R.range(-3, 3)`. Final scale is `depthScale(y) × R.range(0.96, 1.04)`; the jitter is per-zombie body-size variety. Store `z.lane`.
- **Why this works.** Adjacent lanes are 24–30px apart and the scale difference adds about 10–12px of head height, so x-aligned zombies in neighbouring lanes end up with heads about 35–40px apart vertically. That is more than a head's height (0.17 × 156 ≈ 27px), so heads stop stacking on one line.
- **Speed.** Do *not* scale walk speed by depth. Every lane must reach the wall at the same time for balance, and Last Stand does not scale speed either. Gait bob amplitude (`dy`) should still be multiplied by scale.
- **Sorting.** Sort key is `y + id × 1e-4`, which removes ties and flicker.
- **Lane changes.** Allowed only for avoidance (§3.5). Ease y at 40px/s and update `scale` continuously from `depthScale(z.y)`.

### 3.2 Atmospheric tint per depth

Per-lane bake parameters, applied to zombies (and to guards, using the defender lanes):

| lane | feet y | scale | brightness | saturation | fog tint `#1b2333` (source-atop α) | outline px | rim α |
|---|---|---|---|---|---|---|---|
| 0 far | 604 | 0.82 | 0.70 | 0.65 | 0.22 | 1 | 0.25 |
| 1 | 628 | 0.89 | 0.80 | 0.75 | 0.14 | 1 | 0.35 |
| 2 | 655 | 0.97 | 0.90 | 0.88 | 0.06 | 1.5 | 0.50 |
| 3 near | 685 | 1.06 | 1.00 | 1.00 | 0.00 | 2 | 0.65 |

Far zombies get dimmer, cooler, flatter and thinner-edged, and near zombies keep full contrast. Even so, the far lane must stay **brighter and more contrasty than the background directly behind it** (see §3.4). The rule is *background < far actors < near actors* in contrast.

The `fog` special keeps its x-based `farFade`, multiplied by `(0.6 + 0.4 × depthT)`.

### 3.3 Contact shadows (every actor)

Draw contact shadows in **one pass before the sorted actor list**. Shadows lie on the ground, so they never need sorting against actors.

```ts
c.fillStyle = 'rgba(0,0,0,0.5)';
c.beginPath();
for (const a of actors) { const rx = a.w * 0.38, ry = rx * 0.22; c.ellipse(a.x, a.footY + 1, rx, ry, 0, 0, 7); }
c.fill();
```

- Shadows stay at ground y while an actor bobs, lunges or climbs (`over` state), and shrink when the actor lifts: `rx *= 1 - lift/120`.
- Dying zombies: the shadow fades with the body's alpha. Crawlers (`drag`) use `rx = w × 0.5`.
- Add a second, softer shadow (α 0.25, rx × 1.6) cast **away from the floodlights**, offset +x by `12 × scale`. Floodlights and the house are on the left, so the shadow falls toward the horde.
- Guards, the barricade (one long ellipse along its base), turrets and wire posts all get contact shadows. In `expedition.ts`, so do the player, the follower and spot objects.

### 3.4 Treating the painted background

**Bake once** when the battle is constructed and cache it on `this.bgBaked` (a 1600×740 offscreen canvas). Never apply a per-frame filter to the background.

1. `x.filter = 'brightness(0.55) saturate(0.55) contrast(0.8) blur(1.2px)'`, then `drawImage(bg_mid)`, then `x.filter = 'none'`. The blur is depth of field: it softens the background's ink lines so the sprites' crisp ink lines become the in-focus plane.
2. **Atmospheric lift.** Fill a vertical gradient with `source-over` in cool fog `#1b2333`: α 0 at y 0, α 0.35 at y 380–520 (house and street band, the far distance), α 0.15 at y 560. Then fill with `multiply` `#0e1220` at α 0.5 from y 0 to 300 to deepen the sky. This replaces the current flat `rgba(14,18,30,…)` night grade over the whole screen. Keep `nightT` progression as an α on a second cached "late night" variant, and crossfade the two cached canvases. Never re-filter per frame.
3. **Target value ranges** (check by sampling luminance in a screenshot): background 12–40% luminance; actors' lit side 45–85%; actors' darks 3–10%. The play plane owns the extremes.
4. **The ground band is lit, not black.** Replace the 0.75→0.95 black road gradient with a dark asphalt plane, `#16171a` at α 0.55 from y 596 to 720, plus a cached ground texture in `this.ground` (wet asphalt speckle, faint tyre ruts along the lane ys at α 0.06). Floodlight and fire light holes should land **on the ground plane**: move the `hole()` y values to about 640–680 so the light pools sit under the zombies' feet.
5. **Separate the darkness into two passes.**
   - Pass A runs before the actors: the full `this.dark` mask (base α as now) over the background and ground.
   - Pass B runs after the actors: the same mask at **40% strength**, which keeps the actors unified with the scene without flattening them.
   - Implementation: keep `drawLighting` building the mask into `this.dark`. Draw it once at α 1.0 before the sorted list and again at α 0.4 after it. Do the additive warm glow and the vignette only after the actors, and soften the vignette to 0.45.
6. **Foreground layer.** Drawn after the sorted actor list, before particles: a strip of near-black (`#07080b`) weeds, kerb rubble and a tyre at y 700–720, never taller than 28px, and α 0.9. It overlaps the near lane's feet by at most about 10px, which sells the front plane without hiding targets. It parallaxes at **1.4×** the background's aim offset (`px × 1.4`), where the background moves 1×. Bake it once from procedural shapes into `this.fg`, or from an AI asset `fg_debris` if one is generated. Optionally add a blurred, out-of-focus dark post at the far right edge (x ≈ 1240) at 1.6× parallax as a framing element.
7. **Vignette.** Keep it, but use an ellipse weighted toward the bottom corners rather than a centred circle, so the HUD corners are dark and the lanes in the centre are clear.

### 3.5 Crowd separation

1. **Per-instance variation.** This is baked, not filtered per frame. At spawn, assign `z.variant ∈ {0,1,2}`:
   - 0 = neutral;
   - 1 = cold: brightness 0.9 plus `#5a6f8c` source-atop at α 0.10;
   - 2 = sickly: brightness 1.08 plus `#8a8a4a` at α 0.08.

   Avoid `hue-rotate`, which makes skin look wrong; use ±10% brightness and a light tint. Never give two zombies within 120px in the same or an adjacent lane the same `(sprite, variant)` pair; reroll the variant at spawn if they collide.
2. **Outline.** At bake time, stamp the silhouette (`shadeImg(id, '#050608')`) at 8 offsets of 1–2px, as in the lane table, under the sprite. Overlapping zombies then get a dark seam between them. The ink line already in the AI art is not enough at about 0.8 scale.
3. **Directional rim light.** This replaces the uniform `#a9b8c9` rim.
   - **Warm key**, `#f0c98a`: offset (−2, 0) × scale, so it falls on the front of a left-facing zombie. Use it when the zombie is inside a floodlight cone or within 300px of a fire. α = lane rim α × (0.6 + 0.4 × light), and add +0.3 for 0.1s after a nearby muzzle flash.
   - **Cool moon rim**, `#8fa6c8`: offset (+1.5, −1.5). Use it otherwise, at α = lane rim α × 0.6.
   - Both colours are baked silhouettes (`shadeImg` already caches per colour).
   - Mark-of-the-Ninja rule: a zombie outside every light pool also gets a 35% `shadeImg('#0a0b10')` overlay, which turns it into a near-silhouette. A zombie in light gets none. Walking out of the dark into the light pool should visibly "switch on".
4. **Spacing and avoidance.** In `update`, for each walking zombie, find the nearest zombie ahead (smaller x) in the same lane:
   - If the gap is less than `0.55 × w`, match that zombie's speed.
   - If the gap is less than `0.35 × w`, try to switch to an adjacent lane whose gap at this x is at least `0.6 × w`, easing y at 40px/s.
   - At the wall, each lane queues at `WALL_X + w/2 + k × 0.45 × w` for queue index k (the front one attacks). Cap at 3 visible per lane; extra zombies wait or shift lanes.
   - At spawn, stagger x by at least `0.3 × w` from any zombie in an adjacent lane, so heads alternate in x as well as y.
5. **Hover cue** (optional, cheap): the zombie under the crosshair gets its rim α +0.25, and a 2px ellipse on the ground at its feet in `rgba(240,216,144,0.35)`. That shows which lane the shot will go to (§3.6).

### 3.6 Hit tests and depth

**Recommendation: Last-Stand-style target-lane locking.** The current muzzle-ray against every zombie becomes wrong once lanes are deep. A ray from the muzzle (y≈556) up to a far-lane head passes through near-lane heads first, so nearer zombies "steal" shots aimed at the far lane. Fix it as follows.

1. **On fire**, choose the target lane:
   - (a) If the cursor is inside any zombie's hitbox, use that zombie's lane. If several match, take the topmost in draw order, i.e. the nearest — the one the player sees under the crosshair.
   - (b) Otherwise use the lane whose typical body column contains the cursor: `argmin_lane |cursor.y − (LANES[i] − 0.55 × 156 × depthScale(LANES[i]))|`.
2. **`castShot` takes `laneY`** and only tests zombies with `|z.y − laneY| ≤ 16`, the lane tolerance (the beat-'em-up z-band). A zombie standing in front in another lane never blocks the shot, which is the same as Last Stand's "the crosshair is the shot".
3. **Pierce continues along the same lane only.** Damage falloff is as now.
4. **Shotgun pellets** use the target lane at full chance, and the two adjacent lanes with a 25% chance per pellet, so buckshot "sprays" through depth a little.
5. **Misses.** The tracer ends where the ray reaches `laneY`'s ground row (replacing `LANE_BOT`). Ground sparks land at `laneY`, so a miss visibly lands *in that lane*.
6. **Guard AI.** Targets are chosen from all lanes, as now (nearest to the wall first), and their shots lock to the target's lane. This keeps guards from wasting shots on occluding near-lane zombies.
7. **Firebomb and explosions.** Use a ground-space ellipse, `(dx/r)² + (dy/(0.3r))² ≤ 1`, centred at the impact foot point, so splash covers about 1–2 adjacent lanes.
8. **Particles.** Keep `ground: z.y` for blood (it already lands on the actor's lane).

### 3.7 Guards and barricade in depth

- **Defender lanes.** Use two rows behind the wall, `DEF_LANES = [662, 688]`, and scale guards by `depthScale`: 0.98 and 1.08. The player-controlled guard goes on the near row (688) at the slot closest to the wall, so the most important actor is the largest and most contrasty. Alternate the other guards between rows, with x slots spaced at least 62px. Put name labels at `y − h − 14`, and when two labels are within 50px in x, offset the far-row label up by 14px.
- **Guards keep full brightness**, lane 3 parameters on the near row and lane 2 on the far row. They also get a constant warm rim from the house lantern (`#f0c98a` at offset (+2, 0), because they face right and the lantern is behind them on the left). Remove the 0.45 dark overlay when unlit, and use the depth table instead. Survivors must never be darker than the background behind them.
- **Barricade.** It spans the whole ground plane. Draw the wall image so its base sits at y 704 and give it sort key **700**, which puts it in front of every walking lane. The wall sits at x < WALL_X+10 and zombies stand at x > WALL_X, so overlap only happens while climbing. Zombies in `over`/`maul` state get sort key 702, so they draw over the wall.
- **Perspective-skewed wall face.** Make the wall face depend on lane: `wallX(lane) = WALL_X + (685 − LANES[lane]) × 0.12`, which puts the far lane about 10px further right. Zombies in each lane stop at their own `wallX`. That reads as a wall seen slightly from the side and stops the far queue overlapping the near one.
- **Wire, traps and fires.** These span all lanes. Draw wire posts at both ends of the band (y 600 and 704). Draw trap markers as ground ellipses in their lane. Fires stay ground-level: sort key = their y, and their glow sits on the ground plane.

### 3.8 `expedition.ts`

- Use the same `depthScale`. Use **3 lanes**: `[640, 664, 688]`. The player stays on 664, and zombies spawn on any of the three. Hit lock works as in §3.6 with lane tolerance 16. Player melee or grab range only applies within ±1 lane.
- Bake `bg_far` and `bg_mid` once into filtered canvases (far: `brightness(0.7) saturate(0.5) blur(2px)` plus fog lift; mid: as in §3.4 but brightness 0.8 by day). Apply the dusk grade only as a crossfade between two cached variants, not as a full-screen fill over the actors.
- Contact shadows for the player, the follower, zombies and spot objects. Draw the foreground strip at 1.3× camera speed (`cam × 1.3`).
- **Searched spots.** Replace the per-frame `filter = 'brightness(0.6)'` with alpha 0.55 by a baked dark variant at alpha 1. This removes the translucent-box artefact in `6-run.png`.
- **Kin zombies.** Replace the per-frame `filter = 'saturate(0.4) brightness(0.8)'` with a baked variant.

### 3.9 Performance notes

- **Sprite bake cache.** Key: `${sprite}|${lane}|${variant}`. Bake at the **lane's display size**, `h = def.height × ZS × depthScale(LANES[lane])`, so per-frame draws are close to 1:1 and only the ±4% body jitter is scaled.
  - Each bake: outline stamps, then the sprite with `filter` (brightness and saturate, bake-time only), then the fog tint (`source-atop`), then the variant tint.
  - Size: about 15 zombie sprites × 4 lanes × 3 variants = 180 canvases of roughly 90×170px, about 11 MB total. That is fine.
  - Bake lazily on first use, or on load during the night intro (the 3s intro is free time).
- **Rim and flash.** Rim silhouettes (warm and cool), flash and burn stay as per-sprite `shadeImg`/`flashImg` caches at source size. Optionally pre-scale them per lane too.
- **Zero per-frame `ctx.filter` in either scene.** Today `expedition.ts` uses per-frame filters for searched spots and kin zombies. That is the Firefox software-path risk ([bug 1602299](https://bugzilla.mozilla.org/show_bug.cgi?id=1602299)).
- **Batching.** All contact shadows go in one path and one `fill()`. The foreground strip and background are single `drawImage` calls from cached canvases. The darkness mask is already drawn at half resolution (`s = 0.5`), so keep that; it is now drawn twice, and that is cheap.
- **Integers and sorting.** Round draw x/y to integers for the 1:1 baked sprites to avoid resampling blur. Sort keys are now discrete lanes plus a small id epsilon, so the sort stays stable and cheap. 60–80 actors is trivial.
- **Cache invalidation.** Invalidate the bake cache only when sprites reload (asset hot-reload). Weather or special-night variants (fog, snow, crossing) change the **background bake and lighting**, not the actor cache, except fog, which multiplies alpha at draw time.

---

## 4. Checklist to validate

1. Take a screenshot and convert it to greyscale. Each zombie's head and shoulders should be identifiable as a separate shape against the background, including over the wrecked truck.
2. Squint test: the eye should land on the lane band (y 500–704) first, not on the house facades.
3. With 12 or more zombies at the wall, no two heads should overlap by more than about 30%.
4. Clicking a far-lane zombie that stands behind a near-lane zombie should hit the far one.
5. Firefox performance profile: no `filter` work in the frame flame graph.

---

## 5. Night lighting, separation and grade (2026-11 pass)

The complaint: figures standing close blended together, and the frame was one bland dark, every surface at about the same saturation and value. The fix is a faux-HDR balance: real highlights (lamp heads, flash cores, sodium rims, lit faces) near-white and saturated, deep darks elsewhere, and hue that varies across the frame. Everything is cached or a handful of blend layers. There is no per-pixel JS and no per-frame `ctx.filter`.

**Per figure** (`night/actors.ts`, `battle.ts` `GUARD_LOOK` / `occlude*`):
- *Key from behind the line.* Defenders get a saturated rim on the side facing the light: sodium `#ffa040` when floodlights are up, the lantern otherwise, weakening with distance from it. It sits over the ink line (`rig.rim`, about 0.9× the outline width).
- *Cel bands by light direction.* Through the rig's existing hooks, with no rig edits, the body is redrawn inside a slanted half-plane clip using a shaded, blue-hazed grade. That gives one hard terminator. At High, a third and deepest band on the far edge stands in for a normal-mapped falloff (the bevel / inner shadow). A muzzle flash in front of the body cancels the bands for that frame, because the body is front-lit. Medium draws one band and Low draws none. The Turned get the two-band version at High when lit.
- *Row value stagger.* The far row is cooler, darker and blue-hazed (b 0.84, s 0.72); the near row is warm and saturated (b 1.1, s 1.25). Two defenders side by side on alternate rows never share a value.
- *Occlusion halo.* A body that overlaps one standing behind it draws a soft dark blob just before itself in the sorted pass, so the figure behind darkens round its silhouette.

**Practicals:** the sodium floodlight pools have an orange skirt and a hot pale core; the beams are warm; the lamp heads use cached soft dots; a flash gets a white-hot core. These go in the additive pass (emissive only, so nothing else blooms). The GL bloom in `vfx/gl.ts` stays as it was.

**Frame** (`battle.ts` `drawGlow`, `drawGrade`):
- The darkness veil is moonlit blue rather than grey, and the lantern opens a lit island up the firestep.
- A cached half-res vignette with a top-down sky falloff, plus a dull ember sky glow over the far town (one cached 320×60 strip, additive). The sky stops being a single flat blue.
- *Grade, Effects High only, four full-frame blend layers:*
  1. A blue soft-light wash (shadow leg of the split tone).
  2. A colour-burn by a near-white (levels black point k ≈ 0.05, at 65%; the S-curve toe).
  3. The frame added onto itself at 38% (exposure / shoulder: highlights clip toward white).
  4. A colour-dodge by a dark amber (R ×1.12, G ×1.05), the highlight leg. Being proportional, it warms the lit areas and leaves the blue darks alone.

  A self-governor turns the grade off for the night if its smoothed cost passes 1.5 ms, which happens on a software-rastered canvas. The Canvas2D path is used even when the GL effects layer is on, because a GL grade would need the whole 2D frame uploaded as a texture every frame.

**Measured** on staged frames: the packed firestep (all six defenders, alternate rows 40 px apart) and a cluster of 15 Turned, with 0 and 2 floodlights, at dpr 2. Values are relative luminance; "con" is a figure against the same pixels with the figure removed.

| | before (dark / lit) | after, High (dark / lit) | after, grade off (dark / lit) |
|---|---|---|---|
| frame L p5 / p50 / p95 | .052 .122 .264 / .068 .170 .327 | .033 .113 .356 / .040 .160 .467 | .048 .117 .293 / .055 .151 .380 |
| L spread p95−p5 | .212 / .259 | .323 / .427 | .245 / .325 |
| saturation mean / sd | .253 .078 / .196 .082 | .570 .190 / .449 .176 | .395 .132 / .301 .117 |
| Turned vs road (con) | +.129 / +.136 | +.204 / +.153 | +.161 / +.131 |
| defender neighbour ΔL / Δhue (dark · lit) | .063 / 74° · .039 / 11° | .058 / 44° · .066 / 35° | .039 / 24° · .039 / 20° |
| Turned cluster edges (mean ∣∇L∣ / share > .12) | .113 .353 / .125 .412 | .137 .457 / .148 .474 | .112 .373 / .124 .408 |

With the grade on, the darks go deeper and the highlights brighter: the luminance spread grows 52–65% and the saturation spread more than doubles. Edge strength inside the Turned cluster, a measure of where one body stops and the next starts, rises by about 20–30%. The Turned stay at +0.15 or more against the road. Lit-scene defender neighbours now differ by about 0.07 in value and 35° in hue; before they shared a hue (11°). In the unlit scene the hue gap narrows from 74° to 44° because everything takes the moon cast. Without the grade (Medium, Low, or governed off), the spread and saturation still widen, but neighbour ΔL stays at the old level.

*Cost.* Measured in headless Chromium, which rasterises the canvas in software (dpr 1, 24 Turned plus the firestep, median of 5×30 frames). With the four grade layers, the whole High frame costs 6–7 ms more than with every new piece off. In that environment the governor turns the grade off within 20 frames. The other new pieces together (cel bands, occlusion halos, rims, sky glow, pools) cost about 0.5 ms at Medium, which is within noise. On a GPU-composited canvas the grade is four blend draws. The previous frame-wide per-frame radial-gradient vignette is now a cached bitmap.
