// Phase B of the South Lake birthplace: the lake's buildings and the south shore's landmarks packed for v2.
//   node tools/v2-buildings-pack.mjs [--check]
// Input: OpenStreetMap's footprints in data/geo/tahoe-towns.json (ODbL; each an oriented box with its eaves' and ridge's
// heights from building:levels or height, else a default by type, its kind and, for the Stateline high-rises, a facade and
// their towers' floors from public sources), its aerialways (the gondola from Stateline) and its marinas and piers (Ski Run
// Marina's docks). Projected into the world frame as v1's towns are (UTM 10N → lon/lat → the shared projection).
// Output (v2/towns/buildings.js has the format): v2/assets/towns/buildings-lake.vbd.gz and buildings-south.vbd.gz.
//   lake    the bay's buildings, every big building round the lake (a footprint of BIG_M2 or more, the mid- and high-rises,
//           the Stateline towers among them) and the gondola (its terminals, pylons, two cables and cabins)
//   south   the south shore's other buildings (inside SETS.south.box) and the boats in the marina's slips
// The night's extra lights for the south (the towers' facades, the docks) are tools/v2-lights-pack.mjs's lights-south.bin,
// from southLights() here. No names: the data carries kinds and generic ids only, and no record has a sign or a word.
// --check (and v2/tests/buildings.test.mjs) compares the decoded content with a fresh pack (zlib builds differ in bytes).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeBuildings, decodeBuildings, KIND, MODE, CLASS, SETS, BIG_M2, PART_ID, hash, inBox } from '../v2/towns/buildings.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'v2/assets/towns');
const DEG = Math.PI / 180;

export const RULES = Object.freeze({
  regionMarginM: 4000,     // a region with a birthplace keeps every building within its circle and this much round it (the lake set)
  inLakeM: 0.3,            // a footprint whose every corner is under this (m over the lake) is a pier house or not real ground yet: left out
  farH: 40,                // m: a building this tall (or a high-rise) draws to the far range
  lit: Object.freeze({ [KIND.high]: 0.7, [KIND.mid]: 0.4, [KIND.low]: 0.3 }),   // v1's lit window shares at night; the towers brighter (0.55 in v1)
  gondola: Object.freeze({ spacingM: 220, headM: 18, clearM: 10, gaugeM: 6, cableM: 0.5, cabinEveryM: 110, cabinDropM: 3.2, cabin: [2.4, 2.6, 2.4],
    pylon: [2.0, 2.0], arm: [1.0, 0.8, 8.0], bottom: [36, 18, 12], top: [28, 16, 10] }),
  marina: Object.freeze({ pitchM: 3.6, gapM: 0.6, deckHalfM: 1.25, minDepthM: 1.2, fill: 0.8, len: [6, 9.5], beam: 0.34, draftM: 0.35, freeM: 0.8, mastShare: 0.4 }),
});

