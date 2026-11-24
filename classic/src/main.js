// Lakeshore's entry: boots the core (src/core/: renderer, sky, world, loop, capture contract) and loads the mode the
// URL names with a dynamic import(), so each mode is its own chunk.
//   ?mode=sail   Sail (src/modes/daysail/)
//   ?mode=regatta Regatta (src/modes/regatta/): the Island Sprint against Osprey
//   ?mode=cruise Cruise (src/modes/chill/): Sail on a safe autopilot, the music on (old values chill, daysail, racing still work: src/modeNames.js)
//   otherwise   Sail on a live page (owner, 2026-10-30: the bare URL showed no boat); fly, the dev mode, for headless
//               captures and goldens (their URLs carry cam=…) or ?mode=fly
// Deterministic by URL: ?hour=6.5&cam=A&seed=1&exposure=6&headless=1 (the capture tool relies on this).
// The services registry (src/core/services.js) is the page's one shared place; window.__lakeshore is its read-only
// mirror for the headless capture and the tools: ready, then renderOnce(), stats(), camera (+ boat, hint in Sail).
import { boot } from './core/index.js';
import { createServices } from '../../src/sim/core/services.js';
import { installMirror } from './core/mirror.js';
import { flags, stageFlags } from '../../src/sim/core/params.js';
import { FLAGS, withFlags } from '../../src/sim/core/flags.js';
import { isShare, shareOverrides } from '../../src/fireworks/share.js';
import { modeId } from '../../src/modeNames.js';
import { modeLoaders } from './modes/registry.js';
import { touchInit } from '../../src/ui/touchUi.js';
import { startMetrics, track, deviceClass, loadSteps } from '../../src/metrics.js';
import { importRetry, isImportError, reloadFresh, dropFresh } from './core/importRetry.js';
import { deviceKindNow } from '../../src/ui/device.js';
import { skyStepOf } from './core/skyGuard.js';
import { decideFirstVisit, stageParams, SETTINGS_KEY } from '../../src/ui/firstVisit.js';
import { diagState } from './ui/diag.js';

touchInit();   // a phone or tablet: safe areas and finger-sized pieces for every mode (src/ui/touchUi.js)
dropFresh();   // a page reloaded after a failed import (src/core/importRetry.js) takes ?fresh off its address

// each mode's chunk, from the mode registry (src/modes/registry.js); a failed import is tried once more (perf/phone-load: a
// phone network, or an upload mid-load); a dev mode's loader is marked .dev: the menu does not fetch it ahead (src/shell.js)
const MODES = modeLoaders(importRetry);
// the staged first visit (src/ui/firstVisit.js, src/ui/firstStage.js): a true first visit sails straight onto the lake;
// decided here, before the core reads the start pose. ?first=1 forces it, ?first=0 turns it off.
let firstVisit = null;
{
  let stored = null; try { stored = globalThis.localStorage?.getItem(SETTINGS_KEY) ?? null; } catch { /* private mode */ }
  const fv = decideFirstVisit({ flags: FLAGS, stored, webdriver: !!navigator.webdriver });
  if (fv.stage) stageFlags(stageParams(flags));
  firstVisit = fv;
}
// the share link, ?show=fireworks (S5; src/fireworks/share.js): Cruise on the show's day, the boat at anchor at
// the viewing spot a minute before the show; staged here, as the first visit's start, before the core reads the flags
if (isShare(flags)) stageFlags(withFlags(flags, shareOverrides(flags)));
const modeNow = modeId(flags.mode) ?? (flags.headless != null ? 'fly' : 'sail');
const mode = (MODES[modeNow] ?? MODES.fly)();   // fetched while the GPU starts
mode.catch(() => {});   // a failure is the boot's to tell (load_fail 'reload' or 'error' below), not an unhandled rejection's js_error

