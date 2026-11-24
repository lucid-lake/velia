// v2's play counts: v1's own src/metrics.js (the same events, fields, endpoint /api/e and rules: nothing from a headless page,
// an automated browser, Do Not Track, Global Privacy Control, ?notrack, ?metrics=0 or a local host), so the owner's Velia
// numbers keep counting once v2 is the main page. No new event, no new field, no key. v1's DOM modules that v2 runs already
// call track() (home.js set_sail and support_click, viewSwitch.js music_next); they were no-ops until startMetrics() ran.
// v2's own engagement events (2026-11-19, v2/ui/engagement.js): sailed_2min and race_finished, the funnel's last two steps.
// goal_reached (firstSailGuide.js) never fires on v2: v2 sets no island goal (2026-11-16); the event stays in the schema
// (src/metrics.js, functions/api/e.js, tools/velia_report.py's funnel) because v1 at /classic/ still sends it. Here: the mapping from v2's facts to v1's coarse labels.
//   startPageMetrics()                       v2/start.js, first thing (js_error, session_end come with it)
//   track(name, props)                       v1's
//   sessionProps({ mode, signals, level, firstVisit, lang, display })   → session_start's fields (display: displayOf())
export { startMetrics as startPageMetrics, track, gpuClass } from '../../src/metrics.js';
import { gpuClass } from '../../src/metrics.js';
import { formOf } from '../../src/core/profile.js';

// v2's quality level → v1's tier labels (the server's enum: auto | high | balanced | low)
export const tierOf = (level) => (level == null ? 'auto' : level <= 0 ? 'high' : level === 1 ? 'balanced' : 'low');
// engine/quality.js readSignals' phone / tablet → v1's device labels (phone | tablet | desktop)
export const deviceOf = (s = {}) => (s.phone ? 'phone' : s.tablet ? 'tablet' : 'desktop');
// the device profile's form rule (src/core/profile.js formOf) from loose facts (the page itself reads profile.get().form)
export function guessDevice({ ua = '', touch = 0, coarse = false, w = 1280, h = 720, platform = '' } = {}) {
  return formOf({ ua, platform, touchPoints: touch, coarse, screenW: w, screenH: h });
}
// how the page was opened (session_start's display): a Home Screen launch in full screen or standalone (iOS:
// navigator.standalone), else a browser tab
export function displayOf({ win = globalThis } = {}) {
  const mm = (q) => { try { return !!win.matchMedia?.(q)?.matches; } catch { return false; } };
  if (mm('(display-mode: fullscreen)')) return 'fullscreen';
  if (mm('(display-mode: standalone)') || win.navigator?.standalone === true) return 'standalone';
  return 'browser';
}
export function sessionProps({ mode = 'sail', signals = {}, level = null, firstVisit = false, lang = 'en', display = 'browser' } = {}) {
  return { mode, device: deviceOf(signals), backend: 'webgpu', tier: tierOf(level), first_visit: !!firstVisit, lang, display,
    gpu: gpuClass({ vendor: signals.vendor ?? '', renderer: `${signals.architecture ?? ''} ${signals.description ?? ''}`, fallback: !!signals.fallback }) };
}
