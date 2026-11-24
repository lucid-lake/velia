// A headless Chill voyage: the real BoatPhysics on the real wind field (Tahoe's day, the terrain's lee and channel),
// the traffic, and the navigator, at 60 Hz with no GPU. For tests/navigator.test.mjs and tools (renders/chill/).
// Returns the safety record: the least depth, shore and object distances, the closest traffic, stalls, tacks, stops.
import { makeTerrain } from '../../sim/terrain.js';
import { WindField } from '../../sim/wind.js';
import { layoutShoreline } from '../../shoreline-layout.js';
import { harbourLayout } from '../../harbour-layout.js';
import { createTraffic } from '../../sim/traffic.js';
import { BoatPhysics, CONTROLS, DT } from '../../sim/boat.js';
import { analyticSun, TimeOfDay } from '../../sim/timeOfDay.js';
import { buildChart, scenicRoute, Navigator, NAV, chooseStart } from '../../sim/modes/chill/navigator.js';
import { CHILL } from '../../sim/modes/chill/params.js';
import { CruisePilot } from '../../sim/modes/chill/pilot.js';
import { HullFloat } from '../../sim/boat/float.js';
import { createSimulation } from '../../sim/sail/simulation.js';

const DEG = Math.PI / 180;

// the world as the page builds it (src/core/world.js), without the meshes
// schedule: a clock rate schedule (params.js chillSchedule(): the page's quick night) in place of the constant rate
export function chillWorld({ seed = 1, hour = 18, advisory = false, rate = CHILL.timeRate, schedule = null, extra = [] } = {}) {   // extra: more fixed objects on the chart (the show's props: src/fireworks/solids.js chartObjects)
  const terrain = makeTerrain({ seed });
  const wind = new WindField({ seed, day: { hour, rate: 1, advisory } });
  wind.setTerrain(terrain.heightAt);
  const tod = new TimeOfDay({ hour, rate, schedule });   // the page's clock (src/core/index.js), on sim time
  const clock = (t) => tod.hourAt(t);
  if (rate > 0 || schedule) wind.setClock(clock);
  const shoreline = layoutShoreline(terrain, { seed });
  const harbour = { ...harbourLayout({ terrain, seed }), boats: [] };   // the slips empty, as the game's (src/harbour.js)
  const traffic = createTraffic();   // none, as the game's (src/traffic.js)
  const chart = buildChart(terrain, { shoreline, harbour, lanes: [], extra });
  return { terrain, wind, shoreline, harbour, traffic, chart, clock, tod };
}

