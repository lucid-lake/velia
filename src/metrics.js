// Anonymous play counts (feat/metrics, 2026-10-31). What it is:
//   track(name, props)   queue one event; batched, sent with navigator.sendBeacon to /api/e on the same origin
//                        (functions/api/e.js: a Pages Function that writes to Workers Analytics Engine). Fails silently.
// What it is not: no cookie, no id stored on the device, no IP, no account. The server counts unique daily users itself
// (a hash of IP + browser + a salt that rotates every day; the IP is never stored). first_visit comes from the game's
// own `welcomed` setting. Nothing is sent: headless pages (captures, goldens, probes), an automated browser, Do Not
// Track or Global Privacy Control, ?notrack, ?metrics=0, or a local/dev host (?metrics=1 forces it on for a test).
// The event names and the fields each may carry are in EVENTS below; the server enforces the same list.
//   startMetrics({ ... })  once, from src/main.js on a live page; before that track() is a no-op (tests, tools)
//   createMetrics({ env, send, ... })  the pure core (tests/metrics.test.mjs)

import { toFlags } from './sim/core/flags.js';
const ENDPOINT = '/api/e';
export const LIMITS = { bodyBytes: 4096, batch: 20, queue: 40, flushMs: 5000, str: 120, file: 80, steps: 200 };
// event -> the props it may carry (the server drops the rest). Every field is a coarse label or a number: no ids, no text the player typed.
export const EVENTS = {
  session_start: ['mode', 'device', 'backend', 'tier', 'first_visit', 'lang', 'gpu', 'display'],   // display: optional (v2 sends it; v1 does not): DISPLAY_MODES
  set_sail: ['mode'],
  mode_change: ['from', 'to'],
  goal_reached: [],   // v1 only (the island goal); v2 sets none and sends sailed_2min and race_finished instead
  sailed_2min: ['mode'],   // v2: 2 minutes of visible play in Sail, Cruise or Regatta, once a session (v2/ui/engagement.js)
  race_finished: ['race'],   // v2: a finish line crossed: a place race's id or the course's event kind (a DNF sends nothing)
  first_beat: ['beat'],   // the staged first visit reached a beat (FIRST_BEATS; src/ui/firstStage.js): how far newcomers get
  music_next: ['mode'],   // the bar's next-song tap, with the mode it was tapped in
  support_click: ['source'],   // a press on a Support Velia link (Ko-fi, a plain link): where it was (SUPPORT_SOURCES); nothing about the player
  regatta_finish: ['place', 'level'],
  session_end: ['duration_s'],
  // device, backend, gpu: which visitors fail (perf/shader-warmup). why: left | timeout | error | killed | reload (LOAD_WHY);
  // ms: since navigation; steps: each loading stage's and boot step's seconds (loadSteps) (perf/phone-load)
  load_fail: ['stage', 'device', 'backend', 'gpu', 'why', 'ms', 'steps'],
  load_late: ['ms'],   // a load told as 'left' (the tab hidden) that still reached its first frame: subtract it from the leavers
  sky_fallback: ['reason'],   // the sky's LUTs failed or overran: the game loaded on the plain sky (src/core/skyGuard.js); not a load failure
  gpu_lost: ['reason', 'backend'],
  watchdog_reload: ['reason'],
  js_error: ['msg', 'file', 'line'],
};
const URGENT = new Set(['gpu_lost', 'watchdog_reload', 'load_fail', 'session_end']);   // flushed at once: the page may be about to go

// ---- cleaning (client side; the server cleans again) ----
export const clean = (s, n = LIMITS.str) => String(s ?? '')
  .replace(/https?:\/\/[^\s)'"]+/g, (u) => u.replace(/[?#].*$/, ''))        // no query strings or fragments in a URL
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')                              // nor an email address
  .replace(/\s+/g, ' ').trim().slice(0, n);
export const fileOf = (u) => String(u ?? '').replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '').slice(-LIMITS.file);

