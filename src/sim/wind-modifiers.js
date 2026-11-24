// The wind field's modifiers (refactor Phase 2 step 4): what changes the one
// wind field (src/wind.js) on top of its day, gusts, shifts and terrain, as a list run in a fixed order. Plain JS.
//
// Each modifier is driven by the field's own plain-data state, so the water's wind worker (src/wind-texture.js
// windState / applyWindState) runs the same list with the same numbers. Two stages, in the field's order:
//   'gust'  a factor on the raw gust, before the gust cap (WindField.gustRaw; toTexture: one value a texel)
//             at(field, x, z, t, adv) → factor;  raster(field, T, sizePx, cellM, t, adv) → the factor per texel of T
//   'flow'  the wind vector after the terrain (WindField.sample; toTexture: after every texel's speed)
//             frame(field, t) → (vx, vz, x, z, out) → out, the new [vx, vz] written into out (no allocation a sample)
// key: the field's property holding its state (plain data, or null: off); windState carries it to the worker.
// on(field): whether it acts now. Off, the field's numbers are what they were without it, bit for bit.
//
//   field.modifiers                      // WIND_MODIFIERS: the gust cells, then the storm's outflow
// More weather adds a modifier here (a front, a sea breeze), driven by a plain-data state on the field.
import { cellFactor, cellRaster } from './wind-cells.js';
import { stormWindFrameInto, applyStormInto } from './weather/stormWind.js';

// gust cells (wow/gusts, src/wind-cells.js): puffs with a sharp leading edge, carried with the air; field.cells: their
// options or null. At the point itself, not on the gust grid: their leading edge stays sharp.
export const gustCells = Object.freeze({
  id: 'cells', key: 'cells', stage: 'gust',
  on: (f) => !!f.cells,
  at: (f, x, z, t, adv) => cellFactor(x, z, t, adv, f.base.dirDeg, f.seed, f.cells),
  raster: (f, T, sizePx, cellM, t, adv) => cellRaster(T.px, T.pz, sizePx, cellM, t, adv, f.base.dirDeg, f.seed, f.cells, T.cells ??= new Float64Array(T.px.length)),
});

// the afternoon thunderstorm's outflow (wow/storm, src/weather/stormWind.js); field.storm: its state or null. The
// frame's part is made once per (state, t) and kept on the field, so sample() allocates nothing per point.
const STORM_POINT = Symbol('storm point');
export const stormOutflow = Object.freeze({
  id: 'storm', key: 'storm', stage: 'flow',
  on: (f) => !!f.storm,
  frame(f, t) {
    const st = f.storm, k = f[STORM_POINT];
    if (k && k.state === st && k.t === t && k.s0 === st.s0 && k.t0 === st.t0 && k.rate === st.rate) return k.fn;
    const at = stormWindFrameInto(st, t), o = { gain: 1, fromDeg: 0, w: 0 };
    const fn = (vx, vz, x, z, out) => applyStormInto(vx, vz, at(x, z, o), out);
    f[STORM_POINT] = { state: st, t, s0: st.s0, t0: st.t0, rate: st.rate, fn };
    return fn;
  },
});

export const WIND_MODIFIERS = Object.freeze([gustCells, stormOutflow]);
