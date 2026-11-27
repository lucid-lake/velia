// Play as Tessie, the cheat mode (the Tessie RPG; Tessie's own chunk: a phone loads none of it). Pure: no DOM, no clock, no
// Math.random. Every skill unlocked at rank 4, no cooldowns, no free trial spent, and the real save never touched: while the cheat is
// on, the player's bounty reads and writes a copy in memory (her XP and level as the save had them when it came on); whatever she
// earns in it is dropped when it goes off or the page closes. The save's own key is only read, never written, while it is on.
//   on        ?tessiecheat=1 (v2/engine/flags.js), or the code typed while she is played: G R U F F (CHEAT.code). Its letters are none
//             of her controls (W A S D, the arrows, E Q, C, T, Space, 1 to 5, Shift) and all of them are keys she swallows anyway
//             (living/tessiePlayer.js INERT), so typing it moves nothing and reaches no boat key. The same code turns it off
//   the line  the skipper's line says CHEAT.on / CHEAT.off (its kind CHEAT.kind: a MUST, the answer to the player's own keys)
//   const K = createCheatCode();   K.feed(code) → true when the code is complete (a wrong key restarts it; its first letter starts again)
//   const B = cheatBounty(real, { on: () => bool, storage });   B has the bounty's interface (state, legend, score, can, spend, trial,
//             trialsLeft); off it is the real one, on the memory copy
import { BOUNTY, SKILL_ORDER, migrate, scoreInto, legendOf } from './tessieBounty.js';

export const CHEAT = Object.freeze({
  code: Object.freeze(['KeyG', 'KeyR', 'KeyU', 'KeyF', 'KeyF']),   // "gruff"
  word: 'gruff',
  kind: 'tessie.cheat',
  on: 'Cheat on: every skill, no cooldown.',
  off: 'Cheat off.',
  rank: BOUNTY.rankCap,
});

export function createCheatCode(code = CHEAT.code) {
  let i = 0;
  return {
    feed(k) {
      if (k === code[i]) { i++; if (i === code.length) { i = 0; return true; } return false; }
      i = k === code[0] ? 1 : 0;
      return false;
    },
    get at() { return i; },
    reset() { i = 0; },
  };
}

// a save seen through the cheat: every skill at rank 4, no point to spend (the halo stays dark), the trials as they were
const cheatView = (save) => ({ ...save, ranks: Object.fromEntries(SKILL_ORDER.map((id) => [id, CHEAT.rank])), points: 0, byType: Object.fromEntries(Object.entries(save.byType).map(([k, v]) => [k, { ...v }])), trials: { ...save.trials }, sets: [...save.sets] });

export function cheatBounty(real, { on = () => false, storage = null } = {}) {
  let mem = null;   // the cheat's copy, made when it comes on, dropped when it goes off
  const read = () => {
    if (!on()) { mem = null; return null; }
    if (!mem) {
      let raw = null, knocks = null;
      try { raw = storage?.getItem(BOUNTY.key) ?? null; knocks = storage?.getItem(BOUNTY.knocksKey) ?? null; } catch { /* no store: a fresh save */ }
      mem = cheatView(storage ? migrate(raw, knocks).save : real.state());   // read only: a migration is never written from here
    }
    return mem;
  };
  return {
    get cheat() { return on(); },
    state: () => read() ?? real.state(),
    legend: () => { const s = read(); return s ? legendOf(s) : real.legend(); },
    score(hit, opts = {}) {
      const s = read(); if (!s) return real.score(hit, opts);
      // scored into the copy as the real save would be (the XP, the level, the records), then seen through the cheat again
      const tmp = { ...s, ranks: { ...s.ranks } }, r = scoreInto(tmp, hit, opts); if (!r) return null;   // its ranks are all spent: the derived points go negative (read as 0 below)
      mem = cheatView(tmp);
      return { ...r, state: mem };
    },
    can: (id) => (read() ? 'max' : real.can(id)),
    spend: (id) => { const s = read(); return s ? { ok: false, why: 'max', state: s } : real.spend(id); },
    trial: (id) => { const s = read(); return s ? { ok: false, why: 'unlocked', left: s.trials[id] ?? 0, state: s } : real.trial(id); },
    trialsLeft: (id) => (read() ? 0 : real.trialsLeft(id)),
  };
}
