// The UI audit's S2 rows, the node half. The browser half (the big chart over the bar and the
// cockpit, the night chart, the status line, N in Cruise, the course tool's buttons): v2/tests/pages/chartUi.page.mjs.
//   U8   Escape with the enlarged chart pinned unpins it and the Menu card stays down; the next Escape opens the card (v1's shell
//        escFirst names the pinned chart). v1's home card with front.js's links, a chart toggle with the chart's own Esc.
//   U15  the course tool's marks (v2/ui/course.js): Lay sets v1's course to the wind in deep water, the marks float on the shared
//        sim and step inside the boat's own tick (v2/sim/seamanship.js addPost), the props draw them while laid and no race is on,
//        Clear takes them away; a rounding is one quiet line and a row of v1's course log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHome, memStorage } from '../../tests/helpers/home-mount.mjs';
import { logLinks } from '../ui/front.js';
import { createServices } from '../../src/sim/core/services.js';
import { ChartToggle } from '../../src/ui/chartplotterData.js';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { createSeamanship } from '../sim/seamanship.js';
import { createSailCourse, COURSE_KEY } from '../ui/course.js';
import { steadyWind } from '../../src/sim/boat.js';

test('U8: Escape over the pinned chart unpins it first; the Menu card opens on the next Escape', async (t) => {
  const tog = new ChartToggle(); tog.shown = true;
  const ui = { services: createServices(), chartEsc: () => tog.pinned };
  const c = await mountHome({ state: 'gone', clock: t, ...logLinks(() => ui) });   // in play (the card gone)
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && tog.pinned) tog.unpin(); });   // the chart's own Esc (chartplotter.js onKeyDown)
  tog.pin();
  c.D.key('Escape');
  assert.equal(tog.pinned, false, 'Escape unpins the chart');
  assert.equal(c.home.isOpen, false, 'and the Menu card stays down');
  c.D.key('Escape');
  assert.equal(c.home.isOpen, true, 'with the chart unpinned, Escape opens the Menu');
});

function boat({ depth = 40, windKn = 10, windFrom = 0 } = {}) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -depth, wind: { sample: (x, z, tt) => steadyWind(windKn * KN, windFrom)(x, z, tt) }, start: { x: 0, z: 0, headingDeg: 90, speed: 0 } });
  B.sea = createSeamanship({ B, depthAt: () => depth, say: () => {}, timeScale: 1 });
  return B;
}
function fakeProps() {
  const P = { active: false, frames: [], cur: null, setActive(on) { P.active = !!on; }, begin() { P.cur = []; }, put(kind, x, y, z, yaw) { P.cur.push({ kind, x, y, z, yaw }); }, end() { P.frames.push(P.cur); } };
  return P;
}

