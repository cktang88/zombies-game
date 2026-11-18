# 17c: HUD simplify pass (night battle and runs)

The player: "do a pass in ui lots of redundant elements and text and stuff can all be simplified
and unified." This note covers the in-game canvas HUD only (night: `src/night/hud.ts`,
`battle.ts`, `emplacements.ts`, and the module overlays `traps.ts`/`melee.ts`; run:
`src/night/expedition.ts`). DOM screens are out of scope.

Audit from full-resolution captures (`tools/e2e/shots.cjs night nest run crossing`, 2560x1440),
before any change.

## Night: what was redundant

| # | What | Where | Why it is redundant / noisy |
|---|------|-------|------------------------------|
| 1 | Wall shown twice: "350" big number and a 12-segment bar | top left | Same quantity twice; the bar (with its drain ghost and flash) is what you read mid-fight. |
| 2 | "WALL" word next to the wall icon | top left | The icon already names it. |
| 3 | Top-centre line "HOLD UNTIL DAWN · 77 LEFT · 11 DOWN" under a clock | top centre | The clock already says "until dawn"; the objective only needs saying when the road is clear. |
| 4 | Three panel styles in the corners: a 0.7 rounded box (wall), a 0.6 square strip (nerve), a 0.55 rounded box (nest rows), a left-to-right gradient (weapon), a flat 0.55 strip (road ribbon) | all corners | Same job, five looks. Wall and nerve sit in two touching boxes of different widths. |
| 5 | Gun name in caps ("SERVICE PISTOL") over the gun's picture | top right | The picture is the gun; the name already floats at the cursor when you switch. |
| 6 | Guard labels: name + bar + order glyph + state dots on every guard, all the time | the line | Six labels stacked over the firestep at all times; most of the time nothing about them changes. |
| 7 | Floating combat text stacks: e.g. "KNOCKED DOWN" + "LEGS" + "burst — clear of the wall" on one body in the same half second | world | Only same-word dedupe; different words on one spot pile up. Font sizes 10-18 bold with ad-hoc colours. |
| 8 | First-night key chips (reload / duck / focus / guard) while the coach says "Reload before they reach the wall" with the same [R] | bottom left vs centre | Same key, two places. |
| 9 | Traps line "traps: [L] lure ×2 · [K] deadfall" in plain text at the bottom | bottom left, above key chips | A second key-hint style (bracket text instead of keycaps) in a second row. |
| 10 | Downed guard: name and "DOWN" on two plain lines; named Turned and downed labels with no backing, unlike every other label | world | Two label styles. |
| 11 | Per-frame `texts.filter(...)` allocation | battle.update | Allocation each frame; replaced with in-place compaction. |

## Run: what was redundant

| # | What | Where | Why |
|---|------|-------|-----|
| 1 | The whole key list as an 8-second ticker line ("[A/D] walk · [E] search · …") | top, over the status panel | Overlaps the status panel; a wall of keys. Belongs on a held key sheet. |
| 2 | Gun name in caps over the gun picture | bottom right | As night #5. |
| 3 | "PACK 0/18" plus a separate "EMPTY" | bottom left | 0/18 already says empty. |
| 4 | Mate's name always over their head, and again in the status panel | world + top left | Name in the panel is enough; over the head only when down. |
| 5 | "standing still" over every sleeping Turned on screen | world | Only matters for the ones close to you. |
| 6 | Status panel a different box style from the night's | top left | Unify with the night's panel. |

## What changed (commits "HUD: …" / "Run HUD: …")

- `hud.ts`: one `panel()` for every HUD box (same fill, radius, hairline) and one
  `worldLabel()` for every word over a body (13 px, 16 px for the big moments, dark backing).
- Night top left: wall and nerve in one panel, both rows labelled the same way ("WALL", "NERVE");
  the wall is the segmented bar only (the number went). Nest rows use the same panel and width.
- Top centre: the clock, then "77 to come · 11 down" ("road clear · hold until dawn" once nothing is left).
- Top right: road ribbon and weapon in the shared panel, aligned; the gun's name went (its picture
  is the gun; the name shows at the cursor on a swap); the melee row ([V] + tool + stamina) sits
  inside the weapon panel's foot.
- Guard labels: only the leader, the hovered or selected guard, or one something is happening to
  (pain went up in the last 3 s, below half health, hauling, panicking or raging, bitten).
- Floating text: one message per spot (90 x 60 px). A new word near one already showing replaces
  it if it is at least as big (important), otherwise it is dropped. The per-frame `filter` became
  in-place compaction.
- Key chips skip a key the coach is teaching; the traps' line became keycap chips in the same row
  (lure ×N, deadfall/pipe mine, the propane); lure and trap rows added to the F1 sheet.
- Downed and named-Turned labels use `worldLabel`; the coach and Bellwether boxes use `panel`.
- Run: the 8-second key-list ticker became a short line ("walk · search · hold [F1] for keys")
  and a held [F1] key sheet in the night's style, with an "F1 keys" chip beside the pack count;
  status panel in the shared style; gun name gone (shows "reloading…" only while reloading);
  "EMPTY" under "PACK 0/18" gone; the mate's name over their head only when down (it is in the
  status panel); "standing still" only within ~420 px of you.

## Left for later

- The pause screen (DOM, other agents) could list the same key groups as the F1 sheet.
- The run's bottom-right gun block has no panel (it sits over the road's feet line); the night's moved to the top for that reason, the run could follow.
- Ticker (news line) keeps its own lighter backing; it is a message, not a panel.
