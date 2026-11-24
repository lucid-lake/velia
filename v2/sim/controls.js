// Sail's two verbs from the hands (M3): the helm (steer −1 port … +1 starboard) and the sheet (pull +1 in … −1 ease),
// from v1's keys (src/sail/keys.js KEYMAP: A/D or ←/→ steer, W/S or ↑/↓ the sheets) and a phone's on-screen helm and
// sheet buttons (v2/ui/touch.js), summed and clamped as v1's controls.js does with its pads. Pure: the tests feed key
// sets and touch states. The page's DOM listeners live in v2/ui/touch.js and main.js.
export const KEYS = Object.freeze({
  port: ['KeyA', 'ArrowLeft'], starboard: ['KeyD', 'ArrowRight'],
  pullIn: ['KeyW', 'ArrowUp'], ease: ['KeyS', 'ArrowDown'],
});
// every code the page listens for (the keys test holds it to v1's table)
export const CODES = Object.freeze([...KEYS.port, ...KEYS.starboard, ...KEYS.pullIn, ...KEYS.ease]);
// the trim keys held (v1's src/sail/keys.js KEYMAP; src/controllers/sail.js): R/F the jib's own sheet (Pro only since 2026-11-20; v1
// makes them the jib lead; v2's lead is the PRO panel's), Q/E the traveller, Z/X the twist, Shift+Z/X the backstay (Pro)
export const TRIM_KEYS = Object.freeze({ jibIn: 'KeyR', jibOut: 'KeyF', travDown: 'KeyQ', travUp: 'KeyE', twistOpen: 'KeyZ', twistClosed: 'KeyX', shift: Object.freeze(['ShiftLeft', 'ShiftRight']) });
// every code held for the hands (main.js tracks these; only CODES are the page's own, preventDefault)
export const HELD_CODES = Object.freeze([...CODES, TRIM_KEYS.jibIn, TRIM_KEYS.jibOut, TRIM_KEYS.travDown, TRIM_KEYS.travUp, TRIM_KEYS.twistOpen, TRIM_KEYS.twistClosed, ...TRIM_KEYS.shift]);
// keys: the held Set → { jib, trav, twist, backstay, lead } axes (−1…+1): jib + = in (R), in Pro; lead 0 (no key:
// the PRO panel's slider); the traveller + = up (E); the twist + = open (Z) without Shift; the
// backstay + = on (Shift+X)
// pro (default true): R/F the jib's own sheet are Pro keys only since the lean key set (owner 2026-11-20); in basic the jib
// has its winch alone. The page passes B.pro; the pure callers (tests) keep the default
export function keysToTrim(keys, { pro = true } = {}) {
  const k = (c) => (keys.has(c) ? 1 : 0), sh = TRIM_KEYS.shift.some((c) => keys.has(c));
  const T = TRIM_KEYS;
  return {
    jib: sh || !pro ? 0 : k(T.jibIn) - k(T.jibOut),
    lead: 0,
    trav: k(T.travUp) - k(T.travDown),
    twist: sh ? 0 : k(T.twistOpen) - k(T.twistClosed),
    backstay: sh ? k(T.twistClosed) - k(T.twistOpen) : 0,
  };
}
const clamp = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);
const any = (set, codes) => codes.some((c) => set.has(c));

// keys: a Set of KeyboardEvent.code held now → { steer, pull }
export function keysToAxes(keys) {
  return { steer: (any(keys, KEYS.starboard) ? 1 : 0) - (any(keys, KEYS.port) ? 1 : 0), pull: (any(keys, KEYS.pullIn) ? 1 : 0) - (any(keys, KEYS.ease) ? 1 : 0) };
}
// the hands summed (v1's pads: keys + the stick + the strip), each axis clamped to ±1
export function sumHands(...hands) {
  let steer = 0, pull = 0;
  for (const h of hands) { steer += h?.steer ?? 0; pull += h?.pull ?? 0; }
  return { steer: clamp(steer), pull: clamp(pull) };
}
// the on-screen helm: a finger's offset from where it landed, full at `fullPx` (v1 TOUCH.helmFrac × the width)
export const helmFromDrag = (dx, fullPx) => clamp(dx / Math.max(1, fullPx));
// a drag looks: px → rad (v1's deck, src/deck/index.js: 0.005 rad/px round, 0.004 up), the same in both views; the wheel
// zooms by v1's deck's exp(deltaY × 0.001) (each camera clamps its own: the follow camera's distance, the helm view's lens)
export const LOOK = Object.freeze({ dragX: 0.005, dragY: 0.004, wheel: 0.001 });
export const orbitFromDrag = (dx, dy) => [dx * LOOK.dragX, dy * LOOK.dragY];
export const zoomFromWheel = (deltaY) => Math.exp(deltaY * LOOK.wheel);
// the frame's look and zoom to the camera that is the view (v1's deck.camera): the follow camera takes them only in the follow
// view, the helm camera only in the helm view (also while the move to it runs); look is null when no drag is held, else
// [dx, dy] rad (a held drag that did not move this frame is [0, 0]: the helm camera's spring back waits while a hand is on it)
export function routeLook(view, look, zoom) {
  const helm = view === 'helm', z = zoom && zoom !== 1 ? zoom : 0;
  return { orbit: helm ? null : look, followZoom: helm ? 0 : z, helmLook: helm ? look : null, helmZoom: helm && z ? z : 1 };
}
// portrait (an upright phone): the follow camera's aim point sits lower (v1 FOLLOW.leadPortrait) so the boat clears the controls
export const isPortrait = (w, h) => h > w;
