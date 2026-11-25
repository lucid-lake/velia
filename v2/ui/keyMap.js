// v2's desktop keys in one table: every key the v2 page acts on, read from its handlers, so the Keys page (Menu › Keys,
// front.js keysPageHtml) and the key legend say the same thing and say all of it. The LEAN set (owner, 2026-11-20): a key
// stays only where a hand is already on the keyboard and a trip to the mouse would lose the moment. The handlers: sim/controls.js
// (A/D ←/→ the helm, W/S ↑/↓ both sheets; Pro only: R/F the jib's own sheet, Q/E, Z/X, Shift+Z/X the trims), ui/keys.js (C, Space),
// ui/seamanship.js (I, + −, 0, J, Y), ui/captain.js (B), src/ui/chartplotter.js (N), src/ui/calmHud.js (H: a tap folds the cockpit),
// src/ui/home.js (Esc), cruise/index.js (Cruise's C, Shift+C, V, [ ]; its P photo never fires: src/sail/keys.js CRUISE_KEYMAP has no P).
// Off the keyboard, on screen only: the jib's own sheet in basic (its winch), L (the logbook), O (VHF), M (sound), ` (the top bar's
// Cruise ⇄ Sail), 1–4 (the Conditions sheet), K (REEF), WING (Pro), U (MOOR); no key for the gennaker (round 2: the crew flies it; Pro's R/F trim it); gone: Shift+C chase, the H list and H+5/6/7, ?, Shift+F,
// V in Sail. The AUTO button has no key (ui/autopilot.js); a steering key takes the helm back from it.
// A row: k the caps shown, codes the KeyboardEvent codes it stands for ('Shift+KeyC' for a shifted one), v a short verb
// (words.js markup glosses on hover), g a note on the row's title, a the mouse or touch way (the Mouse, touch tab).
// modes: where it acts ('sail' covers Regatta: a race is Sail's page); pro: true only in Pro, false only without.
import { PILOT_LABEL } from './pilotLabel.js';   // the autopilot button's name (NAV)

