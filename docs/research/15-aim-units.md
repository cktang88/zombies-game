# Aim units: coverage for every survivor and the guns guards hold

Follow-up to [14-sprite-critique.md](14-sprite-critique.md) §3. An *aim unit* is the torso, head, both arms, both hands and
the gun painted as **one drawing** in the firing pose. While a guard's gun is up, the rig draws it in place of the
rigged torso, arms and held gun (`src/anim/rig.ts`, `this.unit`). The rig's own hips and legs stay underneath.
Every other state (low ready, walking, reload, ready) still uses the rigged arms. If a rig has no unit for its gun,
the old rigged arms are the fallback, so a missing unit costs looks, not correctness.

Main had 15 units, mostly each character's signature gun. This pass gives every survivor rig its own unit for the
five core gun classes, plus the auto shotgun and the LMG where the result held up. That is 66 new drawings and
81 units in all.

## Pipeline

1. **Template** `npx tsx tools/aim-guide.ts <rig> <weapon>` → `tools/rigs/src/aimguide_<rig>_<weapon>.png/.json`.
   It draws the rig's own torso and head silhouettes, capsule arms (near arm light grey, far arm dark grey) and the
   real gun icon in a correct side-view firing pose, on magenta. The `.json` beside it holds the pelvis, neck, muzzle
   and butt points in image px, plus the px-per-rig-unit scale `k`. These are the first guess for the cut.
   - Shouldered long guns: the butt sits in the shoulder pocket, with a 0.16 rad lean and the chin down on the stock.
   - Pistols: arms out at shoulder height.
   - Stockless long guns (the riot auto shotgun, whose `butt` is only a few icon px behind the grip): held out in
     front of the chest, not shouldered.
   - The LMG (`stance: 'hip'`): hip fire, with the butt under the armpit, the gun at the belt line and the head up.
2. **Generate** `npx tsx tools/gen-parts.ts --manifest=tools/sprites-parts-aim.json aim_<rig>_<weapon>`.
   The template goes in as the first image and the character's reference as the second. Each prompt keeps the
   template's framing and facing (right), wants both hands on the gun and no grey left unpainted, and borrows the
   character text from the rig's own prompt. The raw image lands in `tools/.cache/parts-raw/`. Copy the pick to
   `tools/rigs/src/aimunit_<rig>_<weapon>.png`, which is committed so the cut can be reproduced.
3. **Cut** `npx tsx tools/cut-unit.ts <rig> <weapon> --match` → `public/sprites/parts/unit_<rig>_<weapon>.png/.json`
   at 1 px per rig unit. The cut does the following:
   - chroma key and speck removal;
   - finds the muzzle as the opaque pixel farthest along the bore near the guessed muzzle;
   - finds the bore angle from the gun's own axis, not from butt to muzzle;
   - `--match` applies half of a per-channel gain toward the rig's torso colours.

   Overrides go in `tools/rigs/src/aimunit_<rig>_<weapon>.points.json`. Any key left out comes from the template.
   - `pelvis`, `neck`, `muzzle`, `butt`, `ppu`: for when the model moved or rescaled the figure. Pistols often need
     these.
   - `cutY`: drops every row below a source y. Use it when the model painted trousers below the jacket hem, which
     would show as a pale band of "shorts" over the rig's own legs.
   - `degrey: true | [[x0,y0,x1,y1], …]`: drops large flat-grey areas the model left from the template. Boxes limit
     where it applies, because a grey garment or grey hair would match too.
   - `shade: [[x0,y0,x1,y1], …]`: inside these boxes, template grey is the far arm the model left unpainted. It is
     repainted as the figure's own mid-tone in shadow, not dropped, so the support hand does not float.
4. **Register** the unit under `aimUnits` in both `tools/rigs/<rig>.json` and `public/sprites/parts/<rig>.json`
   (`{ "<weapon>": "unit_<rig>_<weapon>" }`). At load, `assets.ts` stacks the drawings under the atlas.
5. **Share** (`AIM_UNIT_SHARES`, `src/anim/assets.ts`): a gun whose held silhouette matches another gun's borrows that
   unit, unless the rig has its own. Current shares: carbine → ar15, scoped → hunting, r22 / muzzleloader → lever,
   coach gun → pump, and service9 ↔ m1911. This pass added no shares. The remaining candidates do not match:
   - the mp93 has a foregrip and a long magazine;
   - the revolver has a different frame and grip;
   - the .410 snake charmer is a one-hand pistol-grip shotgun;
   - the auto shotgun and the LMG are held differently from everything else.

### Verification

- **Overlay.** Use `animlab.html?closeup&still&cols=N&h=300&only=<rig>&w=<guns>`, and `&aim=-0.4` / `&aim=0.3` for
  steep aims. Draw `rig.muzzleWorld()` as a cross and `gunAngleWorld()` as a line along the barrel. All 81 units
  were checked at aim, −0.4 and +0.3. In every case the muzzle sits on the barrel tip and the line runs down the
  barrel. Both hands are on every long gun, and every unit faces right.
