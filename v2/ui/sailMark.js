// Sail's own mark by a double-tap on the water (owner, 2026-11-15: "in sail mode double click the water will also set a target like
// the cruise mode, difference is the boat will not automatically sail to it";'s mark). The gesture is Cruise's
// (src/modes/chill/markTap.js DoubleTap: two taps within 350 ms and 24 px, no drag between); the mark only lights the beacon
// (render/waymark.js): no autopilot, the helm and the sheets stay the player's. A double-tap near the mark clears it; a new one moves
// it; the beacon's arrival clears it (main.js). Off with the beacon (?beacon=0).
// It keeps clear of Sail's other gestures: a drag (the look) or a second finger (the camera's pinch) cancels the pair; a tap on an
// upright phone's lower band (the helm strip and the one-thumb steer zone) never counts; a mouse counts only its main button; the
// listener is on the canvas only (the bar, the cockpit's DOM and the chart take their own taps).
//   const M = createSailMark({ waterAt, depthAt, boat, active, say, now });
//   M.down(e) / M.move(e) / M.up(e)   the canvas's pointer events ({ pointerId, pointerType, clientX, clientY, button, timeStamp })
//   M.mark → { x, z } | null;  M.set(x, z) / M.clear();  M.place({ x, z }) → the same checks for a world point (the chart's tap past
//   the planner's chart); M.attach(canvas) → off()
// Near the boat (fix 2026-11-15, owner: "double-tap on the water does not place the beacon"): in the chase view most of the water
// on screen lies within 40 m of the boat (an upright phone: everything under 37 % of the height), so a double-tap there did
// nothing, and one at 40–50 m lit the beacon inside its 50 m arrival radius, which put it out at once. A tap nearer than nearM now
// sets the mark nearM out on the same bearing (cheat on where: the light goes where the player pointed, far enough to sail to).
import { DoubleTap } from '../../src/modes/chill/markTap.js';

export const SAIL_MARK = Object.freeze({
  movePx: 6,        // px: a press that travels further is a drag (the look), never a tap
  onBoatM: 8,       // m: a tap this close to the boat is on the boat (no bearing): no mark
  nearM: 150,       // m: a tap nearer than this sets the mark this far out on its bearing (3 × the beacon's 50 m arrival radius)
  maxM: 9000,       // m: further than this is the far shore's haze, not a mark
  minDepthM: 2,     // m: the water must be at least this deep (dry land and the shallows get a line)
  clearM: 90,       // m: a double-tap this close to the mark clears it (Cruise's 90 m)
  lowBand: 0.36,    // an upright phone's lower share of the screen: the helm strip and the steer zone (never a mark)
});

// What the mark says (owner 2026-11-20: the boat does not sail there by itself, so the line says what comes next and NAV
// pulses once, calm): "Mark set. Click NAV to sail there." ("Tap" on a touch screen); the mark moved says the same; NAV already on
// follows the new mark by itself
export function markLine(was = false, { on = false, touch = false } = {}) {   // on: NAV is on now
  const head = was ? 'Mark moved.' : 'Mark set.';
  return on ? `${head} NAV is sailing there.` : `${head} ${touch ? 'Tap' : 'Click'} NAV to sail there.`;
}

