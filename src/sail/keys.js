// Sail's keys in one table (§ 13, § 14): every binding the page listens for, so a new key is
// checked against the rest (tests/keys.test.mjs: no two actions on one key in one mode, and every key code the
// Sail sources read is in the table). code: KeyboardEvent.code; shift: true (only with Shift), false (only
// without), undefined (either); modes: where it acts, of MODES ('basic': the crew trims, ?autotrim on; 'raw':
// ?autotrim=0; 'pro-…': pro mode on top of either), all four if not given; hold: the action lasts while the key is down.
export const MODES = ['basic', 'raw', 'pro-basic', 'pro-raw'];
const RAW = ['raw', 'pro-raw'], PRO = ['pro-basic', 'pro-raw'];
export const KEYMAP = [
  { code: 'KeyA', action: 'steer to port', hold: true }, { code: 'ArrowLeft', action: 'steer to port', hold: true },
  { code: 'KeyD', action: 'steer to starboard', hold: true }, { code: 'ArrowRight', action: 'steer to starboard', hold: true },
  { code: 'Space', action: 'tack or gybe: the Tack button, the whole turn (fix/tack-wind)' },   // Cruise leaves it unbound: her autopilot tacks
  { code: 'KeyW', action: 'pull the sheets in', hold: true }, { code: 'ArrowUp', action: 'pull the sheets in', hold: true },
  { code: 'KeyS', action: 'ease the sheets', hold: true }, { code: 'ArrowDown', action: 'ease the sheets', hold: true },
  ...['Digit1', 'Digit2', 'Digit3', 'Digit4'].map((code, i) => ({ code, action: `wind level ${i + 1}` })),
  { code: 'KeyV', action: 'the boat from above' },
  { code: 'KeyH', action: 'the keys list (held); a tap: lower or raise the cockpit (the fold button)', hold: true },
  { code: 'KeyL', action: 'the logbook' },
  { code: 'KeyM', action: 'sound on / off' },
  { code: 'KeyC', shift: false, action: 'the helm view' }, { code: 'KeyC', shift: true, action: 'the chase camera' },
  { code: 'KeyN', action: 'the chart: a tap opens it large and a tap closes it; held, it is large while held' },
  { code: 'KeyG', action: 'wing on wing' },
  { code: 'KeyF', shift: true, modes: ['basic', 'raw', 'pro-basic'], action: 'full screen' },   // plain F is the jib sheet / lead; Shift+F is the lead in pro-raw (owner, 2026-10-30)
  { code: 'KeyB', action: 'the binoculars: up, and again down' },                  // 2026-10-29: was reef (untaught); a toggle since 2026-11-12 (was held)
  { code: 'KeyK', action: 'reef' },   // moved from B; auto-reef is a Settings row (key-cleanup, 2026-10-30)
  { code: 'KeyO', action: 'the VHF: the weather channel' },                          // R is the jib lead (pro) and the jib sheet (raw)
  { code: 'KeyR', shift: false, modes: ['basic'], action: 'the jib sheet in (its own winch)', hold: true }, { code: 'KeyF', shift: false, modes: ['basic'], action: 'the jib sheet out (its own winch)', hold: true },
  { code: 'KeyR', shift: false, modes: RAW, action: 'the jib sheet in', hold: true }, { code: 'KeyF', shift: false, modes: RAW, action: 'the jib sheet out', hold: true },
  { code: 'KeyQ', modes: PRO, action: 'traveller down', hold: true }, { code: 'KeyE', modes: PRO, action: 'traveller up', hold: true },
  { code: 'KeyZ', shift: false, modes: PRO, action: 'twist open', hold: true }, { code: 'KeyX', shift: false, modes: PRO, action: 'twist closed', hold: true },
  { code: 'KeyZ', shift: true, modes: PRO, action: 'backstay ease', hold: true }, { code: 'KeyX', shift: true, modes: PRO, action: 'backstay on', hold: true },
  { code: 'KeyR', shift: false, modes: ['pro-basic'], action: 'jib lead forward', hold: true }, { code: 'KeyF', shift: false, modes: ['pro-basic'], action: 'jib lead aft', hold: true },
  { code: 'KeyR', shift: true, modes: ['pro-raw'], action: 'jib lead forward', hold: true }, { code: 'KeyF', shift: true, modes: ['pro-raw'], action: 'jib lead aft', hold: true },
  { code: 'Escape', action: 'the home card (src/ui/home.js); first it closes the logbook, the pinned chart or the raised binoculars' },
  // the engine and the ground tackle (feat/engine-anchor; seamanship.js)
  { code: 'KeyI', action: 'the engine: start / stop' },
  { code: 'Equal', action: 'the throttle: a notch ahead (held: a notch every 0.3 s; it stays)', hold: true }, { code: 'NumpadAdd', action: 'the throttle: a notch ahead (held: a notch every 0.3 s; it stays)', hold: true },
  { code: 'Minus', action: 'the throttle: a notch astern (held: a notch every 0.3 s; it stays)', hold: true }, { code: 'NumpadSubtract', action: 'the throttle: a notch astern (held: a notch every 0.3 s; it stays)', hold: true },
  { code: 'Digit0', action: 'the throttle: STOP' },
  { code: 'KeyJ', action: 'the anchor: drop / weigh' },   // wait for dawn is a button beside it, not a key
  { code: 'KeyU', action: 'the lines: pick up a mooring, tie up alongside, let go' },
  { code: 'KeyY', action: 'the sails: down / up' },
  { code: 'Backquote', action: 'let her sail herself: Cruise (any key takes the helm back)' },   // every letter is taken; ` sits at the top left, out of the hands' way
  // the settings, only while H is held (feat/mastery; controlsHint.js): letters are all taken
  { code: 'Digit5', action: 'H held: the crew\'s net' }, { code: 'Digit6', action: 'H held: the pilot' }, { code: 'Digit7', action: 'H held: I sail' },
];
export const KEY = { tack: 'Space', cruise: 'Backquote', bino: 'KeyB', reef: 'KeyK', vhf: 'KeyO', engine: 'KeyI', ahead: 'Equal', astern: 'Minus', neutral: 'Digit0', anchor: 'KeyJ', lines: 'KeyU', sails: 'KeyY' };

