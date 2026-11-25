// The boat on the shared sim (M3): v1's sloop physics (src/sim/boat.js BoatPhysics through its craft), the hull float
// (src/sim/boat/ride.js, float.js), the bottom (ground.js), the follow camera and Sail's hands (the helm and the sheet:
// src/controllers/sail.js's rules without the DOM), wired to v2's water (any { heightAt(x, z) }), terrain height and
// wind. Pure: node runs it on a flat sea (tests); the page gives it the readback surface and the WindField.
//   const B = createBoatSim({ water, heightAt, wind, start, hour, seed, vessel, flags });
//   B.step(simDt, { steer, pull })   // the fixed 1/60 s ticks owed (the remainder carries); then the float; → the pose
//   B.pose (the drawn state: heave/pitch from the float, the waves' roll on the heel), B.state (the physics'), B.follow
//   B.input({ steer, pull, orbit, zoom })   // the hands this frame (held until the next call)
// Inputs: steer −1 (port) … +1 (starboard), as v1's A/D; pull +1 pulls the sheets in, −1 eases (W/S). Let go of the helm
// and the pilot holds the course (v1: pilotHeading); the sheet stays where it is left (HandSheets), the winch slower
// under load (feel.js winchRate).
import { CONTROLS, Helm, DT, KN, PRO } from '../../src/sim/boat.js';
import { craftOf } from '../../src/sim/craft/index.js';
import { createGennaker } from '../../src/sim/sail/gennaker.js';   //: ?gennaker=1 starts it flying
import { createGennakerCrew } from './gennakerCrew.js';   // round 2: the crew flies it (Setup › Aids › Gennaker: Auto | Off)
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { vesselDims } from '../../src/sim/boat/dims.js';
import { BoatOnWater } from '../../src/sim/boat/ride.js';
import { calmPose, reducedNow } from './steadyCamera.js';   // Reduce Motion (the OS's setting; sim/steadyCamera.js)
import { createHeaveFilter, createLowPass } from './ease.js';   // step D3: the follow camera rides the slow heave, not each wave; the cameras' slow speed
import { wrap } from '../../src/sim/core/math.js';
import { FollowCamera, FOLLOW } from '../../src/sim/boat/followCamera.js';
import { createGround } from '../../src/sim/boat/ground.js';
import { groundTerrain } from '../../src/sim/boat/groundTerrain.js';
import { createStepper } from '../../src/sim/sail/stepper.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { HandSheets, HAND, trimBoost } from '../../src/sim/sail/sheets.js';
import { jibTrimRange, LetFly } from '../../src/sim/sail/letFly.js';
import { winchRate, sailForce, weatherHelm, helmTau, WINCH, HELM } from '../../src/sim/sail/feel.js';
import { pilotHeading, TackCarry } from '../../src/sim/sail/tackCarry.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { routeLook } from './controls.js';
import { createTrimNudge, nudgePose } from './trimNudge.js';
import { createSpeedCam, speedPose, speedK } from './speedFeel.js';
import { createKnockdown } from './knockdown.js';   // K1: the knockdown watch
import { createKnockdownFx, kdPose } from './knockdownFx.js';   // K2: the knockdown's look (the camera, the flog, the helm's cut)
import { tiltPose, BOAT_VIEW, BOAT_VIEW_FLAT } from './camTilt.js';   // the Boat view's pose and its tilt up (owner, 2026-11-17)

export { CONTROLS, DT, KN, FOLLOW };
// The desktop's sheet (owner, 2026-11-16: W/S trim looked too slow on a desk): the winch about twice v1's (feel.js WINCH:
// 12°/s light, ≈ 6°/s at 2 kN), still slower under load (25°/s light, ≈ 13.5°/s at 2 kN, never under 12°/s), and the
// ease 35°/s (v1 25°/s). The keys' and the cockpit's held trim only (the pull verb: W/S, the station's held winch, a let
// fly's grind back); a phone's rings nudge the sheet directly and never read it. main.js passes it on a desk page.
// The Pro trim keys (owner, 2026-11-16: their change was hard to see): the traveller, the twist (the vang), the backstay and
// the jib lead at twice v1's PRO.rate (1 unit/s: a full −1 … +1 sweep in 2 s, was 4 s). The ranges are v1's.
export const PRO_RATE = 2 * PRO.rate;
export const DESK_TRIM = Object.freeze({ winch: Object.freeze({ ...WINCH, fastDeg: 25, minDeg: 12 }), easeRate: 35 * Math.PI / 180 });
export const START = CURRENT_WATERS.start;
// held capsized (B.capsize): on her side at lieDeg (± bobDeg), eased there over easeS, her way gone over stopS, drifting at drift × the wind
export const CAPSIZE_HOLD = Object.freeze({ lieDeg: 86, bobDeg: 2.5, easeS: 0.8, stopS: 2.5, drift: 0.03 });
export const STEADY_RAMP_S = 1;
// the follow camera's slow inputs (fix 2026-11-25, the shaking sky; createBoatSim camPose): the low-passes' time constants (s,
// critically damped: sim/ease.js createLowPass). A sine of period P passes at 1 / (1 + (π · tau / P)²): with tau 3 s a 2.7 s
// wave's surge reaches the speed camera at under a tenth (under 1/40 with its own ease), a gust's run-up (5–10 s) still breathes
// heelTau: the heel the page's camera lean reads (v2/sim/gust.js lean, 16 % of it: B.camState); its wave-period part rocked the frame's edges
export const CAM_SLOW = Object.freeze({ sogTau: 3, surfTau: 3, headingTau: 2, heelTau: 2 });
const STEADY_LEAD_S = 0.5, STEADY_LEAD_MAX = 10 * Math.PI / 180;   // the let-go heading leads her swing by this (her yaw rate × s), at most 10°   // s: steady hands' grip easing in after a hand lets go (ui/steadyHands.js STEADY.rampS)
// the island in island radii (≈ 1 at its shore; v1's src/sim/lake.js islandR) from the lake's fitted ellipse { x, z, a, b, rotDeg }
// (v2/ui/logbookWorld.json terrain.lake.island): the bottom reads it for rock (src/sim/boat/groundTerrain.js)
export function islandRFor(I) {
  const c = Math.cos(I.rotDeg * Math.PI / 180), s = Math.sin(I.rotDeg * Math.PI / 180);
  return (x, z) => { const dx = x - I.x, dz = z - I.z; return Math.hypot((dx * c + dz * s) / I.a, (-dx * s + dz * c) / I.b); };
}   // v1's Sail start: (1200, −1050), 251°, 2.75 m/s (src/sail/options.js)
const DEG = Math.PI / 180;
// round 2: Pro's gennaker sheet (rad past its best: − over-trimmed, its stall full by −20°; + eased, the luff gone by 24°)
// and the hold at a sheet's end that hoists (F at the jib's full ease) or douses (R at the gennaker's full trim)
export const GK_TRIM = Object.freeze({ lower: -20 * DEG, upper: 30 * DEG });
export const GK_HAND_S = 1;
const TILT_RATE = 2;   // 1/s: the Boat view's tilt eased in or out when a drive is handed over (camera())
import { clampT as clamp } from '../../src/sim/core/math.js';

