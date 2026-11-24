// The staged first visit (owner, 2026-11-05): who gets it (src/ui/firstVisit.js), the five minutes' beats and the
// opening camera (src/ui/firstStage.js), and the staged course on the real terrain, wind and physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideFirstVisit, stageParams, isStaged, STAGE_START } from '../src/ui/firstVisit.js';
import { createStage, STAGE, LINES, introCam, INTRO, eagleCue, ospreyCue, gustAt, gustAheadOf, BEATS } from '../classic/src/ui/firstStage.js';
import { startPose, coreOptions } from '../classic/src/modes/daysail/index.js';
import { NOTES } from '../src/ui/skipper.js';
import { HM_VOCAB } from '../src/vhf/harbourMaster.js';
import { EVENTS, FIRST_BEATS } from '../src/metrics.js';
import { pointOf } from '../functions/api/e.js';
import * as T from '../src/sim/terrain.js';
import { WindField, firstGustFor } from '../src/sim/wind.js';
import { BoatPhysics, CONTROLS, Helm, DT } from '../src/sim/boat.js';
import { createGround, predict } from '../src/sim/boat/ground.js';
import { ShoalAssist } from '../src/sim/boat/shoalAssist.js';
import { groundTerrain } from '../src/sim/boat/groundTerrain.js';
import { SAIL_HOUR } from '../src/sim/timeOfDay.js';
import { KEEP_M } from '../classic/src/birds/index.js';
import { parseFlags } from '../src/sim/core/flags.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('the camera moments: each once at its time; eased in, held, eased out; input hands the camera back at once', async () => {
  const { MOMENTS, createDirector, mixPose, momentWeight, fovFor, shallowsPose, stormPose, birdPose, aimOf } = await import('../classic/src/ui/firstStage.js');
  // the schedule: the shallows after the swing, the osprey 0:19, the storm ≈ 1:06, each once
  const seen = [];
  const st = createStage({ effects: { say: () => true, moment: (k) => seen.push([k, st.state.t]) } });
  for (let t = 0; t < 120; t += 0.25) st.update(0.25, { stage: true, playing: true, quiet: true, depth: 6, stormPhase: 'none' });
  assert.deepEqual(seen.map((x) => x[0]), ['shallows', 'osprey', 'storm'], 'no eagle glance (round 4: it framed dark forest)');
  for (const [k, t] of seen) assert.ok(Math.abs(t - MOMENTS[k].at) < 0.3, k);
  assert.ok(MOMENTS.shallows.at >= INTRO.holdS + INTRO.durS - 0.6 && MOMENTS.shallows.at + MOMENTS.shallows.inS + MOMENTS.shallows.holdS <= 14, 'the shallows right after the swing, through the line');
  assert.ok(MOMENTS.osprey.at < 20.5 && MOMENTS.osprey.at + MOMENTS.osprey.inS + MOMENTS.osprey.holdS >= 26, 'the osprey framed from before its hover to the climb');
  assert.ok(MOMENTS.storm.at >= STAGE.vhfS + 5 && MOMENTS.storm.holdS >= 4.5);
  // the weight: 0 → 1 → 0, smooth; a cut eases out in 0.35 s from where it was
  const m = MOMENTS.osprey, end = m.inS + m.holdS + m.outS;
  assert.equal(momentWeight(0, m), 0); assert.equal(momentWeight(m.inS + 1, m), 1); assert.equal(momentWeight(end + 0.01, m), 0);
  for (let t = 0, w0 = 0; t < end; t += 1 / 60) { const w = momentWeight(t, m); assert.ok(Math.abs(w - w0) < 0.05, 'no jump'); w0 = w; }
  assert.ok(Math.abs(momentWeight(2, m, { cutAt: 2 }) - 1) < 1e-9 && momentWeight(2.36, m, { cutAt: 2 }) === 0);
  // a bird reads 80–150 px tall at 1280×720
  const px = (fov, d, span) => span / d / (2 * Math.tan(fov * Math.PI / 360)) * 720;
  for (const d of [45, 65, 90]) { const f = fovFor(1.6, d, 100); assert.ok(px(f, d, 1.6) >= 80 && px(f, d, 1.6) <= 150, `${d} m: ${px(f, d, 1.6).toFixed(0)} px`); }
  // the poses: the shallows look down from behind the boat; the storm looks west from beside the follow camera
  const boat = { x: 0, z: 0, heading: 80 * DEG }, follow = { pos: [-Math.sin(80 * DEG) * 30, 11, Math.cos(80 * DEG) * 30], target: [Math.sin(80 * DEG) * 20, 1.5, -Math.cos(80 * DEG) * 20], fov: 40 };
  const sh = aimOf(shallowsPose(boat));
  assert.ok(sh.pitch < -30 * DEG && sh.pitch > -60 * DEG, 'looking down into the water');
  const sp = aimOf(stormPose(follow, boat));
  assert.ok(Math.abs(wrap(sp.yaw - 255 * DEG)) < 1e-6 && sp.pitch > 0, 'the west ridge');
  const bp = birdPose(follow, [0, 20, -80]); assert.ok(bp.distM > KEEP_M && bp.fov < 15);
  // a turn of the head to the stern goes round the way asked, never through the camera
  let last = aimOf(follow).yaw;
  for (let w = 0; w <= 1.0001; w += 0.05) { const y = aimOf(mixPose(follow, stormPose(follow, boat), w, 1)).yaw; assert.ok(wrap(y - last) >= -1e-6, 'clockwise all the way'); last = y; }
  // the director: the follow pose between moments; a moment mixes it; input cuts it back within 0.35 s; null once done
  let over = false;
  const d = createDirector({ intro: () => null, done: () => over });
  assert.equal(d.update(1 / 60, follow, boat), follow);
  d.play('shallows', MOMENTS.shallows, (f, s) => shallowsPose(s));
  for (let i = 0; i < 120; i++) d.update(1 / 60, follow, boat);
  const mid = d.update(1 / 60, follow, boat);
  assert.ok(mid !== follow && Math.abs(mid.pos[1] - 17) < 1e-6, 'held on the shallows');
  d.cancel();
  let p = null; for (let i = 0; i < 24; i++) p = d.update(1 / 60, follow, boat);
  assert.equal(p, follow, 'handed back after 0.35 s');
  over = true; assert.equal(d.update(1 / 60, follow, boat), null, 'the hook lets go when the stage is over');
});

