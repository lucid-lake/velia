// The start helper (owner 2026-11-14: start in the box, an untouched boat makes a clean start). v1's start
// plan (src/sim/ai/skipper.js startPlan) commits on a 60 s sequence and its pro skipper is over early from the box at −0:45 on 4
// seeds of 5 (2026-11-14), so the helper is v2's own, a sailor's timed run: sail the close-hauled starboard lay straight at the
// gold ghost on the line, and burn the spare seconds by easing the sheets (a luff: the boat slows, keeps her lane), trimming
// in when the time left matches the time she needs. An AISkipper at skill 1 holds the lane and trims (the hands a player has:
// rudder and sheet only). Pure: v2/tests/regatta.test.mjs (3 seeds, clean starts).
//   const H = createStartHelper({ line, windFrom, windAt, vessel, seed });
//   H.tick(dt, state, ctl, { t, clock, ocs })   writes ctl (rudder, sheet); → { phase: 'luff' | 'run' | 'dip' | 'go', burnS }
//   startLay(line, windFrom, a, back, alpha)     → { ghost, box }: the ghost a along the line and the box pose back m below it on the lay
import { AISkipper, polarKn, polarTargets } from '../../src/sim/ai/skipper.js';
import { KN } from '../../src/sim/boat.js';
import { side } from '../../src/sim/race/line.js';

const DEG = Math.PI / 180;
export const HELP = Object.freeze({ lateS: [0.5, 1.5], accelS: 9, luffSheetDeg: 85, a: 0.62, guardM: 14, driftMs: 0.7, holdDeg: 80 });
// coast (the player's helper; 2026-11-18, filmed over early on seeds 1 and 6 at wind 2): her luff eased the main only, and the jib
// kept driving her at the line (0.7-1.0 m/s in light air): on a luff the jib is let fly (ctl.jibFree) too, and a luff that would still
// carry her over (her way toward the line held for the time left, plus marginM) bears away along the line, both sheets free
export const COAST = Object.freeze({ marginM: 2 });
const dirOf = (h) => [Math.sin(h), -Math.cos(h)];

// the lay: the ghost on the line a along it (0 the pin, 1 the committee boat), the box `back` m below the line on the close-
// hauled starboard ray that ends at the ghost (alpha: the course off the wind, rad)
export function startLay(line, windFromRad, a, back, alpha) {
  const g = [line.pin[0] + (line.committee[0] - line.pin[0]) * a, line.pin[1] + (line.committee[1] - line.pin[1]) * a];
  const ray = dirOf(windFromRad - alpha), rayUp = ray[0] * line.up[0] + ray[1] * line.up[1], k = back / Math.max(0.2, rayUp);
  return { ghost: g, box: { x: g[0] - ray[0] * k, z: g[1] - ray[1] * k, heading: windFromRad - alpha }, rayUp };
}

