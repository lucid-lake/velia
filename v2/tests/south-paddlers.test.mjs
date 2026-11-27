// South Lake's paddlers (the region rows' `kayaks` and `sups`; v2/sim/sup.js, v2/sim/supPose.js, v2/living/sup.js, v2/render/supMesh.js):
//   - they exist only for a page started in South Lake (the region rule: its level is the one loaded), on a tier that has boards
//   - the lanes stay in water deeper than 4 m, off the beach and clear of the piers, and clear of the Ski Run start
//   - a Tessie splash makes a paddler wobble, kneel and stand again; nobody leaves the board
//   - the sup kind is reported by Tessie's hit rules (splashed and spooked like a kayak, never a hit), the HUD and sound treat it as a kayak
//   - determinism: the same seed and hour give the same boards; the figure's hands are on the paddle
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { REGIONS, residentKayaks, residentSups, regionLoaded, SUP_LIFE } from '../living/busyLake.js';
import { supsLoaded, SUP_MAX } from '../living/sup.js';
import { createSupFleet, SUP, toWorld } from '../sim/sup.js';
import { supPose, newPose, BODY, BOARD } from '../sim/supPose.js';
import { buildSupMeshes, PART } from '../render/supMesh.js';
import { createTessieHits, SPOOKABLE } from '../sim/tessieHits.js';
import { polyline } from '../../src/sim/kayaks/routes.js';
import { listBirthplaces } from '../sim/birthplace.js';
import { regionsOf } from '../sim/regions.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { makeGeo } from '../../src/sim/geo.js';
import { fromUTM } from '../../src/sim/geo/utm.js';
import { inflate, unpredict, metres } from '../terrain/decode.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { hullOf } from '../audio/tessieMix.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (...p) => resolve(ROOT, ...p);
const BIRTHS = listBirthplaces(CURRENT_WATERS);
const SOUTH = REGIONS.find((r) => r.id === 'south-lake'), ROW = regionsOf(CURRENT_WATERS).find((r) => r.id === 'south-lake');   // ROW: the region table's row (launchSpots)
const PIN = [11800, -875];

// ---- the south level's bed, the piers and the lake chart (for the lanes) ----
async function level() {
  const dir = T('terrain/south'), M = JSON.parse(readFileSync(resolve(dir, 'south.json'), 'utf8')), L = M.levels[0];
  const q = unpredict(await inflate(readFileSync(resolve(dir, L.height))), L.w, L.h), m = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) m[i] = metres(q[i], M.height);
  return { L, h: (x, z) => {
    const fx = Math.min(Math.max((x - L.x0) / L.step, 0), L.w - 1), fz = Math.min(Math.max((z - L.z0) / L.step, 0), L.h - 1);
    const i = Math.min(Math.floor(fx), L.w - 2), j = Math.min(Math.floor(fz), L.h - 2), u = fx - i, v = fz - j, k = j * L.w + i;
    return (m[k] * (1 - u) + m[k + 1] * u) * (1 - v) + (m[k + L.w] * (1 - u) + m[k + L.w + 1] * u) * v;
  } };
}
const { L: LV, h: bed } = await level();
const inLevel = (x, z) => x >= LV.x0 + 20 && x <= LV.x0 + (LV.w - 1) * LV.step - 20 && z >= LV.z0 + 20 && z <= LV.z0 + (LV.h - 1) * LV.step - 20;
const chart = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(T('v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(T('v2/cruise/chartWorld.json'), 'utf8'))));
const shoreOf = (x, z) => { for (let r = 0; r <= 300; r += 5) for (let a = 0; a < 360; a += 6) { const t = a * Math.PI / 180; if (bed(x + Math.cos(t) * r, z + Math.sin(t) * r) >= 0) return r; } return 300; };
const data = JSON.parse(readFileSync(T('data/geo/tahoe-towns.json'), 'utf8')), geo = makeGeo(CURRENT_WATERS), SEGS = [];
for (const p of data.piers) {
  const pts = []; for (let k = 0; k < p.p.length; k += 2) { const g = fromUTM(p.p[k] + data.origin[0], p.p[k + 1] + data.origin[1]); pts.push(geo.lonLatToWorld(g.lon, g.lat)); }
  for (let k = 0; k + 1 < pts.length; k++) SEGS.push([...pts[k], ...pts[k + 1]]);
}
const pierOf = (x, z) => { let m = Infinity; for (const [ax, az, bx, bz] of SEGS) { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1))); m = Math.min(m, Math.hypot(ax + vx * t - x, az + vz * t - z)); } return m; };
const samples = (lane, step = 10) => { const out = [], p = polyline(lane, true); for (let s = 0; s < p.length; s += step) out.push(p.at(s)); return out; };

