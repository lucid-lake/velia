// Each wind level stays in its band at every hour (fix/wind-level-range, 2026-11-04). An outside tester sailed
// "Wind 3 · Fresh" and saw the true wind go 6-8 kn -> 24-26 kn within a minute. The level's scale was fixed at 18:45,
// but the day's own base runs from 0.3 m/s (the 13:30 lull) to 12-20 kt (the afternoon breeze): level 3 sailed 5 kn of
// mean at 10:00 and up to 29 kn at 14:00 (seed 1, the start). The wind as a live Sail page builds it: the day on the
// day clock (10 game s per sim s, src/timeOfDay.js), the real terrain, the first gust and the shifts; 1 s steps.
// On the old code (main before this fix) the band tests fail at 10:00 and 14:00 for every level, and the tester's
// case fails on the peak (29.4 kn) and the 60 s swing (17 kn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindField, WIND_LEVELS, firstGustFor } from '../src/sim/wind.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { TimeOfDay, dayClockSchedule, DEFAULT_TIMERATE } from '../src/sim/timeOfDay.js';

const KN = 0.514444;
const START = { x: 1200, z: -1050, headingDeg: 251 };              // src/modes/daysail/index.js START
const FIRST_GUST = { aheadM: 195, offsetM: 0, gain: 0.35, edgeM: 10 };  // src/modes/daysail/index.js FIRST_GUST
const PTS = [[START.x, START.z], [776, -626], [1624, -1474]];      // the start and two water points 600 m off it
const T1 = makeTerrain({ seed: 1 });

function sail({ seed = 1, hour, level }) {
  const w = new WindField({ seed, day: { hour, rate: 1 }, level, shifts: true,
    firstGust: firstGustFor({ x: START.x, z: START.z, headingDeg: START.headingDeg, ...FIRST_GUST }) });
  w.setTerrain(T1.heightAt);
  const clock = new TimeOfDay({ hour, rate: DEFAULT_TIMERATE, schedule: dayClockSchedule({ base: DEFAULT_TIMERATE }) });
  w.setClock((t) => clock.hourAt(t));
  return w;
}
const series = (w, x, z, dur, at = null) => {
  const v = [];
  for (let t = 0; t <= dur; t++) { if (at && t === at.t) w.setLevel(at.level, { t, at: START, overS: 50 }); v.push(w.sample(x, z, t).speed / KN); }
  return v;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const swing60 = (v) => { let m = 0; for (let i = 0; i + 60 <= v.length; i++) { const w = v.slice(i, i + 60); m = Math.max(m, Math.max(...w) - Math.min(...w)); } return m; };

test('every level keeps its band for 5 min at 10:00, 14:00 and 18:45 (seed 1, the start and 2 points near it)', () => {
  for (let L = 1; L <= 4; L++) for (const hour of [10, 14, 18.75]) {
    const [lo, hi] = WIND_LEVELS[L - 1].kn, all = [], tag = `L${L} ${lo}-${hi} kn at ${hour} h`;
    for (const [x, z] of PTS) {
      const w = sail({ hour, level: L }), v = series(w, x, z, 300), m = mean(v), mx = Math.max(...v);
      all.push(...v);
      // each point's 5-min mean near the band (the lee and the narrows move a point ± 20 %)
      assert.ok(m >= 0.8 * lo && m <= 1.1 * hi, `${tag} (${x}, ${z}): mean ${m.toFixed(1)} kn`);
      // gusts ride on it: the peak at most 1.3 x the band's top, and 1.9 x the point's mean (the gust cap is 1.25 x
      // the local wind; the base may move floor -> ceiling within the band in 5 min). Old: 1.35-1.69 x and 2.3-3.9 x at 14:00
      assert.ok(mx <= 1.3 * hi, `${tag} (${x}, ${z}): peak ${mx.toFixed(1)} kn`);
      assert.ok(mx <= 1.9 * m, `${tag} (${x}, ${z}): peak / mean ${(mx / m).toFixed(2)}`);
      // the lulls: 95 % of the time over 0.4 x the band's bottom (the start sits in a lull for its first minute, the
      // headland's lulls reach 1 - 0.35 x 1.6 = 0.44 x: the gust field is unchanged). Old: 0.01-0.38 x at 10:00 and 14:00
      assert.ok(pct(v, 0.05) >= 0.4 * lo, `${tag} (${x}, ${z}): p05 ${pct(v, 0.05).toFixed(1)} kn`);
    }
    const m = mean(all);
    assert.ok(m >= lo && m <= hi, `${tag}: the three points' mean ${m.toFixed(1)} kn`);
  }
});

test('the tester’s case: level 3 from 13:00 (and 2 -> 3 at 30 s), 20 min at the start: no 6 -> 26 kn run', () => {
  const [lo, hi] = WIND_LEVELS[2].kn;
  for (const seed of [1, 2]) for (const change of [null, { t: 30, level: 3 }]) {
    const w = sail({ seed, hour: 13, level: change ? 2 : 3 }), v = series(w, START.x, START.z, 1200, change);
    const tag = `seed ${seed}${change ? ' 2->3' : ''}`, after = v.slice(change ? 90 : 0), m = mean(after);
    assert.ok(m >= lo && m <= hi, `${tag}: mean ${m.toFixed(1)} kn`);
    assert.ok(Math.max(...v) <= 1.3 * hi, `${tag}: peak ${Math.max(...v).toFixed(1)} kn`);
    assert.ok(swing60(after) <= 0.95 * hi, `${tag}: the largest 60 s swing ${swing60(after).toFixed(1)} kn`);
  }
});
