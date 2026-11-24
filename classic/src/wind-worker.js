// The water's wind texture, filled off the main thread (src/wind-texture.js): one dedicated worker,
// its own WindField on the real terrain, set each request to the page's state at the frame's time.
import { WindField } from '../../src/sim/wind.js';
import { acceptFiles } from '../../src/sim/terrain-data.js';
import { applyWindState, fillWindTexture, newWindBuffers } from '../../src/sim/wind-texture.js';

let field = null, makeTerrain = null;
self.onmessage = async ({ data }) => {
  if (acceptFiles(data)) return;   // a phone's page posts its grid bytes first (src/terrain-data.js primeWorker)
  const { key, seed, state, cx, cz } = data;
  try {
    if (!field) {
      ({ makeTerrain } = await import('../../src/sim/terrain.js'));
      field = new WindField({ seed });
      field.setTerrain(makeTerrain({ seed }).heightAt);
    }
    applyWindState(field, state);
    const out = fillWindTexture(field, state.t, cx, cz, newWindBuffers());
    self.postMessage({ key, cx, cz, wind: out.wind, mean: out.mean }, [out.wind.buffer, out.mean.buffer]);
  } catch (e) {
    self.postMessage({ key, error: String(e?.stack ?? e) });
  }
};
