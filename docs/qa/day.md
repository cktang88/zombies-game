# QA: the day

System-by-system pass over the day: the house view and the ledger (L), the Today list, jobs and hours,
the workshop, the armory, the wall and chores, kitchen / rations / still, infirmary, bunks, radio, the
table (counsel, break risk, journal), calendar, gate / runs / site picker, town, graves, the survivor
sheet and perks, every incident card (`__story.event` for all 64, both first and last choice), the dusk
report, the dawn report and its For today box, and the day sim underneath (`sim/day.ts`, `readiness.ts`,
`tomorrow.ts`).

Played with Playwright against `vite preview`: a fresh Siege game days 1–5 through dusk, deploy, night and
dawn; the staged day-12 save (`tools/stage-save.ts 12`); every station opened; drag-assign; click-assign;
Tab / Enter / Esc / L; viewports 1920×1080, 1440×900, 1280×720, 1024×768 and 390×844 (phone).

Severity: **high** = loses progress or blocks play; **med** = misleading numbers, a wasted day the game
does not warn about, or a control that cannot be reached; **low** = wording, clipping, polish.

## Fixed

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| 1 | med | Picking a person zoomed the camera onto them, which pushed the yard (gate, wall, bench, board) off screen: "click a place to give that job" could not reach half the places. | `f501aac` the whole scene shows beside their card, places named |
| 2 | med | An incident's outcome (and a run's haul, a chore, a perk) was pushed to the end of the morning's lines: in the house view that is inside a closed fold, in the ledger past "+N more". A choice had no visible result. | `dfa66ed` newest first; the house note shows the newest line unfolded |
| 3 | med | A scavenger left on a picked-clean place (and the run, which defaulted to Route 9 even when clean) spent the day for 15% of a haul with no warning anywhere but the site card. | `f2779a6` job line says so, a Today item, the run defaults to a place with stock |
| 4 | med | The leader starts on Repair with a whole wall and spends every day "finding nothing to patch"; nothing flagged it. | `e685d79` listed as idle in Today |
| 5 | med | For today called "tonight is a tide" from the Siege's cycle on every persona (wrong on the Quiet and the Coin, silent on the Crossing). | `241413f` reads the calendar |
| 6 | med | The first dusk press with carried-over jobs turned the button into "Go anyway" with no reason given (the Today item explaining it was often pushed past the top four). | `9e0a737` the bar says why |
| 7 | low | Old saves: the first look at any system (workshop, armory, …) showed a "New." note for the rest of the day. | `315c320` |
| 8 | low | Calendar station summary said "tonight ordinary" while the calendar beside it said BIG. | `8f8d8f2` |
| 9 | low | Deserters got a grave marker and read as died (house art, graves list, sheet, people list). | `9bd9383` gone, "left Nov 17" |
| 10 | low | Empty muzzle and magazine slots both read "M". | `68f0504` MZ / MG |
| 11 | low | Ledger workshop cards cut names to "Coppe...", "Pistol ro...". | `30702bd` two lines |
| 12 | low | Tend wounded outlook ignored the medicine perk the day's work applies. | `6a1a03d` |
| 13 | low | For today said "timber" (now salvage) and "the Armory" (the house calls it the gun rack). | `71df2a4` |
| 14 | low | For today told you to hand out a gun when the rack was empty. | `4e1272b` |
| 15 | low | Waiting perks never reached Today while that person's job was carried over (i.e. most mornings). | `8dbf314` |
| 16 | low | Site picker: a picked-clean place still said "you need food" and showed no stock. | `a8d5263` |
| 17 | low | Dusk: a scavenger's haul ("…: 5 food, 9 salvage") was filed under Food. | `0310112` |
| 18 | low | Bunks panel ended with an orphaned "SLEEPS IT OFF". | `d785baa` says what rest does |
| 19 | low | The table's Talk list named the people near breaking with no chance shown. | `520305b` |
| 20 | low | A fresh house scene showed everyone aiming their gun across the room for a moment (rigs ease from aim to low ready). | `8b11fbf` |
| 21 | low | `__story.event('deliver_*')` threw without a running thread (test hook). | `abb5efa` |

Count: 0 high, 6 med, 15 low fixed.

## Checked, fine

- All 64 incidents open (`__story.event`) with no `undefined`/`NaN` (except `found`, which only the hook can
  open without its flag), and resolve with the first and the last choice with no page error.
- Workshop: queue / ETA / cancel refunds exactly; machinery builds; queue buttons disabled when short.
- Armory: attach / detach mods, give-to, arm everyone (Today one-click) hand out the right guns.
- Rations toggle, oil the guns, haul / burn the pile, hours − / +, job select, weapon / melee select,
  vest, perk pick on the sheet; each re-renders at once.
- Esc closes the sheet, then the site picker, then the panel; Enter on a focused place opens it; L flips
  views both ways; Enter goes to dusk (arms first with carried-over jobs).
- Phone (390×844): ledger, house, panels as bottom sheets, event cards scroll, site picker.
- `simtest 2`, `smoke`, `ui-check`, `pad-check` clean (the "D-pad down from a fold head" failure no longer
  reproduces).

## Left

- **Ledger has no rations toggle** (low): half rations is set only from the kitchen (house view) or the
  rations incident; the ledger's Today item only goes back to full. Not a regression (the ledger never had one).
- **Station labels sit against the painted bulbs** in the infirmary and kitchen (low, art placement).
- **Phone: the "Put X here: …" assign label runs off the right edge** for places near it (low).
- **Arm everyone can hand an unarmed guard a dry gun**; the "can't shoot" item then stays with nothing to
  click (low; by design it prefers a gun for later over none).
- **Building machinery has no undo** (one click spends e.g. 42 of 48 salvage); queued recipes do refund.
- `stage-save.ts` leaves every survivor with several perk offers and the day-12 save's Route 9 picked clean;
  both are staging artefacts, not game bugs.