test('who gets the staged first visit: a fresh browser only; ?first= decides for a test; never a capture or an automated browser', () => {
  const d = (search, o = {}) => decideFirstVisit({ search, ...o }).stage;
  assert.equal(d(''), true, 'a true first visit: no stored settings');
  assert.equal(d('?mode=sail'), true, 'a Sail link is still a first visit');
  assert.equal(d('', { stored: '{"welcomed":true}' }), false, 'a returning visitor: the home card as today');
  assert.equal(d('', { stored: '{}' }), false, 'any stored settings mean a visit before');
  assert.equal(d('', { webdriver: true }), false, 'the goldens and the probes (automated browsers) never get it');
  assert.equal(d('?first=1', { stored: '{"welcomed":true}', webdriver: true }), true, '?first=1 forces it');
  assert.equal(d('?first=0'), false, '?first=0 turns it off');
  for (const q of ['?headless=1', '?first=1&headless=1', '?film=1', '?noload=1', '?shot=a', '?gate=1', '?menu=0', '?mode=cruise', '?mode=regatta', '?first=1&mode=chill', '?start=0,0', '?heading=90', '?welcome=1'])
    assert.equal(d(q), false, q);
  assert.equal(decideFirstVisit({ search: '', webdriver: true }).why, 'automated');
});

test('the staged start rides the URL contract: start, heading, and the Sail mode picks its speed and its first gust', () => {
  const p = stageParams(parseFlags());
  assert.equal(p.start, `${STAGE_START.x},${STAGE_START.z}`); assert.equal(p.heading, String(STAGE_START.headingDeg)); assert.ok(isStaged(p));
  const S = startPose(p);
  assert.deepEqual([S.x, S.z, S.headingDeg, S.speed], [STAGE_START.x, STAGE_START.z, STAGE_START.headingDeg, STAGE_START.speed]);
  assert.ok(S.speed * 1.944 > 3.5 && S.speed * 1.944 < 4.5, 'about 4 kn');
  assert.equal(coreOptions(p).wind(18.75).firstGust, null, 'the staged visit lays its own gust during play');
  assert.ok(coreOptions(parseFlags()).wind(18.75).firstGust, 'a normal visit keeps the placed first gust');
  // a normal visit is untouched
  const n = startPose(parseFlags());
  assert.deepEqual([n.x, n.z, n.speed], [1200, -1050, 2.75]);
  assert.equal(isStaged(parseFlags()), false);
});

