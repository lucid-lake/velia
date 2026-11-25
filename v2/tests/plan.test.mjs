// The passage plan on v2 (feat(v2): the passage plan; ui/plan.js, ui/planChart.js, tools/v2-plan-bake.mjs). v1's planner
// (src/sail/passagePlan.js) runs as it is on both: on v1 with v1's terrain (createPlanner builds its chart from core.terrain,
// v1's Sail path), on v2 with the chart built from the baked grid and the baked chart rows. Checked here:
//   the bake is current (the committed grid equals a fresh bake from v1's terrain);
//   the chart: inside the bay, v1's A* grid cell for cell, the margins, comfort, depth and the shore's sign at 30 000 points (the
//     whole lake past it: v2/tests/lakeChart.test.mjs);
//   the planner: the same three taps give the same route (each checked by the navigator's rules) and the same legs (bearing,
//     distance, the A* bend round the island, the point of sail, tacks, minutes) and the same sheet rows on both;
//   the course: Set course, the passage block's WP 1 · 3, the leg advancing within 40 m (WP 2 · 3, then the name-free last),
//     the skipper's lines, Clear; the first-time line under 'lakeshore.passage.v1' (once per browser);
//   Cruise: the course steps aside (suspended), taps do nothing, Sail brings it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { planBakeCurrent, OUT } from '../../tools/v2-plan-bake.mjs';
import { decodePlanGrid, planChart, SHORE } from '../ui/planChart.js';
import { mountPlan } from '../ui/plan.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createPlanner, ensureCourse } from '../../src/sail/passagePlan.js';
import { sheetRows } from '../../src/sail/passageSheet.js';
import { createPassage } from '../../src/ui/passage.js';
import { createServices } from '../../src/sim/core/services.js';
import { makeTerrain } from './helpers/ground.mjs';   // v2's own lake (v2/sim/lake.js over v2/terrain/sample.js, the lake-wide shore grids)
import { makeGeo } from '../../src/sim/geo.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { loadTownsData, buildTownsLayout } from '../../classic/src/towns-layout.js';
import { layoutShoreline } from '../../src/shoreline-layout.js';
import { harbourLayout } from '../../src/harbour-layout.js';
import { buildChart } from '../../src/sim/modes/chill/navigator.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';

const DEG = Math.PI / 180;
const WORLD = JSON.parse(readFileSync(new URL('../cruise/chartWorld.json', import.meta.url), 'utf8'));

// a tiny DOM for the plan sheet (createPassageSheet: a style, a div, innerHTML, classList)
function fakeDoc() {
  const mk = (tag) => { const set = new Set(); const n = { tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, innerHTML: '', textContent: '',
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, prepend(c) { this.children.unshift(c); return c; }, appendChild(c) { this.children.push(c); return c; },
    remove() {}, getBoundingClientRect: () => ({ left: 100, top: 100, right: 700, bottom: 700, width: 600, height: 600 }) };
    Object.defineProperty(n, 'className', { get: () => [...set].join(' '), set: (v) => { set.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) set.add(c); } });
    return n; };
  const head = mk('head'), body = mk('body');
  return { head, body, documentElement: mk('html'), createElement: mk, getElementById: (id) => head.children.find((c) => c.id === id) ?? null };
}
globalThis.document ??= fakeDoc();
globalThis.innerWidth ??= 1280; globalThis.innerHeight ??= 800;
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

// the enlarged chart as the planner reads it: its route layer (setRoute) and whether the big pane is in
function fakeCp() {
  const big = { classList: { contains: (c) => c === 'in' && cp.bigIn }, getBoundingClientRect: () => ({ left: 100, top: 100, right: 700, bottom: 700, width: 600, height: 600 }) };
  const cp = { bigIn: false, routes: [], el: { querySelector: (s) => (s === '.big' ? big : null) }, setRoute(r, o) { cp.routes.push({ r, o }); } };
  return cp;
}
// a boat at rest-ish in the bay's west basin, 6 m/s of wind from 200°
const boatAt = (x, z) => ({ x, z, heading: 20 * DEG, sog: 2, cog: 20 * DEG, trueWind: { speed: 6, angle: 180 * DEG }, heel: 0 });

