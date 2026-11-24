// The helm view (src/boat/helmCamera.js): fixed to the boat, so it rolls with the heel (the one camera that does);
// smoothed slightly; looks around on a drag and drifts back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HelmCamera, HELM_CAM, toWorld } from '../src/sim/boat/helmCamera.js';

const DEG = Math.PI / 180;
const pose = (o = {}) => ({ x: 100, z: -50, heading: 0, heel: 0, pitch: 0, heave: 0, ...o });
const settle = (cam, p, n = 120, input = {}) => { let r; for (let i = 0; i < n; i++) r = cam.update(1 / 60, p, input); return r; };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = (a) => Math.hypot(...a);

test('at the helmsman\'s eye behind the wheel, looking forward a touch down', () => {
  const r = settle(new HelmCamera(), pose());
  assert.deepEqual(r.pos.map((v) => +v.toFixed(6)), [100, HELM_CAM.eye[1], -50 + HELM_CAM.eye[2]]);
  const d = sub(r.target, r.pos), el = Math.asin(d[1] / norm(d));
  assert.ok(d[2] < 0 && Math.abs(d[0]) < 1e-9, 'forward: north for a north-heading boat');
  assert.ok(Math.abs(el - HELM_CAM.pitchDeg * DEG) < 1e-6, `elevation ${(el / DEG).toFixed(2)}°`);
  assert.ok(r.near <= 0.1, 'a near plane short of the wheel');
});

test('the horizon tilts with the heel: the up vector rolls with the boat', () => {
  const r = settle(new HelmCamera(), pose({ heel: 20 * DEG }));
  const roll = Math.atan2(r.up[0], r.up[1]);
  // heel > 0 puts the starboard rail down: the boat's up leans to starboard (+x for a north-heading boat)
  assert.ok(Math.abs(roll - 20 * DEG) < 0.01 * DEG, `roll ${(roll / DEG).toFixed(2)}°`);
  assert.ok(r.pos[0] > 100 + 0.6, 'the eye swings to leeward with the heeled boat');
});

test('the waves\' pitching is real but smoothed: a step in pitch is followed within ≈ 0.3 s, never overshooting', () => {
  const cam = new HelmCamera(); settle(cam, pose());
  const els = [];
  for (let i = 0; i < 60; i++) { const r = cam.update(1 / 60, pose({ pitch: 5 * DEG }), {}); const d = sub(r.target, r.pos); els.push(Math.asin(d[1] / norm(d)) / DEG - HELM_CAM.pitchDeg); }
  assert.ok(els[0] < 1.5, `the first frame moves only a little (${els[0].toFixed(2)}°)`);
  assert.ok(Math.abs(els[20] - 5) < 0.5, `at 0.33 s: ${els[20].toFixed(2)}°`);
  assert.ok(Math.max(...els) < 5.05, 'no overshoot (critically damped)');
});

test('a drag looks around inside its limits and drifts back to the bow when let go', () => {
  const cam = new HelmCamera(); settle(cam, pose());
  let r = settle(cam, pose(), 30, { look: [0.1, 0] });    // 3 rad of drag to starboard: clamped at 120°
  r = settle(cam, pose(), 30, { look: [0, 0] });
  const d = sub(r.target, r.pos), yaw = Math.atan2(d[0], -d[2]);
  assert.ok(Math.abs(yaw - HELM_CAM.yawMax) < 1 * DEG, `yaw ${(yaw / DEG).toFixed(1)}°`);
  r = settle(cam, pose(), 30, { look: [0, -0.1] }); r = settle(cam, pose(), 30, { look: [0, 0] });       // drag up: look up at the sails, clamped
  const d2 = sub(r.target, r.pos), el = Math.asin(d2[1] / norm(d2));
  assert.ok(Math.abs(el - HELM_CAM.pitchMax) < 1 * DEG, `up ${(el / DEG).toFixed(1)}°`);
  r = settle(cam, pose(), 60 * 10);                        // hands off for 10 s: a look up at the sky stays (round 4)
  const d4 = sub(r.target, r.pos);
  assert.ok(Math.asin(d4[1] / norm(d4)) > 60 * DEG, 'the look up stays');
  r = settle(cam, pose(), 30, { look: [0, 0.1] }); r = settle(cam, pose(), 30, { look: [0, -0.02] });   // dragged back down near the rest
  r = settle(cam, pose(), 60 * 10);                        // hands off for 10 s
  const d3 = sub(r.target, r.pos);
  assert.ok(Math.abs(Math.atan2(d3[0], -d3[2])) < 2 * DEG, 'back to the bow');
});