// ---- Cruise, the passenger mode (owner, 2026-10-30) ------------------------------------------------------------
// Cruise listens to its own table. 'passenger' keys never take the helm; 'intent' keys are the boat-operating ones: the
// first press hands the helm to Sail (index.js takeHelm) and the key then acts there, as it would have. Anything not in
// this table does nothing in Cruise (a stray key never takes the helm). C is the camera there (cycle; Shift+C back),
// where in Sail it is the helm view and Shift+C the chase: the two tables never meet (collisions() runs on each), and
// tests/passenger.test.mjs checks that every Sail steering, trim, engine and anchor key is an intent key here.
export const CRUISE = ['cruise'];
export const CRUISE_KEYMAP = [
  // passenger: nothing here takes the helm
  { code: 'KeyC', shift: false, modes: CRUISE, kind: 'passenger', action: 'the next camera' }, { code: 'KeyC', shift: true, modes: CRUISE, kind: 'passenger', action: 'the previous camera' },
  { code: 'KeyV', modes: CRUISE, kind: 'passenger', action: 'the Above camera; again: north-up / course-up' },
  { code: 'KeyN', modes: CRUISE, kind: 'passenger', action: 'the chart (tap pins it; tap the water on it to sail there)', hold: true },
  { code: 'KeyL', modes: CRUISE, kind: 'passenger', action: 'the logbook' },
  { code: 'KeyB', modes: CRUISE, kind: 'passenger', action: 'the binoculars: up, and again down' },
  { code: 'KeyO', modes: CRUISE, kind: 'passenger', action: 'the VHF: the weather channel' },
  { code: 'KeyM', modes: CRUISE, kind: 'passenger', action: 'sound on / off' },
  { code: 'BracketRight', modes: CRUISE, kind: 'passenger', action: 'music: the next piece' },
  { code: 'BracketLeft', modes: CRUISE, kind: 'passenger', action: 'music: pause / play' },
  { code: 'Escape', modes: CRUISE, kind: 'passenger', action: 'the menu; first it closes the logbook, the pinned chart or the raised binoculars' },
  { code: 'Backquote', modes: CRUISE, kind: 'passenger', action: 'let her sail herself (already in Cruise: nothing)' },
  // intent: the boat-operating keys
  { code: 'KeyA', modes: CRUISE, kind: 'intent', action: 'steer to port' }, { code: 'ArrowLeft', modes: CRUISE, kind: 'intent', action: 'steer to port' },
  { code: 'KeyD', modes: CRUISE, kind: 'intent', action: 'steer to starboard' }, { code: 'ArrowRight', modes: CRUISE, kind: 'intent', action: 'steer to starboard' },
  { code: 'KeyW', modes: CRUISE, kind: 'intent', action: 'pull the sheets in' }, { code: 'ArrowUp', modes: CRUISE, kind: 'intent', action: 'pull the sheets in' },
  { code: 'KeyS', modes: CRUISE, kind: 'intent', action: 'ease the sheets' }, { code: 'ArrowDown', modes: CRUISE, kind: 'intent', action: 'ease the sheets' },
  ...['KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyR', 'KeyF'].map((code) => ({ code, modes: CRUISE, kind: 'intent', action: 'a pro trim key' })),
  { code: 'KeyG', modes: CRUISE, kind: 'intent', action: 'wing on wing' },
  { code: 'KeyK', modes: CRUISE, kind: 'intent', action: 'reef' },
  { code: 'KeyI', modes: CRUISE, kind: 'intent', action: 'the engine' },
  { code: 'Equal', modes: CRUISE, kind: 'intent', action: 'the throttle' }, { code: 'NumpadAdd', modes: CRUISE, kind: 'intent', action: 'the throttle' },
  { code: 'Minus', modes: CRUISE, kind: 'intent', action: 'the throttle' }, { code: 'NumpadSubtract', modes: CRUISE, kind: 'intent', action: 'the throttle' },
  { code: 'Digit0', modes: CRUISE, kind: 'intent', action: 'the throttle: neutral' },
  { code: 'KeyJ', modes: CRUISE, kind: 'intent', action: 'the anchor' }, { code: 'KeyU', modes: CRUISE, kind: 'intent', action: 'the lines' }, { code: 'KeyY', modes: CRUISE, kind: 'intent', action: 'the sails: down / up' },
];
// The lean key set (owner 2026-11-20): on v2 these Cruise keys have no handler (L the logbook, O the VHF, M sound, ` the
// mode switch, G wing, K reef, U the lines: each has its on-screen control); v1 keeps them all
export const LEAN_OFF = Object.freeze(['KeyL', 'KeyO', 'KeyM', 'Backquote', 'KeyG', 'KeyK', 'KeyU']);
// what a key does in Cruise: 'intent' (take the helm), 'passenger' (handled, no helm) or 'none' (ignored); lean: v2's lean set
export function cruiseKind(code, shift = false, lean = false) {
  if (lean && LEAN_OFF.includes(code)) return 'none';
  const hit = CRUISE_KEYMAP.find((k) => k.code === code && (k.shift === undefined || k.shift === !!shift));
  return hit ? hit.kind : 'none';
}

