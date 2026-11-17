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
        const im = await loadImage(`${base()}sprites/parts/${id}.png`);
        if (!im) throw new Error('no atlas');
        const w = im.width, h = im.height;
        const asset: RigAsset = {
          meta,
          atlas: im,
          dark: tinted(im, w, h, '#14110f', 0.42),
          shadow: tinted(im, w, h, '#000', 1),
          flash: tinted(im, w, h, '#fff4e0', 1),
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

/** Load every gun with anchors (for a dev page / preloading). */
export const loadAllGuns = () => Promise.all(Object.keys(WEAPON_ANCHORS).map(loadGun));
