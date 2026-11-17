// Battle-scene audit captures (docs/gfx-audit.md §Round 2 — Battle): multi-frame sequences of
// every night look, special, trap, Turned move and crew post, at deviceScaleFactor 2.
//   npx tsx tools/stage-save.ts 12 /tmp/vessey-save.json
//   npx vite build && npx vite preview --port 4196 &
//   node tools/e2e/battle-audit.cjs [scene ...]     (default: every scene)
// Writes <scene>_<frame>.png (2× raw) and a 1280 px .jpg beside it, into $AUDIT_OUT.
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const sharp = require('sharp');

const URL = process.env.AUDIT_URL ?? 'http://localhost:4196/';
const SAVE = process.env.AUDIT_SAVE ?? '/tmp/vessey-save.json';
const OUT = process.env.AUDIT_OUT ?? '/tmp/vessey-audit';
fs.mkdirSync(OUT, { recursive: true });
const save = fs.readFileSync(SAVE, 'utf8');

async function boot(page, mutate) {
  await page.goto(URL);
  const g = JSON.parse(save);
  mutate?.(g);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('vessey-save-v1', s); localStorage.setItem('vessey-onboarding-v1', 'done'); }, JSON.stringify(g));
  await page.reload();
  await page.waitForSelector('.personas button', { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.click('[data-act=continue]');
  await page.waitForSelector('.day', { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('.dusk');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(350);
    if (await page.$('.stage canvas')) break;
    if (await page.$('.overlay .go')) { await page.click('.overlay .go'); continue; }
    if (await page.$('.day .dusk')) { await page.click('.day .dusk'); continue; }
    if (await page.$('.dep-done')) { await page.click('.dep-done'); continue; }
  }
  await page.waitForFunction(() => window.__battle && window.__battle.intro <= 0, null, { timeout: 30000 });
}
/** day, weather, special, lights, emplacements, traps (placed after the battle starts) */
const night = (page, o = {}) => boot(page, (G) => {
  G.day = o.day ?? 12;
  G.weather = o.weather ?? 'clear';
  if (o.special) G.flags.forceSpecial = o.special; else delete G.flags.forceSpecial;
  G.fort.lights = o.lights ?? 0;
  if (o.wall) G.fort.hp = G.fort.maxHp;
  if (o.hp != null) G.fort.hp = Math.round(G.fort.maxHp * o.hp);
  if (o.emp) G.flags.emplacements = JSON.stringify(o.emp);
  if (o.crew) G.flags.empCrew = JSON.stringify(o.crew);
  G.stores.r556 = 600; G.stores.rifle = 80; G.stores.fuel = 20;
  G.trapStock = {};
  G.deploy = [];
  o.mut?.(G);
});
const B = (page, f, a) => page.evaluate(f, a);
const spawnAt = (page, list) => B(page, (list) => {
  const b = window.__battle;
  for (const [t, x, lane] of list) {
    b.spawn(t);
    const z = b.zombies[b.zombies.length - 1];
    z.x = x;
    if (lane != null) { z.lane = lane; z.y = [604, 628, 655, 685][lane]; }
  }
}, list);
const placeTraps = (page, ps) => B(page, (ps) => {
  const b = window.__battle;
  const T = b.hooks.find((h) => Array.isArray(h.list) && h.pressG);
  const t2 = new T.constructor(b, ps);
  T.list = t2.list;
}, ps);
async function shoot(page, ms, beat = 240) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await B(page, () => {
      const b = window.__battle;
      const zs = b.zombies.filter((z) => z.state !== 'dying' && z.x < 1180).sort((a, c) => a.x - c.x);
      if (!zs.length) return null;
      const hb = b.hitbox(zs[0]);
      return { x: hb.hx, y: hb.hy };
    });
    if (t) { await page.mouse.move(t.x, t.y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); }
    await page.waitForTimeout(beat);
  }
}
let cur = '';
async function snap(page, tag) {
  const raw = path.join(OUT, `${cur}_${tag}.png`);
  await page.screenshot({ path: raw });
  await sharp(raw).resize({ width: 1280 }).jpeg({ quality: 82 }).toFile(raw.replace(/\.png$/, '.jpg'));
}
async function seq(page, n, gap, tag = 'f') { for (let i = 0; i < n; i++) { await snap(page, `${tag}${i}`); await page.waitForTimeout(gap); } }
const crowd = (n, x0 = 520, step = 61) => Array.from({ length: n }, (_, i) => [['sleeper', 'sleeper', 'deer', 'sleeper', 'deputy'][i % 5], x0 + ((i * step) % 680), i % 4]);

