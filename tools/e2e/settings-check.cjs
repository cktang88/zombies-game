// Settings end-to-end check: flips every setting and asserts something observable changed.
//   npx vite build && npx vite preview --port 4192 &
//   node tools/e2e/settings-check.cjs [http://localhost:4192/]
// Uses the Playwright that ships with the environment (require('playwright'), or the global
// install under $(npm root -g)). Exit code 1 on any failure; page errors fail the run.
const path = require('node:path');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const URL = process.argv[2] ?? 'http://localhost:4192/';
let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.personas button', { timeout: 30000 });
  const S = () => page.evaluate(() => globalThis.__settings.get());
  const openSettings = async (tab) => {
    if (!(await page.$('.overlay.settings'))) await page.click('[data-act=settings]');
    await page.click(`.overlay.settings [data-tab=${tab}]`);
  };
  const closeSettings = () => page.click('.overlay.settings .go[data-s=close]');

  // ---------------- audio
  await openSettings('audio');
  for (const k of ['master', 'music', 'sfx', 'ambience']) {
    await page.$eval(`.overlay.settings input[data-k=${k}]`, (el) => { el.value = '25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const v = await page.evaluate(() => globalThis.__settings.volumes());
    ok(Math.abs(v[k === 'ambience' ? 'amb' : k] - 0.25) < 1e-6, `audio: ${k} slider sets the bus volume`);
  }
  await page.click('.overlay.settings input[data-k=muted]');
  ok((await page.evaluate(() => globalThis.__settings.volumes())).muted === true, 'audio: mute mutes');
  await page.click('.overlay.settings input[data-k=muted]');

  // ---------------- video (DOM-observable ones)
  await openSettings('video');
  await page.click('.overlay.settings [data-choice=textSize][data-v=L]');
  ok(await page.$eval('.overlay.settings .modal', (m) => getComputedStyle(m).zoom === '1.18'), 'video: text size L scales the ledger pages');
  await page.click('.overlay.settings [data-choice=textSize][data-v=M]');
  await page.click('.overlay.settings input[data-k=highContrast]');
  ok(await page.evaluate(() => document.documentElement.classList.contains('hc') && getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() === '#fffaf0'), 'video: high contrast swaps the ink');
  await page.click('.overlay.settings input[data-k=highContrast]');
  await page.click('.overlay.settings input[data-k=showFps]');
  await page.waitForTimeout(700);
  ok(/fps/.test((await page.textContent('.fps').catch(() => '')) ?? ''), 'video: frame counter shows');
  await page.click('.overlay.settings input[data-k=showFps]');
  ok(!(await page.$('.fps')), 'video: frame counter hides');
  await page.click('.overlay.settings input[data-k=reduceShake]');
  ok((await page.evaluate(() => globalThis.__settings.shakeScale())) === 0.2, 'video: reduce shake scales the camera shake');
  await page.click('.overlay.settings input[data-k=reduceShake]');
  ok(!!(await page.$('.overlay.settings [data-act=fullscreen]')), 'video: fullscreen button present');

  // ---------------- gameplay: hints
  await openSettings('gameplay');
  await page.evaluate(() => localStorage.setItem('vessey-onboarding-v1', 'done'));
  await page.click('.overlay.settings [data-act=hints]');
  ok((await page.evaluate(() => localStorage.getItem('vessey-onboarding-v1'))) === '0', 'gameplay: tutorial hints reset');

  // ---------------- controls: rebind, conflict, reset
  await openSettings('controls');
  await page.click('.overlay.settings [data-bind="night.reload"]');
  await page.keyboard.press('j');
  ok((await page.textContent('.overlay.settings [data-bind="night.reload"]')).trim() === 'J', 'controls: rebinding reload to J');
  await page.click('.overlay.settings [data-bind="night.weapon"]');
  await page.keyboard.press('j');
  ok((await page.$$('.overlay.settings .keyrow.clash')).length === 2, 'controls: a clash is flagged on both rows');
  await page.click('.overlay.settings [data-bind="night.weapon"]');
  await page.keyboard.press('q');
  await page.click('.overlay.settings [data-bind="night.free"]');
  await page.keyboard.press('3');
  ok((await page.textContent('.overlay.settings [data-bind="night.free"]')).trim() === 'Z', 'controls: number keys are refused at the wall');

  // ---------------- data
  await openSettings('data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.overlay.settings [data-act=export]')]);
  ok(/vessey-.*\.json/.test(dl.suggestedFilename()), 'data: export downloads a file');
  await page.evaluate(() => localStorage.setItem('vessey-legacy-v1', JSON.stringify({ runs: 3 })));
  await page.click('.overlay.settings [data-act=resetlegacy]');
  await page.click('.overlay.settings [data-act=resetlegacy-yes]');
  ok((await page.evaluate(() => localStorage.getItem('vessey-legacy-v1'))) === null, 'data: reset legacy (after confirming)');
  const imp = await page.evaluate(() => { localStorage.removeItem('vessey-legacy-v1'); return 1; });
  void imp;
  await closeSettings();

  // ---------------- the night: pause menu, rebinding in play, the canvas toggles
  await page.evaluate(() => globalThis.__story.night(3));
  await page.waitForFunction(() => window.__battle && window.__battle.intro <= 0, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const b = (f) => page.evaluate(f);
  // pause
  await page.keyboard.press('p');
  ok(!!(await page.$('.overlay.pause')) && (await b(() => window.__battle.paused)), 'pause: P opens the pause menu and freezes the night');
  const t0 = await b(() => window.__battle.t);
  await page.keyboard.press('j'); await page.keyboard.press('q');
  await page.waitForTimeout(300);
  ok((await b(() => window.__battle.t)) === t0 && (await b(() => window.__battle.playerReload)) <= 0, 'pause: time stands still and keys do nothing');
  await page.click('.overlay.pause [data-p=settings]');
  ok(!!(await page.$('.overlay.settings')), 'pause: settings open from the pause menu');
  await page.keyboard.press('Escape');
  ok(!(await page.$('.overlay.settings')) && !!(await page.$('.overlay.pause')), 'pause: Esc closes settings back to the pause menu');
  await page.keyboard.press('Escape');
  ok(!(await page.$('.overlay.pause')) && !(await b(() => window.__battle.paused)), 'pause: Esc resumes');
  // the rebound key reloads
  await b(() => { const B = window.__battle; B.playerMag.set(B.player.w.uid, 0); B.jam = null; B.playerReload = 0; });
  await page.keyboard.down('j'); await page.keyboard.up('j');
  ok((await b(() => window.__battle.playerReload)) > 0, 'controls: the rebound key (J) reloads at the wall');
  await b(() => { const B = window.__battle; B.playerReload = 0; });
  // auto-reload off: dry fire just clicks
  await b(() => { globalThis.__settings.set('autoReload', false); const B = window.__battle; B.playerMag.set(B.player.w.uid, 0); B.playerReload = 0; B.playerCd = 0; B.tryFire(true); });
  ok((await b(() => window.__battle.playerReload)) <= 0, 'gameplay: auto-reload off — an empty gun only clicks');
  await b(() => { globalThis.__settings.set('autoReload', true); const B = window.__battle; B.playerCd = 0; B.tryFire(true); });
  ok((await b(() => window.__battle.playerReload)) > 0, 'gameplay: auto-reload on — an empty gun reloads');
  // focus toggle
  await b(() => globalThis.__settings.set('focusMode', 'toggle'));
  await b(() => { const B = window.__battle; B.nerve = 60; B.focusing = false; });
  await page.mouse.move(800, 400);
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  ok(await b(() => window.__battle.focusing), 'gameplay: toggle focus stays on after the button comes up');
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  ok(!(await b(() => window.__battle.focusing)), 'gameplay: a second click turns focus off');
  await b(() => globalThis.__settings.set('focusMode', 'hold'));
  // canvas toggles: freeze the battle, draw with the toggle on and off, compare pixels
  const diff = (setup, key, region, same = false) => page.evaluate(async ({ setup, key, region, same }) => {
    const B = window.__battle;
    B.paused = true;
    const cv = B.canvas, g = cv.getContext('2d');
    const grab = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const [x, y, w, h] = region; res(Array.from(g.getImageData(x, y, w, h).data));
    })));
    new Function('B', setup)(B);
    globalThis.__settings.set(key, true);
    const a = await grab();
    new Function('B', setup)(B);
    globalThis.__settings.set(key, same);
    const c = await grab();
    globalThis.__settings.set(key, true);
    B.paused = false;
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - c[i]);
    return d / a.length;
  }, { setup, key, region, same });
  ok((await diff("B.hitMark = { kind: 'head', t: 0.18, kill: true }; B.mouse.x = 640; B.mouse.y = 360;", 'hitMarkers', [600, 320, 80, 80])) > 0.5, 'video: hit markers draw (and stop drawing when off)');
  ok((await diff('B.killFlash = 0.16; B.wallFlash = 0;', 'flashes', [0, 0, 1280, 60])) > 0.3, 'video: screen flashes show (and stop when off)');
  ok((await diff('', 'threatRibbon', [0, 0, 1280, 40])) > 0.3, 'gameplay: threat ribbon shows (and hides when off)');
  // key hints: drawn only while unpaused (paused shows the whole key sheet), so draw a frame by hand
  const kh = await b(() => {
    const B = window.__battle, g = B.canvas.getContext('2d'), H = B.canvas.height;
    const shot = (on) => { globalThis.__settings.set('keyHints', on); B.paused = false; B.draw(); B.paused = true; return Array.from(g.getImageData(0, H - 30, 520, 30).data); };
    B.paused = true;
    const a = shot(true), c = shot(false), a2 = shot(true);
    let d = 0, d0 = 0; for (let i = 0; i < a.length; i++) { d += Math.abs(a[i] - c[i]); d0 += Math.abs(a[i] - a2[i]); }
    B.paused = false;
    return { on: globalThis.__settings.get().keyHints, d: d / a.length, d0: d0 / a.length };
  });
  ok(kh.on === true && kh.d > 0.3 && kh.d > kh.d0 * 4, `gameplay: key hints at the wall show (and hide when off) ${JSON.stringify(kh)}`);
  // weakspot rings need a Turned on screen
  await b(() => { const B = window.__battle; for (let i = 0; i < 6; i++) B.spawn('pulper'); B.zombies.forEach((z, i) => { if (z.state !== 'dying') z.x = 600 + (i % 6) * 70; }); B.update(0.016); });
  await page.waitForTimeout(400);
  const zd = await diff('', 'zoneMarkers', [300, 200, 900, 450]), z0 = await diff('', 'zoneMarkers', [300, 200, 900, 450], true);
  ok(zd > 0.0005 && zd > z0 * 4, `video: damage-zone rings show (and hide when off) ${zd} ${z0}`);
  // effects quality: the night's effects system takes it on its next update (particle budget)
  const fxq = await b(() => { const B = window.__battle, out = {}; for (const q of ['low', 'medium', 'high']) { globalThis.__settings.set('fxQuality', q); B.update(0.016); out[q] = B.vfx.P.limit; } return out; });
  ok(fxq.low < fxq.medium && fxq.medium < fxq.high, `video: Effects quality sets the particle budget (${JSON.stringify(fxq)})`);
  // animation: Classic turns the rigs off
  await b(() => globalThis.__settings.set('animation', 'classic'));
  ok(!(await b(() => globalThis.__anim.state().on)), 'video: Classic animation turns the rigs off');
  await b(() => globalThis.__settings.set('animation', 'rigged'));
  ok(await b(() => globalThis.__anim.state().on), 'video: Rigged animation turns them back on');
  // realism and gore: the getters the battle reads
  await b(() => globalThis.__settings.set('realism', 'hardcore'));
  ok((await S()).realism === 'hardcore', 'gameplay: realism Hardcore stored');
  await b(() => globalThis.__settings.set('realism', 'standard'));

  // ---------------- quit to title from the pause menu
  await page.keyboard.press('Escape');
  await page.click('.overlay.pause [data-p=quit]');
  await page.click('.overlay.pause [data-p=quit-yes]');
  await page.waitForSelector('.personas button');
  ok(!(await page.$('.stage canvas')) && !(await page.evaluate(() => window.__battle.raf && !window.__battle.ended)), 'pause: quit to title tears the night down');

  // ---------------- a run: pause there too
  await page.evaluate(() => globalThis.__story.run());
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  ok(!!(await page.$('.overlay.pause')), 'run: Esc opens the pause menu');
  await page.keyboard.press('Escape');
  ok(!(await page.$('.overlay.pause')), 'run: Esc resumes');

  // ---------------- persistence
  await page.reload();
  await page.waitForSelector('.personas button');
  ok((await S()).master === 0.25 && (await page.evaluate(() => JSON.parse(localStorage.getItem('vessey-keys-v1') || '{}')['night.reload'])) === 'j', 'persist: volumes and keys survive a reload');
  // reset keys
  await openSettings('controls');
  await page.click('.overlay.settings [data-act=resetkeys]');
  ok((await page.textContent('.overlay.settings [data-bind="night.reload"]')).trim() === 'R', 'controls: reset to defaults');
  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  for (const t of ['audio', 'video', 'gameplay', 'controls', 'data']) {
    await openSettings(t);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 390, `layout: ${t} tab fits 390 px (scrollWidth ${w})`);
  }
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all settings checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
