// Key bindings: one central map used by the night battle (and its modules), the daylight run
// and the day screen. The settings page rebinds them.
//
// Storage (localStorage, every access wrapped in try/catch):
//   key 'vessey-keys-v1' → JSON { [actionId]: key } — only the actions the player changed
//
// A key is stored the way normKey() reports a KeyboardEvent: a single printable character in
// lower case (' ' for Space), otherwise the KeyboardEvent.key name ('Enter', 'Tab', 'Control').
// Handlers compare with is(e, 'night.reload') / keyOf('run.left'); the mouse, the number row
// (guards), Tab, Shift, the arrow keys and Esc are fixed and listed for reference.

export type KeyCtx = 'night' | 'run' | 'day';
export interface KeyAction { id: string; ctx: KeyCtx; label: string; def: string; hold?: boolean }

export const ACTIONS: KeyAction[] = [
  // ---- the wall at night
  { id: 'night.reload', ctx: 'night', label: 'Reload / clear a jam (hold: speed reload)', def: 'r', hold: true },
  { id: 'night.weapon', ctx: 'night', label: 'Next gun from the rack', def: 'q' },
  { id: 'night.selector', ctx: 'night', label: 'Fire selector', def: 'b' },
  { id: 'night.firebomb', ctx: 'night', label: 'Throw a firebomb', def: 'f' },
  { id: 'night.duck', ctx: 'night', label: 'Duck under the parapet (hold)', def: 's', hold: true },
  { id: 'night.melee', ctx: 'night', label: 'Hand weapon over the wall', def: 'v' },
  { id: 'night.rally', ctx: 'night', label: 'Rally the line', def: 'e' },
  { id: 'night.mark', ctx: 'night', label: 'Mark a target', def: 'm' },
  { id: 'night.free', ctx: 'night', label: 'Order: free fire (Shift: everyone)', def: 'z' },
  { id: 'night.hold', ctx: 'night', label: 'Order: hold fire', def: 'x' },
  { id: 'night.heads', ctx: 'night', label: 'Order: heads only', def: 'c' },
  { id: 'night.wall', ctx: 'night', label: 'Order: protect the wall', def: 'k' },
  { id: 'night.post', ctx: 'night', label: "Selected guard's post", def: 'y' },
  { id: 'night.lure', ctx: 'night', label: 'Pull a lure', def: 'l' },
  { id: 'night.trap', ctx: 'night', label: 'Light the oil slick', def: 'g' },
  { id: 'night.nest', ctx: 'night', label: 'Take / leave the gun nest', def: 'h' },
  { id: 'night.sally', ctx: 'night', label: 'Sally over the wall / back (Shift: take the selected guard)', def: 'o' },
  { id: 'night.hurry', ctx: 'night', label: 'Hurry the night along (hold)', def: ' ', hold: true },
  { id: 'night.pause', ctx: 'night', label: 'Pause', def: 'p' },
  // ---- daylight runs
  { id: 'run.left', ctx: 'run', label: 'Walk left (home)', def: 'a', hold: true },
  { id: 'run.right', ctx: 'run', label: 'Walk right', def: 'd', hold: true },
  { id: 'run.search', ctx: 'run', label: 'Search / revive (hold)', def: 'e', hold: true },
  { id: 'run.reload', ctx: 'run', label: 'Reload', def: 'r' },
  { id: 'run.swing', ctx: 'run', label: 'Swing the hand weapon', def: 'v', hold: true },
  { id: 'run.shove', ctx: 'run', label: 'Shove', def: ' ' },
  { id: 'run.pack', ctx: 'run', label: 'Next item in the pack', def: 'Tab' },
  { id: 'run.drop', ctx: 'run', label: 'Drop the selected item', def: 'g' },
  { id: 'run.pause', ctx: 'run', label: 'Pause', def: 'p' },
  // ---- the day ledger
  { id: 'day.dusk', ctx: 'day', label: 'Go to the wall at dusk', def: 'Enter' },
  { id: 'day.help', ctx: 'day', label: 'Open the help ledger', def: '?' },
];

/** Fixed inputs, listed beside the bindings (not rebindable). */
export const FIXED: Record<KeyCtx, [string, string][]> = {
  night: [['Mouse', 'Aim'], ['Left click', 'Fire (hold for automatics)'], ['Right click', 'Focus (hold, or toggle in Gameplay)'], ['Middle click', 'Firebomb'], ['Wheel', 'Change guns'], ['1–9 / Tab', 'Select a guard'], ['Ctrl', 'Duck (hold)'], ['Esc', 'Pause']],
  run: [['Mouse', 'Aim'], ['Left click', 'Fire'], ['Right click', 'Swing'], ['← →', 'Walk'], ['Esc', 'Pause']],
  day: [['Mouse', 'Everything else']],
};

