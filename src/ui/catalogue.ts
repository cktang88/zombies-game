import type { Res, WeaponItem } from '../types';
import { G, has } from '../state';
import { spriteUrl } from '../assets';
import { WEAPONS, RARES, CLASS_NAMES, fireProfile, ammoLabel } from '../data/weapons';
import { RES_ICON, RES_LABEL } from '../data/world';
import { gunCatalogue, nextUnlock, type GunEntry, type Catalogue } from '../sim/catalogue';
import { landingStock, landingOpen, landingMul, standingWord, merchantOn, merchantNext, rareMinDay, MERCHANT_GUNS, MERCHANT_NAME, type Offer } from '../sim/landing';
import { SITES } from '../data/world';
import { dateLabel } from '../state';
import { tip, fold } from './kit';
import { rackGuns } from '../sim/readiness';
import './catalogue.css';

/* The gun catalogue and the landing's shelves as HTML: the gun rack (day.ts armoryHtml), the Compendium
 * (compendium.ts) and the landing station (house.ts) all draw from here, off sim/catalogue.ts and
 * sim/landing.ts. Buttons: data-act="queue" (make, day.ts) and data-act="landbuy" (buy, day.ts). */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pic = (id: string) => `<img src="${spriteUrl(id)}" alt="" onerror="this.style.visibility='hidden'">`;
const salv = (n: number | undefined) => `<span class="cost ${(G.stores.salvage ?? 0) >= (n ?? 0) ? '' : 'short'}"><img src="${spriteUrl(RES_ICON.salvage)}" alt="salvage">${n}</span>`;
function costTxt(c: Partial<Record<Res, number>>) {
  return Object.entries(c).map(([k, v]) => `<span class="cost ${(G.stores[k as Res] ?? 0) >= (v ?? 0) ? '' : 'short'}"><img src="${spriteUrl(RES_ICON[k as Res])}" alt="${RES_LABEL[k as Res]}">${v}</span>`).join('');
}

/** A gun's identity line and numbers (damage, rate, magazine, ammo pool, noise): the catalogue's hover. */
export function gunStatsHtml(w: Pick<WeaponItem, 'def' | 'rare'> & Partial<WeaponItem>): string {
  const d = WEAPONS[w.def];
  const rv = w.rare ? RARES[w.rare] : undefined;
  const p = fireProfile({ uid: '', kills: 0, cond: 1, ...w } as WeaponItem, { noMods: true });
  const tags: string[] = [];
  if (p.auto) tags.push('full-auto');
  if (p.burst > 1) tags.push(p.burstGap <= 0 ? `${p.burst} barrels at once` : `${p.burst}-round burst`);
  if (p.reloadPerRound) tags.push('loads one at a time');
  if (p.incendiary) tags.push('incendiary');
  if (p.explosive) tags.push(`blast ${p.explosive.dmg}`);
  if (p.jam >= 0.02) tags.push(`jams ${Math.round(p.jam * 100)}%`);
  const noise = p.noise <= 0.6 ? 'quiet' : p.noise >= 2.5 ? 'loud' : p.noise >= 1.5 ? 'noisy' : 'normal';
  return `<b>${esc(rv?.name ?? d.name)}</b>${rv ? ' <span class="rare-b">★ rare</span>' : ''} · ${esc(CLASS_NAMES[d.cls].toLowerCase())}
    <br><i>${esc(rv ? rv.line : d.niche ?? d.desc)}</i>${rv ? `<br><span class="dim">A better ${esc(d.name.toLowerCase())}.</span>` : ''}
    <br>dmg ${Math.round(p.dmg)}${p.pellets > 1 ? `×${p.pellets}` : ''} · ${+p.rof.toFixed(2)}/s · mag ${p.mag} · reload ${p.reloadPerRound ? `${p.reload.toFixed(2)}s/round` : `${+p.reload.toFixed(1)}s`}${p.pierce ? ` · pierce ${p.pierce}` : ''}
    <br>ammo: ${esc(p.ammoRes ? ammoLabel(p.ammoRes).toLowerCase() : 'none (arrows come back)')}${p.perShot !== 1 && p.ammoRes ? ` ×${p.perShot}/shot` : ''} · noise: ${noise}${tags.length ? `<br>${tags.join(' · ')}` : ''}`;
}

