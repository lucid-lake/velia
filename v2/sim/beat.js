// AUTO's beat and run to a target (owner, 2026-11-17: "I didn't see AUTO zigzag to reach an upwind target"). v1's AI skipper
// (src/sim/ai/skipper.js, skill 1) already beats on the polar's best-VMG angle and tacks at the layline, at its corridor's edge
// (0.12 × the leg, up to 240 m) or on a header; on a long leg that is a board of 4 to 5 minutes, so the player saw her sail off at an
// angle and never tack. Sail's AUTO keeps that skipper and adds a sailor's rhythm on top (v1's Cruise is unchanged):
//   beat   close-hauled at the polar's best VMG angle; a tack at the layline (as v1) or when a board has run BEAT.legMaxS; never a
//          tack for the corridor or a small header before BEAT.legMinS (no short-tacking); the shore still turns her at once
//   run    a target deep downwind (more than BEAT.runDeg off the wind's eye, where v1 would sail a dead run straight at it): broad
//          reaches at BEAT.runDeg with gybes at the layline or every BEAT.legMaxS
//   shifts a wind shift of BEAT.shiftDeg or more since the board began (src/sim/sail-shifts.js's big shifts) re-plans: a header that
//          big tacks her (after BEAT.shiftMinS on the board), a lift is sailed (the layline rule takes it), each counted (replans)
// Pure (no DOM): v2/sim/autoNav.js builds it for AUTO's passage; v2/tests/auto-beat.test.mjs sails it on the whole-lake chart.
//   new BeatSkipper({ skill, seed, windAt, clear, vessel })   (AISkipper's options)   .turning  .replans  .tacks  .gybes
import { AISkipper } from '../../src/sim/ai/skipper.js';

const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const sgn = (x) => (x < 0 ? -1 : 1);

export const BEAT = Object.freeze({
  legMinS: 60,      // s: the least board before a tack or gybe for the corridor, a small header or the leg timer (the layline and
                    // the shore are never held back)
  legMaxS: 110,     // s: the longest board inside the cone (the owner's 60 to 120 s)
  runDeg: 155,      // ° off the wind's eye: the broad reach a run is sailed at (v1: a dead run at 180 in a breeze)
  shiftDeg: 12,     // °: a shift this big since the board began re-plans
  shiftMinS: 30,    // s: a header that big tacks her once the board is this old
  slowS: 12,        // s: the wind's mean a shift is judged on
  settleS: 12,      // s: after a turn, the board's own wind is taken this late
  turnS: 20,        // s: the least time between two gybes on a run (a gybe and straight back reads as a wobble)
  minDistM: 90,     // m: nearer than this the skipper sails straight in (v1's own rule)
});

export class BeatSkipper extends AISkipper {
  constructor(o = {}) { super(o); this.replans = 0; this.boardTwd = null; this.boardSide = 0; this.slow = null; this.slowT = null; }
  // the manoeuvre under way, for the key's amber: 'tack' | 'gybe' | null (a bear-away round counts as a tack)
  get turning() { const m = this.man; return m ? (m.type === 'gybe' ? 'gybe' : 'tack') : null; }

  course(dt, s, t, ctx) {
    let c = super.course(dt, s, t, ctx);
    if (this.man || this.twd == null) return c;
    if (this.lastManT === -Infinity) this.lastManT = t;   // the first board's clock starts with the passage, not at −∞
    // the wind's slow mean (BEAT.slowS): a swing of a few degrees is no shift; the board's own wind is that mean once the board has
    // settled (BEAT.settleS after the turn)
    const dtS = this.slowT == null ? 0 : Math.max(0, t - this.slowT); this.slowT = t;
    const v = [Math.sin(this.twd), -Math.cos(this.twd)], k = this.slow ? 1 - Math.exp(-dtS / BEAT.slowS) : 1;
    this.slow = this.slow ? [this.slow[0] + (v[0] - this.slow[0]) * k, this.slow[1] + (v[1] - this.slow[1]) * k] : v;
    const twdSlow = Math.atan2(this.slow[0], -this.slow[1]);
    if (this.side !== this.boardSide) { this.boardSide = this.side; this.boardTwd = null; }
    if (this.boardTwd == null && t - this.lastManT >= BEAT.settleS) this.boardTwd = twdSlow;
    const wp = ctx.waypoint ?? this.routeWaypoint(s);
    const brg = Math.atan2(wp[0] - s.x, -(wp[1] - s.z)), rel = wrap(brg - this.twd), dist = c.dist ?? Math.hypot(wp[0] - s.x, wp[1] - s.z);
    const since = t - this.lastManT, side = this.side;
    // a deep run: v1 steers straight at a mark under 180° − its polar's best (a dead run in a breeze); AUTO sails broad reaches
    const runA = BEAT.runDeg * DEG;
    if ((c.mode === 'reach' && Math.abs(rel) > runA) || c.mode === 'run') {
      const A = runA, h = (sd) => wrap(this.twd - sd * A);
      // the board: the one she is on (a reach's board is the heading's side: v1 sets it each frame)
      const sd = side || sgn(s.trueWind.angle);
      // the layline: the other board's heading lays the mark (the bearing past it on the other side), or the leg timer
      const okO = !this.clear || this.clear(h(-sd), 20, s);
      const lay = sgn(rel) === -sd ? false : Math.abs(rel) <= A + 1.5 * DEG;   // her board is −sd·A off the eye; the mark swings to +sd
      const timer = since > BEAT.legMaxS && dist > BEAT.minDistM;
      if (okO && since > BEAT.turnS && (lay || timer) && dist > BEAT.minDistM && Math.abs(rel) < Math.PI - 1e-3) {
        return { heading: h(-sd), mode: 'run', side: -sd, A, dist, why: lay ? 'layline' : 'leg', flip: true };
      }
      return { heading: h(sd), mode: 'run', side: sd, A, dist, why: null, flip: sd !== this.side };
    }
    if (c.mode !== 'beat') return c;
    const A = c.A, h = (sd) => wrap(this.twd - sd * A);
    // a shift since the board began: a re-plan (counted); a header that big tacks her
    const d = this.boardTwd == null ? 0 : wrap(twdSlow - this.boardTwd);
    if (Math.abs(d) >= BEAT.shiftDeg * DEG) {
      this.replans++; this.boardTwd = twdSlow;
      const header = sgn(d) === -side;   // on the board with the wind from starboard (+1) a backing wind (− d) heads her
      if (header && !c.flip && since > BEAT.shiftMinS && dist > BEAT.minDistM && (!this.clear || this.clear(h(-side), 20, s))) {
        return { ...c, heading: h(-side), side: -side, why: 'shift', flip: true };
      }
    }
    if (c.flip) {
      // v1's tack: the shore and the layline at once; the corridor and a small header wait for the least board
      if (c.why === 'hazard' || c.why === 'layline' || since >= BEAT.legMinS) return c;
      return { ...c, heading: h(side), side, why: null, flip: false };
    }
    // the leg timer: a board this long inside the cone is ended (the other board clear), unless this board lays the mark
    const lays = Math.abs(wrap(brg - h(side))) < 5 * DEG;
    if (!lays && since > BEAT.legMaxS && dist > BEAT.minDistM && (!this.clear || this.clear(h(-side), 20, s))) {
      return { ...c, heading: h(-side), side: -side, why: 'leg', flip: true };
    }
    return c;
  }
}
