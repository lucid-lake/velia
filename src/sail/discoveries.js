// The logbook's trigger rules: given Day Sail's state stream, which entries were just found.
// Pure JS, no three.js and no DOM, so node tests can drive it with scripted streams (tests/discoveries.test.mjs).
//
//   const places = placesFrom({ terrain, shoreline: core.shoreline.layout, harbour: core.harbour.layout });
//   const disc = createDiscoveries({ places, isFound: (id) => logbook.found(id) });
//   const ids = disc.update(sample);   // every frame; [] or the ids found on this sample (each fires once)
//
// sample: { t (sim s), x, z, heading (rad, clockwise from north), sog (m/s), tws (m/s, the true wind at the boat),
//           twa (rad, signed, the true wind angle off the bow), cam: { x, y, z, fx, fy, fz, fovDeg, aspect } | null,
//           sunElevDeg | null, anchored: bool (the anchor down and holding: seamanship.js),
//           bino: { x, y, z, fx, fy, fz } | null (the binoculars' eye and aim while fully raised), rt (real s: the
//           sight's dwell runs on the player's clock, not the 2× sim), boats: [{ x, z }] (the far sailboats),
//           sky: { dir: [x, y, z] } | null (the Milky Way's best point, unit world, only on a clear dark night: milkyway.js) }
// Sight (the binoculars, owner 2026-10-29): a place or a far boat held inside the glasses' middle (RULES.sight.coneDeg
// of the aim) for holdS of real time, within its range and with the terrain clear between, is found. Only while the
// glasses are up (S.bino); lowering them or looking away resets the dwell.
// The world frame: x east, y up, z south, metres (src/terrain.js).


const DEG = Math.PI / 180;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// The rules' numbers. Places: the find radius from the place (m). "In view": the place inside the camera frustum's
// middle band, |ndc x| ≤ 1/3 (the middle third of the frame) and on screen vertically, in front of the camera.
export const RULES = {
  island: { r: 220, view: true },
  waterfall: { r: 420, view: true },
  house: { r: 320, view: true },
  narrows: { halfWidth: 190 },               // inside the mouth channel: off its axis < 190 m, 0 to its length along it
  harbour: { r: 300, view: true },           // r from the entrance; the view check aims at the basin
  light: { r: 260, view: true },
  ruin: { r: 90, view: true },               // the tea-house ruin on the island's summit: close, or by sight
  // moments
  gust: { rise: 0.25, surge: 0.10, baseS: 10, riseS: 6, peakDrop: 0.005, peakS: 10 },
  tack: { turnDeg: 60, turnS: 20, heldS: 15, heldSog: 1 },
  round: { sweepDeg: 300, r: 260, withinS: 360 },
  sunset: { sog: 1 },
  milkyway: { coneDeg: 25, holdS: 4 },       // round 4: the view held within 25° of the band's best point on a clear dark night, 4 real s
  sail: { minM: 300, maxM: 5000 },           // a far sailboat, by sight only
  anchor: { sog: 0.3, holdS: 10 },          // D3: the anchor holding (S.anchored) and the boat under 0.3 m/s for 10 s
  aground: { external: true },              // the keel on the bottom (src/boat/ground.js): fired by grounding.js, quietly, never by this stream
};
// the binoculars' sight rule: the places it can find, each with its range (m)
export const SIGHT = { holdS: 1.0, coneDeg: 1.2, aimY: 4, maxM: { ruin: 4000, waterfall: 6000, house: 5000, light: 6000, harbour: 6000, sail: 5000 } };
export const BAND = 1 / 3;
export const IDS = Object.keys(RULES);

