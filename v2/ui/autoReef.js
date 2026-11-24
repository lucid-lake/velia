// The reef selector "A · 0 · 1 · 2", one state per mode (owner, 2026-11-17: "off by default in Sail and Regatta, but on in Cruise",
// then one selector that merges auto-reef and the manual reef). A: the boat picks none, one or two reefs (ctl.autoReef; the
// boom's roll shows them). 0, 1, 2: the player's reef, held (0: full sail). Cruise is a hands-off autopilot, so it starts on A.
//   REEF_DEFAULTS            { sail: 0, regatta: 0, cruise: 'A' }
//   createReefStore({ storage })   .get(mode) → 'A' | 0 | 1 | 2   .set(mode, v)   .chosen(mode)   the player's choices, per mode
//   nextReef(v)              a click: A → 0 → 1 → 2 → A
//   keyReef(v, level)        K: 0 → 1 → 2 → 0; from A it holds the level the boat has now, then steps on the next press
//   reefWords(v, level)      the tip and spoken label: "reef: auto (one in)", "reef: two in", "reef: none"
// Storage: its own key, only the modes the player changed (a later change of a default reaches everyone else). The old global
// setting 'autoReef' of the shared store (v1's, default on) is not read by v2: an old "on" cannot be told from the old default;
// v1 keeps reading it. Setup has no auto-reef row on v2 (the selector is its only place).
export const REEF_VALUES = Object.freeze(['A', 0, 1, 2]);
export const REEF_DEFAULTS = Object.freeze({ sail: 0, regatta: 0, cruise: 'A' });
export const REEF_KEY = 'velia.reef.v2';
const modeId = (m) => (m in REEF_DEFAULTS ? m : 'sail');
const valid = (v) => REEF_VALUES.includes(v);

export function createReefStore({ storage = globalThis.localStorage } = {}) {
  let saved = {};
  try { const j = JSON.parse(storage?.getItem(REEF_KEY) ?? '{}'); if (j && typeof j === 'object') for (const k of Object.keys(REEF_DEFAULTS)) if (valid(j[k])) saved[k] = j[k]; } catch { saved = {}; }
  return {
    get: (m) => saved[modeId(m)] ?? REEF_DEFAULTS[modeId(m)],
    chosen: (m) => modeId(m) in saved,
    set(m, v) {
      if (!valid(v)) return;
      saved[modeId(m)] = v;
      try { storage?.setItem(REEF_KEY, JSON.stringify(saved)); } catch { /* private window: kept in memory */ }
    },
  };
}

export const nextReef = (v) => REEF_VALUES[(REEF_VALUES.indexOf(v) + 1) % REEF_VALUES.length];
export const keyReef = (v, level = 0) => (v === 'A' ? Math.max(0, Math.min(2, Math.round(level))) : (v + 1) % 3);
const IN = ['none in', 'one in', 'two in'];
export const reefWords = (v, level = 0) => (v === 'A' ? `reef: auto (${IN[Math.max(0, Math.min(2, Math.round(level)))]})` : v === 0 ? 'reef: none' : `reef: ${IN[v]}`);
// the cockpit selector's place, 0 … 1 over its four stops: A, 0, 1, 2 at 0, ⅓, ⅔, 1; its lamp lights amber on A (render/cockpit/rig.js)
export const reefLever = (v) => (v === 'A' ? 0 : (v + 1) / 3);
