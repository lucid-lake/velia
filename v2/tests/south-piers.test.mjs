// The south shore's piers (owner, 2026-11-24: "near Heavenly there are also some piers, make sure we cover it"). Every pier, dock and
// breakwater of OpenStreetMap inside the south area (world x 7,000 to 14,500, z -1,500 to 3,000; data/geo/tahoe-towns.json) is in the
// drawn set for a south start: v2/assets/towns/shore-south.vsh.gz merged into the shared shore (v2/towns/format.js mergeShore), on
// pilings that reach the south level's bed (tools/v2-towns-pack.mjs). The file loads only on a start or a move into the south.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { decodeShore, mergeShore, shoreSetsFor, SHORE_SETS, inArea, MESH, CHUNK } from '../towns/format.js';
import { setsFor as buildingSets } from '../towns/buildings.js';
import { shoreArrays, pickDraws, RANGE } from '../render/towns.js';
import { inflate, unpredict, metres } from '../terrain/decode.js';
import { makeGeo } from '../../src/sim/geo.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { fromUTM } from '../../src/sim/geo/utm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (...p) => resolve(ROOT, ...p);
const AREA = SHORE_SETS.south.area;
const shore = (f) => decodeShore(gunzipSync(readFileSync(T('v2/assets/towns', f))));
const shared = shore('shore.vsh.gz'), phone = shore('shore-phone.vsh.gz'), south = shore(SHORE_SETS.south.file);
const drawn = mergeShore(shared, [south]);
const PIN = [11800, -875];

async function level(name) {
  const dir = T('terrain/south'), M = JSON.parse(readFileSync(resolve(dir, name), 'utf8')), L = M.levels[0];
  const q = unpredict(await inflate(readFileSync(resolve(dir, L.height))), L.w, L.h), m = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) m[i] = metres(q[i], M.height);
  return (x, z) => {
    const fx = Math.min(Math.max((x - L.x0) / L.step, 0), L.w - 1), fz = Math.min(Math.max((z - L.z0) / L.step, 0), L.h - 1);
    const i = Math.min(Math.floor(fx), L.w - 2), j = Math.min(Math.floor(fz), L.h - 2), u = fx - i, v = fz - j, k = j * L.w + i;
    return (m[k] * (1 - u) + m[k + 1] * u) * (1 - v) + (m[k + L.w] * (1 - u) + m[k + L.w + 1] * u) * v;
  };
}
const h4 = await level('south.json'), h8 = await level('south-phone.json');
const bed = (x, z) => Math.min(h4(x, z), h8(x, z)), top = (x, z) => Math.max(h4(x, z), h8(x, z));

// the instances of a mesh inside the area: [{ m (12 floats), x, z }]
const inst = (S, mesh) => { const out = [], k = S.meshes[mesh]; if (!k) return out; for (let i = k.first; i < k.first + k.count; i++) { const m = S.mats.subarray(i * 12, i * 12 + 12); if (inArea(AREA, m[9], m[11])) out.push(m); } return out; };

// every OSM pier segment in the area, converted by the game's own geo code (what v1's layout makes of the file: ≥ 0.5 m)
const data = JSON.parse(readFileSync(T('data/geo/tahoe-towns.json'), 'utf8')), geo = makeGeo(CURRENT_WATERS);
const SEGS = [];
for (const [way, p] of data.piers.entries()) {
  const pts = []; for (let k = 0; k < p.p.length; k += 2) { const g = fromUTM(p.p[k] + data.origin[0], p.p[k + 1] + data.origin[1]); pts.push(geo.lonLatToWorld(g.lon, g.lat)); }
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len >= 0.5 && inArea(AREA, (ax + bx) / 2, (az + bz) / 2)) SEGS.push({ ax, az, bx, bz, len, mx: (ax + bx) / 2, mz: (az + bz) / 2, kind: p.k, w: p.w, way });
  }
}

