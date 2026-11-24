// Regatta's levels (BACKLOG-v2 #12 R3): Beginner, Club, Pro, what each turns on, and the stored choice. Pure but
// for the optional store (localStorage, `LEVEL_KEY`); tiny, so Setup's row (ui/front.js) reads it without the race's chunk.
// v2/tests/regatta-r3.test.mjs.
//   LEVELS[id]             the plan's table: the start helper, the ghost and its path, the laylines, the zone, the turn arrow, the
//                          coach ('all' | 'mistakes' | 'off'), the penalties (forgiving: none), the rivals' tier (v1's TIERS)
//   pace                   R4 (the owner's pacing note, 2026-11-14): the race's game speed, × real time (the clock, the rivals, the wind
//                          and the physics together: main.js's clock runs the fixed 1/60 s ticks faster). Beginner and Club 2 × (Cruise's,
//                          a race of about 3 minutes); Pro 1.5 ×: a Pro reads the laylines, the shifts and the crossings alone, with no
//                          coach and no lines lit; a third more real time to judge each call, and still under 4 minutes
//   aidsFor(id, { laylines })  the aids a race shows at a level (Pro's laylines are the player's option, off by default)
//   loadLevel(store) → { level, laylines, chosen }   saveLevel(store, { level, laylines })
export const LEVEL_IDS = Object.freeze(['beginner', 'club', 'pro']);
export const LEVELS = Object.freeze({
  beginner: Object.freeze({ id: 'beginner', label: 'Beginner', helper: true, ghost: true, ghostPath: true, laylines: true, zone: true, turnArrow: true, coach: 'all', forgiving: true, tier: 'easy', pace: 2,
    line: 'Every aid: the helper, the gold boat, the laylines, the coach.' }),
  club: Object.freeze({ id: 'club', label: 'Club', helper: false, ghost: true, ghostPath: false, laylines: true, zone: true, turnArrow: false, coach: 'mistakes', forgiving: false, tier: 'medium', pace: 2,
    line: 'No helper. The coach speaks up for mistakes. Penalty turns count.' }),
  pro: Object.freeze({ id: 'pro', label: 'Pro', helper: false, ghost: false, ghostPath: false, laylines: 'option', zone: true, turnArrow: false, coach: 'off', forgiving: false, tier: 'hard', pace: 1.5,
    line: 'The line, the zone and the marks. Sharp rivals.' }),
});
export const DEFAULT_LEVEL = 'beginner';
export const LEVEL_KEY = 'lakeshore.regatta.level.v1';
export const levelOf = (id) => LEVELS[id] ?? LEVELS[DEFAULT_LEVEL];

export function aidsFor(id, { laylines = false } = {}) {
  const L = levelOf(id);
  return { level: L.id, helper: L.helper, ghost: L.ghost, ghostPath: L.ghostPath, laylines: L.laylines === 'option' ? !!laylines : L.laylines, zone: L.zone, turnArrow: L.turnArrow,
    coach: L.coach, forgiving: L.forgiving, tier: L.tier, pace: L.pace, laylinesOption: L.laylines === 'option' };
}

export function loadLevel(store = globalThis.localStorage) {
  try {
    const j = JSON.parse(store?.getItem(LEVEL_KEY) ?? 'null');
    if (j && LEVELS[j.level]) return { level: j.level, laylines: !!j.laylines, chosen: true };
  } catch { /* private mode, or a broken value */ }
  return { level: DEFAULT_LEVEL, laylines: false, chosen: false };
}
export function saveLevel(store = globalThis.localStorage, { level, laylines = false } = {}) {
  const o = { level: LEVELS[level] ? level : DEFAULT_LEVEL, laylines: !!laylines };
  try { store?.setItem(LEVEL_KEY, JSON.stringify(o)); } catch { /* full or blocked */ }
  try { globalThis.dispatchEvent?.(new CustomEvent('velia:regatta-level', { detail: o })); } catch { /* node */ }
  return o;
}
