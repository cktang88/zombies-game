# QA: runs, meta, saves, input (meta pass)

Scope: runs (`src/night/expedition.ts`), title / new game / continue / daily / ledger, onboarding,
help and the "How it works" guide, settings, pause, endings and the Crossing, legacy, saves and
old-save migration, gamepad / touch / phone layouts / resize, text floor and contrast.
Played with Playwright against `vite preview` (desktop 1280×720, phone 390×844 and 844×390 with touch).

Severity: **H** lost progress or a softlock · **M** input not responding, misleading, or confusing ·
**L** cosmetic, wording, minor.

## Fixed

| Issue | Sev | Commit |
|---|---|---|
| Deleting the save in Settings › Data from the title left Continue on screen, and it loaded the deleted game from memory | M | 6ae312c |
| Gamepad: D-pad down from a closed fold head did nothing (the next stop was inside the closed fold, where `focus()` fails silently); pad-check failed on it | M | 630862f |
| Runs: alt-tab with a walk key held left the leader walking on (the keyup never came); losing focus now pauses the street | M | 57e1e81 |
| Touch: a run's walk buttons were stacked, ▶ above ◀; now side by side | M | 8335382 |
| Settings: once the rigs fell back to Classic (slow frames), picking Rigged again did nothing for the session; settings-check failed on it | M | c9049fe |
| Gamepad: the D-pad did nothing on runs (only the left stick walked) | M | 384ad58 |
| Help › Runs: "Dying out there: The loot stays" read as if the pack could be fetched later; nothing keeps it | L | 8634328 |
| Touch: the turn-your-phone prompt on a run talked about the wall and the night | L | 89e351e |
| Touch: the run's opening line and HUD asked to hold [F1] (no F1 on a phone) | L | 844a190 |
| Help: key caps in the key lists came out at 11 px (under the 13 px floor) | L | ada76f9 |
| Runs: the return screen always said "Back before dark", even after the light ran out | L | a3df5cd |
| Onboarding: the dusk note always said Enter, even with dusk rebound | L | 15c515e |

## Checked, no change needed

- **Save round trip**: save, reload, Continue gives a byte-identical state (day 14 staged save).
- **Old-save migration**: a v1 save staged on 28d3717 (`tools/stage-save.ts 14`) loads clean on main:
  stores fold exactly (salvage 22+18+2×4+21 = 69; pistol 255 + ½×115 = 312.5; food +1.5 liquor;
  shells +slugs; molotovs → explosives), no NaN anywhere in the state; old mods fold (choke → red dot,
  bipod/brake → sling, drum → ext. mag) and a misfit goes back to the bench; melee and survivor refs
  kept; 8 trap kits stay 8 kits; a night-phase v1 save with old traps on the road (propane, deadfall,
  spike pit) and old recipes queued (slug, propane kit, brake) resumes at the wall with the folded
  plan and queue.
- **Runs**: loot lands in the 4 materials + 3 pools + explosives (every site's loot, guns, mods and hand
  weapons resolve); pack cap 12 (+4 duffel, +6 companion), overload slows; Sleepers wake after ~1.1 s
  close; companion drag-home path (pack trimmed to the companion's 6, lines and thoughts right);
  pause / Esc / resume; F1 sheet while held; window resize keeps the mouse mapping right.
- **Endings**: ferry, mill, spring, ice, game over; the Crossing screen survives a reload (Continue
  returns to the choice); Endure → day; Close the ledger → epilogue; legacy recorded once.
- **Ledger boons**: unlocks, choosing a boon applies it to the next game (+60 wall).
- **Settings**: every checkbox, choice and slider persists across a reload; layout fits 390 px.
- **Guide numbers** (`src/data/systems.ts`): recipes, wall 300 / +60, rest +40% / +3 mood, half
  rations, frost heat 1 per 3, floodlight / wire / spike / nerve / rally / sally numbers spot-checked
  against the code: they match.
- **Phone**: title, help, ledger, settings, end screens fit 390×844 and 844×390 with no sideways scroll.

## Left as is

- The run's canvas HUD is drawn at 1280×720 logical px: on a phone (844×390) its 13 px text shows at
  about 7 px. Needs a phone HUD scale (bigger job than this pass).
- On touch, run prompts still draw keyboard keycaps ([E] search) beside the on-screen buttons.
- A run starts with a full magazine not drawn from the stores, and what is left in it is not
  returned: a free magazine per run. Looks deliberate (the gun comes loaded); left for a balance pass.
- Quitting a run from the pause menu forfeits the day's run (the pause confirm's tip says so):
  by design, it stops reload-scumming a run.
- settings-check's "damage-zone rings" step is flaky (failed once, passed twice); under headless
  software rendering the rigs fall back to Classic for slow frames (environment, not a game bug).
