// Play as Tessie, the level-up moment (the Tessie RPG, phase 2; behind ?tessierpg=1). Pure: no DOM, no clock of its own (the caller
// steps it), no Math.random. Everything lives on surfaces that exist: the skipper's line says "Level N: pick one skill to grow.", the
// slots that can take a point carry a soft amber halo, and a press on a glowing slot while the line is up spends the point there.
//   the line     asked at once when a level is reached; while a point waits, asked again once she has been still stillS (2 s), at
//                most every everyS (60 s), with no cap. The lean skipper still decides when it shows (v2/ui/leanSkipper.js
//                'tip.tessie.level': the 20 s gap, the busy rule); say(text) answers whether it was taken
//   the window   lineS (7 s, the skipper's note) from the line's showing; it closes early when the line goes (lineUp false) or no
//                point is left
//   the halo     the skills a point can go to now (v2/sim/tessieBounty.js canSpend), whenever a point waits, line or no line
//   a press      on a glowing slot inside the window spends the point ('pick'); any other press is the skill's own ('fire')
//   const U = createLevelUp({ bounty });   U.levelUp(); U.step(dt, { still, say, lineUp }); U.press(id) → { pick, rank?, why? }
//   U.halo() → [ids];  U.open → bool;  U.state → { open, lineAt, lastLine, stillT, want, shown }
import { SKILL_ORDER, canSpend } from './tessieBounty.js';

export const LEVEL_UP = Object.freeze({
  kind: 'tip.tessie.level',   // its lean kind (a TIP that comes back: leanSkipper.js LEAN_REPEAT)
  lineS: 7,                   // s: the skipper's note stays up this long (src/ui/controlsHint.js), the pick's window
  stillS: 2,                  // s she must be still before a waiting point's line comes back
  everyS: 60,                 // s at least between two showings of a waiting point's line (no cap on how many)
  askS: 1,                    // s between two asks while the lean skipper refuses
  line: (level) => `Level ${level}: pick one skill to grow.`,
});
// the skills a point can go to now (the halo), in the slots' order
export const pickable = (s) => (s && s.points > 0 ? SKILL_ORDER.filter((id) => canSpend(s, id) == null) : []);

export function createLevelUp({ bounty, P = LEVEL_UP } = {}) {
  let t = 0, want = false, lineAt = null, lastLine = -Infinity, stillT = 0, wait = 0, shown = 0;
  const read = () => { try { return bounty?.state?.() ?? null; } catch { return null; } };
  const close = () => { lineAt = null; };
  const api = {
    // a level reached (one or more): the line asks at once
    levelUp() { want = true; },
    // the clock: still (she is at rest this step), say(text) → true when the line was taken, lineUp (false: the line is gone)
    step(dt, { still = false, say = null, lineUp = null } = {}) {
      if (!(dt > 0)) return;
      t += dt; wait -= dt;
      stillT = still ? stillT + dt : 0;
      if (lineAt != null && (t - lineAt >= P.lineS || lineUp === false)) close();
      const s = read();
      if (!s || s.points <= 0) { want = false; close(); return; }
      const due = want || (stillT >= P.stillS && t - lastLine >= P.everyS);
      if (!due || lineAt != null || wait > 0 || typeof say !== 'function') return;
      wait = P.askS;
      if (say(P.line(s.level))) { lineAt = t; lastLine = t; want = false; shown++; }
    },
    get open() { return lineAt != null; },
    halo: () => pickable(read()),
    // a slot pressed (its number key, a click or a tap): a pick inside the window on a glowing slot, else the skill's own press
    press(id) {
      if (lineAt == null) return { pick: false, why: 'closed' };
      const s = read(); if (!s || !pickable(s).includes(id)) return { pick: false, why: 'not-pickable' };
      const r = bounty.spend(id);
      if (!r?.ok) return { pick: false, why: r?.why ?? 'refused' };
      if (!(r.state?.points > 0)) close();   // the last point: the line's work is done
      return { pick: true, rank: r.rank, points: r.state?.points ?? 0 };
    },
    get state() { return { open: lineAt != null, lineAt, lastLine, stillT, want, shown, t }; },
  };
  return api;
}
