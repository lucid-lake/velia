// The wind modifiers' fixture cases (tests/wind-modifiers.test.mjs): fields with and without the storm's outflow and
// the gust cells, steady and on Tahoe's day over the terrain. tests/fixtures/wind-modifiers.json holds their numbers
// as main computed them before the modifiers list (refactor Phase 2 step 4, recorded at 5f239e7): sample() and
// gustAt() exactly, and sha-256 of toTexture() and of the worker path's half floats.
export const GRID = [];
for (let x = -1500; x <= 1500; x += 500) for (let z = -1500; z <= 1500; z += 500) GRID.push([x + 37, z - 23]);
export const TIMES = [0, 61.5, 95, 150, 230];   // the storm's arc seconds (s0 0, rate 1): before, on and after its front
export const TEX = { size: 24, extent: 4096, cx: 1024, cz: -1024 };
const STORM = { s0: 0, t0: 0, rate: 1, ref: [600, -650], seed: 3 };

const steady = (WindField, extra = {}) => new WindField({ seed: 7, base: { dirDeg: 250, speedMs: 6 }, ...extra });
export const CONFIGS = [
  { name: 'steady', make: ({ WindField }) => steady(WindField) },
  { name: 'cells', make: ({ WindField }) => steady(WindField, { cells: true }) },
  { name: 'storm', make: ({ WindField }) => { const f = steady(WindField); f.setStorm(STORM); return f; } },
  { name: 'storm+cells', make: ({ WindField }) => { const f = steady(WindField, { cells: true }); f.setStorm(STORM); return f; } },
  { name: 'day+terrain+storm+cells', terrain: true, make: ({ WindField, dayWind, terrain }) => {
    const f = new WindField({ seed: 1, ...dayWind(15.5, { seed: 1 }), level: 3, cells: true });
    f.setTerrain(terrain.heightAt); f.setStorm(STORM); return f;
  } },
];