// --- the inputs ---
export async function inputs() {
  const { loadTownsData } = await import('../classic/src/towns-layout.js');
  const { fromUTM } = await import('../src/sim/geo/utm.js');
  const { makeGeo } = await import('../src/sim/geo.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const { loadTerrain, makeSampler } = await import('../src/sim/terrain-data.js');
  const { SHORE_REGION } = await import('../src/shoreline-layout.js');
  const data = await loadTownsData(), g = makeGeo(CURRENT_WATERS), S = makeSampler(await loadTerrain('full'));
  const [E0, N0] = data.origin;
  const toW = (e, n) => { const q = fromUTM(e + E0, n + N0); return g.lonLatToWorld(q.lon, q.lat); };
  return { data, toW, heightAt: S.height, waters: CURRENT_WATERS, shoreRegion: SHORE_REGION };
}

// --- the buildings: OSM's boxes in the world frame (v1's towns-layout: the yaw from a 10 m step along the long axis) ---
export function buildingRecords({ data, toW, heightAt, waters, shoreRegion }) {
  const regions = (waters.regions ?? []).filter((r) => r.birthplaces?.length && !inBox(SETS.south.box, r.centre[0], r.centre[1]));
  const nearRegion = (x, z) => regions.some((r) => Math.hypot(x - r.centre[0], z - r.centre[1]) < r.radiusM + RULES.regionMarginM);
  const SR = shoreRegion, inShore = (x, z) => x > SR.x0 && x < SR.x1 && z > SR.z0 && z < SR.z1;
  const D = data.buildings, F = data.buildingFields.length, out = { lake: [], south: [] }, stats = { osm: D.length / F, inLake: 0, bayBoathouse: 0, dropped: 0 };
  for (let k = 0; k < D.length / F; k++) {
    const o = k * F, len = D[o + 2] / 2, wid = D[o + 3] / 2, ang = D[o + 4] / 10 * DEG;
    const [x, z] = toW(D[o], D[o + 1]), [x2, z2] = toW(D[o] + Math.cos(ang) * 10, D[o + 1] + Math.sin(ang) * 10);
    const yaw = Math.atan2(-(z2 - z), x2 - x), ca = Math.cos(yaw), sa = Math.sin(yaw);
    let y1 = -Infinity;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) y1 = Math.max(y1, heightAt(x + u * len * ca + v * wid * sa, z - u * len * sa + v * wid * ca));
    if (y1 < RULES.inLakeM) { stats.inLake++; continue; }
    const kind = D[o + 7], facade = D[o + 8], wall = D[o + 5] / 2, roof = D[o + 6] / 2;
    if (kind === KIND.boathouse && inShore(x, z)) { stats.bayBoathouse++; continue; }   // the bay's boathouses are the shoreline's (render/towns.js)
    const s = Math.floor(hash(k, 7) * 1e6), big = len * wid >= BIG_M2 || kind === KIND.high || kind === KIND.mid;
    const r = { x, z, len, wid, h: wall, y: 0, shear: 0, yaw, roof, kind, mode: MODE.ground, tint: (s % (big ? 5 : 9)) | (((s >> 3) % 7) << 4), facade,
      lit: RULES.lit[kind] ?? 0, cls: kind === KIND.high || wall >= RULES.farH ? CLASS.far : CLASS.near };
    if (inBox(SETS.south.box, x, z)) out[big ? 'lake' : 'south'].push(r);
    else if (big || nearRegion(x, z)) out.lake.push(r);
    else stats.dropped++;
  }
  return { ...out, stats };
}

