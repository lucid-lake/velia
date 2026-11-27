// Play as Tessie, the camera. Pure (no DOM, no
// GPU): the page feeds it her spine, her nose and the water's height.
//   the chase   behind her neck: 10 m behind the frame 4.5 m back along her spine, 2.8 m to one side, 4.6 m up, looking 20 m ahead
//               of her nose (a quarter of the way toward the boat in her corners); FOV 55°
//   heavy, calm the yaw follows her heading through a critically damped spring (0.8 s), at most 40°/s; no roll; at the surface the
//               pitch never passes 10°; no shake, no blur, no FOV punch
//   C           (owner, 2026-11-20) third person <-> first person ("Tessie's eyes"); the far camera is gone. First person:
//               the eye over her spine frame TCAM.fp.back m back from the snout, TCAM.fp.up m above it by world up (never the frame's own up:
//               steep in a dive that points forward), low-passed (x z over xyTau, y over yTau, at most lagM behind), so the humps never bob
//               it; world up (her bank never rolls it); the yaw the same as third person's (the player's drag, the swing in behind her);
//               the pitch the player's look about level (-60 deg up to +60 deg); a fixed 60 deg lens; it goes through the surface with her head.
//               The switch is a 0.35 s eased move between the two eyes (smootherstep), not a cut. step's `view`: 'third' | 'first'
//   under       (owner, 2026-11-20: "the other demos let the camera move gradually from above water to fully inside"): one continuous
//               rig, no switch. Its blend k (0 the air's rig, 1 the water's) follows her nose's depth smoothly (from U.k0 m to U.k1 m,
//               eased over U.kS); the eye's height is the air rig's (4.6 m up) mixed into the water rig's (1.4 m above her back, at least
//               1 m off the bed), so it moves through the surface as she goes under or comes up, never a jump. Within U.slowM of the
//               surface its vertical speed is held to U.slowV m/s, so the waterline (drawn per pixel: render/underBack.js) sweeps the frame
//               slowly. Through the lunge's run the blend holds (the strike rises from under the water). step's out.under: { medium
//               'air' | 'water' (the eye's side, U.flagM of hysteresis), depth (m under the local surface, − over), crossing (the
//               surface within U.bandM of the eye: the split frame), k, surf (the surface's height at the eye) }. underOn false keeps
//               phase 1's dive (the eye rises to 9 m and looks down 32°; she shows through the clear water)
//   the assist : a drag looks round (the existing orbit's [dx, dy] rad, smoothed over about 33 ms) and is kept;
//               1.0 s after the last drag, while she swims (and "Camera follows her" is on: followOn), the yaw swings in behind her
//               through the spring, at most 40°/s; the look levels over 1.0 s when she reaches a limit (limit) and at 15°/s after 3 s
//               at a drift with no keys (resting); the automatic pitch at most 30°/s; under the water the look reaches 40° up about level
//   continuous  (step 5; it replaced the strike mode that fell 30 m behind her and rushed back at 86 m/s, and the
//               aim that swung at up to 850°/s) one critically damped spring on the eye, no mode switch: its natural frequency
//               spring.w0 × (1 + her pace / spring.paceV), itself eased over spring.wTau; the eye never faster than her pace + spring.vOver.
//               A strike weight (0 → 1 over strike.in s, back over strike.out s; step's `strike`: the controller's state.strike) shapes only
//               the goal: strike.up m higher, strike.side m to the side away from the boat, the pitch lifting to keep her head in frame
//               through a breach (never a freeze). The aim's yaw toward the locked boat (step's `lock`: sim/tessieHits.js lock()) follows a
//               spring (aim.tau) at most aim.max °/s, its pull aim.pull × the lock's blend (the rising strike's look at the hull the same pull
//               at 1); the aim's whole yaw at most aim.max °/s while nobody drags. First person: a third of the pull, at most fp.lockMax °/s,
//               and the eye pushes in fp.push m with the strike
//   the wreck   (step's `focus`: { x, z } the boat she just knocked over, or null) after a wreck the eye eases round behind her toward the
//               wreck through the yaw's own spring (at most focus.yawMax °/s, no follow-swing while it holds) and the aim pulls focus.pull of
//               the way onto it, so the wreck and her head stay in frame for the few seconds the page holds it; the page clears it on any
//               drag, swim key or press, and a drag turns the eye at once (the player's look always wins)
//   the strike  through a strike the aim also drops toward the struck boat (strike.aimK of the way) and the eye stands strike.back m
//               further back, so her neck, her head and the boat's rail are in frame together at the contact
//   reduced     (the OS's Reduce Motion, reducedNow() in sim/steadyCamera.js): third person by default (C still works), every rate halved (yaw 20°/s, pitch
//               15°/s, the level 7.5°/s), the recentre's wait and spring twice as long
//   const cam = createTessieCam();  cam.reset(); cam.step(dt, { spine, L, psi, nose, speed, strike, lock, view, reduced, orbit, follow,
//                                                              followOn, limit, resting, waterAt, floorAt, underOn }) → { pos, target, fov, up, under }
// The swap's glide (§ 3.4): createGlide() eases any camera into another over 1.6 s on an arc that rises toward 25 m between them; over
// GLIDE.maxM apart (or under reduced motion) the page uses the veil instead (needsVeil).
export const TCAM = Object.freeze({
  backAlong: 4.5, back: 10, side: 2.8, up: 4.6, ahead: 20, fov: 55,
  fp: Object.freeze({ back: 1.6, up: 0.45, crown: 0.44, headM: 0.9, xyTau: 0.08, yTau: 0.35, lagM: 0.4, fov: 60, near: 0.1, switchS: 0.35, lookUp: 60, lookDown: 60, push: 0.6, pushIn: 0.22, pushOut: 0.45, lockK: 1 / 3, lockMax: 25 }),   //: first person
  yawS: 0.8, yawMax: 40, yawMaxReduced: 20,   // s (the spring's settle), °/s
  pitchMaxSurface: 10, divePitch: 32, diveUp: 9, diveS: 1.5, diveFrom: 2.0, diveFull: 4.5,   // °, m, s; nose depth (m) where phase 1's dive look begins and is full
  //: the one spring (rad/s, m/s, s, m/s), the strike weight (s, s, m, m), the aim's smoothing (s, °/s, the lock's pull)
  spring: Object.freeze({ w0: 6, paceV: 6, wTau: 0.3, vOver: 6 }),
  strike: Object.freeze({ in: 0.25, out: 0.6, up: 1.5, side: 1.5, back: 4, aimK: 0.55 }),
  focus: Object.freeze({ pull: 0.85, yawMax: 40, in: 0.6, out: 0.8 }),   // the wreck look: the aim's pull, the eye's turn (°/s), its weight's ease in and out (s)
  aim: Object.freeze({ tau: 0.25, max: 60, pull: 0.35 }),
  paceV: 6,                                    // m/s: her pace read from her neck's own motion (eased) when step's speed is absent
  lookUp: 25, lookDown: 55, pitchMax: 60, diveExtra: 18,   // °: the look's range up and down at the surface, the camera's steepest, phase 1's extra down while she is under
  pullBack: 10, pullUp: 4, pullS: 0.9,         // a knockdown: the eye eases back and up (m), so the falling rig never fills the frame (step's pull: true, or a share for the boat's size: v2/sim/tessieFit.js frameK)
  // phase 2a, the continuous rig (owner, 2026-11-20)
  under: Object.freeze({ k0: 0.9, k1: 3.0, kS: 0.35, slowM: 1.0, slowV: 0.9, vMax: 5.0, flagM: 0.25, keepUnder: 0.9, bandM: 1.5, back: 7, aboveBack: 1.4, bedClear: 1.0, lookUp: 40, strikeUpK: 2.5, hullY: -0.6, strikeBack: 12 }),   // 2c: the eye through the surface 2.5 × as fast out of a strike from below; the hull's underbody (m) the rise looks up at; m short of the hull the rise's eye glides in to (a goal of the one spring)
  assist: Object.freeze({ waitS: 1.0, levelS: 1.0, restS: 3.0, restRate: 15, pitchRate: 30, smooth: 30 }),   // s, s, s, °/s, °/s, 1/s (the drag's one-stage smoothing)
});
export const GLIDE = Object.freeze({ s: 1.6, rise: 25, maxM: 120 });
const DEG = Math.PI / 180;
import { clampT as clamp } from '../../src/sim/core/math.js';
import { wrap } from '../../src/sim/core/math.js';
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

