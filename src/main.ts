import './style.css';
import { G, setState, save, loadSave, clearSave, log, dateLabel, ICE_DAY } from './state';
import { loadAssets, spriteUrl } from './assets';
import { newGame } from './sim/newgame';
import { renderDay } from './ui/day';
import { resolveDayWork, dawnTick, nextWeather } from './sim/day';
import { planNight, afterNight, PERSONAS } from './sim/director';
import { rollIncident, resolveEvent, returnsTick } from './sim/events';
import { Battle, W, H, type NightResult } from './night/battle';
import { living, displayName, first } from './sim/survivors';
import { setMuted, muted, sfx } from './audio';

const app = document.getElementById('app')!;
let report: string[] = [];
let battle: Battle | null = null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function title() {
  const saved = loadSave();
  app.innerHTML = `<div class="title" style="background-image:linear-gradient(rgba(8,8,10,.35),rgba(8,8,10,.92)),url(${spriteUrl('bg_sky')})">
    <div class="tbox">
      <h1>VESSEY</h1>
      <div class="tsub">before the ice</div>
      <p class="tquote">"IT'S IN THE WATER / IT'S IN THE DEER / IT'S IN US<br>RIVER FREEZES NOV 28 — GET ACROSS OR GET READY"<br><span>— spray paint, Vessey water tower</span></p>
      ${saved ? `<button data-act="continue">Continue — ${dateLabel(saved.day)}, ${saved.survivors.filter((s) => !s.dead).length} living</button>` : ''}
      <div class="personas">${Object.values(PERSONAS).map((p) => `<button data-act="new" data-id="${p.id}"><b>${p.name}</b><small>${p.desc}</small></button>`).join('')}</div>
      <p class="how">A paper-mill town on the St. Aubin River, November. The Guard sealed the bridge. Hold a house on Ferry Road with whoever you can find.<br>
      <b>Day:</b> assign survivors, scavenge, build machinery, craft. <b>Night:</b> aim with the mouse, click to fire, aim for the head. [R] reload, [Q] swap, [F] firebomb.</p>
      <button class="mute" data-act="mute">${muted ? 'sound off' : 'sound on'}</button>
    </div>
  </div>`;
  app.onclick = (e) => {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el) return;
    sfx.ui();
    if (el.dataset.act === 'continue' && saved) {
      setState(saved);
      report = ['You return to the house on Ferry Road.'];
      if (G.phase === 'over') return gameOver();
      day();
    } else if (el.dataset.act === 'new') {
      clearSave();
      newGame(el.dataset.id);
      report = [
        `${displayName(living()[0])} leads. ${living().slice(1).map(displayName).join(' and ')} came with ${living()[0].sex === 'm' ? 'him' : 'her'}.`,
        'Assign everyone a job for the day, then go to the wall at dusk.',
      ];
      save();
      day();
    } else if (el.dataset.act === 'mute') {
      setMuted(!muted);
      title();
    }
  };
}

function day() {
  G.phase = 'day';
  app.onclick = null;
  app.onchange = null;
  renderDay(app, {
    rerender: () => day(),
    onChoice: (i) => {
      const ev = G.pendingEvent;
      if (!ev) return;
      G.pendingEvent = null;
      const outcome = resolveEvent(ev, i);
      if (outcome) report.push(outcome);
      // events can chain (e.g. found survivor + a bite)
      if (!living().length) return gameOver();
      save();
      day();
    },
    onDusk: () => dusk(),
  }, report);
}

function overlay(html: string, onClose: () => void) {
  const div = document.createElement('div');
  div.className = 'overlay';
  div.innerHTML = `<div class="modal">${html}<button class="go">Continue ›</button></div>`;
  app.appendChild(div);
  div.querySelector('.go')!.addEventListener('click', () => {
    sfx.ui();
    div.remove();
    onClose();
  });
}

function dusk() {
  const lines = resolveDayWork();
  const plan = planNight();
  G.nextNight = plan;
  save();
  overlay(`<h2>Dusk, ${dateLabel()}</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p class="forecast">${esc(plan.label)}</p>`, () => night());
}

