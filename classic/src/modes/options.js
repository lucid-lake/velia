// The mode options schema (refactor round 2, Phase C step 4): one checked
// table of what a mode's coreOptions(flags) may say (src/modes/README.md § The interface). The core checks the options at boot
// and on a switch (src/core/index.js). A bad option fails loudly in dev (the Vite dev server, node tests: it throws) and falls
// back safely in a build: the bad key is dropped (its reader's default applies, as for a mode that never said it) and one
// console.error names it. Plain JS, no DOM.
//   const options = checkModeOptions(mode.coreOptions?.(flags) ?? {}, { mode: 'sail' });
// Absent keys stay absent: each reader keeps its own default (hud 'calm', card 'sail', Shift+F full screen …).
import { CARDS } from './registry.js';

const fn = (v) => typeof v === 'function';
const hourOk = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 24;
// key → [test(value), what it must be]
export const MODE_OPTIONS = Object.freeze({
  hud: [(v) => ['full', 'calm', 'instruments', 'clear'].includes(v), "the Calm HUD's default: 'full' | 'calm' | 'instruments' | 'clear' (src/ui/calmHud.js)"],
  card: [(v) => CARDS.includes(v), `the loading card's look: ${CARDS.map((c) => `'${c}'`).join(' | ')} (src/modes/registry.js CARDS)`],
  stage: [(v) => typeof v === 'boolean', 'the staged first visit plays here: a boolean (src/ui/firstStage.js)'],
  firstSail: [(v) => v === null || v === 'goal' || v === 'offer', "the first sail: 'goal' | 'offer' | null (src/ui/firstSail.js)"],
  fullscreenKey: [(v) => typeof v === 'boolean', 'Shift+F is full screen: a boolean (src/shell.js)'],
  defaultHour: [hourOk, "the ?hour default: a string hour 0–24, e.g. '18.75'"],
  timeRate: [(v) => Number.isFinite(v) && v >= 0, 'game seconds per scene second: a number ≥ 0'],
  timeSchedule: [(v) => v === null || fn(v) || (typeof v === 'object' && v !== null), 'the day clock: a schedule (hour → rate, or a table) or null (src/timeOfDay.js)'],
  wind: [(v) => v === null || fn(v), "wind(hour) → the WindField's options, or null for the base wind"],
  createWake: [(v) => v === null || fn(v), 'a wake factory, or null'],
  ownFireworks: [(v) => typeof v === 'boolean', "the mode draws its own show (the core's stays out): a boolean"],
});

// dev: throw on a bad option; else drop it with one console.error. Vite sets import.meta.env.DEV; node has no env: dev.
export const isDev = () => import.meta.env?.DEV ?? true;

// → the options, checked: the same object when every key is good; a copy without the bad keys when not (a build)
export function checkModeOptions(options, { mode = '?', dev = isDev(), report = (m) => console.error(m) } = {}) {
  if (options == null) return {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    const msg = `mode ${mode}: coreOptions() must return an object, not ${Array.isArray(options) ? 'an array' : typeof options}`;
    if (dev) throw new Error(msg);
    report(msg); return {};
  }
  const bad = [];
  for (const [k, v] of Object.entries(options)) {
    const row = MODE_OPTIONS[k];
    if (!row) bad.push([k, `unknown option '${k}' (known: ${Object.keys(MODE_OPTIONS).join(', ')})`]);
    else if (v !== undefined && !row[0](v)) bad.push([k, `option '${k}' is ${JSON.stringify(v) ?? typeof v}: ${row[1]}`]);
  }
  if (!bad.length) return options;
  const msg = `mode ${mode}: ${bad.map(([, m]) => m).join('; ')}`;
  if (dev) throw new Error(msg);
  report(`${msg} (dropped; the defaults apply)`);
  const out = { ...options };
  for (const [k] of bad) delete out[k];
  return out;
}
