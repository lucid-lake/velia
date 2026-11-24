// Channel markers (BACKLOG "Channel markers", owner 2026-11-17, go 2026-11-18; v2/sim/channelMarks.js, channelMarks.json;
//): the data (each row's public source, the US lateral convention, the buoys in water on our bed),
// the lamps' patterns, the planner and AUTO passing the channel on its starboard side between the buoys, and a bump.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { OUT } from '../../tools/v2-plan-bake.mjs';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createAutoNav } from '../sim/autoNav.js';
import { createBoatSim, waterFor, START } from '../sim/boat.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { findPath } from '../../src/sim/modes/chill/navigator.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { lonLatToWorld } from '../../src/sim/geo.js';
import { resolveMarks, parseLight, lightLevel, markLights, createMarkBodies, markPose, KEEP_RIGHT_M, SHAPES, RODE } from '../sim/channelMarks.js';
import { GLOW_FLOATS } from '../sim/night.js';

const DATA = JSON.parse(readFileSync(new URL('../sim/channelMarks.json', import.meta.url), 'utf8'));
const WORLD = JSON.parse(readFileSync(new URL('../cruise/chartWorld.json', import.meta.url), 'utf8'));
const MARKS = resolveMarks(DATA, { waters: 'tahoe-emerald', channel: CHANNEL, lonLatToWorld });
const chart = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(OUT)))), chartInputs(WORLD), { marks: MARKS });
const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
const LAT = MARKS.filter((m) => m.type === 'lateral');
const byId = Object.fromEntries(MARKS.map((m) => [m.id, m]));
// the lateral pairs (gates) by their station along the channel: [red, green]
const GATES = [['R2', 'G1'], ['R4', 'G3'], ['R6', 'G5']].map(([r, g]) => [byId[r], byId[g]]);

// signed offset (m) of a point from the channel's line, + to starboard of a boat going along it the way dir says (+1 toward the lake)
function sideOf(x, z, dir) {
  const c = channelAt(x, z), P = CHANNEL.pts;
  let run = 0;
  for (let i = 1; i < P.length; i++) {
    const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
    if (c.along <= run + L + 1e-6 || i === P.length - 1) { const t = (c.along - run) / L, px = P[i - 1][0] + dx * t, pz = P[i - 1][1] + dz * t; return ((x - px) * (-dz / L) + (z - pz) * (dx / L)) * dir; }
    run += L;
  }
  return 0;
}
const crosses = (a, b, p, q) => { const o = (u, v, w) => Math.sign((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])); return o(a, b, p) !== o(a, b, q) && o(p, q, a) !== o(p, q, b); };
const throughGate = (track, [r, g]) => track.some((p, i) => i > 0 && crosses(track[i - 1], p, [r.x, r.z], [g.x, g.z]));

