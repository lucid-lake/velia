// Regatta's race camera and fly-ins (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// camera(dt, base): the pre-start's square view behind the boat (racePose), the beat's lift and turn toward the mark (beatPose),
// Tessie's look during a strike near the player, the fly-over up the course (startFly, endFly, flyover, holdFly: the race held at
// its first clock while it plays) and the beacon's race target (beaconView). The hub's own frame is hubGlue.js hubBlend.
import { createFlyover, flyoverWanted } from './flyover.js';
import { reducedNow } from '../sim/steadyCamera.js';
import { easeK } from '../sim/ease.js';
import { CAM_RATES, DEG, RACE_CAM, raceCamEase, smoothstep } from './tuning.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installCamera(R) {
  const { B, canvas, clock, flags, live, look, pic, reduced, stats, tessie } = R;
  const flown = new Set();
  // the fly-over: on the first race of a course this session (flyover.js flyoverWanted: never with reduce motion, an automated browser
  // only with ?flyover=1); the race held at −0:45 while it plays (the boat kept in her box, no tick), any input skips it
  const flyKey = () => R.course?.id ?? '';
  function maybeFly() {
    if (!R.on || R.hubOpen || !R.S || R.S.race.clock >= 0 || R.S.race.clock > R.raceStart + 1) return;
    if (flyoverWanted({ flags, live, webdriver: !!globalThis.navigator?.webdriver, reduced: reducedNow(), seen: flown, key: flyKey() })) startFly();
  }
  const skipKeys = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
  const onSkip = () => R.fly?.skip();
  function startFly() {
    if (!R.S || !R.course) return R.api;
    R.fly = createFlyover({ course: R.course }); flown.add(flyKey());
    R.flyHold = R.S.race.clock <= R.raceStart + 1;   // at the race's start the race waits for it; later (Show course) it runs on
    if (R.flyHold && B.driven) B.drive(null);
    { const q = B.phys.state; R.flyPose = { x: q.x, z: q.z, headingDeg: q.heading / DEG, speed: Math.hypot(q.u ?? 0, q.v ?? 0) || (R.S.me0?.speed ?? 0) }; }   // held where she is, at her speed (a flying start sails on after it)
    R.ui?.card(undefined, { open: false });
    if (live) setTimeout(() => { if (R.fly) for (const k of skipKeys) globalThis.addEventListener?.(k, onSkip, { capture: true, passive: true }); }, 0);   // the click that asked for it is not a skip
    stats.fly = { on: true, stops: R.fly.stops.map((x) => x.id), held: R.flyHold, n: (stats.fly?.n ?? 0) + 1 };
    return R.api;
  }
  function endFly(redrive = true) {
    if (!R.fly) return;
    for (const k of skipKeys) globalThis.removeEventListener?.(k, onSkip, { capture: true });
    const held = R.flyHold; R.fly = null; R.flyHold = false; if (stats.fly) stats.fly.on = false;
    if (held && redrive && R.S) { B.drive(!R.hubOpen && (R.aids.helper || R.auto) ? R.driveHelper : null); R.armPattern(B.t - R.S.race.clock); }
  }
  // Show course (the course card): the fly-over again, at any time before the gun
  function flyover() { if (R.on && !R.hubOpen && R.S && R.S.race.clock < 0 && !R.fly) startFly(); return R.api; }
  // the beacon's race target (main.js): the fly-over's mark (the committee boat on its way home), the committee boat on the last leg
  // (owner 2026-11-16: the finish's pillar), else the next mark (sim/waymark.js targetOf reads { status, leg, target })
  // seq: the leg's number (the beacon's arrival plays only when the rounding moves it on by one; the fly-over's stops carry none);
  // finished: the finish's target once more with status 'finished' (the arrival plays on the crossing; owner 2026-11-16)
  const bv = { status: 'racing', leg: '', seq: null, target: { at: { x: 0, z: 0 }, mark: '' } };
  function beaconView() {
    if (!R.on || !R.S) return null;
    const v = R.S.race.view('me'), L = R.course.line, last = R.course.legs.length - 1;
    const put = (x, z, mark, leg, seq = null, status = 'racing') => { bv.status = status; bv.leg = leg; bv.seq = seq; bv.target.at.x = x; bv.target.at.z = z; bv.target.mark = mark; return bv; };
    if (R.fly && !R.fly.done) { const k = R.fly.mark; return k == null ? put(L.committee[0], L.committee[1], 'finish', 'fly-f') : put(R.fly.stops[k].at[0], R.fly.stops[k].at[1], R.fly.stops[k].id, `fly${k}`); }
    const FE = R.course.finish ?? L;   // a place race's own finish line: its far end carries the pillar
    if (v.status === 'finished') return put(FE.committee[0], FE.committee[1], 'finish', 'finish', last, 'finished');
    if (v.status === 'racing' && v.leg >= last) return put(FE.committee[0], FE.committee[1], 'finish', 'finish', last);
    return v;
  }
  // the fly-over at the race's start: the boat put back where it began, at her speed (a box start's or a flying start's)
  function holdFly() { const q = B.phys.state, p = R.flyPose; if (p && Math.hypot(q.x - p.x, q.z - p.z) > 0.2) B.place(p); }   // 0.2 m: she reads as held, not jumping back

  // the race camera: before the gun (and easing out over 3 s after it) the eye stands behind the boat looking up the course,
  // square to the line, so both ends, the ghost and the boat are in one frame; then the follow camera again
  function camera(dt, base) {
    let c = camera0(dt, base);
    if (R.on && !R.hubOpen && R.S && (R.deep || look.w > 0)) {   // Tessie's Deep: the follow eye turns toward her during a strike near the player, then back
      const q = B.phys.state, st = tessie()?.sim?.state, at = R.deep?.state.phase === 'strike' ? (st?.visible && st.centre ? st.centre : R.deep.ring?.at ?? null) : null;
      c = look.step(dt, c, { active: !!at, boat: [q.x, q.z], target: at, reduced: !!reduced() });
      stats.look = { yawDeg: +look.yawDeg.toFixed(2), w: +look.w.toFixed(3) };
    }
    return R.fly && R.on && !R.hubOpen ? R.fly.update(dt, c) : c;   // the fly-over eases out of the race camera and back into it
  }
  // the race camera's anchor (owner, 2026-11-20, Pass the Channel: "on the very first launch the whole world is shaking"): the boat's
  // physics steps in whole 1/60 s ticks and the drawn pose is the last tick (no interpolation). At 60 fps a 2 × race runs 2 ticks a
  // frame, but the uneven frames of a cold start (pipelines compiling, tiles streaming) run 1, 3 or 5, and an eye locked to the pose
  // moved the world round a steady boat in tick-sized jerks (about 9 cm at 5.6 m/s) until the follow camera's spring took over after
  // the gun. The anchor is where she is at the time this frame was fed: the last tick carried along her course over the ground by the
  // sim time owed and not yet stepped (the boat's stepper and the page clock's remainders, each under one tick)
  const anchor = { x: 0, z: 0 };
  function anchorNow() {
    const q = B.pose ?? B.phys.state, rem = Math.max(0, (B.sim?.acc ?? 0) + (clock?.acc ?? 0)), v = q.sog ?? 0, c = q.cog ?? q.heading ?? 0;
    anchor.x = q.x + Math.sin(c) * v * rem; anchor.z = q.z - Math.cos(c) * v * rem;
    return anchor;
  }
  function camera0(dt, base) {
    if (!R.on || (B.viewOf && B.viewOf() !== 'follow')) return base;
    const c = R.S.race.clock, k = c < 0 ? 1 : Math.max(0, 1 - c / RACE_CAM.easeS);
    // on the beat (the laylines up) the follow eye rises and steps back so the lines read on the water (the TV view of mock 3)
    const lift = pic.laylines && R.aids.laylines ? 1 : 0;
    camE.camK = R.camK; camE.liftK = R.liftK; raceCamEase(camE, { k, lift, yaw: null }, dt); R.camK = camE.camK; R.liftK = camE.liftK;
    // the beat's lift is laid on the follow pose first, so the pre-start's ease out mixes into it (it applied only once the ease was
    // done: a 5 m rise and 8 m step back in one frame, about 4 s after the gun)
    if (R.liftK >= 0.01) base = beatPose(dt, base);
    if (R.camK < 1e-3) return base;
    return racePose(dt, base);
  }
  function beatPose(dt, base) {
    {
      // the eye turns about the boat toward the mark (RACE_CAM.beatYawK of the angle, at most RACE_CAM.beatYawDeg), rises and steps back: the mark and
      // both laylines in the frame, the boat still in its middle
      const s = anchorNow(), m = R.S.race.view('me').target?.at;
      let fx = base.target[0] - base.pos[0], fz = base.target[2] - base.pos[2]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      let yaw = 0;
      if (m) { const bx = m.x - s.x, bz = m.z - s.z; yaw = Math.atan2(fx * bz - fz * bx, fx * bx + fz * bz) * RACE_CAM.beatYawK; const c = RACE_CAM.beatYawDeg * DEG; yaw = Math.max(-c, Math.min(c, yaw)) * R.liftK; }
      R.camYaw += (yaw - R.camYaw) * easeK(CAM_RATES.yaw, dt); stats.camYawDeg = +(R.camYaw / DEG).toFixed(1); stats.lift = +R.liftK.toFixed(2);
      const cs = Math.cos(R.camYaw), sn = Math.sin(R.camYaw), rot = (x, z) => [x * cs - z * sn, x * sn + z * cs];
      const [ex, ez] = rot(base.pos[0] - s.x, base.pos[2] - s.z), [tx, tz] = rot(base.target[0] - s.x, base.target[2] - s.z), [ux, uz] = rot(fx, fz), b = RACE_CAM.beatBack * R.liftK;
      // the look reaches out ahead (RACE_CAM.beatLookM along the turned forward, never past the mark): the lines up the course sit in the
      // frame's upper half instead of on the horizon, the boat in its lower third
      const dm = m ? Math.hypot(m.x - s.x, m.z - s.z) : 0, look = Math.min(RACE_CAM.beatLookM, 0.6 * dm) * R.liftK;
      return { ...base, pos: [s.x + ex - ux * b, base.pos[1] + RACE_CAM.beatLift * R.liftK, s.z + ez - uz * b], target: [s.x + tx + ux * look, base.target[1], s.z + tz + uz * look] };
    }
  }
  function racePose(dt, base) {
    const s = anchorNow(), U = R.course.line.up, portrait = canvas && canvas.clientHeight > canvas.clientWidth;
    const back = portrait ? RACE_CAM.portraitBack : RACE_CAM.back, hgt = portrait ? RACE_CAM.portraitHeight : RACE_CAM.height;
    // look from behind the boat toward the line's middle (between its centre and the ghost): the boat, both ends and the ghost in frame
    const L = R.course.line, tx = (L.centre[0] + R.S.ghost[0]) / 2, tz = (L.centre[1] + R.S.ghost[1]) / 2;
    let dx = tx - s.x, dz = tz - s.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // near the line square to it, and up the course once its middle is behind her: blended over RACE_CAM.blendM and as the middle comes
    // abeam (a cut at 25 m turned the view 67° in one frame before the gun, and 76° as she crossed the line after it)
    { const w = smoothstep(RACE_CAM.squareM, RACE_CAM.squareM + RACE_CAM.blendM, dl) * smoothstep(-0.3, 0, dx * U[0] + dz * U[1]);
      dx = U[0] + (dx - U[0]) * w; dz = U[1] + (dz - U[1]) * w; const dn = Math.hypot(dx, dz) || 1; dx /= dn; dz /= dn; }
    // R3: a box nearer the line (light air: 36 m) would put the line's ends out of the frame: the eye steps back and up by as much
    const near = Math.max(0, RACE_CAM.nearM - dl) * RACE_CAM.nearBack;
    let pos = [s.x - dx * (back + near), hgt + near * 0.3, s.z - dz * (back + near)];
    let target = [s.x + dx * RACE_CAM.ahead, 0, s.z + dz * RACE_CAM.ahead];
    let fov = portrait ? 58 : RACE_CAM.fov;
    ({ pos, target, fov } = R.hubBlend(dt, portrait, { pos, target, fov }));   // behind the hub: the course's frame mixed in
    const e = R.camK * R.camK * (3 - 2 * R.camK), mix = (a, b) => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
    return { ...base, pos: mix(base.pos, pos), target: mix(base.target, target), fov: base.fov + (fov - base.fov) * e };
  }
  const camE = { camK: 1, liftK: 0, camYaw: 0 };   // the race camera's eases (raceCamEase)
  Object.assign(R, { maybeFly, endFly, flyover, beaconView, holdFly, camera });
}