// a stage driven by a scripted world: f(t) → ctx patch, every 0.25 s for `dur` s of play
function run(f = () => ({}), dur = 340) {
  const log = [], said = [], tracked = [], hush = [];
  let t = 0, stormAt = null;
  const effects = {
    hud: () => log.push(['hud', t]), osprey: () => { log.push(['osprey', t]); return true; }, eagle: () => { log.push(['eagle', t]); return true; },
    gust: (secs) => log.push(['gust', t, secs]), hush: (on) => hush.push([on, t]),
    say: (id) => { said.push([id, t]); return true; }, vhf: () => log.push(['vhf', t]),
    storm: () => { stormAt = t; log.push(['storm', t]); }, track: (b) => tracked.push(b), end: (w) => log.push([`end:${w}`, t]),
  };
  const st = createStage({ effects });
  // the arc on the 2× scene clock: build 0–90 s, front –120, storm –210, clear –270, after –300 (arc s = 2 × play s)
  const phase = () => { if (stormAt == null) return 'none'; const a = 2 * (t - stormAt); return a < 90 ? 'build' : a < 120 ? 'front' : a < 210 ? 'storm' : a < 270 ? 'clear' : a < 300 ? 'after' : 'none'; };
  for (; t <= dur; t += 0.25) st.update(0.25, { stage: true, playing: true, quiet: true, depth: 40, gustAhead: false, gustHere: 1, crewOff: false, stormPhase: phase(), ...f(t) });
  const at = (k) => log.find((r) => r[0] === k)?.[1];
  return { st, log, said, tracked, hush, at, line: (id) => said.find((r) => r[0] === id)?.[1] };
}
// the staged course: on the shelf (6 m) to 0:24, deep after; the laid gust's dark water ahead 0:40–0:48, at the boat 0:48–1:05
const course = (t) => ({ depth: t < 24 ? 6 : 40, gustAhead: t >= 40 && t < 48, gustHere: t >= 48 && t < 65 ? 1.3 : 1 });

test('the first minute is the showreel: the bottom, the osprey, the eagle, the gust, then the storm; the lines apart', () => {
  const r = run(course);
  assert.ok(r.at('hud') < 0.5 && Math.abs(r.log.filter((x) => x[0] === 'hud').length - STAGE.hudS * 4) <= 1, 'the HUD held up from the start to hudS');
  assert.ok(r.line('bottom') >= 6.5 && r.line('bottom') < 7.5, `"Look down" at ≈ 0:08 (${r.line('bottom')} s)`);
  assert.ok(Math.abs(r.at('osprey') - STAGE.ospreyS) < 0.3 && STAGE.ospreyS >= 15 && STAGE.ospreyS <= 25, 'the osprey in 0:20–0:40 (it plunges ≈ 5 s after its cue)');
  assert.ok(Math.abs(r.at('eagle') - STAGE.eagleS) < 0.3 && STAGE.eagleS > STAGE.ospreyS, 'the eagle soon after');
  const g = r.log.find((x) => x[0] === 'gust');
  assert.ok(Math.abs(g[1] - STAGE.gustPlaceS) < 0.3 && Math.abs(g[1] + g[2] - STAGE.gustHitS) < 0.3 && STAGE.gustHitS <= 55, 'the gust laid to land by 0:55');
  assert.ok(r.line('gust') >= 39.5 && r.line('gust') < 40.5, `the gust line as the dark water nears (${r.line('gust')} s)`);
  assert.ok(Math.abs(r.at('vhf') - STAGE.vhfS) < 0.3 && Math.abs(r.at('storm') - STAGE.stormS) < 0.3, 'the advisory ≈ 1:00, the storm right after');
  // the storm's own clock: the front by ≈ 1:45, the rain by ≈ 2:00 of play
  assert.ok(STAGE.stormS + (90 - STAGE.stormS0) / 2 <= 105 && STAGE.stormS + (125 - STAGE.stormS0) / 2 <= 121, 'the front by 1:45, full rain by ≈ 2:00');
  assert.ok(r.line('sheets') >= STAGE.sheetsMinS && r.line('sheets') >= STAGE.stormS + 104, `the sheets line after the storm clears (${r.line('sheets')} s)`);
  assert.deepEqual(r.said.map((s) => s[0]), ['bottom', 'gust', 'sheets'], 'each line once');
  for (let i = 1; i < r.said.length; i++) assert.ok(r.said[i][1] - r.said[i - 1][1] >= STAGE.lineGapS, 'the lines keep their gap');
  assert.deepEqual(r.tracked, ['bottom', 'osprey', 'eagle', 'gust', 'storm'], 'the metrics see each beat reached');
  assert.deepEqual(r.hush.map((h) => h[0]), [true, false], 'the other hints hushed, then back');
  assert.ok(Math.abs(r.hush[1][1] - STAGE.hushS) < 0.3);
  assert.ok(r.st.state.done && r.at('end:done') >= STAGE.hushS - 0.5, 'then normal play');
  // a player who steers off the shelf at once and away from the gust: those lines never come; the birds, the gust's
  // laying and the storm still do
  const away = run(() => ({}));
  assert.deepEqual(away.said.map((s) => s[0]), ['sheets']);
  assert.ok(away.at('storm') != null && away.at('vhf') != null && away.at('osprey') != null && away.at('gust') != null);
});

