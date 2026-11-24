// The cups' hunts (§ 4.8, phase 2; owner go 2026-11-19 with every default): Chart the Bay and Chart the Mouth, eight
// corners each, found by sailing there at your own pace, in Sail, Cruise or any race. No clock, no lock: a corner once found stays found
// (this browser), with the day it was found. Each corner is a place on the chart (◇ until found, filled after: the live chart's corners
// layer) and a rule the boat's own state answers: within a range, held in the binoculars, a sweep round a point, a mooring ball picked
// up under sail, deep water under the keel, Tessie seen, a while close to the glass boat, the channel's gates the right way, the barges
// at night, a surf run, the glass boat out on the open lake. The Logbook's corners page lists them (found with the date; unfound as a
// one-line clue); the hub's hunt row counts them ("3/8"). Pure: no DOM, no GPU, no wall clock (the day comes from the caller);
// v2/tests/regatta-places-2.test.mjs.
//   HUNTS                         [{ id, cup, name, corners: [{ id, name, clue, at: [x, z], rule }] }]
//   createHunts({ store, day })   → H
//     H.step(ctx, dt) → [corner …] newly found this step. ctx: { x, z, heading, sog (m/s), twaDeg (true wind angle, deg, 0 head to wind),
//                       windLevel, depth (m under the boat), sunElevDeg, bino: { x, y, z, fx, fy, fz } | null (the glasses' eye and aim,
//                       fully raised), moored (on a mooring ball), engine (running), tessie: { x, z } | null (her neck or splash seen
//                       now), glass: { x, z, fast } | null (the glass boat, fast: out on the open lake) }
//     H.found(id) → the day string | null;  H.counts() → { [huntId]: { found, of } };  H.pages() → the Logbook's rows;  H.chart() → the
//     live chart's points [{ id, hunt, name, x, z, found, line }];  H.onChange(fn) → off;  H.reset()
//   HUNTS_KEY: the browser's store
import { gateCross } from './placeTracker.js';

