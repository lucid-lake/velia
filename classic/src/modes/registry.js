// The mode registry (refactor round 2, Phase C step 1): one row per mode.
// Everything that lists modes reads it: src/main.js (the chunks), src/modeNames.js (labels, ?mode= aliases), src/ui/home.js
// (the card's picks), src/ui/loading.js (the card classes), src/ui/watchdog.js (the modes that sail), tools/loading_shell.py
// (the first paint's card class). What only names the modes reads its pure half, src/modes/rows.js (no mode code: Velia v2
// imports the home card through it). A new mode is one row in rows.js, its chunk in LOADS below, and its folder.
//   id       the ?mode= value and the 'mode' service's value
//   label    the public name (owner, 2026-10-29: Cruise, Sail, Regatta, School)
//   aliases  old ?mode= values that still work (lower case)
//   card     the loading card's and the dock's look ('sail' | 'cruise': html.lk-m-<card>); the mode's coreOptions().card agrees
//   order    the home card's pick order (no order: not a pick)
//   dev      a dev mode: no pick, the menu does not fetch it ahead (src/shell.js), the watchdog does not arm
//   load     the mode's chunk (a dynamic import, so each mode is its own chunk); null: planned, no folder yet
import { MODE_NAMES, CARDS } from '../../../src/modes/rows.js';

// each mode's chunk by id (no entry: planned, load null); a row is rows.js's row plus its load, in the same key order
const LOADS = {
  cruise: () => import('./chill/index.js'),
  sail: () => import('./daysail/index.js'),
  regatta: () => import('./regatta/index.js'),
  fly: () => import('./fly/index.js'),
};
export const MODE_ROWS = MODE_NAMES.map((r) => ({ ...r, load: LOADS[r.id] ?? null }));

export { CARDS };   // the card looks the pages know (src/modes/rows.js)
const KEYS = new Set(['id', 'label', 'aliases', 'card', 'order', 'dev', 'load']);

// Throws on a malformed table: a missing or duplicate id, an alias that names another mode, an unknown card or key, a load
// that is not a function, two picks with one order.
export function checkRows(rows) {
  const ids = new Set(), names = new Set(), orders = new Set();
  for (const r of rows) {
    const where = `mode row ${JSON.stringify(r?.id)}`;
    if (!r || typeof r.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(r.id)) throw new Error(`${where}: id must be a lower-case word`);
    for (const k of Object.keys(r)) if (!KEYS.has(k)) throw new Error(`${where}: unknown key '${k}'`);
    if (ids.has(r.id)) throw new Error(`${where}: duplicate id`);
    ids.add(r.id);
    if (typeof r.label !== 'string' || !r.label) throw new Error(`${where}: no label`);
    if (!Array.isArray(r.aliases)) throw new Error(`${where}: aliases must be a list`);
    if (!CARDS.includes(r.card)) throw new Error(`${where}: card '${r.card}' is not one of ${CARDS.join(', ')}`);
    if (r.load !== null && typeof r.load !== 'function') throw new Error(`${where}: load must be a function or null`);
    if (r.order != null) {
      if (!Number.isFinite(r.order)) throw new Error(`${where}: order must be a number`);
      if (r.dev || !r.load) throw new Error(`${where}: a pick needs a chunk and no dev flag`);
      if (orders.has(r.order)) throw new Error(`${where}: order ${r.order} is taken`);
      orders.add(r.order);
    }
  }
  for (const r of rows) for (const a of r.aliases) {
    if (a !== a.toLowerCase() || ids.has(a) || names.has(a)) throw new Error(`mode row "${r.id}": alias '${a}' is upper case, an id or another row's alias`);
    names.add(a);
  }
  return rows;
}
checkRows(MODE_ROWS);

export const modeRow = (id) => MODE_ROWS.find((r) => r.id === id) ?? null;
// the home card's picks, in order: [{ id, label }]
export const pickRows = () => MODE_ROWS.filter((r) => r.order != null).sort((a, b) => a.order - b.order);
// a mode where the player sails a boat (not dev, has a chunk): the watchdog arms there
export const isPlayMode = (id) => { const r = modeRow(id); return !!r && !!r.load && !r.dev; };
// { id: () => Promise<module> } for each mode with a chunk, a dev mode's loader marked .dev; wrap: e.g. importRetry
export function modeLoaders(wrap = (load) => load()) {
  return Object.fromEntries(MODE_ROWS.filter((r) => r.load).map((r) => {
    const f = () => wrap(r.load);
    return [r.id, r.dev ? Object.assign(f, { dev: true }) : f];
  }));
}
