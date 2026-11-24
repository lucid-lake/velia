// The one wind every weather effect reads (owner, 2026-11-24: "One wind drives the whole storm ... Rain angle, cloud drift and
// gull calls all follow the wind"). Plain JS, no DOM, no GPU. It owns no wind of its own: it reads the shared field
// (src/sim/wind.js: the day's base, the gusts, the terrain, and the storm's outflow as the field's 'flow' modifier,
// src/sim/weather/stormWind.js) once a frame at the eye and hands the same numbers to:
//   the rain        its lean and streak direction (render/storm.js): the surface wind at the eye, a gust leaning it more
//                   (the gust is the wind's own rise over its 8 s mean, so the field's gusts, the outflow's gusty band and the
//                   front all count);
//   the clouds      their drift (render/clouds.js): the wind aloft, integrated over the scene clock (the deck moves at the
//                   wind's speed now, never by speed × t, so a changing wind no longer slides the whole deck);
//   the storm       aloft, a storm's steering flow (stormArc.js CELL: its cells ride from 250 deg) takes over the deck's drift by
//                   the storm's front envelope, so the deck and the cells move together;
//   the gulls       `eye` and `at(x, z)`: the getter their calls read (the gulls' own module reads it; nothing here plays a sound).
//   const ww = createWeatherWind({ field, steer: { fromDeg: 250, speedMs: 14 } });
//   ww.update({ eye, t, windT, base, storm, cut })   each frame, after the storm's step (the field has the outflow)
//   ww.eye → { vx, vz, speedMs, fromDeg, mean, gust }   ww.rain → { vx, vz, lean }   ww.drift → [x, z] (m)   ww.at(x, z, out)
// Deterministic: no wall clock, no Math.random(); the means and the drift step on the scene clock and reset on a time cut.
const DEG = Math.PI / 180;

export const WEATHER_WIND = Object.freeze({
  meanS: 8,          // the wind's running mean (s): a gust is the wind over it
  gustLean: 1.6,     // the rain's extra lean per unit of gust (a 30 % gust leans the rain's drift × 1.48 more, on top of its speed)
  gustCap: 1.0,      // at most this much extra
  driftMul: 1.5,     // the deck's drift per m/s of wind aloft (v1's world.js; v2/sim/clouds.js KEY.driftMul)
  steerFromDeg: 250, // a storm's steering flow aloft (stormArc.js CELL.fromDeg): the cells ride it
  steerMs: 14,       // its speed (m/s): the deck races under a storm
  maxDt: 0.25,       // a frame longer than this is a jump, not a step
});

// toward (x east, z south) of a FROM bearing, as src/sim/wind.js
export const towardOf = (fromDeg) => [-Math.sin(fromDeg * DEG), Math.cos(fromDeg * DEG)];
export const fromOf = (vx, vz) => ((Math.atan2(-vx, vz) / DEG) % 360 + 360) % 360;

// the rain's horizontal drift from the surface wind and its gust: the wind itself, × (1 + gustLean × the rise over the mean)
export function rainDrift(vx, vz, gust, W = WEATHER_WIND) {
  const k = 1 + Math.min(W.gustCap, W.gustLean * Math.max(0, gust - 1));
  return { vx: vx * k, vz: vz * k, k, lean: Math.atan2(Math.hypot(vx, vz) * k, 9) };   // lean: from the vertical, at 9 m/s fall (render/storm.js RAIN.fallMs)
}

// the wind aloft: the day's base (free air, no terrain), turned toward the storm's steering flow by w (0–1)
export function aloftWind(baseSpeed, baseFromDeg, w, W = WEATHER_WIND) {
  const [bx, bz] = towardOf(baseFromDeg), [sx, sz] = towardOf(W.steerFromDeg);
  const vx = bx * baseSpeed * (1 - w) + sx * W.steerMs * w, vz = bz * baseSpeed * (1 - w) + sz * W.steerMs * w;
  return { vx, vz, speedMs: Math.hypot(vx, vz), fromDeg: fromOf(vx, vz) };
}

// field: the shared WindField (sample(x, z, t) → { vx, vz, speed, dirDeg })
export function createWeatherWind({ field, W = WEATHER_WIND } = {}) {
  const eye = { vx: 0, vz: 0, speedMs: 0, fromDeg: 0, mean: 0, gust: 1 };
  const rain = { vx: 0, vz: 0, lean: 0, k: 1 };
  const aloft = { vx: 0, vz: 0, speedMs: 0, fromDeg: 0 };
  const drift = [0, 0];
  let lastT = null, lastCut = null, windT = 0;
  return {
    eye, rain, aloft, drift,
    // a point's wind for a reader that needs it elsewhere (the gulls' calls): the field's own sample (outflow included)
    at(x, z, out = {}) {
      const s = field ? field.sample(x, z, windT) : { vx: 0, vz: 0, speed: 0, dirDeg: 0 };
      out.vx = s.vx; out.vz = s.vz; out.speedMs = s.speed; out.fromDeg = s.dirDeg;
      return out;
    },
    // eye [x, y, z]; t the scene clock (the drift's and the means' clock); windT the field's clock (the boat's sim time);
    // base { speedMs, dirDeg } the day's free-air wind; storm { on, front } (front: the outflow's envelope 0–1); cut: the clock's cut count
    update({ eye: e, t = 0, windT: wt = t, base = null, storm = null, cut = 0 }) {
      windT = wt;
      const s = field ? field.sample(e[0], e[2], wt) : { vx: 0, vz: 0, speed: 0, dirDeg: 0 };
      const jump = lastT == null || cut !== lastCut || !(t - lastT >= 0) || t - lastT > W.maxDt;
      const dt = jump ? 0 : t - lastT;
      lastT = t; lastCut = cut;
      eye.vx = s.vx; eye.vz = s.vz; eye.speedMs = s.speed; eye.fromDeg = s.dirDeg;
      eye.mean = jump ? s.speed : eye.mean + (s.speed - eye.mean) * (1 - Math.exp(-dt / W.meanS));
      eye.gust = eye.mean > 0.3 ? s.speed / eye.mean : 1;
      const r = rainDrift(s.vx, s.vz, eye.gust, W);
      rain.vx = r.vx; rain.vz = r.vz; rain.lean = r.lean; rain.k = r.k;
      const w = storm && storm.on ? Math.max(0, Math.min(1, storm.front ?? 0)) : 0;
      const a = aloftWind(base?.speedMs ?? s.speed, base?.dirDeg ?? s.dirDeg, w, W);
      aloft.vx = a.vx; aloft.vz = a.vz; aloft.speedMs = a.speedMs; aloft.fromDeg = a.fromDeg;
      // the deck's drift: on a jump (the first frame, a time cut) it is placed where speed × t puts it (the old drift, so a
      // still wind draws the same deck); after that it moves at the wind aloft's speed now
      if (jump) { drift[0] = a.vx * W.driftMul * t; drift[1] = a.vz * W.driftMul * t; }
      else { drift[0] += a.vx * W.driftMul * dt; drift[1] += a.vz * W.driftMul * dt; }
      return eye;
    },
  };
}
