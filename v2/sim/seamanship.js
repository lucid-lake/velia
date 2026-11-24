// The engine and the ground tackle on v2 (#8, #14): v1's src/sail/seamanship.js, its pure half, on v2's boat (v2/sim/boat.js).
// No DOM and no GPU: node runs it (tests), the headless page steps it (the films), a live page adds the keys, the dock, the
// skipper's lines, the sunrise veil and the sound (v2/ui/seamanship.js, v2/audio/engine.js).
// v1's own pure modules do the work:
//   src/sim/boat/engine.js      the auxiliary (inside BoatPhysics: phys.engine; its lever reaches the physics through ctl.throttle)
//   src/sim/boat/tackle.js      the anchor and its rode, the mooring, the dock (createTackle), on the boat's env through
//   src/sim/sail/tackleEnv.js   (with the bottom's hooks while the boat is free)
//   src/stations/sloop/throttleLever.js  the lever's six notches, the start out of N, the stop at N by state
//   src/sail/seamanshipRules.js the lever's repeat, the arrival's camera, the engine-off line, the sunrise's numbers
//   src/boat/exhaustSim.js      the wet exhaust's clots (drawn by v2/render/exhaust.js)
// What v1's createSeamanship does each frame is copied here line for line where it touches no three or DOM: pre() before the
// physics steps (the lever into ctl.throttle, the crew's furl while held, the arrival, the stop by state, the engine's first
// words, the nudge), post() after (the exhaust, the anchor on the bow, the rode, the chain's speed).
//   const sea = createSeamanship({ B, depthAt, piers, clock, sun, say, cue, veil });
//   B.sea = sea   (B.step calls sea.pre(dt) first and sea.post(dt) after the ride)
//   sea.actions.engine() / lever(v) / step(±1) / neutral() / anchor() / lines() / sails() / sunrise()
//   sea.hold(±1) / sea.release()   the + − keys held (a notch every SEA.repeatS)
//   sea.camera(dt, pose) → the arrival's wide shot blended over the views' pose
//   sea.draw → { anchorDrop, anchorShown, rode (world points | null) } for the boat's renderer; sea.exhaust (the clots)
import { createTackle, anchorFor } from '../../src/sim/boat/tackle.js';
import { tackleEnv } from '../../src/sim/sail/tackleEnv.js';
import { SEA, EngineNudge, nextSunrise } from '../../src/sail/seamanshipRules.js';
import { stepNotch, autoStart, autoStop, sailsDrawing } from '../../src/stations/sloop/throttleLever.js';
import { createExhaustSim } from '../../src/boat/exhaustSim.js';
import { blendPose } from '../../src/boat/binoculars.js';
import { analyticSun } from '../../src/sim/timeOfDay.js';
import { nearestAnchorage, spotLine, anchorageCue, ballCue } from './anchorages.js';
import { BALL_USE_M } from './moorings.js';

const NO_EVENTS = Object.freeze([]);
import { clampT as clamp } from '../../src/sim/core/math.js';
const ease = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// The anchor seen (owner, 2026-11-17: "Do we have an anchor animation? I have never seen the anchor work once."): v2's crew on
// v1's tackle. Too fast, the crew stops her (sails down, rounded up head to wind, the engine astern, then N) and lets go under 1 kn; too
// deep, the skipper names the nearest charted anchorage (v2/sim/anchorages.js); the anchor falls at fallMs and the chain runs at
// payMs (v1: 0.8 m/s both; a 7 kg anchor sinks faster, and the chain runs as she falls back: cheat on when, not on motion);
// the splash, the break-out and the drips are events for the page's droplets and sound; the Boat view eases toward the bow for
// the drop; one line when it holds, one when it drags.
export const ANCHORING = Object.freeze({
  // round 2 (owner, 2026-11-17: "Do another round"): ANCHOR to "Anchor's holding." in about 12–15 s of play (Sail's 2 ×), brisk but
  // real: the engine astern at once, the anchor's free fall, the chain run out from a free-spooling gypsy as she backs, a short set
  fallMs: 2.5, payMs: 2.0,           // m/s: the 7 kg anchor's fall to the bottom on its chain, then the chain run out as she backs down
  setS: 1.5,                           // s of pull for the anchor to dig in (v1: 8)
  haulMs: 1.2, haulN: 450,           // m/s: the windlass bringing the chain in while the pull is under haulN, the crew motoring up to it
                                     // so it stays slack (v1: 0.3 m/s by hand up to 700 N; a faster haul against a taut rode snatched)
  stopS: 40,                         // s: the crew tries this long to stop her before the 'fast' line
  astern: -1, dropAheadMs: 0.2,      // full astern, and the crew lets go as her way comes off (under 0.2 m/s ahead, under 1 kn),
                                     // the engine kept astern to lay the chain out as she gathers sternway
  scope: 3,                          // the crew's scope (v1: 5): 3 : 1 of the depth and the bow's height, a short stop in a sheltered spot in a lake breeze (it holds to about 16 kn steady; past that "We're dragging")
  // setting it: with the chain going out the crew backs her down astern (sternway kept under maxSternMs: the chain's own pace), slow
  // astern once the rode pulls (over tautN), until the anchor bites (the rode's pull over biteN, not dragging, for biteS); then N:
  // the engine stops by itself at anchor (v1's rule), quietly
  setLever: -1, setGentle: -0.4, tautN: 60, maxSternMs: 2.0, endSternMs: 1.3, biteN: 250, biteS: 0.5, setMaxS: 30, holdN: 120,
  holdS: 0.6,                        // s held, taut (the pull over holdN) and not dragging, before "Anchor's holding."
  dragM: 3, reholdS: 8,              // m dragged after it held before "We're dragging"; s still again before it holds again
  weighLever: 0.5, weighN: 80,       // weighing: slow ahead while the rode pulls over weighN (the crew motors up to the anchor)
  upS2: 1.5,                         // s after it is stowed before the camera eases back (the sails going up, or the engine at idle)
  // the Boat view's look at the bow (owner, 2026-11-17: "zoom in to view the anchor animation, fine, then stay there"; "too fast and
  // too sharp"): a smootherstep over inS (and outS back), to the Boat view's own spot swung swingDeg about the boat and brought in
  // (closer, lift, at least minUp high), aimed at the water under the roller (aimY); her swing at anchor followed through a tauS
  // low-pass; the view turns no faster than maxDegS (v2/tests/anchor-seen.test.mjs, v2/tests/pages/anchorCamera.page.mjs): on the live
  // Boat view the ease's middle alone reached 16–20°/s (2026-11-18), so the aim is held to capDegS per second, a margin under it
  bow: { inS: 6, outS: 6, swingDeg: 45, closer: 0.8, lift: 3.5, minUp: 6, aimY: 0.2, tauS: 2.0, maxDegS: 15, capDegS: 14,
    // with the gear drawn close (desktop and tablet, owner 2026-11-18: "The anchor line is too thin to be noticed"; sea.hang): the eye
    // dist m from the roller on her own side, bearingDeg off the bow, up m over the water, aimed ahead m forward of the roller at aimY
    // (the water under the roller, where the chain goes in): the anchor on the roller, its splash and the chain hanging into the clear water all in frame
    near: { dist: 5.5, up: 2.8, bearingDeg: 105, ahead: 0, aimY: 0.2 } },
});
// v2's anchor numbers for a boat's dims: v1's (src/sim/boat/tackle.js anchorFor) with v2's fall and pay
export const anchorNumbers = (dims) => ({ ...anchorFor(dims), scope: ANCHORING.scope, fallMs: ANCHORING.fallMs, payMs: ANCHORING.payMs, setS: ANCHORING.setS, haulMs: ANCHORING.haulMs, haulN: ANCHORING.haulN, maxN: 4000 });   // maxN: the rode's pull capped (the snub of a 7 kg anchor's 1 kN hold and the boat's surge)

