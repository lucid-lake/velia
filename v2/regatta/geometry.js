// The race drawn on the water, as numbers: the laylines to the windward mark, the ghost's spot, the line's
// readouts (time and distance to the line, time to burn), the mark's zone. Pure: no DOM, no GPU (v2/tests/regatta.test.mjs).
// Frames as src/sim/race/line.js: x east, z south, metres; headings clockwise from north (dir(h) = [sin h, −cos h]).
//   tackAngle(twsMs, polar?)              → rad: the boat's course over the ground off the wind, close-hauled (the polar's best-VMG
//                                           angle + its leeway, measured on the real BoatPhysics: LEEWAY_DEG)
//   laylines(mark, windFromRad, alpha, L)  → { port: [a, b], stbd: [a, b] }: the lines a boat close-hauled on that tack fetches the
//                                           mark along (red: port tack, green: starboard; owner 2026-11-14), each L m long from it
//   ghostSpot(line, windFromRad, back)     → [x, z]: one boat length below the favoured end's quarter (the start helper's aim)
//   lineReadout(line, pose, clock, vUp)    → { distM, timeS, burnS }: the metres to the line, the seconds at this speed, the time to burn
//   ring(c, r, n) → [[x, z] ...] the zone (closed polyline)
import { polarTargets } from '../../src/sim/ai/skipper.js';
import { BOAT_LENGTH_M } from '../../src/sim/race/course.js';
import { side, timeToLine } from '../../src/sim/race/line.js';

const DEG = Math.PI / 180;
export const LEEWAY_DEG = 3;   // the sloop's leeway close-hauled: the course over the ground 2.9–3.1° below the heading at 3, 5 and 7 m/s (renders/regatta-r1r2: a pro AISkipper, 60 s on a board)
export const ZONE_M = Math.round(3 * BOAT_LENGTH_M);   // 26 m: three lengths (rule 18's zone)
export const dirOf = (h) => [Math.sin(h), -Math.cos(h)];

export function tackAngle(twsMs, polar) { return (polarTargets(Math.max(1, twsMs || 0), polar).up.twa + LEEWAY_DEG) * DEG; }

// the starboard-tack boat (wind over the starboard side) sails at windFrom − alpha; it fetches the mark from below along that
// heading, so its layline runs from the mark back down the reverse heading; the port tack's at windFrom + alpha
export function laylines(mark, windFromRad, alpha, len = 300) {
  const ds = dirOf(windFromRad - alpha), dp = dirOf(windFromRad + alpha), m = [mark[0], mark[1]];
  return { stbd: [m, [m[0] - ds[0] * len, m[1] - ds[1] * len]], port: [m, [m[0] - dp[0] * len, m[1] - dp[1] * len]] };
}

// the startPlan's aim (src/sim/ai/skipper.js startPlan): a quarter of the line in from the favoured end (the committee end on a
// tie), here one length below the line: "be here at 0:00"
export function ghostSpot(line, windFromRad, back = BOAT_LENGTH_M) {
  const up = [Math.sin(windFromRad), -Math.cos(windFromRad)];
  const bias = (line.committee[0] - line.pin[0]) * up[0] + (line.committee[1] - line.pin[1]) * up[1];
  const a = bias >= -0.5 ? 0.78 : 0.22;
  const T = [line.pin[0] + (line.committee[0] - line.pin[0]) * a, line.pin[1] + (line.committee[1] - line.pin[1]) * a];
  return [T[0] - line.up[0] * back, T[1] - line.up[1] * back];
}

// distM: metres below the line (negative: over it); timeS: at this heading and speed (null when pointing away); burnS: the
// seconds to spare before the gun if she sailed for the line now at vUp (m/s toward it, close-hauled), negative when late
export function lineReadout(line, pose, clock, vUp) {
  const distM = -side(line, pose.x, pose.z);
  const t = timeToLine(line, pose.x, pose.z, pose.heading, pose.u ?? 0);
  const need = distM > 0 ? distM / Math.max(0.5, vUp) : 0;
  return { distM, timeS: Number.isFinite(t) ? t : null, burnS: clock < 0 ? -clock - need : null };
}

export function ring(c, r, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  return out;
}

