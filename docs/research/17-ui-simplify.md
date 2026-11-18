# 17 · UI simplify pass: the day screen and the shared kit

The player: "do a pass in ui lots of redundant elements and text and stuff can all be simplified and unified."

Audit of the day screen (staged day-12 save and a fresh day 1, 1440×900 and 390×844), then what each
finding became. Rule for every change: keep the one clearest place, move the sentence into a hover
tip (`kit.tip`), never drop a fact outright.

## Same fact shown more than once

| # | Fact | Where it showed | Keep | Status |
|---|------|-----------------|------|--------|
| 1 | Jobs carried over from yesterday | a dashed banner over the cards ("6 jobs carried over…" + Keep), a SAME? tag on every card, a Today item ("Check 6 jobs from yesterday"), a gold bar on each card | Today item (the to-do) + the gold bar on the card (where) + a small Keep button in The house's head (the action) | planned |
| 2 | A scavenge site's stock left | the site button ("picked clean" / "3/8 left"), a row of ▮▯ glyphs under it, in the picker a chip with pips | pips inside the site button; the words in its tip | planned |
| 3 | Run: walk hours, risk, stock | the site button's meta line, then again as three chips under the selects | the site button | planned |
| 4 | Run: hours on the street | the site button ("9h street") and the line under the strip ("9h street · 153s light") | the button; daylight seconds on the Go button | planned |
| 5 | Next big night | "This morning" forecast ("Tomorrow is circled in red on the kitchen calendar"), the calendar's next-night line, the Today item ("Bad night in 1d") | the calendar line; the forecast flavour goes in its tip (it still shows before the calendar opens) | planned |
| 6 | Tonight's size | the calendar's tonight cell said "quiet" while a separate TONIGHT line said "a long one ●●●●●" (two answers, one contradicting the other) | one answer, in the calendar's tonight cell (word + red when big); pace and stove fuel in its tip | planned |
| 7 | The job | job icon square, then the select's text ("Repair the wall — +63 wall") | both: the icon is the picture, the select the control. No change | kept |
| 8 | Weather | header text and date tip | header text; dropped from the tip | planned |

## Several styles for one kind of thing

| Kind | Variants found | Unified to |
|------|----------------|-----------|
| chip (icon + value) | `.chip`, `.sv-chip` (its own padding and bad/bite/lead/lo colours), `.schip` (stores, its own border/size), `.wchip` (dead), `.ammochip` | one `.chip` with tones `warn` `bad` `good` `lead` `lo` `none` and one size modifier `.chip.lg` (the stores row) |
| tag (small uppercase label) | `.tag` with five unused tone classes, `.tag.carried`, `.sv-perknew` restyled per screen, `.prof` (dead) | one `.tag` (`kit.tag()`), tones `good` `warn` `bad` |
| small button | `button.mini`, `.mini.hb`, `.td-all` (a hand-rolled text link), `.hint button.mini` (another text link) | `button.mini`, plus `button.mini.link` for the quiet text-link look; `.urgent` tone |
| "what is this?" mark | `.qm` (16px circle, 13px "?") on the day screen, `.qi` (15px circle, **10px** "i", under the type floor) in settings and deploy | one `.qi` at 13px (`kit.qi(tip)`) |
| section header | `section > h2.t-l` + `.t-xs` count, `.sechead` (armory, town), `.wsq > .t-l` (workshop queue), `.rhead` (run), `.calhead` (calendar: small uppercase), bare `.t-xs` "Tonight" | `kit.sec(title, meta, tip)` → `.sechead`: a `.t-l` title, a `.t-xs` meta, an optional `.qi`. Sections' h2 use the same parts |
| pips | kit `.pips` dots, ▮▯ text glyphs for site stock, ●●●●● text in a few tips | kit `pips()` everywhere on the day screen |
| fold | `.fold` with per-screen summary overrides (`.sv-fold`, `.fold.mk`, `.duskwork .fold`, `.sbody .fold`) | left as is: they are one component with local sizes; noted for the other screens' owners |

## Words that repeat a picture

- Site picker cards: "Big icons: lots of it. Far places eat the day in walking." under the title. The icons and chips say it; moved to the title's tip.
- Run head "Lead a run ?" carried a long paragraph; now the `.qi` tip, shortened.
- `Today` strip: "show everything" was a hand-styled link; now `mini link`.
- Dusk button while jobs are marked: "Yesterday's jobs are marked. Go anyway ›" → "Go anyway ›" (the Today item and the gold bars already say which).

## Dead CSS removed

`.warns*`, `.wchip`, `.mood .why*`, `.jobhint`, `.calkey`, `.trait`, `.skill` (old sheet rows), `.tag.lead/.bad/.warn/.bite/.good` (unused), `.tag.carried`, `.carryover*`, `.surv .prof`, `.surv .stock*`, `.runchips`, `.qm`, `.stores span em`, `.schip*`.

## Left for later

- The centre tabs (workshop, armory, town) each still build their own card grids (`.wcard`, `.gcard`, `.ftile`, `.sitecard`): one "picture card" component would fold four styles into one.
- Fold summaries are restyled per screen; a `fold(…, {size:'s'})` option would retire the overrides.
