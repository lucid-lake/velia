// The logbook's chart data: the bay's shoreline, the island, the places and the frame to draw them in. Plain JS, no
// three.js (node tests can read it); src/ui/logbook.js draws it. Everything comes from the terrain, so a reshaped
// basin moves the chart with it. World frame: x east, z south, metres.
//
//   import { buildChart } from './ui/logbookChart.js';
//   const chart = buildChart(terrain, { seed: 1 });   // → { shore: [[x, z], …], island: [[x, z], …], bounds, places }
//
// Sail already runs layoutShoreline for the piers and balls; pass its result as { shoreline } to skip the trace.

import { CURRENT_WATERS } from '../sim/waters/current.js';
import { layoutShoreline } from '../shoreline-layout.js';
import { harbourLayout } from '../harbour-layout.js';

// The chart's frame: Emerald Bay from its head (the falls, x ≈ −900) past its mouth (z ≈ −1270) and east along the
// south shore to the harbour (x ≈ 5,200), north up. Fixed, not fitted to the track, so a short sail and a long one sit
// on the same page. The lake profile's (charts.logbook): this page's lake.
export const CHART_BOUNDS = CURRENT_WATERS.charts.logbook;

export function buildChart(terrain, { seed = 1, shoreline = null, harbour = null, step = 20 } = {}) {
  const L = shoreline ?? layoutShoreline(terrain, { seed });
  const H = harbour ?? (() => { try { const h = harbourLayout({ terrain, seed }); return { x: h.entrance.centre[0], z: h.entrance.centre[1] }; } catch { return null; } })();
  // the traced shore, thinned to one point per `step` m along it (the trace is 5 m), closed
  const shore = [];
  let last = -1e9;
  for (const p of L.shore) { if (p.s - last >= step) { shore.push([Math.round(p.x), Math.round(p.z)]); last = p.s; } }
  if (shore.length > 2) shore.push(shore[0]);
  // the island: its ellipse (the terrain's lake.island), 24 points
  const I = terrain.lake.island, LANDMARKS = terrain.landmarks, c = Math.cos(I.rotDeg * Math.PI / 180), s = Math.sin(I.rotDeg * Math.PI / 180);
  const island = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2, ex = Math.cos(a) * (I.a + 8), ez = Math.sin(a) * (I.b + 8);
    island.push([Math.round(I.x + ex * c - ez * s), Math.round(I.z + ex * s + ez * c)]);
  }
  const pl = L.places;
  const mouthMid = terrain.mouth ? { x: (terrain.mouth.a[0] + terrain.mouth.b[0]) / 2, z: (terrain.mouth.a[1] + terrain.mouth.b[1]) / 2 } : pl.mouth[0];
  const fall = terrain.waterfall?.();
  const places = {
    island: { x: I.x, z: I.z },
    waterfall: { x: fall ? fall.x : LANDMARKS.waterfall.x, z: fall ? fall.z : LANDMARKS.waterfall.z },
    house: { x: LANDMARKS.house.x, z: LANDMARKS.house.z },
    narrows: mouthMid,
    harbour: H,                          // the harbour entrance
    light: L.tower ? { x: L.tower.x, z: L.tower.z } : null,
  };
  return { shore, island, bounds: CHART_BOUNDS, places, mouth: terrain.mouth ?? null };
}
