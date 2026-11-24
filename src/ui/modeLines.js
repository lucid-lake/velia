// (src/ui/modeLines.js: shared by Cruise and Regatta, so neither imports the other's code.) Cruise's own lines (the quiet line under the world) and Regatta's card words that name a key, each with the finger's
// wording (fix/first-load, 2026-10-31: iOS in Cruise said "C the camera"). A touch device never sees a key named:
// cruiseLine(id, { touch }) picks the wording by the input modality (src/ui/pointer.js .touch: a finger last, or a coarse
// device before any input). The words are what the passenger sees on screen: the bar's camera button, named for the camera on
// screen (camera: its word, 'Cinematic'; 2026-11-11, the bottom bar's View is gone), and Take the helm.
//   cruiseLine('look', { touch: true, camera: 'Cinematic' })   // 'look round · tap Cinematic to change the camera · …'
//   cruiseLine('above', { touch, northUp: true })
export const CRUISE_LINES = {
  look: { keys: 'look round · C the camera · A D to take the helm', touch: 'look round · tap {camera} to change the camera · Take the helm to steer' },
  aboveNorth: { keys: 'From above · north up · V course up', touch: 'From above · north up' },
  aboveCourse: { keys: 'From above · course up · V north up', touch: 'From above · course up' },
};
export const REGATTA_WORDS = {
  start: { keys: 'Start (Enter)', touch: 'Start' },
  skipIntro: { keys: 'any key to skip', touch: 'tap to skip' },
};

export function cruiseLine(id, { touch = false, camera = null } = {}) {
  const l = CRUISE_LINES[id] ?? REGATTA_WORDS[id];
  return l ? (touch ? l.touch : l.keys).replace('{camera}', camera || 'the camera button') : '';
}

// the hand now: Sail's modality while its controls run (the 'modality' service in services), else the one given, else a coarse device
export function touchNow(own = null, coarse = () => false, services = null) {
  const m = services?.get('modality') ?? own;
  return m ? !!m.touch : !!coarse();
}

// a key named on screen: a key cap ('C', 'A D', 'Shift', 'Enter'), "press X", "any key" (tests/touchWords.test.mjs)
export const KEYCAP = /(^|[\s·(])[A-Z](\s[A-Z])?(?=\s(the|to|for|course|north|back|next)\b)|\b[Pp]ress\b|\b[Aa]ny key\b|\b(Enter|Esc|Shift|Space|Ctrl|Tab)\b|<span class="cap">/;
