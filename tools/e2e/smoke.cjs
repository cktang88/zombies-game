// Smoke run through a whole day: title → new game → day → a daylight run (and home) → dusk →
// deploy → the night (fought a little, then fast-forwarded) → dawn report → the next day.
// Fails on any page error.   node tools/e2e/smoke.cjs [http://localhost:4192/]
const path = require('node:path');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const URL = process.argv[2] ?? 'http://localhost:4192/';

(async () => {
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const step = (s) => console.log(`- ${s}`);
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.personas button', { timeout: 30000 });
  step('title');
  await page.click('[data-act=new][data-id=siege]');
  await page.waitForSelector('.day');
  step('day 1');
  // a run: walk out a little, then home off the left edge
  await page.click('[data-act=run]');
  await page.waitForSelector('.stage canvas');
  await page.waitForTimeout(1200);
  await page.keyboard.down('d'); await page.waitForTimeout(1500); await page.keyboard.up('d');
  await page.mouse.click(900, 500);
  await page.keyboard.down('a');
  await page.waitForSelector('.overlay .go', { timeout: 30000 });
  await page.keyboard.up('a');
  step('run, home');
  await page.click('.overlay .go');
  await page.waitForSelector('.day');
  // dusk → deploy → night
  for (let i = 0; i < 12 && !(await page.$('.stage canvas')); i++) {
    if (await page.$('.overlay .go')) await page.click('.overlay .go');
    else if (await page.$('.dep-done')) await page.click('.dep-done');
    else if (await page.$('.day .dusk')) await page.click('.day .dusk');
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => window.__battle && window.__battle.intro <= 0, null, { timeout: 30000 });
  step('night');
  for (let i = 0; i < 12; i++) { await page.mouse.click(700 + (i % 4) * 80, 420); await page.waitForTimeout(250); }
  await page.keyboard.press('p'); await page.waitForTimeout(300); await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = window.__battle; b.t = b.duration + 1; for (const z of b.zombies) z.hp = 0; b.zombies.length = 0; b.spawnIdx = 1e9; });
  await page.waitForSelector('.dawnrep', { timeout: 40000 });
  step('dawn');
  // the dawn report (click to skip, then close), then whatever the morning brings
  for (let i = 0; i < 10 && !(await page.$('.day:not(.overlay .day)')); i++) {
    const b = await page.$('.overlay .go, .dawnrep button');
    if (b) await b.click(); else await page.mouse.click(640, 360);
    await page.waitForTimeout(600);
  }
  if (process.env.SMOKE_DEBUG) await page.screenshot({ path: '/tmp/smoke-dawn.png' });
  await page.waitForSelector('.day', { timeout: 15000 });
  const day = await page.evaluate(() => globalThis.__G.day);
  step(`day ${day}`);
  await browser.close();
  const ok = day === 2 && errors.length === 0;
  console.log(ok ? 'smoke run clean' : `FAILED (day ${day}): ${errors.join(' | ')}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
