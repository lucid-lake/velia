// The kayaks' levels of detail (feat/kayaks-lake). Plain JS. Three tiers by the distance to the camera, with
// hysteresis so a kayak at a boundary does not flicker between them:
//   full  the approved paddler (src/props/paddler/) inside ≈ 150 m
//   mid   a simple hull, figure and swung paddle, ≈ 150–600 m
//   far   a flat impostor beyond ≈ 600 m
// A tier changes only once the distance is past the boundary by the band (8 %): in to full under 150 m, out of it over
// 162 m; out to far over 600 m, back to mid under 552 m.
export const LOD = Object.freeze({ full: 150, far: 600, band: 0.08, maxFull: 3, every: [[50, 1], [100, 2], [Infinity, 3]], perFrame: 1, minHz: 10 });

export function pickTier(prev, d, L = LOD) {
  const fIn = L.full, fOut = L.full * (1 + L.band), farIn = L.far, farOut = L.far * (1 - L.band);
  if (prev === 'full') return d > fOut ? (d > farIn ? 'far' : 'mid') : 'full';
  if (prev === 'far') return d < farOut ? (d < fIn ? 'full' : 'mid') : 'far';
  if (prev === 'mid') return d < fIn ? 'full' : d > farIn ? 'far' : 'mid';
  return d < fIn ? 'full' : d > farIn ? 'far' : 'mid';   // a new kayak: no history
}

// the full tier is capped (the paddler's rig costs ≈ 0.28 ms a step): the nearest maxFull that want it get it; the
// rest wait at mid. A full paddler wants a step every frame inside 50 m, every second frame to 100 m, every third beyond
// (with the frames' summed dt: at 100 m the figure is ≈ 20 px tall and a 20 Hz stroke reads as smooth); a frame runs at
// most perFrame paddler steps (one costs ≈ 0.5 ms in Chrome on the M5 Pro), the most overdue first (time since its last
// step over its wanted interval), and none waits longer than 1 / minHz s
const stepEvery = (d, L = LOD) => L.every.find(([m]) => d < m)[1];
export function pickSteps(items, dt, L = LOD) {   // items: { d, acc (s since the last step) } → the ones to step now
  // (it.slow: a resting kayak's rest clip barely moves: its steps that many times rarer, still ≥ minHz)
  const due = items.map((it) => ({ it, p: it.acc / (stepEvery(it.d, L) * (it.slow ?? 1) * dt) })).filter((q) => q.p >= 1 || q.it.acc >= 1 / L.minHz);
  due.sort((a, b) => b.p - a.p || a.it.d - b.it.d);
  return due.filter((q, i) => i < L.perFrame || q.it.acc >= 1 / L.minHz).map((q) => q.it);
}
export function capFull(items, L = LOD) {
  const want = items.filter((it) => it.tier === 'full').sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  want.slice(L.maxFull).forEach((it) => { it.tier = 'mid'; });
  return items;
}

// The quality rule (feat/kayaks-default-on): the levels of detail and the count for the tier the world is
// built with (core.tier: src/quality/apply.js tierFor, its name and whether it is a phone's live page).
//   High      LOD as above: up to 3 full paddlers, 6 kayaks out
//   Balanced  up to 2 full paddlers, 6 out
//   Low, or any phone or tablet: 1 full paddler (the nearest, inside 90 m, stepped every 2nd frame inside 50 m and every 3rd
//             beyond: 30 / 20 Hz at 60 fps), the rest mid or far; at most 3 kayaks out (the meetings' two first)
const KAYAK_TIERS = Object.freeze({
  high: Object.freeze({ maxFull: 3, maxOut: 6 }),
  balanced: Object.freeze({ maxFull: 2, maxOut: 6 }),
  low: Object.freeze({ maxFull: 1, maxOut: 3, full: 90, every: [[50, 2], [Infinity, 3]] }),
});
export function lodFor(tier = null) {
  const name = tier?.phone ? 'low' : KAYAK_TIERS[tier?.name] ? tier.name : 'high';
  return Object.freeze({ ...LOD, ...KAYAK_TIERS[name], tier: name });
}