// nav(): { on, touch } the pilot's state and the hand now (markLine); onSet(navOn): a mark was set or moved (the page pulses NAV once when it is off)
export function createSailMark({ waterAt, depthAt, boat = () => null, active = () => true, say = () => {}, viewport = () => ({ w: globalThis.innerWidth ?? 1280, h: globalThis.innerHeight ?? 720 }), nav = () => ({}), onSet = () => {}, opts = {} } = {}) {
  const K = { ...SAIL_MARK, ...opts };
  const dbl = new DoubleTap();
  const presses = new Map();
  let mark = null, sets = 0;
  const api = {
    get mark() { return mark; }, get sets() { return sets; },
    set(x, z) { mark = { x, z }; sets++; return mark; },
    clear() { const had = !!mark; mark = null; return had; },
    down(e) {
      if (!active()) return;
      presses.set(e.pointerId, { x0: e.clientX, y0: e.clientY, moved: false, type: e.pointerType ?? 'mouse', button: e.button ?? 0 });
      if (presses.size > 1) { for (const p of presses.values()) p.moved = true; dbl.reset(); }   // a second finger: the camera's pinch
    },
    move(e) { const p = presses.get(e.pointerId); if (p && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > K.movePx) p.moved = true; },
    // → 'set' | 'moved' | 'cleared' | 'refused' | null
    up(e) {
      const p = presses.get(e.pointerId); presses.delete(e.pointerId);
      if (!p || !active()) return null;
      if (p.moved) { dbl.reset(); return null; }
      if (p.type === 'mouse' && p.button !== 0) return null;
      const vp = viewport();
      if (p.type === 'touch' && vp.h > vp.w && e.clientY > vp.h * (1 - K.lowBand)) { dbl.reset(); return null; }   // the helm's band
      if (!dbl.tap({ x: e.clientX, y: e.clientY, t: e.timeStamp ?? 0 })) return null;
      return api.at(e.clientX, e.clientY);
    },
    // the double-tap's spot: the water under it, checked
    at(cx, cy) {
      const pt = waterAt(cx, cy);
      if (!pt) return null;   // the sky
      return api.place(pt);
    },
    // a world point (the double-tap's water, or the chart's tap past the planner's chart), checked → as up()
    place(pt0, { line = null } = {}) {
      const b = boat();
      const pt = b ? pushOutOk(b, pt0, (q) => depthAt(q.x, q.z) >= K.minDepthM, K.nearM) : pt0;
      const on = (q) => !!q && Math.hypot(q.x - mark.x, q.z - mark.z) < K.clearM;
      if (mark && (on(pt0) || on(pt))) { mark = null; say('Mark cleared.'); return 'cleared'; }   // the spot tapped, or where it put the mark
      if (!pt) return null;   // on the boat
      const d = b ? Math.hypot(pt.x - b.x, pt.z - b.z) : Infinity;
      if (d > K.maxM) { say('Too far to mark. Pick a spot nearer.', 'refuse.mark'); return 'refused'; }
      if (!(depthAt(pt.x, pt.z) >= K.minDepthM)) { say('Too shallow there. Mark open water.', 'refuse.mark'); return 'refused'; }
      const was = !!mark;
      api.set(pt.x, pt.z);
      const n = nav() ?? {};
      say(line ?? markLine(was, n), 'mark.set');   // 'mark.set': the lean skipper's MUST (it answers the player's own act; leanSkipper.js)
      onSet(!!n.on);
      return was ? 'moved' : 'set';
    },
    attach(canvas) {
      const ac = new AbortController(), o = { signal: ac.signal };
      canvas.addEventListener('pointerdown', (e) => api.down(e), o);
      canvas.addEventListener('pointermove', (e) => api.move(e), o);
      canvas.addEventListener('pointerup', (e) => api.up(e), o);
      canvas.addEventListener('pointercancel', (e) => { presses.delete(e.pointerId); dbl.reset(); }, o);
      return () => ac.abort();
    },
  };
  return api;
}

// a mark point nearer the boat than nearM, moved out to nearM on the same bearing from the boat; null within onBoatM (no bearing)
export function pushOut(boat, pt, nearM = SAIL_MARK.nearM, onBoatM = SAIL_MARK.onBoatM) {
  const dx = pt.x - boat.x, dz = pt.z - boat.z, d = Math.hypot(dx, dz);
  if (d < onBoatM) return null;
  if (d >= nearM) return { x: pt.x, z: pt.z };
  return { x: boat.x + dx / d * nearM, z: boat.z + dz / d * nearM };
}

// pushOut, stepping in (nearM, then 120 m, then 100 m: all outside both arrival radii) while ok(pt) refuses the spot (the shore
// close on that bearing); the first ok spot, else the nearM one (its owner says why it is refused). null on the boat
export function pushOutOk(boat, pt, ok = () => true, nearM = SAIL_MARK.nearM) {
  const first = pushOut(boat, pt, nearM);
  if (!first || ok(first)) return first;
  for (const r of [120, 100]) { if (r >= nearM) continue; const q = pushOut(boat, pt, r); if (q && ok(q)) return q; }
  return first;
}

// the water (y = 0) under a screen point through the inverse view-projection (reversed depth: ndc z 1 is the near plane), or null
// for the sky. invVP: column-major 4×4; rect: the canvas's client rect
export function waterUnder(invVP, rect, cx, cy, waterY = 0) {
  const nx = (cx - rect.left) / rect.width * 2 - 1, ny = 1 - (cy - rect.top) / rect.height * 2;
  const un = (z) => { const m = invVP, x = m[0] * nx + m[4] * ny + m[8] * z + m[12], y = m[1] * nx + m[5] * ny + m[9] * z + m[13], zz = m[2] * nx + m[6] * ny + m[10] * z + m[14], w = m[3] * nx + m[7] * ny + m[11] * z + m[15]; return [x / w, y / w, zz / w]; };
  const a = un(1), b = un(0.5), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  if (!(d[1] < -1e-9)) return null;
  const s = (waterY - a[1]) / d[1];
  if (!(s > 0)) return null;
  return { x: a[0] + d[0] * s, z: a[2] + d[2] * s };
}
