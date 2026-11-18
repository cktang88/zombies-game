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
| 1 | Help | What each day job does | "The day" tab (7 job cards, missing Drill and Counsel) and the guide's "Day jobs" group (all 9, with spend → get) | the guide; the day keys (dusk, help) move under its lede; the tab goes | planned |
| 2 | Help | The barricade is your health bar | "The wall" tab card and the guide's "The wall" card | the guide | planned |
| 3 | Help / Settings | The whole key list | Help › The wall › Keys and Settings › Controls, both open | both (one reads, one rebinds), but Help's list starts folded | planned |
| 4 | Help, Settings | Close | a × in the corner and a Close / Done button at the bottom | the × (Esc and a click outside also close) | planned |
| 5 | Pause | Resume keys | a "P Esc resume" line above the buttons, then the Resume button | the keys as kbd caps inside the Resume button | planned |
| 6 | Dawn | Which night | "Dawn, Nov 18" and a right-aligned "the Nov 17 night" | the title; the night in its tip | planned |
| 7 | Dawn | Wall damage | a "wall lost" tally tile, then the wall bar with "350 / 350 · −N" | the bar (it animates the loss) | planned |
| 8 | Dawn | Rounds spent by type | the "rounds" tile's tip and a row of chips per ammo type | the tile (total) with the breakdown in its tip | planned |
| 9 | Dusk | Lines per group | each "day's work" fold showed a count that is 1 for nearly every group, beside the first line | count only when there is more than one line | planned |
| 10 | Dusk → Deploy | The date | "Dusk, Nov 17" on the report, then "Dusk, Nov 17. The road." on the road planner | the report; the planner says "The road" | planned |
| 11 | Run return | The loot | chips (4 food, 3 scrap, 12 with no icon) and the sentence "Brought home: 4 food, 3 scrap, 12 r9." | the chips, with icons for every resource and the names in tips | planned |
| 12 | Ending | Days, Turned put down, headshots | the sub line under the title and the score tiles | the tiles; the sub line keeps the dates and the seed | planned |
| 13 | Survivor sheet | Mood | a mood chip in the header and the Mood section's big number + word (open by default) | the Mood section | planned |
| 14 | Survivor sheet | Rest | header status, the Body head ("rested 26%") and a tired chip inside Body | the Body head; the chip inside goes (fed stays) | planned |
| 15 | Event card | What a choice risks | an icon + a word ("time", "standing") beside the button, then the hint sentence under it | the icon and the sentence; the word becomes the icon's tip | planned |
| 16 | Title | How the game goes | "Hold a house on Ferry Road…", two "Day work" / "Night the wall" chips, and the "how to play" button | the line and the button; the chips' text (setting, night keys) becomes the line's tip | planned |

## Paragraphs that could be a line

| Screen | Text | Now |
|--------|------|-----|
| Site picker | "Every place has its own stock. Big icons: lots of it. Far places eat the day in walking." under the heading | the heading's tip |
| Site picker | each card's two-sentence place description | the card's tip; the card keeps "7h searching" |
| Deploy, posts | "one at the loophole, one on the roof" | the header's tip |
| Deploy, guns | "heavy-weapons training decides how well a crew works one" and each gun's niche sentence | the header's tip / the gun name's tip |
| Settings | "Saved on this device." | the Data tab only (where it matters) |
| Guide | lede "Everything costs something. Here is what, and what it buys." over the two sub-tabs | kept (one line, it is the guide's thesis) |

## Same kind of element, several styles

| Kind | Variants | Unified to |
|------|----------|-----------|
| close | `.close` ×, `.go` Close/Done, `.go` "Close ›" (Ledger) | the × everywhere a dialog has one; `.go` only for a step forward (Continue, Resume, Begin again) |
| info "?" | `.qi` in deploy, `.qi` in hints, `(i)` in settings | `.qi` (the kit's, from 17) |
| loot / resource amount | `chip()` with an icon lookup that only knew ammo (food/scrap fell back to a bare id) | `chip()` with `RES_ICON` for every resource |
| "Locked." boon rows in the Ledger | a disabled-looking button + paragraph | left as is (the control is a real toggle) |

## Left alone (and why)

- Dawn "click to skip": it is the only hint that the report animates and can be skipped.
- Survivor sheet skill rows (icon · name · pips · number · xp bar): the number reads faster than ten pips, the bar is progress to the next level; three facts, not one.
- Epilogue grave cards' "lived" label next to an epitaph that starts "X lived": the label is the fate filter (lived / buried / stayed), the epitaph is prose that sometimes says otherwise ("made it", "across the river").
- Onboarding note: already one line with the rest in the (?) tip.
