// The waters registry: the lakes a player can choose, from src/waters/index.json and
// each lake's descriptor. The choice is the URL's ?waters=, else the one saved in this browser, else the default; an id
// that is unknown or not ready falls back to the default. Plain data, no DOM: the home card (src/ui/home.js) reads it
// and tools/loading_shell.py reads the same files.
import index from '../../waters/index.json' with { type: 'json' };
import tahoeEmerald from '../../waters/tahoe-emerald.json' with { type: 'json' };
import { FLAGS, toFlags } from '../core/flags.js';

const FILES = { 'tahoe-emerald.json': tahoeEmerald };   // a new lake: its file here and a line in index.json

export const WATERS = index.waters.map((w) => ({ ...FILES[w.file], id: w.id, ready: !!w.ready && !!FILES[w.file] }));
export const WATERS_SOON = index.soon;
export const DEFAULT_WATERS = index.default;

export function watersReady(v) {   // the id of a ready lake, or null
  const w = WATERS.find((x) => x.id === v);
  return w?.ready ? w.id : null;
}
export const watersById = (id) => WATERS.find((x) => x.id === id) ?? WATERS.find((x) => x.id === DEFAULT_WATERS);

// the chosen waters: ?waters=, else the saved one, else the default
export function chosenWaters(flags = FLAGS, saved = null) {   // flags: a flags object (or a query string: the tests)
  return watersReady(toFlags(flags).waters) ?? watersReady(saved) ?? DEFAULT_WATERS;
}
