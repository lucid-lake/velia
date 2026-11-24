// The first sail's lines on v2 (BACKLOG-v2 #4): v1's own rules and chips (src/ui/firstSailGuide.js, the
// three-free half of v1's src/ui/firstSail.js) on v2's Sail UI. What v1's shell gives them, here from v2's parts:
//   the lines        through Sail's hint row (sail.js 'controls'.hint, v1's controlsHint.js note()): a New player's
//                    "Drag the wheel to steer — the crew handles the sails." 1.5 s into the first quiet sail (the card gone,
//                    no logbook open), gone after the hint row's 7 s; I sail's winch line; I race's Regatta line; the pro
//                    offer. Setup's hints row hides them with the row (setup.js: the row's display), as v1's setHints
//   no goal          v1's "Sail to Fannette Island" chip (and so its arrival line, next suggestion and goal_reached) is not
//                    set on v2, desktop or phone (owner ruling 2026-11-16: it distracted players and few followed it;
//). The waymark beacon, the chart's marks and Cruise's destinations are their own modules
//   the mode         Sail 'goal' (v1's option name: the Sail lines); Cruise 'offer' (a New player is offered the helm after 60 s; the chip switches to Sail
//                    through the page's modes, main.js), as v1's modes' firstSail option
//   the settings     the page's store (settingsStore.js: welcomed, profile, introShown, proOffered, cruiseOffered)
// No staged first minute (owner, 2026-11-13): the stage is null, so the full line shows. Live pages
// only, not on a ?filmui=1 film (m4.js), as v1's captures never build it.
//   const fs = mountFirstSail({ ui, settings, menu: () => front?.home, modes });   each frame: fs.update()
import { attachFirstSailGuide } from '../../src/ui/firstSailGuide.js';

const GONE = { state: 'gone' };   // no card (?menu=0): play is always quiet

export function mountFirstSail({ ui, settings, menu = () => null, modes = null }) {
  const services = ui.services;
  if (modes?.go && !services.get('switchMode')) services.provide('switchMode', (id) => modes.go(id));   // v1's shell: the Cruise offer's chip
  const menuNow = { get state() { return (menu() ?? GONE).state; } };
  return attachFirstSailGuide({
    settings, services, menu: menuNow, goal: false,
    getOptions: () => ({ firstSail: (modes?.now?.() ?? ui.mode) === 'cruise' ? 'offer' : 'goal' }),
  });
}
