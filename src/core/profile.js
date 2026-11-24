// The device profile (owner, 2026-11-17: one answer per question): the only module that reads the browser for
// device facts. Four questions used to share one word, "phone"; each is its own axis here:
//   input    'touch' | 'keys' | 'mixed'   what the hands can use: a finger only, a mouse or trackpad only, or both (an iPad
//                                         with a trackpad, a touch laptop). From any-pointer at load: coarse + fine is mixed.
//                                         hand (below) is the last pointer used (the input modality), live.
//   form     'phone' | 'tablet' | 'desktop'   the device itself: the physical screen (screen.width/height, which the page's turn
//                                         never changes), touch points, the UA's phone and tablet words, and the iPad-reports-
//                                         as-a-Mac rule (a Mac UA with touch points). A desktop window dragged small stays a desktop.
//   screen   'short' | 'compact' | 'full'   the layout the page has, after the turn (ui/landscape.js swaps innerWidth/innerHeight):
//                                         compact under LIMITS.phoneShort on its short side (a phone-sized frame), short when
//                                         that frame is also under LIMITS.tall px tall (a phone's browser tab: the compact
//                                         sizes); full otherwise. The size lines (500, 520, 600, 640, 370) live
//                                         in LIMITS and nowhere else; CSS reads them as data-screen tokens (screenTokens).
//   gpu      0 | 1 | 2 | 3 | null         the quality ladder's level (v2/engine/quality.js), live: the page sets it at load and
//                                         on every step, the race's steps too (setGpu). null where no ladder runs (v1, tests).
//   quirks   a list of: 'ios-webkit' (every iOS and iPadOS browser), 'standalone' (a Home Screen launch), 'slow-compiler'
//            (this GPU's last load took over RETRY_SLOW_MS to build its first frame's pipelines: the page sets it),
//            'rotated' (an upright phone's page turned on its side).
// v2 installs it (profile.install(): its own listeners); v1's watchDevice (src/ui/device.js) refreshes it on its resize.
// On <html>: data-input, data-form, data-screen (the tier, then its tokens: "compact narrow low"), data-gpu, data-quirks
// (space separated; CSS reads [data-quirks~=rotated]). JS: profile.get(), profile.on('change', fn) → off.
// ?profile=form:phone,input:touch,gpu:2,screen:short,quirks:ios-webkit+rotated forces any axis (the tests and the A/B). The old
// flags are its aliases: ?touch=1|0 is input touch | keys; ?quality=N is the ladder's pin (and so gpu); ?terrain, ?levers,
// ?portrait and ?thumb are features' own pins (src/core/features.js).
// Pure helpers for the tests: readFacts(win), profileOf(facts, force), parseProfileFlag(s), screenTokens(w, h), kindOf(p).
import { toFlags } from '../sim/core/flags.js';

export const LIMITS = Object.freeze({
  phoneShort: 500,   // a short side under this is a phone: the physical screen for form, the layout for screen (compact)
  tall: 370,         // a compact frame under this tall is short (a phone's browser tab: 320–360 px; the Home Screen 390–430 px)
  tight: 500,        // a layout this low or lower carries the token tight (the short card and hub layouts)
  low: 520,          // a layout this low or lower and landscape (w ≥ lowAspect × h) carries the token low (the short-window card)
  lowAspect: 5 / 4,
  raceNarrow: 600,   // a layout this narrow or narrower carries the token slim (Regatta's plates and briefing)
  narrow: 640,       // a layout this narrow or narrower carries the token narrow (the narrow window's rules)
  upright: 4 / 5,    // a layout this upright or more (w ≤ upright × h) carries the token upright
});
export const INPUTS = Object.freeze(['touch', 'keys', 'mixed']);
const FORMS = Object.freeze(['phone', 'tablet', 'desktop']);
const SCREENS = Object.freeze(['short', 'compact', 'full']);
const QUIRKS = Object.freeze(['ios-webkit', 'standalone', 'slow-compiler', 'rotated']);

const PHONE_UA = /iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i;
const TABLET_UA = /iPad|Tablet|Android(?!.*Mobile)/i;
const MAC_UA = /Macintosh|MacIntel/i;