test('a line whose moment passed is dropped; the clock stops while the menu is open; another mode ends the stage', () => {
  assert.equal(run((t) => ({ ...course(t), gustAhead: t > STAGE.gust[1] + 1 })).line('gust'), undefined, 'never said late');
  assert.equal(run((t) => ({ ...course(t), depth: t > STAGE.bottom[1] + 1 && t < 200 ? 6 : 40 })).line('bottom'), undefined);
  // a player who already took the sheets is not told how; the stage still ends
  const c = run((t) => ({ ...course(t), crewOff: true }));
  assert.equal(c.line('sheets'), undefined); assert.ok(c.st.state.done);
  // the menu open for 60 s from 0:10: every beat after it moves 60 s later
  const m = run((t) => ({ ...course(t), playing: !(t >= 10 && t < 70) }), 400);
  assert.ok(Math.abs(m.at('osprey') - (STAGE.ospreyS + 60)) < 0.5);
  // Cruise picked at 0:20: nothing more, the storm never forced, the hints back
  const x = run((t) => ({ ...course(t), stage: !(t >= 20) }));   // Cruise's options: no stage
  assert.equal(x.at('eagle'), undefined); assert.equal(x.at('storm'), undefined); assert.ok(x.at('end:cancelled') != null);
  assert.deepEqual(x.hush.map((h) => h[0]), [true, false]);
});

test('the lines are R.\'s: short, plain, voiced; the advisory is a harbour-master call; the beats are a metrics label', () => {
  for (const id of ['gust', 'bottom', 'sheets']) {
    const n = LINES[id], plain = n.text.replace(/\{(?:[^|}]*\|)?([^}]*)\}/g, '$1');
    assert.ok(n && n.text && n.speak, id);
    assert.ok(plain.split(/\s+/).length <= 12 && !/!/.test(plain), `${id}: at most 12 words, no "!"`);
  }
  assert.equal(LINES.gust.text, 'Dark water ahead — here comes a {gust}');
  assert.equal(LINES.bottom.text, 'Look down — you can see the bottom');
  assert.ok(NOTES.gustAhead === LINES.gust && NOTES.bottom === LINES.bottom && NOTES.sheets === LINES.sheets);
  assert.match(HM_VOCAB.hm_storm, /Thunderstorm building over the west ridge/);
  assert.ok('first_beat' in EVENTS); assert.deepEqual(BEATS, FIRST_BEATS);
  assert.equal(pointOf({ n: 'first_beat', p: { beat: 'gust' } }).detail, 'gust');
  assert.equal(pointOf({ n: 'first_beat', p: { beat: 'my name' } }).detail, '', 'only the known beats');
});

