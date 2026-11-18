// UI regressions on the ledger screens and the night: folds keep their state when a screen redraws,
// Esc closes the survivor sheet, the ? key sheet lets go when Shift is released first.
//   node tools/e2e/ui-check.cjs [http://localhost:4192/]
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
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.personas button', { timeout: 30000 });
  await page.click('[data-act=new][data-id=siege]');
  await page.waitForSelector('.day');

  // the house view (the default day screen): a station zooms in with its panel, Esc steps back out,
  // a person opens their card, L flips to the ledger and back
  ok(!!(await page.$('.hv-scene')), 'the day opens on the house view');
  await page.evaluate(() => document.querySelector('[data-hs=wall]').click());
  await page.waitForSelector('.hv-panel[data-panel=wall]');
  ok(!!(await page.$('.hv-panel .wallbar')), 'the wall zooms in with its panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(!(await page.$('.hv-panel')), 'Esc steps back out of the wall');
  const sid = await page.evaluate(() => { const s = __G.survivors.find((x) => !x.dead && x.job !== 'repair'); return s && s.id; });
  await page.evaluate((id) => document.querySelector(`[data-sv="${id}"]`).click(), sid);
  await page.waitForSelector(`.hv-panel .sv-card[data-id="${sid}"]`);
  ok(true, 'a person opens their card');
  await page.evaluate(() => document.querySelector('[data-hs=wall]').click());
  await page.waitForTimeout(150);
  ok(await page.evaluate((id) => __G.survivors.find((x) => x.id === id).job === 'repair', sid), 'with a person picked, clicking the wall puts them on repair');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  ok(!(await page.$('.hv-scene')) && !!(await page.$('.day .people .sv-card')), 'L flips to the ledger');
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  ok(!!(await page.$('.hv-scene')), 'L flips back to the house');

  // the survivor sheet: Esc closes it
  await page.evaluate(() => document.querySelector('[data-sv]').click());
  await page.click('.day a[data-act=detail]');
  await page.waitForSelector('.overlay[data-act=closedetail]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(!(await page.$('.overlay[data-act=closedetail]')), 'Esc closes the survivor sheet');

  // the ending screen: open the chronicle fold, inscribe a name (the screen redraws), the fold stays open
  await page.evaluate(() => __story.ending('ferry'));
  await page.waitForSelector('.chronfold');
  await page.click('.chronfold > summary');
  ok(await page.$eval('.chronfold', (d) => d.open), 'chronicle fold opens');
  await page.click('[data-act=inscribe]');
  await page.waitForTimeout(200);
  ok(await page.$('.inscribed') !== null, 'a name was inscribed (the screen redrew)');
  ok(await page.$eval('.chronfold', (d) => d.open), 'the chronicle fold is still open after the redraw');

  // the night: hold Shift+/ for the key sheet, let go of Shift first
  await page.evaluate(() => __story.night(3));
  await page.waitForFunction(() => window.__battle && window.__battle.intro <= 0, null, { timeout: 30000 });
  await page.keyboard.down('Shift'); await page.keyboard.down('Slash');
  ok(await page.evaluate(() => __battle.keySheetHeld), 'Shift+/ shows the key sheet');
  await page.keyboard.up('Shift'); await page.keyboard.up('Slash');
  await page.waitForTimeout(100);
  ok(!(await page.evaluate(() => __battle.keySheetHeld)), 'the key sheet goes when ? is let go (Shift released first)');

  if (errors.length) { console.log(errors.join('\n')); fails++; }
  await browser.close();
  console.log(fails ? `${fails} failed` : 'ui check clean');
  process.exit(fails ? 1 : 0);
})();
