// The lake this page sails (refactor Phase 2 step 6): the chosen lake's whole
// profile (src/waters/<id>.json), resolved once per page, worker or node process. Plain JS, no DOM.
//   import { CURRENT_WATERS } from './waters/current.js';   CURRENT_WATERS.id, .start, .terrain.full, .goal.text …
// The choice: ?waters=, else the one saved in this browser (the settings' 'waters'), else the default (src/waters/index.js
// chosenWaters). A choice on the home card reloads the page with ?waters= (src/shell.js), so one page holds one lake.
// A worker has no URL flags or storage: the page names it '<variant> <waters id>' (src/terrain-data.js workerName).
// node: globalThis.__lakeshoreWaters, a whole profile object, wins (the tests' second lake: tests/profiles.test.mjs).
// Everything that differs by lake reads it from here, from the terrain object (makeTerrain: lake, landmarks, season,
// place) or from the world (createWorld({ waters })); nothing else imports Tahoe's numbers.
import { chosenWaters, watersById, watersReady } from './index.js';
import { FLAGS } from '../core/flags.js';
import { SETTINGS_KEY } from '../settingsKey.js';   // the saved settings' key (src/ui/settings.js)

const g = globalThis;
const isWorker = typeof g.WorkerGlobalScope !== 'undefined' && g instanceof g.WorkerGlobalScope;

function saved() {
  if (typeof g.document === 'undefined') return null;   // node and workers: no saved choice (node's localStorage warns)
  try { return JSON.parse(g.localStorage?.getItem(SETTINGS_KEY) ?? 'null')?.waters ?? null; } catch { return null; }
}

function resolveWaters() {
  if (g.__lakeshoreWaters && typeof g.__lakeshoreWaters === 'object') return g.__lakeshoreWaters;
  if (isWorker) return watersById(watersReady(String(g.name ?? '').split(' ')[1]) ?? chosenWaters(''));
  return watersById(chosenWaters(FLAGS, saved()));
}

export const CURRENT_WATERS = resolveWaters();
