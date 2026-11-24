// The boat on the lake's waves without a GPU (the thrill build, 2026-10-29): the physics (src/boat.js) + the hull float
// (src/boat/float.js) on the CPU wave surface (src/water-spectrum.js makeSurface), the wind field at a Day Sail level
// (src/wind.js), a helm holding a true wind angle. Plain JS: node (tools/sim_surf.mjs, tests/thrill.test.mjs) and the
// sound demo (demos/thrill-audio.js) run it.
import { BoatPhysics, Helm, CONTROLS, KN, DT } from '../boat.js';
import { HullFloat } from './float.js';
import { makeSurface, significantHeight, peakFrequency } from '../water-spectrum.js';
import { WindField } from '../wind.js';
import { SURF } from './thrill.js';
import { createSimulation } from '../sail/simulation.js';

const DEG = Math.PI / 180;

// baseMs: the wind's base speed to scale the node field to (null: as it comes). Node has no terrain, so the level's
// scale is set against the default bay factor; the page's level-4 base at 18:45 on the open lake is 10.5 m/s from
// 199° (renders/thrill/tmp/fetch.txt, the page's wind.base), 10.5 by default here.
// every: keep one row per `every` ticks; full: also keep a copy of the whole state (the sound demo)
export function simSurf({ level = 4, twaDeg = 150, fetchM = 4500, seconds = 300, seed = 1, noSea = false, surface: surfaceIn = null, x = 4500, z = -2500, hour = 18.75, warm = 30, baseMs = 10.5, every = 6, full = false } = {}) {
  const wind = new WindField({ seed, day: { hour, rate: 1 }, level });
  const w0 = wind.sample(x, z, 0);
  const k = baseMs ? baseMs / wind.base.speedMs : 1;
  const U = wind.base.speedMs * k, dirDeg = wind.base.dirDeg;
  const surface = surfaceIn ? surfaceIn(dirDeg, U) : makeSurface({ seed, dirDeg, U, fetchAt: () => fetchM });   // surfaceIn(dirDeg, U): { heightAt, velocityAt? } another sea (tests/ultra-surf.test.mjs)
  const float = new HullFloat({ surface });
  const fromRad = dirDeg * DEG, twa = (twaDeg * DEG) * -1;   // wind on the port side (the boom to starboard)
  const boat = new BoatPhysics({ x, z, heading: fromRad - twa, speed: 3 });
  const helm = new Helm();
  let wave = { slopeX: 0, bowRelVel: 0 };
  const env = { t: 0, windAt: (px, pz, t) => { const s = wind.sample(px, pz, t); return { vx: s.vx * k, vz: s.vz * k }; }, sea: noSea ? null : () => wave, ...(surface.velocityAt && !noSea ? { currentAt: (px, pz, t) => { const v = surface.velocityAt(px, pz, t, { filterM: 3.6, depthM: float.depthM }); return { vx: v[0], vz: v[1] }; } } : {}) };
  const rows = [];
  // the boat on the shared Simulation (src/sail/simulation.js), its clock t = i × DT
  const sim = createSimulation({ clock: 'index', boat: { phys: boat, env: (t) => { env.t = t; return env; } } });
  for (let i = 0, n = Math.round((seconds + warm) / DT); i < n; i++) {
    sim.tick({ ...CONTROLS, rudder: helm.toTWA(boat.state, twa, fromRad) });
    const st = boat.state;
    if (!noSea) wave = float.update(st, env.t, DT);
    if (i * DT >= warm && i % every === 0) rows.push({ ...(full ? { s: JSON.parse(JSON.stringify(st)) } : {}), t: +(i * DT - warm).toFixed(2), kn: st.u / KN, sog: st.sog / KN, push: st.waveSurge, res: st.hullRes, surf: st.surf, heel: st.heel / DEG, twa: st.trueWind.angle / DEG, tws: st.trueWind.speed / KN, slamVel: st.slamVel, slam: st.slam, rail: st.rail, roundUp: st.roundUp, groove: st.groove, pitch: wave.pitch ?? 0 });
  }
  const fp = peakFrequency(U, fetchM), hs = significantHeight(U, fetchM);
  return { rows, sea: { U, dirDeg, fetchM, hs, tp: 1 / fp, lambdaP: 9.81 / (2 * Math.PI * fp * fp), cP: 9.81 / (2 * Math.PI * fp) }, wind0: w0 };
}

// the bursts: runs of surf ≥ SURF.on, with their peak speed and length
export function bursts(rows) {
  const out = []; let cur = null;
  for (const r of rows) {
    if (r.surf >= SURF.on) { if (!cur) cur = { t0: r.t, peak: r.kn, t1: r.t }; cur.peak = Math.max(cur.peak, r.kn); cur.t1 = r.t; }
    else if (cur && r.surf < SURF.off) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map((b) => ({ ...b, len: +(b.t1 - b.t0).toFixed(2) }));
}