test('the data: every row has a public source (url, date, licence), the real buoys keep their OpenSeaMap place beside the placed one', () => {
  const W0 = DATA.waters['tahoe-emerald'];
  assert.ok(W0.marks.length >= 6 && MARKS.length === W0.marks.length, 'every row resolves to a place');
  for (const m of W0.marks) {
    const s = DATA.sources[m.src];
    assert.ok(s, `${m.id}: its source ${m.src} is listed`);
    assert.match(s.accessed, /^\d{4}-\d{2}-\d{2}$/, `${m.id}: the date read`);
    assert.ok(s.licence, `${m.id}: a licence`);
    if (m.src !== 'geometry') assert.match(s.url, /^https:\/\//, `${m.id}: a public link`);
  }
  for (const m of MARKS.filter((q) => q.osm)) {
    const [x, z] = lonLatToWorld(m.osm[1], m.osm[0]);
    assert.ok(Math.hypot(x - m.x, z - m.z) < 80, `${m.id}: within 80 m of OpenSeaMap's spot (${Math.hypot(x - m.x, z - m.z).toFixed(0)} m)`);
  }
  assert.equal(MARKS.filter((m) => m.light).length, 2, 'the two lighted buoys (1 and 2) carry lamps');
});

test('the US lateral convention: red to starboard entering from the lake, green to port; even numbers red, odd green, rising from the lake', () => {
  for (const m of LAT) {
    const s = sideOf(m.x, m.z, -1);   // entering: toward the bay
    if (m.colour === 'red') assert.ok(s > 20, `${m.id} red to starboard entering (${s.toFixed(1)} m)`);
    else assert.ok(s < -20, `${m.id} green to port entering (${s.toFixed(1)} m)`);
    assert.equal(Number(m.number) % 2, m.colour === 'red' ? 0 : 1, `${m.id}: ${m.colour} carries ${m.colour === 'red' ? 'even' : 'odd'}`);
  }
  const along = (id) => channelAt(byId[id].x, byId[id].z).along;
  assert.ok(along('G1') > along('G3') && along('G3') > along('G5'), 'the numbers rise from the lake end inward');
});

test('every buoy floats in water on our bed: the lateral ones at the channel\'s edges (≥ 3 m), the no-wake buoys inside the bay', () => {
  for (const m of MARKS) {
    const d = -W.terrain.heightAt(m.x, m.z);
    assert.ok(d >= 3, `${m.id}: ${d.toFixed(2)} m of water`);
    assert.ok(-W.terrain.shoreDistance(m.x, m.z) > 30, `${m.id}: off the shore`);
  }
  for (const m of LAT) { const c = channelAt(m.x, m.z); assert.ok(c.d > CHANNEL.coreHalfM && c.d < CHANNEL.coreHalfM + 10, `${m.id}: just past the floor's edge (${c.d.toFixed(1)} m off the line)`); }
  for (const m of MARKS.filter((q) => q.type === 'noWake')) assert.equal(chart.channelSide([m.x, m.z]), 'bay', `${m.id}: inside the bay`);
  assert.ok(MARKS.filter((q) => q.type === 'noWake').every((m) => chart.buoys.some(([x, z]) => Math.hypot(x - m.x, z - m.z) < 0.5)), 'the no-wake buoys are on the navigator\'s buoys');
});

test('the lamps flash in their light-list patterns (deterministic), only at night', () => {
  const g = parseLight('Fl G 4s'), r = parseLight('Fl R 2.5s'), q = parseLight('Fl(2) W 6s');
  assert.equal(g.period, 4); assert.equal(g.colour, 'G'); assert.equal(r.period, 2.5); assert.equal(q.on.length, 2);
  assert.equal(parseLight('nonsense'), null);
  const duty = (L) => { let on = 0, n = 0; for (let t = 0; t < 60; t += 0.005, n++) on += lightLevel(L, t, 0.3) > 0.5 ? 1 : 0; return on / n; };
  assert.ok(Math.abs(duty(g) - 0.1) < 0.01, `Fl 4s: one 0.4 s flash (${duty(g).toFixed(3)})`);
  assert.ok(Math.abs(duty(r) - 0.12) < 0.01, `Fl 2.5s: one 0.3 s flash (${duty(r).toFixed(3)})`);
  assert.ok(Math.abs(duty(q) - 0.8 / 6) < 0.01, `Fl(2) 6s: two 0.4 s flashes (${duty(q).toFixed(3)})`);
  assert.equal(lightLevel(g, 1.234, 0.5), lightLevel(g, 1.234, 0.5), 'deterministic');
  const out = new Float32Array(20 * GLOW_FLOATS);
  let lit = 0, max = 0;
  for (let t = 0; t < 8; t += 0.05) { const n = markLights(out, 0, MARKS, { t, sunElevDeg: -10 }); lit += n > 0 ? 1 : 0; max = Math.max(max, n); }
  assert.ok(lit > 0 && max <= 2, `at night the two lamps flash (${lit} of 160 steps lit, at most ${max} at once)`);
  for (let t = 0; t < 8; t += 0.05) assert.equal(markLights(out, 0, MARKS, { t, sunElevDeg: 20 }), 0, 'by day none');
  // the glow sits at the lamp, over its buoy
  const t1 = (() => { for (let t = 0; t < 8; t += 0.01) if (markLights(out, 0, MARKS, { t, sunElevDeg: -10 }) > 0) return t; return null; })();
  assert.ok(t1 != null); const m = MARKS.find((k) => k.light && Math.abs(out[0] - k.x) < 0.01);
  assert.ok(m, 'the glow at a lit buoy'); assert.ok(Math.abs(out[1] - SHAPES.lighted.lampY) < 1e-5);
});

test('the planner lays the channel on its starboard side, through every gate, either way', () => {
  const from = [START.x, START.z], to = [12600, -12000];
  for (const [a, b, dir] of [[from, to, 1], [to, from, -1]]) {
    const P = findPath(chart, a, b);
    assert.ok(P, 'a route');
    const fine = []; for (let i = 1; i < P.length; i++) { const n = Math.ceil(Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) / 4); for (let k = 0; k <= n; k++) fine.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k / n, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k / n]); }
    for (const gt of GATES) assert.ok(throughGate(fine, gt), `${dir > 0 ? 'out' : 'in'}: between ${gt[0].id} and ${gt[1].id}`);
    const inLane = fine.filter(([x, z]) => { const c = channelAt(x, z); return c.d < 30 && c.along > 120 && c.along < 420; });
    assert.ok(inLane.length > 40, 'down the channel');
    const off = inLane.map(([x, z]) => sideOf(x, z, dir)), mean = off.reduce((s, v) => s + v, 0) / off.length;
    assert.ok(Math.abs(mean - KEEP_RIGHT_M) < 1.5 && Math.min(...off) > 3, `${dir > 0 ? 'out' : 'in'}: ${mean.toFixed(1)} m to starboard (least ${Math.min(...off).toFixed(1)} m)`);
    let clear = Infinity; for (const p of fine) for (const m of LAT) clear = Math.min(clear, Math.hypot(p[0] - m.x, p[1] - m.z));
    assert.ok(clear > 12, `${clear.toFixed(1)} m off the nearest buoy`);
  }
});

