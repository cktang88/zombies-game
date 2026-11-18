# 17b · UI simplify pass: every screen but the day and the night HUD

The player: "do a pass in ui lots of redundant elements and text and stuff can all be simplified and unified."

Companion to 17 (the day screen and the shared kit). Audited from a staged day-12 save
(`tools/stage-save.ts 12`) at 1280×720, device scale 2: title, Ledger, survivor sheet, site picker,
incident card, dusk report, deploy (posts, guns, road), pause, dawn report, run return, settings
(every tab), help (every tab, guide card), first-day hints, ending. Same rule as 17: keep the one
clearest place, move the sentence into a hover tip (`kit.tip`), never drop a fact outright.

## Same fact shown more than once

| # | Screen | Fact | Where it showed | Keep | Status |
|---|--------|------|-----------------|------|--------|
| 1 | Help | What each day job does | "The day" tab (7 job cards, missing Drill and Counsel) and the guide's "Day jobs" group (all 9, with spend → get) | the guide; the day keys (dusk, help) move under its lede; the tab goes | done |
| 2 | Help | The barricade is your health bar | "The wall" tab card and the guide's "The wall" card | the guide | done |
| 3 | Help / Settings | The whole key list | Help › The wall › Keys and Settings › Controls, both open | both (one reads, one rebinds), but Help's list starts folded | done |
| 4 | Help, Settings | Close | a × in the corner and a Close / Done button at the bottom | the × (Esc and a click outside also close) | done |
| 5 | Pause | Resume keys | a "P Esc resume" line above the buttons, then the Resume button | the keys as kbd caps inside the Resume button | done |
| 6 | Dawn | Which night | "Dawn, Nov 18" and a right-aligned "the Nov 17 night" | the title; the night in its tip | done |
| 7 | Dawn | Wall damage | a "wall lost" tally tile, then the wall bar with "350 / 350 · −N" | the bar (it animates the loss) | done |
| 8 | Dawn | Rounds spent by type | the "rounds" tile's tip and a row of chips per ammo type | the tile (total) with the breakdown in its tip | done |
| 9 | Dusk | Lines per group | each "day's work" fold showed a count that is 1 for nearly every group, beside the first line | count only when there is more than one line | done |
| 10 | Dusk → Deploy | The date | "Dusk, Nov 17" on the report, then "Dusk, Nov 17. The road." on the road planner | the report; the planner says "The road" | done |
| 11 | Run return | The loot | chips (4 food, 3 scrap, 12 with no icon) and the sentence "Brought home: 4 food, 3 scrap, 12 r9." | the chips, with icons for every resource and the names in tips | done |
| 12 | Ending | Days, Turned put down, headshots | the sub line under the title and the score tiles | the tiles; the sub line keeps the dates and the seed | done |
| 13 | Survivor sheet | Mood | a mood chip in the header and the Mood section's big number + word (open by default) | the Mood section | done |
| 14 | Survivor sheet | Rest | header status, the Body head ("rested 26%") and a tired chip inside Body | the Body head; the chip inside goes (fed stays) | done |
| 15 | Event card | What a choice risks | an icon + a word ("time", "standing") beside the button, then the hint sentence under it | the icon and the sentence; the word becomes the icon's tip | done |
| 16 | Title | How the game goes | "Hold a house on Ferry Road…", two "Day work" / "Night the wall" chips, and the "how to play" button | the line and the button; the chips' text (setting, night keys) becomes the line's tip | done |

## Paragraphs that could be a line

| Screen | Text | Now |
|--------|------|-----|
| Site picker | "Every place has its own stock. Big icons: lots of it. Far places eat the day in walking." under the heading | the heading's (i) tip (done in 17's kit pass) |
| Site picker | each card's two-sentence place description, and "++" after a big icon | the card's tip; the card keeps "7h searching"; the big icon alone says lots |
| Deploy, posts | "one at the loophole, one on the roof" | the header's tip |
| Deploy, guns | "heavy-weapons training decides how well a crew works one" and each gun's niche sentence | the header's (i) tip / the gun name's tip |
| Deploy, posts | "(cheaper at the workbench)" after the roof-nest cost; what each post does only after you pick it | the button's tip; every post's job also in the Posts (i) |
| Ledger (title) | "0 Novembers on Ferry Road. Longest held: 0 days. Best score: 0."; "No names yet. At the end of a run…" | three chips; "No names yet." with the rest in the Names (i) |
| Ending | "Inscribe in the Ledger" on every grave card under "Inscribe up to two names in the Ledger." | "Inscribe" |
| Settings | "Saved on this device." | the Data tab only (where it matters) |
| Guide | lede "Everything costs something. Here is what, and what it buys." over the two sub-tabs | kept (one line, it is the guide's thesis) |

## Same kind of element, several styles

| Kind | Variants | Unified to |
|------|----------|-----------|
| close | `.close` ×, `.go` Close/Done, `.go` "Close ›" (Ledger) | the × everywhere a dialog has one; `.go` only for a step forward (Continue, Resume, Begin again) |
| info "?" | `.qi` in deploy, `.qi` in hints, `(i)` in settings | `.qi` (the kit's, from 17) |
| loot / resource amount | `chip()` with an icon lookup that only knew ammo (food/scrap fell back to a bare id) | `chip()` with `RES_ICON` for every resource |
| locked boon in the Ledger | an empty ☐ like an unticked one, then "Locked. …" | no box, a `kit.tag('locked')`, then how to unlock |
| (i) marks | deploy's own `?` spans (road, a trap's counter) | `kit.qi` |
| native `title=` | the Daily Vessey button | `kit.tip` |

## Left alone (and why)

- Dawn "click to skip": it is the only hint that the report animates and can be skipped.
- Survivor sheet skill rows (icon · name · pips · number · xp bar): the number reads faster than ten pips, the bar is progress to the next level; three facts, not one.
- Epilogue grave cards' "lived" label next to an epitaph that starts "X lived": the label is the fate filter (lived / buried / stayed), the epitaph is prose that sometimes says otherwise ("made it", "across the river").
- Onboarding note: already one line with the rest in the (?) tip.

## Commits

Help tab and barricade card · Settings close · Pause keys · Dawn wall/rounds/night · Run-return loot ·
Dusk counts · Deploy notes → tips · Event stake words · Survivor sheet mood/rest · Site picker
descriptions · Ending sub line and Inscribe · Title chips · Title Ledger · Help key peek. One commit each
(`git log --grep` on those areas).

## Still open

- Dusk report: "saved at dusk" stays as its own line under Tomorrow (the generic overlay has no slot
  beside Continue).
- Help pages and the systems guide still overlap a little on the wall (The others / Noise / Jams are
  help-only; Nerve, Rally, Sally, Firebombs are guide-only). Merging the wall page into the guide's
  night group would need new `systems.ts` entries.
- Survivor sheet: the tired status tag under the name and "rested N%" in the Body head both show when
  someone is tired (the tag is the warning; it only shows then).