export const HUNTS_KEY = 'lakeshore.hunts.v1';
const C = (id, name, clue, at, rule) => Object.freeze({ id, name, clue, at: Object.freeze(at), rule: Object.freeze(rule) });
// the channel's gates as pairs (green, red): v2/sim/channelMarks.json's stations (places.js Pass the Channel)
const GATES = Object.freeze([[[1428, -1032], [1396, -1068]], [[1548, -1139], [1516, -1175]], [[1589, -1205], [1548, -1229]]]);
const BARGES = [2512, -1823];
export const HUNTS = Object.freeze([
  Object.freeze({ id: 'chart-the-bay', cup: 'emerald-bay', name: 'Chart the Bay', corners: Object.freeze([
    C('teahouse', 'The tea house in the glasses', 'Hold the stone tea house in the binoculars for a second.', [2, 0], { kind: 'sight', holdS: 1, maxM: 1500, coneDeg: 3, y: 12 }),
    C('falls', 'Eagle Falls', 'Sail within 420 m of the falls at the head of the bay.', [-856, 171], { kind: 'near', r: 420 }),
    C('stonehouse', 'The stone house', 'Sail within 320 m of Vikingsholm.', [-549, 217], { kind: 'near', r: 320 }),
    C('round', 'Round the island', 'Sail most of the way round Fannette, within 260 m.', [0, 0], { kind: 'round', r: 260, deg: 300 }),
    C('ball', 'A Boat Camp ball under sail', 'Pick up a Boat Camp mooring ball with the engine off.', [400, -576], { kind: 'moored', box: [314, 488, -635, -517] }),
    C('deep', '61 m under the keel', 'Where the water is 61 m deep: her water.', [300, -130], { kind: 'deep', minM: 58, r: 200 }),
    C('tessie', 'Tessie seen', 'See her neck or her splash, anywhere.', [300, -130], { kind: 'tessie', r: 600 }),
    C('glass', 'Alongside the glass boat', 'Keep within 30 m of Velia Travel for 10 s.', [-140, 60], { kind: 'follow', r: 30, holdS: 10 }),
  ]) }),
  Object.freeze({ id: 'chart-the-mouth', cup: 'the-mouth', name: 'Chart the Mouth', corners: Object.freeze([
    C('narrows', 'Thread the narrows', 'Sail down the middle of the channel at the narrows.', [1535, -1160], { kind: 'near', r: 30 }),
    C('buoys', 'All six buoys the right way', 'Through the three channel gates, red to port going out (or red right returning).', [1532, -1157], { kind: 'gates' }),
    C('barges', 'The barges at night', 'Sail within 300 m of the show barges after dark.', BARGES, { kind: 'night', r: 300, sunBelow: -4 }),
    C('surf', 'A surf run', 'Run before a strong wind (Strong or more) for 20 s.', [2100, -1500], { kind: 'surf', holdS: 20, level: 4, twaDeg: 140, sog: 3 }),
    C('emerald', 'Emerald Point close aboard', 'Pass within 150 m of Emerald Point.', [1496, -1281], { kind: 'near', r: 150 }),
    C('eagle', 'Eagle Point close aboard', 'Pass within 150 m of Eagle Point.', [1878, -1259], { kind: 'near', r: 150 }),
    C('deep300', '300 m of water', 'Past the mouth, where the lake is 300 m deep.', [2500, -1500], { kind: 'deep', minM: 300 }),
    C('glasslake', 'The glass boat on the lake', 'Meet Velia Travel out on the open lake, within 300 m.', [2250, -1650], { kind: 'glassLake', r: 300 }),
  ]) }),
]);
const ALL = HUNTS.flatMap((h) => h.corners.map((c) => ({ ...c, hunt: h.id })));
const cornerOf = (id) => ALL.find((c) => c.id === id) ?? null;
const DEG = Math.PI / 180;
// the glasses' aim off a point (src/sail/discoveries.js aimOff's rule: the angle between the aim and the eye → point ray)
function aimOff(b, p) {
  const dx = p[0] - b.x, dy = (p[1] ?? 0) - b.y, dz = p[2] - b.z, d = Math.hypot(dx, dy, dz), fl = Math.hypot(b.fx, b.fy, b.fz) || 1;
  const c = (dx * b.fx + dy * b.fy + dz * b.fz) / (d * fl || 1);
  return c <= 0 ? Infinity : Math.acos(Math.min(1, c));
}

export function loadHunts(store = globalThis.localStorage) {
  let j = null; try { j = JSON.parse(store?.getItem(HUNTS_KEY) ?? 'null'); } catch { j = null; }
  const out = {};
  if (j && typeof j === 'object') for (const [id, d] of Object.entries(j)) if (cornerOf(id) && typeof d === 'string') out[id] = d.slice(0, 10);
  return out;
}
export function huntCounts(found = {}) {
  return Object.fromEntries(HUNTS.map((h) => [h.id, { found: h.corners.filter((c) => found[c.id] != null).length, of: h.corners.length }]));
}