// The places from the world data (the same sources as logbookChart.js): the terrain's lake and landmarks (the profile's),
// the shoreline layout (the tower, the mooring field), the harbour layout (the entrance, the basin), the mouth.
// y: the height to aim the view check at (m).
export function placesFrom({ terrain, shoreline, harbour }) {
  const h = (x, z) => Math.max(0, terrain.heightAt(x, z));
  const fall = terrain.waterfall?.();
  const I = terrain.lake.island, LANDMARKS = terrain.landmarks;
  const encl = harbour?.enclosure ?? [];
  const basin = encl.length ? encl.reduce((a, p) => ({ x: a.x + p[0] / encl.length, z: a.z + p[1] / encl.length }), { x: 0, z: 0 }) : null;
  const entrance = harbour ? { x: harbour.entrance.centre[0], z: harbour.entrance.centre[1] } : null;
  const wx = fall ? fall.x : LANDMARKS.waterfall.x, wz = fall ? fall.z : LANDMARKS.waterfall.z;
  return {
    island: { x: I.x, z: I.z, y: I.top * 0.5 },
    waterfall: { x: wx, z: wz, y: fall ? (fall.top + fall.bottom) / 2 : h(wx, wz) },
    house: { x: LANDMARKS.house.x, z: LANDMARKS.house.z, y: h(LANDMARKS.house.x, LANDMARKS.house.z) + 4 },
    narrows: terrain.mouth ? { a: { x: terrain.mouth.a[0], z: terrain.mouth.a[1] }, b: { x: terrain.mouth.b[0], z: terrain.mouth.b[1] } } : null,
    harbour: entrance && { ...entrance, y: 2, view: basin ? { ...basin, y: 2 } : entrance },
    light: shoreline?.tower ? { x: shoreline.tower.x, z: shoreline.tower.z, y: (shoreline.tower.y ?? 0) + 2 } : null,
    ruin: LANDMARKS.ruin ? { x: LANDMARKS.ruin.x, z: LANDMARKS.ruin.z, y: h(LANDMARKS.ruin.x, LANDMARKS.ruin.z) + 1.5 } : null,
  };
}

// Is the world point p inside the camera's middle band? cam: position, forward (any length), vertical fov, aspect.
export function inBand(cam, p, band = BAND) {
  if (!cam) return false;
  let fx = cam.fx, fy = cam.fy, fz = cam.fz; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  // right = forward × up(0,1,0); up' = right × forward
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const dx = p.x - cam.x, dy = (p.y ?? 0) - cam.y, dz = p.z - cam.z;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth <= 0) return false;
  const ty = Math.tan((cam.fovDeg ?? 50) * DEG / 2), tx = ty * (cam.aspect ?? 16 / 9);
  const nx = (dx * rx + dz * rz) / depth / tx, ny = (dx * ux + dy * uy + dz * uz) / depth / ty;
  return Math.abs(nx) <= band && Math.abs(ny) <= 1;
}

// The angle (rad) between the aim and a point, from the eye; Infinity behind
export function aimOff(bino, p) {
  const dx = p.x - bino.x, dy = (p.y ?? 0) - bino.y, dz = p.z - bino.z, d = Math.hypot(dx, dy, dz);
  const fl = Math.hypot(bino.fx, bino.fy, bino.fz), c = (dx * bino.fx + dy * bino.fy + dz * bino.fz) / (d * fl);
  return c <= 0 ? Infinity : Math.acos(Math.min(1, c));
}

// Line of sight over the terrain from the eye to a point: clear if no ground sample along the line (stopping 40 m
// short of the point, which sits on its own ground) stands above it, the earth's curve and refraction counted
// (2 × 1.15 R, k = 0.13, as the towns' check). heightAt: the terrain's.
export function terrainLos(heightAt, n = 48) {
  return (a, p) => {
    const dx = p.x - a.x, dz = p.z - a.z, dy = (p.y ?? 0) - a.y, d = Math.hypot(dx, dz);
    if (d < 60) return true;
    const stop = (d - 40) / d;
    for (let i = 1; i < n; i++) {
      const f = (i / n) * stop, s = d * f;
      if (heightAt(a.x + dx * f, a.z + dz * f) > a.y + dy * f - s * (d - s) / 14.65e6) return false;
    }
    return true;
  };
}

// Distance from (x, z) to the segment a→b and the distance along it.
function along(a, b, x, z) {
  const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez), ux = ex / L, uz = ez / L;
  const s = (x - a.x) * ux + (z - a.z) * uz, off = Math.abs((x - a.x) * uz - (z - a.z) * ux);
  return { s, off, L };
}

