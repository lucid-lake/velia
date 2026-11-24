// The crew flies the gennaker (owner, 2026-11-21: option A, "automatic, like crew trim"; "this UX of G should
// not exist"). No key and no button: the crew hoists it when the wind has been well behind the beam for a while and douses it when
// she heads up, at anchor, on the lines, docking, in a race or with the sails down. Setup › Aids › Gennaker: Auto | Off (default Auto).
// Pro flies it by hand too (v2/sim/boat.js hands: F held at the jib's full ease hoists, R held at the gennaker's full trim douses); a
// hand's call overrides the crew until the conditions change. Pure: v2/sim/boat.js steps it each frame; v2/tests/gennakerCrew.test.mjs.
//   const C = createGennakerCrew();
//   C.update(dt, { mode, twa, tws, sailsUp, blocked, up, manual }) → { want, said }   want: the sail asked up; said: 'up' | 'down' | null
//     mode 'auto' | 'off'; twa rad (true wind angle off the bow, signed); tws m/s; sailsUp: the sails set (furl < 0.5); blocked: at
//     anchor, on a ball or the pier, docking, or in a race; wait: the home card is up, or just went (the hoist clock does not run, nothing
//     is hoisted; a sail already up stays); up: the sail asked up now; manual: 'up' | 'down' | null (a Pro hand this frame)
const DEG = Math.PI / 180, KN = 0.514444;
export const GK_CREW = Object.freeze({
  hoistTwaDeg: 100,   // the true wind at least this far off the bow …
  hoistS: 8,          // … for this long, in at least minTwsKn: the crew hoists
  minTwsKn: 6,
  douseTwaDeg: 85,    // headed up past this for douseS: the crew douses (the 15° band and the two clocks: it never flickers)
  douseS: 4,
  handTwaDeg: 80,     // a Pro hand may hoist with the wind behind this
});

export function createGennakerCrew(P = GK_CREW) {
  let abaft = 0, ahead = 0, holdUp = false, holdDown = false;   // the clocks; a Pro hand's override (until the conditions change)
  return {
    get state() { return { abaft, ahead, holdUp, holdDown }; },
    hold(which) { holdUp = which === 'up'; holdDown = which === 'down'; },   // a call made outside (?gennaker=1's capture): held as a hand's
    update(dt, { mode = 'auto', twa = 0, tws = 0, sailsUp = true, blocked = false, wait = false, up = false, manual = null } = {}) {
      const a = Math.abs(twa);
      let want = !!up;
      if (!sailsUp || blocked) {   // the hard stops: down at once, every hand's call forgotten
        abaft = 0; ahead = 0; holdUp = false; holdDown = false;
        return { want: false, said: up ? 'down' : null };
      }
      abaft = !wait && a >= P.hoistTwaDeg * DEG && tws >= P.minTwsKn * KN ? abaft + dt : 0;
      ahead = a < P.douseTwaDeg * DEG ? ahead + dt : 0;
      if (manual === 'up' && a >= P.handTwaDeg * DEG) { want = true; holdUp = true; holdDown = false; }
      else if (manual === 'down') { want = false; holdDown = true; holdUp = false; }
      // the conditions change: a hand's douse holds until she has headed up past douseTwaDeg (and must bear away again); a hand's
      // hoist holds until she is well abaft hoistTwaDeg (the crew's own rules then apply)
      if (holdDown && a < P.douseTwaDeg * DEG) holdDown = false;
      if (holdUp && a >= P.hoistTwaDeg * DEG) holdUp = false;
      if (mode === 'auto' && !manual && !wait) {
        if (!want && !holdDown && abaft >= P.hoistS) want = true;
        else if (want && !holdUp && ahead >= P.douseS) want = false;
      }
      return { want, said: want === !!up ? null : want ? 'up' : 'down' };
    },
  };
}