// R4: lateS, the seconds after the gun she aims to cross (a rival's by its skill: fleet.js startLate; the player's 0.5–1.5 s)
// flying (the flying start: she comes in at speed with a few seconds to spare): the spare goes by bearing away, not by luffing (a
// keelboat at speed carries her way for 15 s with the sheets eased: a luff burned 3 s of 5 and she was over early). Each tick she sails
// the course, between her lane and FLY_HELP.maxDeg off the wind, whose speed toward the line brings her there aimS after the gun,
// sheets trimmed, and heads back up to her lane as the time runs out: she crosses at full speed. The player's aimS is a hair early
// (the turn back up costs her up to a second in light air; at Beginner, the only level with the helper, the gun waits for her); a
// rival's is the middle of its lateS
export const FLY_HELP = Object.freeze({ maxDeg: 88, stepDeg: 2, aimS: -0.2 });
export function createStartHelper({ line, windFrom, windAt, vessel, seed = 1, ghost, lateS = HELP.lateS, guard = false, flying = false, aimS = FLY_HELP.aimS, coast = false } = {}) {
  const sk = new AISkipper({ skill: 1, seed, windAt, ...(vessel ? { vessel } : {}) });
  const out = { phase: 'run', burnS: 0, needS: 0 };
  let luffing = false;
  const hold = { evade: true, heading: 0, side: 1, mode: 'reach' };
  function tick(dt, s, ctl, { t = 0, clock = -45, ocs = false } = {}) {
    if (coast) ctl.jibFree = false;
    const d = -side(line, s.x, s.z), tws = s.trueWind?.speed || 5, tg = polarTargets(tws, sk.polar);
    // the speed toward the line close-hauled: her close-hauled heading in the wind she has now against the line's square (R3: a line not
    // square to the local wind, 10–20° where the valley steers it, made cos(twa) overrate her approach and the start late)
    const twd = s.heading + (s.trueWind?.angle ?? 0), hCH = twd - (tg.up.twa + 3) * DEG;
    const vFull = polarKn(tws, tg.up.twa, sk.polar) * KN, rayUp = Math.max(0.2, Math.sin(hCH) * line.up[0] - Math.cos(hCH) * line.up[1]);
    const u = Math.max(0, s.u ?? 0), toLine = u * (Math.sin(s.heading) * line.up[0] - Math.cos(s.heading) * line.up[1]);
    // the time she needs: the run at her own speed toward the line once she is up to speed (a lift or a header shows in it), else
    // at 90 % of the polar's, plus the time lost getting up to speed from the speed she has now. Slow is safe: early, she luffs again
    const vApp = u > 0.7 * vFull ? toLine : 0.9 * vFull * rayUp;
    const need = d / Math.max(0.3, vApp) + HELP.accelS * Math.max(0, 1 - u / vFull) * Math.min(1, Math.max(0, d) / 20);   // the speed to gain matters less the closer the line
    const left = -clock;
    out.needS = need; out.burnS = left - need;
    if (d < 0 && (clock < 0 || ocs)) { out.phase = 'dip'; luffing = false; }
    else if (clock >= 0 || ocs) { out.phase = 'go'; luffing = false; }
    else { if (luffing ? out.burnS < -lateS[1] : out.burnS > -lateS[0]) luffing = !luffing; out.phase = luffing ? 'luff' : 'run'; }   // aim to cross 0.5–1.5 s after the gun: luff while she would be early
    if (flying && clock < 0 && !ocs && d >= 0) {
      // the course whose speed toward the line (half her speed now, half the polar's on that course; at least 60 % of the polar's
      // close-hauled) brings her there aimS after the gun: the freest of her lane and the angle that slows the approach enough
      const lane = tg.up.twa + 6, want = d / Math.max(0.4, left + aimS);
      let A = lane;
      for (; A < FLY_HELP.maxDeg; A += FLY_HELP.stepDeg) {
        const h = twd - A * DEG, v = Math.max(0.6 * vFull, 0.5 * (u + polarKn(tws, A, sk.polar) * KN));
        if (v * (Math.sin(h) * line.up[0] - Math.cos(h) * line.up[1]) <= want) break;
      }
      hold.heading = twd - A * DEG; hold.side = 1;
      sk.update(dt, s, ctl, { t, waypoint: [s.x + Math.sin(hold.heading) * 400, s.z - Math.cos(hold.heading) * 400], legKey: 'start', advice: hold });
      out.phase = A > lane + 1 ? 'reach' : 'run';
      return out;
    }
    // R4 (guard, the rivals): a boat nearer the line than she drifts in the time left (3 m + HELP.driftMs a second, at most HELP.guardM) bears away along the line (80° off the wind) with the sheets
    // free, instead of drifting over on her luff (two rivals of five were over early on one seed of four: a minute and a half lost)
    if (guard && clock < 0 && !ocs && d >= 0 && d < Math.min(HELP.guardM, 3 + HELP.driftMs * left) && out.phase !== 'dip') out.phase = 'hold';
    // coast: a luff that would still carry her over before the gun (her way toward the line now held for the time left, plus marginM)
    // bears away along the line instead, both sheets free (the rivals' hold)
    if (coast && out.phase === 'luff' && clock < 0 && d >= 0 && d < COAST.marginM + Math.max(0, toLine) * left) out.phase = 'hold';
    if (out.phase === 'hold') {
      hold.heading = twd - HELP.holdDeg * DEG; hold.side = 1;
      sk.update(dt, s, ctl, { t, waypoint: [s.x + line.up[0] * 400, s.z + line.up[1] * 400], legKey: 'start', advice: hold });
      ctl.sheet = HELP.luffSheetDeg * DEG; ctl.sheetBias = 0;
      if (coast) ctl.jibFree = true;
    } else if (out.phase === 'dip') {   // over early: bear away below the line, then come back up
      sk.update(dt, s, ctl, { t, waypoint: [s.x - line.up[0] * (guard ? 25 : 60), s.z - line.up[1] * (guard ? 25 : 60)], legKey: 'dip' });   // R4: a rival dips a short way (60 m cost a minute)
    } else {
      // the lane: close-hauled on starboard at the ghost (after the gun, on across the line)
      // the lane: close-hauled on starboard (evade: the lane wins over the skipper's own tack calls); after the gun, on across the line.
      // (Steering for the ghost's spot instead was over early on seed 1: a broad approach with time to burn cannot luff it away.)
      const aim = ghost ?? line.centre, advice = { evade: true, closeHauled: true, side: 1, chDeg: tg.up.twa, mode: 'beat' };
      sk.update(dt, s, ctl, { t, waypoint: [aim[0] + line.up[0] * 400, aim[1] + line.up[1] * 400], legKey: 'start', advice });
      if (out.phase === 'luff') { ctl.sheet = HELP.luffSheetDeg * DEG; ctl.sheetBias = 0; }
      if (coast && out.phase === 'luff') ctl.jibFree = true;
    }
    return out;
  }
  function reset() { luffing = false; sk.man = null; sk.side = 1; sk.helm.i = 0; }
  return { tick, reset, sk, get state() { return out; } };
}

// where the untouched boat is at 0:00: her close-hauled starboard lane from where she is now, one length below the line (the
// gold ghost follows it while the helper sails, so "be at the gold boat at 0:00" is what the helper does); null when the lane
// does not reach the line ahead
export function laneGhost(line, s, alpha, back) {
  const twd = s.heading + (s.trueWind?.angle ?? 0), h = twd - alpha, d = [Math.sin(h), -Math.cos(h)];
  const du = d[0] * line.up[0] + d[1] * line.up[1], sd = side(line, s.x, s.z), t = (-back - sd) / du;
  if (du < 0.2 || !(t > 0)) return null;
  return { x: s.x + d[0] * t, z: s.z + d[1] * t, heading: h };
}