export function createDiscoveries({ places, rules = RULES, isFound = () => false, sampleS = 0.25, sight = SIGHT, los = () => true } = {}) {
  const done = new Set();
  const dwell = new Map();  // sight: target key → real seconds held in the glasses' middle
  const hist = [];          // { t, tws, sog, heading, twa }, one per sampleS of sim time, the last 40 s
  let lastPush = -Infinity;
  // gust
  let gustArm = null;       // { t, peak }
  // tack: candidate crossings through head to wind
  const tacks = [];         // { tc, h0, turned }
  let prevTwa = null;
  // round
  let roundHist = [], roundPrevBearing = null, roundA = 0;
  // sunset
  let prevElev = null;
  // anchor
  let anchorFor = 0, anchorT = null;
  // sight: the real clock's last sample
  let lastRt = null;
  // the Milky Way: real seconds the view has held on the band
  let skyHeld = 0;

  const has = (id) => done.has(id) || isFound(id);
  const fire = (out, id) => { if (has(id)) return; done.add(id); out.push(id); };
  const meanOver = (key, t0, t1) => { let s = 0, n = 0; for (const h of hist) if (h.t >= t0 && h.t < t1) { s += h[key]; n++; } return n ? s / n : null; };

  function update(S) {
    const out = [];
    const P = places;
    // ---- places ----
    const near = (p, r) => p && Math.hypot(S.x - p.x, S.z - p.z) < r;
    for (const id of ['island', 'waterfall', 'house', 'harbour', 'light', 'ruin']) {
      if (has(id) || !P[id]) continue;
      if (near(P[id], rules[id].r) && (!rules[id].view || inBand(S.cam, P[id].view ?? P[id]))) fire(out, id);
    }
    // ---- sight: the binoculars held on a place or a far boat (SIGHT) ----
    const rt = S.rt ?? S.t;
    const dtR = lastRt == null ? 0 : Math.max(0, Math.min(0.25, rt - lastRt)); lastRt = rt;
    const seen = new Set();
    if (S.bino) {
      // the candidates inside the glasses' middle, in range, the terrain clear; only the one nearest the aim's centre
      // (then the nearest) dwells: a place behind another one on the same line is not found with it
      const cone = sight.coneDeg * DEG, cands = [];
      const look = (key, id, p) => {
        if (has(id) || !p) return;
        const d = Math.hypot(p.x - S.bino.x, p.z - S.bino.z), off = aimOff(S.bino, p);
        if (d > (sight.maxM[id] ?? 6000) || (id === 'sail' && d < rules.sail.minM) || off > cone) return;
        cands.push({ key, id, p, d, off });
      };
      for (const id of ['ruin', 'waterfall', 'house', 'light', 'harbour']) if (sight.maxM[id]) look(id, id, P[id] && { ...(P[id].view ?? P[id]), y: (P[id].view ?? P[id]).y ?? sight.aimY });
      (S.boats ?? []).forEach((b, i) => look(`sail:${i}`, 'sail', { x: b.x, z: b.z, y: b.y ?? sight.aimY }));
      cands.sort((a, b) => a.off - b.off || a.d - b.d);
      const c = cands.find((q) => los(S.bino, q.p));
      if (c) {
        seen.add(c.key);
        const held = (dwell.get(c.key) ?? 0) + dtR; dwell.set(c.key, held);
        if (held >= sight.holdS) fire(out, c.id);
      }
    }
    for (const k of [...dwell.keys()]) if (!seen.has(k)) dwell.delete(k);   // looked away, or lowered: the dwell starts over

    // ---- the Milky Way: the view (the camera, or the glasses) held on the band's best point on a clear dark night ----
    if (!has('milkyway')) {
      const v = S.bino ? S.bino : S.cam, d = S.sky?.dir;
      const on = !!(v && d) && v.fx * d[0] + v.fy * d[1] + v.fz * d[2] >= Math.cos(rules.milkyway.coneDeg * DEG);
      skyHeld = on ? skyHeld + dtR : 0;
      if (skyHeld >= rules.milkyway.holdS) fire(out, 'milkyway');
    }

    if (!has('narrows') && P.narrows) {
      const { s, off, L } = along(P.narrows.a, P.narrows.b, S.x, S.z);
      if (off < rules.narrows.halfWidth && s >= 0 && s <= L) fire(out, 'narrows');
    }

    // ---- the history ----
    if (S.t - lastPush >= sampleS - 1e-9) {
      hist.push({ t: S.t, tws: S.tws, sog: S.sog, heading: S.heading, twa: S.twa }); lastPush = S.t;
      while (hist.length && hist[0].t < S.t - 40) hist.shift();
    }

    // ---- gust: the true wind ≥ 25 % over its 10 s mean before the rise, the speed ≥ 10 % over the same mean,
    // inside 6 s; the find waits for the peak (the wind stops rising) so the frame holds the surge ----
    const G = rules.gust;
    if (!has('gust') && S.tws != null) {
      if (gustArm) {
        gustArm.peak = Math.max(gustArm.peak, S.tws);
        if (S.tws < gustArm.peak * (1 - G.peakDrop) || S.t - gustArm.t > G.peakS) fire(out, 'gust');
      } else if (hist.length && hist[0].t <= S.t - (G.baseS + G.riseS) + sampleS) {
        const t0 = S.t - G.riseS - G.baseS, t1 = S.t - G.riseS;
        const w0 = meanOver('tws', t0, t1), v0 = meanOver('sog', t0, t1);
        if (w0 > 0.1 && v0 > 0.1 && S.tws >= w0 * (1 + G.rise) && S.sog >= v0 * (1 + G.surge)) gustArm = { t: S.t, peak: S.tws };
      }
    }

    // ---- tack: the true wind angle changes sign through head to wind (|twa| < 90° both sides; a gybe crosses at
    // 180°), the heading turns > 60° inside 20 s, and 15 s later the boat makes > 1 m/s ----
    const K = rules.tack;
    if (!has('tack') && S.twa != null) {
      if (prevTwa != null && Math.sign(prevTwa) !== Math.sign(S.twa) && Math.abs(prevTwa) < Math.PI / 2 && Math.abs(S.twa) < Math.PI / 2) {
        // the heading before the turn: the sample turnS/2 before the crossing (or the oldest one)
        const before = hist.find((h) => h.t >= S.t - K.turnS / 2) ?? hist[0];
        tacks.push({ tc: S.t, h0: before ? before.heading : S.heading, turned: false });
      }
      for (const c of tacks) {
        if (!c.turned && S.t <= c.tc + K.turnS / 2 && Math.abs(wrap(S.heading - c.h0)) > K.turnDeg * DEG) c.turned = true;
        if (c.turned && S.t >= c.tc + K.heldS) { if (S.sog > K.heldSog) fire(out, 'tack'); c.dead = true; }
        else if (!c.turned && S.t > c.tc + K.turnS / 2) c.dead = true;
      }
      for (let i = tacks.length - 1; i >= 0; i--) if (tacks[i].dead) tacks.splice(i, 1);
    }
    prevTwa = S.twa ?? prevTwa;

    // ---- round the island: the bearing island → boat sweeps 300° one way while within 260 m, inside 6 min ----
    const R = rules.round, I = P.island;
    if (!has('round') && I) {
      const d = Math.hypot(S.x - I.x, S.z - I.z);
      if (d < R.r) {
        const b = Math.atan2(S.x - I.x, -(S.z - I.z));
        if (roundPrevBearing != null) roundA += wrap(b - roundPrevBearing);
        roundPrevBearing = b;
        if (!roundHist.length || S.t - roundHist.at(-1).t >= sampleS - 1e-9) roundHist.push({ t: S.t, a: roundA });
        while (roundHist.length && roundHist[0].t < S.t - R.withinS) roundHist.shift();
        let lo = roundA, hi = roundA; for (const h of roundHist) { lo = Math.min(lo, h.a); hi = Math.max(hi, h.a); }
        if (roundA - lo >= R.sweepDeg * DEG || hi - roundA >= R.sweepDeg * DEG) fire(out, 'round');
      } else { roundHist = []; roundPrevBearing = null; roundA = 0; }
    }

    // ---- past sunset: the sun's elevation crosses 0° downward while the boat makes > 1 m/s ----
    if (S.sunElevDeg != null) {
      if (!has('sunset') && prevElev != null && prevElev > 0 && S.sunElevDeg <= 0 && S.sog > rules.sunset.sog) fire(out, 'sunset');
      prevElev = S.sunElevDeg;
    }

    // ---- at anchor (D3): the anchor holding and the boat still (under 0.3 m/s) for 10 s of sim time ----
    if (!has('anchor')) {
      anchorFor = S.anchored && S.sog < rules.anchor.sog ? anchorFor + (anchorT == null ? 0 : S.t - anchorT) : 0;
      anchorT = S.t;
      if (anchorFor >= rules.anchor.holdS) fire(out, 'anchor');
    }
    return out;
  }

  return { update, get done() { return [...done]; }, places, get dwell() { return Object.fromEntries(dwell); } };
}
