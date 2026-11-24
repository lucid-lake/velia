// The film runner's shot module (tools/film/shot.mjs): pinned URLs, a smooth deterministic camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ShotCamera, shotQuery, cameraFor, frameCount } from '../tools/film/shot.mjs';
import { uiQuery } from '../tools/film/ui.mjs';

const SHOTS = new URL('../tools/film/shots/', import.meta.url);
const all = readdirSync(SHOTS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, SHOTS), 'utf8')));
const shots = all.filter((s) => !s.ui), uiShots = all.filter((s) => s.ui);   // UI shots: the live page, no scripted camera (tools/film/ui.mjs)

// a boat sailing west at 2.5 m/s with a slow turn and a little noise-free wander
const boatAt = (t) => ({ x: 180 - 2.5 * t, z: 40 + 0.05 * t * t, heading: -Math.PI / 2 + 0.01 * t, sog: 2.5 });

function run(shot, fmt) {
  const cam = new ShotCamera(shot, fmt), fps = shot.fps ?? 60, out = [];
  for (let i = 0; i < frameCount(shot); i++) out.push(cam.pose(i / fps, boatAt(i / fps), i ? 1 / fps : 0));
  return out;
}

test('every shot file pins its scene: film, headless, mode, hour, seed, cloud cover and the wind level in the URL; formats sized', () => {
  assert.ok(shots.length >= 1);
  for (const s of shots) {
    const q = new URLSearchParams(shotQuery(s));
    for (const k of ['film', 'headless', 'hour', 'seed', 'mode', 'settle', 'music', 'cloudcov']) assert.ok(q.has(k) || (k === 'cloudcov' && s.name === 'golden-glide'), `${s.name}: ${k}`);
    if (q.get('mode') !== 'regatta') assert.ok(q.has('wind'), `${s.name}: wind`);   // Regatta's course sets its own wind
    assert.equal(q.get('film'), '1'); assert.equal(q.get('music'), '0');
    for (const [f, F] of Object.entries(s.formats)) { assert.ok(F.w > 0 && F.h > 0, f); assert.ok(cameraFor(s, f).keys.length >= 1); }
  }
});

test('the camera is deterministic and smooth: no step in position, aim or lens above a few cm per frame', () => {
  for (const s of shots) for (const f of Object.keys(s.formats)) {
    const a = run(s, f), b = run(s, f);
    assert.deepEqual(a, b, `${s.name} ${f}: same input, same poses`);
    if (a[0].rig) { assert.ok(a.every((p) => p.rig && p.fov > 10 && p.fov < 80), `${s.name} ${f}: the mode's camera, a sane lens`); continue; }
    let maxAcc = 0;
    for (let i = 2; i < a.length; i++) for (const k of ['pos', 'target']) for (let j = 0; j < 3; j++) {
      maxAcc = Math.max(maxAcc, Math.abs(a[i][k][j] - 2 * a[i - 1][k][j] + a[i - 2][k][j]));   // m per frame²
    }
    assert.ok(maxAcc < 0.02, `${s.name} ${f}: second difference ${maxAcc.toFixed(4)} m`);
    for (const p of a) assert.ok(p.pos[1] >= 0.3 && p.fov > 10 && p.fov < 80, `${s.name} ${f}: above the water, a sane lens`);
  }
});

test('frames: boat0 positions sit in the first frame of the boat; Catmull-Rom passes through every key', () => {
  const shot = { name: 't', duration: 4, fps: 10, camera: { frame: 'boat0', keys: [{ t: 0, pos: [10, 3, 0], fov: 30 }, { t: 2, pos: [10, 3, 5], fov: 30 }, { t: 4, pos: [10, 3, 20], fov: 40 }], aim: { at: [0, 0, 0] } }, formats: { a: { w: 1, h: 1 } } };
  const cam = new ShotCamera(shot, 'a'), b = { x: 100, z: 50, heading: 0, sog: 0 };   // heading 0: ahead is −z, starboard +x
  const p0 = cam.pose(0, b, 0);
  assert.deepEqual(p0.pos.map((v) => +v.toFixed(6)), [110, 3, 50]);
  const p2 = cam.pose(2, { ...b, x: 999 }, 2);   // boat0 ignores where the boat is now
  assert.deepEqual(p2.pos.map((v) => +v.toFixed(6)), [110, 3, 45]);
  assert.equal(+cam.pose(4, b, 2).fov.toFixed(6), 40);
});