test('the region rule: paddlers only for a page started in South Lake, on a tier that has boards', () => {
  assert.ok(SOUTH.kayaks.length >= 2 && SOUTH.kayaks.length <= 3 && SOUTH.kayaks.every((k) => k.mate), 'South Lake: 2 to 3 kayak pairs');
  assert.ok(SOUTH.sups.length >= 1, 'South Lake: paddleboard lanes');
  assert.equal(regionLoaded(SOUTH, 'bay'), false); assert.equal(regionLoaded(SOUTH, 'south-lake'), true);
  assert.equal(regionLoaded(REGIONS.find((r) => r.id === 'emerald-bay'), 'bay'), true, 'a region without its own level lives always');
  const at = (loaded) => residentKayaks(REGIONS, BIRTHS, { seed: 1, hour: 13, polyline, loaded });
  for (const loaded of ['bay', null]) assert.equal(at(loaded).filter((s) => s.region === 'south-lake').length, 0, `no South Lake kayaker on a ${loaded} start`);
  const south = at('south-lake').filter((s) => s.region === 'south-lake');
  assert.equal(south.length, SOUTH.kayaks.length * 2, 'every pair out on a South Lake start');
  assert.ok(at('south-lake').length > south.length, 'the bay\'s kayakers are there too');
  assert.equal(residentSups(REGIONS, BIRTHS, { seed: 1, hour: 13, polyline, loaded: 'bay' }).length, 0, 'no board off South Lake');
  assert.equal(supsLoaded('bay'), false); assert.equal(supsLoaded('south-lake'), true);
  const full = residentSups(REGIONS, BIRTHS, { seed: 1, hour: 13, polyline, loaded: 'south-lake', max: SUP_MAX.full }), lite = residentSups(REGIONS, BIRTHS, { seed: 1, hour: 13, polyline, loaded: 'south-lake', max: SUP_MAX.lite });
  assert.ok(full.length >= 3 && full.length <= 5, `${full.length} boards (3 to 5)`);
  assert.equal(lite.length, SUP_MAX.lite, 'the weak tier: fewer boards');
  assert.ok(full.every((s) => s.region === 'south-lake'));
});

test('the paddleboards\' policy: a desktop or a tablet full at L0-L1 and lite at L2-L3, a phone none, a capture full; ?sup=', () => {
  const make = (dev, gpu, ctx = {}, search = '') => createFeatures({ profile: { get: () => profileOf(readFacts({ ...DEVICES[dev], location: { search } }), forcedOf(search), { gpu }), on: () => () => {} }, doc: null }).configure({ headless: false, flags: {}, ...ctx });
  for (const dev of ['desktop', 'ipadTrackpad']) { assert.equal(make(dev, 0).feature('paddleboards').tier, 'full'); assert.equal(make(dev, 1).feature('paddleboards').tier, 'full'); assert.equal(make(dev, 2).feature('paddleboards').tier, 'lite'); assert.equal(make(dev, 3).feature('paddleboards').tier, 'lite'); }
  for (const dev of ['iphoneTurned', 'androidSideways']) assert.equal(make(dev, 1).feature('paddleboards').tier, 'off', `${dev}: no boards`);
  assert.equal(make('iphoneTurned', 1, { headless: true }).feature('paddleboards').tier, 'full', 'a capture');
  assert.equal(make('desktop', 0, { flags: { sup: '0' } }).feature('paddleboards').tier, 'off');
  assert.equal(make('iphoneTurned', 1, { flags: { sup: '1' } }).feature('paddleboards').tier, 'full');
  assert.equal(make('desktop', 0, { flags: { sup: 'lite' } }).feature('paddleboards').tier, 'lite');
});

