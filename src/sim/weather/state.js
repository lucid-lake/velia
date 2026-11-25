// The weather's state as plain numbers (Sprint 0: out of the shader uniforms). The storm sim
// (src/sim/weather/stormSim.js) is its only writer, each frame from the arc; an engine copies it into its shader inputs:
// v1's weather bus (src/weather/uniforms.js writeWeatherUniforms) into its TSL uniforms, v2 into its own buffer.
// The fields are the bus's, one for one (vectors as arrays); the camera's matrices are the renderer's own, not here.
//   on        1 while a storm runs: every shader hook is off at 0
//   cell      [x, z, radius] (m): the cell's centre and size        cover, tall: its coverage and towers' growth (0–1)
//   slab      metres added to the deck's slab top (the towers)       shelfDrop, under: the shelf's and the curtains' reach (m)
//   rainCore  the rain under the cell's core (0–1)                   shade, gaps: the sun the cell takes, the clearing's gaps
//   rain      the rain at the listener (0–1)                         dark, gold, flash, flashAdd, haze: the grade's inputs
//   time      the arc's seconds (scene clock)                        front: [x, z, along the drift (m), strength]
//   sun       [x, y, z] the sun (world, unit)                        bow, bowAmt: the rainbow's light and its 0–1 amount
//   toRain    [x, z] toward the departing rain                       drift: [x, z] the shade's noise offset (m)
//   dir       [x, z] the cell's drift (unit): v1's fixed track until a storm with its own steering runs (v2); not in the copied
//             lists below (v1's bus has no row for it: its shaders keep the fixed track)
import { DIR } from './stormArc.js';
export const STORM_TOP_M = 7600;   // the towers' top above the lake (m): an anvil near 9.5 km above sea level

export function createWeatherState() {
  return {
    on: 0, cell: [0, 0, 1], cover: 0, tall: 0, slab: 0, shelfDrop: 0, under: 0, rainCore: 0, shade: 0, gaps: 0, rain: 0,
    dark: 0, gold: 0, flash: 0, flashAdd: 0, haze: 0, time: 0, front: [0, 0, 0, 0], sun: [0, 1, 0], bow: 0, bowAmt: 0,
    toRain: [1, 0], drift: [0, 0], dir: [DIR[0], DIR[1]],
  };
}

// the scalars a storm's stop puts back to 0 (with `on` and `front`; the cell, the sun and the clocks keep their last values)
export const STOP_ZERO = ['cover', 'tall', 'slab', 'shade', 'gaps', 'rain', 'dark', 'gold', 'flash', 'flashAdd', 'haze', 'bow', 'bowAmt', 'shelfDrop', 'under', 'rainCore'];
// every scalar field, and every vector field with its length (an engine's copy reads these lists)
export const WEATHER_SCALARS = ['on', 'cover', 'tall', 'slab', 'shelfDrop', 'under', 'rainCore', 'shade', 'gaps', 'rain', 'dark', 'gold', 'flash', 'flashAdd', 'haze', 'time', 'bow', 'bowAmt'];
export const WEATHER_VECTORS = { cell: 3, front: 4, sun: 3, toRain: 2, drift: 2 };
