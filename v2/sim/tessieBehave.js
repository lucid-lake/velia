// Tessie M3, her behaviours near the boat (owner, 2026-11-18): she swims alongside
// for a while, and she dives under the hull, passing below the keel. Pure: no DOM, no GPU, no Math.random, no wall clock. Like
// the revenge (v2/sim/tessieRevenge.js) it drives her through the sim's motion API (v2/sim/tessie.js: ambush, swimTo, depth,
// behave, play) and only chooses where she starts ("cheat on where and when, never on motion"): she swims as an animal, her turn,
// speed and climb inside the sim's limits, and the boat is solid to her (v2/sim/tessieClear.js holds her outside it).
//
//   alongside  she rises abeam and ahead (26 m off the side, 30 m ahead: in the follow camera's view), on the side nearest the camera's view with deep water, and swims
//              beside the boat at its speed (up to BEHAVE.alongside.maxMs: a faster boat leaves her behind), her neck up and
//              turned to the boat, for up to holdS; then she peels away and dives
//   under      she rises sideM off the boat's track ahead of it, swims across it; inside deepBandM of the track she goes under her
//              swimming depth by crossDy (the keel's 1.6 m, her girth and a margin: her body follows her nose's path below the
//              keel), up again past the band, and she dives outM off the other side. The crossing point is ahead by as far as the
//              boat sails while her middle reaches it, so the boat passes over her
//
//   const H = createBehave({ sim, depthAt })
//   H.start(kind, { boat: { x, z, heading, speed, vx?, vz? }, view: { x, z, yaw } }) → bool (false: no deep water for it here)
//   H.step(dt, { boat })   after sim.step;  H.active;  H.cancel();  H.state { kind, phase, t, lat, side, cross }
export const BEHAVE = Object.freeze({
  alongside: { latM: 26, aheadM: 30, holdS: 20, maxMs: 3.5, minMs: 0.4, peelM: 80, peelS: 3, lagM: 25 },
  under: { sideM: 45, swimMs: [3.2, 5.5], crossDy: -4.2, deepBandM: 14, outM: 40, upS: 6, aheadMax: 90 },
  depthMin: 10,   // m of water where she starts and along her way
});

import { wrap } from '../../src/sim/core/math.js';

