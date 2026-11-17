// The particle pool (docs/research/10-vfx.md §5): structure-of-arrays in typed arrays, swap-remove on death,
// no per-particle objects or closures, a hard cap (effects quality). When full, a new particle overwrites the
// oldest *optional* slot (round-robin), so a long MG burst thins its own smoke instead of dropping the next flash.

// kinds: the normal-blend ones first, then the additive ones
export const SMOKE = 0, DUST = 1, MIST = 2, BLOOD = 3, CHUNK = 4, SPLINTER = 5, DEBRIS = 6, CASING = 7, ARROWSTUCK = 8;
export const SPARK = 16, EMBER = 17, FIRE = 18, FLAME = 19, GLOW = 20, RING = 21, SHOCK = 22, STREAK = 23;
export const isAdditive = (k: number) => k >= 16;

// flags
export const F_STAMP = 1; // stamps a decal on the ground when it lands
export const F_WIND = 2; // carried by the wind
export const F_SMOKEY = 4; // leaves a smoke wisp behind (debris in flight, fire turning to smoke)
export const F_GLINT = 8; // catches the light as it spins (casings)
export const F_GROUNDED = 16; // flattened ground-plane shape (dust skirts, rings on the road)
export const F_RISE = 32; // fire: turns into a smoke puff when it dies

export class Pool {
  cap: number;
  n = 0;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  age: Float32Array; life: Float32Array;
  s0: Float32Array; s1: Float32Array;
  rot: Float32Array; vr: Float32Array;
  drag: Float32Array; grav: Float32Array; gy: Float32Array;
  a0: Float32Array; seed: Float32Array; delay: Float32Array; asp: Float32Array;
  kind: Uint8Array; col: Uint8Array; flags: Uint8Array; bounce: Uint8Array;
  limit: number;
  private evict = 0;

  constructor(cap: number) {
    this.cap = this.limit = cap;
    const F = () => new Float32Array(cap);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F();
    this.age = F(); this.life = F(); this.s0 = F(); this.s1 = F();
    this.rot = F(); this.vr = F(); this.drag = F(); this.grav = F(); this.gy = F();
    this.a0 = F(); this.seed = F(); this.delay = F(); this.asp = F();
    this.kind = new Uint8Array(cap); this.col = new Uint8Array(cap); this.flags = new Uint8Array(cap); this.bounce = new Uint8Array(cap);
  }

  /** 1 while there is room, down to 0.2 as the pool fills: continuous emitters thin themselves. */
  get room() { return Math.min(1, Math.max(0.2, (1 - this.n / this.limit) / 0.35)); }

  /**
   * A new particle; returns its slot. Every field is reset to a sane default so callers only set what they use.
   * kind, x, y, life are required.
   */
  add(kind: number, x: number, y: number, life: number): number {
    let i: number;
    if (this.n < this.limit) i = this.n++;
    else {
      // full: overwrite a slot, preferring smoke/dust/mist (the optional, long-lived ones)
      i = -1;
      for (let k = 0; k < 24; k++) {
        const j = (this.evict++) % this.n;
        const kk = this.kind[j];
        if (kk === SMOKE || kk === DUST || kk === MIST || kk === EMBER) { i = j; break; }
      }
      if (i < 0) i = (this.evict++) % this.n;
    }
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.vx[i] = 0; this.vy[i] = 0;
    this.age[i] = 0; this.life[i] = Math.max(0.001, life); this.s0[i] = 4; this.s1[i] = 4;
    this.rot[i] = 0; this.vr[i] = 0; this.drag[i] = 0; this.grav[i] = 0; this.gy[i] = 0;
    this.a0[i] = 1; this.seed[i] = Math.random(); this.delay[i] = 0; this.asp[i] = 1;
    this.col[i] = 0; this.flags[i] = 0; this.bounce[i] = 0;
    return i;
  }

  /** Remove slot i (swap with the last). */
  kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.kind[i] = this.kind[j]; this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.rot[i] = this.rot[j]; this.vr[i] = this.vr[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j]; this.gy[i] = this.gy[j];
    this.a0[i] = this.a0[j]; this.seed[i] = this.seed[j]; this.delay[i] = this.delay[j]; this.asp[i] = this.asp[j];
    this.col[i] = this.col[j]; this.flags[i] = this.flags[j]; this.bounce[i] = this.bounce[j];
  }

  clear() { this.n = 0; }
}
