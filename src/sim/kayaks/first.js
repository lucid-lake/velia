// The first pair (owner 2026-11-09, late: "My main purpose is to be able to notice them during game load… I am OK
// with the kayak doing the old way before tonight's change, but it just needs to be close and noticeable; it does not need
// to compete with the sailboat"). Only WHERE the pair is when play starts is new: two kayakers placed in the follow camera's
// view, ahead of the boat and to port (the desktop's key hints stand on the right), about 26 m off her, paddling side-on
// away from her line. From then on they are ordinary kayakers: the fleet's own minds (mind.js), each on its own short route
// of good water, at their own pace. Nothing times them to the boat, keeps up with her or steers them to meet her (round A's
// timed crossing and meetSteer are gone). The skipper names them once ("Kayakers off the bow.", the subtitle line). Plain
// JS, no three.js; deterministic (the seed, the pose and the view).
//
//   placePair({ seed, terrain, pose, view })  → { slots, side, R, course } | null   pose: { x, z, heading (rad) }
//        view: { x, z, yaw (rad), hHalf (rad, the camera's horizontal half-angle) }: the camera at the moment of laying;
//        null: the follow camera's default pose behind the boat at 16:9 (defaultView)
//   createSpotLine({ show, free })            → the line once: line.tick(t, { seen }) each frame → true once said
import { hash01 } from './plan.js';
import { polyline, minDepthAt } from './routes.js';

const DEG = Math.PI / 180;

export const FIRST = Object.freeze({
  R: [26, 30, 22, 34, 38],   // m: the lead's distance off the boat, tried in order (the owner's 20–40 m)
  k: 0.6,             // the lead's bearing from the camera: this share of its half-angle, to the side (in view, clear of the edge) …
  kNarrow: 0.12,      // … on an upright phone (a half-angle under 15°): near the axis, as the boat closing on them carries them out …
  courseNarrow: [40, 30, 55],   // … and a course more ahead than across, so they cross the narrow view slowly
  bearMax: 9,         // … at most this many degrees: the boat then goes by 9–15 m off, where the notice shot frames the paddler
                      // whole (passes at 20–25 m put the kayak in the frame's corner, under the cockpit and the key hints)
  side: -1,           // port first (the key hints stand on the right of the desktop view); starboard if port has no water
  course: [65, 45, 85],   // ° off the boat's heading, out toward the side: side-on to the camera, paddling away from her line
  abreast: 2,         // m: the second paddler beside the lead, on the side away from the boat …
  back: -5,           // … and this far behind (−: ahead, further out from her line; a pair 5.4 m apart, outside mind.js's pair push of 6 m but for a nudge)
  before: 20,         // m of route behind each paddler
  after: 160, minAfter: 60,   // m of route ahead (cut short by the shore or the shallows, at least minAfter)
  loop: 12,           // m: the return leg beside the outward one (the routes are loops)
  margin: 15,         // m off the shore (the routes' own rule; the legs at 0.8 of it)
  ahead: 6,           // m: the lead at least this far ahead of the boat's beam
  persona: 'experienced',   // a calm, early-acting paddler (the fleet's own personality)
  closeR: 6,          // m: their close call ("Too close", the back-off) only nearer than this (others: 15 m): laid near her, they expect her
  line: 'Kayakers off the bow.',
  lineAfter: 1.5,     // s after the pair is laid: the line waits for the card to go
  lineFor: 25,        // s: a line that found no moment by then is dropped, never said late
  seeM: 175,          // m: the pair this near the boat and in the camera's view counts as seen
});

// the follow camera's default pose (src/boat/followCamera.js: 3.5 hull lengths ≈ 32 m back, 40° vertical lens) at 16:9
export function defaultView(pose, aspect = 16 / 9) {
  const back = 32;
  return { x: pose.x - Math.sin(pose.heading) * back, z: pose.z + Math.cos(pose.heading) * back, yaw: pose.heading, hHalf: Math.atan(Math.tan(20 * DEG) * aspect) };
}

function waterOk(terrain, x, z, margin) {
  const d = -terrain.heightAt(x, z);
  return d >= minDepthAt(terrain, x, z) && -terrain.shoreDistance(x, z) >= margin;
}
// how far good water runs from (x, z) along (ux, uz), up to max m (2 m steps)
function run(terrain, x, z, ux, uz, max, margin) {
  let d = 0;
  for (; d <= max; d += 2) if (!waterOk(terrain, x + ux * d, z + uz * d, margin)) return Math.max(0, d - 2);
  return max;
}
// a paddler's route: out along (kx, kz) from F.before behind (x, z), back on a leg F.loop m to the side (nx, nz); null
// when the water does not hold it
function routeFrom(terrain, x, z, kx, kz, nx, nz, id, F) {
  if (!waterOk(terrain, x, z, F.margin)) return null;
  const before = run(terrain, x, z, -kx, -kz, F.before, F.margin * 0.8), after = run(terrain, x, z, kx, kz, F.after, F.margin);
  if (before < 6 || after < F.minAfter) return null;
  const A = [x - kx * before, z - kz * before], B = [x + kx * after, z + kz * after];
  const A2 = [A[0] + nx * F.loop, A[1] + nz * F.loop], B2 = [B[0] + nx * F.loop, B[1] + nz * F.loop];
  const pts = [], seg = (p, q) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4)); for (let i = 0; i < n; i++) pts.push([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]); };
  seg(A, B); seg(B, B2); seg(B2, A2); seg(A2, A);
  if (!pts.every(([px, pz]) => waterOk(terrain, px, pz, F.margin * 0.8))) return null;
  return { route: { id, kind: 'first', path: polyline(pts, true), rests: [], station: null, ends: [A, B] }, s0: before };
}