test('the opening camera: low ahead of the bow, holds through the dissolve, swings into the follow pose exactly, a drag cuts it short', () => {
  const boat = { x: 100, z: -200, heading: 255 * DEG, heave: 0 };
  const follow = { pos: [100 + Math.sin(75 * DEG) * 30, 11, -200 - Math.cos(75 * DEG) * 30], target: [100 - 20, 1.5, -200], fov: 40 };   // astern (heading + 180°)
  let go = false;
  const cam = introCam({ started: () => go });
  const p0 = cam(1 / 60, follow, boat);
  assert.ok(Math.abs(p0.pos[1] - INTRO.start.heightM) < 1e-9, 'low over the water');
  const fwd = [Math.sin(boat.heading), -Math.cos(boat.heading)], rel = [p0.pos[0] - boat.x, p0.pos[2] - boat.z];
  assert.ok(rel[0] * fwd[0] + rel[1] * fwd[1] > 20, 'ahead of the bow');
  for (let i = 0; i < 600; i++) cam(1 / 60, follow, boat);
  assert.deepEqual(cam(1 / 60, follow, boat).pos, p0.pos, 'it waits for the entry');
  go = true;
  let p = null, last = null, n = 0;
  while ((p = cam(1 / 60, follow, boat)) && n++ < 2000) {
    assert.ok(p.pos[1] >= INTRO.start.heightM - 1e-9, 'never below its start height');
    assert.ok(Math.hypot(p.pos[0] - boat.x, p.pos[2] - boat.z) > 25, 'never closer than 25 m to the boat');
    last = p;
  }
  assert.equal(p, null, 'it ends');
  assert.ok((n + 1) / 60 >= INTRO.holdS + INTRO.durS - 0.1 && (n + 1) / 60 <= INTRO.holdS + INTRO.durS + 0.1, `≈ ${INTRO.holdS + INTRO.durS} s`);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(last.pos[k] - follow.pos[k]) < 0.05 && Math.abs(last.target[k] - follow.target[k]) < 0.05, 'it lands on the follow pose');
  // a drag at 2 s: done within 0.8 s
  const c2 = introCam(); let m = 0;
  for (; m < 120; m++) c2(1 / 60, follow, boat);
  let left = 0; while (c2(1 / 60, follow, boat, { look: true }) && left < 600) left++;
  assert.ok(left / 60 <= 0.85, `cut in ${(left / 60).toFixed(2)} s`);
});

test('the birds are cued where the camera sees them and keep the 40 m rule; the gust is laid on the course', () => {
  const boat = { x: 140, z: -420, heading: 80 * DEG, sog: 2.6 };
  const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
  // the eagle: 300 m ahead, 45 m to port, high
  const e = eagleCue(boat), rel = [e.from[0] - boat.x, e.from[2] - boat.z];
  assert.ok(Math.abs(rel[0] * fx + rel[1] * fz - 300) < 1e-6);
  assert.ok(Math.abs(rel[0] * -fz + rel[1] * fx + 45) < 1e-6, 'port side, 45 m');
  assert.ok(e.offset >= KEEP_M && e.height >= 15);
  // the osprey: 125 m ahead along the camera's view, a little to the right, over water at least 3 m deep
  const cam = { x: 110, z: -425, fx: fx, fz: fz };
  const o = ospreyCue(cam, () => 40);
  const d = [o.x - cam.x, o.z - cam.z], along = d[0] * fx + d[1] * fz, across = d[0] * -fz + d[1] * fx;
  assert.ok(Math.abs(along - 100) < 1e-6 && Math.abs(across - 10) < 1e-6, 'ahead of the camera, right of centre');
  assert.ok(Math.atan2(Math.abs(across), along) < 20 * DEG, 'well inside the view');
  assert.ok(Math.hypot(...d) > 50 + 32 + 15, 'far enough that the boat (32 m ahead of the camera) never closes inside the plunge rule');
  const start = [o.x - Math.sin(o.yaw) * o.back, o.z - Math.cos(o.yaw) * o.back];
  assert.ok(Math.hypot(start[0] - cam.x, start[1] - cam.z) > KEEP_M + 40, 'it enters from the side, far off');
  assert.equal(ospreyCue(cam, () => 1), null, 'never over the shallows');
  // with the sun (low, astern to port at 287°): the fish toward the sun, so the strike lands in its glitter
  const sun = { x: Math.sin(287 * DEG), z: -Math.cos(287 * DEG) };
  const os = ospreyCue(cam, () => 40, undefined, sun), od = [os.x - cam.x, os.z - cam.z];
  assert.ok(Math.abs(Math.atan2(od[0], -od[1]) - wrap(287 * DEG)) < 0.12 && Math.hypot(...od) > 55 && Math.hypot(...od) < 70, 'toward the sun, ≈ 62 m off');
  assert.ok(Math.hypot(os.x - (cam.x + fx * 32), os.z - (cam.z + fz * 32)) < 105, 'inside the plunge rule (≤ 120 m off the boat, with room for her to sail on)');
  assert.ok(os.turn === 1 || os.turn === -1);
  // the gust: where the boat will be in 22 s of play (44 s of sim), spreading in, held long past the stage
  const g = gustAt(boat, 22, { t: 100, dirDeg: 200, speedMs: 5 });
  const gd = [g.x - boat.x, g.z - boat.z];
  assert.ok(Math.abs(gd[0] * fx + gd[1] * fz - (2.6 * 2 * 22 + 60)) < 1e-6 && Math.abs(gd[0] * -fz + gd[1] * fx) < 1e-6);
  assert.ok(g.riseAt === 100 && g.riseS > 0 && g.holdS > 100 + 120);
  // the wind field: nothing at the riseAt moment, full once spread
  const w = new WindField({ seed: 1, base: { dirDeg: 200, speedMs: 5 } }); w.first = g;
  assert.ok(Math.abs(w.firstGustAt(g.x, g.z, 100) - 1) < 1e-9 && w.firstGustAt(g.x, g.z, 100 + g.riseS) > 1.3);
  // the dark water probe: ahead, not behind
  const at = (x, z) => (Math.hypot(x - (boat.x + fx * 50), z - (boat.z + fz * 50)) < 12 ? 1.3 : 1);
  assert.equal(gustAheadOf(boat, at), true);
  assert.equal(gustAheadOf({ ...boat, heading: boat.heading + Math.PI }, at), false);
});

