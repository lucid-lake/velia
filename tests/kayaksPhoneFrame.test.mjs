// The first pair's notice shot on a phone (fix/kayaks-phone-framing): on an upright phone (390 × 844) and one held sideways
// (844 × 390), both kayakers stay in the frame from the shot's first frame through its hold and into its ease back, and
// the near paddler stands big (an upright phone: about 190 px of 844 through the hold); the desktop's shot is as before. Behaviour only: the
// real sail, the pair's own minds, Sail's follow camera and the notice, each frame's camera pose projected
// (tests/helpers/first-sail.mjs runShot). The shot is off by default since 2026-11-11 (owner: stay on the sailing camera);
// these runs turn Settings' kayakCam on, as a player who wants it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShot } from './helpers/first-sail.mjs';

const VIEWS = { portrait: [390, 844], landscape: [844, 390], desktop: [1280, 720] };
const run = (view, seed) => { const [w, h] = VIEWS[view]; return { h, ...runShot({ seed, aspect: w / h, phone: view !== 'desktop', secs: 13, kayakCam: true }) }; };

test('on a phone both kayakers stay in the frame through the notice shot (the ease in, the hold, the first of the ease back)', () => {
  for (const view of ['portrait', 'landscape']) for (const seed of [1, 2, 3]) {
    const { frames } = run(view, seed);
    const shot = frames.filter((f) => f.phase === 'in' || f.phase === 'hold' || (f.phase === 'out' && f.w > 0.9));
    assert.ok(shot.length > 60 * 7.5, `${view} ${seed}: a shot of ${(shot.length / 60).toFixed(1)} s`);
    const out = shot.find((f) => !f.both);
    assert.equal(out, undefined, `${view} ${seed}: a kayaker leaves the frame at ${out?.t.toFixed(2)} s (${out?.phase})`);
  }
});

test('on a phone the near paddler stands big through the hold: an upright phone about 190 px of 844, sideways about 120 px of 390', () => {
  for (const view of ['portrait', 'landscape']) for (const seed of [1, 2, 3]) {
    const { frames, h } = run(view, seed);
    const px = frames.filter((f) => f.phase === 'hold').map((f) => f.near / 2 * h).sort((a, b) => a - b);
    const med = px[Math.floor(px.length / 2)], min = px[0];
    assert.ok(med >= (view === 'portrait' ? 180 : 110), `${view} ${seed}: the near paddler ${med.toFixed(0)} px (median of the hold)`);
    assert.ok(min >= (view === 'portrait' ? 140 : 90), `${view} ${seed}: the near paddler down to ${min.toFixed(0)} px`);
  }
});

test('on a phone the camera stays calm: never nearer a paddler than 3.4 m, never tipped more than 21° down, from the ease in to the end of the ease back', () => {
  for (const view of ['portrait', 'landscape']) for (const seed of [1, 2, 3]) {
    const shot = run(view, seed).frames.filter((f) => f.phase !== 'idle');
    const near = Math.min(...shot.map((f) => f.camD)), down = Math.max(...shot.map((f) => f.down));
    assert.ok(near >= 3.4, `${view} ${seed}: the camera ${near.toFixed(1)} m from a paddler`);
    assert.ok(down <= 21, `${view} ${seed}: the aim ${down.toFixed(0)}° down`);
  }
});

test('the desktop shot is unchanged: both kayakers in through the ease and the hold, the near paddler over 150 px of 720', () => {
  for (const seed of [1, 2, 3]) {
    const { frames, h } = run('desktop', seed);
    const shot = frames.filter((f) => f.phase === 'in' || f.phase === 'hold');
    assert.equal(shot.find((f) => !f.both), undefined, `desktop ${seed}`);
    const min = Math.min(...frames.filter((f) => f.phase === 'hold').map((f) => f.near / 2 * h));
    assert.ok(min >= 150, `desktop ${seed}: ${min.toFixed(0)} px`);
  }
});

test('the default start keeps the sailing camera (owner, 2026-11-11): no notice shot, and the pair in the follow camera\'s own view from the first frame', () => {
  for (const [view, w, h] of [['desktop', 1920, 1080], ['portrait', 412, 915]]) {
    const { frames } = runShot({ seed: 1, aspect: w / h, phone: view !== 'desktop', secs: 15 });
    assert.ok(frames.every((f) => f.phase === 'idle' && f.w === 0), `${view}: a notice shot ran (${frames.find((f) => f.phase !== 'idle')?.t.toFixed(2)} s)`);
    assert.ok(frames.slice(0, 30).every((f) => f.both), `${view}: the pair out of the first half second's frame`);
    const both = frames.filter((f) => f.t <= 10 && f.both).length / 60;
    assert.ok(both >= 4, `${view}: the pair in the frame ${both.toFixed(1)} s of the first 10 s`);
  }
});
