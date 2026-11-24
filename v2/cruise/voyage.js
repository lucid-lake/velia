// Cruise's voyage on v2 (BACKLOG-v2 #11): v1's src/modes/chill/voyage.js on v2's shared sim, with v1's own three-free parts as
// they are: the chart (src/sim/modes/chill/navigator.js buildChart, on v1's lake terrain over v2's heights: v2/sim/lake.js), the
// start (chooseStart), the navigator and the scenic round (Navigator, scenicRoute), the AI skipper at skill 1 (CruisePilot), the
// director's shots (src/modes/chill/director.js) and the five cameras (src/modes/chill/rig.js: astern, above, helm, island,
// cinematic; v2's order and start: ./cameras.js, the Boat view first, owner 2026-11-15). The navigator and the skipper sail v2's boat (v2/sim/boat.js) through its autopilot hook: B.drive(fn) runs fn
// before every 1/60 s physics tick, as v1's helm.js before-hook runs on the same 'start' clock, so the same inputs give v1's
// controls tick for tick. Pure (no DOM, no GPU): node drives it (v2/tests/cruise.test.mjs) on v1's own terrain too.
//   const V = createCruiseVoyage({ B, lake, wind, seed, flags, chartIn, traffic, sun, t0 })
//   V.place()                       the start pose (?start=x,z&heading= or v1's chooseStart) → B.place, the navigator's first stop
//   V.attach() / V.detach()         the autopilot on B (Cruise sails) / off (the hand-over: Sail's hands)
//   V.frame(dt, simDt, { look, zoom, aspect, sunDir }) → the camera pose (pos, target, up, fov, near): the boat steps simDt
//                                   (the navigator and the skipper each tick), then the director and the rig frame it
//   V.nav, V.pilot, V.director, V.rig, V.chart, V.stats(), V.safety()
// What v1's voyage also carries and v2 does not yet: the fireworks trip (its crew, tackle and the show's shots), the paddlewheeler
// (v1's traffic is empty too), the show's barges on the chart (?fireworks=0 charts the same as v1).
import { buildChart, scenicRoute, Navigator, chooseStart } from '../../src/sim/modes/chill/navigator.js';
import { CruisePilot } from '../../src/sim/modes/chill/pilot.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { Director, SHOTS } from '../../src/modes/chill/director.js';
import { createCameraRig } from '../../src/modes/chill/rig.js';
import { NIGHT_CAMERAS, START_CAMERA } from './cameras.js';
import { sightClear } from '../../src/forest/crowns.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { createChannelHelm } from '../sim/channelHelm.js';
import { Helm } from '../../src/sim/boat.js';

const DEG = Math.PI / 180;
export const NO_TRAFFIC = Object.freeze({ agents: () => [] });   // v1's createTraffic(): none, as the game's (src/traffic.js)

// v1's start camera row (?cruisecam=, the old Deck camera's links land on Above); no row or an unknown one: the Boat view
// (owner, 2026-11-15: Cinematic last; ?cruisecam=cinematic still opens on it for captures)
export const startCamera = (flags = {}) => { const c = flags.cruisecam === 'deck' ? 'above' : flags.cruisecam; return NIGHT_CAMERAS.includes(c) ? c : START_CAMERA; };

