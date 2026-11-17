# VESSEY: Before the Ice

A 2D side-view zombie barricade shooter in the spirit of the *Last Stand* flash games, wrapped in a light RimWorld-style survivor sim and storyteller AI that generate stories you remember.

Vessey is a dying paper-mill town on the St. Aubin River, in November. The Guard has sealed the bridge. The river freezes on Nov 28, and then the dead can walk across. Hold a house on Ferry Road with whoever you can find.

**Play:** https://cktang88.github.io/zombies-game/ (built from `main` by `.github/workflows/pages.yml` and published to the `gh-pages` branch)

## What's in it
- **Night defense:** mouse aim with a true-spread crosshair, headshots ×3, piercing rifles, shell-by-shell shotgun reloads, jams on worn guns, noise that draws stragglers, firebombs, traps, spikes, wire and floodlights. Survivors fire from the wall using their own skill, wounds and mood, and they can panic or rage.
- **Daylight runs:** a side-scrolling scavenging walk you play yourself. Search doors, cars, sheds and the dead; don't wake the Sleepers; get home before dusk. You may find survivors, guns, papers, and Kin sitting at their kitchen tables.
- **Survivor sim:** backstories, 24 traits, skills and passions, mood built from named thoughts, mental breaks and resolve, wounds by body part, bites and amputations, relationships (friends, lovers, rivals, marriages), earned titles, deaths that ripple through everyone.
- **Storyteller:** three personas (The Long Siege, The Quiet, The Coin), threat budgets, mercy after deaths, about 20 incidents, and the Crossing on Nov 28.
- **Production:** workbench, forge, cold frames, infirmary, still, generator and radio; ammo, traps, armour, wall reinforcements, and named masterwork guns.
- **Chronicle:** a journal of everything that mattered, graves with epitaphs, 22 found documents, and the four factions of Vessey.

## Docs
- [Design document](docs/DESIGN.md)
- Research: [Last Stand & genre](docs/research/01-last-stand-and-genre.md) · [RimWorld & emergent story](docs/research/02-rimworld-emergent-story.md) · [Art style & lore](docs/research/03-art-style-and-lore.md)

## Dev
```
npm install
npm run dev
npx tsx tools/simtest.ts 9                         # headless 30-day soak test of the sim layer
OPENROUTER_API_KEY=… node tools/gen-sprites.mjs    # (re)generate missing sprites; see tools/sprites.json
```
Sprites are generated with OpenRouter's cheapest image model on flat magenta, then chroma-keyed, trimmed and downscaled with `sharp`. They cost about $0.03 each, and the whole set so far cost under $2.
