// Day Sail's challenges: in the world from minute one, never announced,
// never on screen. Each has a start and a finish read from the boat's position and state on the real map; a result
// goes only to the logbook's seamanship page ("beat to the head · 6 min 40 s"), the one place a time appears.
// Pure JS, no DOM, no three.js: tests/challenges.test.mjs drives it on the real map's coordinates.
//
//   const ch = createChallenges({ courses: coursesFrom(LAKE), storage: localStorage });
//   const done = ch.update(sample);   // every frame; [] or [{ id, value, label, best }] finished on this sample
//   ch.bests                          // { id: { value, label, at } }
//
// sample: { t (s, the world's clock: the 2× sim, so a time compares with real sailing), x, z (m, the world frame:
//           x east, z south), heading (rad, clockwise from north), sog (m/s), twa (rad, signed), windFrom (rad, the
//           compass direction the true wind blows from), level 1–4 | null, surf 0–1, roundUp 0–1,
//           sloops: [{ id, x, z, heading }] (src/traffic.js's AI sloops) }
const DEG = Math.PI / 180, KN = 0.514444;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const KEY = 'lakeshore.challenges.v1';

// The page's order; sil: the seamanship page's drawing (viewBox 0 0 160 100).
export const CHALLENGES = [
  { id: 'round', name: 'round the island', kind: 'time', sil: 'M80 52 m-34 0 a34 22 0 1 0 68 0 a34 22 0 1 0 -68 0 M62 52 Q80 34 98 52 M114 40 l6 12 l-12 -2 M30 82 H130' },
  { id: 'beat', name: 'beat to the head', kind: 'time', sil: 'M60 90 L40 66 L76 46 L52 26 L80 10 M100 20 h30 v14 h-30 Z M108 34 V44 M20 90 H70' },
  { id: 'narrows', name: 'thread the narrows', kind: 'clean', sil: 'M6 90 Q40 60 60 36 L52 14 M154 90 Q120 60 100 36 L108 14 M80 88 V20 M74 28 L80 18 L86 28' },
  { id: 'surf', name: 'surf run', kind: 'speed', sil: 'M6 70 Q36 70 58 44 Q76 24 96 44 Q116 64 154 64 M64 40 L88 28 L96 40 Z M20 86 h24 M60 86 h40' },
  { id: 'sloop', name: 'catch the sloop', kind: 'margin', sil: 'M24 74 H64 L58 82 H30 Z M44 74 V44 L60 72 M96 70 H136 L130 78 H102 Z M116 70 V36 L134 68 M74 58 h14 M84 54 l4 4 l-4 4' },
  { id: 'moor', name: 'moor under sail', kind: 'clean', sil: 'M10 74 H150 M80 66 a6 6 0 1 0 0.1 0 M80 72 V90 M40 70 H70 L64 78 H46 Z M56 70 V44 L68 68', stub: true },
];
export const CHALLENGE_IDS = CHALLENGES.map((c) => c.id);

// The courses' numbers. Times are the world's clock (s).
export const COURSE = {
  round: { r: 300, withinS: 600 },                       // a full 360° sweep of the bearing from the island, inside 300 m, inside 10 min
  beat: { startR: 150, finishR: 110, maxS: 1800, upwindDeg: 60 },   // leave the start circle, reach the finish circle; the finish must lie within 60° of dead upwind at the start
  narrows: { level: 3, minSog: 1, round: 0.5 },          // the mouth channel end to end at level ≥ 3; clean: no round-up, never under 1 m/s
  surf: { level: 4, twaDeg: 120, endS: 5, minS: 20, on: 0.5 },      // the open lake past the mouth, level 4, downwind; a run ≥ 20 s with a surf burst
  sloop: { range: 300, abeam: 150, headingDeg: 45, behind: 20, ahead: 20, armS: 900, marginS: 60 },   // from 20 m astern to 20 m ahead, sailing the same way
};