test('the south area holds the real piers: Ski Run, Timber Cove, Lakeside, El Dorado Beach, the Tahoe Keys', () => {
  assert.ok(SEGS.length >= 500, `${SEGS.length} OSM pier segments in the area`);
  // a way's length is the sum of its segments (a pier is one OSM way of 2 to 8 points)
  const wayLen = (way) => SEGS.filter((s) => s.way === way).reduce((t, s) => t + s.len, 0);
  const near = (x, z, r, minLen, kind = 0) => SEGS.some((s) => s.kind === kind && Math.hypot(s.mx - x, s.mz - z) < r && wayLen(s.way) >= minLen);
  assert.ok(near(12212, 367, 150, 150), 'Ski Run Marina: the 159 m pier (8 points)');
  assert.ok(near(11549, 597, 150, 250), 'Timber Cove: the 272 m pier');
  assert.ok(near(12875, -516, 150, 50) && near(12905, -697, 150, 100, 1), 'Lakeside Marina: its pier and its 143 m breakwater');
  assert.ok(near(9534, 1138, 100, 40), 'El Dorado Beach: the 51 m pier');
  assert.ok(SEGS.filter((s) => Math.hypot(s.mx - 8100, s.mz - 2000) < 700).length > 200, 'the Tahoe Keys: their docks');
});

test('every OSM pier segment in the south area is in the drawn set for a south start', () => {
  const boxes = inst(drawn, MESH.box);
  const at = new Map(); for (const m of boxes) at.set(`${Math.round(m[9] * 50)},${Math.round(m[11] * 50)}`, m);
  const missing = SEGS.filter((s) => { // a deck or a breakwater whose middle is this segment's middle (to 2 cm)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (at.has(`${Math.round(s.mx * 50) + dx},${Math.round(s.mz * 50) + dz}`)) return false;
    return true;
  });
  assert.equal(missing.length, 0, `${missing.length} of ${SEGS.length} segments not drawn, first ${JSON.stringify(missing[0])}`);
  assert.ok(boxes.length >= SEGS.length, `${boxes.length} boxes for ${SEGS.length} segments`);
  assert.equal(inst(south, MESH.box).length, SEGS.length, 'the south file: one box per segment (none inland: the lowest ground under each is under 8 m)');
});

test('a start outside the south draws none of them: the shared files hold no pier of the area', () => {
  for (const [name, S] of [['shore', shared], ['shore-phone', phone]]) assert.equal(inst(S, MESH.box).length + inst(S, MESH.pile).length, 0, `${name}.vsh holds no instance in the south area`);
  assert.equal(south.meshes.length, 2, 'the south file: the box and the piling meshes only');
});

test('the load rule: the file is for a start or a move into the south, never for the bay', () => {
  assert.deepEqual(shoreSetsFor(...PIN), ['south'], 'the Ski Run pin');
  assert.deepEqual(shoreSetsFor(12453, 166), ['south'], 'Ski Run Marina');
  assert.deepEqual(shoreSetsFor(1200, -1050), [], 'Emerald Bay');
  assert.deepEqual(shoreSetsFor(300, -400), [], 'the mouth');
  assert.deepEqual(shoreSetsFor(NaN, NaN), []);
  // the same trigger as the buildings' south set: the region's detail loads together
  for (const [x, z] of [PIN, [1200, -1050], [300, -400], [5900, 1500], [20000, 0]]) assert.equal(shoreSetsFor(x, z).length > 0, buildingSets(x, z).includes('south'), `(${x}, ${z})`);
  // what it costs: the file is one request, a fraction of the south level's 2.26 MB
  const bytes = readFileSync(T('v2/assets/towns', SHORE_SETS.south.file)).length;
  assert.ok(bytes < 100e3, `${bytes} B on the wire (gzip)`);
});

test('mergeShore keeps the base and adds the extra instances in chunk order', () => {
  assert.equal(drawn.instances, shared.instances + south.instances);
  for (const k of [MESH.box, MESH.pile]) assert.equal(drawn.meshes[k].count, shared.meshes[k].count + south.meshes[k].count);
  for (const k of [MESH.roof, MESH.tower, MESH.harbour, MESH.rock]) assert.equal(drawn.meshes[k].count, shared.meshes[k].count);
  assert.equal(drawn.meshes[MESH.box].verts, shared.meshes[MESH.box].verts);
  drawn.meshes.forEach((m) => { let prev = -Infinity; for (let i = m.first; i < m.first + m.count; i++) { const key = Math.floor(drawn.mats[i * 12 + 11] / CHUNK) * 100000 + Math.floor(drawn.mats[i * 12 + 9] / CHUNK); assert.ok(key >= prev); prev = key; } });
  // the GPU arrays take it whole
  const A = shoreArrays(drawn);
  assert.equal(A.inst.byteLength, drawn.instances * 52);
  assert.equal(A.chunks[MESH.pile].reduce((s, c) => s + c.count, 0), drawn.meshes[MESH.pile].count);
});

