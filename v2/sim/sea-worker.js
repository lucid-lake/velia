// The sea's two tables (v2/sim/spectrum.js seaTables: v1's lake and bay sims' h0) built off the main thread on a live page, so a
// wind that moves (the day clock's evening fade, a level change, a storm's outflow) never stops a frame for the ≈ 40–90 ms
// build (render/water.js setWind). Captures and the film clock build them in the frame (deterministic). Pure in, typed arrays out.
//   post { id, speedMs, travelRad, seed, fades } → { id, T: { hL, hB, gL, gB, key } } (hL, hB transferred); fades: 'v1' | 'm5c' (#56 M1)
import { seaTables, FADES } from './spectrum.js';

self.onmessage = (e) => {
  const { id, speedMs, travelRad, seed, fades } = e.data;
  const T = seaTables({ speedMs, travelRad, seed, fades: FADES[fades] ?? FADES.v1 });
  self.postMessage({ id, T }, [T.hL.buffer, T.hB.buffer]);
};
