// When the show's props are in the world (fix/barge-collision, owner 2026-11-09: "they exist during day time"). The barges,
// tugs and patrol boats are there on the show's day from 20:30 to 23:30, the spectators' sailboats from 20:30 to 22:40.
// (The wow round showed the barges from 19:30: the sun is then still 9.5° up, sunset is 20:25 (the analytic sun at
// Fannette on 2026-07-04), so for 55 game minutes they stood in full daylight, and popped in at 19:30 in front of Sail's
// start, 171 m off. 20:30 is 5 minutes after sunset, the sun 1.4° down.) A prop never pops into or out of the picture:
//   - a cut (the page's first frame, a clock jump, a seek) sets it at once;
//   - else it comes (or goes) on the first frame its spot is out of the camera's view and our boat is clear of it;
//   - the barges still unseen at TOW.at are towed in instead: each comes in from TOW.from m up the bay, bow first with its
//     tug pushing, at TOW.speed m/s (sooner if the evening's clock runs fast: in by TOW.by), turning onto its spot over
//     the last TOW.turnM; the tow starts once its far end is out of view, or regardless at TOW.force (then it starts
//     ≈ 900 m off the viewing spot in the dusk, the sun 6.7° down: a small dark shape);
//   - a crowd still unseen at its own deadline (21:30) is placed regardless (after dark).
// Plain JS: world.js passes the camera test (inView) and our boat's place; tests/fireworksSolids.test.mjs drives it.
//   const pr = createPresence({ spots: [{ x, z, yaw }] })
//   pr.step({ hour, dt, cut, inView: (x, z, r) => bool, boatAt: [x, z], crowdAt: [[x, z]] })
//     → { shown, towing, crowd, poses: [{ x, z, yaw, tow }], changed: { barges, crowd } }
export const PRESENCE = {
  barges: { from: 20.5, to: 23.5 },
  crowd: { from: 20.5, to: 22 + 40 / 60, force: 21.5 },
  cutH: 0.25,      // a clock step over this (h) in one frame is a cut
  boatClearM: 140, // our boat at least this far from a barge's spot for it to appear (or go)
};
// bearing: up the bay from the barges (deg clockwise from north; the bay's axis toward Fannette Island, open water all the way)
export const TOW = { at: 20.75, force: 21.1, by: 21.6, from: 650, speed: 3.0, turnM: 90, bearing: 234 };
const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
const inWindow = (h, w) => (w.from <= w.to ? h > w.from && h < w.to : h > w.from || h < w.to);

// a barge's tow path: from `from` m up the bay (bearingDeg from its spot) to its spot, bow first.
// spot: { x, z, yaw } (three.js yaw of its group); → { start, len, pose(s) } (s: metres travelled)
export function towPath(spot, bearingDeg = TOW.bearing, from = TOW.from, turnM = TOW.turnM) {
  const ux = Math.sin(bearingDeg * DEG), uz = -Math.cos(bearingDeg * DEG);
  const start = [spot.x + ux * from, spot.z + uz * from];
  // travelling back down the bay (−u): the bow (local −z) along −u, so the group's yaw = atan2(ux, uz)
  const travelYaw = Math.atan2(ux, uz);
  const pose = (s) => {
    const left = Math.max(0, from - s), f = smooth(1 - left / turnM);   // 0 under way, 1 on the spot
    const yaw = travelYaw + wrap(spot.yaw - travelYaw) * f;
    return { x: spot.x + ux * left, z: spot.z + uz * left, yaw, tow: 1 - f };
  };
  return { start, len: from, pose };
}

export function createPresence({ spots = [], windows = PRESENCE, tow = TOW } = {}) {
  const st = {
    barges: { shown: false, towing: false, s: 0, path: spots.map((p) => towPath(p, tow.bearing, tow.from, tow.turnM)), t0: 0, h0: 0 },
    crowd: { shown: false },
  };
  let lastH = null;
  const poses = () => st.barges.path.map((p, i) => (st.barges.towing ? p.pose(st.barges.s) : { x: spots[i].x, z: spots[i].z, yaw: spots[i].yaw, tow: 0 }));
  const near = (boatAt, pts, m) => boatAt && pts.some(([x, z]) => Math.hypot(boatAt[0] - x, boatAt[1] - z) < m);
  // one frame. hour: the hour of day; sim: s since the last frame (scene clock); cut: forced; inView(x, z, r): is a sphere
  // round (x, z) in the camera's view; boatAt: our boat; crowdAt: the spectators' spots
  function step({ hour, dt = 0, cut = false, inView = () => false, boatAt = null, crowdAt = [] } = {}) {
    const jump = cut || lastH == null || Math.abs(wrap((hour - lastH) * 15 * DEG)) / (15 * DEG) > windows.cutH;
    lastH = hour;
    const B = st.barges, wantB = inWindow(hour, windows.barges), changed = { barges: false, crowd: false };
    const spotsSeen = () => spots.some((p) => inView(p.x, p.z, 75));
    if (jump) {
      if (B.shown !== wantB || B.towing) changed.barges = true;
      B.shown = wantB; B.towing = false;
    } else if (B.towing) {
      // in by tow.by whatever the clock does: the distance left shrinks with the hour too
      const byHour = B.h0 < tow.by ? (hour - B.h0) / (tow.by - B.h0) * B.path[0].len : B.path[0].len;
      B.s = Math.min(B.path[0].len, Math.max(B.s + tow.speed * dt, byHour));
      if (B.s >= B.path[0].len) { B.towing = false; changed.barges = true; }
      if (!wantB) { B.towing = false; B.shown = false; changed.barges = true; }
    } else if (B.shown !== wantB) {
      const boatNear = near(boatAt, spots.map((p) => [p.x, p.z]), windows.boatClearM);
      if (!spotsSeen() && !boatNear) { B.shown = wantB; changed.barges = true; }
      else if (wantB && inWindow(hour, { from: tow.at, to: windows.barges.to })) {
        // the tow: from its far end, once that is out of view (or regardless at tow.force)
        const farSeen = B.path.some((p) => inView(p.start[0], p.start[1], 75));
        if (!farSeen || inWindow(hour, { from: tow.force, to: windows.barges.to })) { B.shown = true; B.towing = true; B.s = 0; B.h0 = hour; changed.barges = true; }
      }
    }
    // the crowd: out of view, or at its deadline
    const C = st.crowd, wantC = inWindow(hour, windows.crowd);
    if (jump) { if (C.shown !== wantC) changed.crowd = true; C.shown = wantC; }
    else if (C.shown !== wantC) {
      const seen = crowdAt.some(([x, z]) => inView(x, z, 8)), boatNear = near(boatAt, crowdAt, 30);
      if ((!seen && !boatNear) || (wantC && inWindow(hour, { from: windows.crowd.force, to: windows.crowd.to }) && !boatNear)) { C.shown = wantC; changed.crowd = true; }
    }
    return { shown: B.shown, towing: B.towing, crowd: C.shown, poses: poses(), changed };
  }
  return { step, state: st, poses };
}