test('aims and looks: "fleet" aims between our boat and Wren; "look": "down" looks straight down with its own up; "rig" hands the camera to the mode', () => {
  const base = { name: 't', duration: 1, fps: 10, formats: { a: { w: 1, h: 1 } } };
  const fleet = new ShotCamera({ ...base, camera: { frame: 'world', keys: [{ t: 0, pos: [0, 2, 0], fov: 20 }], aim: { at: 'fleet', offset: [0, 0, 0] } } }, 'a');
  assert.deepEqual(fleet.pose(0, { x: 10, z: 0, heading: 0, wren: { x: 30, z: 20 } }, 0).target, [20, 0, 10]);
  const down = new ShotCamera({ ...base, camera: { frame: 'world', look: 'down', up: [0, 0, -1], keys: [{ t: 0, pos: [5, 140, 7], fov: 55 }], aim: { at: 'boat' } } }, 'a').pose(0, { x: 0, z: 0, heading: 0 }, 0);
  assert.deepEqual(down.target, [5, 0, 7]); assert.deepEqual(down.up, [0, 0, -1]);
  const rig = new ShotCamera({ ...base, camera: { rig: true, keys: [{ t: 0, pos: [0, 0, 0], fov: 58 }] } }, 'a').pose(0, { x: 0, z: 0, heading: 0 }, 0);
  assert.deepEqual(rig, { rig: true, fov: 58 });
});

test('every edit list cuts from shot files that exist, inside their length, with lines of at most 7 words', () => {
  const EDITS = new URL('../tools/film/edits/', import.meta.url), byName = Object.fromEntries(all.map((s) => [s.name, s]));
  for (const f of readdirSync(EDITS).filter((x) => x.endsWith('.json'))) {
    const e = JSON.parse(readFileSync(new URL(f, EDITS), 'utf8'));
    for (const g of e.segments) {
      if (g.card) { assert.ok(g.dur >= 2 && g.dur <= 4.5, `${f}: the end card 2–4.5 s`); continue; }
      const s = byName[g.clip]; assert.ok(s, `${f}: ${g.clip} has a shot file`);
      assert.ok(g.in >= 0 && g.in + g.dur <= s.duration + 1e-9, `${f}: ${g.clip} ${g.in}+${g.dur} inside ${s.duration} s`);
      if (g.text) assert.ok(g.text.split(/\s+/).length <= 7, `${f}: "${g.text}" ≤ 7 words`);
    }
  }
});

test('UI shots: a live film page (filmui, no headless), the light and the sim pinned, every input inside the shot, formats with a layout', () => {
  assert.ok(uiShots.length >= 1);
  for (const s of uiShots) for (const [f, F] of Object.entries(s.formats)) {
    const q = new URLSearchParams(uiQuery(s, F));
    assert.equal(q.get('filmui'), '1'); assert.ok(!q.has('headless') && !q.has('film'), `${s.name} ${f}: not a capture page`);
    for (const [k, v] of [['timerate', '0'], ['speed', '1'], ['music', '0'], ['metrics', '0'], ['quality', 'high']]) assert.equal(q.get(k), v, `${s.name} ${f}: ${k}`);
    assert.ok(q.has('hour') && q.has('seed'), `${s.name}: hour and seed`);
    assert.ok(F.view?.length === 2 && F.dpr >= 1 && F.w > 0 && F.h > 0, `${s.name} ${f}: a layout and a density`);
    if (F.crop) assert.ok(F.crop.around && F.crop.h > 0, `${s.name} ${f}: a crop names its part`);
    for (const e of s.inputs ?? []) assert.ok(e.t >= 0 && e.t < s.duration, `${s.name}: input at ${e.t} s inside ${s.duration} s`);
  }
});

test('v2 camera: an eased window holds then moves, keyed aim offsets travel, a helm key eases 0→1, the drift is seeded and small', () => {
  const shot = { name: 'v', duration: 4, fps: 60, formats: { a: { w: 1, h: 1 } }, camera: { frame: 'world', window: [1, 3], aim: { at: 'boat', tau: 1 },
    drift: { ampM: 0.015, ampDeg: 0.25, hz: 0.12, seed: 3, from: 3.5 },
    keys: [{ t: 0, pos: [0, 2, 0], fov: 20, aim: [5, 4, 0] }, { t: 1, pos: [0, 2, 0], fov: 20, aim: [5, 4, 0] }, { t: 3, pos: [10, 2, 0], fov: 40, aim: [0, 2, 0], helm: 0 }, { t: 4, pos: [10, 2, 0], fov: 40, aim: [0, 2, 0], helm: 1 }] } };
  const run = () => { const c = new ShotCamera(shot, 'a'), o = []; for (let i = 0; i <= 240; i++) o.push(c.pose(i / 60, { x: 0, z: 0, heading: 0 }, i ? 1 / 60 : 0)); return o; };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a[30].pos[0], 0, 'held before the window');
  assert.ok(Math.abs(a[61].pos[0] - a[60].pos[0]) < 0.01, 'eases out of the hold');
  assert.ok(Math.abs(a[180].pos[0] - 10) < 1e-9, 'lands at the window end');
  assert.ok(!a[150].helm && a[240].helm === 1 && a[210].helm > 0 && a[210].helm < 1, 'the helm key eases in after its key');
  assert.ok(a[0].target[1] > 3.9 && a[240].target[1] < 2.3, 'the aim offset travels');
  let maxD = 0; for (let i = 211; i <= 240; i++) maxD = Math.max(maxD, Math.abs(a[i].pos[1] - 2));
  assert.ok(maxD > 0 && maxD <= 0.015 + 1e-9, `drift ≤ ampM (${maxD})`);
});