const services = createServices();
installMirror(services);
services.provide('diag', diagState());   // the diag counters from the start (the boot provides the same object again); tools: window.__lakeshore.diag
services.provide('firstVisit', firstVisit);   // the staged first visit's decision (src/shell.js reads it)
const ready = services.provide('ready', boot(mode, { services }));
// anonymous play counts (src/metrics.js): off for headless pages, Do Not Track and ?notrack. A load that never reached
// its first frame is told as load_fail with the last stage it passed (when the page is left, or on a boot error).
startMetrics();
// which visitors fail (perf/shader-warmup): the device class, the backend (wanted, before the renderer is up) and the GPU's coarse class
const who = () => { const d = services.get('diag'); return { device: deviceClass(deviceKindNow()), backend: d?.backend ?? d?.backendWanted, gpu: d?.gpuClass || undefined }; };
// load_fail (perf/phone-load) says why: the visitor left ('left': the page hidden or closed before its first frame; on
// iOS the hide is the last event a page reliably gets), the 90 s timeout ('timeout'), a boot error ('error'), a failed
// module import that reloads the page once ('reload'), or the last load ended without a word ('killed'); with the ms
// since navigation and each stage's seconds (loadSteps). A load told 'left' that still reaches its first frame (the
// visitor came back) sends load_late, so the report can tell those who left from those who only looked away.
const diagNow = () => services.get('diag');
const stepsNow = () => { const L = window.__veliaLoading; return loadSteps({ stages: L?.log ?? [], t0: L?.t0 ?? 0, steps: diagNow()?.steps ?? [], now: performance.now() }); };
{
  let loaded = false, told = null;
  // the sky stage names its step (fix/sky-load: 'sky:compile' is the first frame's shader build, src/core/index.js)
  const lastStage = () => { const s = String((window.__veliaLoading?.log ?? []).at(-1)?.[0] ?? 'start'); return s === 'sky' ? skyStepOf(diagNow()?.bootStep) : s; };
  const failed = (why, stage) => {
    if (loaded || told) return;
    told = why;
    track('load_fail', { stage: stage ?? lastStage(), why, ms: performance.now(), steps: stepsNow(), ...who() });
  };
  addEventListener('pagehide', () => failed('left'));
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') failed('left'); });
  ready.then(() => { loaded = true; if (told === 'left') track('load_late', { ms: performance.now() }); }, (e) => {
    const msg = `boot: ${e?.message ?? e}`;
    diagNow()?.error?.('boot', msg);
    // a chunk that would not import, twice: reload once with a fresh address (an upload replaced the chunks mid-load)
    failed(isImportError(e) && !told && reloadFresh() ? 'reload' : 'error', msg);
  });
  setTimeout(() => failed('timeout'), 90e3);   // 90 s and still no first frame
}
ready.then((api) => {
  // the core's api: renderOnce, stats, camera, core … but not its switchMode(module): the 'switchMode' service is the
  // shell's switch by id (src/shell.js); the core's stays at services.get('core').switchMode
  for (const [k, v] of Object.entries(api ?? {})) if (k !== 'switchMode') services.provide(k, v);
  if (api?.diag?.safeMode) track('load_fail', { stage: 'previous_load', why: 'killed', ...who() });   // iOS ended the last load without a word (the boot guard's mark)
  // ?diag=1: the owner's on-page readout (fps, sim ticks, speed, stages, GPU memory, the last error; src/ui/diag.js)
  if (flags.diag === '1' && flags.headless == null) import('./ui/diag.js').then(({ mountDiag }) => mountDiag({ services }));
  // the shell (src/shell.js): the menu (Esc, ≡), the settings and the mode switch in play; live pages only (captures
  // and goldens never see it). ?menu=0 leaves it out.
  if (flags.headless == null && flags.menu) {
    const current = MODES[modeNow] ? modeNow : 'fly';
    import('./shell.js').then(({ installShell }) => installShell({ services, modes: MODES, current }));
  }
}, () => { /* a boot error: told above (load_fail, the diag's last error) */ });
