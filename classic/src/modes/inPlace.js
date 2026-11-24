// The in-place mode change (Cruise's hand-over to Sail and its hand back, src/modes/chill/index.js) with or without the shell.
// The shell (src/shell.js) is imported only once the core is ready (src/main.js), seconds after Cruise's strip and keys
// work on a slow load (the Vite dev server, a phone network). Before it is in:
//   setModeInPlace   the mode and its options go to the registry; the shell takes them up when it installs
//   switchInPlace    the ` key reaches the running mode's quick switch (the hand back) directly
// After, both are the shell's: its 'setMode' and its 'switchMode' (the switch by id, which asks 'quickSwitch' first).

export function setModeInPlace(services, id, options = null) {
  const setMode = services.get('setMode');
  if (setMode) return setMode(id, options);
  const root = services.root ?? services;   // the page's registry, not the mode's scope: the shell reads them there
  if (options) root.provide('modeOptions', options);
  root.provide('mode', id);
}

export function switchInPlace(services, id) {
  const switchMode = services.get('switchMode');
  if (switchMode) return switchMode(id);
  const quick = services.get('quickSwitch')?.[id];
  return quick ? quick() : false;
}
