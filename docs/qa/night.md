# QA: the night

System-by-system pass over dusk → deploy → battle → dawn (November 2026). Played with Playwright at
1280×720 and phone landscape (844×390, touch), nights 1, 3, 5, 8, 13, 14 (raiders, tunnel, horde
forced), 23 (the Crossing); every weapon class (pistol, shotgun, rifle, bow, M79, M72), throws, all six
trap kits, orders, posts, focus, rally, sally, melee, a wall breach, a lost line, a won night.
Severity: **high** = wrong outcome or input that does nothing; **med** = misleading or hidden;
**low** = cosmetic or wording.

## Fixed

| # | Issue | Sev | Fix |
|---|-------|-----|-----|
| 1 | F1 key sheet named [G] "spring trap"; the HUD chip and binding say "light oil" | low | 6acca9a |
| 2 | Holding the firebomb key threw one bomb per key repeat (the whole stock in a second) | high | d8a3ead |
| 3 | The nail bomb's "shoot the bomb" hint never showed: its 4 s timer ran out under the 4 s intro | med | ef1685e |
| 4 | Deploy card called the one-shot nail bomb "reusable" | low | 30e00de |
| 5 | Classic corpses (also the fallback on slow machines) were squashed along their length, not their thickness: bodies stood up off the road as dark heaps with arms raised | high | 4445567 |
| 6 | The news line could run under/over the weapon panel (on a phone it covered the ammo count) | med | c61c330 |
| 7 | Touch had no way to throw a firebomb or call a rally: Bomb and Rally buttons | high | 0f48a49 |
| 8 | Sally loot with a launcher or nail gun in hand gave 2-6 rockets' worth of explosives (or salvage) per kill | high | ed3b37d |
| 9 | A guard whose panic came due during a rally re-panicked every frame, writing a "panicked" chronicle entry each frame | high | cfc059c |
| 10 | Selected guard was an index into a list [Y] re-sorts: after a post change the selection (and the next order) jumped to another guard | high | a06b7aa |
| 11 | Auto posts never made a runner when the lightest gun on the line was not a handgun (an AR), though the deploy screen tagged the revolver "suits runner" | med | 475468b |
| 12 | A guard killed outright was announced "IS DOWN" (the line for someone who can still be dragged out) | low | a33d91e |

## Checked, no bug

- Ammo after the pool merge: magazines load from the right pool per gun (`roundsInStores`/`perShot`,
  .22 at 0.25 pistol, M72 at 2 explosives), guard mags, the pouch, dropped mags, guns picked up and put
  down all return to the stores at dawn; no negative stores seen. Bows draw on nothing and count arrows.
- Explosives: throws, M79 and M72 draw from one count; the HUD and F1 sheet show it.
- Trap kits behave as their cards say (snare trips runners, nails cripple, bear trap holds and
  re-arms, oil auto-lights at four, the lure auto-pulls once, the nail bomb goes underfoot or shot).
- Wall breach, the line lost (house overrun → dawn report), a won night → dawn → next day: no softlock.
- Special nights (raiders, tunnel, horde, the Crossing with the Bellwether bar) run without errors.
- smoke, pad-check, settings-check (all passed, including "Rigged animation turns them back on"),
  pose-check, ragdoll-check, simtest.

## Left

- Touch still has no sally, melee, orders, lure or oil buttons (oil and lure fire on their own);
  the pad has no melee, lure or oil (every standard button is already bound). Worth a radial or a
  context button, not a quick fix.
- Paused, the canvas key sheet is drawn under the pause menu's dark backdrop and cannot be read
  (Help in the menu covers it). Cosmetic.
- On this container's software renderer the rigs fall back to Classic within seconds ("frames over
  25 ms with 8 full rigs"); frame-time governors could not be judged here.
- A bow switched to shows a red "0 /∞" until the first click nocks an arrow (auto reload covers it).
- The dawn report's death card clamps the cause to two lines (the full text is in its tooltip).