// --- the gondola: OSM's line from Stateline up the mountain (the one gondola whose foot is inside the south box, the lowest
// one if several), pylons every spacingM raised until both cables clear the ground by clearM, the two cables gaugeM apart,
// cabins hanging under them, a terminal at each end ---
export function gondolaRecords({ data, toW, heightAt }) {
  const G = RULES.gondola;
  const lines = data.lifts.filter((l) => l.k === 1).map((l) => { const p = []; for (let k = 0; k < l.p.length; k += 2) p.push(toW(l.p[k], l.p[k + 1])); return p; })
    .map((p) => (heightAt(...p[0]) > heightAt(...p[p.length - 1]) ? p.reverse() : p))
    .filter((p) => inBox(SETS.south.box, p[0][0], p[0][1]));
  if (!lines.length) return { records: [], line: null };
  lines.sort((a, b) => heightAt(...a[0]) - heightAt(...b[0]));
  const P = lines[0];
  // the stations along the polyline: its vertices and pylons between them
  const st = [];
  for (let s = 0; s + 1 < P.length; s++) {
    const [ax, az] = P[s], [bx, bz] = P[s + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / G.spacingM));
    for (let i = s ? 1 : 0; i <= n; i++) st.push({ x: ax + (bx - ax) * i / n, z: az + (bz - az) * i / n });
  }
  for (const q of st) { q.g = heightAt(q.x, q.z); q.top = q.g + G.headM; }
  st[0].top = st[0].g + 10; st[st.length - 1].top = st[st.length - 1].g + 8;   // the terminals' sheaves
  // raise the pylons until every span clears the ground (sampled each 10 m, both cables) by clearM
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      let need = 0;
      for (let t = 0.05; t < 1; t += 10 / L) for (const sd of [-1, 1]) {
        const x = a.x + (b.x - a.x) * t + nx * sd * G.gaugeM / 2, z = a.z + (b.z - a.z) * t + nz * sd * G.gaugeM / 2;
        need = Math.max(need, heightAt(x, z) + G.clearM - (a.top + (b.top - a.top) * t));
      }
      if (need > 0.01) { for (const q of [a, b]) if (q !== st[0] && q !== st[st.length - 1]) q.top += need; if (a === st[0] && b === st[st.length - 1]) break; moved = true; }
    }
    if (!moved) break;
  }
  const recs = [], part = (r) => recs.push({ shear: 0, roof: 0, facade: 0, lit: 0, kind: KIND.part, cls: CLASS.far, ...r });
  // the terminals (grounded boxes, the low one's long side along the line) and the pylons with their cross-arms
  const yawOf = (a, b) => Math.atan2(-(b.z - a.z), b.x - a.x);
  const y0 = yawOf(st[0], st[1]), y1 = yawOf(st[st.length - 2], st[st.length - 1]);
  part({ x: st[0].x, z: st[0].z, len: G.bottom[0], wid: G.bottom[1], h: G.bottom[2], y: 0, yaw: y0, mode: MODE.ground, tint: PART_ID.white | (PART_ID.steel << 4) });
  part({ x: st.at(-1).x, z: st.at(-1).z, len: G.top[0], wid: G.top[1], h: G.top[2], y: 0, yaw: y1, mode: MODE.ground, tint: PART_ID.white | (PART_ID.steel << 4) });
  for (let i = 1; i + 1 < st.length; i++) {
    const q = st[i], yw = yawOf(st[i - 1], st[i + 1]);
    part({ x: q.x, z: q.z, len: G.pylon[0], wid: G.pylon[1], h: 0, y: q.top - 0.6, yaw: yw, mode: MODE.foot, tint: PART_ID.steel | (PART_ID.steel << 4) });
    part({ x: q.x, z: q.z, len: G.arm[0], wid: G.arm[2], h: G.arm[1], y: q.top - 0.6, yaw: yw, mode: MODE.abs, tint: PART_ID.steel | (PART_ID.steel << 4) });
  }
  // the cables (one sheared box a span each side) and the cabins under them every cabinEveryM (up one side, down the other)
  let along = 0;
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i], b = st[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L, yw = yawOf(a, b);
    for (const sd of [-1, 1]) {
      const ox = nx * sd * G.gaugeM / 2, oz = nz * sd * G.gaugeM / 2;
      part({ x: (a.x + b.x) / 2 + ox, z: (a.z + b.z) / 2 + oz, len: L, wid: G.cableM, h: G.cableM, y: (a.top + b.top) / 2 - G.cableM / 2, shear: b.top - a.top, yaw: yw, mode: MODE.abs, tint: PART_ID.cable | (PART_ID.cable << 4) });
      for (let t = (G.cabinEveryM - (along % G.cabinEveryM)) % G.cabinEveryM + (sd > 0 ? G.cabinEveryM / 2 : 0); t < L; t += G.cabinEveryM) {
        const f = t / L, c = G.cabin;
        part({ x: a.x + (b.x - a.x) * f + ox, z: a.z + (b.z - a.z) * f + oz, len: c[0], wid: c[2], h: c[1], y: a.top + (b.top - a.top) * f - G.cabinDropM - c[1], yaw: yw, mode: MODE.abs, cls: CLASS.near,
          tint: (Math.floor(t + along) % 3 ? PART_ID.cabin : PART_ID.white) | (PART_ID.canvas << 4) });
      }
    }
    along += L;
  }
  return { records: recs, line: st.map((q) => ({ x: +q.x.toFixed(1), z: +q.z.toFixed(1), ground: +q.g.toFixed(1), top: +q.top.toFixed(1) })) };
}

