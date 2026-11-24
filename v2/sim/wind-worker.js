// The water's wind texture off the main thread (audit W1, sim/windTex.js; v1's src/wind-worker.js): its own WindField on a
// copy of the terrain's height grids (v2/terrain/sample.js createHeightField, the same codes the page holds), set each
// request to the page's state at the frame's time (v1's applyWindState), filled with v1's fillWindTexture.
//   { type: 'init', seed, H }   { type: 'slot', k, grid, codes }   { type: 'req', key, state, cx, cz } → { key, cx, cz, wind, mean }
//   { type: 'return', wind, mean }: the page hands a result's buffers back for reuse
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { applyWindState, fillWindTexture, newWindBuffers } from '../../src/sim/wind-texture.js';
import { createHeightField } from '../terrain/sample.js';

let field = null, hf = null;
const pool = [];
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      hf = createHeightField(data.H ?? undefined);
      field = new WindField({ seed: data.seed, bay: CURRENT_WATERS.windBay });
      field.setTerrain((x, z) => hf.height(x, z));
    } else if (data.type === 'slot') {
      hf.setSlot(data.k, data.grid, data.codes);
      field.setTerrain((x, z) => hf.height(x, z));   // the terrain caches start again on the finer grid
    } else if (data.type === 'return') {
      pool.push(data);
    } else if (data.type === 'req') {
      applyWindState(field, data.state);
      const b = newWindBuffers();
      const back = pool.pop();
      if (back) { b.wind = back.wind; b.mean = back.mean; }
      const out = fillWindTexture(field, data.state.t, data.cx, data.cz, b);
      self.postMessage({ key: data.key, cx: data.cx, cz: data.cz, wind: out.wind, mean: out.mean }, [out.wind.buffer, out.mean.buffer]);
    }
  } catch (e) {
    self.postMessage({ key: data.key, error: String(e?.stack ?? e) });
  }
};
