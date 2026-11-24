// The fireworks launch site's A/B row (v2/sim/fireworksSite.js; owner, 2026-11-18): the bay by default, the mouth on the
// bay's axis past the channel, clear of the channel and its marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireworksSite, SITE, inShowScene, facingShow, showStartHeading, SHOW_VIEW, showStartPose, SHOW_START } from '../sim/fireworksSite.js';

test('the show\'s own start: the deep-water spot past the mouth\'s site, none for the bay\'s', () => {
  assert.deepEqual(showStartPose(fireworksSite(parseV2Flags(''))), { x: SHOW_START.x, z: SHOW_START.z });
  assert.equal(showStartPose(fireworksSite(parseV2Flags('?fwsite=bay'))), null);
  const h = showStartHeading(fireworksSite(parseV2Flags('')), SHOW_START.x, SHOW_START.z, 195);
  assert.ok(h > 72 && h < 83, `facing the show 18 deg off from there (${h.toFixed(1)})`);
});
import { bargesWorld } from '../../src/fireworks/stage.js';
import { parseV2Flags } from '../engine/flags.js';
import { channelAt, CHANNEL } from '../terrain/channel.js';
import { bargeProps, gameShow } from '../sim/fireworks.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

test('the default site is past the mouth at 1,000 m; ?fwsite=bay keeps the wow round\'s barges', () => {
  const s = fireworksSite(parseV2Flags(''));
  assert.equal(s.id, 'mouth'); assert.equal(s.d, 1000);
  const b = fireworksSite(parseV2Flags('?fwsite=bay'));
  assert.equal(b.id, 'bay');
  assert.deepEqual(b.barges.map((q) => [q.x, q.z]), bargesWorld().map((q) => [q.x, q.z]));
});

test('the fireworks scene faces the show: the window and the heading from the start', () => {
  assert.equal(inShowScene(21 + 43 / 60), true);         // the Fireworks pick lands 10 game s before the first shell
  assert.equal(inShowScene(21.5), false); assert.equal(inShowScene(22.5), false); assert.equal(inShowScene(13), false);
  assert.equal(inShowScene(13, true), true);              // ?fwt pins it
  const st = CURRENT_WATERS.start, h = facingShow(fireworksSite(parseV2Flags('')), st.x, st.z);
  assert.ok(h > 55 && h < 65, `about 60 deg from the start (${h.toFixed(1)})`);
});

test('the show beside the mast: the scene turns her 18 deg off the show, to starboard unless that is within 50 deg of the wind', () => {
  const site = fireworksSite(parseV2Flags('')), st = CURRENT_WATERS.start, f = facingShow(site, st.x, st.z);
  const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const a = showStartHeading(site, st.x, st.z, 195);   // the evening's wind from 195 deg: about 77.5 deg, 117 deg off the wind
  assert.ok(Math.abs(off(a, f) - SHOW_VIEW.offsetDeg) < 1e-9 && ((a - f + 360) % 360) < 180, `starboard of the show (${a.toFixed(1)} vs ${f.toFixed(1)})`);
  assert.equal(showStartHeading(site, st.x, st.z), a, 'no wind: starboard');
  // a wind from just starboard of the show: starboard would be in irons, so the port side
  const w = (f + 35) % 360, b = showStartHeading(site, st.x, st.z, w);
  assert.ok(off(b, w) >= SHOW_VIEW.ironsDeg && ((f - b + 360) % 360) < 180, `the side clear of the wind (${b.toFixed(1)}, wind ${w.toFixed(1)})`);
  // the wind dead on the show: both sides 18 deg off it, the starboard kept (the further of two equals)
  const c = showStartHeading(site, st.x, st.z, f);
  assert.ok(Math.abs(off(c, f) - SHOW_VIEW.offsetDeg) < 1e-9);
});

test('?fwsite=mouth puts both barges past the mouth on the start\'s line through it, clear of the channel', () => {
  for (const d of [600, 1000]) {
    const s = fireworksSite(parseV2Flags(`?fwsite=mouth&fwsited=${d}`)), st = CURRENT_WATERS.start, E = CHANNEL.pts.at(-1);
    assert.equal(s.id, 'mouth'); assert.equal(s.d, d);
    const toE = Math.hypot(E[0] - st.x, E[1] - st.z), toC = Math.hypot(s.centre[0] - st.x, s.centre[1] - st.z);
    assert.ok(Math.abs(toC - (toE + d)) < 1, 'the middle d m past the channel\'s lake end');
    const cross = ((E[0] - st.x) * (s.centre[1] - st.z) - (E[1] - st.z) * (s.centre[0] - st.x)) / (toE * toC);
    assert.ok(Math.abs(cross) < 1e-6, 'on the start\'s line through the mouth');
    for (const box of bargeProps(s.barges).boxes) assert.ok(channelAt(box.c[0], box.c[2]).d > 300, 'every prop far from the channel');
  }
  assert.equal(fireworksSite(parseV2Flags('?fwsite=mouth&fwsited=50')).d, SITE.dMin);
});

test('the show spreads over the site\'s barges (deterministic)', () => {
  const s = fireworksSite(parseV2Flags('?fwsite=mouth&fwsited=600'));
  const a = gameShow(1, { barges: s.barges }), b = gameShow(1, { barges: s.barges });
  assert.deepEqual(a.events.slice(0, 20), b.events.slice(0, 20));
  assert.notDeepEqual(a.events.map((e) => e.tilt), gameShow(1).events.map((e) => e.tilt), 'the leans follow the site\'s axis');
});

test('the bursts\' light behind the land: a burst hidden by a ridge lights nothing, one over it all, one at its edge a share', async () => {
  const { createOccluder } = await import('../sim/fireworksOcclude.js');
  const occ = createOccluder({ heightAt: (x) => (x > 400 && x < 450 ? 60 : -20) });   // a 60 m ridge (+ its canopy) 400–450 m out
  const eye = [0, 3, 0];
  assert.equal(occ.seen(eye, [1000, 100, 0]), 0, 'behind the ridge');
  assert.equal(occ.seen(eye, [1000, 400, 0]), 1, 'well over it');
  const edge = occ.seen(eye, [1000, 170, 0]); assert.ok(edge > 0 && edge < 1, `at its edge (${edge})`);
  const flash = { pos: new Float32Array([1000, 100, 0, 2, 1000, 400, 0, 2]), col: new Float32Array([1, 1, 1, 0.5, 1, 1, 1, 0.5]) };
  occ.apply(flash, eye);
  assert.deepEqual([flash.pos[3], flash.col[3], flash.pos[7], flash.col[7]], [0, 0, 2, 0.5]);
});
