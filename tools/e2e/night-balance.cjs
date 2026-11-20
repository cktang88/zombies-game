// Balance sanity: auto-play real nights (the real Battle, stepped headless in the page) on chosen days
// with mid-game stores (docs/balance.md §6f PATCH means), a passive leader and a decent bot leader.
// usage: npx vite build && npx vite preview --port 4198 &
//        PORT=4198 node tools/e2e/night-balance.cjs [days=3,8,13,18,23] [seeds=2] [modes=passive,decent,prep]
// env: GUNS = JSON {day: ["service9", "pump:duckpump", ...]} replaces that day's loadout (def:rare for a rare variant),
//      e.g. the guns a house could make or buy by then (docs/balance.md §Gun catalogue)
//      TUNE / DTUNE / IMP = JSON merged into Battle.tune / DIRECTOR_TUNE / impact.ts IMPACT (deep for objects)
//      TRAPS=1 lays one of each of the six kits on the road (or TRAPS = JSON [{trap,x,lane}]); the row adds
//      kills per kit and whether it was used or spent (traps: ...)
// Columns: wall lost / max, deaths, leader shots, guard kills, stun% = share of on-screen body-seconds
// spent staggered or down, rx = reactions per kill (stagger / stumble / knockdown).
// docs/balance.md §9-§11.
const path = require('node:path');
const { execSync } = require('node:child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const PORT = process.env.PORT || 4198;
// one of each kit, spread down the road (x = battle screen x; the wall face is 372)
const TRAP_SIX = [{ trap: 'snare', x: 520, lane: 0 }, { trap: 'roofnails', x: 600, lane: 2 }, { trap: 'beartrap', x: 560, lane: 1 }, { trap: 'oil', x: 760, lane: 0 }, { trap: 'tincan', x: 780, lane: 2 }, { trap: 'nailbomb', x: 900, lane: 1 }];
const TRAPS = !process.env.TRAPS ? [] : process.env.TRAPS === '1' ? TRAP_SIX : JSON.parse(process.env.TRAPS);
(async () => {
const days = (process.argv[2] || '3,8,13,18,23').split(',').map(Number);
const seeds = +(process.argv[3] || 2);
const modes = (process.argv[4] || 'passive,decent').split(',');
const browser = await chromium.launch();
const errs = [];

// mid-game snapshot per day (stock = §6f PATCH mean; armory and walls a plausible competent house)
const SNAP = {
  3: { n: 4, sh: 3, stores: { light: 54, shell: 36, rifle: 10, r556: 0, r22: 0, scrap: 29, fuel: 9, parts: 9, molotov: 0 }, guns: ['service9', 'revolver', 'pump', 'r22'], fort: { maxHp: 300, lights: 0, wire: 0, spikes: 0 } },
  8: { n: 5, sh: 4, stores: { light: 116, shell: 39, rifle: 28, r556: 19, r22: 121, scrap: 39, fuel: 9, parts: 8, molotov: 2 }, guns: (process.env.NOPUMP ? ['service9', 'revolver', 'm1911', 'lever', 'hunting'] : ['service9', 'revolver', 'pump', 'lever', 'hunting']), fort: { maxHp: 360, lights: 1, wire: 1, spikes: 1 } },
  6: { n: 5, sh: 4, stores: { light: 65, shell: 34, rifle: 28, r556: 15, r22: 91, scrap: 33, fuel: 9, parts: 7, molotov: 1 }, guns: ['service9', 'revolver', 'pump', 'lever', 'r22'], fort: { maxHp: 360, lights: 1, wire: 1, spikes: 0 } },
  20: { n: 6, sh: 6, stores: { light: 106, shell: 30, rifle: 26, r556: 75, r22: 125, scrap: 45, fuel: 7, parts: 14, molotov: 3 }, guns: ['m1911', 'autoshot', 'pump', 'lever', 'scoped', 'ar15'], fort: { maxHp: 480, lights: 2, wire: 2, spikes: 1 } },
  13: { n: 6, sh: 5, stores: { light: 96, shell: 15, rifle: 27, r556: 43, r22: 104, scrap: 57, fuel: 18, parts: 14, molotov: 3 }, guns: ['service9', 'm1911', 'pump', 'lever', 'hunting', 'ar15'], fort: { maxHp: 420, lights: 2, wire: 1, spikes: 1 } },
  18: { n: 6, sh: 6, stores: { light: 163, shell: 52, rifle: 34, r556: 58, r22: 114, scrap: 38, fuel: 8, parts: 14, molotov: 3 }, guns: ['m1911', 'autoshot', 'pump', 'lever', 'scoped', 'ar15'], fort: { maxHp: 480, lights: 2, wire: 2, spikes: 1 } },
  23: { n: 6, sh: 6, stores: { light: 75, shell: 23, rifle: 12, r556: 32, r22: 147, scrap: 68, fuel: 4, parts: 16, molotov: 4 }, guns: ['m1911', 'autoshot', 'pump', 'carbine', 'scoped', 'ar15'], fort: { maxHp: 480, lights: 3, wire: 2, spikes: 2 } },
};

// "good prep" for the big nights: a house that stockpiled for it (ammo ~1.5x, the wall built up, every light, firebombs)
const PREP = {
  23: { n: 6, sh: 6, stores: { light: 150, shell: 50, rifle: 30, r556: 70, r22: 160, scrap: 68, fuel: 8, parts: 16, molotov: 8 }, guns: ['m1911', 'autoshot', 'pump', 'carbine', 'scoped', 'ar15'], fort: { maxHp: 600, lights: 3, wire: 3, spikes: 2 } },
  20: { n: 6, sh: 6, stores: { light: 150, shell: 45, rifle: 35, r556: 100, r22: 140, scrap: 45, fuel: 7, parts: 14, molotov: 6 }, guns: ['m1911', 'autoshot', 'pump', 'lever', 'scoped', 'ar15'], fort: { maxHp: 540, lights: 3, wire: 2, spikes: 2 } },
  13: { n: 6, sh: 5, stores: { light: 140, shell: 30, rifle: 40, r556: 60, r22: 120, scrap: 57, fuel: 18, parts: 14, molotov: 5 }, guns: ['service9', 'm1911', 'pump', 'lever', 'hunting', 'ar15'], fort: { maxHp: 480, lights: 2, wire: 2, spikes: 1 } },
};
// the snapshots keep their old numbers; fold them into today's pools (src/state.ts STORE_FOLD)
const FOLD = { molotov: ['explosive', 1], light: ['pistol', 1], r22: ['pistol', 0.25], r556: ['rifle', 0.5], scrap: ['salvage', 1], parts: ['salvage', 2] };
const folded = (st) => { const o = {}; for (const [k, v] of Object.entries(st)) { const [to, per] = FOLD[k] ?? [k, 1]; o[to] = (o[to] ?? 0) + v * per; } return o; };
async function night(day, seed, mode) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errs.push(`${day}/${mode}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('[')) console.log(m.text()); });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('[data-act=new][data-id=siege]', { timeout: 20000 });
  await page.fill('[data-seed]', String(1000 + seed * 7));
  await page.click('[data-act=new][data-id=siege]');
  await page.waitForSelector('.dusk', { timeout: 10000 });
  const snap0 = (mode === 'prep' && PREP[day]) || SNAP[day] || SNAP[13];
  const gunsEnv = JSON.parse(process.env.GUNS || '{}');
  const snap = { ...snap0, stores: folded(snap0.stores), ...(gunsEnv[day] ? { guns: gunsEnv[day] } : {}) };
  await page.evaluate((dt) => Object.assign(globalThis.__directorTune, dt), JSON.parse(process.env.DTUNE || "{}"));
  await page.evaluate((im) => { const I = globalThis.__impact; for (const [k, v] of Object.entries(im)) { if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(I[k], v); else I[k] = v; } }, JSON.parse(process.env.IMP || "{}"));
  await page.evaluate(([day, snap, traps]) => {
    const G = globalThis.__G;
    G.pendingEvent = null;
    G.day = day;
    while (G.survivors.filter((s) => !s.dead).length < snap.n) globalThis.__story.addSurvivor();
    const ppl = G.survivors.filter((s) => !s.dead);
    G.weapons = [];
    snap.guns.forEach((g, i) => { const [d, rare] = g.split(':'); const uid = `bw${i}`; G.weapons.push({ uid, def: d, cond: 0.85, kills: 0, ...(rare ? { rare } : {}) }); if (ppl[i]) ppl[i].weapon = uid; });
    for (const s of ppl) { s.skills.shooting = snap.sh + (s.isLeader ? 0 : -1); s.wounds = []; s.infection = 0; s.mood = 60; s.thoughts = []; s.breakState = null; s.job = 'rest'; }
    for (const k of Object.keys(G.stores)) if (!['food', 'meds'].includes(k)) G.stores[k] = 0;
    Object.assign(G.stores, snap.stores);
    G.stores.food = 60;
    G.fort.maxHp = snap.fort.maxHp; G.fort.hp = snap.fort.maxHp; G.fort.lights = snap.fort.lights; G.fort.wire = snap.fort.wire; G.fort.spikes = snap.fort.spikes;
    if (snap.fort.lights && !G.buildings.some((b) => b.id === 'generator')) G.buildings.push({ id: 'generator', level: 1 });
    G.trapStock = {}; G.deploy = []; G.flags.emplacements = '[]';
    delete G.flags.pileCarry; delete G.flags.turningTonight; delete G.flags.posts; delete G.flags.forceSpecial;
    if (traps.length) {
      // a builder good enough for every placement; last night's plan pre-fills the deploy screen
      ppl[0].skills.building = 12;
      G.trapStock = {}; for (const p of traps) G.trapStock[p.trap] = (G.trapStock[p.trap] ?? 0) + 1;
      G.flags.lastPlan = JSON.stringify(traps);
    }
  }, [day, snap, TRAPS]);
  // dusk → (deploy) → battle
  for (let i = 0; i < 3 && await page.$('.dusk') && !(await page.$('.overlay .go')); i++) { await page.evaluate(() => document.querySelector('.dusk').click()); await page.waitForTimeout(200); }
  await page.waitForSelector('.overlay .go', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('.overlay .go').click());
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) if (await page.$('.dep-done')) { await page.evaluate(() => document.querySelector('.dep-done').click()); await page.waitForTimeout(200); }
  await page.waitForFunction(() => !!window.__battle, null, { timeout: 10000 });
  const res = await page.evaluate(([mode, tune]) => {
    const b = window.__battle;
    Object.assign(b.constructor.tune, tune);
    const G = globalThis.__G;
    cancelAnimationFrame(b.raf);
    b.ended = true; // the page's loop stops drawing; we step it ourselves
    b.intro = 0;
    const ammo0 = {}; for (const k of ['pistol', 'shell', 'rifle', 'explosive']) ammo0[k] = G.stores[k] ?? 0;
    const wall0 = G.fort.hp;
    const dt = 1 / 30;
    let shots = 0, autoHeld = 0, lastFire = -9, ax = 800, ay = 500, tid = -1, ready = 0;
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;
    const WALL_X = 372;
    const decent = mode === "decent" || mode === "prep";
    if (mode === "stress") { b.zombies = []; b.plan.spawns = Array.from({ length: 30 }, (_, i) => ({ t: 0.5 + i * 0.25, type: "sleeper" })); b.spawnIdx = 0; }
    let steps = 0, onT = 0, stT = 0, dnT = 0;
    const rx = { stagger: 0, stumble: 0, knockdown: 0 }, seen = new Map();
    const pick = () => {
      let best = null, bp = 1e9;
      for (const z of b.zombies) {
        if (z.state === 'dying' || z.state === 'leap' || (z.emerge ?? 0) > 0.25 || z.x > 1260) continue;
        if (z.def.ranged && z.ducked) continue;
        const inside = z.state === 'over' || z.state === 'maul' || z.state === 'climb';
        let p = z.x + (inside ? -900 : 0) + ((z.windup ?? 0) > 0 ? -300 : 0) + (z.def.burst && z.x - WALL_X < 180 && z.state !== 'wall' ? 400 : 0);
        if (p < bp) { bp = p; best = z; }
      }
      return best;
    };
    while (!b.done && steps < 30 * 600) {
      steps++;
      b.slowmo = 0; b.hitstop = 0;
      if (decent) {
        const p = b.player;
        if (b.jam && b.jam.clearing <= 0) b.startReload();
        const z = pick();
        if (p && p.w && z) {
          const hb = b.hitbox(z);
          const inside = z.state === 'over' || z.state === 'maul';
          // a human hand: a reaction beat on a new target, a finite flick, and a few px of error
          if (z.id !== tid) { tid = z.id; ready = b.t + 0.28 + Math.random() * 0.15; }
          const tx = hb.hr > 0 ? hb.hx : z.x, ty = hb.hr > 0 && !inside ? hb.hy : (hb.y1 + hb.y2) / 2;
          const d = Math.hypot(tx - ax, ty - ay), step = 1600 * dt;
          if (d > step) { ax += (tx - ax) / d * step; ay += (ty - ay) / d * step; } else { ax = tx + gauss() * 3; ay = ty + gauss() * 3; }
          b.mouse.x = ax; b.mouse.y = ay;
          const prof = b.eff(p);
          const press = z.x - WALL_X < 160 || inside;
          const onIt = d < Math.max(8, hb.hr * 1.4) && b.t >= ready;
          if (!onIt) { b.mouse.down = false; }
          else if (prof.auto) {
            b.mouse.down = autoHeld < 0.6;
            autoHeld += dt; if (autoHeld > 0.9) autoHeld = 0;
            if (b.mouse.down) b.tryFire(false);
          } else if (b.playerCd <= 0 && (b.aimedNow(prof) || press || b.t - lastFire > 0.5)) {
            const n0 = b.shotsTonight; b.tryFire(true); if (b.shotsTonight > n0) { shots++; lastFire = b.t; }
          }
          const q = b.zombies.filter((o) => o.state === 'wall').length;
          if (q >= 5 && G.stores.explosive >= 1 && b.t - (b._mol ?? -9) > 6) { b._mol = b.t; b.mouse.x = WALL_X + 60; b.mouse.y = 640; b.throwMolotov(); }
          if (b.rally > 0 && (q >= 4 || b.nerve < b.nerveMax * 0.3)) b.useRally();
        } else b.mouse.down = false;
        // reload in the lulls
        if (p && p.w && !z && (b.playerMag.get(p.w.uid) ?? 0) < b.prof(p.w, p.s).mag * 0.5 && b.playerReload <= 0) b.startReload();
      }
      b.update(dt);
      if ((mode === "stress" || b.constructor.tune.trace2) && steps % 90 === 0 && b.t > 4 && b.t < 140) console.log(JSON.stringify(b.zombies.filter((z) => z.state !== "dying").sort((p, q) => p.x - q.x).slice(0, 4).map((z) => [b.zombies.filter((q) => q.pass > 0).length, Math.round(z.x), z.def.id, z.state, z.lane, +z.stun.toFixed(2), z.slow, +z.blocked.toFixed(1), Math.round(z.hp)])));
      if (globalThis.__trace || (steps % 150 === 0 && b.constructor.tune.trace)) { const al = b.zombies.filter((z) => z.state !== "dying"); (b._tr ??= []).push(`${Math.round(b.t)}s:${al.length}/${al.filter((z) => z.state === "wall").length}w/${al.length ? Math.round(Math.min(...al.map((z) => z.x))) : "-"}/st${al.filter((z) => z.stun > 0).length}/sp${al.map((z) => z.def.id[0]).join("")}`); }
      b.tickNerve(dt);
      for (const z of b.zombies) {
        if (z.state === 'dying' || z.x > 1260) continue;
        onT++;
        if ((z.down ?? 0) > 0) { dnT++; stT++; } else if (z.stun > 0) stT++;
        if (z.react && seen.get(z.id) !== z.react.t0) { seen.set(z.id, z.react.t0); rx[z.react.tier]++; }
      }
    }
    // the end of the night as the game does it
    b.endT = 0;
    const kills = b.res.kills, deaths = b.res.deaths.length, fell = b.res.fell;
    const raiders = b.raidersDown;
    b.ended = false; b.finish();
    const spent = {}; for (const k of Object.keys(ammo0)) { const d = ammo0[k] - (G.stores[k] ?? 0); if (d > 0.5) spent[k] = Math.round(d); }
    const fired = Object.fromEntries([...b.fired].map(([u, n]) => [G.weapons.find((w) => w.uid === u)?.def ?? u, n]));
    if (b._tr) console.log(b._tr.join(" "));
    const trapHook = b.hooks.find((h) => Array.isArray(h.list) && h.list.every((t) => t.def && t.def.fx));
    const trapKills = trapHook ? Object.fromEntries(trapHook.list.map((t) => [t.def.id, `${t.kills}${t.spent ? ' spent' : t.uses < t.def.uses ? ' used' : ''}`])) : {};
    return { stun: Math.round(stT / Math.max(1, onT) * 1000) / 10, downP: Math.round(dnT / Math.max(1, onT) * 1000) / 10, rx, tr: b._tr, fired, killsBy: b.res.killsBy, t: Math.round(b.t), special: b.plan.special ?? '-', points: b.plan.points, spawns: b.plan.spawns.length, kills, raiders, deaths, fell, wallLost: Math.round(wall0 - G.fort.hp), wallMax: G.fort.maxHp, wallHeld: b.res.wallHeld, spent, shots, trapKills, guardKills: Object.entries(b.res.killsBy).filter(([id]) => id !== b.guards.find((g) => g.s.isLeader)?.s.id).reduce((a, [, v]) => a + v, 0) };
  }, [mode, JSON.parse(process.env.TUNE || '{}')]);
  await page.close();
  return res;
}

const rows = [];
for (const day of days) for (const mode of modes) for (let s = 0; s < seeds; s++) {
  const r = await night(day, s, mode);
  rows.push({ day, mode, seed: s, ...r });
  console.log([day, mode, s, r.special, 'pts' + r.points, 'n' + r.spawns, 'k' + r.kills, 't' + r.t, 'wall -' + r.wallLost + '/' + r.wallMax, r.wallHeld ? 'held' : 'FELL', 'dead ' + r.deaths, 'lead ' + r.shots, 'gk ' + r.guardKills, 'stun ' + r.stun + '% (down ' + r.downP + '%)', 'rx/k ' + [r.rx.stagger, r.rx.stumble, r.rx.knockdown].map((n) => (n / Math.max(1, r.kills)).toFixed(2)).join('/'), JSON.stringify(r.fired), ...(TRAPS.length ? ['traps ' + JSON.stringify(r.trapKills)] : [])].join(' | ')); if (r.tr) console.log('   ' + r.tr.join(' '));
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
})();
