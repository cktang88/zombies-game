// Procedural effect textures (docs/research/10-vfx.md §4): every glow, flame, puff, plume, streak and decal is
// generated once into a small offscreen canvas at startup and only stamped with drawImage afterwards (no
// per-frame gradients, no filters, no shadowBlur). The look follows the game's cel-shaded graphic-novel art:
// flames and fireballs are hard-banded temperature ramps (pale core → yellow → orange → red rim) and smoke is
// two-tone shaded from its own density gradient, lit from the top left, with a darker silhouette band
// (after siege-game src/fx.ts and McGuire et al., "Real-Time Cartoon Rendering of Smoke"). Soft additive
// glows sit under the hard shapes as the bloom.

export type Cv = HTMLCanvasElement;
type RGB = [number, number, number];

function mk(w: number, h: number): [Cv, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

// ---------- deterministic noise ----------
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const hash2 = (x: number, y: number, s: number) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number) {
  return (vnoise(x, y, s) * 0.5 + vnoise(x * 2.03 + 17, y * 2.03 + 9, s) * 0.3 + vnoise(x * 4.1 + 5, y * 4.1 + 31, s) * 0.2);
}
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Fill a canvas pixel by pixel: f(x, y) → [r, g, b, a] (0..255) written into out. */
function raster(w: number, h: number, f: (x: number, y: number, out: number[]) => void): Cv {
  const [c, g] = mk(w, h);
  const im = g.createImageData(w, h);
  const d = im.data;
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    o[0] = o[1] = o[2] = o[3] = 0;
    f(x, y, o);
    const i = (y * w + x) * 4;
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3];
  }
  g.putImageData(im, 0, 0);
  return c;
}

// ---------- glows (bloom) ----------
export const GLOW = {
  white: '#fff6e6', warm: '#ffd796', orange: '#ff8a32', red: '#d8401c', tracer: '#ff6a32', flare: '#ff3c3c',
  blue: '#a6c8ff', ember: '#ff9a40', pale: '#ffe8c0', green: '#c8d060',
} as const;
export type GlowCol = keyof typeof GLOW;

function glowTex(col: string, S = 64): Cv {
  const [c, g] = mk(S, S);
  const [r, gg, b] = hex(col);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // bright centre, long soft tail: reads as light, not as a disc
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  gr.addColorStop(0.16, `rgba(${r},${gg},${b},0.62)`);
  gr.addColorStop(0.42, `rgba(${r},${gg},${b},0.2)`);
  gr.addColorStop(0.72, `rgba(${r},${gg},${b},0.05)`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

// ---------- fire: temperature stages, hard bands ----------
// 0 white-hot, 1 yellow, 2 orange, 3 deep red. Each stage is a lumpy blob whose bands are shifted down the ramp.
const RAMP: RGB[] = [[255, 250, 230], [255, 222, 120], [255, 150, 44], [222, 72, 22], [140, 32, 14], [60, 18, 10]];
function fireBlob(stage: number, variant: number, S = 96): Cv {
  const R = rng(1000 + stage * 31 + variant * 7);
  const lobes: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + R() * 0.6, d = 0.18 + R() * 0.2;
    lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.22 + R() * 0.14]);
  }
  lobes.push([0, 0, 0.42]);
  const sd = variant * 13 + stage;
  return raster(S, S, (x, y, o) => {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
    let f = 0;
    for (const [lx, ly, lr] of lobes) {
      const dx = u - lx, dy = v - ly;
      f = Math.max(f, 1 - Math.sqrt(dx * dx + dy * dy) / lr);
    }
    f -= (fbm(u * 2.6 + 4, v * 2.6 + 7, sd) - 0.5) * 0.3;
    if (f <= 0) return;
    // bands: rim → core; the stage pushes every band one step toward red
    const bands = [0.02, 0.12, 0.28, 0.5];
    let k = 0;
    for (let i = 0; i < bands.length; i++) if (f > bands[i]) k = i;
    const ci = Math.min(RAMP.length - 1, 3 - k + stage);
    const [r, g, b] = RAMP[ci];
    const edge = sstep(0.02, 0.07, f);
    o[0] = r; o[1] = g; o[2] = b; o[3] = 255 * edge * (stage >= 3 ? 0.8 : 0.95);
  });
}