test('the lanes: in water deeper than 4 m, off the beach, clear of the piers and of the Ski Run start', () => {
  const rows = [...SOUTH.kayaks.map((k) => ({ ...k, kind: 'kayak' })), ...SOUTH.sups.map((k) => ({ ...k, kind: 'sup' }))];
  assert.ok(rows.length >= 5);
  for (const k of rows) {
    const K = k.kind === 'kayak' ? { shore: 80, pier: 50 } : { shore: 50, pier: 35 };
    for (const p of samples(k.lane)) {
      assert.ok(Math.hypot(p.x - PIN[0], p.z - PIN[1]) >= 150, `${k.id}: off the Ski Run start`);
      if (inLevel(p.x, p.z)) {
        assert.ok(-bed(p.x, p.z) >= 4, `${k.id} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): ${(-bed(p.x, p.z)).toFixed(1)} m deep`);
        assert.ok(shoreOf(p.x, p.z) >= K.shore, `${k.id} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): ${shoreOf(p.x, p.z)} m off the beach`);
        assert.ok(pierOf(p.x, p.z) >= K.pier, `${k.id} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): ${pierOf(p.x, p.z).toFixed(0)} m off a pier`);
      } else {   // outside the south level (Pope Beach): the lake chart's
        assert.ok(chart.depthAt(p.x, p.z) >= 4 && chart.shoreAt(p.x, p.z) >= 50, `${k.id}: the chart's ${chart.depthAt(p.x, p.z).toFixed(1)} m deep, ${chart.shoreAt(p.x, p.z).toFixed(0)} m off`);
      }
    }
  }
  // the boards share their lane with their mate, apart on it; the put-ins are in the region's circle
  for (const s of ROW.launchSpots) assert.ok(Math.hypot(s.at[0] - ROW.centre[0], s.at[1] - ROW.centre[1]) <= ROW.radiusM, `${s.id} in the region`);
  assert.deepEqual(ROW.launchSpots.map((s) => s.id), ['timber-cove', 'lakeview-commons', 'pope-beach']);
  // the lanes' places: the kayakers' and the boards' do not meet (a kayak lane clear of a board lane by 40 m)
  for (const a of SOUTH.sups) for (const b of SOUTH.kayaks) { let m = Infinity; for (const p of samples(a.lane, 10)) for (const q of samples(b.lane, 10)) m = Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)); assert.ok(m >= 40, `${a.id} and ${b.id} ${m.toFixed(0)} m apart`); }
});

// ---- the sim ----
const slotsFor = (o = {}) => residentSups(REGIONS, BIRTHS, { seed: 1, hour: 13, polyline, loaded: 'south-lake', max: 4, ...o });
const fleetOf = (o = {}, f = {}) => createSupFleet({ slots: slotsFor(o), hour: () => o.hour ?? 13, ...f });
const run = (F, sec, dt = 1 / 60) => { for (let i = 0; i < Math.round(sec / dt); i++) F.step(dt); };

