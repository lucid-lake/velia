// Play as Tessie, her skills (owner, 2026-11-20, every default approved). Pure: no DOM, no clock of its own
// (the controller steps it), no Math.random. The dash is the first skill; the table's shape is the only preparation for later ones (a
// sonar ping, a tail slap, a deep dive, levels:, not built).
//   const S = createSkills(SKILLS)
//   S.press(id)   a press (edge-triggered: the caller sends one per key-down): true when it fires now or is buffered (a press in the last
//                 bufferS of the cooldown fires the moment the skill is ready)
//   S.step(dt)    the clock; returns the ids that fired this step (a buffered press)
//   S.state(id)   { phase: 'ready' | 'active' | 'cool', k (its ring, 0…1: full when ready, emptying while active, refilling while cooling),
//                 t (s into the phase), level, key, buffered }
//   S.active(id)  true while it runs
//   S.list()      the skills in SKILLS order ({ id, key, level, … }): the HUD draws one slot each, the key legend one line each
//   S.free(on)    the cheat mode (v2/sim/tessieCheat.js): no cooldown (a skill is ready the moment its active phase ends; one cooling
//                 now is ready at the next step), and a skill whose rank row says refire (the Sonar: a new ping replaces the marks)
//                 fires again while still active; S.free() reads it
// The dash: Shift, a press; 1.8 s at the dash speed counted from the press, then 4.5 s of cooldown from the burst's end
// (a full cycle 6.3 s); a press in the last 0.3 s is buffered.
import { SURGE_RANKS } from './tessieSurge.js';   // the RPG's Tail Surge ranks (Tessie's own chunk: nothing on a phone reads this file)
import { BREACH_RANKS } from './tessieBreach.js';   // the RPG's Breach ranks (the same chunk)
export const SKILLS = Object.freeze({
  dash: Object.freeze({ id: 'dash', name: 'Dash', slot: 1, key: 'Shift', keys: Object.freeze(['Digit1', 'ShiftLeft', 'ShiftRight']), caps: Object.freeze(['1', '⇧']), glyph: '⇧', touch: 'slot', activeS: 1.8, cooldownS: 4.5, bufferS: 0.3, level: 1 }),
});
// the skills row works like an RPG skill bar (owner, 2026-11-21): four slots, a skill sits in its slot, a click or tap on the slot and
// the slot's number key (Digit1 … Digit4) both press it, and a skill may carry a second key (Shift for the dash, the sprint
// convention). Slots 2 to 4 are reserved: their number keys do nothing yet.
export const SLOT_COUNT = 4;
// the Tessie RPG (?tessierpg=1): five slots, one per skill in v2/sim/tessieBounty.js SKILL_ORDER (Dash, Lure, Sonar, Tail Surge,
// Breach); Digit1 … Digit5 press them. Flag off the row keeps SLOT_COUNT.
export const RPG_SLOT_COUNT = 5;
// the Dash's four ranks (the RPG; retuned so each rank is felt: rank 2 used to add 0.3 s of burst and nothing else): the burst's speed
// × 1.0 → 1.1 → 1.2 → 1.3 (under the water 19 → 20.9 → 22.8 → 24.7 m/s, at the surface 12 → 13.2 → 14.4 → 15.6), the burst and the
// cooldown 1.8/4.5 → 2.4/3.8 → 3.0/3.1 → 3.6/2.5 s (one burst under the water carries her about 34 → 50 → 68 → 89 m); rank 4 makes the dash
// bite's knockdown × 1.25 (× 1.15 below it: sim/tessie.js BITE2.dash.knock). Index = rank (0: locked, never for the Dash)
export const DASH_RANKS = Object.freeze([null,
  Object.freeze({ activeS: 1.8, cooldownS: 4.5, bite: 1.15, speedK: 1.0 }), Object.freeze({ activeS: 2.4, cooldownS: 3.8, bite: 1.15, speedK: 1.1 }),
  Object.freeze({ activeS: 3.0, cooldownS: 3.1, bite: 1.15, speedK: 1.2 }), Object.freeze({ activeS: 3.6, cooldownS: 2.5, bite: 1.25, speedK: 1.3 })]);
