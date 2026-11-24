// Lakeshore harbour layout (L3): where every breakwater, dock, slip, boat and building goes. Plain JS, no three.js,
// so node tests can check it; the meshes are built in src/harbour.js.
//
// A small marina in the shape of the west shore's: two breakwaters (a rubble mound and a sheet-pile crib with a
// boathouse on it) close a basin of four floating docks with 72 slips; a public pier outside the mound, a fuel dock
// inside the entrance, a launch ramp beyond the crib, a yacht club on the shore behind. Generic: no names.
//
// Placement (harbourSite): on the real basin, terrain.places().harbour (the open lake's south shore, where the real
// marinas are; Emerald Bay itself has none). Older basins: on the bay's east shore, 600 m inside the mouth (terrain.mouth: its
// inner end), found by a shore query: march east from the lake's centre line until the first land. It faces west
// into the bay, by the mouth and away from the sail path (≥ 650 m from the centre line). The frame is then fitted to
// the shore there (a least-squares line through the shoreline over ±200 m), so a reshaped basin moves the harbour
// with it. Every dock and breakwater root starts at the real shoreline.
//
// World frame (src/main.js): x east, y up, z south, metres; water level y = 0. Local frame: u along the shore
// (the shore normal turned −90°: south for a west-facing shore), v offshore. Directions are unit [dx, dz] in the world.
//
//   import { harbourLayout } from './harbour-layout.js';
//   const L = harbourLayout({ terrain, seed: 1 });   // → { frame, breakwaters, docks, piles, slips, boats, buildings, ramp, entrance, enclosure, toWorld }
//
// Deterministic: the same terrain and seed give the same layout; no Math.random(), no clock.

// how far inside the mouth the harbour sits, m (along z from the mouth's inner end); a terrain without a mouth (the
// pre-L2 basin) takes z = 180
const SITE_INSIDE_MOUTH = 600;

// The site: a point on the shore, on the east side of the lake at the harbour's z. Throws if the march finds no shore.
export function harbourSite(terrain) {
  // the real basin names a site (src/terrain.js places().harbour: the south shore's marinas, ≈ 5 km east of Emerald
  // Bay's mouth): walk from it down the shore distance's gradient to the shoreline
  const named = terrain.places?.().harbour;
  if (named) {
    let { x, z } = named;
    const sd = terrain.shoreDistance, e = 2;
    for (let k = 0; k < 400; k++) {
      const d = sd(x, z);
      if (Math.abs(d) < 0.25) break;
      const gx = (sd(x + e, z) - sd(x - e, z)) / (2 * e), gz = (sd(x, z + e) - sd(x, z - e)) / (2 * e), g = Math.hypot(gx, gz) || 1;
      const stepM = Math.sign(d) * Math.min(Math.abs(d) * 0.8, 40);
      x -= gx / g * stepM; z -= gz / g * stepM;
    }
    if (Math.abs(sd(x, z)) < 1) return { x, z };
  }
  const z = terrain.mouth ? terrain.mouth.a[1] + SITE_INSIDE_MOUTH : 180;
  const x0 = terrain.centreX ? terrain.centreX(z) : 0;
  for (let x = x0; x < x0 + 4000; x += 2) if (terrain.shoreDistance(x, z) >= 0) return { x, z };
  throw new Error(`harbour: no east shore at z ${z}`);
}
const BASIN = {
  docks: [-75, -25, 25, 75],     // u of the four main docks, m
  slipsPerSide: 9, slipPitch: 5.0, slipStartV: 26,   // the first slip's centre, m offshore
  dockWidth: 2.4, fingerWidth: 0.9, deckY: 0.45, fixedDeckY: 1.4,
  occupancy: 0.86, sailShare: 0.7,
};

// small seeded PRNG (mulberry32)
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fit the shore near (x, z): the offshore normal from the shoreDistance gradient, then a line through the shoreline
// crossings along it. Returns { origin, t, n } with t = along the shore (n rotated −90°: east for a south normal).
export function fitShore(shoreDistance, { x, z }, half = 200) {
  const grad = (px, pz, h = 40) => [
    (shoreDistance(px + h, pz) - shoreDistance(px - h, pz)) / (2 * h),
    (shoreDistance(px, pz + h) - shoreDistance(px, pz - h)) / (2 * h)];
  let gx = 0, gz = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const g = grad(x + 60 * i, z + 60 * j); gx += g[0]; gz += g[1]; }
  let n = norm([-gx, -gz]);                          // toward the water: shoreDistance falls offshore
  let o = [x, z];
  for (let pass = 0; pass < 3; pass++) {
    const t = [n[1], -n[0]];
    const us = [], vs = [];
    for (let u = -half; u <= half; u += 20) {
      const v = crossing(shoreDistance, o, t, n, u);
      if (v != null) { us.push(u); vs.push(v); }
    }
    if (us.length < 5) throw new Error(`harbour: no straight shore near (${x}, ${z})`);
    const mu = mean(us), mv = mean(vs);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < us.length; i++) { sxy += (us[i] - mu) * (vs[i] - mv); sxx += (us[i] - mu) ** 2; }
    const b = sxy / sxx;                              // v = mv + b (u − mu)
    o = [o[0] + t[0] * mu + n[0] * mv, o[1] + t[1] * mu + n[1] * mv];
    const a = Math.atan(b);                           // turn the frame so the fitted line is v = 0
    n = norm([n[0] * Math.cos(a) - t[0] * Math.sin(a), n[1] * Math.cos(a) - t[1] * Math.sin(a)]);
  }
  return { origin: o, t: [n[1], -n[0]], n };
}

