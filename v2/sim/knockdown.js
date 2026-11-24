// Knockdown detection (K1; ?knockdown=1, off by default): physics decides, this only watches the heel.
//   const K = createKnockdown({ on, onWarn, onKnockdown });   K.tick(t, state) each physics tick (after it)
//   K.state  { on, active, count, warnT, warnHeelDeg, t, heelDeg, leadS, warnings, events }
// Warning: the heel 1.5 s ahead (heel + leadS × its rate) passes warnDeg (38°, "about 40°"), rising: about 2 s before a knockdown (the reef cue: "Overpowered, ease the sails or reef"); one per
//   excursion, re-armed once the heel is back under rearmDeg.
// Knockdown: the heel past kdDeg (55°) for holdS (0.5 s). One event per excursion (active until the heel is back under
//   rearmDeg). leadS: seconds from the excursion's warning to the knockdown (null when no warning came first).
// Nothing reacts to the events yet (K2 the look, K3 the game end); the state is read by the tests and the sim tool.
export const KD = Object.freeze({ leadS: 1.5, warnDeg: 38, kdDeg: 55, holdS: 0.5, rearmDeg: 22, maxEvents: 32 });
const DEG = Math.PI / 180;

export function createKnockdown({ on = false, onWarn = null, onKnockdown = null } = {}) {
  const st = { on: !!on, active: false, count: 0, warnings: 0, warnT: null, warnHeelDeg: null, t: null, heelDeg: null, leadS: null, events: [] };
  let over = 0, armedWarn = true, lastHeel = 0, peakTws = 0;   // peakTws: the strongest true wind (m/s) since the excursion began (the end card's gust)
  const push = (e) => { st.events.push(e); if (st.events.length > KD.maxEvents) st.events.shift(); };
  return {
    state: st,
    // a fresh start (B.place): no excursion in hand (the count and the events stay: the session's record)
    reset() { st.active = false; st.warnT = null; st.warnHeelDeg = null; over = 0; armedWarn = true; lastHeel = 0; peakTws = 0; },
    tick(t, s) {
      if (!st.on) return;
      const h = Math.abs(s.heel) / DEG, rate = (h - lastHeel) * 60, rising = rate > 0, ahead = h + KD.leadS * rate;   // deg/s at the 1/60 s tick
      lastHeel = h;
      if (h < KD.rearmDeg) { armedWarn = true; st.active = false; st.warnT = null; over = 0; peakTws = 0; return; }
      peakTws = Math.max(peakTws, s.trueWind?.speed ?? 0);
      if (armedWarn && ahead > KD.warnDeg && rising) {
        armedWarn = false; st.warnings++; st.warnT = t; st.warnHeelDeg = h;
        const e = { type: 'knockdownWarn', t, heelDeg: h }; push(e); onWarn?.(e);
      }
      over = h > KD.kdDeg ? over + (s.dt ?? 1 / 60) : 0;
      if (!st.active && over >= KD.holdS) {
        st.active = true; st.count++; st.t = t; st.heelDeg = h; st.leadS = st.warnT != null ? t - st.warnT : null;
        const e = { type: 'knockdown', t, heelDeg: h, leadS: st.leadS, twsKn: s.trueWind ? s.trueWind.speed / 0.514444 : null, gustKn: peakTws / 0.514444, twaDeg: s.trueWind ? s.trueWind.angle / DEG : null, reef: s.reef ?? null, boomDeg: s.boomAngle != null ? Math.abs(s.boomAngle) / DEG : null, mainFill: s.mainFill ?? null };
        push(e); onKnockdown?.(e);
      }
    },
  };
}
