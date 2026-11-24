// The phone's build gate (owner, 2026-11-17: "For phones, the best experience is to build the shaders, then present. Build it that
// way, and while loading show more info on the phone to hold the user"; src/core/features.js buildAllFirst). A phone builds every
// pipeline the modes need behind the home card, one group at a time (PHONE_ORDER), while the lake draws beside the card; Sail,
// Cruise and Regatta start only once the gate is open, so nothing compiles in play. The gate also waits for the first view's
// assets (the lake's whole grids and the boat's models, the forest, the towns): the card's percentage counts both, one item each
// pipeline and one each asset, so 100 % is the moment the modes light. Pure: main.js feeds it, the card (ui/buildCard.js) reads it.
//   buildGate.configure({ on: true });   buildGate.update({ built, total, group, assets: { lake, forest, towns } });
//   buildGate.percent  buildGate.stage ('lake' | 'forest' | 'boat' | 'sails' | 'ready')  buildGate.words  buildGate.ready
//   buildGate.enabled   buildGate.on(fn) → off   (every change; fn(state))   buildGate.whenReady() → Promise
// Off (a tablet, a desktop, a capture): ready at once, nothing to show (the modes start as before).
import { modePipes } from './modes.js';   // each mode's own pipeline groups (the mode table), after 'storm'

// the groups in the order a phone builds them after the first frame: the lake's other water first, then the shore's forest and
// towns, the boat, then what waits for an evening, a storm or a race (main.js PIPE_ORDER is a tablet's and a desktop's)
export const PHONE_ORDER = Object.freeze(['water-alt', 'forest', 'rocks', 'ground', 'towns', 'shore', 'boatModels', 'boatDetail', 'boatfx', 'post', 'kayaks', 'birds', 'probes', 'night', 'storm', ...modePipes(), 'sweep', 'tessie', 'under', 'fireworks']);   // tessieUnder: play as Tessie's under-water twins (never declared on a phone: an empty group)
// the stage a group's build belongs to (the card's stage line says what the phone is doing now)
const STAGE_OF = { core: 'lake', 'water-alt': 'lake', forest: 'forest', rocks: 'forest', ground: 'forest', towns: 'forest', shore: 'forest', boatModels: 'boat', boatDetail: 'boat', boatfx: 'boat' };
export const stageOfGroup = (g) => (g == null ? 'lake' : STAGE_OF[g] ?? 'sails');
export const STAGES = Object.freeze(['lake', 'forest', 'boat', 'sails', 'ready']);
export const STAGE_WORDS = Object.freeze({ lake: 'Filling the lake', forest: 'Raising the forest', boat: 'Rigging the boat', sails: 'Setting the sails', ready: 'Ready' });
export const ASSETS = Object.freeze(['lake', 'forest', 'towns']);

export function createBuildGate() {
  const subs = new Set();
  let on = false, built = 0, total = 0, group = null, assets = {}, ready = true, readyAt = null, stage = 'ready', waits = [];
  const assetsDone = () => ASSETS.filter((k) => !!assets[k]).length;
  const emit = () => { const s = api.state(); for (const f of subs) { try { f(s); } catch (e) { console.error(e); } } };
  const open = (now) => { ready = true; stage = 'ready'; readyAt = now; const w = waits; waits = []; for (const r of w) r(true); };
  const api = {
    // on: the page's buildAllFirst; a gate configured off is open at once
    configure({ on: o = false } = {}) { on = !!o; built = 0; total = 0; group = null; assets = {}; readyAt = null; if (on) { ready = false; stage = 'lake'; } else open(null); emit(); return api; },
    // the page's numbers, once a frame while the gate is shut: built and total pipelines (at the active sample count), the
    // group building now (null: before the first frame, or none left), and the first view's assets landed
    update({ built: b = built, total: t = total, group: g = group, assets: a = assets } = {}, now = globalThis.performance?.now?.() ?? 0) {
      if (!on || ready) return false;
      const was = `${built}|${total}|${group}|${assetsDone()}`;
      built = b; total = t; group = g; assets = { ...a };
      const pipesDone = total > 0 && built >= total;
      stage = pipesDone ? 'sails' : stageOfGroup(group);
      if (pipesDone && assetsDone() === ASSETS.length) open(now);
      if (ready || was !== `${built}|${total}|${group}|${assetsDone()}`) emit();
      return ready;
    },
    get enabled() { return on; },   // the page's buildAllFirst
    get ready() { return ready; },
    get readyAt() { return readyAt; },
    get stage() { return stage; },
    get words() { return STAGE_WORDS[stage]; },
    // one honest percentage: pipelines and assets, one item each (never 100 before the gate opens)
    get percent() {
      if (ready) return 100;
      const n = total + ASSETS.length;
      return Math.min(99, Math.floor((100 * (built + assetsDone())) / n));
    },
    state() { return { on, ready, built, total, group, assets: { ...assets }, stage, words: STAGE_WORDS[stage], percent: api.percent, readyAt }; },
    on(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); },
    whenReady() { return ready ? Promise.resolve(true) : new Promise((r) => waits.push(r)); },
  };
  return api;
}
// the page's gate (main.js configures it; ui/front.js and ui/buildCard.js read it)
export const buildGate = createBuildGate();
