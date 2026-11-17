# 07 — Gun audio: making shots feel heavy, readable and balanced

Scope: how VESSEY's procedural WebAudio gun kit (`src/audio.ts`, `src/audio/*.ts`) should sound, and why. Companion to 05 (combat depth) and 06 §"Juice" (sound pitch variation, kill-confirm tick, ducking).

## 1. What a gunshot is made of

Commercial weapon design converges on five layers that are mixed separately and fused at the same instant ([Ortega][ortega], [Violet][violet], [Splice][splice], [Krotos][krotos]):

| Layer | What it does | Our synthesis |
|---|---|---|
| **Transient / crack** | The first 2–8 ms: the supersonic crack and firing-pin click. Sells *sharpness* and position. Without it a shot is "muffled". | 3–6 ms high-passed noise click + a tiny square blip. |
| **Body** | 30–400 ms band-limited burst: the "bang". Its spectral centre and length set the *calibre*. | Noise through a low-pass whose cutoff sweeps down (bright → dark), soft-clipped for grit on shotguns/rifles. |
| **Sub / thump** | 40–90 Hz punch felt in the chest. Without it a gun is "thin and toy-like". | Sine dropping from ~2.5× to 1× its pitch in 40–80 ms. |
| **Mechanical** | Bolt carrier, slide, pump, lever, belt links, shell eject. Tells the player *which gun* and *what state* (racked, empty, jammed). | Band-passed noise ticks + short inharmonic metal rings, scheduled after the shot at the real cycle time. |
| **Tail** | Environment: reverb, slap-back off buildings, distant rumble. Kept *separate* from the dry shot so the engine can change it per place ([Splice][splice], Hunt 2.4 notes [CRY][hunt24]). | One shared `ConvolverNode` with a generated "street" impulse (early reflections from facades + 1.2 s dark decay) and one shared delay echo (~0.27 s, filtered) — every gun sends to them. |

The timing between transient and body matters more than either alone: a 1–3 ms offset makes a gun read larger; an aligned attack makes it read tighter ([Violet][violet]). Small guns get a crack-heavy, short body; big guns a darker, longer body and more sub.

## 2. How games sell weight

- **DOOM (2016)** — weapon sounds are designed from scratch in layered stacks; the super shotgun's power is mostly low-mid body + a hard mechanical "clack" of the break action and shells ([ADSR Q&A][adsr], [Tonna][reaper]). The lesson: *the reload/handling foley is part of the power fantasy*.
- **Hunt: Showdown** — every gunshot comes from a real source and attenuates over distance; "the sound had to scale, you have to be able to read from the audio" ([PlayStation Blog][psblog], [80.lv][80lv], [RPS][rps]). Distant shots lose the transient and high body and are mostly tail: we model "far" as a low-pass + more echo send, less crack.
- **Insurgency / Sandstorm** — mechanics louder than you'd expect, dense outdoor tails, and pronounced distance layers; suppressed guns are mostly action noise + a "phut", which is what we do for `opts.suppressed`.
- **Receiver / Gunpoint** — every mechanical step is its own sound (mag out, mag in, slide). Granular reload foley makes the gun feel physical even with simple visuals; our `sfx.reload(kind, stage)` stages follow this.

## 3. Balance rules for VESSEY

1. **Loudness follows damage, not rate.** The muzzleloader and coach gun are the loudest single events; the LMG's per-round level is lower than the bolt rifle's so a 12 rps stream sits *under* the hunting rifle rather than drowning it. Quiet guns (bow, .22, nailer) stay quiet — their noise is already a gameplay stat.
2. **Variation, not repetition.** Each shot jitters pitch ±4 %, filter cutoff ±12 %, layer levels ±10 %, and round-robins between pre-rendered variants. Automatic fire never machine-guns identical samples ([Krotos][krotos]).
3. **Glue the mix.** Everything goes through a compressor then a limiter on the SFX bus; music is ducked ~4–6 dB for ~0.4 s under heavy shots so a shot always cuts through.
4. **Cheap at volume.** Each gun variant is rendered once in an `OfflineAudioContext`; afterwards a shot is 2–3 nodes (buffer source → gain → buses). A voice cap steals the oldest voice so LMG fire cannot pile up hundreds of nodes.
5. **Impacts carry the hit feedback.** Flesh = wet low thud, head = crunch + pop, armour = metallic ping (with occasional ricochet whine), wood = hollow knock, bone = dry crack. A small kill-confirm tick rises ~6 % per kill in a streak (06 §4).