/** Where a missing gun comes from, as short lines with their buttons (the full lines are on the hover). */
function howHtml(e: GunEntry): string {
  const rows: string[] = [];
  if (e.craft) {
    const c = e.craft;
    rows.push(c.unlocked
      ? `<div class="gway make"><span>Make · ${esc(c.where)}</span>${costTxt(c.recipe.cost)}<button class="mini" data-act="queue" data-id="${c.recipe.id}" ${c.afford ? '' : 'disabled'} aria-label="Make the ${esc(e.name)}">Make</button></div>`
      : `<div class="gway lock"><span>🔒 ${esc(c.where)}</span>${costTxt(c.recipe.cost)}</div>`);
  }
  for (const o of [e.store, e.merchant]) {
    if (!o) continue;
    rows.push(`<div class="gway buy"><span>${o.merchant ? 'Merchant' : 'Landing'} today</span>${salv(o.cost.salvage)}<button class="mini" data-act="landbuy" data-key="${o.key}" ${o.left > 0 && has(o.cost) ? '' : 'disabled'}>${o.left > 0 ? 'Buy' : 'Sold'}</button></div>`);
  }
  if (!e.store && e.storeEver) rows.push('<div class="gway">Landing, some days</div>');
  if (!e.merchant && e.merchantEver) rows.push(`<div class="gway">Merchant · ${esc(dateLabel(merchantNext(Math.max(G.day + (merchantOn() ? 1 : 0), e.rare ? rareMinDay(e.rare) : MERCHANT_GUNS[e.def]?.minDay ?? 1))))}</div>`);
  if (e.sites.length) {
    const n = SITES.find((x) => x.id === e.sites[0])?.name ?? e.sites[0];
    rows.push(`<div class="gway">Found · ${esc(n)}${e.sites.length > 1 ? ` +${e.sites.length - 1}` : ''}</div>`);
  }
  return rows.join('');
}

function missingCard(e: GunEntry): string {
  const t = `${gunStatsHtml({ def: e.def, rare: e.rare })}<br><span class="dim">${e.how.map(esc).join('<br>')}</span>`;
  const can = (e.craft?.afford || (e.store && e.store.left > 0 && has(e.store.cost)) || (e.merchant && e.merchant.left > 0 && has(e.merchant.cost)));
  return `<div class="gcard missing ${e.rare ? 'rare slot' : ''} ${can ? 'can' : ''}" data-gun="${e.key}">
    <div class="gpic"${tip(t)}>${pic(e.icon)}${e.rare ? '<span class="rstar">★</span>' : ''}</div>
    <div class="gname"${tip(t)}>${esc(e.name)}</div>
    <div class="ghow">${howHtml(e)}</div>
  </div>`;
}
/** Read-only owned card (the Compendium): picture, name, who carries it. */
export function ownedCardRO(w: WeaponItem): string {
  const holder = G.survivors.find((s) => !s.dead && s.weapon === w.uid);
  return `<div class="gcard ${holder ? 'held' : ''} ${w.rare ? 'rare' : ''}"${tip(gunStatsHtml(w))}>
    <div class="gpic">${pic(WEAPONS[w.def].icon)}${w.rare ? '<span class="rstar">★</span>' : ''}</div>
    <div class="gname">${w.name ? `"${esc(w.name)}"` : esc(w.rare ? RARES[w.rare].name : WEAPONS[w.def].name)}</div>
    <div class="t-xs">${holder ? esc(holder.name.split(' ')[0]) : 'on the rack'} · ${Math.round(w.cond * 100)}%</div></div>`;
}

export function collectionLine(c: Catalogue = gunCatalogue()): string {
  return `Guns ${c.owned}/${c.total} · rare ${c.rareOwned}/${c.rareTotal}`;
}
/** "Next unlock: Barrel forge → hunting rifle, crossbow" */
export function nextUnlockHtml(): string {
  const n = nextUnlock();
  if (!n) return '';
  const names = n.guns.map((g) => WEAPONS[g].name.toLowerCase());
  return `<div class="nextunlock ${n.afford ? 'pos' : ''}"${tip(`Build it in Workshop › Machinery.${n.afford ? ' <b>You can afford it now.</b>' : ''}`)}>Next unlock: <b>${esc(n.where)}</b> → ${esc(names.join(', '))} <span class="t-xs">${costTxt(n.cost)}</span></div>`;
}

/**
 * The whole catalogue: a progress line, the next unlock, then the six kinds, each "2/5 owned", owned
 * guns first in full colour (`owned` draws a rack card with its controls), then what is missing, greyed,
 * with exactly how to get it, and a ★ slot for every rare variant not yet found.
 */
