// Gamepad check with a stubbed navigator.getGamepads (src/input/gamepad.ts): menu focus moves on the
// D-pad and repeats while held, reaches fold heads (<summary>) and opens them with A, B closes the
// survivor sheet; at the wall the right stick aims, RT fires, Start pauses and B resumes.
//   node tools/e2e/pad-check.cjs [http://localhost:4192/]
const path = require('node:path');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const URL = process.argv[2] ?? 'http://localhost:4192/';

(async () => {
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  let fails = 0;
  const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.addInitScript(() => {
    const pad = { id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__pad = pad;
    window.__press = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0, touched: on }; };
    navigator.getGamepads = () => [pad, null, null, null];
  });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const tap = async (i) => { await page.evaluate((i) => __press(i, true), i); await frames(3); await page.evaluate((i) => __press(i, false), i); await frames(3); };
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''}` : ''; });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.personas button', { timeout: 30000 });
  await page.click('[data-act=new][data-id=siege]');
  await page.waitForSelector('.day');
  await frames(5);

  // the D-pad held down: one move at once, then repeats
  await tap(13);
  const seen = new Set();
  await page.evaluate(() => __press(13, true));
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(100); seen.add(await page.evaluate(() => document.activeElement && [...document.querySelectorAll('*')].indexOf(document.activeElement))); }
  await page.evaluate(() => __press(13, false));
  ok(seen.size >= 4, `D-pad held repeats focus moves (${seen.size} distinct stops in 1.2 s)`);

  // a fold head (<summary>) is a focus stop: from it, D-pad down moves on to the next thing below (a stop
  // the pad does not know jumps back to the top of the page instead); A on it opens the fold
  const sumTop = await page.evaluate(() => { const d = document.querySelector('.day details.fold:not([open])'); d.scrollIntoView({ block: 'center' }); const s = d.querySelector('summary'); s.focus(); return s.getBoundingClientRect().top; });
  await tap(13);
  const nextTop = await page.evaluate(() => document.activeElement.getBoundingClientRect().top);
  ok(nextTop > sumTop, `D-pad down from a fold head moves on below it (${Math.round(sumTop)} → ${Math.round(nextTop)})`);
  const onSummary = await page.evaluate(() => { const s = document.querySelector('.day details.fold:not([open]) > summary'); s.focus(); return document.activeElement === s; });
  if (onSummary) {
    await tap(0);
    ok(await page.evaluate(() => document.activeElement?.parentElement?.open === true), 'A opens the fold');
  }

  // the survivor sheet: open it, B closes it
  await page.evaluate(() => document.querySelector('.day a[data-act=detail]').click());
  await page.waitForSelector('.overlay[data-act=closedetail]');
  await frames(3);
  await tap(1);
  await page.waitForTimeout(200);
  ok(!(await page.$('.overlay[data-act=closedetail]')), 'B closes the survivor sheet');

  // the wall
  await page.evaluate(() => __story.night(3));
  await page.waitForFunction(() => window.__battle && window.__battle.intro <= 0, null, { timeout: 30000 });
  const m0 = await page.evaluate(() => ({ ...__battle.mouse }));
  await page.evaluate(() => { __pad.axes[2] = 1; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { __pad.axes[2] = 0; });
  const m1 = await page.evaluate(() => ({ ...__battle.mouse }));
  ok(m1.x > m0.x + 50, `right stick moves the crosshair (${Math.round(m0.x)} → ${Math.round(m1.x)})`);
  await page.evaluate(() => __press(7, true));
  await frames(3);
  ok(await page.evaluate(() => __battle.mouse.down), 'RT holds the trigger');
  await page.evaluate(() => __press(7, false));
  await frames(3);
  ok(!(await page.evaluate(() => __battle.mouse.down)), 'RT let go lets go');
  await tap(9);
  await page.waitForTimeout(200);
  ok(!!(await page.$('.overlay.pause')), 'Start pauses');
  await tap(1);
  await page.waitForTimeout(200);
  ok(!(await page.$('.overlay.pause')), 'B resumes');

  if (errors.length) { console.log(errors.join('\n')); fails++; }
  await browser.close();
  console.log(fails ? `${fails} failed` : 'pad check clean');
  process.exit(fails ? 1 : 0);
})();
