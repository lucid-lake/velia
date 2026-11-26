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
// The dash: Shift, a press; 1.8 s at the dash speed counted from the press, then 4.5 s of cooldown from the burst's end
// (a full cycle 6.3 s); a press in the last 0.3 s is buffered.
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
// the Dash's four ranks (the RPG): the burst and the cooldown 1.8/4.5 → 2.1/4.0 → 2.4/3.5 → 2.6/3.0 s; rank 4 makes the dash bite's
// knockdown × 1.25 (× 1.15 below it: sim/tessie.js BITE2.dash.knock). Index = rank (0: locked, never for the Dash)
export const DASH_RANKS = Object.freeze([null,
  Object.freeze({ activeS: 1.8, cooldownS: 4.5, bite: 1.15 }), Object.freeze({ activeS: 2.1, cooldownS: 4.0, bite: 1.15 }),
  Object.freeze({ activeS: 2.4, cooldownS: 3.5, bite: 1.15 }), Object.freeze({ activeS: 2.6, cooldownS: 3.0, bite: 1.25 })]);
export const SKILL_RANKS = Object.freeze({ dash: DASH_RANKS });
// the skill a key code presses (null: none, including a reserved slot's number)
export const skillOfCode = (code, table = SKILLS) => Object.values(table).find((r) => r.keys?.includes(code))?.id ?? null;
// the slot's label: "1 · ⇧" for the dash, "2" for a reserved slot (n: 1 … 4)
export const slotLabel = (n, table = SKILLS) => { const r = Object.values(table).find((x) => x.slot === n); return r ? [String(n), ...(r.caps ?? []).slice(1)].join(' · ') : String(n); };

export function createSkills(table = SKILLS) {
  const rows = Object.values(table).map((r) => ({ ...r, phase: 'ready', t: 0, buffered: false }));
  const by = new Map(rows.map((r) => [r.id, r]));
  const fire = (r) => { r.phase = 'active'; r.t = 0; r.buffered = false; r.count = (r.count ?? 0) + 1; };
  return {
    press(id) {
      const r = by.get(id); if (!r) return false;
      if (r.phase === 'ready') { fire(r); return true; }
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
      return { phase: r.phase, k, t: r.t, level: r.level, key: r.key, buffered: r.buffered, count: r.count ?? 0, bite: r.bite ?? null };   // bite: the rank's knock (null: no rank set, the bite's own)
    },
    active: (id) => by.get(id)?.phase === 'active',
    // the RPG: a skill's rank (1 … 4) sets its numbers from SKILL_RANKS (the burst, the cooldown, the bite's knock); false: no such rank.
    // A phase under way keeps its clock: the new numbers apply from now
    rank(id, n) {
      const r = by.get(id), row = SKILL_RANKS[id]?.[n]; if (!r || !row) return false;
      Object.assign(r, row, { level: n });
      return true;
    },
    reset() { for (const r of rows) { r.phase = 'ready'; r.t = 0; r.buffered = false; } },
    list: () => rows.map(({ phase, t, buffered, ...r }) => r),
  };
}
