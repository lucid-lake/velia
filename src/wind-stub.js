// A stand-in for T1's WindField (src/wind.js) until it lands: the same constructor and methods, so src/water.js
// takes either. Gusts are a noise field advected downwind at the base speed, exactly (a gust patch keeps its shape
// and travels at the wind speed); no lee shadow, no direction shift yet. Deterministic for a seed.
// Direction: where the wind blows FROM, compass degrees (0 = north). World frame: x east, z south.
//
// One addition to the T1 contract: toTexture takes the time t (s), since the field moves. Texel (i, j) covers the
// point x = (i + 0.5)/size·extent − extent/2, z likewise (centred on the world origin), rows along z.
import { downwind } from './sim/water-spectrum.js';

function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  const value = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => (value(x, y) * 0.57 + value(x * 2.03 + 17.1, y * 2.03 + 3.7) * 0.29 + value(x * 4.1 + 5.3, y * 4.1 + 31.9) * 0.14);
}

export class WindStub {
  constructor({ seed = 1, base = { dirDeg: 315, speedMs: 6 }, gust = { strength: 0.35, scaleM: 180, periodS: 60 }, shift = { deg: 0, periodS: 300 } } = {}) {
    this.seed = seed; this.base = base; this.gust = gust; this.shift = shift;
    this.noise = makeNoise(seed);
    this.heightAt = null;
  }

  setTerrain(heightAt) { this.heightAt = heightAt; }   // kept for the contract; the stub has no lee shadow

  sample(x, z, t) {
    const { speedMs, dirDeg } = this.base;
    const [dx, dz] = downwind(dirDeg);
    // the gust pattern at (x, z, t) is the pattern at t = 0, moved downwind by speed·t
    const px = (x - dx * speedMs * t) / this.gust.scaleM, pz = (z - dz * speedMs * t) / this.gust.scaleM;
    const n = this.noise(px, pz);                                     // mean ≈ 0.5, most values within ±0.25
    const speed = Math.max(0, speedMs * (1 + this.gust.strength * (n - 0.5) / 0.25));
    return { vx: dx * speed, vz: dz * speed, speed, dirDeg };
  }

  toTexture(sizePx, extentM, t = 0, cx = 0, cz = 0) {
    const out = new Float32Array(sizePx * sizePx * 2);
    for (let j = 0; j < sizePx; j++) {
      const z = cz + (j + 0.5) / sizePx * extentM - extentM / 2;
      for (let i = 0; i < sizePx; i++) {
        const x = cx + (i + 0.5) / sizePx * extentM - extentM / 2;
        const s = this.sample(x, z, t);
        out[(j * sizePx + i) * 2] = s.vx;
        out[(j * sizePx + i) * 2 + 1] = s.vz;
      }
    }
    return out;
  }
}