// --- the marina's boats: OSM's docks (piers inside a marina's ring in the south box) with boats in slips on both sides, bow to
// the dock, where the water is deep enough and no other dock or boat is in the way; fill share of the slips taken ---
function inRing(r, x, z) { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
const segD = (px, pz, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-9, t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2)); return Math.hypot(px - ax - vx * t, pz - az - vz * t); };
export function marinaDocks({ data, toW }) {
  const rings = data.land.filter((l) => l.k === 5).map((l) => { const r = []; for (let k = 0; k < l.r.length; k += 2) r.push(...toW(l.r[k], l.r[k + 1])); return r; })
    .filter((r) => inBox(SETS.south.box, r[0], r[1]));
  const near = (r, x, z, m) => inRing(r, x, z) || (() => { for (let i = 0; i + 3 < r.length; i += 2) if (segD(x, z, r[i], r[i + 1], r[i + 2], r[i + 3]) < m) return true; return false; })();
  const docks = [];
  for (const p of data.piers) {
    if (p.k !== 0) continue;
    const q = []; for (let k = 0; k < p.p.length; k += 2) q.push(toW(p.p[k], p.p[k + 1]));
    const ring = rings.find((r) => q.some(([x, z]) => near(r, x, z, 30)));
    if (ring) docks.push({ pts: q, ring });
  }
  return docks;
}
export function marinaRecords(I) {
  const M = RULES.marina, { heightAt } = I, docks = marinaDocks(I), segs = [];
  for (const d of docks) for (let i = 0; i + 1 < d.pts.length; i++) segs.push([...d.pts[i], ...d.pts[i + 1]]);
  const recs = [], boats = [];
  let id = 0;
  for (let s = 0; s < segs.length; s++) {
    const [ax, az, bx, bz] = segs[s], L = Math.hypot(bx - ax, bz - az);
    if (L < M.pitchM) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
    for (let t = M.pitchM / 2; t < L; t += M.pitchM) for (const sd of [-1, 1]) {
      const k = id++;
      if (hash(k, 11) > M.fill) continue;
      const len = M.len[0] + (M.len[1] - M.len[0]) * hash(k, 12), beam = len * M.beam, off = M.deckHalfM + M.gapM + len / 2;
      const cx = ax + ux * t + nx * sd * off, cz = az + uz * t + nz * sd * off;
      // deep enough under her middle and her stern; clear of every other dock and of the boats placed
      const sx = cx + nx * sd * len / 2, sz = cz + nz * sd * len / 2;
      if (heightAt(cx, cz) > -M.minDepthM || heightAt(sx, sz) > -M.minDepthM) continue;
      let clear = true;
      for (let o = 0; o < segs.length && clear; o++) if (o !== s && Math.min(segD(cx, cz, ...segs[o]), segD(sx, sz, ...segs[o])) < M.deckHalfM + beam / 2 + 0.3) clear = false;
      for (const b of boats) if (clear && Math.hypot(b[0] - cx, b[1] - cz) < Math.max(b[2], beam) + 0.8) clear = false;
      if (!clear) continue;
      boats.push([cx, cz, beam]);
      // the bow (the hull's +x) toward the dock: her heading is −n·sd
      const yaw = Math.atan2(nz * sd, -nx * sd);
      const top = [PART_ID.white, PART_ID.white, PART_ID.white, PART_ID.navy, PART_ID.green, PART_ID.maroon][Math.floor(hash(k, 13) * 6)];
      const base = { shear: 0, roof: 0, facade: 0, lit: 0, cls: CLASS.near, mode: MODE.abs, yaw };
      recs.push({ ...base, kind: KIND.hull, x: cx, z: cz, len, wid: beam, h: M.draftM + M.freeM, y: -M.draftM, tint: top | ((hash(k, 14) < 0.7 ? PART_ID.white : PART_ID.teak) << 4) });
      // the cabin, a little aft of her middle (−x is aft): its centre (x, z) shifted along her heading
      const fx = Math.cos(yaw), fz = -Math.sin(yaw), cl = len * 0.38, ch = 0.7 + 0.5 * hash(k, 15);
      recs.push({ ...base, kind: KIND.part, x: cx - fx * len * 0.08, z: cz - fz * len * 0.08, len: cl, wid: beam * 0.7, h: ch, y: M.freeM - 0.05, tint: PART_ID.white | (PART_ID.white << 4) });
      if (hash(k, 16) < M.mastShare) recs.push({ ...base, kind: KIND.part, x: cx + fx * len * 0.12, z: cz + fz * len * 0.12, len: 0.14, wid: 0.14, h: len * 1.3, y: M.freeM, tint: PART_ID.white | (PART_ID.white << 4) });
    }
  }
  return { records: recs, boats: boats.length, docks: docks.length, segments: segs.length };
}