const scenes = {
  async unlit(page) { await night(page, { day: 1, lights: 0 }); await spawnAt(page, crowd(6)); await page.mouse.move(800, 560); await seq(page, 3, 700); await shoot(page, 1500); await snap(page, 'shot'); },
  async floodlit(page) { await night(page, { lights: 3 }); await spawnAt(page, crowd(12)); await page.mouse.move(800, 560); await seq(page, 2, 900); await shoot(page, 2000); await snap(page, 'shot'); },
  async fog(page) { await night(page, { special: 'fog', weather: 'fog', lights: 1 }); await spawnAt(page, crowd(10)); await seq(page, 2, 1200); },
  async snow(page) { await night(page, { weather: 'snow', lights: 1 }); await spawnAt(page, crowd(10)); await seq(page, 2, 800); await shoot(page, 1200, 120); await snap(page, 'shot'); },
  async rain(page) { await night(page, { weather: 'rain', lights: 1 }); await spawnAt(page, crowd(10)); await seq(page, 2, 800); await shoot(page, 1200, 120); await snap(page, 'shot'); },
  async tide(page) { await night(page, { lights: 2, hp: 0.5 }); await spawnAt(page, crowd(30, 420, 23)); await B(page, () => { window.__battle.t = window.__battle.duration * 0.55; }); await seq(page, 3, 1500); },
  async raiders(page) { await night(page, { special: 'raiders', lights: 1, hp: 0.6 }); await B(page, () => { const b = window.__battle; b.zombies.filter((z) => z.def.id === 'raider').forEach((z, i) => { z.x = 640 + i * 120; }); }); await spawnAt(page, [['raider', 640, 0], ['raider', 760, 2], ['raider', 900, 3]]); await page.waitForTimeout(1500); await seq(page, 4, 900); },
  async tunnel(page) { await night(page, { special: 'tunnel', lights: 1 }); await spawnAt(page, [['tunneler', 200, 3], ['tunneler', 150, 1]]); await seq(page, 3, 900); },
  async horde(page) { await night(page, { special: 'horde', lights: 2, hp: 0.35 }); await spawnAt(page, crowd(44, 400, 17)); await seq(page, 3, 1200); },
  async crossing(page) { await night(page, { day: 23, weather: 'snow', wall: true }); await spawnAt(page, [['bellwether', 760, 2], ...crowd(12)]); await page.waitForTimeout(1500); await seq(page, 2, 800); await B(page, () => { const z = window.__battle.zombies.find((x) => x.def.id === 'bellwether'); if (z) z.screamT = 1.7; }); await page.waitForTimeout(1200); await snap(page, 'toll'); },
  async nests(page) {
    await night(page, { lights: 1, emp: [{ id: 'mgnest', post: 'roof', cond: 0.9 }, { id: 'swivel', post: 'roof', cond: 0.9 }, { id: 'flamer', post: 'firestep', cond: 0.9 }, { id: 'mgnest', post: 'firestep', cond: 0.8 }] });
    await spawnAt(page, crowd(14));
    await seq(page, 2, 900, 'crew');
    await page.keyboard.press('h'); await page.mouse.move(800, 600); await page.waitForTimeout(500); await page.mouse.down();
    await seq(page, 3, 250, 'man'); await page.mouse.up();
  },
  async traps(page) {
    await night(page, { lights: 1, mut: (G) => { G.buildings.push({ id: 'generator', level: 1 }); } });
    const ids = ['beartrap', 'roofnails', 'flare', 'oil', 'propane', 'barrels', 'tincan', 'radio', 'snare', 'spikepit', 'electric', 'deadfall', 'net', 'sludge', 'pipemine', 'glass', 'nailbomb'];
    await placeTraps(page, ids.map((t, i) => ({ trap: t, x: 470 + (i % 9) * 80, lane: i % 4 })));
    await snap(page, 'set');
    await spawnAt(page, crowd(22, 820, 37).map(([t, x, l]) => [t, x + 120, l]));
    await page.keyboard.press('l');
    await seq(page, 4, 1500, 'run');
    await page.keyboard.press('g'); await page.waitForTimeout(120); await snap(page, 'g1'); await page.waitForTimeout(500); await page.keyboard.press('g'); await page.waitForTimeout(150); await snap(page, 'g2');
    await shoot(page, 2000, 150); await snap(page, 'shot');
  },
  async pile(page) {
    await night(page, { lights: 1, mut: (G) => { G.flags.pileCarry = JSON.stringify([2.5, 4, 6, 3]); } });
    await spawnAt(page, crowd(16, 400, 29));
    await seq(page, 4, 1300);
  },
  async buck(page) { await night(page, { lights: 2 }); await spawnAt(page, [['leaper', 620, 3], ['leaper', 700, 1], ['sleeper', 470, 3], ['sleeper', 480, 1]]); await seq(page, 6, 280); },
  async biler(page) { await night(page, { lights: 1 }); await spawnAt(page, [['spitter', 640, 2], ['spitter', 760, 0], ['sleeper', 700, 3]]); await B(page, () => window.__battle.zombies.forEach((z) => { if (z.def.id === 'spitter') { z.hp = 9999; z.spitT = 0.6; } })); await page.waitForFunction(() => window.__battle.globs.length > 0, null, { timeout: 15000 }).catch(() => {}); await snap(page, 'glob'); await page.keyboard.down('s'); await page.waitForTimeout(300); await snap(page, 'duck'); await page.waitForTimeout(500); await page.keyboard.up('s'); await page.waitForTimeout(1600); await snap(page, 'after'); },
  async crier(page) { await night(page, { lights: 1 }); await spawnAt(page, [['crier', 700, 1], ...crowd(6)]); await B(page, () => { const z = window.__battle.zombies.find((x) => x.def.id === 'crier'); z.hp = 9999; z.screamT = 1.5; z.keen = 1.5; }); await seq(page, 4, 600); },
  async pulper(page) { await night(page, { lights: 1 }); await spawnAt(page, [['pulper', 600, 2], ['sleeper', 640, 1], ['sleeper', 560, 3]]); await page.waitForTimeout(600); await B(page, () => { const b = window.__battle; const z = b.zombies.find((x) => x.def.id === 'pulper'); z.hp = 0; b.kill(z, b.player); }); await seq(page, 5, 140); },
  async ferryman(page) { await night(page, { lights: 2 }); await spawnAt(page, [['ferryman', 460, 3]]); await B(page, () => { const z = window.__battle.zombies.find((x) => x.def.id === 'ferryman'); z.hp = 9999; }); await seq(page, 6, 700); await B(page, () => { const z = window.__battle.zombies.find((x) => x.def.id === 'ferryman'); z.down = 2.5; }); await seq(page, 2, 500, 'down'); },
  async melee(page) { await night(page, { lights: 1, hp: 0.3 }); await spawnAt(page, [['sleeper', 400, 3], ['sleeper', 410, 2], ['deer', 420, 1], ['sleeper', 440, 0], ['deputy', 470, 3]]); await page.waitForTimeout(1200); await page.mouse.move(420, 560); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(150); await snap(page, 'swing'); await page.mouse.up({ button: 'right' }); await seq(page, 3, 600); },
  async wallhp(page) { await night(page, { lights: 1, hp: 1 }); for (const h of [1, 0.7, 0.45, 0.2, 0.05]) { await B(page, (h) => { const b = window.__battle; (globalThis.__G).fort.hp = Math.round(globalThis.__G.fort.maxHp * h); }, h); await page.waitForTimeout(200); await snap(page, `hp${Math.round(h * 100)}`); } },
  async dawn(page) {
    await night(page, { lights: 1 }); await spawnAt(page, crowd(8)); await shoot(page, 2500);
    await B(page, () => { const b = window.__battle; b.t = b.duration - 2; });
    await seq(page, 4, 900);
  },
};

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
  const size = (process.env.AUDIT_SIZE ?? '1280x720').split('x').map(Number);
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const name of want) {
    cur = `${name}${size[0] !== 1280 ? `_${size[0]}` : ''}`;
    const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const t0 = Date.now();
    try {
      await scenes[name](page);
      const perf = await B(page, () => window.__battle?.perf ?? null).catch(() => null);
      console.log(`${name}: ok ${((Date.now() - t0) / 1000).toFixed(1)}s${perf ? ` perf ${JSON.stringify(perf)}` : ''}${errs.length ? ` (page errors: ${errs.join(' | ')})` : ''}`);
    } catch (e) {
      console.log(`${name}: FAILED ${String(e).split('\n')[0]}${errs.length ? ` (page errors: ${errs.join(' | ')})` : ''}`);
      await snap(page, 'fail').catch(() => {});
    }
    await ctx.close();
  }
  await browser.close();
})();
