import type { GameState, ChronicleEntry, Res, WeaponItem } from './types';
import { Rng } from './rng';

const KEY = 'vessey-save-v1';

export let G: GameState;
export let R: Rng;

export function setState(s: GameState) {
  G = s;
  R = new Rng(s.seed + s.day * 7919 + s.uid);
}

export function uid(prefix = 'x') {
  G.uid++;
  return `${prefix}${G.uid}`;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(G));
  } catch {
    /* storage may be unavailable */
  }
}

export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return s.version === 1 ? s : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function log(kind: ChronicleEntry['kind'], text: string) {
  G.chronicle.push({ day: G.day, kind, text });
}

export function add(res: Res, n: number) {
  G.stores[res] = Math.max(0, Math.round((G.stores[res] + n) * 10) / 10);
}

export function has(cost: Partial<Record<Res, number>>) {
  return Object.entries(cost).every(([k, v]) => G.stores[k as Res] >= (v ?? 0));
}

export function pay(cost: Partial<Record<Res, number>>) {
  for (const [k, v] of Object.entries(cost)) add(k as Res, -(v ?? 0));
}

export function newWeapon(def: string, cond = 1): WeaponItem {
  const w: WeaponItem = { uid: uid('w'), def, cond, kills: 0 };
  G.weapons.push(w);
  return w;
}

// Calendar: day 1 = Nov 6. The river freezes on Nov 28 (day 23).
export const START_DATE = 6;
export const ICE_DAY = 23;
export function dateLabel(day = G.day) {
  const d = START_DATE + day - 1;
  if (d <= 30) return `Nov ${d}`;
  return `Dec ${d - 30}`;
}
export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
