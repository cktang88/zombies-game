// Gun juice shared by the night battle and the daylight run (docs/balance.md §5): recoil kick, shake,
// light, and the sound-side mapping (impact surfaces, zombie voices). Pure helpers: no game state, so
// both canvases feel like the same guns. What a shot LOOKS like (flash anatomy per gun, the round in
// flight, tracers, impacts, smoke, brass, blasts, fire) lives in night/vfx (docs/research/10-vfx.md);
// drawFlash/casingLook below are the old single-shape versions, kept for any caller outside the night.
export { gunLook, type GunLook } from './vfx/looks';
import type { WeaponItem } from '../types';
import { WEAPONS, type FireProfile } from '../data/weapons';
import { gunSoundFor, type ZombieVoiceType } from '../audio';

const SLEEPER_HP = 64;

/** Muzzle-flash silhouette: pistol star, rifle long spike, shotgun wide cone, suppressed tiny. */
export type FlashKind = 'star' | 'long' | 'cone' | 'tiny' | 'blast' | 'none';

export const isSuppressed = (w: WeaponItem | null | undefined) => w?.mods?.muzzle?.def === 'suppressor';

export function flashKind(w: WeaponItem, p: FireProfile): FlashKind {
  if (p.cls === 'bow') return 'none';
  if (isSuppressed(w)) return 'tiny';
  if (p.cls === 'launcher' || p.explosive) return 'blast';
  if (p.cls === 'improvised' && (w.def === 'nailer' || w.def === 'rivet')) return 'tiny';
  if (p.cls === 'shotgun' || p.pellets > 1) return 'cone';
  if (p.cls === 'handgun' || p.cls === 'smg') return 'star';
  return 'long';
}

export interface GunFeel {
  /** screen shake px per pull (not stacking: shake = max(shake, x)) */
  shake: number;
  /** recoil kick of the shooter sprite, px */
  kick: number;
  /** muzzle light radius */
  light: number;
  /** muzzle-flash size multiplier */
  size: number;
}

/** §5 rules of thumb: shake 2.5 + 3.2·√(pull ÷ Sleeper HP) × recoilMul; autos a hose, not a hammer. */
export function gunFeel(p: FireProfile): GunFeel {
  const pull = (p.dmg * p.pellets) / SLEEPER_HP;
  const auto = p.auto;
  const bow = p.cls === 'bow';
  const shake = bow ? 2 : auto ? Math.min(3.6, 3 + 0.4 * Math.sqrt(pull)) * p.recoilMul : (2.5 + 3.2 * Math.sqrt(pull)) * p.recoilMul;
  const kick = (auto ? 4 : 4 + 6.3 * Math.sqrt(pull)) * p.recoilMul;
  const light = bow ? 0 : auto ? 160 : Math.min(300, 190 + 25 * Math.sqrt(pull) * 2);
  const size = auto ? 0.8 : Math.min(1.6, 0.85 + 0.25 * Math.sqrt(pull));
  return { shake: Math.min(10, shake), kick: Math.min(18, kick), light, size };
}