test('the staged course on the real lake: over the granite at first, deep water by ≈ 0:30, no assist for 2:30, never aground', () => {
  // as the page: 18:45, level 3, the shifts and the gust cells; the pilot holds the start heading and the shallow-water
  // assist is on (the "New to it" profile); the sim runs at 2× (sim s / 2 = s of play)
  const p = stageParams(parseFlags()), S = startPose(p);
  const wind = new WindField({ seed: 1, day: { hour: Number(SAIL_HOUR), rate: 1 }, level: 3, levelRef: 'bay', shifts: true, cells: true });
  wind.setTerrain(T.heightAt);
  const { depthAt, rockAt } = groundTerrain(T);
  const ground = createGround({ depthAt, rockAt }), as = new ShoalAssist({ depthAt, predict: (d, s, o) => predict(d, s, { ...o, rockAt }) });
  const phys = new BoatPhysics({ x: S.x, z: S.z, heading: S.headingDeg * DEG, speed: S.speed }), helm = new Helm(), ctl = { ...CONTROLS };
  const env = { t: 0, windAt: (x, z, t) => { const s = wind.sample(x, z, t); return { vx: s.vx, vz: s.vz }; }, ext: ground.ext, post: ground.post };
  let hold = S.headingDeg * DEG, shelfTill = null, deepAt = null, shallowAgain = null, minD = 99, engage = null;
  for (let i = 0; i < 60 * 300; i++) {
    const t = i * DT; env.t = t;
    const s = phys.state, o = as.update(s, DT, { enabled: true, steering: false, windFrom: wind.sample(s.x, s.z, t).dirDeg * DEG });
    if (o.event === 'engage' && engage == null) engage = t;
    if (o.event === 'release') hold = s.heading;
    ctl.rudder = helm.toHeading(s, o.engaged ? o.heading : hold, DT);
    phys.step(DT, ctl, env);
    const d = depthAt(s.x, s.z);
    minD = Math.min(minD, d);
    if (shelfTill == null && d > STAGE.bottomDepth[1]) shelfTill = t;
    if (deepAt == null && d >= 10) deepAt = t;
    if (deepAt != null && d < 10 && shallowAgain == null) shallowAgain = t;
  }
  const d0 = depthAt(S.x, S.z);
  assert.ok(d0 >= 5 && d0 <= 8, `the start over 5–8 m (${d0.toFixed(1)} m)`);
  assert.ok(shelfTill / 2 >= STAGE.bottom[0] + 2, `still over the shelf when R. says look down (${(shelfTill / 2).toFixed(0)} s of play)`);
  assert.ok(deepAt / 2 <= 35, `deep water (≥ 10 m) by ${(deepAt / 2).toFixed(0)} s of play`);
  assert.equal(shallowAgain, null, 'deep for the rest of the 2:30');
  assert.equal(engage, null, 'no shallow-water assist');
  assert.ok(minD >= 4.5, `never under 4.5 m (${minD.toFixed(1)} m)`);
  assert.equal(ground.state.mode, 'afloat');
});

