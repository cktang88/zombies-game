// Small seeded PRNG (mulberry32) so runs can be reproduced from a seed.
export class Rng {
  s: number;
  constructor(seed = Date.now() >>> 0) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(items: readonly T[], w: (t: T) => number): T | undefined {
    let total = 0;
    for (const i of items) total += Math.max(0, w(i));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const i of items) {
      r -= Math.max(0, w(i));
      if (r <= 0) return i;
    }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** 32-bit FNV-1a hash of a string: turns words or dates into seeds. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2 ** 31;
}

/** A typed seed: plain digits are used as-is, anything else is hashed. Empty → null. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{1,10}$/.test(t)) return Number(t) % 2 ** 31;
  return hashSeed(t.toLowerCase());
}

/** A fresh random seed for a new game (the only unseeded randomness the sim needs). */
export function freshSeed(): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % 2 ** 31;
  } catch {
    return (Date.now() * 2654435761) % 2 ** 31;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Daily Vessey: everyone gets the same seed and Weather on the same local calendar day. */
export function dailySeed(d = new Date()) {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const seed = hashSeed(`vessey-daily-${iso}`);
  return { seed, iso, label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, mode: (['siege', 'quiet', 'coin'] as const)[seed % 3] };
}