## 4. Synthesis notes (WebAudio)

- Noise is a pre-generated buffer played from a random offset ([Opera drum synthesis][opera], [O'Reilly ch.6][oreilly]); no `ScriptProcessorNode`.
- Exponential envelopes need a non-zero floor (`0.0001`); set the attack with `setValueAtTime(0)` then `linearRampToValueAtTime` over 1 ms to avoid clicks.
- Convolver impulse: stereo noise × exponential decay, with 6–10 sparse early spikes in the first 60 ms (facade reflections) and a progressively darker tail (one-pole low-pass on later samples) ([W3C convolution][w3c]).
- Distance: low-pass at 900–1500 Hz, transient removed, extra delay/reverb send, ~-10 dB.
- Black powder: a percussion-cap snap, a 20–30 ms gap, a huge dark boom, then a long crackling hiss (sparse random clicks on band-passed noise).

## References

- [ortega]: https://www.liortega.com/post/first-person-shooter-gun-sound-design — L. Ortega, "First-person shooter gun sound design"
- [violet]: https://violetrecording.com/how-to-design-weapon-sounds/ — Violet Recording, "How to Design Weapon Sounds for Games"
- [splice]: https://splice.com/blog/?p=16617 — Splice, "How to design a weapon sound for video games"
- [krotos]: https://www.krotosaudio.com/?p=1057976 — Krotos / Aftertouch Audio, Weaponiser tutorial (onset/body/thump/tail engines, random pools)
- [psblog]: https://blog.playstation.com/?p=221483 — "Listen Closely: Insight into the Sound Design of Hunt: Showdown"
- [80lv]: https://80.lv/articles/crytek-on-the-sound-design-of-hunt-showdown — 80.lv, Crytek on Hunt's sound design
- [hunt24]: https://patchtracker.gg/hunt-showdown/dev-insight-audio-design-recap-what-s-new-in-update-2-4 — Crytek, Dev Insight: audio recap, update 2.4
- [rps]: https://wwwrockpapershotgos.pages.dev/posts/how-hunt-showdown-creates-hot-dripping-tension — "How Hunt: Showdown creates tension" (Schwarz quote)
- [adsr]: https://www.adsrsounds.com/news/the-sound-design-of-doom-exclusive-qa/ — ADSR, "The sound design of DOOM" Q&A
- [reaper]: https://reaper.blog/2018/05/redesigning-doom — Will Tonna, "Redesigning DOOM"
- [opera]: https://dev.opera.com/articles/drum-sounds-webaudio — "Synthesising Drum Sounds with the Web Audio API"
- [oreilly]: https://www.oreilly.com/library/view/web-audio-api/9781449332679/ch06.html — B. Smus, *Web Audio API*, ch. 6 (procedural gunshot)
- [w3c]: https://www.w3.org/TR/2015/WD-webaudio-20151208/convolution.html — W3C, Convolution reverb
- Jonasson & Purho, "Juice It or Lose It" (GDC EU 2012); Nijman, "The Art of Screenshake" (2013) — see 06.

[ortega]: https://www.liortega.com/post/first-person-shooter-gun-sound-design
[violet]: https://violetrecording.com/how-to-design-weapon-sounds/
[splice]: https://splice.com/blog/?p=16617
[krotos]: https://www.krotosaudio.com/?p=1057976
[psblog]: https://blog.playstation.com/?p=221483
[80lv]: https://80.lv/articles/crytek-on-the-sound-design-of-hunt-showdown
[hunt24]: https://patchtracker.gg/hunt-showdown/dev-insight-audio-design-recap-what-s-new-in-update-2-4
[rps]: https://wwwrockpapershotgos.pages.dev/posts/how-hunt-showdown-creates-hot-dripping-tension
[adsr]: https://www.adsrsounds.com/news/the-sound-design-of-doom-exclusive-qa/
[reaper]: https://reaper.blog/2018/05/redesigning-doom
[opera]: https://dev.opera.com/articles/drum-sounds-webaudio
[oreilly]: https://www.oreilly.com/library/view/web-audio-api/9781449332679/ch06.html
[w3c]: https://www.w3.org/TR/2015/WD-webaudio-20151208/convolution.html