// a v1-shaped water for the ride from any heightAt(x, z, opts) (v2's readback surface): the surface the float reads
// (heightAt(x, z, t, opts): opts the float's Smith depth and the hull's filter, as v1's), waveAt(x, z, t, opts) → { y, nx, nz }
// (v1's: the unit normal by central differences, 0.5 m apart) and orbitAt(x, z, t, opts) → { vx, vz } (v1's water.js orbitAt:
// the waves' orbital velocity, the physics' current, through the ride's currentAt).
// #21 (2026-11-14), v1's recipe: now() is the wave clock's time (the page's scene clock, the one the readback's reads are
// stamped with; the boat's own sim clock runs a capture's settle ahead of it), so the surface carries its newest read forward
// to the moment the float reads it (v2/sim/surface.js heightAt's t); velocityAt is the surface's orbital velocity. Without them
// (the node tests' plain heightAt) the float reads the surface as it is and there is no orbital current, as before.
export function waterFor(heightAt, { velocityAt = null, now = null } = {}) {
  const opt = { depthM: 0, filterM: 0, t: null }, vel = [0, 0], orbit = { vx: 0, vz: 0 };
  const at = (o) => { opt.depthM = o?.depthM ?? 0; opt.filterM = o?.filterM ?? 0; opt.t = now ? now() : null; return opt; };
  const surface = { heightAt: (x, z, t, o) => heightAt(x, z, at(o)) };   // o: the hull's filters (depthM, filterM: v2/sim/surface.js)
  return {
    surface,
    // v1's waveAt (water.js): the height and the unit normal's horizontal parts, central differences over 0.5 m, the hull's filter
    waveAt(x, z, t, o) {
      const q = at(o), e = 0.5, y = heightAt(x, z, q), gx = (heightAt(x + e, z, q) - heightAt(x - e, z, q)) / (2 * e), gz = (heightAt(x, z + e, q) - heightAt(x, z - e, q)) / (2 * e);
      const inv = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      return { y, nx: -gx * inv, nz: -gz * inv };
    },
    orbitAt: velocityAt ? (x, z, t, o) => { velocityAt(x, z, at(o), vel); orbit.vx = vel[0]; orbit.vz = vel[1]; return orbit; } : null,
  };
}