// --- the night's extra lights for the south (tools/v2-lights-pack.mjs → v2/assets/night/lights-south.bin): the high-rises'
// facades (a grid of lit windows on each face, warm and cool) and a lamp every 10 m along the marina's docks; v1's light layout
// ({ count, data: x, y, z, r, g, b, size m, on deg }) ---
export const SOUTH_LIGHTS = Object.freeze({ facadeColM: 7, facadeRowM: 6.4, facadeShare: 0.55, facadeSize: 1.6, facadeOn: 3, dockEveryM: 10, dockY: 1.3, dockSize: 1.0, dockOn: 2 });
export function southLights(I, towns = buildingRecords(I)) {
  const L = [], K = SOUTH_LIGHTS, WARM = [1.0, 0.7, 0.42], COOL = [0.9, 0.93, 1.0], LED = [1.0, 0.82, 0.62];
  let id = 0;
  for (const r of towns.lake) {
    if (r.kind !== KIND.high || !inBox(SETS.south.box, r.x, r.z) || r.h < 30) continue;
    const ca = Math.cos(r.yaw), sa = Math.sin(r.yaw), g = I.heightAt(r.x, r.z);
    for (const [ax, w, nrm] of [[0, r.len, r.wid / 2], [0, r.len, -r.wid / 2], [1, r.wid, r.len / 2], [1, r.wid, -r.len / 2]]) {
      for (let u = -w / 2 + K.facadeColM / 2; u < w / 2; u += K.facadeColM) for (let v = 8; v < r.h - 2; v += K.facadeRowM) {
        const k = id++;
        if (hash(k, 21) > K.facadeShare) continue;
        const lu = ax ? nrm + Math.sign(nrm) * 0.4 : u, lv = ax ? u : nrm + Math.sign(nrm) * 0.4;   // along the long axis (ca, −sa), across (sa, ca)
        L.push(r.x + lu * ca + lv * sa, g + v, r.z - lu * sa + lv * ca, ...(hash(k, 22) < 0.6 ? WARM : COOL), K.facadeSize, K.facadeOn - 2 * hash(k, 23));
      }
    }
  }
  for (const d of marinaDocks(I)) {
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1], Lg = Math.hypot(bx - ax, bz - az);
      for (let t = K.dockEveryM / 2; t < Lg; t += K.dockEveryM) { const k = id++; L.push(ax + (bx - ax) * t / Lg, K.dockY, az + (bz - az) * t / Lg, ...(hash(k, 24) < 0.7 ? COOL : LED), K.dockSize, K.dockOn - hash(k, 25)); }
    }
  }
  return { count: L.length / 8, data: Float32Array.from(L) };
}

export async function packBuildings(I = null) {
  I ??= await inputs();
  const B = buildingRecords(I), Gd = gondolaRecords(I), Mr = marinaRecords(I);
  const lake = [...B.lake, ...Gd.records], south = [...B.south, ...Mr.records];
  return {
    files: { [SETS.lake.file]: encodeBuildings(lake, I.heightAt), [SETS.south.file]: encodeBuildings(south, I.heightAt) },
    stats: { ...B.stats, lake: B.lake.length, south: B.south.length, gondola: Gd.records.length, gondolaLine: Gd.line, marina: { boats: Mr.boats, records: Mr.records.length, docks: Mr.docks } },
  };
}

// the decoded content of two files, record by record (the check: zlib builds differ in bytes, the content must not)
export function sameContent(a, b) {
  const A = decodeBuildings(a), B = decodeBuildings(b);
  if (A.count !== B.count || A.chunks.length !== B.chunks.length) return `counts ${A.count}/${A.chunks.length} vs ${B.count}/${B.chunks.length}`;
  for (let i = 0; i < A.count; i++) { const x = A.rec(i), y = B.rec(i); for (const k of Object.keys(x)) if (Math.abs(x[k] - y[k]) > 1e-6) return `record ${i} ${k}: ${x[k]} vs ${y[k]}`; }
  return null;
}

async function main() {
  const check = process.argv.includes('--check');
  const { files, stats } = await packBuildings();
  let bad = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const p = resolve(OUT, name), gz = gzipSync(bytes, { level: 9 });
    if (check) {
      const diff = existsSync(p) ? sameContent(gunzipSync(readFileSync(p)), bytes) : 'missing';
      console.log(`${name}: ${diff ? `DIFFERS (${diff})` : 'matches'}`); if (diff) bad++;
    } else { writeFileSync(p, gz); console.log(`${name}: ${decodeBuildings(bytes).count} records, ${bytes.length} B raw, ${gz.length} B gzip`); }
  }
  console.log(JSON.stringify({ ...stats, gondolaLine: `${stats.gondolaLine?.length ?? 0} stations, tops ${stats.gondolaLine?.map((q) => Math.round(q.top - q.ground)).join(' ')} m over the ground` }));
  if (bad) process.exit(1);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
