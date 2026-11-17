// Small day-screen feedback: floating +/- numbers on the stores, bars that tween between renders,
// and numbers that count. The day screen re-renders its whole innerHTML on every change, so this
// module remembers the last values it saw and animates from them after each render.
import './juice.css';
import { G } from '../state';

let lastStores: Record<string, number> | null = null;
let lastSeed = -1;
const lastBars = new Map<string, number>();

const reduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Call after the day screen renders. Elements: [data-res=key] get floating deltas; [data-tw=key] (width %) tween. */
export function juiceAfterRender(root: HTMLElement) {
  if (G.seed !== lastSeed) {
    lastSeed = G.seed;
    lastStores = null;
    lastBars.clear();
  }
  const now: Record<string, number> = {};
  for (const [k, v] of Object.entries(G.stores)) now[k] = Math.floor(v ?? 0);
  if (lastStores) {
    const deltas: { k: string; d: number }[] = [];
    for (const k of Object.keys(now)) {
      const d = now[k] - (lastStores[k] ?? 0);
      if (d) deltas.push({ k, d });
    }
    deltas.forEach(({ k, d }, i) => {
      const host = root.querySelector(`[data-res="${k}"]`) as HTMLElement | null ?? root.querySelector(`[data-res-group~="${k}"]`) as HTMLElement | null;
      if (!host) return;
      floatAt(host, `${d > 0 ? '+' : '−'}${Math.abs(d)}`, d > 0 ? 'pos' : 'neg', i * 90);
      const num = host.querySelector('.n') as HTMLElement | null;
      if (num && host.dataset.res === k) countUp(num, lastStores![k] ?? 0, now[k], 600);
    });
  }
  lastStores = now;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-tw]'))) {
    const key = el.dataset.tw!;
    const target = parseFloat(el.style.width) || 0;
    const prev = lastBars.get(key);
    lastBars.set(key, target);
    if (prev === undefined || Math.abs(prev - target) < 0.5 || reduced()) continue;
    el.style.transition = 'none';
    el.style.width = `${prev}%`;
    void el.offsetWidth;
    el.style.transition = 'width .7s cubic-bezier(.2,.8,.2,1)';
    el.style.width = `${target}%`;
    el.classList.add(target > prev ? 'tw-up' : 'tw-down');
  }
}

export function floatAt(host: HTMLElement, text: string, cls: string, delay = 0) {
  const f = document.createElement('span');
  f.className = `floatnum ${cls}`;
  f.textContent = text;
  f.style.animationDelay = `${delay}ms`;
  host.classList.add('floathost');
  host.appendChild(f);
  setTimeout(() => f.remove(), 1600 + delay);
}

/** Animate an element's text from a to b. */
export function countUp(el: HTMLElement, a: number, b: number, ms: number, fmt = (n: number) => String(Math.round(n))) {
  if (reduced() || ms <= 0 || a === b) {
    el.textContent = fmt(b);
    return () => {};
  }
  const t0 = performance.now();
  let stop = false;
  const step = (t: number) => {
    if (stop) return;
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(a + (b - a) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = fmt(a);
  requestAnimationFrame(step);
  return () => {
    stop = true;
    el.textContent = fmt(b);
  };
}

/** Forget remembered values (e.g. after loading a different save). */
export function resetJuice() {
  lastStores = null;
  lastBars.clear();
}