export function tracking(env = {}) {
  const flags = toFlags(env.search ?? '');   // the page's flags (or a query string: the tests)
  if (flags.headless != null || flags.noload != null || flags.notrack || flags.metrics === '0') return false;
  if (env.webdriver) return false;                       // Playwright, Selenium: the probes and the test pages
  if (env.dnt === '1' || env.dnt === 'yes' || env.gpc === true) return false;
  if (flags.metrics === '1') return true;
  return !/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|.*\.local$)/.test(env.hostname ?? '');
}

export function createMetrics({ env = {}, send = null, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = clearTimeout } = {}) {
  const on = tracking(env) && typeof send === 'function';
  let queue = [], timer = null, jsErrors = 0;
  const sendNow = (body) => { try { send(ENDPOINT, body); } catch { /* silent */ } };
  function flush() {
    if (timer != null) { clearTimer(timer); timer = null; }
    while (queue.length) {
      // as many events as fit the byte cap, never more than the batch size
      let n = Math.min(queue.length, LIMITS.batch), body;
      for (; n > 1; n--) { body = JSON.stringify({ v: 1, e: queue.slice(0, n) }); if (body.length <= LIMITS.bodyBytes - 200) break; }
      body = JSON.stringify({ v: 1, e: queue.slice(0, n) });
      queue = queue.slice(n);
      if (body.length <= LIMITS.bodyBytes) sendNow(body);   // a single event over the cap is dropped, never split
    }
  }
  function track(name, props = {}) {
    if (!on || !(name in EVENTS)) return false;
    if (name === 'js_error' && ++jsErrors > 5) return false;   // a crash loop must not flood
    const p = {};
    for (const k of EVENTS[name]) {
      const v = props?.[k];
      if (v == null) continue;
      if (typeof v === 'number') { if (Number.isFinite(v)) p[k] = Math.round(v * 10) / 10; }
      else if (typeof v === 'boolean') p[k] = v;
      else p[k] = k === 'file' ? fileOf(v) : clean(v, k === 'steps' ? LIMITS.steps : LIMITS.str);
    }
    queue.push({ n: name, p });
    if (queue.length > LIMITS.queue) queue.shift();
    if (URGENT.has(name) || queue.length >= LIMITS.batch) flush();
    else if (timer == null) timer = setTimer(flush, LIMITS.flushMs);
    return true;
  }
  return { track, flush, get enabled() { return on; }, get pending() { return queue.length; } };
}

// ---- the live layer ----
let M = null;
export const track = (name, props) => { try { return M ? M.track(name, props) : false; } catch { return false; } };
export const deviceClass = (kind) => (String(kind).startsWith('phone') ? 'phone' : kind === 'tablet' ? 'tablet' : 'desktop');
// The GPU's coarse class for the counts: one of GPU_CLASSES, never the adapter's or the driver's own string (no model, no
// driver version: that would fingerprint). vendor: WebGPU's adapter info vendor; renderer: WebGL's unmasked renderer
// string (read, classified here, never sent); fallback: WebGPU's software adapter flag.
export const SUPPORT_SOURCES = ['card', 'about', 'help'];   // support_click's source: the home card's foot, the end of About, the About list's row
export const FIRST_BEATS = ['bottom', 'osprey', 'eagle', 'gust', 'storm'];
// session_start's display: how the page was opened (a browser tab, or a Home Screen launch: standalone or full screen)
export const DISPLAY_MODES = ['browser', 'standalone', 'fullscreen'];
export const GPU_CLASSES = ['software', 'apple', 'nvidia', 'amd', 'intel', 'mobile', 'other'];
export function gpuClass({ vendor = '', renderer = '', fallback = false } = {}) {
  const t = `${vendor} ${renderer}`.toLowerCase();
  if (fallback || /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(t)) return 'software';
  if (/\bapple\b/.test(t)) return 'apple';
  if (/nvidia|geforce|quadro|rtx/.test(t)) return 'nvidia';
  if (/\bamd\b|radeon|\bati\b/.test(t)) return 'amd';
  if (/intel/.test(t)) return 'intel';
  if (/qualcomm|adreno|\barm\b|mali|imagination|powervr|\bimg\b|samsung|xclipse/.test(t)) return 'mobile';
  return t.trim() ? 'other' : '';
}