// v2/assets/towns/piers.json (tools/v2-tackle-bake.mjs: v1's piersFrom) → v1's pier records
export function piersOf(json) {
  const kinds = json?.kinds ?? [];
  return (json?.piers ?? []).map((r) => ({ a: [r[0], r[1]], b: [r[2], r[3]], half: r[4], kind: kinds[r[5]] ?? 'pier' }));
}

// a hull-frame point (x starboard, y up from the waterline, z aft) → world, on the drawn pose: Boat.update's
// position · Ry(−heading) · Rx(pitch) · Rz(−heel) (v2/render/boat.js Mroot)
export function hullToWorld(pose, p, out = [0, 0, 0]) {
  const h = pose.heading ?? 0, pi = pose.pitch ?? 0, he = -(pose.heel ?? 0);
  let x = p[0], y = p[1], z = p[2];
  { const c = Math.cos(he), s = Math.sin(he), nx = c * x - s * y, ny = s * x + c * y; x = nx; y = ny; }
  { const c = Math.cos(pi), s = Math.sin(pi), ny = c * y - s * z, nz = s * y + c * z; y = ny; z = nz; }
  { const c = Math.cos(-h), s = Math.sin(-h), nx = c * x + s * z, nz = -s * x + c * z; x = nx; z = nz; }
  out[0] = (pose.x ?? 0) + x; out[1] = (pose.heave ?? 0) + y; out[2] = (pose.z ?? 0) + z;
  return out;
}

