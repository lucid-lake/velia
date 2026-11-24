// The depth sounder's alarm and the grounding's words (feat/grounding). Plain JS, no DOM, no clock: the
// controls feed it every frame; tests/ground.test.mjs runs it on the real physics.
//
//   const so = new Sounder();
//   const r = so.update(dt, { under, depth, sog, held, mode }, t);
//   r.level  0 clear · 1 amber (under the keel < 3 m) · 2 red (< 1 m);  r.beep: null | 'amber' | 'red' (play one beep now)
//   r.trend  m/s, the depth's change (negative: shoaling)
//
// The reading is what a real sounder gives: the water under the transducer, and the clearance under the keel (depth − the
// keel's draft). Amber at 3 m under the keel (4.6 m of water) with a soft beep every 2.4 s, at most 6 in one approach
// (the alarm is silenced by turning away and by going slowly; a sounder you cannot hush is a sounder you switch off);
// red under 1 m, a beep every 0.7 s while the boat moves. Hysteresis 0.3 m. Silent at anchor, on a mooring, alongside a
// pier, aground, and under 0.5 m/s (a drift, the dock).
export const SOUNDER = { amberM: 3.0, redM: 1.0, hysM: 0.3, amberEveryS: 2.4, redEveryS: 0.7, amberBeeps: 6, minSog: 0.5, resetS: 12, trendS: 3 };

export class Sounder {
  constructor(S = SOUNDER) {
    this.S = S; this.level = 0; this.nextBeep = 0; this.beeps = 0; this.clearFor = 0; this.hist = []; this.trend = 0; this.t = 0;
  }
  update(dt, { under = 99, depth = 99, sog = 0, held = false, mode = 'afloat' } = {}, t = this.t + dt) {
    const S = this.S; this.t = t;
    // the level, with hysteresis: a level is left only when the clearance is hysM past its threshold
    let lv = this.level;
    const up = (th, cur) => (cur ? under < th + S.hysM : under < th);
    lv = up(S.redM, lv === 2) ? 2 : up(S.amberM, lv >= 1) ? 1 : 0;
    this.level = lv;
    // the trend over trendS seconds (a smoothed rate: shoaling is negative)
    this.hist.push([t, depth]);
    while (this.hist.length > 1 && t - this.hist[0][0] > S.trendS) this.hist.shift();
    const h0 = this.hist[0]; this.trend = t - h0[0] > 0.5 ? (depth - h0[1]) / (t - h0[0]) : 0;
    let beep = null;
    const quiet = held || mode === 'aground' || sog < S.minSog;
    if (lv === 0) { this.clearFor += dt; if (this.clearFor > S.resetS) this.beeps = 0; this.nextBeep = 0; }
    else {
      this.clearFor = 0;
      if (!quiet && t >= this.nextBeep) {
        if (lv === 2) { beep = 'red'; this.nextBeep = t + S.redEveryS; }
        else if (this.beeps < S.amberBeeps) { beep = 'amber'; this.beeps++; this.nextBeep = t + S.amberEveryS; }
      }
    }
    return { level: lv, beep, trend: this.trend, quiet };
  }
}

// The spoken words for what the bottom does (the old skipper's notes, src/ui/skipper.js NOTES): which line, now?
//   const w = new GroundTalk(); w.next(t, { reason, assisting, tHit, events }) → a NOTES id or null
// Each line at most once per `gapS` seconds (any line: `anyS`), a warning never over the assist's own line.
export class GroundTalk {
  constructor({ gapS = 45, anyS = 6 } = {}) { this.gapS = gapS; this.anyS = anyS; this.last = {}; this.lastAny = -99; }
  say(t, id, gap = this.gapS) {
    if (t - this.lastAny < this.anyS || t - (this.last[id] ?? -99) < gap) return null;
    this.last[id] = t; this.lastAny = t; return id;
  }
  // reason: 'shoal' | 'rocks' | 'shore' | null (what the lookahead sees within 8 s); assisting: the assist is turning the boat
  warn(t, { reason = null, assisting = false, engaged = false } = {}) {
    if (!reason) return null;
    return this.say(t, assisting || engaged ? `${reason}Auto` : reason);
  }
}