const KEY = 'vessey-keys-v1';
const byId = new Map(ACTIONS.map((a) => [a.id, a]));
let custom: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (custom) return custom;
  custom = {};
  try {
    const raw = localStorage.getItem(KEY);
    const o = raw ? (JSON.parse(raw) as unknown) : null;
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (byId.has(k) && typeof v === 'string' && v) custom[k] = v;
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return custom;
}
function store() {
  try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* ignore */ }
}

/** A KeyboardEvent as a binding: printable characters lower-cased, otherwise the key name. */
export function normKey(e: KeyboardEvent | string): string {
  const k = typeof e === 'string' ? e : e.key;
  return k.length === 1 ? k.toLowerCase() : k;
}
/** The key bound to an action. */
export function keyOf(id: string): string { return load()[id] ?? byId.get(id)?.def ?? ''; }
/** Does this event (or normalised key) trigger the action? */
export function is(e: KeyboardEvent | string, id: string): boolean { return normKey(e) === keyOf(id); }
/** For HUD text: '[R]', '[Space]'. */
export function keyCap(id: string): string { return `[${keyLabel(keyOf(id))}]`; }
export function keyLabel(k: string): string {
  if (k === ' ') return 'Space';
  if (k.length === 1) return k.toUpperCase();
  return ({ Control: 'Ctrl', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' } as Record<string, string>)[k] ?? k;
}
/** Keys that can't be bound: they're fixed for something else in that context. */
export function reserved(ctx: KeyCtx, k: string): string | null {
  if (k === 'Escape') return 'Esc always pauses or closes';
  if (ctx === 'night' && /^[1-9]$/.test(k)) return 'the number keys select guards';
  if (ctx === 'night' && (k === 'Tab' || k === 'Shift' || k === 'Control')) return `${keyLabel(k)} is fixed at the wall`;
  if (ctx === 'run' && (k === 'ArrowLeft' || k === 'ArrowRight')) return 'the arrows always walk';
  return null;
}
export function setKey(id: string, k: string) {
  const a = byId.get(id);
  if (!a) return;
  const c = load();
  if (k === a.def) delete c[id]; else c[id] = k;
  store();
}
export function resetKeys() { custom = {}; store(); }
/** Actions in the same context sharing a key: each id → the labels it clashes with. */
export function conflicts(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of ACTIONS) for (const b of ACTIONS) {
    if (a === b || a.ctx !== b.ctx || keyOf(a.id) !== keyOf(b.id)) continue;
    out.set(a.id, [...(out.get(a.id) ?? []), b.label]);
  }
  return out;
}

// ---- gamepad (src/input/gamepad.ts polls the pad and feeds these through the bindings above)
// Standard-mapping button indices: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start,
// 12–15 D-pad up/down/left/right. A target is an action id above (sent as that action's current
// key, so a rebinding moves the pad too) or a fixed input: '@fire' / '@alt' (left / right mouse
// button at the crosshair), '@next' / '@prev' (Tab / Shift+Tab), '@pause' (Esc).
export interface PadBind { btn: number; to: string; label: string }
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
export const PAD: Record<'night' | 'run', PadBind[]> = {
  night: [
    { btn: 7, to: '@fire', label: 'Fire' },
    { btn: 6, to: '@alt', label: 'Focus' },
    { btn: 2, to: 'night.reload', label: 'Reload (hold: speed reload)' },
    { btn: 3, to: 'night.weapon', label: 'Next gun' },
    { btn: 1, to: 'night.duck', label: 'Duck (hold)' },
    { btn: 0, to: 'night.rally', label: 'Rally the line' },
    { btn: 4, to: '@prev', label: 'Previous guard' },
    { btn: 5, to: '@next', label: 'Next guard' },
    { btn: 12, to: 'night.free', label: 'Order: free fire' },
    { btn: 13, to: 'night.hold', label: 'Order: hold fire' },
    { btn: 14, to: 'night.heads', label: 'Order: heads only' },
    { btn: 15, to: 'night.wall', label: 'Order: protect the wall' },
    { btn: 11, to: 'night.firebomb', label: 'Firebomb' },
    { btn: 10, to: 'night.sally', label: 'Sally over the wall / back' },
    { btn: 8, to: 'night.hurry', label: 'Hurry the night (hold)' },
    { btn: 9, to: '@pause', label: 'Pause' },
  ],
  run: [
    { btn: 7, to: '@fire', label: 'Fire' },
    { btn: 6, to: '@alt', label: 'Swing' },
    { btn: 2, to: 'run.reload', label: 'Reload' },
    { btn: 0, to: 'run.search', label: 'Search / revive (hold)' },
    { btn: 1, to: 'run.shove', label: 'Shove' },
    { btn: 3, to: 'run.pack', label: 'Next item in the pack' },
    { btn: 5, to: 'run.drop', label: 'Drop the selected item' },
    { btn: 9, to: '@pause', label: 'Pause' },
  ],
};
/** Sticks, listed beside the buttons. */
export const PAD_STICKS: Record<'night' | 'run', [string, string][]> = {
  night: [['Right stick', 'Aim (the crosshair)']],
  run: [['Left stick', 'Walk'], ['Right stick', 'Aim']],
};
