#!/usr/bin/env python3
# Builds the recorded sample set: tools/.cache/sfx-src/** (CC0 downloads, see tools/sfx-fetch.py)
#   -> public/sfx/<id>-<n>.mp3 (mono, 44.1 kHz, trimmed, loudness-matched, VBR mp3)
#   -> src/audio/sample-manifest.ts (ids, variant counts, loop flags)
#   -> CREDITS.md (source page, author, license, which shipped files came from it)
#
# Requires: python3 + numpy, ffmpeg (libmp3lame). Run: python3 -I tools/sfx-build.py
# Every source used here was checked to be CC0 / public domain on its page (fetch script
# refuses non-CC0 entries; meta.json beside each download records the license it saw).
import json, os, re, subprocess, sys, glob
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools/.cache/sfx-src')
OUT = os.path.join(ROOT, 'public/sfx')
SR = 44100

# ---------------------------------------------------------------------------------------
# Manifest. Each id lists its variants: 'pack/file' or ('pack/file', start, dur).
# opts: loop (crossfaded bed), rms (target dBFS of the loudest 300 ms), q (lame VBR quality),
#       hp/lp (Hz), rate (resample factor baked in: <1 = lower & longer), tail (max seconds)
# ---------------------------------------------------------------------------------------
def rng(pack, pat, nums): return [f'{pack}/{pat.format(n)}' for n in nums]
def segs(path, spans): return [(path, a, b - a) for a, b in spans]

