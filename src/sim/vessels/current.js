// The boat this page sails (refactor Phase 2 step 6): the chosen boat's whole
// profile (src/vessels/<id>.json), resolved once per page or node process. Plain JS, no DOM.
//   import { CURRENT_VESSEL } from './vessels/current.js';   .spec, .hull, .rig, .physics, .engine, .polar, .models …
// The choice: ?vessel=, else the one saved in this browser (the settings' 'vessel'), else the default (src/vessels/index.js
// chosenVessel). A choice on the home card reloads the page with ?vessel= (src/shell.js), so one page holds one boat.
// node: globalThis.__lakeshoreVessel, a whole profile object, wins (the tests' second boat: tests/profiles.test.mjs).
// The dimensions come from it through src/boat/dims.js vesselDims(vessel), the physics through src/boat.js
// boatParams(vessel), the models and sockets through src/sail/assemble.js (assembleBoat(core, start, { vessel })).
import { chosenVessel, vesselById } from './index.js';
import { FLAGS } from '../core/flags.js';
import { SETTINGS_KEY } from '../settingsKey.js';   // the saved settings' key (src/ui/settings.js)

const g = globalThis;

function saved() {
  if (typeof g.document === 'undefined') return null;   // node and workers: no saved choice (node's localStorage warns)
  try { return JSON.parse(g.localStorage?.getItem(SETTINGS_KEY) ?? 'null')?.vessel ?? null; } catch { return null; }
}

function resolveVessel() {
  if (g.__lakeshoreVessel && typeof g.__lakeshoreVessel === 'object') return g.__lakeshoreVessel;
  return vesselById(chosenVessel(FLAGS, saved()));
}

export const CURRENT_VESSEL = resolveVessel();