// B: v2/sim/boat.js; depthAt(x, z): the water's depth (m, + down: −terrain height); piers, balls: v1's records; clock: the
// day clock (setHour, hourAt: the sunrise wait); sun(): the sun's elevation (deg); say(id, key, d): the skipper's line (NOTES
// id); cue(name, o): a control's click (v1's sfx.cue); veil(opacity, seconds): the sunrise's fade (the UI's element)
// anchorages: the chart's anchorages ([{ x, z, depth, name }], v2/sim/anchorages.js), the 'deep' line names the nearest;
// A: the anchor's numbers (v2's by default; v1's ANCHOR for a parity check)
export function createSeamanship({ B, depthAt = () => 10, piers = [], balls = [], clock = null, sun = () => 90, sunAt = analyticSun, say = null, cue = null, veil = null, muted = () => false, timeScale = 2, anchorages = [], A: AN = null, M: MO = null }) {
  const phys = B.phys, ctl = B.ctl, eng = phys.engine, dims = B.dims;
  const AN0 = AN ?? anchorNumbers(dims);
  // the piers and balls the tackle reads (setPiers swaps them in; reset builds on them); M: the mooring's numbers (v2/sim/moorings.js
  // MOOR_V2 on the live page; v1's MOORING by default)
  let tackleIn = { balls, piers, ...(MO ? { M: MO } : {}) };
  let tk = createTackle({ dims, depthAt, A: AN0, ...tackleIn });
  const posts = [];
  // the env: the tackle's forces with the bottom's (v1's tackleEnv on the boat's env object; the original hooks kept for a re-wire)
  const envObj = B.env(0), base = { ext: envObj.ext, post: envObj.post };
  const wire = () => { envObj.ext = base.ext; envObj.post = base.post; tackleEnv(envObj, tk, posts); };
  wire();
  let furlWant = ctl.furl ?? 0, leverHeldDir = 0, leverHeldAt = 0, lastMode = 'free', t = 0, atN = 0;
  const hooks = { say, cue, veil, kedge: null, onAnchor: null };   // the live page's voice, click and veil (v2/ui/seamanship.js sets them)
  let spots = anchorages;   // the chart's anchorages (setAnchorages once the page has them)
  let stopping = null;      // the crew stopping her for the anchor: { age, rounding } (the boat's helm reads sea.rounding)
  const events = [];        // the splash, the break-out (sea.drain(): the page's droplets and sound)
  const sayIt = (id, key = '', d = '') => hooks.say?.(id, key, d);

  // ---- the actions (v1's, line for line) ----
  const actions = {
    engine() { crewEngine = false; const on = eng.toggle(); if (on) eng.setLever(0); return on; },
    lever(v, { snap = false } = {}) { crewEngine = false; if (autoStart({ from: eng.lever, to: v, engineOn: eng.on, detent: eng.P.detent })) eng.start(); const was = eng.lever; eng.setLever(v); if (snap && Math.abs(was - v) > 1e-3) hooks.cue?.('click', { rate: 0.9 }); },
    neutral() { crewEngine = false; eng.setLever(0); },
    step(dir) { crewEngine = false; const from = eng.lever, to = stepNotch(from, dir); if (autoStart({ from, to, engineOn: eng.on, detent: eng.P.detent })) eng.start(); eng.setLever(to); hooks.cue?.('click', { rate: 0.9 }); return to; },
    anchor() {
      hooks.onAnchor?.();   // the page: the splash's sound file now, before it is needed
      if (tk.mode === 'anchor') { if (tk.weigh()) startWeigh(); return 'weigh'; }
      if (hooks.kedge && tk.mode === 'free' && B.ground?.state?.mode === 'aground') { hooks.kedge(); return 'kedge'; }   // aground: J rows the anchor out and hauls (v1: grounding.js)
      if (stopping) { endStop(); return 'cancel'; }   // J again while the crew stops her: they let it be (the sails as they were)
      // a mooring: on a ball, J lets it go; a free ball near the bow, J picks it up (or the skipper says how) instead
      // of dropping the anchor in a mooring field
      if (tk.mode === 'moored') { tk.release(); return 'slipped'; }
      if (tk.mode === 'free') {
        const nb = tk.nearestBall(phys.state);
        if (nb && nb.d < BALL_USE_M) { const m = tk.moor(phys.state); if (m.ok) return 'moored'; sayIt(m.why === 'fast' ? 'ballFast' : 'ball', 'J'); return 'ball'; }
      }
      const r = tk.drop(phys.state);
      // too fast but the depth is right: the crew stops her and lets go under 1 kn (pre() below)
      const why = r.ok ? null : r.why === 'fast' ? depthWhy(r.depth) ?? 'fast' : r.why;
      if (why === 'fast') { before = { furl: furlWant, motoring: eng.on }; startStop(); return 'stopping'; }
      if (why) refuse(why, r.depth);
      if (r.ok) { before = { furl: furlWant, motoring: eng.on }; startSet(); }
      return r.ok ? 'drop' : why;
    },
    lines() {
      const rel = tk.release(); if (rel) return rel;
      const m = tk.moor(phys.state); if (m.ok) return 'moored';
      const d = tk.tieUp(phys.state); if (d.ok) return 'docked';
      if (m.d != null && m.d < 25) sayIt(m.why === 'fast' ? 'ballFast' : 'ball', '');
      else if (d.gap != null && d.gap < 12) sayIt(d.why === 'fast' ? 'pierFast' : 'pier', '');
      return 'none';
    },
    sails() { furlWant = furlWant > 0.5 ? 0 : 1; return furlWant; },
    sunrise() { return waitForSunrise(); },
  };
  const motoring = () => eng.on && Math.max(ctl.furl ?? 0, furlWant) >= 0.5;
  // the depth's own refusal (null: 3–20 m)
  function depthWhy(d) { const R = AN0.dropDepth; return !(d >= R[0]) ? 'shallow' : d > R[1] ? 'deep' : null; }
  function refuse(why, depth) {
    const d = depth != null ? `${depth.toFixed(0)} m` : '';
    if (why === 'deep') {   // the nearest charted anchorage, its distance and bearing from the bow
      const s = phys.state, n = nearestAnchorage(spots, s.x, s.z);
      if (n) { sayIt('deepSpot', 'J', `${d} here. ${spotLine(n.spot, s)}`); lastSpot = n.spot; return; }
    }
    sayIt(why === 'fast' ? 'fast' : why === 'deep' ? 'deep' : why === 'shallow' ? 'shallow' : 'tied', 'J', d);
  }
  let lastSpot = null;
  // the crew sets the anchor with the engine: started if it was off, slow astern while the chain runs out, N once it bites
  let setting = null;
  function startSet() { setting = { age: 0, bite: 0, lever: eng.lever, crew: !eng.on || !!crewEngine }; if (!eng.on) { eng.start(); talk.keys = true; } crewEngine = setting.crew; }
  let crewEngine = false;   // the crew started the engine for the anchoring: it stops by itself after, with no line
  function stepSet(dt) {
    const a = tk.state.anchor, s = phys.state;
    if (Math.abs(eng.lever - setting.lever) > 1e-6) { setting = null; return; }   // a hand on the lever: the player's
    const gone = tk.mode !== 'anchor' || ['weighing', 'up', 'stowed'].includes(a.phase);
    setting.age += dt;
    setting.bite = a.phase === 'held' && still(a) && a.H > ANCHORING.biteN ? setting.bite + dt : 0;
    const done = gone || setting.bite >= ANCHORING.biteS || (a.phase === 'held' && still(a) && a.set >= 1) || setting.age > ANCHORING.setMaxS;
    // astern while the chain lies slack (she falls back to lay it out), gently once it pulls (a crew never backs harder than the
    // anchor holds: v1's 1 kN), N at the drop and once it bites
    // the last fifth of the chain at a walk (never a snatch at the rode's end); all out and still slack: she coasts back onto it
    const cap = a.out > a.target * 0.8 || a.phase === 'held' ? ANCHORING.endSternMs : ANCHORING.maxSternMs;
    const lever = done || eng.state !== 'running' || s.u < -cap ? 0 : a.H > ANCHORING.tautN ? ANCHORING.setGentle : ANCHORING.setLever;
    if (eng.lever !== lever) eng.setLever(lever);
    setting.lever = eng.lever;
    if (done) setting = null;
  }
  function endStop() { if (stopping) { furlWant = stopping.furl0; eng.setLever(0); } stopping = null; bowOut(); }
  // what she was doing before the anchor (the sails up or down, under engine or not): weighed, she goes back to it
  let before = null, weighing = null;
  function startWeigh() {
    weighing = { lever: 0, stowedAt: null };
    if (!eng.on) { eng.start(); talk.keys = true; crewEngine = true; }   // the crew motors up to the anchor
    setting = null;
  }
  function stepWeigh(dt) {
    const a = tk.state.anchor;
    if (weighing.stowedAt == null) {
      if (Math.abs(eng.lever - weighing.lever) > 1e-6) { weighing.lever = null; }   // a hand on the lever: the player's from here
      // the crew steers for the anchor and motors slowly up to it, so the windlass hauls a slack chain (she ends over it)
      const s = phys.state, [bx, bz] = bowXZ(s), dx = a.x - bx, dz = a.z - bz, X = Math.hypot(dx, dz);
      weighing.steer = a.phase === 'weighing' && X > 2 ? Math.atan2(dx, -dz) : null;
      if (weighing.lever != null) {
        const lever = eng.state === 'running' && a.phase === 'weighing' && X > Math.max(3, a.depth * 0.4) && s.sog < 0.8 ? ANCHORING.weighLever : 0;
        if (eng.lever !== lever) eng.setLever(lever);
        weighing.lever = eng.lever;
      }
      if (tk.mode === 'free') {   // stowed: back to what she was doing
        weighing.stowedAt = t;
        const b = before ?? { furl: 0, motoring: false };
        furlWant = b.furl;
        if (weighing.lever != null) eng.setLever(0);
        if (b.motoring) crewEngine = false;   // she was motoring: the engine stays on at idle, the player's again
        else if (crewEngine && eng.on) { eng.stop(); crewEngine = false; }
        sayIt('up', 'J');
        before = null;
      }
    } else if (t - weighing.stowedAt > ANCHORING.upS2) { bowOut(); weighing = null; }
  }   // given up: the sails back as they were
  function startStop() {
    stopping = { age: 0, rounding: null, furl0: furlWant, lever: null };
    furlWant = 1; eng.setLever(0);   // the sails down, the engine to N
    sayIt('rounding', 'J');
    bowIn();   // the slow ease starts with the stop, so the camera is there for the drop and the splash (about 4 s on)
  }

  // ---- the arrival (anchoring): the camera rises to a wide shot (v1's arrivalPose) ----
  const A = SEA.arrival;
  let slowFor = 0, holding = false, arrival = null, inputAt = -9, arrived = false, camNow = null;
  function startArrival() {
    const s = phys.state, cp = camNow?.pos ?? [s.x + 10, 3, s.z + 10], cx = cp[0] - s.x, cz = cp[2] - s.z, l = Math.hypot(cx, cz) || 1;
    arrival = { t0: t, dir: [cx / l, cz / l], k: 0, phase: 'rise' };
  }
  // ---- the drop's look: the Boat view eases toward the bow and stays there while she lies to it (owner, 2026-11-17: "That camera
  // movement is too fast and too sharp; it will make people dizzy"): a 4.5 s smootherstep in and out (zero speed and acceleration at
  // both ends, no overshoot), on the camera's own clock (framerate-independent); the spot is the Boat view's own position swung
  // swingDeg about the boat toward its side and brought in, aimed at the water under the bow, so the turn is small and the boat stays
  // in view; while she swings at anchor the spot and the aim follow through a tauS low-pass (no jitter, no quick yaw) ----
  let bowLook = null, lookedAt = -9, bowRan = false;
  const bowIn = () => { if (!bowLook) { bowLook = { t0: t, age: 0, outAge: null, S: null, side: null, dir: null }; bowRan = true; } };   // bowRan: no wide arrival shot after it either, this anchoring (the owner: no camera moves of its own)
  function bowOut() { if (bowLook && bowLook.outAge == null) bowLook.outAge = 0; }
  const smoother = (x) => { const u = clamp(x, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
  function bowPose(normal, dt = 1 / 60) {
    const W = ANCHORING.bow;
    if (!bowLook) return normal;
    if ((B.viewOf?.() ?? 'follow') !== 'follow') { bowLook = null; return normal; }   // the helm view: at once
    if (lookedAt > bowLook.t0 + 0.2) bowOut();   // the player's own look (a drag on the view, the wheel's zoom: B.camera calls looked()): eased back
    const step = clamp(dt, 0, 0.25);
    // the spot: the Boat view's position swung about the boat's centre toward its own side (it never crosses over her), brought in
    const s = phys.state, b = roller, p = normal.pos, cx = s.x, cz = s.z, rx = p[0] - cx, rz = p[2] - cz;
    if (bowLook.side == null) { const h = s.heading; bowLook.side = (rx * Math.cos(h) + rz * Math.sin(h)) >= 0 ? 1 : -1; }   // starboard of her: +1
    const a = -bowLook.side * W.swingDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    let pos = [cx + (rx * ca - rz * sa) * W.closer, Math.max(W.minUp, p[1] * W.closer + W.lift), cz + (rx * sa + rz * ca) * W.closer];
    let target = [b[0], W.aimY, b[2]];
    if (api.hang) {   // the gear drawn close (desktop, tablet): the eye near the bow on her own side, the anchor, the splash and the chain in frame
      const N = W.near, h = s.heading, fx = Math.sin(h), fz = -Math.cos(h), sx = Math.cos(h) * bowLook.side, sz = Math.sin(h) * bowLook.side;
      const bb = N.bearingDeg * Math.PI / 180, ox = fx * Math.cos(bb) + sx * Math.sin(bb), oz = fz * Math.cos(bb) + sz * Math.sin(bb);
      pos = [b[0] + ox * N.dist, N.up, b[2] + oz * N.dist];
      target = [b[0] + fx * N.ahead, N.aimY, b[2] + fz * N.ahead];
    }
    // the low-pass on the spot and the aim: her swing at anchor followed, slowly. Close in (api.hang) only the swing is smoothed, in
    // offsets from the roller: she backs down at up to 2 m/s, and a lag of metres at 5.5 m loses the bow
    const o = api.hang ? b : null, rel = (v) => (o ? [v[0] - o[0], v[1], v[2] - o[2]] : v);
    if (!bowLook.S) bowLook.S = { pos: rel(pos).slice(), target: rel(target).slice() };
    const f = 1 - Math.exp(-step / W.tauS), S = bowLook.S, pr = rel(pos), tr = rel(target);
    for (let i = 0; i < 3; i++) { S.pos[i] += (pr[i] - S.pos[i]) * f; S.target[i] += (tr[i] - S.target[i]) * f; }
    const abs = (v) => (o ? [v[0] + o[0], v[1], v[2] + o[2]] : v.slice());
    const bowP = { pos: abs(S.pos), target: abs(S.target), fov: normal.fov, near: normal.near ?? 0.5, up: normal.up };
    // the ease's clock held back so the view never turns faster than capDegS (the swing's middle on the live Boat view reached
    // 16-20 deg/s, 2026-11-18): the pose at a full step and at none; if the full step turns the view too far from the last frame's
    // aim, the clock moves only the share that keeps the turn at the cap. The pose stays on the eased path (no lag to catch up: no kink)
    const kAt = (age, outAge) => smoother(age / W.inS) * (outAge == null ? 1 : 1 - smoother(outAge / W.outS));
    const out1 = (x) => outAt(normal, bowP, kAt(bowLook.age + step * x, bowLook.outAge == null ? null : bowLook.outAge + step * x));
    let x = 1;
    const prev = bowLook.dir, cap = W.capDegS * Math.PI / 180 * step;
    if (prev && step > 0) {
      const a1 = angTo(prev, out1(1)), a0 = angTo(prev, out1(0));
      if (a1 > cap && a1 > a0 + 1e-9) x = clamp((cap - a0) / (a1 - a0), 0, 1);
    }
    bowLook.age += step * x; if (bowLook.outAge != null) bowLook.outAge += step * x;
    if (bowLook.outAge != null && bowLook.outAge >= W.outS) { bowLook = null; return normal; }
    const out = outAt(normal, bowP, kAt(bowLook.age, bowLook.outAge));
    bowLook.dir = dirOf(out);
    return out;
  }
  const dirOf = (q) => { const d = [q.target[0] - q.pos[0], q.target[1] - q.pos[1], q.target[2] - q.pos[2]], L = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / L, d[1] / L, d[2] / L]; };
  const angTo = (u, q) => { const v = dirOf(q); return Math.acos(clamp(u[0] * v[0] + u[1] * v[1] + u[2] * v[2], -1, 1)); };
  // close in (api.hang) the eased view looks at a point eased from the Boat view's aim to the roller's water, a little ahead of the
  // eye's move (the plain blend of directions looked past the bow from the eye's half-way spot)
  const outAt = (normal, bowP, k) => {
    const o = blendPose(normal, bowP, k);
    if (!api.hang || k <= 0 || k >= 1) return o;
    const kt = 1 - (1 - k) * (1 - k);
    return { ...o, target: normal.target.map((x, i) => x + (bowP.target[i] - x) * kt) };
  };
  function arrivalPose(normal) {
    camNow = normal;
    if (!arrival) return normal;
    const a = arrival, s = phys.state, age = t - a.t0;
    if (a.phase === 'rise' && inputAt > a.t0 + 0.5) { a.phase = 'back'; a.backAt = t; a.from = a.k; }
    if (a.phase === 'rise') { a.k = ease(age / A.riseS); if (age > A.riseS + A.holdWideS) { a.phase = 'back'; a.backAt = t; a.from = a.k; } }
    else { a.k = a.from * (1 - ease((t - a.backAt) / A.backS)); if (a.k <= 0) { arrival = null; return normal; } }
    const wide = { pos: [s.x + a.dir[0] * A.backM, A.upM, s.z + a.dir[1] * A.backM], target: [s.x - a.dir[0] * 25, 1.5, s.z - a.dir[1] * 25], fov: A.fov, near: 0.5 };
    return blendPose(normal, wide, a.k);
  }

  // ---- wait for sunrise (D3): the veil, the clock moved to the dawn, the veil lifted ----
  let waking = null;
  function waitForSunrise() {
    if (tk.mode !== 'anchor' || tk.state.anchor.phase !== 'held' || waking || !clock) { sayIt('dawn', 'J'); return false; }
    const now = clock.hourUnwrappedAt ? clock.hourUnwrappedAt(B.t) : clock.hourAt(B.t), rise = nextSunrise(now, sunAt);   // ENG-6: unwrapped (v1's hourAt is), so setHour after midnight never steps the day back
    if (rise == null) return false;
    waking = { at: t, hour: rise - SEA.sunrise.before, set: false };
    hooks.veil?.(1, SEA.sunrise.fadeS);
    return waking.hour;
  }
  function stepSunrise() {
    if (!waking) return;
    if (!waking.set && t - waking.at > SEA.sunrise.fadeS + SEA.sunrise.darkS) {
      clock.setHour(waking.hour, B.t); waking.set = true; waking.setAt = t;
      hooks.veil?.(0, 3.2);
    }
    if (waking.set && t - waking.setAt > 3.5) waking = null;
  }

  // the bow's point on the water (the tackle's: A.bowX forward of the centre)
  // the anchor not moving now (v1's dragging flag stays up 8 s after it stops: the creep while it sets)
  const still = (a) => !a.dragging || a.stillS > 0.5;
  const bowXZ = (s) => [s.x + Math.sin(s.heading) * AN0.bowX, s.z - Math.cos(s.heading) * AN0.bowX];
  // "Anchor's holding." once it is held, taut and still for holdS; "We're dragging" once it moves dragM after that (the creep
  // while it sets is not dragging); "Anchor's holding." again once it is still reholdS
  const said = { hold: false, drag: false, heldS: 0, from: 0 };
  function lines(dt) {
    const a = tk.state.anchor;
    if (tk.mode !== 'anchor' || a.phase === 'stowed') { said.hold = false; said.drag = false; said.heldS = 0; return; }
    const moving = a.dragging && a.stillS === 0;
    said.heldS = a.phase === 'held' && !moving && !setting && a.set >= 1 && (a.H > ANCHORING.holdN || said.heldS > 0) ? said.heldS + dt : 0;
    if (!said.hold && said.heldS >= (said.drag ? ANCHORING.reholdS : ANCHORING.holdS)) { said.hold = true; said.drag = false; said.from = a.dragged; sayIt('holding', 'J'); }
    if (said.hold && moving && a.phase === 'held' && a.dragged - said.from >= ANCHORING.dragM) { said.drag = true; said.hold = false; sayIt('dragging', 'J'); }
  }
  const nudge = new EngineNudge();
  const talk = { started: false, keys: false, sails: false, motorAt: 0, ball: false, ballAt: -99 };
  const ancCue = { on: false, spot: null, ball: false };   // the anchorage cue (pre(): v2/ui/sail.js lights the ANCHOR lamp faintly, the chart lifts the glyph)

  // ---- each frame, before the physics (v1's pre) ----
  function pre(dt) {
    t += dt;
    if (stopping && stopping.lever != null && Math.abs(eng.lever - stopping.lever) > 1e-6) { stopping.furl0 = furlWant; stopping = null; }   // a hand on the lever: the player stops her
    if (stopping) {
      const s = phys.state;
      stopping.age += dt;
      stopping.rounding = s.heading + (s.trueWind?.angle ?? 0);   // head to wind (the wind's from)
      // the way off her: the engine (started for the anchoring, as a crew does) astern once she points up, then N for the drop
      if (!eng.on) { eng.start(); talk.keys = true; crewEngine = true; }   // the crew's start: no "+ for more power" line
      const lever = eng.state === 'running' ? ANCHORING.astern : 0;
      if (eng.lever !== lever) eng.setLever(lever);
      stopping.lever = eng.lever;
   // the camera on its way to the bow as she slows: there for the splash
      const dNow = depthAt(...bowXZ(s)), w = depthWhy(dNow);
      if (w) { endStop(); refuse(w, dNow); }   // she ran off the 3–20 m while stopping
      else if (s.u <= ANCHORING.dropAheadMs && s.sog <= AN0.dropMs * 0.95) { stopping = null; const r = tk.drop(s); if (!r.ok) { eng.setLever(0); refuse(r.why, r.depth); } else startSet(); }   // let go as she gathers sternway, still astern
      else if (stopping.age > ANCHORING.stopS) { endStop(); refuse('fast'); }
    }
    if (setting) stepSet(dt);
    if (weighing) stepWeigh(dt);
    if (leverHeldDir && t - leverHeldAt >= SEA.repeatS) { actions.step(leverHeldDir); leverHeldAt = t; }
    ctl.throttle = eng.lever;
    const s = phys.state, mode = tk.mode;
    const heldNow = (mode === 'anchor' && ['down', 'held'].includes(tk.state.anchor.phase)) || mode === 'moored' || mode === 'docked';
    s.held = heldNow;
    if (mode !== lastMode) { if (mode === 'free' && !weighing) furlWant = 0; if (mode === 'free') bowRan = false; lastMode = mode; }
    ctl.furl = heldNow ? 1 : furlWant;
    holding = mode === 'anchor' && tk.state.anchor.phase === 'held' && !tk.state.anchor.dragging;
    lines(dt);
    slowFor = holding && s.sog < A.slowMs ? slowFor + dt : 0;
    if (slowFor >= A.holdS && !arrived && !api.arrivalOff && !bowLook && !bowRan) { arrived = true; startArrival(); }   // not while the bow look holds (owner: stay there)
    if (!holding) arrived = false;
    if (eng.state === 'running' && !talk.started) { talk.started = true; talk.motorAt = t; }
    if (talk.started && !talk.keys && eng.on && t - talk.motorAt > 1.5) { talk.keys = true; sayIt('motorKeys', '+'); }
    if (talk.started && !talk.sails && eng.on && !motoring() && (ctl.furl ?? 0) < 0.5 && t - talk.motorAt > 9) { talk.sails = true; sayIt('sailsDown', 'Y'); }
    { const nb = tk.nearestBall(s)?.d ?? 1e9;
      if (mode === 'free' && nb < 40 && !talk.ball && t - talk.ballAt > 60) { talk.ball = true; talk.ballAt = t; sayIt('ballNear', ''); }
      if (nb > 60) talk.ball = false;
      // the quiet cue: inside a charted anchorage, or a free ball near the bow, while she is free (v2/sim/anchorages.js CUE)
      const free = mode === 'free' && !stopping;
      ancCue.ball = free && ballCue(nb, ancCue.ball);
      ancCue.spot = free ? anchorageCue(spots, s.x, s.z, ancCue.spot) : null;
      ancCue.on = !!ancCue.spot || ancCue.ball; }
    atN = eng.on && Math.abs(eng.lever) < eng.P.detent ? atN + dt : 0;
    const madeFast = mode === 'moored' || mode === 'docked';
    const why = autoStop({ engineOn: eng.on, lever: eng.lever, atNeutralS: atN, drawing: sailsDrawing({ furl: s.furl ?? ctl.furl, mainFill: s.mainFill, jibFill: s.jibFill }), held: (holding && !setting) || madeFast, detent: eng.P.detent });
    if (why) { eng.stop(); atN = 0; if (!((crewEngine || said.hold) && why === 'held')) sayIt(why === 'sails' ? 'engineOffSails' : madeFast ? 'engineOffFast' : 'engineOffAnchor', ''); crewEngine = false; }
    if (nudge.update(dt, s, { muted: muted() })) sayIt('engine', '0');
    stepSunrise();
  }

  // ---- after the physics (v1's post, without three): the exhaust, the anchor on the bow, the rode, the chain's speed ----
  const HULL = dims.HULL;
  const exhaust = createExhaustSim();
  const roller = [0, 0, 0], outlet = [0, 0, 0], aft = [0, 0], stbd = [0, 0];
  const rodePts = Array.from({ length: 16 }, () => [0, 0, 0]), rodeOut = [];
  const pennantPts = Array.from({ length: 8 }, () => [0, 0, 0]);   // A2: v1's 8-point pennant, its points reused
  const draw = { anchorDrop: 0, anchorShown: true, rode: null, pennant: null };
  const y0 = HULL.anchorPin?.[1] ?? 1.143;
  const pin = HULL.anchorPin ?? HULL.anchorRoller ?? [0, 1.143, -4.4];
  const anchorAt = [0, 0, 0];
  let lastDrop = 0;
  let lastOut = 0, chainMs = 0;
  function post(dt) {
    const s = phys.state, pose = B.pose;
    // the exhaust from its outlet on the starboard quarter
    hullToWorld(pose, HULL.exhaust ?? [1.18, 0.3, 3.805], outlet);
    const h = s.heading; aft[0] = -Math.sin(h); aft[1] = Math.cos(h); stbd[0] = Math.cos(h); stbd[1] = Math.sin(h);
    exhaust.update(s, { at: outlet, aft, stbd }, dt);
    // the anchor on its socket: lowered along the hull's −y as the chain runs out, hidden once 1 m under; back up on weighing
    const an = tk.state.anchor;
    const drop = an.phase === 'stowed' ? 0 : Math.min(an.out, y0 + 1.2);
    draw.anchorDrop = drop; draw.anchorShown = drop < y0 + 1.0;
    // the anchor's crown in the world (its shackle lowered by the drop): the splash where it meets the water, the drips after it
    // breaks out on the way up
    // with the gear drawn close (api.hang: v2/render/anchorGear.js) the anchor slides forward over the roller and hangs under it,
    // so its splash and drips are under the roller (0.53 m forward of the stowed pin)
    const at = api.hang ? (HULL.anchorRoller ?? pin) : pin;
    hullToWorld(pose, [at[0], y0 - drop, at[2]], anchorAt);
    if (lastDrop <= 0 && drop > 0 && an.phase === 'falling') { events.push({ kind: 'letgo', at: [anchorAt[0], anchorAt[1], anchorAt[2]] }); bowIn(); }
    if (lastDrop < y0 && drop >= y0 && an.phase === 'falling') events.push({ kind: 'splash', at: [anchorAt[0], 0, anchorAt[2]] });
    if (lastDrop >= y0 && drop < y0 && (an.phase === 'up' || an.phase === 'weighing')) events.push({ kind: 'break', at: [anchorAt[0], 0, anchorAt[2]] });
    lastDrop = drop;
    // the rode (the anchor seen, round 2: "the chain catenary visible at anchor as she swings"): the whole chain, in v2's clear
    // water too. On the bottom (down, held, weighing): the catenary of its pull (a = H / w) from the roller to where it touches
    // down, then along the bottom to the anchor; falling or coming up: straight from the roller to the anchor. 16 points, reused
    hullToWorld(pose, HULL.anchorRoller ?? [0, 1.1, -4.4], roller);
    if (tk.mode === 'anchor' && an.phase !== 'stowed') {
      let n = 0;
      const put = (x, y, z) => { const p = rodePts[n++]; p[0] = x; p[1] = y; p[2] = z; };
      const bottom = -Math.max(0.5, an.depth);
      if (an.phase === 'falling' || an.phase === 'up') {
        put(roller[0], roller[1], roller[2]);
        put(anchorAt[0], Math.max(bottom, Math.min(anchorAt[1], roller[1] - an.out)), anchorAt[2]);
      } else {
        const dx = an.x - roller[0], dz = an.z - roller[2], X = Math.hypot(dx, dz), ux = X > 1e-6 ? dx / X : 0, uz = X > 1e-6 ? dz / X : 0;
        const h = roller[1] - bottom, w = AN0.chainKgM * 9.81 * AN0.chainSub, a = Math.max(an.H, 4) / w;
        const s0 = Math.min(an.out, Math.sqrt(h * h + 2 * h * a));
        const xs = Math.min(X, a * Math.asinh(s0 / a));   // the hanging part's horizontal span
        const yk = h / Math.max(1e-6, a * (Math.cosh(xs / a) - 1));   // fitted so it meets the roller exactly
        for (let i = 0; i < 14; i++) {   // from the roller (x = xs from the touchdown) down to the touchdown (x = 0)
          const x = xs * (1 - i / 13), y = bottom + Math.min(h, a * (Math.cosh(x / a) - 1) * yk);
          put(roller[0] + ux * (xs - x), y, roller[2] + uz * (xs - x));
        }
        if (X - xs > 0.05) put(an.x, bottom, an.z);   // the chain along the bottom to the anchor
      }
      rodeOut.length = 0; for (let i = 0; i < n; i++) rodeOut.push(rodePts[i]);   // no allocation a frame
      draw.rode = n >= 2 ? rodeOut : null;
    } else draw.rode = null;
    // A2: moored, the pennant from the roller to the ball (v1's src/sail/seamanship.js: 8 points, a sag of 0.35 m, down to
    // 0.25 m at the ball)
    if (tk.mode === 'moored' && tk.state.ball) {
      const b = tk.state.ball;
      for (let i = 0; i < 8; i++) { const k = i / 7, p = pennantPts[i]; p[0] = roller[0] + (b.x - roller[0]) * k; p[1] = roller[1] * (1 - k) + 0.25 * k - Math.sin(Math.PI * k) * 0.35; p[2] = roller[2] + (b.z - roller[2]) * k; }
      draw.pennant = pennantPts;
    } else draw.pennant = null;
    pose.anchorLight = tk.mode === 'anchor' && an.phase !== 'stowed';   // the masthead's anchor light (render/night.js), dark by day by its own level
    pose.anchorDrop = draw.anchorDrop; pose.anchorShown = draw.anchorShown; pose.rode = draw.rode; pose.pennant = draw.pennant;
    // the chain's speed for its sound (v1: out per frame over the game speed, smoothed over 0.15 s)
    const out = an.phase === 'stowed' ? 0 : an.out;
    chainMs += ((out - lastOut) / Math.max(dt, 1e-3) / timeScale - chainMs) * Math.min(1, dt / 0.15); lastOut = out;
  }

  const api = {
    actions, pre, post, posts, nudge, exhaust, draw, hooks, arrivalOff: false, hang: false, engine: eng, ctl,
    get tackle() { return tk; }, get t() { return t; },
    // more hooks after each physics tick (v1's addPost: Sail's practice marks, ui/course.js); the env is re-wired so the tick runs them
    addPost(f) { posts.push(f); wire(); return () => { const i = posts.indexOf(f); if (i >= 0) { posts.splice(i, 1); wire(); } }; },
    // the piers, once their file is in (the env re-wired on the new tackle; nothing else changes)
    // an outside hook after each physics tick, after the tackle's (v1's addPost: the show's solids, L3); the env re-wired so
    // the tick runs it. Returns its remover
    addPost(f) { posts.push(f); wire(); return () => { const i = posts.indexOf(f); if (i >= 0) posts.splice(i, 1); wire(); }; },
    setPiers(list, ballsIn = tackleIn.balls) { if (tk.mode !== 'free') return false; tackleIn = { ...tackleIn, balls: ballsIn, piers: list }; tk = createTackle({ dims, depthAt, A: AN0, ...tackleIn }); wire(); return true; },
    // a fresh boat (B.place: Cruise's start, Sail's from the card; v1 builds a new boat and a new seamanship there): the anchor
    // and its rode aboard, the lines in, the lever's repeat, the furl, the arrival and the dawn wait cleared. Without it a boat
    // left at anchor or on her lines in Sail kept the old tackle's forces at the new pose: Cruise flung her km off and held her
    reset() {
      tk = createTackle({ dims, depthAt, A: AN0, ...tackleIn }); wire();
      furlWant = 0; leverHeldDir = 0; lastMode = 'free'; atN = 0;
      slowFor = 0; holding = false; arrival = null; arrived = false;
      if (waking) { waking = null; hooks.veil?.(0, 0.3); }
      stopping = null; setting = null; weighing = null; before = null; crewEngine = false; bowLook = null; events.length = 0; lastDrop = 0; said.hold = false; said.drag = false; said.heldS = 0;
      lastOut = 0; chainMs = 0; draw.anchorDrop = 0; draw.anchorShown = true; draw.rode = null; draw.pennant = null;
      return api;
    },
    hold(dir) { if (!dir) return; actions.step(dir); leverHeldDir = dir; leverHeldAt = t; },
    release() { leverHeldDir = 0; },
    touched() { inputAt = t; },
    looked() { lookedAt = t; inputAt = t; },   // the player's own look (v2/sim/boat.js camera(): the follow camera moved by a drag or the wheel; never a click or a key): the bow look eases back
    camera(dt, pose) { return arrivalPose(bowPose(pose, dt)); },
    get motoring() { return motoring(); },
    get furlWant() { return furlWant; },
    get held() { return tk.mode !== 'free' && (tk.mode !== 'anchor' || ['down', 'held'].includes(tk.state.anchor.phase)); },
    get holding() { return holding && slowFor >= A.holdS; },
    get anchoredNow() { return holding; },
    get arrival() { return arrival ? { phase: arrival.phase, k: arrival.k } : null; },
    get waking() { return waking; }, get chainMs() { return chainMs; },
    // the anchor seen: the crew stopping her (the boat's helm rounds her up to sea.rounding), the drop's bow look, the events
    get stopping() { return stopping ? { age: stopping.age } : null; }, get rounding() { return stopping?.rounding ?? (weighing?.lever != null ? weighing.steer ?? null : null); },
    get bowLook() { return bowLook ? { age: bowLook.age, out: bowLook.outAge } : null; },
    // the crew has the lever (stopping her, setting the anchor) or runs the engine it started: the status line stays quiet on them
    get crewHands() { return !!stopping || !!setting || (!!weighing && weighing.lever != null && weighing.stowedAt == null); }, get weighing() { return weighing ? { stowed: weighing.stowedAt != null } : null; }, get crewEngine() { return crewEngine && eng.on; },
    get holdSaid() { return said.hold; },
    get anchorAt() { return anchorAt; }, get anchorages() { return spots; }, get lastSpot() { return lastSpot; },
    get cue() { return ancCue; },   // { on, spot, ball }: the boat inside a charted anchorage (spot) or a free ball near her bow
    setAnchorages(list) { spots = list ?? []; return spots; },
    drain() { return events.length ? events.splice(0) : NO_EVENTS; },
    A: AN0,
    // the dock's MOOR (lines) and DAWN rules (v1's dock.register visible())
    linesUp() { return tk.mode === 'moored' || tk.mode === 'docked' || (tk.nearestBall(phys.state)?.d ?? 1e9) < 40 || tk.state.pierGap < 15; },
    dawnUp() { return tk.mode === 'anchor' && tk.state.anchor.phase === 'held' && !waking && sun() < 0; },
    get state() { const s = phys.state; return { engine: eng.state, rpm: Math.round(eng.rpm), lever: +eng.lever.toFixed(2), gear: eng.gear ?? 0, thrust: Math.round(s.thrust), mode: tk.mode, anchor: { ...tk.state.anchor }, fenders: tk.state.fenders, furl: +(s.furl ?? 0).toFixed(2), sog: +s.sog.toFixed(2), depth: depthAt(s.x, s.z), why: tk.state.why, exhaust: exhaust.stats(), chainMs: +chainMs.toFixed(3), arrival: api.arrival }; },
  };
  return api;
}