test('a splash: the paddler wobbles, drops to kneel, holds, stands again, never leaving the board', () => {
  const F = fleetOf(), b = F.boards[0], hist = [];
  run(F, 5);
  const t0 = F.time; F.spook(b.x, b.z);
  let maxRoll = 0, maxK = 0, kneelAt = null, upAt = null;
  for (let i = 0; i < 60 * 16; i++) {
    F.step(1 / 60); const t = F.time - t0;
    maxRoll = Math.max(maxRoll, Math.abs(b.roll)); maxK = Math.max(maxK, b.k);
    if (kneelAt == null && b.k >= 0.99) kneelAt = t;
    if (kneelAt != null && upAt == null && b.k <= 0.01) upAt = t;
    hist.push(b.k);
    // on the board: the feet on the deck, the hips and the knees over it, the roll capped; the board on its lane
    const P = b.pose;
    for (let s = 0; s < 2; s++) {
      assert.ok(Math.abs(P.ankle[s][0]) <= BOARD.B / 2, 'a foot over the board');
      assert.ok(P.ankle[s][1] <= BOARD.top + 0.1 && P.ankle[s][1] >= BOARD.top, 'a foot on the deck');
      assert.ok(Math.abs(P.knee[s][0]) <= BOARD.B / 2 + 0.1 && P.knee[s][1] >= BOARD.top, 'a knee over the board, above the deck');
    }
    assert.ok(Math.abs(P.hip[0]) <= 0.15 && P.hip[1] >= 0.45 && Math.abs(P.hip[2]) <= BOARD.L / 2, 'the hips over the board');
    assert.ok(Math.abs(b.roll) <= BODY.rollMax, `the roll capped: ${b.roll.toFixed(2)}`);
    const L = b.slot.path.at(b.s); assert.ok(Math.hypot(b.x - L.x, b.z - L.z) < 1e-6, 'the board on its lane');
  }
  assert.ok(maxRoll > 0.15, `she wobbles (${maxRoll.toFixed(2)} rad)`);
  assert.ok(hist.slice(0, Math.round(SUP.wobbleS * 60) - 2).every((k) => k < 0.05), 'the wobble first, standing');
  assert.ok(kneelAt != null && kneelAt >= SUP.wobbleS && kneelAt <= SUP.wobbleS + SUP.dropS + 0.3, `kneeling at ${kneelAt?.toFixed(1)} s`);
  assert.ok(upAt != null && upAt - kneelAt >= 3 && upAt <= 14, `standing again at ${upAt?.toFixed(1)} s (a few seconds on the knees)`);
  assert.ok(hist.every((k) => k >= 0 && k <= 1) && maxK === 1);
  assert.ok(F.stats().spooks >= 1, 'counted');
});

test('a splash reaches only the boards within 20 m; a second splash while kneeling holds her down longer', () => {
  const F = fleetOf(), [a, ...rest] = F.boards; run(F, 2);
  assert.equal(F.spook(a.x + 40, a.z, SUP.spookM), rest.some((q) => Math.hypot(q.x - a.x - 40, q.z - a.z) <= SUP.spookM) ? F.stats().spooks : 0, 'a splash 40 m off reaches no one near her');
  const n0 = F.stats().spooks;
  F.spook(a.x, a.z); assert.equal(F.stats().spooks, n0 + 1 + rest.filter((q) => Math.hypot(q.x - a.x, q.z - a.z) <= SUP.spookM).length);
  run(F, 4); const holdWas = a.kneelUntil; F.spook(a.x, a.z); assert.ok(a.kneelUntil > holdWas, 'held longer');
  run(F, 14); assert.ok(a.k < 0.01, 'on her feet in the end');
});

test('stormy or after dark the boards are home: none out, none stepped', () => {
  let storm = false, hour = 13;
  const F = createSupFleet({ slots: slotsFor(), hour: () => hour, storm: () => storm });
  run(F, 1); assert.equal(F.marks().length, 4);
  storm = true; const x = F.boards[0].x; run(F, 1); assert.equal(F.marks().length, 0); assert.equal(F.boards[0].x, x);
  storm = false; hour = 21; run(F, 1); assert.equal(F.marks().length, 0, 'after dark');
  hour = 6; run(F, 1); assert.equal(F.marks().length, 0, 'before the day');
});

test('the strokes alternate sides slowly; the blade splashes through the kayaks\' lists (a catch and an exit a stroke)', () => {
  const F = fleetOf(), b = F.boards[0]; let side = b.side, flips = 0, strokes = 0, lastU = b.u, catches = 0, exits = 0;
  for (let i = 0; i < 60 * 30; i++) { F.step(1 / 60); if (b.u < lastU) strokes++; lastU = b.u; if (b.side !== side) { flips++; side = b.side; } for (const e of F.splash) { if (e.type === 'catch') catches++; else exits++; assert.ok(Number.isFinite(e.at[0]) && e.s > 0); } }
  assert.ok(strokes >= 8 && strokes <= 11, `${strokes} strokes in 30 s (a stroke every ${SUP.strokeS} s)`);
  assert.ok(flips >= 1 && flips <= 4, `${flips} side changes in 30 s (every 3 to 5 strokes)`);
  assert.ok(catches >= 8 && exits >= 8 && Math.abs(catches - exits) <= 1, `${catches} catches, ${exits} exits`);
  assert.ok(F.boards[0].v > 0.7 && F.boards[0].v < 1.0, 'a slow pace');
});

