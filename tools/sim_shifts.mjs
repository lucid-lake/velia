// Does playing the shifts pay? A 20-minute beat in the day's wind (src/wind.js with src/wind-shifts.js), the same boat
// (src/boat.js) from the same start, sailed four ways:
//   header   tack on a header: the pod's trend (ShiftTrend) reads a header of ≥ 4° for 6 s, at least 60 s after a tack;
//   one      ignore the shifts: one tack at 10 min (the fewest tacks: what a beat with no information sails);
//   even     ignore the shifts, tack as often as `header` did, evenly spaced (the same tack cost, no timing);
//   lift     the wrong way round: tack on a lift (a check that the sign matters).
// The helm holds a close-hauled true wind angle (42°) to the LOCAL wind, as a sailor does by the telltales. The score is
// the VMG: the distance made good toward the wind (the day's base direction, before the shifts) over the beat, in kn.
//   node tools/sim_shifts.mjs [--seeds 1-8] [--level 3] [--hour 16.5] [--minutes 20] [--json]
// tests/wind-shifts.test.mjs runs a short version (3 seeds) and checks header > one and header > even.
import { BoatPhysics, CONTROLS, Helm, KN, DT } from '../src/sim/boat.js';
import { WindField } from '../src/sim/wind.js';
import { ShiftTrend } from '../src/sim/wind-shifts.js';

const DEG = Math.PI / 180;
export const SIM = { twaDeg: 42, headerDeg: 4, holdS: 6, minGapS: 60 };

// one beat: returns { vmgKn, tacks, distM }
export function beat({ seed = 1, level = 3, hour = 16.5, minutes = 20, strategy = 'header', tackTimes = null, shifts } = {}) {
  const wind = new WindField({ seed, day: { hour, rate: 1 }, level, shifts: shifts !== false });
  wind.at(0);
  const mean = wind.base.dirDeg * DEG;                       // the day's direction: the course is straight up it
  const env = { t: 0, windAt: (x, z, t) => { const w = wind.sample(x, z, t); return { vx: w.vx, vz: w.vz }; } };
  const twa = SIM.twaDeg * DEG;
  let side = 1;                                              // + = starboard tack (the wind over the starboard bow)
  const boat = new BoatPhysics({ heading: mean - side * twa, speed: 2.5 });
  const helm = new Helm(), trend = new ShiftTrend();
  const n = Math.round(minutes * 60 / DT);
  let lastTack = -1e9, hold = 0, tacks = 0, ti = 0;
  const times = tackTimes ? [...tackTimes] : null;
  for (let i = 0; i < n; i++) {
    const t = i * DT; env.t = t;
    const s = boat.state, w = wind.sample(s.x, s.z, t);
    const twdRad = w.dirDeg * DEG;
    // the trend at 10 Hz, as the pod
    if (i % 6 === 0) {
      const tr = trend.update(6 * DT, w.dirDeg, side * twa);
      const sinceTack = t - lastTack;
      let go = false;
      if (strategy === 'header' || strategy === 'lift') {
        const want = strategy === 'header' ? -1 : 1;
        hold = tr.signed * want >= SIM.headerDeg && sinceTack > SIM.minGapS ? hold + 6 * DT : 0;
        go = hold >= SIM.holdS;
      } else if (times && ti < times.length && t >= times[ti]) { go = true; ti++; }
      if (go) { side = -side; lastTack = t; hold = 0; tacks++; }
    }
    const rudder = helm.toTWA(s, side * twa, twdRad);
    boat.step(DT, { ...CONTROLS, rudder }, env);
  }
  const s = boat.state, up = s.x * Math.sin(mean) - s.z * Math.cos(mean);   // m toward the wind (FROM `mean`)
  return { vmgKn: up / (minutes * 60) / KN, tacks, distM: up };
}

// all four strategies for one seed
export function compare(o = {}) {
  const minutes = o.minutes ?? 20;
  const header = beat({ ...o, strategy: 'header' });
  const one = beat({ ...o, strategy: 'times', tackTimes: [minutes * 30] });
  const k = Math.max(1, header.tacks), even = beat({ ...o, strategy: 'times', tackTimes: Array.from({ length: k }, (_, i) => (i + 1) * minutes * 60 / (k + 1)) });
  const lift = beat({ ...o, strategy: 'lift' });
  return { seed: o.seed ?? 1, header, one, even, lift };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter((x) => x.length));
  const [s0, s1] = String(args.seeds ?? '1-8').split('-').map(Number);
  const o = { level: +(args.level ?? 3), hour: +(args.hour ?? 16.5), minutes: +(args.minutes ?? 20) };
  const rows = [];
  for (let seed = s0; seed <= (s1 ?? s0); seed++) {
    const r = compare({ ...o, seed });
    rows.push(r);
    if (!args.json) console.log(`seed ${seed}: header ${r.header.vmgKn.toFixed(2)} kn (${r.header.tacks} tacks) · one tack ${r.one.vmgKn.toFixed(2)} · even ${r.even.vmgKn.toFixed(2)} (${r.even.tacks}) · on lifts ${r.lift.vmgKn.toFixed(2)} (${r.lift.tacks})`);
  }
  const mean = (k) => rows.reduce((a, r) => a + r[k].vmgKn, 0) / rows.length;
  const sum = { header: mean('header'), one: mean('one'), even: mean('even'), lift: mean('lift') };
  if (args.json) console.log(JSON.stringify({ o, rows, sum }));
  else console.log(`mean VMG over ${rows.length} seeds, level ${o.level}, ${o.minutes} min from ${o.hour}: header ${sum.header.toFixed(3)} kn · one tack ${sum.one.toFixed(3)} · even ${sum.even.toFixed(3)} · on lifts ${sum.lift.toFixed(3)} → header vs one +${((sum.header / sum.one - 1) * 100).toFixed(1)} %, vs even +${((sum.header / sum.even - 1) * 100).toFixed(1)} %`);
}
