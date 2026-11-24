// The slow half of v2/tests/regatta.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): the start helper's clean start on 3 seeds (the fast suite keeps seed 1).
// Regatta on v2 (BACKLOG-v2 #12, R1 the box and the clock, R2 the course on the water). No browser: the page
// facts (the mode's aliases, the 6-boat cap), the start helper on the real BoatPhysics and v1's race rules (an untouched boat
// starts clean on 3 seeds, never OCS), the laylines (geometry for the wind and the tacking angle; a boat on one fetches the
// mark within a length in the real sim), the course laid to the wind, the segment builder per phase, the watch's words, and the
// guard: the race's two pipelines are declared at load and nothing after; outside a race nothing is recorded.
// The browser half: v2/tests/pages/regatta.page.mjs; the frame: the v2-regatta golden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse, BOAT_LENGTH_M } from '../../../src/sim/race/course.js';
import { AISkipper, polarTargets } from '../../../src/sim/ai/skipper.js';
import { regattaAtBoot, fleetSize, RACE, RACE_CUTS } from '../../regatta/plan.js';
import { createRegattaSession, FLEET } from '../../regatta/session.js';
import { laylines, laylineAhead, tackAngle, ghostSpot, lineReadout, courseToWind, dirOf, LEEWAY_DEG, ZONE_M } from '../../regatta/geometry.js';
import { createSegmentWriter, buildRaceLines, INK, LAY, WIDTH } from '../../regatta/lines.js';
import { STEPS } from '../../regatta/coach.js';
import { tipFor } from '../../regatta/review.js';
import { watchLines, mmss } from '../../regatta/ui.js';
import { createRaceLines, MAX_SEGMENTS, SEG_FLOATS } from '../../render/raceLines.js';
import { createRaceProps, MAX_PROPS } from '../../render/raceProps.js';

const DEG = Math.PI / 180;
const COURSE = courseFor('tahoe-emerald', 'island-sprint');
const wrap = (a) => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };

// an untouched race: the player's boat gets nothing but the helper's hands, `seconds` of sim from −0:45
function untouched({ seed, dir = 210, speedMs = null, rivals = 1, seconds = 55 }) {
  const course = courseToWind(COURSE, dir, { loadCourse, snapCourse });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, ...(speedMs ? { speedMs } : {}) } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind }, log = [];
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) { S.helperTick(ctl, t); env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); log.push(...S.drain()); }
  return { S, log };
}

// (8 s since the race fixes, 2026-11-18: the helper lets the jib fly on a luff and bears away when a luff would still carry her over,
// so it is never over early; seed 3 sits beside the rival's hull on its hold and starts 7.3 s late)
test('the start helper: an untouched boat makes a clean start on 3 seeds (racing within 8 s of the gun, never OCS)', () => {
  for (const seed of [1, 2, 3]) {
    const { S, log } = untouched({ seed, seconds: 60 });
    const ocs = log.filter((e) => e.type === 'ocs' && e.id === 'me'), st = log.find((e) => e.type === 'started' && e.id === 'me');
    assert.equal(ocs.length, 0, `seed ${seed}: never over early (${JSON.stringify(ocs)})`);
    assert.ok(st && st.delayS >= 0 && st.delayS < 8, `seed ${seed}: started ${st?.delayS?.toFixed(2)} s after the gun`);
    assert.equal(S.state().me.status, 'racing');
    assert.equal(S.helper, false, `seed ${seed}: the helper handed the helm back after the start`);
    assert.ok(log.some((e) => e.type === 'helperOff' && e.why === 'started'));
  }
});

// ---- the guard: two pipelines at load, none after; nothing recorded outside a race ----
function mockGpu() {
  const n = { pipelines: 0, buffers: 0, writes: 0 };
  const device = {
    createBuffer: (d) => { n.buffers++; return { d }; }, createBindGroupLayout: (d) => d, createBindGroup: (d) => d, createPipelineLayout: (d) => d,
    createShaderModule: (d) => d, createRenderPipeline: () => { n.pipelines++; return {}; }, createRenderPipelineAsync: async () => { n.pipelines++; return {}; },
    createTexture: () => ({ createView: () => ({}) }), createSampler: () => ({}),   // the sail-art atlas (render/sailArt.js; no canvas here: a stand-in, made at load)
    queue: { writeBuffer: () => { n.writes++; }, writeTexture: () => {} },
  };
  const added = [];
  const reg = { shader: (l, code) => ({ l, code }), add: (name) => { added.push(name); }, get: (name) => ({ name }) };
  return { device, reg, added, n };
}
function mockPass() { const rec = []; const p = new Proxy({}, { get: (t, k) => (...a) => { rec.push(k); } }); return { p, rec }; }

