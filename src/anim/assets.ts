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
  /** arm kit (docs/research/13 §6, tools/cut-sheet.ts): whole-arm sleeve drawings at several elbow
   * bends replace the cut upperArm / forearm. A name (kit_<name> for both sides) or one per side. */
  kit?: string | { near: string; far: string };
  /** filled at load from `kit`: the drawings per side, as atlas parts named kitN<i> / kitF<i> */
  kitArms?: { near: KitDraw[]; far: KitDraw[] };
  /** aim units (docs/research/14 §3, tools/cut-unit.ts): weapon id → unit_<name> drawing of the torso,
   * head, both arms, hands and gun in the firing pose, drawn instead of those parts while aiming */
  aimUnits?: Record<string, string>;
  /** filled at load from `aimUnits` (+ AIM_UNIT_SHARES): weapon id → the drawing (an atlas part named after the unit) */
  units?: Record<string, UnitDraw>;
  /** LOW-READY units (tools/aim-guide.ts `ready`): the same one-piece drawing with the gun muzzle-down at low ready,
   * drawn while the gun is held but not aiming; the rig cross-dissolves it with the aim unit as the gun comes up.
   * weapon id → unit_<name>_ready. A rig json may give it; else it comes from parts/unit_index.json. */
  readyUnits?: Record<string, string>;
  /** RELOAD key drawings (tools/aim-guide.ts `reload`): gun canted at the chest, support hand at the magazine well,
   * drawn through the middle of a reload clip. weapon id → unit_<name>_reload (same sources as readyUnits). */
  reloadUnits?: Record<string, string>;
  /** filled at load from readyUnits / reloadUnits (+ AIM_UNIT_SHARES) */
  unitsReady?: Record<string, UnitDraw>;
  unitsReload?: Record<string, UnitDraw>;
  /** the units' drawn gun against the gun icon (parts/unit_index.json cutGunScale, + AIM_UNIT_SHARES): weapon id → scale */
  gunScale?: Record<string, number>;
}
/** One aim unit: its pelvis, neck and muzzle inside the drawing (rig units, from its top-left) and
 * the barrel's angle in the drawing. */
export interface UnitDraw {
  part: string; pelvis: [number, number]; neck: [number, number]; muzzle: [number, number]; bore: number;
  /** the point the gun turns about between drawings (the butt in the shoulder; a pistol's shoulder), when the cut knows it */
  pocket?: [number, number];
}
/** One kit drawing: its elbow bend (deg, forearm turned up from a level upper arm) and its
 * shoulder / elbow / wrist inside the drawing (rig units, from the drawing's top-left). */
export interface KitDraw { part: string; bend: number; s: [number, number]; e: [number, number]; wr: [number, number] }
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
  /** long guns: icon y of the top of the stock where the cheek rests (the comb), measured from the art */
  combY?: number;
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

/**
 * The far-side limbs: one arm/leg art serves both sides, so the far copy is pushed back hard enough
 * that a distinctive mark on the near sleeve (a patch, a stripe, blood) does not read mirrored on
 * the far arm: desaturated, softened a touch and lowered in contrast, then darkened.
 */
function farCopy(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  // no blur: blurred alpha clipped back to the silhouette left every far limb semi-transparent at
  // its edges (it read as a ghost arm); solid, just pushed back in value and colour
  x.filter = 'saturate(0.5) contrast(0.9)';
  x.drawImage(src, 0, 0);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = 0.38;
  x.fillStyle = '#14110f';
  x.fillRect(0, 0, w, h);
  return c;
}

