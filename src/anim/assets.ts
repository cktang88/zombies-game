// Loading of cutout part atlases (public/sprites/parts/<id>.png + .json, written by
// tools/segment.ts) and weapon icons, plus the pre-baked variants the renderer needs:
// a darkened copy of the atlas for far-side limbs, a flat shadow copy for contact shading,
// a white flash copy for hit flashes, and the magazine cut out of each gun icon.
import { WEAPON_ANCHORS, type WeaponAnchors } from './weaponAnchors';

export interface PartMeta {
  x: number; y: number; w: number; h: number;
  px: number; py: number; // pivot (proximal joint) inside the part image
  tx: number; ty: number; // distal joint inside the part image
  rest: number; // bone angle in the source art
  len: number; // bone length, rig units
  gx?: number; gy?: number; // hands: palm/grip point in the bone frame (from the wrist)
}
export interface RigMeta {
  id: string;
  height: number;
  ground: number;
  joints: Record<string, [number, number]>;
  parts: Record<string, PartMeta>;
}
export interface RigAsset {
  meta: RigMeta;
  atlas: CanvasImageSource;
  dark: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  /** per-look variants (night/actors.ts): graded atlases, silhouettes, dilated outlines */
  skins: Map<string, HTMLCanvasElement>;
}
export interface GunAsset {
  a: WeaponAnchors;
  img: CanvasImageSource; // the gun without its magazine (if it has one)
  full: CanvasImageSource; // the gun as drawn in the icon
  mag?: HTMLCanvasElement; // the magazine on its own
  w: number; h: number;
}

const base = (): string => {
  try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'; } catch { return './'; }
};
const rigCache = new Map<string, RigAsset | null>();
const rigWait = new Map<string, Promise<RigAsset | null>>();
const gunCache = new Map<string, GunAsset | null>();
const gunWait = new Map<string, Promise<GunAsset | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}
function tinted(src: CanvasImageSource, w: number, h: number, color: string, alpha: number, mode: GlobalCompositeOperation = 'source-atop'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = mode;
  x.globalAlpha = alpha;
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  return c;
}