// ---- pure ------------------------------------------------------------------------------------------------------------------
// the input from the pointer queries: a coarse main pointer and no fine one is a finger; coarse beside fine is mixed
function inputOf({ coarse = false, anyCoarse = false, anyFine = false } = {}) {
  if (anyFine && (coarse || anyCoarse)) return 'mixed';
  if (coarse && !anyFine) return 'touch';
  return 'keys';
}
// the form from the device (screen: the physical screen, CSS px; input: the real input, not a forced one)
export function formOf({ ua = '', platform = '', touchPoints = 0, coarse = false, screenW = 1280, screenH = 720, input = 'keys' } = {}) {
  const short = Math.min(screenW || 0, screenH || 0) || Infinity;
  if (PHONE_UA.test(ua)) return 'phone';
  if ((touchPoints > 0 || coarse) && short < LIMITS.phoneShort) return 'phone';
  if (TABLET_UA.test(ua) || (MAC_UA.test(ua + platform) && touchPoints > 1)) return 'tablet';   // an iPad asks for desktop sites as a Mac with touch points
  if (input === 'touch') return 'tablet';   // a finger-only device with a big screen (a Chromebook or a Surface in tablet mode)
  return 'desktop';
}
// the screen tier of a layout (w × h after the turn; fh: the visible frame's height when known, else h)
function screenOf({ w = 1280, h = 720, fh = null } = {}) {
  if (Math.min(w, h) >= LIMITS.phoneShort) return 'full';
  return (fh ?? h) < LIMITS.tall ? 'short' : 'compact';
}
// the CSS tokens of a layout: the tier first (a short frame is compact too), then narrow (≤ 640 wide), slim (≤ 600 wide), low
// (≤ 520 tall, landscape: w ≥ 5/4 h), tight (≤ 500 tall), upright (w ≤ 4/5 h), portrait (taller than wide). One line each,
// here; the CSS writes [data-screen~=narrow] or [data-screen~=compact], never a width or a device class.
export function screenTokens(w = 1280, h = 720, fh = null) {
  const t = [screenOf({ w, h, fh })];
  if (t[0] === 'short') t.push('compact');
  if (w <= LIMITS.narrow) t.push('narrow');
  if (w <= LIMITS.raceNarrow) t.push('slim');
  if (h <= LIMITS.low && w >= LIMITS.lowAspect * h) t.push('low');
  if (h <= LIMITS.tight) t.push('tight');
  if (w <= LIMITS.upright * h) t.push('upright');
  if (h > w) t.push('portrait');
  return t;
}
function quirksOf({ ua = '', platform = '', touchPoints = 0, standalone = false, rotated = false, slowCompiler = false } = {}) {
  const q = [];
  if (/iPhone|iPad|iPod/.test(ua) || (MAC_UA.test(ua + platform) && touchPoints > 1)) q.push('ios-webkit');
  if (standalone) q.push('standalone');
  if (slowCompiler) q.push('slow-compiler');
  if (rotated) q.push('rotated');
  return q;
}
// ?profile=form:phone,input:touch,gpu:2,screen:short,quirks:ios-webkit+rotated → { form, input, gpu, screen, quirks }, axes absent
// when not named (a bad value is ignored)
export function parseProfileFlag(s) {
  const o = {};
  if (s == null || s === '') return o;
  for (const part of String(s).split(',')) {
    const [k0, v0 = ''] = part.split(':'); const k = k0.trim().toLowerCase(), v = v0.trim().toLowerCase();
    if (k === 'input' && INPUTS.includes(v)) o.input = v;
    else if (k === 'form' && FORMS.includes(v)) o.form = v;
    else if (k === 'screen' && SCREENS.includes(v)) o.screen = v;
    else if (k === 'gpu' && /^[0-3]$/.test(v)) o.gpu = Number(v);
    else if (k === 'quirks') o.quirks = v ? v.split('+').map((x) => x.trim()).filter((x) => QUIRKS.includes(x)) : [];
  }
  return o;
}
// the forced axes from the URL: ?profile= and its alias ?touch=1|0 (input)
export function forcedOf(search = '') {
  const flags = toFlags(search);
  const o = parseProfileFlag(flags.profile);
  if (o.input == null && flags.touch === '1') o.input = 'touch';
  if (o.input == null && flags.touch === '0') o.input = 'keys';
  return o;
}

// a window's device facts (any object shaped like one: the tests pass fakes)
export function readFacts(win = globalThis) {
  const mm = (q) => { try { return !!win.matchMedia?.(q)?.matches; } catch { return false; } };
  const nav = win.navigator ?? {};
  const w = win.innerWidth ?? 1280, h = win.innerHeight ?? 720;
  const fr = (() => { try { return win.__veliaScreen?.frame?.() ?? null; } catch { return null; } })();
  const rotated = (() => { try { return !!win.__veliaTurn?.rotated?.() || !!win.document?.documentElement?.classList?.contains('lk-rot'); } catch { return false; } })();
  return {
    coarse: mm('(pointer: coarse)'), anyCoarse: mm('(any-pointer: coarse)'), anyFine: mm('(any-pointer: fine)'), anyHover: mm('(any-hover: hover)'),
    touchPoints: nav.maxTouchPoints ?? 0, ua: nav.userAgent ?? '', platform: nav.platform ?? '',
    screenW: win.screen?.width || w, screenH: win.screen?.height || h,
    w, h, fh: fr && fr.h > 0 ? fr.h : null,
    standalone: nav.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)'),
    rotated,
  };
}

