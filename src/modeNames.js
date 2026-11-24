// The modes' public names (owner, 2026-10-29): Cruise (was Chill), Sail (was Day Sail), Regatta (was Racing), School
// (was Sailing School). The ids are the ?mode= values; the old values still work as aliases (modeId below).
// Folder names keep the old words (src/modes/chill = Cruise, src/modes/daysail = Sail). The names and aliases are the
// mode registry's rows (src/modes/registry.js; their pure half, src/modes/rows.js, so nothing here reaches a mode's code).
import { MODE_NAMES as MODE_ROWS } from './modes/rows.js';

export const MODE_LABELS = Object.fromEntries(MODE_ROWS.map((r) => [r.id, r.label]));
const ALIASES = Object.fromEntries(MODE_ROWS.flatMap((r) => r.aliases.map((a) => [a, r.id])));

// ?mode= value (any case, old or new) -> the id, or null
export function modeId(v) {
  if (v == null) return null;
  const s = String(v).toLowerCase();
  return ALIASES[s] ?? (s in MODE_LABELS ? s : null);
}
