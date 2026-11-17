// Drifting snow and ash over the title sky. A small canvas that stops itself
// once it leaves the document. Honours prefers-reduced-motion (a still scatter).

interface Flake { x: number; y: number; r: number; vy: number; vx: number; ph: number; ash: boolean; a: number }

export function startAsh(host: HTMLElement) {
  const cv = document.createElement('canvas');
  cv.className = 'ash';
  cv.setAttribute('aria-hidden', 'true');
  host.prepend(cv);
  const g = cv.getContext('2d');
  if (!g) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const flakes: Flake[] = [];
  const spawn = (f: Partial<Flake> = {}): Flake => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 0.6 + Math.random() * 1.9,
    vy: 9 + Math.random() * 22,
    vx: -6 + Math.random() * 4,
    ph: Math.random() * Math.PI * 2,
    ash: Math.random() < 0.35,
    a: 0.25 + Math.random() * 0.45,
    ...f,
  });
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = host.clientWidth;
    h = host.clientHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const want = Math.round(Math.min(140, (w * h) / 9000));
    while (flakes.length < want) flakes.push(spawn());
    flakes.length = want;
  };
  resize();
  window.addEventListener('resize', resize);

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    for (const f of flakes) {
      g.globalAlpha = f.a;
      g.fillStyle = f.ash ? '#6b625a' : '#e8e0cc';
      g.beginPath();
      if (f.ash) g.rect(f.x, f.y, f.r * 1.6, f.r * 0.9);
      else g.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };
  if (still) {
    draw();
    return;
  }
  let last = performance.now();
  const tick = (now: number) => {
    if (!cv.isConnected) {
      window.removeEventListener('resize', resize);
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const f of flakes) {
      f.ph += dt * (f.ash ? 2.2 : 0.9);
      f.y += f.vy * dt * (f.ash ? 0.7 : 1);
      f.x += (f.vx + Math.sin(f.ph) * (f.ash ? 14 : 7)) * dt;
      if (f.y > h + 4 || f.x < -6) Object.assign(f, spawn({ y: -4, x: Math.random() * (w + 60) }));
    }
    draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