export function createHunts({ store = null, day = () => '' } = {}) {
  let found = store ? loadHunts(store) : {};
  const subs = new Set();
  // the rules' running state: the sweep's angles, the dwells, the gates crossed
  const run = { sweep: null, prev: null, dwell: {}, gates: { out: new Set(), in: new Set() } };
  const save = () => { try { store?.setItem(HUNTS_KEY, JSON.stringify(found)); } catch { /* full or blocked */ } };
  const hold = (id, on, dt, need) => { run.dwell[id] = on ? (run.dwell[id] ?? 0) + dt : 0; return run.dwell[id] >= need; };
  function test(c, q, dt) {
    const R = c.rule, d = Math.hypot(q.x - c.at[0], q.z - c.at[1]);
    switch (R.kind) {
      case 'near': return d <= R.r;
      case 'sight': return hold(c.id, !!q.bino && Math.hypot(q.bino.x - c.at[0], q.bino.z - c.at[1]) <= R.maxM && aimOff(q.bino, [c.at[0], R.y ?? 10, c.at[1]]) <= R.coneDeg * DEG, dt, R.holdS);
      case 'round': {   // the angle swept round the point while within r (either way round; leaving the ring starts again)
        if (d > R.r) { run.sweep = null; return false; }
        const a = Math.atan2(q.z - c.at[1], q.x - c.at[0]);
        if (!run.sweep) { run.sweep = { last: a, sum: 0 }; return false; }
        let da = a - run.sweep.last; da = Math.atan2(Math.sin(da), Math.cos(da)); run.sweep.last = a; run.sweep.sum += da;
        return Math.abs(run.sweep.sum) >= R.deg * DEG;
      }
      case 'moored': { const [x0, x1, z0, z1] = R.box; return !!q.moored && !q.engine && q.x >= x0 - 20 && q.x <= x1 + 20 && q.z >= z0 - 20 && q.z <= z1 + 20; }
      case 'deep': return (R.r == null || d <= R.r) && (q.depth ?? 0) >= R.minM;
      case 'tessie': return !!q.tessie && Math.hypot(q.tessie.x - q.x, q.tessie.z - q.z) <= R.r;
      case 'follow': return hold(c.id, !!q.glass && Math.hypot(q.glass.x - q.x, q.glass.z - q.z) <= R.r, dt, R.holdS);
      case 'glassLake': return !!q.glass?.fast && Math.hypot(q.glass.x - q.x, q.glass.z - q.z) <= R.r;
      case 'night': return d <= R.r && (q.sunElevDeg ?? 90) < R.sunBelow;
      case 'surf': return hold(c.id, (q.windLevel ?? 0) >= R.level && Math.abs(q.twaDeg ?? 0) >= R.twaDeg && (q.sog ?? 0) >= R.sog, dt, R.holdS);
      case 'gates': {   // all three gates crossed the right way, in one direction (out: red to port; in: red to starboard)
        if (run.prev) GATES.forEach(([green, red], i) => {
          const g = { green, red }, out = gateCross(g, run.prev, [q.x, q.z]), back = gateCross({ green: red, red: green }, run.prev, [q.x, q.z]);
          if (out?.through && out.right) run.gates.out.add(i);
          if (back?.through && back.right) run.gates.in.add(i);
        });
        return run.gates.out.size === GATES.length || run.gates.in.size === GATES.length;
      }
      default: return false;
    }
  }
  const api = {
    HUNTS,
    step(q, dt = 0) {
      if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) return [];
      const fresh = [];
      for (const c of ALL) { if (found[c.id]) continue; if (test(c, q, dt)) { found[c.id] = day() || ''; fresh.push(c); } }
      run.prev = [q.x, q.z];
      if (fresh.length) { save(); for (const f of subs) { try { f(fresh); } catch { /* a listener's fault */ } } }
      return fresh;
    },
    found: (id) => (found[id] != null ? found[id] : null),
    counts: () => huntCounts(found),
    chart: () => ALL.map((c) => ({ id: c.id, hunt: c.hunt, name: c.name, x: c.at[0], z: c.at[1], found: found[c.id] != null, line: found[c.id] != null ? `Found${found[c.id] ? ` ${found[c.id]}` : ''}.` : c.clue })),
    pages: () => HUNTS.map((h) => ({ id: h.id, name: h.name, found: h.corners.filter((c) => found[c.id] != null).length, of: h.corners.length,
      rows: h.corners.map((c) => ({ id: c.id, name: c.name, clue: c.clue, foundAt: found[c.id] ?? null })) })),
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    reset() { found = {}; run.sweep = null; run.prev = null; run.dwell = {}; run.gates.out.clear(); run.gates.in.clear(); save(); },
  };
  return api;
}
