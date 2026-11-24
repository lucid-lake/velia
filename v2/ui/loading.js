// The front door's first module (index.html loads it before main.js, as v1's index.html loads src/ui/loading.js): v1's
// loading screen as it is (src/ui/loading.js: the mark, the voyage bar, the stage captions, the hand-off to the home card),
// installed here instead of by v1's data-auto block, with v1's own gate rule (frontPlan.js frontGate), no v1 boat prefetch
// (v2 streams its own packed models after the first frame) and no attract reel (owner, 2026-11-13: noReel.js stands in for
// it: the mark thins onto the golden still, then the live lake; no staged first minute: a first visit gets the same door,
// the card with v1's welcome). main.js tells it the stages (window.__veliaLoading: stage,
// ready, dispose); the home card's logic arrives after the first frame (front.js through ui/m4.js) and the card goes live
// then. A capture (?headless=1, ?noload=1) gets the shell's no-op api: no card.
import './landscapeBoot.js';   // first (phones are landscape-only): the turned frame before any other module reads the screen
import { installLoading } from '../../src/ui/loading.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { frontGate, RESUME_KEY } from './frontPlan.js';
import { installNoReel } from './noReel.js';
import { installLoadBar } from './loadBar.js';
import { watchHand } from '../../src/ui/hand.js';
import { installHomeScreen } from './install.js';
import { parseV2Flags, liveChartOn } from '../engine/flags.js';
import { installLoadReportDoor } from './loadReportDoor.js';
import { installLoadWords } from './loadWords.js';   // the loading page's facts, a phone's advice, and the hold until the card's layout is there
import { feature } from '../../src/core/features.js';   // the load report (?loadreport=1, a long press on the bar or the version, Setup › Screen)

// the load's marks start here (engine/loadMarks.js): the page's first module; the recorder only with ?loadreport=1
if (typeof document !== 'undefined') installLoadReportDoor();

// the hand first (src/ui/hand.js): data-hand="touch" | "keys" on <html> before the card's first words are read
if (typeof document !== 'undefined') watchHand();
// the Home Screen launch (ui/install.js): the visit counted, Android's install dialog kept, the Menu card's row, the
// iPhone's card when it is due (never on a first visit, never in the Home Screen app)
if (typeof document !== 'undefined') installHomeScreen({ flag: parseV2Flags(location.search).install });
// the first card's words by the hand and the owner's rulings (2026-11-15), on the shell's markup (tools/loading_shell.py writes it
// for v1 too, so v2 sets them here): no mode lit before a tap ("I need the enter mode gone"; home.js pickToEnter keeps it so), and
// the start failure's line names the browsers that run v2 on any device (the no-WebGPU gate's list), not "desktop" ones
export const FAIL_LINE = 'Try Chrome or Edge, Safari 26, or Firefox 141 or later.';
export function shellWords(root) {
  if (!root) return;
  for (const b of root.querySelectorAll('.lk-pick')) b.setAttribute('aria-checked', 'false');
  const fail = root.querySelector('.lk-fail');
  if (fail?.firstChild?.nodeType === 3) {   // "Your browser can't run Velia." <br> "Try desktop …" <small>
    const br = fail.querySelector('br'), t = br?.nextSibling;
    if (t?.nodeType === 3) t.textContent = FAIL_LINE;
  }
}

const root = typeof document !== 'undefined' ? document.getElementById('lk-load') : null;
if (root) {
  let resumeAt = NaN;
  try { resumeAt = parseFloat(sessionStorage.getItem(RESUME_KEY) ?? ''); sessionStorage.removeItem(RESUME_KEY); } catch { /* no storage */ }
  const webdriver = !!navigator.webdriver;
  const off = document.documentElement.classList.contains('lk-nol');
  shellWords(root);
  const reel = off ? null : installNoReel({ root });   // a first visit and a returning one alike: no staged minute in v2
  const L = installLoading({ gate: frontGate({ flags: FLAGS, webdriver, resumeAt, now: Date.now() }), home: true, prefetch: false, reel });
  // the voyage bar's motion (loadBar.js: compositor-driven, a creep between the real milestones): the boot's stages and
  // ready reach it through the same api main.js already calls; start.js marks the gate (api.bar)
  if (!off && L && !L.off) {
    // the words under the line and the hold (loadWords.js): the old big card never paints before the panel or the phone card
    L.words = installLoadWords({ root, phone: feature('loadPhoneAdvice').on, waitMap: liveChartOn(location.search, true),
      standalone: () => document.documentElement.classList.contains('lk-standalone') || navigator.standalone === true });
    const bar = installLoadBar({ root });
    const { stage, ready, dispose } = L;
    L.bar = bar;
    L.stage = (name, f) => { stage(name, f); bar.mark(name); };
    L.ready = () => { ready(); bar.ready(); };
    L.dispose = () => { bar.stop(); L.words?.dispose(); return dispose(); };
  }
}