function night() {
  G.phase = 'night';
  app.onclick = null;
  app.onchange = null;
  app.innerHTML = `<div class="stage"><canvas width="${W}" height="${H}"></canvas></div>`;
  const canvas = app.querySelector('canvas')!;
  battle = new Battle(canvas, G.nextNight!, (r) => dawn(r));
  battle.start();
}

function dawn(r: NightResult) {
  battle = null;
  afterNight(r.deaths.length, r.wallHeld);
  if (r.fell) {
    // the house is overrun; those inside may not make it
    for (const s of living()) {
      if (Math.random() < 0.6) {
        s.dead = { day: G.day, cause: 'when the house on Ferry Road was overrun', epitaph: s.tales[s.tales.length - 1] ?? 'Was there at the end.' };
        G.graves.push(s);
      }
    }
    G.survivors = G.survivors.filter((s) => !s.dead);
  }
  const wasIce = G.day === ICE_DAY;
  const lines: string[] = [];
  lines.push(`${r.kills} of the Turned put down.${r.headshots ? ` ${r.headshots} through the head.` : ''}`);
  if (r.deaths.length) lines.push(`We lost ${r.deaths.join(', ')}.`);
  if (!r.wallHeld) lines.push('They came over the wall.');
  lines.push(...r.lines);
  const used = Object.entries(r.ammoUsed).map(([k, v]) => `${v} ${k === 'light' ? 'pistol rounds' : k === 'shell' ? 'shells' : k === 'rifle' ? 'rifle rounds' : k}`).join(', ');
  if (used) lines.push(`Spent: ${used}.`);
  if (!living().length) return gameOver();
  G.day++;
  nextWeather();
  const morning = [...returnsTick(), ...dawnTick()];
  if (!living().length) return gameOver();
  G.pendingEvent = rollIncident();
  report = [...lines, ...morning];
  save();
  if (wasIce) return iceEpilogue();
  overlay(`<h2>Dawn, ${dateLabel()}</h2>${report.map((l) => `<p>${esc(l)}</p>`).join('')}`, () => day());
}

function iceEpilogue() {
  const alive = living();
  log('lore', 'The river froze. They walked across it in the night, and we were still here in the morning.');
  overlay(`<h2>The river is ice</h2>
    <p>They came across the St. Aubin in the dark, hundreds of them, the ice booming under their weight. In the morning the house on Ferry Road was still standing.</p>
    <p>${alive.map((s) => esc(displayName(s))).join(', ')} saw the first light of December.</p>
    <p>${G.graves.length ? `Behind the house: ${G.graves.map((g) => esc(first(g))).join(', ')}.` : 'Nobody is buried behind the house. Nobody.'}</p>
    <p class="forecast">The ice will hold until April. Winter has only begun. (The game continues as long as you can hold.)</p>`, () => day());
}

function gameOver() {
  G.phase = 'over';
  save();
  const all = [...G.graves];
  app.onclick = null;
  app.innerHTML = `<div class="over">
    <h1>The house on Ferry Road</h1>
    <p class="sub">${dateLabel(1)} – ${dateLabel()} · ${G.day} days · ${G.stats.kills} of the Turned put down · ${G.stats.headshots} headshots</p>
    <div class="graves">${all.map((g) => `<div class="grave"><div class="gn">${esc(displayName(g))}</div>
      <div class="gd">${g.age} · ${g.kills} put down · ${g.daysSurvived} days</div>
      <div class="gc">${esc(g.dead?.cause ?? '')}</div>
      <div class="ge">${esc(g.dead?.epitaph ?? '')}</div>
      ${g.tales.length ? `<ul>${g.tales.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
    <h2>The chronicle</h2>
    <div class="chron">${G.chronicle.map((e) => `<p class="ce ${e.kind}"><b>${dateLabel(e.day)}.</b> ${esc(e.text)}</p>`).join('')}</div>
    <button data-act="again">Begin again</button>
  </div>`;
  app.onclick = (e) => {
    if ((e.target as HTMLElement).dataset.act === 'again') {
      clearSave();
      title();
    }
  };
}

app.innerHTML = '<div class="loading">Vessey, November<div class="bar"><div></div></div></div>';
loadAssets((p) => {
  const b = app.querySelector('.bar div') as HTMLElement | null;
  if (b) b.style.width = `${p * 100}%`;
}).then(title);
