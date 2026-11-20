// The dawn report's "For tomorrow" box: 1–3 concrete things to do differently today, read off what
// went wrong last night and what tonight looks like (docs/research/18-decision-info-audit.md §17).
import type { Res, Survivor } from '../types';
import { G } from '../state';
import { living, canFight, first, pain } from './survivors';
import { fireProfile, ammoLabel } from '../data/weapons';
import { calendar } from './calendar';

export interface Advice { icon: string; text: string; tip: string }

/** wallHeld/wallLost from the night; panicked: who came apart on the wall. Call after the day has turned. */
export function forTomorrow(r: { wallHeld: boolean; wallLost: number; fell: boolean }, panicked: Survivor[]): Advice[] {
  const out: Advice[] = [];
  const max = G.fort.maxHp, hp = Math.max(0, G.fort.hp);
  // tonight as the calendar shows it (a tide on the Siege, a likely one on the Quiet, the Crossing, the ice)
  const BIG: Partial<Record<string, string>> = { tide: 'a tide', band: 'maybe a tide', crossing: 'the Crossing', ice: 'an ice night' };
  const bigWord = BIG[calendar(1)[0].kind];
  const big = !!bigWord;
  // the wall: breached, or going into the night under half
  if (!r.wallHeld || hp < max * 0.5) {
    const repairers = living().filter((s) => s.job === 'repair').length;
    out.push({ icon: 'job_repair', text: `Wall ${Math.ceil(hp)}/${max} → ${repairers >= 2 ? 'keep' : 'put'} two on Repair`, tip: `${!r.wallHeld ? 'They came over the wall last night. ' : ''}${Math.round(r.wallLost)} lost. Repair the wall is the day job that mends it; each salvage patches 25.` });
  }
  // rounds for the guns we carry, against about 25 a gun a night (more on a tide)
  const guns = new Map<Res, number>();
  const fighters = living().filter(canFight).sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0)).slice(0, 6); // the six on the wall
  for (const s of fighters) {
    const w = G.weapons.find((x) => x.uid === s.weapon);
    const res = w ? fireProfile(w).ammoRes : null;
    if (res) guns.set(res, (guns.get(res) ?? 0) + 1);
  }
  const per = big ? 60 : 25;
  const short = [...guns].map(([res, n]) => ({ res, n, have: Math.floor(G.stores[res] ?? 0), need: n * per })).filter((a) => a.have < a.need).sort((a, b) => a.have / a.need - b.have / b.need)[0];
  if (short) out.push({ icon: 'ammo', text: `${ammoLabel(short.res)}: ${short.have} left${big ? `, tonight is ${bigWord}` : ''} → make or find more`, tip: `${short.n} gun${short.n > 1 ? 's' : ''} on the wall fire${short.n > 1 ? '' : 's'} it: about ${per} rounds each ${big ? 'on a big night' : 'a night'}. Queue it at the workbench, or scavenge.` });
  // unarmed on the wall
  const unarmed = fighters.filter((s) => !s.weapon);
  if (unarmed.length) out.push({ icon: 'pistol', text: `${unarmed.map(first).join(', ')} had no gun → hand one out at the gun rack`, tip: 'A guard without a gun takes a place on the wall and does nothing.' });
  // came apart on the wall
  if (panicked.length) out.push({ icon: 'job_counsel', text: `${panicked.map(first).join(', ')} panicked → Counsel or Rest today`, tip: 'Low mood makes guards break on the wall. Counsel lifts it; so does rest.' });
  // hurt and not tended
  const hurt = living().filter((s) => s.wounds.some((w) => !w.hidden && !w.tended && w.severity > 0.25)).sort((a, b) => pain(b) - pain(a));
  if (hurt.length) out.push({ icon: 'job_doctor', text: `${hurt.slice(0, 2).map(first).join(', ')} hurt → someone on Tend wounded`, tip: 'Untended wounds bleed and fester. Tend wounded uses Medicine skill; meds help.' });
  if (!out.length && big) out.push({ icon: 'st_danger', text: `Tonight is ${bigWord} → stock rounds, mend the wall, set traps`, tip: 'A big night comes two to three times as thick.' });
  return out.slice(0, 3);
}
