// The features list (refactor round 2, Phase C step 3, K8): the things a
// mode or the core adds to the lake (the fireworks, the racing marks, the kayak fleet, the kayak demo stage), one row each.
// They attach in one loop (attachFeatures), and the menus' rows they contribute come from here: the clock menu's Fireworks row
// (src/ui/timeMenu.js), the Setup rows (src/ui/homePages.js: 'camera to kayaks', the boat's radio).
// Light on purpose: no static import of a feature's code (each row loads its own with import()), so the core and the shell
// can read the list without the features' bytes. The core imports this file with import().
//   const F = await attachFeatures(core, player, { scope: 'mode', mode: 'sail', ctx: { sail, controls } });
//   F.get('marks')   F.ids   F.update(dt, …)   F.dispose()
// A row:
//   id        the name (and the services name some of them provide: 'fireworks', 'kayaks')
//   scope     'core': the core attaches it after the mode's start (src/core/index.js; ctx: { fireworksOn, options, systems },
//             systems the frame's registry); 'mode': a mode's start does
//   modes     (scope 'mode') the mode ids that have it (src/modes/registry.js)
//   on        (core, ctx) → bool: attach on this page (absent: always)
//   load      () → Promise<module>: the feature's code (a dynamic import: its own chunk)
//   attach    (mod, core, player, ctx) → api | Promise<api>: { update?(dt, …), dispose?() }; null: nothing to run
//   settings  [{ tab, key, label, radio: [[value, word], …] } | { tab, toggleIn, key, label }] Setup rows (homePages.js)
//   shown     (flags) → bool: its Setup rows show on this page
//             (settings and shown live in src/features/setup.js, the pure half the home card reads; a row spreads its entry)
//   timeRows  [{ id, name, lit(phase) → bool, pick(ctx) → what it did }] the clock menu's rows after the hours (timeMenu.js)
import { kayaksOn } from '../../../src/sim/kayaks/on.js';
import { FEATURE_SETUP } from '../../../src/features/setup.js';
import { FEATURE_TIME_ROWS, SHOW_START_HOUR, FIREWORKS_LEAD_H } from '../../../src/features/timeRows.js';

export { SHOW_START_HOUR, FIREWORKS_LEAD_H };   // the show's clock and the menu's lead (their one source: src/features/timeRows.js, the clock menu's pure half)

const SCOPES = ['core', 'mode'];
const KEYS = new Set(['id', 'scope', 'modes', 'on', 'load', 'attach', 'settings', 'shown', 'timeRows']);

export const FEATURES = [
  // the racing marks (feat/marks, src/marks/scene.js): Sail's practice courses, Regatta's race course
  { id: 'marks', scope: 'mode', modes: ['sail', 'regatta'],
    load: () => import('../marks/scene.js'),
    attach: (m, core, player, ctx) => m.attachMarks(core, ctx.sail, { controls: ctx.controls ?? null }) },
  // ?kayak=: the kayak's demo stage (feat/kayak, src/props/kayak/stage.js); without the flag nothing is loaded
  { id: 'kayakStage', scope: 'mode', modes: ['sail'], on: (core) => !!core.flags.kayak,
    load: () => import('../props/kayak/stage.js'),
    attach: (m, core, player) => m.attachKayakStage(core, player) },
  // the kayaks on the lake (feat/kayaks-lake, src/kayaks/fleet.js; on by default since 2026-11-08): ?kayaks=0 loads
  // nothing. Cruise's fleet has no camera notice (ctx.kayakFleet: { notice: false })
  { id: 'kayakFleet', scope: 'mode', modes: ['sail', 'cruise'], on: (core) => kayaksOn(core.flags.kayaks),
    load: () => import('../kayaks/fleet.js'),
    attach: (m, core, player, ctx) => (ctx.kayakFleet ? m.attachKayakFleet(core, player, ctx.kayakFleet) : m.attachKayakFleet(core, player)),
    ...FEATURE_SETUP.kayakFleet },   // shown, settings: 'camera to kayaks' with the kayaks on (src/features/setup.js)
  // the fireworks in the world (src/fireworks/world.js): after the mode (it reads the player for the camera), a frame system;
  // a mode with its own show (demos/fireworks.js: coreOptions ownFireworks) keeps the twilight and the post stage but not a
  // second show (realism round: since S5's default-on the demo drew the game's show too, a frozen burst in every still)
  { id: 'fireworks', scope: 'core', on: (core, ctx) => !!ctx.fireworksOn && !ctx.options?.ownFireworks,
    load: () => import('../fireworks/world.js'),
    attach: async (m, core, player, ctx) => {
      const fwWorld = await m.attachFireworks(core);
      ctx.systems.add({ id: 'fireworks', phase: 'scene', update: () => fwWorld.frame() });
      return null;   // a frame system, not a mode's update
    },
    ...FEATURE_SETUP.fireworks,   // shown, settings: the boat's radio on the fireworks evening (src/features/setup.js)
    timeRows: FEATURE_TIME_ROWS.fireworks },   // the clock menu's Fireworks row (src/features/timeRows.js, the pure half timeMenu.js reads)
  // the bench's baseline (?fwlook= on a headless page, no show): the same tilted follow camera
  { id: 'fireworksLook', scope: 'core', on: ({ flags, headless }, ctx) => !(ctx.fireworksOn && !ctx.options?.ownFireworks) && flags.fwlook != null && !!headless,
    load: () => import('../fireworks/world.js'),
    attach: (m, core, player, ctx) => { ctx.systems.add({ id: 'fireworks-look', phase: 'scene', update: m.followLook(core) }); return null; } },
];