// her body grows a little with her level, points aside (the RPG; research § 4's growth, made big enough to feel): her cruise speed
// + 1.5 % a level from level 2, at most + 15 % (level 11 on): under the water 11 → 12.65 m/s, at the surface 6 → 6.9 m/s. She still
// moves as she does (her rates and turns unchanged); level 1 and the flag off: × 1
export const GROWTH = Object.freeze({ cruisePerLevel: 0.015, cruiseMax: 0.15 });
export const growthOf = (level = 1, G = GROWTH) => 1 + Math.min(G.cruiseMax, G.cruisePerLevel * Math.max(0, (level | 0) - 1));
// Lure's and Sonar's four ranks (the RPG, phase 3; v2/sim/tessieLure.js, tessieSonar.js): everyS is the cooldown from the press (the
// slot's ring: activeS amber, then cooldownS dim, the two summing to everyS). Lure: range 120 → 150 → 180 → 210 m, the boats curious
// 12 → 15 → 18 → 21 s, every 20 s; rank 4 also lures the Halcyon's skipper. Sonar: range 300 → 360 → 420 → 480 m, marks 8 → 10 → 12 → 14 s
// (amber while they last), every 25 s (rank 4: 15 s); rank 3 adds a heading tail to each mark
export const LURE_CAST_S = 2;   // s: the tail's flicks (the slot amber while she casts)
const lureRank = (rangeM, curiousS, halcyon = false) => Object.freeze({ rangeM, curiousS, everyS: 20, halcyon, activeS: LURE_CAST_S, cooldownS: 20 - LURE_CAST_S });
const sonarRank = (rangeM, markS, everyS, tail = false) => Object.freeze({ rangeM, markS, everyS, tail, activeS: markS, cooldownS: everyS - markS, refire: true });   // refire: the cheat's re-ping
export const LURE_RANKS = Object.freeze([null, lureRank(120, 12), lureRank(150, 15), lureRank(180, 18), lureRank(210, 21, true)]);
export const SONAR_RANKS = Object.freeze([null, sonarRank(300, 8, 25), sonarRank(360, 10, 25), sonarRank(420, 12, 25, true), sonarRank(480, 14, 15, true)]);
// Tail Surge's four ranks (the RPG, phase 4; v2/sim/tessieSurge.js): ring 40 → 48 → 56 → 64 m, knock radius 12 → 14 → 16 → 18 m,
// heel 35 → 38 → 41 → 45°, every 30 s at every rank (amber over the 1.2 s wind-up and the wave's 2 s, then dim)
export { SURGE_RANKS };
// Breach's four ranks (the RPG, phase 5; v2/sim/tessieBreach.js): cooldown 60 → 52 → 45 → 40 s from the press (amber over the run and the
// arc, BREACH.activeS), landing window 3 → 4 → 5 → 6 m
export { BREACH_RANKS };
export const SKILL_RANKS = Object.freeze({ dash: DASH_RANKS, lure: LURE_RANKS, sonar: SONAR_RANKS, surge: SURGE_RANKS, breach: BREACH_RANKS });
// the RPG's own skills table for the slots after the Dash (their rings; flag off nothing reads it): rank 1's numbers until rank() sets theirs
export const RPG_SKILLS_TABLE = Object.freeze({
  lure: Object.freeze({ id: 'lure', name: 'Lure', slot: 2, keys: Object.freeze(['Digit2']), bufferS: 0, level: 1, ...LURE_RANKS[1] }),
  sonar: Object.freeze({ id: 'sonar', name: 'Sonar', slot: 3, keys: Object.freeze(['Digit3']), bufferS: 0, level: 1, ...SONAR_RANKS[1] }),
  surge: Object.freeze({ id: 'surge', name: 'Tail Surge', slot: 4, keys: Object.freeze(['Digit4']), bufferS: 0, level: 1, ...SURGE_RANKS[1] }),
  breach: Object.freeze({ id: 'breach', name: 'Breach', slot: 5, keys: Object.freeze(['Digit5']), bufferS: 0, level: 1, ...BREACH_RANKS[1] }),
});
// the skill a key code presses (null: none, including a reserved slot's number)
export const skillOfCode = (code, table = SKILLS) => Object.values(table).find((r) => r.keys?.includes(code))?.id ?? null;
// the slot's label: "1 · ⇧" for the dash, "2" for a reserved slot (n: 1 … 4)
export const slotLabel = (n, table = SKILLS) => { const r = Object.values(table).find((x) => x.slot === n); return r ? [String(n), ...(r.caps ?? []).slice(1)].join(' · ') : String(n); };

export function createSkills(table = SKILLS) {
  const rows = Object.values(table).map((r) => ({ ...r, phase: 'ready', t: 0, buffered: false }));
  const by = new Map(rows.map((r) => [r.id, r]));
  const fire = (r) => { r.phase = 'active'; r.t = 0; r.buffered = false; r.count = (r.count ?? 0) + 1; };
  let free = false;   // the cheat mode: no cooldowns
  return {
    press(id) {
      const r = by.get(id); if (!r) return false;
      if (r.phase === 'ready' || (free && (r.phase === 'cool' || (r.phase === 'active' && r.refire)))) { fire(r); return true; }
      if (r.phase === 'cool' && r.cooldownS - r.t <= r.bufferS) { r.buffered = true; return true; }
      return false;
    },
    step(dt) {
      const fired = [];
      if (!(dt > 0)) return fired;
      for (const r of rows) {
        if (r.phase === 'ready') continue;
        r.t += dt;
        if (r.phase === 'active' && r.t >= r.activeS) { r.phase = 'cool'; r.t -= r.activeS; }
        if (free && r.phase === 'cool') { r.phase = 'ready'; r.t = 0; if (r.buffered) { fire(r); fired.push(r.id); } continue; }
        if (r.phase === 'cool' && r.t >= r.cooldownS) {
          const over = r.t - r.cooldownS;
          r.phase = 'ready'; r.t = 0;
          if (r.buffered) { fire(r); r.t = over; fired.push(r.id); }
        }
      }
      return fired;
    },
    state(id) {
      const r = by.get(id); if (!r) return null;
      const k = r.phase === 'ready' ? 1 : r.phase === 'active' ? Math.max(0, 1 - r.t / r.activeS) : Math.min(1, r.t / r.cooldownS);
      return { phase: r.phase, k, t: r.t, level: r.level, key: r.key, buffered: r.buffered, count: r.count ?? 0, bite: r.bite ?? null, speedK: r.speedK ?? 1 };   // bite: the rank's knock (null: no rank set, the bite's own); speedK: the burst's speed by rank
    },
    active: (id) => by.get(id)?.phase === 'active',
    // the RPG: a skill's rank (1 … 4) sets its numbers from SKILL_RANKS (the burst, the cooldown, the bite's knock); false: no such rank.
    // A phase under way keeps its clock: the new numbers apply from now
    rank(id, n) {
      const r = by.get(id), row = SKILL_RANKS[id]?.[n]; if (!r || !row) return false;
      Object.assign(r, row, { level: n });
      return true;
    },
    free(on) { if (on !== undefined) free = !!on; return free; },
    reset() { for (const r of rows) { r.phase = 'ready'; r.t = 0; r.buffered = false; } },
    list: () => rows.map(({ phase, t, buffered, ...r }) => r),
  };
}