// the course laid to today's wind (a race committee's job): the design course (v1's JSON, square to its designWindFrom) turned
// about the line's centre by the wind's difference, so the line stays square and the first leg a beat. Then v1's snap
// (src/sim/race/course.js snapCourse) moves any mark the turn put in shoal water. → a laid course (loadCourse's shape)
// laps: the race's laps (the course's own by default); the race's time limit grows with the laid course (TIME_LIMIT: a slow boat's
// average along the course's legs, so a long course or a light day is never cut short by the 15 minutes of the Island Sprint's JSON)
export const TIME_LIMIT = Object.freeze({ msAlong: 0.6, minS: 900 });
export const timeLimitFor = (totalM, own = TIME_LIMIT.minS) => Math.max(own, TIME_LIMIT.minS, Math.ceil(totalM / TIME_LIMIT.msAlong));
export function courseToWind(course, windFromDeg, { loadCourse, snapCourse, depthAt = null, shoreDist = null, offset = null, scale = 1, laps = course.laps } = {}) {
  const d = (((windFromDeg - course.designWindFrom) % 360) + 540) % 360 - 180, a = d * DEG, c = course.lineSpec, o = [(c.committee[0] + c.pin[0]) / 2, (c.committee[1] + c.pin[1]) / 2];
  const ox = offset?.[0] ?? 0, oz = offset?.[1] ?? 0;
  // a heading turns clockwise by +a; in x east / z south that is the screen rotation (x, z) → (x cos a − z sin a, x sin a + z cos a);
  // then the committee's move to fair wind (offset, layFairCourse) and the short course's scale (marks only: the line keeps its length)
  const turn = (p, k = scale) => { const x = (p[0] - o[0]) * k, z = (p[1] - o[1]) * k; return [o[0] + ox + x * Math.cos(a) - z * Math.sin(a), o[1] + oz + x * Math.sin(a) + z * Math.cos(a)]; };
  const j = { id: course.id, waters: course.waters, name: course.name, blurb: course.blurb, designWindFrom: windFromDeg, laps, timeLimitS: course.timeLimitS, scales: course.scales,
    line: { committee: turn(c.committee, 1), pin: turn(c.pin, 1) }, marks: course.marks.map((m) => ({ id: m.id, kind: m.kind, colour: m.colour, rounding: m.rounding, at: turn(m.at) })),
    legs: (course.lapLegs ?? course.legSpec).map((l) => ({ to: l.to })) };
  const laid = loadCourse(j);
  laid.timeLimitS = timeLimitFor(laid.totalM, course.timeLimitS);
  return depthAt ? snapCourse(laid, { depthAt, shoreDist: shoreDist ?? (() => 1e9) }) : laid;
}

// The fair course (R3, 2026-11-14): a race committee lays its course in clean wind. Turned to today's wind, v1's Island Sprint
// can put its windward mark in Emerald Bay's lee (a SSW wind: 17 kn at the line, 8 kn at W, measured on the real terrain; one
// run read 22 kn at the start and 7 kn by 2:30). layFairCourse moves the whole course, nearest first, until every point a boat
// sails through sees at least FAIR.minRatio of the course's best terrain factor (and of the open bay's, when `ref` is given),
// in water at least FAIR.depthM deep with the marks' zones clear of the shore. The wind keeps its shifts and gusts (the owner:
// weather stays); only the place moves. factorAt(x, z) → the wind field's terrain factor for today's wind (0–1+).
// behindM, waterM: the race camera's water before the gun (it stands up to ~100 m below the line, behind the boat in the box): the
// line's breadth (and half its length beyond each end) that far below stays water at least waterM deep: the camera never stands in
// the shore's trees, the box never in the shallows
export const FAIR = Object.freeze({ minRatio: 0.88, refRatio: 0.85, stepM: 100, maxM: 2600, depthM: 5, zoneDepthM: 3, everyM: 60, behindM: 140, waterM: 4 });

// the points a race sails through, from a laid course's spec (before loadCourse): the line's ends and middle, the box below it, each
// mark, every `every` m along each leg (the line's middle → the marks in order → the finish at the line's middle)
export function racePoints(line, marks, legsTo, up, every = FAIR.everyM) {
  const c = [(line.committee[0] + line.pin[0]) / 2, (line.committee[1] + line.pin[1]) / 2];
  const pts = [line.committee, line.pin, c, [c[0] - up[0] * 60, c[1] - up[1] * 60]];
  const at = (id) => (id === 'finish' ? c : marks.find((m) => m.id === id).at);
  let from = c;
  for (const id of legsTo) { const to = at(id), L = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(1, Math.ceil(L / every)); for (let i = 1; i <= n; i++) pts.push([from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]); from = to; }
  return pts;
}

