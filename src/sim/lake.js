// One lake's terrain object from its profile and a sampler (src/sim/terrain-data.js makeSampler, or any { height, distance,
// spacing, cover } over the same grids): moved out of src/sim/terrain.js unchanged (v2 seam, 2026-11-13), so a page that
// streams its own grids (Velia v2) builds the same object without terrain.js's top-level load. Plain JS, no three.js.
//   buildLakeOn(waters, S, day) → { heightAt, shoreDistance, normalAt, slopeAt, coverAt, snowAt, fetchMap, places, … }
import { COVER } from './terrain-cover.js';
import { makeGeo } from './geo.js';
import { makePlace } from './place.js';
import { pickDay, dayChoice } from './day.js';

import { smooth as smoothstep } from './core/math.js';

// One lake from its profile and its decoded grids (loadTerrain(variant, waters)): the sampler, the fitted island, the
// bay's mouth, the landmarks and the queries. Pure: the same profile, day and data give the same numbers.
// day: the map's day (src/day.js pickDay: the highlight day unless ?day says otherwise); it sets the season and the place.
export function buildLakeOn(waters, S, day = pickDay(waters, dayChoice())) {
  const geo = makeGeo(waters), Y0 = geo.Y0;
  const W = (lat, lon) => { const [x, z] = geo.lonLatToWorld(lon, lat); return { x, z }; };
  const BAY_CENTRE = waters.terrain.bayCentre, LAKE_CENTRE = waters.terrain.lakeCentre;

  // The season: the day's (the profile's day.highlight.season / day.normal.season, src/day.js; for Tahoe's).
  // The winter's last snow on the crest and north faces. snowLine: elevation (m, sea level) where snow starts on a
  // level, east/west-facing slope; north faces hold it aspectM lower, south faces aspectM higher; full cover fullM above
  // the line; none on slopes past maxSlope (rise/run). grassDry: the meadows' colour, 0 fresh green .. 1 straw; bloom:
  // wildflowers in the meadows and the manzanita's blossom, 0 .. 1 (the ground material, src/terrain-mesh.js).
  // Tahoe's normal day (mid-June, owner 2026-10-29): level ground bare well above the lake (NRCS Echo Peak SNOTEL #463,
  // 2,332 m: the 1981–2010 median snowpack is gone by early June); patches on north faces from ≈ 2,550 m (2,850 − 300)
  // and in Mount Tallac's north bowls (2,947 m), none on south faces below 3,150 m; fullM 250; grassDry 0.15; bloom 1.
  // Tahoe's highlight day (early July): the line ≈ 150 m higher (3,000; north faces from 2,700: Tallac's cross still
  // shows, the low north patches are gone), patchier (fullM 300), the low meadows starting to cure (grassDry 0.35),
  // the high meadows' bloom past its peak but still on (0.85). (2750 was late October.)
  // treeline: m, sea level (whitebark pine thins out above ≈ 2,750–3,000 m).
  const TAHOE = {
    surface: Y0,
    season: { ...day.season },
    treeline: waters.treeline,
  };

  // --- real places (lat, lon from GNIS / Wikipedia): the profile's points -------------------------------
  const pt = waters.points, at = (k) => W(pt[k][0], pt[k][1]);
  const P = {
    house: at('house'),               // the stone house at the bay's head (Vikingsholm)
    headBeach: at('headBeach'),       // the beach in front of it
    mouthNW: at('mouthNW'),           // the mouth's north-west side (Emerald Point)
    mouthSE: at('mouthSE'),           // the mouth's south-east side (Eagle Point)
    creekTop: at('creekTop'),         // the creek at the highway bridge (the top of the lower falls)
    creekMouth: at('creekMouth'),     // where it meets the bay
    peak: at('peak'),                 // Mount Tallac
    ridgeFrom: at('ridgeFrom'),       // Dicks Peak
    ridgeTo: at('ridgeTo'),           // Pyramid Peak
  };

  // --- the island: fitted from the lidar (an ellipse round the origin's summit) -------------------------------------
  function fitIsland() {
    const R = waters.island.searchM, RMAX = waters.island.radiusM;
    let n = 0, sx = 0, sz = 0, top = -Infinity, tx = 0, tz = 0;
    const pts = [];
    for (let z = -R; z <= R; z += 1) for (let x = -R; x <= R; x += 1) {
      const h = S.height(x, z);
      if (h <= 0) continue;
      if (S.distance(x, z) < 0 || Math.hypot(x, z) > RMAX) continue;
      n++; sx += x; sz += z; pts.push(x, z);
      if (h > top) { top = h; tx = x; tz = z; }
    }
    const cx = sx / n, cz = sz / n;
    let xx = 0, zz = 0, xz = 0;
    for (let k = 0; k < pts.length; k += 2) { const dx = pts[k] - cx, dz = pts[k + 1] - cz; xx += dx * dx; zz += dz * dz; xz += dx * dz; }
    xx /= n; zz /= n; xz /= n;
    const tr = xx + zz, det = xx * zz - xz * xz, l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
    const rot = 0.5 * Math.atan2(2 * xz, xx - zz);
    // an ellipse of uniform area has variance a²/4 along its axis
    return { x: +cx.toFixed(1), z: +cz.toFixed(1), a: +(2 * Math.sqrt(l1)).toFixed(1), b: +(2 * Math.sqrt(l2)).toFixed(1),
      rotDeg: +(rot * 180 / Math.PI).toFixed(1), top: +top.toFixed(1), summit: { x: tx, z: tz }, areaM2: n };
  }
  const ISLAND = fitIsland();

  // the bay's mouth: the channel's axis, from inside the bay (a) out to the open lake (b), across the line between the
  // two points; its half-width the points' half-separation
  const mouthMid = { x: (P.mouthNW.x + P.mouthSE.x) / 2, z: (P.mouthNW.z + P.mouthSE.z) / 2 };
  const mw = Math.hypot(P.mouthSE.x - P.mouthNW.x, P.mouthSE.z - P.mouthNW.z);
  // the outward normal of the points' line, toward deep water
  let nx = -(P.mouthSE.z - P.mouthNW.z) / mw, nz = (P.mouthSE.x - P.mouthNW.x) / mw;
  if (S.height(mouthMid.x + nx * 600, mouthMid.z + nz * 600) > S.height(mouthMid.x - nx * 600, mouthMid.z - nz * 600)) { nx = -nx; nz = -nz; }
  // a: mouthInM (330 m) back into the bay, toward its centre (the channel bends south-west over the sill); b: mouthOutM (400 m) out
  const B = waters.bay;
  const inX = BAY_CENTRE[0] - mouthMid.x, inZ = BAY_CENTRE[1] - mouthMid.z, inL = Math.hypot(inX, inZ);
  const MOUTH_A = [mouthMid.x + inX / inL * B.mouthInM, mouthMid.z + inZ / inL * B.mouthInM], MOUTH_B = [mouthMid.x + nx * B.mouthOutM, mouthMid.z + nz * B.mouthOutM];

  const LAKE = {
    surface: Y0,
    island: ISLAND,                                   // { x, z, a, b (semi-axes, m), rotDeg, top (m), summit, areaM2 }
    bay: { cx: BAY_CENTRE[0], cz: BAY_CENTRE[1], lengthM: B.lengthM },   // the inner water maps centre here (the bay, its mouth)
    lakeCentre: { x: LAKE_CENTRE[0], z: LAKE_CENTRE[1] },          // the outer maps centre here (the whole lake)
    zCentre: BAY_CENTRE[1],                                    // (old name: the bay's centre z)
    mouth: { a: MOUTH_A, b: MOUTH_B, mid: [mouthMid.x, mouthMid.z], halfWidth: mw / 2,
      bearingDeg: (Math.atan2(nx, -nz) * 180 / Math.PI + 360) % 360, length: Math.round(Math.hypot(MOUTH_B[0] - MOUTH_A[0], MOUTH_B[1] - MOUTH_A[1])) },
    beach: { x: P.headBeach.x, z: P.headBeach.z, halfWidth: B.beachHalfWidthM },   // the head's beach (its sand comes from coverAt)
    creek: { a: [P.creekTop.x, P.creekTop.z], b: [P.creekMouth.x, P.creekMouth.z] },
    maxDepth: B.maxDepthM,                            // m, the bay (the open lake: 501 m)
  };

  // The landmarks on the terrain, for src/landmarks.js (world positions; heights from heightAt there)
  const LM = waters.landmarks;
  const LANDMARKS = {
    ruin: { x: ISLAND.summit.x, z: ISLAND.summit.z, sizeM: LM.ruin.sizeM },   // the 1929 tea house: 16 × 16 ft, on the summit
    house: { x: P.house.x, z: P.house.z, yawDeg: LM.house.yawDeg, length: LM.house.length, width: LM.house.width },
    waterfall: { x: (P.creekTop.x + P.creekMouth.x) / 2, z: (P.creekTop.z + P.creekMouth.z) / 2 },
    peak: { x: P.peak.x, z: P.peak.z, name: LM.peak.name },
    ridge: { from: [P.ridgeFrom.x, P.ridgeFrom.z], to: [P.ridgeTo.x, P.ridgeTo.z] },
    overlook: { x: LM.overlook.x, z: LM.overlook.z },   // the Hwy 89 vista on the north-west wall (cam O), 166 m up: the classic view east over the island
  };

  const heightAt = S.height;
  const shoreDistance = S.distance;

  // the unit normal from heightAt at the finest level's spacing there
  function normalAt(x, z, out = [0, 1, 0]) {
    const e = S.spacing(x, z);
    const dx = (S.height(x + e, z) - S.height(x - e, z)) / (2 * e), dz = (S.height(x, z + e) - S.height(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    out[0] = -dx / l; out[1] = 1 / l; out[2] = -dz / l;
    return out;
  }
  function slopeAt(x, z) {
    const e = S.spacing(x, z);
    return Math.hypot((S.height(x + e, z) - S.height(x - e, z)) / (2 * e), (S.height(x, z + e) - S.height(x, z - e)) / (2 * e));
  }

  // snow 0–1 by elevation, aspect and slope (the season above); h: m above the lake, n: the unit normal
  function snowAt(h, n, season = TAHOE.season) {
    const elev = h + Y0;
    const north = -n[2] / Math.max(1e-6, Math.hypot(n[0], n[2]));          // +1 on a north-facing slope (normal toward −z)
    const steep = Math.hypot(n[0], n[2]) / Math.max(1e-6, n[1]);
    const line = season.snowLine - season.aspectM * north * Math.min(1, steep * 3);
    return smoothstep(line, line + season.fullM, elev) * (1 - smoothstep(season.maxSlope * 0.8, season.maxSlope * 1.2, steep));
  }

  // the ground cover: NLCD classes blended over the four nearest texels, then refined by the slope
  // (granite on steep faces), the season's snow, and the beach (sand on low, gentle ground at the water)
  const COVER_TMP = new Float32Array(COVER.length), NTMP = [0, 1, 0];
  function coverAt(x, z, out = {}) {
    const c = S.cover(x, z, COVER_TMP), h = S.height(x, z), n = normalAt(x, z, NTMP);
    const steep = Math.hypot(n[0], n[2]) / Math.max(1e-6, n[1]);
    let water = c[1] + c[10] * 0, forest = c[5], rock = c[4], shrub = c[6] + c[8] * 0.5, grass = c[7] + c[8] * 0.5, urban = c[2] + c[3] * 0.4, open = c[3] * 0.6, pond = c[10];
    const known = c.reduce((s, v) => s + v, 0);
    if (known < 0.5) {   // past the cover grids (the far ring): forest below the treeline, rock above
      const t = smoothstep(TAHOE.treeline - 250, TAHOE.treeline, h + Y0);
      forest = h > 0 ? 0.7 * (1 - t) : 0; shrub = h > 0 ? 0.3 * (1 - t) : 0; rock = h > 0 ? t : 0; water = h < 0 ? 1 : 0;
    }
    if (h < 0) { water = 1; forest = rock = shrub = grass = urban = open = 0; }
    // granite on steep faces (past ≈ 40°, in full by 50°), whatever NLCD says about the 30 m texel
    const cliff = smoothstep(0.85, 1.2, steep);
    forest *= 1 - cliff; shrub *= 1 - cliff; grass *= 1 - cliff; rock = Math.min(1, rock + cliff * (1 - rock));
    const snow = h > 0 ? snowAt(h, n) : 0;
    const d = h > 0 ? S.distance(x, z) : -1;
    const beach = h >= 0 && h < 2.5 && d < 35 ? smoothstep(0.22, 0.08, steep) * smoothstep(35, 15, d) * (1 - urban) : 0;
    const keep = 1 - Math.max(snow, beach);
    out.water = water; out.forest = forest * keep; out.rock = rock * (1 - snow); out.snow = snow; out.beach = beach;
    out.urban = urban; out.open = open; out.shrub = shrub * keep; out.grass = grass * keep; out.pond = pond;
    return out;
  }

  // Fetch: for each texel and each of 16 wind directions, the distance (m) upwind over water to the first land (for the
  // water's wave growth). A square `extent` metres a side, centred on (cx, cz) (the bay by default), `size` texels a
  // side; rows from north (−z) to south, columns west to east. Direction k is the wind's FROM bearing k × 22.5°.
  // data[(row × size + col) × 16 + k]; 0 on land; capped at `cap` m. Cached per arguments.
  const fetchCache = new Map();
  function fetchMap(size = 128, extent = 4096, { cx = LAKE.bay.cx, cz = LAKE.bay.cz, cap = 6000 } = {}) {
    const key = `${size}:${extent}:${cx}:${cz}:${cap}`;
    if (fetchCache.has(key)) return fetchCache.get(key);
    const DIRS = 16, data = new Float32Array(size * size * DIRS), tex = extent / size, cell = Math.min(tex / 2, 16);
    for (let k = 0; k < DIRS; k++) {
      const a = k * 22.5 * Math.PI / 180, fx = Math.sin(a), fz = -Math.cos(a);
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const x = cx - extent / 2 + (i + 0.5) * tex, z = cz - extent / 2 + (j + 0.5) * tex;
        if (heightAt(x, z) >= 0) continue;
        let d = 0;
        // march by the shore distance itself (a distance field: never past the shore), at least `cell`
        while (d < cap) { const s = shoreDistance(x + fx * d, z + fz * d); if (s >= 0) break; d += Math.max(cell, -s * 0.9); }
        data[(j * size + i) * DIRS + k] = Math.min(d, cap);
      }
    }
    const out = { size, extent, cx, cz, cap, dirs: DIRS, data };
    fetchCache.set(key, out);
    return out;
  }

  // Named points for the shoreline layout (src/shoreline-layout.js snaps each to its traced shoreline)
  function places() {
    const px = -LAKE.mouth.a[1] + LAKE.mouth.b[1], pz = LAKE.mouth.a[0] - LAKE.mouth.b[0];   // across the channel
    const l = Math.hypot(px, pz);
    return {
      bayHead: { x: P.headBeach.x, z: P.headBeach.z },
      mouth: [{ x: P.mouthNW.x, z: P.mouthNW.z }, { x: P.mouthSE.x, z: P.mouthSE.z }],
      headland: { x: P.mouthSE.x + px / l * 60, z: P.mouthSE.z + pz / l * 60 },
      river: { x: P.creekMouth.x, z: P.creekMouth.z },
      // a harbour site on the open lake's south shore, ≈ 5 km east of the mouth (where the real south-shore marinas are)
      harbour: at('harbour'),
    };
  }

  // the waterfall: the creek's steepest 40 m (horizontal) drop between the bridge and the bay; a, b its top and foot
  let fallCache = null;
  function waterfall() {
    if (fallCache) return fallCache;
    const [ax, az] = LAKE.creek.a, [bx, bz] = LAKE.creek.b, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    // the creek's bed: the lowest ground across a 30 m band at each step (the gully, not the line)
    const bed = (s) => {
      let best = null;
      for (let o = -15; o <= 15; o += 1.5) { const x = ax + ux * s - uz * o, z = az + uz * s + ux * o, h = heightAt(x, z); if (!best || h < best.h) best = { x, z, h }; }
      return best;
    };
    let best = null;
    for (let s = 0; s + 40 <= L; s += 4) {
      const top = bed(s), foot = bed(s + 40);
      if (!best || top.h - foot.h > best.top - best.bottom) best = { a: [top.x, top.z], b: [foot.x, foot.z], top: top.h, bottom: foot.h };
    }
    best.x = (best.a[0] + best.b[0]) / 2; best.z = (best.a[1] + best.b[1]) / 2;
    best.z0 = best.a[1]; best.z1 = best.b[1];   // (old fields)
    fallCache = best;
    return best;
  }

  // how far from the island's centre, in island radii (≈ 1 at its shore): the trees allow steeper ground on it
  function islandR(x, z) {
    const I = ISLAND, c = Math.cos(I.rotDeg * Math.PI / 180), s = Math.sin(I.rotDeg * Math.PI / 180);
    const dx = x - I.x, dz = z - I.z, lx = dx * c + dz * s, lz = -dx * s + dz * c;   // rotDeg: the long axis from +x toward +z
    return Math.hypot(lx / I.a, lz / I.b);
  }

  // where the scatter keeps out: the tea house's clearing, the overlook, the stone house's grounds, the falls, the beaches
  function keepOut(x, z) {
    if (Math.hypot(x - LANDMARKS.ruin.x, z - LANDMARKS.ruin.z) < 7) return true;
    if (Math.hypot(x - LANDMARKS.overlook.x, z - LANDMARKS.overlook.z) < 70) return true;   // the overlook's clearing
    const H = LANDMARKS.house;
    if (Math.hypot(x - H.x, z - H.z) < H.length * 0.5 + 25) return true;
    const w = waterfall();
    const vx = w.b[0] - w.a[0], vz = w.b[1] - w.a[1], t = Math.max(0, Math.min(1, ((x - w.a[0]) * vx + (z - w.a[1]) * vz) / (vx * vx + vz * vz)));
    if (Math.hypot(x - w.a[0] - vx * t, z - w.a[1] - vz * t) < 9) return true;
    // the beaches; built ground is the towns' to clear (their footprints, roads and lots: Tahoe's towns stand in the pines)
    return coverAt(x, z, KTMP).beach > 0.5;
  }
  const KTMP = {};


  const T = { seed: 1, heightAt, shoreDistance, normalAt, slopeAt, coverAt, snowAt, fetchMap, places, waterfall, keepOut, islandR,
    mouth: { a: LAKE.mouth.a, b: LAKE.mouth.b }, data: S,
    waters, lake: LAKE, landmarks: LANDMARKS, climate: TAHOE, place: makePlace(waters, day), geo, day: day.key };
  return T;
}
