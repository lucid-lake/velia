// What a first-time racer needs (follow-up, owner 2026-10-30): the briefing's chart and rules, the difficulty, the guide to
// the next mark, the rival's marker at the screen edge, the plain-words gap, the skipper's coaching. All pure: tests/race-newbie.test.mjs.
const DEG = Math.PI / 180;

export const DIFFICULTY = [
  { id: 'easy', label: 'Easy', tier: 'easy', forgiving: true, guide: true, line: 'Osprey sails gently. No penalties. A guide line shows the way.' },
  { id: 'medium', label: 'Medium', tier: 'medium', forgiving: false, guide: true, line: 'Osprey races properly. Penalty turns count. The guide stays.' },
  { id: 'hard', label: 'Hard', tier: 'hard', forgiving: false, guide: false, line: 'Osprey is sharp and covers you. No guide line.' },
];
export const diffById = (id) => DIFFICULTY.find((d) => d.id === id) ?? DIFFICULTY[0];
export const RULES_TEXT = ['Cross the start line after the gun, not before.', 'Go round each mark the way the arrow shows.', "Don't hit the other boat."];
export const BRIEF = { autoS: 20, introS: 4 };

// the mini-chart: the course in a 200 x 140 box (north up, x east, z south), the start line, the marks with their side, the legs
export function briefModel(course, { w = 200, h = 140, pad = 16 } = {}) {
  const pts = [course.line.committee, course.line.pin, ...course.marks.map((m) => m.at)];
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const k = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (z1 - z0 || 1));
  const P = (p) => [+(pad + (p[0] - x0) * k + ((w - 2 * pad) - (x1 - x0) * k) / 2).toFixed(1), +(pad + (p[1] - z0) * k + ((h - 2 * pad) - (z1 - z0) * k) / 2).toFixed(1)];
  const side = (m) => (m.rounding === 'port' ? 'left' : 'right');
  const route = [P(course.line.centre), ...course.legs.slice(0, -1).map((l) => P(l.to)), P(course.line.centre)];
  return { w, h, line: [P(course.line.committee), P(course.line.pin)], marks: course.marks.map((m) => ({ id: m.id, colour: m.colour, at: P(m.at), side: side(m), text: `Keep the ${m.colour} mark ${m.id} on your ${side(m)}` })),
    route, windArrow: { from: P([course.line.centre[0] + 200, course.line.centre[1] - 330]), dir: course.designWindFrom }, finish: P(course.line.centre) };
}

// "Round ⟲ — keep it on your left" over the next mark, and the point the dashed guide line runs to: the first route point not yet reached
export function guideModel({ pose, target, routeIdx = 0, reachM = 14 }) {
  if (!target) return null;
  let j = Math.min(routeIdx, target.route.length - 1);
  while (j < target.route.length - 1 && Math.hypot(target.route[j][0] - pose.x, target.route[j][1] - pose.z) < reachM) j++;
  const ccw = target.rounding === 'port';
  return { mark: target.mark, routeIdx: j, wp: target.route[j], at: target.at, label: `Round ${ccw ? '⟲' : '⟳'} — keep it on your ${ccw ? 'left' : 'right'}` };
}
// a dashed line as segment pairs (a LineSegments geometry): dash m long, gap m between, from a to b
export function dashSegments(a, b, dash = 3, gap = 3) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), out = [];
  if (L < 1e-6) return out;
  const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  for (let s = 0; s < L; s += dash + gap) { const e = Math.min(s + dash, L); out.push([a[0] + ux * s, a[1] + uz * s, a[0] + ux * e, a[1] + uz * e]); }
  return out;
}