let v1World = null;
async function v1() {
  if (v1World) return v1World;
  const T = makeTerrain({ seed: 1 });
  const towns = buildTownsLayout(await loadTownsData(), { heightAt: T.heightAt, lonLatToWorld: makeGeo(CURRENT_WATERS).lonLatToWorld });
  const L = layoutShoreline(T, { seed: 1, realPiers: towns.osmPiers });   // v1's page (src/core/world.js)
  const H = { ...harbourLayout({ terrain: T, seed: 1 }), boats: [] };     // the slips empty, as the game's
  return (v1World = { T, L, H });
}
const grid = () => decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(OUT))));
const v2Chart = () => planChart(grid(), chartInputs(WORLD));

test('the bake is current: the committed grid equals a fresh bake from v1\'s terrain', async () => {
  assert.equal(await planBakeCurrent(), true, 'run node tools/v2-plan-bake.mjs');
  const g = grid();
  for (const L of Object.values(g.levels)) assert.equal(L.shore.length, L.nx * L.nz);
  assert.deepEqual(Object.keys(g.levels), ['bay', 'lake']); assert.equal(g.shoreLo, SHORE.lo); assert.equal(g.shoreHi, SHORE.hi);
});

test('the chart: inside the bay v1\'s A* grid cell for cell, and the margins, comfort, depth and the shore\'s sign v1\'s at 30 000 points', async () => {
  const { T, L, H } = await v1();
  const a = buildChart(T, { shoreline: L, harbour: H, lanes: [] }), b = v2Chart(), bay = b.bay;
  assert.deepEqual(bay.region, a.region);
  assert.equal(b.objects.length, a.objects.length); assert.deepEqual(b.gates, a.gates);
  assert.equal(bay.grid.cost.length, a.grid.cost.length);
  let diff = 0; for (let i = 0; i < a.grid.cost.length; i++) if (a.grid.cost[i] !== bay.grid.cost[i]) diff++;
  assert.equal(diff, 0, `${diff} A* cells differ`);
  let n = 0;
  for (let z = -1990; z < 1790; z += 23) for (let x = -1290; x < 1690; x += 17, n++) {
    if (channelAt(x, z).d <= CHANNEL.coreHalfM) continue;   // the entrance channel's floor: its lane's keel rule (ui/planChart.js), v2's own
    assert.equal(b.depthAt(x, z), a.depthAt(x, z), `depth at ${x}, ${z}`);
    assert.equal(Math.sign(b.shoreAt(x, z)), Math.sign(a.shoreAt(x, z)), `shore's sign at ${x}, ${z}`);
    const ma = a.marginAt(x, z), mb = b.marginAt(x, z);
    assert.equal(Math.sign(mb), Math.sign(ma), `margin's sign at ${x}, ${z}`);
    if (ma >= 0) { assert.equal(mb, ma, `margin at ${x}, ${z}`); assert.equal(b.comfortAt(x, z), a.comfortAt(x, z), `comfort at ${x}, ${z}`); }
  }
  assert.ok(n > 28000, `${n} points`);
});

// three taps on the enlarged chart: west of the island to the east basin (A* bends round the island), up the bay, back south
const TAPS = [{ op: 'add', x: 300, z: -300, name: null }, { op: 'add', x: 900, z: -800, name: null }, { op: 'add', x: 600, z: -400, name: null }];
const START = [-350, 150];

function run(planner, course, state) {
  for (const p of TAPS) planner.pick({ ...p, index: course.route.length });
  return { route: course.route, plan: planner.plan };
}
const legKeys = (P) => P.legs.map((L) => ({ ok: L.ok, brg: L.brg, nm: L.nm, distNm: L.distNm, point: L.point, twa: L.twa, tacks: L.tacks, gybes: L.gybes, minutes: L.minutes, path: L.path, bend: L.bend, gate: L.gate }));