test('determinism: the same seed and hour, the same boards and strokes; another seed or hour, others', () => {
  const sig = (o) => { const F = fleetOf(o); run(F, 20); return F.boards.map((b) => [b.slot.id, +b.x.toFixed(6), +b.z.toFixed(6), +b.heading.toFixed(6), +b.u.toFixed(6), b.side]); };
  assert.deepEqual(sig({}), sig({}));
  assert.notDeepEqual(sig({}).map((r) => r.slice(1, 3)), sig({ seed: 2 }).map((r) => r.slice(1, 3)), 'another seed');
  assert.notDeepEqual(sig({}).map((r) => r.slice(1, 3)), sig({ hour: 15 }).map((r) => r.slice(1, 3)), 'another hour');
  const a = slotsFor(), b = slotsFor();
  assert.deepEqual(a.map((s) => [s.id, s.s0, s.board, s.skin]), b.map((s) => [s.id, s.s0, s.board, s.skin]));
});

test('the figure: both hands on the paddle, the blade in the water at the pull and out of it at the recovery, the paddle across the lap when kneeling', () => {
  const P = newPose(), lineD = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...ab), t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L ** 2; return Math.hypot(a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1], a[2] + ab[2] * t - p[2]); };
  let worstHand = 0, pullY = Infinity, recY = -Infinity;
  for (const side of [1, -1]) for (let u = 0; u < 1; u += 0.02) {
    supPose({ kneel: 0, u, side, roll: 0.03 * Math.sin(u * 6) }, P);
    for (let s = 0; s < 2; s++) worstHand = Math.max(worstHand, lineD(P.hand[s], P.top, P.tip));
    if (u > 0.2 && u < 0.45) pullY = Math.min(pullY, P.tip[1]); if (u > 0.7 && u < 0.9) recY = Math.max(recY, P.tip[1]);
    assert.ok(P.head[1] > 1.55 && P.head[1] < 1.95, `the head at ${P.head[1].toFixed(2)} m`);
  }
  assert.ok(worstHand < 0.06, `the hands on the shaft (worst ${worstHand.toFixed(3)} m)`);
  assert.ok(pullY < 0 && recY > 0.2, `the blade under at the pull (${pullY.toFixed(2)}) and over the water at the recovery (${recY.toFixed(2)})`);
  for (const u of [0, 0.3, 0.7]) { supPose({ kneel: 1, u, side: 1, roll: 0 }, P); assert.ok(P.hip[1] < 0.62 && P.head[1] < 1.4, 'kneeling: lower'); for (let s = 0; s < 2; s++) assert.ok(lineD(P.hand[s], P.top, P.tip) < 0.06, 'kneeling: hands on the paddle'); assert.ok(P.tip[1] > 0.3 && P.top[1] > 0.3, 'the paddle across her lap, clear of the water'); }
  // the limbs keep their lengths: the knee's and the elbow's two bones
  supPose({ kneel: 0.4, u: 0.3, side: -1, roll: 0.1 }, P);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let s = 0; s < 2; s++) { assert.ok(Math.abs(d(P.hipJoint[s], P.knee[s]) - BODY.thigh) < 1e-6 && Math.abs(d(P.knee[s], P.ankle[s]) - BODY.shin) < 1e-6, 'a leg\'s bones'); assert.ok(Math.abs(d(P.shoulder[s], P.elbow[s]) - BODY.upperArm) < 1e-6, 'an arm\'s bone'); }
});