test('U15: Lay windward-leeward and Lay triangle set v1\'s marks to the wind; the props draw them; Clear course takes them away', () => {
  const B = boat({ windFrom: 0 });
  const props = fakeProps(), said = [], storage = memStorage();
  let race = false;
  const C = createSailCourse({ B, windAt: (x, z, tt) => B.env(tt).windAt(x, z, tt), depthAt: () => 40, surface: { heightAt: () => 0 }, note: (s) => said.push(s), props, raceOn: () => race, storage });
  assert.deepEqual(C.chart.kinds.map((k) => k.id), ['windward-leeward', 'triangle'], 'the tool\'s two kinds, as v1\'s');
  assert.equal(C.chart.laid, false);
  const wl = C.chart.lay('windward-leeward');
  assert.ok(wl && C.chart.laid, 'a course is laid');
  assert.deepEqual(C.chart.marks().map((m) => m.type).sort(), ['committee', 'cylinder', 'pin', 'sphere']);
  assert.match(said.at(-1), /^Windward-leeward, 0\.\d\d nm, port: 4 marks laid$/, `v1's line (${said.at(-1)})`);
  assert.match(storage.getItem(COURSE_KEY), /4 marks laid/, 'v1\'s course log');
  // the windward mark lies upwind of the line (the wind from the north: −z)
  const M = Object.fromEntries(C.chart.marks().map((m) => [m.id, m]));
  assert.ok(M.windward.z < M.committee.z - 500, `the windward mark upwind (z ${M.windward.z.toFixed(0)} vs the line ${M.committee.z.toFixed(0)})`);
  C.update(1 / 60);
  assert.equal(props.active, true, 'the props draw while a course is laid');
  assert.deepEqual(props.frames.at(-1).map((p) => p.kind).sort(), ['committee', 'markI', 'markW', 'pin']);
  // the marks step inside the boat's own tick (no frame update between)
  const s0 = C.field.stats.steps;
  for (let i = 0; i < 30; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(C.field.stats.steps > s0, `the marks step in the boat's tick (${s0} → ${C.field.stats.steps})`);
  // a race owns the props: nothing written while it is on
  race = true; const n = props.frames.length; C.update(1 / 60); assert.equal(props.frames.length, n, 'a race on: the course writes no props');
  race = false;
  C.chart.lay('triangle');
  assert.deepEqual(C.chart.marks().map((m) => m.type).sort(), ['committee', 'cylinder', 'pin', 'sphere', 'tetra'], 'the triangle: five marks (the old course cleared)');
  assert.equal(C.chart.sequence.length, 3);
  C.chart.clear();
  assert.equal(C.chart.laid, false); assert.equal(C.chart.marks().length, 0);
  C.update(1 / 60);
  assert.equal(props.active, false, 'Clear course: the props stop');
  C.dispose();
});

test('U15: the boat rounds the windward mark: one quiet line, "Rounded the windward mark to port"', () => {
  const B = boat({ windFrom: 0 });
  const said = [];
  const C = createSailCourse({ B, windAt: (x, z, tt) => B.env(tt).windAt(x, z, tt), depthAt: () => 40, surface: { heightAt: () => 0 }, note: (s) => said.push(s), storage: memStorage() });
  C.chart.lay('windward-leeward');
  const w = C.chart.marks().find((m) => m.id === 'windward');
  // sail the boat round the mark by placing it on a port rounding's path (the tracker reads the boat's position)
  const s = B.phys.state, R = 25, pts = [];
  const line = C.chart.marks().filter((m) => m.role === 'start'), cx = (line[0].x + line[1].x) / 2, cz = (line[0].z + line[1].z) / 2;
  for (let k = 0; k <= 20; k++) pts.push([cx + (w.x - cx) * k / 20, cz + (w.z + 60 - cz) * k / 20]);   // up the beat to below the mark
  for (let a = 0; a <= 360; a += 10) { const b = Math.PI - a * Math.PI / 180; pts.push([w.x + R * Math.sin(b), w.z - R * Math.cos(b)]); }   // once round it on a falling bearing from the mark: anticlockwise from above, the mark to port
  for (const [x, z] of pts) { s.x = x; s.z = z; C.update(0.5); }
  assert.ok(said.some((l) => /^Rounded the windward mark to port$/.test(l)), `a rounding line (${JSON.stringify(said.slice(1))})`);
  C.dispose();
});

//, 2026-11-17: Regatta's props "imported only when Regatta starts"): the props come in their own chunk;
// the practice marks ask for them on the first laid course and draw once they are there
test('U15, round 2: no course, no ask for the props; the first laid course asks; they draw once in', () => {
  const B = boat({ windFrom: 0 });
  let kit = null, asks = 0;
  const C = createSailCourse({ B, windAt: (x, z, tt) => B.env(tt).windAt(x, z, tt), depthAt: () => 40, surface: { heightAt: () => 0 }, props: () => kit, wantProps: () => { asks++; }, raceOn: () => false, storage: memStorage() });
  for (let i = 0; i < 30; i++) C.update(1 / 60);
  assert.equal(asks, 0, 'Sail without a course: the props never asked for');
  C.chart.lay('windward-leeward'); C.update(1 / 60);
  assert.ok(asks >= 1, 'a laid course asks for them');
  kit = fakeProps(); C.update(1 / 60);
  assert.equal(kit.active, true); assert.deepEqual(kit.frames.at(-1).map((p) => p.kind).sort(), ['committee', 'markI', 'markW', 'pin'], 'they draw once in');
  C.chart.clear(); C.update(1 / 60); assert.equal(kit.active, false);
  C.dispose();
});