test('the planner: the same taps give v1\'s route and legs (the bend round the island, tacks, minutes) and v1\'s sheet rows', async () => {
  const { T, L, H } = await v1();
  // v1: Sail's createPlanner, its chart from core.terrain (src/sail/chart.js passes no navChart in Sail)
  const s1 = createServices(), st1 = boatAt(...START); s1.provide('player', { phys: { state: st1 } }); s1.provide('passage', createPassage({ services: s1 }));
  const c1 = ensureCourse(s1), cp1 = fakeCp(), said1 = [];
  const p1 = createPlanner({ core: { services: s1, flags: {}, terrain: T, shoreline: { layout: L }, harbour: { layout: H }, time: 0 }, cp: cp1, course: c1, say: (t) => said1.push(t) });
  p1.update(1 / 60);   // the wind's mean starts
  p1.recompute();
  // v2: ui/plan.js on the baked chart
  const s2 = createServices(), st2 = boatAt(...START); s2.provide('player', { phys: { state: st2 } }); s2.provide('passage', createPassage({ services: s2 }));
  const cp2 = fakeCp(), said2 = [];
  const plan = mountPlan({ services: s2, cp: cp2, chartP: v2Chart(), say: (t) => said2.push(t) });
  await plan.ready;
  plan.update(1 / 60); plan.planner.recompute();
  const A = run(p1, c1, st1), B = run(plan.planner, plan.course, st2);
  assert.equal(A.route.length, 3, `v1 took the three taps: ${said1.join(' | ')}`);
  assert.deepEqual(B.route, A.route, 'the same route (the navigator\'s checks)');
  assert.deepEqual(legKeys(B.plan), legKeys(A.plan), 'the same legs');
  assert.ok(A.plan.legs[0].path?.length > 2 && A.plan.legs[0].bend, 'leg 1 bends round the island');
  assert.deepEqual(B.plan.notes, A.plan.notes);
  assert.deepEqual(sheetRows(B.plan), sheetRows(A.plan));
  assert.equal(sheetRows(B.plan).title, 'Passage · 3 legs');
  assert.deepEqual(said2, said1);
  // the route layer the chart draws: the same points, a draft (active −1), the plan for the bends
  const last = cp2.routes.at(-1);
  assert.equal(last.r.length, 3); assert.equal(last.o.active, -1); assert.ok(last.o.plan?.legs?.length === 3);
  // a tap on dry land: refused with the navigator's words, the route unchanged, the same on both
  const p0 = { op: 'add', x: -900, z: 300 }; p1.pick({ ...p0, index: 3 }); plan.pick({ ...p0, index: 3 });
  assert.equal(plan.course.route.length, 3); assert.deepEqual(said2, said1); assert.match(said2.at(-1), /dry land/);
  // a tap past v1's chart (the open lake east of the bay): v1 "off my chart"; v2 charts the whole lake and the entrance channel,
  // so it is a waypoint there
  const p5 = { op: 'add', x: 5000, z: 0 }; p1.pick({ ...p5, index: 3 }); plan.pick({ ...p5, index: 3 });
  assert.match(said1.at(-1), /off my chart/); assert.equal(plan.course.route.length, 4, `v2: ${said2.at(-1)}`);
});

test('the course: Set course, WP 1 · 3 in the passage block, the leg advancing on arrival, the last waypoint, Clear', async () => {
  const s = createServices(), st = boatAt(...START); s.provide('player', { phys: { state: st } });
  const passage = createPassage({ services: s }); s.provide('passage', passage);
  const cp = fakeCp(), said = [];
  const plan = mountPlan({ services: s, cp, chartP: v2Chart(), say: (t) => said.push(t) });
  await plan.ready; plan.update(1 / 60);
  for (const p of TAPS) plan.pick({ ...p, index: plan.course.route.length });
  assert.equal(passage.target, null, 'a draft is not in force');
  plan.pick({ op: 'set' });
  assert.equal(plan.course.active, true); assert.equal(plan.course.leg, 0);
  assert.equal(passage.target.name, 'WP 1 · 3'); assert.deepEqual(passage.from, START);
  assert.match(said.at(-1), /^Course set\. Waypoint 1 bears \d{3}°, \d\.\d nm\./);
  assert.equal(cp.routes.at(-1).o.active, 0);
  // not yet there: nothing moves
  st.x = 300 - 60; st.z = -300; plan.update(1 / 60); assert.equal(plan.course.leg, 0);
  // within 40 m of waypoint 1: the next leg, from waypoint 1
  const w = plan.course.route;
  st.x = w[0].x + 25; st.z = w[0].z; plan.update(1 / 60);
  assert.equal(plan.course.leg, 1); assert.equal(passage.target.name, 'WP 2 · 3'); assert.deepEqual(passage.from, [w[0].x, w[0].z]);
  assert.match(said.at(-1), /^Waypoint 1 astern\. Next bears \d{3}°/);
  st.x = w[1].x; st.z = w[1].z + 30; plan.update(1 / 60);
  assert.equal(passage.target.name, 'WP 3 · 3');
  st.x = w[2].x - 10; st.z = w[2].z; plan.update(1 / 60);
  assert.equal(plan.course.active, false); assert.equal(plan.course.route.length, 0); assert.equal(passage.target, null);
  assert.equal(said.at(-1), 'Arrived at the last waypoint. Course done.');
  // Clear
  plan.pick({ ...TAPS[0], index: 0 }); plan.pick({ op: 'set' }); assert.equal(passage.target.name, 'WP 1 · 1');
  plan.pick({ op: 'clear' }); assert.equal(passage.target, null); assert.equal(said.at(-1), 'Course cleared.');
});