/** A licking flame tongue, base at the bottom centre, tip up: pale core, yellow, orange, red rim. */
function flameTongue(variant: number, W = 40, H = 88): Cv {
  const R = rng(4242 + variant * 97);
  const curl = (R() - 0.5) * 0.5, fat = 0.8 + R() * 0.35, sd = variant * 5 + 3;
  return raster(W, H, (x, y, o) => {
    const u = ((x + 0.5) / W) * 2 - 1; // -1..1
    const t = 1 - (y + 0.5) / H; // 0 bottom .. 1 top
    // teardrop: round base low, pinching to a curled tip
    const base = 0.16;
    const half = t < base ? Math.sqrt(Math.max(0, 1 - ((base - t) / base) ** 2)) * 0.95 * fat : 0.95 * fat * Math.pow(Math.max(0, 1 - (t - base) / (1 - base)), 0.62);
    const cx = curl * t * t * 1.4 + Math.sin(t * 5 + variant) * 0.08 * t;
    let f = half > 0 ? 1 - Math.abs(u - cx) / half : -1;
    f -= (fbm(u * 2.4 + variant, t * 4.2, sd) - 0.5) * 0.7 * (0.3 + t);
    f -= t * 0.18;
    if (f <= 0) return;
    const bands = [0.0, 0.2, 0.42, 0.66];
    let k = 0;
    for (let i = 0; i < bands.length; i++) if (f > bands[i]) k = i;
    const cols: RGB[] = [[196, 52, 18], [255, 128, 34], [255, 206, 92], [255, 246, 214]];
    const [r, g, b] = cols[k];
    o[0] = r; o[1] = g; o[2] = b; o[3] = 255 * sstep(0, 0.06, f) * (k === 0 ? 0.85 : 1);
  });
}

// ---------- smoke: cel-shaded puffs ----------
export const PUFF = {
  smoke: '#6e6a64', dark: '#26231f', powder: '#d8d4cb', dust: '#7b6e5a', snow: '#dfe6ee', mist: '#5e0c0a', mistDark: '#2c0907', steam: '#a8acb0', flare: '#c8868a',
} as const;
export type PuffCol = keyof typeof PUFF;

function puffTex(col: string, variant: number, S = 96): Cv {
  const R = rng(55 + variant * 131 + col.length * 7);
  const base = hex(col);
  const lobes: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + R() * 0.8, d = 0.2 + R() * 0.22;
    lobes.push([Math.cos(a) * d, Math.sin(a) * d * 0.9, 0.3 + R() * 0.16]);
  }
  lobes.push([0, 0.04, 0.5]);
  const sd = variant * 17 + 1;
  const field = (u: number, v: number) => {
    let f = 0;
    for (const [lx, ly, lr] of lobes) {
      const dx = u - lx, dy = v - ly;
      const q = 1 - (dx * dx + dy * dy) / (lr * lr);
      if (q > 0) f += q * q;
    }
    return f * 0.9 - (fbm(u * 3 + 11, v * 3 + 2, sd) - 0.5) * 0.5;
  };
  const e = 2 / S;
  return raster(S, S, (x, y, o) => {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
    const f = field(u, v);
    if (f < 0.12) return;
    // light from the top left, across the puff's own density gradient
    const gx = field(u + e * 3, v) - field(u - e * 3, v), gy = field(u, v + e * 3) - field(u, v - e * 3);
    const gl = Math.sqrt(gx * gx + gy * gy) + 0.06;
    const sh = (gx * 0.6 + gy * 0.8) / gl; // positive where density rises down-right, i.e. lit side faces up-left
    let k = sh > 0.25 ? 1.22 : sh < -0.25 ? 0.7 : 0.95;
    // cel outline: a darker band at the silhouette
    if (f < 0.2) k *= 0.78;
    const r = Math.min(255, base[0] * k + (k > 1 ? 10 : 0)), g = Math.min(255, base[1] * k + (k > 1 ? 10 : 0)), b = Math.min(255, base[2] * k + (k > 1 ? 10 : 0));
    // two opacity steps: wisps see-through, body solid
    const a = sstep(0.12, 0.16, f) * (f > 0.32 ? 1 : 0.62);
    o[0] = r; o[1] = g; o[2] = b; o[3] = 255 * a;
  });
}