test('from the Ski Run pin the south piers draw (desktop and phone ranges), the piles only when near', () => {
  const eye = [PIN[0], 3, PIN[1]], count = (draws, mesh) => draws.filter((d) => d[0] === mesh).reduce((s, d) => s + d[2], 0);
  const A = shoreArrays(drawn), B = shoreArrays(shared);
  for (const [name, R] of [['desktop', RANGE.desktop], ['phone', RANGE.phone]]) {
    // the whole area is within 5 km of the pin: every south deck and breakwater is in range, on top of what the shared file draws
    const gain = count(pickDraws(A, eye, null, R), MESH.box) - count(pickDraws(B, eye, null, R), MESH.box);
    assert.equal(gain, SEGS.length, `${name}: the south boxes drawn at the pin`);
  }
  // the pilings: v2's own range (desktop 1.5 km, phone 0.7 km): Ski Run Marina's pier (1.3 km from the pin) is in the desktop's
  const pileGain = (R) => count(pickDraws(A, eye, null, R), MESH.pile) - count(pickDraws(B, eye, null, R), MESH.pile);
  assert.ok(pileGain(RANGE.desktop) > 0, 'desktop: pilings drawn at the pin');
  const nearMarina = pickDraws(A, [12100, 3, 400], null, RANGE.phone);
  assert.ok(count(nearMarina, MESH.pile) - count(pickDraws(B, [12100, 3, 400], null, RANGE.phone), MESH.pile) > 20, 'phone: pilings drawn off Ski Run Marina');
});

test('grounding: every piling reaches the bed of both south levels; decks clear the lake and the beach', () => {
  const piles = inst(south, MESH.pile);
  assert.equal(piles.length, south.meshes[MESH.pile].count);
  let worst = Infinity, short = Infinity;
  for (const m of piles) { // the unit piling is 1 m tall about its origin
    const sy = m[4], foot = m[10] - sy / 2, b = bed(m[9], m[11]);
    worst = Math.min(worst, b - foot); short = Math.min(short, sy);
    assert.ok(foot <= b - 0.3, `a piling at (${m[9].toFixed(1)}, ${m[11].toFixed(1)}) ends ${(foot - b).toFixed(2)} m over the bed`);
    assert.ok(foot >= b - 1.0, `a piling at (${m[9].toFixed(1)}, ${m[11].toFixed(1)}) sinks ${(b - foot).toFixed(2)} m under the bed`);
  }
  assert.ok(short > 0.3);
  // decks: the underside at samples along the centre line, over water and over the beach
  let waterUnder = Infinity, buried = -Infinity, nDecks = 0;
  for (const m of inst(south, MESH.box)) {
    const len = Math.hypot(m[0], m[1], m[2]), th = Math.hypot(m[3], m[4], m[5]);
    if (th > 1) continue;   // a breakwater: its toe reaches the bed
    nDecks++;
    const u = [m[0] / len, m[1] / len, m[2] / len], n = Math.max(2, Math.ceil(len / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5, x = m[9] + u[0] * len * t, y = m[10] + u[1] * len * t, z = m[11] + u[2] * len * t, g = top(x, z), under = y - th / 2;
      buried = Math.max(buried, g - under);
      if (bed(x, z) < -0.3) waterUnder = Math.min(waterUnder, under);
    }
  }
  assert.ok(nDecks > 500);
  assert.ok(waterUnder > 1.0, `over water the deck's underside is ${waterUnder.toFixed(2)} m over the lake`);
  assert.ok(buried < 0.1, `the ground is at most ${buried.toFixed(2)} m over a deck's underside`);
  // breakwaters: the toe reaches the bed
  for (const m of inst(south, MESH.box)) {
    const th = Math.hypot(m[3], m[4], m[5]); if (th <= 1) continue;
    const len = Math.hypot(m[0], m[1], m[2]), u = [m[0] / len, m[2] / len];
    for (const t of [-0.5, 0, 0.5]) assert.ok(m[10] - th / 2 <= Math.min(0, bed(m[9] + u[0] * len * t, m[11] + u[1] * len * t)) - 0.3, 'a breakwater toe over the bed');
  }
});