/** Transparent gutter (atlas px) round every part after re-packing. */
export const ATLAS_PAD = 7;
function repack(im: HTMLImageElement, meta: RigMeta): HTMLCanvasElement {
  const names = Object.keys(meta.parts).sort((a, b) => meta.parts[b].h - meta.parts[a].h);
  const W = 640;
  let x = 0, y = 0, rowH = 0;
  const pos: Record<string, [number, number]> = {};
  for (const n of names) {
    const p = meta.parts[n];
    const w = p.w + ATLAS_PAD * 2, h = p.h + ATLAS_PAD * 2;
    if (x + w > W) { x = 0; y += rowH; rowH = 0; }
    pos[n] = [x + ATLAS_PAD, y + ATLAS_PAD];
    x += w; rowH = Math.max(rowH, h);
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.max(1, y + rowH);
  const x2 = c.getContext('2d')!;
  for (const n of names) {
    const p = meta.parts[n];
    x2.drawImage(im, p.x, p.y, p.w, p.h, pos[n][0], pos[n][1], p.w, p.h);
    p.x = pos[n][0]; p.y = pos[n][1];
  }
  return c;
}

/**
 * A cached per-look variant of a rig's atlas (same layout, so the rig draws it with the same
 * part rects). key must identify `make` uniquely for this asset.
 */
export function skinCanvas(a: RigAsset, key: string, make: (src: CanvasImageSource, w: number, h: number, x: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let c = a.skins.get(key);
  if (c) return c;
  const src = a.atlas as HTMLCanvasElement;
  c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  make(src, src.width, src.height, c.getContext('2d')!);
  a.skins.set(key, c);
  return c;
}
/** Graded copy of the atlas (and of its darkened far-limb copy): brightness/saturation, then flat tints. */
export function gradedAtlas(a: RigAsset, key: string, filter: string, tints: [string, number][], far = false, ink = 0): HTMLCanvasElement {
  return skinCanvas(a, `g|${far ? 1 : 0}|${ink}|${key}`, (_src, w, h, x) => {
    x.filter = filter;
    x.drawImage(far ? a.dark : a.atlas, 0, 0);
    x.filter = 'none';
    x.globalCompositeOperation = 'source-atop';
    for (const [col, al] of tints) if (al > 0) { x.globalAlpha = al; x.fillStyle = col; x.fillRect(0, 0, w, h); }
    // an ink line round every part, under it (draw these parts with grow = ink)
    if (ink > 0) { x.globalCompositeOperation = 'destination-over'; x.globalAlpha = 1; x.drawImage(outlineAtlas(a, ink), 0, 0); }
  });
}
/** Flat-colour silhouette of every part (rim bands, hit edges). */
export function silAtlas(a: RigAsset, color: string): HTMLCanvasElement {
  return skinCanvas(a, `s|${color}`, (src, w, h, x) => {
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = color; x.fillRect(0, 0, w, h);
  });
}
/** The silhouette grown by r atlas px (ink outline stamped under the body). r ≤ ATLAS_PAD - 1. */
export function outlineAtlas(a: RigAsset, r: number, color = '#050608'): HTMLCanvasElement {
  r = Math.max(1, Math.min(ATLAS_PAD - 1, Math.round(r)));
  return skinCanvas(a, `o|${r}|${color}`, (_src, _w, _h, x) => {
    const sil = silAtlas(a, color);
    const n = r > 2 ? 16 : 8;
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; x.drawImage(sil, Math.round(Math.cos(t) * r), Math.round(Math.sin(t) * r)); }
    x.drawImage(sil, 0, 0);
  });
}

/** Load (once) the part atlas for a sprite id. Resolves null when no parts exist. */
export function loadRig(id: string): Promise<RigAsset | null> {
  if (rigCache.has(id)) return Promise.resolve(rigCache.get(id)!);
  let p = rigWait.get(id);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(`${base()}sprites/parts/${id}.json`);
        if (!r.ok) throw new Error('no parts');
        const meta = (await r.json()) as RigMeta;
        const raw = await loadImage(`${base()}sprites/parts/${id}.png`);
        if (!raw) throw new Error('no atlas');
        // re-pack with a transparent gutter round every part, so the dilated (outline) and
        // offset (rim) silhouettes of a part never pick up its neighbour
        const im = repack(raw, meta);
        const w = im.width, h = im.height;
        const asset: RigAsset = {
          meta,
          atlas: im,
          dark: tinted(im, w, h, '#14110f', 0.42),
          shadow: tinted(im, w, h, '#000', 1),
          flash: tinted(im, w, h, '#fff4e0', 1),
          skins: new Map(),
        };
        rigCache.set(id, asset);
        return asset;
      } catch {
        rigCache.set(id, null);
        return null;
      }
    })();
    rigWait.set(id, p);
  }
  return p;
}
export const getRig = (id: string) => rigCache.get(id) ?? undefined;

/** Load a weapon icon and cut its magazine out into a separate sprite. */
export function loadGun(defId: string): Promise<GunAsset | null> {
  if (gunCache.has(defId)) return Promise.resolve(gunCache.get(defId)!);
  let p = gunWait.get(defId);
  if (!p) {
    p = (async () => {
      const a = WEAPON_ANCHORS[defId];
      if (!a) { gunCache.set(defId, null); return null; }
      const im = await loadImage(`${base()}sprites/${a.icon}.png`);
      if (!im) { gunCache.set(defId, null); return null; }
      const g: GunAsset = { a, img: im, full: im, w: im.width, h: im.height };
      if (a.mag) {
        const [mx, my, mw, mh] = a.mag;
        const mag = document.createElement('canvas');
        mag.width = mw; mag.height = mh;
        mag.getContext('2d')!.drawImage(im, mx, my, mw, mh, 0, 0, mw, mh);
        const body = document.createElement('canvas');
        body.width = im.width; body.height = im.height;
        const bx = body.getContext('2d')!;
        bx.drawImage(im, 0, 0);
        // keep a 2px lip at the top of the well so the receiver isn't notched
        bx.clearRect(mx, my + 3, mw, mh);
        g.mag = mag;
        g.img = body;
      }
      gunCache.set(defId, g);
      return g;
    })();
    gunWait.set(defId, p);
  }
  return p;
}
export const getGun = (defId: string) => gunCache.get(defId) ?? undefined;

