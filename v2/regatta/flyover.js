// Regatta's fly-over (owner 2026-11-16, the guidance pass): before the start a ~4 s camera dolly up the course, the beacon's pillar
// lighting each mark in turn, so a first-time player sees where the race goes before the gun. Any input skips it; it plays on the
// first race of a course in a page's session (afterwards only from the course card's Show course); reduce motion (the OS's
// setting) never plays it; an automated browser only with ?flyover=1. The race waits at −0:45 while it plays (index.js).
// Pure: v2/tests/regatta-guidance.test.mjs.
//   flyoverWanted({ flags, live, webdriver, reduced, seen, key }) → bool
//   const F = createFlyover({ course, durS });  F.update(dt, base) → the camera { pos, target, fov } (base eased in and out), F.mark →
//   the index into F.stops of the mark lit now (null: none yet), F.stops [{ at: [x, z], id }], F.done, F.skip()
import { easeK } from '../sim/ease.js';   // step D3: rates per second, compounded for the frame

export const FLY = Object.freeze({ durS: 4, inS: 0.6, outS: 0.7, minAlt: 45, maxAlt: 170, altK: 0.12, backK: 1.1, aheadM: 140, fov: 55 });

export function flyoverWanted({ flags = {}, live = true, webdriver = false, reduced = false, seen = null, key = '' } = {}) {
  const f = flags.flyover;
  if (f === '0' || f === false || f === 0) return false;
  if (seen?.has?.(key)) return false;
  if (f === '1' || f === true || f === 1) return true;
  return !!live && !webdriver && !reduced;
}

const smooth = (t) => { const k = t < 0 ? 0 : t > 1 ? 1 : t; return k * k * (3 - 2 * k); };
const mix3 = (a, b, e) => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];

export function createFlyover({ course, durS = FLY.durS } = {}) {
  // the stops: the start line's middle, then one lap's marks in order (each once), then the finish (the line again)
  const L = course.line, seen = new Set(), stops = [{ at: L.centre, id: 'start' }];
  for (const g of course.legs) { if (g.toId === 'finish') break; if (seen.has(g.toId)) break; seen.add(g.toId); stops.push({ at: g.to, id: g.toId }); }
  const path = [...stops.map((s) => s.at), L.centre], cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = Math.max(1, cum.at(-1)), alt = Math.max(FLY.minAlt, Math.min(FLY.maxAlt, total * FLY.altK)), back = alt * FLY.backK;
  const at = (s) => {
    s = Math.max(0, Math.min(total, s));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = path[i - 1], b = path[i], k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], i, d: [(b[0] - a[0]) / Math.max(1e-6, cum[i] - cum[i - 1]), (b[1] - a[1]) / Math.max(1e-6, cum[i] - cum[i - 1])] };
  };
  let t = 0, done = false, mark = null, dir = null;
  const api = {
    stops, total, alt,
    get t() { return t; }, get done() { return done; }, get mark() { return mark; },
    skip() { done = true; mark = null; },
    // the camera this frame: the travel along the course over the middle of the time, eased from the race camera (base) and back to it
    update(dt, base) {
      if (done) return base;
      t += Math.max(0, dt);
      if (t >= durS) { done = true; mark = null; return base; }
      const u = smooth((t - FLY.inS * 0.4) / Math.max(0.1, durS - FLY.inS * 0.4 - FLY.outS)), s = u * total, here = at(s), ahead = at(s + FLY.aheadM);
      // the mark lit: the one the camera travels toward (the last leg back to the line lights nothing)
      mark = here.i < stops.length ? here.i : null;
      const d = here.d; dir = dir ? [dir[0] + (d[0] - dir[0]) * easeK(3, dt), dir[1] + (d[1] - dir[1]) * easeK(3, dt)] : d.slice();
      const dl = Math.hypot(dir[0], dir[1]) || 1, fx = dir[0] / dl, fz = dir[1] / dl;
      const pos = [here.p[0] - fx * back, alt, here.p[1] - fz * back], target = [ahead.p[0], 0, ahead.p[1]];
      const e = Math.min(smooth(t / FLY.inS), smooth((durS - t) / FLY.outS));
      return { ...base, pos: mix3(base.pos, pos, e), target: mix3(base.target, target, e), fov: base.fov + (FLY.fov - base.fov) * e };
    },
  };
  return api;
}