// ---------- muzzle pieces ----------
/** Forward plume, origin at x = 6 on the centre line, pointing +x. */
function plumeTex(variant: number, W = 200, H = 64): Cv {
  const R = rng(777 + variant * 53);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) lumps.push([0.1 + R() * 0.75, (R() - 0.5) * 0.3, 0.1 + R() * 0.12]);
  const sd = variant * 3 + 101;
  const ox = 6;
  return raster(W, H, (x, y, o) => {
    const t = (x - ox) / (W - ox); // 0 at the muzzle → 1 at the tip
    const v = ((y + 0.5) / H) * 2 - 1;
    if (t < -0.03) return;
    // spindle: widest about a third of the way out, a long pointed tip
    const w = 0.55 * Math.pow(Math.max(0, t), 0.45) * Math.pow(Math.max(0, 1 - t), 1.1) * 2.2 + 0.08;
    let f = 1 - Math.abs(v) / w;
    for (const [lx, ly, lr] of lumps) {
      const dx = (t - lx) / lr, dy = (v - ly) / (lr * 2.2);
      f = Math.max(f, 1 - Math.sqrt(dx * dx + dy * dy) * 1.1 - t * 0.3);
    }
    f -= (fbm(t * 7 + variant, v * 2.2, sd) - 0.5) * 0.65;
    f *= 1 - t * 0.35;
    if (f <= 0) return;
    const bands = [0, 0.22, 0.45, 0.7];
    let k = 0;
    for (let i = 0; i < bands.length; i++) if (f > bands[i]) k = i;
    const cols: RGB[] = [[230, 96, 28], [255, 168, 60], [255, 226, 140], [255, 252, 236]];
    const [r, g, b] = cols[k];
    o[0] = r; o[1] = g; o[2] = b; o[3] = 255 * sstep(0, 0.08, f) * (k === 0 ? 0.75 : 1);
  });
}

/** A thin flame petal, origin at the left centre, pointing +x (the side jets of a star or a brake). */
function petalTex(variant: number, W = 96, H = 18): Cv {
  const R = rng(91 + variant * 11);
  const bend = (R() - 0.5) * 0.25;
  return raster(W, H, (x, y, o) => {
    const t = x / W;
    const v = ((y + 0.5) / H) * 2 - 1 - bend * t * t;
    const w = 0.95 * Math.pow(1 - t, 0.9) * Math.min(1, t * 6 + 0.35);
    let f = 1 - Math.abs(v) / Math.max(0.02, w);
    f -= (vnoise(t * 9 + variant * 3, v * 1.5, variant) - 0.5) * 0.4;
    if (f <= 0) return;
    const hot = f > 0.55 && t < 0.6;
    o[0] = 255; o[1] = hot ? 236 : 170; o[2] = hot ? 180 : 70; o[3] = 255 * sstep(0, 0.15, f) * (1 - t * 0.4);
  });
}

/** Front-view star burst (the pistol's "star"): prongs radiating from a hot centre. */
function burstTex(variant: number, S = 128): Cv {
  const [c, g] = mk(S, S);
  const R = rng(333 + variant * 19);
  g.translate(S / 2, S / 2);
  g.globalCompositeOperation = 'lighter';
  const prongs = 4 + variant;
  for (let i = 0; i < prongs; i++) {
    const a = (i / prongs) * Math.PI * 2 + (R() - 0.5) * 0.5;
    const len = S * (0.26 + R() * 0.2);
    g.save();
    g.rotate(a);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, 'rgba(255,246,220,1)');
    gr.addColorStop(0.45, 'rgba(255,182,72,0.85)');
    gr.addColorStop(1, 'rgba(255,110,30,0)');
    g.fillStyle = gr;
    const w = S * (0.03 + R() * 0.025);
    g.beginPath(); g.moveTo(0, -w); g.quadraticCurveTo(len * 0.5, -w * 0.6, len, 0); g.quadraticCurveTo(len * 0.5, w * 0.6, 0, w); g.fill();
    g.restore();
  }
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.2);
  rg.addColorStop(0, 'rgba(255,255,244,1)');
  rg.addColorStop(0.4, 'rgba(255,214,128,0.85)');
  rg.addColorStop(1, 'rgba(255,130,30,0)');
  g.fillStyle = rg;
  g.beginPath(); g.arc(0, 0, S * 0.2, 0, Math.PI * 2); g.fill();
  return c;
}