const COLOURS = ['yellow', 'red', 'orange'];
const PFDS = ['red', 'orange', 'yellow', 'blue'];
// the pair: the lead on the camera's ray at k of its half-angle to the side, R m off the boat and ahead of her beam; the
// second abreast of it; both heading out from her line, each on its own route; their colours, figures and jackets by seed
export function placePair({ seed = 1, terrain, pose, view = null, F = FIRST } = {}) {
  if (!pose || !Number.isFinite(pose.x) || !terrain) return null;
  const V = view && Number.isFinite(view.x) && Math.hypot(view.x - pose.x, view.z - pose.z) < 120 ? view : defaultView(pose);
  const fx = Math.sin(pose.heading), fz = -Math.cos(pose.heading);
  const narrow = V.hHalf < 15 * DEG;
  for (const side of [F.side, -F.side]) for (const R of F.R) for (const cDeg of narrow ? [...F.courseNarrow, ...F.course] : F.course) {
    // the camera's ray, and the point on it R m from the boat beyond her
    const b = V.yaw + side * Math.min((narrow ? F.kNarrow : F.k) * V.hHalf, F.bearMax * DEG), ux = Math.sin(b), uz = -Math.cos(b);
    const cx = pose.x - V.x, cz = pose.z - V.z, along = cx * ux + cz * uz, perp = cx * uz - cz * ux;
    if (R * R <= perp * perp) continue;
    const t = along + Math.sqrt(R * R - perp * perp), x = V.x + ux * t, z = V.z + uz * t;
    if ((x - pose.x) * fx + (z - pose.z) * fz < F.ahead) continue;
    // the course: out from her line toward the side; the second beside the lead on the side away from her
    const h = pose.heading + side * cDeg * DEG, kx = Math.sin(h), kz = -Math.cos(h);
    let nx = -kz, nz = kx; if (nx * (x - pose.x) + nz * (z - pose.z) < 0) { nx = -nx; nz = -nz; }
    const x2 = x + nx * F.abreast - kx * F.back, z2 = z + nz * F.abreast - kz * F.back;
    const r0 = routeFrom(terrain, x, z, kx, kz, nx, nz, 'first-0', F), r1 = r0 && routeFrom(terrain, x2, z2, kx, kz, nx, nz, 'first-1', F);
    if (!r0 || !r1) continue;
    const looks = pairLooks(seed);
    const slots = [r0, r1].map((r, i) => ({
      ...looks[i], slot: 50 + i, route: r.route, kind: 'first', group: 'first', s0: r.s0, restLeft: 0,
      personality: F.persona, mind: { closeR: F.closeR }, meet: null, place: { x: i ? x2 : x, z: i ? z2 : z, heading: h },
    }));
    return { slots, side, R, course: cDeg };
  }
  return null;
}

// the pair's looks before it is placed (the full models are built during the home card, before the place is known): the
// same ids, colours, figures and jackets placePair gives
export function pairLooks(seed = 1) {
  const u = (i, f) => hash01(seed, 300 + i, f), c0 = Math.floor(u(0, 1) * 3) % 3, man = u(0, 2) < 0.5;
  return [0, 1].map((i) => ({ id: `kayak-first-${i}`, colour: COLOURS[(c0 + i) % 3], sex: (i === 0) === man ? 'male' : 'female', pfd: PFDS[Math.floor(u(i, 3) * 4) % 4], seed: 1 + Math.floor(u(i, 4) * 9973), wear: 0.2 + 0.4 * u(i, 5) }));
}

// The skipper's line, once (the subtitle line; never a pop-up): when the pair is seen (near and in the camera's view), not
// before lineAfter s from the pair's laying (the card's dissolve), and only when the line is free (no note, status or keep
// line up: free()); a line that found no moment in lineFor s is dropped.
export function createSpotLine({ show, free = () => true, F = FIRST } = {}) {
  let t0 = null, said = false, dropped = false, at = null;
  return {
    tick(t, { seen = false } = {}) {
      if (said || dropped) return false;
      t0 ??= t;
      if (t - t0 > F.lineFor) { dropped = true; return false; }
      if (t - t0 < F.lineAfter || !seen || !free()) return false;
      if (show(F.line) === false) return false;
      said = true; at = t;
      return true;
    },
    get said() { return said; }, get at() { return at; }, get dropped() { return dropped; },
  };
}