// AUTO through the channel: her track, the least distance to a buoy, her side
function autoRun({ start, target, motor = false, secs = 360 }) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start });
  if (motor) { B.phys.engine.start(); B.phys.engine.setLever(0.7); B.ctl.furl = 1; }
  const A = createAutoNav({ B, chart });
  assert.deepEqual(A.engage({ x: target[0], z: target[1], name: 'mark' }), { ok: true });
  const track = [], offs = []; let clear = Infinity, shoal = Infinity;
  for (let i = 0; i < 60 * secs; i++) {
    B.step(1 / 60, null, 1 / 60); const s = B.phys.state;
    if (i % 15 === 0) {
      track.push([s.x, s.z]); shoal = Math.min(shoal, -W.terrain.heightAt(s.x, s.z));
      for (const m of LAT) clear = Math.min(clear, Math.hypot(s.x - m.x, s.z - m.z));
      if (A.inChannel) offs.push({ x: s.x, z: s.z });
    }
    if (track.length > 2 && GATES.every((g) => throughGate(track, g)) && channelAt(s.x, s.z).d > 80) break;
  }
  return { track, offs, clear, shoal };
}
test('AUTO sails out of the bay between the buoys, on the channel\'s starboard side, clear of every buoy', () => {
  const r = autoRun({ start: START, target: [1900, -1900] });
  for (const gt of GATES) assert.ok(throughGate(r.track, gt), `between ${gt[0].id} and ${gt[1].id}`);
  const side = r.offs.filter((s) => { const a = channelAt(s.x, s.z).along; return a > 120 && a < 420; }).map((s) => sideOf(s.x, s.z, 1));
  const mean = side.reduce((s, v) => s + v, 0) / side.length;
  assert.ok(side.length > 10 && mean > 2.5, `to starboard of the line (${mean.toFixed(1)} m on average)`);
  assert.ok(r.clear > 10, `the nearest buoy ${r.clear.toFixed(1)} m off`); assert.ok(r.shoal >= 3, `${r.shoal.toFixed(2)} m under her`);
});
test('AUTO motors into the bay from the lake between the buoys, red to starboard, clear of every buoy', () => {
  const r = autoRun({ start: { ...START, x: 1760, z: -1420, heading: -2.4 }, target: [700, -600], motor: true });
  for (const gt of GATES) assert.ok(throughGate(r.track, gt), `between ${gt[0].id} and ${gt[1].id}`);
  const side = r.offs.filter((s) => { const a = channelAt(s.x, s.z).along; return a > 120 && a < 420; }).map((s) => sideOf(s.x, s.z, -1));
  const mean = side.reduce((s, v) => s + v, 0) / side.length;
  assert.ok(side.length > 5 && mean > 2.5, `to starboard of the line, the red side (${mean.toFixed(1)} m on average)`);
  assert.ok(r.clear > 10, `the nearest buoy ${r.clear.toFixed(1)} m off`); assert.ok(r.shoal >= 3, `${r.shoal.toFixed(2)} m under her`);
});

