// v2's plug-in list (refactor round 3, Phase C step C2): one contract for the living lake's features and one runner, so boot()
// wires a feature once (its row in the list) instead of at each create, prime, step, fill, draw, stats and hook site. The list
// keeps boot()'s order exactly: ORDER (living/lakePlugins.js) names, per anchor, the ids in the order boot() called them before the
// move; an anchor is one call site in boot() (a draw slot between two hand-wired draws, a fill, the step, a prime stage).
//
// A plug-in (a plain object; living/lakePlugins.js holds the lake's):
//   id        its name: the key in ORDER, plugins.get(id), its stats and hook keys
//   on(ctx)   the switch: its policy or feature row (src/core/features.js), a flag; false → nothing made, no anchor runs, its
//             stats and hook give their "off" value (stats(null), hook(null))
//   group     its pipeline group (engine/pipelines.js PIPE_ORDER): create runs inside ctx.inGroup(group)
//   load(ctx) optional, async: the chunk(s) create needs (dynamic imports); awaited only when the plug-in is on
//   fetch(feature) optional: its chunk's import() started early in boot() (fetchChunks: ctx.chunks[id]), null where its policy is off;
//             its load() then awaits ctx.chunks[id] (the fireworks: fetched at the device's start, made after Tessie)
//   create(ctx, mods) → the instance (null: off, e.g. its own ?flag=0)
//   at        { [anchor]: (inst, ctx, ...args) => any }: what it does at each anchor (step, fill, a draw slot, attach, lights …)
//   prime     { stage, paths: ['capture' | 'filmui' | 'live'], run(inst, ctx, ...args) }: its data in before the first frame; the
//             three boot paths read one ordered list (ORDER['prime.<stage>']) and each plug-in says which paths prime it
//   an anchor's hook may also answer: plugins.some(anchor) (any on plug-in says true: the depth kept, Regatta's salute),
//             plugins.first(anchor) (the first answer not null: the show's start, its clock), plugins.runs(anchor) (one is on there)
//   stats(inst | null, ctx) → { key: value } (merged into hook._stats at its 'stats.<x>' anchor)
//   hook(inst | null, ctx)  → { key: value } (merged into window.__velia)
//   dispose   the instance's own dispose(), if it has one (the list calls it, last made first)
// ctx: the shared bag boot() builds once (device, reg, the frame layouts, flags, P, feature, inGroup, terrain, water …, and getters
// for what boot() makes later: B, regatta, eye, clock …) plus ctx.plugins (this list: one plug-in reads another's instance).

const PATHS = ['capture', 'filmui', 'live'];

// the list's own check: every id in ORDER is a plug-in, every plug-in's anchor is in ORDER under its id and the other way round
export function checkOrder(defs, order) {
  const byId = new Map(defs.map((d) => [d.id, d])), errs = [];
  if (byId.size !== defs.length) errs.push('duplicate plug-in id');
  const want = new Set();
  for (const d of defs) {
    if (typeof d.on !== 'function' || typeof d.create !== 'function') errs.push(`${d.id}: on and create are required`);
    if (!d.createAt) errs.push(`${d.id}: no createAt`);
    else want.add(`create.${d.createAt}|${d.id}`);
    for (const a of Object.keys(d.at ?? {})) want.add(`${a}|${d.id}`);
    if (d.prime) { want.add(`prime.${d.prime.stage}|${d.id}`); for (const p of d.prime.paths) if (!PATHS.includes(p)) errs.push(`${d.id}: prime path ${p}`); }
    if (d.statsAt) want.add(`stats.${d.statsAt}|${d.id}`);
  }
  const have = new Set();
  for (const [a, ids] of Object.entries(order)) for (const id of ids) {
    if (!byId.has(id)) errs.push(`ORDER ${a}: unknown ${id}`);
    if (have.has(`${a}|${id}`)) errs.push(`ORDER ${a}: ${id} twice`);
    have.add(`${a}|${id}`);
  }
  for (const k of want) if (!have.has(k)) errs.push(`ORDER misses ${k.replace('|', ': ')}`);
  for (const k of have) if (!want.has(k)) errs.push(`ORDER has ${k.replace('|', ': ')} but the plug-in has no such anchor`);
  return errs;
}

