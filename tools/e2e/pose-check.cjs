// Arm/stance check: every human rig (13 survivors + 2 raiders) × a gun per stance, aiming, measured
// against real arm proportions and real shooting stances (src/anim/armcheck.ts ARM_TARGETS):
// bone lengths, elbow angles, shoulder-to-wrist reach, and the trigger hand's distance ahead of the
// shoulder (a "scrunched" arm fails). Exits 1 on any problem.
//   npx vite build && npx vite preview --port 4192 &
//   node tools/e2e/pose-check.cjs [url]
const path = require('node:path');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const URL = (process.argv[2] ?? 'http://localhost:4192/').replace(/\/?$/, '/');
// one gun per stance: rifle, shotgun, smg, hip (LMG), pistol (two hands)
const GUNS = ['ar15', 'hunting', 'pump', 'coach', 'smg', 'lmg', 'service9', 'revolver'];

(async () => {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  let n = 0, bad = 0;
  for (const gun of GUNS) {
    await page.goto(`${URL}animlab.html?closeup&still&w=${gun}&act=aim&h=158`);
    await page.waitForFunction(() => window.__cu && window.__cu.actors.length > 0, null, { timeout: 30000 });
    const rows = await page.evaluate(() => window.__cu.measure());
    for (const r of rows) {
      n++;
      if (!r.m) { bad++; console.log(`FAIL ${r.label}: no rig`); continue; }
      if (r.m.problems.length) { bad++; console.log(`FAIL ${r.label} [${r.m.stance}]: ${r.m.problems.join('; ')}`); }
    }
    const s = rows.filter((r) => r.m).map((r) => r.m);
    const avg = (f) => (s.reduce((a, m) => a + f(m), 0) / Math.max(1, s.length));
    console.log(`${gun.padEnd(9)} ${s.length} rigs · trigger elbow ${avg((m) => m.trigger.elbow).toFixed(0)}° reach ${avg((m) => m.trigger.reach).toFixed(2)} ahead ${avg((m) => m.trigger.fwd).toFixed(2)} H · support elbow ${avg((m) => m.support.elbow).toFixed(0)}° reach ${avg((m) => m.support.reach).toFixed(2)}`);
  }
  await browser.close();
  if (errs.length) { console.log('page errors:', errs.join(' | ')); bad++; }
  console.log(bad ? `pose-check: ${bad} of ${n} failed` : `pose-check: all ${n} rig × gun poses within the real-arm ranges`);
  process.exit(bad ? 1 : 0);
})();
