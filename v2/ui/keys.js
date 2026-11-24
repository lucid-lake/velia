// The keys Sail's UI owns on v2 (M4), beside the boat's own two verbs (v2/sim/controls.js: A/D ←/→ the helm, W/S ↑/↓ the
// sheets): C the view and Space the assist. The LEAN set (owner, 2026-11-20): Shift+C (the chase camera), 1–4 (the wind
// level: Conditions), K (the reef: the REEF switch) and G (wing on wing: the Pro drawer's WING) have no key on v2. H is the Calm HUD's
// own (calmHud.js: a tap folds the cockpit). Pure: the tests hold it to the Keys page (ui/keyMap.js).
// No G: the gennaker is the crew's (round 2, owner 2026-11-21: "this UX of G should not exist").
export const UI_KEYS = Object.freeze({ view: 'KeyC', tack: 'Space', fold: 'KeyH' });

// e: { code, shiftKey, repeat, ctrlKey, metaKey, typing } → an action or null
export function keyAction({ code, shiftKey = false, repeat = false, ctrlKey = false, metaKey = false, typing = false } = {}) {
  if (ctrlKey || metaKey || repeat) return null;
  if (code === UI_KEYS.view) return shiftKey ? null : { view: 'toggle' };
  if (code === UI_KEYS.tack && !typing) return { tack: true };
  return null;
}
