// README screenshots: stages each scene with the debug handles and captures it at 1280×720,
// deviceScaleFactor 2, then writes a 1600 px JPEG to docs/screenshots/.
//   npx tsx tools/stage-save.ts 12 /tmp/vessey-save.json
//   npx vite build && npx vite preview --port 4192 &
//   node tools/e2e/shots.cjs [scene ...]        (default: every scene)
// Handles: globalThis.__G (state), __story (night(day) / run() / ending(kind)), window.__battle,
// window.__EX (the run), __anim, __settings.
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const sharp = require('sharp');

const URL = process.env.SHOTS_URL ?? 'http://localhost:4192/';
const SAVE = process.env.SHOTS_SAVE ?? '/tmp/vessey-save.json';
const OUT = path.join(__dirname, '..', '..', 'docs', 'screenshots');
const RAW = process.env.SHOTS_RAW ?? '/tmp/vessey-shots';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });
const save = fs.readFileSync(SAVE, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(page, mutate) {
  await page.goto(URL);
  let s = save;
  if (mutate) { const g = JSON.parse(save); mutate(g); s = JSON.stringify(g); }
  await page.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('vessey-save-v1', s); localStorage.setItem('vessey-onboarding-v1', 'done'); }, s);
  await page.reload();
  await page.waitForSelector('.personas button', { timeout: 30000 });
  await page.waitForTimeout(400);
}
async function cont(page) {
  await page.click('[data-act=continue]');
  await page.waitForSelector('.day', { timeout: 15000 });
  await page.waitForTimeout(500);
}
/** From the day screen through dusk, the deploy step(s), into the night. place(): lay traps. */
async function toNight(page, place) {
  await page.click('.dusk');
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(400);
    if (process.env.SHOTS_DEBUG) console.log('  step', i, await page.evaluate(() => [...document.querySelectorAll('.overlay, .dep, .dep-kits, .dep-done, .stage')].map((e) => e.className).join(' | ')));
    if (await page.$('.stage canvas')) break;
    if (await page.$('.overlay .go')) { await page.click('.overlay .go'); continue; }
    if (await page.$('.day .dusk')) { await page.click('.day .dusk'); continue; } // jobs carried over: "go anyway"
    if (place && (await page.$('.dep-kits'))) { await place(); place = null; return 'deploy'; }
    if (await page.$('.dep-done')) { await page.click('.dep-done'); continue; }
  }
  await page.waitForFunction(() => window.__battle && window.__battle.intro <= 0, null, { timeout: 30000 });
  return 'night';
}
async function nightFrom(page, day, opt = {}) {
  await boot(page, (G) => { G.day = day; if (opt.wall) G.fort.hp = G.fort.maxHp; if (opt.lights) G.fort.lights = opt.lights; G.stores.r556 = 400; });
  await cont(page);
  await toNight(page);
}
const B = (page, f, a) => page.evaluate(f, a);
/** The leader shoots: every beat, aim at the nearest Turned's head and click. */
async function fightFor(page, ms, beat = 260) {
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

const scenes = {
  async title(page) { await boot(page); await page.waitForTimeout(1500); },
  async day(page) {
    await boot(page); await cont(page);
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  async survivor(page) {
    await boot(page); await cont(page);
    await page.click('.surv .name a[data-act=detail]');
    await page.waitForTimeout(400);
  },
  async armory(page) {
    await boot(page); await cont(page);
    await page.click('[data-act=tab][data-id=armory]');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.center')?.scrollIntoView({ block: 'start' }));
  },
  async town(page) {
    await boot(page); await cont(page);
    await page.click('[data-act=tab][data-id=town]');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.center')?.scrollIntoView({ block: 'start' }));
  },
  async deploy(page) {
    await boot(page); await cont(page);
    await toNight(page, async () => {
      const road = await page.$('.dep-road');
      const bb = await road.boundingBox();
      const put = async (kit, fx, fy) => {
        const k = await page.$(`.dep-kit[data-kit=${kit}]`);
        if (!k) return;
        await k.click();
        await page.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy);
        await page.waitForTimeout(150);
      };
      await put('beartrap', 0.32, 0.3); await put('beartrap', 0.45, 0.8); await put('tincan', 0.62, 0.55); await put('propane', 0.5, 0.3); await put('deadfall', 0.24, 0.62); await put('spikepit', 0.38, 0.55);
      await page.evaluate(() => [...document.querySelectorAll('.dep-h')].pop()?.scrollIntoView({ block: 'start' }));
    });
  },
  async night(page) {
    await nightFrom(page, 12, { lights: 3 });
    await B(page, () => { const b = window.__battle; for (const t of ['shambler', 'shambler', 'deer', 'pulper', 'shambler', 'crier', 'shambler', 'deputy', 'shambler', 'shambler', 'deer', 'shambler', 'shambler', 'deputy']) b.spawn(t); b.zombies.forEach((z, i) => { z.x = 470 + ((i * 97) % 700); }); });
    await fightFor(page, 5200);
    // the last beat lands just before the shot: the muzzle flash in frame
    await B(page, () => { const b = window.__battle; b.playerCd = 0; });
    await page.mouse.down(); await page.waitForTimeout(30); await page.mouse.up();
    await page.waitForTimeout(16);
  },
  async crossing(page) {
    await nightFrom(page, 23, { wall: true });
    await B(page, () => { const b = window.__battle; b.spawn('bellwether'); for (let i = 0; i < 14; i++) b.spawn(['shambler', 'shambler', 'deer', 'deputy'][i % 4]); b.zombies.forEach((z, i) => { if (z.def.id === 'bellwether') z.x = 760; else z.x = 520 + ((i * 89) % 700); }); });
    await page.mouse.move(760, 300);
    await page.waitForTimeout(2500);
    await B(page, () => { const z = window.__battle.zombies.find((x) => x.def.id === 'bellwether'); if (z) z.screamT = 1.7; });
    await page.waitForTimeout(1300);
  },
  async nest(page) {
    await nightFrom(page, 12);
    await B(page, () => { const b = window.__battle; for (let i = 0; i < 10; i++) b.spawn('shambler'); b.zombies.forEach((z, i) => { z.x = 560 + ((i * 83) % 600); }); });
    await page.keyboard.press('h');
    await page.mouse.move(800, 380);
    await page.waitForTimeout(600);
    await page.mouse.down();
    await page.waitForTimeout(1400); // still on the trigger: the belt runs in frame
  },
  async biler(page) {
    await nightFrom(page, 12);
    await B(page, () => { const b = window.__battle; b.spawn('spitter'); b.spawn('shambler'); b.spawn('shambler'); b.spawn('deputy'); b.zombies.forEach((z, i) => { if (z.def.id === 'spitter') { z.hp = 9999; z.x = z.stopX ?? 520; z.spitT = 0.75; } else z.x = 640 + i * 70; }); });
    await page.mouse.move(640, 300);
    await page.waitForFunction(() => window.__battle.globs.length > 0, null, { timeout: 15000 });
    await page.keyboard.down('s');
    await page.waitForTimeout(380);
  },
  async run(page) {
    await boot(page);
    await cont(page);
    await page.evaluate(() => { const G = globalThis.__G; const mate = G.survivors.find((s) => !s.dead && !s.isLeader && s.weapon); if (mate) G.flags.runMate = mate.id; });
    await page.click('[data-act=run]');
    await page.waitForSelector('.stage canvas');
    await page.waitForTimeout(1200);
    await page.keyboard.down('d');
    await page.waitForTimeout(3400);
    await page.keyboard.up('d');
    await page.waitForTimeout(5500); // the opening lines fade
    // one of the Turned shambles up close: out comes the hatchet
    await B(page, () => { const e = globalThis.__EX; const z = e.zs.filter((x) => x.state !== 'dying').sort((a, b) => Math.abs(a.x - e.px) - Math.abs(b.x - e.px))[0]; if (z) { z.x = e.px + 120; z.state = 'walk'; z.dir = -1; } });
    await page.mouse.move(900, 520);
    await page.waitForTimeout(500);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(230);
  },
  async dawn(page) {
    await nightFrom(page, 12);
    await B(page, () => { const b = window.__battle; for (let i = 0; i < 10; i++) b.spawn(i % 3 ? 'shambler' : 'deer'); b.zombies.forEach((z, i) => { z.x = 520 + i * 55; }); });
    await fightFor(page, 6000);
    await B(page, () => { const b = window.__battle; b.t = b.duration + 1; for (const z of b.zombies) z.hp = 0; b.zombies.length = 0; b.spawnIdx = 1e9; });
    await page.waitForSelector('.dawnrep', { timeout: 40000 });
    await page.waitForTimeout(4000);
  },
  async epilogue(page) {
    await boot(page); await cont(page);
    await page.evaluate(() => globalThis.__story.ending('ferry'));
    await page.waitForTimeout(1200);
  },
  async settings(page) {
    await boot(page); await cont(page);
    await page.click('[data-act=settings]');
    await page.click('.overlay.settings [data-tab=video]');
    await page.waitForTimeout(300);
  },
  async animlab(page) {
    await page.goto(URL + 'animlab.html');
    await page.waitForTimeout(4000);
  },
};

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const name of want) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    try {
      await scenes[name](page);
      const raw = path.join(RAW, `${name}.png`);
      await page.screenshot({ path: raw });
      await sharp(raw).resize({ width: 1600 }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, `${name}.jpg`));
      console.log(`${name}: ok${errs.length ? ` (page errors: ${errs.join(' | ')})` : ''}`);
    } catch (e) {
      console.log(`${name}: FAILED ${String(e).split('\n')[0]}${errs.length ? ` (page errors: ${errs.join(' | ')})` : ''}`);
    }
    await ctx.close();
  }
  await browser.close();
})();