// Throws on a malformed list: a missing or duplicate id, an unknown key or scope, a mode-scope row with no modes, a load or an
// attach that is not a function, a Setup row with no key or tab, a clock row with no pick.
export function checkFeatures(list) {
  const ids = new Set(), times = new Set();
  for (const f of list) {
    const where = `feature ${JSON.stringify(f?.id)}`;
    if (!f || typeof f.id !== 'string' || !f.id) throw new Error(`${where}: no id`);
    for (const k of Object.keys(f)) if (!KEYS.has(k)) throw new Error(`${where}: unknown key '${k}'`);
    if (ids.has(f.id)) throw new Error(`${where}: duplicate id`);
    ids.add(f.id);
    if (!SCOPES.includes(f.scope)) throw new Error(`${where}: scope '${f.scope}' is not one of ${SCOPES.join(', ')}`);
    if (f.scope === 'mode' && (!Array.isArray(f.modes) || !f.modes.length)) throw new Error(`${where}: a mode feature names its modes`);
    for (const k of ['load', 'attach']) if (typeof f[k] !== 'function') throw new Error(`${where}: ${k} must be a function`);
    for (const k of ['on', 'shown']) if (f[k] != null && typeof f[k] !== 'function') throw new Error(`${where}: ${k} must be a function`);
    for (const s of f.settings ?? []) {
      if (!s.key || !s.label || !s.tab) throw new Error(`${where}: a Setup row needs a tab, a key and a label`);
      if (!s.toggleIn && !(Array.isArray(s.radio) && s.radio.length)) throw new Error(`${where}: Setup row '${s.key}': radio options or toggleIn`);
    }
    for (const r of f.timeRows ?? []) {
      if (!r.id || !r.name || typeof r.pick !== 'function' || typeof r.lit !== 'function') throw new Error(`${where}: a clock row needs an id, a name, lit() and pick()`);
      if (times.has(r.id)) throw new Error(`${where}: clock row '${r.id}' twice`);
      times.add(r.id);
    }
  }
  return list;
}
checkFeatures(FEATURES);

// the rows that attach here: a scope (and, for 'mode', the mode's id), on this page
export function featuresFor(core, { scope, mode = null, ctx = {}, list = FEATURES } = {}) {
  return list.filter((f) => f.scope === scope && (scope !== 'mode' || f.modes.includes(mode)) && (!f.on || f.on(core, ctx)));
}

// start fetching their code now (a mode calls it before its boat is assembled: the kayaks' code was ≈ 12 s at Slow 4G)
export function prefetchFeatures(core, opts) {
  for (const f of featuresFor(core, opts)) f.load().catch(() => {});
}

// Attach the rows in list order, one after the other (each may await its models). → { ids, get(id), update(…a), dispose() }:
// update runs each api's update in list order with the caller's arguments; dispose in reverse order.
export async function attachFeatures(core, player, opts = {}) {
  const on = [];
  for (const f of featuresFor(core, opts)) {
    const api = await f.attach(await f.load(), core, player, opts.ctx ?? {});
    on.push([f.id, api ?? null]);
  }
  return {
    ids: on.map(([id]) => id),
    get: (id) => on.find(([k]) => k === id)?.[1] ?? null,
    update(...a) { for (const [, api] of on) api?.update?.(...a); },
    dispose() { for (const [, api] of [...on].reverse()) api?.dispose?.(); on.length = 0; },
  };
}

// the Setup rows the features contribute on this page (src/ui/homePages.js pagesHtml rows)
export const featureSettings = (flags, list = FEATURES) => list.filter((f) => f.settings && (!f.shown || f.shown(flags))).flatMap((f) => f.settings);
// the clock menu's rows after the hours (src/ui/timeMenu.js)
export const featureTimeRows = (list = FEATURES) => list.flatMap((f) => f.timeRows ?? []);
