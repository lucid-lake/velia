// The load report's doors (owner, 2026-11-16: "Mobile phone loading is a big pain. Build a way to find where the blocker
// is"). Tiny and in the first module (ui/loading.js), so the marks start with the page; the card itself is its own chunk
// (ui/loadReportCard.js), fetched only when it opens.
//   ?loadreport=1      the recorder from the first module (engine/loadRecorder.js), then the card once the home card is live
//                      (or the start failed, or after STUCK_MS: a stuck load reports where it is stuck)
//   a long press       on the loading bar, the card's version line or About's version: the card for this load, now
//   (About's "Loading report ›" link was removed, owner 2026-11-19); the card's
//                      "Record a fresh load" opens the page again with ?loadreport=1
// Off by default: without the flag a page only keeps its marks and a longer resource list (engine/loadMarks.js).
import { lmPoint, lmStart, lmEnd, lmHas, keepResources } from '../engine/loadMarks.js';
import { startLoadRecorder } from '../engine/loadRecorder.js';

const PRESS_MS = 650, STUCK_MS = 60000;
// the spans the report waits for once started, so it shows a finished load: a phone's modes (every shader built first) and the
// shaders built after the first frame (a desktop's background build ends about 1 s after its card is live)
const LATE_SPANS = Object.freeze(['modes', 'pipes.late']);
const PRESS_TARGETS = '#lk-load .lk-voyage, #lk-load .lk-ver, .pg[data-page=about] .stamp-b';
const LIVE_STATES = ['home', 'menu', 'gone', 'attract'];
let rec = null, opening = null;

const reportWanted = (search = globalThis.location?.search ?? '') => { const v = new URLSearchParams(search).get('loadreport'); return v != null && v !== '0' && v !== 'false'; };

// the card for this load (the recorder's data when it ran)
function openReport() {
  opening ??= import('./loadReportCard.js').then((m) => { opening = null; rec?.stop(); return m.openLoadReport({ rec }); }).catch((e) => { opening = null; console.error(e); return null; });
  return opening;
}

// the home card is live: its scripts are in (front.js and Sail's UI: main.js passes their promises; the stage `card` ends then,
// never before the first frame) and the loading card has handed over (`handover`: its ease and fade, by design)
export function markCardLive(frontReady, { win = globalThis, maxMs = 20000 } = {}) {
  const t0 = win.performance.now();
  const late = () => win.performance.now() - t0 > maxMs;
  const after = (ok, fn) => { const look = () => { if (late() || ok()) { fn(); return; } setTimeout(look, 50); }; look(); };
  Promise.resolve(frontReady).catch(() => null).then(() => after(() => lmHas('frame1'), () => lmEnd('card')));
  after(() => { const s = win.__veliaLoading?.state; return lmHas('frame1') && (s == null || LIVE_STATES.includes(s)); }, () => lmEnd('handover'));
}

function installPress(doc) {
  const st = doc.createElement('style');
  st.textContent = `${PRESS_TARGETS}{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}`;
  doc.head?.appendChild(st);
  let timer = null, at = null, fired = false;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  doc.addEventListener('pointerdown', (e) => {
    const el = e.target?.closest?.(PRESS_TARGETS); if (!el) return;
    cancel(); fired = false; at = [e.clientX, e.clientY];
    timer = setTimeout(() => { timer = null; fired = true; openReport(); }, PRESS_MS);
  }, true);
  doc.addEventListener('pointermove', (e) => { if (timer && at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > 12) cancel(); }, true);
  for (const ev of ['pointerup', 'pointercancel']) doc.addEventListener(ev, cancel, true);
  doc.addEventListener('click', (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);   // the press is not a tap on what is under it
  doc.addEventListener('contextmenu', (e) => { if (e.target?.closest?.(PRESS_TARGETS)) e.preventDefault(); }, true);
}

// the first module's part: called once by ui/loading.js
export function installLoadReportDoor({ doc = globalThis.document, search } = {}) {
  keepResources();
  lmPoint('index');
  if (!doc) return null;
  try { if (doc.fonts?.ready) { lmStart('fonts'); doc.fonts.ready.then(() => lmEnd('fonts')); } } catch { /* no font loading API */ }
  installPress(doc);
  if (!reportWanted(search)) return null;
  rec = startLoadRecorder();
  const t0 = globalThis.performance.now();
  const poll = () => {
    if ((lmHas('card:e') && lmHas('handover:e') && LATE_SPANS.every((n) => !lmHas(`${n}:s`) || lmHas(`${n}:e`))) || lmHas('fail') || globalThis.performance.now() - t0 > STUCK_MS) { setTimeout(openReport, lmHas('fail') ? 100 : 400); return; }   // a finished load: the card live and every late span done (LATE_SPANS)
    setTimeout(poll, 250);
  };
  poll();
  return rec;
}
