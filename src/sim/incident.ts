// Shared incident plumbing for events.ts, factions.ts and incidents.ts.
import type { PendingEvent, Survivor } from '../types';
import { G, R, rep, addRep, log } from '../state';
import { FACTIONS } from '../data/lore';
import { living, rel } from './survivors';
import { arrivalLine } from './chronicle';

export interface Incident {
  id: string;
  weight: () => number;
  make: () => PendingEvent | null;
  resolve?: (choice: number, data: Record<string, unknown>) => string;
  cooldown?: number; // days before it can recur (default 3)
}

export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export const pop = () => living().length;
// RimWorld-style population intent: few survivors -> more arrivals
export const popIntent = () => [4, 3, 2.2, 1.6, 1.2, 1, 0.7, 0.45, 0.25, 0.1, 0][Math.min(10, pop())];

/** Pick a survivor, favouring those with few stories so far (the spotlight rule). */
export function lowestSpotlight(list = living()) {
  return R.weighted(list, (s) => 1 / (1 + s.tales.length) ** 2)!;
}

export function standingWord(v: number) {
  return v >= 40 ? 'friendly' : v >= 10 ? 'warm' : v > -10 ? 'unknown' : v > -40 ? 'cold' : 'hostile';
}
export const factionName = (f: string) => FACTIONS.find((x) => x.id === f)?.name ?? f;

/** Change standing and return a short note for the outcome text. */
export function shiftRep(f: string, d: number): string {
  const before = rep(f);
  addRep(f, d);
  const after = rep(f);
  const delta = after - before;
  if (!delta) return '';
  const wb = standingWord(before), wa = standingWord(after);
  return `\n\n(${factionName(f)} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}: ${wb === wa ? `still ${wa}` : `${wb} → ${wa}`}.)`;
}

export function flagN(k: string) {
  return (G.flags[k] as number) ?? 0;
}

/** Bring a newcomer into the house with relations and a chronicle line. */
export function admit(n: Survivor, how = 'gate', by?: Survivor) {
  n.arrivedDay = G.day;
  G.survivors.push(n);
  for (const s of living()) if (s !== n) { rel(s, n); rel(n, s); }
  log('arrival', arrivalLine(n, how, by));
}

export function ids(list: Survivor[]) {
  return JSON.stringify(list.map((s) => s.id));
}
export function parseIds(v: unknown): string[] {
  try { return JSON.parse(String(v ?? '[]')) as string[]; } catch { return []; }
}