// the profile from facts (pure): { input, form, screen, tokens, gpu, quirks, w, h }; force: the forced axes (forcedOf), set: what
// the page told it ({ gpu, slowCompiler })
export function profileOf(facts, force = {}, set = {}) {
  const input = inputOf(facts);
  const form = formOf({ ...facts, input });
  const tokens = screenTokens(facts.w, facts.h, facts.fh);
  if (force.screen) tokens[0] = force.screen;
  const quirks = force.quirks ?? quirksOf({ ...facts, slowCompiler: !!set.slowCompiler });
  const gpu = force.gpu ?? (Number.isInteger(set.gpu) ? set.gpu : null);
  return Object.freeze({ input: force.input ?? input, form: force.form ?? form, screen: tokens[0], tokens: Object.freeze(tokens), gpu, quirks: Object.freeze(quirks), w: facts.w, h: facts.h, forced: Object.keys(force).length > 0 });
}

// the old layout tier (src/ui/device.js deviceKind's words) from a profile: a phone-sized frame is phone-land or phone-port by
// its layout; else a finger's or a tablet's big frame is 'tablet' (an iPad with a trackpad is a tablet), the rest 'desktop'
export function kindOf(p) {
  if (p.screen !== 'full') return p.h > p.w ? 'phone-port' : 'phone-land';
  return p.input === 'touch' || p.form === 'tablet' ? 'tablet' : 'desktop';
}
// a profile for any window (pure of the singleton: the tests pass fake windows)
export function profileFor(win = globalThis) {
  let search = ''; try { search = win.location?.search ?? ''; } catch { /* none */ }
  return profileOf(readFacts(win), forcedOf(search));
}

// ---- the page's profile (one per page) ---------------------------------------------------------------------------------------
const ATTRS = { input: 'input', form: 'form', screen: 'screen', gpu: 'gpu', quirks: 'quirks' };
function createProfile(win = globalThis) {
  const set = { gpu: null, slowCompiler: false };
  const subs = new Set(), pubs = new Set();
  let now = null, installed = false;
  const search = () => { try { return win.location?.search ?? ''; } catch { return ''; } };
  const compute = () => profileOf(readFacts(win), forcedOf(search()), set);
  const key = (p) => `${p.input}|${p.form}|${p.tokens.join(' ')}|${p.gpu}|${p.quirks.join(' ')}`;
  const publish = (p) => {
    const H = win.document?.documentElement; if (!H?.dataset) return;
    const v = { input: p.input, form: p.form, screen: p.tokens.join(' '), gpu: p.gpu == null ? null : String(p.gpu), quirks: p.quirks.join(' ') };
    for (const [k, a] of Object.entries(ATTRS)) { if (v[k] == null) delete H.dataset[a]; else if (H.dataset[a] !== v[k]) H.dataset[a] = v[k]; }
  };
  const refresh = () => {
    const next = compute(), was = now;
    if (was && key(was) === key(next)) { publish(was); for (const f of pubs) { try { f(was); } catch (e) { console.error(e); } } return was; }   // a new document (the tests) gets the attributes too
    now = next; publish(next); for (const f of pubs) { try { f(next); } catch (e) { console.error(e); } }
    if (was) for (const f of subs) { try { f(next, was); } catch (e) { console.error(e); } }
    return now;
  };
  const install = () => {
    if (installed || typeof win.addEventListener !== 'function' || !win.document) return;
    installed = true;
    for (const ev of ['resize', 'orientationchange', 'lk-screen', 'lk-turn']) win.addEventListener(ev, () => refresh());
    try { win.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', () => refresh()); } catch { /* old Safari */ }
  };
  return {
    get() { if (!now) { now = compute(); publish(now); } return now; },
    refresh,
    install() { install(); return this.get(); },   // v2/start.js: follow resizes, the turn, the screen tier, a Home Screen launch (v1: watchDevice refreshes on its resize)
    on(ev, fn) { const set = ev === 'change' ? subs : ev === 'publish' ? pubs : null; if (!set || typeof fn !== 'function') return () => {}; set.add(fn); return () => set.delete(fn); },   // change: an axis moved; publish: the attributes were written (every refresh)
    setGpu(level) { const v = Number.isInteger(level) ? level : null; if (set.gpu === v) return; set.gpu = v; if (now) refresh(); },
    setQuirk(name, on) { if (name === 'slow-compiler') { if (set.slowCompiler === !!on) return; set.slowCompiler = !!on; if (now) refresh(); } },
    forced: () => forcedOf(search()),
  };
}
export const profile = createProfile();
