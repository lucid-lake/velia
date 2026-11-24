// The vessels registry: the boats a player can choose, from src/vessels/index.json and
// each boat's plate. The choice is the URL's ?vessel=, else the one saved in this browser, else the default. Plain
// data, no DOM. Never a maker or a model on screen.
import index from '../../vessels/index.json' with { type: 'json' };
import halcyon from '../../vessels/halcyon.json' with { type: 'json' };
import { FLAGS, toFlags } from '../core/flags.js';

const FILES = { 'halcyon.json': halcyon };   // a new boat: its file here and a line in index.json

export const VESSELS = index.vessels.map((v) => ({ ...FILES[v.file], id: v.id, ready: !!v.ready && !!FILES[v.file] }));
export const VESSELS_SOON = index.soon;
export const DEFAULT_VESSEL = index.default;

function vesselReady(v) {   // the id of a ready vessel, or null
  const x = VESSELS.find((e) => e.id === v);
  return x?.ready ? x.id : null;
}
export const vesselById = (id) => VESSELS.find((x) => x.id === id) ?? VESSELS.find((x) => x.id === DEFAULT_VESSEL);

// the chosen vessel: ?vessel=, else the saved one, else the default
export function chosenVessel(flags = FLAGS, saved = null) {   // flags: a flags object (or a query string: the tests)
  return vesselReady(toFlags(flags).vessel) ?? vesselReady(saved) ?? DEFAULT_VESSEL;
}
