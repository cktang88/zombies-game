const imgs = new Map<string, HTMLImageElement>();

const IDS = [
  'surv_rifle', 'surv_pistol', 'surv_shotgun', 'surv_smg', 'surv_idle', 'surv_f_old', 'surv_f_mid', 'surv_m_mid', 'surv_m_young',
  'surv_f_native', 'surv_m_old', 'surv_m_big', 'surv_f_young',
  'z_shambler', 'z_shambler2', 'z_runner', 'z_bloater', 'z_brute', 'z_crawler', 'z_riot', 'z_shrieker',
  'barricade', 'barricade_broken', 'corpse', 'obj_door', 'obj_car', 'obj_shed', 'obj_body', 'obj_kin',
  'icon_pistol', 'icon_revolver', 'icon_shotgun', 'icon_rifle', 'icon_smg', 'icon_carbine', 'icon_nailgun', 'icon_molotov',
  'icon_scrap', 'icon_food', 'icon_meds', 'icon_ammo', 'icon_fuel', 'icon_wood', 'icon_parts', 'icon_cloth',
];
const JPG = ['bg_sky', 'bg_far', 'bg_mid'];

export function spriteUrl(id: string) {
  return `${import.meta.env.BASE_URL}sprites/${id}.${JPG.includes(id) ? 'jpg' : 'png'}`;
}

export async function loadAssets(onProgress?: (p: number) => void) {
  const all = [...IDS, ...JPG];
  let done = 0;
  await Promise.all(
    all.map(
      (id) =>
        new Promise<void>((res) => {
          const im = new Image();
          im.onload = () => {
            imgs.set(id, im);
            onProgress?.(++done / all.length);
            res();
          };
          im.onerror = () => {
            onProgress?.(++done / all.length);
            res();
          };
          im.src = spriteUrl(id);
        }),
    ),
  );
}

export function img(id: string): HTMLImageElement | undefined {
  return imgs.get(id);
}

// White silhouette versions for hit flashes, built lazily.
const flashCache = new Map<string, HTMLCanvasElement>();
export function flashImg(id: string): HTMLCanvasElement | undefined {
  if (flashCache.has(id)) return flashCache.get(id);
  const im = imgs.get(id);
  if (!im) return undefined;
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const x = c.getContext('2d')!;
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = '#fff4e0';
  x.fillRect(0, 0, c.width, c.height);
  flashCache.set(id, c);
  return c;
}

// Dark silhouette version (shadow-blocking, survivors seen against the light)
const shadowCache = new Map<string, HTMLCanvasElement>();
export function shadeImg(id: string, color = '#0d0c0b'): HTMLCanvasElement | undefined {
  const key = id + color;
  if (shadowCache.has(key)) return shadowCache.get(key);
  const im = imgs.get(id);
  if (!im) return undefined;
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const x = c.getContext('2d')!;
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  shadowCache.set(key, c);
  return c;
}
