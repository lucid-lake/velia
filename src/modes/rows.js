// The mode registry's names (the pure half of src/modes/registry.js; Velia v2's front door, 2026-11-13): one row per mode
// with everything but its chunk. What only names the modes reads this file (src/modeNames.js, the home card's picks in
// src/ui/home.js, the card looks in src/ui/loading.js, tools/loading_shell.py), so it reaches no mode code: Velia v2
// (v2/, no three.js) imports the home card and the loading screen through it. src/modes/registry.js adds each row's
// `load` (the dynamic import of its chunk) and is the registry everything else reads (the chunks, the watchdog).
//   id, label, aliases, card, order, dev   as src/modes/registry.js says (load lives there)
// Keep each row on one line: tools/loading_shell.py reads id, aliases and card from this file.
export const MODE_NAMES = [
  { id: 'cruise', label: 'Cruise', aliases: ['chill'], card: 'cruise', order: 1 },
  { id: 'sail', label: 'Sail', aliases: ['daysail', 'day-sail', 'day_sail'], card: 'sail', order: 2 },
  { id: 'regatta', label: 'Regatta', aliases: ['racing', 'race'], card: 'sail', order: 3 },
  { id: 'school', label: 'School', aliases: ['sailing_school', 'sailing-school'], card: 'sail' },
  { id: 'fly', label: 'Fly', aliases: [], card: 'sail', dev: true },
];

export const CARDS = ['sail', 'cruise'];   // the card looks the pages know (src/ui/loading-shell.html, tokens.css lk-m-*)

// the home card's picks, in order (the rows with an order): [{ id, label, … }]
export const pickNames = () => MODE_NAMES.filter((r) => r.order != null).sort((a, b) => a.order - b.order);