/** Transparent gutter (atlas px) round every part after re-packing. */
export const ATLAS_PAD = 7;
interface KitFile { near: (Omit<KitDraw, 'part'> & { x: number; y: number; w: number; h: number })[]; far: KitFile['near'] }
/** The rig's atlas with its arm kit sheet(s) stacked under it; the drawings become parts kitN<i> / kitF<i>. */
async function withKit(im: HTMLImageElement, meta: RigMeta): Promise<HTMLCanvasElement | null> {
  const k = meta.kit!;
  const names = typeof k === 'string' ? { near: k, far: k } : k;
  const files: Record<string, { j: KitFile; im: HTMLImageElement }> = {};
  for (const n of new Set([names.near, names.far])) {
    const r = await fetch(`${base()}sprites/parts/kit_${n}.json`).catch(() => null);
    const kim = r?.ok ? await loadImage(`${base()}sprites/parts/kit_${n}.png`) : null;
    if (!r?.ok || !kim) return null;
    files[n] = { j: (await r.json()) as KitFile, im: kim };
  }
  const list = [...new Set([names.near, names.far])];
  const c = document.createElement('canvas');
  c.width = Math.max(im.width, ...list.map((n) => files[n].im.width));
  c.height = im.height + list.reduce((s, n) => s + files[n].im.height, 0);
  const x = c.getContext('2d')!;
  x.drawImage(im, 0, 0);
  const oy: Record<string, number> = {};
  let y = im.height;
  for (const n of list) { oy[n] = y; x.drawImage(files[n].im, 0, y); y += files[n].im.height; }
  const arms: { near: KitDraw[]; far: KitDraw[] } = { near: [], far: [] };
  for (const side of ['near', 'far'] as const) {
    const n = names[side];
    files[n].j[side].forEach((d, i) => {
      const part = `kit${side === 'near' ? 'N' : 'F'}${i}`;
      const len = Math.hypot(d.e[0] - d.s[0], d.e[1] - d.s[1]);
      meta.parts[part] = { x: d.x, y: d.y + oy[n], w: d.w, h: d.h, px: d.s[0], py: d.s[1], tx: d.e[0], ty: d.e[1], rest: Math.atan2(d.e[1] - d.s[1], d.e[0] - d.s[0]), len };
      arms[side].push({ part, bend: d.bend, s: d.s, e: d.e, wr: d.wr });
    });
  }
  if (!arms.near.length || !arms.far.length) return null;
  meta.kitArms = arms;
  return c;
}
/**
 * Which other guns may borrow a rig's aim unit (weapon id → guns drawn with that unit when the rig has none of
 * its own for them). Only where the side-view silhouette at game scale is close enough that the drawn gun reads
 * as the held one (same length class, same stock / grip shape, scope or no scope):
 *   ar15     → carbine            (the same 5.56 platform: black, pistol grip, mag, collapsible stock)
 *   hunting  → scoped             (scoped bolt rifles with a wooden stock)
 *   lever    → r22, muzzle        (long unscoped wooden rifles)
 *   pump     → coach              (long wooden-stock shotguns; a unit only shows while aiming, never in a reload)
 *   service9 ↔ m1911              (full-size semi-auto pistols)
 * Not shared: revolver (the cylinder), smg (no other gun of that size and shape: mp93 is a machine pistol),
 * snake410 (silver receiver, black synthetic stock: reads as another gun), autoshot (black, pistol grip), pipe,
 * lmg, launchers, bows (different silhouettes or holds).
 */