// the eye's side of the surface for the HUD and the assist (never the picture: it is drawn per pixel): 'water' once the eye is flagM under
// the local surface, 'air' once it is flagM over it, else the side it was on (a wave lapping at the lens never flip-flops it)
export function nextMedium(medium, depth, U = TCAM.under) {
  if (depth > U.flagM) return 'water';
  if (depth < -U.flagM) return 'air';
  return medium;
}
// the rig's blend for her nose's depth (0 the air's, 1 the water's): smooth from U.k0 to U.k1
export const rigBlend = (nose, U = TCAM.under) => smooth((nose - U.k0) / (U.k1 - U.k0));

export function createTessieCam({ K = TCAM } = {}) {
  const U = K.under, A = K.assist;
  let yaw = null, yawV = 0, pos = null, vel = [0, 0, 0], omega = null, ws = 0, wr = 0, aimOff = 0, aimOffV = 0, aimYaw = null, fpOffYaw = 0, pushK = 0, diveK = 0, fpPos = null, fpOff = null, viewK = null, viewWant = 0, look = 0, lookIn = 0, pitchNow = 0, first = true, pullK = 0;   // look: the player's own pitch (kept; it steers her climb)
  let medium = 'air', kNow = null, dragAge = 99, restT = 0, prevA = null, vNow = 0, boatSide = 1, wf = 0, fLast = null;   // wf: the wreck look's weight (0…1); fLast: its wreck while it eases out   // vNow: her pace (m/s, from her neck's own motion) when step's speed is absent
  const under = { medium: 'air', depth: -4.6, crossing: false, k: 0, surf: 0 };
  const out = { pos: [0, 0, 0], target: [0, 0, 0], fov: K.fov, up: [0, 1, 0], under };
  // one critically damped spring step toward g (exact for a goal held over dt: stable at any ω dt)
  const springTo = (i, g, w, dt) => { const x = pos[i] - g, e = Math.exp(-w * dt), q = (vel[i] + w * x) * dt; pos[i] = g + (x + q) * e; vel[i] = (vel[i] - w * q) * e; };
  const self = {
    K,
    reset() { yaw = null; yawV = 0; pos = null; vel = [0, 0, 0]; omega = null; ws = 0; wr = 0; aimOff = 0; aimOffV = 0; aimYaw = null; fpOffYaw = 0; pushK = 0; diveK = 0; fpPos = null; fpOff = null; viewK = null; viewWant = 0; look = 0; lookIn = 0; pitchNow = 0; first = true; pullK = 0; medium = 'air'; kNow = null; dragAge = 99; restT = 0; prevA = null; vNow = 0; boatSide = 1; wf = 0; fLast = null; },
    get state() { return { focusK: wf, yaw, diveK, viewK: viewK ?? 0, view: viewWant ? 'first' : 'third', fpEye: fpPos ? [...fpPos] : null, look, pitch: pitchNow, medium, k: kNow ?? 0, crossing: under.crossing, dragAge, restT, omega: omega ?? 0, ws, aimOff, vel: [...vel] }; },
    get yaw() { return yaw ?? 0; }, get pitch() { return pitchNow; },   // the look: its yaw (W's way, turned by the drag) and its pitch below level (rad, + down)
    get look() { return look; },   // the player's own look about the camera's neutral (+ down): her climb rate's input
    get medium() { return medium; },
    setLook(p) { lookIn = clamp(p, -Math.max(U.lookUp, viewWant ? K.fp.lookUp : 0) * DEG, (viewWant ? K.fp.lookDown : K.lookDown) * DEG); look = lookIn; },
    step(dt, { spine, L = 19, psi = 0, nose = 0, speed = null, strike = null, lock = null, view = 'third', reduced = false, orbit = null, pull = 0, follow = true,
      followOn = true, limit = false, resting = false, waterAt = null, floorAt = null, underOn = true, focus = null } = {}) {
      dt = Math.max(0, Math.min(0.1, dt || 0));
      const N = spine.length / 8, ia = Math.min(N - 1, Math.round(K.backAlong / (L / (N - 1)))) * 8;
      const ax = spine[ia], ay = spine[ia + 1], az = spine[ia + 2], hx = spine[0], hy = spine[1], hz = spine[2];
      const wAt = (x, z) => (waterAt ? waterAt(x, z) : 0);
      const slow = reduced ? 2 : 1;
      const rise = !!strike?.rise, hasBoat = strike && Number.isFinite(strike.x);
      // the rig's blend: her nose's depth, eased (it holds through the rise: the strike comes up from under the water)
      if (underOn) {
        const kw = rigBlend(nose, U);
        if (kNow == null) kNow = kw;
        else if (!(rise && kw < kNow)) kNow += (kw - kNow) * (1 - Math.exp(-dt / U.kS));
      } else kNow = 0;
      // the strike weight: in over strike.in, out over strike.out; the rise's own weight (the glide in, the look up)
      const SK = K.strike;
      ws = strike ? Math.min(1, ws + dt / SK.in) : Math.max(0, ws - dt / SK.out);
      wr = rise && underOn ? Math.min(1, wr + dt / SK.in) : Math.max(0, wr - dt / SK.out);
      const wsE = smooth(ws), wrE = smooth(wr);
      const kU = kNow;
      // the look: a drag turns the camera round her and tilts it (kept), its pitch smoothed over about 33 ms (one stage)
      if (yaw == null) yaw = psi;
      const dragging = !!(orbit && (orbit[0] || orbit[1]));
      // first person or third (C): the wanted view now, and its eased share (0.35 s, smootherstep below)
      viewWant = view === 'first' ? 1 : 0;
      if (viewK == null) viewK = viewWant; else { const r = dt / K.fp.switchS; viewK = viewWant > viewK ? Math.min(viewWant, viewK + r) : Math.max(viewWant, viewK - r); }
      const fpOn = viewWant === 1;
      const lookUpMax = fpOn ? K.fp.lookUp * DEG : (K.lookUp + (U.lookUp - K.lookUp) * kU) * DEG;
      const lookInMax = fpOn ? lookUpMax : lookUpMax + K.pitchMaxSurface * DEG * kU;   // under the water the look may cancel the base's tilt: the camera reaches 40° up about level
      const lookDownMax = (fpOn ? K.fp.lookDown : K.lookDown) * DEG;
      if (dragging) { dragAge = 0; yaw = wrap(yaw - orbit[0]); yawV = 0; lookIn = clamp(lookIn + orbit[1], -lookInMax, lookDownMax); restT = 0; }
      else dragAge += dt;
      lookIn = clamp(lookIn, -lookInMax, lookDownMax);
      // the assist's pitch: the look levels over levelS at a limit, and at restRate after restS at a drift with no keys (a drag stops both)
      restT = resting && !dragging ? restT + dt : 0;
      if (!dragging && underOn) {
        if (limit) lookIn *= Math.exp(-dt * 3 / (A.levelS * slow));
        else if (restT >= A.restS) { const r = A.restRate / slow * DEG * dt; lookIn = Math.abs(lookIn) <= r ? 0 : lookIn - Math.sign(lookIn) * r; }
      }
      look = underOn ? look + (lookIn - look) * (1 - Math.exp(-A.smooth * dt)) : lookIn;
      if (Math.abs(lookIn - look) < 1e-5) look = lookIn;
      // the yaw: (phase 2) 1.0 s after the last drag, while she swims, it swings in behind her through the spring, its rate capped; else it holds
      const wait = underOn ? A.waitS * slow : 0;
      // the wreck look: its weight eases in and out; while it holds the yaw swings (the same spring) round behind her toward the wreck
      const FK = K.focus, hasF = !!(focus && Number.isFinite(focus.x));
      if (hasF) fLast = [focus.x, focus.z];
      wf = hasF && !dragging ? Math.min(1, wf + dt / FK.in) : dragging ? 0 : Math.max(0, wf - dt / FK.out);
      if (!hasF && wf <= 0) fLast = null;
      if (!dragging && hasF) {
        // from her middle (not her neck), so the eye stands behind her body and the wreck lies ahead of her head, never under the eye
        const im = Math.min(N - 1, Math.round(L * 0.5 / (L / (N - 1)))) * 8, mx = spine[im], mz = spine[im + 2];
        const want = Math.atan2(focus.x - mx, -(focus.z - mz)), w = 4 / (K.yawS * slow), err = wrap(want - yaw);
        yawV += (w * w * err - 2 * w * yawV) * dt;
        const cap = Math.min(FK.yawMax, reduced ? K.yawMaxReduced : K.yawMax) * DEG;
        yawV = clamp(yawV, -cap, cap);
        yaw = wrap(yaw + yawV * dt);
      } else if (!dragging && follow && followOn && dragAge >= wait) {
        const w = 4 / (K.yawS * (underOn ? slow : 1)), err = wrap(psi - yaw);
        yawV += (w * w * err - 2 * w * yawV) * dt;
        const cap = (reduced ? K.yawMaxReduced : K.yawMax) * DEG;
        yawV = clamp(yawV, -cap, cap);
        yaw = wrap(yaw + yawV * dt);
      } else yawV = 0;
      const yw = yaw;
      // phase 1's dive (eased over diveS) only without the under rig
      const diveWant = underOn ? 0 : smooth((nose - K.diveFrom) / (K.diveFull - K.diveFrom));
      diveK += (diveWant - diveK) * (1 - Math.exp(-dt / (K.diveS / 3)));
      pullK += ((pull === true ? 1 : Number.isFinite(pull) ? Math.max(0, pull) : 0) - pullK) * (1 - Math.exp(-dt / K.pullS));
      const backAir = K.back + K.pullBack * pullK + SK.back * smooth(ws), backWater = U.back;
      const back = backAir + (backWater - backAir) * kU;
      const side = K.side * (1 - 0.5 * kU);
      const hUp = K.up + K.pullUp * pullK;
      // her pace: the controller's (her nose's speed), else read from her neck's own motion (eased)
      if (prevA && dt > 0) { const v = Math.hypot(ax - prevA[0], az - prevA[1]) / dt; if (v < 40) vNow += (v - vNow) * (1 - Math.exp(-dt / 0.5)); }
      prevA = [ax, az];
      const pace = Number.isFinite(speed) ? speed : vNow;
      const fx = Math.sin(yw), fz = -Math.cos(yw), rx = Math.cos(yw), rz = Math.sin(yw);
      // the goal behind her neck's base (the spring smooths it; no anchor of its own, no hold through a strike)
      let wx = ax - fx * back + rx * side, wz = az - fz * back + rz * side;
      // the strike weight shapes the goal only: a little higher, to the side away from the boat (both in frame)
      if (hasBoat) boatSide = (strike.x - ax) * rx + (strike.z - az) * rz >= 0 ? 1 : -1;
      wx -= rx * boatSide * SK.side * wsE * (1 - kU * 0.5); wz -= rz * boatSide * SK.side * wsE * (1 - kU * 0.5);
      // 2c: through the rise of a strike from below the eye glides in to U.strikeBack m short of the hull (on its side of it), so the hull
      // stands dark against the bright window above, not lost 30 m off in the blue: a goal of the same spring, weighed in by the rise
      if (wrE > 0 && hasBoat && kU > 0.5) {
        const dx = wx - strike.x, dz = wz - strike.z, dl = Math.hypot(dx, dz) || 1;
        if (dl > U.strikeBack) { wx += (strike.x + dx / dl * U.strikeBack - wx) * wrE; wz += (strike.z + dz / dl * U.strikeBack - wz) * wrE; }
      }
      const surfW = wAt(wx, wz);
      let wy;
      if (underOn) {
        // the air's rig and the water's mixed by k: the eye goes through the surface as she does, never a jump
        const yAir = Math.max(hUp, surfW + 0.5) + SK.up * wsE, yWater = Math.min(ay + U.aboveBack, surfW - U.keepUnder);   // the water's rig is under the water (her back may lie at the surface while her nose is down)
        wy = yAir + (yWater - yAir) * kU;
        if (floorAt && wy < surfW) wy = Math.max(wy, floorAt(wx, wz) + U.bedClear);
      } else wy = Math.max(hUp, hUp + (K.diveUp - hUp) * diveK) + SK.up * wsE;
      // the one spring: ω = w0 (1 + pace / paceV), eased; a changed goal moves where it pulls, never its time constant
      const SP = K.spring, wWant = SP.w0 * (1 + pace / SP.paceV) / slow;
      omega = omega == null ? wWant : omega + (wWant - omega) * (1 - Math.exp(-dt / SP.wTau));
      if (!pos || first) { pos = [wx, wy, wz]; vel = [0, 0, 0]; }
      else if (dt > 0) {
        const p0 = [...pos];
        springTo(0, wx, omega, dt); springTo(2, wz, omega, dt); springTo(1, wy, omega, dt);
        // the eye never faster than her pace + vOver over the ground (no 86 m/s rushes)
        const capH = (pace + SP.vOver) * dt, gx = pos[0] - p0[0], gz = pos[2] - p0[2], gl = Math.hypot(gx, gz);
        if (gl > capH) { const f = capH / gl; pos[0] = p0[0] + gx * f; pos[2] = p0[2] + gz * f; vel[0] *= f; vel[2] *= f; }
        let dy = pos[1] - p0[1];
        if (underOn) {
          const dyWas = dy;
          dy = clamp(dy, -U.vMax * dt, U.vMax * dt);   // the eye never outruns her by more than a swimmer's burst
          // near the surface the eye moves through it slowly (the split frame's waterline sweeps the view, never a wipe)
          const sNow = wAt(p0[0], p0[2]), near = Math.abs(p0[1] - sNow) < U.slowM || Math.abs(p0[1] + dy - sNow) < U.slowM || (p0[1] - sNow) * (p0[1] + dy - sNow) < 0;
          const sv = U.slowV * (strike?.breach ? U.strikeUpK : 1) / slow;   // 2c: up with her out of the strike from below (still eased, never a jump)
          if (near) dy = clamp(dy, -sv * dt, sv * dt);
          if (dy !== dyWas) vel[1] = dy / dt;
        }
        pos[1] = p0[1] + dy;
      }
      // the aim: ahead of her nose; its yaw pulled toward the locked boat by a spring (aim.tau, at most aim.max °/s, the pull aim.pull × the
      // lock's blend), the rising strike's look at the hull the same pull at 1; the base pitch: shallow at the surface, toward her under it
      const AM = K.aim;
      let tx = hx + Math.sin(yw) * K.ahead, tz = hz - Math.cos(yw) * K.ahead;
      // through a strike the aim drops toward the struck boat (her neck, head and its rail in frame); after a wreck toward the wreck
      if (hasBoat && wsE > 0) { const k = SK.aimK * wsE; tx += (strike.x - tx) * k; tz += (strike.z - tz) * k; }
      const wfE = smooth(wf);
      if (fLast && wfE > 0) { const k = SK.aimK * wfE; tx += (fLast[0] - tx) * k; tz += (fLast[1] - tz) * k; }
      const lockOn = lock && lock.k > 0 && Number.isFinite(lock.x), baseYaw = Math.atan2(tx - pos[0], -(tz - pos[2]));
      const pullTo = wrE > 0 && hasBoat ? [strike.x, strike.z] : fLast && wfE > 0 ? fLast : lockOn ? [lock.x, lock.z] : null;
      const pullAim = wrE > 0 && hasBoat ? Math.max(wrE, lockOn ? AM.pull * lock.k : 0) : fLast && wfE > 0 ? K.focus.pull * wfE : lockOn ? AM.pull * lock.k : 0;
      const offWant = pullTo ? pullAim * wrap(Math.atan2(pullTo[0] - pos[0], -(pullTo[1] - pos[2])) - baseYaw) : 0;
      { const w = 1 / AM.tau, x = aimOff - offWant, e = Math.exp(-w * dt), q = (aimOffV + w * x) * dt; let nx = offWant + (x + q) * e; aimOffV = (aimOffV - w * q) * e;
        const cap = AM.max / slow * DEG * dt; if (Math.abs(nx - aimOff) > cap) { nx = aimOff + Math.sign(nx - aimOff) * cap; aimOffV = clamp(aimOffV, -AM.max * DEG, AM.max * DEG); } aimOff = nx; }
      const hd0 = Math.max(1, Math.hypot(tx - pos[0], tz - pos[2]));
      let ayw = baseYaw + aimOff;
      // the aim's whole yaw at most aim.max °/s while nobody drags (the yaw's spring, her head's sway and the pull together)
      if (aimYaw == null || first || dragAge < 0.15) aimYaw = ayw;
      else { const cap = AM.max / slow * DEG * dt; aimYaw = wrap(aimYaw + clamp(wrap(ayw - aimYaw), -cap, cap)); }
      ayw = aimYaw;
      tx = pos[0] + Math.sin(ayw) * hd0; tz = pos[2] - Math.cos(ayw) * hd0;
      const hd = hd0;
      const baseAir = Math.atan2(pos[1] - 0.5, hd), baseWater = Math.atan2(pos[1] - hy, hd);
      const base = clamp(baseAir + (baseWater - baseAir) * kU, -K.pitchMaxSurface * DEG, K.pitchMaxSurface * DEG);
      // the pitch: the base, the player's look on it (and phase 1's extra down while she is under); the automatic part at most 30°/s. The
      // rise looks up at the hull's underbody (weighed in); a breach lifts the look to keep her head in frame (never a freeze)
      let pitchWant = clamp(base + look + K.diveExtra * DEG * diveK, -lookUpMax, K.pitchMax * DEG);
      if (wrE > 0 && hasBoat && kU > 0.5) pitchWant += (clamp(Math.atan2(pos[1] - U.hullY, Math.max(1, Math.hypot(strike.x - pos[0], strike.z - pos[2]))), -lookUpMax, K.pitchMax * DEG) - pitchWant) * wrE;
      if (strike?.breach && hy > pos[1] - 2) { const hp = Math.atan2(pos[1] - hy, Math.max(1, Math.hypot(hx - pos[0], hz - pos[2]))); if (hp < pitchWant) pitchWant += (Math.max(hp, -lookUpMax) - pitchWant) * wsE; }
      if (first || dragAge < 0.15 || !underOn) pitchNow = pitchWant;
      else { const r = A.pitchRate / slow * DEG * dt; pitchNow += clamp(pitchWant - pitchNow, -r, r); }
      first = false;
      // first person: the eye over her spine frame fp.back m from the snout, fp.up m above it by world up, low-passed
      // (no bob), its aim the camera's yaw and the player's look about level; kept up to date in third person too, so C eases between two live eyes
      // (measured, phase 2d step 2: a frame 1.6 m along the spine sits on her steep neck at the surface, under her head; so the eye stands
      // 1.6 m back from the snout over the ground, along her head's own heading, and fp.up over her crown line, fp.crown over the snout's)
      const F = K.fp, ih = Math.max(1, Math.round(F.headM / (L / (N - 1)))) * 8;
      let qx = spine[0] - spine[ih], qz = spine[2] - spine[ih + 2]; const ql = Math.hypot(qx, qz);
      if (ql > 0.05) { qx /= ql; qz /= ql; } else { qx = Math.sin(psi); qz = -Math.cos(psi); }
      const ex = spine[0] - qx * F.back, ez = spine[2] - qz * F.back, ey = spine[1] + F.crown + F.up;
      if (!fpPos || dt <= 0) { fpPos = [ex, ey, ez]; fpOff = [ex - spine[0], ez - spine[2]]; }
      else {
        const kxz = 1 - Math.exp(-dt / F.xyTau), ky = 1 - Math.exp(-dt / F.yTau);
        // x z: the eye's offset from her snout smoothed (a lag in the world would leave the eye behind at 19 m/s); y: the height itself (no bob)
        fpOff[0] += (ex - spine[0] - fpOff[0]) * kxz; fpOff[1] += (ez - spine[2] - fpOff[1]) * kxz;
        fpPos[0] = spine[0] + fpOff[0]; fpPos[2] = spine[2] + fpOff[1]; fpPos[1] += (ey - fpPos[1]) * ky;
        fpPos[1] = clamp(fpPos[1], ey - F.lagM, ey + F.lagM);   // at most lagM behind her head (the waterline sweeps over about 0.4 s, never detached)
      }
      const fpPitch = clamp(look, -lookUpMax, lookDownMax);
      //: the lock eases a third of the way onto the boat (at most fp.lockMax °/s); the eye pushes in fp.push m with the strike
      const fpWant = lockOn ? F.lockK * lock.k * wrap(Math.atan2(lock.x - fpPos[0], -(lock.z - fpPos[2])) - yw) : 0, fcap = F.lockMax / slow * DEG * dt;
      fpOffYaw += clamp((fpWant - fpOffYaw) * (1 - Math.exp(-dt / AM.tau)), -fcap, fcap);
      const fyw = yw + fpOffYaw;
      const pushOn = strike && (strike.phase === 'strike' || strike.phase === 'follow');
      pushK = pushOn ? Math.min(1, pushK + dt / F.pushIn) : Math.max(0, pushK - dt / F.pushOut);
      const push = F.push * smooth(pushK), fpE = [fpPos[0] + qx * push, fpPos[1], fpPos[2] + qz * push];
      const fpT = [fpE[0] + Math.sin(fyw) * 20 * Math.cos(fpPitch), fpE[1] - Math.sin(fpPitch) * 20, fpE[2] - Math.cos(fyw) * 20 * Math.cos(fpPitch)];
      const tgt = [tx, pos[1] - Math.tan(pitchNow) * hd, tz];
      const vu = viewK * viewK * viewK * (viewK * (viewK * 6 - 15) + 10);   // smootherstep between the two eyes (0.35 s)
      // the aim: a point 20 m along each eye's view, blended (a target blended between far points never swings through the eye)
      const d3 = Math.hypot(tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]) || 1, tA = [pos[0] + (tgt[0] - pos[0]) * 20 / d3, pos[1] + (tgt[1] - pos[1]) * 20 / d3, pos[2] + (tgt[2] - pos[2]) * 20 / d3];
      for (let i = 0; i < 3; i++) { out.pos[i] = pos[i] + (fpE[i] - pos[i]) * vu; out.target[i] = tA[i] + (fpT[i] - tA[i]) * vu; }
      out.fov = K.fov + (F.fov - K.fov) * vu; out.up[0] = 0; out.up[1] = 1; out.up[2] = 0;
      out.view = vu > 0.5 ? 'first' : 'third'; out.viewK = vu;
      const sEye = wAt(out.pos[0], out.pos[2]);
      under.surf = sEye; under.depth = sEye - out.pos[1];
      medium = underOn ? nextMedium(medium, under.depth, U) : 'air';
      under.medium = medium; under.crossing = underOn && Math.abs(under.depth) < U.bandM; under.k = kU;
      return out;
    },
  };
  return self;
}