test('the first-time line once per browser (lakeshore.passage.v1); a tap before the chart is in waits for it; Cruise steps aside', async () => {
  store.delete('lakeshore.passage.v1');
  const s = createServices(), st = boatAt(...START); s.provide('player', { phys: { state: st } });
  const passage = createPassage({ services: s }); s.provide('passage', passage);
  const cp = fakeCp(), said = [];
  let resolve; const chartP = new Promise((r) => { resolve = r; });
  const plan = mountPlan({ services: s, cp, chartP, say: (t) => said.push(t) });
  plan.pick({ ...TAPS[0], index: 0 });   // before the chart: kept
  resolve(v2Chart()); await plan.ready;
  assert.equal(plan.course.route.length, 1, 'the early tap played');
  plan.course.clear();
  cp.bigIn = true; plan.update(1 / 60);
  assert.equal(said.at(-1), 'Click the water to add a waypoint. Click a name to sail there.');
  assert.equal(store.get('lakeshore.passage.v1'), '1');
  const n = said.length; cp.bigIn = false; plan.update(1 / 60); cp.bigIn = true; plan.update(1 / 60);
  assert.equal(said.length, n, 'said once');
  // a second page in the same browser: no line
  const plan2 = mountPlan({ services: (() => { const q = createServices(); q.provide('player', { phys: { state: st } }); return q; })(), cp: fakeCp(), chartP: v2Chart(), say: (t) => said.push(t) });
  await plan2.ready; plan2.update(1 / 60);
  // Cruise: the course suspended (the passage block goes back to the chart's mark), the route off the chart, taps ignored
  plan.pick({ ...TAPS[0], index: 0 }); plan.pick({ op: 'set' }); assert.equal(passage.target.name, 'WP 1 · 1');
  plan.setMode('cruise');
  assert.equal(passage.target, null); assert.equal(cp.routes.at(-1).r.length, 0);
  plan.pick({ ...TAPS[1], index: 1 }); assert.equal(plan.course.route.length, 1);
  plan.setMode('sail');
  assert.equal(passage.target.name, 'WP 1 · 1'); assert.equal(cp.routes.at(-1).r.length, 1);
});

test('Sail on the whole-lake chart: a far waypoint is planned from the open lake and from inside the bay (the channel); past the lake\'s box Sail\'s mark; land keeps its line', async () => {
  const run2 = async (at) => {
    const s = createServices(), st = boatAt(...at); s.provide('player', { phys: { state: st } }); s.provide('passage', createPassage({ services: s }));
    const said = [], offs = [];
    const plan = mountPlan({ services: s, cp: fakeCp(), chartP: v2Chart(), say: (t) => said.push(t), offChart: (p, why) => { offs.push([p.x, p.z, why]); return 'set'; } });
    await plan.ready;
    return { plan, said, offs };
  };
  // from off the bay's mouth: the east shore, 14.7 km off, is a waypoint
  const a = await run2([1900, -1900]);
  a.plan.pick({ op: 'add', index: 0, x: 12600, z: -12000, name: null });
  assert.equal(a.plan.course.route.length, 1, `a waypoint on the east shore (${a.said.join(' | ')})`); assert.deepEqual(a.offs, []);
  // from inside the bay: the same tap, through the entrance channel; dry land: the planner's own line
  const b = await run2(START);
  b.plan.pick({ op: 'add', index: 0, x: 12600, z: -12000, name: null });
  assert.equal(b.plan.course.route.length, 1, `through the channel (${b.said.join(' | ')})`); assert.deepEqual(b.offs, []);
  b.plan.pick({ op: 'add', index: 1, x: -900, z: 300, name: null });
  assert.equal(b.offs.length, 0); assert.match(b.said.at(-1), /dry land/);
  b.plan.pick({ op: 'add', index: 1, x: 30000, z: -12000, name: null });
  assert.deepEqual(b.offs.at(-1), [30000, -12000, 'off'], 'past the lake\'s box: Sail\'s mark (its own checks answer)');
});