- **Grey and magenta scan.** Look for connected flat-grey blobs of 20 px or more, and for magenta edge pixels, in
  every `unit_*.png`. No unit has magenta fringe. The grey blobs that remain are all real: grey hair (surv_f_old,
  surv_m_old), surv_smg's grey hood, surv_f_young's white sleeves and the steel of the guns.
- `node tools/e2e/pose-check.cjs`: every rigged pose is within the real-arm ranges, and the 87 poses drawn by a unit
  are skipped. `npx tsc --noEmit` and `npm run build` are clean.

## Coverage (rig × gun → unit / shared / fallback)

`unit` means the rig's own drawing, `shared (x)` means it borrows the rig's unit for gun x through AIM_UNIT_SHARES,
and `—` means fallback to the rigged arms.

| rig | ar15 | carbine | pump | coach | smg | service9 | m1911 | hunting | scoped | autoshot | lmg | lever | revolver |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| surv_rifle | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | unit | unit | — | — |
| surv_pistol | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | — | — | — | unit |
| surv_shotgun | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | unit | — | — | — |
| surv_smg | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | unit | unit | — | — |
| surv_idle | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | unit | — | — | — |
| surv_f_old | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | — | — | — | — |
| surv_f_mid | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | unit | unit | — | — |
| surv_m_mid | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | unit | — | — | — |
| surv_m_young | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | — | — | unit | — |
| surv_f_native | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | — | — | — | — |
| surv_m_old | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | — | unit | — | unit |
| surv_m_big | unit | shared (ar15) | unit | shared (pump) | unit | unit | shared (service9) | unit | shared (hunting) | — | unit | — | — |
| surv_f_young | unit | shared (ar15) | unit | shared (pump) | unit | shared (m1911) | unit | unit | shared (hunting) | — | — | — | — |
| z_raider | — | — | — | — | — | — | — | — | — | — | — | unit | — |
| z_raider2 | — | — | unit | shared (pump) | — | — | — | — | — | — | — | — | — |

Totals:
- 13 survivor rigs × 5 core classes = 65 of 65 covered, by their own unit or, for surv_f_young's service9, by her
  m1911.
- Auto shotgun: 6 of 13 rigs have a unit.
- LMG: 5 of 13 rigs have a unit.
- Signature guns: lever (surv_m_young) and revolver (surv_pistol, surv_m_old).
- The two raiders keep their single units from main.

Every other gun still falls back to the rigged arms: mp93, revolver on other rigs, snake410, lever on other rigs,
the bows, the launchers and the tools. The auto shotgun and the LMG also fall back on the rigs that have no unit
for them.

### Fixes in this pass, and known compromises

- surv_f_mid autoshot (`cutY 790`), surv_pistol service9 (`cutY 768`), surv_smg ar15 (`cutY 798`) and surv_smg
  autoshot (`cutY 850`): the model painted the trousers below the hem, which showed as a pale band of "shorts" over
  the rig's legs. surv_pistol service9 is cut without `--match`: once the jeans were gone, the gain region was all
  vest, and the gain turned the skin grey.
- surv_rifle hunting: a light-grey template blob under the support elbow was removed with
  `degrey [[450,495,515,550]]`.
- surv_m_old pump: the model painted the template's grey hands as light-grey gloves. They are shaded and outlined,
  so they read as gloves, and the unit is kept.
- surv_smg hunting: the far arm is painted as a near-black shadow shape. It reads as the arm in shadow, and the unit
  is kept.
- Rejects: no cut unit was rejected in this pass. Six first generations were rejected earlier in the batch and
  re-rolled, and the second take is the one shipped: surv_rifle lmg, surv_f_mid autoshot, surv_pistol service9,
  surv_shotgun service9, surv_shotgun autoshot and surv_m_old service9.

## Spend

Budget approved: $5.00 including retries.

| measure | count | cost |
|---|---|---|
| Rule given for the estimate: `tools/rigs/src/aimunit_*.png` added on this branch vs main × $0.068 | 66 | **$4.49** |
| Generation log (`gen-parts.ts` reports the cost of each call, including the 6 re-rolls) | 72 calls | $4.97 |

Templates and cuts are local and cost nothing. The log total is just under the $5.00 cap, so this pass made no
further generations. Filling the remaining auto shotgun (7 rigs) and LMG (8 rigs) gaps would cost about $1.00 more,
with retries on top.

## Contact sheet

`/tmp/claude-0/-home-user/8bd06cb1-c6ac-5391-b55a-fe2040c590af/scratchpad/aimunit3/contact_sheet.png` has one row per
survivor with all its units at aim (h=400). A third-size copy is `contact_sheet_small.png` in the same folder.
