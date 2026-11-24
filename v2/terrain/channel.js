// Emerald Bay's entrance channel (owner, 2026-11-16: "cut a navigable channel through the Emerald Bay entrance bar in the lake-bed
// data; the real entrance is a boat passage"). The 1998 multibeam left the bar 0.3–1.5 m deep, its deepest crossing 1.15 m, and the
// keel draws 1.6 m, so no boat could leave the bay. One source: tools/terrain/carve_channel.mjs carves this trough into the height
// grids (terrain/bay-h.lsh at 2 m and basin-h.lsh at 10 m; tools/terrain/phone_terrain.mjs then makes the phone set from them), so
// the physics bottom, the water's shading and caustics, the chart bake and the navigator all read the same bed.
//   The line: the widest way through the mouth (each point's distance to the shore maximised; the narrowest 118 m), from the bay's
//   basin (16 m of water) over the bar to the open lake's drop-off (20 m), ≈ 480 m.
//   The trough: a flat floor depthM under the lake's surface (y = 0, the July level the game sails) across 2 · coreHalfM, its sides a
//   smoothstep over sideM on each side; the bed is the deeper of the trough and the survey, so it blends into the bar with no cliff
//   and leaves deeper water alone.
// Pure (no DOM): the carve tool, the planner's chart (ui/planChart.js: its channel lane), AUTO (sim/autoNav.js), the tests.
export const CHANNEL = Object.freeze({
  pts: Object.freeze([[1300, -950], [1440, -1075], [1535, -1160], [1585, -1245], [1650, -1315]]),
  coreHalfM: 18,   // the floor 36 m wide
  sideM: 22,       // each side's slope (to the bar's 0.3–1.5 m: ≈ 10°)
  depthM: 4,       // m under the surface: ≥ 3 m with the keel's 1.6 m and 1 m to spare after the grids' smoothing
});

// distance (m) from (x, z) to the channel's line, and the position along it (m from the bay's end)
export function channelAt(x, z, C = CHANNEL) {
  let best = Infinity, along = 0, run = 0;
  for (let i = 1; i < C.pts.length; i++) {
    const [ax, az] = C.pts[i - 1], [bx, bz] = C.pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; along = run + t * L; }
    run += L;
  }
  return { d: best, along, length: run };
}

// the trough's bed (m, y up: negative under the surface) at (x, z), or null where it does not reach
export function channelBed(x, z, C = CHANNEL) {
  const { d } = channelAt(x, z, C);
  if (d >= C.coreHalfM + C.sideM) return null;
  const t = Math.max(0, (d - C.coreHalfM) / C.sideM), w = 1 - t * t * (3 - 2 * t);
  return -C.depthM * w;
}