// The courses on the real map (src/terrain.js LAKE). The island: Fannette at the origin. The beat: from off the
// island's east side to the bay's head off Vikingsholm (≈ (−160, 280), 28 m deep, ≈ 200 m off the shore), upwind
// in the 18:45 breeze up the bay (from ≈ 196–199°). The narrows: the mouth channel the logbook's "narrows" uses.
export const BEAT = { start: { x: 200, z: -20 }, finish: { x: -160, z: 280 } };
export function coursesFrom(LAKE) {
  const m = LAKE.mouth;
  return {
    island: { x: LAKE.island.x, z: LAKE.island.z },
    beat: BEAT,
    mouth: { a: { x: m.a[0], z: m.a[1] }, b: { x: m.b[0], z: m.b[1] }, halfWidth: m.halfWidth },
  };
}

// the label a result shows on the page
export function labelOf(kind, value) {
  if (kind === 'time') { const s = Math.round(value), mm = Math.floor(s / 60), ss = s % 60; return mm ? `${mm} min ${ss} s` : `${ss} s`; }
  if (kind === 'speed') return `${(value / KN).toFixed(1)} kn`;
  if (kind === 'margin') return `${Math.round(value)} m`;
  if (kind === 'clean') return value ? 'clean' : 'through';
  return String(value);
}
// is a better than b (b may be null)?
function better(kind, a, b) {
  if (b == null) return true;
  if (kind === 'time') return a < b;
  if (kind === 'clean') return a && !b;
  return a > b;
}
function along(a, b, x, z) {
  const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez), ux = ex / L, uz = ez / L;
  return { s: (x - a.x) * ux + (z - a.z) * uz, off: Math.abs((x - a.x) * uz - (z - a.z) * ux), L };
}