/** Velocity streak, head at the right edge: hot white core over a tinted glow, tail fading to nothing. */
function streakTex(col: string, W = 128, H = 16): Cv {
  const [r, g0, b] = hex(col);
  return raster(W, H, (x, y, o) => {
    const t = (x + 0.5) / W;
    const v = Math.abs(((y + 0.5) / H) * 2 - 1);
    const along = Math.pow(t, 1.6) * (t > 0.94 ? 1 - (t - 0.94) / 0.06 * 0.5 : 1);
    const glow = Math.exp(-v * v * 9) * along;
    const core = Math.exp(-v * v * 90) * Math.pow(t, 0.8);
    const k = Math.min(1, core * 1.2);
    o[0] = Math.min(255, r * (1 - k) + 255 * k);
    o[1] = Math.min(255, g0 * (1 - k) + 250 * k);
    o[2] = Math.min(255, b * (1 - k) + 236 * k);
    o[3] = 255 * Math.min(1, glow * 0.8 + core);
  });
}

/** Shock ring: a bright leading edge with a soft inner trail. */
function ringTex(S = 128): Cv {
  const [c, g] = mk(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,236,200,0)');
  gr.addColorStop(0.8, 'rgba(255,236,200,0.03)');
  gr.addColorStop(0.92, 'rgba(255,236,200,0.45)');
  gr.addColorStop(0.965, 'rgba(255,250,236,1)');
  gr.addColorStop(1, 'rgba(255,236,200,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}
/** The refraction band a shockwave pushes through the air: a dark inner edge under the bright one. */
function shockTex(S = 128): Cv {
  const [c, g] = mk(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(0.72, 'rgba(0,0,0,0)');
  gr.addColorStop(0.86, 'rgba(10,8,6,0.35)');
  gr.addColorStop(0.93, 'rgba(10,8,6,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

// ---------- small solid sprites (drawn at 4x, shown small) ----------
function casingTex(kind: 'brass' | 'hull' | 'link' | 'steel'): Cv {
  const [c, g] = mk(24, 10);
  if (kind === 'hull') {
    g.fillStyle = '#7a1e18'; g.fillRect(6, 1, 17, 8);
    g.fillStyle = '#b23a2c'; g.fillRect(6, 2, 17, 3);
    g.fillStyle = '#c8a050'; g.fillRect(1, 1, 6, 8);
    g.fillStyle = '#f0d890'; g.fillRect(2, 2, 4, 2);
  } else if (kind === 'link') {
    g.fillStyle = '#3e3c38'; g.fillRect(2, 2, 18, 6);
    g.fillStyle = '#76726a'; g.fillRect(3, 3, 16, 2);
  } else {
    const [a, b2, hi] = kind === 'steel' ? ['#6a6e70', '#9aa0a2', '#e8eef0'] : ['#8a6420', '#d0a448', '#fff0b0'];
    g.fillStyle = a; g.fillRect(1, 1, 22, 8);
    g.fillStyle = b2; g.fillRect(1, 2, 22, 3);
    g.fillStyle = hi; g.fillRect(4, 2, 14, 1.5);
    g.fillStyle = a; g.fillRect(0, 1, 2, 8);
  }
  return c;
}

function arrowTex(bolt: boolean): Cv {
  const W = bolt ? 120 : 176, [c, g] = mk(W, 16);
  // shaft along +x, head at the right edge
  g.fillStyle = bolt ? '#4a3a26' : '#7a6040';
  g.fillRect(10, 7, W - 26, 2.4);
  g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(14, 7, W - 34, 0.9);
  // fletching
  g.fillStyle = bolt ? '#262626' : '#b8b2a2';
  g.beginPath(); g.moveTo(2, 2); g.lineTo(26, 7); g.lineTo(10, 7); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(2, 14); g.lineTo(26, 9.4); g.lineTo(10, 9.4); g.closePath(); g.fill();
  g.fillStyle = bolt ? '#3a3a3a' : '#8a2a1c';
  g.beginPath(); g.moveTo(4, 8.2); g.lineTo(22, 8.2); g.lineTo(6, 6); g.closePath(); g.fill();
  // broadhead
  g.fillStyle = '#9aa0a4';
  g.beginPath(); g.moveTo(W, 8.2); g.lineTo(W - 18, 2.5); g.lineTo(W - 14, 8.2); g.lineTo(W - 18, 14); g.closePath(); g.fill();
  g.fillStyle = '#e8eef0'; g.fillRect(W - 15, 7.4, 12, 1);
  return c;
}

function nailTex(rivet: boolean): Cv {
  const [c, g] = mk(36, 10);
  g.fillStyle = '#7c8286'; g.fillRect(6, rivet ? 3 : 4, 28, rivet ? 4 : 2.2);
  g.fillStyle = '#d8e0e4'; g.fillRect(8, rivet ? 3.4 : 4.2, 22, 1);
  g.fillStyle = '#5c6266'; g.fillRect(3, rivet ? 1 : 2, 4, rivet ? 8 : 6);
  g.beginPath(); g.moveTo(34, 4); g.lineTo(36, 5); g.lineTo(34, 6.2); g.fill();
  return c;
}

function rocketTex(): Cv {
  const [c, g] = mk(64, 16);
  g.fillStyle = '#2f3328'; g.fillRect(10, 4, 40, 8);
  g.fillStyle = '#4a5240'; g.fillRect(10, 5, 40, 2.5);
  g.fillStyle = '#5a5a50'; g.beginPath(); g.moveTo(50, 4); g.quadraticCurveTo(64, 8, 50, 12); g.fill();
  g.fillStyle = '#1e201c';
  g.beginPath(); g.moveTo(10, 4); g.lineTo(2, 0); g.lineTo(6, 4); g.fill();
  g.beginPath(); g.moveTo(10, 12); g.lineTo(2, 16); g.lineTo(6, 12); g.fill();
  g.fillStyle = '#c8b860'; g.fillRect(30, 4, 2, 8);
  return c;
}

function grenadeTex(pipe: boolean): Cv {
  const [c, g] = mk(28, 20);
  if (pipe) {
    g.fillStyle = '#4c4a46'; g.fillRect(4, 5, 20, 10);
    g.fillStyle = '#7a7670'; g.fillRect(4, 6, 20, 2.5);
    g.fillStyle = '#34322e'; g.fillRect(2, 4, 4, 12); g.fillRect(22, 4, 4, 12);
  } else {
    g.fillStyle = '#3c4230'; g.beginPath(); g.ellipse(14, 10, 11, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b8a248'; g.fillRect(17, 3.5, 3, 13);
    g.fillStyle = '#6a7458'; g.beginPath(); g.ellipse(11, 8, 6, 2.5, 0, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function bottleTex(): Cv {
  const [c, g] = mk(30, 14);
  g.fillStyle = '#3a4a2a'; g.fillRect(2, 3, 18, 8);
  g.fillRect(19, 5, 6, 4);
  g.fillStyle = 'rgba(200,230,170,0.5)'; g.fillRect(4, 4, 14, 1.5);
  g.fillStyle = '#c8b898'; g.fillRect(24, 4, 6, 6);
  return c;
}

/** A blood droplet in flight, head at the right: a dark teardrop with a wet highlight. */
function dropTex(col: string): Cv {
  const [r, g0, b] = hex(col);
  return raster(24, 10, (x, y, o) => {
    const t = (x + 0.5) / 24, v = ((y + 0.5) / 10) * 2 - 1;
    const w = t > 0.7 ? Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2)) : Math.pow(t / 0.7, 1.4);
    const f = 1 - Math.abs(v) / Math.max(0.05, w);
    if (f <= 0) return;
    const hi = t > 0.66 && t < 0.86 && v < -0.1 && v > -0.6;
    o[0] = hi ? Math.min(255, r * 2.2) : r; o[1] = hi ? Math.min(255, g0 * 2) : g0; o[2] = hi ? Math.min(255, b * 2) : b; o[3] = 255 * sstep(0, 0.35, f);
  });
}
/** A torn scrap of flesh or bone: an irregular dark polygon with a lighter edge. */
function gibTex(variant: number, col: string, edge: string): Cv {
  const [c, g] = mk(14, 14);
  const R = rng(66 + variant * 13 + col.length);
  g.beginPath();
  const n = 6 + variant;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = 3.5 + R() * 3.2; if (i === 0) g.moveTo(7 + Math.cos(a) * r, 7 + Math.sin(a) * r); else g.lineTo(7 + Math.cos(a) * r, 7 + Math.sin(a) * r); }
  g.closePath();
  g.fillStyle = col; g.fill();
  g.strokeStyle = edge; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(8, 8.5, 2, 0, Math.PI * 2); g.fill();
  return c;
}

// ---------- decals ----------
function scorchTex(variant: number, S = 160): Cv {
  const R = rng(900 + variant * 41);
  const sd = variant * 9 + 77;
  const spokes: number[] = [];
  for (let i = 0; i < 14; i++) spokes.push(R() * Math.PI * 2);
  return raster(S, S, (x, y, o) => {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
    const d = Math.sqrt(u * u + v * v);
    const a = Math.atan2(v, u);
    const rag = 0.7 + 0.3 * fbm(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, sd);
    let streak = 0;
    for (const s of spokes) {
      const da = Math.abs(((a - s + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      streak = Math.max(streak, (1 - sstep(0, 0.08, da)) * (1 - sstep(rag * 0.7, 1, d)));
    }
    const body = 1 - sstep(rag * 0.55, rag * 0.62, d);
    const core = 1 - sstep(rag * 0.22, rag * 0.3, d);
    const a0 = Math.max(body * 0.62, streak * 0.4, core * 0.85) * (0.75 + 0.25 * vnoise(u * 12, v * 12, sd));
    if (a0 <= 0.01) return;
    o[0] = 10; o[1] = 9; o[2] = 8; o[3] = 255 * Math.min(1, a0);
  });
}

function holeTex(variant: number): Cv {
  // bullet hole in boards: dark pit, splintered pale rim, a crack along the grain
  const [c, g] = mk(20, 20);
  const R = rng(55 + variant * 3);
  g.fillStyle = 'rgba(214,186,140,0.75)';
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, r = 4 + R() * 3.5;
    if (i === 0) g.moveTo(10 + Math.cos(a) * r, 10 + Math.sin(a) * r * 0.8); else g.lineTo(10 + Math.cos(a) * r, 10 + Math.sin(a) * r * 0.8);
  }
  g.closePath(); g.fill();
  g.fillStyle = '#0c0a08';
  g.beginPath(); g.arc(10, 10, 2.6 + R() * 0.8, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(12,10,8,0.7)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(2 + R() * 3, 10 + (R() - 0.5) * 2); g.lineTo(18 - R() * 3, 10 + (R() - 0.5) * 2); g.stroke();
  return c;
}

function splatTex(variant: number, col: string, S = 32): Cv {
  const R = rng(321 + variant * 77 + col.length);
  const [r, gg, b] = hex(col);
  const drops: [number, number, number][] = [[0, 0, 0.42 + R() * 0.12]];
  for (let i = 0; i < 6; i++) { const a = R() * Math.PI * 2, d = 0.35 + R() * 0.5; drops.push([Math.cos(a) * d, Math.sin(a) * d, 0.06 + R() * 0.12]); }
  return raster(S, S, (x, y, o) => {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
    let f = 0;
    for (const [dx, dy, dr] of drops) f = Math.max(f, 1 - Math.sqrt((u - dx) ** 2 + (v - dy) ** 2) / dr);
    f -= (vnoise(u * 5 + variant, v * 5, variant) - 0.5) * 0.4;
    if (f <= 0) return;
    const wet = f > 0.55 ? 1.25 : 1;
    o[0] = Math.min(255, r * wet); o[1] = Math.min(255, gg * wet); o[2] = Math.min(255, b * wet); o[3] = 255 * sstep(0, 0.12, f) * 0.9;
  });
}

// ---------- the set ----------
export interface Sprites {
  glow: Record<GlowCol, Cv>;
  fire: Cv[][]; // [stage][variant]
  flame: Cv[];
  puff: Record<PuffCol, Cv[]>;
  plume: Cv[];
  petal: Cv[];
  burst: Cv[];
  streak: { warm: Cv; tracer: Cv; pale: Cv; fire: Cv; flare: Cv; green: Cv };
  ring: Cv;
  shock: Cv;
  casing: { brass: Cv; hull: Cv; link: Cv; steel: Cv };
  arrow: Cv; bolt: Cv; nail: Cv; rivet: Cv; rocket: Cv; grenade: Cv; pipebomb: Cv; bottle: Cv;
  scorch: Cv[]; hole: Cv[]; splat: Cv[]; splatDark: Cv[]; chip: Cv[];
  drop: Cv; dropDark: Cv; gib: Cv[]; bone: Cv[];
  /** ms it took to build everything */
  ms: number;
}

let SPR: Sprites | null = null;
/** Build every effect texture once (≈ 60–120 ms CPU on first use; cached for the session). */
export function sprites(): Sprites {
  if (SPR) return SPR;
  const t0 = performance.now();
  const glow = {} as Record<GlowCol, Cv>;
  for (const k of Object.keys(GLOW) as GlowCol[]) glow[k] = glowTex(GLOW[k]);
  const puff = {} as Record<PuffCol, Cv[]>;
  for (const k of Object.keys(PUFF) as PuffCol[]) puff[k] = [0, 1, 2, 3].map((v) => puffTex(PUFF[k], v));
  SPR = {
    glow,
    fire: [0, 1, 2, 3].map((s) => [0, 1, 2, 3].map((v) => fireBlob(s, v))),
    flame: [0, 1, 2, 3, 4, 5].map((v) => flameTongue(v)),
    puff,
    plume: [0, 1, 2, 3, 4, 5].map((v) => plumeTex(v)),
    petal: [0, 1, 2, 3].map((v) => petalTex(v)),
    burst: [0, 1, 2, 3].map((v) => burstTex(v)),
    streak: { warm: streakTex('#ffc46a'), tracer: streakTex('#ff5a28'), pale: streakTex('#d8d4cc'), fire: streakTex('#ff8a2a'), flare: streakTex('#ff3030'), green: streakTex('#b8c850') },
    ring: ringTex(),
    shock: shockTex(),
    casing: { brass: casingTex('brass'), hull: casingTex('hull'), link: casingTex('link'), steel: casingTex('steel') },
    arrow: arrowTex(false), bolt: arrowTex(true), nail: nailTex(false), rivet: nailTex(true), rocket: rocketTex(), grenade: grenadeTex(false), pipebomb: grenadeTex(true), bottle: bottleTex(),
    scorch: [0, 1, 2].map((v) => scorchTex(v)),
    hole: [0, 1, 2, 3].map((v) => holeTex(v)),
    splat: [0, 1, 2, 3, 4, 5].map((v) => splatTex(v, '#4a0c0a')),
    splatDark: [0, 1, 2].map((v) => splatTex(v, '#200806')),
    chip: [0, 1, 2].map((v) => splatTex(v + 9, '#121110', 16)),
    drop: dropTex('#4a0b08'), dropDark: dropTex('#220605'),
    gib: [0, 1, 2].map((v) => gibTex(v, '#4a1410', '#7a2a1c')), bone: [0, 1].map((v) => gibTex(v + 3, '#b8ae98', '#e0d8c4')),
    ms: 0,
  };
  SPR.ms = performance.now() - t0;
  return SPR;
}
