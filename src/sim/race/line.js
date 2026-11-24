// The start / finish line: a segment between the committee boat and the pin, square to the wind. Plain JS.
// Frames: x east, z south, metres; bearings clockwise from north. `up` is the unit vector toward the wind's origin: the
// course side of the line (side > 0) is upwind of it; the pre-start side (side < 0) is downwind.
const DEG = Math.PI / 180;

export function makeLine({ committee, pin }, windFromDeg = 210) {
  const dx = committee[0] - pin[0], dz = committee[1] - pin[1], len = Math.hypot(dx, dz) || 1;
  const f = windFromDeg * DEG;
  return { committee: [...committee], pin: [...pin], centre: [(committee[0] + pin[0]) / 2, (committee[1] + pin[1]) / 2], len,
    dir: [dx / len, dz / len], up: [Math.sin(f), -Math.cos(f)] };
}
// metres from the line toward the course side (> 0: over the line)
export const side = (L, x, z) => (x - L.centre[0]) * L.up[0] + (z - L.centre[1]) * L.up[1];
// position along the line, 0 at the pin and 1 at the committee boat
export const along = (L, x, z) => ((x - L.pin[0]) * L.dir[0] + (z - L.pin[1]) * L.dir[1]) / L.len;
// a boat's bow over the line before the gun
export const isOver = (L, x, z) => side(L, x, z) > 0;
// the segment p0 → p1 crosses the line (between its ends, with a margin): { dir: 'up' | 'down', f (0..1 of the step), at } or null
export function crossing(L, p0, p1, margin = 0.04) {
  const s0 = side(L, p0[0], p0[1]), s1 = side(L, p1[0], p1[1]);
  if (s0 === s1 || (s0 > 0) === (s1 > 0)) return null;
  const f = s0 / (s0 - s1), x = p0[0] + (p1[0] - p0[0]) * f, z = p0[1] + (p1[1] - p0[1]) * f, a = along(L, x, z);
  if (a < -margin || a > 1 + margin) return null;
  return { dir: s1 > 0 ? 'up' : 'down', f, at: a };
}
// the line's bias for a wind from `windFromRad`: how far (m) the favoured end is upwind of the other, and which it is
export function bias(L, windFromRad) {
  const u = [Math.sin(windFromRad), -Math.cos(windFromRad)];
  const c = (L.committee[0] - L.pin[0]) * u[0] + (L.committee[1] - L.pin[1]) * u[1];
  return { m: Math.abs(c), deg: Math.asin(Math.max(-1, Math.min(1, c / L.len))) / DEG, favoured: c > 0.5 ? 'committee' : c < -0.5 ? 'pin' : 'committee' };
}
// seconds for a boat at (x, z) heading h (rad) at speed u (m/s) to reach the line (Infinity if it points away or stands still)
export function timeToLine(L, x, z, h, u) {
  const v = u * (Math.sin(h) * L.up[0] - Math.cos(h) * L.up[1]), d = -side(L, x, z);
  return v > 1e-6 && d > 0 ? d / v : d <= 0 ? 0 : Infinity;
}