// The gamepad (the standard mapping's button indices; pads.js): one action per button and context
export const PADMAP = [
  { button: 0, action: 'pro: held with the d-pad, the jib lead' }, { button: 1, action: 'pro: held with the d-pad, the backstay' },
  { button: 2, action: 'the helm view' }, { button: 3, action: 'the boat from above (tap), the helm view (hold)' },
  { button: 4, action: 'pro: twist open' }, { button: 5, action: 'pro: twist closed' },
  { button: 6, action: 'ease' }, { button: 7, action: 'pull in' },
  { button: 8, action: 'the logbook' }, { button: 9, action: 'the keys list' },
  { button: 10, action: 'the binoculars (held ≥ 0.25 s; the right stick aims), the VHF (a tap)' }, { button: 11, action: 'the chart (feat/chart)' },
  { button: 12, action: 'wind up' }, { button: 13, action: 'wind down' }, { button: 14, action: 'pro: traveller down' }, { button: 15, action: 'pro: traveller up' },
];

// Cruise's gamepad (owner, 2026-10-30; its own table, as CRUISE_KEYMAP): standard-mapping buttons by gesture. 'passenger' never takes
// the helm; 'intent' does (src/modes/chill/intent.js padIntent reads this table, and the left stick past 0.4 is intent too).
// Y is the camera (a tap: the next; held 0.5 s: the helm camera, as Sail's held Y is the helm view), the d-pad's left / right the
// previous / next camera (Sail: the pro traveller, which waits for the hand-over). R3 stays the chart, as N is a key (a pad has no
// other way to pin it); X and the rest do nothing here. Sail's own table (PADMAP) takes over at the hand-over.
export const CRUISE_PADMAP = [
  { button: 3, gesture: 'tap', kind: 'passenger', action: 'the next camera' }, { button: 3, gesture: 'hold', kind: 'passenger', action: 'the helm camera' },
  { button: 14, gesture: 'tap', kind: 'passenger', action: 'the previous camera' }, { button: 15, gesture: 'tap', kind: 'passenger', action: 'the next camera' },
  { button: 11, gesture: 'tap', kind: 'passenger', action: 'the chart (held: while held)' },
  { button: 4, gesture: 'press', kind: 'intent', action: 'pro: twist open' }, { button: 5, gesture: 'press', kind: 'intent', action: 'pro: twist closed' },
  { button: 6, gesture: 'press', kind: 'intent', action: 'ease' }, { button: 7, gesture: 'press', kind: 'intent', action: 'pull in' },
  { button: 12, gesture: 'press', kind: 'intent', action: 'wind up' }, { button: 13, gesture: 'press', kind: 'intent', action: 'wind down' },
];
export const CRUISE_PAD_HOLD_S = 0.5;
// two pad bindings collide: the same button, and one gesture the same as (or 'press' covering) the other's
export function padCollisions(map = CRUISE_PADMAP) {
  const out = [];
  for (let i = 0; i < map.length; i++) for (let j = i + 1; j < map.length; j++) {
    const a = map[i], b = map[j];
    if (a.button === b.button && a.action !== b.action && (a.gesture === b.gesture || a.gesture === 'press' || b.gesture === 'press')) out.push([a, b]);
  }
  return out;
}

// Do two bindings collide? Same code, overlapping Shift, a mode in common.
const modesOf = (k) => k.modes ?? MODES;
export function collisions(map = KEYMAP) {
  const out = [];
  for (let i = 0; i < map.length; i++) for (let j = i + 1; j < map.length; j++) {
    const a = map[i], b = map[j];
    if (a.code !== b.code || a.action === b.action) continue;
    const shiftOverlap = a.shift === undefined || b.shift === undefined || a.shift === b.shift;
    if (shiftOverlap && modesOf(a).some((m) => modesOf(b).includes(m))) out.push([a, b]);
  }
  return out;
}