export function voyage({ seed = 1, hour = 18, advisory = false, rate = CHILL.timeRate, schedule = null, minutes = 30, start = null, onTick = null, world = null, skipper = null, surface = null, ground = null } = {}) {   // surface: { heightAt(x, z, t, opts) } puts the hull on waves (tests/ultra-seastate.test.mjs); null: flat water, as before
  const W = world ?? chillWorld({ seed, hour, advisory, rate, schedule });
  const { terrain, wind, shoreline, harbour, traffic, chart, clock } = W;
  const w0 = wind.sample(CHILL.start.x, CHILL.start.z, 0);
  const S = start ?? chooseStart(chart, { seed, traffic, t0: 0, windFrom: Math.atan2(-w0.vx, w0.vz) });
  const phys = new BoatPhysics({ x: S.x, z: S.z, heading: S.headingDeg * DEG, speed: S.speed });
  const nav = new Navigator({ chart, route: scenicRoute(chart, { seed }), seed });
  nav.pickNearest(S.x, S.z);
  const env = { t: 0, windAt: (x, z, t) => { const w = wind.sample(x, z, t); return { vx: w.vx, vz: w.vz }; } };
  if (ground) { env.ext = ground.ext; env.post = ground.post; }   // the bottom (src/boat/ground.js): the same depth the chart reads; tests/ground.test.mjs sails Cruise on it
  // the sea: the hull float and the physics' wave inputs, as src/boat/ride.js gives them in the game
  let wave = { heave: 0, pitch: 0, roll: 0, slopeX: 0, bowRel: 0, bowRelVel: 0 };
  const float = surface ? new HullFloat({ surface }) : null;
  if (surface) {
    env.sea = () => wave;
    env.waveAt = (x, z, t) => {
      const d = 0.5, o = { filterM: 3.6 }, y = surface.heightAt(x, z, t, o);
      const gx = (surface.heightAt(x + d, z, t, o) - surface.heightAt(x - d, z, t, o)) / (2 * d), gz = (surface.heightAt(x, z + d, t, o) - surface.heightAt(x, z - d, t, o)) / (2 * d);
      const inv = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      return { y, nx: -gx * inv, nz: -gz * inv };
    };
  }
  const ctl = { ...CONTROLS };
  // skipper: a skill 0..1 sails with the AI skipper (the pro trim); null: the navigator's own helm and the crew's trim
  const pilot = skipper == null ? null : new CruisePilot({ nav, skill: skipper, seed, windAt: env.windAt });
  const balls = [...shoreline.balls, ...shoreline.field];
  const fixed = chart.objects;   // piers, balls (with their swing), breakwaters, docks, the basin
  const rec = { minDepth: Infinity, minShore: Infinity, minObj: Infinity, minBall: Infinity, minBuoy: Infinity, minTraffic: Infinity, minIsland: Infinity,
    worstStallS: 0, stallS: 0, becalmedS: 0, dist: 0, maxHeelDeg: 0, reefMax: 0, at: {} };
  const I = terrain.islandR;
  const n = Math.round(minutes * 60 / DT);
  let px = phys.state.x, pz = phys.state.z;
  // the boat on the shared Simulation (src/sail/simulation.js), its clock t = i × DT; the pilot helms and the float reads
  // the waves before each tick
  let out;
  const sim = createSimulation({ clock: 'index', boat: { phys, env: (t) => { env.t = t; return env; } } });
  const hooks = { before(id, t) {
    const sunElevDeg = Math.asin(analyticSun(((clock(t) % 24) + 24) % 24).y) / DEG;
    if (pilot) out = pilot.update(DT, phys.state, ctl, { t, sunElevDeg, traffic });
    else { out = nav.update(phys.state, { t, sunElevDeg, traffic }); ctl.rudder = out.rudder; ctl.jibSide = out.jibSide; }
    if (float) wave = float.update(phys.state, t, DT);
  } };
  for (let i = 0; i < n; i++) {
    const t = sim.tick(ctl, hooks), s = phys.state;
    // the record, every tick at the hull's bow, middle and stern (±4.5 m)
    for (const f of [-4.5, 0, 4.5]) {
      const x = s.x + Math.sin(s.heading) * f, z = s.z - Math.cos(s.heading) * f;
      const depth = -terrain.heightAt(x, z), shore = -terrain.shoreDistance(x, z);
      if (depth < rec.minDepth) { rec.minDepth = depth; rec.at.depth = [x | 0, z | 0, t | 0]; }
      if (shore < rec.minShore) { rec.minShore = shore; rec.at.shore = [x | 0, z | 0, t | 0]; }
    }
    if (i % 6 === 0) {   // 10 Hz: the objects and the traffic
      for (const [ox, oz, r] of fixed) { const d = Math.hypot(ox - s.x, oz - s.z) - r; if (d < rec.minObj) { rec.minObj = d; rec.at.obj = [s.x | 0, s.z | 0, t | 0]; } }
      for (const b of balls) rec.minBall = Math.min(rec.minBall, Math.hypot(b.x - s.x, b.z - s.z));
      for (const [ox, oz] of chart.buoys) rec.minBuoy = Math.min(rec.minBuoy, Math.hypot(ox - s.x, oz - s.z));
      for (const a of traffic.agents(t)) { const d = Math.hypot(a.x - s.x, a.z - s.z); if (d < rec.minTraffic) { rec.minTraffic = d; rec.at.traffic = [a.id, s.x | 0, s.z | 0, t | 0]; } }
      // the island: its shore is where islandR = 1 (the lidar's ellipse, 79 × 40 m semi-axes); the distance there,
      // roughly, along the ray from its centre: |p| (1 − 1 / islandR) (the old basin's round island used 32 m radii)
      const ri = I(s.x, s.z), pr = Math.hypot(s.x - terrain.lake.island.x, s.z - terrain.lake.island.z);
      rec.minIsland = Math.min(rec.minIsland, pr * (1 - 1 / Math.max(ri, 1e-6)));
    }
    // a stall: head to wind and stopped, while there is a breeze to sail in (≥ 1.5 m/s); in a calm (the night
    // drainage is 0.6 m/s) nothing sails, and that is counted apart (becalmedS, calmIronsS)
    const inIrons = Math.abs(s.trueWind.angle) < 35 * DEG && s.u < 0.3;
    const windy = s.trueWind.speed >= 1.5;
    rec.stallS = inIrons && windy ? rec.stallS + DT : 0;
    if (rec.stallS > rec.worstStallS) { rec.worstStallS = rec.stallS; rec.at.stall = [s.x | 0, s.z | 0, t | 0]; }
    rec.calmIronsS = inIrons && !windy ? (rec.calmIronsS ?? 0) + DT : (rec.calmIronsS ?? 0);
    if (s.trueWind.speed < 1) rec.becalmedS += DT;
    rec.dist += Math.hypot(s.x - px, s.z - pz); px = s.x; pz = s.z;
    rec.maxHeelDeg = Math.max(rec.maxHeelDeg, Math.abs(s.heel) / DEG);
    rec.reefMax = Math.max(rec.reefMax, s.reef);
    onTick?.(t, s, out, nav);
  }
  rec.minDepthUnderKeel = rec.minDepth - NAV.draft;
  return { rec, nav: nav.stats(), reached: nav.reached, state: phys.state, hourEnd: clock(n * DT) };
}