// lake: v1's terrain object (heightAt, shoreDistance, islandR, lake …); wind: the WindField the boat feels (B's); chartIn: the
// shoreline and harbour buildChart reads ({ shoreline, harbour }: v2/cruise/chartWorld.json on a page, a node world's in tests);
// traffic: { agents(t) } (the kayaks, when the page has them); sun: () → the sun's elevation, degrees; chart: a prebuilt chart (a page:
// the whole-lake chart, v2/ui/planChart.js loadPlanChart, so Cruise's chart targets reach the open lake) in place of buildChart's
export function createCruiseVoyage({ B, lake, wind, seed = 1, flags = {}, chartIn = {}, chart: chartOpt = null, traffic = NO_TRAFFIC, sun = () => 20, solid = null, extra = [], birth = () => null }) {
  const chart = chartOpt ?? buildChart(lake, { shoreline: chartIn.shoreline ?? null, harbour: chartIn.harbour ?? null, lanes: [], extra });
  B.setReef?.('A', { silent: true });   // Cruise's crew reefs (owner 2026-11-17); the page's mode sync then applies the passenger's own choice
  const nav = new Navigator({ chart, route: scenicRoute(chart, { seed }), seed });
  // the AI skipper (src/ai/skipper.js) at skill 1 with the pro controls; the navigator plans and keeps it safe (v1's voyage.js)
  const pilot = new CruisePilot({ nav, skill: 1, seed, windAt: (x, z, t) => B.env(t).windAt(x, z, t), vessel: B.phys.vessel });
  const only = flags.shot && SHOTS[flags.shot] ? flags.shot : null;   // ?shot=wide|follow|low|orbit|drone (v2's close-shot names are not the director's)
  const director = new Director({ heightAt: lake.heightAt, seed, only });
  const rig = createCameraRig({ terrain: lake, follow: B.follow, view: startCamera(flags), solid, sky: () => null, helm: sloopCameras(B.phys.vessel).helm });
  if (flags.coursecam) rig.above.toggle();
  if (solid) director.solid = solid.at;
  let attached = false, ticks = 0;
  // one tick of v1's helm.js: the navigator plans, the skipper sails (the controls B's physics reads this tick)
  // the bay's entrance channel (a chart with one: the whole-lake chart): down its line on the way to a mark past it (sim/channelHelm.js)
  const lane = chart.channel ? createChannelHelm({ chart }) : null, laneHelm = new Helm({ rudderMaxDeg: B?.phys?.P?.rudder?.maxDeg });
  const tick = (t, dt) => {
    ticks++; pilot.update(dt, B.phys.state, B.ctl, { t, sunElevDeg: sun(), traffic });
    const was = !!lane?.active, h = lane?.heading(B.phys.state, nav.target?.at ?? null);
    if (h != null) { B.ctl.rudder = laneHelm.toHeading(B.phys.state, h, Math.max(dt, 1e-3)); B.ctl.jibSide = 0; }
    else if (was) nav.path = null;   // through: the navigator re-plans from here
  };

  const V = {
    chart, nav, pilot, director, rig, traffic,
    get attached() { return attached; }, get ticks() { return ticks; },
    // the forest arrives later on a page (v2/cruise/index.js crownsFrom): the director's and the shore cameras' sight lines
    setSolid(s) { if (!s) return; rig.setSolid(s); director.solid = s.at; V.solid = s; },
    solid,
    // v1's start: ?start=x,z (and ?heading=), else the player's birthplace pick (birth(): a pose, or null on a first visit with no
    // pick), else the chart's own pick upwind of the reference start in the wind at t0
    startPose(t0 = B.t) {
      const at = typeof flags.start === 'string' ? flags.start.split(',').map(parseFloat) : null;
      if (at?.length === 2 && at.every(Number.isFinite)) return { x: at[0], z: at[1], headingDeg: parseFloat(flags.heading ?? '0') || 0, speed: 2.5 };
      const b = birth?.();   // the player's own birthplace pick (Cruise takes it as the voyage's first pose; v2/sim/birthplace.js)
      if (b) return { x: b.x, z: b.z, headingDeg: b.headingDeg, speed: 2.5 };
      const w0 = wind.sample(CHILL.start.x, CHILL.start.z, t0);
      return chooseStart(chart, { seed, traffic, t0, windFrom: Math.atan2(-w0.vx, w0.vz) });
    },
    place(pose = V.startPose()) { B.place(pose); nav.pickNearest(B.phys.state.x, B.phys.state.z); return pose; },
    // Cruise takes the boat (the fresh start, and the hand-back: v1 disposes Sail's tackle with Sail's controls): the anchor and
    // the lines aboard, the sails up, the lever in neutral and the engine off. The seamanship's pre() does not run while the
    // autopilot drives, so whatever the player left (Y's furl, J's anchor, the lever) froze and she drifted with the sails down
    attach() {
      B.sea?.reset();
      B.ctl.furl = 0; B.ctl.throttle = null;
      const eng = B.phys.engine; eng.stop(); eng.setLever(0);
      B.drive(tick); attached = true; return V;
    },
    detach() { B.drive(null); attached = false; return V; },
    // one frame of Cruise (v1's sailFor): the boat sails simDt (the autopilot each tick), then the director and the rig
    frame(dt, simDt, { look = null, zoom = 1, aspect = 16 / 9, sunDir = null, hands = null } = {}) {
      if (simDt > 0) B.step(simDt, hands, dt);
      return V.camera(dt, { look, zoom, aspect, sunDir });
    },
    camera(dt, { look = null, zoom = 1, aspect = 16 / 9, sunDir = null } = {}) {
      const s = B.state, rp = B.pose;
      const fp = rig.followStep(dt, s, { look, zoom });
      const dp = director.update(dt, { t: B.t, boat: { x: s.x, z: s.z, heading: s.heading, sog: s.sog }, sun: sunDir ?? { x: 0, y: 1, z: 0 }, look: nav.target.look, follow: fp, windSpeed: s.trueWind.speed, aspect });
      return rig.pose(dt, { ride: rp, state: s, fp, dp, look, zoom });
    },
    // does the camera on screen see the hull? (v1's chillApi.sight: the probes)
    sight() { const p = rig.last, s = B.state; return p && V.solid ? sightClear(V.solid.at, p.pos, [s.x, 1.5, s.z]) : null; },
    stats: () => ({ view: rig.view, shot: director.shot?.kind ?? null, dest: nav.dest?.name ?? null, helm: attached ? 'cruise' : 'player', ticks, ...nav.stats() }),
    // the safety record at this instant (v1's chillApi.safety: tools/probe_chill.mjs)
    safety() {
      const s = B.state, out = { depth: Infinity, shore: Infinity };
      for (const f of [-4.5, 0, 4.5]) {
        const x = s.x + Math.sin(s.heading) * f, z = s.z - Math.cos(s.heading) * f;
        out.depth = Math.min(out.depth, -lake.heightAt(x, z)); out.shore = Math.min(out.shore, -lake.shoreDistance(x, z));
      }
      out.obj = chart.objects.length ? Math.min(...chart.objects.map(([ox, oz, r]) => Math.hypot(ox - s.x, oz - s.z) - r)) : Infinity;
      return Object.assign(out, { x: s.x, z: s.z, u: s.u, sog: s.sog, twaDeg: s.trueWind.angle / DEG, tws: s.trueWind.speed, heelDeg: s.heel / DEG, reef: s.reef });
    },
  };
  return V;
}