// the rival's marker at the screen edge: ndc (x, y in -1..1, w the clip w; behind the camera when w <= 0) → where on the screen, which way
export function edgeMarker({ x, y, w = 1 }, { width = 1280, height = 720, margin = 56 } = {}) {
  const behind = w <= 0, nx = behind ? -x : x, ny = behind ? -y : y;
  const inside = !behind && Math.abs(x) <= 0.92 && Math.abs(y) <= 0.88;
  if (inside) return { offscreen: false };
  const m = Math.max(Math.abs(nx), Math.abs(ny), 1e-6), ex = nx / m, ey = ny / m;
  const px = Math.min(Math.max((ex * 0.5 + 0.5) * width, margin), width - margin), py = Math.min(Math.max((0.5 - ey * 0.5) * height, margin), height - margin);
  return { offscreen: true, x: px, y: py, angleDeg: Math.atan2(ex * width, ey * height) / DEG };   // 0 = up, 90 = right
}
// "Osprey is ahead 40 m": plain words for the plate. leadM > 0: the rival leads
export function gapWords(leadM, name = 'Osprey') {
  const m = Math.round(Math.abs(leadM) / 5) * 5;
  if (m < 10) return `Level with ${name}`;
  return leadM > 0 ? `${name} leads by ${m} m` : `You lead ${name} by ${m} m`;
}

// the skipper's coaching: a few lines at the right moments, never two within 8 s, each once where it is a first (R.)
export function createCoach({ minGapS = 8 } = {}) {
  let t = 0, last = -Infinity; const done = new Set();
  const sayOnce = (key, text) => { if (key && done.has(key)) return null; if (t - last < minGapS) return null; if (key) done.add(key); last = t; return text; };
  return {
    // in: { clock, easy, events, covered, gustRatio, next (the next mark's id or null for the finish) }
    step(dt, { clock = -60, easy = true, events = [], covered = false, gustRatio = 1, lineS = null } = {}) {
      t += dt;
      for (const e of events) {
        if (e.type === 'wrongSide' && e.id === 'me') return sayOnce(null, 'Wrong side of that one. Go back round it, the mark on your left.');
        if (e.type === 'rounded' && e.id === 'me') return e.mark === 'W' ? sayOnce(null, 'Well rounded. Now the island mark, reaching, mark on your left.') : sayOnce(null, 'Good. Last stretch: straight for the line.');
        if (e.type === 'ocs' && e.id === 'me' && !e.early && easy) return sayOnce(null, 'You were early. Dip back below the line.');
      }
      if (clock < -45 && clock > -58) return sayOnce('s1', 'Stay below the line until the gun. I will call it.');
      if (clock >= -22 && clock < -10 && easy) return sayOnce('s2', lineS != null ? `Line in ${Math.round(lineS)} seconds. Ease toward it.` : 'Ease toward the line. Gun in twenty.');
      if (covered) return sayOnce('cover', 'Osprey is sitting on your wind. Tack away, or hold your lane.');
      if (gustRatio > 1.25 && clock > 0) return sayOnce(`gust${Math.floor(t / 60)}`, 'Gust coming. Ease the sheet.');
      return null;
    },
    reset() { t = 0; last = -Infinity; done.clear(); },
  };
}
// the finish: always ends well (owner): the time, a personal best, a next step
export function finishNote({ place, tierId, isNew, prev }) {
  const next = tierId === 'easy' ? ' Try Medium next?' : tierId === 'medium' ? ' Try Hard next?' : '';
  if (place === 1) return `You beat Osprey. Well sailed.${next}`;
  if (isNew && prev == null) return `You finished your first race.${next || ' Beat Osprey next time?'}`;
  return isNew ? `A personal best.${next}` : `Good race. Osprey is quick; one more go?`;
}
// the briefing's step order: the card (auto-starts after 20 s), the rival intro (4 s, skippable), then the countdown
export function createFlow({ show = true, S = BRIEF } = {}) {
  let state = show ? 'brief' : 'race', t = 0, diff = DIFFICULTY[0].id;
  return {
    get state() { return state; }, get difficulty() { return diff; }, get t() { return t; },
    choose(id) { if (state === 'brief' && DIFFICULTY.some((d) => d.id === id)) diff = id; return diff; },
    start() { if (state === 'brief') { state = 'intro'; t = 0; return true; } return false; },
    skip() { if (state === 'brief') { state = 'intro'; t = 0; } else if (state === 'intro') state = 'race'; return state; },
    reopen() { if (state === 'race') { state = 'help'; return true; } return false; },
    close() { if (state === 'help') state = 'race'; return state; },
    step(dt) { t += dt; if (state === 'brief' && t >= S.autoS) { state = 'intro'; t = 0; } else if (state === 'intro' && t >= S.introS) { state = 'race'; t = 0; } return state; },
    get running() { return state === 'race'; },
  };
}