// Why a load never reached its first frame (load_fail's `why`): the visitor left (the page hidden or closed), the 90 s
// timeout, a boot error, the last load ended without a word (iOS killed the tab: the boot guard's mark), or a module that
// failed to import, so the page reloads itself once (src/core/importRetry.js)
export const LOAD_WHY = ['left', 'timeout', 'error', 'killed', 'reload'];
// Each loading stage's and boot step's seconds, in order, for load_fail: "modules 11.9 gpu 1.3 … warm 3.8 probe 1.9 compile 4.6+".
// stages: the loading card's log ([name, fraction, ms since t0], src/ui/loading.js); steps: the boot's [name, ms from
// navigation] (src/ui/diag.js D.steps); the sky and boat stages are told by their boot steps. The last one is still
// running at `now`: its seconds so far, marked +. Names are short words, numbers one decimal: no ids, nothing typed.
const SHORT = { modules: 'mod', terrain: 'ter', water: 'wat', trees: 'tre', shore: 'sho', compile: 'cmp', probe: 'prb', modewarm: 'mwarm', latewarm: 'lwarm' };
export function loadSteps({ stages = [], t0 = 0, steps = [], now = 0 } = {}) {
  const marks = [['modules', 0]];
  for (const [n, , t] of stages) {
    if (n === 'sky' || n === 'boat' || n === 'ready' || String(n).startsWith('fail')) continue;
    if (marks.at(-1)[0] !== n) marks.push([String(n), t0 + t]);
  }
  for (const [n, t] of steps) marks.push([String(n), t]);
  marks.sort((a, b) => a[1] - b[1]);
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const [n, t] = marks[i], end = marks[i + 1]?.[1] ?? now;
    out.push(`${SHORT[n] ?? n.replace(/[^a-z0-9:]/gi, '').slice(0, 10)} ${Math.max(0, (end - t) / 1000).toFixed(1)}${i === marks.length - 1 ? '+' : ''}`);
  }
  while (out.length > 1 && out.join(' ').length > LIMITS.steps) out.shift();   // too long: the latest steps matter most
  return out.join(' ');
}

export function startMetrics({ g = globalThis } = {}) {
  if (M || !g.document) return M;
  const nav = g.navigator ?? {};
  const send = (url, body) => {
    const blob = typeof Blob === 'function' ? new Blob([body], { type: 'text/plain' }) : body;   // text/plain: no CORS preflight
    if (nav.sendBeacon?.(url, blob)) return;
    g.fetch?.(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  };
  M = createMetrics({
    env: { search: g.location?.search, hostname: g.location?.hostname, webdriver: !!nav.webdriver, dnt: nav.doNotTrack ?? g.doNotTrack ?? nav.msDoNotTrack, gpc: nav.globalPrivacyControl === true },
    send,
  });
  if (!M.enabled) return M;
  // js_error: message, file, line. Never the stack, never the page's state.
  g.addEventListener('error', (e) => { track('js_error', { msg: e.message, file: e.filename, line: e.lineno }); });
  g.addEventListener('unhandledrejection', (e) => { track('js_error', { msg: e.reason?.message ?? e.reason, file: '(promise)' }); });
  // session_end: visible seconds since the page came up or came back; flushed when the page is hidden or leaves
  let since = g.document.visibilityState === 'hidden' ? null : now();
  const end = () => { if (since == null) return; const s = (now() - since) / 1000; since = null; if (s >= 1) track('session_end', { duration_s: s }); M.flush(); };
  g.addEventListener('visibilitychange', () => { if (g.document.visibilityState === 'hidden') end(); else if (since == null) since = now(); });
  g.addEventListener('pagehide', end);
  return M;
}
function now() { return (globalThis.performance?.now?.() ?? Date.now()); }