export function catalogueHtml(owned: (w: WeaponItem) => string = ownedCardRO, o: { foldPrefix?: string } = {}): string {
  const c = gunCatalogue();
  const groups = c.groups.map((g) => {
    const cards: string[] = [];
    for (const e of g.entries) {
      if (e.have.length) { for (const w of e.have) cards.push(owned(w)); continue; }
      cards.push(missingCard(e));
    }
    const head = `<span class="t-l">${esc(g.name)}</span> <span class="t-xs cat-n ${g.owned === g.total ? 'pos' : ''}">${g.owned}/${g.total} owned</span><span class="cat-dots">${g.entries.filter((e) => !e.rare).map((e) => `<i class="${e.have.length ? 'on' : ''}"></i>`).join('')}</span>`;
    return fold(head, `<div class="gungrid">${cards.join('')}</div>`, { id: `${o.foldPrefix ?? 'cat'}-${g.id}`, open: true, cls: 'catgroup' });
  }).join('');
  // spare guns first, so one just bought or traded for is not buried under its kind
  const spare = rackGuns().sort((a, b) => (b.got ?? 0) - (a.got ?? 0));
  const spareHtml = spare.length ? `<div class="cat-spare"><div class="t-m">On the rack, nobody carries ${spare.length === 1 ? 'it' : 'them'} <span class="t-xs dim">${spare.length}</span></div>
    <div class="gungrid">${spare.map((w) => `<div class="gspare ${w.got === G.day ? 'isnew' : ''}">${w.got === G.day ? '<span class="newb">new</span>' : ''}${owned(w)}</div>`).join('')}</div></div>` : '';
  return `<div class="catalogue">
    <div class="cat-top"><span class="t-l">${collectionLine(c)}</span>${nextUnlockHtml()}</div>
    ${spareHtml}
    ${groups}
  </div>`;
}

// ---------------------------------------------------------------- the landing's shelves
function offerRow(o: Offer): string {
  const sell = o.kind === 'sell';
  const can = o.left > 0 && has(o.cost);
  const t = `<b>${esc(o.name)}</b>${o.rare ? ' <span class="rare-b">★ rare</span>' : ''}<br>${esc(o.desc)}${o.def ? `<br>${gunStatsHtml({ def: o.def, rare: o.rare })}` : ''}`;
  return `<div class="offer ${o.rare ? 'rare' : ''} ${o.left ? '' : 'gone'}"${tip(t)}>
    <span class="opic">${pic(o.icon)}${o.rare ? '<span class="rstar">★</span>' : ''}</span>
    <span class="oname t-s">${esc(o.name)}</span>
    <span class="ostock t-xs">${o.left}/${o.stock}</span>
    <span class="oprice">${sell ? `${costTxt(o.cost)} → ${costTxt(o.gives ?? {})}` : costTxt(o.cost)}</span>
    <button class="mini" data-act="landbuy" data-key="${o.key}" ${can ? '' : 'disabled'} aria-label="${sell ? 'Sell' : 'Buy'} ${esc(o.name)}">${o.left ? (sell ? 'Sell' : 'Buy') : 'Sold'}</button>
  </div>`;
}
export function landingHtml(): string {
  const all = landingStock();
  const shop = all.filter((o) => !o.merchant);
  const merch = all.filter((o) => o.merchant);
  const mul = landingMul();
  const sec = (k: string[], title: string) => {
    const xs = shop.filter((o) => k.includes(o.kind));
    return xs.length ? `<div class="oh t-l">${title}</div>${xs.map(offerRow).join('')}` : '';
  };
  const nd = merchantNext(G.day + 1);
  const merchSec = `<div class="oh t-l">${esc(MERCHANT_NAME)}, the merchant</div>
    ${merchantOn() ? `<p class="t-s">The peddler from upriver, <b>today only</b>: rare guns you cannot make, and the wilder ones. Back on ${dateLabel(nd)}.</p><div class="merch">${merch.map(offerRow).join('')}</div>` : `<p class="t-s">Comes every third day with rare guns and the wilder ones. <b>Back on ${dateLabel(merchantNext())}</b> (${merchantNext() - G.day === 1 ? 'tomorrow' : `in ${merchantNext() - G.day} days`}).</p>`}`;
  return `<div class="landing">
    <p class="t-s">${landingOpen() ? `Peltier's boat is tied up below the house. Prices in salvage; the Ferry families are <b>${standingWord()}</b>${mul !== 1 ? ` (×${mul})` : ''}.` : '<b>Peltier will not tie up</b>: the Ferry families are hostile. Help them (events, the ferry thread) to trade again.'}</p>
    ${merchantOn() ? merchSec : ''}
    ${landingOpen() ? `${sec(['ammo'], 'Ammunition')}${sec(['supply'], 'Supplies')}${sec(['gun', 'mod'], 'On the boat today')}${sec(['sell'], 'Sell surplus')}` : ''}
    ${merchantOn() ? '' : merchSec}
  </div>`;
}
