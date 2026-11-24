// The water's feature modules (refactor Phase 2 step 4): what the shared
// water shader (src/water.js) draws on top of its waves, as a list folded into fixed slots in a fixed order. The water
// knows the slots, not the features: the gust look, the storm's rain, the birds' marks and the clear lake bed each live
// in their own module and fill the slots they need.
//
//   const water = createWater({ features: [gustWater(), weather.water(), birdMarks(), clarityWater(clarity)] });
//
// The slots, in the order the shader meets them; each stage is (value, c) → value, run feature by feature in list order
// (the value one feature returns is the next one's input). c: the water's shared nodes at that point (water.js fx).
//   slope   weight(w, c)     the gust look's weight (0–1) at a pixel, from the wind texture's gust ratio
//           fine(g, c)       a gain on the gust's fine ripples' slope (null in: the first feature's own gain)
//           add(acc, c)      the extra slope and roughness, { sx, sz, rough } (null in; addSlope sums them, then the
//                            water adds the sum to its own: the order of the sums is the shader's)
//   sky     mirror(sky, c)   the sky the surface mirrors (the probe's colour)
//           fres(k, c)       the gust look's Fresnel cut (a number: GUST_LOOK.fres in)
//           trace(r, c)      the roughness the screen-space reflection reads (√σ² in)
//   glint   sun(g, c)        the sun's glint before its roll-off (the light that reaches the surface)
//           after(g, c)      the glint after the roll-off (the facets that scatter it)
//   foam    add(f, c)        the foam cover 0–1
//   body    colour(b, c)     the water body's colour (the L1 bed and absorption in)
// A feature: { id, slope?: { weight?, fine?, add? }, sky?: { … }, glint?: { … }, foam?: { … }, body?: { … },
// update?(t, { sun }), api? } (update: once a frame, from water.update; api: what the feature offers the game, as
// water.features.get(id).api). No feature, no node: the shader is the plain water's.
const WATER_SLOTS = Object.freeze({
  slope: Object.freeze(['weight', 'fine', 'add']),
  sky: Object.freeze(['mirror', 'fres', 'trace']),
  glint: Object.freeze(['sun', 'after']),
  foam: Object.freeze(['add']),
  body: Object.freeze(['colour']),
});
const KEYS = new Set(['id', 'update', 'api', ...Object.keys(WATER_SLOTS)]);

export function waterFeatures(features = []) {
  const list = features.filter(Boolean);
  const ids = new Set();
  for (const f of list) {
    if (typeof f.id !== 'string') throw new TypeError('a water feature needs an id');
    if (ids.has(f.id)) throw new Error(`water feature ${f.id} is listed twice`);
    ids.add(f.id);
    for (const k of Object.keys(f)) {
      if (!KEYS.has(k)) throw new TypeError(`water feature ${f.id}: no slot "${k}" (slots: ${Object.keys(WATER_SLOTS).join(', ')})`);
      if (k === 'id' || k === 'update' || k === 'api') continue;
      for (const st of Object.keys(f[k])) if (!WATER_SLOTS[k].includes(st)) throw new TypeError(`water feature ${f.id}: slot ${k} has no stage "${st}" (${WATER_SLOTS[k].join(', ')})`);
    }
  }
  return {
    list,
    ids: () => list.map((f) => f.id),
    get: (id) => list.find((f) => f.id === id) ?? null,
    has: (slot, stage) => list.some((f) => typeof f[slot]?.[stage] === 'function'),
    // the slot's stage, folded over the features in order
    run(slot, stage, value, c) {
      let v = value;
      for (let i = 0; i < list.length; i++) { const fn = list[i][slot]?.[stage]; if (fn) v = fn(v, c); }
      return v;
    },
    update(t, o) { for (let i = 0; i < list.length; i++) list[i].update?.(t, o); },
  };
}

// slope.add's sum: the features' terms added in list order before the water adds them to its own
export const addSlope = (acc, r) => (acc ? { sx: acc.sx.add(r.sx), sz: acc.sz.add(r.sz), rough: acc.rough.add(r.rough) } : r);