export function layFairCourse(course, windFromDeg, { loadCourse, snapCourse, depthAt, factorAt, ref = null, scale = 1, laps = course.laps, F = FAIR } = {}) {
  const base = courseToWind(course, windFromDeg, { loadCourse, scale, laps });   // turned, not moved, not snapped
  const up = base.line.up, legsTo = base.legSpec.map((l) => l.to);
  const L0 = { committee: base.line.committee, pin: base.line.pin }, M0 = base.marks.map((m) => ({ id: m.id, at: m.at }));
  const pts0 = racePoints(L0, M0, legsTo, up, F.everyM);
  const along = (a) => [L0.pin[0] + (L0.committee[0] - L0.pin[0]) * a, L0.pin[1] + (L0.committee[1] - L0.pin[1]) * a];
  const behind = [-0.75, -0.25, 0.25, 0.75, 1.25, 1.75].map(along).flatMap((p) => [0.5, 1].map((k) => [p[0] - up[0] * F.behindM * k, p[1] - up[1] * F.behindM * k]));
  const ring = [];
  for (let i = 0; i < 8; i++) ring.push([Math.cos(i * Math.PI / 4) * ZONE_M, Math.sin(i * Math.PI / 4) * ZONE_M]);
  // the candidates, nearest first (a ring at a time, 100 m apart)
  const cand = [[0, 0]];
  for (let r = F.stepM; r <= F.maxM; r += F.stepM) { const n = Math.max(8, Math.round(2 * Math.PI * r / F.stepM)); for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; cand.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); } }
  const score = (dx, dz) => {
    for (const p of pts0) if (depthAt(p[0] + dx, p[1] + dz) < F.depthM) return null;
    for (const m of M0) for (const q of ring) if (depthAt(m.at[0] + dx + q[0], m.at[1] + dz + q[1]) < F.zoneDepthM) return null;
    for (const q of behind) if (depthAt(q[0] + dx, q[1] + dz) < F.waterM) return null;
    let mn = Infinity, mx = 0, sum = 0;
    for (const p of pts0) { const f = factorAt(p[0] + dx, p[1] + dz); mn = Math.min(mn, f); mx = Math.max(mx, f); sum += f; }
    const mean = sum / pts0.length, ratio = mx > 0 ? mn / mx : 0, refOk = ref == null || mean >= F.refRatio * ref;
    return { ratio, mean, min: mn, ok: ratio >= F.minRatio && refOk };
  };
  const s0 = score(0, 0);
  let best = null, tried = 0;
  if (s0?.ok) best = { off: [0, 0], ...s0 };
  else for (const [dx, dz] of cand) {
    tried++;
    const s = score(dx, dz);
    if (!s) continue;
    if (!best || s.ratio > best.ratio) best = { off: [dx, dz], ...s };
    if (s.ok) { best = { off: [dx, dz], ...s }; break; }
  }
  const off = best?.off ?? [0, 0];
  const laid = courseToWind(course, windFromDeg, { loadCourse, snapCourse, depthAt, offset: off, scale, laps });
  return { course: laid, offset: off, fair: best?.ok ?? false, ratio: best?.ratio ?? s0?.ratio ?? null, ratio0: s0?.ratio ?? null, tried };
}

// the layline a boat sailing on reaches first: her heading's ray against each layline segment → { side: 'port' | 'stbd', m } | null
export function laylineAhead(lay, x, z, heading) {
  if (!lay) return null;
  const dx = Math.sin(heading), dz = -Math.cos(heading);
  let best = null;
  for (const side of ['port', 'stbd']) {
    const [a, b] = lay[side], ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - x) * ez - (a[1] - z) * ex) / den, u = ((a[0] - x) * dz - (a[1] - z) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && (!best || t < best.m)) best = { side, m: t };
  }
  return best;
}

// The race's gusts kept fair (R3; the owner: weather stays, shifts and gusts yes, collapses no): the wind a racing boat feels, the
// player's and the rivals' alike, held within GUST_BAND of the day's base speed. v1's gust cells swing a point 0.5-1.35 x the base
// (6 kn on a 12 kn day for half a minute at W, measured 2026-11-14); a race keeps the swing and its direction, not the hole.
export const GUST_BAND = Object.freeze({ lo: 0.82, hi: 1.35 });
export function fairGust(w, baseMs, B = GUST_BAND) {
  const s = Math.hypot(w.vx, w.vz);
  if (!(baseMs > 0.5) || !(s > 1e-6)) return w;
  const k = s < B.lo * baseMs ? (B.lo * baseMs) / s : s > B.hi * baseMs ? (B.hi * baseMs) / s : 1;
  return k === 1 ? w : { vx: w.vx * k, vz: w.vz * k };
}