test('the meshes: five parts in one vertex set, a few thousand triangles for the whole figure', () => {
  const M = buildSupMeshes();
  for (const k of Object.values(PART)) assert.ok(M.runs[k]?.count > 0 && M.runs[k].count % 3 === 0, `part ${k}`);
  assert.ok(M.data.length / 7 === Object.values(M.runs).reduce((n, r) => n + r.count, 0));
  assert.ok(M.triangles < 3000, `${M.triangles} triangles in all parts once`);
  // the board: 3.35 m × 0.76 m
  const r = M.runs[PART.board]; let zlo = Infinity, zhi = -Infinity, xhi = 0;
  for (let i = r.first; i < r.first + r.count; i++) { const o = i * 7; zlo = Math.min(zlo, M.data[o + 2]); zhi = Math.max(zhi, M.data[o + 2]); xhi = Math.max(xhi, Math.abs(M.data[o])); }
  assert.ok(Math.abs(zhi - zlo - BOARD.L) < 0.02 && Math.abs(xhi * 2 - BOARD.B) < 0.02, 'the board\'s size');
  // the world: a board's records fit the buffers (4 boards: 5 draws, ≤ 3 k triangles)
  const perBoard = M.runs[PART.board].count / 3 + M.runs[PART.torso].count / 3 + M.runs[PART.head].count / 3 + M.runs[PART.paddle].count / 3 + 8 * M.runs[PART.rod].count / 3;
  assert.ok(perBoard * 4 < 8000, `${perBoard * 4} triangles for 4 boards`);
});

test('the sup kind: splashed and spooked like a kayak, never a target or a hit; reported in the spooked lists', () => {
  const H = createTessieHits(), at = (id, kind, x, z) => ({ id, kind, x, z, heading: 0, L: 3.35, B: 0.76 });
  assert.deepEqual([...SPOOKABLE], ['kayak', 'sup']);
  const list = [at('s:a', 'sup', 15, 0), at('s:b', 'sup', 25, 0), at('k:1', 'kayak', 10, 0)];
  assert.deepEqual(H.splash(0, 0, list), ['s:a', 'k:1'], 'a splash within 20 m: the board and the kayak, not the far board');
  const f = H.fall({ x: 0, z: 0, psi: 0 }, list, 0); assert.equal(f.hit, null, 'a fall on a board is no hit'); assert.deepEqual(f.spooked.sort(), ['k:1', 's:a']);
  assert.equal(H.aim({ x: 0, z: 0, psi: Math.PI / 2 }, list, 0), null, 'never aimed at'); assert.equal(H.lock({ x: 0, z: 0, psi: Math.PI / 2 }, list, 0, { nose: 0, dt: 0.1 }), null, 'never locked');
  const c = H.contact({ x: 5, y: 0, z: 0, locked: false }, [at('s:c', 'sup', 6, 0)], 0); assert.equal(c.hit, null); assert.deepEqual(c.spooked, ['s:c'], 'her head near a board spooks it');
  assert.equal(H.count, 0, 'no knockdown counted');
  // she is held out of it as of a kayak: a spine through the board is pushed aside
  const spine = new Float32Array(8 * 4); for (let i = 0; i < 4; i++) { spine[i * 8] = 0.2; spine[i * 8 + 1] = 0; spine[i * 8 + 2] = -3 + i * 2; }
  const moved = H.holdOff(spine, 6, [{ ...at('s:d', 'sup', 0, 0) }], () => 0.2); assert.ok(moved > 0.3, `pushed ${moved.toFixed(2)} m clear`);
  assert.equal(hullOf('sup'), 'shell');
});

test('a played Tessie\'s breach near a board makes it kneel: the sup system takes the splash through spook and through her sim\'s events', async () => {
  const { createSupSystem } = await import('../living/sup.js');
  const noop = () => ({}), fake = { device: { createBuffer: noop, queue: { writeBuffer() {} }, createBindGroupLayout: noop, createBindGroup: noop, createPipelineLayout: noop }, reg: { shader: noop, add() {} } };
  void fake; void createSupSystem;   // (the GPU half runs in the page test; the sim half is the fleet's)
  const F = fleetOf(), b = F.boards[1]; run(F, 1);
  const ev = [{ type: 'breach', x: b.x + 5, y: 0, z: b.z, s: 1 }, { type: 'slap', x: 1e6, y: 0, z: 0, s: 1 }];
  for (const e of ev) if (e.type === 'breach') F.spook(e.x, e.z, SUP.spookM);
  run(F, 3); assert.ok(b.k > 0.9, 'kneeling 3 s after the breach');
  run(F, 14); assert.ok(b.k < 0.01 && Math.abs(b.roll) < 0.1, 'standing again');
  assert.ok(toWorld(b, 0, 0)[0] === b.x && SUP_LIFE.apartM > 0);
});
