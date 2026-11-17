"""Bust portraits for the ledger (survivor cards, the survivor sheet, the end cards).

Cut from the full-resolution survivor generations (tools/.cache/raw/surv_*.png, 1408x768 on
magenta; falls back to public/sprites/surv_*.png), keyed, cropped head-and-shoulders and set on a
dark painted ground with a vignette and paper grain, like a photograph pinned in the ledger.
    python3 tools/make-portraits.py            -> public/art/port_<sprite>.jpg (240x300)
"""
import glob
import os
import random

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'art')
W, H = 240, 300
os.makedirs(OUT, exist_ok=True)


def keyed(path):
    im = np.asarray(Image.open(path).convert('RGBA')).astype(np.int32)
    r, g, b, a = im[..., 0], im[..., 1], im[..., 2], im[..., 3]
    mag = np.minimum(r, b) - g
    alpha = np.where((mag > 90) & (r > 120) & (b > 120), 0, a)
    soft = (mag > 35) & (alpha > 0)
    alpha = np.where(soft, np.clip(255 * (1 - (mag - 35) / 55), 0, 255), alpha).astype(np.uint8)
    # despill the magenta fringe
    rr = np.where(soft, np.minimum(r, g + 25), r)
    bb = np.where(soft, np.minimum(b, g + 25), b)
    out = np.stack([rr, g, bb, alpha], -1).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def ground(rng):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    # light from the top left, as everywhere in the game
    d = np.sqrt(((x - W * 0.38) / W) ** 2 + ((y - H * 0.3) / H) ** 2)
    v = np.clip(1 - d * 1.35, 0, 1) ** 1.4
    base = np.array([24, 21, 18], np.float32)
    lit = np.array([70, 62, 52], np.float32)
    img = base + (lit - base) * v[..., None]
    noise = rng.normal(0, 5.5, (H, W, 1)).astype(np.float32)
    img = np.clip(img + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(img, 'RGB').filter(ImageFilter.GaussianBlur(0.6))


def portrait(src, out):
    fig = keyed(src)
    a = np.asarray(fig)[..., 3]
    ys, xs = np.nonzero(a > 40)
    top, bot = ys.min(), ys.max()
    fh = bot - top
    # the head: the columns with ink in the top tenth of the figure
    band = a[top:top + int(fh * 0.1)] > 40
    cols = np.nonzero(band.any(0))[0]
    hx = (cols.min() + cols.max()) / 2
    ch = fh * 0.40
    cw = ch * W / H
    x0 = hx - cw * 0.5
    y0 = top - fh * 0.045
    crop = fig.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((W, H), Image.LANCZOS)
    rng = np.random.default_rng(abs(hash(os.path.basename(src))) % 2**32)
    bg = ground(rng)
    # a soft cast shadow behind the figure, down and to the right
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sa = crop.split()[3].filter(ImageFilter.GaussianBlur(7)).point(lambda p: int(p * 0.55))
    sh.putalpha(sa)
    bg.paste((8, 7, 6), (6, 5), sa)
    bg.paste(crop, (0, 0), crop)
    # vignette and a faint grade toward the ledger's bone/sepia
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    vig = np.clip(1 - (((x - W / 2) / (W * 0.62)) ** 2 + ((y - H * 0.45) / (H * 0.66)) ** 2) * 0.55, 0.45, 1)
    px = np.asarray(bg).astype(np.float32) * vig[..., None]
    lum = px.mean(-1, keepdims=True)
    px = px * 0.86 + lum * np.array([1.04, 0.98, 0.88]) * 0.14
    Image.fromarray(np.clip(px, 0, 255).astype(np.uint8)).save(out, quality=86, optimize=True)
    print(out)


random.seed(7)
ids = sorted({os.path.basename(p)[:-4] for p in glob.glob(os.path.join(ROOT, 'public/sprites/surv_*.png'))})
for i in ids:
    raw = os.path.join(ROOT, 'tools/.cache/raw', f'{i}.png')
    portrait(raw if os.path.exists(raw) else os.path.join(ROOT, 'public/sprites', f'{i}.png'), os.path.join(OUT, f'port_{i}.jpg'))
