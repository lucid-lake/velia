// What counts as taking the helm in Cruise (owner, 2026-10-30: Cruise is a passenger mode). Pure: tests/passenger.test.mjs.
// A passenger looks round (drag), zooms (wheel, pinch), switches the camera, opens the chart or the logbook, raises the
// binoculars and plays with the music, and none of that takes the helm. Only the inputs that operate the boat do:
//   keys        the intent keys of the table (src/sail/keys.js CRUISE_KEYMAP): steer A D ← →, trim W S ↑ ↓, the pro
//               trim keys, the sheets to the crew, wing on wing, reef, the engine and its throttle, the anchor, the lines, the sails
//   the helm    a press on the wheel or a winch in the helm view (a drag there steers or pulls), not on the radio set
//   a gamepad   a stick pushed past 0.4, a trigger or bumper held, the d-pad (the pro trim)
// Modifier chords (Ctrl, Cmd, Alt) are the browser's, never the boat's. Held modifiers alone do nothing.
import { cruiseKind, CRUISE_PADMAP } from '../../sail/keys.js';

export const INTENT = { stick: 0.4, trigger: 0.3, dragPx: 6 };
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab']);

// 'intent' | 'passenger' | 'none' for a keydown-like { code, key, shiftKey, ctrlKey, metaKey, altKey }
// lean: v2's lean key set (src/sail/keys.js LEAN_OFF: L O M ` G K U do nothing)
export function keyClass(e, lean = false) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || MODIFIERS.has(e.key)) return 'none';
  return cruiseKind(e.code, !!e.shiftKey, lean);
}

// a standard-mapping gamepad: the left stick steers, LT/RT ease and pull, LB/RB the twist, d-pad up/down the wind level (the 'intent'
// rows of CRUISE_PADMAP). Y, the d-pad's left/right and R3 are the passenger's (cameras, chart) and never the helm.
const PAD_INTENT = CRUISE_PADMAP.filter((m) => m.kind === 'intent').map((m) => m.button);
export function padIntent(gp) {
  if (!gp) return false;
  const a = gp.axes ?? [], b = gp.buttons ?? [];
  if (Math.hypot(a[0] ?? 0, a[1] ?? 0) > INTENT.stick) return true;
  for (const i of [6, 7]) if ((b[i]?.value ?? (b[i]?.pressed ? 1 : 0)) > INTENT.trigger) return true;
  return PAD_INTENT.some((i) => b[i]?.pressed);
}

// a helm-view part under the pointer: the wheel and the winches operate the boat, the radio set does not
export const partIntent = (part) => !!part && (part.role === 'steer' || part.role === 'pull' || part.role === 'ease');