/**
 * How a held weapon is graded to sit in the body's light: the same filter and flat tints as the
 * body's atlas (night/actors.ts applyLook), plus the ink outline width in display px.
 */
export interface GunLook { key: string; filter: string; tints: [string, number][]; ink: number }
export interface BakedIcon { c: HTMLCanvasElement; k: number; pad: number }
/** the icons are bright UI art: pull them into the inked bodies' value range */
const GUN_GRADE = 'brightness(0.8) saturate(0.78) contrast(1.08)';
const iconCache = new Map<string, BakedIcon>();
let iconBytes = 0;
const ICON_BUDGET = 24 * 1024 * 1024;
/**
 * A weapon icon (or its cut-out magazine) resampled once to the size it is drawn at (`k` device
 * px per icon px, bucketed), graded like the body and ringed with the body's ink line.
 * Drawing the 100-400 px icons straight down to a 20-90 px gun skipped most of their pixels
 * (Canvas2D's default sampling has no mipmaps): the dark linework vanished and the guns read
 * pale and see-through next to the inked bodies.
 */
export function bakedIcon(id: string, src: CanvasImageSource, w: number, h: number, look: GunLook | null, k: number, inkPx: number): BakedIcon {
  k = Math.pow(2, Math.round(Math.log2(Math.max(0.02, Math.min(4, k))) * 6) / 6);
  const ink = Math.max(0, Math.round(inkPx * 2) / 2);
  const key = `${id}|${look?.key ?? '-'}|${k.toFixed(4)}|${ink}`;
  let b = iconCache.get(key);
  if (b) { iconCache.delete(key); iconCache.set(key, b); return b; }
  const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
  // progressive halving, then one smooth step: every source pixel contributes
  let cur: CanvasImageSource = src, cw = w, ch = h;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const n = document.createElement('canvas');
    n.width = Math.max(1, Math.round(cw / 2)); n.height = Math.max(1, Math.round(ch / 2));
    const x = n.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch, 0, 0, n.width, n.height);
    cur = n; cw = n.width; ch = n.height;
  }
  const pad = Math.ceil(ink) + 1;
  const g = document.createElement('canvas');
  g.width = tw; g.height = th;
  const gx = g.getContext('2d')!;
  gx.imageSmoothingQuality = 'high';
  gx.filter = `${look?.filter ?? ''} ${GUN_GRADE}`.trim();
  gx.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
  gx.filter = 'none';
  gx.globalCompositeOperation = 'source-atop';
  for (const [col, al] of look?.tints ?? []) if (al > 0) { gx.globalAlpha = al; gx.fillStyle = col; gx.fillRect(0, 0, tw, th); }
  // resampled edges are soft: firm up the coverage so the gun is as solid as the body
  const id2 = gx.getImageData(0, 0, tw, th), d = id2.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 40 ? d[i] : Math.min(255, Math.round(d[i] * 1.5));
  gx.putImageData(id2, 0, 0);
  const c = document.createElement('canvas');
  c.width = tw + pad * 2; c.height = th + pad * 2;
  const x = c.getContext('2d')!;
  if (ink > 0) {
    // the ink line: the silhouette stamped round a ring of radius `ink`, under the gun
    const sil = document.createElement('canvas');
    sil.width = tw; sil.height = th;
    const sx = sil.getContext('2d')!;
    sx.drawImage(g, 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = '#050608'; sx.fillRect(0, 0, tw, th);
    const n = ink > 1.5 ? 16 : 8;
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; x.drawImage(sil, pad + Math.cos(t) * ink, pad + Math.sin(t) * ink); }
  }
  x.drawImage(g, pad, pad);
  b = { c, k, pad };
  iconCache.set(key, b);
  iconBytes += c.width * c.height * 4;
  if (iconBytes > ICON_BUDGET) for (const [kk, v] of iconCache) {
    if (iconBytes <= ICON_BUDGET * 0.7) break;
    iconCache.delete(kk); iconBytes -= v.c.width * v.c.height * 4;
  }
  return b;
}

/** Load every gun with anchors (for a dev page / preloading). */
export const loadAllGuns = () => Promise.all(Object.keys(WEAPON_ANCHORS).map(loadGun));