const SR = ['sail'], ALL = ['sail', 'cruise'];
const KEY_GROUPS = [
  { id: 'helm', title: 'Helm', rows: [
    { id: 'steer', k: ['A', 'D'], codes: ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'], alt: ['←', '→'], v: 'steer', g: `a hand on the helm lets ${PILOT_LABEL} go`, a: 'drag or scroll the wheel', modes: SR },
    { id: 'tack', k: ['Space'], codes: ['Space'], v: 'the assist', g: 'the round key\'s word now, the whole manoeuvre for you: Tack, Gybe, Free (out of irons), Refloat (kedges her off); again cancels', a: 'the round key on the wheel\'s hub', modes: SR },
    { id: 'auto', k: ['click'], codes: [], v: PILOT_LABEL, g: 'the crescent beside the round key holds her course, or sails to a mark set; no key', a: `the ${PILOT_LABEL} crescent`, modes: SR },
  ] },
  { id: 'sails', title: 'Sails', rows: [
    { id: 'sheets', k: ['W', 'S'], codes: ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'], alt: ['↑', '↓'], v: 'both sails in, out', g: 'trim: both sheets together', a: 'drag a {winch}', modes: SR },
    { id: 'furl', k: ['Y'], codes: ['KeyY'], v: 'sails up, down', modes: SR },
  ] },
  { id: 'engine', title: 'Engine, anchor', rows: [
    { id: 'engine', k: ['I'], codes: ['KeyI'], v: 'engine on, off', modes: SR },
    { id: 'throttle', k: ['+', '−'], codes: ['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'], v: 'ahead, {astern|astern|back}', g: 'held: a notch every 0.3 s; out of neutral it starts the engine', a: 'the throttle lever', modes: SR },
    { id: 'neutral', k: ['0'], codes: ['Digit0'], v: 'neutral', modes: SR },
    { id: 'anchor', k: ['J'], codes: ['KeyJ'], v: '{anchor} down, up', modes: SR },
  ] },
  { id: 'view', title: 'View', rows: [
    { id: 'view', k: ['C'], codes: ['KeyC'], v: 'boat or {helm|helm|wheel} view', a: 'tap Boat | Helm', modes: SR },
    { id: 'bino', k: ['B'], codes: ['KeyB'], v: 'binoculars', g: 'up, and again down; the mouse aims', a: 'the mouse aims', modes: ALL },
    { id: 'fold', k: ['H'], codes: ['KeyH'], v: 'cockpit down, up', g: 'a tap', modes: SR },
  ] },
  { id: 'tools', title: 'Tools', rows: [
    { id: 'chart', k: ['N'], codes: ['KeyN'], v: 'chart', g: 'tap opens the whole bay, tap again closes; or hold', a: 'tap Menu on the top bar', modes: ALL },
  ] },
];
// the foot of the Keys tab: the menu
const KEY_FOOT = [
  { id: 'menu', k: ['Esc'], codes: ['Escape'], v: 'menu', g: 'first it closes the chart, the logbook or the binoculars', modes: ALL },
];
// Pro (Setup › Sail › Pro, or the PRO button): the trims the crew keeps in basic, and the jib's own sheet (basic: its winch)
export const KEY_PRO = { id: 'pro', title: 'Pro trim', rows: [
  { id: 'jib', k: ['R', 'F'], codes: ['KeyR', 'KeyF'], v: '{jib} or {gennaker} in, out', g: 'Pro only: the jib alone, or the gennaker while it flies. Hold F 1 s at the jib\'s full ease (wind behind 80°) to hoist the gennaker; hold R 1 s at its full trim to douse it. In basic the jib\'s own winch; the jib lead is the PRO panel\'s slider', modes: SR, pro: true },
  { id: 'trav', k: ['Q', 'E'], codes: ['KeyQ', 'KeyE'], v: '{traveller} down, up', modes: SR, pro: true },
  { id: 'twist', k: ['Z', 'X'], codes: ['KeyZ', 'KeyX'], v: '{twist} open, closed', modes: SR, pro: true },
  { id: 'backstay', k: ['⇧Z', '⇧X'], codes: ['Shift+KeyZ', 'Shift+KeyX'], v: '{backstay} ease, on', modes: SR, pro: true },
] };
// Cruise (the autopilot sails): its own keys; a boat key (steer, sheets, trims, engine, anchor, sails) takes the helm back
const KEY_CRUISE = { id: 'cruise', title: 'Cruise', note: 'N chart, B binoculars and Esc work here too.', rows: [
  { id: 'c-helm', k: ['A', 'D'], codes: [], v: 'take the helm', g: 'any boat key does: W S, I, J, Y …', modes: ['cruise'] },
  { id: 'c-cam', k: ['C', '⇧C'], codes: ['KeyC', 'Shift+KeyC'], v: 'next, last camera', modes: ['cruise'] },
  { id: 'c-above', k: ['V'], codes: ['KeyV'], v: 'from above', g: 'again: north up, course up', modes: ['cruise'] },
  { id: 'c-next', k: [']'], codes: ['BracketRight'], v: 'next piece', modes: ['cruise'] },
  { id: 'c-play', k: ['['], codes: ['BracketLeft'], v: 'music pause, play', modes: ['cruise'] },
  { id: 'c-back', k: ['click'], codes: [], v: 'take the helm', a: 'tap Sail on the top bar', modes: ['cruise'] },
] };
// the hands' own ways (no key): on the Mouse, touch tab only. First the mouse, plain (the water, the chart), then what the
// audit moved off the keyboard, each with the control it keeps
export const KEY_HANDS = [
  { id: 'look', k: ['drag'], codes: [], v: 'look around', a: 'two fingers', modes: ALL },
  { id: 'zoom', k: ['wheel'], codes: [], v: 'zoom', a: 'pinch', modes: ALL },
  { id: 'mark', k: ['2×click'], codes: [], v: 'set the mark', g: `on the water or the chart; then click ${PILOT_LABEL} to sail there; on the mark: clear it`, a: `double-tap; then tap ${PILOT_LABEL}`, modes: SR },
  { id: 'jib-hand', k: ['drag'], codes: [], v: '{jib} alone in, out', a: 'the jib\'s own winch', modes: SR },
  { id: 'reef-hand', k: ['click'], codes: [], v: '{reef}', a: 'the REEF switch: A · 0 · 1 · 2', modes: SR },
  { id: 'wind-hand', k: ['click'], codes: [], v: 'wind level 1 to 4', a: 'Conditions on the top bar', modes: SR },
  { id: 'moor-hand', k: ['click'], codes: [], v: 'moor: ball or pier', a: 'the MOOR button', modes: SR },
  { id: 'log-hand', k: ['click'], codes: [], v: 'logbook', a: 'Menu › Logbook', modes: ALL },
  { id: 'sound-hand', k: ['click'], codes: [], v: 'sound on, off', a: 'Conditions › Sound', modes: ALL },
  { id: 'vhf-hand', k: ['click'], codes: [], v: 'VHF weather', a: 'VHF on Conditions: the forecast now', modes: ALL },
  { id: 'cruise-hand', k: ['click'], codes: [], v: 'Cruise ⇄ Sail', a: 'Cruise ⇄ on the top bar', modes: ALL },
];
// the phone's Controls page (Help › Controls on the flat controls, v2/ui/flat.js; a finger, no keys): what is on its screen, never a
// wheel, a winch or a lever (fix 2026-11-18: it still read the cockpit's "drag the wheel", "drag a winch"). [what, how]
export const FLAT_ROWS = [
  ['Steer', 'drag the left ring'],
  ['{tack|Tack}, {gybe|gybe}', 'tap the bottom-right corner'],
  ['{trim|Trim}', 'drag the right ring: In or Ease'],
  [PILOT_LABEL, 'tap the bottom-left corner'],
  ['More', 'tap ⋯: sails, engine, anchor, Pro'],
  ['Look', 'drag the water; pinch to zoom'],
  ['Cruise', 'tap Cruise ⇄ on the top bar'],
  ['Menu, chart', 'tap Menu, top left: the chart is the menu'],
];
// Play as Tessie (living/tessiePlayer.js TESSIE_KEYS; the UI audit, owner 2026-11-21): her own tab, only where feature('playTessie') is on
// (front.js keyTable); the boat's keys do nothing while you are her. T is the swap both ways: in Sail it becomes her while she shows
// herself (the skipper's line says "Tessie's up. [T] to be her."), as her it gives the Halcyon back. The words are her legend's (ui/tessieHud.js LEGEND).
export const KEY_TESSIE = { id: 'tessie', title: 'Tessie', note: 'Drag to look. Esc opens the menu.', rows: [
  { id: 't-swim', k: ['WASD'], codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], alt: ['↑', '↓', '←', '→'], v: 'swim', g: 'about the camera: W away from it', modes: ['tessie'] },
  { id: 't-dash', k: ['1', '⇧'], codes: ['Digit1', 'ShiftLeft', 'ShiftRight'], v: 'dash', g: 'a burst of speed, then a cooldown', modes: ['tessie'] },
  { id: 't-bite', k: ['Space', 'click'], codes: ['Space'], v: 'bite', g: 'Space, or a left click on the water', modes: ['tessie'] },   // no F (owner, 2026-11-24)
  { id: 't-updown', k: ['E', 'Q'], codes: ['KeyE', 'KeyQ'], v: 'up, down', g: 'held', modes: ['tessie'] },
  { id: 't-view', k: ['C'], codes: ['KeyC'], v: 'first or third person', modes: ['tessie'] },
  { id: 't-swap', k: ['T'], codes: ['KeyT'], v: 'be Tessie, back to the Halcyon', g: 'in Sail while she shows herself', modes: ['sail', 'tessie'] },
] };
const KEY_COLUMNS = [['helm', 'sails', 'view'], ['engine', 'tools']];
export const KEY_TABLE = { groups: KEY_GROUPS, columns: KEY_COLUMNS, foot: KEY_FOOT, pro: KEY_PRO, extra: [KEY_CRUISE], hands: KEY_HANDS };
// the Keys page's table for this device: Tessie's tab only where she is playable (src/core/features.js playTessie)
export const keyTable = ({ tessie = false } = {}) => (tessie ? { ...KEY_TABLE, extra: [...KEY_TABLE.extra, KEY_TESSIE] } : KEY_TABLE);
export const KEY_ROWS = [...KEY_GROUPS.flatMap((g) => g.rows), ...KEY_FOOT, ...KEY_PRO.rows, ...KEY_CRUISE.rows, ...KEY_HANDS];
