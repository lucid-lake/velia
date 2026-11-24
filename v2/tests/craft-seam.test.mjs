// The craft seam in v2 (refactor round 3, Phase C step 6): v2 builds every boat's physics through craftOf(vessel).createPhysics
// (src/sim/craft/), not `new BoatPhysics`. The pins below are the full state after N ticks, taken on main before the seam
// (7dd12b3c): the player's boat (v2/sim/boat.js, a place() included), the Regatta's rivals (v2/regatta/session.js, a restart
// and sailToLine included) and the busy lake (v2/living/busyLake.js, a lay() included) on a few seeds. The states live in
// fixtures/craft-seam-state.json; their digests are the seam's original pins (so the file is that state, number for number).
// The run must agree with them within 1e-8 of each number (tools/near.mjs): V8's Math functions differ in the last bit
// between platforms (a Mac's arm64 against CI's Linux x64), which moves these states by under 1e-14, while a changed step
// moves them by far more (a 0.008 % change to the air density: 3e-4 m). A mismatch means a boat steps differently: fix the code, never the pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BoatPhysics, CONTROLS, DT, steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { courseToWind } from '../regatta/geometry.js';
import { createRegattaSession, sailToLine } from '../regatta/session.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createBusyLake } from '../living/busyLake.js';
import { birthplaceRows } from '../sim/regions.js';
import { craftOf } from '../../src/sim/craft/index.js';
import { nearDiff } from '../../tools/near.mjs';

// a state as JSON keeps it (a non-finite number as its name), as the pins were taken
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x)));
const digest = (v) => createHash('sha1').update(JSON.stringify(plain(v))).digest('hex').slice(0, 16);
const st = (p) => { const s = p.state; return [s.x, s.z, s.heading, s.u, s.v, s.yawRate, s.heel, s.sog, s.cog, s.rudderAngle]; };

function playerBoat() {
  const wind = { sample: (x, z, t) => { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind });
  const out = [];
  for (let i = 0; i < 600; i++) B.step(1 / 60, { steer: i < 300 ? 0.4 : -0.2, pull: 0 });
  out.push(st(B.phys));
  B.place({ x: 900, z: -800, headingDeg: 120, speed: 2 });
  for (let i = 0; i < 300; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  out.push(st(B.phys));
  return out;
}

function regatta(seed) {
  const course = courseToWind(courseFor('tahoe-emerald', 'island-sprint'), 210, { loadCourse, snapCourse }), wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: 210 } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals: 3, windAt, seed });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind };
  let t = 0;
  const run = (n) => { for (let i = 0; i < n; i++) { S.helperTick(ctl, t); env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); S.drain(); } };
  run(Math.round(20 / DT));
  const out = [st(phys), ...S.rivals.map((r) => st(r.phys))];
  S.restart(); run(Math.round(5 / DT));
  out.push(...S.rivals.map((r) => st(r.phys)));
  out.push(sailToLine(course.line, { x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: 2 }, windAt, { maxS: 60 }));
  return out;
}

function busy(seed) {
  const BP = birthplaceRows(CURRENT_WATERS);
  const L = createBusyLake({ seed, birthplaces: BP, depthAt: () => 30, windAt: steadyWind(5, 225), tier: 'full', starts: [[CURRENT_WATERS.start.x, CURRENT_WATERS.start.z]] });
  const bp = BP[0], S = { x: bp.x, z: bp.z, heading: 0, u: 0, v: 0, yawRate: 0 };
  for (let i = 0; i < 60 * 15; i++) L.post(S, 1 / 60, i / 60, { eye: [bp.x, 2, bp.z], hour: 13 });
  const out = L.liveBoats.map((b) => [b.id, ...st(b.phys)]);
  const b0 = L.liveBoats[0];
  if (b0) { L.lay(b0.id, { x: bp.x + 60, z: bp.z + 40, heading: 1 }); for (let i = 0; i < 300; i++) L.post(S, 1 / 60, 15 + i / 60, { eye: [bp.x, 2, bp.z], hour: 13 }); out.push(st(b0.phys)); }
  return out;
}

// the seam's original pins: the digests of the states in the fixture
const PINS = {
  player: '7dca004bc08c6503',
  regatta1: '973e34e5771fcf0e', regatta2: 'b8912b8aefb121f0',
  busy1: '2d49dc51e0385eb5', busy2: '1721e06ae43c2afe',
};
const STATE = JSON.parse(readFileSync(new URL('./fixtures/craft-seam-state.json', import.meta.url), 'utf8'));
const TOL = { rel: 1e-8 };
const same = (name, run) => { const d = nearDiff(plain(run), STATE[name], TOL); assert.equal(d, null, `${name} steps differently: ${d}`); };

test('the fixture is the state the seam was pinned on (its digests are the original pins)', () => {
  for (const [k, pin] of Object.entries(PINS)) assert.equal(digest(STATE[k]), pin, k);
});

test('the craft seam: a vessel with no craft is a sloop, built as BoatPhysics', () => {
  const p = craftOf(undefined).createPhysics({ x: 1, z: 2, heading: 0.5, speed: 1 });
  assert.ok(p instanceof BoatPhysics);
  assert.deepEqual(st(p), st(new BoatPhysics({ x: 1, z: 2, heading: 0.5, speed: 1 })));
});

test('the player\'s boat steps as before the seam (a place() included)', () => { same('player', playerBoat()); });
test('the Regatta\'s rivals step as before the seam (seeds 1, 2; a restart and sailToLine included)', () => {
  same('regatta1', regatta(1)); same('regatta2', regatta(2));
});
test('the busy lake steps as before the seam (seeds 1, 2; a lay() included)', () => {
  same('busy1', busy(1)); same('busy2', busy(2));
});

if (process.env.CRAFT_SEAM_PRINT) console.log(JSON.stringify({ player: digest(playerBoat()), regatta1: digest(regatta(1)), regatta2: digest(regatta(2)), busy1: digest(busy(1)), busy2: digest(busy(2)) }));   // this machine's bit-exact digests
