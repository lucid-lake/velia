// v2's mode table (refactor round 3, Phase C step C1): one row per mode v2 plays. The names, labels, aliases, card looks and the
// home card's order are src/modes/rows.js's (the one list v1, v2 and tools/loading_shell.py share); this file adds what v2 needs
// to play a mode. Everything that lists or tells the modes apart reads it: ui/modeSwitch.js (enter, leave, clock, Pro, speed),
// ui/frontPlan.js and ui/front.js (the picks v2 plays), engine/buildGate.js and main.js's PIPE_ORDER (the mode's pipeline
// groups), sim/knockdownGame.js and main.js (the knockdown's end), sim/tessieSwap.js and living/tessiePlayer.js (a race),
// main.js (the mode a URL opens in). A new mode is one row here plus its folder (v2/README.md § The mode table).
//   id         src/modes/rows.js's id (label, aliases, card, order come from there; a new id needs a row there too)
//   chunk      () → the mode's chunk (a dynamic import: its own chunk); null for Sail (the page itself)
//   enter(k, ctx) / leave(k, to)   the switch's hooks on the mode's controller k (from the page's loader); ctx { load, get, ready,
//              wasRace, pose(), opts }; leave(k, to) runs when another mode is picked and k is loaded (to: that row); needsBoat:
//              entered only on a page with a boat
//   clock      the day clock it runs: 'sail' (Sail's schedule), 'race' (real time: ui/modeSwitch.js raceClock), 'own' (the mode sets it)
//   pro        true: Pro from the setting on entering (ui/modeSwitch.js proWanted)
//   race       true: a race (left before any other mode starts; no Tessie swap; no Sail ⇄ Cruise button)
//   swap       true: the top bar's in-place Sail ⇄ Cruise partner (ui/modeSwitch.js swap, backquote)
//   home       true: where a left race or mode returns (Sail)
//   pipes      the pipeline groups only this mode needs (engine/buildGate.js PHONE_ORDER, main.js PIPE_ORDER; built behind the card)
//   knockdown  the knockdown's end: 'logbook' (the end card), 'race' (the race's results card, full time under it), null (none)
//   dials      true: the chart and wind dials show as their 2D modules (ui/dials.js); false: none (Cruise's passenger view)
import { MODE_NAMES } from '../../src/modes/rows.js';
import { CRUISE_SWITCH } from '../cruise/plan.js';
import { REGATTA_SWITCH } from '../regatta/plan.js';

const ROWS = [
  { id: 'sail', chunk: null, clock: 'sail', pro: true, home: true, pipes: [], knockdown: 'logbook', dials: true },
  { id: 'cruise', chunk: () => import('../cruise/index.js'), ...CRUISE_SWITCH, clock: 'own', pro: false, swap: true, pipes: [], knockdown: null, dials: false },
  { id: 'regatta', chunk: () => import('../regatta/index.js'), ...REGATTA_SWITCH, clock: 'race', pro: true, race: true, pipes: ['regatta'], knockdown: 'race', dials: true },
];
const KEYS = new Set(['id', 'label', 'aliases', 'card', 'order', 'dev', 'chunk', 'enter', 'leave', 'needsBoat', 'clock', 'pro', 'race', 'swap', 'home', 'pipes', 'knockdown', 'dials']);
const CLOCKS = ['sail', 'race', 'own'], KNOCKS = ['logbook', 'race', null];

// throws on a malformed row (an unknown key, clock or knockdown; a chunk with no enter hook; a duplicate id)
export function checkMode(r, rows = MODES) {
  const where = `v2 mode row ${JSON.stringify(r?.id)}`;
  if (!r || typeof r.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(r.id)) throw new Error(`${where}: id must be a lower-case word`);
  for (const k of Object.keys(r)) if (!KEYS.has(k)) throw new Error(`${where}: unknown key '${k}'`);
  if (rows.some((x) => x !== r && x.id === r.id)) throw new Error(`${where}: duplicate id`);
  if (!CLOCKS.includes(r.clock)) throw new Error(`${where}: clock must be one of ${CLOCKS.join(', ')}`);
  if (!KNOCKS.includes(r.knockdown)) throw new Error(`${where}: knockdown must be 'logbook', 'race' or null`);
  if (!Array.isArray(r.pipes)) throw new Error(`${where}: pipes must be a list`);
  if (r.chunk != null && (typeof r.chunk !== 'function' || typeof r.enter !== 'function')) throw new Error(`${where}: a chunk needs an enter hook`);
  return r;
}
const join = (r) => ({ label: r.id, aliases: [], card: 'sail', ...(MODE_NAMES.find((n) => n.id === r.id) ?? {}), ...r });
const MODES = [];
for (const r of ROWS) { const j = join(r); MODES.push(checkMode(j, [...MODES, j])); }

// a new row at run time (a test's fake mode; a later mode adds its row to ROWS above instead): the readers list it, unedited
export function addMode(row) { const r = join(row); checkMode(r, [...MODES, r]); MODES.push(r); return r; }

export const modeRows = () => MODES;
export const playedIds = () => MODES.map((r) => r.id);
export const modeRow = (id) => MODES.find((r) => r.id === id) ?? null;
export const isPlayed = (id) => !!modeRow(id);
export const isRace = (id) => !!modeRow(id)?.race;
export const showsDials = (id) => modeRow(id)?.dials === true;   // the dials' modules in this mode (ui/dials.js)
export const homeId = () => MODES.find((r) => r.home).id;
export const swapRow = () => MODES.find((r) => r.swap) ?? null;
export const chunkRows = () => MODES.filter((r) => r.chunk);
// the pipeline groups the modes add, in row order (each list keeps its place for them: after 'storm')
export const modePipes = () => MODES.flatMap((r) => r.pipes);
// the knockdown's end in a mode; a name the table lacks ends as Sail does
export const knockOf = (id) => { const r = modeRow(id); return r ? r.knockdown : 'logbook'; };
// the mode a URL opens in: ?mode= names a row (or one of its aliases), else Sail
export function bootMode(flags = {}) {
  const m = flags?.mode == null ? '' : String(flags.mode).toLowerCase();
  return (m && MODES.find((r) => r.id === m || r.aliases.includes(m))?.id) || homeId();
}