export function createChallenges({ courses, storage = null, rules = COURSE } = {}) {
  const C = rules;
  let save = { v: 1, bests: {} };
  try { const raw = storage?.getItem(KEY); if (raw) { const j = JSON.parse(raw); if (j && j.v === 1 && j.bests) save = { v: 1, bests: { ...j.bests } }; } } catch { /* start clean */ }
  const persist = () => { try { storage?.setItem(KEY, JSON.stringify(save)); } catch { /* memory only */ } };
  const kindOf = Object.fromEntries(CHALLENGES.map((c) => [c.id, c.kind]));

  // round
  let roundHist = [], roundA = 0, roundPrev = null;
  // beat
  let beatInStart = false, beatFrom = null;
  // narrows
  let nPrev = null, nRun = null;
  // surf
  let surfRun = null;
  // sloop
  const armed = new Map(); let lead = null;

  function finish(out, id, value, at) {
    const kind = kindOf[id], label = labelOf(kind, value), prev = save.bests[id];
    const best = better(kind, value, prev?.value ?? null);
    if (best) { save.bests[id] = { value, label, at }; persist(); }
    out.push({ id, value, label, best });
  }

  function update(S) {
    const out = [];
    const P = courses;
    // ---- round the island: the bearing from the island sweeps a full turn, inside r, inside withinS ----
    {
      const I = P.island, d = Math.hypot(S.x - I.x, S.z - I.z);
      if (d < C.round.r) {
        const b = Math.atan2(S.x - I.x, -(S.z - I.z));
        if (roundPrev != null) roundA += wrap(b - roundPrev);
        roundPrev = b;
        roundHist.push({ t: S.t, a: roundA });
        while (roundHist.length && roundHist[0].t < S.t - C.round.withinS) roundHist.shift();
        for (let i = roundHist.length - 1; i >= 0; i--) {
          if (Math.abs(roundA - roundHist[i].a) >= 2 * Math.PI) { finish(out, 'round', S.t - roundHist[i].t, S.t); roundHist = [{ t: S.t, a: roundA }]; break; }
        }
      } else { roundHist = []; roundPrev = null; roundA = 0; }
    }
    // ---- beat to the head: out of the start circle with the finish upwind, into the finish circle ----
    {
      const B = P.beat, inStart = Math.hypot(S.x - B.start.x, S.z - B.start.z) < C.beat.startR;
      if (beatInStart && !inStart) {
        const brg = Math.atan2(B.finish.x - S.x, -(B.finish.z - S.z));   // compass bearing to the finish
        beatFrom = S.windFrom != null && Math.abs(wrap(brg - S.windFrom)) < C.beat.upwindDeg * DEG ? S.t : null;
      }
      beatInStart = inStart;
      if (beatFrom != null && S.t - beatFrom > C.beat.maxS) beatFrom = null;
      if (beatFrom != null && Math.hypot(S.x - B.finish.x, S.z - B.finish.z) < C.beat.finishR) { finish(out, 'beat', S.t - beatFrom, S.t); beatFrom = null; }
    }
    // ---- thread the narrows: the mouth channel end to end, level ≥ 3; clean: no round-up, way on throughout ----
    if (P.mouth) {
      const M = P.mouth, { s, off, L } = along(M.a, M.b, S.x, S.z), inside = off < M.halfWidth;
      if (nPrev && inside) {
        if (!nRun && ((nPrev.s < 0 && s >= 0) || (nPrev.s > L && s <= L))) nRun = { dir: nPrev.s < 0 ? 1 : -1, clean: true, level: true };
      }
      if (nRun) {
        if (!inside) nRun = null;
        else {
          if ((S.roundUp ?? 0) > C.narrows.round || (S.sog ?? 0) < C.narrows.minSog) nRun.clean = false;
          if ((S.level ?? 0) < C.narrows.level) nRun.level = false;
          const out1 = nRun.dir > 0 ? s > L : s < 0;
          if (out1) { if (nRun.level) finish(out, 'narrows', nRun.clean, S.t); nRun = null; }
          else if (nRun.dir > 0 ? s < 0 : s > L) nRun = null;   // turned back
        }
      }
      nPrev = { s };
    }
    // ---- surf run: past the mouth on the open lake, level 4, downwind; the best top speed of a run ----
    if (P.mouth) {
      const { s, L } = along(P.mouth.a, P.mouth.b, S.x, S.z);
      const cond = s > L && (S.level ?? 0) >= C.surf.level && Math.abs(S.twa ?? 0) >= C.surf.twaDeg * DEG;
      if (cond) {
        if (!surfRun) surfRun = { t0: S.t, top: 0, surfed: false, lost: 0 };
        surfRun.lost = 0; surfRun.top = Math.max(surfRun.top, S.sog ?? 0); if ((S.surf ?? 0) >= C.surf.on) surfRun.surfed = true; surfRun.t1 = S.t;
      } else if (surfRun && S.t - surfRun.t1 > C.surf.endS) {
        if (surfRun.surfed && surfRun.t1 - surfRun.t0 >= C.surf.minS) finish(out, 'surf', surfRun.top, S.t);
        surfRun = null;
      }
    }
    // ---- catch the sloop: from astern to ahead of an AI sloop sailing the same way; the margin a minute on ----
    const Sl = C.sloop;
    for (const b of S.sloops ?? []) {
      const dx = S.x - b.x, dz = S.z - b.z, fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
      const ahead = dx * fx + dz * fz, abeam = Math.abs(dx * fz - dz * fx);
      const same = Math.abs(wrap((S.heading ?? 0) - b.heading)) < Sl.headingDeg * DEG && Math.hypot(dx, dz) < Sl.range && abeam < Sl.abeam;
      if (lead?.id === b.id) {
        if (same) lead.margin = Math.max(lead.margin, ahead);
        if (!same || S.t - lead.t0 >= Sl.marginS) { finish(out, 'sloop', Math.min(Sl.range, lead.margin), S.t); lead = null; armed.delete(b.id); }
        continue;
      }
      const a = armed.get(b.id);
      if (a != null && S.t - a > Sl.armS) armed.delete(b.id);
      if (!same) continue;
      if (ahead < -Sl.behind) { if (!armed.has(b.id)) armed.set(b.id, S.t); }
      else if (ahead > Sl.ahead && armed.has(b.id) && !lead) lead = { id: b.id, t0: S.t, margin: ahead };
    }
    // ---- moor under sail: a stub until D3's mooring pick-up ----
    return out;
  }

  return { update, get bests() { return { ...save.bests }; }, courses, reset() { save = { v: 1, bests: {} }; persist(); } };
}