ZSP = 'zombies-sound-pack'
M = [
    # ---- zombie voices -------------------------------------------------------------
    ('z_groan', rng(ZSP, 'zombie-{}.wav', [16, 17, 18, 21, 15, 1, 20, 23]) +
        ['zomby-sfx-pack/02_zombey.mp3', 'zomby-sfx-pack/06_zombey.mp3', 'zomby-sfx-pack/07_zombey.mp3',
         'zombie-moans-01-by-emopreben/ZombieMoans_-_Track_5_-_ZombieMoan1.wav',
         'zombie-moans-01-by-emopreben/ZombieMoans_-_Track_7_-_ZombieMoan3.wav'] +
        segs('zombie-moans/darsycho__zombie-moans_0.ogg', [(0.17, 3.09), (3.6, 6.32), (6.56, 9.08)]) +
        ['undead-moans/undead-1.ogg', 'undead-moans/undead-2.ogg'],
        dict(rms=-17, tail=2.6)),
    ('z_alert', rng(ZSP, 'zombie-{}.wav', [2, 3, 4, 5, 6, 7, 10, 14, 22, 24]) +
        segs('hungry-ghoul/hungry-ghoul_0.ogg', [(5.33, 7.64), (8.37, 10.87), (11.89, 14.26), (15.08, 17.44)]),
        dict(rms=-16, tail=2.0)),
    ('z_attack', segs('monster-snarls/monster-snarl-attack.ogg', [(0.02, 1.27), (1.56, 2.96), (3.22, 4.25), (5.12, 6.1), (6.67, 7.82), (10.48, 11.83)]) +
        segs('monster-snarls/monster-snarl-5.ogg', [(0.28, 1.65), (1.97, 3.54), (3.97, 5.73)]) +
        rng('16-monster-growls', 'monster.{}.ogg', [2, 3, 5]),
        dict(rms=-15, tail=1.6)),
    ('z_pain', rng('zombie-skeleton-monster-voice-effects', 'zombieYell{}.wav', [1, 2, 4, 6, 9, 10]) +
        rng('80-cc0-creature-sfx', 'hurt_0{}.ogg', [3, 4, 5]),
        dict(rms=-15)),
    ('z_death', rng('zombie-skeleton-monster-voice-effects', 'zombieDeath{}.wav', [1, 2, 3, 4]) +
        [f'{ZSP}/zombie-9.wav', f'{ZSP}/zombie-19.wav', '80-cc0-creature-sfx/troll_02.ogg', '80-cc0-creature-sfx/grunt_01.ogg',
         'zombie-pain/zombie_pain.flac'],
        dict(rms=-15, tail=2.0)),
    ('z_scream', ['80-cc0-creature-sfx/scream_01.ogg', '80-cc0-creature-sfx/scream_02.ogg',
                  'high-pitch-scream-sounds2/high_pitch_scream.mp3', 'insect-or-alien-scream/insectoralien.flac'] +
        segs('horror-scream1/scream_horror1_0.mp3', [(0.3, 2.6), (4.0, 6.4)]) +
        segs('female-high-pitched-scream-sfx/screams_0.ogg', [(0.0, 2.2), (2.2, 4.4)]),
        dict(rms=-14, tail=2.4)),
    ('z_wet', [f'slimy-monster-or-murder-sounds9/slimy_monster_or_murderd_sound{s}.mp3' for s in ['', '_1', '_2', '_3', '_7', '_8']] +
        ['80-cc0-creature-sfx/burble_01.ogg', '80-cc0-creature-sfx/burble_02.ogg', '80-cc0-creature-sfx/burp_01.ogg',
         '80-cc0-creature-sfx/burp_02.ogg'],
        dict(rms=-16)),
    ('z_breath', ['breathing-tired/breathing_tired.wav', '80-cc0-creature-sfx/breath.ogg', '80-cc0-creature-sfx/snore.ogg',
                  'dog-snarl-grunt-grumble/dog-grumble.flac'],
        dict(rms=-18, tail=3.2)),
    ('z_snarl', ['dog-snarl-grunt-grumble/dog-snarl.flac', 'dog-snarl-grunt-grumble/dog-growl.flac', '80-cc0-creature-sfx/howl.ogg',
                 '80-cc0-creature-sfx/roar_03.ogg', '80-cc0-creature-sfx/hurt_02.ogg'],
        dict(rms=-15)),
    ('z_big', ['ghost-monster-voice-moaning-growling/qubodup-GhostMoan01.wav', 'ghost-monster-voice-moaning-growling/qubodup-GhostMoan05.wav',
               ('ghost-monster-voice-moaning-growling/qubodup-GhostMoan03.wav', 0, 3.0),
               '80-cc0-creature-sfx/monster_04.ogg', '80-cc0-creature-sfx/monster_07.ogg', '80-cc0-creature-sfx/roar_02.ogg',
               '80-cc0-creature-sfx/troll_01.ogg'],
        dict(rms=-15, tail=3.0)),
    ('z_spit', rng('80-cc0-creature-sfx', 'spit_0{}.ogg', [1, 2, 3]) + ['80-cc0-creature-sfx/cough_01.ogg'], dict(rms=-16)),

    # ---- flesh & gore ---------------------------------------------------------------
    ('flesh', rng('8-wet-squish-slurp-impacts', 'impactsplat0{}.mp3.flac', [1, 2, 3, 4, 5, 6, 7, 8]), dict(rms=-14, tail=0.6)),
    ('splat', ['squish-sounds-effects/squishsplat_impact.mp3', 'squish-sounds-effects/squishpop.mp3'] +
        rng('squish-sounds-effects', 'squish_0{}.mp3', [2, 3, 4]) +
        segs('ripping-into-meat/rippingintomeat_0.mp3', [(1.0, 2.2)]),
        dict(rms=-14, tail=1.0)),
    ('bone', rng('fleshy-bone-breaksnap-sfx', 'Wet_Break_{}.wav', [1, 2, 3, 4, 5]) + rng('deep-bone-crackbreak-sfx', 'Deep_Break_{}.wav', [1, 2, 3]),
        dict(rms=-14, tail=0.7)),
    ('crunch', rng('5-break-crunch-impacts', 'impactcrunch0{}.mp3.flac', [1, 2, 3, 4, 5]), dict(rms=-14, tail=0.7)),
    ('bodyfall', rng('12-wet-towel-hittingfallingpunching-floor-sounds', 'wet_towel_on_floor-{:02d}.flac', [1, 2, 3, 6, 9, 11]),
        dict(rms=-15, tail=0.8)),

    # ---- barricade --------------------------------------------------------------------
    ('wood_hit', rng('35-wooden-crackshitsdestructions', 'impactwood{:02d}.mp3.flac', [1, 3, 5, 7, 9, 12, 15, 18]) +
        rng('100-cc0-metal-and-wood-sfx', 'wood_hit_0{}.ogg', [1, 3, 5]),
        dict(rms=-14, tail=0.8)),
    ('wood_crack', rng('35-wooden-crackshitsdestructions', 'crack{:02d}.mp3.flac', [1, 3, 5, 7, 9]) +
        rng('100-cc0-metal-and-wood-sfx', 'wood_cracking_0{}.ogg', [1, 2, 3]),
        dict(rms=-14, tail=1.2)),
    ('wood_break', ['100-cc0-metal-and-wood-sfx/wood_breaking_01.ogg', '100-cc0-metal-and-wood-sfx/wood_breaking_02.ogg'] +
        rng('75-cc0-breaking-falling-hit-sfx', 'bfh1_wood_breaking_0{}.ogg', [1, 2, 3, 4]),
        dict(rms=-13, tail=1.6)),
    ('metal_hit', ['metal-impact-sounds/bong1.wav', 'metal-impact-sounds/clink2.wav', 'metal-impact-sounds/thud2.wav'] +
        rng('100-cc0-metal-and-wood-sfx', 'hammer_0{}.ogg', [1, 2, 3]) +
        rng('machete-vs-spatula', 'machete_vs_spatula_{}.wav', [8, 10, 13]),
        dict(rms=-16, tail=0.9)),

    # ---- melee ------------------------------------------------------------------------
    ('swing', rng('swishes-sound-pack', 'swish-{}.wav', [1, 3, 4, 5, 6, 8, 10, 11]), dict(rms=-14)),
    ('swing_heavy', ['swishes-sound-pack/swish-7.wav', 'swishes-sound-pack/swish-9.wav', '3-melee-sounds/melee_sound.wav',
                     '3-melee-sounds/animal_melee_sound.wav'],
        dict(rms=-14, tail=0.7)),
    ('blunt', rng('37-hitspunches', 'hit{:02d}.mp3.flac', [1, 2, 3, 6, 7, 9, 12, 15]) + rng('thwack-sounds', 'thwack-0{}.wav', [2, 3, 5]),
        dict(rms=-13, tail=0.6)),
    ('blade', rng('machete-vs-spatula', 'machete_vs_spatula_{}.wav', [4, 5, 7, 9, 12, 14]), dict(rms=-17, tail=0.6, hp=300)),

    # ---- ambience beds (loops) ------------------------------------------------------------
    ('amb_wind', [('park-ambiences/park_ambience_wind.wav', 40.0, 26.0)], dict(loop=True, rms=-20, q=7)),
    ('amb_gust', [('windy-ambient-noise/windy_ambiance_0.ogg', 30.0, 22.0)], dict(loop=True, rms=-20, q=7)),
    ('amb_crickets', [('crickets-ambient-noise-loopable/crickets_1.mp3', 0.0, 11.4)], dict(loop=True, rms=-22, q=7, hp=1500)),
    ('amb_river', [('park-ambiences/park_ambience_river.wav', 120.0, 22.0)], dict(loop=True, rms=-21, q=7)),
    ('amb_birds', [('park-ambiences/park_ambience_birds.wav', 60.0, 22.0)], dict(loop=True, rms=-22, q=7)),
    ('amb_fire', [('fireplace-sound-loop/fire.wav', 2.0, 14.0)], dict(loop=True, rms=-20, q=7)),
    ('amb_generator', [('generator-loop/loop_generator_1.mp3', 0.1, 5.3)], dict(loop=True, rms=-20, q=7)),
    ('amb_static', [('frequency-static-sound-effects/static6.wav', 10.0, 4.0), ('frequency-static-sound-effects/static4.wav', 30.0, 4.0)],
        dict(loop=True, rms=-22, q=7)),

    # ---- ambient one-shots ------------------------------------------------------------------
    ('dog_far', segs('dog-barking-mono/dog_barking.wav', [(1.0, 3.2), (3.2, 5.4), (5.4, 7.5)]) + ['dog-barking-mono/dog_barking_mono.wav'],
        dict(rms=-16, lp=3500)),
    ('gun_far', segs('gunshot-sounds/sks.wav', [(0.32, 2.2), (6.0, 7.65)]) + segs('gunshot-sounds/mosin.wav', [(0.42, 2.6), (8.82, 11.4)]) +
        segs('gunshot-sounds/cz.wav', [(0.25, 2.6)]),
        dict(rms=-14, lp=2500)),
    ('bell_toll', [('100-cc0-sfx/gong_02.ogg', 0, 1.19), ('100-cc0-sfx/gong_01.ogg', 0, 1.42)], dict(rms=-16, rate=0.5)),
    ('tree_creak', segs('tree-creaking/tree_creak.flac', [(0.0, 2.6), (2.6, 5.2)]) + ['creaky-door-hinge-spooky/creaky_door_hinge.wav'],
        dict(rms=-18)),
    ('explosion_far', ['muffled-distant-explosion/NenadSimic_-_Muffled_Distant_Explosion.wav'], dict(rms=-12, tail=4.0)),
    ('fire_burst', ['fire-crackling/fire-1.wav', 'fire-crackling/fire-1_0.ogg'], dict(rms=-18)),

    # ---- real gunshots: an extra layer under the procedural bank -----------------------------------
    ('gun_rifle', segs('gunshot-sounds/sks.wav', [(0.32, 1.9), (3.32, 4.9)]) + segs('gunshot-sounds/mosin.wav', [(0.42, 2.0)]),
        dict(rms=-12, tail=1.6)),
    ('gun_pistol', segs('gunshot-sounds/cz.wav', [(0.25, 1.6), (4.03, 5.4)]) + segs('gunshots/Unkown.wav', [(0.24, 1.6)]),
        dict(rms=-12, tail=1.4)),
    ('gun_shotgun', ['gunshot-sounds/shotty.wav'] + segs('gunshots/Black_Powder.wav', [(0.13, 0.82)]), dict(rms=-12)),

    # ---- UI ------------------------------------------------------------------------------
    ('ui_type', rng('typewriter-sounds', 'typewriter{}.wav', [1, 3, 4, 6, 7, 8]), dict(rms=-18)),
    ('ui_paper', ['various-paper-sound-effects/Paper_Sound_-_1.wav', 'various-paper-sound-effects/Paper_Sound_-_2.wav',
                  'various-paper-sound-effects/Paper_Sound_-_3.wav', '100-cc0-sfx/paper_01.ogg', '100-cc0-sfx/paper_02.ogg',
                  'various-sound-effects/turn_page.wav'],
        dict(rms=-20, tail=0.9)),
    ('ui_stamp', ['100-cc0-sfx/wooden_01.ogg', '100-cc0-sfx/slam_03.ogg', '100-cc0-sfx/hit_03.ogg'], dict(rms=-16, tail=0.5)),
    ('ui_click', rng('51-ui-sound-effects-buttons-switches-and-clicks', 'click{}.wav', [1, 2, 3]) +
        rng('51-ui-sound-effects-buttons-switches-and-clicks', 'switch{}.wav', [2, 7]),
        dict(rms=-20)),

    # ---- footsteps -----------------------------------------------------------------------
    ('step_asphalt', rng('footsteps-0', '0{}-footstep.ogg', [2, 3, 4, 5, 6]) + ['footsteps-0/01-footstep_0.ogg',
                      'different-steps-on-wood-stone-leaves-gravel-and-mud/stone01.ogg'], dict(rms=-18)),
    ('step_leaves', ['different-steps-on-wood-stone-leaves-gravel-and-mud/leaves01.ogg', 'different-steps-on-wood-stone-leaves-gravel-and-mud/leaves02.ogg'] +
        [('20-rustles-dry-leaves/rustle{:02d}.flac'.format(n), 0, 0.45) for n in [1, 4, 7, 10]], dict(rms=-18)),
    ('step_gravel', ['different-steps-on-wood-stone-leaves-gravel-and-mud/gravel.ogg', 'different-steps-on-wood-stone-leaves-gravel-and-mud/mud02.ogg'],
        dict(rms=-18)),
    ('step_wood', rng('different-steps-on-wood-stone-leaves-gravel-and-mud', 'wood0{}.ogg', [1, 2, 3]), dict(rms=-18)),

    # ---- searching -------------------------------------------------------------------------
    ('door_creak', segs('various-sound-effects/door_creak_open.wav', [(0.08, 1.5)]) + ['various-sound-effects/floor_creak1.wav',
                    '100-cc0-metal-and-wood-sfx/wood_squeak_01.ogg', '100-cc0-metal-and-wood-sfx/wood_squeak_02.ogg'],
        dict(rms=-19)),
    ('door_open', rng('door-open-door-close-set', 'qubodup-DoorOpen0{}.flac', [1, 3, 5]), dict(rms=-18, tail=1.5)),
    ('door_close', rng('door-open-door-close-set', 'qubodup-DoorClose0{}.flac', [1, 4, 7]), dict(rms=-17, tail=1.2)),
    ('rummage', ['various-sound-effects/drawer_open.wav', 'various-sound-effects/drawer_close.wav', '100-cc0-sfx/wooded_box_open.ogg'] +
        rng('100-cc0-sfx', 'dishes_0{}.ogg', [1, 3]) + rng('100-cc0-sfx', 'tools_0{}.ogg', [2, 5]) + ['100-cc0-metal-and-wood-sfx/keys_02.ogg'] +
        [('20-rustles-dry-leaves/rustle{:02d}.flac'.format(n), 0, 0.9) for n in [13, 17]],
        dict(rms=-18, tail=1.2)),
    ('glass', rng('100-cc0-sfx', 'glass_0{}.ogg', [1, 2, 4]) + rng('75-cc0-breaking-falling-hit-sfx', 'bfh1_glass_breaking_0{}.ogg', [1, 2, 3]),
        dict(rms=-15, tail=1.4)),
    ('explosion', ['100-cc0-sfx/explosion.ogg'], dict(rms=-12)),
]