export function createBehave({ sim, depthAt = () => 30, B = BEHAVE } = {}) {
  const st = { kind: null, phase: 'idle', t: 0, lat: null, side: 0, cross: null, alongS: 0, minLat: Infinity, maxDeep: 0 };
  let lastBoat = null;
  const go = (phase) => { st.phase = phase; st.t = 0; };
  const deepWay = (ax, az, bx, bz, n = 6) => { for (let k = 0; k <= n; k++) if (depthAt(ax + (bx - ax) * k / n, az + (bz - az) * k / n) < B.depthMin) return false; return true; };
  const velOf = (b) => (Number.isFinite(b.vx) && Number.isFinite(b.vz) ? [b.vx, b.vz] : [Math.sin(b.heading) * (b.speed ?? 0), -Math.cos(b.heading) * (b.speed ?? 0)]);
  const frame = (b) => ({ fx: Math.sin(b.heading), fz: -Math.cos(b.heading), rx: Math.cos(b.heading), rz: Math.sin(b.heading) });
  // the side (+1 starboard) whose spot is deep, with a deep way, nearest the middle of the camera's view
  function pickSide(b, view, spotOf) {
    let best = null;
    for (const s of [-1, 1]) {
      const p = spotOf(s);
      if (depthAt(p[0], p[1]) < B.depthMin || !deepWay(p[0], p[1], p[2] ?? p[0], p[3] ?? p[1])) continue;
      const off = view ? Math.abs(wrap(Math.atan2(p[0] - view.x, -(p[1] - view.z)) - view.yaw)) : 0;
      if (!best || off < best.off) best = { s, p, off };
    }
    return best;
  }
  const self = {
    B, state: st,
    get active() { return st.phase !== 'idle' && st.phase !== 'done'; },
    start(kind, { boat, view = null } = {}) {
      if (!boat || self.active || sim.state.visible) return false;
      const { fx, fz, rx, rz } = frame(boat), v = velOf(boat), vb = Math.hypot(v[0], v[1]);
      if (kind === 'alongside') {
        const A = B.alongside;
        const pick = pickSide(boat, view, (s) => { const x = boat.x + rx * s * A.latM + fx * A.aheadM, z = boat.z + rz * s * A.latM + fz * A.aheadM; return [x, z, x + fx * 60, z + fz * 60]; });
        if (!pick) return false;
        sim.ambush(pick.p[0], pick.p[1], boat.heading, Math.min(A.maxMs, Math.max(1, vb)));
        sim.hunt(false); sim.behave(true);
        st.side = pick.s;
      } else if (kind === 'under') {
        const U = B.under, L = sim.L;
        // her speed with the boat's (0.9 ×, 3.2–5.5 m/s: an animal's cruise to a sprint), the crossing as far ahead as the boat sails
        // while her middle reaches its line
        const sw = Math.max(U.swimMs[0], Math.min(U.swimMs[1], 0.9 * vb));
        const tMid = (U.sideM + L / 2) / sw, D = Math.min(U.aheadMax, vb * tMid);
        const cx = boat.x + fx * D, cz = boat.z + fz * D;
        const pick = pickSide(boat, view, (s) => [cx + rx * s * U.sideM, cz + rz * s * U.sideM, cx - rx * s * (U.outM + 10), cz - rz * s * (U.outM + 10)]);
        if (!pick) return false;
        const head = Math.atan2(cx - pick.p[0], -(cz - pick.p[1]));
        sim.ambush(pick.p[0], pick.p[1], head, sw);
        sim.hunt(false); sim.behave(true);
        sim.swimTo(cx - rx * pick.s * (U.outM + 30), cz - rz * pick.s * (U.outM + 30), sw);
        st.side = pick.s; st.cross = [+cx.toFixed(1), +cz.toFixed(1)];
      } else return false;
      st.kind = kind; st.alongS = 0; st.minLat = Infinity; st.maxDeep = 0; go('rise');
      lastBoat = { x: boat.x, z: boat.z };
      return true;
    },
    cancel() { if (!self.active) return false; sim.behave(false); sim.depth(0); if (sim.state.visible) { sim.swimTo(null); sim.play('dive', sim.state.t + 0.5); } go('done'); return true; },
    step(dt, { boat = null } = {}) {
      if (!self.active || !(dt > 0) || !boat) return st;
      st.t += dt;
      if (!sim.state.visible) { go('done'); return st; }
      const v = lastBoat ? [(boat.x - lastBoat.x) / dt, (boat.z - lastBoat.z) / dt] : velOf(boat);
      lastBoat = { x: boat.x, z: boat.z };
      const vb = Math.hypot(v[0], v[1]), { fx, fz, rx, rz } = frame(boat);
      const n = sim.state.nose;
      // her nose in the boat's frame: across (m to the side she started, +) and along (m ahead)
      const ax = n.x - boat.x, az = n.z - boat.z, lat = (ax * rx + az * rz) * st.side, along = ax * fx + az * fz;
      st.lat = +lat.toFixed(1);
      st.maxDeep = Math.min(st.maxDeep, sim.dy);
      if (st.kind === 'alongside') {
        const A = B.alongside;
        if (st.phase === 'rise' || st.phase === 'with') {
          // her station abeam and a little ahead; she aims 10 m past it (a course parallel to the boat's) at the boat's speed,
          // a little faster when the station is ahead of her
          const sx = boat.x + rx * st.side * A.latM + fx * A.aheadM, sz = boat.z + rz * st.side * A.latM + fz * A.aheadM;
          const err = (sx - n.x) * fx + (sz - n.z) * fz;
          sim.swimTo(sx + fx * 10, sz + fz * 10, Math.max(A.minMs, Math.min(A.maxMs, vb + 0.25 * err)));
          if (st.phase === 'rise' && st.t > 4) { go('with'); sim.play('arc', sim.state.t + 1); }
          if (st.phase === 'with') {
            st.alongS += dt; st.minLat = Math.min(st.minLat, lat);
            if (st.t >= A.holdS || err > A.lagM) {
              go('peel');
              sim.swimTo(boat.x + rx * st.side * A.peelM + fx * 30, boat.z + rz * st.side * A.peelM + fz * 30, 3.0);
              sim.play('dive', sim.state.t + A.peelS);
            }
          }
        }
      } else if (st.kind === 'under') {
        const U = B.under;
        // the band round the boat's track (its line now, ahead and astern): deep inside it, up outside it
        const across = (ax * rx + az * rz) * st.side;   // + on her starting side
        if (st.phase === 'rise' && Math.abs(across) < U.deepBandM) { go('cross'); sim.depth(U.crossDy); }
        else if (st.phase === 'cross' && across < -U.deepBandM) { go('out'); sim.depth(0); }
        else if (st.phase === 'out' && across < -U.outM) { go('away'); sim.play('dive', sim.state.t + U.upS); }
        st.minLat = Math.min(st.minLat, Math.abs(across));
      }
      return st;
    },
  };
  return self;
}
