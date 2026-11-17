# Graphics audit: round 1 (the non-night screens)

**Method.** I staged a day-12 save and a day-24 save with `tools/stage-save.ts`, plus a fresh game. I drove each screen with Playwright using the debug handles (`__G`, `__story`, `window.__battle`). Every screen was captured at 1280×720, 1920×1080 and 390×844 at deviceScaleFactor 2, then inspected, fixed and captured again.

**Screens covered.** Title (with its Ledger, seed row and the Daily), settings (all five tabs), the help ledger (all five pages), and day one with the onboarding hints. The day ledger: every tab, the calendar, threads, the hours strips, the warnings and the run planner. Also the survivor sheet, five incident modals, dusk, the deploy step, the pause menu, both dawn stages, the four endings, the crossing choice and the game-over memorial.

**Out of scope for round 1.** The night and the run canvases, world sprites and rigs belong to two other agents. `deploy.ts` is theirs too: only its page wrapper and its CSS were touched here.

Severity: **H** = looks broken or unfinished, **M** = clearly below the bar, **L** = polish.

| Screen | Sev | Issue | Fix |
|---|---|---|---|
| Survivor cards, sheet, graves, dawn, end cards | H | The "portraits" were full-body side-view sprites squeezed into 56×84. The faces were about 8 px and guns stuck out of the frame. | Bust portraits are now cut from the 1408×768 original generations: keyed, cropped to head and shoulders, set on a lit, grained ground with a vignette (`tools/make-portraits.py` → `public/art/port_*.jpg`, 13 files). They show as pinned photographs on cards (64×80), the sheet (128×160), graves, dawn and the end screens. The dead are drawn in sepia-grey. `src/ui/portrait.ts` falls back to the sprite if a portrait is missing. |
| Every select | H | Native OS dropdowns with a white system chevron that clashed with the ledger. | `appearance:none` ink field, inset shadow, brass caret, hover and disabled states, ellipsis. |
| Settings › audio | M | Native range sliders. | Ten-tick ledger track, brass fill (`--p` driven from `settings.ts`) and a brass slug thumb. Checkboxes are ink boxes with a pencil tick. |
| Incident modals | H | Plain dark box, the same as every other modal. The research doc asks for found documents. | Rendered as light ruled paper: red margin line, paper clip, water stains, grain, ink text. Choices read as tick-box lines (☐ → ☒ on hover). |
| Title | M | Flat purple cloud sky with no subject. | Generated key art: the brick house on Ferry Road at dusk, the mill, the river and the dead on the road. It has a slow Ken Burns drift, falls back to `bg_far` (the town), uses a lighter vignette, and the persona cards are lifted with backdrop blur and a hover rise. |
| Epilogue / crossing / game over | H | Left-aligned text on black, inline styles, nothing to look at. | A painted plate for each ending (ferry, mill, spring, ice; fell for the memorial), each falling back to a graded `bg_far` or `bg_mid`. The title sits on the plate, the opening paragraph has a drop cap, the score card is a ledger with a double-ruled total and a brass score, and the fate cards carry portraits. The buttons are classes now, not inline styles. |
| Day: workshop | H | The recipe column made the page about 8000 CSS px tall at 1280 (16000 at DPR 2). | Tighter recipe rows (grid with costs inline). On desktop the recipe column scrolls inside the panel with a fade mask. The page is now about 950 px. |
| Day: survivor cards | M | The "same as yesterday?" tag broke across two lines. Names were underlined links. | Tags use nowrap and the name row is a flex wrap. Names have a dotted underline that goes brass on hover. |
| Day: tabs (centre, help, settings) | M | Loose buttons with no sense of a selected page. | Joined tab strip on a rule line. The active tab has a brass top edge. Labels are capitalised. |
| Day: panels | L | Flat translucent boxes. | Paper grain, an inner highlight, a drop shadow and double-ruled panel headers. |
| Day: wall tab | L | Default disc bullets. | Ledger rows with an em-dash marker and type-face figures. |
| Day: armory | M | Zero-stock ammo shown in alarm red: the list read as a wall of red. The stats line was 11 px. | Zero stock is now dim. Stats are 12 px. Gun icons sit on a faint light pool. |
| Icons (stores, costs, armory) | M | Dark gunmetal icons vanished on dark paper at 20 px. | A hairline light halo plus a contact shadow. Store icons are 22 px. The icon set itself is consistent: no icons drawn as people. |
| Onboarding hint | L | The paper clip covered the hint title. | More top padding. The note now uses the same grained ruled paper as the documents. |
| Help › The Turned | L | "from day 999" shown for the special-night Turned. | Reads "special nights". |
| Title › Ledger | L | A 🔒 emoji (colour glyph) in a monochrome ledger. | A plain ☐ in the disabled state. |
| Pause | L | Off-centre (the margin padding was on one side only). | Symmetric padding and a spaced-caps header. |
| Dawn | L | The tally wrapped to two rows on phones, leaving a hole. | Always three columns, with smaller labels on phones. Numbers are 34 px and centred. |
| Dusk deploy page | M | Three cards on flat black. The post selects were misaligned because each sat after a different gun name. The "guns" card used inline flex styles. | The town backdrop sits behind, cards stack in one column with shadows, post rows use a grid, crew labels use the type face, and headers wrap on phones. |
| Settings / help on phones | M | The five tabs wrapped, leaving "Data" alone on a second row. | The tab strip scrolls horizontally on phones. |
| End screens | L | The body grain stopped after the first viewport, leaving a seam. | The grain moved to `html`. |
| Modals | L | Popped in. | A 0.2 s rise and fade. The backdrop blurs and desaturates the page. Reduced-motion users get no animation. |

## Art spend
These went through OpenRouter (`google/gemini-3.1-flash-lite-image`) with `tools/gen-art.ts` and `tools/art.json`: six images at about $0.034 each, **about $0.20** in total. They are `key_title` and `end_ferry`, `end_mill`, `end_spring`, `end_ice` and `end_fell`. The 13 portraits cost nothing: they are cut from existing generations.

## Left for round 2
- **Night and run HUD over the dawn report.** Behind the dawn modal, the staged capture shows "−999999914 still out there". That comes from forcing `spawnIdx = 1e9` in the capture script, not from the game. Even so, the HUD counter should clamp at 0.
- **Deploy planner internals** (`deploy.ts`, owned by the world-objects agent). On phones the kit buttons lose their labels and show only an icon and a count. The road strip is a flat gradient.
- **Turned thumbnails in the help ledger** are tiny full-body sprites. Once the rigs settle, they could use bust crops the way the survivors now do.
- **Survivor sprite reuse.** Two founders can share a sprite, and therefore a portrait: Renee and Colette in the day-24 save. More survivor generations would fix it. That needs new world sprites, so it belongs to the other agents.
- **Survivor sheet.** The middle and right columns are short while the left column (skills) runs long. A two-column layout at 1280+ would balance it.
- **Score card.** At desktop width there is empty space to the right of the score card. It could sit beside the fates, or the chronicle could move up.