test('toWorld follows Boat.update: the bow of a boat heading east is east', () => {
  const bow = toWorld([0, 0, -4], { x: 0, z: 0, heading: 90 * DEG, heel: 0, pitch: 0, heave: 0 });
  assert.ok(Math.abs(bow[0] - 4) < 1e-9 && Math.abs(bow[2]) < 1e-9);
  const up = toWorld([0, 0, -4], { x: 0, z: 0, heading: 0, heel: 0, pitch: 10 * DEG, heave: 0 });
  assert.ok(up[1] > 0.6, 'pitch + raises the bow');
});

test('steady horizon: the camera cancels the set share of heel and pitch, the eye still rides the boat', () => {
  const p = pose({ heel: 20 * DEG, pitch: 8 * DEG, heave: 0.3 });
  const raw = settle(new HelmCamera(), p), st = settle(new HelmCamera({ steady: 0.4 }), p), full = settle(new HelmCamera({ steady: 1 }), p);
  const roll = (r) => Math.atan2(r.up[0], r.up[1]) / DEG;
  assert.ok(Math.abs(roll(raw) - 20) < 0.4, `fixed to the boat: ${roll(raw).toFixed(2)} deg`);
  assert.ok(Math.abs(roll(st) - 12) < 0.4, `40 % steadied: ${roll(st).toFixed(2)} deg of a 20 deg heel (12 expected)`);
  assert.ok(Math.abs(roll(full)) < 0.1, 'fully steadied: level');
  for (const k of [0, 1, 2]) assert.ok(Math.abs(st.pos[k] - raw.pos[k]) < 1e-9, 'the eye is the boat\'s: only the view\'s orientation is steadied');
  // pitch: the look's elevation above the horizon moves toward the resting look by the same share
  const elev = (r) => Math.asin((r.target[1] - r.pos[1]) / 10) / DEG;
  const rest = elev(settle(new HelmCamera(), pose()));
  assert.ok(Math.abs((elev(st) - rest) - 0.6 * (elev(raw) - rest)) < 0.2, `pitch ${elev(st).toFixed(2)} vs raw ${elev(raw).toFixed(2)} (rest ${rest.toFixed(2)})`);
});

test('the controls turn it on by default (0.4) and the Settings row, the shell and the settings carry it', async () => {
  const fs = await import('node:fs'), rd = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const { SETTINGS, createSettings } = await import('../src/ui/settings.js');
  const { pagesHtml } = await import('../src/ui/homePages.js');
  assert.equal(SETTINGS.steadyHorizon, true, 'on by default');
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = createSettings({ storage }); s.set('steadyHorizon', false); assert.equal(createSettings({ storage }).get('steadyHorizon'), false, 'saved');
  s.set('steadyHorizon', true); s.set('steadyHorizon', 'off'); assert.equal(s.get('steadyHorizon'), true, 'a non-boolean is refused');
  const html = pagesHtml({ waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' });
  const row = html.match(/<div class="set" data-set="steady">.*?<\/div>/s)?.[0] ?? '';
  assert.match(row, /steady horizon/); assert.match(row, /data-r="steady:on"/); assert.match(row, /data-r="steady:off"/);
  const home = rd('src/ui/home.js');
  assert.match(home, /data-r\^="steady:"[^\n]*settings\.get\('steadyHorizon'\)/, 'painted from the setting');
  assert.match(home, /startsWith\('steady:'\)[^\n]*settings\.set\('steadyHorizon'/, 'a click sets it');
  // the controls themselves (behaviour, not their source: the controls split moved STEADY to src/deck/index.js)
  const { STEADY } = await import('../classic/src/sail/controls.js'), { mountSail } = await import('./helpers/sail-controls.mjs');
  assert.equal(STEADY, 0.4);
  const m = mountSail();
  try {
    assert.equal(m.c.helmCam.steady, 0.4, 'on by default');
    assert.equal(m.c.setSteady(false), 0); assert.equal(m.c.helmCam.steady, 0);
    assert.equal(m.c.setSteady(true), STEADY); assert.equal(m.c.helmCam.steady, 0.4);
  } finally { m.dispose(); }
});