export const AIM_UNIT_SHARES: Record<string, string[]> = {
  ar15: ['carbine'], hunting: ['scoped'], lever: ['r22', 'muzzle'], pump: ['coach'], service9: ['m1911'], m1911: ['service9'],
};
/** A rig's `aimUnits` with the AIM_UNIT_SHARES borrowers added (a rig's own unit for a gun always wins). */
export function aimUnitsWithShares(own: Record<string, string>): Record<string, string> {
  const out = { ...own };
  for (const [w, n] of Object.entries(own)) for (const s of AIM_UNIT_SHARES[w] ?? []) if (!(s in out)) out[s] = n;
  return out;
}
/** parts/unit_index.json: the low-ready and reload units per rig (kept out of the rig jsons, which other tools rewrite) */
let unitIndex: Promise<{ readyUnits?: Record<string, Record<string, string>>; reloadUnits?: Record<string, Record<string, string>>; cutGunScale?: Record<string, Record<string, number>> }> | null = null;
function loadUnitIndex() {
  unitIndex ??= fetch(`${base()}sprites/parts/unit_index.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return unitIndex;
}
/** The atlas with the rig's unit drawings (aim, low ready, reload) stacked under it, one part per drawing (named
 * after the unit); every gun that uses a drawing (its own and the AIM_UNIT_SHARES borrowers) points at the same part. */
async function withUnits(im: CanvasImageSource & { width: number; height: number }, meta: RigMeta): Promise<HTMLCanvasElement | null> {
  const got: [string, UnitDraw & { im: HTMLImageElement }][] = [];
  const all = [meta.aimUnits, meta.readyUnits, meta.reloadUnits].flatMap((m) => Object.values(m ?? {}));
  for (const n of new Set(all)) {
    const r = await fetch(`${base()}sprites/parts/${n}.json`).catch(() => null);
    const uim = r?.ok ? await loadImage(`${base()}sprites/parts/${n}.png`) : null;
    if (!r?.ok || !uim) continue;
    const j = (await r.json()) as Omit<UnitDraw, 'part'>;
    got.push([n, { ...j, part: n, im: uim }]);
  }
  if (!got.length) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(im.width, ...got.map(([, u]) => u.im.width));
  c.height = im.height + got.reduce((s, [, u]) => s + u.im.height, 0);
  const x = c.getContext('2d')!;
  x.drawImage(im, 0, 0);
  let y = im.height;
  meta.units = {}; meta.unitsReady = {}; meta.unitsReload = {};
  const byName = new Map(got);
  for (const [, u] of got) {
    x.drawImage(u.im, 0, y);
    const len = Math.hypot(u.neck[0] - u.pelvis[0], u.neck[1] - u.pelvis[1]);
    meta.parts[u.part] = { x: 0, y, w: u.im.width, h: u.im.height, px: u.pelvis[0], py: u.pelvis[1], tx: u.neck[0], ty: u.neck[1], rest: Math.atan2(u.neck[1] - u.pelvis[1], u.neck[0] - u.pelvis[0]), len };
    y += u.im.height;
  }
  const fill = (own: Record<string, string> | undefined, to: Record<string, UnitDraw>, sameAim = false) => {
    for (const [weapon, n] of Object.entries(aimUnitsWithShares(own ?? {}))) {
      const u = byName.get(n);
      // a low-ready / reload drawing goes to a borrower only while that gun is still aimed with the owner's drawing
      // (not once it has an aim unit of its own: the gun would change shape between the drawings)
      if (sameAim && !(weapon in (own ?? {}))) {
        const owner = Object.keys(own ?? {}).find((w) => (AIM_UNIT_SHARES[w] ?? []).includes(weapon));
        if (!owner || meta.units![weapon]?.part !== meta.units![owner]?.part) continue;
      }
      if (u) to[weapon] = { part: u.part, pelvis: u.pelvis, neck: u.neck, muzzle: u.muzzle, bore: u.bore, pocket: u.pocket };
    }
  };
  fill(meta.aimUnits, meta.units); fill(meta.readyUnits, meta.unitsReady, true); fill(meta.reloadUnits, meta.unitsReload, true);
  return c;
}
function repack(im: CanvasImageSource, meta: RigMeta): HTMLCanvasElement {
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
        let raw: CanvasImageSource | null = await loadImage(`${base()}sprites/parts/${id}.png`);
        if (!raw) throw new Error('no atlas');
        if (meta.kit) raw = (await withKit(raw as HTMLImageElement, meta)) ?? raw;
        if (meta.aimUnits) {
          const ix = await loadUnitIndex();
          meta.readyUnits ??= ix.readyUnits?.[id];
          meta.reloadUnits ??= ix.reloadUnits?.[id];
          raw = (await withUnits(raw as HTMLCanvasElement, meta)) ?? raw;
          // a gun's scale goes to every gun drawn by the same aim drawing (the AIM_UNIT_SHARES borrowers without their own)
          const gs = meta.gunScale ?? ix.cutGunScale?.[id];
          if (gs) {
            meta.gunScale = {};
            for (const [w, v] of Object.entries(gs)) for (const [w2, u] of Object.entries(meta.units ?? {})) if (u.part === meta.units?.[w]?.part) meta.gunScale[w2] = v;
          }
        }
        // re-pack with a transparent gutter round every part, so the dilated (outline) and
        // offset (rim) silhouettes of a part never pick up its neighbour
        const im = repack(raw, meta);
        const w = im.width, h = im.height;
        const asset: RigAsset = {
          meta,
          atlas: im,
          dark: farCopy(im, w, h),
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
      if (a.butt) g.combY = combOf(im, a);
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

/** The comb: the highest the stock's top edge gets in the middle half between the butt and the
 * grip (the cheek rests on the stock's top line, not on the butt anchor's height). */
function combOf(im: HTMLImageElement, a: WeaponAnchors): number | undefined {
  try {
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width, im.height).data;
    const b = a.butt![0], gx = a.grip[0];
    const lo = Math.round(Math.min(b + (gx - b) * 0.2, b + (gx - b) * 0.7)), hi = Math.round(Math.max(b + (gx - b) * 0.2, b + (gx - b) * 0.7));
    let top = 1e9;
    for (let cx = Math.max(0, lo); cx <= Math.min(im.width - 1, hi); cx++) {
      for (let y = 0; y < im.height; y++) if (d[(y * im.width + cx) * 4 + 3] > 100) { top = Math.min(top, y); break; }
    }
    return top < 1e9 ? top : undefined;
  } catch { return undefined; }
}