# ---------------------------------------------------------------------------------------
def decode(path, start=None, dur=None, hp=35, lp=None, rate=1.0):
    af = [f'highpass=f={hp}']
    if lp: af.append(f'lowpass=f={lp}')
    cmd = ['ffmpeg', '-nostdin', '-v', 'error']
    if start is not None: cmd += ['-ss', str(start)]
    if dur is not None: cmd += ['-t', str(dur)]
    cmd += ['-i', path, '-af', ','.join(af), '-ac', '1', '-ar', str(int(SR / rate)), '-f', 'f32le', '-']
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()
    # rate < 1: decoded at a higher rate, then treated as SR -> lower pitch, longer
    return x

def env_db(x, hop=256):
    n = max(1, len(x) // hop)
    e = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12) if len(x) >= hop else np.array([np.sqrt(np.mean(x ** 2) + 1e-12)])
    return 20 * np.log10(e / (e.max() + 1e-12))

def trim(x, lead_db=-40, tail_db=-48):
    hop = 256
    e = env_db(x, hop)
    on = np.where(e > lead_db)[0]
    if len(on) == 0: return x
    a = max(0, on[0] * hop - int(0.004 * SR))
    tail = np.where(e > tail_db)[0]
    b = min(len(x), (tail[-1] + 1) * hop + int(0.02 * SR))
    return x[a:b]