// the chunks of the plug-ins that fetch their own (fetch(feature)), started at once: { [id]: Promise | null }
export function fetchChunks(defs, feature) {
  const out = {};
  for (const d of defs) if (d.fetch) out[d.id] = d.fetch(feature) ?? null;
  return out;
}

export function createPluginList(defs, order, ctx) {
  const errs = checkOrder(defs, order);
  if (errs.length) throw new Error(`plug-in list: ${errs.join('; ')}`);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const inst = new Map(), made = [];
  const ids = (a) => order[a] ?? [];
  const make = (d, mods) => {
    const go = () => d.create(ctx, mods);
    const i = d.group ? ctx.inGroup(d.group, go) : go();
    if (i != null) { inst.set(d.id, i); made.push(d.id); }
  };
  const list = {
    // create(anchor): the plug-ins made at this anchor, in ORDER; a promise only when an on plug-in has a load() (boot awaits
    // it then, as it awaited the chunk before the move), else undefined (no extra await: the boot's ticks unchanged)
    create(anchor) {
      const todo = ids(`create.${anchor}`).map((id) => byId.get(id)).filter((d) => d.on(ctx));
      if (!todo.some((d) => d.load)) { for (const d of todo) make(d); return undefined; }
      return (async () => { for (const d of todo) make(d, d.load ? await d.load(ctx) : undefined); })();
    },
    // run(anchor, ...args): each on plug-in's at[anchor](inst, ctx, ...args), in ORDER
    run(anchor, ...args) { for (const id of ids(anchor)) { const i = inst.get(id); if (i) byId.get(id).at[anchor](i, ctx, ...args); } },
    // reduce(anchor, acc, ...args): acc = at[anchor](inst, ctx, acc, ...args) through the on plug-ins (the night's lit records)
    reduce(anchor, acc, ...args) { for (const id of ids(anchor)) { const i = inst.get(id); if (i) acc = byId.get(id).at[anchor](i, ctx, acc, ...args); } return acc; },
    // some(anchor, ...args): every on plug-in asked (each runs: an event fans out to all), true when any said a truthy value
    some(anchor, ...args) { let any = false; for (const id of ids(anchor)) { const i = inst.get(id); if (i && byId.get(id).at[anchor](i, ctx, ...args)) any = true; } return any; },
    // first(anchor, ...args): the first on plug-in's answer that is not null (in ORDER), else null
    first(anchor, ...args) { for (const id of ids(anchor)) { const i = inst.get(id); if (i) { const v = byId.get(id).at[anchor](i, ctx, ...args); if (v != null) return v; } } return null; },
    // runs(anchor): an on plug-in has a hook at this anchor
    runs(anchor) { return ids(anchor).some((id) => inst.has(id)); },
    // prime(stage, path, ...args): the on plug-ins primed on this path at this stage, one after another (each awaited)
    async prime(stage, path, ...args) {
      for (const id of ids(`prime.${stage}`)) {
        const i = inst.get(id), d = byId.get(id);
        if (i && d.prime.paths.includes(path)) await d.prime.run(i, ctx, ...args);
      }
    },
    // the order a prime stage runs on a path (the tests: the three paths read one list)
    primeOrder(stage, path) { return ids(`prime.${stage}`).filter((id) => byId.get(id).prime.paths.includes(path)); },
    stats(anchor) { const o = {}; for (const id of ids(`stats.${anchor}`)) Object.assign(o, byId.get(id).stats(inst.get(id) ?? null, ctx)); return o; },
    hooks() { const o = {}; for (const d of defs) if (d.hook) Object.assign(o, d.hook(inst.get(d.id) ?? null, ctx)); return o; },
    get: (id) => inst.get(id) ?? null,
    has: (id) => inst.has(id),
    get on() { return made.slice(); },
    dispose() { for (const id of made.slice().reverse()) inst.get(id)?.dispose?.(); inst.clear(); made.length = 0; },
  };
  ctx.plugins = list;
  return list;
}