// wind: { sample(x, z, t) → { vx, vz } | { speed, dirDeg } } (src/sim/wind.js WindField, or any)
// wake, makeSpray: the wake's track and the spray's flight (v2/render/wake.js), stepped by the shared ride as v1's are
// trim: the held sheet's rates ({ winch, easeRate }: DESK_TRIM on a desk page); null keeps v1's (feel.js WINCH, HAND.easeRate)
export function createBoatSim({ water, heightAt = null, wind, start = START, vessel = CURRENT_VESSEL, flags = {}, t0 = 0, headless = false, wake = null, makeSpray = null, trim = null } = {}) {
  const dims = vesselDims(vessel);
  let heading0 = (start.headingDeg ?? 0) * DEG;   // the start heading (Cruise's place() moves it: the settle and the film helm hold it)
  // the physics as the vessel's craft builds it (src/sim/craft/: craftOf(vessel).createPhysics; a sloop's is v1's BoatPhysics)
  const knockdownOn = flags.knockdown === true || flags.knockdown === '1';   // the page's flag (on by default, ?knockdown=0 off: v2/engine/flags.js); a test's own flags pass it explicitly
  const phys = craftOf(vessel).createPhysics({ x: start.x, z: start.z, heading: heading0, speed: start.speed ?? 0, vessel, ...(knockdownOn ? { params: { knockdown: true } } : {}) });
  // K1: the knockdown watch (sim/knockdown.js), ticked after each physics tick; B.onKnockdown / B.onKnockdownWarn hear it
  const kd = createKnockdown({ on: knockdownOn, onWarn: (e) => B.onKnockdownWarn?.(e), onKnockdown: (e) => B.onKnockdown?.(e) });
  const ride = new BoatOnWater({ water, wake, dims, makeSpray });
  // the bottom: the keel, the rudder and the hull meet the bed (the same height the terrain draws); none without a terrain
  // ENG-2: the bed's rock (v1 hands the whole terrain): the island's ellipse once it is known (B.setIsland), read at each call
  const terrainIn = { heightAt, islandR: null };
  const GT = heightAt ? groundTerrain(terrainIn) : null, ground = GT ? createGround({ ...GT, dims }) : null;
  // a scripted gust on the boat's own wind (B.setGust: the knockdown's page test and its evidence clip; null: the wind as it is):
  // from t0 (sim s) the speed rises to peakMs over riseS, holds holdS, falls over fallS (never under the wind's own)
  let gustS = null;
  const gustK = (tt) => { const g = gustS; if (!g) return 0; const u = tt - g.t0; return u <= 0 || u >= g.riseS + g.holdS + g.fallS ? 0 : u < g.riseS ? u / g.riseS : u < g.riseS + g.holdS ? 1 : 1 - (u - g.riseS - g.holdS) / g.fallS; };
  const windAt = (x, z, tt) => {
    const w = wind.sample(x, z, tt); const to = Math.atan2(w.vx ?? 0, -(w.vz ?? 0)); let vx = w.vx ?? Math.sin(to) * w.speed, vz = w.vz ?? -Math.cos(to) * w.speed;
    const k = gustS ? gustK(tt) : 0;
    if (k > 0) { const sp = Math.hypot(vx, vz) || 1e-6, want = Math.max(sp, sp + (gustS.peakMs - sp) * k); vx *= want / sp; vz *= want / sp; }
    return { vx, vz };
  };
  const envObj = { t: 0, ext: ground?.ext ?? null, post: ground?.post ?? null, waveAt: ride.waveAt, currentAt: water?.orbitAt ? ride.currentAt : null, sea: () => ride.wave, windAt };   // #21: the waves' orbital current (v1's ride.currentAt), when the water has one
  const env = (t) => { envObj.t = t; return envObj; };
  // the Simulation's single-boat 'start' clock (src/sim/sail/simulation.js): a tick runs at the time it starts, then t += DT;
  // the fixed-step accumulator is v1's stepper (the remainder carries)
  const stepper = createStepper({ dt: DT });
  let simT = t0;
  // Cruise (v2/cruise/voyage.js): drive(fn) hands each tick to an autopilot, fn(t, DT) before the physics steps (v1's
  // src/modes/chill/helm.js before-hook on the same 'start' clock); null gives the boat back to the hands
  let driver = null, driverSea = false;   // driverSea: Sail's AUTO drives, the seamanship still runs (B.drive(fn, { sea: true }))
  // an outside roll moment (B.shove: Tessie's tail sweep under the lee side): from t0 (sim s) K N·m rises over
  // riseS, holds holdS, falls over fallS, added to the roll rate each tick (the physics still decides whether she goes over)
  let shoveS = null;
  // capsized and held (B.capsize: Tessie's strike, owner 2026-11-20: "the end card appears and the boat stays capsized"): after each tick she is
  // eased onto her side (CAPSIZE_HOLD.lieDeg, a slow bob), her way and her swing die, and she drifts slowly with the wind; never righting
  // until a fresh start (B.place) or B.capsize(false)
  let capS = null;
  const holdCapsize = (dt) => { const s = phys.state, H = CAPSIZE_HOLD, want = capS.side * (H.lieDeg + H.bobDeg * Math.sin(simT * 0.7)) * DEG;
    s.heel += (want - s.heel) * Math.min(1, dt / H.easeS); phys.p = 0;
    const k = Math.max(0, 1 - dt / H.stopS); s.u *= k; s.v *= k; s.yawRate = (s.yawRate ?? 0) * k; if (phys.r != null) phys.r *= k;
    const w = windAt(s.x, s.z, simT); s.x += w.vx * H.drift * dt; s.z += w.vz * H.drift * dt; };
  const shoveK = (tt) => { const g = shoveS; if (!g) return 0; const u = tt - g.t0; if (u <= 0) return 0; if (u >= g.riseS + g.holdS + g.fallS) { shoveS = null; return 0; } return g.K * (u < g.riseS ? u / g.riseS : u < g.riseS + g.holdS ? 1 : 1 - (u - g.riseS - g.holdS) / g.fallS); };
  const sim = { get t() { return simT; }, get acc() { return stepper.acc; }, get alpha() { return stepper.alpha; },
    step(simDt, inputs) { stepper.advance(simDt, () => { driver?.(simT, DT); if (shoveS) phys.p += shoveK(simT) / phys.P.ixx * DT; phys.step(DT, inputs, env(simT)); if (capS) holdCapsize(DT); simT += DT; if (kd.state.on && !(driver && !driverSea)) kd.tick(simT, phys.state); }); return phys.state; } };   // Cruise never (owner 2026-11-17): its autopilot's boat is not watched
  // the camera: v1's follow camera, its length unit the craft's; ?campitch, ?camdist and ?camyaw as v1's hull frame reads them
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const tiltFlag = Number.isFinite(parseFloat(flags.camtilt)) ? parseFloat(flags.camtilt) : null;   // ?camtilt= deg (0 none) over the pose's own tilt
  let sailPose = BOAT_VIEW;   // the Boat view's pose: the desk's, or the flat controls' (B.setFlat: a phone's bigger top bar)
  const follow = new FollowCamera({ hull: sloopCameras(vessel).follow.hull, x: start.x, z: start.z, heading: heading0, pitchDeg: num(flags.campitch), dist: num(flags.camdist), pose: BOAT_VIEW });
  if (flags.camyaw != null && num(flags.camyaw) != null) { follow.yaw = heading0 + num(flags.camyaw) * DEG; follow.chase = false; }
  // step D3: the follow (and chase) camera reads the heave high-passed out: its slow part only, solved
  // per step (sim/ease.js), so the eye does not bob with every wave and 30 fps and 120 Hz follow the same curve
  // fix 2026-11-25 (the sky shook by day and by night): the camera also reads the boat's speed, her surf cue and her heading slow
  // (CAM_SLOW). Each moves with every wave (the speed ±0.7 m/s at 16 kn on the bigger sea, the surf cue on each face, the heading
  // ±0.05°), and the follow camera's breath and the speed camera (sim/speedFeel.js) turned them into a lens pumping 0.5° and an aim
  // swinging 0.1° at the waves' period: the sky far from the frame's centre shook while the horizon held. The boat rides on screen
  const heaveF = createHeaveFilter(), camP = {};
  const sogF = createLowPass({ tau: CAM_SLOW.sogTau }), surfF = createLowPass({ tau: CAM_SLOW.surfTau }), headF = createLowPass({ tau: CAM_SLOW.headingTau }), heelF = createLowPass({ tau: CAM_SLOW.heelTau });
  const camState = { heel: 0, heading: 0 };   // B.camState: the physics' heel and heading, slow, for the page's camera lean (main.js gust.lean)
  let headU = null;   // the heading unwrapped (rad): the low-pass never sees the ±π seam
  const slowHeading = (h, dt) => { if (!Number.isFinite(h)) return h; headU = headU == null ? h : headU + wrap(h - headU); return wrap(headF.step(headU, dt)); };
  const camPose = (p, dt) => {
    if (!p) return p;
    Object.assign(camP, p);
    camP.heave = heaveF.step(p.heave ?? 0, dt); camP.sog = sogF.step(p.sog ?? 0, dt); camP.surf = surfF.step(p.surf ?? 0, dt); camP.heading = slowHeading(p.heading, dt);
    return camP;
  };
  const camSlowReset = (p = null) => { heaveF.reset(p ? p.heave ?? 0 : null); sogF.reset(p?.sog ?? null); surfF.reset(p ? p.surf ?? 0 : null); headF.reset(p?.heading ?? null); headU = p?.heading ?? null; heelF.reset(p ? phys.state.heel ?? 0 : null); };

  // the hands (src/controllers/sail.js): the helm and the pilot, the sheet and the winch
  const ctl = { ...CONTROLS, autoReef: false, reef: 0 };   // the reef selector A · 0 · 1 · 2 (ui/autoReef.js): a fresh boat is on 0 (Sail); the page sets each mode's own
  let reefSel = 0;
  const setReef = (v, { silent = false } = {}) => { if (!['A', 0, 1, 2].includes(v)) return reefSel; reefSel = v; ctl.autoReef = v === 'A'; ctl.reef = v === 'A' ? 0 : v; if (!silent) B.onReef?.(v); return reefSel; };
  const hand = new HandSheets(), pilot = new Helm();
  let trimRates = trim;   // B.trimRates (null: v1's)
  let holdHeading = heading0, sinceHand = Infinity, loadN = 0, pullRate = winchRate(0, trimRates?.winch ?? WINCH);
  const input = { steer: 0, pull: 0, orbit: null, zoom: 0, trim: null };
  // Pro (DRV-3): the boat knows it (the let-fly hand-off, the pilot's course); the page's Pro switch sets it (ui/sail.js setPro)
  let pro = false;
  // round 2 (owner, 2026-11-21): the crew flies the gennaker (gennakerCrew.js); Pro's hands too. gkCtx: the page's
  // Setup row and race (B.gennakerCrew); gkHold: R or F held at the sheet's end (s); a hand's call goes to the crew this frame
  const sloop = (vessel.craft ?? 'sloop') === 'sloop';
  let gkCrew = createGennakerCrew(), gkHoldF = 0, gkHoldR = 0;
  // The take-over (owner, 2026-11-21: "if assist on, and user do nothing we do auto crew; however if user start using WS RF it should
  // always take over, let user see the feedback"): with crew trim on, the crew trims until the player's first W/S (the main, and the
  // gennaker while it flies) or R/F in Pro (the flying headsail). From that press the sheet is the player's: no hand-back on any idle
  // time (the crew's net is off for it). Handed back only by Setup's crew trim switch (B.handBack) or a fresh start (B.place).
  // onTakeOver(which) hears the first press ('main' | 'head') for the skipper's one line.
  const owned = { main: false, head: false };
  const handMain = () => !assists.crewTrim || owned.main;
  const gkCtx = { mode: 'auto', race: false, card: false };   // card: the home card is up (the first sail has not begun: the crew's clocks wait)
  // the beginner's tack carry (DRV-5, v1's controllers/sail.js TackCarry): a tack let go mid-turn is kept through, the crew
  // backs the jib when it slows; keep: the way to keep turning (the hint's line); off in Pro, at anchor and without autoTrim
  let carry = new TackCarry(), carryJib = false, carryKeep = 0, freeHeld = false;
  // M4: the helm station's hands (v2/ui/station.js), as src/controllers/sail.js reads them: the wheel in the hand (a rudder
  // command, null when not held), the Tack button's assist (ext), each winch's change since the last frame (rad, + = in) and
  // its held step (+1 in, −1 ease). Absent: M3's two verbs exactly.
  // free: the FREE manoeuvre's hands (v2/ui/assist.js FreeAssist.step's out: { helm, jibSide, jibBack, mainBack, sheet, pivot }) or null
  const station = { helm: null, ext: null, free: null, main: 0, mainHold: 0, jib: 0, jibHold: 0, fly: { main: false, jib: false } };
  // let fly (src/sim/sail/letFly.js, as controllers/sail.js plumbs it): a click on a winch throws its sheet off or grinds it back
  let fly = new LetFly({ storage: null, once: false });
  let jibHeldS = 0, jibHeldDir = 0;
  // the trim camera nudge (sim/trimNudge.js): the player's hand on a sheet this frame, and the Pro controls last seen
  const nudge = createTrimNudge();
  // the speed camera (sim/speedFeel.js, owner 2026-11-17): the Boat view a touch lower and wider as she reaches hull speed
  const speedCam = createSpeedCam();
  // K2: the knockdown's look from the drawn heel (all 0 upright): the Boat view eased out and up, the Helm view's
  // cut at 45°, the sails' flog and the vane's wildness (read by the page: B.kdFx.state)
  const kdFx = createKnockdownFx();
  let trimHand = false, proSeen = '';
  // Setup's assists (v1's controllers/sail.js setPilot, setCrewTrim; v2/ui/setup.js): the pilot holds the course when the helm is
  // let go (off: the helm eases amidships); crew trim takes the main's sheet off your hands (ctl.sheet null: the crew's trim).
  // shoal: v1's shallow-water assist (src/sail/grounding.js, mounted by the live UI) as fn(dt, { steering, windFrom }) → its state
  // DRV-6: the URL's ?pilot=0 starts the pilot off and ?hand=0 gives the main to the crew (v1's controllers/sail.js; Setup skips its
  // stored rows when the URL says, ui/setup.js)
  const flagOn = (v) => v !== '0' && v !== false && v !== 0;
  //: ?gennaker=1 starts with the gennaker flying full (no bang: a capture's settled frame), ?gennaker=hoist asks for it at
  // the first tick (the sock goes up, then the bang); unset: down, the default page untouched
  const gkStart = (vessel.craft ?? 'sloop') === 'sloop' ? flags.gennaker : null;
  if (gkStart === '1' || gkStart === 'hoist') { ctl.gennaker = true; gkCrew.hold('up'); }   // a capture's sail stays up until she bears away past the crew's line
  if (gkStart === '1') Object.assign(phys.gk = createGennaker(), { deploy: 1, sock: 1, roll: 1, lift: 1, phase: 'flying', fill: 1, minFill: 1, target: 1 });
  const assists = { pilot: flags.pilot != null ? flagOn(flags.pilot) : true, crewTrim: flags.hand != null ? !flagOn(flags.hand) : false, shoal: null };
  function hands(dt) {
    const s = phys.state, steer = clamp(input.steer + (station.ext ?? 0), -1, 1), pull = clamp(input.pull + station.mainHold, -1, 1);
    const need = weatherHelm(s).need;
    const onHelm = station.helm != null;
    const shoal = assists.shoal ? assists.shoal(dt, { steering: !!(steer || onHelm), windFrom: s.heading + (s.trueWind?.angle ?? 0) }) : null;
    if (shoal?.release && assists.pilot) holdHeading = s.heading;
    const fr = station.free;
    const co = carry.update(dt, { steer: steer || (onHelm ? station.helm : 0), twa: s.trueWind?.angle ?? 0, sog: s.sog ?? 0, yawRate: s.yawRate ?? 0, enabled: !pro && !B.sea?.held && ctl.autoTrim !== false && !fr });
    if (co.jibSide) { ctl.jibSide = co.jibSide; carryJib = true; } else if (carryJib) { ctl.jibSide = 0; carryJib = false; }   // the crew backs the jib, then lets it draw
    // FREE (v2/ui/assist.js): the crew backs the jib and the main by hand and the helm is the manoeuvre's; let go, they draw again
    if (fr) { ctl.jibSide = fr.jibSide ?? 0; ctl.jibBack = fr.jibBack ?? 0; ctl.mainBack = fr.mainBack ?? 0; ctl.pivot = fr.pivot ?? 0; freeHeld = true; }
    else if (freeHeld) { ctl.jibSide = 0; ctl.jibBack = 0; ctl.mainBack = 0; ctl.pivot = 0; freeHeld = false; }
    carryKeep = co.keep;
    if (onHelm) { ctl.rudder += (station.helm - ctl.rudder) * Math.min(1, dt / helmTau(station.helm, s.apparentWind?.angle ?? 0, need)); holdHeading = null; }
    else if (fr) { const hm = clamp((fr.helm ?? 0) + input.steer, -1, 1); ctl.rudder += (hm - ctl.rudder) * Math.min(1, dt / HELM.tau); holdHeading = null; }   // FREE: its helm, amidships included (the pilot waits)
    else if (steer) { ctl.rudder += (steer - ctl.rudder) * Math.min(1, dt / helmTau(steer, s.apparentWind?.angle ?? 0, need)); holdHeading = null; }
    else if (B.sea?.rounding != null) { holdHeading = null; ctl.rudder = pilot.toHeading(s, B.sea.rounding, dt); }   // the anchor called while she moves: the crew rounds her up head to wind to stop her (v2/sim/seamanship.js)
    else if (B.sea?.held) { ctl.rudder += (0 - ctl.rudder) * Math.min(1, dt / 0.6); holdHeading = null; }   // #8: on the anchor or the lines the helm goes amidships and she swings (controllers/sail.js)
    else if (shoal?.engaged) { holdHeading = shoal.heading; ctl.rudder = pilot.toHeading(s, shoal.heading, dt); }   // v1: the assist bears away from the shoal
    else if (co.helm != null) { ctl.rudder += (co.helm - ctl.rudder) * Math.min(1, dt / HELM.tau); holdHeading = null; }   // the tack let go mid-turn: kept through
    else if (fly.any) { ctl.rudder += (0 - ctl.rudder) * Math.min(1, dt / 0.4); holdHeading = null; }   // a sheet let fly: the helm let go, she rounds up and stops
    else if (assists.pilot) {   // steady hands (ui/steadyHands.js; AUTO's hold too): the heading she had when the hand let go
      if (holdHeading == null) { const h = pro ? s.heading : s.heading + clamp((s.yawRate ?? 0) * STEADY_LEAD_S, -STEADY_LEAD_MAX, STEADY_LEAD_MAX); holdHeading = pro ? h : pilotHeading(h, (s.trueWind?.angle ?? 0) - (h - s.heading), s.trueWind?.speed ?? 0); pilot.i = 0; }   // where her swing would settle: the heading she had, not an overshoot back to it
      const want = pilot.toHeading(s, holdHeading, dt), w = Math.min(1, sinceHand / STEADY_RAMP_S);   // its grip eases in over STEADY_RAMP_S after a hand let go
      ctl.rudder = w >= 1 ? want : ctl.rudder + (want - ctl.rudder) * Math.min(1, w + dt / STEADY_RAMP_S);
    }
    else ctl.rudder += (0 - ctl.rudder) * Math.min(1, dt / 0.4);   // v1: no pilot, the helm eases amidships
    sinceHand = holdHeading == null || onHelm || fr || steer || co.helm != null ? 0 : sinceHand + dt;   // a hand (or the tack carry) on the helm this frame
    // DRV-1, DRV-2: the keys' trim (v2/sim/controls.js keysToTrim): R/F the jib's own sheet in basic (+ = in), the four Pro
    // controls at PRO.rate per second, held where left (v1's controllers/sail.js)
    const tr = input.trim, rf = tr ? tr.jib ?? 0 : 0;   // R/F (Pro only: v2/sim/controls.js): + = R (in), − = F (out)
    // round 2: R/F trim whichever headsail flies: the gennaker's own sheet once the jib is mostly rolled away
    const G0 = phys.gk, gkHead = !!G0 && (G0.roll ?? 0) >= 0.5;
    const jibKeys = gkHead ? 0 : rf;
    const jibDir0 = clamp(station.jibHold + jibKeys, -1, 1), jr0 = jibTrimRange(s);
    gennakerHands(dt, s, rf, gkHead, jr0);
    const io = (toggles = {}) => ({ ctl, hand, handOn: handMain(), pro, state: s, pullRate, jr: jr0, toggles });   // v1's flyIO: handOn
    const inp = { pull, mainNow: station.main, mainHold: station.mainHold, jibDir: jibDir0, jibNow: station.jib, jibHold: station.jibHold };
    fly.before(dt, io(station.fly), inp); station.fly = { main: false, jib: false };
    if (assists.crewTrim && !owned.main && (pull || station.main)) takeOver('main', s);
    if (station.main && handMain()) hand.nudge(station.main);
    // the jib's own sheet (sail.js: its winch; the crew still matches it to the main): + = out on ctl.jibTrim, inside its range
    const jibDir = jibDir0;
    if (station.jib || jibDir) {
      jibHeldS = jibDir && Math.sign(jibDir) === jibHeldDir ? jibHeldS + dt : 0; jibHeldDir = Math.sign(jibDir);
      // the held jib winch at the desk's rates when the page gives them (DESK_TRIM: its light-air pull, the jib's sheet has no load
      // model; the ease), v1's otherwise
      const jibIn = trimRates ? winchRate(0, trimRates.winch) : HAND.rate, jibOut = trimRates?.easeRate ?? HAND.easeRate;
      const jr = jibTrimRange(s), dj = -station.jib - jibDir * (jibDir > 0 ? jibIn : jibOut) * trimBoost(jibHeldS, Math.sign(jibDir)) * dt;
      ctl.jibTrim = Math.max(jr.lower, Math.min(jr.upper, (ctl.jibTrim ?? 0) + dj));
    } else { jibHeldS = 0; jibHeldDir = 0; }
    loadN += (sailForce(s) - loadN) * (1 - Math.exp(-dt / WINCH.tau)); pullRate = winchRate(loadN, trimRates?.winch ?? WINCH);
    if (owned.main && assists.crewTrim) { hand.netAfter = Infinity; hand.crew = false; }   // taken over: the crew's net never takes it back
    if (handMain()) { ctl.sheet = hand.update(dt, pull, s, { pullRate, easeRate: trimRates?.easeRate ?? HAND.easeRate }); ctl.sheetBias = 0; } else { ctl.sheet = null; ctl.sheetBias = 0; }   // v1: the crew trims
    if (fr?.sheet != null) ctl.sheet = fr.sheet;   // FREE: the main eased right out (the player's or the crew's sheet back after it)
    fly.after(dt, io(), inp);
    if (pro && tr) {
      const r = PRO_RATE * dt, add = (v, d, lo = -1) => Math.max(lo, Math.min(1, (v ?? 0) + d * r));
      if (tr.trav) ctl.traveller = add(ctl.traveller, tr.trav);
      if (tr.twist) ctl.twist = add(ctl.twist, tr.twist);
      if (tr.backstay) ctl.backstay = add(ctl.backstay ?? s.backstay, tr.backstay, 0);
      if (tr.lead) ctl.jibLead = add(ctl.jibLead, tr.lead);
    }
    trimHand = !!pull || !!station.main || !!station.jib || !!jibDir;   // the nudge: the sheet in the player's hand
    station.main = 0; station.jib = 0;
  }
  // the player's first W/S or R/F with crew trim on: that sheet is theirs from here (the main starts where the crew had it: no jump)
  function takeOver(which, s) {
    if (owned[which]) return;
    owned[which] = true;
    if (which === 'main') { hand.sheet = phys.auto?.main ?? s.crewSheet ?? hand.sheet; hand.crew = false; hand.start = false; }
    B.onTakeOver?.(which);
  }
  // round 2: Pro's R/F on the gennaker's sheet and the hold-to-hoist/douse, then the crew's call (gennakerCrew.js)
  function gennakerHands(dt, s, rf, gkHead, jr) {
    if (!sloop) return;
    let manual = null;
    if (pro && rf && assists.crewTrim && !owned.head) takeOver('head', s);
    if (pro && gkHead && rf) ctl.gkTrim = clamp((ctl.gkTrim ?? 0) - rf * (rf > 0 ? HAND.rate : HAND.easeRate) * dt, GK_TRIM.lower, GK_TRIM.upper);
    if (!pro || !phys.gk || phys.gk.sock <= 0) ctl.gkTrim = null;   // the crew's (the jib's winch) again; a fresh sail starts at its best
    // W/S trim both flying sails (owner, 2026-11-21): with a hand on the sheets the gennaker's sheet moves by the same in/out as the
    // main (+ pull = in: over-trimmed toward the stall; − = eased toward the curl), off the crew's best; the crew's own trim rides on
    // sheetBias in the physics. Gone with the sail: a fresh hoist starts at its best
    if (phys.gk && phys.gk.sock > 0 && handMain()) { const p = input.pull + station.mainHold; if (p) ctl.gkHand = clamp((ctl.gkHand ?? 0) - p * (p > 0 ? pullRate : HAND.easeRate) * dt, GK_TRIM.lower, GK_TRIM.upper); else ctl.gkHand ??= 0; }
    else ctl.gkHand = null;
    const ends = 0.5 * DEG;
    gkHoldF = pro && rf < 0 && !ctl.gennaker && (ctl.jibTrim ?? 0) >= jr.upper - ends ? gkHoldF + dt : 0;
    gkHoldR = pro && rf > 0 && ctl.gennaker && gkHead && (ctl.gkTrim ?? 0) <= GK_TRIM.lower + ends ? gkHoldR + dt : 0;
    if (gkHoldF >= GK_HAND_S) { manual = 'up'; gkHoldF = 0; }
    if (gkHoldR >= GK_HAND_S) { manual = 'down'; gkHoldR = 0; }
    const sea = B.sea;
    const blocked = !!gkCtx.race || !!sea?.held || !!sea?.stopping || !!sea?.arrival || sea?.rounding != null;
    const r = gkCrew.update(dt, { mode: gkCtx.mode, twa: s.trueWind?.angle ?? 0, tws: s.trueWind?.speed ?? 0, sailsUp: (s.furl ?? 0) < 0.5, blocked, wait: gkCtx.card, up: !!ctl.gennaker, manual });
    if (r.want !== !!ctl.gennaker) B.gennaker(r.want, r.said ? { said: r.said, hand: !!manual } : null);
  }
  let pose = { ...phys.state }, filmHelm = null, tiltK = null;   // tiltK: the Boat view's tilt share (camera(): eased when a drive comes or goes)
  const helmLook = { look: null, zoom: 1 };   // this frame's look and zoom for the helm camera (camera() fills it)
  const filmInputs = { ...CONTROLS };
  const B = {
    phys, ride, follow, ground, sim, ctl, hand, dims, vessel, env, start, assists,
    get state() { return phys.state; },
    get pose() { return pose; },
    get t() { return simT; },
    get holdHeading() { return holdHeading; },
    get pullRate() { return pullRate; },
    // the held sheet's rates (DESK_TRIM on a desk page, null: v1's); read by the next frame's hands
    get trimRates() { return trimRates; }, set trimRates(r) { trimRates = r ?? null; },
    // M4: the station's hands for the next step (main and jib accumulate until a step reads them)
    get fly() { return fly; }, get free() { return { main: !!fly.free?.main, jib: !!fly.free?.jib }; },
    station(o) { if ('free' in o) station.free = o.free ?? null; if (o.fly) station.fly = { main: station.fly.main || !!o.fly.main, jib: station.fly.jib || !!o.fly.jib }; if ('helm' in o) station.helm = o.helm; if ('ext' in o) station.ext = o.ext; station.main += o.main ?? 0; station.jib += o.jib ?? 0; station.mainHold = o.mainHold ?? 0; station.jibHold = o.jibHold ?? 0; return station; },
    input(o) { if (o.steer != null) input.steer = o.steer; if (o.pull != null) input.pull = o.pull; input.orbit = o.orbit ?? null; input.zoom = o.zoom ?? 0; if ('trim' in o) input.trim = o.trim ?? null; return input; },
    // Pro on the boat (DRV-3): the let-fly hand-off and the pilot's course read it
    get pro() { return pro; }, set pro(on) { pro = !!on; },
    // K1 (?knockdown=1): the knockdown watch's state ({ on, active, count, warnT, t, leadS, events … }) and its two hooks
    get knockdown() { return kd.state; }, onKnockdown: null, onKnockdownWarn: null,
    // K2: the knockdown's look this frame ({ k, mix, flog, wild, cam, cut }: v2/sim/knockdownFx.js); onKdCut(): the Helm view passed 45°
    // (the views cut to the Boat view); onPlaced(): a fresh start (Start again, a race, Cruise's place)
    kdFx, onKdCut: null, onPlaced: null, knockdownOn,
    // a scripted gust (tests and the evidence clip): { peakKn, riseS = 3, holdS = 8, fallS = 2, inS = 0 } from now, or null
    // an outside roll moment (Tessie's tail sweep): { K (N·m, signed as the heel it adds), riseS = 0.4, holdS = 1.2, fallS = 0.8 } or null
    shove(o) { shoveS = o ? { t0: simT, K: o.K ?? 0, riseS: o.riseS ?? 0.4, holdS: o.holdS ?? 1.2, fallS: o.fallS ?? 0.8 } : null; return shoveS; },
    get shoving() { return !!shoveS; },
    // held capsized (Tessie's strike): capsize(true, side) lays her on that side (+1 starboard) and keeps her there; capsize(false) lets go
    capsize(on = true, side = Math.sign(phys.state.heel) || 1) { capS = on ? { side: side >= 0 ? 1 : -1 } : null; return !!capS; },
    get capsized() { return !!capS; },
    setGust(o) { gustS = o ? { t0: simT + (o.inS ?? 0), peakMs: (o.peakKn ?? 40) * KN, riseS: o.riseS ?? 3, holdS: o.holdS ?? 8, fallS: o.fallS ?? 2 } : null; return gustS; },
    get reefSel() { return reefSel; }, setReef, onReef: null,   // the reef selector's value; onReef(v): the page saves it for the mode
    // the tack carry's keep-turning side (0 or ±1: the hint line's keep), this frame
    get carryKeep() { return carryKeep; },
    // the trim camera nudge's amount now (−1 … +1, 0: none; sim/trimNudge.js)
    get nudge() { return nudge.amount; },
    // the speed camera's amount now (0 … 1; sim/speedFeel.js) and its switch (?speedfeel=0, the A/B: off)
    get speedCam() { return speedCam.amount; },
    get camState() { return camState; },   // the heel and heading the camera reads (slow: CAM_SLOW), for the page's lean
    speedFeel: flags.speedfeel !== false,
    // G and the trim panel's WING (DRV-2, v1's controllers/sail.js): the jib held out opposite the boom, and back
    wing() { ctl.jibSide = ctl.jibSide ? 0 : -Math.sign(phys.state.boomAngle || 1); carryJib = false; return ctl.jibSide; },
    // the gennaker (round 2: no key, the crew flies it: gennakerCrew.js): on true up, false down, absent the other way
    // (the sock up over 4 s with the jib drawing, the jib rolled away over 3 s, the sock lifted and the bang; the douse in reverse).
    // onGennaker(up, said) hears it: said { said: 'up' | 'down', hand } when the crew or a Pro hand called it
    gennaker(on = !ctl.gennaker, said = null) { if (on) ctl.gennaker = true; else if (ctl.gennaker) ctl.gennaker = false; B.onGennaker?.(!!ctl.gennaker, said); return !!ctl.gennaker; },
    get gennakerUp() { return !!ctl.gennaker; }, onGennaker: null,
    // the take-over (above): which sheets the player holds with crew trim on; handBack() gives them to the crew (Setup's crew trim switch)
    get owned() { return { ...owned }; }, onTakeOver: null,
    handBack() { owned.main = false; owned.head = false; ctl.sheet = null; ctl.gkHand = null; ctl.gkTrim = null; hand.netAfter = HAND.netAfter; return true; },
    // the page's context for the crew: Setup › Aids › Gennaker ('auto' | 'off') and a race running
    set gennakerCrew(o) { if (o?.mode) gkCtx.mode = o.mode === 'off' ? 'off' : 'auto'; if (o && 'race' in o) gkCtx.race = !!o.race; if (o && 'card' in o) gkCtx.card = !!o.card; },
    get gennakerCrew() { return { ...gkCtx, ...gkCrew.state, holdF: gkHoldF, holdR: gkHoldR }; },
    // the pilot switch (DRV-7, v1's setPilot): on or off, the course it holds read again when it next takes her
    setPilot(on) { assists.pilot = !!on; holdHeading = null; return assists.pilot; },
    // the phone's Auto (v2/ui/flat.js, owner 2026-11-16): the pilot on, holding the heading she has now (not pilotHeading's pick)
    holdCourse(heading = phys.state.heading) { assists.pilot = true; holdHeading = heading; return holdHeading; },
    get holding() { return assists.pilot ? holdHeading : null; },
    // the hands this frame (the pilot head reads a hand on the helm: AUTO lets go, the display shows the rudder): the keys' or
    // strip's steer and the wheel held (a rudder command, null when not held)
    get handInput() { return { steer: input.steer, helm: station.helm }; },
    // the island's ellipse for the bottom's rock (ENG-2): the same one v1's terrain fits ({ x, z, a, b, rotDeg })
    setIsland(I) { terrainIn.islandR = I ? islandRFor(I) : null; return B; },
    groundTerrain: GT,
    // simDt of sim time: the hands first (at the frame's real dt, handDt, as v1: its sim runs at the game speed, its hands at
    // dt), the whole ticks owed, then the float once (v1: per frame)
    step(simDt, inp = null, handDt = simDt) {
      if (inp) B.input(inp);
      if (!driver || driverSea) B.sea?.pre(handDt);   // #8, #14: the seamanship's rules are Sail's (AUTO's passage keeps them: the lever, the sails, the anchor)
      if (!driver) hands(handDt);   // an autopilot writes the helm and trim itself, each tick
      sim.step(simDt, ctl);
      pose = ride.step(null, phys.state, simT, simDt);
      pose.proBackstay = pro && ctl.backstay != null ? ctl.backstay : null;   // the drawing's Pro backstay (render/boat/drawnTrim.js); null: the crew's
      B.sea?.post(handDt);  // the exhaust, the anchor on the bow, the rode, the chain's speed
      return pose;
    },
    // the camera's pose for this frame: { pos, target, fov }; the hands' look [dx, dy] rad and zoom (factor) go to the follow
    // camera only in the follow view, to the helm camera only in the helm view (v1's deck.camera; controls.js routeLook):
    // B.viewOf() → 'follow' | 'helm' (the views, v2/ui/m4.js), and the helm's share waits in B.helmLook for the views' pose
    camera(dt) {
      const r = routeLook(B.viewOf?.() ?? 'follow', input.orbit, input.zoom);
      if (r.orbit || r.followZoom) B.sea?.looked?.();   // the player's own look on the Boat view (a drag past its slop, the wheel's zoom): the anchor's bow look hands the camera back (a click on a control, a tap or a key never does)
      const o = {};
      if (r.orbit) o.orbit = r.orbit;
      if (r.followZoom) o.zoom = r.followZoom;
      const c = follow.update(dt, camPose(calmPose(pose, reducedNow()), dt), o);   // Reduce Motion (sim/steadyCamera.js): less heave, no surf breath
      camState.heel = heelF.step(phys.state.heel ?? 0, dt); camState.heading = camP.heading ?? phys.state.heading;   // the lean's slow heel (CAM_SLOW)
      helmLook.look = r.helmLook; helmLook.zoom = r.helmZoom;
      // the trim nudge (sim/trimNudge.js): a hand on a sheet, or a Pro control moving (the keys, the PRO panel's drags)
      const proNow = pro ? `${ctl.traveller}|${ctl.twist}|${ctl.backstay}|${ctl.jibLead}` : '';
      const proMoved = pro && proNow !== proSeen; proSeen = proNow;
      const view = B.viewOf?.() ?? 'follow';
      const k = nudge.update(dt, { trimming: !driver && (trimHand || proMoved), dragging: !!input.orbit, view, cruise: !!driver, reduced: reducedNow(), boom: phys.state.boomAngle ?? 0 });
      trimHand = false;
      input.orbit = null; input.zoom = 0;
      // the speed camera first (the follow pose is this frame's own object: lowered and widened in place), then the nudge on it
      speedPose(c, speedCam.update(dt, { sog: sogF.value ?? phys.state.sog ?? 0, view, cruise: !!driver, reduced: reducedNow(), on: B.speedFeel }));
      let out = k ? nudgePose(c, follow.c, k) : c;
      // K2: the knockdown's camera (the Boat view eased out and up; 0 upright) and the Helm view's cut at 45°
      const kf = kdFx.update(dt, { heel: pose.heel ?? phys.state.heel, view, on: knockdownOn && !(driver && !driverSea) });
      if (kf.cam > 0) out = kdPose(out, kf.cam);
      if (kf.cut) B.onKdCut?.();
      const tiltDeg = tiltFlag ?? follow.F.tiltDeg ?? 0;   // the pose's tilt (Cruise's v1 pose: none)
      // the default tilt up, last (Cruise's autopilot: none), eased in and out at TILT_RATE: a drive handed over or back (Regatta's start
      // helper lets go after the gun) turned the view 5.5° in one frame (fix/v2-race-feedback); the first pose takes it at once
      const tiltWant = (driver && !driverSea) || !(tiltDeg !== 0) ? 0 : 1;
      tiltK = tiltK == null ? tiltWant : tiltK + (tiltWant - tiltK) * (1 - Math.exp(-TILT_RATE * Math.max(0, dt)));
      return tiltK < 1e-3 || !(tiltDeg !== 0) ? out : tiltPose(out, tiltDeg * (tiltK > 0.999 ? 1 : tiltK));
    },
    // the follow camera's pose for a mode: 'sail' (and Regatta) the Boat view's low, near pose (sim/camTilt.js BOAT_VIEW), 'cruise'
    // v1's (FOLLOW: Cruise's astern view and its director's shots as before). A pitch or distance still at the old pose's default
    // takes the new one's (a drag's is kept, inside the new range); the URL's ?campitch / ?camdist always win
    followPose(mode) {
      const F = mode === 'cruise' ? FOLLOW : { ...FOLLOW, ...sailPose }, was = follow.F;
      if (was === F || (was.pitch === F.pitch && was.dist === F.dist && was.tiltDeg === F.tiltDeg && was.pitchMin === F.pitchMin)) return follow.F;
      if (num(flags.campitch) == null) follow.pitch = follow.pitch === was.pitch ? F.pitch : Math.min(F.pitchMax, Math.max(F.pitchMin, follow.pitch));
      if (num(flags.camdist) == null && follow.dist === was.dist) follow.dist = F.dist;
      follow.F = F;
      return F;
    },
    // the flat controls (a phone: no cockpit, a taller top bar; src/core/features.js flatControls): the Boat view's flat pose
    setFlat(on) { sailPose = on ? BOAT_VIEW_FLAT : BOAT_VIEW; return follow.F === FOLLOW ? follow.F : B.followPose('sail'); },
    viewOf: null,
    sea: null,   // #8, #14: the engine and the ground tackle (v2/sim/seamanship.js), set by its creator
    helmLook,
    // Cruise (v2/cruise): the autopilot on each tick (fn(t, DT) writes B.ctl; null: the hands again); see sim above
    // the hand-back: the lever goes back to the engine's own (ctl.throttle null), and to neutral when the engine is off, so
    // Sail's lever starts out of N as v1's does (the autopilot's last throttle left on a stopped engine blocked the start)
    drive(fn, { sea = false } = {}) { driver = fn ?? null; driverSea = !!driver && sea; if (!driver) { holdHeading = phys.state.heading; ctl.throttle = null; if (!phys.engine.on) phys.engine.setLever(0); } return B; },
    get driven() { return !!driver; },
    drivenBy(fn) { return !!fn && driver === fn; },   // who holds the autopilot hook (Tessie's flee must not detach Cruise's)
    // Cruise's start (v1 builds a fresh boat at the mode's pose): the same objects, a fresh physics, the follow camera behind
    // her, the wake's trail cleared; the hands start fresh (the pilot on her heading)
    place({ x, z, headingDeg = 0, speed = 0 }) {
      const h = headingDeg * DEG; heading0 = h;
      // the engine stays the same object, fresh inside: the seamanship, the dock and the sound hold it (a new one left their
      // lever on a dead engine after Cruise's start or Sail's from the card)
      const eng = phys.engine, fresh = craftOf(vessel).createPhysics({ x, z, heading: h, speed, vessel });
      Object.assign(phys, fresh); phys.engine = Object.assign(eng, fresh.engine);
      ride.wake?.reset?.();
      camSlowReset(); speedCam.reset();
      Object.assign(follow, new FollowCamera({ hull: sloopCameras(vessel).follow.hull, x, z, heading: h, pitchDeg: num(flags.campitch), dist: num(flags.camdist), pose: BOAT_VIEW }));
      if (flags.camyaw != null && num(flags.camyaw) != null) { follow.yaw = h + num(flags.camyaw) * DEG; follow.chase = false; }   // ?camyaw= holds through a new start (a film's)
      // DRV-8: Setup's rows on ctl (auto-reef) survive the new start; a fresh let-fly (no sheet left flying) and a fresh carry
      const keep = { autoReef: ctl.autoReef, reef: ctl.reef };
      Object.assign(ctl, CONTROLS, keep); delete ctl.gennaker; delete ctl.gkTrim; delete ctl.gkHand; delete phys.gk; owned.main = false; owned.head = false; gkCrew = createGennakerCrew(); gkHoldF = 0; gkHoldR = 0; hand.sheet = null; holdHeading = h; loadN = 0;   //: a fresh start, the gennaker in its bag
      fly = new LetFly({ storage: null, once: false }); carry = new TackCarry(); carryJib = false; carryKeep = 0;
      ground?.reset();
      B.sea?.reset();   // #8, #14: the tackle back aboard, the lever and the furl as new (the engine is fresh inside, above)
      pose = ride.step(null, phys.state, simT, 0);
      kd.reset(); kdFx.reset(); gustS = null; shoveS = null; capS = null;   // K1, K2: a fresh start is upright and unwatched (a scripted gust ends)
      B.onPlaced?.();
      return pose;
    },
    // v1's film contract (src/craft/sloop/capture.js ?film=1): simDt of sim with the capture's helm on the start heading
    // and the crew's trim (no hands): the v1-vs-v2 trace comparison (tools/v2-sail-compare.mjs) runs both this way
    filmStep(simDt) {
      filmHelm ??= new Helm({ rudderMaxDeg: phys.P.rudder.maxDeg });
      filmInputs.rudder = filmHelm.toHeading(phys.state, heading0);
      sim.step(simDt, filmInputs);
      pose = ride.step(null, phys.state, simT, simDt);
      return pose;
    },
    // a capture's settle (v1's settleCapture): `seconds` of sim at 1/60 with the pilot on the start heading, no hands
    // The settle runs the boat's clock `seconds` ahead of the waves' (the readback holds one moment of the sea), so she sails over a
    // frozen sea: its slopes' surge and its orbital current pushed one way for seconds, and on the big sea's back slopes she slid
    // astern (−1.7 m/s after 20 s, 2026-11-24). She settles on the wind and the helm alone and meets the moving sea at the first frame
    settle(seconds) {
      const n = Math.round(seconds * 60);
      const helm = new Helm({ rudderMaxDeg: phys.P.rudder.maxDeg });
      const sea0 = envObj.sea, cur0 = envObj.currentAt;
      envObj.sea = null; envObj.currentAt = null;
      try {
        for (let i = 0; i < n; i++) {
          const rudder = helm.toHeading(phys.state, heading0);
          sim.step(DT, { ...CONTROLS, rudder });
          pose = ride.step(null, phys.state, simT, DT);
        }
      } finally { envObj.sea = sea0; envObj.currentAt = cur0; }
      holdHeading = heading0; hand.sheet = null;   // the hands start fresh: the crew's trim, the pilot on the start heading
      camSlowReset(pose);
      for (let i = 0; i < 120; i++) follow.update(1 / 60, camPose(pose, 1 / 60));
      speedCam.reset(B.speedFeel && !reducedNow() && !driver && (B.viewOf?.() ?? 'follow') === 'follow' ? speedK(phys.state.sog ?? 0) : 0);   // a capture's camera as settled, not easing in from none
      return pose;
    },
    // a short trace row (the sailing comparison, the stats hook)
    row() { const s = phys.state; return { t: +simT.toFixed(3), x: +s.x.toFixed(2), z: +s.z.toFixed(2), sogKn: +(s.sog / KN).toFixed(3), uKn: +(s.u / KN).toFixed(3), headingDeg: +((s.heading / DEG + 360) % 360).toFixed(2), heelDeg: +((s.heel + (pose.heel - s.heel)) / DEG).toFixed(2), physHeelDeg: +(s.heel / DEG).toFixed(2), pitchDeg: +((pose.pitch ?? 0) / DEG).toFixed(2), heaveM: +(pose.heave ?? 0).toFixed(3), twaDeg: +(s.trueWind.angle / DEG).toFixed(1), twsKn: +(s.trueWind.speed / KN).toFixed(2), sheetDeg: ctl.sheet != null ? +(ctl.sheet / DEG).toFixed(1) : null, rudder: +ctl.rudder.toFixed(3), fill: +s.mainFill.toFixed(2) }; },
  };
  return B;
}