test('R0: the opening frames Emerald Bay from off the port bow and swings round port into the follow pose; the sky is held Clear for the first minute', async () => {
  const { INTRO_OLD } = await import('../classic/src/ui/firstStage.js');
  assert.ok(INTRO.start.angleDeg < 0 && INTRO_OLD.start.angleDeg > 0, 'port by default, starboard with ?intro=old');
  // the staged start (north of Fannette Island, heading 80°): the opening lens looks back over the bow toward the island and the bay's head
  const boat = { x: 61, z: -406, heading: 80 * DEG, heave: 0 };
  const follow = { pos: [61 - Math.sin(80 * DEG) * 30, 11, -406 + Math.cos(80 * DEG) * 30], target: [61 + Math.sin(80 * DEG) * 20, 1.5, -406 - Math.cos(80 * DEG) * 20], fov: 40 };
  const cam = introCam();
  const p0 = cam(1 / 60, follow, boat);
  const yaw = Math.atan2(p0.target[0] - p0.pos[0], -(p0.target[2] - p0.pos[2]));
  const bearingTo = (x, z) => Math.atan2(x - p0.pos[0], -(z - p0.pos[2]));
  const half = (INTRO.fov / 2) * DEG * (16 / 9);   // about the horizontal half-angle at 16:9 (generous, small angles)
  for (const [name, x, z] of [['Fannette Island', 0, 0], ["the bay's head", -600, 250]]) assert.ok(Math.abs(wrap(bearingTo(x, z) - yaw)) < half, `${name} in frame`);
  assert.ok(Math.abs(p0.pos[1] - INTRO.start.heightM) < 1e-9 && Math.abs(Math.atan2(p0.target[1] - p0.pos[1], Math.hypot(p0.target[0] - p0.pos[0], p0.target[2] - p0.pos[2]))) < 3 * DEG, 'a low eye, a level lens: the horizon near mid-frame');
  // the swing: round the port side (the camera's bearing off the bow goes negative), never closer than 25 m, landing on the follow pose
  let p = p0, last = p0, minRel = 0, n = 0;
  while ((p = cam(1 / 60, follow, boat)) && n++ < 2000) {
    const rel = wrap(Math.atan2(p.pos[0] - boat.x, -(p.pos[2] - boat.z)) - boat.heading);
    minRel = Math.min(minRel, rel);
    assert.ok(Math.hypot(p.pos[0] - boat.x, p.pos[2] - boat.z) > 25, 'never closer than 25 m');
    last = p;
  }
  assert.ok(minRel < -80 * DEG, 'it swings round the port beam');
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(last.pos[k] - follow.pos[k]) < 0.05, 'it lands on the follow pose');
  // the sky: held Clear from the first frame of play to 60 s, then let go (and let go if the stage ends early)
  const sky = [];
  const st = createStage({ effects: { say: () => true, sky: (on) => sky.push([on, st.state.t]) } });
  for (let t = 0; t < 70; t += 0.25) st.update(0.25, { stage: true, playing: true, quiet: true, depth: 20, stormPhase: 'none' });
  assert.deepEqual(sky.map((s) => s[0]), [true, false]);
  assert.ok(sky[0][1] <= 0.25 && Math.abs(sky[1][1] - STAGE.clearS) <= 0.25, `on at the start, off at ${STAGE.clearS} s`);
  const sky2 = [];
  const st2 = createStage({ effects: { say: () => true, sky: (on) => sky2.push(on) } });
  st2.update(0.25, { stage: true, playing: true, quiet: true, depth: 20 }); st2.cancel();
  assert.deepEqual(sky2, [true, false], 'a cancelled stage gives the sky back');
});
