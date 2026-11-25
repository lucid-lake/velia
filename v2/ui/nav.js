// The nav column on v2 (the owner, 2026-11-13: "on the left side screen we have the pro data … can we bring them back in v2?"):
// v1's left edge as it is. src/ui/navColumn.js (the rows, the readings, the show and hide rules, the DOM and its CSS, three-free
// with src/ui/edgeStyle.js) and src/ui/passage.js (the 'passage' service: the mark in force and the leg to it), wired as v1's
// shell.js wires them (the passage service first, then the column; .update() each frame after the key legend).
// What it reads on v2's services (ui/sail.js), the same shapes v1's shell gives it:
//   player.phys.state   v2's boat (src/sim/boat.js BoatPhysics, the same physics as v1): cog, sog, trueWind, heel, rudderAngle, x, z
//   controls.pro        the PRO recess / TRIM switch (the trim panel's)
//   calm.mode           the Calm HUD's preset (Clear takes the column; Calm's fade is calmHud.js's CSS on .lk-edgepair)
//   chart.state         the small chart's state (chartplotter.js): Sail Pro's waypoint, a click on the enlarged chart
//   menu, logbook, chart.toggle, controls.hint, controls.tools.bino   the covers (as the key legend's)
// settings: the page's store (settingsStore.js), read through setup.js v2Settings: v2 has no edge instruments row (owner, 2026-11-17),
// so a stored edgeInstruments (an old 'off' hid the column with Pro on) reads as 'auto' and the column follows the PRO switch;
// ?navcol=0|1 stays (0 never, 1 always).
// On a desktop cockpit the column also follows the cockpit-up rule (2026-11-25; ui/cockpitUp.js, set in ui/sail.js as column.hidden):
// folded, Clear, Instruments or Tessie played takes it; the helm view keeps it.
//   const nav = mountNav({ services, settings, getMode: () => 'sail' });   each frame: nav.update()
import { createNavColumn } from '../../src/ui/navColumn.js';
import { createPassage } from '../../src/ui/passage.js';
import { v2Settings } from './setup.js';

export function mountNav({ services, settings, getMode = () => 'sail', doc = globalThis.document, win = globalThis } = {}) {
  const passage = services.get('passage') ?? createPassage({ services });
  if (!services.get('passage')) services.provide('passage', passage);
  const column = createNavColumn({ services, settings: v2Settings(settings), getMode, passage, doc, win });
  services.provide('navColumn', column);
  return column;
}
