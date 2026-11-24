// The knockdown in a place race (owner go 2026-11-19, default 3): a knockdown costs KNOCK.holdS of race time (she
// rights and sails on: the crew lets the sheets fly and the helm go while she comes up), and a second one ends her race (DNF). Every
// boat keeps the same rule (a rival caught by Tessie is held too). Pure, on the race's own clock (v2/tests/regatta-places.test.mjs).
//   const K = createKnocks();  K.knock(id, t, cause) → { kind: 'hold', until, n } | { kind: 'dnf', n } | null (already held: the same knock)
//   K.holding(id, t) → bool;  K.left(id, t) → s still held;  K.count(id);  K.reset();  K.log  ([{ id, t, cause, kind }])
//   holdControls(ctl) → the controls of a boat being righted: both sheets let fly, the rudder amidships (the crew's hands off)
export const KNOCK = Object.freeze({ holdS: 12, maxKnocks: 2, line: 'Knocked down: 12 s to right her. One more and you are out.' });

export function createKnocks({ holdS = KNOCK.holdS, maxKnocks = KNOCK.maxKnocks } = {}) {
  const st = new Map(), log = [];
  const of = (id) => { let s = st.get(id); if (!s) st.set(id, (s = { n: 0, until: -Infinity, out: false })); return s; };
  return {
    log,
    knock(id, t, cause = 'knockdown') {
      const s = of(id);
      if (s.out || t < s.until) return null;   // the knock in hand (her roll fires the knockdown watch again), or already out
      s.n++;
      if (s.n >= maxKnocks) { s.out = true; s.until = -Infinity; log.push({ id, t, cause, kind: 'dnf' }); return { kind: 'dnf', n: s.n }; }
      s.until = t + holdS; log.push({ id, t, cause, kind: 'hold' });
      return { kind: 'hold', until: s.until, n: s.n };
    },
    holding: (id, t) => { const s = st.get(id); return !!s && !s.out && t < s.until; },
    left: (id, t) => { const s = st.get(id); return s && !s.out ? Math.max(0, s.until - t) : 0; },
    count: (id) => st.get(id)?.n ?? 0,
    out: (id) => !!st.get(id)?.out,
    reset() { st.clear(); log.length = 0; },
  };
}

export function holdControls(ctl) {
  ctl.rudder = 0; ctl.sheet = 85 * Math.PI / 180; ctl.sheetBias = 0; ctl.jibFree = true;
  return ctl;
}