def loudest_rms(x, win=0.3):
    w = int(win * SR)
    if len(x) <= w: return np.sqrt(np.mean(x ** 2) + 1e-12)
    c = np.cumsum(np.concatenate([[0], x.astype(np.float64) ** 2]))
    return np.sqrt(((c[w:] - c[:-w]) / w).max() + 1e-12)

def fades(x, fin=0.003, fout=0.03):
    n = len(x)
    a = min(n // 4, int(fin * SR)); b = min(n // 3, int(fout * SR))
    if a: x[:a] *= np.linspace(0, 1, a)
    if b: x[-b:] *= np.linspace(1, 0, b) ** 2
    return x

def loopify(x, xf=1.2):
    n = int(xf * SR)
    body, tail = x[:-n], x[-n:]
    t = np.linspace(0, np.pi / 2, n)
    body = body.copy()
    body[:n] = body[:n] * np.sin(t) + tail * np.cos(t)  # equal-power crossfade of the end into the start
    return body

def normalize(x, rms_db, ceil_db=-1.0):
    g = 10 ** (rms_db / 20) / loudest_rms(x)
    pk = np.abs(x).max() + 1e-12
    g = min(g, 10 ** (ceil_db / 20) / pk)
    return x * g

def encode(x, dst, q):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                    '-c:a', 'libmp3lame', '-q:a', str(q), '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', dst],
                   input=pcm, check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, '*.mp3')): os.remove(f)
    used = {}  # pack -> list of shipped files
    manifest = {}
    total = 0
    for sid, variants, o in M:
        files = []
        for i, v in enumerate(variants):
            path, start, dur = (v, None, None) if isinstance(v, str) else v
            full = os.path.join(SRC, path)
            if not os.path.exists(full):
                sys.exit(f'missing source {path} (run tools/sfx-fetch.py)')
            x = decode(full, start, dur, hp=o.get('hp', 35), lp=o.get('lp'), rate=o.get('rate', 1.0))
            if o.get('loop'):
                x = loopify(x)
                x = normalize(x, o.get('rms', -20), -3)
            else:
                x = trim(x)
                if o.get('tail') and len(x) > o['tail'] * SR: x = x[: int(o['tail'] * SR)]
                x = normalize(x, o.get('rms', -16))
                x = fades(x)
            name = f'{sid}-{i + 1}.mp3'
            encode(x, os.path.join(OUT, name), o.get('q', 5))
            total += os.path.getsize(os.path.join(OUT, name))
            files.append(name)
            used.setdefault(path.split('/')[0], []).append(name)
        manifest[sid] = {'n': len(files), 'loop': bool(o.get('loop'))}
        print(f'{sid:14s} {len(files):2d} variants')
    print(f'total {total / 1024:.0f} KB in {sum(m["n"] for m in manifest.values())} files')

    # --- manifest for the loader ---
    ids = sorted(manifest)
    ts = ['// Generated by tools/sfx-build.py — do not edit. Recorded CC0 samples in public/sfx/ (see CREDITS.md).',
          '// id -> number of variants (<id>-1.mp3 … <id>-n.mp3); loop = seamless ambience bed.',
          'export const SAMPLES = {']
    for k in ids:
        ts.append(f"  {k}: {{ n: {manifest[k]['n']}, loop: {str(manifest[k]['loop']).lower()} }},")
    ts += ['} as const;', 'export type SampleId = keyof typeof SAMPLES;', '']
    open(os.path.join(ROOT, 'src/audio/sample-manifest.ts'), 'w').write('\n'.join(ts))

    # --- credits ---
    lines = ['# Credits', '',
             'The procedural audio (src/audio/*) and all code are original to this project. The recorded sound',
             'effects in `public/sfx/` are cut, trimmed, mixed down to mono and re-encoded from the following',
             '**CC0 / public-domain** sources. CC0 asks for no attribution; we list them anyway, with thanks.',
             'Each source page was checked for its license when downloaded (tools/sfx-fetch.py refuses non-CC0',
             'entries). Where a page offers several licenses, we use it under the CC0 option.', '',
             '| Source | Author | License | Shipped files |', '|---|---|---|---|']
    for pack in sorted(used):
        mp = os.path.join(SRC, pack, 'meta.json')
        meta = json.load(open(mp)) if os.path.exists(mp) else {}
        lic = 'CC0' if 'CC0' in meta.get('licenses', []) else '?'
        if lic != 'CC0': sys.exit(f'{pack}: license not recorded as CC0')
        title = meta.get('title', pack).replace('|', '/')
        url = meta.get('url', '')
        author = meta.get('author', '?')
        files = sorted(set(used[pack]), key=lambda s: (re.sub(r'-\d+\.mp3$', '', s), int(re.search(r'-(\d+)\.mp3$', s).group(1))))
        lines.append(f'| [{title}]({url}) | [{author}](https://opengameart.org/users/{author}) | CC0 1.0 | {", ".join(files)} |')
    lines += ['', 'Rebuild: `python3 tools/sfx-fetch.py <slugs…>` (downloads to the git-ignored tools/.cache/sfx-src/),',
              'then `python3 -I tools/sfx-build.py`.', '']
    open(os.path.join(ROOT, 'CREDITS.md'), 'w').write('\n'.join(lines))


if __name__ == '__main__':
    main()