// the eye's distance between two camera poses (the veil's rule)
const camGap = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
export const needsVeil = (from, to, { reduced = false, K = GLIDE } = {}) => reduced || camGap(from, to) > K.maxM;

// the glide: from a frozen pose into the live one over K.s, an eased arc rising toward K.rise m between them
export function createGlide({ K = GLIDE } = {}) {
  let from = null, t = 0;
  return {
    get active() { return !!from; },
    start(pose) { from = { pos: [...pose.pos], target: [...pose.target], fov: pose.fov ?? 55 }; t = 0; },
    stop() { from = null; },
    apply(dt, live) {
      if (!from) return live;
      t += Math.max(0, dt);
      const u = clamp(t / K.s, 0, 1), e = u * u * u * (u * (u * 6 - 15) + 10);   // smootherstep
      const lift = Math.sin(Math.PI * u) * Math.max(0, Math.min(K.rise, camGap(from, live) * 0.35));
      const L = (a, b) => a + (b - a) * e;
      const out = { ...live, pos: [L(from.pos[0], live.pos[0]), L(from.pos[1], live.pos[1]) + lift, L(from.pos[2], live.pos[2])],
        target: [L(from.target[0], live.target[0]), L(from.target[1], live.target[1]), L(from.target[2], live.target[2])], fov: L(from.fov, live.fov ?? 55), up: [0, 1, 0] };
      if (u >= 1) from = null;
      return out;
    },
  };
}