// v of the shoreline at u: marching offshore from 150 m inland, the first point that is water
function crossing(shoreDistance, o, t, n, u) {
  for (let v = -150; v <= 150; v += 1) {
    if (shoreDistance(o[0] + t[0] * u + n[0] * v, o[1] + t[1] * u + n[1] * v) < 0) return v;
  }
  return null;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function norm([a, b]) { const l = Math.hypot(a, b) || 1; return [a / l, b / l]; }

export function harbourLayout({ terrain, seed = 1, site = harbourSite(terrain) } = {}) {
  const { shoreDistance, heightAt } = terrain;
  const frame = fitShore(shoreDistance, site);
  const { origin: o, t, n } = frame;
  const W = (u, v) => [o[0] + t[0] * u + n[0] * v, o[1] + t[1] * u + n[1] * v];
  const dir = (du, dv) => norm([t[0] * du + n[0] * dv, t[1] * du + n[1] * dv]);
  const shoreV = (u) => crossing(shoreDistance, o, t, n, u) ?? 0;
  const R = rng(seed * 7919 + 17);
  const B = BASIN;

  // --- breakwaters: a rubble mound from the west end, out and round to the entrance; a sheet-pile crib from the east
  // the roots 20 m behind the real shoreline at their u, so a ragged or reshaped shore never leaves a gap to the land
  const rockPath = [[-125, Math.min(-25, shoreV(-125) - 20)], [-125, 112], [-95, 135], [-15, 150]];
  const cribPath = [[125, Math.min(-25, shoreV(125) - 20)], [125, 100], [22, 128]];
  const breakwaters = [
    { kind: 'rock', path: rockPath.map(([u, v]) => W(u, v)), crestY: 2.2, crestWidth: 4, baseWidth: 18, baseY: -7 },
    { kind: 'crib', path: cribPath.map(([u, v]) => W(u, v)), crestY: 1.6, crestWidth: 5, baseY: -5 },
  ];
  // the entrance: between the mound's toe (its crest end + half its base) and the crib's end, along the line between
  const ea = W(-15, 150), eb = W(22, 128);
  const entrance = { a: ea, b: eb, width: Math.hypot(ea[0] - eb[0], ea[1] - eb[1]) - 18 / 2 - 5 / 2, centre: W(3, 139) };
  const enclosure = [...rockPath, ...[...cribPath].reverse()].map(([u, v]) => W(u, v));

  // --- docks, fingers, slips, boats
  const docks = [], piles = [], slips = [], boats = [];
  const pileAt = (u, v, top) => piles.push([...W(u, v), top]);
  const endV = B.slipStartV + (B.slipsPerSide - 0.5) * B.slipPitch + 4;
  B.docks.forEach((du, di) => {
    const root = shoreV(du) - 3;                     // 3 m onto the land: the gangway lands on the bank
    docks.push({ kind: 'main', a: W(du, root), b: W(du, endV), width: B.dockWidth, deckY: B.deckY });
    // piles: along the gangway end, then at every other finger root (where no boat lies against the dock)
    for (let v = root + 8; v < B.slipStartV - 4; v += 10) { pileAt(du - B.dockWidth / 2 - 0.25, v, 1.6); pileAt(du + B.dockWidth / 2 + 0.25, v, 1.6); }
    for (let k = 1; k < B.slipsPerSide; k += 2) { const v = B.slipStartV + (k + 0.5) * B.slipPitch; pileAt(du - B.dockWidth / 2 - 0.25, v, 1.6); pileAt(du + B.dockWidth / 2 + 0.25, v, 1.6); }
    for (const side of [-1, 1]) {
      for (let k = 0; k < B.slipsPerSide; k++) {
        const v = B.slipStartV + k * B.slipPitch;
        const sailboat = R() < B.sailShare;
        const len = sailboat ? 7 + 3.2 * R() : 5 + 2.2 * R();
        const fingerLen = 8.5;
        // a finger on the slip's offshore side, so each boat lies between two fingers (the last slip uses the dock end)
        const fu0 = du + side * B.dockWidth / 2, fu1 = fu0 + side * fingerLen;
        const fv = v + B.slipPitch / 2;
        docks.push({ kind: 'finger', a: W(fu0, fv), b: W(fu1, fv), width: B.fingerWidth, deckY: B.deckY });
        pileAt(fu1 + side * 0.3, fv, 1.6);
        const id = slips.length;
        const cu = du + side * (B.dockWidth / 2 + 0.6 + len / 2);
        slips.push({ id, dock: di, side, x: W(cu, v)[0], z: W(cu, v)[1], dir: dir(side, 0), width: B.slipPitch, length: fingerLen + 1.5 });
        if (R() < B.occupancy) {
          const bowIn = R() < 0.8;                    // most boats moor bow to the dock
          const d = dir(bowIn ? -side : side, 0);
          const beam = sailboat ? 0.34 * len : 0.38 * len;
          boats.push({ slip: id, type: sailboat ? 'sail' : 'motor', x: W(cu, v)[0], z: W(cu, v)[1], dir: d, length: +len.toFixed(2), beam: +beam.toFixed(2),
            hull: pickHull(R), phase: +(R() * Math.PI * 2).toFixed(3) });
        }
      }
    }
  });

  // --- the fuel dock: a float inside the crib near the entrance, a kiosk and two pumps on it
  const fuelV = 90, fuelU0 = 52, fuelU1 = 88;
  docks.push({ kind: 'fuel', a: W(fuelU0, fuelV), b: W(fuelU1, fuelV), width: 4, deckY: B.deckY });
  for (const u of [fuelU0, fuelU1]) for (const s of [-1, 1]) pileAt(u, fuelV + s * 2.4, 1.6);
  // its walkway to the crib (the crib's inner face runs from (125, 100) to (22, 128); at u 70 it is at v ≈ 112)
  docks.push({ kind: 'gangway', a: W(70, fuelV + 2), b: W(70, 112), width: 1.4, deckY: B.deckY });

  // --- the public pier: fixed timber on piles, outside the mound's root, with a T head
  const pu = -170, pRoot = shoreV(pu) - 4, pEnd = 100;
  docks.push({ kind: 'pier', a: W(pu, pRoot), b: W(pu, pEnd), width: 3, deckY: B.fixedDeckY });
  docks.push({ kind: 'pier', head: true, a: W(pu - 11, pEnd + 2), b: W(pu + 11, pEnd + 2), width: 4, deckY: B.fixedDeckY });
  for (let v = pRoot + 6; v <= pEnd; v += 6) { pileAt(pu - 1.7, v, B.fixedDeckY); pileAt(pu + 1.7, v, B.fixedDeckY); }
  for (let u = pu - 10; u <= pu + 10; u += 5) { pileAt(u, pEnd, B.fixedDeckY); pileAt(u, pEnd + 4, B.fixedDeckY); }

  // --- the launch ramp east of the crib: a concrete slab from the bank to 1.6 m under water, a courtesy float beside it
  const ru = 160, rShore = shoreV(ru);
  const ramp = { a: W(ru, rShore - 26), b: W(ru, rShore + 14), width: 7, yA: Math.max(0.6, heightAt(...W(ru, rShore - 26))) , yB: -1.6, dir: dir(0, 1) };
  docks.push({ kind: 'float', a: W(ru + 6, rShore - 2), b: W(ru + 6, rShore + 26), width: 2, deckY: B.deckY });

  // --- buildings: the yacht club behind the basin's west half; the boathouse on the crib's corner; the fuel kiosk
  const ground = (u, v, w, d) => {          // the floor: the ground at the footprint's middle; a stone plinth takes the fall
    let lo = Infinity, hi = -Infinity;
    for (const a of [-0.5, 0, 0.5]) for (const b of [-0.5, 0, 0.5]) { const h = heightAt(...W(u + a * w, v + b * d)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return (lo + hi) / 2;
  };
  const clubU = -40, clubV = shoreV(-40) - 20;      // on the bench behind the bank, before the valley wall climbs
  const buildings = [
    { kind: 'club', x: W(clubU, clubV)[0], z: W(clubU, clubV)[1], y: Math.max(1.2, ground(clubU, clubV, 34, 14)), dir: dir(1, 0), w: 34, d: 14, h: 4.6 },
    { kind: 'clubWing', x: W(clubU + 23, clubV - 1)[0], z: W(clubU + 23, clubV - 1)[1], y: Math.max(1.2, ground(clubU + 23, clubV - 1, 12, 12)), dir: dir(0, 1), w: 12, d: 12, h: 4.0 },
    { kind: 'boathouse', x: W(118, 96)[0], z: W(118, 96)[1], y: 1.6, dir: dir(0, 1), w: 18, d: 12, h: 6.5 },
    { kind: 'kiosk', x: W(80, fuelV)[0], z: W(80, fuelV)[1], y: B.deckY, dir: dir(1, 0), w: 3.4, d: 2.6, h: 2.6 },
  ];

  return { seed, site, frame, breakwaters, entrance, enclosure, docks, piles, slips, boats, buildings, ramp, toWorld: W, dir };
}

// hull colours (albedo): mostly white and cream, a few navy, dark green, a dull red; no loud colour
const HULLS = [[0xc9c8c0, 0.5], [0xbfb8a6, 0.2], [0x22303f, 0.13], [0x2c3b33, 0.1], [0x5a2e2a, 0.07]];
function pickHull(R) {
  let r = R();
  for (const [c, p] of HULLS) { if ((r -= p) < 0) return c; }
  return HULLS[0][0];
}

// Point in polygon (even-odd), for the tests and for anything that must stay inside the basin.
export function insidePolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