test('a bump: the hull meets a buoy, she loses way, the buoy is shoved and swings back on its rode, one thud, never inside', () => {
  const m = { id: 'T', shape: 'can', x: 0, z: -12 }, bumps = [];
  const bodies = createMarkBodies([m], { onBump: (e) => bumps.push(e) });
  const S = { x: 0.5, z: 0, heading: 0, u: 2.2, v: 0, yawRate: 0 };   // north at 2.2 m/s (4.3 kn), the buoy 12 m ahead, a little to port
  let worst = Infinity, maxOff = 0, uMin = S.u;
  for (let i = 0, t = 0; i < 60 * 40; i++, t += 1 / 60) {
    const dt = 1 / 60, sh = Math.sin(S.heading), ch = Math.cos(S.heading);
    S.x += (S.u * sh + S.v * ch) * dt; S.z += (-S.u * ch + S.v * sh) * dt; S.heading += S.yawRate * dt;
    if (i > 60 * 12) { S.u *= 0.98; S.v *= 0.98; S.yawRate *= 0.98; }   // past the buoy, she coasts to a stop away from it
    bodies.post(S, dt, t);
    const b = bodies.bodies[0];
    worst = Math.min(worst, bodies.gap(S)); maxOff = Math.max(maxOff, Math.hypot(b.x - b.x0, b.z - b.z0)); if (i < 60 * 12) uMin = Math.min(uMin, S.u);
  }
  const b = bodies.bodies[0];
  assert.equal(bumps.length, 1, 'one bump, one thud'); assert.ok(bumps[0].speed > 0.5, `the thud's speed ${bumps[0].speed.toFixed(2)} m/s`);
  assert.ok(uMin < 2.15, `she lost way (${uMin.toFixed(2)} m/s: a 160 kg buoy against her 3.8 t)`);
  assert.ok(worst > -0.03, `never inside the hull (${worst.toFixed(3)} m)`);
  assert.ok(maxOff > 0.3 && maxOff <= RODE.maxOff + 1e-6, `shoved ${maxOff.toFixed(2)} m, at most the rode's swing`);
  assert.ok(Math.hypot(b.x - b.x0, b.z - b.z0) < 0.2, 'back on its station');
  // its pose on a sloping sea leans downslope, within the cap
  const p = markPose({ x: 0, z: 0, vx: 0, vz: 0 }, (x) => 0.1 * x);
  assert.ok(Math.abs(Math.cos(p.yaw) + 1) < 1e-6 && p.heel > 0.05 && p.heel <= 0.32, 'tilted toward the low side');
});

test('the chart: every buoy in its symbol, the lit ones labelled with their number and light, the red\'s label west, the green\'s east', async () => {
  const { drawAidMarks } = await import('../../src/ui/chartplotter.js');
  const noop = () => {}, g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => { o[k] = v; return true; } });
  const view = { toPx: (x, z, P) => { P[0] = x; P[1] = z; return P; } };
  const labels = [];
  const drawn = drawAidMarks(g, view, MARKS, { label: (t, x, y, align) => labels.push({ t, x, align }) });
  assert.equal(drawn.length, MARKS.length, 'every buoy drawn');
  assert.deepEqual(labels.map((l) => l.t).sort(), ['"1" Fl G 4s', '"2" Fl R 2.5s']);
  assert.equal(labels.find((l) => l.t.startsWith('"2"')).align, 'right'); assert.equal(labels.find((l) => l.t.startsWith('"1"')).align, 'left');
  assert.equal(drawAidMarks(g, view, MARKS, { near: () => false }).length, 0, 'none outside the chart\'s range');
});