/** Legacy: one muzzle-flash shape at (x, y) pointing along `ang` (night/vfx draws the real ones). k: 1 at the shot → 0. */
export function drawFlash(c: CanvasRenderingContext2D, x: number, y: number, ang: number, kind: FlashKind, k: number, size = 1, seed = 0) {
  if (kind === 'none' || k <= 0) return;
  const a = Math.min(1, k * 1.4);
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.globalCompositeOperation = 'lighter';
  const s = size * (0.75 + 0.5 * k);
  const jit = (n: number) => 0.8 + 0.4 * Math.abs(Math.sin(seed * 12.9898 + n * 78.233));
  const core = (r: number) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(255,250,225,${a})`);
    g.addColorStop(0.4, `rgba(255,205,120,${a * 0.7})`);
    g.addColorStop(1, 'rgba(255,140,40,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  };
  c.fillStyle = `rgba(255,224,150,${a * 0.9})`;
  if (kind === 'tiny') {
    core(6 * s);
  } else if (kind === 'star') {
    // four petals, the forward one longest
    core(12 * s);
    c.beginPath();
    const pts: [number, number][] = [[26 * jit(1), 0], [0, 8 * jit(2)], [-6, 0], [0, -8 * jit(3)]];
    c.moveTo(0, -3 * s);
    for (const [px, py] of pts) { c.lineTo(px * s, py * s); c.lineTo(0, 0); }
    c.closePath(); c.fill();
    c.beginPath(); c.moveTo(4 * s, -3 * s); c.lineTo(18 * s * jit(4), -9 * s); c.lineTo(8 * s, 0); c.lineTo(18 * s * jit(5), 9 * s); c.lineTo(4 * s, 3 * s); c.fill();
  } else if (kind === 'long') {
    core(14 * s);
    c.beginPath(); c.moveTo(0, -4 * s); c.lineTo(48 * s * jit(1), 0); c.lineTo(0, 4 * s); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(6 * s, -2 * s); c.lineTo(22 * s * jit(2), -10 * s); c.lineTo(10 * s, 0); c.lineTo(22 * s * jit(3), 10 * s); c.lineTo(6 * s, 2 * s); c.fill();
  } else if (kind === 'cone') {
    core(16 * s);
    c.beginPath(); c.moveTo(0, -5 * s); c.lineTo(38 * s * jit(1), -20 * s * jit(2)); c.lineTo(46 * s * jit(3), 0); c.lineTo(38 * s * jit(4), 20 * s * jit(5)); c.lineTo(0, 5 * s); c.closePath(); c.fill();
    c.fillStyle = `rgba(255,250,230,${a})`;
    c.beginPath(); c.moveTo(0, -3 * s); c.lineTo(26 * s, 0); c.lineTo(0, 3 * s); c.closePath(); c.fill();
  } else if (kind === 'blast') {
    core(26 * s);
    c.beginPath(); c.moveTo(0, -8 * s); c.lineTo(34 * s, -14 * s); c.lineTo(44 * s, 0); c.lineTo(34 * s, 14 * s); c.lineTo(0, 8 * s); c.closePath(); c.fill();
    // back-blast
    c.beginPath(); c.moveTo(-10 * s, -6 * s); c.lineTo(-40 * s, -12 * s); c.lineTo(-40 * s, 12 * s); c.lineTo(-10 * s, 6 * s); c.closePath(); c.fill();
  }
  c.restore();
}

/** What the gun throws out of its side: colour and size of the casing, or null. */
export function casingLook(defId: string): { color: string; w: number; h: number } | null {
  const k = gunSoundFor(defId).casing;
  const d = WEAPONS[defId];
  if (!k) return null;
  if (k === 'hull') return { color: '#a8382c', w: 6, h: 3.5 };
  if (k === 'link') return { color: '#5a5650', w: 3, h: 2 };
  if (k === 'small') return { color: '#c9a24a', w: 2.5, h: 1.6 };
  return { color: '#d0a848', w: d?.caliber === 'rifle' || d?.caliber === 'r556' ? 5 : 3, h: 2 };
}

/** The zombie voice set for a ZOMBIES id (null for living men). */
export function voiceOf(defId: string): ZombieVoiceType | null {
  if (defId === 'raider') return null;
  if (defId === 'tunneler') return 'drag';
  return (['sleeper', 'deer', 'pulper', 'crier', 'ferryman', 'drag', 'leaper', 'spitter', 'bellwether', 'deputy'] as string[]).includes(defId) ? defId as ZombieVoiceType : 'sleeper';
}

/** Stereo position for a screen x. */
export const panOf = (x: number, w = 1280) => Math.max(-0.85, Math.min(0.85, (x / w) * 2 - 1));
